/// <reference types="node" />
import { chromium, devices, expect, test as base, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Horarios, escuelas y personas ficticias. Los archivos de Excel se generan con openpyxl.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

/** Escuela con 1° A y 1° B (Matutino 07:00–13:00), dos docentes y dos materias. */
export async function preparar(page: Page): Promise<string> {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre de la escuela').fill('Escuela Secundaria Ficticia 90');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Al grado').fill('1');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  const urlCiclo = page.url();
  await page.getByRole('link', { name: 'Registrar materias' }).click();
  await page.locator('#f-lote-lote').fill('Español\nMatemáticas');
  await page.getByRole('button', { name: 'Agregar materias' }).click();
  await expect(page.getByRole('heading', { name: 'Materias del ciclo (2)' })).toBeVisible();
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 90' }).click();
  await page.getByRole('link', { name: 'Registrar personal' }).click();
  for (const [ap1, ap2, num] of [['Ficticio', 'Uno', 'E-001'], ['Ficticia', 'Dos', '']] as const) {
    await page.locator('#f-persona-nombre').fill('Docente');
    await page.locator('#f-persona-primerApellido').fill(ap1);
    await page.locator('#f-persona-segundoApellido').fill(ap2);
    await page.locator('#f-persona-numeroEmpleado').fill(num);
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await expect(page.getByRole('link', { name: `Docente ${ap1} ${ap2}` })).toBeVisible();
  }
  return urlCiclo;
}

async function importar(page: Page, urlCiclo: string, archivo: string) {
  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Importar horarios desde Excel' }).click();
  await page.locator('#archivo-horario').setInputFiles(`tests/fixtures/${archivo}`);
  await expect(page.getByRole('heading', { name: `Revisión de «${archivo}»` })).toBeVisible();
}

test('importación de Excel: conflictos intencionales se muestran y no se guarda nada; el archivo válido se importa', async ({ page }) => {
  const urlCiclo = await preparar(page);
  await importar(page, urlCiclo, 'horario-conflictos.xlsx');
  const revision = page.locator('.importacion');
  await expect(revision).toContainText('No se puede importar');
  await expect(revision).toContainText('1° A tendría dos clases a la misma hora (filas 2 y 4)');
  await expect(revision).toContainText('El docente estaría en dos grupos a la vez (filas 2 y 3)');
  await expect(revision).toContainText('El sábado no es laborable');
  await expect(revision).toContainText('no tiene un periodo que inicie a las 09:15');
  await expect(revision).toContainText('La materia «Química» no está registrada');
  await expect(revision).toContainText('No existe el grupo 9° Z');
  await expect(page.getByRole('button', { name: /^Importar/ })).toHaveCount(0);

  await importar(page, urlCiclo, 'horario-valido.xlsx');
  await expect(revision).toContainText('El archivo es válido');
  await expect(revision).toContainText('Se asignará Matemáticas a 1° A con 2 hora(s) por semana.');
  await page.getByRole('button', { name: 'Importar 4 clase(s)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  const lunes = page.locator('.tabla-semana tbody tr');
  await expect(lunes.nth(0).locator('td').first()).toContainText('Matemáticas');
  await expect(lunes.nth(1).locator('td').first()).toContainText('Español');
  await expect(lunes.nth(3)).toContainText('RECESO');
  await expect(lunes.nth(4).locator('td').first()).toContainText('SIN ACTIVIDAD REGISTRADA');
});

test('servicio confirmado, otra actividad, caso especial y horario confirmado con autorización', async ({ page }) => {
  const urlCiclo = await preparar(page);
  await importar(page, urlCiclo, 'horario-valido.xlsx');
  await page.getByRole('button', { name: 'Importar 4 clase(s)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();

  // Docente: hora de servicio que choca con clase → rechazo; luego válida y confirmada
  await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 90' }).click();
  await page.getByRole('link', { name: 'Ver personal' }).click();
  await page.getByRole('link', { name: 'Docente Ficticio Uno' }).click();
  await page.getByText('Registrar hora de servicio u otra actividad').click();
  await page.locator('#f-actividad-dia').selectOption('1');
  await page.locator('#f-actividad-horaInicio').fill('07:30');
  await page.locator('#f-actividad-horaFin').fill('08:00');
  await page.locator('#f-actividad-descripcion').fill('Guardia en patio');
  await page.getByRole('button', { name: 'Registrar actividad' }).click();
  await expect(page.locator('#f-actividad .resumen-errores')).toContainText('ya tiene clase con 1° A');
  await page.locator('#f-actividad-horaInicio').fill('08:40');
  await page.locator('#f-actividad-horaFin').fill('09:30');
  await page.getByRole('button', { name: 'Registrar actividad' }).click();
  await expect(page.locator('.insignia', { hasText: 'SERVICIO por confirmar' })).toBeVisible();
  await expect(page.locator('.semana-docente__dia', { hasText: 'Lunes' })).toContainText('SERVICIO (POR CONFIRMAR)');
  await page.getByRole('button', { name: 'Confirmar Guardia en patio' }).click();
  await expect(page.locator('.insignia', { hasText: 'SERVICIO confirmado' })).toBeVisible();
  await expect(page.locator('.totales div', { hasText: 'Servicio confirmado' })).toContainText('50 min');
  // Un hueco no es servicio
  await expect(page.locator('.semana-docente__dia', { hasText: 'Martes' })).toContainText('SIN ACTIVIDAD REGISTRADA');
  // Confirmado: sólo se puede quitar la confirmación con motivo
  await expect(page.getByRole('button', { name: 'Eliminar Guardia en patio' })).toHaveCount(0);

  // Caso especial: permite 1° B el lunes 07:00 con el mismo docente
  await page.getByText('Autorizar un caso especial').click();
  await page.locator('#f-excepcion-dia').selectOption('1');
  await page.locator('#f-excepcion-horaInicio').fill('07:00');
  await page.locator('#f-excepcion-horaFin').fill('07:50');
  await page.locator('#f-excepcion-motivo').fill('Taller conjunto de 1° A y 1° B');
  await page.getByRole('button', { name: 'Autorizar caso especial' }).click();
  await expect(page.locator('#excepciones-titulo').locator('..')).toContainText('Taller conjunto');

  await page.goto(urlCiclo);
  await page.getByRole('link', { name: 'Materias y horario de 1° B' }).click();
  // Desde el Excel, Matemáticas en 1° B tiene 1 hora (ya usada): se amplía a 2
  await page.getByRole('button', { name: 'Editar Matemáticas' }).click();
  await page.locator('#f-asignacion-horasSemana').fill('2');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('1 de 2 horas en el horario')).toBeVisible();
  await page.getByRole('button', { name: 'Asignar Lunes 07:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Matemáticas/ }).click();
  await expect(page.locator('[data-periodo]').first()).toContainText('Matemáticas');

  // Otra actividad en un periodo del grupo
  await page.getByRole('button', { name: 'Asignar Lunes 10:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Otra actividad/ }).click();
  await page.getByLabel('Descripción').fill('Honores a la bandera');
  await page.getByRole('button', { name: 'Guardar actividad' }).click();
  await expect(page.locator('.tabla-semana')).toContainText('OTRA ACTIVIDAD');
  await expect(page.locator('.tabla-semana')).toContainText('Honores a la bandera');

  // Confirmar: el editor desaparece; reabrir exige motivo
  await page.getByRole('button', { name: 'Confirmar horario' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar horario' }).click();
  await expect(page.getByText(/Horario confirmado el/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Editar por día' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reabrir para editar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir horario' }).click();
  await expect(page.getByRole('dialog')).toContainText('Escribe al menos 5 caracteres');
  await page.getByRole('dialog').getByLabel('Motivo').fill('Ajuste solicitado por dirección');
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir horario' }).click();
  await expect(page.getByRole('heading', { name: 'Editar por día' })).toBeVisible();
});

test('los horarios se conservan al cerrar y volver a abrir el navegador', async ({ baseURL }) => {
  const perfil = mkdtempSync(join(tmpdir(), 'perfil-ge-'));
  try {
    const abrir = () => chromium.launchPersistentContext(perfil, { ...devices['Pixel 7'], baseURL });
    let navegador = await abrir();
    let page = navegador.pages()[0] ?? await navegador.newPage();
    const urlCiclo = await preparar(page);
    await importar(page, urlCiclo, 'horario-valido.xlsx');
    await page.getByRole('button', { name: 'Importar 4 clase(s)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
    await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
    await page.getByRole('button', { name: 'Confirmar horario' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar horario' }).click();
    await expect(page.getByText(/Horario confirmado el/)).toBeVisible();
    await navegador.close(); // cierra por completo la aplicación

    navegador = await abrir();
    page = navegador.pages()[0] ?? await navegador.newPage();
    await page.goto('/');
    await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 90' }).click();
    await page.getByRole('link', { name: 'Configurar' }).click();
    await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
    await expect(page.getByText(/Horario confirmado el/)).toBeVisible();
    await expect(page.locator('.tabla-semana tbody tr').first().locator('td').first()).toContainText('Matemáticas');
    await navegador.close();
  } finally {
    rmSync(perfil, { recursive: true, force: true });
  }
});

test('las pantallas de horarios son cómodas en teléfono (320 px)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const urlCiclo = await preparar(page);
  await importar(page, urlCiclo, 'horario-valido.xlsx');
  const rutaImportar = page.url();
  await page.getByRole('button', { name: 'Importar 4 clase(s)' }).click();
  await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
  const rutaGrupo = page.url();
  await page.getByRole('link', { name: 'Docente Ficticio', exact: true }).first().click();
  const rutaDocente = page.url();
  for (const ruta of [rutaGrupo, rutaDocente, rutaImportar]) {
    await page.goto(ruta);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `desborde en ${ruta}`).toBeLessThanOrEqual(0);
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main input:not([type=radio]), main select, main summary')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim() || el.id));
    expect(pequenos, `controles < 44 px en ${ruta}`).toEqual([]);
    const encimados = await page.evaluate(() => [...document.querySelectorAll('.celda')].filter((c) => {
      const b = c.querySelector('.boton')?.getBoundingClientRect(); const t = c.querySelector('.celda__cuerpo')?.getBoundingClientRect();
      return b && t && b.left < t.right && t.left < b.right && b.top < t.bottom && t.top < b.bottom;
    }).length);
    expect(encimados, 'texto encimado con botones').toBe(0);
  }
});
