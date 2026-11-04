import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { cambiarYGuardar, claseDeHoy, entrarYUsar, FECHA, p, pasesDe, sincronizado, URL } from './comun';

// Fase 12 — PRUEBAS MULTIUSUARIO contra la PREPRODUCCIÓN local en contenedores (HTTPS, SMTP de prueba,
// PostgreSQL con RLS). Cada persona usa un NAVEGADOR INDEPENDIENTE (contexto propio: cookies e
// IndexedDB separadas) con otro perfil de dispositivo EMULADO. Nunca pestañas que comparten datos.
const UNO = 'docente.uno.piloto@ejemplo.test';
const DOS = 'docente.dos.piloto@ejemplo.test';
const PREFECTURA = 'prefectura.piloto@ejemplo.test';
const claseUno = claseDeHoy(p.docente.id);
const sesiones = (JSON.parse(p.contenido).datos as { sesiones: { personalId: string; grupoId: string }[] }).sesiones;
const claseDos = claseDeHoy(p.docenteAusente.id);

async function dispositivo(browser: Browser, perfil: keyof typeof devices): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices[perfil], ignoreHTTPSErrors: true, timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  return { ctx, page: await ctx.newPage() };
}
const salidasDe = async (page: Page, sesionId: string) => ((await (await page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/salidas`)).json()) as { sesionId: string; fecha: string; regreso: string | null }[])
  .filter((x) => x.fecha === FECHA && x.sesionId === sesionId);

test.describe.configure({ mode: 'serial' });
let uno: Awaited<ReturnType<typeof dispositivo>>; let dos: Awaited<ReturnType<typeof dispositivo>>; let pref: Awaited<ReturnType<typeof dispositivo>>;
test.beforeAll(async ({ browser }) => {
  uno = await dispositivo(browser, 'Pixel 7');
  dos = await dispositivo(browser, 'Desktop Chrome');
  pref = await dispositivo(browser, 'Galaxy Tab S4');
});
test.afterAll(async () => { for (const d of [uno, dos, pref]) await d?.ctx.close(); });

test('MUP-01 · dos docentes inician sesiones independientes (teléfono y computadora) y consultan su horario', async () => {
  await entrarYUsar(uno.page, UNO);
  await entrarYUsar(dos.page, DOS);
  for (const [d, id] of [[uno, p.docente.id], [dos, p.docenteAusente.id]] as const) {
    await d.page.goto(`${URL}/#/personal/${id}/ciclo/${p.cicloId}`);
    await expect(d.page.locator('main')).toContainText(/CLASE/);
  }
  // Cookies distintas: cerrar la sesión de una no cierra la otra (se comprueba en MUP-05).
  const c1 = (await uno.ctx.cookies()).find((c) => c.name.includes('session'))?.value;
  const c2 = (await dos.ctx.cookies()).find((c) => c.name.includes('session'))?.value;
  expect(c1).toBeTruthy(); expect(c2).toBeTruthy(); expect(c1).not.toBe(c2);
});

test('MUP-02 · ambas registran asistencia al mismo tiempo; se sincroniza y Prefectura (tableta) ve las dos listas', async () => {
  await uno.page.goto(`${URL}/#/lista/${claseUno.id}/${FECHA}`);
  await dos.page.goto(`${URL}/#/lista/${claseDos.id}/${FECHA}`);
  await expect(uno.page.locator('#estado-lista')).toBeVisible(); await expect(dos.page.locator('#estado-lista')).toBeVisible();
  await Promise.all([cambiarYGuardar(uno.page, 0), cambiarYGuardar(dos.page, 0)]);
  await expect.poll(async () => (await pasesDe(uno.page, claseUno.id)).length, { timeout: 30_000 }).toBe(1);
  await expect.poll(async () => (await pasesDe(dos.page, claseDos.id)).length, { timeout: 30_000 }).toBe(1);
  await Promise.all([sincronizado(uno.page), sincronizado(dos.page)]);
  await entrarYUsar(pref.page, PREFECTURA);
  expect((await pasesDe(pref.page, claseUno.id)).length).toBe(1);
  expect((await pasesDe(pref.page, claseDos.id)).length).toBe(1);
});

test('MUP-03 · desconexión: la docente dos corrige la lista y registra una salida SIN RED; al reconectar se envía y no se duplica', async () => {
  const antes = (await pasesDe(dos.page, claseDos.id))[0]!.correcciones;
  const salidasAntes = (await salidasDe(dos.page, claseDos.id)).length;
  await dos.ctx.setOffline(true);
  await dos.page.goto(`${URL}/#/lista/${claseDos.id}/${FECHA}`);
  await cambiarYGuardar(dos.page, 1);
  await dos.page.getByRole('button', { name: /^Salida al baño de / }).and(dos.page.locator(':enabled')).nth(3).click();
  await expect(dos.page.locator('#fuera-lista')).toBeVisible();
  await expect(dos.page.locator('#sincronizacion')).toContainText('por enviar');
  await expect(dos.page.locator('#sincronizacion')).not.toContainText('Sincronizado');
  await dos.ctx.setOffline(false);
  await sincronizado(dos.page);
  const pases = await pasesDe(dos.page, claseDos.id);
  expect(pases).toHaveLength(1);
  expect(pases[0]!.correcciones).toBe(antes + 1);
  expect((await salidasDe(dos.page, claseDos.id)).length).toBe(salidasAntes + 1);
});

test('MUP-04 · conflicto: la misma docente cambia la MISMA lista en dos dispositivos sin red; el segundo ve CONFLICTO y decide', async ({ browser }) => {
  const otro = await dispositivo(browser, 'Desktop Chrome'); // segundo dispositivo de la docente uno
  await entrarYUsar(otro.page, UNO);
  const lista = `${URL}/#/lista/${claseUno.id}/${FECHA}`;
  await uno.page.goto(lista); await otro.page.goto(lista);
  await expect(uno.page.locator('#estado-lista')).toBeVisible(); await expect(otro.page.locator('#estado-lista')).toBeVisible();
  await uno.ctx.setOffline(true); await otro.ctx.setOffline(true);
  const marcaA = await cambiarYGuardar(uno.page, 2);
  await cambiarYGuardar(otro.page, 2);
  await uno.ctx.setOffline(false);
  await sincronizado(uno.page);
  await otro.ctx.setOffline(false);
  await otro.page.goto(`${URL}/#/sincronizacion`);
  await expect(async () => {
    await otro.page.reload();
    await expect(otro.page.locator(`#por-resolver-${p.escuelaId}`)).toContainText('Conflicto', { timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await expect(otro.page.locator('#sincronizacion')).not.toContainText('Sincronizado');
  await otro.page.getByRole('button', { name: 'Usar la versión del servidor' }).first().click();
  await otro.page.getByRole('dialog').getByRole('button', { name: 'Usar la del servidor' }).click();
  await sincronizado(otro.page);
  await otro.page.goto(lista);
  await expect(otro.page.getByRole('radiogroup').nth(2).getByRole('radio', { name: marcaA })).toBeChecked(); // quedó la del servidor
  expect(await pasesDe(otro.page, claseUno.id)).toHaveLength(1);
  await otro.ctx.close();
});

test('MUP-05 · permisos: cada docente ve sólo sus grupos; Prefectura ve la escuela; nadie invita sin permiso; cerrar una sesión no afecta a otra', async () => {
  // Cada docente ve SÓLO los grupos donde da clase (RLS «g»). En DEMO-001 ambas docentes comparten
  // grupos del bloque 0 del matutino; ninguna ve los grupos del vespertino ni los demás.
  const gruposDe = (id: string) => new Set(sesiones.filter((x) => x.personalId === id).map((x) => x.grupoId));
  const visibles = async (page: Page) => new Set(((await (await page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/inscripciones`)).json()) as { grupoId: string | null }[]).map((x) => x.grupoId).filter(Boolean) as string[]);
  for (const [d, id] of [[uno, p.docente.id], [dos, p.docenteAusente.id]] as const) {
    const propios = gruposDe(id); const vistos = await visibles(d.page);
    expect(vistos.size).toBeGreaterThan(0);
    expect([...vistos].every((g) => propios.has(g)), 'sólo sus grupos').toBe(true);
    expect(vistos.size).toBeLessThan(p.grupos.length); // no ve toda la escuela
  }
  expect((await visibles(pref.page)).size).toBe(p.grupos.length); // Prefectura: toda la escuela
  expect((await pasesDe(pref.page, claseUno.id)).length).toBe(1);
  for (const d of [dos, pref]) {
    const r = await d.page.request.post(`${URL}/api/escuelas/${p.escuelaId}/invitaciones`, { headers: { origin: URL }, data: { nombre: 'X', correo: 'x@ejemplo.test', rol: 'administrador', tipoCorreo: 'institucional' } });
    expect([403, 404]).toContain(r.status());
  }
  // Cerrar la sesión de la docente dos (quitando sus datos del dispositivo) no cierra la de la docente uno.
  await dos.page.goto(`${URL}/#/cuenta`);
  await dos.page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await dos.page.getByRole('dialog').getByRole('button', { name: 'Quitar los datos de este dispositivo' }).click();
  expect([401, 403]).toContain((await dos.page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/pases`)).status());
  expect((await uno.page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/pases`)).status()).toBe(200);
});
