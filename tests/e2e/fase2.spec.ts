import { expect, test as base, type Page } from '@playwright/test';

// Personas, escuelas y materias ficticias.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

async function preparar(page: Page) {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre de la escuela').fill('Escuela Secundaria Ficticia 70');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  const urlCiclo = page.url();

  // Materias en lote
  await page.getByRole('link', { name: 'Registrar materias' }).click();
  await page.locator('#f-lote-lote').fill('Español\nMatemáticas\nmatemáticas');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('#f-lote .resumen-errores')).toContainText('repetida');
  await page.locator('#f-lote-lote').fill('Español\nMatemáticas\nCiencias');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.getByRole('heading', { name: 'Materias del ciclo (3)' })).toBeVisible();

  // Personal
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 70' }).click();
  await page.getByRole('link', { name: 'Registrar personal' }).click();
  for (const ap of ['Ficticio Uno', 'Ficticia Dos']) {
    await page.locator('#f-persona-nombre').fill('Docente');
    await page.locator('#f-persona-primerApellido').fill(ap);
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await expect(page.getByRole('link', { name: `Docente ${ap}` })).toBeVisible();
  }
  return urlCiclo;
}

async function asignar(page: Page, materia: string, docente: string, horas: string) {
  await page.locator('#f-asignacion-materiaId').selectOption({ label: materia });
  await page.locator('#f-asignacion-personalId').selectOption({ label: docente });
  await page.locator('#f-asignacion-horasSemana').fill(horas);
  await page.getByRole('button', { name: 'Asignar materia' }).click();
  await expect(page.locator('.renglon__texto', { hasText: materia })).toBeVisible();
}

test('asigna materias y arma el horario sin choques de docentes; todo persiste', async ({ page }) => {
  const urlCiclo = await preparar(page);
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await asignar(page, 'Matemáticas', 'Docente Ficticio Uno', '1');
  await asignar(page, 'Español', 'Docente Ficticia Dos', '5');

  // Programar lunes 07:00
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('Matemáticas');
  await expect(page.getByText('1 de 1 horas en el horario')).toBeVisible();

  // Límite de horas: Matemáticas ya no se puede en otra hora
  await page.getByRole('button', { name: 'Asignar Lunes 07:50' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Ya tiene sus 1 horas');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  // Otro día conserva su propio horario
  await page.locator('.dias__opcion', { hasText: 'Mar' }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('SIN ACTIVIDAD REGISTRADA');

  // Choque de docente en 1° B a la misma hora
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° B' }).click();
  await asignar(page, 'Matemáticas', 'Docente Ficticio Uno', '5');
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  const opcion = page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ });
  await expect(opcion).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('ya tiene clase con 1° A (Matemáticas) el lunes de 07:00 a 07:50');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Asignar Lunes 07:50' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ }).click();
  await expect(page.locator('[data-periodo]').nth(1)).toContainText('Matemáticas');

  // Vista del docente: su semana con ambos grupos; persiste tras recargar
  await page.reload();
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 70' }).click();
  await page.getByRole('link', { name: 'Ver personal' }).click();
  await page.getByRole('link', { name: 'Docente Ficticio Uno' }).click();
  await expect(page.locator('.totales div', { hasText: '● Clase' })).toContainText('1 h 40 min');
  await expect(page.locator('.semana-docente__dia', { hasText: 'Lunes' })).toContainText('1° A');
  await expect(page.locator('.semana-docente__dia', { hasText: 'Lunes' })).toContainText('1° B');

  // Dejar libre
  await page.getByRole('link', { name: '1° A' }).click();
  await page.getByRole('button', { name: 'Cambiar Lunes 07:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dejar libre' }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('SIN ACTIVIDAD REGISTRADA');
});

test('reglas de baja, eliminación y cambio de docente', async ({ page }) => {
  const urlCiclo = await preparar(page);
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await asignar(page, 'Ciencias', 'Docente Ficticio Uno', '3');
  // No se elimina una materia asignada
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Ver materias' }).click();
  await page.getByRole('button', { name: 'Eliminar Ciencias' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('.aviso--error')).toContainText('asignada a 1 grupo');
  // No se da de baja a un docente con clases vigentes
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 70' }).click();
  await page.getByRole('link', { name: 'Ver personal' }).click();
  await page.getByRole('button', { name: 'Dar de baja a Docente Ficticio Uno' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();
  await expect(page.locator('.aviso--error')).toContainText('Reasígnalas');
  // Cambiar el docente de la materia y entonces sí dar de baja
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await page.getByRole('button', { name: 'Editar Ciencias' }).click();
  await page.locator('#f-asignacion-personalId').selectOption({ label: 'Docente Ficticia Dos' });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.renglon', { hasText: 'Ciencias' })).toContainText('Docente Ficticia Dos');
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 70' }).click();
  await page.getByRole('link', { name: 'Ver personal' }).click();
  await page.getByRole('button', { name: 'Dar de baja a Docente Ficticio Uno' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();
  await expect(page.locator('.tarjeta--baja')).toContainText('Docente Ficticio Uno');
});

test('las pantallas de la Fase 2 son cómodas en teléfono (320 px)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const urlCiclo = await preparar(page);
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await asignar(page, 'Matemáticas', 'Docente Ficticio Uno', '5');
  const rutas = [page.url(), new URL(page.url()).href.replace(/#.*/, '') + '#' + new URL(urlCiclo).hash.slice(1) + '/materias'];
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dlg = await page.evaluate(() => document.querySelector('dialog')!.scrollWidth <= document.querySelector('dialog')!.clientWidth);
  expect(dlg, 'el diálogo cabe a lo ancho').toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  for (const ruta of rutas) {
    await page.goto(ruta);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `desborde en ${ruta}`).toBeLessThanOrEqual(0);
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main input:not([type=radio]), main select, main summary, main textarea, main .dias__opcion')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim() || el.getAttribute('name')));
    expect(pequenos, `controles < 44 px en ${ruta}`).toEqual([]);
  }
});
