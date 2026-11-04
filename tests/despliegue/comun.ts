import { expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { generarPiloto } from '../../piloto/datos';

// Utilidades de las pruebas contra la PREPRODUCCIÓN local en contenedores (Fases 11 y 12).
export const URL = process.env.URL_PREPRODUCCION ?? 'https://localhost:8443';
export const BUZON = process.env.URL_BUZON_PRUEBA ?? 'http://127.0.0.1:8025';
export const PROYECTO = ['compose', '-p', 'gestion-preprod', '-f', 'deploy/docker-compose.yml', '-f', 'deploy/compose.preproduccion.yml', '--env-file', 'deploy/preproduccion.env'];
export const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const FECHA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
/** DEMO-001 tal como la carga la preproducción (mismos identificadores estables). */
export const p = generarPiloto({ escala: 0.2, semanas: 2, hoy: FECHA });
const datos = JSON.parse(p.contenido).datos as { sesiones: { id: string; personalId: string; dia: number; grupoId: string; periodoId: string }[] };
const diaHoy = Math.min(((new Date(`${FECHA}T12:00:00Z`).getUTCDay() + 6) % 7) + 1, 5);
/** Primera clase de HOY de un docente (o del viernes si hoy es fin de semana). */
export const claseDeHoy = (personalId: string) => datos.sesiones.find((s) => s.personalId === personalId && s.dia === diaHoy)!;

/** Último código de acceso enviado POR SMTP a ese correo (leído del buzón de prueba). */
export async function codigoPorCorreo(ctx: BrowserContext, correo: string, despuesDe: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await ctx.request.get(`${BUZON}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    const { messages } = (await r.json()) as { messages: { ID: string; Created: string }[] };
    const nuevo = messages.find((m) => Date.parse(m.Created) >= despuesDe - 2000);
    if (nuevo) {
      const m = (await (await ctx.request.get(`${BUZON}/api/v1/message/${nuevo.ID}`)).json()) as { Text: string };
      const c = /\b(\d{6})\b/.exec(m.Text)?.[1];
      if (c) return c;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('No llegó el código por SMTP');
}

export async function entrar(page: Page, correo: string) {
  await page.goto(`${URL}/#/cuenta`);
  await page.getByLabel('Correo con el que te invitaron').fill(correo);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(await codigoPorCorreo(page.context(), correo, t0));
  await page.getByRole('button', { name: 'Entrar' }).click();
}
/** Entra y usa DEMO-001 en este dispositivo (descarga lo que su rol permite ver). */
export async function entrarYUsar(page: Page, correo: string) {
  await entrar(page, correo);
  await page.getByRole('button', { name: 'Usar en este dispositivo' }).click();
  await expect(page).toHaveURL(new RegExp(`#/escuela/${p.escuelaId}$`), { timeout: 60_000 });
}
export const lista = (page: Page) => page.request.get(`${URL}/api/salud/lista`).then((r) => r.status());
/** Cambia la marca del alumno n (a F o R, la que no tenga) y guarda: lista nueva o corrección. */
export async function cambiarYGuardar(page: Page, n: number) {
  const grupo = page.getByRole('radiogroup').nth(n);
  // Nunca «Retardo»: depende de la hora REAL (la llegada no puede ser antes del inicio de la clase).
  const nueva = (await grupo.getByRole('radio', { name: 'Falta' }).isChecked()) ? 'Presente' : 'Falta';
  await grupo.getByRole('radio', { name: nueva }).check();
  if (await page.getByRole('button', { name: 'Guardar lista' }).isVisible()) await page.getByRole('button', { name: 'Guardar lista' }).click();
  else {
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  }
  // Si la app rechaza el guardado (aviso de error), la prueba falla aquí con el motivo visible.
  await expect(page.locator('#estado-lista')).not.toContainText('EN CAPTURA', { timeout: 15_000 });
  return nueva;
}
export const pasesDe = async (page: Page, sesionId: string) => ((await (await page.request.get(`${URL}/api/escuelas/${p.escuelaId}/tablas/pases`)).json()) as { id: string; fecha: string; sesionId: string; correcciones: number }[])
  .filter((x) => x.fecha === FECHA && x.sesionId === sesionId);
export const sincronizado = (page: Page) => expect(page.locator('#sincronizacion')).toContainText('✓ Sincronizado', { timeout: 60_000 });
