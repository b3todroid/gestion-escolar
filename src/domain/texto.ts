/**
 * Normaliza un texto para comparar duplicados:
 * sin acentos, minúsculas, espacios colapsados.
 * "  1° A " y "1° a" se consideran iguales.
 */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}
