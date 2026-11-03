import type { DiaSemana, Jornada } from '../models';
import { construirDia, type EstadoValidacion, type Segmento } from '../domain/horarioVista';
import { ServicioRevisionHorarios } from './revisionHorarios';
import { compararPorInicio, duracionMinutos, type Intervalo } from '../domain/tiempo';
import type { Contexto } from './contexto';
import { requerir } from './contexto';
import { DIAS_SEMANA } from './turnos';

export interface DiaVista {
  dia: DiaSemana;
  nombre: string;
  segmentos: Segmento[];
}

export interface TotalesDocente {
  clase: number;
  servicioConfirmado: number;
  servicioPorConfirmar: number;
  otra: number;
  sinActividad: number;
}

/** Vistas semanales (sólo lectura) con tipos explícitos de bloque. */
export class ServicioVistas {
  constructor(private readonly ctx: Contexto) {}

  private async nombreGrupo(grupoId: string) {
    const g = await this.ctx.repos.grupos.obtener(grupoId);
    const gr = g ? await this.ctx.repos.grados.obtener(g.gradoId) : undefined;
    return `${gr?.numero ?? ''}° ${g?.nombre ?? ''}`;
  }

  async semanaGrupo(grupoId: string): Promise<DiaVista[]> {
    const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
    const [jornada] = await this.ctx.repos.jornadas.listarPor('turnoId', grupo.turnoId);
    if (!jornada) return [];
    const periodos = (await this.ctx.repos.periodos.listarPor('jornadaId', jornada.id)).sort(compararPorInicio);
    const recesos = await this.ctx.repos.recesos.listarPor('jornadaId', jornada.id);
    const sesiones = await this.ctx.repos.sesiones.listarPor('grupoId', grupoId);
    const actividades = await this.ctx.repos.actividades.listarPor('grupoId', grupoId);
    const confirmado = (await this.ctx.repos.confirmaciones.listarPor('grupoId', grupoId)).length > 0;
    const enConflicto = await new ServicioRevisionHorarios(this.ctx).idsEnConflicto(grupo.cicloEscolarId);
    const estado = (id: string) => (enConflicto.has(id) ? 'conflicto' : confirmado ? 'confirmado' : 'registrado') as EstadoValidacion;
    const r: DiaVista[] = [];
    for (const d of DIAS_SEMANA.filter((x) => jornada.dias.includes(x.valor))) {
      const ocupados: Segmento[] = [];
      for (const p of periodos) {
        const s = sesiones.find((x) => x.dia === d.valor && x.periodoId === p.id);
        const a = actividades.find((x) => x.dia === d.valor && x.periodoId === p.id);
        if (s) {
          const asig = await this.ctx.repos.asignaciones.obtener(s.asignacionId);
          const materia = asig ? await this.ctx.repos.materias.obtener(asig.materiaId) : undefined;
          const docente = s.personalId ? await this.ctx.repos.personal.obtener(s.personalId) : undefined;
          ocupados.push({ tipo: 'clase', titulo: materia?.nombre ?? 'Clase', detalle: docente ? `${docente.nombre} ${docente.primerApellido}` : 'Docente pendiente', horaInicio: p.horaInicio, horaFin: p.horaFin, id: s.id, enlaceDetalle: docente ? `#/personal/${docente.id}` : undefined, estado: estado(s.id), origen: s.origen ?? null });
        } else if (a) {
          ocupados.push({ tipo: 'otra', titulo: a.descripcion, horaInicio: p.horaInicio, horaFin: p.horaFin, id: a.id, estado: estado(a.id), origen: a.origen ?? null });
        } else {
          ocupados.push({ tipo: 'sin_actividad', titulo: 'Sin actividad registrada', horaInicio: p.horaInicio, horaFin: p.horaFin });
        }
      }
      r.push({ dia: d.valor, nombre: d.nombre, segmentos: construirDia(ocupados, recesos, null) });
    }
    return r;
  }

  async semanaDocente(personalId: string, cicloId: string): Promise<{ dias: DiaVista[]; totales: TotalesDocente }> {
    const sesiones = (await this.ctx.repos.sesiones.listarPor('personalId', personalId)).filter((s) => s.cicloEscolarId === cicloId);
    const actividades = (await this.ctx.repos.actividades.listarPor('personalId', personalId)).filter((a) => a.cicloEscolarId === cicloId);
    const enConflicto = await new ServicioRevisionHorarios(this.ctx).idsEnConflicto(cicloId);
    const confirmados = new Set((await this.ctx.repos.confirmaciones.listarPor('cicloEscolarId', cicloId)).map((c) => c.grupoId));

    // Jornadas de los turnos donde da clases: definen su rango de trabajo y sus recesos.
    const jornadas = new Map<string, Jornada>();
    const recesosPorJornada = new Map<string, Intervalo[]>();
    const clases: (Segmento & { dia: number; jornadaId: string })[] = [];
    for (const s of sesiones) {
      const p = await this.ctx.repos.periodos.obtener(s.periodoId);
      if (!p) continue;
      if (!jornadas.has(p.jornadaId)) {
        const j = await this.ctx.repos.jornadas.obtener(p.jornadaId);
        if (j) { jornadas.set(j.id, j); recesosPorJornada.set(j.id, await this.ctx.repos.recesos.listarPor('jornadaId', j.id)); }
      }
      const asig = await this.ctx.repos.asignaciones.obtener(s.asignacionId);
      const materia = asig ? await this.ctx.repos.materias.obtener(asig.materiaId) : undefined;
      clases.push({ tipo: 'clase', titulo: `${await this.nombreGrupo(s.grupoId)} ${materia?.nombre ?? ''}`.trim(), horaInicio: p.horaInicio, horaFin: p.horaFin, dia: s.dia, jornadaId: p.jornadaId, enlace: `#/grupo/${s.grupoId}`, id: s.id, estado: enConflicto.has(s.id) ? 'conflicto' : confirmados.has(s.grupoId) ? 'confirmado' : 'registrado', origen: s.origen ?? null });
    }
    // Marca clases simultáneas (sólo posibles con caso especial).
    for (const c of clases) c.simultanea = clases.some((o) => o !== c && o.dia === c.dia && o.horaInicio < c.horaFin && c.horaInicio < o.horaFin);

    const dias = new Set<number>([...actividades.map((a) => a.dia), ...[...jornadas.values()].flatMap((j) => j.dias)]);
    const r: DiaVista[] = [];
    const totales: TotalesDocente = { clase: 0, servicioConfirmado: 0, servicioPorConfirmar: 0, otra: 0, sinActividad: 0 };
    for (const d of DIAS_SEMANA.filter((x) => dias.has(x.valor))) {
      const delDia = [...jornadas.values()].filter((j) => j.dias.includes(d.valor));
      const rango = delDia.length
        ? { horaInicio: delDia.map((j) => j.horaInicio).sort()[0]!, horaFin: delDia.map((j) => j.horaFin).sort().at(-1)! }
        : null;
      const ocupados: Segmento[] = [
        ...clases.filter((c) => c.dia === d.valor),
        ...actividades.filter((a) => a.dia === d.valor).map((a): Segmento => ({
          tipo: a.tipo === 'servicio' ? 'servicio' : 'otra', titulo: a.descripcion, horaInicio: a.horaInicio, horaFin: a.horaFin,
          confirmada: a.confirmada, id: a.id, origen: a.origen ?? null,
          estado: enConflicto.has(a.id) ? 'conflicto' : a.confirmada ? 'confirmado' : 'registrado',
        })),
      ];
      const recesos = delDia.flatMap((j) => recesosPorJornada.get(j.id) ?? []);
      const segmentos = construirDia(ocupados, recesos, rango);
      for (const s of segmentos) {
        const m = duracionMinutos(s.horaInicio, s.horaFin);
        if (s.tipo === 'clase') totales.clase += m;
        else if (s.tipo === 'servicio') { if (s.confirmada) totales.servicioConfirmado += m; else totales.servicioPorConfirmar += m; }
        else if (s.tipo === 'otra') totales.otra += m;
        else if (s.tipo === 'sin_actividad') totales.sinActividad += m;
      }
      r.push({ dia: d.valor, nombre: d.nombre, segmentos });
    }
    return { dias: r, totales };
  }
}
