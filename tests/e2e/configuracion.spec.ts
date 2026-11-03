import { expect, test, type Page } from '@playwright/test';

// Datos ficticios únicamente.

async function registrarEscuela(page: Page, nombre = 'Escuela Secundaria Ficticia 7', cct = '32zzz0007z') {
  await page.goto('/');
  await page.goto('/#/escuela/nueva');
  await page.getByLabel('Nombre oficial de la escuela').fill(nombre);
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill(cct);
  await page.getByLabel('Municipio o alcaldía').fill('Localidad Ejemplo');
  await page.getByRole('button', { name: 'Registrar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
}

test('configura una escuela completa y los datos persisten al recargar', async ({ page }) => {
  await registrarEscuela(page);
  await expect(page.locator('.datos').getByText('32ZZZ0007Z')).toBeVisible(); // CCT normalizado

  // Ciclo escolar (el formulario se abre automáticamente cuando no hay ciclos)
  await page.getByLabel('Nombre del ciclo').fill('2026-2027');
  await page.getByLabel('Inicio').fill('2026-08-31');
  await page.getByLabel('Fin').fill('2027-07-15');
  await page.getByRole('button', { name: 'Agregar ciclo' }).click();
  await expect(page.getByRole('heading', { name: 'Ciclo 2026-2027' })).toBeVisible();
  await page.getByRole('link', { name: 'Configurar' }).click();

  // Turno con jornada
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByLabel('Entrada').fill('07:00');
  await page.getByLabel('Salida').fill('13:10');
  await page.getByRole('button', { name: 'Agregar turno' }).click();
  await expect(page.getByText('Lunes a viernes, de 07:00 a 13:10 (6 h 10 min)')).toBeVisible();

  // Periodos y receso (inicio sugerido automáticamente)
  await page.getByRole('link', { name: 'Periodos y recesos' }).click();
  await page.getByRole('button', { name: 'Agregar bloque' }).click(); // Módulo 1: 07:00–07:50
  await expect(page.locator('.bloque__nombre', { hasText: 'Módulo 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar bloque' }).click(); // Módulo 2: 07:50–08:40
  await expect(page.locator('.bloque__nombre', { hasText: 'Módulo 2' })).toBeVisible();
  await page.getByLabel('Tipo de bloque').selectOption('receso');
  await expect(page.getByLabel('Nombre')).toHaveValue('Receso');
  await page.getByLabel('Fin').fill('09:00');
  await page.getByRole('button', { name: 'Agregar bloque' }).click();
  await expect(page.locator('.bloque')).toHaveCount(3);

  // Periodo superpuesto: debe rechazarse con mensaje comprensible
  await page.getByLabel('Inicio').fill('08:50');
  await page.getByLabel('Fin').fill('09:40');
  await page.getByRole('button', { name: 'Agregar bloque' }).click();
  await expect(page.locator('#f-bloque .resumen-errores')).toContainText('Se traslapa con el receso «Receso»');
  await expect(page.locator('.bloque')).toHaveCount(3);

  // Grados y grupos
  await page.getByRole('link', { name: 'Ciclo 2026-2027' }).click();
  // El formulario quedó con el horario rechazado: la app pregunta antes de descartarlo.
  await page.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page.locator('#f-grado-nombre')).toHaveValue('Primer grado');
  await page.getByRole('button', { name: 'Agregar grado' }).click();
  await expect(page.getByRole('heading', { name: 'Primer grado' })).toBeVisible();
  await page.locator('#f-grupo-nombre').fill('a');
  await page.getByLabel('Capacidad').fill('35');
  await page.getByRole('button', { name: 'Agregar grupo' }).click();
  await expect(page.getByText('1° A')).toBeVisible();

  // Duplicado
  await page.locator('#f-grupo-nombre').fill('A');
  await page.getByRole('button', { name: 'Agregar grupo' }).click();
  await expect(page.locator('#f-grupo .resumen-errores')).toContainText('Ya existe el grupo');

  // Persistencia
  await page.reload();
  await expect(page.getByText('1° A')).toBeVisible();
  await expect(page.getByText('Matutino, 35 lugares')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Escuela Secundaria Ficticia 7' })).toBeVisible();
});

test('muestra errores de validación junto a cada campo', async ({ page }) => {
  await page.goto('/#/escuela/nueva');
  await page.getByLabel('Nombre oficial de la escuela').fill('ab');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('mal clave!');
  await page.getByRole('button', { name: 'Registrar escuela' }).click();
  await expect(page.locator('.resumen-errores')).toContainText('Revisa 3 campos');
  await expect(page.getByLabel('Nombre oficial de la escuela')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-escuela-nombre-error')).toContainText('al menos 3 caracteres');
});

test('los textos se muestran como texto, no como HTML', async ({ page }) => {
  let ejecutado = false;
  page.on('dialog', async (d) => { ejecutado = true; await d.dismiss(); });
  await registrarEscuela(page, '<img src=x onerror=alert(1)> Escuela', '32ZZZ0008Z');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('<img src=x onerror=alert(1)> Escuela');
  expect(await page.locator('main img').count()).toBe(0);
  expect(ejecutado).toBe(false);
});

test('pide confirmación antes de eliminar y respeta la cancelación', async ({ page }) => {
  await registrarEscuela(page, 'Escuela Para Borrar', '32ZZZ0009Z');
  await page.getByRole('button', { name: 'Eliminar escuela' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('¿Eliminar «Escuela Para Borrar»?');
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Escuela Para Borrar' })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar escuela' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gestión escolar' })).toBeVisible();
});

test('funciona sin conexión después de la primera carga', async ({ page, context }) => {
  await registrarEscuela(page, 'Escuela Sin Red', '32ZZZ0010Z');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Asegura que el SW controle la página antes de cortar la red.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Escuela Sin Red' })).toBeVisible();
  await expect(page.locator('#conexion')).toContainText('Sin conexión');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('link', { name: 'Escuela Sin Red' })).toBeVisible();
  await context.setOffline(false);
});
