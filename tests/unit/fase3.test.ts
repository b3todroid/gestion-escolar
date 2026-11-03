/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { construirDia } from '../../src/domain/horarioVista';
import { leerXlsx } from '../../src/domain/importacion/tabla';
import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo, Materia, Periodo, Personal } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Horarios, escuelas y personas ficticias.
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 80', cct: '32ZZZ0080A', nivel: 'secundaria', localidad: null },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
const tabla = async (n: string) => { const b = readFileSync(`tests/fixtures/${n}`); return leerXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); };

let nombreBd: string;
let s: Servicios;
let cicloId: string;
let A: Grupo; let B: Grupo;
let uno: Personal; let dos: Personal;
let mat: Materia;
let p: Periodo[];

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  cicloId = r.ciclo.id;
  const gs = await s.grados.listarGrupos(cicloId);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
  uno = await s.personal.crear(r.escuela.id, { nombre: 'Docente', primerApellido: 'Ficticio', segundoApellido: 'Uno', numeroEmpleado: 'E-001', funciones: ['docente'] });
  dos = await s.personal.crear(r.escuela.id, { nombre: 'Docente', primerApellido: 'Ficticia', segundoApellido: 'Dos', funciones: ['docente'] });
  [, mat] = (await s.materias.crearVarias(cicloId, 'Español\nMatemáticas')) as [Materia, Materia];
  p = (await s.asignaciones.horarioDelDia(A.id, 1)).map((c) => c.periodo);
});

describe('vista del día (tipos de bloque)', () => {
  it('un hueco es «sin actividad registrada», nunca servicio; el receso cubierto no se muestra', () => {
    const d = construirDia(
      [{ tipo: 'clase', titulo: 'Mat', horaInicio: '07:00', horaFin: '07:50' }, { tipo: 'servicio', titulo: 'Guardia', horaInicio: '09:30', horaFin: '10:00', confirmada: true }],
      [{ horaInicio: '09:30', horaFin: '10:00' }, { horaInicio: '11:00', horaFin: '11:20' }],
      { horaInicio: '07:00', horaFin: '12:00' },
    );
    expect(d.map((x) => `${x.tipo} ${x.horaInicio}-${x.horaFin}`)).toEqual([
      'clase 07:00-07:50', 'sin_actividad 07:50-09:30', 'servicio 09:30-10:00', 'sin_actividad 10:00-11:00', 'receso 11:00-11:20', 'sin_actividad 11:20-12:00',
    ]);
  });
});

describe('conflictos de docente', () => {
  it('no se programan clases simultáneas salvo caso especial explícito', async () => {
    const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    const aB = await s.asignaciones.crear(cicloId, { grupoId: B.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id });
    await expect(s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[0]!.id })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    // Caso especial: taller conjunto lunes 07:00–07:50
    const exc = await s.actividades.crearExcepcion(cicloId, uno.id, { dia: 1, horaInicio: '07:00', horaFin: '07:50', motivo: 'Taller conjunto de 1° A y 1° B' });
    await expect(s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[0]!.id })).resolves.toBeDefined();
    // El caso especial no cubre otra hora
    await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[1]!.id });
    await expect(s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[1]!.id })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    // No se puede quitar el caso especial mientras haya simultaneidad
    await expect(s.actividades.eliminarExcepcion(exc.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    const semana = await s.vistas.semanaDocente(uno.id, cicloId);
    expect(semana.dias[0]!.segmentos.filter((x) => x.simultanea)).toHaveLength(2);
  });

  it('las clases de un ciclo cerrado no bloquean el ciclo nuevo (corrección)', async () => {
    const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id });
    await s.ciclos.cambiarEstado(cicloId, 'cerrado');
    const escuela = (await s.escuelas.listar())[0]!;
    const nuevo = await s.ciclos.crear(escuela.id, { nombre: '2027-2028', fechaInicio: '2027-08-30', fechaFin: '2028-07-14' });
    const { turno, jornada } = await s.turnos.crear(nuevo.id, { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] });
    const per = await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    const g = await s.grados.crearGrado(nuevo.id, { numero: 1, nombre: 'Primer grado' });
    const gr = await s.grados.crearGrupo(nuevo.id, { gradoId: g.id, turnoId: turno.id, nombre: 'A' });
    const m = await s.materias.crear(nuevo.id, { nombre: 'Matemáticas' });
    const a = await s.asignaciones.crear(nuevo.id, { grupoId: gr.id, materiaId: m.id, personalId: uno.id, horasSemana: 5 });
    await expect(s.asignaciones.programar({ grupoId: gr.id, asignacionId: a.id, dia: 1, periodoId: per.id })).resolves.toBeDefined();
  });
});

describe('horas de servicio y otras actividades', () => {
  it('el servicio se registra, choca con clases y sólo cuenta como confirmado al confirmarlo', async () => {
    const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id });
    await expect(s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 1, horaInicio: '07:30', horaFin: '08:30', descripcion: 'Guardia' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    const sv = await s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 1, horaInicio: '07:50', horaFin: '08:40', descripcion: 'Apoyo en biblioteca' });
    let t = (await s.vistas.semanaDocente(uno.id, cicloId)).totales;
    expect(t).toMatchObject({ clase: 50, servicioConfirmado: 0, servicioPorConfirmar: 50 });
    await s.actividades.confirmar(sv.id);
    t = (await s.vistas.semanaDocente(uno.id, cicloId)).totales;
    expect(t).toMatchObject({ servicioConfirmado: 50, servicioPorConfirmar: 0 });
    // Confirmado: no se edita ni elimina sin quitar la confirmación con motivo
    await expect(s.actividades.eliminar(sv.id)).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.actividades.desconfirmar(sv.id, 'no')).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await s.actividades.desconfirmar(sv.id, 'Cambio de horario de biblioteca');
    await s.actividades.eliminar(sv.id);
    // No se puede programar una clase encima de un servicio
    await s.actividades.crearDocente(cicloId, uno.id, { tipo: 'otra', dia: 2, horaInicio: '07:00', horaFin: '07:50', descripcion: 'Reunión de academia' });
    await expect(s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 2, periodoId: p[0]!.id })).rejects.toThrow('otra actividad');
  });

  it('el grupo puede tener otra actividad en un periodo; no convive con una clase', async () => {
    const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat.id, horasSemana: 5 });
    await s.actividades.crearGrupo(A.id, 1, p[0]!.id, 'Honores a la bandera');
    await expect(s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id })).rejects.toThrow('Honores');
    const semana = await s.vistas.semanaGrupo(A.id);
    expect(semana[0]!.segmentos.map((x) => x.tipo)).toEqual(['otra', 'sin_actividad', 'sin_actividad', 'receso', 'sin_actividad', 'sin_actividad', 'sin_actividad']);
  });
});

describe('horarios confirmados', () => {
  it('bloquean cambios hasta reabrirlos con motivo (queda en bitácora)', async () => {
    const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    await expect(s.confirmacion.confirmar(A.id)).rejects.toThrow('no tiene clases');
    const ses = await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id });
    await s.confirmacion.confirmar(A.id);
    await expect(s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 2, periodoId: p[0]!.id })).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.asignaciones.quitarSesion(ses.id)).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.asignaciones.actualizar(aA.id, { personalId: dos.id, horasSemana: 5 })).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.asignaciones.eliminar(aA.id)).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.horario.actualizar('periodo', p[0]!.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:45' })).rejects.toMatchObject({ codigo: 'HORARIO_CONFIRMADO' });
    await expect(s.confirmacion.reabrir(A.id, '')).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await s.confirmacion.reabrir(A.id, 'Ajuste solicitado por dirección');
    await expect(s.asignaciones.quitarSesion(ses.id)).resolves.toBeUndefined();
    const b = await s.confirmacion.bitacora(A.id);
    expect(b.map((x) => [x.accion, x.motivo])).toEqual(expect.arrayContaining([['confirmar', null], ['reabrir', 'Ajuste solicitado por dirección']]));
  });
});

describe('importación desde Excel', () => {
  it('archivo con conflictos intencionales: detecta cada uno y no guarda nada', async () => {
    const a = await s.importacion.analizar(cicloId, await tabla('horario-conflictos.xlsx'));
    const por = Object.fromEntries(a.filas.map((f) => [f.fila, f]));
    expect(por[2]!.estado).toBe('conflicto');
    expect(por[2]!.mensajes.join(' ')).toMatch(/dos clases a la misma hora \(filas 2 y 4\)/);
    expect(por[3]!.mensajes.join(' ')).toMatch(/dos grupos a la vez \(filas 2 y 3\)/);
    expect(por[4]!.estado).toBe('conflicto');
    expect(por[5]!.mensajes.join(' ')).toMatch(/sábado no es laborable/);
    expect(por[6]!.mensajes.join(' ')).toMatch(/no tiene un periodo que inicie a las 09:15/);
    expect(por[7]!.mensajes.join(' ')).toMatch(/«Química» no está registrada/);
    expect(por[8]!.mensajes.join(' ')).toMatch(/No existe el grupo 9° Z/);
    expect(por[8]!.mensajes.join(' ')).toMatch(/«Nadie»/);
    expect(a.puedeImportar).toBe(false);
    await expect(s.importacion.aplicar(cicloId, await tabla('horario-conflictos.xlsx'))).rejects.toThrow('No se importó nada');
    expect(await s.asignaciones.listarPorGrupo(A.id)).toHaveLength(0);
  });

  it('archivo válido: previsualiza ajustes, importa todo junto y respeta lo existente y lo confirmado', async () => {
    const t = await tabla('horario-valido.xlsx');
    const a = await s.importacion.analizar(cicloId, t);
    expect(a).toMatchObject({ nuevas: 4, errores: 0, conflictos: 0, puedeImportar: true });
    expect(a.ajustes).toEqual(expect.arrayContaining(['Se asignará Matemáticas a 1° A con 2 hora(s) por semana.']));
    expect(await s.importacion.aplicar(cicloId, t)).toEqual({ clases: 4, asignacionesNuevas: 3 });
    // Reimportar: todo existe, nada se duplica
    const b = await s.importacion.analizar(cicloId, t);
    expect(b).toMatchObject({ nuevas: 0, existentes: 4, puedeImportar: false });
    // Confirmar 1° A y cambiar el archivo: no se toca
    await s.confirmacion.confirmar(A.id);
    const otra = [t[0]!, ['1', 'A', 'Matutino', 'Miércoles', '07:00', 'Matemáticas', 'E-001']];
    const c = await s.importacion.analizar(cicloId, otra);
    expect(c.filas[0]!.mensajes.join(' ')).toMatch(/confirmado/);
    // Persistencia tras «cerrar»
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    const semana = await s2.vistas.semanaGrupo(A.id);
    expect(semana[0]!.segmentos.filter((x) => x.tipo === 'clase').map((x) => x.titulo)).toEqual(['Matemáticas', 'Español']);
    expect(await s2.confirmacion.estado(A.id)).not.toBeNull();
  });

  it('exige las columnas obligatorias', async () => {
    await expect(s.importacion.analizar(cicloId, [['Grado', 'Grupo', 'Materia'], ['1', 'A', 'Español']])).rejects.toThrow('«Día», «Inicio»');
  });
});
