import { expect, test as base, type Page } from '@playwright/test';

/**
 * Auditoría de la Fase 1: recorre todos los botones, ediciones, duplicados,
 * traslapes, persistencia en IndexedDB, uso en teléfono y errores de consola.
 * Datos ficticios únicamente.
 */

// Cada prueba falla si aparece un error en consola o una excepción no controlada.
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});

/** Lee directamente IndexedDB (no la interfaz) para comprobar lo guardado. */
async function contarEnBD(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => new Promise<Record<string, number>>((ok, mal) => {
    const req = indexedDB.open('gestion-escolar');
    req.onerror = () => mal(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tablas = Array.from(db.objectStoreNames);
      const tx = db.transaction(tablas, 'readonly');
      const r: Record<string, number> = {};
      tablas.forEach((t) => { const c = tx.objectStore(t).count(); c.onsuccess = () => { r[t] = c.result; }; });
      tx.oncomplete = () => { db.close(); ok(r); };
    };
  }));
}

async function crearConAsistente(page: Page, nombre = 'Escuela Secundaria Ficticia 40', cct = '32ZZZ0040A') {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre de la escuela').fill(nombre);
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill(cct);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
}

test.describe('guardado e IndexedDB', () => {
  test('el asistente escribe en IndexedDB y un doble clic en Guardar no duplica nada', async ({ page }) => {
    await page.goto('/#/asistente');
    await page.getByLabel('Nombre de la escuela').fill('Escuela Ficticia Doble');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nombre del turno').fill('Matutino');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Guardar escuela' }).dblclick();
    await expect(page.getByRole('heading', { level: 1, name: /^Ciclo / })).toBeVisible();
    // 6 módulos + 1 receso, 3 grados × 2 grupos
    const esperado = { escuelas: 1, ciclosEscolares: 1, turnos: 1, jornadas: 1, periodos: 6, recesos: 1, grados: 3, grupos: 6 };
    const conteo = await contarEnBD(page);
    expect(conteo).toMatchObject(esperado);
    // Cualquier otra tabla (de fases posteriores) debe quedar vacía.
    expect(Object.entries(conteo).filter(([t, n]) => !(t in esperado) && n !== 0)).toEqual([]);
    await page.reload();
    expect(await contarEnBD(page)).toMatchObject({ escuelas: 1, grupos: 6 });
    await expect(page.locator('.grupo')).toHaveCount(6);
  });

  test('un doble envío del formulario de grupo no crea grupos duplicados', async ({ page }) => {
    await crearConAsistente(page);
    await page.locator('summary', { hasText: 'Agregar grupo' }).click();
    await page.locator('#f-grupo-gradoId').selectOption({ label: 'Primer grado' });
    await page.locator('#f-grupo-nombre').fill('C');
    await page.locator('#f-grupo button[type="submit"]').dblclick();
    await expect(page.getByText('1° C')).toHaveCount(1);
    expect((await contarEnBD(page)).grupos).toBe(7);
  });
});

test.describe('edición', () => {
  test('editar escuela, ciclo, turno, periodo, receso, grado y grupo', async ({ page }) => {
    await crearConAsistente(page);
    const urlCiclo = page.url();

    // Turno: cambiar nombre y salida
    await page.getByRole('button', { name: 'Editar turno Matutino' }).click();
    await page.locator('#f-turno-nombre').fill('Matutino A');
    await page.locator('#f-turno-horaFin').fill('13:30');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Lunes a viernes, de 07:00 a 13:30')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Matutino A' })).toBeVisible();

    // Grado
    await page.getByRole('button', { name: 'Editar Tercer grado' }).click();
    await page.locator('#f-grado-nombre').fill('Tercero');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('heading', { name: 'Tercero' })).toBeVisible();

    // Grupo: renombrar y cambiar capacidad
    await page.getByRole('button', { name: 'Editar grupo 1° B' }).click();
    await page.locator('#f-grupo-nombre').fill('D');
    await page.locator('#f-grupo-capacidad').fill('30');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('1° D')).toBeVisible();
    await expect(page.getByText('Matutino A, 30 lugares')).toBeVisible();

    // Grupo: renombrar a uno existente → rechazado
    await page.getByRole('button', { name: 'Editar grupo 1° D' }).click();
    await page.locator('#f-grupo-nombre').fill('a');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('#f-grupo .resumen-errores')).toContainText('Ya existe el grupo');
    await page.locator('#f-grupo').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('#f-grupo button[type="submit"]')).toHaveText('Agregar grupo');

    // Periodo y receso
    await page.getByRole('link', { name: 'Periodos y recesos' }).click();
    await page.getByRole('button', { name: 'Editar Módulo 2' }).click();
    await page.locator('#f-bloque-nombre').fill('Módulo 2 (laboratorio)');
    await page.locator('#f-bloque-horaFin').fill('08:30');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('.bloque__nombre', { hasText: 'Módulo 2 (laboratorio)' })).toBeVisible();
    // Receso: alargarlo hasta invadir el Módulo 4 (10:00) se rechaza; acortarlo se guarda
    await page.getByRole('button', { name: 'Editar Receso' }).click();
    await page.locator('#f-bloque-horaFin').fill('10:10');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('#f-bloque .resumen-errores')).toContainText('Se traslapa con el periodo «Módulo 4»');
    await page.locator('#f-bloque-horaFin').fill('09:50');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('.bloque--receso')).toContainText('20 min');

    // Ciclo y escuela
    await page.goto(urlCiclo);
    await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 40' }).click();
    await page.getByRole('button', { name: /^Editar ciclo/ }).click();
    await page.locator('#f-ciclo-nombre').fill('2026-2027 B');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('heading', { name: 'Ciclo 2026-2027 B' })).toBeVisible();
    await page.getByRole('link', { name: 'Editar datos' }).click();
    await page.getByLabel('Localidad o municipio').fill('Localidad Nueva');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Localidad Nueva')).toBeVisible();

    // Todo sigue tras recargar
    await page.reload();
    await expect(page.getByText('Localidad Nueva')).toBeVisible();
    await page.getByRole('link', { name: 'Configurar' }).click();
    await expect(page.getByText('1° D')).toBeVisible();
  });
});

test.describe('reglas', () => {
  test('detecta periodos superpuestos al agregar y al editar', async ({ page }) => {
    await crearConAsistente(page);
    await page.getByRole('link', { name: 'Periodos y recesos' }).click();
    // Agregar uno que choca con Módulo 1 (07:00–07:50)
    await page.locator('#f-bloque-horaInicio').fill('07:30');
    await page.locator('#f-bloque-horaFin').fill('08:00');
    await page.getByRole('button', { name: 'Agregar bloque' }).click();
    await expect(page.locator('#f-bloque .resumen-errores')).toContainText('Se traslapa con el periodo «Módulo 1»');
    // Editar Módulo 2 para que invada el Módulo 3
    await page.getByRole('button', { name: 'Editar Módulo 2' }).click();
    await page.locator('#f-bloque-horaFin').fill('09:00');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('#f-bloque .resumen-errores')).toContainText('Se traslapa con el periodo «Módulo 3»');
    // Fuera de la jornada
    await page.locator('#f-bloque').getByRole('button', { name: 'Cancelar' }).click();
    await page.locator('#f-bloque-horaInicio').fill('12:40');
    await page.locator('#f-bloque-horaFin').fill('13:30');
    await page.getByRole('button', { name: 'Agregar bloque' }).click();
    await expect(page.locator('#f-bloque .resumen-errores')).toContainText('dentro de la jornada');
    expect((await contarEnBD(page)).periodos).toBe(6);
  });

  test('estados del ciclo: activar, cerrar (sólo lectura) y eliminar bloqueado', async ({ page }) => {
    await crearConAsistente(page);
    await page.getByRole('link', { name: 'Escuela Secundaria Ficticia 40' }).click();
    await page.getByRole('button', { name: /^Eliminar ciclo/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.locator('.aviso--error')).toContainText('Elimínalos antes');
    await page.getByRole('button', { name: /^Cerrar ciclo/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar ciclo' }).click();
    await expect(page.locator('.tarjeta .insignia')).toContainText('Cerrado');
    await page.getByRole('link', { name: 'Configurar' }).click();
    await expect(page.getByText('su configuración se muestra sólo para consulta')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Editar/ })).toHaveCount(0);
  });

  test('eliminar grupo, grado y turno con confirmación', async ({ page }) => {
    await crearConAsistente(page);
    // Turno con grupos: sólo informa
    await page.getByRole('button', { name: 'Eliminar turno Matutino' }).click();
    await expect(page.getByRole('dialog')).toContainText('No se puede eliminar');
    await page.getByRole('dialog').getByRole('button', { name: 'Entendido' }).click();
    for (const g of ['1° A', '1° B']) {
      await page.getByRole('button', { name: `Eliminar grupo ${g}` }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
      await expect(page.getByText(g, { exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Eliminar Primer grado' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('heading', { name: 'Primer grado' })).toHaveCount(0);
    expect(await contarEnBD(page)).toMatchObject({ grados: 2, grupos: 4 });
  });
});

test.describe('navegación sin pérdida de datos', () => {
  test('Atrás, Cambiar y el botón del navegador conservan lo capturado en el asistente', async ({ page }) => {
    await page.goto('/#/asistente');
    await page.getByLabel('Nombre de la escuela').fill('Escuela Ficticia Navegación');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nombre del ciclo').fill('2027-2028');
    await page.getByRole('button', { name: 'Atrás' }).click();
    await expect(page.getByLabel('Nombre de la escuela')).toHaveValue('Escuela Ficticia Navegación');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByLabel('Nombre del ciclo')).toHaveValue('2027-2028');
    // Salir al inicio y volver
    await page.getByRole('link', { name: 'Inicio' }).click();
    await expect(page.getByRole('heading', { name: 'Configuración sin terminar' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Nombre del ciclo')).toHaveValue('2027-2028');
    // Llegar al último paso y volver con «Cambiar»
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nombre del turno').fill('Vespertino');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Revisar y guardar' })).toBeVisible();
    await page.getByRole('button', { name: 'Cambiar turno' }).click();
    await expect(page.getByLabel('Nombre del turno')).toHaveValue('Vespertino');
    // Descartar pide confirmación
    await page.goto('/#/');
    await page.getByRole('button', { name: 'Descartar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByRole('link', { name: 'Configurar una escuela nueva' })).toBeVisible();
  });

  test('una dirección inexistente muestra un mensaje y permite volver', async ({ page }) => {
    await page.goto('/#/no-existe');
    await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver al inicio' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Escuelas' })).toBeVisible();
  });
});

test.describe('uso en teléfono', () => {
  for (const ancho of [320, 375]) {
    test(`sin desplazamiento horizontal y con botones de tamaño táctil a ${ancho}px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 720 });
      await crearConAsistente(page);
      const rutas = [page.url()];
      await page.getByRole('link', { name: 'Periodos y recesos' }).click();
      rutas.push(page.url(), new URL('/#/', page.url()).href, new URL('/#/asistente', page.url()).href);
      for (const ruta of rutas) {
        await page.goto(ruta);
        await page.waitForLoadState('networkidle');
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(desborde, `desborde horizontal en ${ruta}`).toBeLessThanOrEqual(0);
        const pequenos = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main input, main select, main summary')]
            .filter((el) => el.offsetParent !== null)
            .map((el) => ({ t: (el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
            .filter((x) => x.h < 44));
        expect(pequenos, `objetivos táctiles < 44px en ${ruta}`).toEqual([]);
      }
    });
  }
});
