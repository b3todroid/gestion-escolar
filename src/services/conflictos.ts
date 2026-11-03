import type { Contexto } from './contexto';
import { seTraslapan, type Intervalo } from '../domain/tiempo';
import { DIAS_SEMANA } from './turnos';

/**
 * Busca si el docente ya tiene una sesión que se traslape en horario real
 * (no por número de periodo: los turnos pueden tener periodos distintos).
 * Devuelve una descripción comprensible del choque, o null.
 */
export async function choqueDocente(
  ctx: Contexto,
  personalId: string,
  dia: number,
  intervalo: Intervalo,
  excluirSesiones: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  const sesiones = (await ctx.repos.sesiones.listarPor('personalId', personalId))
    .filter((s) => s.dia === dia && !excluirSesiones.has(s.id));
  for (const s of sesiones) {
    const periodo = await ctx.repos.periodos.obtener(s.periodoId);
    if (!periodo || !seTraslapan(periodo, intervalo)) continue;
    const grupo = await ctx.repos.grupos.obtener(s.grupoId);
    const grado = grupo ? await ctx.repos.grados.obtener(grupo.gradoId) : undefined;
    const asignacion = await ctx.repos.asignaciones.obtener(s.asignacionId);
    const materia = asignacion ? await ctx.repos.materias.obtener(asignacion.materiaId) : undefined;
    const persona = await ctx.repos.personal.obtener(personalId);
    const nombreDia = DIAS_SEMANA.find((d) => d.valor === dia)?.nombre.toLowerCase() ?? '';
    return `${persona ? `${persona.nombre} ${persona.primerApellido}` : 'El docente'} ya tiene clase con ${grado?.numero ?? ''}° ${grupo?.nombre ?? ''}`
      + `${materia ? ` (${materia.nombre})` : ''} el ${nombreDia} de ${periodo.horaInicio} a ${periodo.horaFin}.`;
  }
  return null;
}
