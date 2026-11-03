import { expect, test as base, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Fase 8D — una docente usa la escuela del servidor en su dispositivo, pasa lista SIN CONEXIÓN
// y, al volver la conexión, el cambio se envía solo. Datos ficticios (servidorPruebas.ts).
const API = 'http://127.0.0.1:8788';
const ESPERADOS = /Failed to load resource: the server responded with a status of (401|403)/;
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !ESPERADOS.test(m.text())) errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});
test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });

async function codigo(request: APIRequestContext, correo: string) {
  const r = await request.get(`${API}/api/desarrollo/buzon?correo=${encodeURIComponent(correo)}`);
  return ((await r.json()) as { codigo: string | null }[]).reverse().find((m) => m.codigo)!.codigo!;
}

test('trabajar sin conexión y sincronizar al volver la conexión, con indicador honesto', async ({ page, context, request }) => {
  const s = JSON.parse(readFileSync('test-results/semilla-e2e.json', 'utf8')) as { escuelaId: string; s1: string; hoy: string };
  const correo = 'docente.uno.e2e@ejemplo.test';
  await page.goto('/#/cuenta');
  await expect(page.locator('#sincronizacion')).toBeHidden(); // sin escuelas vinculadas: no hay indicador
  await page.getByLabel('Correo con el que te invitaron').fill(correo);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(await codigo(request, correo));
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Usar la escuela en este dispositivo: descarga sólo lo que su rol le permite ver
  await page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${s.escuelaId}$`));
  await expect(page.locator('#sincronizacion')).toBeVisible();

  // Sin conexión: pasar lista
  await context.setOffline(true);
  await page.goto(`/#/lista/${s.s1}/${s.hoy}`);
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('#avisos')).toContainText(/guard/i);
  await page.goto('/#/sincronizacion');
  await expect(page.locator(`.estado-sinc[data-escuela="${s.escuelaId}"]`)).toContainText('por enviar');
  await expect(page.locator('#sincronizacion')).toContainText('por enviar');
  await expect(page.locator('#sincronizacion')).not.toContainText('Sincronizado');

  // Vuelve la conexión: se envía sola
  await context.setOffline(false);
  await expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 15_000 });
  await page.reload();
  await expect(page.locator(`.estado-sinc[data-escuela="${s.escuelaId}"]`)).toContainText('no hay cambios por enviar');

  // El servidor tiene la lista (consultada con la sesión de la docente)
  const pases = await page.request.get(`/api/escuelas/${s.escuelaId}/tablas/pases`);
  const lista = (await pases.json()) as { sesionId: string; fecha: string }[];
  expect(lista.filter((p) => p.sesionId === s.s1 && p.fecha === s.hoy)).toHaveLength(1);
});
