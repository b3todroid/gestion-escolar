/**
 * Fase 8D — sincronización de punta a punta con DISPOSITIVOS SIMULADOS: cada uno con su propia
 * base IndexedDB (fake-indexeddb), su sesión real y la MISMA aplicación (servicios + cola).
 * Se trabaja sin conexión, se sincroniza y se comprueba que nada se pierde, nada se duplica
 * y nada se sobrescribe en silencio. Sólo datos ficticios.
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BaseDatosEscolar } from '../../src/database/db';
import { ErrorServidor, type ClienteServidor } from '../../src/remoto/servidorEscolar';
import { crearServicios, type Servicios } from '../../src/services';
import type { Rol } from '../src/acceso.ts';
import { activarSegundoFactor, crearEntorno, entrarConCodigo, escuelaFicticia, type Entorno, type Navegador } from './entorno.ts';
import { sembrar, type Semilla } from './semilla.ts';

let e: Entorno;
let A: Semilla;

/** Cliente del servidor como el del navegador, con un interruptor de conexión. */
class ClientePrueba implements ClienteServidor {
  sinConexion = false;
  readonly nav: Navegador;
  constructor(nav: Navegador) { this.nav = nav; }
  async pedir<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
    if (this.sinConexion) throw new ErrorServidor(0, 'SIN_CONEXION', 'Sin conexión.');
    const r = await this.nav.pedir(metodo, ruta, cuerpo);
    if (r.estado >= 200 && r.estado < 300) return r.cuerpo as T;
    throw new ErrorServidor(r.estado, r.cuerpo?.codigo ?? r.cuerpo?.code ?? `HTTP_${r.estado}`, r.cuerpo?.mensaje ?? r.cuerpo?.message ?? 'Error');
  }
}

interface Dispositivo { s: Servicios; cliente: ClientePrueba; db: BaseDatosEscolar; usuarioId: string }

const usuarios = new Map<string, { id: string; correo: string; rol: Rol }>();
async function persona(rol: Rol, personalId: string | null, clave: string) {
  const id = randomUUID(); const correo = `${clave}@ejemplo.test`;
  await e.bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, false, now(), now())`, [id, `Persona ${clave}`, correo]);
  await e.bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en, aceptada_en)
    VALUES ($1, $2, $3, 'activa', $4, 'institucional', now() + interval '1 day', now())`, [id, A.escuelaId, rol, personalId]);
  usuarios.set(clave, { id, correo, rol });
}
async function dispositivo(clave: string): Promise<Dispositivo> {
  const u = usuarios.get(clave)!;
  const nav = e.navegador();
  expect((await entrarConCodigo(e, nav, u.correo)).estado).toBe(200);
  if (['administrador', 'direccion', 'subdireccion'].includes(u.rol)) {
    const { rows } = await e.bd.query(`SELECT count(*)::int AS n FROM "twoFactor" WHERE "userId" = $1`, [u.id]);
    if (rows[0].n === 0) await activarSegundoFactor(nav);
    else throw new Error('Este ayudante sólo activa el segundo factor la primera vez');
  }
  const cliente = new ClientePrueba(nav);
  const db = new BaseDatosEscolar(`dispositivo-${clave}-${randomUUID()}`);
  return { s: crearServicios(db, () => new Date().toISOString(), cliente), cliente, db, usuarioId: u.id };
}
const haceDias = (n: number) => { const d = new Date(`${A.hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

let docente: Dispositivo; let prefecto: Dispositivo; let direccion: Dispositivo; let subdireccion: Dispositivo;

beforeAll(async () => {
  e = await crearEntorno();
  A = await sembrar(e.bd, (await escuelaFicticia(e, 'admin-disp@ejemplo.test')).escuelaId);
  await persona('docente', A.d1, 'docente-uno');
  await persona('prefectura', A.pf, 'prefecto');
  await persona('direccion', null, 'directora');
  await persona('subdireccion', null, 'subdirector');
  docente = await dispositivo('docente-uno');
  prefecto = await dispositivo('prefecto');
  direccion = await dispositivo('directora');
  subdireccion = await dispositivo('subdirector');
  for (const d of [docente, prefecto, direccion, subdireccion]) await d.s.sincronizacion.unirse(A.escuelaId, d.usuarioId);
}, 120_000);
afterAll(async () => {
  for (const d of [docente, prefecto, direccion, subdireccion]) d?.db.close();
  await e?.cerrar();
});

describe('Unirse a la escuela del servidor', () => {
  test('el dispositivo descarga sólo lo que la persona puede ver (y sin columnas sensibles)', async () => {
    expect((await docente.db.escuelas.toArray()).map((x) => x.id)).toEqual([A.escuelaId]);
    expect((await docente.db.grupos.toArray()).map((g) => g.id)).toEqual([A.g1]);
    const alumnos = await docente.db.alumnos.toArray();
    expect(alumnos.map((a) => a.id)).toEqual([A.al1]);
    expect(alumnos[0]!.matricula).toBeNull();
    expect((await prefecto.db.grupos.toArray()).length).toBe(2);
    expect((await prefecto.db.alumnos.toArray())[0]!.matricula).not.toBeNull();
    expect(await docente.s.sincronizacion.estado(A.escuelaId)).toMatchObject({ vinculada: true, pendientes: 0, conflictos: 0, rechazados: 0 });
  });

  test('no se une dos veces ni mezcla con una escuela local existente', async () => {
    await expect(docente.s.sincronizacion.unirse(A.escuelaId, docente.usuarioId)).rejects.toThrow(/ya se sincroniza/);
  });
});

describe('Trabajo sin conexión', () => {
  test('el pase de lista se guarda sin conexión, queda en la cola y se envía al volver la conexión', async () => {
    docente.cliente.sinConexion = true;
    const r = await docente.s.asistencia.guardarLista(A.s1, A.hoy, { [A.al1]: 'F' }, {}, A.hoy, A.d1);
    expect(r.F).toBe(1);
    const antes = await docente.s.sincronizacion.estado(A.escuelaId);
    expect(antes.pendientes).toBeGreaterThanOrEqual(2); // pase + asistencia (misma transacción = mismo grupo)
    const sin = await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(sin.problema).toMatch(/Sin conexión/);
    expect((await docente.s.sincronizacion.estado(A.escuelaId)).pendientes).toBe(antes.pendientes); // nada se pierde
    docente.cliente.sinConexion = false;
    const con = await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(con.problema).toBeNull();
    expect(con.enviados).toBe(antes.pendientes);
    expect((await docente.s.sincronizacion.estado(A.escuelaId)).pendientes).toBe(0);
    const { rows } = await e.bd.query(`SELECT p.personal_id, a.marca FROM escolar.pases p JOIN escolar.asistencias a ON a.pase_id = p.id WHERE p.sesion_id = $1 AND p.fecha = $2`, [A.s1, A.hoy]);
    expect(rows).toEqual([{ personal_id: A.d1, marca: 'F' }]);
  });

  test('otro dispositivo recibe el cambio; las reglas de la app siguen en cada dispositivo', async () => {
    await prefecto.s.sincronizacion.sincronizar(A.escuelaId);
    const pases = (await prefecto.db.pases.toArray()).filter((p) => p.fecha === A.hoy);
    expect(pases).toHaveLength(1);
    // Con la falta ya sincronizada, la regla falta ⇄ salida también aplica en el dispositivo de Prefectura.
    await expect(prefecto.s.asistencia.registrarSalida(A.s1, A.hoy, A.al1, '07:20', A.hoy, A.pf)).rejects.toThrow(/tiene falta/);
  });

  test('un reporte de Prefectura llega al docente del grupo; una baja también se propaga', async () => {
    const rep = await prefecto.s.asistencia.crearReporte(A.al1, { tipo: 'reconocimiento', texto: 'Ayudó a un compañero (ficticio)' }, { personalId: A.pf, sesionId: null, fecha: A.hoy, hora: '09:00' });
    await prefecto.s.sincronizacion.sincronizar(A.escuelaId);
    await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(await docente.db.reportes.get(rep.id)).toBeTruthy();
    await prefecto.s.asistencia.eliminarReporte(rep.id);
    await prefecto.s.sincronizacion.sincronizar(A.escuelaId);
    await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(await docente.db.reportes.get(rep.id)).toBeUndefined();
  });
});

describe('Conflictos: nunca «el último gana»', () => {
  test('dos personas cambian el mismo grupo sin conexión: el segundo queda en CONFLICTO y decide reaplicar', async () => {
    direccion.cliente.sinConexion = true; subdireccion.cliente.sinConexion = true;
    await direccion.s.grados.actualizarGrupo(A.g2, { gradoId: A.gradoId, turnoId: A.turnoId, nombre: 'B', capacidad: 30 });
    await subdireccion.s.grados.actualizarGrupo(A.g2, { gradoId: A.gradoId, turnoId: A.turnoId, nombre: 'B', capacidad: 40 });
    direccion.cliente.sinConexion = false; subdireccion.cliente.sinConexion = false;
    expect((await direccion.s.sincronizacion.sincronizar(A.escuelaId)).enviados).toBe(1);
    const r = await subdireccion.s.sincronizacion.sincronizar(A.escuelaId);
    expect(r.conflictos).toBe(1);
    const [c] = await subdireccion.s.sincronizacion.porResolver(A.escuelaId);
    expect(c!.estado).toBe('conflicto');
    expect(c!.servidor).toMatchObject({ id: A.g2, capacidad: 30 });
    expect((await subdireccion.db.grupos.get(A.g2))!.capacidad).toBe(40); // su cambio no se pierde mientras decide
    // El servidor conserva lo de Dirección hasta que Subdirección decida.
    expect((await e.bd.query('SELECT capacidad FROM escolar.grupos WHERE id = $1', [A.g2])).rows[0].capacidad).toBe(30);
    await subdireccion.s.sincronizacion.reaplicarMiCambio(c!.opId);
    expect((await subdireccion.s.sincronizacion.sincronizar(A.escuelaId)).enviados).toBe(1);
    const s = (await e.bd.query('SELECT capacidad, version FROM escolar.grupos WHERE id = $1', [A.g2])).rows[0];
    expect(s.capacidad).toBe(40);
    expect(s.version).toBe(c!.servidor!.version as number + 1); // la versión nunca retrocede
    await direccion.s.sincronizacion.sincronizar(A.escuelaId);
    expect((await direccion.db.grupos.get(A.g2))!.capacidad).toBe(40);
  });

  test('dos dispositivos del mismo docente pasan la misma lista: la segunda es CONFLICTO y usa la del servidor', async () => {
    const otro = await (async () => {
      const nav = e.navegador();
      await entrarConCodigo(e, nav, usuarios.get('docente-uno')!.correo);
      const cliente = new ClientePrueba(nav);
      const db = new BaseDatosEscolar(`dispositivo-docente-2-${randomUUID()}`);
      const s = crearServicios(db, () => new Date().toISOString(), cliente);
      await s.sincronizacion.unirse(A.escuelaId, docente.usuarioId);
      return { s, db, cliente };
    })();
    const fecha = haceDias(14);
    docente.cliente.sinConexion = true; otro.cliente.sinConexion = true;
    await docente.s.asistencia.guardarLista(A.s1, fecha, { [A.al1]: 'R' }, { [A.al1]: '07:15' }, A.hoy, A.d1);
    await otro.s.asistencia.guardarLista(A.s1, fecha, {}, {}, A.hoy, A.d1);
    docente.cliente.sinConexion = false; otro.cliente.sinConexion = false;
    await docente.s.sincronizacion.sincronizar(A.escuelaId);
    const r = await otro.s.sincronizacion.sincronizar(A.escuelaId);
    expect(r.conflictos).toBeGreaterThanOrEqual(1);
    const [c] = await otro.s.sincronizacion.porResolver(A.escuelaId);
    expect(c!.mensaje).toMatch(/registro equivalente/);
    await expect(otro.s.sincronizacion.reaplicarMiCambio(c!.opId)).rejects.toThrow(/usa la versión del servidor/);
    await otro.s.sincronizacion.usarVersionServidor(c!.opId);
    await otro.s.sincronizacion.sincronizar(A.escuelaId);
    expect((await otro.s.sincronizacion.estado(A.escuelaId))).toMatchObject({ pendientes: 0, conflictos: 0, rechazados: 0 });
    const locales = (await otro.db.pases.toArray()).filter((p) => p.sesionId === A.s1 && p.fecha === fecha);
    const { rows } = await e.bd.query('SELECT id FROM escolar.pases WHERE sesion_id = $1 AND fecha = $2', [A.s1, fecha]);
    expect(rows).toHaveLength(1); // nunca se duplicó
    expect(locales.map((p) => p.id)).toEqual([rows[0].id]);
    const marca = (await otro.db.asistencias.toArray()).find((a) => a.paseId === rows[0].id);
    expect(marca?.marca).toBe('R');
    otro.db.close();
  });
});

describe('Permisos al sincronizar', () => {
  test('un cambio sin permiso queda RECHAZADO (visible, no se pierde) y la persona vuelve a la versión del servidor', async () => {
    await docente.s.personal.actualizar(A.d1, { nombre: 'Nombre Cambiado', primerApellido: 'Ficticio', funciones: ['docente'] });
    const r = await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(r.rechazados).toBe(1);
    const [c] = await docente.s.sincronizacion.porResolver(A.escuelaId);
    expect(c).toMatchObject({ estado: 'rechazado', tabla: 'personal' });
    expect(c!.mensaje).toMatch(/permiso/);
    expect((await e.bd.query('SELECT nombre FROM escolar.personal WHERE id = $1', [A.d1])).rows[0].nombre).toBe('Docente Uno');
    await docente.s.sincronizacion.usarVersionServidor(c!.opId);
    await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect((await docente.db.personal.get(A.d1))!.nombre).toBe('Docente Uno');
    expect((await docente.s.sincronizacion.estado(A.escuelaId)).rechazados).toBe(0);
  });

  test('reenviar un lote ya aplicado no lo repite (idempotencia)', async () => {
    const op = randomUUID(); const grupo = randomUUID();
    const nuevo = { ...(await prefecto.s.asistencia.crearReporte(A.al2, { tipo: 'otro', texto: 'Texto ficticio' }, { personalId: A.pf, sesionId: null, fecha: A.hoy, hora: null })) };
    await prefecto.db.pendientes.clear(); // simula una cola enviada por otra vía
    const cuerpo = { cambios: [{ opId: op, grupo, tabla: 'reportes', operacion: 'guardar', id: nuevo.id, versionBase: null, datos: nuevo }] };
    const a = await prefecto.cliente.pedir<{ resultados: { estado: string }[] }>('POST', `/api/escuelas/${A.escuelaId}/sincronizacion`, cuerpo);
    const b = await prefecto.cliente.pedir<{ resultados: { estado: string }[] }>('POST', `/api/escuelas/${A.escuelaId}/sincronizacion`, cuerpo);
    expect(a.resultados[0]!.estado).toBe('aplicado');
    expect(b.resultados[0]!.estado).toBe('repetido');
    expect((await e.bd.query('SELECT count(*)::int AS n FROM escolar.reportes WHERE id = $1', [nuevo.id])).rows[0].n).toBe(1);
  });

  test('un registro de otra escuela o con datos inválidos se rechaza', async () => {
    const malo = { ...(await prefecto.db.reportes.toArray())[0]!, texto: '' };
    const ajeno = { ...(await prefecto.db.reportes.toArray())[0]!, id: randomUUID(), escuelaId: randomUUID() };
    const r = await prefecto.cliente.pedir<{ resultados: { estado: string; mensaje: string }[] }>('POST', `/api/escuelas/${A.escuelaId}/sincronizacion`, { cambios: [
      { opId: randomUUID(), grupo: randomUUID(), tabla: 'reportes', operacion: 'guardar', id: malo.id, versionBase: malo.version, datos: { ...malo, texto: 'x'.repeat(400) } },
      { opId: randomUUID(), grupo: randomUUID(), tabla: 'reportes', operacion: 'guardar', id: ajeno.id, versionBase: null, datos: ajeno },
    ] });
    expect(r.resultados.map((x) => x.estado)).toEqual(['rechazado', 'rechazado']);
    expect(r.resultados[1]!.mensaje).toMatch(/no pertenece a esta escuela/);
  });

  test('una escuela sincronizada no se restaura desde un respaldo (evita mezclar versiones)', async () => {
    const { contenido } = await prefecto.s.respaldos.exportar([A.escuelaId], { contrasena: null });
    await expect(prefecto.s.respaldos.restaurar(contenido, [A.escuelaId])).rejects.toThrow(/se sincroniza con el servidor/);
  });

  test('si se revoca el acceso, la sincronización se detiene sin perder la cola; quitar la escuela es explícito', async () => {
    await docente.s.asistencia.crearReporte(A.al1, { tipo: 'otro', texto: 'Pendiente al revocar (ficticio)' }, { personalId: A.d1, sesionId: A.s1, fecha: A.hoy, hora: '07:30' });
    const pendientes = (await docente.s.sincronizacion.estado(A.escuelaId)).pendientes;
    await e.bd.query(`UPDATE acceso.membresias SET estado = 'revocada', revocada_en = now(), motivo_revocacion = 'Prueba ficticia' WHERE usuario_id = $1`, [docente.usuarioId]);
    await e.bd.query('DELETE FROM "session" WHERE "userId" = $1', [docente.usuarioId]);
    const r = await docente.s.sincronizacion.sincronizar(A.escuelaId);
    expect(r.problema).toMatch(/Inicia sesión/);
    expect((await docente.s.sincronizacion.estado(A.escuelaId)).pendientes).toBe(pendientes);
    await docente.s.sincronizacion.quitar(A.escuelaId);
    expect(await docente.db.alumnos.count()).toBe(0);
    expect(await docente.db.pendientes.count()).toBe(0);
    expect(await docente.s.sincronizacion.estaVinculada(A.escuelaId)).toBe(false);
  });
});
