import { expect, test as base, chromium, devices, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fase 5 — PWA y funcionamiento sin conexión. Escuela, docente y alumnos ficticios.
// Se usa un perfil de navegador en disco para comprobar también el cierre y reapertura reales.
const test = base;
const LUNES_0715 = new Date('2026-11-02T07:15:00-06:00');
const OPCIONES = { ...devices['Pixel 7'], timezoneId: 'America/Mexico_City', locale: 'es-MX' };

function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(e.message));
  return errores;
}

async function controladaPorSW(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

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



const radio = (page: Page, n: string, m: string) => page.getByRole('radiogroup', { name: `Asistencia de ${n}` }).getByRole('radio', { name: m });

test('sin conexión: consultas, pase de lista, retardos, salidas, regreso e incidencias; persisten al cerrar y abrir el navegador', async ({ baseURL }) => {
  const perfil = mkdtempSync(join(tmpdir(), 'perfil-offline-'));
  let navegador: BrowserContext | null = null;
  try {
    navegador = await chromium.launchPersistentContext(perfil, { ...OPCIONES, baseURL });
    let page = navegador.pages()[0] ?? await navegador.newPage();
    let errores = vigilarErrores(page);
    await preparar(page); // con conexión: primera carga y datos de prueba
    await controladaPorSW(page);

    // ---- SIN CONEXIÓN ----
    await navegador.setOffline(true);
    await page.goto('/');
    await expect(page.locator('#conexion')).toContainText('Sin conexión');
    await expect(page.locator('.ahora')).toHaveAttribute('data-estado', 'clase');
    // Consultas: escuelas, grupos, docentes, alumnos y horarios
    await page.goto('/#/escuelas');
    await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 110' }).click();
    await expect(page.getByRole('heading', { name: 'Catálogos escolares' })).toBeVisible();
    await page.getByRole('link', { name: 'Administrar grupos' }).click();
    await expect(page.getByRole('link', { name: 'Materias y horario de 1° A' })).toBeVisible();
    await page.goBack();
    const nav = () => page.getByRole('navigation', { name: 'Catálogos escolares' });
    await nav().getByRole('link', { name: 'Docentes' }).click();
    await expect(page.locator('.tarjeta', { hasText: 'Docente Ficticio' })).toBeVisible();
    await nav().getByRole('link', { name: 'Alumnos' }).click();
    await expect(page.locator('#resumen-alumnos div', { hasText: 'Inscritos' }).locator('dd')).toHaveText('5');
    await page.goBack(); await page.goBack();
    await page.getByRole('link', { name: 'Horarios', exact: true }).click();
    await page.locator('#sel-grupo').selectOption({ label: '1° A' });
    await page.getByRole('button', { name: 'Ver horario del grupo' }).click();
    await expect(page.locator('.tabla-semana tbody tr').first().locator('td').first()).toContainText('Matemáticas');
    // Pase de lista con retardo, salida, regreso e incidencia
    await page.goto('/');
    await page.locator('.ahora').getByRole('link', { name: 'Pasar lista' }).click();
    const urlLista = page.url();
    await radio(page, 'Alumno Ficticio, Beto', 'Falta').check();
    await radio(page, 'Alumna Prueba, Carla', 'Retardo').check();
    await page.getByRole('button', { name: 'Guardar lista' }).click();
    await expect(page.locator('.aviso')).toContainText('Guardado en este dispositivo');
    await expect(page.locator('#estado-lista')).toHaveText(/GUARDADA/);
    await page.getByRole('button', { name: 'Salida al baño de Alumna Ficticia, Ana' }).click();
    await expect(page.locator('#fuera-lista')).toContainText('Alumna Ficticia, Ana');
    await page.getByRole('button', { name: 'Reincorporar a Alumna Ficticia, Ana' }).click();
    await expect(page.locator('.aviso')).toContainText('se reincorporó');
    await page.getByRole('button', { name: 'Reporte breve de Alumna Prueba, Carla' }).click();
    await page.getByRole('dialog').getByLabel('Tipo').selectOption('conducta');
    await page.getByRole('dialog').getByLabel('Reporte').fill('Incidencia ficticia registrada sin conexión.');
    await page.getByRole('button', { name: 'Guardar reporte' }).click();
    await expect(page.locator('.aviso')).toContainText('Reporte guardado');
    // Todo quedó en IndexedDB (no en variables temporales)
    expect([await contar(page, 'pases'), await contar(page, 'asistencias'), await contar(page, 'salidas'), await contar(page, 'reportes')]).toEqual([1, 5, 1, 1]);
    // Recargar sin conexión
    await page.reload();
    await expect(page.locator('#estado-lista')).toHaveText(/GUARDADA/);
    await expect(radio(page, 'Alumna Prueba, Carla', 'Retardo')).toBeChecked();
    expect(errores).toEqual([]);
    await navegador.close(); navegador = null;

    // ---- CERRAR Y VOLVER A ABRIR EL NAVEGADOR, AÚN SIN CONEXIÓN ----
    navegador = await chromium.launchPersistentContext(perfil, { ...OPCIONES, baseURL, offline: true });
    page = navegador.pages()[0] ?? await navegador.newPage();
    errores = vigilarErrores(page);
    await page.goto(urlLista);
    await expect(page.locator('#conexion')).toContainText('Sin conexión');
    await expect(page.locator('#estado-lista')).toHaveText(/GUARDADA/);
    await expect(radio(page, 'Alumno Ficticio, Beto', 'Falta')).toBeChecked();
    await expect(radio(page, 'Alumna Prueba, Carla', 'Retardo')).toBeChecked();
    expect(await contar(page, 'reportes')).toBe(1);
    expect(errores).toEqual([]);

    // ---- ACTUALIZACIÓN DE LA APLICACIÓN SIN PÉRDIDA DE DATOS ----
    // Una actualización reemplaza el Service Worker y las cachés de recursos; los datos viven en IndexedDB.
    await navegador.setOffline(false);
    await page.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    await page.goto('/');
    await controladaPorSW(page); // la versión «nueva» se registra de nuevo
    expect([await contar(page, 'pases'), await contar(page, 'salidas'), await contar(page, 'reportes')]).toEqual([1, 1, 1]);
    // Las cachés sólo contienen recursos de la aplicación, nunca datos escolares
    const urls = await page.evaluate(async () => {
      const r: string[] = [];
      for (const k of await caches.keys()) for (const q of await (await caches.open(k)).keys()) r.push(new URL(q.url).pathname);
      return r;
    });
    expect(urls.length).toBeGreaterThan(5);
    expect(urls.every((u) => /\.(js|css|html|svg|png|webmanifest|woff2|xlsx)$/.test(u) || u === '/')).toBe(true);
    await navegador.close(); navegador = null;
  } finally {
    await navegador?.close();
    rmSync(perfil, { recursive: true, force: true });
  }
});

test('instalación PWA: manifiesto, iconos y Service Worker cumplen los requisitos', async ({ page, request }) => {
  const errores = vigilarErrores(page);
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const m = await (await request.get(href!)).json();
  expect(m).toMatchObject({ name: 'Gestión Escolar', short_name: 'Escolar', display: 'standalone', lang: 'es', start_url: './', scope: './', theme_color: '#1f4d3a' });
  for (const tam of ['192x192', '512x512']) {
    const icono = m.icons.find((i: { sizes: string; purpose?: string }) => i.sizes === tam && !i.purpose);
    const r = await request.get(icono.src);
    expect(r.ok()).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null)).toBe('activated');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  // Pantalla «Aplicación y datos»
  await page.goto('/#/aplicacion');
  await expect(page.locator('#estado-offline')).toContainText('Lista para usarse sin conexión');
  await expect(page.locator('#zona-instalar')).toContainText('iPhone o iPad (Safari)');
  await expect(page.locator('#zona-persistencia')).toBeVisible();
  expect(errores).toEqual([]);
});
