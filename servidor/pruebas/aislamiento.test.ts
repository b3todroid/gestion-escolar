/**
 * Fase 8C — batería de AISLAMIENTO directamente en PostgreSQL (como lo hace la API):
 * 2 escuelas × 6 roles × 30 tablas, lectura y escritura. Sólo datos ficticios.
 * Cada prueba corre como el rol restringido `gestion_app` y se deshace al terminar.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ROLES, type Rol } from '../src/acceso.ts';
import { crearEntorno, escuelaFicticia, type Entorno } from './entorno.ts';
import { sembrar, type Semilla } from './semilla.ts';

let e: Entorno;
let A: Semilla; let B: Semilla;
/** usuarios[escuela][rol] */
const usuarios: Record<'A' | 'B', Record<Rol, string>> = { A: {} as Record<Rol, string>, B: {} as Record<Rol, string> };
let doble: string; // persona con rol de administrador en A y en B

/**
 * ESPECIFICACIÓN (escrita aparte de la migración): alcance de lectura y escritura por rol.
 * Orden: administrador, direccion, subdireccion, prefectura, docente, apoyo.
 * e = toda la escuela · g = sus grupos · p = lo propio · n = nada
 */
const ESPEC: Record<string, [string, string]> = {
  escuelas: ['eeeeee', 'eennnn'], ciclos: ['eeeeee', 'eennnn'], turnos: ['eeeeee', 'eennnn'], jornadas: ['eeeeee', 'eennnn'],
  periodos: ['eeeeee', 'eennnn'], recesos: ['eeeeee', 'eennnn'], grados: ['eeeeee', 'eennnn'], personal: ['eeeeee', 'eennnn'],
  grupos: ['eeeege', 'neennn'], materias: ['eeeeee', 'neennn'], asignaciones: ['eeeege', 'neennn'], sesiones: ['eeeege', 'neennn'],
  actividades: ['eeeege', 'neennn'], excepciones: ['eeeepn', 'neennn'], confirmaciones: ['eeeege', 'nennnn'], bitacora: ['eeennn', 'neennn'],
  adscripciones: ['eeeepn', 'eeennn'], alumnos: ['eeeege', 'neennn'], inscripciones: ['eeeege', 'neennn'], movimientos: ['eeeege', 'neennn'],
  importaciones: ['eeennn', 'eeennn'], plantillas_importacion: ['eeennn', 'eeennn'], pases: ['eeeegn', 'nnnnpn'], asistencias: ['eeeegn', 'nnnngn'],
  cambios_asistencia: ['eeeegn', 'nnnngn'], salidas: ['eeeege', 'nnnegn'], reportes: ['eeeege', 'nnnegn'], incidencias_personal: ['eeeepn', 'eeeenn'],
  coberturas: ['eeeepn', 'eeeenn'], banco_actividades: ['eeeeen', 'eeeeen'], bitacora_prefectura: ['eeeenn', 'eeeeen'],
};
const TABLAS = Object.keys(ESPEC);
/** Historiales y banco: se prueban INSERTANDO una copia (no admiten modificación desde la API). */
const PRUEBA_CON_INSERCION = new Set(['bitacora', 'bitacora_prefectura', 'cambios_asistencia', 'movimientos', 'banco_actividades']);

/** Filas que el Docente Uno (grupo G1, ficha D1) debe alcanzar con «g»/«p» en los datos sembrados. */
async function filasDelDocenteUno(tabla: string, s: Semilla): Promise<Set<string>> {
  const cond: Record<string, string> = {
    grupos: `id = '${s.g1}'`, asignaciones: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`, sesiones: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`,
    actividades: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`, excepciones: `personal_id = '${s.d1}'`, confirmaciones: `grupo_id = '${s.g1}'`,
    adscripciones: `personal_id = '${s.d1}'`, alumnos: `id = '${s.al1}'`, inscripciones: `grupo_id = '${s.g1}'`, movimientos: `grupo_nuevo_id = '${s.g1}' OR grupo_anterior_id = '${s.g1}'`,
    pases: `personal_id = '${s.d1}'`, asistencias: `grupo_id = '${s.g1}'`, cambios_asistencia: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`,
    salidas: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`, reportes: `grupo_id = '${s.g1}' OR personal_id = '${s.d1}'`,
    incidencias_personal: `personal_id = '${s.d1}'`, coberturas: `asignado_id = '${s.d1}' OR docente_ausente_id = '${s.d1}'`,
  };
  const c = cond[tabla];
  if (!c) return new Set();
  const { rows } = await e.bd.query(`SELECT id FROM escolar.${tabla} WHERE escuela_id = $1 AND (${c})`, [s.escuelaId]);
  return new Set(rows.map((r) => r.id as string));
}

async function idsDe(tabla: string, s: Semilla): Promise<string[]> {
  const col = tabla === 'escuelas' ? 'id' : 'escuela_id';
  const { rows } = await e.bd.query(`SELECT id FROM escolar.${tabla} WHERE ${col} = $1 ORDER BY id`, [s.escuelaId]);
  return rows.map((r) => r.id as string);
}

/** Corre `fn` como la API: rol gestion_app, usuario y escuela de la ruta. Siempre se deshace. */
async function como<R>(usuarioId: string | null, escuelaId: string | null, fn: (c: PoolClient) => Promise<R>): Promise<R> {
  const c = await e.bd.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE gestion_app');
    if (usuarioId) await c.query(`SELECT set_config('app.usuario_id', $1, true)`, [usuarioId]);
    if (escuelaId) await c.query(`SELECT set_config('app.escuela_id', $1, true)`, [escuelaId]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

/** ¿Puede modificar la fila? true = se aplicó; false = filtrada (0 filas) o rechazada. */
async function puedeEscribir(c: PoolClient, tabla: string, id: string): Promise<boolean> {
  await c.query('SAVEPOINT sonda');
  try {
    if (PRUEBA_CON_INSERCION.has(tabla)) {
      const { rows } = await e.bd.query(`SELECT to_jsonb(t) AS j FROM escolar.${tabla} t WHERE id = $1`, [id]);
      const copia = { ...rows[0].j, id: randomUUID() };
      await c.query(`INSERT INTO escolar.${tabla} SELECT * FROM jsonb_populate_record(NULL::escolar.${tabla}, $1)`, [copia]);
      return true;
    }
    const r = await c.query(`UPDATE escolar.${tabla} SET version = version WHERE id = $1`, [id]);
    return r.rowCount === 1;
  } catch (x) {
    const code = (x as { code?: string }).code;
    if (code === '42501' || code === '23505') return false;
    throw x;
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT sonda');
  }
}

async function crearUsuario(escuelaId: string, rol: Rol, personalId: string | null): Promise<string> {
  const id = randomUUID();
  await e.bd.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, false, now(), now())`,
    [id, `Persona ${rol} ficticia`, `${rol}.${id.slice(0, 6)}@ejemplo.test`]);
  await agregarMembresia(id, escuelaId, rol, personalId);
  return id;
}
async function agregarMembresia(usuarioId: string, escuelaId: string, rol: Rol, personalId: string | null) {
  await e.bd.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, estado, personal_id, tipo_correo, expira_en, aceptada_en)
    VALUES ($1, $2, $3, 'activa', $4, 'institucional', now() + interval '1 day', now())`, [usuarioId, escuelaId, rol, personalId]);
}

beforeAll(async () => {
  e = await crearEntorno();
  const a = await escuelaFicticia(e, 'admin-a@ejemplo.test');
  const b = await escuelaFicticia(e, 'admin-b@ejemplo.test');
  A = await sembrar(e.bd, a.escuelaId);
  B = await sembrar(e.bd, b.escuelaId);
  for (const [k, s] of [['A', A], ['B', B]] as const) {
    for (const rol of ROLES) usuarios[k][rol] = await crearUsuario(s.escuelaId, rol, rol === 'docente' ? s.d1 : rol === 'prefectura' ? s.pf : null);
  }
  doble = await crearUsuario(A.escuelaId, 'administrador', null);
  await agregarMembresia(doble, B.escuelaId, 'administrador', null);
}, 120_000);
afterAll(async () => { await e?.cerrar(); });

describe('Matriz de permisos', () => {
  test('la matriz de la base coincide con la especificación (31 tablas × 6 roles)', async () => {
    const { rows } = await e.bd.query('SELECT tabla, rol, lectura, escritura FROM acceso.matriz');
    expect(rows).toHaveLength(TABLAS.length * ROLES.length);
    const letra = (x: string) => x[0] === 'n' ? 'n' : x[0];
    for (const t of TABLAS) {
      const fila = (campo: 'lectura' | 'escritura') => ROLES.map((r) => letra(rows.find((x) => x.tabla === t && x.rol === r)![campo])).join('');
      expect([fila('lectura'), fila('escritura')], t).toEqual(ESPEC[t]);
    }
  });

  test('todas las tablas escolares tienen seguridad por fila y la API no puede leer cuentas ni membresías', async () => {
    const { rows } = await e.bd.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'escolar' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(rows).toEqual([]);
    for (const tabla of ['acceso.membresias', 'acceso.auditoria', 'acceso.matriz', 'acceso.operaciones', '"user"', 'session', 'account', 'verification', '"twoFactor"']) {
      await expect(como(usuarios.A.administrador, A.escuelaId, (c) => c.query(`SELECT 1 FROM ${tabla} LIMIT 1`)), tabla).rejects.toThrow(/permission denied/);
    }
  });
});

describe.each(['A', 'B'] as const)('Escuela %s', (k) => {
  const propia = () => (k === 'A' ? A : B);
  const ajena = () => (k === 'A' ? B : A);

  describe.each(ROLES.map((r, i) => [r, i] as const))('rol %s', (rol, i) => {
    test('lectura: ve exactamente lo que le permite su alcance y NADA de la otra escuela', async () => {
      for (const t of TABLAS) {
        const alcance = ESPEC[t]![0][i]!;
        const todas = await idsDe(t, propia());
        const esperadas = alcance === 'e' ? new Set(todas) : alcance === 'n' ? new Set<string>() : await filasDelDocenteUno(t, propia());
        const vistas = await como(usuarios[k][rol], propia().escuelaId, async (c) => (await c.query(`SELECT id FROM escolar.${t}`)).rows.map((r) => r.id as string));
        expect(new Set(vistas), `${rol} lee ${t}`).toEqual(esperadas);
        // Ni siquiera atando la transacción a la otra escuela.
        const ajenas = await como(usuarios[k][rol], ajena().escuelaId, async (c) => (await c.query(`SELECT count(*)::int AS n FROM escolar.${t}`)).rows[0].n);
        expect(ajenas, `${rol} lee ${t} de la otra escuela`).toBe(0);
      }
    });

    test('escritura: modifica sólo lo que le permite su alcance y NADA de la otra escuela', async () => {
      for (const t of TABLAS) {
        const alcance = ESPEC[t]![1][i]!;
        const todas = await idsDe(t, propia());
        const esperadas = alcance === 'e' ? new Set(todas) : alcance === 'n' ? new Set<string>() : await filasDelDocenteUno(t, propia());
        const escritas = await como(usuarios[k][rol], propia().escuelaId, async (c) => {
          const ok: string[] = [];
          for (const id of todas) if (await puedeEscribir(c, t, id)) ok.push(id);
          return ok;
        });
        expect(new Set(escritas), `${rol} escribe ${t}`).toEqual(esperadas);
        const ajenas = await como(usuarios[k][rol], propia().escuelaId, async (c) => {
          let n = 0;
          for (const id of await idsDe(t, ajena())) if (await puedeEscribir(c, t, id)) n++;
          return n;
        });
        expect(ajenas, `${rol} escribe ${t} de la otra escuela`).toBe(0);
      }
    });
  });
});

describe('Límites adicionales', () => {
  test('quien administra dos escuelas sólo ve la escuela de la ruta en cada petición', async () => {
    for (const t of TABLAS) {
      const enA = await como(doble, A.escuelaId, async (c) => (await c.query(`SELECT count(*)::int AS n FROM escolar.${t} WHERE ${t === 'escuelas' ? 'id' : 'escuela_id'} = $1`, [B.escuelaId])).rows[0].n);
      expect(enA, t).toBe(0);
    }
    const enB = await como(doble, B.escuelaId, async (c) => (await c.query('SELECT count(*)::int AS n FROM escolar.alumnos')).rows[0].n);
    expect(enB).toBe(2);
  });

  test('sin usuario, con acceso revocado o con invitación sin aceptar no se ve nada', async () => {
    expect(await como(null, A.escuelaId, async (c) => (await c.query('SELECT count(*)::int AS n FROM escolar.alumnos')).rows[0].n)).toBe(0);
    const revocada = await crearUsuario(A.escuelaId, 'direccion', null);
    await e.bd.query(`UPDATE acceso.membresias SET estado = 'revocada', revocada_en = now(), motivo_revocacion = 'Prueba ficticia' WHERE usuario_id = $1`, [revocada]);
    expect(await como(revocada, A.escuelaId, async (c) => (await c.query('SELECT count(*)::int AS n FROM escolar.alumnos')).rows[0].n)).toBe(0);
    const invitada = await crearUsuario(A.escuelaId, 'direccion', null);
    await e.bd.query(`UPDATE acceso.membresias SET estado = 'invitada', aceptada_en = NULL WHERE usuario_id = $1`, [invitada]);
    expect(await como(invitada, A.escuelaId, async (c) => (await c.query('SELECT count(*)::int AS n FROM escolar.alumnos')).rows[0].n)).toBe(0);
  });

  test('un docente sin ficha de personal vinculada no ve grupos ni alumnos', async () => {
    const sinFicha = await crearUsuario(A.escuelaId, 'docente', null);
    for (const t of ['grupos', 'alumnos', 'pases', 'sesiones']) {
      expect(await como(sinFicha, A.escuelaId, async (c) => (await c.query(`SELECT count(*)::int AS n FROM escolar.${t}`)).rows[0].n), t).toBe(0);
    }
  });

  test('no se puede colgar un registro propio de datos de otra escuela (aunque las llaves foráneas lo permitirían)', async () => {
    await como(usuarios.A.direccion, A.escuelaId, async (c) => {
      const intento = c.query(`UPDATE escolar.inscripciones SET grupo_id = $1 WHERE id = $2`, [B.g1, A.i1]);
      await expect(intento).rejects.toThrow(/otra escuela/);
    });
    // También el dueño de la base (operador, migración) está sujeto a esta regla.
    await expect(e.bd.query(`UPDATE escolar.asignaciones SET personal_id = $1 WHERE grupo_id = $2`, [B.d1, A.g1])).rejects.toThrow(/otra escuela/);
    await como(usuarios.A.direccion, A.escuelaId, async (c) => {
      await expect(c.query(`UPDATE escolar.adscripciones SET turno_ids = $1 WHERE personal_id = $2`, [[A.turnoId, B.turnoId], A.d1])).rejects.toThrow(/otra escuela/);
    });
  });

  test('con el ciclo cerrado, nadie modifica sus datos desde la API', async () => {
    await e.bd.query(`UPDATE escolar.ciclos SET estado = 'cerrado' WHERE id = $1`, [A.cicloId]);
    try {
      await como(usuarios.A.docente, A.escuelaId, async (c) => {
        await expect(c.query(`UPDATE escolar.pases SET version = version WHERE id = $1`, [A.pa1])).rejects.toThrow(/cerrado/);
      });
      await como(usuarios.A.direccion, A.escuelaId, async (c) => {
        await expect(c.query(`UPDATE escolar.grupos SET nombre = 'Z' WHERE id = $1`, [A.g1])).rejects.toThrow(/cerrado/);
      });
    } finally {
      await e.bd.query(`UPDATE escolar.ciclos SET estado = 'activo' WHERE id = $1`, [A.cicloId]);
    }
  });

  test('confirmar incidencias y autorizar coberturas: administrador o delegación expresa (D5)', async () => {
    const confirmar = (u: string) => como(u, A.escuelaId, (c) => c.query(`UPDATE escolar.incidencias_personal SET estado = 'confirmada' WHERE id = $1`, [A.incidencia1]));
    await expect(confirmar(usuarios.A.prefectura)).rejects.toThrow(/administrador de la escuela/);
    await expect(confirmar(usuarios.A.direccion)).rejects.toThrow(/administrador de la escuela/);
    await expect(confirmar(usuarios.A.administrador)).resolves.toBeTruthy();
    await e.bd.query(`UPDATE acceso.membresias SET permisos_delegados = '{confirmar_incidencias}' WHERE usuario_id = $1`, [usuarios.A.direccion]);
    await expect(confirmar(usuarios.A.direccion)).resolves.toBeTruthy();
    await expect(confirmar(usuarios.A.subdireccion)).rejects.toThrow(/administrador de la escuela/);
    const autorizar = (u: string) => como(u, A.escuelaId, (c) => c.query(`UPDATE escolar.coberturas SET estado = 'asignada', asignado_id = $2 WHERE sesion_id = $1`, [A.s1, A.pf]));
    await expect(autorizar(usuarios.A.prefectura)).rejects.toThrow(/autoriza coberturas/);
    await expect(autorizar(usuarios.A.direccion)).rejects.toThrow(/autoriza coberturas/); // delegó incidencias, no coberturas
    await expect(autorizar(usuarios.A.administrador)).resolves.toBeTruthy();
  });

  test('banco de actividades: docentes y Prefectura proponen; sólo Administración, Dirección o Subdirección validan', async () => {
    const insertar = (u: string, estado: string) => como(u, A.escuelaId, async (c) => {
      const { rows } = await e.bd.query(`SELECT to_jsonb(t) AS j FROM escolar.banco_actividades t WHERE id = $1`, [A.banco]);
      return c.query(`INSERT INTO escolar.banco_actividades SELECT * FROM jsonb_populate_record(NULL::escolar.banco_actividades, $1)`, [{ ...rows[0].j, id: randomUUID(), estado }]);
    });
    await expect(insertar(usuarios.A.docente, 'propuesta')).resolves.toBeTruthy();
    await expect(insertar(usuarios.A.docente, 'validada')).rejects.toThrow(/validan o retiran/);
    await expect(insertar(usuarios.A.apoyo, 'propuesta')).rejects.toThrow(/row-level security/);
    const validar = (u: string) => como(u, A.escuelaId, (c) => c.query(`UPDATE escolar.banco_actividades SET estado = 'validada' WHERE id = $1`, [A.banco]));
    await expect(validar(usuarios.A.prefectura)).rejects.toThrow(/validan o retiran/);
    await expect(validar(usuarios.A.subdireccion)).resolves.toBeTruthy();
  });

  test('sólo Dirección confirma o reabre horarios', async () => {
    const reabrir = (u: string) => como(u, A.escuelaId, (c) => c.query(`DELETE FROM escolar.confirmaciones WHERE grupo_id = $1`, [A.g1]));
    expect((await reabrir(usuarios.A.subdireccion)).rowCount).toBe(0); // la política ni siquiera se la muestra para borrar
    expect((await reabrir(usuarios.A.direccion)).rowCount).toBe(1);
  });

  test('los historiales sólo se agregan desde la API', async () => {
    await como(usuarios.A.direccion, A.escuelaId, async (c) => {
      await expect(c.query(`DELETE FROM escolar.bitacora`)).rejects.toThrow(/sólo se agregan/);
    });
    await como(usuarios.A.docente, A.escuelaId, async (c) => {
      await expect(c.query(`UPDATE escolar.cambios_asistencia SET marca_nueva = 'P'`)).rejects.toThrow(/sólo se agregan/);
    });
  });
});
