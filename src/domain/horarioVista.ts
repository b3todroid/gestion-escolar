/**
 * Construcción de la vista de un día con tipos de bloque explícitos:
 * CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD y SIN ACTIVIDAD REGISTRADA.
 * Regla: un hueco NUNCA se interpreta como servicio; sólo lo registrado cuenta.
 */
import { aMinutos, desdeMinutos, seTraslapan, type Intervalo } from './tiempo';

export type TipoVista = 'clase' | 'servicio' | 'receso' | 'otra' | 'sin_actividad';

export const ETIQUETA_TIPO_VISTA: Record<TipoVista, string> = {
  clase: 'Clase',
  servicio: 'Servicio',
  receso: 'Receso',
  otra: 'Otra actividad',
  sin_actividad: 'Sin actividad registrada',
};

export interface Segmento extends Intervalo {
  tipo: TipoVista;
  titulo: string;
  detalle?: string;
  /** Para servicio: false = registrado pero aún sin confirmar. */
  confirmada?: boolean;
  /** Clase simultánea autorizada por un caso especial. */
  simultanea?: boolean;
  enlace?: string;
  /** Enlace del detalle (p. ej. el nombre del docente). */
  enlaceDetalle?: string;
  id?: string;
}

/**
 * Ordena los bloques ocupados, agrega recesos que no estén cubiertos por
 * otra actividad y rellena los huecos dentro del rango con «sin actividad».
 */
export function construirDia(ocupados: readonly Segmento[], recesos: readonly Intervalo[], rango: Intervalo | null): Segmento[] {
  const orden = (a: Intervalo, b: Intervalo) => aMinutos(a.horaInicio) - aMinutos(b.horaInicio) || aMinutos(a.horaFin) - aMinutos(b.horaFin);
  const bloques: Segmento[] = [...ocupados];
  for (const r of recesos) {
    if (!ocupados.some((o) => seTraslapan(o, r))) bloques.push({ ...r, tipo: 'receso', titulo: 'Receso' });
  }
  bloques.sort(orden);
  if (!rango && bloques.length === 0) return [];
  const inicio = Math.min(rango ? aMinutos(rango.horaInicio) : Infinity, ...bloques.map((b) => aMinutos(b.horaInicio)));
  const fin = Math.max(rango ? aMinutos(rango.horaFin) : -Infinity, ...bloques.map((b) => aMinutos(b.horaFin)));
  const r: Segmento[] = [];
  let t = inicio;
  for (const b of bloques) {
    const ini = aMinutos(b.horaInicio);
    if (ini > t) r.push({ tipo: 'sin_actividad', titulo: ETIQUETA_TIPO_VISTA.sin_actividad, horaInicio: desdeMinutos(t), horaFin: desdeMinutos(ini) });
    r.push(b);
    t = Math.max(t, aMinutos(b.horaFin));
  }
  if (t < fin) r.push({ tipo: 'sin_actividad', titulo: ETIQUETA_TIPO_VISTA.sin_actividad, horaInicio: desdeMinutos(t), horaFin: desdeMinutos(fin) });
  return r;
}
