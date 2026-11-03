import type { AlumnoInscrito, Asistencia, CambioAsistencia, EstadoIncidencia, MarcaAsistencia, PaseLista, ReporteAlumno, SalidaAula, Sesion, TipoReporte } from '../models';
import { ESTADOS_INCIDENCIA } from '../models';

/** Estructura para un futuro documento PDF de incidencias (no se genera PDF en esta fase). */
export interface DocumentoIncidencias {
  escuela: string; cct: string | null; ciclo: string; grupo: string; desde: string; hasta: string; generadoEn: string;
  filas: { fecha: string; hora: string | null; alumno: string; tipo: TipoReporte; descripcion: string; docente: string | null; estado: EstadoIncidencia }[];
}
import { esquemaFecha, esquemaHora, esquemaMarcas, esquemaReporte, validar, type EntradaReporte } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { aMinutos } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';
import { ServicioAlumnos, nombreAlumno } from './alumnos';
import { DIAS_SEMANA } from './turnos';
import { diaDeFecha } from '../utils/fechas';

/**
 * Estado del pase de lista. EN CAPTURA es sólo de la pantalla (marcas sin
 * guardar); los demás se derivan de lo guardado.
 */
export type EstadoLista = 'no_iniciada' | 'en_captura' | 'guardada' | 'modificada';
export const ETIQUETA_ESTADO_LISTA: Record<EstadoLista, string> = {
  no_iniciada: 'NO INICIADA', en_captura: 'EN CAPTURA', guardada: 'GUARDADA', modificada: 'MODIFICADA',
};
export function estadoLista(pase: Pick<PaseLista, 'correcciones'> | null, hayCambiosSinGuardar = false): EstadoLista {
  if (hayCambiosSinGuardar) return 'en_captura';
  if (!pase) return 'no_iniciada';
  return (pase.correcciones ?? 0) > 0 ? 'modificada' : 'guardada';
}

export interface ListaAbierta {
  sesion: Sesion;
  grupo: { id: string; nombre: string };
  materia: string;
  docente: string | null;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  alumnos: AlumnoInscrito[];
  pase: PaseLista | null;
  /** Marcas guardadas (si el pase existe). */
  marcas: Map<string, Asistencia>;
  /** Salidas de esta clase y fecha. */
  salidas: SalidaAula[];
  estado: EstadoLista;
  /** Historial de correcciones de este pase (más reciente primero). */
  cambios: CambioAsistencia[];
  periodo: string;
}

export interface ResumenAlumno {
  alumno: AlumnoInscrito;
  faltas: number;
  retardos: number;
  salidas: number;
  reportes: number;
}

/**
 * Asistencia (P, F, R), salidas del aula y reportes breves.
 * Reglas contra estados contradictorios:
 * - un alumno con falta en una clase no puede tener salida en esa clase, y viceversa;
 * - un alumno no puede tener dos salidas abiertas;
 * - la reincorporación no puede ser antes de la salida ni repetirse;
 * - un pase por clase y fecha; sólo en el día de la semana de la clase, dentro del ciclo y no en el futuro.
 */
export class ServicioAsistencia {
  private readonly alumnosSrv: ServicioAlumnos;
  constructor(private readonly ctx: Contexto) { this.alumnosSrv = new ServicioAlumnos(ctx); }

  /** Inscripción vigente del alumno en el ciclo (o null si no está inscrito o está de baja). */
  private async inscripcionVigente(alumnoId: string, cicloId: string) {
    return (await this.ctx.repos.inscripciones.listarPor('alumnoId', alumnoId)).find((i) => i.cicloEscolarId === cicloId && i.estado === 'inscrito') ?? null;
  }

  /** Sólo lectura: abrir la lista NO crea ni modifica registros. */
  async abrirLista(sesionId: string, fecha: string): Promise<ListaAbierta> {
    const f = validar(esquemaFecha, fecha);
    const sesion = await requerir(this.ctx.repos.sesiones.obtener(sesionId), 'la clase');
    const grupo = await requerir(this.ctx.repos.grupos.obtener(sesion.grupoId), 'el grupo');
    const grado = await this.ctx.repos.grados.obtener(grupo.gradoId);
    const periodo = await requerir(this.ctx.repos.periodos.obtener(sesion.periodoId), 'el periodo');
    const asig = await requerir(this.ctx.repos.asignaciones.obtener(sesion.asignacionId), 'la asignación');
    const materia = await this.ctx.repos.materias.obtener(asig.materiaId);
    const docente = sesion.personalId ? await this.ctx.repos.personal.obtener(sesion.personalId) : undefined;
    const alumnos = await this.alumnosSrv.listarGrupo(grupo.id);
    const pase = await this.paseDe(sesionId, f);
    const marcas = new Map<string, Asistencia>();
    if (pase) for (const a of await this.ctx.repos.asistencias.listarPor('paseId', pase.id)) marcas.set(a.alumnoId, a);
    const salidas = (await this.ctx.repos.salidas.listarPor('sesionId', sesionId)).filter((s) => s.fecha === f);
    const cambios = pase ? (await this.ctx.repos.cambiosAsistencia.listarPor('paseId', pase.id)).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)) : [];
    return {
      estado: estadoLista(pase), cambios, periodo: periodo.nombre,
      sesion, grupo: { id: grupo.id, nombre: `${grado?.numero ?? ''}° ${grupo.nombre}` }, materia: materia?.nombre ?? 'Materia',
      docente: docente ? `${docente.nombre} ${docente.primerApellido}` : null, fecha: f, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin,
      alumnos, pase, marcas, salidas,
    };
  }

  private async paseDe(sesionId: string, fecha: string): Promise<PaseLista | null> {
    return (await this.ctx.repos.pases.listarPor('sesionId', sesionId)).find((p) => p.fecha === fecha) ?? null;
  }

  /** Verifica que la fecha corresponda a la clase: día de la semana, ciclo y no futura. */
  private async verificarFecha(sesion: Sesion, fecha: string, hoy: string) {
    const ciclo = await cicloEditable(this.ctx, sesion.cicloEscolarId);
    if (diaDeFecha(fecha) !== sesion.dia) {
      const dia = DIAS_SEMANA.find((d) => d.valor === sesion.dia)?.nombre.toLowerCase();
      throw new ErrorDominio('VALIDACION', `Esta clase es los ${dia}; la fecha ${fecha} no corresponde.`);
    }
    if (fecha > hoy) throw new ErrorDominio('VALIDACION', 'No se puede registrar asistencia de una fecha futura.');
    if (fecha < ciclo.fechaInicio || fecha > ciclo.fechaFin) throw new ErrorDominio('VALIDACION', `La fecha está fuera del ciclo escolar (${ciclo.fechaInicio} a ${ciclo.fechaFin}).`);
  }

  /**
   * Guarda (o corrige) el pase de lista. Quien no tenga marca queda PRESENTE:
   * no hay que marcar a cada alumno. Todo o nada.
   */
  async guardarLista(sesionId: string, fecha: string, marcas: Record<string, MarcaAsistencia>, llegadas: Record<string, string>, hoy: string, personalId: string | null = null): Promise<{ pase: PaseLista; P: number; F: number; R: number; corregidos: number }> {
    const f = validar(esquemaFecha, fecha);
    const m = validar(esquemaMarcas, marcas);
    return this.ctx.uow.ejecutar(async () => {
      const sesion = await requerir(this.ctx.repos.sesiones.obtener(sesionId), 'la clase');
      await this.verificarFecha(sesion, f, hoy);
      const periodo = await requerir(this.ctx.repos.periodos.obtener(sesion.periodoId), 'el periodo');
      const alumnos = await this.alumnosSrv.listarGrupo(sesion.grupoId);
      if (alumnos.length === 0) throw new ErrorDominio('VALIDACION', 'El grupo no tiene alumnos registrados.');
      const ids = new Set(alumnos.map((a) => a.id));
      for (const id of Object.keys(m)) if (!ids.has(id)) throw new ErrorDominio('VALIDACION', 'La lista incluye un alumno que no está activo en este grupo. Vuelve a abrirla.');

      const salidas = (await this.ctx.repos.salidas.listarPor('sesionId', sesionId)).filter((s) => s.fecha === f);
      for (const a of alumnos) {
        if (m[a.id] === 'F' && salidas.some((s) => s.alumnoId === a.id)) {
          throw new ErrorDominio('ESTADO_NO_PERMITIDO', `${nombreAlumno(a)} salió del aula en esta clase; no puede tener falta. Márcalo presente o con retardo.`);
        }
        if (m[a.id] === 'R') {
          const h = llegadas[a.id];
          if (h !== undefined && h !== '') {
            validar(esquemaHora, h);
            if (aMinutos(h) < aMinutos(periodo.horaInicio)) throw new ErrorDominio('VALIDACION', `La llegada de ${nombreAlumno(a)} (${h}) es antes del inicio de la clase (${periodo.horaInicio}).`);
          }
        }
      }

      const asig = await requerir(this.ctx.repos.asignaciones.obtener(sesion.asignacionId), 'la asignación');
      const existente = await this.paseDe(sesionId, f);
      const ahoraIso = this.ctx.reloj();
      const pase: PaseLista = existente
        ? { ...existente, guardadoEn: ahoraIso, ...metadatosActualizados(this.ctx, existente) }
        : {
            ...metadatosNuevos(this.ctx), escuelaId: sesion.escuelaId, cicloEscolarId: sesion.cicloEscolarId, grupoId: sesion.grupoId, sesionId,
            asignacionId: asig.id, personalId: sesion.personalId, fecha: f, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin, guardadoEn: ahoraIso, correcciones: 0,
          };
      // Sólo se tocan las asistencias de ESTE pase (clase y fecha); nunca las de otros grupos o docentes.
      const previas = new Map(existente ? (await this.ctx.repos.asistencias.listarPor('paseId', existente.id)).map((a) => [a.alumnoId, a]) : []);
      const cuenta = { P: 0, F: 0, R: 0 };
      let corregidos = 0;
      for (const a of alumnos) {
        const marca: MarcaAsistencia = m[a.id] ?? 'P';
        cuenta[marca]++;
        const horaLlegada = marca === 'R' ? (llegadas[a.id] || null) : null;
        const previa = previas.get(a.id);
        if (previa) {
          if (previa.marca !== marca || previa.horaLlegada !== horaLlegada) {
            await this.ctx.repos.asistencias.actualizar({ ...previa, marca, horaLlegada, ...metadatosActualizados(this.ctx, previa) });
            await this.ctx.repos.cambiosAsistencia.insertar({
              ...metadatosNuevos(this.ctx), escuelaId: pase.escuelaId, cicloEscolarId: pase.cicloEscolarId, paseId: pase.id, grupoId: pase.grupoId, alumnoId: a.id,
              marcaAnterior: previa.marca, marcaNueva: marca, llegadaAnterior: previa.horaLlegada, llegadaNueva: horaLlegada, personalId,
            });
            corregidos++;
          }
        } else {
          await this.ctx.repos.asistencias.insertar({ ...metadatosNuevos(this.ctx), escuelaId: pase.escuelaId, cicloEscolarId: pase.cicloEscolarId, paseId: pase.id, grupoId: pase.grupoId, alumnoId: a.id, fecha: f, marca, horaLlegada });
          if (existente) corregidos++; // alumno agregado después del primer guardado
        }
      }
      if (existente && corregidos === 0) throw new ErrorDominio('VALIDACION', 'No hay cambios que guardar.');
      if (existente) { pase.correcciones = (existente.correcciones ?? 0) + 1; await this.ctx.repos.pases.actualizar(pase); }
      else await this.ctx.repos.pases.insertar(pase);
      return { pase, ...cuenta, corregidos };
    });
  }

  /** Salida al baño. Se registra al momento (no depende de guardar la lista). */
  async registrarSalida(sesionId: string, fecha: string, alumnoId: string, hora: string, hoy: string, personalId: string | null = null): Promise<SalidaAula> {
    const f = validar(esquemaFecha, fecha);
    const h = validar(esquemaHora, hora);
    return this.ctx.uow.ejecutar(async () => {
      const sesion = await requerir(this.ctx.repos.sesiones.obtener(sesionId), 'la clase');
      await this.verificarFecha(sesion, f, hoy);
      const alumno = await requerir(this.ctx.repos.alumnos.obtener(alumnoId), 'al alumno');
      const ins = await this.inscripcionVigente(alumnoId, sesion.cicloEscolarId);
      if (!ins || ins.grupoId !== sesion.grupoId) throw new ErrorDominio('VALIDACION', 'El alumno no está inscrito en este grupo.');
      const pase = await this.paseDe(sesionId, f);
      if (pase) {
        const marca = (await this.ctx.repos.asistencias.listarPor('paseId', pase.id)).find((a) => a.alumnoId === alumnoId);
        if (marca?.marca === 'F') throw new ErrorDominio('ESTADO_NO_PERMITIDO', `${nombreAlumno(alumno)} tiene falta en esta clase; no puede salir al baño. Si llegó, cámbialo a retardo y guarda la lista.`);
      }
      const abierta = (await this.ctx.repos.salidas.listarPor('alumnoId', alumnoId)).find((s) => s.regreso === null);
      if (abierta) throw new ErrorDominio('ESTADO_NO_PERMITIDO', `${nombreAlumno(alumno)} ya está fuera del aula desde las ${abierta.salida}. Registra primero su reincorporación.`);
      const s: SalidaAula = {
        ...metadatosNuevos(this.ctx), escuelaId: sesion.escuelaId, cicloEscolarId: sesion.cicloEscolarId, grupoId: sesion.grupoId, alumnoId, sesionId, fecha: f, salida: h, regreso: null,
        personalId: personalId ?? sesion.personalId, periodoId: sesion.periodoId,
      };
      await this.ctx.repos.salidas.insertar(s);
      return s;
    });
  }

  async reincorporar(salidaId: string, hora: string): Promise<SalidaAula> {
    const h = validar(esquemaHora, hora);
    return this.ctx.uow.ejecutar(async () => {
      const s = await requerir(this.ctx.repos.salidas.obtener(salidaId), 'la salida');
      await cicloEditable(this.ctx, s.cicloEscolarId);
      if (s.regreso !== null) throw new ErrorDominio('ESTADO_NO_PERMITIDO', `Su reincorporación ya se registró a las ${s.regreso}.`);
      if (aMinutos(h) < aMinutos(s.salida)) throw new ErrorDominio('VALIDACION', `La hora de regreso (${h}) no puede ser antes de la salida (${s.salida}).`);
      const r: SalidaAula = { ...s, regreso: h, ...metadatosActualizados(this.ctx, s) };
      await this.ctx.repos.salidas.actualizar(r);
      return r;
    });
  }

  /** Para corregir una salida registrada por error (la interfaz confirma antes). */
  async anularSalida(salidaId: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const s = await requerir(this.ctx.repos.salidas.obtener(salidaId), 'la salida');
      await cicloEditable(this.ctx, s.cicloEscolarId);
      await this.ctx.repos.salidas.eliminar(salidaId);
    });
  }

  /** Alumnos de un grupo que siguen fuera del aula. */
  async fueraDelAula(grupoId: string): Promise<SalidaAula[]> {
    return (await this.ctx.repos.salidas.listarPor('grupoId', grupoId)).filter((s) => s.regreso === null);
  }

  async resumenGrupo(grupoId: string): Promise<ResumenAlumno[]> {
    const alumnos = await this.alumnosSrv.listarGrupo(grupoId, true);
    const asistencias = await this.ctx.repos.asistencias.listarPor('grupoId', grupoId);
    const salidas = await this.ctx.repos.salidas.listarPor('grupoId', grupoId);
    const reportes = await this.ctx.repos.reportes.listarPor('grupoId', grupoId);
    return alumnos.map((alumno) => ({
      alumno,
      faltas: asistencias.filter((x) => x.alumnoId === alumno.id && x.marca === 'F').length,
      retardos: asistencias.filter((x) => x.alumnoId === alumno.id && x.marca === 'R').length,
      salidas: salidas.filter((x) => x.alumnoId === alumno.id).length,
      reportes: reportes.filter((x) => x.alumnoId === alumno.id).length,
    }));
  }

  /** Faltas, retardos, salidas y reportes de un alumno, con la materia de cada clase. */
  async historialAlumno(alumnoId: string) {
    const asistencias = (await this.ctx.repos.asistencias.listarPor('alumnoId', alumnoId)).filter((a) => a.marca !== 'P');
    const filas = [];
    for (const a of asistencias) {
      const pase = await this.ctx.repos.pases.obtener(a.paseId);
      const asig = pase ? await this.ctx.repos.asignaciones.obtener(pase.asignacionId) : undefined;
      const materia = asig ? await this.ctx.repos.materias.obtener(asig.materiaId) : undefined;
      filas.push({ fecha: a.fecha, marca: a.marca, horaLlegada: a.horaLlegada, hora: pase?.horaInicio ?? '', materia: materia?.nombre ?? '' });
    }
    const salidas = (await this.ctx.repos.salidas.listarPor('alumnoId', alumnoId)).sort((x, y) => (y.fecha + y.salida).localeCompare(x.fecha + x.salida));
    const reportes = (await this.ctx.repos.reportes.listarPor('alumnoId', alumnoId)).sort((x, y) => y.creadoEn.localeCompare(x.creadoEn));
    return { asistencias: filas.sort((x, y) => (y.fecha + y.hora).localeCompare(x.fecha + x.hora)), salidas, reportes };
  }

  // ---------- Reportes breves ----------

  async crearReporte(alumnoId: string, entrada: EntradaReporte, contexto: { personalId: string | null; sesionId: string | null; fecha: string; hora?: string | null }): Promise<ReporteAlumno> {
    const datos = validar(esquemaReporte, entrada);
    const fecha = validar(esquemaFecha, contexto.fecha);
    const hora = contexto.hora ? validar(esquemaHora, contexto.hora) : null;
    return this.ctx.uow.ejecutar(async () => {
      const alumno = await requerir(this.ctx.repos.alumnos.obtener(alumnoId), 'al alumno');
      // La inscripción a la que corresponde el reporte: la de la clase, o la vigente más reciente.
      const sesion = contexto.sesionId ? await this.ctx.repos.sesiones.obtener(contexto.sesionId) : undefined;
      const ins = sesion
        ? await this.inscripcionVigente(alumnoId, sesion.cicloEscolarId)
        : (await this.alumnosSrv.inscripciones(alumnoId)).find((i) => i.estado === 'inscrito') ?? null;
      if (!ins) throw new ErrorDominio('VALIDACION', 'El alumno está dado de baja o no está inscrito.');
      await cicloEditable(this.ctx, ins.cicloEscolarId);
      if (!ins.grupoId) throw new ErrorDominio('VALIDACION', 'El alumno no tiene grupo asignado; asígnalo antes de registrar reportes.');
      const r: ReporteAlumno = {
        ...metadatosNuevos(this.ctx), escuelaId: alumno.escuelaId, cicloEscolarId: ins.cicloEscolarId, grupoId: ins.grupoId, alumnoId,
        personalId: contexto.personalId, sesionId: contexto.sesionId, fecha, tipo: datos.tipo as TipoReporte, texto: datos.texto,
        hora, estado: 'abierta',
      };
      await this.ctx.repos.reportes.insertar(r);
      return r;
    });
  }

  /** Incidencia abierta ↔ atendida (seguimiento). */
  async cambiarEstadoReporte(id: string, estado: EstadoIncidencia): Promise<ReporteAlumno> {
    if (!(ESTADOS_INCIDENCIA as readonly string[]).includes(estado)) throw new ErrorDominio('VALIDACION', 'Estado de incidencia inválido.');
    return this.ctx.uow.ejecutar(async () => {
      const r = await requerir(this.ctx.repos.reportes.obtener(id), 'el reporte');
      await cicloEditable(this.ctx, r.cicloEscolarId);
      const n: ReporteAlumno = { ...r, estado, ...metadatosActualizados(this.ctx, r) };
      await this.ctx.repos.reportes.actualizar(n);
      return n;
    });
  }

  /**
   * Datos de incidencias de un grupo, listos para un documento (PDF en una fase
   * posterior). Sólo lectura; no genera archivos.
   */
  async documentoIncidencias(grupoId: string, desde: string, hasta: string): Promise<DocumentoIncidencias> {
    const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
    const escuela = await requerir(this.ctx.repos.escuelas.obtener(grupo.escuelaId), 'la escuela');
    const ciclo = await requerir(this.ctx.repos.ciclos.obtener(grupo.cicloEscolarId), 'el ciclo');
    const grado = await this.ctx.repos.grados.obtener(grupo.gradoId);
    const reportes = (await this.ctx.repos.reportes.listarPor('grupoId', grupoId)).filter((r) => r.fecha >= desde && r.fecha <= hasta)
      .sort((a, b) => (a.fecha + (a.hora ?? '')).localeCompare(b.fecha + (b.hora ?? '')));
    const filas = [];
    for (const r of reportes) {
      const al = await this.ctx.repos.alumnos.obtener(r.alumnoId);
      const doc = r.personalId ? await this.ctx.repos.personal.obtener(r.personalId) : undefined;
      filas.push({ fecha: r.fecha, hora: r.hora, alumno: al ? nombreAlumno(al) : 'Alumno eliminado', tipo: r.tipo, descripcion: r.texto, docente: doc ? `${doc.nombre} ${doc.primerApellido}` : null, estado: r.estado });
    }
    return { escuela: escuela.nombre, cct: escuela.cct, ciclo: ciclo.nombre, grupo: `${grado?.numero ?? ''}° ${grupo.nombre}`, desde, hasta, generadoEn: this.ctx.reloj(), filas };
  }

  async eliminarReporte(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const r = await requerir(this.ctx.repos.reportes.obtener(id), 'el reporte');
      await cicloEditable(this.ctx, r.cicloEscolarId);
      await this.ctx.repos.reportes.eliminar(id);
    });
  }
}
