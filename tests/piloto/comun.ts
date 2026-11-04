import { expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generarPiloto, type DatosPiloto } from '../../piloto/datos';

/** Escala del piloto funcional (PILOTO_ESCALA=1 para el tamaño completo: 30 grupos, 100 trabajadores, 1 500 alumnos). */
export const ESCALA = Number(process.env.PILOTO_ESCALA ?? 0.2);
export const HOY = '2026-11-02'; // lunes
export const a = (h: string) => new Date(`${HOY}T${h}:00-06:00`);

let cache: { p: DatosPiloto; archivo: string } | null = null;
/** Datos FICTICIOS reproducibles de DEMO-001 (se generan una vez por proceso). */
export function piloto(): { p: DatosPiloto; archivo: string } {
  if (cache) return cache;
  const p = generarPiloto({ escala: ESCALA, semanas: 3, hoy: HOY });
  mkdirSync('test-results/piloto', { recursive: true });
  const archivo = `test-results/piloto/DEMO-001-${ESCALA}.json`;
  if (!existsSync(archivo)) writeFileSync(archivo, p.contenido);
  cache = { p, archivo };
  return cache;
}

/** Carga DEMO-001 con «Restaurar» (el mismo camino que usaría la escuela) en un navegador vacío. */
export async function cargarDemo(page: Page, hora = '07:15'): Promise<DatosPiloto> {
  const { p, archivo } = piloto();
  await page.clock.install({ time: a(hora) });
  await page.goto('/#/respaldos');
  await page.locator('#archivo-respaldo').setInputFiles(archivo);
  await expect(page.locator('.respaldo-escuela')).toContainText('Se agregará', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('#informe-restauracion')).toContainText('Restauración completa', { timeout: 300_000 });
  return p;
}

export async function contar(page: Page, tabla: string): Promise<number> {
  return page.evaluate((t) => new Promise<number>((ok) => {
    const r = indexedDB.open('gestion-escolar');
    r.onsuccess = () => { const db = r.result; const c = db.transaction(t).objectStore(t).count(); c.onsuccess = () => { ok(c.result); db.close(); }; };
  }), tabla);
}

/** Alumno n del generador, como lo muestra la lista: «Apellido Segundo, Nombre». */
const NOMBRES = ['Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fer', 'Gabi', 'Hugo', 'Iris', 'Juan', 'Karla', 'Luis', 'Mara', 'Nico', 'Olga', 'Pablo'];
const APELLIDOS = ['Demo', 'Ejemplo', 'Prueba', 'Muestra', 'Ficticio', 'Simulado', 'Modelo', 'Ensayo'];
const SEGUNDOS = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce'];
export const alumno = (n: number) => `${APELLIDOS[Math.floor(n / 16) % 8]} ${SEGUNDOS[Math.floor(n / 128) % 12]} ${n}, ${NOMBRES[n % 16]}`;
export const radio = (page: Page, n: string, m: string) => page.getByRole('radiogroup', { name: `Asistencia de ${n}` }).getByRole('radio', { name: m });
