/**
 * Comandos del OPERADOR del servidor (el administrador dueño de la cuenta, decisión D8).
 * No existen en la aplicación web: requieren acceso a la base de datos.
 *   migrar
 *   alta-escuela --nombre "…" --cct 32XXX0000X --nivel secundaria --entidad 32 --municipio "…"
 *                --admin-correo correo --admin-nombre "…" --tipo-correo institucional|personal [--consentimiento] [--id UUID]
 *   restablecer-segundo-factor --correo correo --motivo "…"
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { leerConfiguracion } from './config.ts';
import { altaEscuela, restablecerSegundoFactorOperador } from './operador.ts';
import { migrar } from './migrar.ts';

const [comando, ...resto] = process.argv.slice(2);
const cfg = leerConfiguracion();
const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL });
try {
  if (comando === 'migrar') {
    const r = await migrar(bd);
    console.info(r.aplicadas.length ? `Aplicadas: ${r.aplicadas.join(', ')}` : `Sin migraciones pendientes (${r.vigentes} vigentes).`);
  } else if (comando === 'alta-escuela') {
    const { values: v } = parseArgs({ args: resto, options: {
      nombre: { type: 'string' }, cct: { type: 'string' }, nivel: { type: 'string' }, entidad: { type: 'string' }, municipio: { type: 'string' },
      'admin-correo': { type: 'string' }, 'admin-nombre': { type: 'string' }, 'tipo-correo': { type: 'string' }, consentimiento: { type: 'boolean' }, id: { type: 'string' },
    } });
    const r = await altaEscuela(bd, cfg, {
      id: v.id, nombre: v.nombre, cct: v.cct, nivel: v.nivel, entidad: v.entidad, municipio: v.municipio,
      adminCorreo: v['admin-correo'], adminNombre: v['admin-nombre'], tipoCorreo: v['tipo-correo'], consentimiento: v.consentimiento ?? false,
    });
    console.info(`Escuela creada (${r.escuelaId}). Invitación de administrador vigente hasta ${r.expira}.`);
  } else if (comando === 'restablecer-segundo-factor') {
    const { values: v } = parseArgs({ args: resto, options: { correo: { type: 'string' }, motivo: { type: 'string' } } });
    const r = await restablecerSegundoFactorOperador(bd, { correo: v.correo, motivo: v.motivo });
    console.info(`Verificación en dos pasos restablecida; sesiones cerradas: ${r.sesionesCerradas}.`);
  } else {
    console.error('Comandos: migrar | alta-escuela | restablecer-segundo-factor');
    process.exitCode = 2;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await bd.end();
}
