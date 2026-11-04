import type { Metadatos } from '../models';
import type { Repositorio } from '../repositories/tipos';
import { ErrorDominio } from '../domain/errores';
import { nuevoId } from '../utils/id';
import { normalizarTexto } from '../domain/texto';
import { comprimir, descomprimir, esComprimido } from '../utils/compresion';
import { ESQUEMAS_TABLA, FORMATO_RESPALDO, TABLAS_RESPALDO, esquemaSobre, type TablaRespaldo } from '../validators/respaldo';
import { type Contexto, metadatosActualizados, metadatosNuevos } from './contexto';
import { cifrar, descifrar, esCifrado, validarContrasena } from '../utils/cifrado';

/** Tamaño máximo del archivo (texto) y de los datos ya descomprimidos. */
export const LIMITE_ARCHIVO = 120 * 1024 * 1024;
export const LIMITE_DATOS = 400 * 1024 * 1024;
/** A partir de este tamaño, el respaldo se guarda comprimido (gzip): el formato es muy repetitivo. */
export const UMBRAL_COMPRESION = 8 * 1024 * 1024;
const DIAS_RECORDATORIO = 7;

export interface Respaldo {
  formato: typeof FORMATO_RESPALDO;
  versionFormato: 2;
  esquema: number;
  creadoEn: string;
  escuelas: { id: string; nombre: string }[];
  ciclos: { id: string; escuelaId: string; nombre: string }[];
  conteos: Record<TablaRespaldo, number>;
  huella: string | null;
  datos: Record<TablaRespaldo, Metadatos[]>;
}

export interface EscuelaEnRespaldo {
  id: string;
  nombre: string;
  accion: 'agregar' | 'reemplazar' | 'bloqueado';
  motivo: string | null;
  conteos: { tabla: TablaRespaldo; actual: number; respaldo: number }[];
  ciclos: string[];
  /** Registros de este dispositivo creados o modificados DESPUÉS de la fecha del respaldo (se perderían al reemplazar). */
  cambiosPosteriores: number;
}

export interface AnalisisRespaldo {
  errores: string[];
  advertencias: string[];
  creadoEn: string | null;
  esquema: number | null;
  escuelas: EscuelaEnRespaldo[];
  puedeRestaurar: boolean;
  cifrado: boolean;
  registros: number;
}

export interface InformeRestauracion {
  agregadas: number;
  reemplazadas: number;
  registros: number;
  porTabla: { tabla: TablaRespaldo; registros: number }[];
}

export const ETIQUETA_TABLA: Record<TablaRespaldo, string> = {
  escuelas: 'Escuela', ciclos: 'Ciclos escolares', turnos: 'Turnos', jornadas: 'Jornadas', periodos: 'Periodos', recesos: 'Recesos',
  grados: 'Grados', grupos: 'Grupos', personal: 'Personal', materias: 'Materias', asignaciones: 'Asignaciones', sesiones: 'Clases del horario',
  actividades: 'Servicio y otras actividades', excepciones: 'Casos especiales', confirmaciones: 'Horarios confirmados', bitacora: 'Bitácora',
  alumnos: 'Alumnos', inscripciones: 'Inscripciones', movimientos: 'Historial de inscripciones', adscripciones: 'Turnos y materias del personal',
  importaciones: 'Registro de importaciones', pases: 'Listas de asistencia', asistencias: 'Marcas de asistencia', salidas: 'Salidas del aula', reportes: 'Reportes',
  cambiosAsistencia: 'Correcciones de asistencia',
  plantillasImportacion: 'Plantillas de importación',
  incidenciasPersonal: 'Incidencias del personal', coberturas: 'Coberturas', bancoActividades: 'Banco de actividades', bitacoraPrefectura: 'Historial de Prefectura',
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
  ['inscripciones', 'alumnoId', 'alumnos', false],
  ['inscripciones', 'grupoId', 'grupos', true],
  ['inscripciones', 'gradoId', 'grados', true],
  ['inscripciones', 'turnoId', 'turnos', true],
  ['movimientos', 'alumnoId', 'alumnos', false],
  ['adscripciones', 'personalId', 'personal', false],
  ['pases', 'asignacionId', 'asignaciones', false],
  ['asistencias', 'paseId', 'pases', false],
  ['asistencias', 'alumnoId', 'alumnos', false],
  ['salidas', 'alumnoId', 'alumnos', false],
  ['reportes', 'alumnoId', 'alumnos', false],
  ['cambiosAsistencia', 'paseId', 'pases', false],
  ['cambiosAsistencia', 'alumnoId', 'alumnos', false],
  ['incidenciasPersonal', 'personalId', 'personal', false],
  ['coberturas', 'grupoId', 'grupos', false],
  ['coberturas', 'asignadoId', 'personal', true],
  ['coberturas', 'incidenciaId', 'incidenciasPersonal', true],
  ['coberturas', 'actividadId', 'bancoActividades', true],
];

function convertirAlumnosAnteriores(datos: Record<string, unknown[]>): void {
  const grupos = new Map(((datos['grupos'] ?? []) as { id: string; gradoId: string; turnoId: string }[]).map((g) => [g.id, g]));
  const inscripciones: unknown[] = [...(datos['inscripciones'] ?? [])];
  const movimientos: unknown[] = [...(datos['movimientos'] ?? [])];
  datos['alumnos'] = (datos['alumnos'] ?? []).map((x) => {
    const a = { ...(x as Record<string, unknown>) };
    if (typeof a['cicloEscolarId'] === 'string') {
      const g = grupos.get(a['grupoId'] as string);
      const marca = typeof a['creadoEn'] === 'string' ? a['creadoEn'] : new Date().toISOString();
      const ins = {
        id: nuevoId(), creadoEn: marca, actualizadoEn: marca, version: 1, escuelaId: a['escuelaId'], cicloEscolarId: a['cicloEscolarId'], alumnoId: a['id'],
        turnoId: g?.turnoId ?? null, gradoId: g?.gradoId ?? null, grupoId: a['grupoId'] ?? null, estado: a['activo'] === false ? 'baja' : 'inscrito', numeroLista: null,
      };
      inscripciones.push(ins);
      movimientos.push({ id: nuevoId(), creadoEn: marca, actualizadoEn: marca, version: 1, escuelaId: a['escuelaId'], cicloEscolarId: a['cicloEscolarId'], alumnoId: a['id'], inscripcionId: ins.id, tipo: 'migracion', grupoAnteriorId: null, grupoNuevoId: ins.grupoId, motivo: 'Respaldo de una versión anterior' });
      delete a['cicloEscolarId']; delete a['grupoId']; delete a['activo'];
    }
    return a;
  });
  datos['inscripciones'] = inscripciones;
  datos['movimientos'] = movimientos;
}

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
  constructor(private readonly ctx: Contexto, private readonly versionEsquema: number, private readonly vinculada: (escuelaId: string) => Promise<boolean> = async () => false) {}

  private repo(t: TablaRespaldo): Repositorio<Metadatos> {
    return this.ctx.repos[t] as unknown as Repositorio<Metadatos>;
  }

  private async registrosDe(escuelaId: string, t: TablaRespaldo): Promise<Metadatos[]> {
    const todos = await this.repo(t).listarTodos();
    return todos.filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === escuelaId);
  }

  /** Versión del esquema de datos de esta aplicación. */
  versionDatos(): number { return this.versionEsquema; }

  // ---------- Exportar ----------

  /**
   * Respaldo JSON versionado. Con `contrasena`, el archivo completo se cifra
   * (AES-GCM + PBKDF2); la contraseña no se guarda en ningún lugar.
   */
  async exportar(escuelaIds: string[], opciones: { contrasena?: string | null; confirmacion?: string; sinComprimir?: boolean } = {}): Promise<{ nombreArchivo: string; contenido: string; registros: number; cifrado: boolean }> {
    if (!escuelaIds.length) throw new ErrorDominio('VALIDACION', 'Selecciona al menos una escuela.');
    if (opciones.contrasena != null) validarContrasena(opciones.contrasena, opciones.confirmacion);
    const escuelas = [];
    for (const id of escuelaIds) {
      const e = await this.ctx.repos.escuelas.obtener(id);
      if (!e) throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró la escuela.');
      escuelas.push(e);
    }
    const datos = {} as Record<TablaRespaldo, Metadatos[]>;
    let registros = 0;
    for (const t of TABLAS_RESPALDO) {
      // Sin `push(...arreglo)`: con cientos de miles de asistencias desborda la pila (Fase 9).
      let lista: Metadatos[] = [];
      for (const e of escuelas) lista = lista.concat(await this.registrosDe(e.id, t));
      datos[t] = lista.sort((a, b) => a.id.localeCompare(b.id));
      registros += lista.length;
    }
    const creadoEn = this.ctx.reloj();
    const respaldo: Respaldo = {
      formato: FORMATO_RESPALDO, versionFormato: 2, esquema: this.versionEsquema, creadoEn,
      escuelas: escuelas.map((e) => ({ id: e.id, nombre: e.nombre })),
      ciclos: (datos.ciclos as (Metadatos & { escuelaId: string; nombre: string })[]).map((c) => ({ id: c.id, escuelaId: c.escuelaId, nombre: c.nombre })),
      conteos: Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, datos[t].length])) as Record<TablaRespaldo, number>,
      huella: await sha256(JSON.stringify(datos)), datos,
    };
    const base = escuelas.length === 1 ? (escuelas[0]!.cct ?? normalizarTexto(escuelas[0]!.nombre).replace(/[^a-z0-9]+/g, '-')) : 'todas';
    const plano = JSON.stringify(respaldo);
    // Escuelas grandes: se comprime (de lo contrario el archivo podría no poder restaurarse).
    const texto = plano.length > UMBRAL_COMPRESION && !opciones.sinComprimir ? await comprimir(plano) : plano;
    const cifrado = opciones.contrasena != null;
    return {
      nombreArchivo: `respaldo-gestion-escolar-${base}-${creadoEn.slice(0, 10)}${cifrado ? '.cifrado' : ''}.json`,
      contenido: cifrado ? await cifrar(texto, opciones.contrasena!, creadoEn) : texto,
      registros, cifrado,
    };
  }

  /**
   * Limpieza del piloto (Fase 10): quita del dispositivo una escuela de DEMOSTRACIÓN con todos sus
   * registros. Nunca actúa sobre una escuela real (sin la marca `demostracion`) ni sobre una
   * sincronizada con el servidor. Todo o nada.
   */
  async quitarDemostracion(escuelaId: string): Promise<{ registros: number }> {
    return this.ctx.uow.ejecutar(async () => {
      const e = await this.ctx.repos.escuelas.obtener(escuelaId);
      if (!e) throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró la escuela.');
      if (e.demostracion !== true) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Sólo se pueden quitar escuelas de demostración. Las escuelas reales nunca se borran con esta función.');
      if (await this.vinculada(e.id)) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'La escuela se sincroniza con el servidor: quítala desde «Sincronización».');
      const personal = new Set((await this.registrosDe(e.id, 'personal')).map((r) => r.id));
      let registros = 0;
      for (const t of TABLAS_RESPALDO) {
        const ids = (await this.registrosDe(e.id, t)).map((r) => r.id);
        await this.repo(t).eliminarVarios(ids);
        registros += ids.length;
      }
      // Preferencias del dispositivo que apuntaban a esa escuela.
      const perfil = await this.ctx.repos.ajustes.obtener('perfil-docente');
      if (perfil?.valor && personal.has(perfil.valor)) await this.ctx.repos.ajustes.actualizar({ ...perfil, valor: null, ...metadatosActualizados(this.ctx, perfil) });
      if (await this.ctx.repos.ajustes.obtener(`ultimo-respaldo:${e.id}`)) await this.ctx.repos.ajustes.eliminar(`ultimo-respaldo:${e.id}`);
      return { registros };
    });
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
  /**
   * ¿Hay que recordar un respaldo? (Fase 10) Misma regla que `estado().recordar`, pero sin recorrer
   * toda la escuela cuando no hace falta: Mi día y la pantalla de inicio lo consultan seguido y, con
   * volumen (~165 000 registros), el recorrido completo competía con la pantalla siguiente.
   */
  async debeRecordar(escuelaId: string, ahora: Date): Promise<boolean> {
    const ultimo = (await this.ctx.repos.ajustes.obtener(`ultimo-respaldo:${escuelaId}`))?.valor ?? null;
    if (ultimo && ahora.getTime() - new Date(ultimo).getTime() <= DIAS_RECORDATORIO * 86_400_000) return false; // reciente
    // ¿Tiene algo más que la escuela (registros > 1)? Todo lo demás cuelga de un ciclo, del personal,
    // de los alumnos o de las plantillas (tablas con índice por escuela).
    let hayDatos = false;
    for (const t of ['ciclos', 'personal', 'alumnos', 'plantillasImportacion'] as const) if ((await this.repo(t).contarPor('escuelaId' as never, escuelaId as never)) > 0) { hayDatos = true; break; }
    if (!hayDatos) return false;
    if (!ultimo) return true; // nunca respaldada
    // Respaldo viejo: ¿algún cambio posterior? Se detiene en el primero que encuentra.
    for (const t of TABLAS_RESPALDO) {
      for (const r of await this.registrosDe(escuelaId, t)) if (r.actualizadoEn > ultimo) return true;
    }
    return false;
  }

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
  async analizar(contenido: string, contrasena: string | null = null): Promise<AnalisisRespaldo & { _datos?: Record<TablaRespaldo, Metadatos[]> }> {
    const v = await this.verificarArchivo(await this.abrir(contenido, contrasena));
    const cifrado = esCifrado(contenido);
    if (!v.datos) return { ...v.analisis, cifrado };
    return { ...(await this.comparar(v.analisis, v.sobre!, v.datos)), cifrado };
  }

  /** ¿Hay que pedir contraseña para abrir este archivo? */
  requiereContrasena(contenido: string): boolean {
    return esCifrado(contenido);
  }

  /** Descifra si hace falta (fuera de cualquier transacción). */
  private async abrir(contenido: string, contrasena: string | null): Promise<string> {
    if (contenido.length > LIMITE_ARCHIVO) throw new ErrorDominio('VALIDACION', `El archivo supera ${LIMITE_ARCHIVO / 1024 / 1024} MB.`);
    let texto = contenido;
    if (esCifrado(texto)) {
      if (!contrasena) throw new ErrorDominio('VALIDACION', 'Este respaldo está protegido con contraseña. Escríbela para abrirlo.', [{ campo: 'contrasena', mensaje: 'Escribe la contraseña del respaldo.' }]);
      texto = await descifrar(texto, contrasena);
    }
    return esComprimido(texto) ? descomprimir(texto, LIMITE_DATOS) : texto;
  }

  /**
   * Lectura, huella y validación del archivo. NO toca la base de datos: se hace
   * fuera de la transacción porque `crypto.subtle` (asíncrono y ajeno a IndexedDB)
   * haría que la transacción se cerrara antes de tiempo.
   */
  private async verificarArchivo(contenido: string): Promise<{ analisis: AnalisisRespaldo; sobre?: { escuelas: { id: string; nombre: string }[]; creadoEn: string }; datos?: Record<TablaRespaldo, Metadatos[]> }> {
    const vacio = (errores: string[]): AnalisisRespaldo => ({ errores, advertencias: [], creadoEn: null, esquema: null, escuelas: [], puedeRestaurar: false, cifrado: false, registros: 0 });
    if (contenido.length > LIMITE_DATOS) return { analisis: vacio([`Los datos del respaldo superan ${LIMITE_DATOS / 1024 / 1024} MB.`]) };
    let crudo: unknown;
    try { crudo = JSON.parse(contenido); } catch { return { analisis: vacio(['El archivo no es un respaldo válido (no se pudo leer).']) }; }
    const sobre = esquemaSobre.safeParse(crudo);
    if (!sobre.success) {
      const m = sobre.error.issues[0]?.message ?? '';
      return { analisis: vacio([m.startsWith('El archivo') || m.startsWith('Formato') ? m : 'El archivo no es un respaldo de Gestión Escolar o está incompleto.']) };
    }
    const s = sobre.data;
    const errores: string[] = [];
    const advertencias: string[] = [];
    if (s.esquema > this.versionEsquema) return { analisis: { ...vacio([`El respaldo se hizo con una versión más nueva de la aplicación (esquema ${s.esquema}). Actualiza la aplicación antes de restaurarlo.`]), creadoEn: s.creadoEn, esquema: s.esquema } };

    const huella = await sha256(JSON.stringify(s.datos));
    if (s.huella && huella && s.huella !== huella) errores.push('El archivo fue modificado o está dañado: su huella de verificación no coincide.');
    if (s.conteos) {
      for (const [t, n] of Object.entries(s.conteos)) {
        if ((s.datos[t]?.length ?? 0) !== n) { errores.push(`El archivo está incompleto: ${ETIQUETA_TABLA[t as TablaRespaldo] ?? t} debería tener ${n} registro(s) y tiene ${s.datos[t]?.length ?? 0}.`); break; }
      }
    }
    if (!s.huella) advertencias.push('El respaldo no tiene huella de verificación; no se puede comprobar que esté íntegro.');
    if (s.huella && !huella) advertencias.push('Este navegador no puede verificar la huella del archivo (requiere HTTPS o localhost).');

    // Respaldos anteriores al esquema 6: el alumno traía su grupo y ciclo; se
    // convierten en inscripciones (igual que la migración de la base de datos).
    if (s.esquema < 6) convertirAlumnosAnteriores(s.datos);

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
    const registros = TABLAS_RESPALDO.reduce((n, t) => n + datos[t].length, 0);
    return { analisis: { errores, advertencias, creadoEn: s.creadoEn, esquema: s.esquema, escuelas: [], puedeRestaurar: false, cifrado: false, registros }, sobre: s, datos };
  }

  /** Comparación con este dispositivo: SÓLO operaciones de la base de datos. */
  private async comparar(base: AnalisisRespaldo, s: { escuelas: { id: string; nombre: string }[]; creadoEn: string }, datos: Record<TablaRespaldo, Metadatos[]>): Promise<AnalisisRespaldo & { _datos: Record<TablaRespaldo, Metadatos[]> }> {
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
      let cambiosPosteriores = 0;
      for (const t of TABLAS_RESPALDO) {
        const respaldo = datos[t].filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === e.id).length;
        const aqui = existe ? await this.registrosDe(e.id, t) : [];
        cambiosPosteriores += aqui.filter((r) => r.actualizadoEn > s.creadoEn).length;
        if (respaldo || aqui.length) conteos.push({ tabla: t, actual: aqui.length, respaldo });
      }
      const ciclos = (datos.ciclos as (Metadatos & { escuelaId: string; nombre: string })[]).filter((c) => c.escuelaId === e.id).map((c) => c.nombre).sort();
      resultado.push({ id: e.id, nombre: e.nombre, accion, motivo, conteos, ciclos, cambiosPosteriores });
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

  async restaurar(contenido: string, escuelaIds: string[], contrasena: string | null = null): Promise<InformeRestauracion> {
    const v = await this.verificarArchivo(await this.abrir(contenido, contrasena)); // fuera de la transacción
    if (!v.datos || v.analisis.errores.length) throw new ErrorDominio('VALIDACION', `No se restauró nada: ${v.analisis.errores[0] ?? 'archivo inválido'}`);
    return this.ctx.uow.ejecutar(async () => {
      const a = await this.comparar(v.analisis, v.sobre!, v.datos!); // se vuelve a comparar dentro de la transacción
      if (a.errores.length) throw new ErrorDominio('VALIDACION', `No se restauró nada: ${a.errores[0]}`);
      const elegidas = a.escuelas.filter((e) => escuelaIds.includes(e.id));
      if (!elegidas.length) throw new ErrorDominio('VALIDACION', 'Selecciona al menos una escuela del respaldo.');
      // Una escuela que se sincroniza con el servidor no se restaura desde archivo: se mezclarían
      // versiones sin control de conflictos (Fase 8D). Su copia de referencia es el servidor.
      for (const e of elegidas) if (await this.vinculada(e.id)) throw new ErrorDominio('ESTADO_NO_PERMITIDO', `«${e.nombre}» se sincroniza con el servidor escolar: no se restaura desde un respaldo en este dispositivo.`);
      const bloqueada = elegidas.find((e) => e.accion === 'bloqueado');
      if (bloqueada) throw new ErrorDominio('ESTADO_NO_PERMITIDO', bloqueada.motivo ?? 'No se puede restaurar esa escuela.');
      let registros = 0;
      const porTabla = new Map<TablaRespaldo, number>();
      for (const e of elegidas) {
        if (e.accion === 'reemplazar') {
          for (const t of TABLAS_RESPALDO) await this.repo(t).eliminarVarios((await this.registrosDe(e.id, t)).map((r) => r.id));
        }
        for (const t of TABLAS_RESPALDO) {
          const lista = a._datos![t].filter((r) => (t === 'escuelas' ? r.id : (r as Metadatos & { escuelaId: string }).escuelaId) === e.id);
          await this.repo(t).insertarVarios(lista);
          registros += lista.length;
          if (lista.length) porTabla.set(t, (porTabla.get(t) ?? 0) + lista.length);
        }
      }
      return {
        agregadas: elegidas.filter((e) => e.accion === 'agregar').length, reemplazadas: elegidas.filter((e) => e.accion === 'reemplazar').length, registros,
        porTabla: [...porTabla].map(([tabla, n]) => ({ tabla, registros: n })),
      };
    });
  }
}
