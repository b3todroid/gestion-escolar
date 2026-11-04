import { expect as base, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { generarPiloto } from '../../piloto/datos';
import { alumno, radio } from './comun';

// Fase 10 — RENDIMIENTO REAL (no estimado) con DEMO-001 en varias escalas y dos perfiles:
// «escritorio» (Chromium) y «android-lento» (Pixel 7 emulado + CPU 4× más lenta por CDP).
// Es EMULACIÓN en el contenedor de desarrollo: no sustituye la prueba en teléfonos reales.
const HOY = '2026-11-02';
const ESCALAS = (process.env.PILOTO_ESCALAS ?? '0.1,0.5,1').split(',').map(Number);
const ARCHIVO = 'test-results/piloto-rendimiento.json';

interface Medicion { perfil: string; escala: number; medicion: string; ms: number; detalle?: string }
const leer = (): Medicion[] => (existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : []);

test.describe.configure({ mode: 'serial' });
test.use({ timezoneId: 'America/Mexico_City', locale: 'es-MX' });
const expect = base.configure({ timeout: 60_000 });

for (const escala of ESCALAS) {
  test(`rendimiento con escala ${escala}`, async ({ page }, info) => {
    test.setTimeout(30 * 60_000);
    const perfil = info.project.name;
    const cdp = await page.context().newCDPSession(page);
    if (perfil === 'android-lento') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Performance.enable');
    const memoriaMB = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return (metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1024 / 1024).toFixed(1);
    };
    const resultados = leer().filter((r) => !(r.perfil === perfil && r.escala === escala));
    const medir = async (medicion: string, fn: () => Promise<unknown>, detalle?: string) => {
      const t0 = Date.now(); await fn();
      resultados.push({ perfil, escala, medicion, ms: Date.now() - t0, detalle });
      mkdirSync('test-results', { recursive: true }); writeFileSync(ARCHIVO, JSON.stringify(resultados, null, 2));
    };
    const p = generarPiloto({ escala, semanas: 3, hoy: HOY });
    const archivo = `test-results/piloto/rend-${escala}.json`;
    mkdirSync('test-results/piloto', { recursive: true });
    writeFileSync(archivo, p.contenido);
    const tam = `${(p.contenido.length / 1048576).toFixed(1)} MB; ${p.conteos.alumnos} alumnos, ${p.conteos.grupos} grupos, ${p.conteos.personal} trabajadores, ${p.conteos.asistencias} marcas de asistencia`;

    await page.clock.install({ time: new Date(`${HOY}T07:15:00-06:00`) });
    await page.goto('/#/respaldos');
    await medir('Leer y validar el archivo (Zod, referencias, huella)', async () => {
      await page.locator('#archivo-respaldo').setInputFiles(archivo);
      await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 15 * 60_000 });
    }, tam);
    await page.getByRole('button', { name: 'Restaurar' }).click();
    await medir('Cargar DEMO-001 en el dispositivo (restaurar)', async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
      await expect(page.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 20 * 60_000 });
    });
    // Cada pantalla se mide partiendo de una página ligera (Aplicación), para no medir la anterior.
    const ir = async (n: string, ruta: string, listo: () => Promise<void>) => { await page.goto('/#/aplicacion'); await page.waitForTimeout(300); await medir(n, async () => { await page.goto(ruta); await listo(); }); };
    await ir('Abrir pantalla de inicio', '/#/escuelas', () => expect(page.locator('.tarjeta-escuela')).toBeVisible());
    await ir('Abrir panel de la escuela', `/#/escuela/${p.escuelaId}`, () => expect(page.locator('#resumen-catalogos')).toBeVisible());
    await ir(`Lista de alumnos del ciclo (${p.conteos.alumnos})`, `/#/ciclo/${p.cicloId}/alumnos`, () => expect(page.locator('#resumen-alumnos')).toContainText(String(p.conteos.alumnos)));
    await medir('Buscar alumno por matrícula', async () => {
      await page.locator('#buscar-alumno').fill('DEMO-A-00007');
      await expect(page.locator('#lista-alumnos-titulo ~ div .renglon:visible')).toHaveCount(1);
    });
    await ir('Abrir horario de grupo', `/#/grupo/${p.docente.grupoId}`, () => expect(page.locator('main')).toContainText('Horario confirmado'));
    await ir('Abrir horario de docente', `/#/personal/${p.docente.id}/ciclo/${p.cicloId}`, () => expect(page.locator('main')).toContainText('1° A'));
    await ir('Revisión de conflictos del ciclo', `/#/ciclo/${p.cicloId}/horarios`, () => expect(page.getByRole('heading', { level: 1 })).toBeVisible());
    await ir('Abrir pase de lista', `/#/lista/${p.docente.sesionHoyId}/${HOY}`, () => expect(page.getByRole('button', { name: 'Guardar lista' })).toBeVisible());
    await radio(page, alumno(1), 'Falta').check();
    await medir('Guardar asistencia (50 alumnos)', async () => {
      await page.getByRole('button', { name: 'Guardar lista' }).click();
      await expect(page.locator('.aviso', { hasText: 'Lista guardada' })).toBeVisible();
    });
    await ir('Asistencia del grupo (3 semanas)', `/#/alumnos/${p.docente.grupoId}`, () => expect(page.locator('.lista-resumen li').first()).toBeVisible());
    await ir('Prefectura: panel del día', `/#/ciclo/${p.cicloId}/prefectura/${HOY}`, () => expect(page.locator('#resumen-prefectura')).toBeVisible());
    await page.goto(`/#/ciclo/${p.cicloId}/prefectura-reportes`);
    await medir('Prefectura: generar reporte de 30 días', async () => {
      await page.locator('#f-reporte-periodo').selectOption('intervalo').catch(() => undefined);
      await page.locator('#f-reporte-desde').fill('2026-10-03');
      await page.locator('#f-reporte-hasta').fill(HOY);
      await page.getByRole('button', { name: 'Generar reporte' }).click();
      await expect(page.locator('#indicadores-reporte')).toBeVisible();
    });
    // Importación: hasta 300 alumnos nuevos (CSV ficticio)
    const todas = p.csvAlumnosNuevos.split('\n');
    const n = Math.min(300, todas.length - 1);
    const filas = todas.slice(0, n + 1).join('\n');
    await page.goto(`/#/ciclo/${p.cicloId}/importar-datos`);
    await page.getByRole('radio', { name: /^Alumnos/ }).check();
    await medir(`Importar ${n} alumnos: analizar`, async () => {
      await page.locator('#archivo-datos').setInputFiles({ name: 'alumnos-demo.csv', mimeType: 'text/csv', buffer: Buffer.from(filas) });
      await page.getByRole('button', { name: 'Analizar archivo' }).click();
      await expect(page.getByRole('button', { name: `Confirmar e importar (${n})` })).toBeVisible({ timeout: 2 * 60_000 });
    });
    await medir(`Importar ${n} alumnos: guardar`, async () => {
      await page.getByRole('button', { name: `Confirmar e importar (${n})` }).click();
      await expect(page.locator('#resultado-importacion')).toContainText(`${n} registro(s) nuevo(s)`, { timeout: 10 * 60_000 });
    });
    const almacen = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
    resultados.push({ perfil, escala, medicion: 'Memoria JavaScript al final (JSHeapUsedSize)', ms: 0, detalle: `${await memoriaMB()} MB` });
    resultados.push({ perfil, escala, medicion: 'Almacenamiento usado (navigator.storage.estimate)', ms: 0, detalle: `${(almacen / 1048576).toFixed(1)} MB` });
    writeFileSync(ARCHIVO, JSON.stringify(resultados, null, 2));
    console.log(resultados.filter((r) => r.perfil === perfil && r.escala === escala).map((r) => `${perfil} ${escala} · ${r.medicion}: ${r.ms} ms ${r.detalle ?? ''}`).join('\n'));
  });
}

export type { Page };
