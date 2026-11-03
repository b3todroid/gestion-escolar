/**
 * Genera el SQL de las tablas de Better Auth contra una base VACÍA, para revisarlo
 * y guardarlo como migración versionada (no se aplica nada automáticamente).
 * Uso: DATABASE_URL=... node servidor/herramientas/generarEsquemaAuth.ts
 */
import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { crearAuth } from '../src/auth.ts';
import { leerConfiguracion } from '../src/config.ts';
import { BuzonDesarrollo } from '../src/correo.ts';

const cfg = leerConfiguracion({ ...process.env, BETTER_AUTH_SECRET: 'x'.repeat(32), OIDC_PRUEBA_URL: undefined });
const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL });
const auth = crearAuth(cfg, bd, new BuzonDesarrollo());
const { compileMigrations } = await getMigrations(auth.options);
process.stdout.write(await compileMigrations());
await bd.end();
