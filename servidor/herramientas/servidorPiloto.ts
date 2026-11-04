/**
 * Servidor del PILOTO MULTIUSUARIO para las pruebas con navegador (playwright.piloto-servidor.config.ts).
 * Crea una base PostgreSQL NUEVA y temporal, carga ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001, datos
 * FICTICIOS) con la huella verificada, da de alta cuentas activas con permisos REALES y BORRA la
 * base al terminar. Los identificadores se escriben en test-results/piloto-servidor.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crearEntorno, escuelaFicticia } from '../pruebas/entorno.ts';
import { sembrar } from '../pruebas/semilla.ts';
import { generarPiloto } from '../../piloto/datos';
import { cargarDemostracion, crearCuentas, cuentasPiloto } from './cargaPiloto.ts';

const puerto = Number(process.env.PUERTO_PRUEBAS ?? 8789);
const origen = process.env.URL_PUBLICA_PRUEBAS ?? 'http://localhost:4181';
const e = await crearEntorno({ URL_PUBLICA: origen }, puerto);
const p = generarPiloto({ escala: 0.1, semanas: 1, hoy: '2026-11-02' });
const carga = await cargarDemostracion(e.bd, p);
const cuentas = cuentasPiloto(p, p.docenteAusente.id);
await crearCuentas(e.bd, p.escuelaId, cuentas, true);
// Una SEGUNDA escuela (otra, ficticia y con su CCT de prueba) para comprobar la separación entre escuelas.
const otra = await escuelaFicticia(e, 'admin.otra.piloto@ejemplo.test');
await sembrar(e.bd, otra.escuelaId);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/piloto-servidor.json', JSON.stringify({
  escuelaId: p.escuelaId, cicloId: p.cicloId, hoy: p.hoy, registros: carga.registros, huella: carga.huella,
  docente: p.docente, docenteAusente: p.docenteAusente, prefectura: p.prefectura, grupos: p.grupos, turnos: p.turnos,
  cuentas: cuentas.map((c) => ({ correo: c.correo, rol: c.rol })), otraEscuelaId: otra.escuelaId,
}));
console.info(`Servidor del piloto listo en ${e.base} · DEMO-001 con ${carga.registros} registros ficticios`);
let cerrando = false;
const terminar = async () => { if (cerrando) return; cerrando = true; await e.cerrar(); process.exit(0); };
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
