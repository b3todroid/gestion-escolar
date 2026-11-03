/**
 * Fase 8C — comandos por HTTP con sesiones reales: los servicios de la aplicación
 * corren en el servidor con permisos por rol, RLS y datos que pone el servidor.
 * Sólo datos ficticios.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Rol } from '../src/acceso.ts';
import { activarSegundoFactor, crearEntorno, entrarConCodigo, escuelaFicticia, type Entorno, type Navegador } from './entorno.ts';
import { sembrar, type Semilla } from './semilla.ts';

let e: Entorno;
let A: Semilla; let B: Semilla;
const n = {} as Record<Rol | 'docenteSinFicha', Navegador>;
const ids = {} as Record<Rol | 'docenteSinFicha', string>;
const membresia = {} as Record<Rol, string>;

async function persona(escuelaId: string, rol: Rol, personalId: string | null, clave: string) {
  const id = randomUUID(); const correo = `${clave}@ejemplo.test`;
  await e.bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, false, now(), now())`, [id, `Persona ${clave}`, correo]);
  const { rows } = await e.bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en, aceptada_en)
    VALUES ($1, $2, $3, 'activa', $4, 'institucional', now() + interval '1 day', now()) RETURNING id`, [id, escuelaId, rol, personalId]);
  const nav = e.navegador();
  expect((await entrarConCodigo(e, nav, correo)).estado).toBe(200);
  if (['administrador', 'direccion', 'subdireccion'].includes(rol)) await activarSegundoFactor(nav);
  return { id, nav, membresiaId: rows[0].id as string };
}

const comando = (nav: Navegador, tipo: string, datos: unknown, opId: string = randomUUID(), escuelaId = A.escuelaId) =>
  nav.post(`/api/escuelas/${escuelaId}/comandos`, { opId, tipo, datos });

beforeAll(async () => {
  e = await crearEntorno();
  const a = await escuelaFicticia(e, 'admin-cmd-a@ejemplo.test');
  const b = await escuelaFicticia(e, 'admin-cmd-b@ejemplo.test');
  A = await sembrar(e.bd, a.escuelaId);
  B = await sembrar(e.bd, b.escuelaId);
  for (const rol of ['administrador', 'direccion', 'subdireccion', 'prefectura', 'docente', 'apoyo'] as Rol[]) {
    const p = await persona(A.escuelaId, rol, rol === 'docente' ? A.d1 : rol === 'prefectura' ? A.pf : null, `cmd-${rol}`);
    n[rol] = p.nav; ids[rol] = p.id; membresia[rol] = p.membresiaId;
  }
  const sf = await persona(A.escuelaId, 'docente', null, 'cmd-sin-ficha');
  n.docenteSinFicha = sf.nav; ids.docenteSinFicha = sf.id;
}, 120_000);
afterAll(async () => { await e?.cerrar(); });

describe('Docente', () => {
  test('pasa lista en SU clase; el servidor pone la fecha y su ficha; repetir el comando no duplica', async () => {
    const opId = randomUUID();
    const datos = { sesionId: A.s1, fecha: A.hoy, marcas: { [A.al1]: 'F' }, llegadas: {} };
    const r = await comando(n.docente, 'asistencia.guardarLista', datos, opId);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo.repetida).toBe(false);
    expect(r.cuerpo.resultado.F).toBe(1);
    expect(r.cuerpo.resultado.pase.personalId).toBe(A.d1);
    const otra = await comando(n.docente, 'asistencia.guardarLista', datos, opId);
    expect(otra.cuerpo).toEqual({ repetida: true, resultado: r.cuerpo.resultado });
    const { rows } = await e.bd.query('SELECT count(*)::int AS n FROM escolar.pases WHERE sesion_id = $1 AND fecha = $2', [A.s1, A.hoy]);
    expect(rows[0].n).toBe(1);
    const mismoId = await comando(n.docente, 'asistencia.registrarSalida', { sesionId: A.s1, fecha: A.hoy, alumnoId: A.al1 }, opId);
    expect(mismoId.cuerpo.codigo).toBe('OPERACION_DISTINTA');
  });

  test('las reglas de la app también rigen en el servidor (falta ⇄ salida)', async () => {
    const r = await comando(n.docente, 'asistencia.registrarSalida', { sesionId: A.s1, fecha: A.hoy, alumnoId: A.al1 });
    expect(r.estado).toBe(409);
    expect(r.cuerpo.mensaje).toMatch(/tiene falta en esta clase/);
  });

  test('no registra en la clase de otro docente, ni en otra escuela, ni con fecha futura', async () => {
    // Clase de otro docente en un grupo que no es suyo: ni siquiera la ve.
    const invisible = await comando(n.docente, 'asistencia.guardarLista', { sesionId: A.s2, fecha: A.hoy, marcas: {}, llegadas: {} });
    expect(invisible.estado).toBe(404);
    // Clase de otro docente en SU grupo: la ve, pero no puede pasar lista en ella.
    const s3 = randomUUID();
    await e.bd.query(`INSERT INTO escolar.sesiones SELECT * FROM jsonb_populate_record(NULL::escolar.sesiones,
      (SELECT to_jsonb(s) || jsonb_build_object('id', $1::text, 'personal_id', $2::text, 'periodo_id', $3::text) FROM escolar.sesiones s WHERE id = $4))`, [s3, A.d2, A.periodo2, A.s1]);
    const ajena = await comando(n.docente, 'asistencia.guardarLista', { sesionId: s3, fecha: A.hoy, marcas: {}, llegadas: {} });
    expect(ajena.estado).toBe(403);
    expect(ajena.cuerpo.mensaje).toMatch(/tus propias clases/);
    const otraEscuela = await comando(n.docente, 'asistencia.guardarLista', { sesionId: B.s1, fecha: B.hoy, marcas: {}, llegadas: {} });
    expect(otraEscuela.estado).toBe(404);
    const rutaAjena = await comando(n.docente, 'asistencia.guardarLista', { sesionId: B.s1, fecha: B.hoy, marcas: {}, llegadas: {} }, randomUUID(), B.escuelaId);
    expect(rutaAjena.cuerpo.codigo).toBe('SIN_PERMISO');
    const manana = new Date(`${A.hoy}T12:00:00Z`); manana.setUTCDate(manana.getUTCDate() + 7);
    const futura = await comando(n.docente, 'asistencia.guardarLista', { sesionId: A.s1, fecha: manana.toISOString().slice(0, 10), marcas: {}, llegadas: {} });
    expect(futura.cuerpo.mensaje).toMatch(/fecha futura/);
  });

  test('sin ficha de personal vinculada, el docente no puede registrar', async () => {
    const r = await comando(n.docenteSinFicha, 'asistencia.guardarLista', { sesionId: A.s1, fecha: A.hoy, marcas: {}, llegadas: {} });
    expect(r.estado).toBe(403);
    expect(r.cuerpo.mensaje).toMatch(/no está vinculado con tu ficha/);
  });

  test('no valida incidencias ni actividades; sí propone actividades', async () => {
    expect((await comando(n.docente, 'prefectura.validarIncidencia', { id: A.incidencia1, estado: 'confirmada' })).estado).toBe(403);
    const prop = await comando(n.docente, 'prefectura.crearActividad', { cicloId: A.cicloId, entrada: { titulo: 'Lectura ficticia', descripcion: 'Actividad de lectura ficticia', fecha: A.hoy } });
    expect(prop.estado).toBe(200);
    expect(prop.cuerpo.resultado.estado).toBe('propuesta');
    expect((await comando(n.docente, 'prefectura.cambiarEstadoActividad', { id: prop.cuerpo.resultado.id, estado: 'validada' })).estado).toBe(403);
  });

  test('lee sólo a los alumnos de sus grupos y sin matrícula', async () => {
    const r = await n.docente.get(`/api/escuelas/${A.escuelaId}/tablas/alumnos`);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.map((x: { id: string }) => x.id)).toEqual([A.al1]);
    expect(r.cuerpo[0].matricula).toBeNull();
    expect(r.cuerpo[0].nombre).toBe('Alumna');
  });
});

describe('Prefectura, Administración y delegación (D5)', () => {
  test('Prefectura reporta (queda REPORTADA con su ficha) pero no confirma', async () => {
    const r = await comando(n.prefectura, 'prefectura.registrarIncidencia', { cicloId: A.cicloId, entrada: { personalId: A.d2, fecha: A.hoy, tipo: 'falta', alcance: 'jornada' } });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo.resultado).toMatchObject({ estado: 'reportada', registradaPor: A.pf });
    expect((await comando(n.prefectura, 'prefectura.validarIncidencia', { id: r.cuerpo.resultado.id, estado: 'confirmada' })).estado).toBe(403);
  });

  test('Dirección confirma sólo si el administrador se lo delega', async () => {
    const sin = await comando(n.direccion, 'prefectura.validarIncidencia', { id: A.incidencia1, estado: 'confirmada' });
    expect(sin.estado).toBe(403);
    expect(sin.cuerpo.mensaje).toMatch(/a quien se lo delegó/);
    const del = await n.administrador.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.direccion}/delegaciones`, { permisos: ['confirmar_incidencias'] });
    expect(del.cuerpo).toEqual({ permisos: ['confirmar_incidencias'] });
    expect((await n.direccion.get('/api/yo')).cuerpo.membresias[0].permisosDelegados).toEqual(['confirmar_incidencias']);
    const con = await comando(n.direccion, 'prefectura.validarIncidencia', { id: A.incidencia1, estado: 'confirmada' });
    expect(con.estado, JSON.stringify(con.cuerpo)).toBe(200);
    expect(con.cuerpo.resultado.estado).toBe('confirmada');
    const docente = await n.administrador.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.docente}/delegaciones`, { permisos: ['confirmar_incidencias'] });
    expect(docente.cuerpo.codigo).toBe('ROL_NO_DELEGABLE');
    expect((await n.direccion.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.subdireccion}/delegaciones`, { permisos: ['autorizar_coberturas'] })).estado).toBe(403);
  });

  test('el administrador autoriza la cobertura; «autorizó» lo pone el servidor, no el cliente', async () => {
    const r = await comando(n.administrador, 'prefectura.asignar', { sesionId: A.s2, fecha: A.hoy, personalId: A.pf, autorizadoPor: 'Texto falso del cliente' });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo.resultado.estado).toBe('asignada');
    expect(r.cuerpo.resultado.autorizadoPor).toBe('Persona cmd-administrador (Administrador de la escuela)');
    expect((await comando(n.prefectura, 'prefectura.asignar', { sesionId: A.s2, fecha: A.hoy, personalId: A.pf })).estado).toBe(403);
  });

  test('Subdirección valida actividades; Dirección no confirma horarios sin ser Dirección', async () => {
    const v = await comando(n.subdireccion, 'prefectura.cambiarEstadoActividad', { id: A.banco, estado: 'validada' });
    expect(v.estado, JSON.stringify(v.cuerpo)).toBe(200);
    expect((await comando(n.subdireccion, 'confirmacion.reabrir', { grupoId: A.g1, motivo: 'Ajuste ficticio' })).estado).toBe(403);
    const reabrir = await comando(n.direccion, 'confirmacion.reabrir', { grupoId: A.g1, motivo: 'Ajuste ficticio del horario' });
    expect(reabrir.estado, JSON.stringify(reabrir.cuerpo)).toBe(200);
    const { rows } = await e.bd.query(`SELECT accion, motivo FROM escolar.bitacora WHERE entidad_id = $1 ORDER BY creado_en DESC LIMIT 1`, [A.g1]);
    expect(rows[0]).toEqual({ accion: 'reabrir', motivo: 'Ajuste ficticio del horario' });
  });

  test('Dirección da de alta personal e inscribe alumnos con las validaciones de la app', async () => {
    const mal = await comando(n.direccion, 'personal.crear', { entrada: { nombre: '', primerApellido: '' } });
    expect(mal.estado).toBe(400);
    const p = await comando(n.direccion, 'personal.crear', { entrada: { nombre: 'Persona', primerApellido: 'Nueva', funciones: ['docente'] } });
    expect(p.estado, JSON.stringify(p.cuerpo)).toBe(200);
    expect(p.cuerpo.resultado.escuelaId).toBe(A.escuelaId);
    expect((await comando(n.subdireccion, 'personal.crear', { entrada: { nombre: 'Otra', primerApellido: 'Persona', funciones: ['docente'] } })).estado).toBe(403);
    const al = await comando(n.subdireccion, 'alumnos.inscribirNuevo', { cicloId: A.cicloId, entrada: { nombre: 'Alumna', primerApellido: 'Nueva' }, inscripcion: { grupoId: A.g2 } });
    expect(al.estado, JSON.stringify(al.cuerpo)).toBe(200);
    expect(al.cuerpo.resultado.inscripcion.grupoId).toBe(A.g2);
    expect((await comando(n.apoyo, 'alumnos.inscribirNuevo', { cicloId: A.cicloId, entrada: { nombre: 'X', primerApellido: 'Y' } })).estado).toBe(403);
  });

  test('vincular una ficha de personal: sólo de la propia escuela y sin duplicar personas', async () => {
    const ajena = await n.administrador.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.apoyo}/vincular-personal`, { personalId: B.d2 });
    expect(ajena.estado).toBe(404);
    const duplicada = await n.administrador.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.apoyo}/vincular-personal`, { personalId: A.d1 });
    expect(duplicada.cuerpo.codigo).toBe('YA_VINCULADA');
    const ok = await n.administrador.post(`/api/escuelas/${A.escuelaId}/membresias/${membresia.apoyo}/vincular-personal`, { personalId: A.d2 });
    expect(ok.cuerpo).toEqual({ vinculada: true });
  });
});

describe('Lectura, errores y auditoría', () => {
  test('columnas sensibles: la CURP sólo la ven Dirección y Subdirección', async () => {
    await e.bd.query(`UPDATE escolar.alumnos SET curp = 'XEXX010101HNEXXXA4' WHERE id = $1`, [A.al1]);
    const ver = async (rol: Rol) => (await n[rol].get(`/api/escuelas/${A.escuelaId}/tablas/alumnos`)).cuerpo.find((x: { id: string }) => x.id === A.al1)?.curp ?? null;
    expect(await ver('direccion')).toBe('XEXX010101HNEXXXA4');
    expect(await ver('subdireccion')).toBe('XEXX010101HNEXXXA4');
    expect(await ver('administrador')).toBeNull();
    expect(await ver('prefectura')).toBeNull();
    expect(await ver('docente')).toBeNull();
  });

  test('peticiones mal formadas y tablas inexistentes', async () => {
    expect((await n.docente.post(`/api/escuelas/${A.escuelaId}/comandos`, { tipo: 'asistencia.guardarLista', datos: {} })).cuerpo.campos.opId).toMatch(/identificador/);
    expect((await comando(n.docente, 'sistema.borrarTodo', {})).estado).toBe(400);
    expect((await n.docente.get(`/api/escuelas/${A.escuelaId}/tablas/membresias`)).estado).toBe(404);
    expect((await n.docente.get(`/api/escuelas/${B.escuelaId}/tablas/alumnos`)).estado).toBe(403);
  });

  test('con el ciclo cerrado, la regla de la app responde en el servidor', async () => {
    await e.bd.query(`UPDATE escolar.ciclos SET estado = 'cerrado' WHERE id = $1`, [A.cicloId]);
    try {
      const r = await comando(n.docente, 'asistencia.crearReporte', { alumnoId: A.al1, sesionId: A.s1, tipo: 'reconocimiento', texto: 'Texto ficticio' });
      expect(r.estado).toBe(409);
      expect(r.cuerpo.mensaje).toMatch(/cerrado/);
    } finally {
      await e.bd.query(`UPDATE escolar.ciclos SET estado = 'activo' WHERE id = $1`, [A.cicloId]);
    }
  });

  test('cada comando aplicado o rechazado queda en la auditoría (sin datos personales)', async () => {
    const { rows } = await e.bd.query(`SELECT accion, entidad, detalle FROM acceso.auditoria WHERE escuela_id = $1 AND accion IN ('comando', 'comando_rechazado')`, [A.escuelaId]);
    expect(rows.some((r) => r.accion === 'comando' && r.entidad === 'asistencia.guardarLista')).toBe(true);
    expect(rows.some((r) => r.accion === 'comando_rechazado' && r.entidad === 'prefectura.validarIncidencia')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Alumna|Ficticia|@ejemplo/);
  });
});
