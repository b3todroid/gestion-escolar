/** Fecha y hora LOCALES (no UTC): la escuela trabaja con su hora de pared. */
export function fechaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function horaLocal(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** 1 = lunes … 7 = domingo. */
export function diaIso(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}
export function diaDeFecha(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return diaIso(new Date(a, m - 1, d));
}
export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return fechaLocal(new Date(a, m - 1, d + n));
}
