import { expect, test as base, type Page, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Fase 8B — cuenta del servidor escolar con un servidor REAL y una base de prueba.
// Sólo datos ficticios. Iniciar sesión no debe escribir nada en los datos locales.
const API = 'http://127.0.0.1:8788';

// Respuestas 401/403 esperadas (p. ej. acceso denegado) aparecen como «Failed to load resource».
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

async function codigoDelBuzon(request: APIRequestContext, correo: string): Promise<string> {
  const r = await request.get(`${API}/api/desarrollo/buzon?correo=${encodeURIComponent(correo)}`);
  const mensajes = (await r.json()) as { codigo: string | null }[];
  const codigo = mensajes.reverse().find((m) => m.codigo)?.codigo;
  if (!codigo) throw new Error('No llegó el código al buzón de desarrollo');
  return codigo;
}

function base32(texto: string): Buffer {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of texto.toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secreto: string): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hm = createHmac('sha1', base32(secreto)).update(buf).digest();
  const o = hm[hm.length - 1]! & 0x0f;
  return String((((hm[o]! & 0x7f) << 24) | (hm[o + 1]! << 16) | (hm[o + 2]! << 8) | hm[o + 3]!) % 1_000_000).padStart(6, '0');
}

async function entrar(page: Page, request: APIRequestContext, correo: string) {
  await page.goto('/#/cuenta');
  await page.getByLabel('Correo con el que te invitaron').fill(correo);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible(); // el servidor ya respondió
  await page.getByLabel('Código de 6 dígitos').fill(await codigoDelBuzon(request, correo));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('#datos-cuenta')).toContainText(correo);
}

test('inicio de sesión, verificación en dos pasos, invitación, permisos del servidor y revocación', async ({ page, browser, request }) => {
  // 1. Administrador: entra con código y el aviso deja claro que no se envían datos
  await entrar(page, request, 'admin.e2e@ejemplo.test');
  await expect(page.locator('#aviso-fase')).toContainText('NO envía ni sincroniza tus datos escolares');
  await expect(page.locator('#aviso-segundo-factor')).toContainText('exige la verificación en dos pasos');
  await expect(page.locator('#estado-segundo-factor')).toContainText('Obligatoria para tu rol');

  // Sin verificación en dos pasos, el SERVIDOR rechaza la administración
  await page.getByRole('link', { name: 'Administrar accesos' }).click();
  await expect(page.getByRole('alert')).toContainText('verificación en dos pasos');
  await page.getByRole('link', { name: 'Volver a la cuenta' }).click();

  // 2. Activa la verificación en dos pasos (como lo haría una app de autenticación)
  await page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
  await expect(page.locator('#codigos-respaldo li')).toHaveCount(10);
  const clave = (await page.locator('#clave-totp').textContent())!.replace(/\s/g, '');
  await page.getByLabel('Código de 6 dígitos que muestra la aplicación').fill(totp(clave));
  await page.getByRole('button', { name: 'Confirmar y activar' }).click();
  await expect(page.locator('#estado-segundo-factor')).toContainText('Activa');
  await expect(page.locator('#lista-sesiones')).toContainText('este dispositivo');

  // 3. Invita a un docente con correo personal: exige el consentimiento
  await page.getByRole('link', { name: 'Administrar accesos' }).click();
  await expect(page.locator('#lista-miembros')).toContainText('admin.e2e@ejemplo.test');
  const escuelaId = page.url().split('/').pop()!;
  await page.getByLabel('Nombre completo').fill('Docente Ficticia E2E');
  await page.locator('#f-invitar-correo').fill('docente.e2e@ejemplo.test');
  await page.getByLabel('Rol').selectOption({ label: 'Docente' });
  await page.getByLabel('Tipo de correo').selectOption('personal');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.locator('#f-invitar-consentimiento-error')).toContainText('consentimiento');
  await page.getByLabel(/La persona aceptó usar su correo personal/).check();
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.locator('[data-correo="docente.e2e@ejemplo.test"]')).toContainText('Invitación pendiente');
  await expect(page.locator('#lista-auditoria')).toContainText('Invitación enviada');

  // 4. El docente entra en otro dispositivo: no administra (lo impide el servidor, no un botón oculto)
  const otro = await browser.newContext({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  const docente = await otro.newPage();
  await entrar(docente, request, 'docente.e2e@ejemplo.test');
  await expect(docente.locator('#lista-accesos')).toContainText('Docente');
  await expect(docente.getByRole('link', { name: 'Administrar accesos' })).toHaveCount(0);
  await expect(docente.locator('#estado-segundo-factor')).toContainText('opcional para tu rol');
  await docente.goto(`/#/cuenta/escuela/${escuelaId}`);
  await expect(docente.getByRole('alert')).toContainText('No tienes permiso');

  // 5. El administrador revoca el acceso: la sesión del docente se cierra al instante
  await page.reload();
  await expect(page.locator('[data-correo="docente.e2e@ejemplo.test"]')).toContainText('Activo');
  await page.getByRole('button', { name: 'Revocar el acceso de Docente Ficticia E2E' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Cambio de escuela (ficticio)');
  await page.getByRole('dialog').getByRole('button', { name: 'Revocar' }).click();
  await expect(page.locator('[data-correo="docente.e2e@ejemplo.test"]')).toContainText('Revocado');
  await docente.goto('/#/cuenta');
  await expect(docente.getByLabel('Correo con el que te invitaron')).toBeVisible();
  await otro.close();

  // 6. Cerrar sesión en todos los dispositivos
  await page.goto('/#/cuenta');
  await page.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar todas' }).click();
  await expect(page.getByLabel('Correo con el que te invitaron')).toBeVisible();

  // 7. Nada de esto escribió en los datos locales del dispositivo
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: /Configurar mi escuela/ }).or(page.getByRole('button', { name: /Configurar mi escuela/ }))).toBeVisible();
  const escuelasLocales = await page.evaluate(() => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction('escuelas').objectStore('escuelas').count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }));
  expect(escuelasLocales).toBe(0);
});

test('una nueva sesión con verificación activa exige el código antes de continuar', async ({ page, request }) => {
  await page.goto('/#/cuenta');
  await page.getByLabel('Correo con el que te invitaron').fill('admin.e2e@ejemplo.test');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(await codigoDelBuzon(request, 'admin.e2e@ejemplo.test'));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByLabel('Código de tu aplicación de autenticación')).toBeVisible();
  await expect(page.locator('#datos-cuenta')).toHaveCount(0);
  await page.getByLabel('Código de tu aplicación de autenticación').fill('000000');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('#f-segundo-factor .resumen-errores')).toContainText('no es correcto');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByLabel('Correo con el que te invitaron')).toBeVisible();
});
