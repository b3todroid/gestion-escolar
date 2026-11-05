import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BUZON, cambiarYGuardar, claseDeHoy, codigoPorCorreo, entrar, entrarYUsar, FECHA, p, sincronizado, URL } from '../despliegue/comun';

// CAPTURAS del MANUAL: pantallas que dependen del SERVIDOR ESCOLAR, contra la PREPRODUCCIÓN local
// (https://localhost:8443, DEMO-001 y cuentas FICTICIAS *.piloto@ejemplo.test). Cada paso se intenta y se anota.
const DIR = 'manual-capturas/img';
mkdirSync(DIR, { recursive: true });
const registro: { nombre: string; ok: boolean; error?: string }[] = [];
async function foto(page: Page, nombre: string, completa = true) {
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelectorAll('#avisos > *').forEach((e) => e.remove()); const st = document.createElement('style'); st.id = 'manual-estatico'; st.textContent = '.barra{position:static !important}'; document.head.append(st); });
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  const vp = page.viewportSize()!;
  await page.screenshot({ path: `${DIR}/${nombre}.jpg`, type: 'jpeg', quality: 82, fullPage: completa, clip: completa ? { x: 0, y: 0, width: vp.width, height: Math.min(alto, 2400) } : undefined });
  await page.evaluate(() => document.getElementById('manual-estatico')?.remove());
}
async function paso(nombre: string, fn: () => Promise<void>) {
  try { await fn(); registro.push({ nombre, ok: true }); }
  catch (e) { registro.push({ nombre, ok: false, error: String((e as Error).message).split('\n')[0]!.slice(0, 300) }); }
}
async function equipo(browser: Browser) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], deviceScaleFactor: 1.5, viewport: { width: 1280, height: 860 }, ignoreHTTPSErrors: true, timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  return { ctx, page: await ctx.newPage() };
}
function base32(texto: string): Buffer {
  const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of texto.toUpperCase()) bits += al.indexOf(c).toString(2).padStart(5, '0');
  const b: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) b.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(b);
}
function totp(s: string): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', base32(s)).update(buf).digest(); const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6).padStart(6, '0');
}

test.describe.configure({ mode: 'serial' });
test.afterAll(() => writeFileSync('manual-capturas/registro-servidor.json', JSON.stringify(registro, null, 2)));

test('S · cuenta, sincronización, conflicto, accesos, verificación en dos pasos y migración', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const uno = await equipo(browser);
  const lista = `${URL}/#/lista/${claseDeHoy(p.docente.id).id}/${FECHA}`;

  await paso('S01 entrar', async () => {
    await uno.page.goto(`${URL}/#/cuenta`); await expect(uno.page.locator('main h1')).toBeVisible();
    await foto(uno.page, 's01-cuenta-entrar');
    await uno.page.getByLabel('Correo con el que te invitaron').fill('docente.uno.piloto@ejemplo.test');
    const t0 = Date.now();
    await uno.page.getByRole('button', { name: 'Enviar código' }).click();
    await expect(uno.page.getByLabel('Código de 6 dígitos')).toBeVisible();
    await foto(uno.page, 's02-cuenta-codigo');
    const codigo = await codigoPorCorreo(uno.ctx, 'docente.uno.piloto@ejemplo.test', t0);
    await uno.page.getByLabel('Código de 6 dígitos').fill(codigo);
    await uno.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(uno.page.getByRole('button', { name: 'Usar en este dispositivo' })).toBeVisible();
    await foto(uno.page, 's03-cuenta-usar-en-dispositivo');
  });
  await paso('S04 buzon de prueba', async () => {
    const b = await uno.ctx.newPage(); await b.setViewportSize({ width: 1280, height: 760 });
    await b.goto(BUZON); await b.waitForTimeout(1500); await foto(b, 's04-buzon-prueba', false);
    await b.locator('.message, a[href*="view"], tr').filter({ hasText: 'docente.uno' }).first().click().catch(() => undefined);
    await b.waitForTimeout(1500); await foto(b, 's05-buzon-correo-codigo', false); await b.close();
  });
  await paso('S06 usar en dispositivo', async () => {
    await uno.page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
    await expect(uno.page).toHaveURL(new RegExp(`#/escuela/${p.escuelaId}$`), { timeout: 60_000 });
    await sincronizado(uno.page);
    await foto(uno.page, 's06-escuela-sincronizada', false);
    await uno.page.goto(`${URL}/#/cuenta`); await expect(uno.page.locator('#datos-cuenta')).toBeVisible(); await foto(uno.page, 's07-cuenta-docente');
    await uno.page.goto(`${URL}/#/sincronizacion`); await foto(uno.page, 's08-sincronizacion-al-dia');
  });
  await paso('S09 sin conexion', async () => {
    await uno.page.goto(lista); await expect(uno.page.locator('#estado-lista')).toBeVisible();
    await uno.ctx.setOffline(true);
    await cambiarYGuardar(uno.page, 0);
    await expect(uno.page.locator('#sincronizacion')).toContainText('por enviar');
    await foto(uno.page, 's09-sin-conexion-por-enviar', false);
    await uno.page.goto(`${URL}/#/sincronizacion`); await foto(uno.page, 's10-sincronizacion-pendientes');
    await uno.ctx.setOffline(false); await sincronizado(uno.page);
  });
  await paso('S11 conflicto', async () => {
    const otro = await equipo(browser);
    await entrarYUsar(otro.page, 'docente.uno.piloto@ejemplo.test');
    await uno.page.goto(lista); await otro.page.goto(lista);
    await expect(uno.page.locator('#estado-lista')).toBeVisible(); await expect(otro.page.locator('#estado-lista')).toBeVisible();
    await uno.ctx.setOffline(true); await otro.ctx.setOffline(true);
    await cambiarYGuardar(uno.page, 2); await cambiarYGuardar(otro.page, 2);
    await uno.ctx.setOffline(false); await sincronizado(uno.page);
    await otro.ctx.setOffline(false);
    await otro.page.goto(`${URL}/#/sincronizacion`);
    await expect(async () => { await otro.page.reload(); await expect(otro.page.locator(`#por-resolver-${p.escuelaId}`)).toContainText('Conflicto', { timeout: 2_000 }); }).toPass({ timeout: 45_000 });
    await foto(otro.page, 's11-sincronizacion-conflicto');
    await otro.page.getByRole('button', { name: 'Usar la versión del servidor' }).first().click();
    await foto(otro.page, 's12-conflicto-confirmar', false);
    await otro.page.getByRole('dialog').getByRole('button', { name: 'Usar la del servidor' }).click();
    await sincronizado(otro.page);
    await otro.ctx.close();
  });
  await paso('S13 cerrar sesion (dialogo)', async () => {
    await uno.page.goto(`${URL}/#/cuenta`);
    await uno.page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(uno.page.getByRole('dialog')).toBeVisible();
    await foto(uno.page, 's13-cerrar-sesion', false);
    await uno.page.keyboard.press('Escape');
  });
  await uno.ctx.close();

  const adm = await equipo(browser);
  await paso('S14 administracion y 2FA', async () => {
    await entrar(adm.page, 'administrador.piloto@ejemplo.test');
    await expect(adm.page.locator('#datos-cuenta')).toBeVisible({ timeout: 30_000 });
    await foto(adm.page, 's14-cuenta-admin-sin-2fa');
    await adm.page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
    await expect(adm.page.locator('#codigos-respaldo li')).toHaveCount(10);
    await foto(adm.page, 's15-activar-2fa');
    const clave = (await adm.page.locator('#clave-totp').textContent())!.replace(/\s/g, '');
    await adm.page.getByLabel('Código de 6 dígitos que muestra la aplicación').fill(totp(clave));
    await adm.page.getByRole('button', { name: 'Confirmar y activar' }).click();
    await expect(adm.page.locator('#estado-segundo-factor')).toContainText('Activa');
    await foto(adm.page, 's16-cuenta-admin-2fa-activa');
  });
  await paso('S17 accesos de la escuela', async () => {
    await adm.page.getByRole('link', { name: 'Administrar accesos' }).first().click();
    await expect(adm.page.locator('#lista-miembros')).toBeVisible();
    await foto(adm.page, 's17-accesos-escuela');
    const f = adm.page.locator('#f-invitar');
    await adm.page.locator('#f-invitar-nombre').fill('Docente Tres (ficticio)');
    await adm.page.locator('#f-invitar-correo').fill('docente.tres.piloto@ejemplo.test');
    await adm.page.locator('#f-invitar-rol').selectOption('docente');
    await f.scrollIntoViewIfNeeded();
    await foto(adm.page, 's18-invitar-persona');
    await f.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(adm.page.locator('#lista-miembros')).toContainText('docente.tres.piloto@ejemplo.test');
    await foto(adm.page, 's19-accesos-con-invitacion');
  });
  await paso('S20 migracion', async () => { await adm.page.goto(`${URL}/#/migracion`); await expect(adm.page.locator('main h1')).toBeVisible(); await foto(adm.page, 's20-migracion'); });
  await adm.ctx.close();
});
