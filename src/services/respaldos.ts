import type { Metadatos } from '../models';
import type { Repositorio } from '../repositories/tipos';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { ESQUEMAS_TABLA, FORMATO_RESPALDO, TABLAS_RESPALDO, esquemaSobre, type TablaRespaldo } from '../validators/respaldo';
import { type Contexto, metadatosActualizados, metadatosNuevos } from './contexto';

export const LIMITE_RESPALDO = 25 * 1024 * 1024; // caracteres
const DIAS_RECORDATORIO = 7;

export interface Respaldo {
  formato: typeof FORMATO_RESPALDO;
  versionFormato: 1;
  esquema: number;
  creadoEn: string;
  escuelas: { id: string; nombre: string }[];
  huella: string | null;
  datos: Record<TablaRespaldo, Metadatos[]>;
}

export interface EscuelaEnRespaldo {
  id: string;
  nombre: string;
  accion: 'agregar' | 'reemplazar' | 'bloqueado';
  motivo: string | null;
  conteos: { tabla: TablaRespaldo; actual: number; respaldo: number }[];
}

export interface AnalisisRespaldo {
  errores: string[];
  advertencias: string[];
  creadoEn: string | null;
  esquema: number | null;
  escuelas: EscuelaEnRespaldo[];
  puedeRestaurar: boolean;
}

export const ETIQUETA_TABLA: Record<TablaRespaldo, string> = {
  escuelas: 'Escuela', ciclos: 'Ciclos escolares', turnos: 'Turnos', jornadas: 'Jornadas', periodos: 'Periodos', recesos: 'Recesos',
  grados: 'Grados', grupos: 'Grupos', personal: 'Personal', materias: 'Materias', asignaciones: 'Asignaciones', sesiones: 'Clases del horario',
  actividades: 'Servicio y otras actividades', excepciones: 'Casos especiales', confirmaciones: 'Horarios confirmados', bitacora: 'Bitácora',
  alumnos: 'Alumnos', pases: 'Listas de asistencia', asistencias: 'Marcas de asistencia', salidas: 'Salidas del aula', reportes: 'Reportes',
};

/** Referencias internas que deben existir dentro del mismo respaldo. */
const REFERENCIAS: [TablaRespaldo, string, TablaRespaldo, boolean][] = [
  // [tabla, campo, tabla destino, puede ser null]
  ['ciclos', 'escuelaId', 'escuelas', false],
  ['turnos', 'cicloEscolarId', 'ciclos', false],
  ['jornadas', 'turnoId', 'turnos', false],
  ['periodos', 'jornadaId', 'jornadas', false],
  ['recesos', 'jornadaId', 'jornadas', false],
  ['grados', 'cicloEscolarId', 'ciclos', false],
  ['grupos', 'gradoId', 'grados', false],
  ['grupos', 'turnoId', 'turnos', false],
  ['materias', 'cicloEscolarId', 'ciclos', false],
  ['asignaciones', 'grupoId', 'grupos', false],
  ['asignaciones', 'materiaId', 'materias', false],
  ['asignaciones', 'personalId', 'personal', true],
  ['sesiones', 'asignacionId', 'asignaciones', false],
  ['sesiones', 'periodoId', 'periodos', false],
  ['actividades', 'personalId', 'personal', true],
  ['actividades', 'grupoId', 'grupos', true],
  ['excepciones', 'personalId', 'personal', false],
  ['confirmaciones', 'grupoId', 'grupos', false],
  ['alumnos', 'grupoId', 'grupos', false],
  ['pases', 'asignacionId', 'asignaciones', false],
  ['asistencias', 'paseId', 'pases', false],
  ['asistencias', 'alumnoId', 'alumnos', false],
  ['salidas', 'alumnoId', 'alumnos', false],
  ['reportes', 'alumnoId', 'alumnos', false],
];

async function sha256(texto: string): Promise<string | null> {
  const sutil = globalThis.crypto?.subtle;
  if (!sutil) return null; // fuera de HTTPS/localhost no está disponible
  const b = await sutil.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Respaldo y restauración local (archivo JSON). Nada sale del dispositivo
 * salvo el archivo que la persona descarga. Restaurar es todo o nada.
 */
export class ServicioRespaldos {
  constructor(private readonly ctx: Contexto, private readonly versionEsquema: number) {}

  private repo(t: TablaRespaldo): Repositorio<Metadatos> {
    return this.ctx.repos[t] as unknown as Repositorio<Metadatos>;
  }

  private async registrosDe(escuelaId: string, t: TablaRespaldo): Promise<Metadatos[]> {
    const todos = await this.repo(t).listarTodos();
    return todos.filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === escuelaId);
  }

  // ---------- Exportar ----------

  async exportar(escuelaIds: string[]): Promise<{ nombreArchivo: string; contenido: string; registros: number }> {
    if (!escuelaIds.length) throw new ErrorDominio('VALIDACION', 'Selecciona al menos una escuela.');
    const escuelas = [];
    for (const id of escuelaIds) {
      const e = await this.ctx.repos.escuelas.obtener(id);
      if (!e) throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró la escuela.');
      escuelas.push(e);
    }
    const datos = {} as Record<TablaRespaldo, Metadatos[]>;
    let registros = 0;
    for (const t of TABLAS_RESPALDO) {
      const lista: Metadatos[] = [];
      for (const e of escuelas) lista.push(...await this.registrosDe(e.id, t));
      datos[t] = lista.sort((a, b) => a.id.localeCompare(b.id));
      registros += lista.length;
    }
    const creadoEn = this.ctx.reloj();
    const respaldo: Respaldo = {
      formato: FORMATO_RESPALDO, versionFormato: 1, esquema: this.versionEsquema, creadoEn,
      escuelas: escuelas.map((e) => ({ id: e.id, nombre: e.nombre })), huella: await sha256(JSON.stringify(datos)), datos,
    };
    const base = escuelas.length === 1 ? (escuelas[0]!.cct ?? normalizarTexto(escuelas[0]!.nombre).replace(/[^a-z0-9]+/g, '-')) : 'todas';
    return { nombreArchivo: `respaldo-gestion-escolar-${base}-${creadoEn.slice(0, 10)}.json`, contenido: JSON.stringify(respaldo), registros };
  }

  async registrarRespaldo(escuelaIds: string[]): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      for (const id of escuelaIds) {
        const clave = `ultimo-respaldo:${id}`;
        const a = await this.ctx.repos.ajustes.obtener(clave);
        if (a) await this.ctx.repos.ajustes.actualizar({ ...a, valor: this.ctx.reloj(), ...metadatosActualizados(this.ctx, a) });
        else await this.ctx.repos.ajustes.insertar({ ...metadatosNuevos(this.ctx), id: clave, valor: this.ctx.reloj() });
      }
    });
  }

  /** Último respaldo y si hubo cambios después (para el recordatorio). */
  async estado(escuelaId: string, ahora: Date): Promise<{ ultimo: string | null; cambiosDespues: boolean; registros: number; recordar: boolean }> {
    const ultimo = (await this.ctx.repos.ajustes.obtener(`ultimo-respaldo:${escuelaId}`))?.valor ?? null;
    let registros = 0; let masReciente = '';
    for (const t of TABLAS_RESPALDO) {
      for (const r of await this.registrosDe(escuelaId, t)) { registros++; if (r.actualizadoEn > masReciente) masReciente = r.actualizadoEn; }
    }
    const cambiosDespues = !ultimo || masReciente > ultimo;
    const viejo = !ultimo || ahora.getTime() - new Date(ultimo).getTime() > DIAS_RECORDATORIO * 86_400_000;
    return { ultimo, cambiosDespues, registros, recordar: registros > 1 && cambiosDespues && viejo };
  }

  // ---------- Analizar (sin escribir nada) ----------

  /** Analiza sin escribir nada: verificación del archivo + comparación con este dispositivo. */
  async analizar(contenido: string): Promise<AnalisisRespaldo & { _datos?: Record<TablaRespaldo, Metadatos[]> }> {
    const v = await this.verificarArchivo(contenido);
    if (!v.datos) return v.analisis;
    return this.comparar(v.analisis, v.sobre!, v.datos);
  }

  /**
   * Lectura, huella y validación del archivo. NO toca la base de datos: se hace
   * fuera de la transacción porque `crypto.subtle` (asíncrono y ajeno a IndexedDB)
   * haría que la transacción se cerrara antes de tiempo.
   */
  private async verificarArchivo(contenido: string): Promise<{ analisis: AnalisisRespaldo; sobre?: { escuelas: { id: string; nombre: string }[] }; datos?: Record<TablaRespaldo, Metadatos[]> }> {
    const vacio = (errores: string[]): AnalisisRespaldo => ({ errores, advertencias: [], creadoEn: null, esquema: null, escuelas: [], puedeRestaurar: false });
    if (contenido.length > LIMITE_RESPALDO) return { analisis: vacio(['El archivo supera 25 MB.']) };
    let crudo: unknown;
    try { crudo = JSON.parse(contenido); } catch { return { analisis: vacio(['El archivo no es un respaldo válido (no se pudo leer).']) }; }
    const sobre = esquemaSobre.safeParse(crudo);
    if (!sobre.success) return { analisis: vacio([sobre.error.issues[0]?.message.startsWith('El archivo') ? sobre.error.issues[0].message : 'El archivo no es un respaldo de Gestión Escolar o está incompleto.']) };
    const s = sobre.data;
    const errores: string[] = [];
    const advertencias: string[] = [];
    if (s.esquema > this.versionEsquema) return { analisis: { ...vacio([`El respaldo se hizo con una versión más nueva de la aplicación (esquema ${s.esquema}). Actualiza la aplicación antes de restaurarlo.`]), creadoEn: s.creadoEn, esquema: s.esquema } };

    const huella = await sha256(JSON.stringify(s.datos));
    if (s.huella && huella && s.huella !== huella) errores.push('El archivo fue modificado o está dañado: su huella de verificación no coincide.');
    if (!s.huella) advertencias.push('El respaldo no tiene huella de verificación; no se puede comprobar que esté íntegro.');
    if (s.huella && !huella) advertencias.push('Este navegador no puede verificar la huella del archivo (requiere HTTPS o localhost).');

    // Validación de cada registro
    const datos = {} as Record<TablaRespaldo, Metadatos[]>;
    for (const t of Object.keys(s.datos)) if (!(TABLAS_RESPALDO as string[]).includes(t)) advertencias.push(`Se ignora la tabla desconocida «${t}».`);
    for (const t of TABLAS_RESPALDO) {
      const lista = s.datos[t] ?? [];
      const validos: Metadatos[] = [];
      const ids = new Set<string>();
      lista.forEach((r, i) => {
        const v = ESQUEMAS_TABLA[t].safeParse(r);
        if (!v.success) { if (errores.length < 20) errores.push(`${ETIQUETA_TABLA[t]}, registro ${i + 1}: dato inválido en «${v.error.issues[0]?.path.join('.') || 'registro'}».`); return; }
        if (ids.has(v.data.id)) { errores.push(`${ETIQUETA_TABLA[t]}: identificador repetido.`); return; }
        ids.add(v.data.id);
        validos.push(v.data as Metadatos);
      });
      datos[t] = validos;
    }
    const idsEscuela = new Set(s.escuelas.map((e) => e.id));
    for (const e of s.escuelas) if (!datos.escuelas.some((x) => x.id === e.id)) errores.push(`Falta la escuela «${e.nombre}» en los datos.`);
    for (const t of TABLAS_RESPALDO) {
      if (t === 'escuelas') continue;
      if (datos[t].some((r) => !idsEscuela.has((r as Metadatos & { escuelaId: string }).escuelaId))) errores.push(`${ETIQUETA_TABLA[t]}: hay registros de una escuela que no está en el respaldo.`);
    }
    for (const [t, campo, destino, nulo] of REFERENCIAS) {
      const existentes = new Set(datos[destino].map((r) => r.id));
      const rotos = datos[t].filter((r) => { const v = (r as unknown as Record<string, string | null>)[campo]; return v === null ? !nulo : !existentes.has(v!); }).length;
      if (rotos) errores.push(`${ETIQUETA_TABLA[t]}: ${rotos} registro(s) hacen referencia a ${ETIQUETA_TABLA[destino].toLowerCase()} que no están en el respaldo.`);
    }
    return { analisis: { errores, advertencias, creadoEn: s.creadoEn, esquema: s.esquema, escuelas: [], puedeRestaurar: false }, sobre: s, datos };
  }

  /** Comparación con este dispositivo: SÓLO operaciones de la base de datos. */
  private async comparar(base: AnalisisRespaldo, s: { escuelas: { id: string; nombre: string }[] }, datos: Record<TablaRespaldo, Metadatos[]>): Promise<AnalisisRespaldo & { _datos: Record<TablaRespaldo, Metadatos[]> }> {
    const errores = [...base.errores];
    const escuelasAqui = await this.ctx.repos.escuelas.listarTodos();
    const resultado: EscuelaEnRespaldo[] = [];
    for (const e of s.escuelas) {
      const enRespaldo = datos.escuelas.find((x) => x.id === e.id) as (Metadatos & { nombre: string; cct: string | null }) | undefined;
      const existe = escuelasAqui.find((x) => x.id === e.id);
      let accion: EscuelaEnRespaldo['accion'] = existe ? 'reemplazar' : 'agregar';
      let motivo: string | null = null;
      if (!existe && enRespaldo) {
        const choca = enRespaldo.cct
          ? escuelasAqui.find((x) => x.cct && normalizarTexto(x.cct) === normalizarTexto(enRespaldo.cct!))
          : escuelasAqui.find((x) => !x.cct && normalizarTexto(x.nombre) === normalizarTexto(enRespaldo.nombre));
        if (choca) { accion = 'bloqueado'; motivo = `En este dispositivo ya existe otra escuela «${choca.nombre}» con ${enRespaldo.cct ? 'la misma CCT' : 'el mismo nombre'}, registrada por separado. No se mezclan: elimínala o restaura en otro dispositivo.`; }
      }
      const conteos = [];
      for (const t of TABLAS_RESPALDO) {
        const respaldo = datos[t].filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === e.id).length;
        const actual = existe ? (await this.registrosDe(e.id, t)).length : 0;
        if (respaldo || actual) conteos.push({ tabla: t, actual, respaldo });
      }
      resultado.push({ id: e.id, nombre: e.nombre, accion, motivo, conteos });
    }
    // Identificadores que ya existen en este dispositivo bajo otra escuela
    for (const t of TABLAS_RESPALDO) {
      const aqui = new Map((await this.repo(t).listarTodos()).map((r) => [r.id, t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId]));
      for (const r of datos[t]) {
        const dueno = aqui.get(r.id);
        const suya = t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId;
        if (dueno !== undefined && dueno !== suya) { errores.push(`${ETIQUETA_TABLA[t]}: hay identificadores que ya pertenecen a otra escuela de este dispositivo.`); break; }
      }
    }
    return { ...base, errores, escuelas: resultado, puedeRestaurar: errores.length === 0 && resultado.some((x) => x.accion !== 'bloqueado'), _datos: datos };
  }

  // ---------- Restaurar (todo o nada) ----------

  async restaurar(contenido: string, escuelaIds: string[]): Promise<{ agregadas: number; reemplazadas: number; registros: number }> {
    const v = await this.verificarArchivo(contenido); // fuera de la transacción
    if (!v.datos || v.analisis.errores.length) throw new ErrorDominio('VALIDACION', `No se restauró nada: ${v.analisis.errores[0] ?? 'archivo inválido'}`);
    return this.ctx.uow.ejecutar(async () => {
      const a = await this.comparar(v.analisis, v.sobre!, v.datos!); // se vuelve a comparar dentro de la transacción
      if (a.errores.length) throw new ErrorDominio('VALIDACION', `No se restauró nada: ${a.errores[0]}`);
      const elegidas = a.escuelas.filter((e) => escuelaIds.includes(e.id));
      if (!elegidas.length) throw new ErrorDominio('VALIDACION', 'Selecciona al menos una escuela del respaldo.');
      const bloqueada = elegidas.find((e) => e.accion === 'bloqueado');
      if (bloqueada) throw new ErrorDominio('ESTADO_NO_PERMITIDO', bloqueada.motivo ?? 'No se puede restaurar esa escuela.');
      let registros = 0;
      for (const e of elegidas) {
        if (e.accion === 'reemplazar') {
          for (const t of TABLAS_RESPALDO) await this.repo(t).eliminarVarios((await this.registrosDe(e.id, t)).map((r) => r.id));
        }
        for (const t of TABLAS_RESPALDO) {
          const lista = a._datos![t].filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === e.id);
          await this.repo(t).insertarVarios(lista);
          registros += lista.length;
        }
      }
      return { agregadas: elegidas.filter((e) => e.accion === 'agregar').length, reemplazadas: elegidas.filter((e) => e.accion === 'reemplazar').length, registros };
    });
  }
}
