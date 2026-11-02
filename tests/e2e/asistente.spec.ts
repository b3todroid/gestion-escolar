import { expect, test } from '@playwright/test';

// Datos ficticios únicamente.

test('el asistente crea una escuela completa que persiste al cerrar y reabrir el navegador', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Configurar una escuela nueva' }).click();

  // 1. Escuela (con validación de CCT)
  await page.getByLabel('Nombre de la escuela').fill('Escuela Primaria Ficticia 30');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ030');
  await page.getByLabel('Nivel educativo').selectOption('primaria');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.locator('#f-escuela-cct-error')).toContainText('10 caracteres');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32zzz0030a');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // 2. Ciclo
  await expect(page.getByRole('heading', { level: 1, name: 'Ciclo escolar' })).toBeVisible();
  await page.getByLabel('Nombre del ciclo').fill('2026-2027');
  await page.getByLabel('Inicio de clases').fill('2026-08-31');
  await page.getByLabel('Fin de clases').fill('2027-07-15');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // 3. Turno y días laborables
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByLabel('Hora de entrada').fill('08:00');
  await page.getByLabel('Hora de salida').fill('12:30');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // 4. Periodos y recesos: plantilla que excede la jornada → error claro
  await expect(page.getByRole('heading', { level: 1, name: 'Periodos y recesos' })).toBeVisible();
  await page.getByLabel('Módulos al día').fill('8');
  await page.getByLabel('Módulos al día').blur();
  await expect(page.locator('.asistente__vista')).toContainText('después de la salida (12:30)');
  await page.getByLabel('Módulos al día').fill('4');
  await page.getByLabel('Minutos por módulo').fill('60');
  await page.getByLabel('Minutos', { exact: false }).last().fill('30');
  await page.getByLabel('Minutos por módulo').blur();
  await expect(page.locator('.asistente__vista')).toContainText('Las clases terminan a las 12:30');

  // Recarga a mitad del asistente: el borrador se conserva
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Periodos y recesos' })).toBeVisible();
  await expect(page.getByLabel('Minutos por módulo')).toHaveValue('60');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // 5. Grados y grupos (primaria sugiere 6 grados)
  await expect(page.getByLabel('Al grado')).toHaveValue('6');
  await page.getByLabel('Grupos por grado').fill('2');
  await page.getByLabel('Grupos por grado').blur();
  await expect(page.locator('.asistente__vista')).toContainText('Se crearán 6 grados y 12 grupos');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // 6. Revisar y guardar
  await expect(page.getByText('CCT 32ZZZ0030A')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ciclo 2026-2027' })).toBeVisible();
  await expect(page.getByText('6° B')).toBeVisible();
  await expect(page.getByText('4 periodos y 1 receso')).toBeVisible();

  // "Cerrar y volver a abrir": nuevo contexto de navegador con el almacenamiento guardado (incluye IndexedDB)
  const estado = await page.context().storageState({ indexedDB: true });
  await page.context().close();
  const otra = await browser.newContext({ storageState: estado });
  const p2 = await otra.newPage();
  await p2.goto('/');
  await p2.getByRole('link', { name: 'Escuela Primaria Ficticia 30' }).click();
  await expect(p2.getByText('Activo')).toBeVisible();
  await p2.getByRole('link', { name: 'Configurar' }).click();
  await p2.getByRole('link', { name: 'Periodos y recesos' }).click();
  await expect(p2.locator('.bloque')).toHaveCount(5);
  await expect(p2.locator('.regla__bloque--receso')).toHaveText(/Receso/);
  await otra.close();
});
