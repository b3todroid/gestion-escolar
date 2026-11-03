import { beforeEach, describe, expect, it } from 'vitest';
import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Alumno, Grupo, Periodo, Personal, Sesion } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Escuela, docentes y alumnos ficticios. 2026-11-02 es lunes.
const LUNES = '2026-11-02';
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 100', cct: '32ZZZ0100A', nivel: 'secundaria', entidad: '32', localidad: 'Ciudad Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};

let s: Servicios; let nombreBd: string; let db: BaseDatosEscolar;
let A: Grupo; let B: Grupo; let uno: Personal; let p: Periodo[];
let claseA: Sesion; let claseB: Sesion; let alumnos: Alumno[];

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; nombreBd = e.nombre; db = e.db;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  const gs = await s.grados.listarGrupos(r.ciclo.id);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
  uno = await s.personal.crear(r.escuela.id, { nombre: 'Docente', primerApellido: 'Ficticio', segundoApellido: 'Uno', numeroEmpleado: 'E-001', funciones: ['docente'] });
  const [mat] = await s.materias.crearVarias(r.ciclo.id, 'Matemáticas');
  const aA = await s.asignaciones.crear(r.ciclo.id, { grupoId: A.id, materiaId: mat!.id, personalId: uno.id, horasSemana: 5 });
  const aB = await s.asignaciones.crear(r.ciclo.id, { grupoId: B.id, materiaId: mat!.id, personalId: uno.id, horasSemana: 5 });
  p = (await s.asignaciones.horarioDelDia(A.id, 1)).map((c) => c.periodo);
  claseA = await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id }); // lunes 07:00
  claseB = await s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[2]!.id }); // lunes 08:40
  alumnos = await s.alumnos.crearVarios(A.id, 'Alumna Ficticia, Ana\nAlumno Ficticio, Beto\nAlumna Prueba, Carla\nAlumno Prueba, Dani');
});

const ids = () => Object.fromEntries((alumnos).map((a) => [a.nombre, a.id])) as Record<string, string>;

describe('alumnos', () => {
  it('captura por lote «Apellidos, Nombre(s)», ordena por apellido y evita duplicados', async () => {
    const lista = await s.alumnos.listarGrupo(A.id);
    // Orden por apellidos: «Alumna Ficticia», «Alumna Prueba», «Alumno Ficticio Dos», «Alumno Prueba Tres»
    expect(lista.map((a) => a.nombre)).toEqual(['Ana', 'Carla', 'Beto', 'Dani']);
    expect(lista[2]).toMatchObject({ primerApellido: 'Alumno', segundoApellido: 'Ficticio' });
    // Ambiguo (tres palabras antes de la coma): no se adivina
    await expect(s.alumnos.crearVarios(A.id, 'De la Cruz, Eva')).rejects.toThrow('captúralo por separado');
    await expect(s.alumnos.crearVarios(A.id, 'Sin coma Nombre')).rejects.toThrow('Apellidos, Nombre');
    await expect(s.alumnos.crearVarios(A.id, 'Alumna Prueba, carla')).rejects.toMatchObject({ codigo: 'DUPLICADO' });
  });
});

describe('pase de lista', () => {
  it('abrir la lista no guarda nada', async () => {
    const l = await s.asistencia.abrirLista(claseA.id, LUNES);
    expect(l.pase).toBeNull();
    expect(l.alumnos).toHaveLength(4);
    expect(await db.pases.count()).toBe(0);
    expect(await db.asistencias.count()).toBe(0);
  });

  it('sólo se marcan F y R; el resto queda presente. Corregir no duplica', async () => {
    const r = await s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Beto']!]: 'F', [ids()['Carla']!]: 'R' }, { [ids()['Carla']!]: '07:12' }, LUNES);
    expect(r).toMatchObject({ P: 2, F: 1, R: 1 });
    const l = await s.asistencia.abrirLista(claseA.id, LUNES);
    expect(l.marcas.get(ids()['Ana']!)?.marca).toBe('P');
    expect(l.marcas.get(ids()['Carla']!)).toMatchObject({ marca: 'R', horaLlegada: '07:12' });
    // Corrección: Beto llegó tarde
    await s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Beto']!]: 'R', [ids()['Carla']!]: 'R' }, { [ids()['Beto']!]: '07:20', [ids()['Carla']!]: '07:12' }, LUNES);
    expect(await db.pases.count()).toBe(1);
    expect(await db.asistencias.count()).toBe(4);
    expect((await s.asistencia.abrirLista(claseA.id, LUNES)).marcas.get(ids()['Beto']!)?.marca).toBe('R');
  });

  it('valida la fecha: día de la clase, no futura y dentro del ciclo; y la hora de llegada', async () => {
    await expect(s.asistencia.guardarLista(claseA.id, '2026-11-03', {}, {}, '2026-11-03')).rejects.toThrow('los lunes');
    await expect(s.asistencia.guardarLista(claseA.id, '2026-11-09', {}, {}, LUNES)).rejects.toThrow('futura');
    await expect(s.asistencia.guardarLista(claseA.id, '2027-08-02', {}, {}, '2027-08-02')).rejects.toThrow('fuera del ciclo');
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Ana']!]: 'R' }, { [ids()['Ana']!]: '06:50' }, LUNES)).rejects.toThrow('antes del inicio');
  });
});

describe('estados contradictorios', () => {
  it('un alumno con falta no puede salir al baño', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Beto']!]: 'F' }, {}, LUNES);
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Beto']!, '07:20', LUNES)).rejects.toThrow('tiene falta');
  });

  it('a quien salió en la clase no se le puede poner falta (aunque ya haya regresado)', async () => {
    const sal = await s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Ana']!, '07:10', LUNES);
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Ana']!]: 'F' }, {}, LUNES)).rejects.toThrow('no puede tener falta');
    await s.asistencia.reincorporar(sal.id, '07:15');
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Ana']!]: 'F' }, {}, LUNES)).rejects.toMatchObject({ codigo: 'ESTADO_NO_PERMITIDO' });
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, {}, {}, LUNES)).resolves.toMatchObject({ P: 4 });
  });

  it('no hay dos salidas abiertas; la reincorporación no es antes de salir ni se repite', async () => {
    const sal = await s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Ana']!, '07:10', LUNES);
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Ana']!, '07:12', LUNES)).rejects.toThrow('ya está fuera del aula desde las 07:10');
    await expect(s.asistencia.reincorporar(sal.id, '07:05')).rejects.toThrow('antes de la salida');
    await s.asistencia.reincorporar(sal.id, '07:16');
    await expect(s.asistencia.reincorporar(sal.id, '07:20')).rejects.toThrow('ya se registró a las 07:16');
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Ana']!, '07:30', LUNES)).resolves.toBeDefined();
  });

  it('no se da de baja a un alumno fuera del aula ni se elimina con historial', async () => {
    await s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Dani']!, '07:10', LUNES);
    await expect(s.alumnos.cambiarActivo(ids()['Dani']!, false)).rejects.toThrow('fuera del aula');
    await expect(s.alumnos.eliminar(ids()['Dani']!)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
  });
});

describe('reportes, resumen y persistencia', () => {
  it('reporte breve (≤ 280), resumen de faltas/retardos y persistencia al reabrir', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [ids()['Beto']!]: 'F', [ids()['Carla']!]: 'R' }, {}, LUNES);
    await s.asistencia.registrarSalida(claseA.id, LUNES, ids()['Ana']!, '07:30', LUNES);
    await expect(s.asistencia.crearReporte(ids()['Ana']!, { tipo: 'conducta', texto: 'x'.repeat(281) }, { personalId: uno.id, sesionId: claseA.id, fecha: LUNES })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await s.asistencia.crearReporte(ids()['Ana']!, { tipo: 'reconocimiento', texto: 'Ayudó a un compañero con el ejercicio.' }, { personalId: uno.id, sesionId: claseA.id, fecha: LUNES });
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    const resumen = await s2.asistencia.resumenGrupo(A.id);
    expect(resumen.map((r) => [r.alumno.nombre, r.faltas, r.retardos, r.salidas, r.reportes])).toEqual([
      ['Ana', 0, 0, 1, 1], ['Carla', 0, 1, 0, 0], ['Beto', 1, 0, 0, 0], ['Dani', 0, 0, 0, 0],
    ]);
    const h = await s2.asistencia.historialAlumno(ids()['Beto']!);
    expect(h.asistencias[0]).toMatchObject({ fecha: LUNES, marca: 'F', materia: 'Matemáticas' });
    expect((await s2.asistencia.fueraDelAula(A.id)).map((x) => x.alumnoId)).toEqual([ids()['Ana']]);
  });

  it('no se quita una materia con listas registradas', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, {}, {}, LUNES);
    const [a] = await s.asignaciones.listarPorGrupo(A.id);
    await expect(s.asignaciones.eliminar(a!.id)).rejects.toThrow(/lista\(s\) de asistencia/);
  });
});

describe('panel del docente', () => {
  it('actividad actual, siguiente y listas pendientes', async () => {
    await s.panel.fijarPerfil(uno.id);
    const yo = (await s.panel.perfil())!;
    let pnl = await s.panel.panel(yo, new Date(2026, 10, 2, 7, 15));
    expect(pnl.actual).toMatchObject({ grupo: '1° A', materia: 'Matemáticas', sesionId: claseA.id, listaGuardada: false });
    expect(pnl.siguiente).toMatchObject({ grupo: '1° B', diaNombre: null, sesionId: claseB.id });
    expect(pnl.siguiente!.segmento.horaInicio).toBe('08:40');
    // 07:55: hueco; la lista de 1° A queda pendiente
    pnl = await s.panel.panel(yo, new Date(2026, 10, 2, 7, 55));
    expect(pnl.actual?.segmento.tipo).toBe('sin_actividad');
    expect(pnl.pendientes.map((x) => x.grupo)).toEqual(['1° A']);
    await s.asistencia.guardarLista(claseA.id, LUNES, {}, {}, LUNES);
    pnl = await s.panel.panel(yo, new Date(2026, 10, 2, 7, 55));
    expect(pnl.pendientes).toHaveLength(0);
    // Después de la última clase: siguiente es el próximo lunes
    pnl = await s.panel.panel(yo, new Date(2026, 10, 2, 12, 0));
    expect(pnl.siguiente).toMatchObject({ diaNombre: 'Lunes', grupo: '1° A' });
    expect(pnl.grupos.map((g) => g.grupo)).toEqual(['1° A', '1° B']);
  });

  it('el perfil se borra si la persona se da de baja', async () => {
    await s.panel.fijarPerfil(uno.id);
    expect(await s.panel.perfil()).not.toBeNull();
    await s.panel.fijarPerfil(null);
    expect(await s.panel.perfil()).toBeNull();
  });
});
