/// <reference types="node" />
import { expect, test as base, type Page } from '@playwright/test';

// Escuela ficticia. Imagen de 1×1 px para probar el logotipo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const test = base.extend<{ errores: string[] }>({
  errores: [async ({ page }, usar) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await usar(errores);
    expect(errores, 'errores en consola').toEqual([]);
  }, { auto: true }],
});
const sig = (page: Page) => page.getByRole('button', { name: 'Siguiente' }).click();

async function configurar(page: Page) {
  // 3. Bienvenida sin escuelas
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Gestión escolar' })).toBeVisible();
  await expect(page.getByText('Sistema de administración y organización escolar')).toBeVisible();
  await expect(page.locator('.tarjeta-escuela')).toHaveCount(0); // no se muestran datos inventados
  await page.getByRole('link', { name: 'Configurar mi escuela' }).click();

  // PASO 1 — Datos del plantel (2. validación del CCT)
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Técnica Ficticia 160');
  await page.getByLabel('Nombre corto').fill('Técnica 160');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ016');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await sig(page);
  await expect(page.locator('#f-escuela-cct-error')).toContainText('10 caracteres');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32zzz0160t');
  await expect(page.getByLabel('Entidad federativa')).toHaveValue('32'); // sugerida desde la CCT
  await page.getByLabel('Entidad federativa').selectOption('09');
  await sig(page);
  await expect(page.locator('#f-escuela-cct-error')).toContainText('La CCT inicia con 32 (Zacatecas), pero la entidad elegida es Ciudad de México');
  await page.getByLabel('Entidad federativa').selectOption('32');
  await page.getByText('Datos adicionales (opcionales)').click();
  await page.getByLabel('Zona escolar').fill('15');
  await page.getByLabel('Teléfono').fill('492 12');
  await page.locator('#f-escuela-logotipo-archivo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByAltText('Vista previa del logotipo')).toBeVisible();
  await sig(page);
  await expect(page.locator('#f-escuela-telefono-error')).toContainText('10 dígitos');
  await page.getByLabel('Teléfono').fill('492 123 4567');
  await page.getByLabel('Correo institucional').fill('direccion@escuela-ficticia.edu.mx');
  await sig(page);

  // Ciclo y 3. turno
  await expect(page.getByRole('heading', { level: 1, name: 'Ciclo escolar' })).toBeVisible();
  await sig(page);
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await page.getByLabel('Hora de entrada').fill('07:00');
  await page.getByLabel('Hora de salida').fill('13:00');
  await sig(page);

  // PASO 2 — Jornada: generación automática y 4. periodos editados uno por uno
  await expect(page.locator('.asistente__vista')).toContainText('6 periodos y 1 receso(s)');
  await page.getByRole('button', { name: 'Editar periodos uno por uno' }).click();
  await expect(page.locator('.bloque-edicion')).toHaveCount(7);
  // 5. Superposición intencional
  await page.locator('[name="bloques.1.horaInicio"]').fill('07:30');
  await expect(page.locator('.asistente__vista')).toContainText('Se traslapa');
  await sig(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Periodos y recesos' })).toBeVisible(); // no avanza
  await page.locator('[name="bloques.1.horaInicio"]').fill('07:50');
  await expect(page.locator('.asistente__vista')).not.toContainText('Se traslapa');
  await page.getByRole('button', { name: 'Agregar receso' }).click();
  await expect(page.locator('.asistente__vista')).toContainText('6 periodos y 2 receso(s)');
  await sig(page);

  // PASO 3 — 6. grados y grupos personalizados, 7. duplicados
  await page.getByRole('button', { name: 'Personalizar grados y grupos' }).click();
  await page.getByRole('button', { name: 'Agregar varios grupos a Primer grado' }).click();
  await page.getByRole('dialog').getByLabel('Grupos').fill('c, a');
  await page.getByRole('dialog').getByRole('button', { name: 'Agregar' }).click();
  await expect(page.locator('.asistente__vista')).toContainText('«A» está repetido');
  await sig(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Grados y grupos' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitar grupo 1° A' }).last().click();
  await expect(page.locator('.asistente__vista')).toContainText('3 grado(s) y 7 grupo(s)');
  await sig(page);

  // PASO 4 — Revisión
  const rev = page.locator('#f-revisar');
  await expect(rev).toContainText('CCT 32ZZZ0160T');
  await expect(rev).toContainText('Municipio Ejemplo, Zacatecas');
  await expect(rev).toContainText('6 periodo(s)');
  await expect(rev).toContainText('2 receso(s)');
  await expect(rev).toContainText('Primer grado: A, B, C');
  await page.getByRole('button', { name: 'Cambiar turno y jornada' }).click();
  await expect(page.getByLabel('Nombre del turno')).toHaveValue('Matutino');
  for (let i = 0; i < 3; i++) await sig(page);
  await page.getByRole('button', { name: 'Guardar escuela' }).click();
}

test('Fase 1 completa: bienvenida → asistente → panel → edición → grupos → persistencia', async ({ page, browser }) => {
  await configurar(page);
  // 6. Panel principal
  const panel = page.locator('.panel-escuela');
  await expect(panel).toContainText('Técnica 160');
  await expect(panel).toContainText('32ZZZ0160T');
  await expect(panel).toContainText('2026-2027');
  await expect(panel).toContainText('Matutino');
  await expect(panel.locator('.panel-escuela__dato', { hasText: 'Grados' })).toContainText('3');
  await expect(panel.locator('.panel-escuela__dato', { hasText: 'Grupos' })).toContainText('7');
  await expect(panel).toContainText('Lunes a viernes, de 07:00 a 13:00; 6 periodo(s) y 2 receso(s)');
  await expect(panel.getByAltText(/Logotipo de/)).toBeVisible();
  // Lo «Próximamente» no son botones ni enlaces
  await expect(page.locator('.modulos__futuro a, .modulos__futuro button')).toHaveCount(0);

  // 8. Edición de datos
  await page.getByRole('link', { name: 'Editar datos escolares' }).click();
  await expect(page.getByLabel('Teléfono')).toHaveValue('4921234567');
  await page.getByLabel('Nombre corto').fill('Técnica 160 Matutina');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('09ZZZ0160T');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#f-escuela-cct-error')).toContainText('Revisa la CCT o la entidad');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0160T');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.panel-escuela')).toContainText('Técnica 160 Matutina');

  // Administrar grupos: varios a la vez, duplicados, desactivar
  await page.getByRole('link', { name: 'Administrar grupos' }).click();
  await page.locator('summary', { hasText: 'Agregar varios grupos' }).click();
  await page.locator('#f-grupos-varios-gradoId').selectOption({ label: 'Segundo grado' });
  await page.locator('#f-grupos-varios-nombres').fill('C, a');
  await page.getByRole('button', { name: 'Agregar grupos' }).click();
  await expect(page.locator('#f-grupos-varios .resumen-errores')).toContainText('Ya existe el grupo «A»');
  await page.locator('#f-grupos-varios-nombres').fill('C, D');
  await page.getByRole('button', { name: 'Agregar grupos' }).click();
  await expect(page.getByText('2° D')).toBeVisible();
  await page.getByRole('button', { name: 'Desactivar grupo 2° D' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.locator('.grupo', { hasText: '2° D' })).toContainText('Desactivado');

  // 9. Persistencia: recargar y abrir en un navegador nuevo con el almacenamiento guardado
  await page.reload();
  await expect(page.locator('.grupo', { hasText: '2° D' })).toContainText('Desactivado');
  const estado = await page.context().storageState({ indexedDB: true });
  const otro = await browser.newContext({ storageState: estado });
  const p2 = await otro.newPage();
  await p2.goto('/');
  await p2.getByRole('link', { name: /Técnica Ficticia 160/ }).click();
  await expect(p2.locator('.panel-escuela__dato', { hasText: 'Grupos' })).toContainText('8 activos (1 desactivados)');
  await otro.close();
});

test('10. funciona en pantalla de teléfono (320 px): bienvenida, asistente y panel', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const revisar = async () => {
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `desborde en ${page.url()}`).toBeLessThanOrEqual(0);
    const pequenos = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a.boton, main input:not([type=hidden]):not([type=checkbox]), main select, main summary')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim() || el.getAttribute('name') || el.id));
    expect(pequenos, `controles < 44 px en ${page.url()}`).toEqual([]);
  };
  await page.goto('/');
  await revisar();
  await configurar(page);
  await revisar();
});

test('el periodo que se traslapa se marca en su lugar', async ({ page }) => {
  await page.goto('/#/asistente');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Ficticia 170');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0170A');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await sig(page); await sig(page);
  await page.getByLabel('Nombre del turno').fill('Matutino');
  await sig(page);
  await page.getByRole('button', { name: 'Editar periodos uno por uno' }).click();
  await page.locator('[name="bloques.0.horaFin"]').fill('08:00');
  const fila = page.locator('.bloque-edicion').nth(0);
  await expect(fila).toHaveClass(/bloque-edicion--error/);
  await expect(fila).toContainText('Se traslapa con el periodo «Módulo 2»');
  await page.locator('[name="bloques.0.horaFin"]').fill('07:50');
  await expect(page.locator('.bloque-edicion--error')).toHaveCount(0);
});
