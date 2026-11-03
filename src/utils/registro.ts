/**
 * Registro de errores inesperados en la consola SIN datos personales:
 * sólo el tipo, el mensaje (recortado) y la pila de llamadas; nunca el objeto
 * completo (que podría traer registros de alumnos o personal).
 */
export function registrarError(e: unknown): void {
  const err = e instanceof Error ? e : null;
  const mensaje = (err?.message ?? String(e)).slice(0, 200);
  console.error(`[Gestión Escolar] ${err?.name ?? 'Error'}: ${mensaje}`, err?.stack ? `\n${err.stack.split('\n').slice(1, 6).join('\n')}` : '');
}
