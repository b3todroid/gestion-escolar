/**
 * Carga de la escuela de DEMOSTRACIÓN del piloto (Fase 10) en un servidor PostgreSQL.
 * Mismo camino que la migración de la Fase 8E: una sola transacción, todo o nada, y la huella
 * releída de la base debe coincidir con la del archivo generado. Sólo acepta datos cuya escuela
 * esté marcada como demostración (sin CCT). Nunca datos reales.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { TABLAS_RESPALDO, type TablaRespaldo } from '../../src/validators/respaldo';
import { huellaDatos, normalizarDatos } from '../../src/validators/migracion';
import { aSnake, conCliente, consultar, crearRepositoriosPg, leerColumnas, type RepositorioPg } from '../src/repositoriosPg.ts';
import type { DatosPiloto } from '../../piloto/datos';

export const PATRON_BASE_PILOTO = /^gestion_piloto(_[a-z0-9]+)?$/;

export interface CuentaPiloto { correo: string; nombre: string; rol: 'administrador' | 'direccion' | 'prefectura' | 'docente'; personalId: string | null }

/** Inserta la escuela de demostración. Rechaza si la base ya tiene cualquier escuela. */
export async function cargarDemostracion(bd: Pool, piloto: DatosPiloto): Promise<{ registros: number; huella: string }> {
  const sobre = JSON.parse(piloto.contenido) as { datos: Record<string, unknown[]> };
  const { datos, errores } = normalizarDatos(sobre.datos);
  if (errores.length) throw new Error(`Datos del piloto inválidos: ${errores.slice(0, 3).join('; ')}`);
  const escuela = datos.escuelas[0] as { id: string; demostracion?: boolean; cct: string | null } | undefined;
  if (!escuela || datos.escuelas.length !== 1 || escuela.demostracion !== true || escuela.cct !== null) throw new Error('Sólo se carga UNA escuela marcada como demostración y sin CCT.');
  const { rows } = await bd.query<{ n: number }>('SELECT count(*)::int AS n FROM escolar.escuelas');
  if (rows[0]!.n > 0) throw new Error('La base ya tiene escuelas: el piloto se carga sólo en una base vacía dedicada (nunca se mezcla con datos existentes).');
  const huellaEsperada = await huellaDatos(datos);
  const columnas = await leerColumnas(bd);
  const c = await bd.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.migracion', 'si', true)`); // historial de días pasados (como la migración 8E)
    const repos = crearRepositoriosPg(columnas);
    const repo = (t: TablaRespaldo) => repos[t] as unknown as RepositorioPg<never>;
    await conCliente(c, async () => {
      for (const t of TABLAS_RESPALDO) for (const r of datos[t]) await repo(t).insertar(r as never);
    });
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    const guardado = {} as Record<string, unknown[]>;
    await conCliente(c, async () => {
      for (const t of TABLAS_RESPALDO) {
        const col = t === 'escuelas' ? 'id' : 'escuela_id';
        guardado[t] = (await consultar(c, `SELECT * FROM escolar.${aSnake(t)} WHERE ${col} = $1`, [escuela.id])).rows
          .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase()), v])));
      }
    });
    const releido = normalizarDatos(guardado);
    const huella = await huellaDatos(releido.datos);
    if (huella !== huellaEsperada) throw new Error('Lo guardado no coincide con lo generado (huella distinta). No se guardó nada.');
    await c.query('COMMIT');
    return { registros: TABLAS_RESPALDO.reduce((a, t) => a + datos[t].length, 0), huella };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Cuentas de prueba con permisos REALES del servidor (correos ficticios del dominio reservado ejemplo.test). */
export function cuentasPiloto(p: DatosPiloto, docente2: string): CuentaPiloto[] {
  return [
    { correo: 'administrador.piloto@ejemplo.test', nombre: 'Administración (DEMOSTRACIÓN)', rol: 'administrador', personalId: null },
    { correo: 'direccion.piloto@ejemplo.test', nombre: 'Dirección (DEMOSTRACIÓN)', rol: 'direccion', personalId: p.direccion.id },
    { correo: 'prefectura.piloto@ejemplo.test', nombre: 'Prefectura (DEMOSTRACIÓN)', rol: 'prefectura', personalId: p.prefectura.id },
    { correo: 'docente.uno.piloto@ejemplo.test', nombre: 'Docente Uno (DEMOSTRACIÓN)', rol: 'docente', personalId: p.docente.id },
    { correo: 'docente.dos.piloto@ejemplo.test', nombre: 'Docente Dos (DEMOSTRACIÓN)', rol: 'docente', personalId: docente2 },
  ];
}

/** Da de alta las cuentas. `activas`: sin invitación pendiente (pruebas automáticas); si no, invitadas 30 días. */
export async function crearCuentas(bd: Pool, escuelaId: string, cuentas: CuentaPiloto[], activas: boolean): Promise<void> {
  for (const c of cuentas) {
    const id = randomUUID();
    await bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, false, now(), now())`, [id, c.nombre, c.correo, activas]);
    await bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en, aceptada_en)
      VALUES ($1, $2, $3, $4, $5, 'institucional', now() + interval '30 days', $6)`, [id, escuelaId, c.rol, activas ? 'activa' : 'invitada', c.personalId, activas ? new Date() : null]);
  }
}
