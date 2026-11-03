import type { Asignacion, DiaSemana, Periodo, Sesion } from '../models';
import { esquemaAsignacion, esquemaSesion, validar, type EntradaAsignacion, type EntradaSesion } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { compararPorInicio } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';
import { asegurarHorarioEditable, choqueDocente } from './conflictos';

export interface AsignacionDetalle extends Asignacion {
  materia: string;
  docente: string | null;
  sesionesProgramadas: number;
}

export interface CeldaHorario {
  periodo: Periodo;
  sesion: Sesion | null;
}

/** Asignaciones (grupo + materia + docente + horas) y sus sesiones en el horario semanal. */
export class ServicioAsignaciones {
  constructor(private readonly ctx: Contexto) {}

  // ---------- Asignaciones ----------

  async listarPorGrupo(grupoId: string): Promise<AsignacionDetalle[]> {
    const lista = await this.ctx.repos.asignaciones.listarPor('grupoId', grupoId);
    const sesiones = await this.ctx.repos.sesiones.listarPor('grupoId', grupoId);
    const r: AsignacionDetalle[] = [];
    for (const a of lista) {
      const m = await this.ctx.repos.materias.obtener(a.materiaId);
      const p = a.personalId ? await this.ctx.repos.personal.obtener(a.personalId) : undefined;
      r.push({
        ...a,
        materia: m?.nombre ?? 'Materia eliminada',
        docente: p ? `${p.nombre} ${p.primerApellido}` : null,
        sesionesProgramadas: sesiones.filter((s) => s.asignacionId === a.id).length,
      });
    }
    return r.sort((x, y) => x.materia.localeCompare(y.materia, 'es'));
  }

  async crear(cicloId: string, entrada: EntradaAsignacion): Promise<Asignacion> {
    const datos = validar(esquemaAsignacion, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const grupo = await requerir(this.ctx.repos.grupos.obtener(datos.grupoId), 'el grupo');
      const materia = await requerir(this.ctx.repos.materias.obtener(datos.materiaId), 'la materia');
      if (grupo.cicloEscolarId !== cicloId || materia.cicloEscolarId !== cicloId) {
        throw new ErrorDominio('VALIDACION', 'El grupo y la materia deben pertenecer al mismo ciclo escolar.');
      }
      await this.verificarDocente(datos.personalId, ciclo.escuelaId);
      const existentes = await this.ctx.repos.asignaciones.listarPor('grupoId', datos.grupoId);
      if (existentes.some((a) => a.materiaId === datos.materiaId)) {
        const mensaje = `El grupo ya tiene asignada la materia «${materia.nombre}».`;
        throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'materiaId', mensaje }]);
      }
      const a: Asignacion = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos };
      await this.ctx.repos.asignaciones.insertar(a);
      return a;
    });
  }

  /** Cambia docente u horas. Si cambia el docente, se revisan choques en todas sus sesiones. */
  async actualizar(id: string, entrada: Pick<EntradaAsignacion, 'personalId' | 'horasSemana'>): Promise<Asignacion> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.asignaciones.obtener(id), 'la asignación');
      const datos = validar(esquemaAsignacion, { ...actual, ...entrada });
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificarDocente(datos.personalId, actual.escuelaId);
      const sesiones = (await this.ctx.repos.sesiones.listarPor('asignacionId', id));
      if (datos.horasSemana < sesiones.length) {
        const mensaje = `Ya hay ${sesiones.length} horas en el horario. Quita algunas antes de bajar a ${datos.horasSemana}.`;
        throw new ErrorDominio('VALIDACION', mensaje, [{ campo: 'horasSemana', mensaje }]);
      }
      if (sesiones.length > 0 && (datos.personalId !== actual.personalId || datos.horasSemana !== actual.horasSemana)) {
        await asegurarHorarioEditable(this.ctx, actual.grupoId);
      }
      if (datos.personalId && datos.personalId !== actual.personalId) {
        const propias = new Set(sesiones.map((s) => s.id));
        for (const s of sesiones) {
          const periodo = await requerir(this.ctx.repos.periodos.obtener(s.periodoId), 'el periodo');
          const choque = await choqueDocente(this.ctx, actual.cicloEscolarId, datos.personalId, s.dia, periodo, { excluirSesiones: propias });
          if (choque) throw new ErrorDominio('TRASLAPE', choque, [{ campo: 'personalId', mensaje: choque }]);
        }
      }
      for (const s of sesiones) {
        if (s.personalId !== datos.personalId) {
          await this.ctx.repos.sesiones.actualizar({ ...s, personalId: datos.personalId, ...metadatosActualizados(this.ctx, s) });
        }
      }
      const a: Asignacion = { ...actual, personalId: datos.personalId, horasSemana: datos.horasSemana, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.asignaciones.actualizar(a);
      return a;
    });
  }

  /** Elimina la asignación y sus horas en el horario (la interfaz confirma antes). */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.asignaciones.obtener(id), 'la asignación');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      const sesiones = await this.ctx.repos.sesiones.listarPor('asignacionId', id);
      if (sesiones.length > 0) await asegurarHorarioEditable(this.ctx, actual.grupoId);
      const pases = (await this.ctx.repos.pases.listarPor('grupoId', actual.grupoId)).filter((p) => p.asignacionId === id).length;
      if (pases > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Esta materia ya tiene ${pases} lista(s) de asistencia registradas; quitarla borraría su historial.`);
      await this.ctx.repos.sesiones.eliminarVarios(sesiones.map((s) => s.id));
      await this.ctx.repos.asignaciones.eliminar(id);
    });
  }

  private async verificarDocente(personalId: string | null, escuelaId: string) {
    if (!personalId) return;
    const p = await this.ctx.repos.personal.obtener(personalId);
    if (!p || p.escuelaId !== escuelaId || !p.activo || !p.funciones.includes('docente')) {
      const mensaje = 'Selecciona un docente activo de esta escuela.';
      throw new ErrorDominio('VALIDACION', mensaje, [{ campo: 'personalId', mensaje }]);
    }
  }

  // ---------- Horario semanal ----------

  /** Periodos del turno del grupo con la sesión asignada (o vacía) para un día. */
  async horarioDelDia(grupoId: string, dia: number): Promise<CeldaHorario[]> {
    const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
    const [jornada] = await this.ctx.repos.jornadas.listarPor('turnoId', grupo.turnoId);
    if (!jornada) return [];
    const periodos = (await this.ctx.repos.periodos.listarPor('jornadaId', jornada.id)).sort(compararPorInicio);
    const sesiones = (await this.ctx.repos.sesiones.listarPor('grupoId', grupoId)).filter((s) => s.dia === dia);
    return periodos.map((periodo) => ({ periodo, sesion: sesiones.find((s) => s.periodoId === periodo.id) ?? null }));
  }

  /**
   * Pone una asignación en un día y periodo del grupo (reemplaza lo que hubiera).
   * Reglas: día laborable del turno, periodo del turno del grupo, sin exceder las
   * horas semanales y sin que el docente tenga otra clase a la misma hora.
   */
  async programar(entrada: EntradaSesion): Promise<Sesion> {
    const datos = validar(esquemaSesion, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const grupo = await requerir(this.ctx.repos.grupos.obtener(datos.grupoId), 'el grupo');
      await cicloEditable(this.ctx, grupo.cicloEscolarId);
      await asegurarHorarioEditable(this.ctx, grupo.id);
      const asignacion = await requerir(this.ctx.repos.asignaciones.obtener(datos.asignacionId), 'la asignación');
      if (asignacion.grupoId !== grupo.id) throw new ErrorDominio('VALIDACION', 'Esa materia no está asignada a este grupo.');
      const [jornada] = await this.ctx.repos.jornadas.listarPor('turnoId', grupo.turnoId);
      const periodo = await requerir(this.ctx.repos.periodos.obtener(datos.periodoId), 'el periodo');
      if (!jornada || periodo.jornadaId !== jornada.id) throw new ErrorDominio('VALIDACION', 'El periodo no pertenece al turno del grupo.');
      if (!jornada.dias.includes(datos.dia as DiaSemana)) throw new ErrorDominio('VALIDACION', 'Ese día no es laborable en el turno del grupo.');

      const actividadEnCelda = (await this.ctx.repos.actividades.listarPor('grupoId', grupo.id)).find((a) => a.dia === datos.dia && a.periodoId === periodo.id);
      if (actividadEnCelda) throw new ErrorDominio('TRASLAPE', `En ese periodo el grupo tiene otra actividad («${actividadEnCelda.descripcion}»). Quítala primero.`);
      const delGrupo = await this.ctx.repos.sesiones.listarPor('grupoId', grupo.id);
      const anterior = delGrupo.find((s) => s.dia === datos.dia && s.periodoId === periodo.id) ?? null;
      const programadas = delGrupo.filter((s) => s.asignacionId === asignacion.id && s.id !== anterior?.id).length;
      if (programadas >= asignacion.horasSemana) {
        const materia = await this.ctx.repos.materias.obtener(asignacion.materiaId);
        throw new ErrorDominio('VALIDACION', `«${materia?.nombre ?? 'La materia'}» ya tiene sus ${asignacion.horasSemana} horas semanales en el horario.`);
      }
      if (asignacion.personalId) {
        const choque = await choqueDocente(this.ctx, grupo.cicloEscolarId, asignacion.personalId, datos.dia, periodo, { excluirSesiones: new Set(anterior ? [anterior.id] : []) });
        if (choque) throw new ErrorDominio('TRASLAPE', choque);
      }
      if (anterior) await this.ctx.repos.sesiones.eliminar(anterior.id);
      const s: Sesion = {
        ...metadatosNuevos(this.ctx), escuelaId: grupo.escuelaId, cicloEscolarId: grupo.cicloEscolarId,
        asignacionId: asignacion.id, grupoId: grupo.id, personalId: asignacion.personalId,
        dia: datos.dia as DiaSemana, periodoId: periodo.id,
      };
      await this.ctx.repos.sesiones.insertar(s);
      return s;
    });
  }

  /** Para una celda: cada materia del grupo con su disponibilidad y el motivo si no se puede. */
  async opcionesParaCelda(grupoId: string, dia: number, periodoId: string) {
    const periodo = await requerir(this.ctx.repos.periodos.obtener(periodoId), 'el periodo');
    const asignaciones = await this.listarPorGrupo(grupoId);
    const delGrupo = await this.ctx.repos.sesiones.listarPor('grupoId', grupoId);
    const actual = delGrupo.find((s) => s.dia === dia && s.periodoId === periodoId) ?? null;
    const r = [];
    for (const a of asignaciones) {
      const esActual = actual?.asignacionId === a.id;
      let motivo: string | null = null;
      if (!esActual && a.sesionesProgramadas >= a.horasSemana) motivo = `Ya tiene sus ${a.horasSemana} horas en el horario.`;
      else if (a.personalId && !esActual) motivo = await choqueDocente(this.ctx, a.cicloEscolarId, a.personalId, dia, periodo, { excluirSesiones: new Set(actual ? [actual.id] : []) });
      r.push({ asignacion: a, actual: esActual, motivo });
    }
    return { actual, opciones: r };
  }

  async quitarSesion(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const s = await requerir(this.ctx.repos.sesiones.obtener(id), 'la clase');
      await cicloEditable(this.ctx, s.cicloEscolarId);
      await asegurarHorarioEditable(this.ctx, s.grupoId);
      await this.ctx.repos.sesiones.eliminar(id);
    });
  }

  /** Horario semanal de un docente en un ciclo (para revisar su carga). */
  async horarioDocente(personalId: string, cicloId: string) {
    const sesiones = (await this.ctx.repos.sesiones.listarPor('personalId', personalId)).filter((s) => s.cicloEscolarId === cicloId);
    const filas = [];
    for (const s of sesiones) {
      const periodo = await this.ctx.repos.periodos.obtener(s.periodoId);
      const grupo = await this.ctx.repos.grupos.obtener(s.grupoId);
      const grado = grupo ? await this.ctx.repos.grados.obtener(grupo.gradoId) : undefined;
      const asignacion = await this.ctx.repos.asignaciones.obtener(s.asignacionId);
      const materia = asignacion ? await this.ctx.repos.materias.obtener(asignacion.materiaId) : undefined;
      if (!periodo) continue;
      filas.push({ dia: s.dia, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin, grupo: `${grado?.numero ?? ''}° ${grupo?.nombre ?? ''}`, grupoId: s.grupoId, materia: materia?.nombre ?? '' });
    }
    return filas.sort((a, b) => a.dia - b.dia || a.horaInicio.localeCompare(b.horaInicio));
  }
}
