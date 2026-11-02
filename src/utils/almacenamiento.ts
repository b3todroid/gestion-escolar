/**
 * Estado del almacenamiento local del navegador.
 * IMPORTANTE: aun con almacenamiento "persistente", los datos se pierden si
 * el usuario borra los datos del sitio o cambia de dispositivo.
 */
export interface EstadoAlmacenamiento {
  disponible: boolean;
  persistente: boolean | null; // null = el navegador no lo informa
  usadoBytes: number | null;
  cuotaBytes: number | null;
}

export async function consultarAlmacenamiento(): Promise<EstadoAlmacenamiento> {
  const st = navigator.storage;
  const persistente = st?.persisted ? await st.persisted().catch(() => null) : null;
  const est = st?.estimate ? await st.estimate().catch(() => null) : null;
  return {
    disponible: typeof indexedDB !== 'undefined',
    persistente,
    usadoBytes: est?.usage ?? null,
    cuotaBytes: est?.quota ?? null,
  };
}

/** Pide al navegador que no borre automáticamente los datos de la app. */
export async function solicitarPersistencia(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function formatoBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}
