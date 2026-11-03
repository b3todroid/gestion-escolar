/**
 * Servidor para las pruebas funcionales con navegador (playwright.servidor.config.ts).
 * Crea una base PostgreSQL NUEVA, la llena con UNA escuela ficticia y su administrador
 * invitado, y la BORRA al terminar. Nunca usa datos reales.
 */
import { crearEntorno, escuelaFicticia, URL_APP } from '../pruebas/entorno.ts';

const puerto = Number(process.env.PUERTO_PRUEBAS ?? 8788);
const origen = process.env.URL_PUBLICA_PRUEBAS ?? URL_APP;
const e = await crearEntorno({ URL_PUBLICA: origen }, puerto);
const { escuelaId } = await escuelaFicticia(e, 'admin.e2e@ejemplo.test');
console.info(`Servidor de pruebas listo en ${e.base} · escuela ficticia ${escuelaId}`);
let cerrando = false;
const terminar = async () => { if (cerrando) return; cerrando = true; await e.cerrar(); process.exit(0); };
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
