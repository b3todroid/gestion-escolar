/**
 * Actividad en un momento dado, a partir de los bloques del día del docente
 * (clases, SE, otras actividades, recesos y huecos «sin actividad registrada»).
 * Límites exactos: un bloque abarca [inicio, fin): a las 07:50 ya terminó el
 * bloque 07:00–07:50 y empezó el siguiente. Pura y sin acceso a datos.
 */
import type { Segmento, TipoVista } from './horarioVista';
import { aMinutos } from './tiempo';

export type EstadoActual = TipoVista | 'fuera_de_jornada';

export const ETIQUETA_ESTADO_ACTUAL: Record<EstadoActual, string> = {
  clase: 'CLASE', servicio: 'SERVICIO', receso: 'RECESO', otra: 'OTRA ACTIVIDAD',
  sin_actividad: 'SIN ACTIVIDAD REGISTRADA', fuera_de_jornada: 'FUERA DE JORNADA',
};

export function actividadEn<T extends { segmento: Segmento }>(bloques: readonly T[], minuto: number): { estado: EstadoActual; bloque: T | null } {
  const enCurso = bloques.filter((b) => aMinutos(b.segmento.horaInicio) <= minuto && minuto < aMinutos(b.segmento.horaFin));
  // Con clases simultáneas autorizadas, se prefiere una clase; después SE, otra, receso y por último el hueco.
  const orden: TipoVista[] = ['clase', 'servicio', 'otra', 'receso', 'sin_actividad'];
  const bloque = [...enCurso].sort((a, b) => orden.indexOf(a.segmento.tipo) - orden.indexOf(b.segmento.tipo))[0] ?? null;
  return { estado: bloque ? bloque.segmento.tipo : 'fuera_de_jornada', bloque };
}

/** Siguiente bloque que empieza después del minuto indicado (opcionalmente de cierto tipo). */
export function siguienteDesde<T extends { segmento: Segmento }>(bloques: readonly T[], minuto: number, tipos: readonly TipoVista[]): T | null {
  return bloques.filter((b) => aMinutos(b.segmento.horaInicio) > minuto && tipos.includes(b.segmento.tipo))
    .sort((a, b) => aMinutos(a.segmento.horaInicio) - aMinutos(b.segmento.horaInicio))[0] ?? null;
}
