import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { a, alumno, cargarDemo, contar, HOY, piloto, radio } from './comun';
import { cifrar } from '../../src/utils/cifrado';

// Fase 10 — PILOTO en el dispositivo con ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001). Datos FICTICIOS.
// Los perfiles (Administración, Docente, Prefectura, Dirección) son PERFILES DE DEMOSTRACIÓN en este
// modo: la app sin servidor no tiene cuentas ni permisos, y así lo dice. Las cuentas y permisos
// REALES se prueban en multiusuario.spec.ts (con servidor).

test.describe.configure({ mode: 'serial' });

test('PIL-ENT-01 · entorno aislado: DEMO-001 se carga en un navegador vacío, sin CCT y marcada como DEMOSTRACIÓN en toda la app', async ({ page }) => {
  expect(await page.goto('/').then(() => contar(page, 'escuelas'))).toBe(0); // navegador vacío: nada previo
  const p = await cargarDemo(page);
  await expect(page.locator('#demostracion')).toContainText('DEMOSTRACIÓN');
  await expect(page.locator('#demostracion')).toContainText('«ESCUELA DEMO GESTIÓN ESCOLAR» (DEMO-001)');
  await page.goto('/#/escuelas');
  await expect(page.locator('.tarjeta-escuela')).toContainText('◆ DEMOSTRACIÓN');
  await expect(page.locator('.tarjeta-escuela')).toContainText('DEMO-001 · datos ficticios');
  await page.goto(`/#/escuela/${p.escuelaId}`);
  await expect(page.locator('#escuela-demostracion')).toContainText('todos sus datos son ficticios');
  await expect(page.locator('.datos')).toContainText('No aplica (escuela de demostración)');
  expect(await contar(page, 'alumnos')).toBe(p.conteos.alumnos);
  expect(await contar(page, 'asistencias')).toBe(p.conteos.asistencias);
});

test('PIL-CFG-01 · editar la escuela de demostración (sin CCT) y conservar los cambios al recargar; turnos con periodos distintos', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto(`/#/escuela/${p.escuelaId}/editar`);
  await expect(page.getByLabel(/Clave de centro de trabajo/)).toBeDisabled();
  await page.getByLabel(/Municipio o alcaldía/).fill('Localidad ficticia editada');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.aviso')).toContainText('Datos escolares actualizados');
  await page.reload();
  await expect(page.locator('.datos')).toContainText('Localidad ficticia editada');
  // Turno vespertino: periodos de 45 min y uno de 60 min; receso propio.
  await page.goto(`/#/turno/${p.turnos[1]!.id}`);
  await expect(page.locator('main')).toContainText('18:05');
  await expect(page.locator('main')).toContainText('19:05');
  await expect(page.locator('main')).toContainText('Receso');
  await page.goto(`/#/turno/${p.turnos[0]!.id}`);
  await expect(page.locator('main')).toContainText('09:30');
});

test('PIL-CAT-01 · catálogos con volumen: buscar por matrícula, evitar duplicados, cambiar de grupo (misma persona) y conservarlo', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto(`/#/ciclo/${p.cicloId}/alumnos`);
  await expect(page.locator('#resumen-alumnos')).toContainText(String(p.conteos.alumnos));
  await page.locator('#buscar-alumno').fill('DEMO-A-00007');
  await expect(page.locator('#lista-alumnos-titulo ~ div .renglon:visible')).toHaveCount(1);
  // Duplicado por matrícula: rechazado
  await page.locator('summary', { hasText: 'Inscribir un alumno nuevo' }).click();
  await page.locator('#f-alumno-alta-nombre').fill('Otra');
  await page.locator('#f-alumno-alta-primerApellido').fill('Persona Demo');
  await page.locator('#f-alumno-alta summary', { hasText: 'Datos opcionales' }).click();
  await page.locator('#f-alumno-alta-matricula').fill('DEMO-A-00007');
  await page.locator('#f-alumno-alta-grupoId').selectOption({ label: '1° A (Matutino)' });
  await page.getByRole('button', { name: 'Inscribir alumno' }).click();
  await expect(page.locator('main')).toContainText('Otra persona ya tiene esa matrícula en la escuela.');
  const antes = await contar(page, 'alumnos');
  // Cambio de grupo
  await page.locator('#buscar-alumno').fill('DEMO-A-00007');
  await page.getByRole('link', { name: alumno(6) }).click();
  // El formulario rechazado conserva lo capturado: salir exige decidir (no se pierde en silencio).
  await page.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click();
  await page.locator('summary', { hasText: 'Cambiar de grupo' }).click();
  const destino = `${p.grupos[3]!.grado}° ${p.grupos[3]!.nombre}`;
  await page.locator('#f-cambio-grupo-grupoId').selectOption({ label: destino });
  await page.locator('#f-cambio-grupo-motivo').fill('Ajuste ficticio del piloto');
  await page.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await expect(page.locator('#historial-ins-titulo ~ ul')).toContainText(`→ ${destino}`);
  expect(await contar(page, 'alumnos')).toBe(antes); // misma persona, no otra
  await page.reload();
  await expect(page.locator('#historial-ins-titulo ~ ul')).toContainText(`→ ${destino}`);
});

test('PIL-HOR-01 · horario de grupo y de docente coinciden (30 clases, receso, SE confirmada) y el grupo está confirmado', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto(`/#/grupo/${p.docente.grupoId}`);
  // Teléfono: lista por día; tableta y escritorio: tabla semanal. Mismo contenido.
  const horario = page.getByRole('table', { name: /Horario semanal de/ }).or(page.getByRole('list', { name: 'Horario de 1° A, Lunes' }));
  await expect(horario).toBeVisible();
  await expect(horario).toContainText('Matemáticas');
  await expect(horario).toContainText('RECESO');
  await expect(horario).toContainText('09:30');
  await expect(page.locator('main')).toContainText('Horario confirmado');
  await expect(page.locator('main')).toContainText('Materias (30 horas por semana)');
  await page.goto(`/#/personal/${p.docente.id}/ciclo/${p.cicloId}`);
  await expect(page.locator('main')).toContainText('1° A');
  await page.goto(`/#/ciclo/${p.cicloId}/horarios`);
  await expect(page.locator('main')).toContainText(/Sin conflictos|0 conflicto|no hay conflictos/i);
});

test('PIL-DOC-01 · jornada del docente: actividad actual → lista → F/R → guardar → corregir → salida → regreso → reporte → historial', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto('/#/perfil');
  await page.getByRole('button', { name: 'Soy yo' }).nth(await page.locator('.renglon').filter({ hasText: p.docente.nombre }).evaluate((li) => [...li.parentElement!.children].indexOf(li))).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Hola,/ })).toBeVisible();
  const ahora = page.locator('.ahora');
  await expect(ahora).toHaveAttribute('data-estado', 'clase');
  await expect(ahora).toContainText('1° A');
  await expect(ahora).toContainText('Matemáticas');
  await ahora.getByRole('link', { name: 'Entrar al grupo 1° A' }).click();
  await page.getByRole('link', { name: 'Pasar lista: 07:00 Matemáticas' }).click();
  await expect(page.locator('#estado-lista')).toHaveText(/NO INICIADA/);
  const pases = await contar(page, 'pases');
  await radio(page, alumno(1), 'Falta').check();
  await radio(page, alumno(2), 'Retardo').check();
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('1 faltas, 1 retardos');
  expect(await contar(page, 'pases')).toBe(pases + 1);
  // Estado contradictorio imposible: quien tiene falta no puede salir al baño
  await expect(page.getByRole('button', { name: `Salida al baño de ${alumno(1)}` })).toBeDisabled();
  // Corrección (F → R) con historial
  await radio(page, alumno(1), 'Retardo').check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#estado-lista')).toHaveText(/MODIFICADA/);
  // Salida y regreso
  await page.clock.setFixedTime(a('07:20'));
  await page.getByRole('button', { name: `Salida al baño de ${alumno(3)}` }).click();
  await expect(page.locator('#fuera-lista')).toContainText(`${alumno(3)} desde las 07:20`);
  await page.clock.setFixedTime(a('07:26'));
  await page.getByRole('button', { name: `Reincorporar a ${alumno(3)}` }).click();
  await expect(page.locator('.aviso')).toContainText('se reincorporó');
  // Reporte breve (incidencia del alumno)
  await page.getByRole('button', { name: `Reporte breve de ${alumno(4)}` }).click();
  await page.getByRole('dialog').getByLabel('Tipo').selectOption('conducta');
  await page.getByRole('dialog').getByLabel('Reporte').fill('Reporte ficticio del piloto.');
  await page.getByRole('button', { name: 'Guardar reporte' }).click();
  // Historial y persistencia
  await page.reload();
  await expect(page.locator('#estado-lista')).toHaveText(/MODIFICADA/);
  await expect(radio(page, alumno(1), 'Retardo')).toBeChecked();
  await page.locator('#historial-lista summary').click();
  await expect(page.locator('#historial-lista')).toContainText(`${alumno(1)}: Falta → Retardo`);
  await page.getByRole('link', { name: 'Ver alumnos y faltas de 1° A' }).click();
  await page.getByRole('link', { name: alumno(4) }).click();
  await expect(page.locator('#reportes-titulo').locator('..')).toContainText('Reporte ficticio del piloto.');
});

test('PIL-PRE-01 · Prefectura: ausencia → grupo afectado → SE → propuesta → autorización → asignación → actividad → realizada → reporte', async ({ page }) => {
  const p = await cargarDemo(page);
  const ausente = p.docenteAusente.nombre;
  await page.goto(`/#/ciclo/${p.cicloId}/prefectura/${HOY}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Prefectura' })).toBeVisible();
  await page.locator('summary', { hasText: 'Registrar incidencia' }).click();
  await page.locator('#f-incidencia-personalId').selectOption({ label: ausente });
  await page.locator('#f-incidencia-tipo').selectOption('falta');
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await expect(page.locator('#incidencias-dia')).toContainText('REPORTADA (sin confirmar)');
  const tarjeta = page.locator('#lista-atencion li', { hasText: '2° A' });
  await expect(tarjeta).toContainText('POSIBLE GRUPO SIN DOCENTE'); // posible ≠ confirmado
  expect(await contar(page, 'coberturas')).toBe(p.conteos.coberturas); // nada automático
  await page.getByRole('button', { name: `Confirmar incidencia de ${ausente}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(tarjeta).toContainText('GRUPO SIN DOCENTE CONFIRMADO');
  await expect(page.locator('#lista-se')).toContainText('Disponible según registro');
  await tarjeta.getByRole('link', { name: /Atender 2° A 07:00/ }).click();
  await expect(page.locator('#lista-candidatos')).toContainText('Compatible · SE');
  expect(await contar(page, 'coberturas')).toBe(p.conteos.coberturas); // sugerir no asigna
  await page.locator('summary', { hasText: 'Proponer personal' }).click();
  await page.locator('#lista-candidatos').locator('..').getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Registrar propuesta' }).click();
  await expect(page.locator('#estado-cobertura')).toHaveText('Propuesta');
  // Autorización obligatoria: sin «autorizado por» no se asigna
  const opcionSE = page.locator('#f-asignar-cobertura-personalId option', { hasText: 'SE confirmada' }).first();
  await page.locator('#f-asignar-cobertura-personalId').selectOption({ value: await opcionSE.getAttribute('value') ?? '' });
  await page.getByRole('button', { name: 'Asignar cobertura' }).click();
  await expect(page.locator('#f-asignar-cobertura')).toContainText(/autoriz/i);
  await page.locator('#f-asignar-cobertura-autorizadoPor').fill('Dirección (DEMOSTRACIÓN)');
  await page.getByLabel(/Actividad \(descripción breve\)/).fill('Lectura dirigida y ejercicios (demostración)');
  await page.getByRole('button', { name: 'Asignar cobertura' }).click();
  await expect(page.locator('#estado-clase')).toContainText('COBERTURA ASIGNADA');
  await page.getByRole('button', { name: 'Registrar como realizada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, se realizó' }).click();
  await expect(page.locator('#estado-clase')).toContainText('COBERTURA REALIZADA');
  await expect(page.locator('#historial-cobertura-titulo').locator('..')).toContainText('asignar');
  // Reporte del día
  await page.goto(`/#/ciclo/${p.cicloId}/prefectura-reportes`);
  await page.locator('#f-reporte-periodo').selectOption('dia');
  await page.locator('#f-reporte-desde').fill(HOY);
  await page.locator('#f-reporte-hasta').fill(HOY);
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  const ind = page.locator('#indicadores-reporte');
  await expect(ind.locator('div', { hasText: 'Incidencias confirmadas' }).locator('dd')).toHaveText('1');
  await expect(ind.locator('div', { hasText: 'Coberturas realizadas' }).locator('dd')).toHaveText('1');
});

test('PIL-DIR-01 · Dirección: consulta de asistencia, reportes de Prefectura con los datos históricos y seguimiento de coberturas', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto(`/#/alumnos/${p.docente.grupoId}`);
  await expect(page.locator('.lista-resumen li')).toHaveCount(Math.min(50, p.conteos.alumnos! / p.grupos.length));
  await page.goto(`/#/ciclo/${p.cicloId}/prefectura-reportes`);
  await page.locator('#f-reporte-periodo').selectOption('intervalo').catch(() => undefined);
  await page.locator('#f-reporte-desde').fill(new Date(Date.parse(`${HOY}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
  await page.locator('#f-reporte-hasta').fill(HOY);
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  const ind = page.locator('#indicadores-reporte');
  await expect(ind).toBeVisible();
  const confirmadas = await ind.locator('div', { hasText: 'Incidencias confirmadas' }).locator('dd').innerText();
  expect(Number(confirmadas)).toBeGreaterThan(0);
  await expect(page.locator('#historial-general')).toContainText('cobertura');
});

test('PIL-RES-01 · respaldo cifrado de DEMO-001 → restaurar en otro dispositivo; archivo alterado, versión incompatible y archivo corrupto se rechazan sin tocar nada', async ({ page, browser }) => {
  const p = await cargarDemo(page);
  // INC-03 (BAJO): justo después de restaurar, la sección «Descargar» de la misma pantalla no se actualiza.
  await page.goto('/#/escuelas');
  await page.goto('/#/respaldos');
  const clave = 'clave-ficticia-piloto-10';
  await page.getByLabel('Contraseña del respaldo').fill(clave);
  await page.getByLabel('Repite la contraseña').fill(clave);
  const espera = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: /Descargar respaldo de ESCUELA DEMO/ }).click();
  const cifrado = readFileSync((await (await espera).path())!, 'utf8');
  expect(cifrado).toContain('gestion-escolar-respaldo-cifrado');
  expect(cifrado).not.toContain('DEMO GESTIÓN');

  const otro = await browser.newContext();
  const p2 = await otro.newPage();
  await p2.goto('/#/respaldos');
  // Versión incompatible
  const sobre = JSON.parse(piloto().p.contenido); sobre.esquema = 99;
  await p2.locator('#archivo-respaldo').setInputFiles({ name: 'nuevo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sobre)) });
  await expect(p2.locator('main')).toContainText('versión más nueva');
  // Corrupto (truncado)
  await p2.locator('#archivo-respaldo').setInputFiles({ name: 'corrupto.json', mimeType: 'application/json', buffer: Buffer.from(piloto().p.contenido.slice(0, 5000)) });
  await expect(p2.locator('main')).toContainText('no es un respaldo válido');
  // Alterado (huella)
  const alterado = JSON.parse(piloto().p.contenido); alterado.datos.alumnos[0].nombre = 'Alterada';
  await p2.locator('#archivo-respaldo').setInputFiles({ name: 'alterado.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(alterado)) });
  await expect(p2.locator('main')).toContainText('El archivo fue modificado o está dañado');
  expect(await contar(p2, 'escuelas')).toBe(0); // nada se escribió
  // El cifrado correcto se restaura completo
  await p2.locator('#archivo-respaldo').setInputFiles({ name: 'cifrado.json', mimeType: 'application/json', buffer: Buffer.from(cifrado) });
  await p2.getByLabel('Contraseña del respaldo').fill(clave);
  await p2.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(p2.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 120_000 });
  await p2.getByRole('button', { name: 'Restaurar' }).click();
  await p2.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(p2.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 300_000 });
  expect(await contar(p2, 'asistencias')).toBe(p.conteos.asistencias);
  await otro.close();
});

test('PIL-RES-03 · elegir otro archivo mientras se revisa el anterior: la revisión vieja no reemplaza a la vigente (INC-F11-01)', async ({ page }) => {
  await page.goto('/#/respaldos');
  const { p } = piloto();
  const alterado = JSON.parse(p.contenido); alterado.datos.alumnos[0].nombre = 'Alterada';
  const cifrado = await cifrar(p.contenido, 'clave-ficticia-piloto-10', new Date().toISOString());
  // 1.º un archivo alterado (su revisión tarda) y, sin esperar, 2.º uno cifrado (pide contraseña al instante).
  await page.locator('#archivo-respaldo').setInputFiles({ name: 'alterado.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(alterado)) });
  await page.locator('#archivo-respaldo').setInputFiles({ name: 'cifrado.json', mimeType: 'application/json', buffer: Buffer.from(cifrado) });
  await expect(page.getByText('«cifrado.json» está protegido con contraseña')).toBeVisible();
  await page.waitForTimeout(5_000); // la revisión del alterado ya terminó
  await expect(page.getByText('«cifrado.json» está protegido con contraseña')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('El archivo fue modificado o está dañado');
  await page.getByLabel('Contraseña del respaldo').fill('clave-ficticia-piloto-10');
  await page.getByRole('button', { name: 'Abrir respaldo' }).click();
  await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 120_000 });
});

test('PIL-RES-02 · interrupción: si se cierra la pestaña a mitad de una restauración, no queda nada a medias', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/#/respaldos');
  const { archivo, p } = piloto();
  await page.locator('#archivo-respaldo').setInputFiles(archivo);
  await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await page.waitForTimeout(150); // la transacción ya empezó
  await page.close({ runBeforeUnload: false });
  const p2 = await ctx.newPage();
  await p2.goto('/');
  const escuelas = await contar(p2, 'escuelas');
  const asistencias = await contar(p2, 'asistencias');
  // Todo o nada: o no se escribió nada, o se escribió completo.
  expect([[0, 0], [1, p.conteos.asistencias]]).toContainEqual([escuelas, asistencias]);
  await ctx.close();
});

test('PIL-OFF-01 · sin conexión: horario, pase de lista e incidencia; persisten al recargar sin red; nunca dice «sincronizado»', async ({ page, context }) => {
  const p = await cargarDemo(page);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto(`/#/grupo/${p.docente.grupoId}`);
  await expect(page.getByRole('table', { name: /Horario semanal de/ }).or(page.getByRole('list', { name: 'Horario de 1° A, Lunes' }))).toBeVisible();
  await page.goto(`/#/lista/${p.docente.sesionHoyId}/${HOY}`);
  await radio(page, alumno(5), 'Falta').check();
  await page.getByRole('button', { name: 'Guardar lista' }).click();
  await expect(page.locator('.aviso')).toContainText('Guardado en este dispositivo');
  await page.goto(`/#/ciclo/${p.cicloId}/prefectura/${HOY}`);
  await page.locator('summary', { hasText: 'Registrar incidencia' }).click();
  await page.locator('#f-incidencia-personalId').selectOption({ label: p.docenteAusente.nombre });
  await page.locator('#f-incidencia-tipo').selectOption('retardo');
  await page.getByRole('button', { name: 'Registrar incidencia' }).click();
  await expect(page.locator('#incidencias-dia')).toContainText('REPORTADA');
  await page.reload(); // sin red: la app sale del Service Worker y los datos de IndexedDB
  await expect(page.locator('#incidencias-dia')).toContainText('REPORTADA');
  await page.goto(`/#/lista/${p.docente.sesionHoyId}/${HOY}`);
  await expect(radio(page, alumno(5), 'Falta')).toBeChecked();
  await expect(page.locator('#sincronizacion')).toBeHidden(); // sin servidor no hay indicador de sincronización
  await expect(page.locator('body')).not.toContainText('Sincronizado');
  await context.setOffline(false);
});

test('PIL-LIM-01 · limpieza segura: «Quitar escuela de demostración» borra sólo DEMO-001; otra escuela (ficticia, no de demostración) queda intacta y sin ese botón', async ({ page }) => {
  const p = await cargarDemo(page);
  await page.goto('/#/escuela/nueva');
  await page.getByLabel('Nombre oficial de la escuela').fill('Escuela Secundaria Ficticia No Demo');
  await page.getByLabel('Clave de centro de trabajo (CCT)').fill('32ZZZ0950A');
  await page.getByLabel('Municipio o alcaldía').fill('Municipio Ejemplo');
  await page.getByRole('button', { name: 'Registrar escuela' }).click();
  await expect(page).toHaveURL(/#\/escuela\//);
  await expect(page.getByRole('button', { name: 'Quitar escuela de demostración' })).toHaveCount(0);
  const otra = page.url();
  await page.goto(`/#/escuela/${p.escuelaId}`);
  await page.getByRole('button', { name: 'Quitar escuela de demostración' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar escuela de demostración' }).click();
  await expect(page.locator('.aviso', { hasText: 'Escuela de demostración quitada' })).toBeVisible({ timeout: 60_000 });
  expect(await contar(page, 'escuelas')).toBe(1);
  expect(await contar(page, 'asistencias')).toBe(0);
  await expect(page.locator('#demostracion')).toBeHidden();
  await page.goto(otra);
  await expect(page.getByRole('heading', { level: 1, name: 'Escuela Secundaria Ficticia No Demo' })).toBeVisible();
});
