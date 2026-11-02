import type { NivelEducativo } from '../models';

export const NIVEL_ETIQUETA: Record<NivelEducativo, string> = {
  preescolar: 'Preescolar',
  primaria: 'Primaria',
  secundaria: 'Secundaria',
  media_superior: 'Media superior',
  otro: 'Otro',
};

export function formatoFecha(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}
