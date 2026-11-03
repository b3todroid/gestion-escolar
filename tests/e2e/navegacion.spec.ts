import { expect, test } from '@playwright/test';

// Datos ficticios únicamente.

async function crearEscuela(page: import('@playwright/test').Page) {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Ficticia Cambios');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0999A');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await page.getByRole('link', { name: 'Administrar grupos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
}

test('avisa antes de salir de un formulario con cambios sin guardar', async ({ page }) => {
  await crearEscuela(page);
  await page.locator('summary', { hasText: 'Agregar grupo' }).click();
  await page.locator('#f-grupo-nombre').fill('Z');
  await page.getByRole('link', { name: 'Periodos y recesos' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('cambios sin guardar');
  await dialogo.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page.locator('#f-grupo-nombre')).toHaveValue('Z');
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();

  await page.getByRole('link', { name: 'Periodos y recesos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Turno / })).toBeVisible();
});

test('tras guardar no pide confirmación al navegar', async ({ page }) => {
  await crearEscuela(page);
  await page.locator('summary', { hasText: 'Agregar grupo' }).click();
  await page.locator('#f-grupo-gradoId').selectOption({ label: 'Primer grado' });
  await page.locator('#f-grupo-nombre').fill('Z');
  await page.getByRole('button', { name: 'Agregar grupo' }).click();
  await expect(page.getByText('1° Z')).toBeVisible();
  await page.getByRole('link', { name: 'Periodos y recesos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Turno / })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('los avisos no bloquean los toques sobre los botones', async ({ page }) => {
  await crearEscuela(page); // deja un aviso de éxito visible
  const aviso = page.locator('.aviso').first();
  await expect(aviso).toBeVisible();
  const caja = (await aviso.boundingBox())!;
  const encima = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.aviso') !== null, [caja.x + 20, caja.y + caja.height / 2]);
  expect(encima, 'el aviso intercepta toques').toBe(false);
});
