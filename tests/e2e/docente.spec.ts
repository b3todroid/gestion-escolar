import { expect, test as base, type Page } from '@playwright/test';

// Fase 4 (módulo docente, segunda etapa). Escuela, docentes y alumnos ficticios. Lunes 2 de noviembre de 2026, hora de la Ciudad de México.
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


const a = (h: string) => new Date(`2026-11-02T${h}:00-06:00`);
const fila = (page: Page, n: string) => page.locator('[data-alumno]', { hasText: n });
const radio = (page: Page, n: string, m: string) => page.getByRole('radiogroup', { name: `Asistencia de ${n}` }).getByRole('radio', { name: m });

/** Hora SE confirmada del docente el lunes en el Módulo 2 (07:50–08:40). */
async function registrarSE(page: Page) {
  await page.getByRole('link', { name: 'Mi horario semanal' }).click();
  await page.getByText('Registrar horas de servicio (SE) u otra actividad').click();
  await page.locator('#f-actividad-dia').selectOption({ label: 'Lunes' });
  await page.locator('#f-actividad-periodoId').selectOption({ label: 'Módulo 2 (07:50–08:40)' });
  await page.locator('#f-actividad-descripcion').fill('Guardia en patio');
  await page.getByRole('button', { name: 'Registrar actividad' }).click();
  await expect(page.locator('.insignia', { hasText: 'SERVICIO confirmado' })).toBeVisible();
}

test('ABRIR → CLASE ACTUAL → ENTRAR AL GRUPO → PASAR LISTA → GUARDAR → SALIDA → REGRESO (con correcciones y conflicto)', async ({ page }) => {
  await preparar(page);
  // ABRIR: clase actual con fecha, hora, escuela, turno, grupo y materia
  await page.goto('/');
  await expect(page.locator('.mi-dia__fecha')).toHaveText('Lunes, 2 de noviembre de 2026');
  await expect(page.locator('.reloj')).toHaveText('07:15');
  await expect(page.locator('#mi-dia-escuela')).toHaveText('Escuela Secundaria Ficticia 110 · Turno Matutino · Ciclo 2026-2027');
  const ahora = page.locator('.ahora');
  await expect(ahora).toHaveAttribute('data-estado', 'clase');
  await expect(ahora).toContainText('1° A');
  await expect(ahora).toContainText('Matemáticas');
  // ENTRAR AL GRUPO → PASAR LISTA
  await ahora.getByRole('link', { name: 'Entrar al grupo 1° A' }).click();
  await page.getByRole('link', { name: 'Pasar lista: 07:00 Matemáticas' }).click();
  await expect(page.locator('#estado-lista')).toHaveText(/NO INICIADA/);
  await expect(page.locator('.lista__datos')).toHaveText('Grupo 1° A · Matemáticas · Módulo 1');
  expect(await contar(page, 'pases')).toBe(0); // abrir no guarda
  await radio(page, 'Alumno Ficticio, Beto', 'Falta').check();
  await radio(page, 'Alumna Prueba, Carla', 'Retardo').check();
  await expect(page.locator('#estado-lista')).toHaveText(/EN CAPTURA/);
  // GUARDAR
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('Lista guardada: 3 presentes, 1 faltas, 1 retardos. Guardado en este dispositivo.');
  await expect(page.locator('#estado-lista')).toHaveText(/GUARDADA/);
  // SALIDA (hora automática) — Beto tiene falta: no puede salir
  await expect(page.getByRole('button', { name: 'Salida al baño de Alumno Ficticio, Beto' })).toBeDisabled();
  await page.clock.setFixedTime(a('07:20'));
  await page.getByRole('button', { name: 'Salida al baño de Alumna Ficticia, Ana' }).click();
  await expect(fila(page, 'Alumna Ficticia, Ana')).toContainText('Fuera del aula desde las 07:20');
  await expect(page.locator('#fuera-lista')).toContainText('Alumna Ficticia, Ana desde las 07:20');
  // La salida activa se conserva al cambiar de pantalla
  await page.getByRole('link', { name: 'Mi día' }).click();
  await expect(page.locator('#fuera-del-aula')).toContainText('Alumna Ficticia, Ana');
  // REGRESO
  await page.clock.setFixedTime(a('07:27'));
  await page.locator('#fuera-del-aula').getByRole('link', { name: 'Registrar regreso' }).click();
  await page.getByRole('button', { name: 'Reincorporar a Alumna Ficticia, Ana' }).click();
  await expect(page.locator('.aviso')).toContainText('se reincorporó');
  await expect(fila(page, 'Alumna Ficticia, Ana')).not.toContainText('Fuera del aula');
  expect(await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const q = r.result.transaction('salidas').objectStore('salidas').getAll(); q.onsuccess = () => { ok(q.result.map((s: { salida: string; regreso: string; periodoId: string | null; personalId: string | null }) => [s.salida, s.regreso, !!s.periodoId, !!s.personalId])); r.result.close(); }; };
  }))).toEqual([['07:20', '07:27', true, true]]);

  // Conflicto: marcar FALTA a quien salió exige resolución explícita; «fue un error» anula la salida
  await radio(page, 'Alumna Ficticia, Ana', 'Falta').click();
  await expect(page.getByRole('dialog')).toContainText('Conflicto: Alumna Ficticia, Ana salió del aula');
  await page.getByRole('dialog').getByRole('button', { name: /se registró por error/ }).click();
  await expect(page.locator('.aviso')).toContainText('Salida anulada');
  await expect(radio(page, 'Alumna Ficticia, Ana', 'Falta')).toBeChecked();
  // CORRECCIÓN: Beto llegó tarde (F → R); queda historial y estado MODIFICADA
  await radio(page, 'Alumno Ficticio, Beto', 'Retardo').check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.aviso')).toContainText('Corrección guardada (2 cambio(s))');
  await expect(page.locator('#estado-lista')).toHaveText(/MODIFICADA/);
  await page.locator('#historial-lista summary').click();
  await expect(page.locator('#historial-lista')).toContainText('Alumno Ficticio, Beto: Falta → Retardo');
  await expect(page.locator('#historial-lista')).toContainText('Alumna Ficticia, Ana: Presente → Falta');
  expect(await contar(page, 'pases')).toBe(1);
  expect(await contar(page, 'cambiosAsistencia')).toBe(2);
  // PERSISTENCIA: recargar conserva lista, estado e historial
  await page.reload();
  await expect(page.locator('#estado-lista')).toHaveText(/MODIFICADA/);
  await expect(radio(page, 'Alumno Ficticio, Beto', 'Retardo')).toBeChecked();
  // Incidencia breve con hora
  await page.getByRole('button', { name: 'Reporte breve de Alumna Prueba, Carla' }).click();
  await page.getByRole('dialog').getByLabel('Tipo').selectOption('conducta');
  await page.getByRole('dialog').getByLabel('Reporte').fill('Llegó sin material por tercera vez.');
  await page.getByRole('button', { name: 'Guardar reporte' }).click();
  await page.getByRole('link', { name: 'Ver alumnos y faltas de 1° A' }).click();
  await page.getByRole('link', { name: 'Alumna Prueba, Carla' }).click();
  const reportes = page.locator('#reportes-titulo').locator('..');
  await expect(reportes).toContainText('07:27');
  await expect(reportes).toContainText('Abierta');
  await page.getByRole('button', { name: /Marcar atendida reporte/ }).click();
  await expect(reportes).toContainText('Atendida');
});

test('actividad actual: SE, receso, sin actividad registrada y fuera de jornada (límites exactos)', async ({ page }) => {
  await preparar(page);
  await registrarSE(page);
  const estado = async (h: string) => { await page.clock.setFixedTime(a(h)); await page.goto('/'); await page.reload(); return page.locator('.ahora').getAttribute('data-estado'); };
  expect(await estado('07:49')).toBe('clase');
  expect(await estado('07:50')).toBe('servicio');
  await expect(page.locator('.ahora')).toContainText('Guardia en patio');
  await expect(page.locator('.ahora')).toContainText('SERVICIO');
  expect(await estado('09:45')).toBe('receso');
  expect(await estado('08:50')).toBe('sin_actividad');
  await expect(page.locator('.ahora')).toContainText('SIN ACTIVIDAD REGISTRADA');
  expect(await estado('06:30')).toBe('fuera_de_jornada');
  await expect(page.locator('.ahora')).toContainText('FUERA DE JORNADA');
  await expect(page.locator('.siguiente')).toContainText('1° A, Matemáticas');
  // Horario personal: viene del módulo Horarios (clase, SE confirmada y receso)
  await page.getByRole('link', { name: 'Mi horario semanal' }).click();
  const lunes = page.locator('.semana-docente__dia', { hasText: 'Lunes' });
  await expect(lunes).toContainText('1° A Matemáticas');
  await expect(lunes).toContainText('Guardia en patio');
  await expect(lunes).toContainText('RECESO');
  await expect(page.locator('#datos-docente')).toContainText('1 confirmada(s)');
});

test('móvil 320 px: búsqueda rápida en la lista y objetivos táctiles grandes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await preparar(page);
  await page.goto('/');
  await page.locator('.ahora').getByRole('link', { name: 'Pasar lista' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const pequenos = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main .marca')]
    .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim()));
  expect(pequenos).toEqual([]);
  await page.getByLabel('Buscar alumno').fill('carla');
  await expect(page.locator('[data-alumno]:visible')).toHaveCount(1);
  await expect(page.locator('[data-alumno]:visible')).toContainText('Alumna Prueba, Carla');
  await radio(page, 'Alumna Prueba, Carla', 'Falta').check();
  await page.getByLabel('Buscar alumno').fill('');
  await expect(page.locator('[data-alumno]:visible')).toHaveCount(5);
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('4 presentes, 1 faltas');
});
