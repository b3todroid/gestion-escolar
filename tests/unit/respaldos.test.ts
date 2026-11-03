import { beforeEach, describe, expect, it } from 'vitest';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import type { Servicios } from '../../src/services';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import { TABLAS_RESPALDO } from '../../src/validators/respaldo';
import { nuevoEntorno } from './ayudantes';

// Datos ficticios. 2026-11-02 es lunes.
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 120', cct: '32ZZZ0120A', nivel: 'secundaria', entidad: '32', localidad: 'Ciudad Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 1, capacidad: null },
};

let s: Servicios; let db: BaseDatosEscolar; let escuelaId: string;

/** Escuela con datos de todas las fases: horario, servicio, alumnos, lista, salida y reporte. */
async function poblar(sv: Servicios, entrada = ENTRADA) {
  const r = await sv.asistente.crearEscuelaCompleta(entrada);
  const [g] = await sv.grados.listarGrupos(r.ciclo.id);
  const d = await sv.personal.crear(r.escuela.id, { nombre: 'Docente', primerApellido: 'Ficticio', numeroEmpleado: 'E-001', funciones: ['docente'] });
  const [m] = await sv.materias.crearVarias(r.ciclo.id, 'Matemáticas');
  const a = await sv.asignaciones.crear(r.ciclo.id, { grupoId: g!.id, materiaId: m!.id, personalId: d.id, horasSemana: 5 });
  const [c] = await sv.asignaciones.horarioDelDia(g!.id, 1);
  const ses = await sv.asignaciones.programar({ grupoId: g!.id, asignacionId: a.id, dia: 1, periodoId: c!.periodo.id });
  await sv.actividades.crearDocente(r.ciclo.id, d.id, { tipo: 'servicio', dia: 2, horaInicio: '07:00', horaFin: '07:50', descripcion: 'Guardia en patio' });
  await sv.confirmacion.confirmar(g!.id);
  const [al1, al2] = await sv.alumnos.crearVarios(g!.id, 'Alumna Ficticia, Ana\nAlumno Ficticio, Beto');
  await sv.asistencia.registrarSalida(ses.id, '2026-11-02', al1!.id, '07:10', '2026-11-02');
  await sv.asistencia.guardarLista(ses.id, '2026-11-02', { [al2!.id]: 'F' }, {}, '2026-11-02');
  await sv.asistencia.crearReporte(al1!.id, { tipo: 'reconocimiento', texto: 'Buen trabajo en equipo.' }, { personalId: d.id, sesionId: ses.id, fecha: '2026-11-02' });
  return { r, grupo: g!, alumnos: [al1!, al2!] };
}

async function volcar(base: BaseDatosEscolar) {
  const r: Record<string, unknown[]> = {};
  for (const t of base.tables) if (t.name !== 'ajustes') r[t.name] = (await t.toArray()).sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));
  return r;
}

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db;
  escuelaId = (await poblar(s)).r.escuela.id;
});

describe('respaldo y restauración', () => {
  it('la versión de esquema declarada coincide con la base de datos', async () => {
    await db.open();
    expect(db.verno).toBe(VERSION_ESQUEMA);
  });

  it('el respaldo incluye todas las tablas con datos de la escuela (y no las preferencias del dispositivo)', async () => {
    await s.panel.fijarPerfil((await s.personal.listar(escuelaId))[0]!.id);
    const { contenido, nombreArchivo } = await s.respaldos.exportar([escuelaId]);
    expect(nombreArchivo).toMatch(/^respaldo-gestion-escolar-32ZZZ0120A-\d{4}-\d{2}-\d{2}\.json$/);
    const j = JSON.parse(contenido);
    expect(j.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(j.datos)).toEqual(TABLAS_RESPALDO);
    for (const t of ['escuelas', 'periodos', 'sesiones', 'actividades', 'confirmaciones', 'alumnos', 'pases', 'asistencias', 'salidas', 'reportes', 'bitacora']) expect(j.datos[t].length, t).toBeGreaterThan(0);
    expect(j.datos.ajustes).toBeUndefined();
  });

  it('restaura en otro dispositivo idéntico a lo original', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    const otro = nuevoEntorno();
    const a = await otro.s.respaldos.analizar(contenido);
    expect(a.errores).toEqual([]);
    expect(a.escuelas[0]).toMatchObject({ accion: 'agregar' });
    expect(await otro.db.escuelas.count()).toBe(0); // analizar no escribe
    expect(await otro.s.respaldos.restaurar(contenido, [escuelaId])).toMatchObject({ agregadas: 1 });
    expect(await volcar(otro.db)).toEqual(await volcar(db));
    // Y la app funciona con los datos restaurados
    const g = (await otro.s.grados.listarGrupos((await otro.s.ciclos.listar(escuelaId))[0]!.id))[0]!;
    expect((await otro.s.asistencia.resumenGrupo(g.id)).map((x) => [x.alumno.nombre, x.faltas, x.salidas, x.reportes])).toEqual([['Ana', 0, 1, 1], ['Beto', 1, 0, 0]]);
  });

  it('reemplazar devuelve los datos al estado del respaldo, todo o nada', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    const original = await volcar(db);
    const g = (await s.grados.listarGrupos((await s.ciclos.listar(escuelaId))[0]!.id))[0]!;
    await s.alumnos.crear(g.id, { nombre: 'Carla', primerApellido: 'Posterior' });
    const a = await s.respaldos.analizar(contenido);
    expect(a.escuelas[0]).toMatchObject({ accion: 'reemplazar' });
    expect(a.escuelas[0]!.conteos.find((c) => c.tabla === 'alumnos')).toEqual({ tabla: 'alumnos', actual: 3, respaldo: 2 });
    // Falla a mitad de la inserción: no se pierde nada
    const original2 = db.alumnos.bulkAdd.bind(db.alumnos);
    db.alumnos.bulkAdd = (() => Promise.reject(new Error('fallo simulado'))) as never;
    await expect(s.respaldos.restaurar(contenido, [escuelaId])).rejects.toMatchObject({ codigo: 'ALMACENAMIENTO' });
    db.alumnos.bulkAdd = original2;
    expect(await db.alumnos.count()).toBe(3);
    await s.respaldos.restaurar(contenido, [escuelaId]);
    expect(await volcar(db)).toEqual(original);
  });

  it('rechaza archivos alterados, inválidos o de una versión más nueva, sin escribir nada', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    const otro = nuevoEntorno();
    const j = JSON.parse(contenido);
    const alterado = { ...j, datos: { ...j.datos, alumnos: j.datos.alumnos.map((x: { nombre: string }) => ({ ...x, nombre: 'Cambiado' })) } };
    expect((await otro.s.respaldos.analizar(JSON.stringify(alterado))).errores.join(' ')).toMatch(/modificado o está dañado/);
    const sinHuella = (datos: unknown) => JSON.stringify({ ...j, huella: null, datos });
    expect((await otro.s.respaldos.analizar(sinHuella({ ...j.datos, asistencias: j.datos.asistencias.map((x: object) => ({ ...x, marca: 'X' })) }))).errores.join(' ')).toMatch(/Marcas de asistencia, registro 1/);
    expect((await otro.s.respaldos.analizar(sinHuella({ ...j.datos, grupos: [] }))).errores.join(' ')).toMatch(/hacen referencia a grupos/);
    expect((await otro.s.respaldos.analizar(JSON.stringify({ ...j, esquema: VERSION_ESQUEMA + 1 }))).errores.join(' ')).toMatch(/versión más nueva/);
    expect((await otro.s.respaldos.analizar('no es json')).errores).toEqual(['El archivo no es un respaldo válido (no se pudo leer).']);
    expect((await otro.s.respaldos.analizar('{"formato":"otro"}')).errores.join(' ')).toMatch(/no es un respaldo de Gestión Escolar/);
    await expect(otro.s.respaldos.restaurar(JSON.stringify(alterado), [escuelaId])).rejects.toThrow('No se restauró nada');
    expect(await otro.db.alumnos.count()).toBe(0);
  });

  it('no mezcla escuelas: bloquea una escuela distinta con la misma CCT', async () => {
    const { contenido } = await s.respaldos.exportar([escuelaId]);
    const otro = nuevoEntorno();
    await otro.s.escuelas.crear({ nombre: 'Otra escuela ficticia', cct: '32ZZZ0120A', nivel: 'primaria' });
    const a = await otro.s.respaldos.analizar(contenido);
    expect(a.escuelas[0]).toMatchObject({ accion: 'bloqueado' });
    expect(a.puedeRestaurar).toBe(false);
    await expect(otro.s.respaldos.restaurar(contenido, [escuelaId])).rejects.toMatchObject({ codigo: 'ESTADO_NO_PERMITIDO' });
  });

  it('recordatorio: sin respaldo o con cambios de más de 7 días', async () => {
    const hoy = new Date('2026-11-03T12:00:00Z');
    expect(await s.respaldos.estado(escuelaId, hoy)).toMatchObject({ ultimo: null, recordar: true });
    await s.respaldos.registrarRespaldo([escuelaId]);
    expect((await s.respaldos.estado(escuelaId, new Date())).recordar).toBe(false);
  });
});
