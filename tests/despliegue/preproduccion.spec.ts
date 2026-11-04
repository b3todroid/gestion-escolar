import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cambiarYGuardar, claseDeHoy, docker, entrar, FECHA, lista, p, pasesDe, PROYECTO, URL } from './comun';

// Fase 11 — PRUEBAS DE DESPLIEGUE contra la PREPRODUCCIÓN local en contenedores (deploy/):
// Caddy con HTTPS → servidor → PostgreSQL, correo SMTP REAL hacia un buzón de prueba (Mailpit) y la
// escuela FICTICIA DEMO-001. Nada sale a internet. Requiere la pila levantada (docs/GUIA_PUBLICACION.md §2).
const sesionHoy = claseDeHoy(p.docente.id).id;
const pasesDeHoy = (page: Page) => pasesDe(page, sesionHoy);

test.describe.configure({ mode: 'serial' });
let ctx: BrowserContext; let page: Page;

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

test('DEP-05 · detrás del proxy, los límites usan la IP real (inventar X-Forwarded-For no los evita) y hay límite por correo', async () => {
  const otro = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  const pedir = (email: string, i: number) => otro.request.post(`${URL}/api/auth/email-otp/send-verification-otp`, { headers: { origin: URL, 'x-forwarded-for': `203.0.113.${(i % 200) + 10}` }, data: { email, type: 'sign-in' } }).then((r) => r.status());
  // Por correo: 4.º código para la misma dirección → 429 (el límite por correo de preproducción es 20; producción usa 3).
  const limiteCorreo = Number(process.env.LIMITE_CODIGOS_POR_CORREO_PREPROD ?? 20);
  const mismo: number[] = [];
  for (let i = 0; i <= limiteCorreo; i++) mismo.push(await pedir('limite.correo.preprod@ejemplo.test', i));
  expect(mismo.at(-1)).toBe(429);
  // Por IP real: 30 por minuto. Con correos distintos y una IP inventada distinta en cada intento, el límite llega igual.
  const estados: number[] = [];
  for (let i = 0; i < 35; i++) estados.push(await pedir(`ip.${i}.preprod@ejemplo.test`, i));
  await otro.close();
  expect(estados.filter((e) => e === 200).length).toBeLessThanOrEqual(30);
  expect(estados.slice(-3)).toEqual([429, 429, 429]);
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
