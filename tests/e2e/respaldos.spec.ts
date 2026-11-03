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
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 130');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0130A');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await page.getByRole('link', { name: 'Administrar grupos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await page.getByRole('link', { name: 'Alumnos y asistencia de 1° A' }).click();
  await page.locator('#f-alumnos-lote-lote').fill('Alumna Ficticia, Ana\nAlumno Ficticio, Beto');
  await page.getByRole('button', { name: 'Agregar alumnos' }).click();
  await expect(page.locator('.lista-resumen li')).toHaveCount(2);
}

async function descargarRespaldo(page: Page): Promise<string> {
  await page.goto('/#/respaldos');
  await page.getByLabel(/Proteger con contraseña/).uncheck(); // estas pruebas usan el formato sin cifrar
  await expect(page.getByText('Sin contraseña, cualquiera que obtenga el archivo')).toBeVisible();
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
  await expect(p2.locator('#informe-restauracion')).toContainText('Restauración completa');
  await expect(p2.locator('#informe-restauracion')).toContainText('Alumnos: 2');
  await p2.getByRole('link', { name: 'Ver escuelas' }).click();
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
  await page.getByLabel('Municipio o alcaldía').fill('Cambio posterior');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.datos').getByText('Cambio posterior')).toBeVisible();

  await cargar(page, respaldo);
  await expect(page.locator('.respaldo-escuela')).toContainText('Reemplazará los datos actuales');
  await expect(page.locator('.conflicto-posterior')).toContainText('creados o modificados después de la fecha del respaldo');
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByRole('dialog')).toContainText('se descargará automáticamente una copia');
  const copia = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Reemplazar' }).click();
  expect((await copia).suggestedFilename()).toMatch(/^copia-antes-de-restaurar-/);
  await expect(page.locator('.aviso')).toContainText('Restauración completa');
  await page.getByRole('link', { name: 'Ver escuelas' }).click();
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 130' }).click();
  await expect(page.locator('.datos').getByText('Cambio posterior')).toHaveCount(0);
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

test('respaldo cifrado con contraseña: descargar, rechazar contraseña incorrecta y restaurar', async ({ page, browser }) => {
  await crearEscuela(page);
  await page.goto('/#/respaldos');
  const clave = 'clave-ficticia-segura-1';
  await page.getByLabel('Contraseña del respaldo').fill('corta');
  await page.getByRole('button', { name: 'Descargar respaldo de Escuela Secundaria Ficticia 130' }).click();
  await expect(page.locator('.aviso')).toContainText('al menos 10 caracteres');
  await page.getByLabel('Contraseña del respaldo').fill(clave);
  await page.getByLabel('Repite la contraseña').fill(clave);
  const espera = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo de Escuela Secundaria Ficticia 130' }).click();
  const d = await espera;
  expect(d.suggestedFilename()).toMatch(/^respaldo-gestion-escolar-32ZZZ0130A-\d{4}-\d{2}-\d{2}\.cifrado\.json$/);
  const cifrado = readFileSync((await d.path())!, 'utf8');
  expect(cifrado).toContain('gestion-escolar-respaldo-cifrado');
  expect(cifrado).not.toContain('Ficticia');
  expect(cifrado).not.toContain(clave);

  const otro = await browser.newContext();
  const p2 = await otro.newPage();
  await p2.goto('/#/respaldos');
  await p2.locator('#archivo-respaldo').setInputFiles({ name: 'cifrado.json', mimeType: 'application/json', buffer: Buffer.from(cifrado) });
  await expect(p2.getByText('está protegido con contraseña')).toBeVisible();
  await p2.getByLabel('Contraseña del respaldo').fill('otra-contrasena-mala');
  await p2.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(p2.locator('#f-contrasena-restaurar')).toContainText('Contraseña incorrecta o archivo dañado');
  await p2.getByLabel('Contraseña del respaldo').fill(clave);
  await p2.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(p2.getByRole('heading', { name: 'Revisión de «cifrado.json»' })).toBeVisible();
  await expect(p2.locator('.importacion')).toContainText('Respaldo cifrado');
  await expect(p2.locator('.respaldo-escuela')).toContainText('Ciclos escolares: 2026-2027');
  await p2.getByRole('button', { name: 'Restaurar' }).click();
  await p2.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(p2.locator('#informe-restauracion')).toContainText('Alumnos: 2');
  await otro.close();
});
