import type { Actividad, Asignacion, DiaSemana, Grupo, Jornada, Periodo, Personal, Sesion } from '../models';
import { aMinutos, duracionMinutos, estaDentro, seTraslapan, type Intervalo } from '../domain/tiempo';
import { type Contexto, requerir } from './contexto';
import { DIAS_SEMANA } from './turnos';
import { nombreCompleto } from './personal';

/**
 * Revisión y reportes de horarios de un ciclo. SÓLO LECTURA: no corrige ni
 * mueve nada. Todo se deriva de las mismas asignaciones, clases (sesiones) y
 * actividades que alimentan las vistas por grupo y por docente.
 */

export type TipoConflicto =
  | 'docente_simultaneo' // un docente en dos grupos (o clase + actividad) a la misma hora real
  | 'turno_incompatible' // choque entre turnos distintos, o periodo de otro turno
  | 'grupo_duplicado' // dos clases/actividades en la misma celda del grupo
  | 'periodo_inexistente'
  | 'materia_inexistente'
  | 'docente_inexistente' // eliminado, de otra escuela, sin función docente o dado de baja
  | 'fuera_de_jornada' // día no laborable u horario fuera de la jornada del turno
  | 'asignacion_duplicada' // la misma materia asignada dos veces al grupo, o más horas que las asignadas
  | 'dato_inconsistente'; // copia desnormalizada que no coincide con su asignación

export const ETIQUETA_CONFLICTO: Record<TipoConflicto, string> = {
  docente_simultaneo: 'Docente en dos lugares a la vez',
  turno_incompatible: 'Incompatibilidad entre turnos',
  grupo_duplicado: 'Grupo con dos actividades en el mismo periodo',
  periodo_inexistente: 'Periodo inexistente',
  materia_inexistente: 'Materia inexistente',
  docente_inexistente: 'Docente inexistente o no disponible',
  fuera_de_jornada: 'Fuera de la jornada',
  asignacion_duplicada: 'Asignación duplicada o excedida',
  dato_inconsistente: 'Dato inconsistente',
};

export interface ConflictoHorario {
  tipo: TipoConflicto;
  mensaje: string;
  grupoId: string | null;
  personalId: string | null;
  /** Clases y actividades involucradas (para marcar su estado en las vistas). */
  sesionIds: string[];
  actividadIds: string[];
}

export interface ResumenGrupo {
  grupoId: string; nombre: string; turnoId: string; turno: string; activo: boolean; confirmado: boolean;
  horasAsignadas: number; // suma de horas por semana de sus materias
  horasProgramadas: number; // clases colocadas en el horario
  otrasActividades: number;
  periodosSinInformacion: number; // celdas (día × periodo) sin clase ni actividad
  periodosTotales: number;
  docentePendiente: number; // clases sin docente
  conflictos: number;
}

export interface ResumenDocente {
  personalId: string; nombre: string; activo: boolean; turnos: string[];
  grupos: string[]; materias: string[];
  horasClase: number; minutosClase: number;
  seConfirmadas: number; minutosSeConfirmados: number;
  sePorConfirmar: number; minutosSePorConfirmar: number;
  otrasActividades: number;
  conflictos: number;
}

export interface ReporteHorarios {
  grupos: ResumenGrupo[];
  docentes: ResumenDocente[];
  conflictos: ConflictoHorario[];
}

const nombreDia = (d: number) => DIAS_SEMANA.find((x) => x.valor === d)?.nombre.toLowerCase() ?? `día ${d}`;

export class ServicioRevisionHorarios {
  constructor(private readonly ctx: Contexto) {}

  private async datos(cicloId: string) {
    const r = this.ctx.repos;
    const ciclo = await requerir(r.ciclos.obtener(cicloId), 'el ciclo escolar');
    return {
      ciclo,
      grados: await r.grados.listarPor('cicloEscolarId', cicloId),
      grupos: await r.grupos.listarPor('cicloEscolarId', cicloId),
      turnos: await r.turnos.listarPor('cicloEscolarId', cicloId),
      jornadas: await r.jornadas.listarPor('cicloEscolarId', cicloId),
      periodos: await r.periodos.listarPor('cicloEscolarId', cicloId),
      materias: await r.materias.listarPor('cicloEscolarId', cicloId),
      personal: await r.personal.listarPor('escuelaId', ciclo.escuelaId),
      asignaciones: await r.asignaciones.listarPor('cicloEscolarId', cicloId),
      sesiones: await r.sesiones.listarPor('cicloEscolarId', cicloId),
      actividades: await r.actividades.listarPor('cicloEscolarId', cicloId),
      excepciones: await r.excepciones.listarPor('cicloEscolarId', cicloId),
      confirmados: new Set((await r.confirmaciones.listarPor('cicloEscolarId', cicloId)).map((c) => c.grupoId)),
    };
  }

  /** Conflictos pendientes del ciclo (opcionalmente sólo de un turno). */
  async conflictos(cicloId: string, turnoId: string | null = null): Promise<ConflictoHorario[]> {
    const d = await this.datos(cicloId);
    const todos = this.revisar(d);
    if (!turnoId) return todos;
    const gruposTurno = new Set(d.grupos.filter((g) => g.turnoId === turnoId).map((g) => g.id));
    const jornadasTurno = new Set(d.jornadas.filter((j) => j.turnoId === turnoId).map((j) => j.id));
    const periodoTurno = (s: Sesion) => jornadasTurno.has(d.periodos.find((p) => p.id === s.periodoId)?.jornadaId ?? '');
    return todos.filter((c) => (c.grupoId && gruposTurno.has(c.grupoId))
      || c.sesionIds.some((id) => { const s = d.sesiones.find((x) => x.id === id); return s ? gruposTurno.has(s.grupoId) || periodoTurno(s) : false; }));
  }

  private revisar(d: Awaited<ReturnType<ServicioRevisionHorarios['datos']>>): ConflictoHorario[] {
    const r: ConflictoHorario[] = [];
    const grupo = (id: string | null) => d.grupos.find((g) => g.id === id);
    const nGrupo = (g: Grupo | undefined) => (g ? `${d.grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre}` : 'grupo eliminado');
    const nTurno = (id: string | undefined) => d.turnos.find((t) => t.id === id)?.nombre ?? 'turno desconocido';
    const persona = (id: string | null) => d.personal.find((p) => p.id === id);
    const nPersona = (p: Personal | undefined) => (p ? nombreCompleto(p) : 'docente eliminado');
    const jornadaDe = (p: Periodo | undefined) => d.jornadas.find((j) => j.id === p?.jornadaId);
    const asig = (id: string) => d.asignaciones.find((a) => a.id === id);
    const materia = (a: Asignacion | undefined) => d.materias.find((m) => m.id === a?.materiaId);
    const agregar = (c: Omit<ConflictoHorario, 'actividadIds' | 'sesionIds'> & Partial<Pick<ConflictoHorario, 'sesionIds' | 'actividadIds'>>) =>
      r.push({ sesionIds: [], actividadIds: [], ...c });

    // --- Asignaciones (materia, docente, duplicados, horas excedidas)
    for (const a of d.asignaciones) {
      const g = grupo(a.grupoId);
      if (!materia(a)) agregar({ tipo: 'materia_inexistente', mensaje: `${nGrupo(g)} tiene asignada una materia que ya no existe en el ciclo.`, grupoId: a.grupoId, personalId: a.personalId });
      if (a.personalId) {
        const p = persona(a.personalId);
        if (!p || !p.funciones.includes('docente') || !p.activo) {
          agregar({ tipo: 'docente_inexistente', grupoId: a.grupoId, personalId: a.personalId,
            mensaje: `${materia(a)?.nombre ?? 'Una materia'} de ${nGrupo(g)}: ${!p ? 'el docente asignado ya no existe' : !p.activo ? `${nPersona(p)} está dado(a) de baja` : `${nPersona(p)} no tiene función docente`}.` });
        }
      }
      const programadas = d.sesiones.filter((s) => s.asignacionId === a.id);
      if (programadas.length > a.horasSemana) {
        agregar({ tipo: 'asignacion_duplicada', grupoId: a.grupoId, personalId: a.personalId, sesionIds: programadas.map((s) => s.id),
          mensaje: `${materia(a)?.nombre ?? 'Una materia'} de ${nGrupo(g)} tiene ${programadas.length} clases en el horario pero sólo ${a.horasSemana} horas asignadas.` });
      }
    }
    const pares = new Map<string, Asignacion[]>();
    for (const a of d.asignaciones) pares.set(`${a.grupoId}|${a.materiaId}`, [...(pares.get(`${a.grupoId}|${a.materiaId}`) ?? []), a]);
    for (const lista of pares.values()) {
      if (lista.length > 1) agregar({ tipo: 'asignacion_duplicada', grupoId: lista[0]!.grupoId, personalId: null,
        mensaje: `${nGrupo(grupo(lista[0]!.grupoId))} tiene ${lista.length} asignaciones de ${materia(lista[0])?.nombre ?? 'la misma materia'}.` });
    }

    // --- Cada clase: periodo, turno, jornada, copias
    const validas: { s: Sesion; periodo: Periodo; jornada: Jornada }[] = [];
    for (const s of d.sesiones) {
      const g = grupo(s.grupoId);
      const a = asig(s.asignacionId);
      const periodo = d.periodos.find((p) => p.id === s.periodoId);
      const donde = `${nGrupo(g)}, ${nombreDia(s.dia)}`;
      if (!a) { agregar({ tipo: 'materia_inexistente', mensaje: `${donde}: hay una clase sin asignación de materia.`, grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id] }); continue; }
      if (a.grupoId !== s.grupoId || a.personalId !== s.personalId) {
        agregar({ tipo: 'dato_inconsistente', grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id],
          mensaje: `${donde}: la clase de ${materia(a)?.nombre ?? 'la materia'} no coincide con su asignación (grupo o docente distinto).` });
      }
      if (!periodo) { agregar({ tipo: 'periodo_inexistente', mensaje: `${donde}: la clase está en un periodo que ya no existe.`, grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id] }); continue; }
      const jornada = jornadaDe(periodo);
      if (!jornada) { agregar({ tipo: 'periodo_inexistente', mensaje: `${donde}: el periodo ${periodo.nombre} no pertenece a ninguna jornada.`, grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id] }); continue; }
      if (g && jornada.turnoId !== g.turnoId) {
        agregar({ tipo: 'turno_incompatible', grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id],
          mensaje: `${donde}: la clase usa un periodo del turno ${nTurno(jornada.turnoId)}, pero el grupo es del turno ${nTurno(g.turnoId)}.` });
      }
      if (!jornada.dias.includes(s.dia)) {
        agregar({ tipo: 'fuera_de_jornada', grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id], mensaje: `${donde}: ese día no es laborable en el turno ${nTurno(jornada.turnoId)}.` });
      } else if (!estaDentro(periodo, jornada)) {
        agregar({ tipo: 'fuera_de_jornada', grupoId: s.grupoId, personalId: s.personalId, sesionIds: [s.id], mensaje: `${donde}: el periodo ${periodo.horaInicio}–${periodo.horaFin} queda fuera de la jornada (${jornada.horaInicio}–${jornada.horaFin}).` });
      }
      validas.push({ s, periodo, jornada });
    }

    // --- Misma celda del grupo con dos cosas
    const celdas = new Map<string, { sesiones: Sesion[]; actividades: Actividad[] }>();
    const celda = (k: string) => { if (!celdas.has(k)) celdas.set(k, { sesiones: [], actividades: [] }); return celdas.get(k)!; };
    for (const s of d.sesiones) celda(`${s.grupoId}|${s.dia}|${s.periodoId}`).sesiones.push(s);
    for (const a of d.actividades) if (a.grupoId && a.periodoId) celda(`${a.grupoId}|${a.dia}|${a.periodoId}`).actividades.push(a);
    for (const [k, c] of celdas) {
      if (c.sesiones.length + c.actividades.length < 2) continue;
      const [grupoId, dia] = k.split('|') as [string, string];
      const periodo = d.periodos.find((p) => p.id === k.split('|')[2]);
      agregar({ tipo: 'grupo_duplicado', grupoId, personalId: null, sesionIds: c.sesiones.map((s) => s.id), actividadIds: c.actividades.map((a) => a.id),
        mensaje: `${nGrupo(grupo(grupoId))} tiene ${c.sesiones.length + c.actividades.length} clases o actividades el ${nombreDia(Number(dia))}${periodo ? ` de ${periodo.horaInicio} a ${periodo.horaFin}` : ''}.` });
    }

    // --- Docente en dos lugares a la vez (hora real; incluye turnos distintos)
    const autorizado = (personalId: string, dia: number, i: Intervalo) =>
      d.excepciones.some((e) => e.personalId === personalId && e.dia === dia && estaDentro(i, e));
    const porDocente = new Map<string, typeof validas>();
    for (const v of validas) if (v.s.personalId) porDocente.set(v.s.personalId, [...(porDocente.get(v.s.personalId) ?? []), v]);
    for (const [personalId, lista] of porDocente) {
      const p = persona(personalId);
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const a = lista[i]!; const b = lista[j]!;
          if (a.s.dia !== b.s.dia || a.s.grupoId === b.s.grupoId || !seTraslapan(a.periodo, b.periodo)) continue;
          if (autorizado(personalId, a.s.dia, a.periodo) && autorizado(personalId, b.s.dia, b.periodo)) continue;
          const turnos = a.jornada.turnoId !== b.jornada.turnoId;
          agregar({ tipo: turnos ? 'turno_incompatible' : 'docente_simultaneo', grupoId: null, personalId, sesionIds: [a.s.id, b.s.id],
            mensaje: `${nPersona(p)} tiene clase con ${nGrupo(grupo(a.s.grupoId))} (${a.periodo.horaInicio}–${a.periodo.horaFin}${turnos ? `, turno ${nTurno(a.jornada.turnoId)}` : ''}) y con ${nGrupo(grupo(b.s.grupoId))} (${b.periodo.horaInicio}–${b.periodo.horaFin}${turnos ? `, turno ${nTurno(b.jornada.turnoId)}` : ''}) el ${nombreDia(a.s.dia)}.` });
        }
      }
      for (const act of d.actividades.filter((x) => x.personalId === personalId)) {
        for (const v of lista) {
          if (v.s.dia === act.dia && seTraslapan(v.periodo, act)) {
            agregar({ tipo: 'docente_simultaneo', grupoId: null, personalId, sesionIds: [v.s.id], actividadIds: [act.id],
              mensaje: `${nPersona(p)} tiene clase con ${nGrupo(grupo(v.s.grupoId))} y ${act.tipo === 'servicio' ? 'servicio' : 'otra actividad'} («${act.descripcion}») el ${nombreDia(act.dia)} a la misma hora.` });
          }
        }
      }
    }
    // Actividades del docente que se traslapan entre sí
    const actsDocente = d.actividades.filter((a) => a.personalId);
    for (let i = 0; i < actsDocente.length; i++) {
      for (let j = i + 1; j < actsDocente.length; j++) {
        const a = actsDocente[i]!; const b = actsDocente[j]!;
        if (a.personalId === b.personalId && a.dia === b.dia && seTraslapan(a, b)) {
          agregar({ tipo: 'docente_simultaneo', grupoId: null, personalId: a.personalId, actividadIds: [a.id, b.id],
            mensaje: `${nPersona(persona(a.personalId))} tiene dos actividades a la misma hora el ${nombreDia(a.dia)} («${a.descripcion}» y «${b.descripcion}»).` });
        }
      }
    }
    // Actividades con periodo inexistente o con horario distinto al de su periodo
    for (const a of d.actividades.filter((x) => x.periodoId)) {
      const p = d.periodos.find((x) => x.id === a.periodoId);
      if (!p) agregar({ tipo: 'periodo_inexistente', grupoId: a.grupoId, personalId: a.personalId, actividadIds: [a.id], mensaje: `«${a.descripcion}» (${nombreDia(a.dia)}) está en un periodo que ya no existe.` });
      else if (p.horaInicio !== a.horaInicio || p.horaFin !== a.horaFin) {
        agregar({ tipo: 'dato_inconsistente', grupoId: a.grupoId, personalId: a.personalId, actividadIds: [a.id], mensaje: `«${a.descripcion}» (${nombreDia(a.dia)}) tiene ${a.horaInicio}–${a.horaFin}, pero su periodo es ${p.horaInicio}–${p.horaFin}.` });
      }
    }
    return r;
  }

  /** Reporte del ciclo (opcionalmente de un turno): grupos, docentes y conflictos pendientes. */
  async reporte(cicloId: string, turnoId: string | null = null): Promise<ReporteHorarios> {
    const d = await this.datos(cicloId);
    let conflictos = this.revisar(d);
    const grupos = d.grupos.filter((g) => !turnoId || g.turnoId === turnoId);
    const idsGrupos = new Set(grupos.map((g) => g.id));
    const nGrupo = (g: Grupo | undefined) => (g ? `${d.grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre}` : '');
    const nTurno = (id: string) => d.turnos.find((t) => t.id === id)?.nombre ?? '';
    const resumenGrupos: ResumenGrupo[] = grupos.map((g) => {
      const j = d.jornadas.find((x) => x.turnoId === g.turnoId);
      const periodos = j ? d.periodos.filter((p) => p.jornadaId === j.id).length : 0;
      const totales = periodos * (j?.dias.length ?? 0);
      const ses = d.sesiones.filter((s) => s.grupoId === g.id);
      const acts = d.actividades.filter((a) => a.grupoId === g.id);
      const ocupadas = new Set([...ses.map((s) => `${s.dia}|${s.periodoId}`), ...acts.map((a) => `${a.dia}|${a.periodoId}`)]);
      return {
        grupoId: g.id, nombre: nGrupo(g), turnoId: g.turnoId, turno: nTurno(g.turnoId), activo: g.activo !== false, confirmado: d.confirmados.has(g.id),
        horasAsignadas: d.asignaciones.filter((a) => a.grupoId === g.id).reduce((n, a) => n + a.horasSemana, 0),
        horasProgramadas: ses.length, otrasActividades: acts.length,
        periodosSinInformacion: Math.max(0, totales - ocupadas.size), periodosTotales: totales,
        docentePendiente: ses.filter((s) => !s.personalId).length,
        conflictos: conflictos.filter((c) => c.grupoId === g.id || c.sesionIds.some((id) => ses.some((s) => s.id === id))).length,
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

    const jornadasTurno = new Set(d.jornadas.filter((j) => !turnoId || j.turnoId === turnoId).map((j) => j.id));
    const docentes = d.personal.filter((p) => p.funciones.includes('docente')
      && (p.activo || d.sesiones.some((s) => s.personalId === p.id) || d.actividades.some((a) => a.personalId === p.id)));
    const resumenDocentes: ResumenDocente[] = [];
    for (const p of docentes) {
      const ses = d.sesiones.filter((s) => s.personalId === p.id);
      const enTurno = ses.filter((s) => idsGrupos.has(s.grupoId));
      const acts = d.actividades.filter((a) => a.personalId === p.id && (!turnoId || !a.periodoId || jornadasTurno.has(d.periodos.find((x) => x.id === a.periodoId)?.jornadaId ?? '')));
      if (turnoId && !enTurno.length && !acts.length) continue;
      const lista = turnoId ? enTurno : ses;
      const minutos = (s: Sesion) => { const per = d.periodos.find((x) => x.id === s.periodoId); return per ? duracionMinutos(per.horaInicio, per.horaFin) : 0; };
      const se = acts.filter((a) => a.tipo === 'servicio');
      resumenDocentes.push({
        personalId: p.id, nombre: nombreCompleto(p), activo: p.activo,
        turnos: [...new Set(lista.map((s) => nTurno(d.grupos.find((g) => g.id === s.grupoId)?.turnoId ?? '')).filter(Boolean))],
        grupos: [...new Set(lista.map((s) => nGrupo(d.grupos.find((g) => g.id === s.grupoId))))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
        materias: [...new Set(lista.map((s) => d.materias.find((m) => m.id === d.asignaciones.find((a) => a.id === s.asignacionId)?.materiaId)?.nombre ?? '').filter(Boolean))].sort(),
        horasClase: lista.length, minutosClase: lista.reduce((n, s) => n + minutos(s), 0),
        seConfirmadas: se.filter((a) => a.confirmada).length, minutosSeConfirmados: se.filter((a) => a.confirmada).reduce((n, a) => n + duracionMinutos(a.horaInicio, a.horaFin), 0),
        sePorConfirmar: se.filter((a) => !a.confirmada).length, minutosSePorConfirmar: se.filter((a) => !a.confirmada).reduce((n, a) => n + duracionMinutos(a.horaInicio, a.horaFin), 0),
        otrasActividades: acts.filter((a) => a.tipo === 'otra').length,
        conflictos: conflictos.filter((c) => c.personalId === p.id).length,
      });
    }
    resumenDocentes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (turnoId) {
      const docs = new Set(resumenDocentes.map((x) => x.personalId));
      conflictos = conflictos.filter((c) => (c.grupoId && idsGrupos.has(c.grupoId)) || (c.personalId && docs.has(c.personalId)));
    }
    return { grupos: resumenGrupos, docentes: resumenDocentes, conflictos };
  }

  /** Ids de clases y actividades con algún conflicto (para el estado de validación de cada celda). */
  async idsEnConflicto(cicloId: string): Promise<Set<string>> {
    const c = await this.conflictos(cicloId);
    return new Set(c.flatMap((x) => [...x.sesionIds, ...x.actividadIds]));
  }

  /** Celdas (día × periodo) de un grupo sin información registrada. */
  async sinInformacion(grupoId: string): Promise<{ dia: DiaSemana; periodo: Periodo }[]> {
    const g = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
    const [j] = await this.ctx.repos.jornadas.listarPor('turnoId', g.turnoId);
    if (!j) return [];
    const periodos = (await this.ctx.repos.periodos.listarPor('jornadaId', j.id)).sort((a, b) => aMinutos(a.horaInicio) - aMinutos(b.horaInicio));
    const ses = await this.ctx.repos.sesiones.listarPor('grupoId', grupoId);
    const acts = await this.ctx.repos.actividades.listarPor('grupoId', grupoId);
    const r: { dia: DiaSemana; periodo: Periodo }[] = [];
    for (const dia of j.dias) for (const p of periodos) {
      if (!ses.some((s) => s.dia === dia && s.periodoId === p.id) && !acts.some((a) => a.dia === dia && a.periodoId === p.id)) r.push({ dia, periodo: p });
    }
    return r;
  }
}
