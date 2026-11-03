import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generarVolumen } from './datos';

// Fase 9 — mediciones REALES (no estimadas) con datos ficticios de volumen.
// Se mide el tiempo de reloj desde la acción hasta que la pantalla muestra el resultado.
// Entorno: Chromium de escritorio en el contenedor de desarrollo (no es un teléfono real).
const HOY = '2026-11-02'; // lunes
const resultados: { medicion: string; ms: number; detalle?: string }[] = [];

async function medir<T>(medicion: string, fn: () => Promise<T>, detalle?: string): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  resultados.push({ medicion, ms: Date.now() - t0, detalle });
  return r;
}

test.describe.configure({ mode: 'serial' });
test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });

test('rendimiento con 1 escuela, 3 turnos, 30 grupos, 100 trabajadores, 1,500 alumnos y 3 semanas de asistencia', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await page.clock.install({ time: new Date(`${HOY}T07:15:00-06:00`) });
  const v = await medir('Generar datos ficticios (Node, fuera de la app)', async () => generarVolumen(HOY));
  const tamano = `${(v.contenido.length / 1024 / 1024).toFixed(1)} MB; asistencias ${v.conteos.asistencias}, pases ${v.conteos.pases}, sesiones ${v.conteos.sesiones}`;

  // Restauración (validación completa + escritura en IndexedDB)
  await page.goto('/#/respaldos');
  await medir('Leer y validar el respaldo (Zod, referencias, huella)', async () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/volumen.json', v.contenido);
    await page.locator('#archivo-respaldo').setInputFiles('test-results/volumen.json');
    await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 20 * 60_000 });
  }, tamano);
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await medir('Escribir el respaldo en IndexedDB (restaurar)', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 20 * 60_000 });
  });

  const ir = async (nombre: string, ruta: string, listo: (p: Page) => Promise<void>) => medir(nombre, async () => { await page.goto(ruta); await listo(page); });
  await ir('Panel de la escuela', `/#/escuela/${v.escuelaId}`, async (p) => { await expect(p.locator('#resumen-catalogos')).toContainText('1500'); });
  await ir('Lista de alumnos del ciclo (1,500)', `/#/ciclo/${v.cicloId}/alumnos`, async (p) => { await expect(p.locator('#resumen-alumnos')).toContainText('1500'); });
  await medir('Buscar un alumno por matrícula', async () => {
    await page.locator('#buscar-alumno').fill('MV-11234');
    await expect(page.locator('#lista-alumnos-titulo ~ div .renglon:visible')).toHaveCount(1);
  });
  await ir('Grupo: horario semanal', `/#/grupo/${v.grupoMuestra}`, async (p) => { await expect(p.locator('[data-periodo]').first()).toBeVisible(); });
  await ir('Grupo: asistencia del ciclo (50 alumnos, 3 semanas)', `/#/alumnos/${v.grupoMuestra}`, async (p) => { await expect(p.locator('.lista-resumen li')).toHaveCount(50); });
  await ir('Abrir pase de lista', `/#/lista/${v.sesionHoy}/${HOY}`, async (p) => { await expect(p.getByRole('button', { name: 'Guardar lista' })).toBeVisible(); });
  await medir('Guardar pase de lista (50 alumnos)', async () => {
    await page.getByRole('button', { name: 'Guardar lista' }).click();
    await expect(page.locator('.aviso')).toContainText('Lista guardada');
  });
  await ir('Revisión de horarios del ciclo (conflictos, 1,050 clases)', `/#/ciclo/${v.cicloId}/horarios`, async (p) => { await expect(p.getByRole('heading', { level: 1 })).toBeVisible(); await expect(p.locator('main')).toContainText(/conflicto/i); });
  await ir('Prefectura: panel del día', `/#/ciclo/${v.cicloId}/prefectura/${HOY}`, async (p) => { await expect(p.locator('#resumen-prefectura')).toBeVisible(); });
  await ir('Prefectura: reportes', `/#/ciclo/${v.cicloId}/prefectura-reportes`, async (p) => { await expect(p.getByRole('button', { name: 'Generar reporte' })).toBeVisible(); });
  await medir('Prefectura: generar reporte del mes', async () => {
    await page.locator('#f-reporte-periodo').selectOption('intervalo').catch(() => undefined);
    await page.getByRole('button', { name: 'Generar reporte' }).click();
    await expect(page.locator('#indicadores-reporte')).toBeVisible();
  });

  // Importación de 1,500 alumnos nuevos desde CSV
  await page.goto(`/#/ciclo/${v.cicloId}/importar-datos`);
  await page.getByRole('radio', { name: /^Alumnos/ }).check();
  await medir('Importación: leer y analizar 1,500 filas', async () => {
    await page.locator('#archivo-datos').setInputFiles({ name: 'alumnos-volumen.csv', mimeType: 'text/csv', buffer: Buffer.from(v.csvAlumnos) });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await expect(page.getByRole('button', { name: /Confirmar e importar \(1500\)/ })).toBeVisible({ timeout: 10 * 60_000 });
  });
  await medir('Importación: guardar 1,500 alumnos (transacción)', async () => {
    await page.getByRole('button', { name: /Confirmar e importar \(1500\)/ }).click();
    await expect(page.locator('#resultado-importacion')).toContainText('1500 registro(s) nuevo(s)', { timeout: 10 * 60_000 });
  });
  // Respaldo completo de la escuela (≈ 3,000 alumnos ya)
  await page.goto('/#/respaldos');
  await page.locator('#proteger-respaldo').uncheck();
  const descarga = page.waitForEvent('download', { timeout: 10 * 60_000 });
  await medir('Descargar respaldo sin cifrar de la escuela completa', async () => {
    await page.getByRole('button', { name: /Descargar/ }).first().click();
    await descarga;
  });

  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/rendimiento.json', JSON.stringify({ fecha: new Date().toISOString(), conteos: v.conteos, resultados }, null, 2));
  console.log(resultados.map((r) => `${r.medicion}: ${r.ms} ms${r.detalle ? ` (${r.detalle})` : ''}`).join('\n'));
});
