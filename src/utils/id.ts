/**
 * Genera identificadores internos únicos y estables (UUID v4).
 * `crypto.randomUUID` sólo existe en contextos seguros (HTTPS/localhost);
 * si se abre la app por IP en la red local, se usa `getRandomValues`,
 * que sí está disponible en cualquier contexto.
 */
export function nuevoId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
