import { expect, test as base, type Page } from '@playwright/test';

// Escuela, docentes y alumnos ficticios. Lunes 2 de noviembre de 2026, hora de la Ciudad de México.
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

const LUNES_0715 = new Date('2026-11-02T07:15:00-06:00');

async function contar(page: Page, tabla: string): Promise<number> {
  return page.evaluate((t) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction(t).objectStore(t).count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }), tabla);
}

/** Escuela con 1° A, un docente con Matemáticas el lunes a las 07:00, y 5 alumnos ficticios. */
async function preparar(page: Page) {
  await page.clock.install({ time: LUNES_0715 });
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia 110');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0999A');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Al grado').fill('1');
  await page.getByLabel('Grupos por grado').fill('1');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await page.getByRole('link', { name: 'Administrar grupos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  const urlCiclo = page.url();
  await page.getByRole('link', { name: 'Registrar materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 110' }).click();
  await page.getByRole('link', { name: 'Registrar personal' }).click();
  await page.locator('#f-persona-nombre').fill('Docente');
  await page.locator('#f-persona-primerApellido').fill('Ficticio');
  await page.getByRole('button', { name: 'Agregar persona' }).click();
  await expect(page.getByRole('link', { name: 'Docente Ficticio' })).toBeVisible();
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await page.locator('#f-asignacion-materiaId').selectOption({ label: 'Matemáticas' });
  await page.locator('#f-asignacion-personalId').selectOption({ label: 'Docente Ficticio' });
  await page.locator('#f-asignacion-horasSemana').fill('5');
  await page.getByRole('button', { name: 'Asignar materia' }).click();
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('Matemáticas');
  await page.getByRole('link', { name: 'Alumnos y asistencia de 1° A' }).click();
  await page.locator('#f-alumnos-lote-lote').fill('Alumna Ficticia, Ana\nAlumno Ficticio, Beto\nAlumna Prueba, Carla\nAlumno Prueba, Dani\nAlumna Ejemplo, Eva');
  await page.getByRole('button', { name: 'Agregar alumnos' }).click();
  await expect(page.locator('.lista-resumen li')).toHaveCount(5);
  // Este dispositivo es del docente
  await page.goto('/#/perfil');
  await page.getByRole('button', { name: 'Soy yo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hola, Docente' })).toBeVisible();
}

test('ABRIR → VER CLASE → ENTRAR AL GRUPO → PASAR LISTA → GUARDAR', async ({ page }) => {
  await preparar(page);
  // ABRIR: la app muestra el panel del docente
  await page.goto('/');
  await expect(page.locator('.mi-dia__fecha')).toHaveText('Lunes, 2 de noviembre de 2026');
  await expect(page.locator('.reloj')).toHaveText('07:15');
  // VER CLASE
  const ahora = page.locator('.ahora');
  await expect(ahora).toContainText('CLASE');
  await expect(ahora.locator('.ahora__grupo')).toHaveText('Grupo: 1° A');
  await expect(ahora.locator('.ahora__materia')).toHaveText('Materia: Matemáticas');
  await expect(ahora).toContainText('termina a las 07:50');
  await expect(page.locator('.siguiente')).toContainText('RECESO');
  await expect(page.locator('.siguiente')).toContainText('09:30 a 10:00');
  // ENTRAR AL GRUPO (pasar lista)
  await ahora.getByRole('link', { name: 'Pasar lista' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Matemáticas, 1° A' })).toBeVisible();
  // Abrir la lista no guarda nada
  expect(await contar(page, 'pases')).toBe(0);
  expect(await contar(page, 'asistencias')).toBe(0);
  await expect(page.locator('.lista__contador')).toContainText('5 presentes');
  // PASAR LISTA: sólo se tocan F y R
  await page.getByRole('radiogroup', { name: 'Asistencia de Alumno Ficticio, Beto' }).getByRole('radio', { name: 'Falta' }).check();
  await page.getByRole('radiogroup', { name: 'Asistencia de Alumna Prueba, Carla' }).getByRole('radio', { name: 'Retardo' }).check();
  await expect(page.getByLabel('Hora de llegada de Alumna Prueba, Carla')).toHaveValue('07:15');
  await expect(page.locator('.lista__contador')).toContainText('3 presentes');
  await expect(page.locator('.lista__contador')).toContainText('1 faltas');
  await expect(page.locator('.lista__contador')).toContainText('1 retardos');
  // Beto con falta no puede ir al baño
  await expect(page.getByRole('button', { name: 'Salida al baño de Alumno Ficticio, Beto' })).toBeDisabled();
  // Ana va al baño (se registra al momento) y las marcas sin guardar se conservan
  await page.getByRole('button', { name: 'Salida al baño de Alumna Ficticia, Ana' }).click();
  await expect(page.locator('[data-alumno]', { hasText: 'Alumna Ficticia, Ana' })).toContainText('Fuera del aula desde las 07:15');
  await expect(page.locator('.lista__contador')).toContainText('1 faltas');
  // Ana salió: ya no se le puede poner falta
  await expect(page.getByRole('radiogroup', { name: 'Asistencia de Alumna Ficticia, Ana' }).getByRole('radio', { name: 'Falta' })).toBeDisabled();
  expect(await contar(page, 'pases')).toBe(0);
  // GUARDAR
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('Lista guardada: 3 presentes, 1 faltas, 1 retardos');
  await expect(page.locator('.lista__estado')).toContainText('Guardada a las 07:15');
  expect(await contar(page, 'pases')).toBe(1);
  expect(await contar(page, 'asistencias')).toBe(5);

  // Persistencia: recargar conserva todo
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Asistencia de Alumno Ficticio, Beto' }).getByRole('radio', { name: 'Falta' })).toBeChecked();
  // Reincorporación
  await page.clock.setFixedTime(new Date('2026-11-02T07:22:00-06:00'));
  await page.getByRole('button', { name: 'Reincorporar a Alumna Ficticia, Ana' }).click();
  await expect(page.locator('[data-alumno]', { hasText: 'Alumna Ficticia, Ana' })).not.toContainText('Fuera del aula');
  // En el panel, la lista aparece como guardada
  await page.getByRole('link', { name: 'Mi día' }).click();
  await expect(page.locator('.ahora')).toContainText('Lista guardada');
});

test('corrección de una lista guardada: la falta pasa a retardo; reporte breve; historial', async ({ page }) => {
  await preparar(page);
  await page.goto('/');
  await page.locator('.ahora').getByRole('link', { name: 'Pasar lista' }).click();
  await page.getByRole('radiogroup', { name: 'Asistencia de Alumna Ejemplo, Eva' }).getByRole('radio', { name: 'Falta' }).check();
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.lista__estado')).toContainText('Guardada');
  // Eva llega tarde: corregir a R
  await page.clock.setFixedTime(new Date('2026-11-02T07:30:00-06:00'));
  await page.getByRole('radiogroup', { name: 'Asistencia de Alumna Ejemplo, Eva' }).getByRole('radio', { name: 'Retardo' }).check();
  await expect(page.getByLabel('Hora de llegada de Alumna Ejemplo, Eva')).toHaveValue('07:30');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.aviso')).toContainText('0 faltas, 1 retardos');
  expect(await contar(page, 'asistencias')).toBe(5);
  // Reporte breve desde la lista
  await page.getByRole('button', { name: 'Reporte breve de Alumna Ejemplo, Eva' }).click();
  await page.getByRole('dialog').getByLabel('Tipo').selectOption('reconocimiento');
  await page.getByRole('dialog').getByLabel('Reporte').fill('Participó con una buena explicación.');
  await page.getByRole('button', { name: 'Guardar reporte' }).click();
  await expect(page.locator('.aviso')).toContainText('Reporte guardado');
  // Historial del alumno
  await page.getByRole('link', { name: 'Ver alumnos y faltas de 1° A' }).click();
  await expect(page.locator('.lista-resumen li', { hasText: 'Alumna Ejemplo, Eva' })).toContainText('1 R');
  await page.getByRole('link', { name: 'Alumna Ejemplo, Eva' }).click();
  await expect(page.locator('#faltas-titulo').locator('..')).toContainText('Retardo (llegó 07:30)');
  await expect(page.locator('#reportes-titulo').locator('..')).toContainText('Participó con una buena explicación.');
});

test('salir de la lista con marcas sin guardar pide confirmación', async ({ page }) => {
  await preparar(page);
  await page.goto('/');
  await page.locator('.ahora').getByRole('link', { name: 'Pasar lista' }).click();
  await page.getByRole('radiogroup', { name: 'Asistencia de Alumno Ficticio, Beto' }).getByRole('radio', { name: 'Falta' }).check();
  await page.getByRole('link', { name: 'Mi día' }).click();
  await expect(page.getByRole('dialog')).toContainText('cambios sin guardar');
  await page.getByRole('dialog').getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Asistencia de Alumno Ficticio, Beto' }).getByRole('radio', { name: 'Falta' })).toBeChecked();
  expect(await contar(page, 'pases')).toBe(0);
});

test('el panel y la lista son cómodos en teléfono (320 px)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await preparar(page);
  for (const ir of [async () => page.goto('/'), async () => page.locator('.ahora').getByRole('link', { name: 'Pasar lista' }).click()]) {
    await ir();
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const pequenos = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main .marca, main input[type=time]')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim()));
    expect(pequenos).toEqual([]);
  }
  // El botón Guardar queda siempre a la vista (barra fija)
  const barra = await page.locator('.lista__barra').boundingBox();
  expect(barra!.y + barra!.height).toBeLessThanOrEqual(700 + 1);
});
