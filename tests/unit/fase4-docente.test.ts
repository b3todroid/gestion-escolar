import { beforeEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import { actividadEn } from '../../src/domain/actividadActual';
import { estadoLista } from '../../src/services/asistencia';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { AlumnoInscrito, Grupo, Periodo, Personal, Sesion } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Fase 4 — módulo docente. Escuela, docentes y alumnos ficticios. 2026-11-02 es lunes.
const LUNES = '2026-11-02';
const en = (hora: string, fecha = LUNES) => new Date(`${fecha}T${hora}:00`); // hora local
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 400', cct: '32ZZZ0400A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
// Periodos: 07:00 07:50 08:40 | receso 09:30–10:00 | 10:00 10:50 11:40 (fin 12:30)

let s: Servicios; let db: BaseDatosEscolar; let nombreBd: string; let escuelaId: string; let cicloId: string;
let A: Grupo; let B: Grupo; let uno: Personal; let dos: Personal; let p: Periodo[];
let claseA: Sesion; let claseB: Sesion; let alumnos: AlumnoInscrito[];

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  escuelaId = r.escuela.id; cicloId = r.ciclo.id;
  const gs = await s.grados.listarGrupos(cicloId);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
  uno = await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticio', segundoApellido: 'Uno', funciones: ['docente'] });
  dos = await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticia', segundoApellido: 'Dos', funciones: ['docente'] });
  const [mat, esp] = await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol');
  const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat!.id, personalId: uno.id, horasSemana: 5 });
  const aB = await s.asignaciones.crear(cicloId, { grupoId: B.id, materiaId: esp!.id, personalId: uno.id, horasSemana: 5 });
  p = (await s.asignaciones.horarioDelDia(A.id, 1)).map((c) => c.periodo);
  claseA = await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id }); // lunes 07:00–07:50
  claseB = await s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[3]!.id }); // lunes 10:00–10:50
  await s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 1, periodoId: p[1]!.id, horaInicio: '07:50', horaFin: '08:40', descripcion: 'Guardia en patio', confirmada: true });
  await s.alumnos.crearVarios(A.id, 'Alumna Ficticia, Ana\nAlumno Ficticio, Beto\nAlumna Prueba, Carla');
  alumnos = await s.alumnos.listarGrupo(A.id);
});
const id = (nombre: string) => alumnos.find((a) => a.nombre === nombre)!.id;

describe('1–4. Actividad actual y siguiente', () => {
  it('1–2. clase actual con escuela, turno, grupo y materia; siguiente actividad y siguiente clase', async () => {
    const x = await s.panel.panel(uno, en('07:15'));
    expect(x).toMatchObject({ estado: 'clase', escuela: 'Escuela Secundaria Ficticia 400', turno: 'Matutino' });
    expect(x.actual).toMatchObject({ grupo: '1° A', materia: 'Matemáticas', sesionId: claseA.id, listaGuardada: false });
    expect(x.siguiente).toMatchObject({ segmento: { tipo: 'servicio', horaInicio: '07:50' }, diaNombre: null });
    expect(x.siguienteClase).toMatchObject({ grupo: '1° B', materia: 'Español', segmento: { horaInicio: '10:00' } });
  });

  it('respeta los límites exactos entre periodos', async () => {
    expect((await s.panel.panel(uno, en('07:49'))).estado).toBe('clase');
    const a750 = await s.panel.panel(uno, en('07:50'));
    expect(a750.estado).toBe('servicio'); // a las 07:50 ya terminó la clase
    expect(a750.actual!.segmento.titulo).toBe('Guardia en patio');
  });

  it('3. receso, hueco sin actividad registrada y fuera de jornada', async () => {
    expect((await s.panel.panel(uno, en('09:45'))).estado).toBe('receso');
    const hueco = await s.panel.panel(uno, en('08:50'));
    expect(hueco.estado).toBe('sin_actividad'); // un hueco NO es tiempo libre ni servicio
    expect((await s.panel.panel(uno, en('06:30'))).estado).toBe('fuera_de_jornada');
    expect((await s.panel.panel(uno, en('14:00'))).estado).toBe('fuera_de_jornada');
    const sabado = await s.panel.panel(uno, en('09:00', '2026-11-07'));
    expect(sabado.estado).toBe('fuera_de_jornada');
    expect(sabado.siguienteClase).toMatchObject({ diaNombre: 'Lunes', grupo: '1° A' });
  });

  it('4. hora SE confirmada como actividad actual; el docente de otra escuela no ve nada de ésta', async () => {
    const se = await s.panel.panel(uno, en('08:10'));
    expect(se.estado).toBe('servicio');
    expect(se.actual!.segmento).toMatchObject({ confirmada: true, estado: 'confirmado' });
    expect(actividadEn([], 600).estado).toBe('fuera_de_jornada');
  });
});

describe('5–8. Pase de lista', () => {
  it('5–7. abrir no guarda; guardar registra fecha y hora; R cuenta como presente con retardo', async () => {
    const l = await s.asistencia.abrirLista(claseA.id, LUNES);
    expect(l.estado).toBe('no_iniciada');
    expect(await db.pases.count()).toBe(0);
    expect(estadoLista(null, true)).toBe('en_captura');
    const r = await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F', [id('Carla')]: 'R' }, { [id('Carla')]: '07:12' }, LUNES, uno.id);
    expect(r).toMatchObject({ P: 1, F: 1, R: 1, corregidos: 0 });
    expect(r.pase.guardadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const l2 = await s.asistencia.abrirLista(claseA.id, LUNES);
    expect(l2.estado).toBe('guardada');
    const resumen = await s.asistencia.resumenGrupo(A.id);
    expect(resumen.find((x) => x.alumno.nombre === 'Carla')).toMatchObject({ faltas: 0, retardos: 1 }); // R no es falta
    expect(await db.pases.count()).toBe(1);
  });

  it('8. correcciones: un solo pase por clase y fecha, historial de cambios y estado MODIFICADA', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F' }, {}, LUNES, uno.id);
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F' }, {}, LUNES, uno.id)).rejects.toThrow('No hay cambios');
    const r = await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'R' }, { [id('Beto')]: '07:20' }, LUNES, uno.id);
    expect(r.corregidos).toBe(1);
    expect(await db.pases.count()).toBe(1);
    const l = await s.asistencia.abrirLista(claseA.id, LUNES);
    expect(l.estado).toBe('modificada');
    expect(l.pase!.correcciones).toBe(1);
    expect(l.cambios).toMatchObject([{ alumnoId: id('Beto'), marcaAnterior: 'F', marcaNueva: 'R', llegadaNueva: '07:20', personalId: uno.id }]);
    // No toca otros grupos: la lista de 1° B sigue sin iniciar
    expect((await s.asistencia.abrirLista(claseB.id, LUNES)).estado).toBe('no_iniciada');
  });
});

describe('9–11. Salidas y contradicciones', () => {
  it('9–10. salida con docente y periodo; se muestra fuera del aula; reincorporación', async () => {
    const sal = await s.asistencia.registrarSalida(claseA.id, LUNES, id('Ana'), '07:20', LUNES, uno.id);
    expect(sal).toMatchObject({ alumnoId: id('Ana'), grupoId: A.id, personalId: uno.id, periodoId: p[0]!.id, fecha: LUNES, salida: '07:20', regreso: null });
    expect((await s.asistencia.fueraDelAula(A.id)).map((x) => x.alumnoId)).toEqual([id('Ana')]);
    await expect(s.asistencia.reincorporar(sal.id, '07:10')).rejects.toThrow('no puede ser antes');
    await s.asistencia.reincorporar(sal.id, '07:26');
    expect(await s.asistencia.fueraDelAula(A.id)).toEqual([]);
    await expect(s.asistencia.reincorporar(sal.id, '07:30')).rejects.toThrow('ya se registró');
  });

  it('11. falta ⇄ salida: no se permite la contradicción; la resolución explícita sí', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F' }, {}, LUNES);
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, id('Beto'), '07:20', LUNES)).rejects.toThrow('tiene falta');
    const sal = await s.asistencia.registrarSalida(claseA.id, LUNES, id('Ana'), '07:20', LUNES);
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F', [id('Ana')]: 'F' }, {}, LUNES)).rejects.toThrow('salió del aula');
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, id('Ana'), '07:25', LUNES)).rejects.toThrow('ya está fuera');
    // Resolución: «la salida se registró por error» → se anula y entonces sí puede tener falta
    await s.asistencia.anularSalida(sal.id);
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F', [id('Ana')]: 'F' }, {}, LUNES);
    expect((await s.asistencia.abrirLista(claseA.id, LUNES)).marcas.get(id('Ana'))!.marca).toBe('F');
  });
});

describe('Incidencias', () => {
  it('registra alumno, tipo, descripción, fecha, hora, docente, grupo y estado; datos listos para un documento', async () => {
    const r = await s.asistencia.crearReporte(id('Ana'), { tipo: 'conducta', texto: 'Interrumpió la clase varias veces.' }, { personalId: uno.id, sesionId: claseA.id, fecha: LUNES, hora: '07:30' });
    expect(r).toMatchObject({ grupoId: A.id, personalId: uno.id, fecha: LUNES, hora: '07:30', estado: 'abierta' });
    await s.asistencia.cambiarEstadoReporte(r.id, 'atendida');
    const doc = await s.asistencia.documentoIncidencias(A.id, '2026-11-01', '2026-11-30');
    expect(doc).toMatchObject({ escuela: 'Escuela Secundaria Ficticia 400', grupo: '1° A', filas: [{ alumno: 'Alumna Ficticia, Ana', hora: '07:30', docente: 'Docente Ficticio', estado: 'atendida', tipo: 'conducta' }] });
    expect((await s.asistencia.documentoIncidencias(A.id, '2026-12-01', '2026-12-31')).filas).toEqual([]);
  });
});

describe('12–15. Persistencia, separación e integridad', () => {
  it('12. conserva lista, correcciones y salida activa al reabrir', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F' }, {}, LUNES, uno.id);
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'R' }, {}, LUNES, uno.id);
    await s.asistencia.registrarSalida(claseA.id, LUNES, id('Ana'), '07:20', LUNES, uno.id);
    db.close();
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    const l = await s2.asistencia.abrirLista(claseA.id, LUNES);
    expect([l.estado, l.cambios.length, l.salidas.filter((x) => !x.regreso).length]).toEqual(['modificada', 1, 1]);
  });

  it('14. separación entre escuelas: el panel y las listas sólo usan datos de la escuela del docente', async () => {
    const otra = await s.asistente.crearEscuelaCompleta({ ...ENTRADA, escuela: { ...ENTRADA.escuela, nombre: 'Escuela Ficticia 401', cct: '32ZZZ0401A' } });
    const ajeno = await s.personal.crear(otra.escuela.id, { nombre: 'Docente', primerApellido: 'Ajeno', funciones: ['docente'] });
    const x = await s.panel.panel(ajeno, en('07:15'));
    expect([x.escuela, x.estado, x.grupos]).toEqual(['Escuela Ficticia 401', 'fuera_de_jornada', []]);
    const g = (await s.grados.listarGrupos(otra.ciclo.id))[0]!;
    const [ajenoAl] = await s.alumnos.crearVarios(g.id, 'Alumno Ajeno, Eva');
    await expect(s.asistencia.registrarSalida(claseA.id, LUNES, ajenoAl!.id, '07:20', LUNES)).rejects.toThrow('no está inscrito en este grupo');
    await expect(s.asistencia.guardarLista(claseA.id, LUNES, { [ajenoAl!.id]: 'F' }, {}, LUNES)).rejects.toThrow('no está activo en este grupo');
  });

  it('15. la migración v7 → v8 conserva pases, salidas y reportes y completa campos sin inventar', async () => {
    const nombre = `mig8-${Date.now()}`;
    const v = new Dexie(nombre);
    v.version(1).stores({ escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId', jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId', grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId' });
    v.version(2).stores({ personal: 'id, escuelaId', materias: 'id, cicloEscolarId, escuelaId', asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId', sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId' });
    v.version(3).stores({ actividades: 'id, cicloEscolarId, personalId, grupoId', excepciones: 'id, cicloEscolarId, personalId', confirmaciones: 'id, &grupoId, cicloEscolarId', bitacora: 'id, cicloEscolarId, entidadId' });
    v.version(4).stores({ alumnos: 'id, grupoId, cicloEscolarId, escuelaId', pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId', asistencias: 'id, paseId, alumnoId, grupoId', salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId', reportes: 'id, alumnoId, grupoId, cicloEscolarId', ajustes: 'id' });
    v.version(5).stores({});
    v.version(6).stores({ alumnos: 'id, escuelaId', inscripciones: 'id, alumnoId, cicloEscolarId, grupoId, escuelaId, &[alumnoId+cicloEscolarId]', movimientos: 'id, alumnoId, cicloEscolarId', adscripciones: 'id, personalId, cicloEscolarId, &[personalId+cicloEscolarId]', importaciones: 'id, escuelaId, cicloEscolarId' });
    v.version(7).stores({});
    const m = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, escuelaId: 'e1', cicloEscolarId: 'c1' };
    await v.table('sesiones').add({ ...m, id: 's1', asignacionId: 'a1', grupoId: 'g1', personalId: 'p1', dia: 1, periodoId: 'pe1', origen: null });
    await v.table('pases').add({ ...m, id: 'pa1', grupoId: 'g1', sesionId: 's1', asignacionId: 'a1', personalId: 'p1', fecha: LUNES, horaInicio: '07:00', horaFin: '07:50', guardadoEn: '2026-11-02T13:10:00Z' });
    await v.table('salidas').add({ ...m, id: 'sa1', grupoId: 'g1', alumnoId: 'al1', sesionId: 's1', fecha: LUNES, salida: '07:20', regreso: null });
    await v.table('reportes').add({ ...m, id: 'r1', grupoId: 'g1', alumnoId: 'al1', personalId: 'p1', sesionId: null, fecha: LUNES, tipo: 'otro', texto: 'Nota ficticia' });
    v.close();
    const v8 = new BaseDatosEscolar(nombre);
    await v8.open();
    expect(v8.verno).toBe(VERSION_ESQUEMA);
    expect(await v8.pases.get('pa1')).toMatchObject({ correcciones: 0, guardadoEn: '2026-11-02T13:10:00Z' });
    expect(await v8.salidas.get('sa1')).toMatchObject({ personalId: 'p1', periodoId: 'pe1', regreso: null });
    expect(await v8.reportes.get('r1')).toMatchObject({ hora: null, estado: 'abierta', texto: 'Nota ficticia' });
    expect(await v8.cambiosAsistencia.count()).toBe(0);
    v8.close();
  });

  it('15b. un respaldo con historial de correcciones se restaura completo', async () => {
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'F' }, {}, LUNES, uno.id);
    await s.asistencia.guardarLista(claseA.id, LUNES, { [id('Beto')]: 'R' }, {}, LUNES, uno.id);
    const contenido = (await s.respaldos.exportar([escuelaId])).contenido;
    const otro = nuevoEntorno();
    expect((await otro.s.respaldos.analizar(contenido)).errores).toEqual([]);
    await otro.s.respaldos.restaurar(contenido, [escuelaId]);
    expect(await otro.db.cambiosAsistencia.count()).toBe(1);
    expect((await otro.s.asistencia.abrirLista(claseA.id, LUNES)).estado).toBe('modificada');
    expect(await otro.db.periodos.count()).toBe(await db.periodos.count());
    void dos;
  });
});
