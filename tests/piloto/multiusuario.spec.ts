import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generarPiloto } from '../../piloto/datos';
import { alumno, radio } from './comun';

// Fase 10 — PILOTO MULTIUSUARIO con servidor REAL (servidorPiloto.ts) y cuentas con permisos REALES.
// Cada persona = un contexto de navegador propio (otro dispositivo). Datos FICTICIOS (DEMO-001).
const API = 'http://127.0.0.1:8789';
const FECHA = '2026-11-02';
interface Semilla { escuelaId: string; cicloId: string; otraEscuelaId: string; docente: { id: string; sesionHoyId: string } ; docenteAusente: { id: string } }
const semilla = () => JSON.parse(readFileSync('test-results/piloto-servidor.json', 'utf8')) as Semilla;
/** Clase del lunes 07:00 de la Docente Dos (mismos datos reproducibles que cargó el servidor). */
function sesionDocenteDos(): string {
  const p = generarPiloto({ escala: 0.1, semanas: 1, hoy: FECHA });
  const sesiones = (JSON.parse(p.contenido).datos.sesiones as { id: string; personalId: string; dia: number; periodoId: string }[]);
  return sesiones.find((s) => s.personalId === p.docenteAusente.id && s.dia === 1 && s.periodoId === p.turnos[0]!.periodos[0]!.id)!.id;
}

async function dispositivo(browser: Browser, correo: string, escuelaId: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/#/cuenta');
  await page.getByLabel('Correo con el que te invitaron').fill(correo);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  const r = await ctx.request.get(`${API}/api/desarrollo/buzon?correo=${encodeURIComponent(correo)}`);
  const codigo = ((await r.json()) as { codigo: string | null }[]).reverse().find((m) => m.codigo)!.codigo!;
  await page.getByLabel('Código de 6 dígitos').fill(codigo);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${escuelaId}$`), { timeout: 60_000 });
  await expect(page.locator('#demostracion')).toContainText('DEMOSTRACIÓN'); // también en el modo con servidor
  return { ctx, page };
}
const sincronizado = (page: Page) => expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 30_000 });
async function local(page: Page, tabla: string, filtro: { campo: string; valor: string }): Promise<number> {
  return page.evaluate(({ t, f }) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const q = r.result.transaction(t).objectStore(t).getAll(); q.onsuccess = () => { ok(q.result.filter((x: Record<string, string>) => x[f.campo] === f.valor).length); r.result.close(); }; };
  }), { t: tabla, f: filtro });
}

test.describe.configure({ mode: 'serial' });

test('PIL-MU-01 · dos docentes pasan lista AL MISMO TIEMPO en dispositivos distintos; Prefectura recibe ambas listas', async ({ browser }) => {
  const s = semilla();
  const uno = await dispositivo(browser, 'docente.uno.piloto@ejemplo.test', s.escuelaId);
  const dos = await dispositivo(browser, 'docente.dos.piloto@ejemplo.test', s.escuelaId);
  const pref = await dispositivo(browser, 'prefectura.piloto@ejemplo.test', s.escuelaId);
  expect(await local(pref.page, 'pases', { campo: 'fecha', valor: FECHA })).toBe(0);

  await uno.page.goto(`/#/lista/${s.docente.sesionHoyId}/${FECHA}`);
  await dos.page.goto(`/#/lista/${sesionDocenteDos()}/${FECHA}`);
  await radio(uno.page, alumno(1), 'Falta').check();
  await radio(dos.page, alumno(51), 'Retardo').check();
  await Promise.all([ // guardado simultáneo
    uno.page.getByRole('button', { name: 'Guardar lista' }).click(),
    dos.page.getByRole('button', { name: 'Guardar lista' }).click(),
  ]);
  await expect(uno.page.locator('.aviso').first()).toContainText(/guard/i);
  await expect(dos.page.locator('.aviso').first()).toContainText(/guard/i);
  // El servidor recibe ambas listas (consultadas con la sesión de Prefectura); el envío es automático.
  const enServidor = async () => ((await (await pref.page.request.get(`/api/escuelas/${s.escuelaId}/tablas/pases`)).json()) as { fecha: string }[]).filter((x) => x.fecha === FECHA).length;
  await expect.poll(enServidor, { timeout: 60_000 }).toBe(2);
  await Promise.all([sincronizado(uno.page), sincronizado(dos.page)]);
  // El dispositivo de Prefectura las recibe al sincronizar (actualización entre dispositivos)
  await pref.page.goto('/#/sincronizacion');
  await pref.page.getByRole('button', { name: 'Sincronizar ahora' }).first().click();
  await expect.poll(() => local(pref.page, 'pases', { campo: 'fecha', valor: FECHA }), { timeout: 30_000 }).toBe(2);
  for (const d of [uno, dos, pref]) await d.ctx.close();
});

test('PIL-MU-02 · cambios concurrentes sobre la MISMA lista en dos dispositivos: el segundo ve un CONFLICTO y decide (nada se sobrescribe en silencio)', async ({ browser }) => {
  const s = semilla();
  const a = await dispositivo(browser, 'docente.uno.piloto@ejemplo.test', s.escuelaId);
  const b = await dispositivo(browser, 'docente.uno.piloto@ejemplo.test', s.escuelaId); // la misma docente en otro dispositivo
  const lista = `/#/lista/${s.docente.sesionHoyId}/${FECHA}`;
  await a.page.goto(lista); await b.page.goto(lista);
  await expect(radio(b.page, alumno(1), 'Falta')).toBeChecked(); // B recibió la lista guardada en MU-01
  await a.ctx.setOffline(true); await b.ctx.setOffline(true);
  await radio(a.page, alumno(2), 'Retardo').check();
  await a.page.getByRole('button', { name: 'Guardar cambios' }).click();
  await a.page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await radio(b.page, alumno(2), 'Falta').check();
  await b.page.getByRole('button', { name: 'Guardar cambios' }).click();
  await b.page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await a.ctx.setOffline(false);
  await sincronizado(a.page);
  await b.ctx.setOffline(false);
  // Al volver la conexión B envía solo (en segundos) y el servidor responde CONFLICTO: no sobrescribe.
  await b.page.goto('/#/sincronizacion');
  await expect(async () => {
    await b.page.reload();
    await expect(b.page.locator(`#por-resolver-${s.escuelaId}`)).toContainText('Conflicto', { timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await expect(b.page.locator('#sincronizacion')).not.toContainText('Sincronizado');
  // Decisión explícita: usar la versión del servidor (la de A)
  await b.page.getByRole('button', { name: 'Usar la versión del servidor' }).first().click();
  await b.page.getByRole('dialog').getByRole('button', { name: 'Usar la del servidor' }).click();
  await expect(b.page.locator(`#por-resolver-${s.escuelaId}`)).toHaveCount(0, { timeout: 30_000 });
  await sincronizado(b.page);
  await b.page.goto(lista);
  // INC-04: la lista muestra lo guardado (la versión del servidor), no el borrador viejo de este dispositivo.
  await expect(b.page.locator('#estado-lista')).toHaveText(/MODIFICADA/);
  await expect(radio(b.page, alumno(2), 'Retardo')).toBeChecked();
  const asis = (await (await b.page.request.get(`/api/escuelas/${s.escuelaId}/tablas/asistencias`)).json()) as { fecha: string; marca: string }[];
  expect(asis.filter((x) => x.fecha === FECHA && x.marca === 'F')).toHaveLength(1); // sin duplicados ni mezclas
  await a.ctx.close(); await b.ctx.close();
});

test('PIL-MU-03 · sesiones independientes, restricciones de acceso y separación de escuelas', async ({ browser }) => {
  const s = semilla();
  const dos = await dispositivo(browser, 'docente.dos.piloto@ejemplo.test', s.escuelaId);
  const pref = await dispositivo(browser, 'prefectura.piloto@ejemplo.test', s.escuelaId);
  // Otra escuela: ni la docente ni Prefectura pueden leerla
  for (const d of [dos, pref]) {
    const r = await d.page.request.get(`/api/escuelas/${s.otraEscuelaId}/tablas/alumnos`);
    expect([403, 404]).toContain(r.status());
  }
  // Sin sesión: nada
  const anonimo = await browser.newContext();
  expect([401, 403]).toContain((await anonimo.request.get(`http://localhost:4181/api/escuelas/${s.escuelaId}/tablas/alumnos`)).status());
  await anonimo.close();
  // Cerrar la sesión de la docente no afecta la de Prefectura
  await dos.page.goto('/#/cuenta');
  await dos.page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await dos.page.getByRole('dialog').getByRole('button', { name: 'Quitar los datos de este dispositivo' }).click();
  expect([401, 403]).toContain((await dos.page.request.get(`/api/escuelas/${s.escuelaId}/tablas/pases`)).status());
  expect((await pref.page.request.get(`/api/escuelas/${s.escuelaId}/tablas/pases`)).status()).toBe(200);
  await dos.ctx.close(); await pref.ctx.close();
});
