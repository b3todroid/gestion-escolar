import type { DiaSemana, Periodo } from '../models';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { compararPorInicio, seTraslapan } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos } from './contexto';
import { choqueDocente, hayExcepcion } from './conflictos';
import { ServicioAsignaciones } from './asignaciones';
import { DIAS_SEMANA } from './turnos';
import { nombreCompleto } from './personal';
import { problemasMapeo, valor, type Mapeo } from '../domain/importacion/mapeo';

export type EstadoFila = 'nueva' | 'existente' | 'error' | 'conflicto';

export interface ResultadoFila {
  fila: number; // número de renglón en el archivo (el encabezado es el 1)
  resumen: string;
  estado: EstadoFila;
  mensajes: string[];
  resuelta?: { grupoId: string; materiaId: string; personalId: string | null; dia: DiaSemana; periodo: Periodo };
}

export interface Analisis {
  advertencias: string[];
  filas: ResultadoFila[];
  nuevas: number;
  existentes: number;
  errores: number;
  conflictos: number;
  ajustes: string[];
  puedeImportar: boolean;
}

const COLUMNAS = {
  grado: ['grado'],
  grupo: ['grupo'],
  turno: ['turno'],
  dia: ['dia', 'día'],
  inicio: ['inicio', 'hora', 'hora inicio', 'hora de inicio'],
  materia: ['materia', 'asignatura'],
  docente: ['docente', 'profesor', 'profesora', 'maestro', 'maestra'],
} as const;
const OBLIGATORIAS = ['grado', 'grupo', 'dia', 'inicio', 'materia'] as const;

interface ValoresFila { grado: string; grupo: string; turno: string; dia: string; inicio: string; periodo: string; materia: string; docente: string }

/**
 * Periodo por número («3», «3°», «Periodo 3», «3a hora»), por nombre exacto, o por
 * hora («07:50» o «07:50-08:40»). Devuelve un mensaje si no hay uno solo que coincida.
 */
export function resolverPeriodo(texto: string, propios: Periodo[]): Periodo | string {
  const t = normalizarTexto(texto);
  const porNombre = propios.filter((p) => normalizarTexto(p.nombre) === t);
  if (porNombre.length === 1) return porNombre[0]!;
  const hora = /^(\d{1,2}:\d{2})(?:\s*(?:-|–|a)\s*\d{1,2}:\d{2})?$/.exec(texto.trim());
  if (hora) {
    const h = normalizarHora(hora[1]!);
    const p = propios.find((x) => x.horaInicio === h);
    return p ?? `El turno no tiene un periodo que inicie a las ${h ?? hora[1]}. Inicios válidos: ${propios.map((x) => x.horaInicio).join(', ') || 'ninguno'}.`;
  }
  const num = /^(?:periodo|modulo|hora|sesion)?\s*(\d{1,2})\s*(?:°|º|o|a|er|do|ro|to|vo|no)?\s*(?:periodo|modulo|hora)?$/.exec(t);
  if (num) {
    const n = Number(num[1]);
    return propios[n - 1] ?? `El turno tiene ${propios.length} periodo(s); no existe el periodo ${n}.`;
  }
  return `No se reconoce el periodo «${texto}». Usa el número de periodo (1, 2, 3…), su nombre o la hora de inicio.`;
}

function normalizarHora(v: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

function normalizarDia(v: string): DiaSemana | null {
  const t = normalizarTexto(v);
  if (/^[1-7]$/.test(t)) return Number(t) as DiaSemana;
  const d = DIAS_SEMANA.find((x) => normalizarTexto(x.nombre) === t || normalizarTexto(x.corto) === t);
  return d ? d.valor : null;
}

/**
 * Importación de horarios estructurados (una fila por clase). Nunca crea
 * grupos, materias ni docentes: deben existir (un dato se captura una vez).
 * No reemplaza celdas ocupadas ni toca horarios confirmados.
 */
export class ServicioImportacion {
  private readonly asignaciones: ServicioAsignaciones;
  constructor(private readonly ctx: Contexto) {
    this.asignaciones = new ServicioAsignaciones(ctx);
  }

  async analizar(cicloId: string, tabla: string[][]): Promise<Analisis> {
    const ciclo = await cicloEditable(this.ctx, cicloId);
    const [encabezado, ...cuerpo] = tabla;
    if (!encabezado || cuerpo.length === 0) throw new ErrorDominio('VALIDACION', 'El archivo no tiene filas de horario debajo del encabezado.');
    const pos: Partial<Record<keyof typeof COLUMNAS, number>> = {};
    encabezado.forEach((h, i) => {
      const n = normalizarTexto(h);
      for (const [clave, alias] of Object.entries(COLUMNAS)) if ((alias as readonly string[]).map(normalizarTexto).includes(n)) pos[clave as keyof typeof COLUMNAS] ??= i;
    });
    const faltan = OBLIGATORIAS.filter((c) => pos[c] === undefined);
    if (faltan.length) {
      throw new ErrorDominio('VALIDACION', `Faltan columnas en el encabezado: ${faltan.map((c) => `«${c === 'dia' ? 'Día' : c.charAt(0).toUpperCase() + c.slice(1)}»`).join(', ')}. Usa la plantilla.`);
    }
    const celda = (f: string[], c: keyof typeof COLUMNAS) => (pos[c] === undefined ? '' : (f[pos[c]!] ?? '').trim());
    const entradas = cuerpo.map((f, i) => ({ fila: i + 2, v: { grado: celda(f, 'grado'), grupo: celda(f, 'grupo'), turno: celda(f, 'turno'), dia: celda(f, 'dia'), inicio: celda(f, 'inicio'), periodo: '', materia: celda(f, 'materia'), docente: celda(f, 'docente') } }));
    return this.analizarValores(ciclo.id, ciclo.escuelaId, entradas, false);
  }

  /**
   * Análisis desde el centro «Importar información»: columnas según el mapeo
   * elegido por la persona (encabezados equivalentes). El periodo puede venir
   * como número de periodo, nombre del periodo u hora de inicio.
   */
  async analizarMapeado(cicloId: string, cuerpo: string[][], mapeo: Mapeo, primeraFila = 2, huella: string | null = null): Promise<Analisis> {
    const ciclo = await cicloEditable(this.ctx, cicloId);
    const p = problemasMapeo(mapeo, 'horarios');
    if (p.length) throw new ErrorDominio('VALIDACION', p[0]!);
    const entradas = cuerpo.map((f, i) => ({ fila: primeraFila + i, f })).filter(({ f }) => f.some((c) => c.trim() !== ''))
      .map(({ fila, f }) => ({ fila, v: { grado: valor(f, mapeo, 'grado'), grupo: valor(f, mapeo, 'grupo'), turno: valor(f, mapeo, 'turno'), dia: valor(f, mapeo, 'dia'), inicio: valor(f, mapeo, 'inicio'), periodo: valor(f, mapeo, 'periodo'), materia: valor(f, mapeo, 'materia'), docente: valor(f, mapeo, 'docente') } }));
    if (!entradas.length) throw new ErrorDominio('VALIDACION', 'No hay filas de horario debajo de los encabezados.');
    if (entradas.length > 3000) throw new ErrorDominio('VALIDACION', 'El archivo tiene más de 3000 filas. Divídelo en varios archivos.');
    const a = await this.analizarValores(ciclo.id, ciclo.escuelaId, entradas, true);
    if (huella) {
      const previa = (await this.ctx.repos.importaciones.listarPor('escuelaId', ciclo.escuelaId)).find((r) => r.huella === huella);
      if (previa) a.advertencias.push(`Este mismo archivo ya se importó el ${new Date(previa.creadoEn).toLocaleString('es-MX')} (${previa.resultado.nuevos} clase(s)). Revisa antes de importarlo otra vez.`);
    }
    return a;
  }

  private async analizarValores(cicloId: string, escuelaId: string, entradas: { fila: number; v: ValoresFila }[], flexible: boolean): Promise<Analisis> {
    // --- Contexto del ciclo (lectura única) ---
    const r = this.ctx.repos;
    const grados = await r.grados.listarPor('cicloEscolarId', cicloId);
    const grupos = await r.grupos.listarPor('cicloEscolarId', cicloId);
    const turnos = await r.turnos.listarPor('cicloEscolarId', cicloId);
    const jornadas = await r.jornadas.listarPor('cicloEscolarId', cicloId);
    const periodos = await r.periodos.listarPor('cicloEscolarId', cicloId);
    const materias = await r.materias.listarPor('cicloEscolarId', cicloId);
    const personal = (await r.personal.listarPor('escuelaId', escuelaId)).filter((p) => p.activo && p.funciones.includes('docente'));
    const asignaciones = await r.asignaciones.listarPor('cicloEscolarId', cicloId);
    const sesiones = await r.sesiones.listarPor('cicloEscolarId', cicloId);
    const actividades = await r.actividades.listarPor('cicloEscolarId', cicloId);
    const confirmados = new Set((await r.confirmaciones.listarPor('cicloEscolarId', cicloId)).map((c) => c.grupoId));
    const nombreGrupo = (id: string) => { const g = grupos.find((x) => x.id === id); const gr = grados.find((x) => x.id === g?.gradoId); return `${gr?.numero ?? ''}° ${g?.nombre ?? ''}`; };

    const filas: ResultadoFila[] = entradas.map(({ fila, v: original }) => {
      const v = { ...original };
      // «1A», «1° A», «1-A» en la columna de grupo cuando no hay columna de grado.
      if (flexible && !v.grado) { const m = /^(\d{1,2})\s*[°º]?\s*-?\s*([A-Za-zÑñ]{1,3})$/.exec(v.grupo); if (m) { v.grado = m[1]!; v.grupo = m[2]!; } }
      const resumen = [`${v.grado}${v.grado ? '° ' : ''}${v.grupo}`.trim(), v.turno, v.dia, v.periodo ? `periodo ${v.periodo}` : v.inicio, v.materia, v.docente || 'sin docente'].filter(Boolean).join(', ');
      const mensajes: string[] = [];
      for (const c of OBLIGATORIAS) if (c !== 'inicio' && !v[c]) mensajes.push(`Falta «${{ grado: 'Grado', grupo: 'Grupo', dia: 'Día', materia: 'Materia' }[c]}».`);
      if (!v.inicio && !v.periodo) mensajes.push(flexible ? 'Falta el periodo (número, nombre u hora de inicio).' : 'Falta «Inicio».');
      if (mensajes.length) return { fila, resumen, estado: 'error', mensajes };

      const dia = normalizarDia(v.dia);
      if (!dia) mensajes.push(`«${v.dia}» no es un día válido (Lunes a Domingo).`);
      const hora = v.inicio ? normalizarHora(v.inicio) : null;
      if (v.inicio && !hora) mensajes.push(`«${v.inicio}» no es una hora válida (HH:MM).`);

      const grado = grados.find((g) => String(g.numero) === v.grado.replace(/[°º]/g, '').trim());
      let candidatos = grado ? grupos.filter((g) => g.gradoId === grado.id && normalizarTexto(g.nombre) === normalizarTexto(v.grupo)) : [];
      if (v.turno) candidatos = candidatos.filter((g) => normalizarTexto(turnos.find((t) => t.id === g.turnoId)?.nombre ?? '') === normalizarTexto(v.turno));
      if (candidatos.length === 1 && candidatos[0]!.activo === false) mensajes.push(`El grupo ${v.grado}° ${v.grupo} está desactivado.`);
      if (candidatos.length === 0) mensajes.push(`No existe el grupo ${v.grado}° ${v.grupo}${v.turno ? ` en el turno ${v.turno}` : ''} en este ciclo.`);
      if (candidatos.length > 1) mensajes.push(`Hay varios grupos ${v.grado}° ${v.grupo}; indica el turno.`);
      const grupo = candidatos.length === 1 ? candidatos[0]! : undefined;

      const materia = materias.find((m) => normalizarTexto(m.nombre) === normalizarTexto(v.materia) || (m.abreviatura && normalizarTexto(m.abreviatura) === normalizarTexto(v.materia)));
      if (!materia) mensajes.push(`La materia «${v.materia}» no está registrada en este ciclo.`);

      let personalId: string | null = null;
      if (v.docente) {
        const t = normalizarTexto(v.docente);
        const p = personal.find((x) => x.numeroEmpleado && normalizarTexto(x.numeroEmpleado) === t)
          ?? personal.find((x) => normalizarTexto(nombreCompleto(x)) === t || normalizarTexto(`${x.nombre} ${x.primerApellido}`) === t);
        if (!p) mensajes.push(`No se encontró al docente «${v.docente}» activo (usa su número de empleado o nombre completo).`);
        else personalId = p.id;
      }

      let periodo: Periodo | undefined;
      if (grupo && dia && (hora || v.periodo)) {
        const jornada = jornadas.find((j) => j.turnoId === grupo.turnoId);
        if (jornada && !jornada.dias.includes(dia)) mensajes.push(`El ${DIAS_SEMANA.find((d) => d.valor === dia)?.nombre.toLowerCase()} no es laborable en el turno del grupo (fuera de jornada).`);
        const propios = periodos.filter((p) => p.jornadaId === jornada?.id).sort(compararPorInicio);
        if (hora) {
          periodo = propios.find((p) => p.horaInicio === hora);
          if (!periodo) mensajes.push(`El turno no tiene un periodo que inicie a las ${hora}. Inicios válidos: ${propios.map((p) => p.horaInicio).join(', ') || 'ninguno'}.`);
        } else {
          const r = resolverPeriodo(v.periodo, propios);
          if (typeof r === 'string') mensajes.push(r); else periodo = r;
        }
        if (hora && v.periodo && periodo) {
          const otro = resolverPeriodo(v.periodo, propios);
          if (typeof otro !== 'string' && otro.id !== periodo.id) { mensajes.push(`El periodo «${v.periodo}» no coincide con la hora de inicio ${hora}. No se adivina cuál es el correcto.`); periodo = undefined; }
        }
      }
      if (mensajes.length || !grupo || !materia || !dia || !periodo) return { fila, resumen, estado: 'error', mensajes };
      return { fila, resumen, estado: 'nueva', mensajes, resuelta: { grupoId: grupo.id, materiaId: materia.id, personalId, dia, periodo } };
    });

    // --- Conflictos ---
    const validas = filas.filter((f) => f.resuelta);
    const conflicto = (f: ResultadoFila, m: string) => { f.estado = 'conflicto'; f.mensajes.push(m); };
    for (const f of validas) {
      const x = f.resuelta!;
      if (confirmados.has(x.grupoId)) { conflicto(f, `El horario de ${nombreGrupo(x.grupoId)} está confirmado; la importación no lo modifica.`); continue; }
      // Mismo grupo, mismo periodo, dos veces en el archivo
      const mismas = validas.filter((o) => o !== f && o.resuelta!.grupoId === x.grupoId && o.resuelta!.dia === x.dia && o.resuelta!.periodo.id === x.periodo.id);
      if (mismas.length) conflicto(f, `${nombreGrupo(x.grupoId)} tendría dos clases a la misma hora (filas ${[f, ...mismas].map((o) => o.fila).sort((a, b) => a - b).join(' y ')}).`);
      // Celda ya ocupada en la app
      const enCelda = sesiones.find((s) => s.grupoId === x.grupoId && s.dia === x.dia && s.periodoId === x.periodo.id);
      const actividad = actividades.find((a) => a.grupoId === x.grupoId && a.dia === x.dia && a.periodoId === x.periodo.id);
      const asig = asignaciones.find((a) => a.grupoId === x.grupoId && a.materiaId === x.materiaId);
      if (asig && asig.personalId !== x.personalId) {
        const actual = asig.personalId ? personal.find((p) => p.id === asig.personalId) : null;
        conflicto(f, `En ${nombreGrupo(x.grupoId)} la materia ya está asignada a ${actual ? nombreCompleto(actual) : 'docente pendiente'}; el archivo indica otro docente.`);
      }
      if (actividad) conflicto(f, `En ese periodo ${nombreGrupo(x.grupoId)} tiene otra actividad («${actividad.descripcion}»).`);
      else if (enCelda) {
        if (asig && enCelda.asignacionId === asig.id) { if (f.estado === 'nueva') { f.estado = 'existente'; f.mensajes.push('Ya está en el horario; se omite.'); } }
        else conflicto(f, `En ese periodo ${nombreGrupo(x.grupoId)} ya tiene otra clase. La importación no reemplaza clases existentes.`);
      }
    }
    // Docente simultáneo: contra la app y dentro del archivo
    for (const f of validas.filter((v) => v.estado === 'nueva' && v.resuelta!.personalId)) {
      const x = f.resuelta!;
      const choque = await choqueDocente(this.ctx, cicloId, x.personalId!, x.dia, x.periodo);
      if (choque) conflicto(f, choque);
      const otras = validas.filter((o) => o !== f && o.estado !== 'error' && o.resuelta!.personalId === x.personalId && o.resuelta!.dia === x.dia
        && o.resuelta!.grupoId !== x.grupoId && seTraslapan(o.resuelta!.periodo, x.periodo));
      if (otras.length && !(await hayExcepcion(this.ctx, cicloId, x.personalId!, x.dia, x.periodo))) {
        conflicto(f, `El docente estaría en dos grupos a la vez (filas ${[f, ...otras].map((o) => o.fila).sort((a, b) => a - b).join(' y ')}).`);
      }
    }
    // Ajustes de horas semanales (se muestran antes de guardar)
    const ajustes: string[] = [];
    const porPar = new Map<string, ResultadoFila[]>();
    for (const f of validas.filter((v) => v.estado === 'nueva')) {
      const k = `${f.resuelta!.grupoId}|${f.resuelta!.materiaId}`;
      porPar.set(k, [...(porPar.get(k) ?? []), f]);
    }
    for (const [k, lista] of porPar) {
      const [grupoId, materiaId] = k.split('|') as [string, string];
      const asig = asignaciones.find((a) => a.grupoId === grupoId && a.materiaId === materiaId);
      const nombre = materias.find((m) => m.id === materiaId)?.nombre ?? '';
      if (!asig) ajustes.push(`Se asignará ${nombre} a ${nombreGrupo(grupoId)} con ${lista.length} hora(s) por semana.`);
      else {
        const necesarias = sesiones.filter((s) => s.asignacionId === asig.id).length + lista.length;
        if (necesarias > asig.horasSemana) ajustes.push(`Las horas por semana de ${nombre} en ${nombreGrupo(grupoId)} pasarán de ${asig.horasSemana} a ${necesarias}.`);
      }
    }
    const cuenta = (e: EstadoFila) => filas.filter((f) => f.estado === e).length;
    const errores = cuenta('error');
    const conflictos = cuenta('conflicto');
    const nuevas = cuenta('nueva');
    return { advertencias: [], filas, nuevas, existentes: cuenta('existente'), errores, conflictos, ajustes, puedeImportar: errores === 0 && conflictos === 0 && nuevas > 0 };
  }

  /** Vuelve a analizar dentro de la transacción y guarda todo o nada. */
  async aplicar(cicloId: string, tabla: string[][]): Promise<{ clases: number; asignacionesNuevas: number }> {
    return this.ctx.uow.ejecutar(async () => this.guardar(cicloId, await this.analizar(cicloId, tabla)));
  }

  /** Igual que aplicar, desde el centro de importación; además registra el origen (archivo, hoja, huella). */
  async aplicarMapeado(cicloId: string, cuerpo: string[][], mapeo: Mapeo, origen: { archivo: string; hoja: string | null; huella: string | null }, primeraFila = 2): Promise<{ clases: number; asignacionesNuevas: number; existentes: number }> {
    return this.ctx.uow.ejecutar(async () => {
      const a = await this.analizarMapeado(cicloId, cuerpo, mapeo, primeraFila);
      const r = await this.guardar(cicloId, a);
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.ctx.repos.importaciones.insertar({
        ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, tipo: 'horarios',
        archivo: origen.archivo.slice(0, 200), hoja: origen.hoja, huella: origen.huella, resultado: { nuevos: r.clases, actualizados: 0, omitidos: a.existentes },
      });
      return { ...r, existentes: a.existentes };
    });
  }

  private async guardar(cicloId: string, a: Analisis): Promise<{ clases: number; asignacionesNuevas: number }> {
    {
      if (!a.puedeImportar) {
        throw new ErrorDominio('VALIDACION', a.nuevas === 0 && a.errores + a.conflictos === 0
          ? 'No hay clases nuevas que importar.'
          : `No se importó nada: hay ${a.errores} error(es) y ${a.conflictos} conflicto(s). Corrige el archivo y vuelve a intentarlo.`);
      }
      const nuevas = a.filas.filter((f) => f.estado === 'nueva');
      let asignacionesNuevas = 0;
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const porPar = new Map<string, ResultadoFila[]>();
      for (const f of nuevas) { const k = `${f.resuelta!.grupoId}|${f.resuelta!.materiaId}`; porPar.set(k, [...(porPar.get(k) ?? []), f]); }
      for (const [k, lista] of porPar) {
        const [grupoId, materiaId] = k.split('|') as [string, string];
        const existente = (await this.ctx.repos.asignaciones.listarPor('grupoId', grupoId)).find((x) => x.materiaId === materiaId);
        let asignacionId: string;
        if (!existente) {
          const nueva = await this.asignaciones.crear(cicloId, { grupoId, materiaId, personalId: lista[0]!.resuelta!.personalId, horasSemana: lista.length });
          asignacionId = nueva.id; asignacionesNuevas++;
        } else {
          asignacionId = existente.id;
          const necesarias = (await this.ctx.repos.sesiones.listarPor('asignacionId', existente.id)).length + lista.length;
          if (necesarias > existente.horasSemana) await this.ctx.repos.asignaciones.actualizar({ ...existente, horasSemana: necesarias, ...metadatosActualizados(this.ctx, existente) });
        }
        // programar() vuelve a validar cada clase (choques, horas, día, periodo).
        for (const f of lista) await this.asignaciones.programar({ grupoId, asignacionId, dia: f.resuelta!.dia, periodoId: f.resuelta!.periodo.id }, 'importacion');
      }
      await this.ctx.repos.bitacora.insertar({
        ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, entidad: 'horario_grupo', entidadId: cicloId,
        accion: 'importar', motivo: null, detalle: `${nuevas.length} clase(s) importadas`,
      });
      return { clases: nuevas.length, asignacionesNuevas };
    }
  }
}
