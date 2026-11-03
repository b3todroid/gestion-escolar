/**
 * Migración de una escuela del dispositivo al servidor (Fase 8E), compartido por la app y el servidor.
 * El paquete lleva los registros de la escuela (con el identificador de la escuela del servidor),
 * sus conteos por tabla y una HUELLA canónica: el servidor la recalcula al recibir y otra vez
 * leyendo lo que quedó guardado. Si cualquiera difiere, no se guarda nada.
 */
import { z } from 'zod';
import { ESQUEMAS_TABLA, TABLAS_RESPALDO, type TablaRespaldo } from './respaldo';

export type DatosEscuela = Record<TablaRespaldo, Record<string, unknown>[]>;

/** JSON con claves ordenadas (la misma representación en el navegador y en el servidor). */
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])]));
  return v;
}

/** Normaliza con el esquema de cada tabla (completa valores por omisión) y ordena por id. */
export function normalizarDatos(datos: Partial<Record<string, unknown[]>>): { datos: DatosEscuela; errores: string[] } {
  const salida = {} as DatosEscuela;
  const errores: string[] = [];
  for (const t of TABLAS_RESPALDO) {
    const lista: Record<string, unknown>[] = [];
    for (const [i, r] of (datos[t] ?? []).entries()) {
      const v = ESQUEMAS_TABLA[t].safeParse(r);
      if (v.success) lista.push(v.data as Record<string, unknown>);
      else if (errores.length < 20) errores.push(`${t}, registro ${i + 1}: dato inválido en «${v.error.issues[0]?.path.join('.') || 'registro'}».`);
    }
    salida[t] = lista.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return { datos: salida, errores };
}

export function conteosDe(datos: DatosEscuela): Record<TablaRespaldo, number> {
  return Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, datos[t].length])) as Record<TablaRespaldo, number>;
}

/** SHA-256 de la representación canónica de los datos normalizados. */
export async function huellaDatos(datos: DatosEscuela): Promise<string> {
  const texto = JSON.stringify(TABLAS_RESPALDO.map((t) => [t, datos[t].map(canonico)]));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const esquemaPaqueteMigracion = z.object({
  /** Identificador de la escuela en el dispositivo de origen (sólo informativo). */
  origenEscuelaId: z.uuid(),
  datos: z.record(z.string(), z.array(z.unknown())),
  conteos: z.record(z.string(), z.number().int().min(0)),
  huella: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PaqueteMigracion = z.infer<typeof esquemaPaqueteMigracion>;

export const esquemaAutorizacionMigracion = z.object({
  autorizadoPor: z.string().trim().min(3, 'Escribe el nombre de quien autoriza.').max(120),
  cargo: z.string().trim().min(3, 'Escribe el cargo de quien autoriza.').max(120),
  avisoPrivacidad: z.literal(true, 'Confirma que el aviso de privacidad de la escuela ya está publicado.'),
  /** La persona escribe la CCT de la escuela para confirmar (evita migrar la escuela equivocada). */
  confirmacionCct: z.string().trim().toUpperCase(),
});
export type AutorizacionMigracion = z.input<typeof esquemaAutorizacionMigracion>;

export interface InformeEnsayo {
  /** true si la migración se puede aplicar tal cual. */
  valido: boolean;
  errores: string[];
  advertencias: string[];
  conteos: Record<string, number>;
  /** Huella calculada por el servidor sobre lo que guardaría. */
  huella: string;
  /** Personas con el mismo nombre (nunca se fusionan: sólo se avisan para revisarlas). */
  posiblesDuplicados: { tabla: 'alumnos' | 'personal'; nombre: string; registros: number }[];
}

export interface ResultadoMigracion extends InformeEnsayo { migracionId: string }

export interface MigracionRegistrada {
  id: string; estado: 'aplicada' | 'revertida'; aplicadaEn: string; autorizadoPor: string; cargo: string; quien: string | null;
  conteos: Record<string, number>; huella: string; revertidaEn: string | null; motivoReversion: string | null;
  /** Cambios hechos en el servidor después de la migración (si hay, no se puede revertir sin perderlos). */
  cambiosPosteriores: number;
}
