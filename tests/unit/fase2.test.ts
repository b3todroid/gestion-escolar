import { beforeEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo, Personal } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Personas y escuelas ficticias.
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 50', cct: '32ZZZ0050A', nivel: 'secundaria', entidad: '32', localidad: 'Ciudad Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
const DOCENTE = { nombre: 'Persona', primerApellido: 'Ficticia', segundoApellido: 'Uno', numeroEmpleado: 'E-001', funciones: ['docente'] as const };

let s: Servicios;
let cicloId: string;
let escuelaId: string;
let grupoA: Grupo;
let grupoB: Grupo;
let docente: Personal;

beforeEach(async () => {
  s = nuevoEntorno().s;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  cicloId = r.ciclo.id;
  escuelaId = r.escuela.id;
  [grupoA, grupoB] = (await s.grados.listarGrupos(cicloId)).sort((a, b) => a.nombre.localeCompare(b.nombre)) as [Grupo, Grupo];
  docente = await s.personal.crear(escuelaId, { ...DOCENTE, funciones: [...DOCENTE.funciones] });
});

async function periodos(grupoId: string) {
  return (await s.asignaciones.horarioDelDia(grupoId, 1)).map((c) => c.periodo);
}

describe('migración del esquema', () => {
  it('abre una base de la versión 1 con datos y los conserva al pasar a la versión actual (6) y completa los campos nuevos', async () => {
    const nombre = `migracion-${Date.now()}`;
    const v1 = new Dexie(nombre);
    v1.version(1).stores({
      escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId',
      jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId',
      grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId',
    });
    const escuela = { id: '7c0b7a3e-1111-4111-8111-111111111111', creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, nombre: 'Escuela Ficticia v1', cct: null, nivel: 'primaria', localidad: null };
    await v1.table('escuelas').add(escuela);
    await v1.table('grupos').add({ id: '7c0b7a3e-2222-4222-8222-222222222222', creadoEn: escuela.creadoEn, actualizadoEn: escuela.creadoEn, version: 1, escuelaId: escuela.id, cicloEscolarId: 'c', gradoId: 'g', turnoId: 't', nombre: 'A', capacidad: null });
    v1.close();

    const v2 = new BaseDatosEscolar(nombre);
    await v2.open();
    expect(v2.verno).toBe(6);
    // La migración v5 conserva todo y completa los campos nuevos sin inventar datos.
    expect(await v2.escuelas.get(escuela.id)).toEqual({ ...escuela, nombreCorto: null, entidad: null, zonaEscolar: null, sector: null, domicilio: null, telefono: null, correo: null, logotipo: null });
    expect(await v2.personal.count()).toBe(0);
    expect(await v2.actividades.count()).toBe(0);
    expect((await v2.grupos.toArray())[0]).toMatchObject({ nombre: 'A', activo: true });
    v2.close();
  });
});

describe('personal', () => {
  it('se registra una vez por escuela y evita duplicados', async () => {
    await expect(s.personal.crear(escuelaId, { ...DOCENTE, nombre: 'Otra', funciones: ['docente'], numeroEmpleado: 'e-001' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    await s.personal.crear(escuelaId, { nombre: 'Sin', primerApellido: 'Numero', funciones: ['prefectura'] });
    await expect(s.personal.crear(escuelaId, { nombre: 'sin', primerApellido: 'NÚMERO', funciones: ['apoyo'] })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    expect((await s.personal.docentes(escuelaId)).map((p) => p.id)).toEqual([docente.id]);
  });

  it('exige al menos una función', async () => {
    await expect(s.personal.crear(escuelaId, { nombre: 'Persona', primerApellido: 'Dos', funciones: [] })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('no se da de baja ni pierde la función docente con clases vigentes; no se elimina si tuvo asignaciones', async () => {
    const [m] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: m!.id, personalId: docente.id, horasSemana: 5 });
    await expect(s.personal.cambiarActivo(docente.id, false)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    await expect(s.personal.actualizar(docente.id, { ...DOCENTE, funciones: ['directivo'] })).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    await expect(s.personal.eliminar(docente.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
  });
});

describe('materias', () => {
  it('alta por lote: todo o nada, sin repetidas', async () => {
    const creadas = await s.materias.crearVarias(cicloId, 'Español\n\n  Matemáticas \nCiencias');
    expect(creadas).toHaveLength(3);
    await expect(s.materias.crearVarias(cicloId, 'Historia\nhistoria')).rejects.toThrow('repetida');
    await expect(s.materias.crearVarias(cicloId, 'Geografía\nespañol')).rejects.toThrow('ya existe');
    expect((await s.materias.listar(cicloId)).map((m) => m.nombre)).toEqual(['Ciencias', 'Español', 'Matemáticas']);
  });

  it('no se elimina una materia asignada', async () => {
    const [m] = await s.materias.crearVarias(cicloId, 'Artes');
    await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: m!.id, horasSemana: 2 });
    await expect(s.materias.eliminar(m!.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
  });
});

describe('asignaciones y horario semanal', () => {
  it('no repite la misma materia en un grupo y valida al docente', async () => {
    const [m] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: m!.id, personalId: docente.id, horasSemana: 5 });
    await expect(s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: m!.id, horasSemana: 3 })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    const prefecto = await s.personal.crear(escuelaId, { nombre: 'Persona', primerApellido: 'Prefecta', funciones: ['prefectura'] });
    await expect(s.asignaciones.crear(cicloId, { grupoId: grupoB.id, materiaId: m!.id, personalId: prefecto.id, horasSemana: 5 })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('programa clases, respeta las horas semanales y reemplaza la celda', async () => {
    const [mat, esp] = await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol');
    const aMat = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 1 });
    const aEsp = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: esp!.id, horasSemana: 2 });
    const [p1, p2] = await periodos(grupoA.id);
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aMat.id, dia: 1, periodoId: p1!.id });
    await expect(s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aMat.id, dia: 2, periodoId: p1!.id })).rejects.toThrow('1 horas semanales');
    // Reemplazar la celda no cuenta doble
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aEsp.id, dia: 1, periodoId: p1!.id });
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aMat.id, dia: 1, periodoId: p2!.id });
    const dia = await s.asignaciones.horarioDelDia(grupoA.id, 1);
    expect(dia.filter((c) => c.sesion).map((c) => c.sesion!.asignacionId)).toEqual([aEsp.id, aMat.id]);
    await expect(s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aEsp.id, dia: 6, periodoId: p1!.id })).rejects.toThrow('no es laborable');
  });

  it('impide que un docente tenga dos grupos a la misma hora', async () => {
    const [mat] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    const aA = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const aB = await s.asignaciones.crear(cicloId, { grupoId: grupoB.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const [p1] = await periodos(grupoA.id);
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aA.id, dia: 1, periodoId: p1!.id });
    await expect(s.asignaciones.programar({ grupoId: grupoB.id, asignacionId: aB.id, dia: 1, periodoId: p1!.id }))
      .rejects.toThrow('Persona Ficticia ya tiene clase con 1° A (Matemáticas) el lunes de 07:00 a 07:50');
    await expect(s.asignaciones.programar({ grupoId: grupoB.id, asignacionId: aB.id, dia: 2, periodoId: p1!.id })).resolves.toBeDefined();
  });

  it('detecta choques entre turnos con periodos distintos (por hora real)', async () => {
    const { turno: ves } = await s.turnos.crear(cicloId, { nombre: 'Intermedio', horaInicio: '07:20', horaFin: '12:00', dias: [1, 2, 3, 4, 5] });
    const { jornada } = (await s.turnos.listar(cicloId)).find((t) => t.turno.id === ves.id)!;
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:20', horaFin: '08:10' });
    const grado = (await s.grados.listarGrados(cicloId))[0]!;
    const gC = await s.grados.crearGrupo(cicloId, { gradoId: grado.id, turnoId: ves.id, nombre: 'C' });
    const [mat] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    const aA = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const aC = await s.asignaciones.crear(cicloId, { grupoId: gC.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const [p1A] = await periodos(grupoA.id); // 07:00–07:50
    const [p1C] = await periodos(gC.id); // 07:20–08:10
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aA.id, dia: 3, periodoId: p1A!.id });
    await expect(s.asignaciones.programar({ grupoId: gC.id, asignacionId: aC.id, dia: 3, periodoId: p1C!.id })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
  });

  it('cambiar de docente revisa sus choques y actualiza las sesiones', async () => {
    const otro = await s.personal.crear(escuelaId, { nombre: 'Persona', primerApellido: 'Ficticia', segundoApellido: 'Dos', numeroEmpleado: 'E-002', funciones: ['docente'] });
    const [mat, esp] = await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol');
    const aA = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const aB = await s.asignaciones.crear(cicloId, { grupoId: grupoB.id, materiaId: esp!.id, personalId: otro.id, horasSemana: 5 });
    const [p1] = await periodos(grupoA.id);
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aA.id, dia: 1, periodoId: p1!.id });
    await s.asignaciones.programar({ grupoId: grupoB.id, asignacionId: aB.id, dia: 1, periodoId: p1!.id });
    await expect(s.asignaciones.actualizar(aB.id, { personalId: docente.id, horasSemana: 5 })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    await expect(s.asignaciones.actualizar(aA.id, { personalId: docente.id, horasSemana: 0 })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    const nuevo = await s.personal.crear(escuelaId, { nombre: 'Persona', primerApellido: 'Nueva', funciones: ['docente'] });
    await s.asignaciones.actualizar(aA.id, { personalId: nuevo.id, horasSemana: 5 });
    expect((await s.asignaciones.horarioDocente(nuevo.id, cicloId))).toHaveLength(1);
    expect((await s.asignaciones.horarioDocente(docente.id, cicloId))).toHaveLength(0);
  });

  it('protege el horario frente a cambios de la Fase 1', async () => {
    const [mat] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    const aA = await s.asignaciones.crear(cicloId, { grupoId: grupoA.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const aB = await s.asignaciones.crear(cicloId, { grupoId: grupoB.id, materiaId: mat!.id, personalId: docente.id, horasSemana: 5 });
    const [p1, p2] = await periodos(grupoA.id);
    await s.asignaciones.programar({ grupoId: grupoA.id, asignacionId: aA.id, dia: 5, periodoId: p1!.id });
    await s.asignaciones.programar({ grupoId: grupoB.id, asignacionId: aB.id, dia: 5, periodoId: p2!.id });
    const [t] = await s.turnos.listar(cicloId);
    await expect(s.turnos.actualizar(t!.turno.id, { ...ENTRADA.turno, dias: [1, 2, 3, 4] })).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    await expect(s.horario.eliminar('periodo', p1!.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    // Alargar el periodo 1 lo encima con el 2 (mismo docente): se rechaza por traslape de bloques
    await expect(s.horario.actualizar('periodo', p1!.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '08:00' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    await expect(s.grados.eliminarGrupo(grupoA.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    // Eliminar la asignación quita también sus horas del horario
    await s.asignaciones.eliminar(aA.id);
    expect((await s.asignaciones.horarioDelDia(grupoA.id, 5)).every((c) => !c.sesion)).toBe(true);
  });

  it('el horario persiste al reabrir la base de datos', async () => {
    const { nombre, s: s2 } = nuevoEntorno();
    const r = await s2.asistente.crearEscuelaCompleta(ENTRADA);
    const g = (await s2.grados.listarGrupos(r.ciclo.id)).find((x) => x.nombre === 'A')!;
    const d = await s2.personal.crear(r.escuela.id, { ...DOCENTE, funciones: ['docente'] });
    const [m] = await s2.materias.crearVarias(r.ciclo.id, 'Matemáticas');
    const a = await s2.asignaciones.crear(r.ciclo.id, { grupoId: g.id, materiaId: m!.id, personalId: d.id, horasSemana: 5 });
    const [c] = await s2.asignaciones.horarioDelDia(g.id, 1);
    await s2.asignaciones.programar({ grupoId: g.id, asignacionId: a.id, dia: 1, periodoId: c!.periodo.id });
    const s3 = crearServicios(new BaseDatosEscolar(nombre));
    expect((await s3.asignaciones.horarioDocente(d.id, r.ciclo.id))[0]).toMatchObject({ grupo: '1° A', materia: 'Matemáticas', horaInicio: '07:00' });
  });
});
