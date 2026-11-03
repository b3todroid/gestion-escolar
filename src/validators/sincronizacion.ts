/**
 * Protocolo de sincronización (Fase 8D), compartido por la aplicación y el servidor.
 * El dispositivo ENVÍA los cambios que hizo sin conexión (cola) y RECIBE los cambios de
 * los demás desde su último número de secuencia. Nada se sobrescribe a ciegas: cada
 * cambio declara sobre qué versión se hizo (`versionBase`).
 */
import { z } from 'zod';
import { TABLAS_RESPALDO } from './respaldo';

export const TABLAS_SINCRONIZADAS = TABLAS_RESPALDO;
export type TablaSincronizada = (typeof TABLAS_SINCRONIZADAS)[number];

export const MAX_CAMBIOS_POR_ENVIO = 2000;

export const esquemaCambio = z.object({
  /** Identificador único de la operación (idempotencia: reenviarla no la repite). */
  opId: z.uuid(),
  /** Cambios hechos en la MISMA transacción local: se aplican todos o ninguno. */
  grupo: z.uuid(),
  tabla: z.enum(TABLAS_SINCRONIZADAS as [TablaSincronizada, ...TablaSincronizada[]]),
  operacion: z.enum(['guardar', 'eliminar']),
  id: z.uuid(),
  /** Versión del registro sobre la que se hizo el cambio (null = registro nuevo). */
  versionBase: z.number().int().min(1).nullable(),
  /** Registro completo (sólo al guardar). Se valida en el servidor con el esquema de su tabla. */
  datos: z.record(z.string(), z.unknown()).nullable(),
});
export type CambioLocal = z.infer<typeof esquemaCambio>;

export const esquemaEnvio = z.object({ cambios: z.array(esquemaCambio).min(1).max(MAX_CAMBIOS_POR_ENVIO) });

export const ESTADOS_RESULTADO = ['aplicado', 'repetido', 'conflicto', 'rechazado'] as const;
export type EstadoResultado = (typeof ESTADOS_RESULTADO)[number];

export interface ResultadoCambio {
  opId: string;
  estado: EstadoResultado;
  /** Explicación en español (conflictos y rechazos). */
  mensaje: string | null;
  /** Versión del servidor del registro, para resolver un conflicto (null si no existe o no se puede ver). */
  servidor: Record<string, unknown> | null;
}

export interface RespuestaEnvio { resultados: ResultadoCambio[] }

export interface CambioRemoto {
  tabla: TablaSincronizada;
  id: string;
  /** null = el registro ya no existe o la persona ya no puede verlo: se quita del dispositivo. */
  registro: Record<string, unknown> | null;
}

export interface RespuestaRecepcion {
  /** Con `desde = 0` el servidor manda la fotografía completa de lo que la persona puede ver. */
  completa: boolean;
  cambios: CambioRemoto[];
  /** Número de secuencia hasta el que ya se entregó todo. */
  hasta: number;
  /** Hay más cambios: volver a pedir desde `hasta`. */
  mas: boolean;
}
