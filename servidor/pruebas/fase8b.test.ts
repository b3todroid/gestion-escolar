/**
 * Fase 8B — servidor, autenticación y accesos. PostgreSQL real; sólo datos ficticios.
 */
import { getMigrations } from 'better-auth/db/migration';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ESQUEMAS_TABLA } from '../../src/validators/respaldo.ts';
import { leerConfiguracion } from '../src/config.ts';
import { leerMigraciones, migrar } from '../src/migrar.ts';
import { altaEscuela } from '../src/operador.ts';
import { activarSegundoFactor, codigoTotp, crearEntorno, entrarConCodigo, escuelaFicticia, type Entorno, type Navegador } from './entorno.ts';

let e: Entorno;
beforeAll(async () => { e = await crearEntorno(); });
afterAll(async () => { await e?.cerrar(); });

const snake = (s: string) => s.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);

/** Administrador ya con sesión y segundo factor activos. */
async function adminListo(correo: string) {
  const escuela = await escuelaFicticia(e, correo);
  const n = e.navegador();
  expect((await entrarConCodigo(e, n, correo)).estado).toBe(200);
  const sf = await activarSegundoFactor(n);
  return { escuela, n, ...sf };
}

async function invitar(n: Navegador, escuelaId: string, datos: Partial<{ correo: string; nombre: string; rol: string; tipoCorreo: string; consentimiento: boolean }>) {
  return n.post(`/api/escuelas/${escuelaId}/invitaciones`, { nombre: 'Persona Ficticia', rol: 'docente', tipoCorreo: 'institucional', ...datos });
}

describe('Esquema y migraciones', () => {
  test('las migraciones son idempotentes y se registran con su huella', async () => {
    const r = await migrar(e.bd);
    expect(r.aplicadas).toEqual([]);
    const { rows } = await e.bd.query('SELECT nombre, huella FROM sistema.migraciones ORDER BY nombre');
    expect(rows.map((x) => x.nombre)).toEqual(leerMigraciones().map((m) => m.nombre));
  });

  test('una migración ya aplicada que cambia o desaparece detiene el proceso (no se modifica lo publicado)', async () => {
    const ms = leerMigraciones();
    const alterada = ms.map((m, i) => (i === 1 ? { ...m, huella: 'f'.repeat(64) } : m));
    await expect(migrar(e.bd, alterada)).rejects.toThrow(/cambió después de aplicarse/);
    await expect(migrar(e.bd, ms.slice(1))).rejects.toThrow(/su archivo no existe/);
  });

  test('el espejo escolar tiene una tabla por cada tabla del respaldo, con los mismos campos', async () => {
    for (const [tabla, esquema] of Object.entries(ESQUEMAS_TABLA) as [string, { shape: Record<string, unknown> }][]) {
      const { rows } = await e.bd.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'escolar' AND table_name = $1`, [snake(tabla)]);
      const columnas = rows.map((r) => r.column_name as string).sort();
      const esperadas = Object.keys(esquema.shape).map(snake).sort();
      expect(columnas, `escolar.${snake(tabla)}`).toEqual(esperadas);
    }
    const { rows } = await e.bd.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'escolar'`);
    expect(rows[0].n).toBe(Object.keys(ESQUEMAS_TABLA).length);
  });

  test('el espejo reproduce las restricciones únicas locales (pase por clase y fecha)', async () => {
    const { rows } = await e.bd.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'escolar.pases'::regclass AND contype = 'u'`);
    expect(rows.map((r) => r.def)).toContain('UNIQUE (sesion_id, fecha)');
  });

  test('las tablas de Better Auth coinciden con su configuración (sin cambios pendientes)', async () => {
    const m = await getMigrations(e.auth.options);
    expect(m.toBeCreated).toEqual([]);
    expect(m.toBeAdded).toEqual([]);
  });

  test('la auditoría es de sólo agregar', async () => {
    await e.bd.query(`INSERT INTO acceso.auditoria (accion) VALUES ('prueba')`);
    await expect(e.bd.query(`UPDATE acceso.auditoria SET accion = 'x'`)).rejects.toThrow(/sólo agregar/);
    await expect(e.bd.query('DELETE FROM acceso.auditoria')).rejects.toThrow(/sólo agregar/);
    await expect(e.bd.query('TRUNCATE acceso.auditoria')).rejects.toThrow(/sólo agregar/);
  });
});

describe('Configuración', () => {
  const base = { DATABASE_URL: 'postgres://x@localhost/x', BETTER_AUTH_SECRET: 'a'.repeat(40) };
  test('rechaza secretos cortos sin mostrar su valor', () => {
    let mensaje = '';
    try { leerConfiguracion({ ...base, BETTER_AUTH_SECRET: 'corto-secreto' }); } catch (x) { mensaje = (x as Error).message; }
    expect(mensaje).toMatch(/BETTER_AUTH_SECRET/);
    expect(mensaje).not.toContain('corto-secreto');
  });
  test('producción no admite el buzón de desarrollo ni http', () => {
    expect(() => leerConfiguracion({ ...base, MODO: 'produccion', CORREO_MODO: 'buzon', URL_PUBLICA: 'https://escuela.example' })).toThrow(/buzón/);
  });
  test('Microsoft exige un inquilino institucional', () => {
    expect(() => leerConfiguracion({ ...base, MICROSOFT_CLIENT_ID: 'a', MICROSOFT_CLIENT_SECRET: 'b', MICROSOFT_TENANT_ID: 'common' })).toThrow(/inquilino institucional/);
  });
  test('el proveedor OIDC de prueba sólo existe en MODO=pruebas', () => {
    expect(() => leerConfiguracion({ ...base, MODO: 'desarrollo', OIDC_PRUEBA_URL: 'http://127.0.0.1:1' })).toThrow(/sólo se permite/);
  });
});

describe('Alta de escuela por el operador', () => {
  test('valida CCT, entidad y consentimiento del correo personal; no repite CCT', async () => {
    const datos = { nombre: 'Escuela Ficticia Alta', cct: '32ZZZ9001A', nivel: 'secundaria', entidad: '32', municipio: 'Municipio Ejemplo', adminCorreo: 'alta@ejemplo.test', adminNombre: 'Persona Ficticia', tipoCorreo: 'institucional', consentimiento: false };
    await expect(altaEscuela(e.bd, e.cfg, { ...datos, cct: '33ZZZ9001A' })).rejects.toThrow(/CCT/);
    await expect(altaEscuela(e.bd, e.cfg, { ...datos, entidad: '01' })).rejects.toThrow(/entidad/);
    await expect(altaEscuela(e.bd, e.cfg, { ...datos, tipoCorreo: 'personal' })).rejects.toThrow(/consentimiento/);
    await altaEscuela(e.bd, e.cfg, datos);
    await expect(altaEscuela(e.bd, e.cfg, { ...datos, adminCorreo: 'otra@ejemplo.test' })).rejects.toThrow(/no se mezclan/);
  });
});

describe('Inicio de sesión con código al correo', () => {
  test('una persona invitada entra; la invitación se activa; el token nunca va en el cuerpo', async () => {
    const { escuelaId } = await escuelaFicticia(e, 'invitada@ejemplo.test', 'personal');
    const n = e.navegador();
    const r = await entrarConCodigo(e, n, 'invitada@ejemplo.test');
    expect(r.estado).toBe(200);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/"token"/);
    expect([...n.cookies.keys()]).toContain('gestion-escolar.session_token');
    const yo = await n.get('/api/yo');
    expect(yo.estado).toBe(200);
    expect(yo.cuerpo.membresias).toEqual([expect.objectContaining({ escuelaId, rol: 'administrador' })]);
    expect(yo.cuerpo.segundoFactor).toEqual({ activo: false, verificado: false, requerido: true });
    const { rows } = await e.bd.query(`SELECT estado, aceptada_en FROM acceso.membresias WHERE escuela_id = $1`, [escuelaId]);
    expect(rows[0].estado).toBe('activa');
    expect(rows[0].aceptada_en).not.toBeNull();
  });

  test('un correo NO invitado recibe la misma respuesta, no recibe código y no se crea cuenta', async () => {
    const n = e.navegador();
    e.buzon.vaciar();
    const r = await n.post('/api/auth/email-otp/send-verification-otp', { email: 'desconocida@ejemplo.test', type: 'sign-in' });
    expect(r.estado).toBe(200);
    expect(e.buzon.de('desconocida@ejemplo.test')).toEqual([]);
    const entrar = await n.post('/api/auth/sign-in/email-otp', { email: 'desconocida@ejemplo.test', otp: '123456' });
    expect(entrar.estado).toBe(400);
    const { rowCount } = await e.bd.query(`SELECT 1 FROM "user" WHERE email = 'desconocida@ejemplo.test'`);
    expect(rowCount).toBe(0);
  });

  test('el código se guarda cifrado con hash (no en texto plano) y caduca tras 3 intentos fallidos', async () => {
    await escuelaFicticia(e, 'intentos@ejemplo.test');
    const n = e.navegador();
    e.buzon.vaciar();
    await n.post('/api/auth/email-otp/send-verification-otp', { email: 'intentos@ejemplo.test', type: 'sign-in' });
    const codigo = e.buzon.ultimoCodigo('intentos@ejemplo.test')!;
    const { rows } = await e.bd.query(`SELECT value FROM verification WHERE identifier LIKE '%intentos@ejemplo.test%'`);
    expect(rows.length).toBe(1);
    expect(rows[0].value).not.toContain(codigo);
    const otro = codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) expect((await n.post('/api/auth/sign-in/email-otp', { email: 'intentos@ejemplo.test', otp: otro })).estado).toBeGreaterThanOrEqual(400);
    const tarde = await n.post('/api/auth/sign-in/email-otp', { email: 'intentos@ejemplo.test', otp: codigo });
    expect(tarde.estado).toBeGreaterThanOrEqual(400);
    expect(n.cookies.has('gestion-escolar.session_token')).toBe(false);
  });

  test('una invitación caducada no permite entrar (y queda en la auditoría)', async () => {
    const { escuelaId, usuarioId } = await escuelaFicticia(e, 'caducada@ejemplo.test');
    await e.bd.query(`UPDATE acceso.membresias SET expira_en = now() - interval '1 minute' WHERE escuela_id = $1`, [escuelaId]);
    const n = e.navegador();
    const r = await entrarConCodigo(e, n, 'caducada@ejemplo.test');
    expect(r.estado).toBe(403);
    expect(r.cuerpo.code).toBe('SIN_ACCESO');
    const { rows } = await e.bd.query(`SELECT accion FROM acceso.auditoria WHERE usuario_id = $1`, [usuarioId]);
    expect(rows.map((x) => x.accion)).toContain('inicio_rechazado');
  });

  test('sólo se envían códigos para iniciar sesión; registro, contraseñas y rutas que exponen el token no existen', async () => {
    const n = e.navegador();
    expect((await n.post('/api/auth/email-otp/send-verification-otp', { email: 'invitada@ejemplo.test', type: 'forget-password' })).estado).toBe(400);
    for (const ruta of ['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/update-user', '/api/auth/delete-user', '/api/auth/change-email', '/api/auth/email-otp/reset-password']) {
      expect((await n.post(ruta, {})).estado, ruta).toBe(404);
    }
    expect((await n.get('/api/auth/get-session')).estado).toBe(404);
    expect((await n.get('/api/auth/list-sessions')).estado).toBe(404);
  });

  test('límite de solicitudes de código y de intentos por minuto', async () => {
    const otro = await crearEntorno({ LIMITE_CODIGOS_POR_MINUTO: '3', LIMITE_INTENTOS_POR_MINUTO: '4' });
    try {
      const n = otro.navegador();
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) estados.push((await n.post('/api/auth/email-otp/send-verification-otp', { email: 'limite@ejemplo.test', type: 'sign-in' })).estado);
      expect(estados.slice(0, 3)).toEqual([200, 200, 200]);
      expect(estados.slice(3)).toEqual([429, 429]);
      const intentos: number[] = [];
      for (let i = 0; i < 6; i++) intentos.push((await n.post('/api/auth/sign-in/email-otp', { email: 'limite@ejemplo.test', otp: '000000' })).estado);
      expect(intentos.slice(4)).toEqual([429, 429]);
    } finally { await otro.cerrar(); }
  });
});

describe('Verificación en dos pasos', () => {
  test('roles amplios no operan hasta activarla; luego sí', async () => {
    const { escuelaId } = await escuelaFicticia(e, 'mfa@ejemplo.test');
    const n = e.navegador();
    await entrarConCodigo(e, n, 'mfa@ejemplo.test');
    const antes = await n.get(`/api/escuelas/${escuelaId}/miembros`);
    expect(antes.estado).toBe(403);
    expect(antes.cuerpo.codigo).toBe('SEGUNDO_FACTOR_REQUERIDO');
    const { respaldo } = await activarSegundoFactor(n);
    expect(respaldo).toHaveLength(10);
    expect((await n.get(`/api/escuelas/${escuelaId}/miembros`)).estado).toBe(200);
  });

  test('una sesión nueva queda pendiente: no puede operar ni desactivar el segundo factor hasta escribir el código', async () => {
    const { escuela, secreto } = await adminListo('pendiente@ejemplo.test');
    const n2 = e.navegador();
    expect((await entrarConCodigo(e, n2, 'pendiente@ejemplo.test')).estado).toBe(200);
    expect((await n2.get('/api/yo')).cuerpo.segundoFactor).toEqual({ activo: true, verificado: false, requerido: true });
    const bloqueado = await n2.get(`/api/escuelas/${escuela.escuelaId}/miembros`);
    expect(bloqueado.cuerpo.codigo).toBe('SEGUNDO_FACTOR_PENDIENTE');
    expect((await n2.post('/api/auth/two-factor/disable', {})).estado).toBe(403);
    expect((await n2.post('/api/auth/revoke-sessions', {})).estado).toBe(403);
    expect((await n2.post('/api/auth/two-factor/verify-totp', { code: '000000' })).estado).toBe(401);
    expect((await n2.post('/api/auth/two-factor/verify-totp', { code: codigoTotp(secreto) })).estado).toBe(200);
    expect((await n2.get('/api/yo')).cuerpo.segundoFactor.verificado).toBe(true);
    expect((await n2.get(`/api/escuelas/${escuela.escuelaId}/miembros`)).estado).toBe(200);
  });

  test('un código de respaldo sirve una sola vez', async () => {
    const { respaldo } = await adminListo('respaldo@ejemplo.test');
    const n2 = e.navegador();
    await entrarConCodigo(e, n2, 'respaldo@ejemplo.test');
    expect((await n2.post('/api/auth/two-factor/verify-backup-code', { code: respaldo[0] })).estado).toBe(200);
    expect((await n2.get('/api/yo')).cuerpo.segundoFactor.verificado).toBe(true);
    const n3 = e.navegador();
    await entrarConCodigo(e, n3, 'respaldo@ejemplo.test');
    expect((await n3.post('/api/auth/two-factor/verify-backup-code', { code: respaldo[0] })).estado).toBeGreaterThanOrEqual(400);
  });

  test('un rol amplio no puede desactivar su verificación en dos pasos', async () => {
    const { n } = await adminListo('nodesactivar@ejemplo.test');
    const r = await n.post('/api/auth/two-factor/disable', {});
    expect(r.estado).toBe(403);
    expect(r.cuerpo.code).toBe('SEGUNDO_FACTOR_OBLIGATORIO');
  });
});

describe('Invitaciones y permisos en el servidor', () => {
  test('el administrador invita; el correo personal exige consentimiento; un docente no administra', async () => {
    const { escuela, n } = await adminListo('admin-inv@ejemplo.test');
    const sinConsent = await invitar(n, escuela.escuelaId, { correo: 'docente-personal@ejemplo.test', tipoCorreo: 'personal' });
    expect(sinConsent.estado).toBe(400);
    expect(sinConsent.cuerpo.campos.consentimiento).toMatch(/consentimiento/);
    expect((await invitar(n, escuela.escuelaId, { correo: 'docente-personal@ejemplo.test', tipoCorreo: 'personal', consentimiento: true })).estado).toBe(201);
    const correo = e.buzon.de('docente-personal@ejemplo.test').at(-1)!;
    expect(correo.asunto).toMatch(/Invitación/);
    expect(correo.codigo).toBeNull();
    const repetida = await invitar(n, escuela.escuelaId, { correo: 'docente-personal@ejemplo.test', tipoCorreo: 'personal', consentimiento: true });
    expect(repetida.estado).toBe(201); // invitación pendiente: se renueva, no se duplica
    const d = e.navegador();
    expect((await entrarConCodigo(e, d, 'docente-personal@ejemplo.test')).estado).toBe(200);
    const yo = await d.get('/api/yo');
    expect(yo.cuerpo.segundoFactor.requerido).toBe(false);
    expect(yo.cuerpo.membresias).toEqual([expect.objectContaining({ rol: 'docente' })]);
    expect((await d.get(`/api/escuelas/${escuela.escuelaId}/miembros`)).cuerpo.codigo).toBe('SIN_PERMISO');
    expect((await invitar(d, escuela.escuelaId, { correo: 'otro@ejemplo.test' })).cuerpo.codigo).toBe('SIN_PERMISO');
    expect((await invitar(n, escuela.escuelaId, { correo: 'docente-personal@ejemplo.test', tipoCorreo: 'personal', consentimiento: true })).cuerpo.codigo).toBe('YA_ES_MIEMBRO');
    const lista = await n.get(`/api/escuelas/${escuela.escuelaId}/miembros`);
    expect(lista.cuerpo.filter((m: { correo: string }) => m.correo === 'docente-personal@ejemplo.test')).toHaveLength(1);
  });

  test('aislamiento: un administrador no ve ni modifica otra escuela (misma respuesta exista o no)', async () => {
    const a = await adminListo('admin-a@ejemplo.test');
    const b = await adminListo('admin-b@ejemplo.test');
    await invitar(b.n, b.escuela.escuelaId, { correo: 'docente-b@ejemplo.test' });
    const ajena = await a.n.get(`/api/escuelas/${b.escuela.escuelaId}/miembros`);
    const inexistente = await a.n.get('/api/escuelas/00000000-0000-4000-8000-000000000000/miembros');
    expect(ajena.estado).toBe(403);
    expect(ajena.cuerpo).toEqual(inexistente.cuerpo);
    expect((await invitar(a.n, b.escuela.escuelaId, { correo: 'intruso@ejemplo.test' })).estado).toBe(403);
    expect((await a.n.get(`/api/escuelas/${b.escuela.escuelaId}/auditoria`)).estado).toBe(403);
    // Una membresía de B pedida por la ruta de A no existe para A.
    const revocar = await a.n.post(`/api/escuelas/${a.escuela.escuelaId}/membresias/${b.escuela.membresiaId}/revocar`, { motivo: 'Prueba de aislamiento' });
    expect(revocar.estado).toBe(404);
    const { rows } = await e.bd.query('SELECT estado FROM acceso.membresias WHERE id = $1', [b.escuela.membresiaId]);
    expect(rows[0].estado).toBe('activa');
    expect((await a.n.get(`/api/escuelas/no-es-un-id/miembros`)).estado).toBe(403);
  });

  test('protección CSRF: POST sin el origen de la aplicación se rechaza; cuerpos grandes también', async () => {
    const { escuela, n } = await adminListo('csrf@ejemplo.test');
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/invitaciones`, { correo: 'x@ejemplo.test' }, { origen: 'https://sitio-malicioso.example' })).estado).toBe(403);
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/invitaciones`, { correo: 'x@ejemplo.test' }, { origen: null })).estado).toBe(403);
    expect((await n.post('/api/auth/sign-out', {}, { origen: 'https://sitio-malicioso.example' })).estado).toBe(403);
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/invitaciones`, { relleno: 'x'.repeat(70 * 1024) })).estado).toBe(413);
  });
});

describe('Cierre y revocación de sesiones', () => {
  test('cerrar sesión invalida la cookie en el servidor (repetirla no sirve)', async () => {
    await escuelaFicticia(e, 'cerrar@ejemplo.test');
    const n = e.navegador();
    await entrarConCodigo(e, n, 'cerrar@ejemplo.test');
    const cookie = n.cookies.get('gestion-escolar.session_token')!;
    expect((await n.post('/api/auth/sign-out', {})).estado).toBe(200);
    expect((await n.get('/api/yo')).cuerpo).toBeNull();
    n.cookies.set('gestion-escolar.session_token', cookie);
    expect((await n.get('/api/yo')).cuerpo).toBeNull();
  });

  test('cerrar todas las sesiones y cerrar una sesión concreta', async () => {
    await escuelaFicticia(e, 'varias@ejemplo.test', 'personal');
    const [a, b, c] = [e.navegador(), e.navegador(), e.navegador()];
    for (const x of [a, b, c]) await entrarConCodigo(e, x, 'varias@ejemplo.test');
    // Administrador sin segundo factor todavía: puede ver y cerrar sus sesiones.
    const lista = await a.get('/api/yo/sesiones');
    expect(lista.cuerpo).toHaveLength(3);
    expect(JSON.stringify(lista.cuerpo)).not.toMatch(/token/i);
    const deB = (await b.get('/api/yo/sesiones')).cuerpo.find((s: { actual: boolean }) => s.actual).id;
    await activarSegundoFactor(a);
    expect((await a.post(`/api/yo/sesiones/${deB}/cerrar`, {})).estado).toBe(200);
    expect((await b.get('/api/yo')).cuerpo).toBeNull();
    expect((await a.post('/api/auth/revoke-sessions', {})).estado).toBe(200);
    expect((await a.get('/api/yo')).cuerpo).toBeNull();
    expect((await c.get('/api/yo')).cuerpo).toBeNull();
  });

  test('revocar el acceso cierra al instante las sesiones de la persona y le impide volver a entrar', async () => {
    const { escuela, n } = await adminListo('admin-rev@ejemplo.test');
    await invitar(n, escuela.escuelaId, { correo: 'revocada@ejemplo.test' });
    const d = e.navegador();
    await entrarConCodigo(e, d, 'revocada@ejemplo.test');
    expect((await d.get('/api/yo')).estado).toBe(200);
    const miembros = (await n.get(`/api/escuelas/${escuela.escuelaId}/miembros`)).cuerpo;
    const m = miembros.find((x: { correo: string }) => x.correo === 'revocada@ejemplo.test');
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${m.id}/revocar`, { motivo: '' })).estado).toBe(400);
    const r = await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${m.id}/revocar`, { motivo: 'Cambio de adscripción (ficticio)' });
    expect(r.cuerpo).toEqual({ revocada: true, sesionesCerradas: 1 });
    expect((await d.get('/api/yo')).cuerpo).toBeNull();
    expect((await entrarConCodigo(e, e.navegador(), 'revocada@ejemplo.test')).cuerpo.code).toBe('SIN_ACCESO');
    const propio = miembros.find((x: { esUsted: boolean }) => x.esUsted);
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${propio.id}/revocar`, { motivo: 'Prueba' })).cuerpo.codigo).toBe('PROPIA');
    const aud = await n.get(`/api/escuelas/${escuela.escuelaId}/auditoria`);
    expect(aud.cuerpo.map((x: { accion: string }) => x.accion)).toEqual(expect.arrayContaining(['membresia_revocada', 'invitacion_creada']));
    expect(JSON.stringify(aud.cuerpo)).not.toContain('revocada@ejemplo.test');
  });

  test('revocar en una escuela no afecta el acceso de la persona a otra', async () => {
    const a = await adminListo('admin-ra@ejemplo.test');
    const b = await adminListo('admin-rb@ejemplo.test');
    await invitar(a.n, a.escuela.escuelaId, { correo: 'dos-escuelas@ejemplo.test' });
    await invitar(b.n, b.escuela.escuelaId, { correo: 'dos-escuelas@ejemplo.test' });
    const d = e.navegador();
    await entrarConCodigo(e, d, 'dos-escuelas@ejemplo.test');
    expect((await d.get('/api/yo')).cuerpo.membresias).toHaveLength(2);
    const m = (await a.n.get(`/api/escuelas/${a.escuela.escuelaId}/miembros`)).cuerpo.find((x: { correo: string }) => x.correo === 'dos-escuelas@ejemplo.test');
    expect((await a.n.post(`/api/escuelas/${a.escuela.escuelaId}/membresias/${m.id}/revocar`, { motivo: 'Fin de interinato (ficticio)' })).cuerpo.sesionesCerradas).toBe(0);
    const yo = await d.get('/api/yo');
    expect(yo.estado).toBe(200);
    expect(yo.cuerpo.membresias).toEqual([expect.objectContaining({ escuelaId: b.escuela.escuelaId })]);
  });

  test('no se puede dejar una escuela sin administrador activo', async () => {
    const { escuela, n } = await adminListo('unico@ejemplo.test');
    await invitar(n, escuela.escuelaId, { correo: 'segundo-admin@ejemplo.test', rol: 'administrador' });
    const s = e.navegador();
    await entrarConCodigo(e, s, 'segundo-admin@ejemplo.test');
    await activarSegundoFactor(s);
    // El segundo revoca al primero (queda uno) y después no puede quedarse sin administración.
    const lista = (await s.get(`/api/escuelas/${escuela.escuelaId}/miembros`)).cuerpo;
    const primero = lista.find((x: { correo: string }) => x.correo === 'unico@ejemplo.test');
    expect((await s.post(`/api/escuelas/${escuela.escuelaId}/membresias/${primero.id}/revocar`, { motivo: 'Cambio de administración (ficticio)' })).estado).toBe(200);
    const { rows } = await e.bd.query(`SELECT count(*)::int AS n FROM acceso.membresias WHERE escuela_id = $1 AND rol = 'administrador' AND estado = 'activa'`, [escuela.escuelaId]);
    expect(rows[0].n).toBe(1);
    const yoMismo = lista.find((x: { esUsted: boolean }) => x.esUsted);
    expect((await s.post(`/api/escuelas/${escuela.escuelaId}/membresias/${yoMismo.id}/revocar`, { motivo: 'Prueba' })).cuerpo.codigo).toBe('PROPIA');
  });
});

describe('Recuperación del acceso', () => {
  test('sin contraseñas que recuperar: basta pedir un código nuevo al correo', async () => {
    await escuelaFicticia(e, 'recupera@ejemplo.test', 'personal');
    const n = e.navegador();
    expect((await entrarConCodigo(e, n, 'recupera@ejemplo.test')).estado).toBe(200);
    const otro = e.navegador();
    expect((await entrarConCodigo(e, otro, 'recupera@ejemplo.test')).estado).toBe(200);
  });

  test('el administrador restablece la verificación de quien perdió su dispositivo (no la propia ni de otras escuelas)', async () => {
    const { escuela, n } = await adminListo('admin-rest@ejemplo.test');
    await invitar(n, escuela.escuelaId, { correo: 'direccion@ejemplo.test', rol: 'direccion' });
    const d = e.navegador();
    await entrarConCodigo(e, d, 'direccion@ejemplo.test');
    await activarSegundoFactor(d);
    const lista = (await n.get(`/api/escuelas/${escuela.escuelaId}/miembros`)).cuerpo;
    const m = lista.find((x: { correo: string }) => x.correo === 'direccion@ejemplo.test');
    expect(m.segundoFactorActivo).toBe(true);
    const r = await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${m.id}/restablecer-segundo-factor`, { motivo: 'Perdió el teléfono (ficticio)' });
    expect(r.cuerpo).toEqual({ restablecido: true, sesionesCerradas: 1 });
    expect((await d.get('/api/yo')).cuerpo).toBeNull();
    const d2 = e.navegador();
    await entrarConCodigo(e, d2, 'direccion@ejemplo.test');
    expect((await d2.get('/api/yo')).cuerpo.segundoFactor).toEqual({ activo: false, verificado: false, requerido: true });
    await activarSegundoFactor(d2); // vuelve a configurarla
    const propio = lista.find((x: { esUsted: boolean }) => x.esUsted);
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${propio.id}/restablecer-segundo-factor`, { motivo: 'Prueba' })).cuerpo.codigo).toBe('PROPIA');
    const otra = await adminListo('admin-rest-b@ejemplo.test');
    await invitar(otra.n, otra.escuela.escuelaId, { correo: 'direccion@ejemplo.test', rol: 'docente' });
    expect((await n.post(`/api/escuelas/${escuela.escuelaId}/membresias/${m.id}/restablecer-segundo-factor`, { motivo: 'Prueba' })).cuerpo.codigo).toBe('OTRAS_ESCUELAS');
  });
});

describe('Sin secretos en el cliente', () => {
  test('el código de la aplicación no importa el servidor ni contiene configuración secreta', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const archivos: string[] = [];
    const recorrer = (d: string) => { for (const a of readdirSync(d)) { const r = join(d, a); if (statSync(r).isDirectory()) recorrer(r); else if (/\.ts$/.test(a)) archivos.push(r); } };
    recorrer('src');
    for (const a of archivos) {
      const t = readFileSync(a, 'utf8');
      expect(t, a).not.toMatch(/from ['"][./]*servidor\//);
      expect(t, a).not.toMatch(/better-auth|from ['"]pg['"]|BETTER_AUTH_SECRET|DATABASE_URL|CLIENT_SECRET/);
    }
  });
});
