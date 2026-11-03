import { beforeEach, describe, expect, it } from 'vitest';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import { cifrar, descifrar, esCifrado, FORMATO_CIFRADO } from '../../src/utils/cifrado';
import { TABLAS_RESPALDO } from '../../src/validators/respaldo';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Fase 5 — respaldos, cifrado y recuperación. Datos ficticios. 2026-11-02 es lunes.
const LUNES = '2026-11-02';
const CLAVE = 'clave-ficticia-segura-1';
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 500', cct: '32ZZZ0500A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 1, capacidad: null },
};

let s: Servicios; let db: BaseDatosEscolar; let nombreBd: string; let escuelaId: string; let cicloId: string; let A: Grupo;

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  escuelaId = r.escuela.id; cicloId = r.ciclo.id;
  A = (await s.grados.listarGrupos(cicloId))[0]!;
  const d = await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticio', funciones: ['docente'] });
  const [m] = await s.materias.crearVarias(cicloId, 'Matemáticas');
  const a = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: m!.id, personalId: d.id, horasSemana: 5 });
  const [c] = await s.asignaciones.horarioDelDia(A.id, 1);
  const ses = await s.asignaciones.programar({ grupoId: A.id, asignacionId: a.id, dia: 1, periodoId: c!.periodo.id });
  const [ana, beto] = await s.alumnos.crearVarios(A.id, 'Alumna Ficticia, Ana\nAlumno Ficticio, Beto');
  await s.asistencia.guardarLista(ses.id, LUNES, { [beto!.id]: 'R' }, { [beto!.id]: '07:10' }, LUNES, d.id);
  const sal = await s.asistencia.registrarSalida(ses.id, LUNES, ana!.id, '07:20', LUNES, d.id);
  await s.asistencia.reincorporar(sal.id, '07:25');
  await s.asistencia.crearReporte(ana!.id, { tipo: 'otro', texto: 'Nota ficticia de prueba.' }, { personalId: d.id, sesionId: ses.id, fecha: LUNES, hora: '07:30' });
});

/** Contenido de todas las tablas de la escuela (para comparar antes/después). */
async function volcar(base: BaseDatosEscolar) {
  const r: Record<string, unknown[]> = {};
  for (const t of TABLAS_RESPALDO) {
    const tabla = (base as unknown as Record<string, { toArray(): Promise<{ id: string }[]> }>)[t === 'ciclos' ? 'ciclosEscolares' : t]!;
    r[t] = (await tabla.toArray()).sort((x, y) => x.id.localeCompare(y.id));
  }
  return r;
}

describe('5. Exportación', () => {
  it('JSON versionado con esquema, fecha, escuela, ciclos, conteos e integridad referencial', async () => {
    const r = await s.respaldos.exportar([escuelaId]);
    expect(r.cifrado).toBe(false);
    const j = JSON.parse(r.contenido);
    expect(j).toMatchObject({ formato: 'gestion-escolar-respaldo', versionFormato: 2, esquema: VERSION_ESQUEMA, escuelas: [{ id: escuelaId, nombre: 'Escuela Secundaria Ficticia 500' }], ciclos: [{ id: cicloId, nombre: '2026-2027' }] });
    expect(j.creadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(j.conteos).toMatchObject({ alumnos: 2, pases: 1, asistencias: 2, salidas: 1, reportes: 1, sesiones: 1 });
    expect(Object.values(j.conteos as Record<string, number>).reduce((x, y) => x + y, 0)).toBe(r.registros);
    expect(j.huella).toMatch(/^[0-9a-f]{64}$/);
    // Se puede restaurar en un dispositivo vacío: todas las referencias están dentro del archivo
    const otro = nuevoEntorno();
    const a = await otro.s.respaldos.analizar(r.contenido);
    expect([a.errores, a.puedeRestaurar, a.registros]).toEqual([[], true, r.registros]);
  });
});

describe('Cifrado autenticado con contraseña', () => {
  it('cifra todo el archivo; sin contraseña, con una incorrecta o alterado no se abre; con la correcta se restaura', async () => {
    await expect(s.respaldos.exportar([escuelaId], { contrasena: 'corta' })).rejects.toThrow('al menos 10');
    await expect(s.respaldos.exportar([escuelaId], { contrasena: CLAVE, confirmacion: 'otra-clave-distinta' })).rejects.toThrow('no coinciden');
    const r = await s.respaldos.exportar([escuelaId], { contrasena: CLAVE, confirmacion: CLAVE });
    expect(r.cifrado).toBe(true);
    expect(r.nombreArchivo).toMatch(/\.cifrado\.json$/);
    expect(esCifrado(r.contenido)).toBe(true);
    const sobre = JSON.parse(r.contenido);
    expect(sobre).toMatchObject({ formato: FORMATO_CIFRADO, kdf: { algoritmo: 'PBKDF2', hash: 'SHA-256', iteraciones: 600000 }, cifrado: { algoritmo: 'AES-GCM' } });
    for (const t of ['Ficticia', 'Alumna', 'Matemáticas', 'Nota ficticia', CLAVE]) expect(r.contenido).not.toContain(t); // nada legible ni la contraseña

    const otro = nuevoEntorno();
    expect(otro.s.respaldos.requiereContrasena(r.contenido)).toBe(true);
    await expect(otro.s.respaldos.analizar(r.contenido)).rejects.toThrow('protegido con contraseña');
    await expect(otro.s.respaldos.analizar(r.contenido, 'contrasena-equivocada')).rejects.toThrow('Contraseña incorrecta o archivo dañado');
    const alterado = JSON.stringify({ ...sobre, datos: (sobre.datos[0] === 'A' ? 'B' : 'A') + sobre.datos.slice(1) });
    await expect(otro.s.respaldos.analizar(alterado, CLAVE)).rejects.toThrow('Contraseña incorrecta o archivo dañado');
    const manipulado = JSON.stringify({ ...sobre, kdf: { ...sobre.kdf, iteraciones: 1 } });
    await expect(otro.s.respaldos.analizar(manipulado, CLAVE)).rejects.toThrow('no admitidos');

    const a = await otro.s.respaldos.analizar(r.contenido, CLAVE);
    expect([a.errores, a.cifrado, a.puedeRestaurar]).toEqual([[], true, true]);
    const inf = await otro.s.respaldos.restaurar(r.contenido, [escuelaId], CLAVE);
    expect(inf.porTabla.find((x) => x.tabla === 'alumnos')).toEqual({ tabla: 'alumnos', registros: 2 });
    expect(await volcar(otro.db)).toEqual(await volcar(db));
  });

  it('cada respaldo usa sal e IV distintos', async () => {
    const x = JSON.parse(await cifrar('hola', CLAVE, '2026-11-02T00:00:00Z', 100_000));
    const y = JSON.parse(await cifrar('hola', CLAVE, '2026-11-02T00:00:00Z', 100_000));
    expect(x.kdf.sal).not.toBe(y.kdf.sal);
    expect(x.cifrado.iv).not.toBe(y.cifrado.iv);
    expect(await descifrar(JSON.stringify(x), CLAVE)).toBe('hola');
  });
});

describe('6–9. Restauración, archivos corruptos, versiones y conflictos', () => {
  it('7. archivo corrupto: ilegible, truncado, con registros faltantes o referencias rotas', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    const otro = nuevoEntorno();
    expect((await otro.s.respaldos.analizar(contenido.slice(0, contenido.length / 2))).errores[0]).toContain('no se pudo leer');
    const j = JSON.parse(contenido);
    const sinAlumno = { ...j, huella: null, datos: { ...j.datos, alumnos: j.datos.alumnos.slice(1) } };
    expect((await otro.s.respaldos.analizar(JSON.stringify(sinAlumno))).errores[0]).toContain('incompleto');
    const roto = { ...j, huella: null, conteos: undefined, datos: { ...j.datos, alumnos: j.datos.alumnos.slice(1) } };
    expect((await otro.s.respaldos.analizar(JSON.stringify(roto))).errores.join(' ')).toContain('no están en el respaldo');
    expect(await otro.db.alumnos.count()).toBe(0);
  });

  it('8. versión incompatible: esquema o formato más nuevo se rechaza', async () => {
    const j = JSON.parse((await s.respaldos.exportar([escuelaId])).contenido);
    const otro = nuevoEntorno();
    expect((await otro.s.respaldos.analizar(JSON.stringify({ ...j, esquema: VERSION_ESQUEMA + 1 }))).errores[0]).toContain('versión más nueva');
    expect((await otro.s.respaldos.analizar(JSON.stringify({ ...j, versionFormato: 3 }))).errores[0]).toContain('Formato de respaldo no compatible');
    await expect(otro.s.respaldos.restaurar(JSON.stringify({ ...j, esquema: VERSION_ESQUEMA + 1 }), [escuelaId])).rejects.toThrow('No se restauró nada');
  });

  it('9. conflictos: cambios posteriores al respaldo se advierten; misma CCT se bloquea; nada se borra sin confirmar', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    await new Promise((r) => setTimeout(r, 5));
    await s.alumnos.crear(A.id, { nombre: 'Carla', primerApellido: 'Posterior' });
    const a = await s.respaldos.analizar(contenido);
    expect(a.escuelas[0]).toMatchObject({ accion: 'reemplazar', ciclos: ['2026-2027'] });
    expect(a.escuelas[0]!.cambiosPosteriores).toBeGreaterThanOrEqual(2); // alumno + inscripción (+ movimiento)
    expect(await db.alumnos.count()).toBe(3); // analizar no escribe
    // Otra escuela con la misma CCT en otro dispositivo: bloqueado (no se mezclan)
    const otro = nuevoEntorno();
    await otro.s.asistente.crearEscuelaCompleta(ENTRADA);
    const b = await otro.s.respaldos.analizar(contenido);
    expect(b.escuelas[0]).toMatchObject({ accion: 'bloqueado' });
    await expect(otro.s.respaldos.restaurar(contenido, [escuelaId])).rejects.toThrow('misma CCT');
  });
});

describe('Recuperación de interrupciones', () => {
  it('una importación interrumpida a mitad no deja nada a medias', async () => {
    const antes = await volcar(db);
    const original = db.inscripciones.add.bind(db.inscripciones);
    let n = 0;
    db.inscripciones.add = ((x: never) => (++n === 2 ? Promise.reject(new Error('corte simulado')) : original(x))) as never;
    await expect(s.importacionDatos.aplicar(cicloId, 'alumnos', [['Ficticia', 'Carla', '1', 'A'], ['Ficticio', 'Dani', '1', 'A']], ['primerApellido', 'nombre', 'grado', 'grupo'], {}, { archivo: 'x.csv', hoja: null, huella: null })).rejects.toBeTruthy();
    db.inscripciones.add = original;
    expect(await volcar(db)).toEqual(antes);
    // Al repetir sin falla se importa completo
    await s.importacionDatos.aplicar(cicloId, 'alumnos', [['Ficticia', 'Carla', '1', 'A'], ['Ficticio', 'Dani', '1', 'A']], ['primerApellido', 'nombre', 'grado', 'grupo'], {}, { archivo: 'x.csv', hoja: null, huella: null });
    expect(await db.alumnos.count()).toBe(4);
  });
});

describe('4 y 10–11. Persistencia y actualización', () => {
  it('4. los registros de asistencia, salidas e incidencias persisten al reabrir', async () => {
    const antes = await volcar(db);
    db.close();
    const db2 = new BaseDatosEscolar(nombreBd);
    crearServicios(db2);
    expect(await volcar(db2)).toEqual(antes);
  });

  it('11. abrir la base con la versión actual no altera datos existentes (actualización sin pérdida)', async () => {
    const antes = await volcar(db);
    db.close();
    const nueva = new BaseDatosEscolar(nombreBd); // misma versión: la «actualización» de recursos no toca IndexedDB
    await nueva.open();
    expect(nueva.verno).toBe(VERSION_ESQUEMA);
    expect(await volcar(nueva)).toEqual(antes);
  });
});
