import { expect, test as base, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Fase 9 — flujo integral de punta a punta en UNA sola prueba (datos FICTICIOS):
// CONFIGURAR ESCUELA → CREAR GRUPOS → IMPORTAR ALUMNOS → REGISTRAR DOCENTES (importación) → ASIGNAR HORARIO
// → CONSULTAR CLASE → PASAR LISTA → RETARDO → SALIDA AL BAÑO → REGRESO → CONSULTAR REPORTE.
// Lunes 2 de noviembre de 2026, hora de la Ciudad de México.
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
const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));
const a = (h: string) => new Date(`2026-11-02T${h}:00-06:00`);
const radio = (page: Page, n: string, m: string) => page.getByRole('radiogroup', { name: `Asistencia de ${n}` }).getByRole('radio', { name: m });

test('flujo integral: de la configuración al reporte de asistencia', async ({ page }) => {
  await page.clock.install({ time: a('07:15') });

  // CONFIGURAR ESCUELA y CREAR GRUPOS (1° A y 1° B)
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia Integral');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0901A');
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

  // IMPORTAR ALUMNOS (Excel con sinónimos de encabezados)
  await nav().getByRole('link', { name: 'Importar información' }).click();
  await page.getByRole('radio', { name: /^Alumnos/ }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture('alumnos-sinonimos.xlsx'));
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (4)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('4 registro(s) nuevo(s)');

  // REGISTRAR DOCENTES (importación de personal desde CSV)
  await page.goto(panel);
  await nav().getByRole('link', { name: 'Importar información' }).click();
  await page.getByRole('radio', { name: /^Personal/ }).check();
  await page.locator('#archivo-datos').setInputFiles(fixture('personal.csv'));
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar e importar (2)' }).click();
  await expect(page.locator('#resultado-importacion')).toContainText('1 fila(s) con error o conflicto no se guardaron');

  // MATERIAS y ASIGNAR HORARIO (Matemáticas con Mario Ficticio, lunes 07:00, 1° A)
  await page.goto(panel);
  await nav().getByRole('link', { name: 'Materias' }).click();
  await page.locator('#f-lote-lote').fill('Matemáticas');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.locator('.renglon', { hasText: 'Matemáticas' })).toBeVisible();
  await page.goto(panel);
  await page.getByRole('link', { name: 'Administrar grupos' }).click();
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  await page.locator('#f-asignacion-materiaId').selectOption({ label: 'Matemáticas' });
  await page.locator('#f-asignacion-personalId').selectOption({ label: 'Mario Ficticio' });
  await page.locator('#f-asignacion-horasSemana').fill('5');
  await page.getByRole('button', { name: 'Asignar materia' }).click();
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('Matemáticas');

  // CONSULTAR CLASE (dispositivo del docente: preferencia, no autenticación)
  await page.goto('/#/perfil');
  await page.getByRole('button', { name: 'Soy yo' }).click();
  // Fase 10 (INC-01): esperar a que la elección quede guardada antes de recargar (era intermitente).
  await expect(page.getByRole('heading', { level: 1, name: /^Hola,/ })).toBeVisible();
  await page.goto('/');
  const ahora = page.locator('.ahora');
  await expect(ahora).toHaveAttribute('data-estado', 'clase');
  await expect(ahora).toContainText('1° A');
  await expect(ahora).toContainText('Matemáticas');

  // PASAR LISTA con RETARDO
  await ahora.getByRole('link', { name: 'Entrar al grupo 1° A' }).click();
  await page.getByRole('link', { name: 'Pasar lista: 07:00 Matemáticas' }).click();
  await radio(page, 'Ficticio, Beto', 'Retardo').check();
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('Lista guardada: 1 presentes, 0 faltas, 1 retardos.');

  // SALIDA AL BAÑO y REGRESO
  await page.clock.setFixedTime(a('07:20'));
  await page.getByRole('button', { name: 'Salida al baño de Ficticia Prueba, Ana' }).click();
  await expect(page.locator('#fuera-lista')).toContainText('Ficticia Prueba, Ana desde las 07:20');
  await page.clock.setFixedTime(a('07:31'));
  await page.getByRole('button', { name: 'Reincorporar a Ficticia Prueba, Ana' }).click();
  await expect(page.locator('.aviso')).toContainText('se reincorporó');

  // CONSULTAR REPORTE (asistencia del ciclo del grupo e historial del alumno), también tras recargar
  await page.reload();
  await page.goto('/');
  await page.locator('.ahora').getByRole('link', { name: 'Entrar al grupo 1° A' }).click();
  const beto = page.locator('.lista-resumen li', { hasText: 'Ficticio, Beto' });
  await expect(beto).toContainText('1 R');
  const ana = page.locator('.lista-resumen li', { hasText: 'Ficticia Prueba, Ana' });
  await ana.getByRole('link', { name: /Ana/ }).click();
  await expect(page.locator('main')).toContainText('07:20');
  await expect(page.locator('main')).toContainText('07:31');
});
