import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { generarPiloto } from '../../piloto/datos';

// Fase 11 — PRUEBAS DE DESPLIEGUE contra la PREPRODUCCIÓN local en contenedores (deploy/):
// Caddy con HTTPS → servidor → PostgreSQL, correo SMTP REAL hacia un buzón de prueba (Mailpit) y la
// escuela FICTICIA DEMO-001. Nada sale a internet. Requiere la pila levantada (docs/GUIA_PUBLICACION.md §2).
const URL = process.env.URL_PREPRODUCCION ?? 'https://localhost:8443';
const BUZON = process.env.URL_BUZON_PRUEBA ?? 'http://127.0.0.1:8025';
const PROYECTO = ['compose', '-p', 'gestion-preprod', '-f', 'deploy/docker-compose.yml', '-f', 'deploy/compose.preproduccion.yml', '--env-file', 'deploy/preproduccion.env'];
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const FECHA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

/** Último código de acceso enviado POR SMTP a ese correo (leído del buzón de prueba). */
async function codigoPorCorreo(ctx: BrowserContext, correo: string, despuesDe: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await ctx.request.get(`${BUZON}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    const { messages } = (await r.json()) as { messages: { ID: string; Created: string }[] };
    const nuevo = messages.find((m) => Date.parse(m.Created) >= despuesDe - 2000);
    if (nuevo) {
      const m = (await (await ctx.request.get(`${BUZON}/api/v1/message/${nuevo.ID}`)).json()) as { Text: string };
      const c = /\b(\d{6})\b/.exec(m.Text)?.[1];
      if (c) return c;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('No llegó el código por SMTP');
}

async function entrar(page: Page, correo: string) {
  await page.goto(`${URL}/#/cuenta`);
  await page.getByLabel('Correo con el que te invitaron').fill(correo);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(await codigoPorCorreo(page.context(), correo, t0));
  await page.getByRole('button', { name: 'Entrar' }).click();
}
const lista = (page: Page) => page.request.get(`${URL}/api/salud/lista`).then((r) => r.status());
/** Cambia la marca del alumno n (a F o R, la que no tenga) y guarda: lista nueva o corrección. */
async function cambiarYGuardar(page: Page, n: number) {
  const grupo = page.getByRole('radiogroup').nth(n);
  const nueva = (await grupo.getByRole('radio', { name: 'Falta' }).isChecked()) ? 'Retardo' : 'Falta';
  await grupo.getByRole('radio', { name: nueva }).check();
  if (await page.getByRole('button', { name: 'Guardar lista' }).isVisible()) await page.getByRole('button', { name: 'Guardar lista' }).click();
  else {
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  }
}
const pasesDeHoy = async (page: Page) => ((await (await page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/pases`)).json()) as { fecha: string; sesionId: string; correcciones: number }[])
  .filter((x) => x.fecha === FECHA && x.sesionId === sesionHoy);

test.describe.configure({ mode: 'serial' });
let ctx: BrowserContext; let page: Page;
const p = generarPiloto({ escala: 0.2, semanas: 2, hoy: FECHA });
const sesionHoy = (() => {
  const datos = JSON.parse(p.contenido).datos as { sesiones: { id: string; personalId: string; dia: number }[] };
  const dia = ((new Date(`${FECHA}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return datos.sesiones.find((s) => s.personalId === p.docente.id && s.dia === Math.min(dia, 5))!.id;
})();

test.beforeAll(async ({ browser }) => { ctx = await browser.newContext({ ignoreHTTPSErrors: true }); page = await ctx.newPage(); });
test.afterAll(async () => { await ctx.close(); });

test('DEP-01 · HTTPS: la PWA se sirve con cabeceras de seguridad, Service Worker activo y HTTP redirige a HTTPS', async () => {
  const r = await page.goto(`${URL}/`);
  expect(r!.status()).toBe(200);
  const h = r!.headers();
  expect(h['strict-transport-security']).toContain('max-age=31536000');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['server']).toBeUndefined();
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("default-src 'self'");
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 20_000 }).toBe('activated');
  expect((await page.request.get(`${URL}/sw.js.map`)).status()).toBe(404); // sin mapas de código
  expect((await page.request.get(`${URL}/api/desarrollo/buzon?correo=x`)).status()).toBe(404);
  const http = await ctx.request.get(URL.replace('https://', 'http://').replace(':8443', ':8080'), { maxRedirects: 0 });
  expect([301, 308]).toContain(http.status());
  expect(http.headers()['location']).toMatch(/^https:\/\//);
});

test('DEP-02 · los puertos de la base de datos y de la API NO están publicados; la base no tiene salida a internet', async () => {
  const puertos = docker(...PROYECTO, 'ps', '--format', '{{.Service}} {{.Ports}}');
  expect(puertos).toMatch(/^db 5432\/tcp$/m); // expuesto sólo dentro de la red de contenedores
  expect(puertos).toMatch(/^servidor 8787\/tcp$/m);
  expect(puertos).not.toMatch(/0\.0\.0\.0:\d+->5432/);
  let salida = '';
  try { salida = docker(...PROYECTO, 'exec', '-T', 'db', 'sh', '-c', 'wget -q -T 5 -O- http://example.com >/dev/null 2>&1 && echo CONECTA || echo SIN_SALIDA'); } catch { salida = 'SIN_SALIDA'; }
  expect(salida.trim()).toBe('SIN_SALIDA');
});

test('DEP-03 · autenticación con código enviado por SMTP real; la docente usa DEMO-001 y pasa lista; llega al servidor', async () => {
  await entrar(page, 'docente.uno.piloto@ejemplo.test');
  await page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${p.escuelaId}$`), { timeout: 60_000 });
  await expect(page.locator('#demostracion')).toContainText('DEMOSTRACIÓN');
  await page.goto(`${URL}/#/lista/${sesionHoy}/${FECHA}`);
  await expect(page.locator('#estado-lista')).toBeVisible();
  const antes = (await pasesDeHoy(page))[0]?.correcciones ?? -1;
  await cambiarYGuardar(page, 0);
  // Una sola lista por clase y fecha en el servidor (nueva o corregida), con el cambio aplicado.
  await expect.poll(async () => { const x = await pasesDeHoy(page); return x.length === 1 && x[0]!.correcciones === antes + 1; }, { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 30_000 });
});

test('DEP-04 · autorización en el servidor: la docente no puede invitar ni ver otra escuela; sin sesión no hay datos', async () => {
  const inv = await page.request.post(`${URL}/api/escuelas/${p.escuelaId}/invitaciones`, { headers: { origin: URL }, data: { nombre: 'X', correo: 'x@ejemplo.test', rol: 'administrador', tipoCorreo: 'institucional' } });
  expect([403, 404]).toContain(inv.status());
  const anonimo = await (await page.context().browser()!.newContext({ ignoreHTTPSErrors: true })).request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/alumnos`);
  expect([401, 403]).toContain(anonimo.status());
  // POST desde otro origen: rechazado (CSRF)
  const cruzado = await page.request.post(`${URL}/api/auth/sign-out`, { headers: { origin: 'https://atacante.example' }, data: {} });
  expect(cruzado.status()).toBe(403);
});

test('DEP-05 · detrás del proxy, el límite de intentos usa la IP real: inventar X-Forwarded-For no lo evita', async () => {
  const otro = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  const estados: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await otro.request.post(`${URL}/api/auth/email-otp/send-verification-otp`, { headers: { origin: URL, 'x-forwarded-for': `203.0.113.${i + 10}` }, data: { email: 'limite.preprod@ejemplo.test', type: 'sign-in' } });
    estados.push(r.status());
  }
  await otro.close();
  // Límite: 3 por minuto y por IP REAL (incluye el código que se pidió en DEP-03 desde este mismo equipo).
  // Si el servidor creyera la cabecera inventada, las 5 solicitudes (5 «IP» distintas) pasarían.
  expect(estados.filter((e) => e === 200).length).toBeLessThanOrEqual(3);
  expect(estados.slice(-2)).toEqual([429, 429]);
});

test('DEP-06 · actualización de la PWA con cambios por enviar: aviso, actualización y nada se pierde; después se envían', async () => {
  // Servidor inalcanzable para el dispositivo (los recursos de la app sí): el cambio queda en la cola.
  await page.route('**/api/escuelas/**', (r) => r.abort());
  const antes = (await pasesDeHoy(page))[0]!.correcciones;
  await page.goto(`${URL}/#/lista/${sesionHoy}/${FECHA}`);
  await cambiarYGuardar(page, 1);
  await expect(page.locator('#sincronizacion')).toContainText('por enviar', { timeout: 15_000 });
  const versionAntes = await (await page.goto(`${URL}/#/aplicacion`), page.locator('dt', { hasText: 'Versión de la aplicación' }).locator('+ dd').innerText());
  // Nueva versión de la web (sólo cambia la etiqueta): se construye y se reemplaza el contenedor.
  execFileSync('bash', ['deploy/scripts/construir.sh', '0.1.1-preprod', process.env.REGISTRO ?? 'docker.io/library'], { stdio: 'ignore', env: { ...process.env } });
  execFileSync('docker', [...PROYECTO, 'up', '-d', '--no-deps', '--no-build', 'web'], { stdio: 'ignore', env: { ...process.env, VERSION: '0.1.1-preprod' } });
  await expect.poll(async () => (await ctx.request.get(`${URL}/`).catch(() => null))?.status() ?? 0, { timeout: 60_000 }).toBe(200);
  await page.reload();
  await expect(page.locator('.barra-actualizacion')).toContainText('Hay una nueva versión', { timeout: 60_000 });
  const recarga = page.waitForEvent('load', { timeout: 30_000 });
  await page.locator('.barra-actualizacion').getByRole('button', { name: 'Actualizar' }).click();
  await recarga; // el nuevo Service Worker toma el control y la página se recarga una vez
  await expect(async () => {
    await page.goto(`${URL}/#/aplicacion`);
    await expect(page.locator('dt', { hasText: 'Versión de la aplicación' }).locator('+ dd')).toHaveText('0.1.1-preprod', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  expect(versionAntes).not.toBe('0.1.1-preprod');
  // Lo local sigue ahí: la cola por enviar y la lista corregida.
  await expect(page.locator('#sincronizacion')).toContainText('por enviar');
  await page.unroute('**/api/escuelas/**');
  await expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 30_000 });
  const pases = await pasesDeHoy(page);
  expect(pases).toHaveLength(1);
  expect(pases[0]!.correcciones).toBe(antes + 1);
});

test('DEP-07 · recuperación: reiniciar la base de datos → la API lo reporta y se recupera sola; lo guardado mientras tanto se envía después, sin duplicados', async () => {
  const antes = (await pasesDeHoy(page))[0]!.correcciones;
  docker(...PROYECTO, 'stop', 'db');
  await expect.poll(() => lista(page), { timeout: 30_000 }).toBe(503);
  await page.goto(`${URL}/#/lista/${sesionHoy}/${FECHA}`);
  await cambiarYGuardar(page, 2);
  await expect(page.locator('.aviso').first()).toContainText(/guardad/i); // se guarda en el dispositivo
  docker(...PROYECTO, 'start', 'db');
  await expect.poll(() => lista(page), { timeout: 90_000 }).toBe(200);
  await expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 60_000 });
  const pases = await pasesDeHoy(page);
  expect(pases).toHaveLength(1);
  expect(pases[0]!.correcciones).toBe(antes + 1);
});

test('DEP-08 · reinicio del servidor de la API: el orquestador lo levanta y la sesión sigue válida', async () => {
  docker(...PROYECTO, 'restart', 'servidor');
  await expect.poll(() => lista(page), { timeout: 90_000 }).toBe(200);
  const yo = await page.request.get(`${URL}/api/yo`);
  expect(yo.status()).toBe(200);
});
