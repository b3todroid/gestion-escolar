import { expect, test as base, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Fase 7 — Prefectura. Escuela, personal y documentos FICTICIOS.
// Lunes 2 de noviembre de 2026, 07:15, hora de la Ciudad de México.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});
test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });

const LUNES = '2026-11-02';
const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));

async function contar(page: Page, tabla: string): Promise<number> {
  return page.evaluate((t) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction(t).objectStore(t).count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }), tabla);
}

/**
 * Escuela con 1° A y 1° B. Horario (importado): lunes 07:00 Matemáticas 1° A con Docente Ficticio Uno
 * y Español 1° B con Docente Ficticia Dos. Docente Ficticio Tres tiene SE confirmada el lunes 07:00–07:50.
 */
async function preparar(page: Page): Promise<string> {
  await page.clock.install({ time: new Date('2026-11-02T07:15:00-06:00') });
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 770');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0770A');
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
  const nav = () => page.getByRole('navigation', { name: 'Catálogos escolares' });
  await nav().getByRole('link', { name: 'Materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas\nEspañol');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Español' })).toBeVisible();
  await nav().getByRole('link', { name: 'Personal' }).click();
  for (const [ap, seg] of [['Ficticio', 'Uno'], ['Ficticia', 'Dos'], ['Ficticio', 'Tres']] as const) {
    await page.locator('#f-persona-nombre').fill('Docente');
    await page.locator('#f-persona-primerApellido').fill(ap);
    await page.locator('#f-persona-segundoApellido').fill(seg);
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await expect(page.getByRole('link', { name: `Docente ${ap} ${seg}` })).toBeVisible();
  }
  // SE confirmada de Tres el lunes, Módulo 1
  await page.getByRole('link', { name: 'Docente Ficticio Tres' }).click();
  await page.getByText('Registrar horas de servicio (SE) u otra actividad').click();
  await page.locator('#f-actividad-dia').selectOption({ label: 'Lunes' });
  await page.locator('#f-actividad-periodoId').selectOption({ label: 'Módulo 1 (07:00–07:50)' });
  await page.locator('#f-actividad-descripcion').fill('Guardia en patio');
  await page.getByRole('button', { name: 'Registrar actividad' }).click();
  await expect(page.locator('.insignia', { hasText: 'SERVICIO confirmado' })).toBeVisible();
  // Horario oficial (importado)
  await page.goto(panel);
  await nav().getByRole('link', { name: 'Importar información' }).click();
  await page.getByRole('radio', { name: /^Horarios/ }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture('horario-sinonimos.xlsx'));
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (3)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('3 clase(s)');
  await page.goto(panel);
  return panel;
}

const tarjeta = (page: Page, grupo: string) => page.locator('#lista-atencion .tarjeta', { hasText: `${grupo} · 07:00` });

test('caso completo: DOCENTE AUSENTE → GRUPO IDENTIFICADO → SE → PROPUESTA → AUTORIZACIÓN → COBERTURA → REPORTE', async ({ page }) => {
  const panel = await preparar(page);
  await page.getByRole('link', { name: 'Prefectura (incidencias del personal y coberturas)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prefectura' })).toBeVisible();
  await expect(page.locator('#fecha-prefectura')).toHaveValue(LUNES);
  // Sin incidencias: nada se da por hecho
  await expect(page.locator('#lista-atencion')).toHaveCount(0);
  await expect(page.locator('#atencion-titulo').locator('..')).toContainText('2 clase(s) sin información suficiente');
  expect(await contar(page, 'incidenciasPersonal')).toBe(0);

  // 1. DOCENTE AUSENTE: se reporta la falta (aún no es un hecho)
  await page.locator('summary', { hasText: 'Registrar incidencia' }).click();
  await page.locator('#f-incidencia-personalId').selectOption({ label: 'Docente Ficticio Uno' });
  await page.locator('#f-incidencia-tipo').selectOption('falta');
  await page.locator('#f-incidencia-observaciones').fill('Avisó por teléfono a las 06:50');
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await expect(page.locator('#incidencias-dia')).toContainText('REPORTADA (sin confirmar)');
  // 2. GRUPO IDENTIFICADO: primero como posible; al confirmar, como hecho
  await expect(tarjeta(page, '1° A')).toContainText('POSIBLE GRUPO SIN DOCENTE');
  await page.getByRole('button', { name: 'Confirmar incidencia de Docente Ficticio Uno' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(tarjeta(page, '1° A')).toContainText('GRUPO SIN DOCENTE CONFIRMADO');
  await expect(tarjeta(page, '1° A')).toContainText('Matemáticas · Docente: Docente Ficticio Uno');
  await expect(page.locator('#resumen-prefectura div', { hasText: 'Sin docente confirmado' }).locator('dd')).toHaveText('1');
  // 3. CONSULTA DE SE
  await expect(page.locator('#lista-se')).toContainText('Docente Ficticio Tres');
  await expect(page.locator('#lista-se')).toContainText('Disponible según registro');

  // Banco de actividades: registrar y validar (sólo las validadas son oficiales)
  await page.getByRole('navigation', { name: 'Prefectura' }).getByRole('link', { name: 'Banco de actividades' }).click();
  await page.locator('#f-actividad-banco-titulo').fill('Ejercicios de fracciones');
  await page.locator('#f-actividad-banco-descripcion').fill('Hoja con 10 ejercicios ficticios de fracciones.');
  await page.locator('#f-actividad-banco-materiaId').selectOption({ label: 'Matemáticas' });
  await page.locator('#f-actividad-banco-archivo').setInputFiles({ name: 'fracciones.txt', mimeType: 'text/plain', buffer: Buffer.from('Ejercicios ficticios') });
  await page.getByRole('button', { name: 'Registrar actividad' }).click();
  await expect(page.locator('#banco-actividades')).toContainText('PROPUESTA (sin validar)');
  await page.getByRole('button', { name: 'Validar Ejercicios de fracciones' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Validar' }).click();
  await expect(page.locator('#banco-actividades')).toContainText('VALIDADA');
  await page.getByRole('navigation', { name: 'Prefectura' }).getByRole('link', { name: 'Panel del día' }).click();

  // 4. PROPUESTA (sugerencia, no asignación)
  await tarjeta(page, '1° A').getByRole('link', { name: 'Atender 1° A 07:00' }).click();
  await expect(page.locator('#estado-clase')).toContainText('GRUPO SIN DOCENTE CONFIRMADO');
  await expect(page.locator('#lista-candidatos')).toContainText('Docente Ficticio Tres');
  await expect(page.locator('#lista-candidatos')).toContainText('Compatible · SE');
  await expect(page.locator('#lista-candidatos')).not.toContainText('Docente Ficticia Dos'); // tiene clase a esa hora
  expect(await contar(page, 'coberturas')).toBe(0); // sugerir no asigna
  await page.locator('summary', { hasText: 'Proponer personal' }).click();
  await page.getByRole('checkbox', { name: /Docente Ficticio Tres/ }).check();
  await page.getByRole('button', { name: 'Registrar propuesta' }).click();
  await expect(page.locator('#estado-cobertura')).toHaveText('Propuesta');
  await expect(page.locator('#estado-clase')).toContainText('GRUPO SIN DOCENTE CONFIRMADO'); // una propuesta no cubre

  // 6. Asignación incompatible: se rechaza antes de guardar
  await page.locator('#f-asignar-cobertura-personalId').selectOption({ label: 'Docente Ficticia Dos · revisar disponibilidad' });
  await page.locator('#f-asignar-cobertura-autorizadoPor').fill('Subdirección académica (ficticia)');
  await page.getByRole('button', { name: 'Asignar cobertura' }).click();
  await expect(page.locator('#f-asignar-cobertura .resumen-errores')).toContainText('Tiene clase con 1° B');
  // 5. AUTORIZACIÓN + COBERTURA
  await page.locator('#f-asignar-cobertura-personalId').selectOption({ label: 'Docente Ficticio Tres · SE confirmada' });
  await page.locator('#f-asignar-cobertura-actividadId').selectOption({ label: 'Ejercicios de fracciones' });
  await page.getByRole('button', { name: 'Asignar cobertura' }).click();
  await expect(page.locator('#estado-clase')).toContainText('COBERTURA ASIGNADA');
  await expect(page.locator('#situacion-titulo').locator('..')).toContainText('Subdirección académica (ficticia)');
  await page.getByRole('button', { name: 'Registrar como realizada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, se realizó' }).click();
  await expect(page.locator('#estado-clase')).toContainText('COBERTURA REALIZADA');
  // 8. Historial
  await expect(page.locator('#historial-cobertura-titulo').locator('..')).toContainText('registrar realizada');
  await expect(page.locator('#historial-cobertura-titulo').locator('..')).toContainText('asignar');
  await expect(page.locator('#historial-cobertura-titulo').locator('..')).toContainText('proponer');

  // 11. Persistencia
  await page.reload();
  await expect(page.locator('#estado-clase')).toContainText('COBERTURA REALIZADA');

  // 9. REPORTE (día)
  await page.goto(`${panel.replace(/#.*/, '')}#/prefectura`);
  await page.getByRole('link', { name: /Abrir Prefectura/ }).click();
  await page.getByRole('navigation', { name: 'Prefectura' }).getByRole('link', { name: 'Reportes e historial' }).click();
  await page.locator('#f-reporte-periodo').selectOption('dia');
  await page.locator('#f-reporte-desde').fill(LUNES);
  await page.locator('#f-reporte-hasta').fill(LUNES);
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  const ind = page.locator('#indicadores-reporte');
  await expect(ind.locator('div', { hasText: 'Incidencias confirmadas' }).locator('dd')).toHaveText('1');
  await expect(ind.locator('div', { hasText: 'Clases sin docente (confirmadas)' }).locator('dd')).toHaveText('1');
  await expect(ind.locator('div', { hasText: 'Coberturas realizadas' }).locator('dd')).toHaveText('1');
  await expect(ind.locator('div', { hasText: 'Porcentaje cubierto' }).locator('dd')).toHaveText('100 %');
  await expect(page.locator('#tabla-clases-reporte')).toContainText('Docente Ficticio Tres');
  await expect(page.locator('#tabla-clases-reporte')).toContainText('Subdirección académica (ficticia)');
  await expect(page.locator('#historial-general')).toContainText('incidencia: confirmar');
  // Vista imprimible
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.reporte-imprimible')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimir o guardar como PDF' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
});

test('3 y 12. confirmación en sitio, descartar incidencia, otra incidencia configurable; datos anteriores intactos; móvil', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const panel = await preparar(page);
  const antes = await Promise.all(['sesiones', 'asignaciones', 'actividades', 'personal', 'materias', 'grupos', 'periodos'].map((t) => contar(page, t)));
  await page.getByRole('link', { name: 'Prefectura (incidencias del personal y coberturas)' }).click();
  // Otra incidencia configurable, reportada y luego descartada con motivo
  await page.locator('summary', { hasText: 'Registrar incidencia' }).click();
  await page.locator('#f-incidencia-personalId').selectOption({ label: 'Docente Ficticia Dos' });
  await page.locator('#f-incidencia-tipo').selectOption('otra');
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await expect(page.locator('#f-incidencia .resumen-errores')).toContainText('Escribe qué tipo de incidencia es');
  await page.locator('#f-incidencia-tipoOtro').fill('Comisión ficticia');
  await page.locator('#f-incidencia-alcance').selectOption('periodos');
  await page.getByRole('checkbox', { name: 'Módulo 1 (07:00–07:50)' }).check();
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await expect(tarjeta(page, '1° B')).toContainText('POSIBLE GRUPO SIN DOCENTE');
  await expect(tarjeta(page, '1° B')).toContainText('Comisión ficticia');
  await page.getByRole('button', { name: 'Descartar incidencia de Docente Ficticia Dos' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Se presentó a tiempo');
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click();
  await expect(page.locator('#incidencias-dia')).toContainText('DESCARTADA');
  await expect(page.locator('#lista-atencion')).toHaveCount(0);
  // Confirmación en sitio (sin incidencia previa) desde la vista por periodo
  await page.locator('.periodos-pref').getByRole('link', { name: /1° B/ }).click();
  await expect(page.locator('#estado-clase')).toContainText('SIN INFORMACIÓN SUFICIENTE');
  await page.getByRole('button', { name: 'Confirmar: el grupo está sin docente' }).click();
  await page.getByRole('dialog').getByLabel('Cómo se confirmó').fill('Recorrido de prefectura: el grupo está solo');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('#estado-clase')).toContainText('GRUPO SIN DOCENTE CONFIRMADO');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // 12. Nada de lo anterior cambió
  const despues = await Promise.all(['sesiones', 'asignaciones', 'actividades', 'personal', 'materias', 'grupos', 'periodos'].map((t) => contar(page, t)));
  expect(despues).toEqual(antes);
  void panel;
});
