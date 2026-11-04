import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { generarPiloto } from '../../piloto/datos';
import { cargarDemostracion } from '../herramientas/cargaPiloto.ts';
import { migrar } from '../src/migrar.ts';
import { crearBasePrueba, urlAdministrativa } from './entorno.ts';

// Fase 10 — entorno del piloto: carga verificada y limpieza que NUNCA borra datos que no sean de demostración.
let base: Awaited<ReturnType<typeof crearBasePrueba>>;
let bd: pg.Pool;
beforeAll(async () => { base = await crearBasePrueba(); bd = new pg.Pool({ connectionString: base.url, max: 3 }); await migrar(bd); });
afterAll(async () => { await bd.end(); await base.borrar(); });

const cli = (url: string, ...args: string[]) => {
  try { return { codigo: 0, salida: execFileSync('node', ['dist-servidor/piloto.mjs', ...args], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (e) { const x = e as { status: number; stderr: string; stdout: string }; return { codigo: x.status, salida: `${x.stdout}${x.stderr}` }; }
};
const urlCon = (nombre: string) => { const u = new URL(urlAdministrativa()); u.pathname = `/${nombre}`; return u.toString(); };
const existe = async (nombre: string) => { const c = new pg.Client({ connectionString: urlAdministrativa() }); await c.connect(); const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]); await c.end(); return r.rowCount === 1; };

describe('carga de DEMO-001 en el servidor', () => {
  test('todo o nada, con la huella releída igual a la generada; sólo en una base sin escuelas', async () => {
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    const r = await cargarDemostracion(bd, p);
    expect(r.registros).toBe(Object.values(p.conteos).reduce((a, b) => a + b, 0));
    const { rows } = await bd.query('SELECT nombre, nombre_corto, cct, demostracion FROM escolar.escuelas');
    expect(rows).toEqual([{ nombre: 'ESCUELA DEMO GESTIÓN ESCOLAR', nombre_corto: 'DEMO-001', cct: null, demostracion: true }]);
    await expect(cargarDemostracion(bd, p)).rejects.toThrow(/ya tiene escuelas/);
  });

  test('la base impide cambiar la marca de demostración o dársela a una escuela con CCT', async () => {
    await expect(bd.query('UPDATE escolar.escuelas SET demostracion = false')).rejects.toThrow(/no se puede cambiar/);
    await expect(bd.query(`INSERT INTO escolar.escuelas (id, creado_en, actualizado_en, version, nombre, cct, nivel, demostracion)
      VALUES (gen_random_uuid(), now(), now(), 1, 'Escuela Ficticia', '32ZZZ0009Z', 'secundaria', true)`)).rejects.toThrow(/escuelas_demostracion_sin_cct/);
  });

  test('rechaza datos cuya escuela no esté marcada como demostración', async () => {
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    const sobre = JSON.parse(p.contenido); sobre.datos.escuelas[0].demostracion = false;
    await expect(cargarDemostracion(bd, { ...p, contenido: JSON.stringify(sobre) })).rejects.toThrow(/marcada como demostración/);
  });
});

describe('herramienta «npm run piloto» (candados)', () => {
  test('se niega a tocar una base cuyo nombre no es del piloto', () => {
    const r = cli(base.url, 'servidor', 'limpiar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/sólo usa una base llamada «gestion_piloto»/);
  });

  test('iniciar → limpiar borra la base del piloto; con una escuela que no sea de demostración, no borra nada', async () => {
    const nombre = `gestion_piloto_t${randomBytes(4).toString('hex')}`;
    const url = urlCon(nombre);
    expect(cli(url, 'servidor', 'iniciar', '--escala', '0.1', '--semanas', '1').codigo).toBe(0);
    expect(await existe(nombre)).toBe(true);
    // Una escuela NO marcada dentro de la base del piloto: la limpieza se detiene.
    const b = new pg.Pool({ connectionString: url, max: 1 });
    await b.query(`INSERT INTO escolar.escuelas (id, creado_en, actualizado_en, version, nombre, cct, nivel) VALUES (gen_random_uuid(), now(), now(), 1, 'Escuela Ficticia No Marcada', '32ZZZ0008Y', 'secundaria')`);
    await b.end();
    const r = cli(url, 'servidor', 'limpiar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NO son de demostración\. No se borra nada/);
    expect(await existe(nombre)).toBe(true);
    // Fin de la prueba: la base temporal (sólo datos ficticios de esta prueba) se borra con el administrador de pruebas.
    const c = new pg.Client({ connectionString: urlAdministrativa() }); await c.connect(); await c.query(`DROP DATABASE ${nombre} WITH (FORCE)`); await c.end();
    // Y una base del piloto sólo con DEMO-001 sí se limpia con la herramienta.
    expect(cli(url, 'servidor', 'iniciar', '--escala', '0.1', '--semanas', '1').codigo).toBe(0);
    expect(cli(url, 'servidor', 'limpiar').codigo).toBe(0);
    expect(await existe(nombre)).toBe(false);
  }, 120_000);
});
