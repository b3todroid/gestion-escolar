/// <reference types="node" />
import { expect, test as base, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Datos ficticios.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

async function crearEscuela(page: Page) {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre de la escuela').fill('Escuela Secundaria Ficticia 130');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0130A');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await page.getByRole('link', { name: 'Alumnos y asistencia de 1° A' }).click();
  await page.locator('#f-alumnos-lote-lote').fill('Alumna Ficticia, Ana\nAlumno Ficticio, Beto');
  await page.getByRole('button', { name: 'Agregar alumnos' }).click();
  await expect(page.locator('.lista-resumen li')).toHaveCount(2);
}

async function descargarRespaldo(page: Page): Promise<string> {
  await page.goto('/#/respaldos');
  const espera = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo de Escuela Secundaria Ficticia 130' }).click();
  const d = await espera;
  expect(d.suggestedFilename()).toMatch(/^respaldo-gestion-escolar-32ZZZ0130A-\d{4}-\d{2}-\d{2}\.json$/);
  // Tras descargar, la pantalla se actualiza; se espera como lo vería una persona.
  await expect(page.locator('.tarjeta', { hasText: 'Escuela Secundaria Ficticia 130' })).toContainText('Respaldo al día');
  return readFileSync((await d.path())!, 'utf8');
}

async function cargar(page: Page, contenido: string, nombre = 'respaldo.json') {
  await page.goto('/#/respaldos');
  await page.locator('#archivo-respaldo').setInputFiles({ name: nombre, mimeType: 'application/json', buffer: Buffer.from(contenido) });
  await expect(page.getByRole('heading', { name: `Revisión de «${nombre}»` })).toBeVisible();
}

test('descargar, y restaurar en otro dispositivo (navegador vacío)', async ({ page, browser }) => {
  await crearEscuela(page);
  await page.goto('/#/escuelas');
  await expect(page.getByText('tiene cambios sin respaldar')).toBeVisible();
  const respaldo = await descargarRespaldo(page);
  await expect(page.locator('.tarjeta', { hasText: 'Escuela Secundaria Ficticia 130' })).toContainText('Respaldo al día');
  const j = JSON.parse(respaldo);
  expect(j.formato).toBe('gestion-escolar-respaldo');
  expect(j.datos.alumnos).toHaveLength(2);

  const otro = await browser.newContext();
  const p2 = await otro.newPage();
  await cargar(p2, respaldo);
  await expect(p2.locator('.respaldo-escuela')).toContainText('Se agregará');
  await expect(p2.locator('.conteos-respaldo')).toContainText('Alumnos');
  await p2.getByRole('button', { name: 'Restaurar' }).click();
  await p2.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(p2.getByRole('link', { name: 'Escuela Secundaria Ficticia 130' })).toBeVisible();
  await p2.getByRole('link', { name: 'Escuela Secundaria Ficticia 130' }).click();
  await p2.getByRole('link', { name: 'Configurar' }).click();
  await p2.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await p2.getByRole('link', { name: 'Alumnos y asistencia de 1° A' }).click();
  await expect(p2.locator('.lista-resumen li')).toHaveCount(2);
  await otro.close();
});

test('reemplazar en el mismo dispositivo descarga antes una copia de los datos actuales', async ({ page }) => {
  await crearEscuela(page);
  const respaldo = await descargarRespaldo(page);
  // Cambio posterior al respaldo
  await page.goto('/#/escuelas');
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 130' }).click();
  await page.getByRole('link', { name: 'Editar datos' }).click();
  await page.getByLabel('Localidad o municipio').fill('Cambio posterior');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambio posterior')).toBeVisible();

  await cargar(page, respaldo);
  await expect(page.locator('.respaldo-escuela')).toContainText('Reemplazará los datos actuales');
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByRole('dialog')).toContainText('se descargará automáticamente una copia');
  const copia = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Reemplazar' }).click();
  expect((await copia).suggestedFilename()).toMatch(/^copia-antes-de-restaurar-/);
  await expect(page.locator('.aviso')).toContainText('Restauración completa');
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 130' }).click();
  await expect(page.getByText('Cambio posterior')).toHaveCount(0);
});

test('un archivo alterado se rechaza y no se modifica nada', async ({ page }) => {
  await crearEscuela(page);
  const respaldo = await descargarRespaldo(page);
  const alterado = respaldo.replace('"Ana"', '"Otra"');
  await cargar(page, alterado, 'alterado.json');
  await expect(page.locator('.importacion')).toContainText('fue modificado o está dañado');
  await expect(page.getByRole('button', { name: 'Restaurar' })).toHaveCount(0);
  await cargar(page, 'esto no es un respaldo', 'texto.json');
  await expect(page.locator('.importacion')).toContainText('no se pudo leer');
});
