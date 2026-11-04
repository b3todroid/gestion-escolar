import { devices, expect, test } from '@playwright/test';
import { URL } from './comun';

// Fase 12 — PRUEBAS MULTIDISPOSITIVO de la PWA servida por HTTPS desde la PREPRODUCCIÓN local.
// IMPORTANTE: todo es EMULACIÓN en Chromium (tamaño de pantalla, toque, agente de usuario). El perfil
// «iPhone» NO es Safari/WebKit (no está instalado en este entorno): sólo prueba el diseño a ese tamaño.
// Ningún dispositivo físico se usó.
const PERFILES = [
  { nombre: 'Android (Pixel 7)', perfil: 'Pixel 7' },
  { nombre: 'Tableta Android (Galaxy Tab S4)', perfil: 'Galaxy Tab S4' },
  { nombre: 'iPhone 13 — sólo tamaño, en Chromium', perfil: 'iPhone 13' },
  { nombre: 'Windows / escritorio (Chromium)', perfil: 'Desktop Chrome' },
] as const;
const PANTALLAS = ['/#/', '/#/cuenta', '/#/aplicacion', '/#/respaldos', '/#/asistente'];

for (const d of PERFILES) {
  test(`DIS · ${d.nombre}: HTTPS, PWA instalable, sin conexión tras la primera carga, sin desbordes ni botones chicos`, async ({ browser }) => {
    const { defaultBrowserType: _tipo, ...perfil } = devices[d.perfil];
    const ctx = await browser.newContext({ ...perfil, ignoreHTTPSErrors: true, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
    const page = await ctx.newPage();
    const r = await page.goto(`${URL}/`);
    expect(r!.status()).toBe(200);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 20_000 }).toBe('activated');
    // Instalabilidad según el propio Chromium (manifiesto, íconos, Service Worker, HTTPS).
    const cdp = await ctx.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors, JSON.stringify(installabilityErrors)).toEqual([]);
    const manifiesto = (await (await page.request.get(`${URL}/manifest.webmanifest`)).json()) as { display: string; icons: { sizes: string }[] };
    expect(manifiesto.display).toBe('standalone');
    expect(manifiesto.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBe(1); // ícono para la pantalla de inicio de iOS
    // Diseño adaptable: sin desplazamiento horizontal y objetivos táctiles ≥ 44 px.
    for (const ruta of PANTALLAS) {
      await page.goto(`${URL}${ruta}`);
      await expect(page.locator('main h1').first()).toBeVisible();
      const problemas = await page.evaluate(() => {
        const desborde = document.documentElement.scrollWidth - window.innerWidth;
        const chicos = [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main input:not([type=hidden]), main select')]
          .filter((el) => { const b = el.getBoundingClientRect(); if (!b.width || !b.height) return false; const et = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null); return Math.max(b.height, et?.getBoundingClientRect().height ?? 0) < 44; })
          .map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? el.id).trim().slice(0, 30));
        return { desborde, chicos };
      });
      expect(problemas.desborde, `${ruta}: desborde horizontal`).toBeLessThanOrEqual(1);
      expect(problemas.chicos, `${ruta}: objetivos < 44 px`).toEqual([]);
    }
    // Sin conexión: la app vuelve a abrir desde el Service Worker.
    await ctx.setOffline(true);
    await page.goto(`${URL}/#/aplicacion`);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('#conexion')).toContainText('Sin conexión');
    await ctx.setOffline(false);
    await ctx.close();
  });
}
