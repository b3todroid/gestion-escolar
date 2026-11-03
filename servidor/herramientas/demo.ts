/**
 * Entorno de DEMOSTRACIÓN para el piloto (Fase 9): una escuela FICTICIA identificada como
 * «(DEMOSTRACIÓN)», con datos completos y cuentas REALES (con inicio de sesión y permisos del
 * servidor) para Administrador, Dirección, Prefectura y Docente. Nunca datos reales.
 *
 * Uso (base de datos VACÍA dedicada a la demostración; nunca borra nada):
 *   DATABASE_URL=postgres://…/gestion_demo npm run servidor:demo
 * Después: DATABASE_URL=… npm run servidor  y  npm run dev
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { leerConfiguracion } from '../src/config.ts';
import { migrar } from '../src/migrar.ts';
import { altaEscuela } from '../src/operador.ts';
import { sembrar } from '../pruebas/semilla.ts';

const CUENTAS = [
  { correo: 'administrador.demo@ejemplo.test', nombre: 'Administración (DEMOSTRACIÓN)', rol: 'administrador' },
  { correo: 'direccion.demo@ejemplo.test', nombre: 'Dirección (DEMOSTRACIÓN)', rol: 'direccion' },
  { correo: 'prefectura.demo@ejemplo.test', nombre: 'Prefectura (DEMOSTRACIÓN)', rol: 'prefectura', ficha: 'pf' },
  { correo: 'docente.demo@ejemplo.test', nombre: 'Docente Uno (DEMOSTRACIÓN)', rol: 'docente', ficha: 'd1' },
] as const;

const cfg = leerConfiguracion();
if (cfg.MODO === 'produccion') throw new Error('La demostración no se crea en producción.');
const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL });
try {
  await migrar(bd);
  const { rows } = await bd.query<{ n: number }>('SELECT count(*)::int AS n FROM escolar.escuelas');
  if (rows[0]!.n > 0) throw new Error('La base ya tiene escuelas. Usa una base VACÍA dedicada a la demostración (nunca se borra nada).');
  const alta = await altaEscuela(bd, cfg, {
    nombre: 'Escuela Secundaria Ficticia (DEMOSTRACIÓN)', cct: '32ZZZ0001D', nivel: 'secundaria', entidad: '32', municipio: 'Municipio Ejemplo',
    adminCorreo: CUENTAS[0].correo, adminNombre: CUENTAS[0].nombre, tipoCorreo: 'institucional', consentimiento: false,
  });
  const s = await sembrar(bd, alta.escuelaId);
  for (const c of CUENTAS.slice(1)) {
    const id = randomUUID();
    await bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, false, false, now(), now())`, [id, c.nombre, c.correo]);
    const ficha = 'ficha' in c ? (c.ficha === 'pf' ? s.pf : s.d1) : null;
    await bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en)
      VALUES ($1, $2, $3, 'invitada', $4, 'institucional', now() + interval '30 days')`, [id, alta.escuelaId, c.rol, ficha]);
  }
  console.info([
    'Demostración creada (datos FICTICIOS):',
    `  Escuela: Escuela Secundaria Ficticia (DEMOSTRACIÓN) · CCT 32ZZZ0001D · ${alta.escuelaId}`,
    ...CUENTAS.map((c) => `  ${c.rol.padEnd(14)} ${c.correo}`),
    'Los códigos de acceso se consultan en http://localhost:5173/api/desarrollo/buzon?correo=… (sólo en este equipo).',
    'Administrador y Dirección deben activar la verificación en dos pasos al entrar.',
  ].join('\n'));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await bd.end();
}
