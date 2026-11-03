import { expect, test as base, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Fase 6 — importación de horarios desde PDF (digital y escaneado con OCR local).
// Documentos, escuela y personas FICTICIOS (scripts/generar_pdf_prueba.py).
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/pdf/${n}`, import.meta.url));

async function contar(page: Page, tabla: string): Promise<number> {
  return page.evaluate((t) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction(t).objectStore(t).count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }), tabla);
}

/** Escuela con 1° A y 1° B (Matutino 07:00, módulos de 50 min), dos materias y dos docentes. */
async function preparar(page: Page) {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 660');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0660A');
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
  const nav = () => page.getByRole('navigation', { name: 'Catálogos escolares' });
  await nav().getByRole('link', { name: 'Materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas\nEspañol');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Español' })).toBeVisible();
  await nav().getByRole('link', { name: 'Personal' }).click();
  for (const [ap, seg] of [['Ficticio', 'Uno'], ['Ficticia', 'Dos']] as const) {
    await page.locator('#f-persona-nombre').fill('Docente');
    await page.locator('#f-persona-primerApellido').fill(ap);
    await page.locator('#f-persona-segundoApellido').fill(seg);
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await expect(page.getByRole('link', { name: `Docente ${ap} ${seg}` })).toBeVisible();
  }
  await nav().getByRole('link', { name: 'Importar información' }).click();
}

async function subirPdf(page: Page, archivo: string) {
  await page.getByRole('radio', { name: /^Horarios/ }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture(archivo));
}

async function importarGrupoA(page: Page) {
  await subirPdf(page, 'horario-grupo-1A.pdf');
  await expect(page.locator('#continuar-documento')).toBeVisible();
  await page.locator('#continuar-documento').click();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (6)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('6 clase(s) nueva(s)');
}

test('1, 3 y 5. PDF digital (horario por grupo): estructura, corrección, validación y guardado', async ({ page }) => {
  await preparar(page);
  await subirPdf(page, 'horario-grupo-1A.pdf');
  await expect(page.locator('#resumen-pdf')).toContainText('PDF de 1 página(s): 1 con texto digital');
  await expect(page.locator('#estructura-documento')).toHaveValue('sabana_grupo');
  await expect(page.locator('#contexto-documento')).toHaveValue('1° A'); // leído del título
  await expect(page.locator('#titulo-documento')).toContainText('Horario del grupo 1° A');
  // Vista previa editable: celda de dos renglones (materia + docente)
  await expect(page.locator('#celda-1-1')).toHaveValue('Matemáticas\nDocente Ficticio Uno');
  expect(await contar(page, 'sesiones')).toBe(0);
  await page.locator('#continuar-documento').click();
  await expect(page.locator('#resumen-conversion')).toContainText('salen 6 fila(s)');
  await expect(page.locator('#resumen-conversion')).toContainText('14 celda(s) vacías ignoradas (no son horas de servicio)');
  await expect(page.locator('#mapeo-0')).toHaveValue('grupo');
  await expect(page.locator('#mapeo-2')).toHaveValue('periodo');
  await expect(page.locator('#mapeo-5')).toHaveValue(''); // «Celda de origen»: sólo informativa
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('.totales--importacion div', { hasText: 'Clases nuevas' }).locator('dd')).toHaveText('6');
  expect(await contar(page, 'sesiones')).toBe(0); // la previsualización no guarda
  await page.getByRole('button', { name: 'Confirmar e importar (6)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('6 clase(s) nueva(s)');
  expect(await contar(page, 'sesiones')).toBe(6);
  await expect(page.locator('#historial-importaciones-titulo ~ ul')).toHaveCount(0); // se actualiza al recargar
  await page.reload();
  await expect(page.locator('#historial-importaciones-titulo ~ ul')).toContainText('horario-grupo-1A.pdf');
  await expect(page.locator('#historial-importaciones-titulo ~ ul')).toContainText('Página 1');
});

test('4, 6, 9 y 8. Horario por docente: conflicto, grupo inexistente, duplicados, cancelación y plantilla', async ({ page }) => {
  await preparar(page);
  await importarGrupoA(page);
  await page.getByRole('button', { name: 'Importar otro archivo' }).click();
  await subirPdf(page, 'horario-docente-uno.pdf');
  await expect(page.locator('#estructura-documento')).toHaveValue('sabana_docente');
  await expect(page.locator('#contexto-documento')).toHaveValue('Docente Ficticio Uno');
  await page.locator('#continuar-documento').click();
  // Guardar plantilla de reconocimiento para este formato
  await page.locator('#guardar-plantilla summary').click();
  await page.locator('#nombre-plantilla').fill('Horario por docente (formato dirección)');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.locator('.aviso')).toContainText('Plantilla «Horario por docente (formato dirección)» guardada');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('#horario-no-importable')).toContainText('No se puede importar');
  await expect(page.locator('.fila-imp--conflicto')).toContainText('ya tiene clase con 1° A');
  await expect(page.locator('.fila-imp--error')).toContainText('No existe el grupo 3° Z');
  await expect(page.getByRole('button', { name: /Confirmar e importar/ })).toHaveCount(0);
  // Cancelar: no se modifica nada
  await page.getByRole('button', { name: 'Cancelar importación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar importación' }).click();
  expect(await contar(page, 'sesiones')).toBe(6);
  // Duplicados: el mismo horario de 1° A ya no agrega nada
  await subirPdf(page, 'horario-grupo-1A.pdf');
  await page.locator('#continuar-documento').click();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.getByText(/Este mismo archivo ya se importó/)).toBeVisible();
  await expect(page.locator('.totales--importacion div', { hasText: 'Ya existentes' }).locator('dd')).toHaveText('6');
  expect(await contar(page, 'sesiones')).toBe(6);
  // La plantilla persiste y se ofrece para la escuela
  await page.reload();
  await page.getByRole('radio', { name: /^Horarios/ }).check();
  await expect(page.locator('#plantilla-importacion')).toContainText('Horario por docente (formato dirección)');
});

test('7. Tabla con encabezados en PDF: ambigüedades y docentes desconocidos no se importan', async ({ page }) => {
  await preparar(page);
  await subirPdf(page, 'horario-lista.pdf');
  await expect(page.locator('#estructura-documento')).toHaveValue('lista');
  await page.locator('#continuar-documento').click();
  await expect(page.locator('#mapeo-3')).toHaveValue('materia');
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('[data-fila="3"]')).toContainText('«Matemáticas Español» no está registrada');
  await expect(page.locator('[data-fila="4"]')).toContainText('No se encontró al docente «Docente Inexistente»');
  await expect(page.getByRole('button', { name: /Confirmar e importar/ })).toHaveCount(0);
  // Corrección manual en la vista previa: quitar las filas problemáticas y volver a validar
  await page.locator('#celda-2-3').fill('Matemáticas');
  await page.locator('#celda-2-3').blur();
  await page.locator('#celda-3-4').fill('Docente Ficticia Dos');
  await page.locator('#celda-3-4').blur();
  await page.locator('#continuar-documento').click();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (3)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('3 clase(s) nueva(s)');
  // Archivo dañado
  await page.getByRole('button', { name: 'Importar otro archivo' }).click();
  await subirPdf(page, 'danado.pdf');
  await expect(page.locator('#paso-archivo-titulo ~ div .mensaje--error')).toContainText('dañado');
});

test('2. PDF escaneado: OCR local, campos inciertos, grupo elegido por la persona; y cancelación del OCR', async ({ page }) => {
  test.setTimeout(120_000);
  await preparar(page);
  const externas: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) externas.push(r.url()); });
  await subirPdf(page, 'horario-escaneado-1B.pdf');
  await expect(page.locator('#resumen-pdf')).toContainText('1 sin texto (posiblemente escaneadas)');
  await expect(page.locator('#sin-texto')).toContainText('no tiene texto digital');
  // Cancelar el OCR a mitad
  await page.locator('#boton-ocr').click();
  await page.locator('#cancelar-proceso').click();
  await expect(page.locator('.aviso')).toContainText('Reconocimiento cancelado');
  await expect(page.locator('#boton-ocr')).toBeVisible();
  // OCR completo
  await page.locator('#boton-ocr').click();
  await expect(page.locator('#continuar-documento')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#estructura-documento')).toHaveValue('sabana_grupo');
  await expect(page.locator('#contexto-documento')).toHaveValue(''); // el «1°» del título no se leyó con certeza: no se adivina
  await page.locator('#continuar-documento').click();
  await expect(page.locator('.aviso').last()).toContainText('Elige el grupo del horario');
  await page.locator('#contexto-documento').selectOption('1° B');
  // Corrección manual: se quitan las filas de «ruido» del OCR (trazos sin hora) que no son clases
  for (let i = 0; i < 5; i++) {
    const n = await page.locator('.rejilla tbody tr').count();
    let quitada = false;
    for (let f = 1; f <= n && !quitada; f++) {
      if ((await page.locator(`#celda-${f}-0`).inputValue()).trim() === '') { await page.getByRole('button', { name: `Quitar fila ${f}` }).click(); quitada = true; }
    }
    if (!quitada) break;
  }
  await expect(page.locator('.rejilla tbody tr')).toHaveCount(2);
  if (await page.locator('#confirmar-inciertas').count()) {
    await page.locator('#confirmar-inciertas').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sí, las revisé' }).click();
  }
  await page.locator('#continuar-documento').click();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('.totales--importacion div', { hasText: 'Clases nuevas' }).locator('dd')).toHaveText('2');
  await page.getByRole('button', { name: 'Confirmar e importar (2)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('2 clase(s) nueva(s)');
  expect(externas).toEqual([]); // nada sale del dispositivo
});

test('10. Conservación de datos: una importación PDF fallida o cancelada no altera nada', async ({ page }) => {
  await preparar(page);
  await importarGrupoA(page);
  const antes = await Promise.all(['sesiones', 'asignaciones', 'alumnos', 'personal', 'materias', 'grupos', 'periodos'].map((t) => contar(page, t)));
  await page.getByRole('button', { name: 'Importar otro archivo' }).click();
  await subirPdf(page, 'horario-docente-uno.pdf');
  await page.locator('#continuar-documento').click();
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.locator('#horario-no-importable')).toBeVisible();
  await page.getByRole('radio', { name: /^Alumnos/ }).check(); // cambiar de tipo descarta todo
  const despues = await Promise.all(['sesiones', 'asignaciones', 'alumnos', 'personal', 'materias', 'grupos', 'periodos'].map((t) => contar(page, t)));
  expect(despues).toEqual(antes);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
