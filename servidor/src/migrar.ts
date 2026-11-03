/**
 * Migraciones versionadas del esquema del servidor (archivos `migraciones/NNNN_nombre.sql`).
 * - Cada archivo se aplica una sola vez, en orden, dentro de su propia transacción.
 * - Se guarda la huella SHA-256 de cada archivo: si un archivo ya aplicado cambia o
 *   desaparece, se DETIENE (una migración publicada nunca se modifica; se agrega otra).
 * - Un candado de PostgreSQL impide que dos procesos migren a la vez.
 * Nunca borra datos por su cuenta.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

export const DIRECTORIO_MIGRACIONES = new URL('../migraciones/', import.meta.url).pathname;
const CANDADO = 824_670_301; // identificador arbitrario y fijo del candado de migración

export interface Migracion { nombre: string; sql: string; huella: string }

export function leerMigraciones(directorio = DIRECTORIO_MIGRACIONES): Migracion[] {
  const archivos = readdirSync(directorio).filter((a) => /^\d{4}_[a-z0-9_]+\.sql$/.test(a)).sort();
  return archivos.map((nombre) => {
    const sql = readFileSync(join(directorio, nombre), 'utf8');
    return { nombre, sql, huella: createHash('sha256').update(sql).digest('hex') };
  });
}

export interface ResultadoMigracion { aplicadas: string[]; vigentes: number }

export async function migrar(bd: Pool, migraciones = leerMigraciones()): Promise<ResultadoMigracion> {
  const c = await bd.connect();
  try {
    await c.query('SELECT pg_advisory_lock($1)', [CANDADO]);
    await c.query('CREATE SCHEMA IF NOT EXISTS sistema');
    await c.query(`CREATE TABLE IF NOT EXISTS sistema.migraciones (
      nombre text PRIMARY KEY, huella text NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await c.query<{ nombre: string; huella: string }>('SELECT nombre, huella FROM sistema.migraciones ORDER BY nombre');
    const porNombre = new Map(migraciones.map((m) => [m.nombre, m]));
    for (const r of rows) {
      const m = porNombre.get(r.nombre);
      if (!m) throw new Error(`La migración ${r.nombre} ya está aplicada pero su archivo no existe. No se continúa.`);
      if (m.huella !== r.huella) throw new Error(`La migración ${r.nombre} cambió después de aplicarse. Las migraciones publicadas no se modifican: agrega una nueva.`);
    }
    const ya = new Set(rows.map((r) => r.nombre));
    const ultima = rows.at(-1)?.nombre;
    const aplicadas: string[] = [];
    for (const m of migraciones) {
      if (ya.has(m.nombre)) continue;
      if (ultima && m.nombre < ultima) throw new Error(`La migración ${m.nombre} es anterior a la última aplicada (${ultima}). Renómbrala con un número mayor.`);
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO sistema.migraciones (nombre, huella) VALUES ($1, $2)', [m.nombre, m.huella]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falló la migración ${m.nombre}; no se aplicó ningún cambio de ese archivo. ${(e as Error).message}`);
      }
      aplicadas.push(m.nombre);
    }
    return { aplicadas, vigentes: rows.length + aplicadas.length };
  } finally {
    await c.query('SELECT pg_advisory_unlock($1)', [CANDADO]).catch(() => {});
    c.release();
  }
}
