import { expect, test as base } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Fase 8B — sin servidor escolar en marcha, la aplicación sigue en modo local (decisión D9).
// El intermediario de la vista previa responde 5xx al no encontrar el servidor: es lo esperado.
const ESPERADOS = /Failed to load resource: the server responded with a status of 50\d/;
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !ESPERADOS.test(m.text())) errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

test('sin servidor, la cuenta indica modo local y la aplicación sigue funcionando', async ({ page }) => {
  await page.goto('/#/aplicacion');
  await page.getByRole('link', { name: 'Cuenta del servidor escolar (en prueba)' }).click();
  await expect(page.locator('#estado-servidor')).toContainText('Modo local: sin servidor escolar');
  await expect(page.locator('#aviso-fase')).toContainText('por sí solo, NO envía tus datos escolares');
  await expect(page.getByLabel('Correo con el que te invitaron')).toHaveCount(0);
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('la aplicación compilada no contiene secretos ni código del servidor', async () => {
  const archivos: string[] = [];
  const recorrer = (d: string) => { for (const a of readdirSync(d)) { const r = join(d, a); if (statSync(r).isDirectory()) recorrer(r); else if (/\.(m?js|html)$/.test(a)) archivos.push(r); } };
  recorrer('dist');
  expect(archivos.length).toBeGreaterThan(0);
  for (const a of archivos) {
    if (a.includes(`${join('dist', 'ocr')}`)) continue; // biblioteca de OCR de terceros
    const t = readFileSync(a, 'utf8');
    expect(t, a).not.toMatch(/BETTER_AUTH_SECRET|DATABASE_URL|CLIENT_SECRET|postgres(ql)?:\/\/|better-auth|solo-desarrollo-local/);
  }
});
