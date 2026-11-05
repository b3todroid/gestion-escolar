import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { a, alumno, cargarDemo, HOY, piloto, radio } from '../piloto/comun';

// CAPTURAS para el MANUAL DE USO (docs/manual). Sólo datos FICTICIOS (DEMO-001 y una escuela ficticia).
// No es una prueba: cada paso se intenta y, si falla, se anota y se sigue (registro.json).
const DIR = 'manual-capturas/img';
mkdirSync(DIR, { recursive: true });
const registro: { nombre: string; ok: boolean; error?: string }[] = [];
const fx = (n: string) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));

async function foto(page: Page, nombre: string, opciones: { completa?: boolean; elemento?: string; conAviso?: boolean } = {}) {
  await page.waitForTimeout(350);
  // Los avisos de acciones anteriores tapan la pantalla: se quitan salvo cuando son el resultado que se muestra.
  if (!opciones.conAviso) await page.evaluate(() => document.querySelectorAll('#avisos > *').forEach((e) => e.remove()));
  const ruta = `${DIR}/${nombre}.jpg`;
  if (opciones.elemento) {
    await page.evaluate(() => { const st = document.createElement('style'); st.id = 'manual-estatico'; st.textContent = '.barra{position:static !important}'; document.head.append(st); });
    await page.locator(opciones.elemento).first().screenshot({ path: ruta, type: 'jpeg', quality: 82 });
    await page.evaluate(() => document.getElementById('manual-estatico')?.remove());
    return;
  }
  const vp = page.viewportSize()!;
  const completa = opciones.completa !== false;
  // En la foto de página completa, las barras fijas se repetirían a media imagen: se vuelven estáticas sólo para la foto.
  if (completa) await page.evaluate(() => { const st = document.createElement('style'); st.id = 'manual-estatico'; st.textContent = '.barra,.asistente__nav,.lista__barra,.rejilla thead th{position:static !important}'; document.head.append(st); });
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: ruta, type: 'jpeg', quality: 82, fullPage: completa, clip: completa ? { x: 0, y: 0, width: vp.width, height: Math.min(alto, 2400) } : undefined });
  await page.evaluate(() => document.getElementById('manual-estatico')?.remove());
}
async function paso(nombre: string, fn: () => Promise<void>) {
  try { await fn(); registro.push({ nombre, ok: true }); }
  catch (e) { registro.push({ nombre, ok: false, error: String((e as Error).message).split('\n')[0]!.slice(0, 300) }); }
}
const telefono = (page: Page) => page.setViewportSize({ width: 412, height: 860 });
const escritorio = (page: Page) => page.setViewportSize({ width: 1280, height: 860 });

test.describe.configure({ mode: 'serial' });
test.afterAll(() => writeFileSync('manual-capturas/registro.json', JSON.stringify(registro, null, 2)));

test('A · escuela nueva desde cero: bienvenida, asistente, catálogos e importaciones', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await escritorio(page);
  let panelA = '';
  await page.clock.install({ time: a('07:15') });
  await paso('A01 bienvenida', async () => { await page.goto('/#/'); await expect(page.locator('main h1')).toBeVisible(); await foto(page, 'a01-bienvenida'); });
  await paso('A02 asistente', async () => {
    await page.goto('/#/asistente');
    await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia Manual');
    await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0777A');
    await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
    await foto(page, 'a02-asistente-1-escuela');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await foto(page, 'a03-asistente-2-ciclo');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Nombre del turno').fill('Matutino');
    await foto(page, 'a04-asistente-3-turno');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await foto(page, 'a05-asistente-4-periodos');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByLabel('Al grado').fill('1');
    await page.getByLabel('Grupos por grado').fill('2');
    await foto(page, 'a06-asistente-5-grupos');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await foto(page, 'a07-asistente-6-revisar');
    await page.getByRole('button', { name: 'Guardar escuela' }).click();
    await expect(page.getByRole('heading', { name: 'Catálogos escolares' })).toBeVisible();
    await foto(page, 'a08-panel-escuela-nueva', { conAviso: true });
    panelA = page.url();
  });
  const nav = () => page.getByRole('navigation', { name: 'Catálogos escolares' });
  await paso('A09 materias', async () => {
    await nav().getByRole('link', { name: 'Materias' }).click();
    await page.locator('#f-lote-lote').fill('Matemáticas\nEspañol');
    await page.getByRole('button', { name: 'Agregar materias' }).click();
    await expect(page.locator('.renglon', { hasText: 'Español' })).toBeVisible();
    await foto(page, 'a09-materias');
  });
  await paso('A10 personal', async () => {
    await nav().getByRole('link', { name: 'Personal' }).click();
    for (const [ap, seg] of [['Ficticio', 'Uno'], ['Ficticia', 'Dos']] as const) {
      await page.locator('#f-persona-nombre').fill('Docente');
      await page.locator('#f-persona-primerApellido').fill(ap);
      await page.locator('#f-persona-segundoApellido').fill(seg);
      await page.getByRole('button', { name: 'Agregar persona' }).click();
      await expect(page.getByRole('link', { name: `Docente ${ap} ${seg}` })).toBeVisible();
    }
    await foto(page, 'a10-personal');
  });
  await paso('A11 importar alumnos xlsx', async () => {
    await nav().getByRole('link', { name: 'Importar información' }).click();
    await foto(page, 'a11-importar-inicio');
    await page.getByRole('radio', { name: /^Alumnos/ }).check();
    await page.locator('#archivo-datos').setInputFiles(fx('alumnos-sinonimos.xlsx'));
    await page.waitForTimeout(800);
    await foto(page, 'a12-importar-columnas');
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await page.waitForTimeout(800);
    await foto(page, 'a13-importar-revision');
    await page.getByRole('button', { name: /Confirmar e importar/ }).click();
    await expect(page.locator('#resultado-importacion')).toBeVisible();
    await foto(page, 'a14-importar-resultado', { conAviso: true });
  });
  await paso('A15 importar horario PDF', async () => {
    await page.goto(page.url());
    await page.getByRole('radio', { name: /^Horarios/ }).check();
    await page.locator('#archivo-datos').setInputFiles(fx('pdf/horario-grupo-1A.pdf'));
    await expect(page.locator('#continuar-documento')).toBeVisible({ timeout: 60_000 });
    await foto(page, 'a15-pdf-estructura');
    await page.locator('#continuar-documento').click();
    await page.waitForTimeout(800);
    await foto(page, 'a16-pdf-tabla');
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await page.waitForTimeout(800);
    await foto(page, 'a17-pdf-revision');
    await page.getByRole('button', { name: /Confirmar e importar/ }).click();
    await expect(page.locator('#resultado-importacion')).toBeVisible();
    await foto(page, 'a18-pdf-resultado', { conAviso: true });
  });
  await paso('A20 grupo con horario editable', async () => {
    await page.goto(panelA);
    await page.getByRole('link', { name: 'Administrar grupos' }).click();
    await foto(page, 'a20-administrar-grupos');
    await page.getByRole('link', { name: 'Materias y horario de 1° A' }).click();
    await expect(page.locator('main h1')).toBeVisible();
    await foto(page, 'a21-grupo-editable');
    await foto(page, 'b23-grupo-editar-dia', { elemento: '#editar-horario-titulo >> xpath=..' });
  });
  await paso('A19 escuela nueva (formulario)', async () => { await page.goto('/#/escuela/nueva'); await foto(page, 'a19-escuela-nueva'); });
});

test('B · escuela de DEMOSTRACIÓN DEMO-001: todos los módulos', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await escritorio(page);
  const { p } = piloto();
  const datos = JSON.parse(p.contenido).datos as Record<string, { id: string; [k: string]: unknown }[]>;
  const alumnoDemo = datos['inscripciones']!.find((x) => x['grupoId'] === p.docente.grupoId)!['alumnoId'] as string;

  await paso('B01 respaldos: restaurar DEMO', async () => {
    await page.clock.install({ time: a('07:15') });
    await page.goto('/#/respaldos');
    await foto(page, 'b01-respaldos-vacio');
    await page.locator('#archivo-respaldo').setInputFiles(piloto().archivo);
    await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 120_000 });
    await foto(page, 'b02-respaldos-revision');
    await page.getByRole('button', { name: 'Restaurar' }).click();
    await foto(page, 'b03-respaldos-confirmar', { completa: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 300_000 });
    await foto(page, 'b04-respaldos-informe', { conAviso: true });
  }).catch(() => undefined);
  // Si la restauración por la interfaz falló, se carga igual para poder seguir.
  if (!registro.find((r) => r.nombre.startsWith('B01'))?.ok) await cargarDemo(page);

  await paso('B05 inicio con escuela', async () => { await page.goto('/#/'); await foto(page, 'b05-inicio'); });
  await paso('B06 escuelas', async () => { await page.goto('/#/escuelas'); await foto(page, 'b06-escuelas'); });
  await paso('B07 panel escuela', async () => { await page.goto(`/#/escuela/${p.escuelaId}`); await expect(page.locator('main h1')).toBeVisible(); await foto(page, 'b07-panel-escuela'); });
  await paso('B08 editar escuela', async () => { await page.goto(`/#/escuela/${p.escuelaId}/editar`); await foto(page, 'b08-editar-escuela'); });
  await paso('B09 personal escuela', async () => { await page.goto(`/#/escuela/${p.escuelaId}/personal`); await foto(page, 'b09-personal'); });
  await paso('B10 ciclo', async () => { await page.goto(`/#/ciclo/${p.cicloId}`); await foto(page, 'b10-ciclo'); });
  await paso('B11 turno', async () => { await page.goto(`/#/turno/${p.turnos[0]!.id}`); await foto(page, 'b11-turno-matutino'); });
  await paso('B12 turno 2', async () => { await page.goto(`/#/turno/${p.turnos[1]!.id}`); await foto(page, 'b12-turno-vespertino'); });
  await paso('B13 materias', async () => { await page.goto(`/#/ciclo/${p.cicloId}/materias`); await foto(page, 'b13-materias'); });
  await paso('B14 docentes', async () => { await page.goto(`/#/ciclo/${p.cicloId}/docentes`); await foto(page, 'b14-docentes'); });
  await paso('B15 alumnos ciclo', async () => {
    await page.goto(`/#/ciclo/${p.cicloId}/alumnos`); await foto(page, 'b15-alumnos-ciclo');
    await page.locator('#buscar-alumno').fill('DEMO-A-00007'); await page.waitForTimeout(500); await foto(page, 'b16-alumnos-buscar');
    await page.locator('summary', { hasText: 'Inscribir un alumno nuevo' }).click(); await foto(page, 'b17-alumnos-inscribir');
  });
  await paso('B18 importar datos', async () => { await page.goto(`/#/ciclo/${p.cicloId}/importar-datos`); await foto(page, 'b18-importar-datos'); });
  await paso('B19 importar horarios', async () => { await page.goto(`/#/ciclo/${p.cicloId}/importar`); await foto(page, 'b19-importar-horarios'); });
  await paso('B20 horarios', async () => { await page.goto('/#/horarios'); await foto(page, 'b20-horarios'); });
  await paso('B21 horarios ciclo', async () => { await page.goto(`/#/ciclo/${p.cicloId}/horarios`); await foto(page, 'b21-horarios-ciclo'); });
  await paso('B22 grupo', async () => { await page.goto(`/#/grupo/${p.docente.grupoId}`); await expect(page.locator('main h1')).toBeVisible(); await foto(page, 'b22-grupo'); });
  await paso('B24 personal (semana)', async () => { await page.goto(`/#/personal/${p.docente.id}`); await foto(page, 'b24-personal-semana'); });
  await paso('B25 horario docente ciclo', async () => { await page.goto(`/#/personal/${p.docente.id}/ciclo/${p.cicloId}`); await foto(page, 'b25-horario-docente'); });
  await paso('B26 alumnos del grupo', async () => { await page.goto(`/#/alumnos/${p.docente.grupoId}`); await foto(page, 'b26-alumnos-grupo'); });
  await paso('B27 ficha alumno', async () => { await page.goto(`/#/alumno/${alumnoDemo}`); await foto(page, 'b27-ficha-alumno'); });
  await paso('B28 editar alumno', async () => { await page.goto(`/#/alumno/${alumnoDemo}/editar`); await foto(page, 'b28-editar-alumno'); });
  await paso('B29 aplicacion', async () => { await page.goto('/#/aplicacion'); await foto(page, 'b29-aplicacion'); });

  // ---- Jornada del docente (vista de teléfono) ----
  await paso('C01 perfil', async () => {
    await page.goto('/#/perfil'); await foto(page, 'c01-perfil');
    await page.getByRole('button', { name: 'Soy yo' }).nth(await page.locator('.renglon').filter({ hasText: p.docente.nombre }).evaluate((li) => [...li.parentElement!.children].indexOf(li))).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Hola,/ })).toBeVisible();
  });
  await paso('C02 mi dia', async () => {
    await telefono(page); await page.goto('/#/'); await expect(page.locator('.ahora')).toBeVisible(); await foto(page, 'c02-mi-dia-telefono');
    await escritorio(page); await foto(page, 'c03-mi-dia-escritorio'); await telefono(page);
  });
  await paso('C04 lista', async () => {
    await page.goto(`/#/lista/${p.docente.sesionHoyId}/${HOY}`);
    await expect(page.locator('#estado-lista')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await foto(page, 'c04-lista-nueva', { completa: false });
    await radio(page, alumno(1), 'Falta').check();
    await radio(page, alumno(2), 'Retardo').check();
    await foto(page, 'c05-lista-marcas', { completa: false });
    await page.getByRole('button', { name: 'Guardar lista' }).click();
    await expect(page.locator('.aviso')).toContainText('faltas');
    await foto(page, 'c06-lista-guardada', { completa: false, conAviso: true });
    await radio(page, alumno(1), 'Retardo').check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await foto(page, 'c07-lista-confirmar-correccion', { completa: false });
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
    await page.clock.setFixedTime(a('07:20'));
    await page.getByRole('button', { name: `Salida al baño de ${alumno(3)}` }).click();
    await expect(page.locator('#fuera-lista')).toContainText(alumno(3));
    await foto(page, 'c08-lista-salida', { completa: false });
    await page.clock.setFixedTime(a('07:26'));
    await page.getByRole('button', { name: `Reincorporar a ${alumno(3)}` }).click();
    await page.getByRole('button', { name: `Reporte breve de ${alumno(4)}` }).click();
    await page.getByRole('dialog').getByLabel('Tipo').selectOption('conducta');
    await page.getByRole('dialog').getByLabel('Reporte').fill('Reporte ficticio para el manual.');
    await foto(page, 'c09-lista-reporte', { completa: false });
    await page.getByRole('button', { name: 'Guardar reporte' }).click();
    await page.reload();
    await page.locator('#historial-lista summary').click();
    await page.locator('#historial-lista').scrollIntoViewIfNeeded();
    await foto(page, 'c10-lista-historial', { completa: false });
    await escritorio(page); await foto(page, 'c11-lista-escritorio');
  });
  await paso('C12 alumnos del grupo tras la lista', async () => {
    await page.goto(`/#/alumnos/${p.docente.grupoId}`); await foto(page, 'c12-alumnos-grupo-faltas');
    await page.getByRole('link', { name: alumno(4) }).click(); await foto(page, 'c13-alumno-reportes');
  });

  // ---- Prefectura ----
  await escritorio(page);
  await paso('D01 prefectura inicio', async () => { await page.goto('/#/prefectura'); await foto(page, 'd01-prefectura-inicio'); });
  await paso('D02 prefectura dia', async () => {
    await page.goto(`/#/ciclo/${p.cicloId}/prefectura/${HOY}`); await expect(page.getByRole('heading', { level: 1, name: 'Prefectura' })).toBeVisible();
    await foto(page, 'd02-prefectura-dia');
    await page.locator('summary', { hasText: 'Registrar incidencia' }).click();
    await page.locator('#f-incidencia-personalId').selectOption({ label: p.docenteAusente.nombre });
    await page.locator('#f-incidencia-tipo').selectOption('falta');
    await foto(page, 'd03-prefectura-registrar-incidencia', { elemento: '#f-incidencia' });
    await page.getByRole('button', { name: 'Registrar incidencia' }).click();
    await expect(page.locator('#incidencias-dia')).toContainText('REPORTADA');
    await foto(page, 'd04-prefectura-incidencia-reportada', { conAviso: true });
    await page.getByRole('button', { name: `Confirmar incidencia de ${p.docenteAusente.nombre}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
    await foto(page, 'd05-prefectura-incidencia-confirmada');
  });
  await paso('D06 cobertura', async () => {
    const tarjeta = page.locator('#lista-atencion li', { hasText: '2° A' });
    await tarjeta.getByRole('link', { name: /Atender 2° A/ }).first().click();
    await expect(page.locator('#lista-candidatos')).toBeVisible();
    await foto(page, 'd06-cobertura-candidatos');
    await page.locator('summary', { hasText: 'Proponer personal' }).click();
    await page.locator('#lista-candidatos').locator('..').getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Registrar propuesta' }).click();
    await expect(page.locator('#estado-cobertura')).toHaveText('Propuesta');
    const opcionSE = page.locator('#f-asignar-cobertura-personalId option', { hasText: 'SE confirmada' }).first();
    await page.locator('#f-asignar-cobertura-personalId').selectOption({ value: await opcionSE.getAttribute('value') ?? '' });
    await page.locator('#f-asignar-cobertura-autorizadoPor').fill('Dirección (DEMOSTRACIÓN)');
    await page.getByLabel(/Actividad \(descripción breve\)/).fill('Lectura dirigida (demostración)');
    await foto(page, 'd07-cobertura-asignar', { elemento: '#f-asignar-cobertura' });
    await page.getByRole('button', { name: 'Asignar cobertura' }).click();
    await expect(page.locator('#estado-clase')).toContainText('COBERTURA ASIGNADA');
    await page.getByRole('button', { name: 'Registrar como realizada' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sí, se realizó' }).click();
    await expect(page.locator('#estado-clase')).toContainText('REALIZADA');
    await foto(page, 'd08-cobertura-realizada');
  });
  await paso('D09 prefectura dia despues', async () => { await page.goto(`/#/ciclo/${p.cicloId}/prefectura/${HOY}`); await foto(page, 'd09-prefectura-dia-final'); });
  await paso('D10 actividades', async () => { await page.goto(`/#/ciclo/${p.cicloId}/prefectura-actividades`); await foto(page, 'd10-banco-actividades'); });
  await paso('D11 reportes', async () => {
    await page.goto(`/#/ciclo/${p.cicloId}/prefectura-reportes`); await foto(page, 'd11-reportes-inicio');
    await page.locator('#f-reporte-periodo').selectOption('dia');
    await page.locator('#f-reporte-desde').fill(HOY); await page.locator('#f-reporte-hasta').fill(HOY);
    await page.getByRole('button', { name: 'Generar reporte' }).click();
    await expect(page.locator('#indicadores-reporte')).toBeVisible();
    await foto(page, 'd12-reportes-dia');
  });

  // ---- Respaldo cifrado, cuenta/sincronización sin servidor ----
  await paso('E01 respaldos con datos', async () => {
    await page.goto('/#/respaldos'); await foto(page, 'e01-respaldos-con-datos');
  });
  await paso('E02 cuenta sin servidor', async () => { await page.goto('/#/cuenta'); await foto(page, 'e02-cuenta-sin-servidor'); });
  await paso('E03 sincronizacion local', async () => { await page.goto('/#/sincronizacion'); await foto(page, 'e03-sincronizacion-local'); });
  await paso('E04 migracion local', async () => { await page.goto('/#/migracion'); await foto(page, 'e04-migracion-local'); });
  await paso('E05 lista telefono pantalla 320', async () => {
    await page.setViewportSize({ width: 320, height: 640 }); await page.goto('/#/'); await foto(page, 'e05-telefono-chico', { completa: false });
  });
});
