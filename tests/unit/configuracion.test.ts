import { beforeEach, describe, expect, it } from 'vitest';
import { ESCUELA_FICTICIA, MATUTINO, escuelaConCiclo, nuevoEntorno } from './ayudantes';
import type { Servicios } from '../../src/services';
import type { CicloEscolar, Escuela, Jornada } from '../../src/models';

let s: Servicios;
let escuela: Escuela;
let ciclo: CicloEscolar;

beforeEach(async () => {
  s = nuevoEntorno().s;
  ({ escuela, ciclo } = await escuelaConCiclo(s));
});

describe('escuelas', () => {
  it('impide escuelas duplicadas por clave (sin importar mayúsculas)', async () => {
    await expect(s.escuelas.crear({ ...ESCUELA_FICTICIA, nombre: 'Otra', cct: '32zzz0000a' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
  });

  it('impide escuelas sin clave con el mismo nombre', async () => {
    await s.escuelas.crear({ nombre: 'Escuela Sin Clave', nivel: 'primaria' });
    await expect(s.escuelas.crear({ nombre: 'escuela  sin clave', nivel: 'primaria' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
  });

  it('no elimina una escuela con ciclos', async () => {
    await expect(s.escuelas.eliminar(escuela.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    await s.ciclos.eliminar(ciclo.id);
    await s.escuelas.eliminar(escuela.id);
    expect(await s.escuelas.listar()).toHaveLength(0);
  });
});

describe('ciclos escolares', () => {
  it('impide nombres duplicados y fechas traslapadas', async () => {
    await expect(s.ciclos.crear(escuela.id, { nombre: '2026-2027', fechaInicio: '2030-01-01', fechaFin: '2030-12-01' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    await expect(s.ciclos.crear(escuela.id, { nombre: '2027-2028', fechaInicio: '2027-07-01', fechaFin: '2028-07-01' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    await expect(s.ciclos.crear(escuela.id, { nombre: '2027-2028', fechaInicio: '2027-08-30', fechaFin: '2028-07-14' })).resolves.toBeDefined();
  });

  it('separa los ciclos por escuela', async () => {
    const otra = await s.escuelas.crear({ nombre: 'Escuela Ficticia 2', cct: '32ZZZ0000B', nivel: 'secundaria' });
    // El mismo nombre y fechas son válidos en otra escuela.
    await s.ciclos.crear(otra.id, { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15' });
    expect(await s.ciclos.listar(escuela.id)).toHaveLength(1);
    expect(await s.ciclos.listar(otra.id)).toHaveLength(1);
  });

  it('sólo permite un ciclo activo y no reabre ciclos cerrados', async () => {
    const otro = await s.ciclos.crear(escuela.id, { nombre: '2027-2028', fechaInicio: '2027-08-30', fechaFin: '2028-07-14' });
    await s.ciclos.cambiarEstado(ciclo.id, 'activo');
    await expect(s.ciclos.cambiarEstado(otro.id, 'activo')).rejects.toMatchObject({ codigo: 'ESTADO_NO_PERMITIDO' });
    await s.ciclos.cambiarEstado(ciclo.id, 'cerrado');
    await expect(s.ciclos.cambiarEstado(ciclo.id, 'activo')).rejects.toMatchObject({ codigo: 'ESTADO_NO_PERMITIDO' });
    await expect(s.ciclos.cambiarEstado(otro.id, 'activo')).resolves.toMatchObject({ estado: 'activo' });
  });

  it('bloquea cambios de configuración en un ciclo cerrado', async () => {
    await s.ciclos.cambiarEstado(ciclo.id, 'cerrado');
    await expect(s.turnos.crear(ciclo.id, MATUTINO)).rejects.toMatchObject({ codigo: 'CICLO_CERRADO' });
    await expect(s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' })).rejects.toMatchObject({ codigo: 'CICLO_CERRADO' });
  });
});

describe('turnos, jornada, periodos y recesos', () => {
  let jornada: Jornada;
  beforeEach(async () => {
    ({ jornada } = await s.turnos.crear(ciclo.id, MATUTINO));
  });

  it('impide turnos duplicados en el mismo ciclo', async () => {
    await expect(s.turnos.crear(ciclo.id, { ...MATUTINO, nombre: 'MATUTINO' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
  });

  it('registra periodos contiguos y recesos, y calcula el resumen', async () => {
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 2', horaInicio: '07:50', horaFin: '08:40' });
    await s.horario.crear('receso', jornada.id, { nombre: 'Receso', horaInicio: '08:40', horaFin: '09:00' });
    const r = await s.horario.resumen(jornada.id);
    expect(r.bloques.map((b) => b.nombre)).toEqual(['Módulo 1', 'Módulo 2', 'Receso']);
    expect(r.minutosClase).toBe(100);
    expect(r.minutosReceso).toBe(20);
    expect(r.minutosLibres).toBe(370 - 120);
  });

  it('rechaza periodos superpuestos (también con recesos)', async () => {
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    await s.horario.crear('receso', jornada.id, { nombre: 'Receso', horaInicio: '10:00', horaFin: '10:30' });
    await expect(s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 2', horaInicio: '07:30', horaFin: '08:20' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    await expect(s.horario.crear('periodo', jornada.id, { nombre: 'Módulo X', horaInicio: '10:20', horaFin: '11:00' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    await expect(s.horario.crear('receso', jornada.id, { nombre: 'Receso 2', horaInicio: '07:40', horaFin: '08:00' })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
  });

  it('rechaza bloques fuera de la jornada', async () => {
    await expect(s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 0', horaInicio: '06:30', horaFin: '07:20' })).rejects.toMatchObject({ codigo: 'FUERA_DE_JORNADA' });
  });

  it('al editar un periodo no choca consigo mismo', async () => {
    const p = await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    await expect(s.horario.actualizar('periodo', p.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:45' })).resolves.toMatchObject({ horaFin: '07:45' });
  });

  it('no permite reducir la jornada si deja bloques fuera', async () => {
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 7', horaInicio: '12:20', horaFin: '13:10' });
    await expect(s.turnos.actualizar(jornada.turnoId, { ...MATUTINO, horaFin: '13:00' })).rejects.toMatchObject({ codigo: 'FUERA_DE_JORNADA' });
  });

  it('elimina el turno con su jornada y bloques, salvo que tenga grupos', async () => {
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    const grado = await s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' });
    const grupo = await s.grados.crearGrupo(ciclo.id, { gradoId: grado.id, turnoId: jornada.turnoId, nombre: 'A' });
    await expect(s.turnos.eliminar(jornada.turnoId)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
    expect(await s.turnos.resumenDependencias(jornada.turnoId)).toEqual({ periodos: 1, recesos: 0, grupos: 1 });
    await s.grados.eliminarGrupo(grupo.id);
    await s.turnos.eliminar(jornada.turnoId);
    expect(await s.turnos.listar(ciclo.id)).toHaveLength(0);
  });
});

describe('grados y grupos', () => {
  it('impide grados duplicados por número o nombre', async () => {
    await s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' });
    await expect(s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primero' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    await expect(s.grados.crearGrado(ciclo.id, { numero: 2, nombre: 'primer GRADO' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
  });

  it('impide grupos duplicados en el mismo grado y turno, pero los permite en otro turno', async () => {
    const { turno: mat } = await s.turnos.crear(ciclo.id, MATUTINO);
    const { turno: ves } = await s.turnos.crear(ciclo.id, { nombre: 'Vespertino', horaInicio: '14:00', horaFin: '20:00', dias: [1, 2, 3, 4, 5] });
    const g1 = await s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' });
    await s.grados.crearGrupo(ciclo.id, { gradoId: g1.id, turnoId: mat.id, nombre: 'A', capacidad: 35 });
    await expect(s.grados.crearGrupo(ciclo.id, { gradoId: g1.id, turnoId: mat.id, nombre: ' a ' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    await expect(s.grados.crearGrupo(ciclo.id, { gradoId: g1.id, turnoId: ves.id, nombre: 'A' })).resolves.toBeDefined();
  });

  it('no mezcla grados ni turnos de otro ciclo o escuela', async () => {
    const otraEscuela = await s.escuelas.crear({ nombre: 'Escuela Ficticia 3', nivel: 'secundaria' });
    const otroCiclo = await s.ciclos.crear(otraEscuela.id, { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15' });
    const gradoAjeno = await s.grados.crearGrado(otroCiclo.id, { numero: 1, nombre: 'Primer grado' });
    const { turno } = await s.turnos.crear(ciclo.id, MATUTINO);
    await expect(s.grados.crearGrupo(ciclo.id, { gradoId: gradoAjeno.id, turnoId: turno.id, nombre: 'A' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    const grado = await s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' });
    expect(grado.escuelaId).toBe(escuela.id);
    expect(grado.cicloEscolarId).toBe(ciclo.id);
  });

  it('no elimina un grado con grupos', async () => {
    const { turno } = await s.turnos.crear(ciclo.id, MATUTINO);
    const g = await s.grados.crearGrado(ciclo.id, { numero: 1, nombre: 'Primer grado' });
    await s.grados.crearGrupo(ciclo.id, { gradoId: g.id, turnoId: turno.id, nombre: 'A' });
    await expect(s.grados.eliminarGrado(g.id)).rejects.toMatchObject({ codigo: 'TIENE_DEPENDENCIAS' });
  });
});
