/**
 * Herramienta del PILOTO (Fase 10). Sólo datos FICTICIOS; nunca toca bases que no sean del piloto.
 *
 *   npm run piloto -- datos [--escala 1] [--semanas 3] [--hoy AAAA-MM-DD]
 *       Escribe piloto/salida/DEMO-001.json: un respaldo que se carga con «Restaurar» en el
 *       navegador del piloto (http://localhost:4180, origen propio = almacenamiento propio).
 *
 *   DATABASE_URL=postgres://…/gestion_piloto npm run piloto -- servidor iniciar [--escala 0.2]
 *       Crea (si falta) la base del piloto, aplica las migraciones y carga DEMO-001 con cuentas
 *       invitadas (Administración, Dirección, Prefectura y dos docentes).
 *
 *   DATABASE_URL=postgres://…/gestion_piloto npm run piloto -- servidor limpiar
 *       Borra la base del piloto COMPLETA.
 *
 * Candados (no se pueden desactivar):
 *   - el nombre de la base debe ser «gestion_piloto» o «gestion_piloto_<sufijo>»;
 *   - nunca en MODO=produccion;
 *   - «iniciar» sólo en una base sin escuelas;
 *   - «limpiar» sólo si TODAS las escuelas de esa base están marcadas como demostración (sin CCT).
 *     Si encuentra una sola escuela real, se detiene sin borrar nada.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { generarPiloto } from '../../piloto/datos';
import { migrar } from '../src/migrar.ts';
import { PATRON_BASE_PILOTO, cargarDemostracion, crearCuentas, cuentasPiloto } from './cargaPiloto.ts';

const [, , comando, sub, ...resto] = process.argv;
const opcion = (n: string) => { const args = [sub, ...resto]; const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const numero = (n: string, def: number) => { const v = opcion(n); return v === undefined ? def : Number(v); };

function baseDelPiloto(): { url: URL; nombre: string } {
  if (process.env.MODO === 'produccion') throw new Error('El piloto nunca se ejecuta en producción.');
  const texto = process.env.DATABASE_URL;
  if (!texto) throw new Error('Falta DATABASE_URL (por ejemplo postgres://USUARIO:CLAVE@localhost:5432/gestion_piloto).');
  const url = new URL(texto);
  const nombre = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!PATRON_BASE_PILOTO.test(nombre)) throw new Error(`Por seguridad, el piloto sólo usa una base llamada «gestion_piloto» (o «gestion_piloto_<sufijo>»); se recibió «${nombre}». No se hizo nada.`);
  return { url, nombre };
}
const mantenimiento = (url: URL) => { const u = new URL(url.toString()); u.pathname = '/postgres'; return u.toString(); };

async function main() {
  if (comando === 'datos') {
    const p = generarPiloto({ escala: numero('escala', 1), semanas: numero('semanas', 3), hoy: opcion('hoy') ?? new Date().toISOString().slice(0, 10) });
    mkdirSync('piloto/salida', { recursive: true });
    const archivo = 'piloto/salida/DEMO-001.json';
    writeFileSync(archivo, p.contenido);
    console.info([`Escuela de DEMOSTRACIÓN generada (datos FICTICIOS): ${archivo}`, `  huella ${p.huella}`,
      ...Object.entries(p.conteos).filter(([, n]) => n).map(([t, n]) => `  ${t.padEnd(20)} ${n}`),
      'Cárgala con «Restaurar» en http://localhost:4180 (npm run piloto:app).'].join('\n'));
    return;
  }
  if (comando !== 'servidor' || (sub !== 'iniciar' && sub !== 'limpiar')) throw new Error('Uso: piloto datos | piloto servidor iniciar | piloto servidor limpiar');
  const { url, nombre } = baseDelPiloto();
  const admin = new pg.Pool({ connectionString: mantenimiento(url), max: 1 });
  try {
    const existe = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre])).rowCount === 1;
    if (sub === 'limpiar') {
      if (!existe) { console.info(`La base ${nombre} no existe: nada que limpiar.`); return; }
      const bd = new pg.Pool({ connectionString: url.toString(), max: 1 });
      try {
        const tabla = (await bd.query(`SELECT to_regclass('escolar.escuelas') AS t`)).rows[0].t;
        if (tabla) {
          const { rows } = await bd.query<{ reales: number }>(`SELECT count(*) FILTER (WHERE NOT demostracion OR cct IS NOT NULL)::int AS reales FROM escolar.escuelas`);
          if (rows[0]!.reales > 0) throw new Error(`La base ${nombre} tiene ${rows[0]!.reales} escuela(s) que NO son de demostración. No se borra nada.`);
        }
      } finally { await bd.end(); }
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(nombre)} WITH (FORCE)`);
      console.info(`Base del piloto ${nombre} borrada (sólo contenía datos de demostración).`);
      return;
    }
    if (!existe) await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(nombre)}`);
    const bd = new pg.Pool({ connectionString: url.toString(), max: 3 });
    try {
      await migrar(bd);
      const p = generarPiloto({ escala: numero('escala', 0.2), semanas: numero('semanas', 2), hoy: opcion('hoy') ?? new Date().toISOString().slice(0, 10) });
      const r = await cargarDemostracion(bd, p);
      const docente2 = p.docenteAusente.id;
      const cuentas = cuentasPiloto(p, docente2);
      await crearCuentas(bd, p.escuelaId, cuentas, false);
      console.info([`Piloto listo en ${nombre}: ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001), ${r.registros} registros FICTICIOS, huella verificada.`,
        ...cuentas.map((c) => `  ${c.rol.padEnd(14)} ${c.correo}`),
        'Códigos de acceso: http://localhost:5173/api/desarrollo/buzon?correo=… (sólo en este equipo). Administración y Dirección activan la verificación en dos pasos al entrar.'].join('\n'));
    } finally { await bd.end(); }
  } finally { await admin.end(); }
}

main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
