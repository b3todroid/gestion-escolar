/**
 * Fase 8E — migración de una escuela del dispositivo al servidor, con la app real en un
 * dispositivo simulado (IndexedDB) y el servidor real. Sólo datos FICTICIOS.
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BaseDatosEscolar } from '../../src/database/db';
import { ErrorServidor, type ClienteServidor } from '../../src/remoto/servidorEscolar';
import { crearRepositoriosDexie, crearUnidadDeTrabajoDexie } from '../../src/repositories/dexie';
import { crearServicios, type Servicios } from '../../src/services';
import { TABLAS_RESPALDO } from '../../src/validators/respaldo';
import type { PreparacionMigracion } from '../../src/services/migracion';
import { activarSegundoFactor, crearEntorno, entrarConCodigo, escuelaFicticia, type Entorno, type Navegador } from './entorno.ts';
import { sembrarLocal, type Semilla } from './semilla.ts';

class ClientePrueba implements ClienteServidor {
  readonly nav: Navegador;
  constructor(nav: Navegador) { this.nav = nav; }
  async pedir<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await this.nav.pedir(metodo, ruta, cuerpo);
    if (r.estado >= 200 && r.estado < 300) return r.cuerpo as T;
    throw new ErrorServidor(r.estado, r.cuerpo?.codigo ?? r.cuerpo?.code ?? `HTTP_${r.estado}`, r.cuerpo?.mensaje ?? r.cuerpo?.message ?? 'Error');
  }
}

let e: Entorno;
let s: Servicios; let db: BaseDatosEscolar; let cliente: ClientePrueba;
let servidorId: string; let cct: string; let adminId: string;
let localId: string; let local: Semilla;

const contar = async (escuelaId: string) => {
  const n: Record<string, number> = {};
  for (const t of TABLAS_RESPALDO) {
    const tabla = t.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
    n[t] = (await e.bd.query(`SELECT count(*)::int AS n FROM escolar.${tabla} WHERE ${t === 'escuelas' ? 'id' : 'escuela_id'} = $1`, [escuelaId])).rows[0].n;
  }
  return n;
};
const autorizacion = () => ({ autorizadoPor: 'Persona Directora Ficticia', cargo: 'Dirección (ficticia)', avisoPrivacidad: true as const, confirmacionCct: cct });

beforeAll(async () => {
  e = await crearEntorno();
  const alta = await escuelaFicticia(e, 'admin-migra@ejemplo.test');
  servidorId = alta.escuelaId; adminId = alta.usuarioId;
  cct = (await e.bd.query('SELECT cct FROM escolar.escuelas WHERE id = $1', [servidorId])).rows[0].cct;
  const nav = e.navegador();
  expect((await entrarConCodigo(e, nav, 'admin-migra@ejemplo.test')).estado).toBe(200);
  await activarSegundoFactor(nav);
  cliente = new ClientePrueba(nav);
  db = new BaseDatosEscolar(`dispositivo-migracion-${randomUUID()}`);
  s = crearServicios(db, () => new Date().toISOString(), cliente);
  localId = randomUUID();
  local = await sembrarLocal(crearRepositoriosDexie(db), crearUnidadDeTrabajoDexie(db), { id: localId, cct, nombre: 'Escuela Secundaria Ficticia Local' });
  // Un ciclo anterior YA CERRADO también se migra (historial), y una persona con nombre repetido se avisa.
  const repos = crearRepositoriosDexie(db);
  const ahora = new Date().toISOString();
  await crearUnidadDeTrabajoDexie(db).ejecutar(async () => {
    const anterior = { id: randomUUID(), creadoEn: ahora, actualizadoEn: ahora, version: 1, escuelaId: localId, nombre: '2025-2026', fechaInicio: '2025-08-25', fechaFin: '2026-07-15', estado: 'cerrado' as const };
    await repos.ciclos.insertar(anterior);
    await repos.turnos.insertar({ id: randomUUID(), creadoEn: ahora, actualizadoEn: ahora, version: 1, escuelaId: localId, cicloEscolarId: anterior.id, nombre: 'Matutino' });
    await repos.alumnos.insertar({ id: randomUUID(), creadoEn: ahora, actualizadoEn: ahora, version: 1, escuelaId: localId, nombre: 'Alumna', primerApellido: 'Ficticia', segundoApellido: 'Uno', matricula: null, curp: null, observaciones: null });
  });
}, 120_000);
afterAll(async () => { db?.close(); await e?.cerrar(); });

describe('Preparación y ensayo', () => {
  let prep: PreparacionMigracion;

  test('no se prepara con una escuela del servidor de otra CCT', async () => {
    await expect(s.migracion.preparar(localId, servidorId, '32ZZZ9999Z')).rejects.toThrow(/no se mezclan escuelas/);
  });

  test('el paquete lleva todas las tablas con el identificador de la escuela del servidor', async () => {
    prep = await s.migracion.preparar(localId, servidorId, cct);
    expect(prep.paquete.conteos.escuelas).toBe(1);
    for (const t of TABLAS_RESPALDO) expect(prep.paquete.conteos[t], t).toBeGreaterThan(0);
    expect(prep.paquete.datos.escuelas![0]).toMatchObject({ id: servidorId, cct });
    expect(prep.paquete.datos.alumnos!.every((a) => (a as { escuelaId: string }).escuelaId === servidorId)).toBe(true);
  });

  test('el ensayo valida todo y NO escribe nada', async () => {
    const antes = await contar(servidorId);
    const r = await s.migracion.ensayo(servidorId, prep.paquete);
    expect(r.errores).toEqual([]);
    expect(r.valido).toBe(true);
    expect(s.migracion.coincide(prep.paquete, r)).toBe(true);
    expect(r.posiblesDuplicados).toEqual([expect.objectContaining({ tabla: 'alumnos', registros: 2 })]);
    expect(await contar(servidorId)).toEqual(antes);
    const { rows } = await e.bd.query(`SELECT accion FROM acceso.auditoria WHERE escuela_id = $1 AND accion = 'migracion_ensayo'`, [servidorId]);
    expect(rows).toHaveLength(1);
  });

  test('un paquete alterado en el camino se rechaza (huella)', async () => {
    const alterado = structuredClone(prep.paquete);
    (alterado.datos.alumnos![0] as { nombre: string }).nombre = 'Otro nombre';
    const r = await s.migracion.ensayo(servidorId, alterado);
    expect(r.valido).toBe(false);
    expect(r.errores.join(' ')).toMatch(/huella/);
  });

  test('sólo el administrador de la escuela, con verificación en dos pasos, puede migrar', async () => {
    const id = randomUUID(); const correo = 'directora-migra@ejemplo.test';
    await e.bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, 'Directora', $2, true, false, now(), now())`, [id, correo]);
    await e.bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, tipo_correo, expira_en, aceptada_en) VALUES ($1, $2, 'direccion', 'activa', 'institucional', now() + interval '1 day', now())`, [id, servidorId]);
    const nav = e.navegador();
    await entrarConCodigo(e, nav, correo);
    await activarSegundoFactor(nav);
    const r = await nav.post(`/api/escuelas/${servidorId}/migracion/ensayo`, { paquete: prep.paquete });
    expect(r.estado).toBe(403);
  });

  test('sin autorización correcta no se migra (CCT escrita distinta, aviso de privacidad sin confirmar)', async () => {
    const r1 = await s.migracion.migrar(servidorId, prep.paquete, { ...autorizacion(), confirmacionCct: '32ZZZ0000A' });
    expect(r1.valido).toBe(false);
    expect(r1.errores.join(' ')).toMatch(/CCT escrita/);
    await expect(s.migracion.migrar(servidorId, prep.paquete, { ...autorizacion(), avisoPrivacidad: false as unknown as true })).rejects.toThrow(/aviso de privacidad/);
    expect((await contar(servidorId)).alumnos).toBe(0);
  });
});

describe('Migración, validación, reversión y cambio de dispositivo', () => {
  test('migrar → validar → revertir deja el servidor como estaba; se puede volver a migrar', async () => {
    const prep = await s.migracion.preparar(localId, servidorId, cct);
    const r = await s.migracion.migrar(servidorId, prep.paquete, autorizacion());
    expect(r.errores).toEqual([]);
    expect(s.migracion.coincide(prep.paquete, r)).toBe(true);
    expect(await contar(servidorId)).toEqual(prep.paquete.conteos);
    const otra = await s.migracion.migrar(servidorId, prep.paquete, autorizacion());
    expect(otra.errores.join(' ')).toMatch(/ya se migró/);
    const [m] = await s.migracion.historial(servidorId);
    expect(m).toMatchObject({ estado: 'aplicada', autorizadoPor: 'Persona Directora Ficticia', cambiosPosteriores: 0 });
    // Una ficha vinculada a una cuenta se desvincula al revertir (la cuenta se conserva).
    await e.bd.query('UPDATE acceso.membresias SET personal_id = $1 WHERE usuario_id = $2', [local.d1, adminId]);
    const rev = await s.migracion.revertir(servidorId, m!.id, 'Ensayo institucional ficticio');
    expect(rev.registros).toBe(Object.values(prep.paquete.conteos).reduce((a, b) => a + b, 0) - 1);
    const despues = await contar(servidorId);
    expect(Object.entries(despues).filter(([t, n]) => t !== 'escuelas' && n > 0)).toEqual([]);
    const esc = (await e.bd.query('SELECT nombre, domicilio FROM escolar.escuelas WHERE id = $1', [servidorId])).rows[0];
    expect(esc.domicilio).toBeNull(); // volvió a los datos que tenía el servidor
    expect((await e.bd.query('SELECT personal_id FROM acceso.membresias WHERE usuario_id = $1', [adminId])).rows[0].personal_id).toBeNull();
    expect((await s.migracion.historial(servidorId))[0]).toMatchObject({ estado: 'revertida', motivoReversion: 'Ensayo institucional ficticio' });
  });

  test('migración definitiva y el dispositivo pasa a la versión sincronizada con los mismos registros', async () => {
    const idsLocales: Record<string, string[]> = {};
    const prep = await s.migracion.preparar(localId, servidorId, cct);
    for (const t of TABLAS_RESPALDO) idsLocales[t] = (prep.paquete.datos[t] as { id: string }[]).map((x) => x.id).sort();
    const r = await s.migracion.migrar(servidorId, prep.paquete, autorizacion());
    expect(s.migracion.coincide(prep.paquete, r)).toBe(true);
    const u = await s.migracion.usarVersionServidor(localId, servidorId, adminId);
    expect(await db.escuelas.get(localId)).toBeUndefined();
    expect(await s.sincronizacion.estaVinculada(servidorId)).toBe(true);
    // El administrador no ve todo (p. ej. CURP), pero los registros que ve son los mismos.
    expect(u.registros).toBeGreaterThan(0);
    expect((await db.alumnos.toArray()).map((a) => a.id).sort()).toEqual(idsLocales.alumnos);
    expect((await db.pases.toArray()).map((a) => a.id).sort()).toEqual(idsLocales.pases);
  });

  test('después de cambios en el servidor ya no se revierte automáticamente', async () => {
    await s.asistencia.crearReporte(local.al1, { tipo: 'otro', texto: 'Después de migrar (ficticio)' }, { personalId: null, sesionId: null, fecha: local.hoy, hora: null })
      .catch(() => undefined); // el administrador puede no tener permiso de escritura en reportes
    await e.bd.query(`UPDATE escolar.grupos SET nombre = 'Z' WHERE id = $1`, [local.g1]); // cambio posterior en el servidor
    const [m] = await s.migracion.historial(servidorId);
    expect(m!.cambiosPosteriores).toBeGreaterThan(0);
    await expect(s.migracion.revertir(servidorId, m!.id, 'Prueba')).rejects.toThrow(/revertirla los borraría/);
    expect((await contar(servidorId)).alumnos).toBeGreaterThan(0);
  });
});
