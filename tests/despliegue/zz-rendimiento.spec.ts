import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { cambiarYGuardar, claseDeHoy, docker, entrar, entrarYUsar, FECHA, p, pasesDe, PROYECTO, URL } from './comun';

// Fase 12 — RENDIMIENTO MEDIDO contra la PREPRODUCCIÓN local (contenedores en ESTE equipo, sin red real
// de por medio). Se registran los tiempos tal como se miden: no hay umbrales inventados; sólo límites
// holgados para detectar algo roto. Resultados en test-results/rendimiento-preproduccion.json.
const resultados: Record<string, unknown> = { fecha: new Date().toISOString(), url: URL, datos: 'DEMO-001 escala 0.2, 2 semanas (ficticios)' };
const ms = (t0: number) => Math.round(performance.now() - t0);
const estad = (xs: number[]) => { const o = [...xs].sort((a, b) => a - b); const q = (f: number) => o[Math.min(o.length - 1, Math.floor(f * o.length))]!; return { n: o.length, min: o[0], mediana: q(0.5), p95: q(0.95), max: o[o.length - 1] }; };
async function cronometrar(page: Page, ruta: string) { const t0 = performance.now(); const r = await page.request.get(`${URL}${ruta}`); expect(r.status()).toBe(200); const b = await r.body(); return { t: ms(t0), bytes: b.length }; }

test.describe.configure({ mode: 'serial' });
test.afterAll(() => { writeFileSync('test-results/rendimiento-preproduccion.json', JSON.stringify(resultados, null, 2)); console.log(JSON.stringify(resultados, null, 2)); });

test('REN-01 · primera carga (sin caché) y segunda carga (Service Worker); conexión lenta EMULADA', async ({ browser }) => {
  const medir = async (lenta: boolean) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    if (lenta) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }); }
    const t0 = performance.now(); await page.goto(`${URL}/`); await expect(page.locator('main h1').first()).toBeVisible(); const primera = ms(t0);
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; const rec = performance.getEntriesByType('resource') as PerformanceResourceTiming[]; return { ttfb: Math.round(n.responseStart), dom: Math.round(n.domContentLoadedEventEnd), bytes: rec.reduce((a, r) => a + r.transferSize, 0) + n.transferSize }; });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 30_000 }).toBe('activated');
    const t1 = performance.now(); await page.reload(); await expect(page.locator('main h1').first()).toBeVisible(); const segunda = ms(t1);
    await ctx.close();
    return { primeraCargaMs: primera, ttfbMs: nav.ttfb, domContentLoadedMs: nav.dom, bytesTransferidos: nav.bytes, segundaCargaMs: segunda };
  };
  resultados.carga = { local: await medir(false), lenta3G_emulada: await medir(true) };
});

test('REN-02 · consultas a la API (Prefectura ve toda la escuela): latencia de 20 repeticiones y 50 peticiones concurrentes', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: 'America/Mexico_City' });
  const page = await ctx.newPage();
  await entrar(page, 'prefectura.piloto@ejemplo.test');
  await expect(page.getByRole('button', { name: 'Usar en este dispositivo' })).toBeVisible();
  const consultas: Record<string, unknown> = {};
  for (const t of ['inscripciones', 'sesiones', 'pases', 'asistencias']) {
    const xs: number[] = []; let bytes = 0;
    for (let i = 0; i < 20; i++) { const r = await cronometrar(page, `/api/escuelas/${p.escuelaId}/tablas/${t}`); xs.push(r.t); bytes = r.bytes; }
    consultas[t] = { ...estad(xs), bytes };
  }
  const xs: number[] = []; for (let i = 0; i < 20; i++) xs.push((await cronometrar(page, `/api/escuelas/${p.escuelaId}/sincronizacion?desde=0`)).t);
  consultas['sincronizacion?desde=0'] = estad(xs);
  resultados.consultasSecuenciales = consultas;
  // Concurrencia: 50 peticiones a la vez (simula a muchas personas consultando al mismo tiempo).
  const t0 = performance.now();
  const conc = await Promise.all(Array.from({ length: 50 }, (_, i) => cronometrar(page, `/api/escuelas/${p.escuelaId}/tablas/${['inscripciones', 'sesiones', 'pases', 'asistencias'][i % 4]}`)));
  resultados.concurrencia50 = { totalMs: ms(t0), ...estad(conc.map((c) => c.t)) };
  // Descarga inicial al «Usar en este dispositivo» (sincronización completa de la escuela).
  const t1 = performance.now();
  await page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${p.escuelaId}$`), { timeout: 120_000 });
  await expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 120_000 });
  resultados.descargaInicialEscuelaMs = ms(t1);
  await ctx.close();
});

test('REN-03 · guardar una lista en el teléfono → visible en el servidor (envío de la cola)', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  const page = await ctx.newPage();
  await entrarYUsar(page, 'docente.uno.piloto@ejemplo.test');
  const clase = claseDeHoy(p.docente.id);
  const xs: number[] = [];
  for (let i = 0; i < 3; i++) {
    await page.goto(`${URL}/#/lista/${clase.id}/${FECHA}`);
    await expect(page.locator('#estado-lista')).toBeVisible();
    const antes = (await pasesDe(page, clase.id))[0]?.correcciones ?? -1;
    const t0 = performance.now();
    await cambiarYGuardar(page, 5 + i);
    await expect.poll(async () => (await pasesDe(page, clase.id))[0]?.correcciones ?? -1, { timeout: 30_000, intervals: [100] }).toBe(antes + 1);
    xs.push(ms(t0));
  }
  resultados.guardarListaHastaServidorMs = estad(xs);
  await ctx.close();
});

test('REN-04 · recursos de los contenedores tras las pruebas (docker stats)', async () => {
  const salida = docker(...PROYECTO, 'ps', '-q').trim().split('\n').filter(Boolean);
  const stats = docker('stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}', ...salida).trim().split('\n').map((l) => { const [nombre, cpu, mem] = l.split('\t'); return { nombre, cpu, mem }; });
  resultados.recursos = stats;
  expect(stats.length).toBeGreaterThanOrEqual(3);
});
