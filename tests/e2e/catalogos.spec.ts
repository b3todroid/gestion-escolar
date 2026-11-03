import { expect, test as base, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Fase 2 (catálogos e importación). Escuela, personas y archivos 100 % ficticios.
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

/** Escuela secundaria con 1° A y 1° B (Matutino). Devuelve la URL del panel. */
async function preparar(page: Page): Promise<string> {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 220');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0220A');
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
  return page.url();
}

async function elegirArchivo(page: Page, tipo: RegExp, archivo: string) {
  await page.getByRole('radio', { name: tipo }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture(archivo));
}

test('importa alumnos desde Excel con sinónimos, varias hojas y fila de título; cancela y reimporta', async ({ page }) => {
  const panel = await preparar(page);
  const nav = page.getByRole('navigation', { name: 'Catálogos escolares' });
  await nav.getByRole('link', { name: 'Importar información' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Importar información' })).toBeVisible();

  await elegirArchivo(page, /^Alumnos/, 'alumnos-sinonimos.xlsx');
  await expect(page.locator('#hoja-datos')).toHaveValue('Lista 2026');
  await expect(page.locator('#fila-encabezados')).toHaveValue('3'); // las filas 1 y 2 son título y espacio
  await expect(page.locator('#mapeo-0')).toHaveValue('primerApellido');
  await expect(page.locator('#mapeo-3')).toHaveValue('grado');
  await expect(page.locator('#mapeo-4')).toHaveValue('grupo');
  await expect(page.locator('#mapeo-6')).toHaveValue('matricula');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  const totales = page.locator('.totales--importacion');
  await expect(totales.locator('div', { hasText: 'Filas leídas' }).locator('dd')).toHaveText('5');
  await expect(totales.locator('div', { hasText: 'Nuevas' }).locator('dd')).toHaveText('4');
  await expect(totales.locator('div', { hasText: 'Errores' }).locator('dd')).toHaveText('1');
  await expect(page.locator('[data-fila="9"]')).toContainText('ERROR');
  expect(await contar(page, 'alumnos')).toBe(0); // analizar no guarda

  // 12. Cancelar no guarda nada
  await page.getByRole('button', { name: 'Cancelar importación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar importación' }).click();
  await expect(page.locator('#paso-revision-titulo + *')).toBeEmpty();
  expect(await contar(page, 'alumnos')).toBe(0);
  expect(await contar(page, 'importaciones')).toBe(0);

  // 9. Ahora sí: confirmar guarda en una transacción
  await elegirArchivo(page, /^Alumnos/, 'alumnos-sinonimos.xlsx');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (4)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('4 registro(s) nuevo(s)');
  expect(await contar(page, 'alumnos')).toBe(4);
  expect(await contar(page, 'importaciones')).toBe(1);

  await page.getByRole('link', { name: 'Ver alumnos' }).click();
  await expect(page.locator('#resumen-alumnos div', { hasText: 'Inscritos' }).locator('dd')).toHaveText('4');
  await expect(page.locator('#resumen-alumnos div', { hasText: 'Sin grupo' }).locator('dd')).toHaveText('1');
  await page.locator('#filtro-grupo').selectOption({ label: 'Sin grupo' });
  await expect(page.locator('#lista-alumnos-titulo ~ div .renglon')).toHaveCount(1);
  await expect(page.locator('#lista-alumnos-titulo ~ div .renglon')).toContainText('Dani');

  // 15. Persistencia al recargar
  await page.reload();
  await expect(page.locator('#resumen-alumnos div', { hasText: 'Inscritos' }).locator('dd')).toHaveText('4');
  await page.locator('#buscar-alumno').fill('m-100');
  await expect(page.locator('#lista-alumnos-titulo ~ div .renglon')).toHaveCount(1);
  await expect(page.locator('#lista-alumnos-titulo ~ div .renglon')).toContainText('Ficticia Prueba, Ana');

  // 14. Reimportar: aviso de archivo repetido; las filas con matrícula se reconocen y no se duplican
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Importar información' }).click();
  await expect(page.locator('#historial-importaciones-titulo ~ ul')).toContainText('alumnos-sinonimos.xlsx');
  await elegirArchivo(page, /^Alumnos/, 'alumnos-sinonimos.xlsx');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.getByText(/Este mismo archivo ya se importó/)).toBeVisible();
  await expect(page.locator('.totales--importacion div', { hasText: 'Nuevas' }).locator('dd')).toHaveText('0');
  await expect(page.locator('.totales--importacion div', { hasText: 'Posibles duplicados' }).locator('dd')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Nada que importar' })).toBeDisabled();
  expect(await contar(page, 'alumnos')).toBe(4);
  await page.goto(panel);
  await expect(page.locator('#resumen-catalogos div', { hasText: 'Alumnos inscritos' }).locator('dd')).toHaveText('4');
});

test('encabezados desconocidos: se asignan a mano antes de analizar', async ({ page }) => {
  await preparar(page);
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Importar información' }).click();
  await elegirArchivo(page, /^Alumnos/, 'alumnos-desconocidos.xlsx');
  await expect(page.getByText('Asigna columnas a «Nombre(s)» y «Primer apellido», o a «Nombre completo».')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('#paso-revision-titulo + *')).toBeEmpty(); // no analiza con mapeo incompleto
  await page.locator('#mapeo-0').selectOption('primerApellido');
  await page.locator('#mapeo-1').selectOption('nombre');
  await page.locator('#mapeo-2').selectOption('grado');
  await page.locator('#mapeo-3').selectOption('grupo');
  await expect(page.getByText('Correspondencia completa.')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('.totales--importacion div', { hasText: 'Nuevas' }).locator('dd')).toHaveText('2');
  await page.getByRole('button', { name: 'Confirmar e importar (2)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('2 registro(s) nuevo(s)');
  expect(await contar(page, 'inscripciones')).toBe(2);
});

test('importa personal desde CSV (;, comillas, saltos de línea) y lo usa en Personal y Docentes', async ({ page }) => {
  await preparar(page);
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Importar información' }).click();
  await elegirArchivo(page, /^Personal/, 'personal.csv');
  await expect(page.locator('#mapeo-4')).toHaveValue('funciones');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('.totales--importacion div', { hasText: 'Filas leídas' }).locator('dd')).toHaveText('3');
  await expect(page.locator('.fila-imp--error')).toContainText('Astronauta');
  await page.getByRole('button', { name: 'Confirmar e importar (2)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('1 fila(s) con error o conflicto no se guardaron');
  await page.getByRole('link', { name: 'Ver personal' }).click();
  await page.locator('#filtro-funcion').selectOption({ label: 'Prefectura' });
  await expect(page.locator('#lista-personal-titulo ~ div .tarjeta')).toHaveCount(1);
  await expect(page.locator('#lista-personal-titulo ~ div .tarjeta')).toContainText('Prefectura, Orientación');
  await expect(page.locator('#lista-personal-titulo ~ div .tarjeta')).toContainText('Turno matutino, apoyo en recreo');

  // Docentes: misma persona del catálogo; materias que puede impartir (no crea asignaciones)
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas\nCiencias');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Ciencias' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Catálogos escolares' }).getByRole('link', { name: 'Docentes' }).click();
  await expect(page.locator('#lista-docentes-titulo ~ div .tarjeta')).toHaveCount(1);
  await page.getByRole('button', { name: 'Editar materias y turnos de Mario Ficticio' }).click();
  await page.getByRole('checkbox', { name: 'Matemáticas' }).check();
  await page.getByRole('checkbox', { name: 'Matutino' }).check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.tarjeta', { hasText: 'Mario Ficticio' })).toContainText('Puede impartir');
  await expect(page.locator('.tarjeta', { hasText: 'Mario Ficticio' }).locator('dd').nth(1)).toHaveText('Matemáticas');
  await expect(page.locator('.tarjeta', { hasText: 'Mario Ficticio' }).locator('dd').nth(2)).toHaveText('Ninguna');
  expect(await contar(page, 'asignaciones')).toBe(0);
  await page.locator('#filtro-materia').selectOption({ label: 'Ciencias' });
  await expect(page.locator('#lista-docentes-titulo ~ div .tarjeta')).toHaveCount(0);
});

test('altas manuales: personal con varias funciones, materia por tipo, alumno con cambio de grupo; móvil 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await preparar(page);
  const nav = () => page.getByRole('navigation', { name: 'Catálogos escolares' });
  await nav().getByRole('link', { name: 'Personal' }).click();
  await page.locator('#f-persona-nombre').fill('Rocío');
  await page.locator('#f-persona-primerApellido').fill('Ficticia');
  await page.locator('#f-persona-numeroEmpleado').fill('x-01');
  await page.getByRole('checkbox', { name: 'Prefectura' }).check();
  await page.getByRole('checkbox', { name: 'Orientación' }).check();
  await page.locator('#f-persona-observaciones').fill('Apoya en ceremonias');
  await page.getByRole('button', { name: 'Agregar persona' }).click();
  await expect(page.locator('.tarjeta', { hasText: 'Rocío Ficticia' })).toContainText('Docente, Prefectura, Orientación; id. X-01');
  // Identificador interno único
  await page.locator('#f-persona-nombre').fill('Otra');
  await page.locator('#f-persona-primerApellido').fill('Persona');
  await page.locator('#f-persona-numeroEmpleado').fill('X-01');
  await page.getByRole('button', { name: 'Agregar persona' }).click();
  await expect(page.locator('#f-persona .resumen-errores')).toBeVisible();

  await nav().getByRole('link', { name: 'Materias' }).click(); // el alta con error queda sin guardar: se pregunta
  await page.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click();
  await page.locator('#f-lote-lote').fill('Robótica');
  await page.locator('#f-lote-tipo').selectOption('taller');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Robótica' })).toContainText('Taller');
  await page.locator('summary', { hasText: 'Sugerencias para secundaria' }).click();
  await page.getByRole('button', { name: 'Agregar Tutoría (tutoría)' }).click(); // sugerencia opcional
  await expect(page.locator('.renglon', { hasText: 'Tutoría' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Desactivar Robótica' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.locator('.renglon', { hasText: 'Robótica' })).toContainText('Desactivada');

  await nav().getByRole('link', { name: 'Alumnos' }).click();
  await page.locator('#f-alumno-alta-nombre').fill('Iván');
  await page.locator('#f-alumno-alta-primerApellido').fill('Ficticio');
  await page.locator('#f-alumno-alta-grupoId').selectOption({ label: '1° A' });
  await page.getByRole('button', { name: 'Inscribir alumno' }).click();
  await expect(page.locator('#resumen-alumnos div', { hasText: 'Inscritos' }).locator('dd')).toHaveText('1');
  await page.getByRole('link', { name: 'Ficticio, Iván' }).click();
  await page.locator('summary', { hasText: 'Cambiar de grupo' }).click();
  await page.locator('#f-cambio-grupo-grupoId').selectOption({ label: '1° B' });
  await page.locator('#f-cambio-grupo-motivo').fill('Ajuste de matrícula');
  await page.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await expect(page.locator('#historial-ins-titulo ~ ul')).toContainText('1° A → 1° B');
  expect(await contar(page, 'alumnos')).toBe(1); // misma persona

  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho).toBeLessThanOrEqual(320);
});
