import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { generarVolumen } from '../rendimiento/datos';

// Fase 9 — revisión de interfaz en teléfono, tableta y escritorio con la escuela FICTICIA de volumen.
// Revisa en cada pantalla: sin desplazamiento horizontal de la página y objetivos táctiles ≥ 44 px.
// Guarda capturas en test-results/ux/ para revisarlas a ojo.
const HOY = '2026-11-02';
const TAMANOS = [
  { nombre: 'telefono', width: 360, height: 780 },
  { nombre: 'tableta', width: 820, height: 1180 },
  { nombre: 'escritorio', width: 1280, height: 800 },
] as const;

interface Revision { pantalla: string; tamano: string; desbordeHorizontal: number; objetivosChicos: string[] }

async function revisar(page: Page, pantalla: string, tamano: string): Promise<Revision> {
  const r = await page.evaluate(() => {
    const desborde = document.documentElement.scrollWidth - window.innerWidth;
    const chicos: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main button, main a.boton, main select, main input:not([type=hidden]), header button, header a'))) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
      // Casillas y radios: cuenta la etiqueta que los envuelve o los acompaña (objetivo real).
      let alto = b.height;
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        const etiqueta = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        if (etiqueta) alto = Math.max(alto, etiqueta.getBoundingClientRect().height);
      }
      if (alto < 44) chicos.push(`${el.tagName.toLowerCase()}«${(el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 40)}» ${Math.round(alto)}px`);
    }
    return { desborde, chicos: [...new Set(chicos)] };
  });
  mkdirSync('test-results/ux', { recursive: true });
  await page.screenshot({ path: `test-results/ux/${tamano}-${pantalla}.png`, fullPage: false });
  return { pantalla, tamano, desbordeHorizontal: r.desborde, objetivosChicos: r.chicos };
}

test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });

test('interfaz en teléfono, tableta y escritorio (escuela ficticia de volumen)', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await page.clock.install({ time: new Date(`${HOY}T07:15:00-06:00`) });
  const v = generarVolumen(HOY);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/volumen-ux.json', JSON.stringify({ formato: 'gestion-escolar-respaldo-comprimido', versionFormato: 1, compresion: 'gzip', datos: gzipSync(v.contenido).toString('base64') }));
  await page.goto('/#/respaldos');
  await page.locator('#archivo-respaldo').setInputFiles('test-results/volumen-ux.json');
  await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 10 * 60_000 });
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 10 * 60_000 });

  // Docente del dispositivo: el primero de la lista (preferencia, no cuenta).
  await page.goto('/#/perfil');
  await page.getByRole('button', { name: 'Soy yo' }).first().click();
  await expect(page).toHaveURL(/#\/$/);

  const pantallas: [string, string][] = [
    ['mi-dia', '/#/'],
    ['pase-de-lista', `/#/lista/${v.sesionHoy}/${HOY}`],
    ['alumnos-grupo', `/#/alumnos/${v.grupoMuestra}`],
    ['horario-grupo', `/#/grupo/${v.grupoMuestra}`],
    ['panel-escuela', `/#/escuela/${v.escuelaId}`],
    ['alumnos-ciclo', `/#/ciclo/${v.cicloId}/alumnos`],
    ['importar', `/#/ciclo/${v.cicloId}/importar-datos`],
    ['horarios-ciclo', `/#/ciclo/${v.cicloId}/horarios`],
    ['prefectura-dia', `/#/ciclo/${v.cicloId}/prefectura/${HOY}`],
    ['prefectura-actividades', `/#/ciclo/${v.cicloId}/prefectura-actividades`],
    ['prefectura-reportes', `/#/ciclo/${v.cicloId}/prefectura-reportes`],
    ['respaldos', '/#/respaldos'],
    ['cuenta', '/#/cuenta'],
  ];
  const revisiones: Revision[] = [];
  const tiempos: string[] = [];
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.width, height: t.height });
    for (const [nombre, ruta] of pantallas) {
      // Se marca el encabezado anterior para esperar a que la pantalla nueva termine de pintarse.
      await page.evaluate(() => document.querySelectorAll('h1').forEach((x) => x.setAttribute('data-ux-viejo', '')));
      const t0 = Date.now();
      await page.goto(ruta);
      await expect(page.locator('main h1:not([data-ux-viejo])').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(300);
      tiempos.push(`${t.nombre}/${nombre}: ${Date.now() - t0} ms`);
      revisiones.push(await revisar(page, nombre, t.nombre));
    }
  }
  writeFileSync('test-results/ux.json', JSON.stringify(revisiones, null, 2));
  console.log(tiempos.join('\n'));
  const desbordes = revisiones.filter((r) => r.desbordeHorizontal > 1);
  console.log(revisiones.map((r) => `${r.tamano}/${r.pantalla}: desborde ${r.desbordeHorizontal}px; chicos ${r.objetivosChicos.length ? r.objetivosChicos.join(', ') : 'ninguno'}`).join('\n'));
  expect(desbordes.map((r) => `${r.tamano}/${r.pantalla} (${r.desbordeHorizontal}px)`)).toEqual([]);
  expect(revisiones.filter((r) => r.objetivosChicos.length).map((r) => `${r.tamano}/${r.pantalla}: ${r.objetivosChicos.join(', ')}`)).toEqual([]);
});
