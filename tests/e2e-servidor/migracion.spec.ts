import { expect, test as base, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Fase 8E — PILOTO INSTITUCIONAL FICTICIO: una escuela creada en el dispositivo (sin servidor)
// se migra a la escuela vacía del servidor con la misma CCT, en los 9 pasos, y el dispositivo
// pasa a la versión sincronizada. Sólo datos ficticios.
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
test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX', acceptDownloads: true });

async function codigo(request: APIRequestContext, correo: string) {
  const r = await request.get(`${API}/api/desarrollo/buzon?correo=${encodeURIComponent(correo)}`);
  return ((await r.json()) as { codigo: string | null }[]).reverse().find((m) => m.codigo)!.codigo!;
}
function base32(t: string) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let b = ''; for (const c of t) b += a.indexOf(c).toString(2).padStart(5, '0'); const y: number[] = []; for (let i = 0; i + 8 <= b.length; i += 8) y.push(parseInt(b.slice(i, i + 8), 2)); return Buffer.from(y); }
function totp(s: string) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', base32(s)).update(buf).digest(); const o = h[h.length - 1]! & 15; return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6).padStart(6, '0'); }

test('piloto: migrar una escuela del dispositivo al servidor en 9 pasos y pasar a la versión sincronizada', async ({ page, request }) => {
  const { migracion } = JSON.parse(readFileSync('test-results/semilla-e2e.json', 'utf8')) as { migracion: { escuelaId: string; cct: string; correo: string } };

  // Escuela creada SÓLO en el dispositivo (como hoy en las escuelas), con la CCT de la escuela del servidor
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia Piloto');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill(migracion.cct);
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Al grado').fill('1');
  await page.getByLabel('Grupos por grado').fill('2');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { name: 'Catálogos escolares' })).toBeVisible();

  // Administrador de la escuela del servidor: entra y activa la verificación en dos pasos
  await page.goto('/#/cuenta');
  await page.getByLabel('Correo con el que te invitaron').fill(migracion.correo);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(await codigo(request, migracion.correo));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
  const clave = (await page.locator('#clave-totp').textContent())!.replace(/\s/g, '');
  await page.getByLabel('Código de 6 dígitos que muestra la aplicación').fill(totp(clave));
  await page.getByRole('button', { name: 'Confirmar y activar' }).click();
  await expect(page.locator('#estado-segundo-factor')).toContainText('Activa');

  await page.getByRole('link', { name: 'Migrar una escuela de este dispositivo' }).click();
  await page.getByRole('button', { name: 'Comenzar' }).click();

  // 1. Respaldo cifrado obligatorio
  await page.getByLabel('Contraseña del respaldo').fill('Clave-ficticia-2026');
  await page.getByLabel('Repite la contraseña').fill('Clave-ficticia-2026');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo cifrado' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/\.cifrado\.json$/);
  // 2–3. Validar y preparar
  await page.getByRole('button', { name: 'Validar y preparar' }).click();
  await expect(page.locator('#pasos-migracion')).toContainText('Datos válidos');
  // 4–5. Ensayo (no escribe)
  await page.getByRole('button', { name: 'Hacer el ensayo' }).click();
  await expect(page.locator('#paso-4')).toContainText('Sin errores');
  // 6. Autorización
  await page.getByLabel('Nombre de quien autoriza').fill('Persona Directora Ficticia');
  await page.getByLabel('Cargo').fill('Dirección (ficticia)');
  await page.getByLabel(/aviso de privacidad de la escuela ya está publicado/).check();
  await page.getByLabel(/escribe la CCT de la escuela/).fill(migracion.cct);
  // 7. Migrar
  await page.getByRole('button', { name: 'Migrar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Migrar' }).click();
  // 8. Validación
  await expect(page.locator('#migracion-validada')).toContainText('la huella coincide');
  // 9. Usar la versión sincronizada
  await page.getByRole('button', { name: 'Usar la versión sincronizada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Usar la versión sincronizada' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${migracion.escuelaId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Escuela Secundaria Ficticia Piloto');
  await expect(page.locator('#sincronizacion')).toBeVisible();

  // El servidor tiene la escuela migrada y la migración registrada
  const grupos = (await (await page.request.get(`/api/escuelas/${migracion.escuelaId}/tablas/grupos`)).json()) as unknown[];
  expect(grupos).toHaveLength(2);
  await page.goto('/#/migracion');
  await expect(page.locator('#historial-migraciones')).toContainText('autorizó Persona Directora Ficticia');
});
