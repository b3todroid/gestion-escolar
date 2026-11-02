/** Utilidades de horas en formato 24 h "HH:MM". */

export const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function esHoraValida(hora: string): boolean {
  return PATRON_HORA.test(hora);
}

/** Convierte "HH:MM" a minutos desde la medianoche. */
export function aMinutos(hora: string): number {
  if (!esHoraValida(hora)) throw new RangeError(`Hora inválida: ${hora}`);
  const [h, m] = hora.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function duracionMinutos(inicio: string, fin: string): number {
  return aMinutos(fin) - aMinutos(inicio);
}

export interface Intervalo {
  horaInicio: string;
  horaFin: string;
}

/**
 * Dos intervalos se traslapan si comparten algún minuto.
 * Intervalos contiguos (uno termina 08:50 y otro inicia 08:50) NO se traslapan.
 */
export function seTraslapan(a: Intervalo, b: Intervalo): boolean {
  return aMinutos(a.horaInicio) < aMinutos(b.horaFin) && aMinutos(b.horaInicio) < aMinutos(a.horaFin);
}

export function estaDentro(interno: Intervalo, externo: Intervalo): boolean {
  return (
    aMinutos(interno.horaInicio) >= aMinutos(externo.horaInicio) &&
    aMinutos(interno.horaFin) <= aMinutos(externo.horaFin)
  );
}

export function compararPorInicio(a: Intervalo, b: Intervalo): number {
  return aMinutos(a.horaInicio) - aMinutos(b.horaInicio);
}

/** Minutos desde la medianoche a "HH:MM" (limitado a 00:00–23:59). */
export function desdeMinutos(min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatoDuracion(min: number): string {
  const hrs = Math.floor(min / 60);
  const resto = min % 60;
  if (hrs === 0) return `${resto} min`;
  return resto === 0 ? `${hrs} h` : `${hrs} h ${resto} min`;
}
