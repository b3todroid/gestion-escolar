import { expect, test as base, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Fase 3 — módulo Horarios. Escuela, personas y archivos ficticios.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));

async function contar(page: Page, tabla: string): Promise<number> {
  return page.evaluate((t) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction(t).objectStore(t).count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }), tabla);
}

/** Escuela con 1° A y 1° B (Matutino), dos materias y dos docentes. Devuelve la URL del panel. */
async function preparar(page: Page): Promise<string> {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 330');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0330A');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Al grado').fill('1');
  await page.getByLabel('Grupos por grado').fill('2');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { name: 'Catálogos escolares' })).toBeVisible();
  const panel = page.url();
  const nav = page.getByRole('navigation', { name: 'Catálogos escolares' });
  await nav.getByRole('link', { name: 'Materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas\nEspañol');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Español' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Personal' }).click();
  for (const [ap, seg] of [['Ficticio', 'Uno'], ['Ficticia', 'Dos']] as const) {
    await page.locator('#f-persona-nombre').fill('Docente');
    await page.locator('#f-persona-primerApellido').fill(ap);
    await page.locator('#f-persona-segundoApellido').fill(seg);
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await expect(page.getByRole('link', { name: `Docente ${ap} ${seg}` })).toBeVisible();
  }
  await page.goto(panel);
  return panel;
}

async function importarHorario(page: Page, archivo: string) {
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Importar información' }).click();
  await page.getByRole('radio', { name: /^Horarios/ }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture(archivo));
  await expect(page.locator('#mapeo-0')).toBeVisible();
}

test.describe('en computadora', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('importa un horario con encabezados equivalentes; horario por grupo y por docente; SE confirmada; persiste', async ({ page }) => {
    const panel = await preparar(page);
    await importarHorario(page, 'horario-sinonimos.xlsx');
    await expect(page.locator('#fila-encabezados')).toHaveValue('3');
    await expect(page.locator('#mapeo-1')).toHaveValue('dia'); // «Día de la semana»
    await expect(page.locator('#mapeo-2')).toHaveValue('periodo'); // «Módulo»
    await expect(page.locator('#mapeo-3')).toHaveValue('materia'); // «Asignatura»
    await expect(page.locator('#mapeo-4')).toHaveValue('docente'); // «Profesor»
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await expect(page.locator('.totales--importacion div', { hasText: 'Clases nuevas' }).locator('dd')).toHaveText('3');
    expect(await contar(page, 'sesiones')).toBe(0); // la previsualización no guarda
    await page.getByRole('button', { name: 'Confirmar e importar (3)' }).click();
    await expect(page.locator('#resultado-importacion')).toContainText('3 clase(s) nueva(s)');
    await page.getByRole('link', { name: 'Ver horarios' }).click();

    // Módulo Horarios
    await expect(page.getByRole('heading', { level: 1, name: 'Horarios' })).toBeVisible();
    await expect(page.locator('#totales-horarios div', { hasText: 'Clases en el horario' }).locator('dd')).toHaveText('3');
    await expect(page.locator('#sin-conflictos')).toBeVisible();
    await page.locator('#sel-grupo').selectOption({ label: '1° A' });
    await page.getByRole('button', { name: 'Ver horario del grupo' }).click();
    const tabla = page.locator('.tabla-semana');
    await expect(tabla).toBeVisible();
    await expect(tabla.locator('thead th')).toHaveText(['Hora', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
    const lunes1 = tabla.locator('tbody tr').first().locator('td').first();
    await expect(lunes1).toContainText('Matemáticas');
    await expect(lunes1).toContainText('Docente Ficticio');
    await expect(lunes1).toContainText('CLASE');
    await expect(lunes1).toContainText('Sin confirmar · importado');
    await expect(page.locator('#sin-informacion-grupo')).toContainText('periodo(s) sin actividad registrada');
    // Regresión: con todas las materias asignadas, «Editar» abre el formulario
    await page.getByRole('button', { name: 'Editar Matemáticas' }).click();
    await page.locator('#f-asignacion-horasSemana').fill('4');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('1 de 4 horas en el horario')).toBeVisible();

    // Horario por docente (derivado de las mismas clases) + SE por periodo, confirmada
    await lunes1.getByRole('link', { name: 'Docente Ficticio' }).click();
    const datos = page.locator('#datos-docente');
    await expect(datos).toContainText('Escuela Secundaria Ficticia 330');
    await expect(datos).toContainText('Matutino');
    await expect(datos.locator('dd').nth(6)).toHaveText('1° A');
    await expect(datos.locator('dd').nth(7)).toHaveText('Matemáticas');
    await page.getByText('Registrar horas de servicio (SE) u otra actividad').click();
    await page.locator('#f-actividad-dia').selectOption({ label: 'Martes' });
    await page.locator('#f-actividad-periodoId').selectOption({ index: 1 });
    await expect(page.locator('#f-actividad-horaInicio')).toHaveValue('07:00');
    await page.locator('#f-actividad-descripcion').fill('Guardia en patio');
    await page.getByRole('button', { name: 'Registrar actividad' }).click();
    await expect(page.locator('.insignia', { hasText: 'SERVICIO confirmado' })).toBeVisible();
    await expect(page.locator('.semana-docente__dia', { hasText: 'Martes' })).toContainText('Guardia en patio');
    await expect(page.locator('.semana-docente__dia', { hasText: 'Miércoles' })).toContainText('SIN ACTIVIDAD REGISTRADA');

    // 10. Persistencia
    await page.reload();
    await expect(page.locator('#datos-docente')).toContainText('1 confirmada(s)');
    await page.goto(panel);
    await page.getByRole('link', { name: 'Horarios', exact: true }).click();
    await expect(page.locator('#totales-horarios div', { hasText: 'Horas SE confirmadas' }).locator('dd')).toHaveText('1');
    await expect(page.locator('[data-docente]', { hasText: 'Docente Ficticio Uno' })).toContainText('1 confirmada(s)');

    // Vista imprimible: tabla visible, controles ocultos
    await page.locator('#sel-grupo').selectOption({ label: '1° A' });
    await page.getByRole('button', { name: 'Ver horario del grupo' }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.tabla-semana')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Imprimir horario' })).toBeHidden();
    await expect(page.locator('.datos-impresion')).toContainText('Ciclo');
    await page.emulateMedia({ media: 'screen' });
  });

  test('demuestra la detección de conflictos: importación con choques y captura manual', async ({ page }) => {
    await preparar(page);
    // 9. Archivo con conflictos: se muestran antes de guardar y no se guarda nada
    await importarHorario(page, 'horario-conflicto.csv');
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await expect(page.locator('#horario-no-importable')).toContainText('No se puede importar');
    await expect(page.locator('[data-fila="2"]')).toContainText('dos grupos a la vez');
    await expect(page.locator('[data-fila="4"]')).toContainText('fuera de jornada');
    await expect(page.locator('[data-fila="5"]')).toContainText('no existe el periodo 9');
    await expect(page.getByRole('button', { name: /Confirmar e importar/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancelar importación' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar importación' }).click();
    expect(await contar(page, 'sesiones')).toBe(0);
    expect(await contar(page, 'importaciones')).toBe(0);

    // Captura manual: el mismo docente no puede estar en 1° B a la misma hora
    await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 330' }).click();
    await page.getByRole('link', { name: 'Horarios', exact: true }).click();
    for (const g of ['1° A', '1° B']) {
      await page.locator('#sel-grupo').selectOption({ label: g });
      await page.getByRole('button', { name: 'Ver horario del grupo' }).click();
      await page.locator('#f-asignacion-materiaId').selectOption({ label: 'Matemáticas' });
      await page.locator('#f-asignacion-personalId').selectOption({ label: 'Docente Ficticio Uno' });
      await page.locator('#f-asignacion-horasSemana').fill('5');
      await page.getByRole('button', { name: 'Asignar materia' }).click();
      await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
      const opcion = page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ });
      if (g === '1° A') {
        await opcion.click();
        await expect(page.locator('[data-periodo]').first()).toContainText('Matemáticas');
      } else {
        await expect(opcion).toBeDisabled();
        await expect(page.getByRole('dialog')).toContainText('ya tiene clase con 1° A (Matemáticas) el lunes de 07:00 a 07:50');
        await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
      }
      await page.goBack();
    }
    expect(await contar(page, 'sesiones')).toBe(1);
  });
});

test('en teléfono: vista por día de un horario confirmado y reportes sin desplazamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await preparar(page);
  await importarHorario(page, 'horario-sinonimos.xlsx');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (3)' }).click();
  await page.getByRole('link', { name: 'Ver horarios' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('#sel-grupo').selectOption({ label: '1° A' });
  await page.getByRole('button', { name: 'Ver horario del grupo' }).click();
  await page.getByRole('button', { name: 'Confirmar horario' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar horario' }).click();
  const porDia = page.locator('[data-vista="por-dia"]');
  await expect(porDia).toBeVisible();
  await expect(page.locator('.tabla-semana')).toBeHidden();
  await porDia.locator('.dias__opcion', { hasText: 'Mar' }).click();
  await expect(porDia.locator('.por-dia__lista')).toContainText('Español');
  await expect(porDia.locator('.por-dia__lista')).toContainText('✓ Confirmado');
  await porDia.locator('.dias__opcion', { hasText: 'Mié' }).click();
  await expect(porDia.locator('.por-dia__lista')).toContainText('SIN ACTIVIDAD REGISTRADA');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
