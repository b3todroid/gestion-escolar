import { describe, expect, it } from 'vitest';
import { generarBloques, nombresGrupos } from '../../src/domain/generadores';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios } from '../../src/services';
import { nuevoEntorno } from './ayudantes';

const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 20', cct: '32ZZZ0020A', nivel: 'secundaria', localidad: null },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:10', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 7, recesos: [{ despuesDe: 3, duracion: 20 }] },
  grados: { gradoDesde: 1, gradoHasta: 3, gruposPorGrado: 3, capacidad: 35 },
};

describe('generadores', () => {
  it('genera módulos consecutivos con recesos intercalados', () => {
    const b = generarBloques({ horaInicio: '07:00', horaFin: '13:10', duracionModulo: 50, modulos: 4, recesos: [{ despuesDe: 2, duracion: 30 }] });
    expect(b.map((x) => `${x.nombre} ${x.horaInicio}-${x.horaFin}`)).toEqual([
      'Módulo 1 07:00-07:50', 'Módulo 2 07:50-08:40', 'Receso 08:40-09:10', 'Módulo 3 09:10-10:00', 'Módulo 4 10:00-10:50',
    ]);
  });

  it('numera los recesos cuando hay más de uno', () => {
    const b = generarBloques({ horaInicio: '07:00', horaFin: '13:00', duracionModulo: 45, modulos: 5, recesos: [{ despuesDe: 2, duracion: 15 }, { despuesDe: 4, duracion: 10 }] });
    expect(b.filter((x) => x.tipo === 'receso').map((x) => x.nombre)).toEqual(['Receso 1', 'Receso 2']);
  });

  it('rechaza una plantilla que excede la jornada, indicando la hora de término', () => {
    expect(() => generarBloques({ horaInicio: '07:00', horaFin: '13:00', duracionModulo: 50, modulos: 8, recesos: [] })).toThrow(/13:40/);
  });

  it('genera nombres de grupo A, B, C…', () => {
    expect(nombresGrupos(4)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('asistente de configuración', () => {
  it('crea escuela, ciclo activo, turno, bloques, grados y grupos en una sola operación', async () => {
    const { s } = nuevoEntorno();
    const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
    expect(r).toMatchObject({ bloques: 8, grados: 3, grupos: 9 });
    expect(r.ciclo.estado).toBe('activo');
    const [t] = await s.turnos.listar(r.ciclo.id);
    const resumen = await s.horario.resumen(t!.jornada.id);
    expect(resumen.minutosClase).toBe(350);
    expect(resumen.minutosReceso).toBe(20);
    const grupos = await s.grados.listarGrupos(r.ciclo.id);
    expect(grupos.map((g) => g.nombre).sort()).toEqual(['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C']);
    expect(grupos.every((g) => g.capacidad === 35 && g.escuelaId === r.escuela.id)).toBe(true);
  });

  it('valida cada paso y detecta la escuela duplicada antes de guardar', async () => {
    const { s } = nuevoEntorno();
    await s.asistente.crearEscuelaCompleta(ENTRADA);
    await expect(s.asistente.validarPaso('escuela', ENTRADA)).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    await expect(s.asistente.validarPaso('horario', { ...ENTRADA, horario: { ...ENTRADA.horario, recesos: [{ despuesDe: 7, duracion: 20 }] } })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(s.asistente.validarPaso('grados', { ...ENTRADA, grados: { ...ENTRADA.grados, gradoDesde: 3, gradoHasta: 1 } })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('si falla un paso intermedio no se guarda nada (atomicidad)', async () => {
    const { db, s } = nuevoEntorno();
    db.grupos.add = () => Promise.reject(new Error('fallo simulado')) as never;
    await expect(s.asistente.crearEscuelaCompleta(ENTRADA)).rejects.toMatchObject({ codigo: 'ALMACENAMIENTO' });
    for (const tabla of db.tables) expect(await tabla.count(), tabla.name).toBe(0);
  });

  it('los datos del asistente persisten al reabrir la base de datos', async () => {
    const { nombre, db, s } = nuevoEntorno();
    const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
    db.close();
    const s2 = crearServicios(new BaseDatosEscolar(nombre));
    expect((await s2.grados.listarGrados(r.ciclo.id)).map((g) => g.nombre)).toEqual(['Primer grado', 'Segundo grado', 'Tercer grado']);
  });
});
