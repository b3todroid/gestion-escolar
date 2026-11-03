import type { Contexto } from './contexto';
import { estaDentro, seTraslapan, type Intervalo } from '../domain/tiempo';
import { DIAS_SEMANA } from './turnos';
import { ErrorDominio } from '../domain/errores';

export interface OpcionesChoque {
  excluirSesiones?: ReadonlySet<string>;
  excluirActividades?: ReadonlySet<string>;
  /** true si lo que se agrega es una actividad (servicio/otra): nunca se permite simultaneidad. */
  esActividad?: boolean;
}

function nombreDia(dia: number): string {
  return DIAS_SEMANA.find((d) => d.valor === dia)?.nombre.toLowerCase() ?? '';
}

/** ¿Hay un caso especial que autorice clases simultáneas del docente en esa franja? */
export async function hayExcepcion(ctx: Contexto, cicloId: string, personalId: string, dia: number, intervalo: Intervalo): Promise<boolean> {
  const lista = await ctx.repos.excepciones.listarPor('personalId', personalId);
  return lista.some((e) => e.cicloEscolarId === cicloId && e.dia === dia && estaDentro(intervalo, e));
}

/**
 * Busca si el docente ya tiene, EN ESE CICLO, una clase o actividad que se traslape
 * en horario real (no por número de periodo: los turnos pueden tener periodos
 * distintos). Dos clases simultáneas sólo se permiten con un caso especial.
 * Devuelve una descripción comprensible del choque, o null.
 */
export async function choqueDocente(
  ctx: Contexto, cicloId: string, personalId: string, dia: number, intervalo: Intervalo, op: OpcionesChoque = {},
): Promise<string | null> {
  const persona = await ctx.repos.personal.obtener(personalId);
  const quien = persona ? `${persona.nombre} ${persona.primerApellido}` : 'El docente';

  const actividades = (await ctx.repos.actividades.listarPor('personalId', personalId))
    .filter((a) => a.cicloEscolarId === cicloId && a.dia === dia && !op.excluirActividades?.has(a.id) && seTraslapan(a, intervalo))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)); // se informa el choque más temprano
  const act = actividades[0];
  if (act) {
    const que = act.tipo === 'servicio' ? 'servicio' : 'otra actividad';
    return `${quien} tiene ${que} («${act.descripcion}») el ${nombreDia(dia)} de ${act.horaInicio} a ${act.horaFin}.`;
  }

  const sesiones = (await ctx.repos.sesiones.listarPor('personalId', personalId))
    .filter((s) => s.cicloEscolarId === cicloId && s.dia === dia && !op.excluirSesiones?.has(s.id));
  const autorizado = !op.esActividad && await hayExcepcion(ctx, cicloId, personalId, dia, intervalo);
  if (autorizado) return null;
  const conHora = [];
  for (const s of sesiones) {
    const periodo = await ctx.repos.periodos.obtener(s.periodoId);
    if (periodo && seTraslapan(periodo, intervalo)) conHora.push({ s, periodo });
  }
  conHora.sort((a, b) => a.periodo.horaInicio.localeCompare(b.periodo.horaInicio)); // el más temprano
  for (const { s, periodo } of conHora) {
    const grupo = await ctx.repos.grupos.obtener(s.grupoId);
    const grado = grupo ? await ctx.repos.grados.obtener(grupo.gradoId) : undefined;
    const asignacion = await ctx.repos.asignaciones.obtener(s.asignacionId);
    const materia = asignacion ? await ctx.repos.materias.obtener(asignacion.materiaId) : undefined;
    return `${quien} ya tiene clase con ${grado?.numero ?? ''}° ${grupo?.nombre ?? ''}`
      + `${materia ? ` (${materia.nombre})` : ''} el ${nombreDia(dia)} de ${periodo.horaInicio} a ${periodo.horaFin}.`;
  }
  return null;
}

/** Un horario de grupo confirmado no se modifica hasta reabrirlo con motivo. */
export async function asegurarHorarioEditable(ctx: Contexto, grupoId: string): Promise<void> {
  const [c] = await ctx.repos.confirmaciones.listarPor('grupoId', grupoId);
  if (c) {
    const grupo = await ctx.repos.grupos.obtener(grupoId);
    const grado = grupo ? await ctx.repos.grados.obtener(grupo.gradoId) : undefined;
    throw new ErrorDominio('HORARIO_CONFIRMADO',
      `El horario de ${grado?.numero ?? ''}° ${grupo?.nombre ?? ''} está confirmado. Para modificarlo, primero reábrelo indicando el motivo.`);
  }
}
