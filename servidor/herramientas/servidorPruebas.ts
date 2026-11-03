/**
 * Servidor para las pruebas funcionales con navegador (playwright.servidor.config.ts).
 * Crea una base PostgreSQL NUEVA con UNA escuela ficticia completa (semilla), su
 * administrador invitado y una docente activa vinculada a su ficha, y la BORRA al terminar.
 * Los identificadores de la semilla se escriben en test-results/ para las pruebas. Nunca datos reales.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crearEntorno, escuelaFicticia, URL_APP } from '../pruebas/entorno.ts';
import { sembrar } from '../pruebas/semilla.ts';

const puerto = Number(process.env.PUERTO_PRUEBAS ?? 8788);
const origen = process.env.URL_PUBLICA_PRUEBAS ?? URL_APP;
const e = await crearEntorno({ URL_PUBLICA: origen }, puerto);
const { escuelaId } = await escuelaFicticia(e, 'admin.e2e@ejemplo.test');
const semilla = await sembrar(e.bd, escuelaId);
const docenteId = randomUUID();
await e.bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, 'Docente Uno Ficticio', 'docente.uno.e2e@ejemplo.test', true, false, now(), now())`, [docenteId]);
await e.bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en, aceptada_en)
  VALUES ($1, $2, 'docente', 'activa', $3, 'institucional', now() + interval '1 day', now())`, [docenteId, escuelaId, semilla.d1]);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/semilla-e2e.json', JSON.stringify(semilla));
console.info(`Servidor de pruebas listo en ${e.base} · escuela ficticia ${escuelaId}`);
let cerrando = false;
const terminar = async () => { if (cerrando) return; cerrando = true; await e.cerrar(); process.exit(0); };
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
