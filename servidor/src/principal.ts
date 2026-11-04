/**
 * Arranque del servidor: valida la configuración, aplica migraciones pendientes y escucha.
 * Uso local: npm run servidor (lee servidor/.env; ver servidor/.env.ejemplo).
 */
import pg from 'pg';
import { crearAuth } from './auth.ts';
import { leerConfiguracion } from './config.ts';
import { BuzonDesarrollo, CorreoSmtp } from './correo.ts';
import { crearServidorHttp } from './http.ts';
import { migrar } from './migrar.ts';

const cfg = leerConfiguracion();
const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
const { aplicadas } = await migrar(bd);
if (aplicadas.length) console.info(`Migraciones aplicadas: ${aplicadas.join(', ')}`);
const correo = cfg.CORREO_MODO === 'smtp' ? new CorreoSmtp(cfg) : new BuzonDesarrollo();
if (correo instanceof CorreoSmtp) {
  // Se avisa si el correo no responde, pero no se impide arrancar (la API sigue sirviendo a quien ya tiene sesión).
  correo.verificar().then(() => console.info('Correo SMTP: conexión verificada.')).catch((e: { code?: string }) => console.warn(`Correo SMTP: no se pudo verificar la conexión (${e.code ?? 'error'}).`));
}
const auth = crearAuth(cfg, bd, correo);
const { servidor, cerrar } = crearServidorHttp(cfg, bd, auth, correo, (m) => console.warn(m));
servidor.listen(cfg.PUERTO, cfg.HOST, () => {
  console.info(`Servidor escolar (${cfg.MODO}) en http://${cfg.HOST}:${cfg.PUERTO} · correo: ${cfg.CORREO_MODO}`);
});
const terminar = async () => { await cerrar(); await bd.end(); process.exit(0); };
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
