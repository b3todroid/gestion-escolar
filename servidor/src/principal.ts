/**
 * Arranque del servidor: valida la configuración, aplica migraciones pendientes y escucha.
 * Uso local: npm run servidor (lee servidor/.env; ver servidor/.env.ejemplo).
 */
import pg from 'pg';
import { crearAuth } from './auth.ts';
import { leerConfiguracion } from './config.ts';
import { BuzonDesarrollo } from './correo.ts';
import { crearServidorHttp } from './http.ts';
import { migrar } from './migrar.ts';

const cfg = leerConfiguracion();
const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
const { aplicadas } = await migrar(bd);
if (aplicadas.length) console.info(`Migraciones aplicadas: ${aplicadas.join(', ')}`);
const correo = new BuzonDesarrollo();
const auth = crearAuth(cfg, bd, correo);
const { servidor, cerrar } = crearServidorHttp(cfg, bd, auth, correo, (m) => console.warn(m));
servidor.listen(cfg.PUERTO, '127.0.0.1', () => {
  console.info(`Servidor escolar (${cfg.MODO}) en http://127.0.0.1:${cfg.PUERTO} · correo: ${cfg.CORREO_MODO}`);
});
const terminar = async () => { await cerrar(); await bd.end(); process.exit(0); };
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
