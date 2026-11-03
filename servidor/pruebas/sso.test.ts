/**
 * Inicio de sesión con cuenta institucional (OIDC), probado con un proveedor SIMULADO
 * local (oauth2-mock-server). Sin servicios externos; sólo datos ficticios.
 * Google Workspace y Microsoft 365 usan el mismo flujo (OpenID Connect).
 */
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { crearEntorno, escuelaFicticia, URL_APP, type Entorno, type Navegador } from './entorno.ts';

let proveedor: OAuth2Server;
let e: Entorno;
let correoDelProveedor = '';
let verificado = true;

beforeAll(async () => {
  proveedor = new OAuth2Server();
  await proveedor.issuer.keys.generate('RS256');
  await proveedor.start(0, '127.0.0.1');
  const reclamar = (p: Record<string, unknown>) => { p.sub = `sub-${correoDelProveedor}`; p.email = correoDelProveedor; p.email_verified = verificado; p.name = 'Persona Ficticia SSO'; };
  proveedor.service.on('beforeTokenSigning', (t: { payload: Record<string, unknown> }) => reclamar(t.payload));
  proveedor.service.on('beforeUserinfo', (r: { body: Record<string, unknown> }) => reclamar(r.body));
  e = await crearEntorno({ OIDC_PRUEBA_URL: proveedor.issuer.url! });
});
afterAll(async () => { await e?.cerrar(); await proveedor?.stop(); });

/** Recorre el flujo completo como lo haría el navegador (siguiendo las redirecciones). */
async function entrarConProveedor(n: Navegador): Promise<{ destino: string }> {
  const inicio = await n.post('/api/auth/sign-in/social', { provider: 'oidc-prueba', callbackURL: `${URL_APP}/#/cuenta`, errorCallbackURL: `${URL_APP}/#/cuenta?error=sso` });
  expect(inicio.estado).toBe(200);
  let url = new URL(inicio.cuerpo.url as string);
  for (let i = 0; i < 6; i++) {
    const deApp = url.origin === URL_APP;
    if (deApp && !url.pathname.startsWith('/api/')) return { destino: url.toString() };
    const destino = deApp ? new URL(url.pathname + url.search, e.base) : url;
    const r = await fetch(destino, { redirect: 'manual', headers: deApp && n.cookies.size ? { cookie: [...n.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {} });
    if (deApp) n.guardarCookies(r.headers);
    const siguiente = r.headers.get('location');
    if (!siguiente) throw new Error(`Sin redirección (${r.status}) en ${destino.pathname}`);
    url = new URL(siguiente, destino);
  }
  throw new Error('Demasiadas redirecciones');
}

test('una persona invitada entra con su cuenta institucional y la cuenta queda vinculada', async () => {
  const { escuelaId } = await escuelaFicticia(e, 'sso-invitada@ejemplo.test');
  correoDelProveedor = 'sso-invitada@ejemplo.test'; verificado = true;
  const n = e.navegador();
  const { destino } = await entrarConProveedor(n);
  expect(destino).toBe(`${URL_APP}/#/cuenta`);
  const yo = await n.get('/api/yo');
  expect(yo.estado).toBe(200);
  expect(yo.cuerpo.membresias).toEqual([expect.objectContaining({ escuelaId })]);
  const { rows } = await e.bd.query(`SELECT "providerId" FROM account a JOIN "user" u ON u.id = a."userId" WHERE u.email = $1`, ['sso-invitada@ejemplo.test']);
  expect(rows.map((r) => r.providerId)).toContain('oidc-prueba');
  const aud = await e.bd.query(`SELECT detalle FROM acceso.auditoria WHERE accion = 'sesion_iniciada' ORDER BY id DESC LIMIT 1`);
  expect(aud.rows[0].detalle.via).toBe('cuenta_institucional');
});

test('una cuenta institucional NO invitada no entra ni crea usuario', async () => {
  correoDelProveedor = 'sso-desconocida@ejemplo.test'; verificado = true;
  const n = e.navegador();
  const { destino } = await entrarConProveedor(n);
  expect(destino).toContain('error');
  expect((await n.get('/api/yo')).cuerpo).toBeNull();
  const { rowCount } = await e.bd.query(`SELECT 1 FROM "user" WHERE email = 'sso-desconocida@ejemplo.test'`);
  expect(rowCount).toBe(0);
});

test('una invitación revocada impide entrar también con cuenta institucional', async () => {
  const { escuelaId } = await escuelaFicticia(e, 'sso-revocada@ejemplo.test');
  await e.bd.query(`UPDATE acceso.membresias SET estado = 'revocada', revocada_en = now(), motivo_revocacion = 'Prueba ficticia' WHERE escuela_id = $1`, [escuelaId]);
  correoDelProveedor = 'sso-revocada@ejemplo.test'; verificado = true;
  const n = e.navegador();
  const { destino } = await entrarConProveedor(n);
  expect(destino).toContain('error');
  expect((await n.get('/api/yo')).cuerpo).toBeNull();
});
