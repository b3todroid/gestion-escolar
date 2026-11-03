/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Dexie } from 'dexie';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import { hojasXlsx, leerTabla } from '../../src/domain/importacion/tabla';
import { detectarEncabezado, problemasMapeo, sugerirMapeo } from '../../src/domain/importacion/mapeo';
import { aTablaSegura } from '../../src/domain/importacion/fuentes';
import { resolverPeriodo } from '../../src/services/importacion';
import { nuevoId } from '../../src/utils/id';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo, Materia, Periodo, Personal } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Fase 3 — horarios. Escuelas, personas y archivos ficticios.
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 300', cct: '32ZZZ0300A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
const archivo = (n: string) => { const b = readFileSync(`tests/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

let s: Servicios; let db: BaseDatosEscolar; let nombreBd: string;
let escuelaId: string; let cicloId: string; let A: Grupo; let B: Grupo;
let mat: Materia; let esp: Materia; let uno: Personal; let dos: Personal; let periodos: Periodo[];

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  escuelaId = r.escuela.id; cicloId = r.ciclo.id;
  const gs = await s.grados.listarGrupos(cicloId);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
  [mat, esp] = await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol') as [Materia, Materia];
  uno = await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticio', segundoApellido: 'Uno', funciones: ['docente'] });
  dos = await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticia', segundoApellido: 'Dos', funciones: ['docente'] });
  periodos = (await db.periodos.where('cicloEscolarId').equals(cicloId).toArray()).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
});

const clase = async (g: Grupo, m: Materia, p: Personal | null, dia: number, i: number, horas = 5) => {
  const existente = (await s.asignaciones.listarPorGrupo(g.id)).find((a) => a.materiaId === m.id);
  const a = existente ?? await s.asignaciones.crear(cicloId, { grupoId: g.id, materiaId: m.id, personalId: p?.id ?? null, horasSemana: horas });
  return s.asignaciones.programar({ grupoId: g.id, asignacionId: a.id, dia, periodoId: periodos[i]!.id });
};

describe('1–2. Captura manual', () => {
  it('1. crea una asignación que relaciona docente, materia, grupo, día y periodo (origen manual)', async () => {
    const ses = await clase(A, mat, uno, 1, 0);
    expect(ses).toMatchObject({ grupoId: A.id, personalId: uno.id, dia: 1, periodoId: periodos[0]!.id, origen: 'manual', escuelaId, cicloEscolarId: cicloId });
    const asig = (await s.asignaciones.listarPorGrupo(A.id))[0]!;
    expect(asig).toMatchObject({ materiaId: mat.id, personalId: uno.id, sesionesProgramadas: 1 });
  });

  it('2. edita la asignación (docente) y el cambio se refleja en grupo y docente sin copias contradictorias', async () => {
    await clase(A, mat, uno, 1, 0);
    const asig = (await s.asignaciones.listarPorGrupo(A.id))[0]!;
    await s.asignaciones.actualizar(asig.id, { personalId: dos.id, horasSemana: 5 });
    const lunes = (await s.vistas.semanaGrupo(A.id))[0]!.segmentos[0]!;
    expect(lunes).toMatchObject({ tipo: 'clase', titulo: 'Matemáticas', detalle: 'Docente Ficticia', estado: 'registrado' });
    expect((await s.vistas.semanaDocente(uno.id, cicloId)).totales.clase).toBe(0);
    expect((await s.vistas.semanaDocente(dos.id, cicloId)).totales.clase).toBe(50);
    expect(await s.revisionHorarios.conflictos(cicloId)).toEqual([]);
    // Eliminar (la interfaz confirma antes) deja la celda sin actividad registrada
    const [ses] = await db.sesiones.toArray();
    await s.asignaciones.quitarSesion(ses!.id);
    expect((await s.vistas.semanaGrupo(A.id))[0]!.segmentos[0]!.tipo).toBe('sin_actividad');
  });
});

describe('3–4. Conflictos', () => {
  it('3. docente duplicado: se rechaza antes de guardar; la revisión detecta los que vengan de datos anteriores', async () => {
    await clase(A, mat, uno, 1, 0);
    await expect(clase(B, mat, uno, 1, 0)).rejects.toThrow('ya tiene clase con 1° A');
    expect(await db.sesiones.count()).toBe(1);
    // Datos inconsistentes (p. ej. de una versión anterior): la revisión los informa y no los corrige
    const asigB = (await s.asignaciones.listarPorGrupo(B.id))[0]!; // la asignación existe; sólo la clase se rechazó
    await db.sesiones.add({ id: nuevoId(), creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, escuelaId, cicloEscolarId: cicloId, asignacionId: asigB.id, grupoId: B.id, personalId: uno.id, dia: 1, periodoId: periodos[0]!.id, origen: null });
    const c = await s.revisionHorarios.conflictos(cicloId);
    expect(c.map((x) => x.tipo)).toEqual(['docente_simultaneo']);
    expect(c[0]!.mensaje).toMatch(/^Docente Ficticio Uno tiene clase con 1° [AB] \(07:00–07:50\) y con 1° [AB] \(07:00–07:50\) el lunes\.$/);
    expect(await db.sesiones.count()).toBe(2); // no modificó nada
    expect((await s.vistas.semanaGrupo(B.id))[0]!.segmentos[0]!.estado).toBe('conflicto');
  });

  it('3b. incompatibilidad entre turnos: la hora real cuenta aunque los periodos sean distintos', async () => {
    const vesp = await s.turnos.crear(cicloId, { nombre: 'Vespertino', horaInicio: '07:30', horaFin: '13:30', dias: [1, 2, 3, 4, 5] });
    const pv = await s.horario.crear('periodo', vesp.jornada.id, { nombre: 'Primer periodo', horaInicio: '07:30', horaFin: '08:20' });
    const grado = (await s.grados.listarGrados(cicloId))[0]!;
    const C = await s.grados.crearGrupo(cicloId, { gradoId: grado.id, turnoId: vesp.turno.id, nombre: 'C', capacidad: null });
    await clase(A, mat, uno, 1, 0); // 07:00–07:50
    const asigC = await s.asignaciones.crear(cicloId, { grupoId: C.id, materiaId: mat.id, personalId: uno.id, horasSemana: 5 });
    await expect(s.asignaciones.programar({ grupoId: C.id, asignacionId: asigC.id, dia: 1, periodoId: pv.id })).rejects.toThrow('ya tiene clase con 1° A');
    // Periodo de otro turno en el grupo: se rechaza
    await expect(s.asignaciones.programar({ grupoId: C.id, asignacionId: asigC.id, dia: 2, periodoId: periodos[0]!.id })).rejects.toThrow('no pertenece al turno');
  });

  it('4. grupo duplicado, periodo/materia/docente inexistentes y fuera de jornada se detectan en la revisión', async () => {
    await clase(A, mat, uno, 1, 0);
    const asigE = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: esp.id, personalId: dos.id, horasSemana: 5 });
    // En la aplicación no se puede: la celda se reemplaza con confirmación, nunca se duplica
    const base = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, escuelaId, cicloEscolarId: cicloId, origen: null };
    await db.sesiones.add({ ...base, id: nuevoId(), asignacionId: asigE.id, grupoId: A.id, personalId: dos.id, dia: 1, periodoId: periodos[0]!.id });
    await db.sesiones.add({ ...base, id: nuevoId(), asignacionId: asigE.id, grupoId: A.id, personalId: dos.id, dia: 6, periodoId: periodos[1]!.id });
    await db.sesiones.add({ ...base, id: nuevoId(), asignacionId: asigE.id, grupoId: A.id, personalId: dos.id, dia: 2, periodoId: nuevoId() });
    await db.asignaciones.add({ ...base, id: nuevoId(), grupoId: B.id, materiaId: nuevoId(), personalId: nuevoId(), horasSemana: 1 } as never);
    const tipos = (await s.revisionHorarios.conflictos(cicloId)).map((x) => x.tipo).sort();
    expect(tipos).toEqual(['docente_inexistente', 'fuera_de_jornada', 'grupo_duplicado', 'materia_inexistente', 'periodo_inexistente']);
  });
});

describe('5. Horas de servicio (SE)', () => {
  it('se registran confirmadas, por periodo, sin grupo; un hueco nunca es SE', async () => {
    await clase(A, mat, uno, 1, 0);
    const se = await s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 1, periodoId: periodos[1]!.id, horaInicio: '00:00', horaFin: '00:01', descripcion: 'Guardia en patio', confirmada: true });
    expect(se).toMatchObject({ grupoId: null, periodoId: periodos[1]!.id, horaInicio: '07:50', horaFin: '08:40', confirmada: true, origen: 'manual' });
    expect((await db.bitacora.toArray()).some((b) => b.entidadId === se.id && b.accion === 'confirmar')).toBe(true);
    // No puede chocar con una clase
    await expect(s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 1, periodoId: periodos[0]!.id, horaInicio: '07:00', horaFin: '07:50', descripcion: 'Biblioteca', confirmada: true })).rejects.toThrow('ya tiene clase');
    const { dias, totales } = await s.vistas.semanaDocente(uno.id, cicloId);
    expect(totales.servicioConfirmado).toBe(50);
    expect(dias[0]!.segmentos.find((x) => x.tipo === 'servicio')).toMatchObject({ estado: 'confirmado', titulo: 'Guardia en patio' });
    expect(dias.find((d) => d.dia === 2)!.segmentos.every((x) => x.tipo !== 'servicio')).toBe(true);
    // Si el periodo cambia de hora, la SE lo sigue (no quedan dos horarios distintos)
    await s.horario.actualizar('periodo', periodos[1]!.id, { nombre: periodos[1]!.nombre, horaInicio: '07:50', horaFin: '08:35' });
    expect(await db.actividades.get(se.id)).toMatchObject({ horaInicio: '07:50', horaFin: '08:35' });
    await expect(s.horario.eliminar('periodo', periodos[1]!.id)).rejects.toThrow('hora(s) de servicio');
    expect((await s.revisionHorarios.reporte(cicloId)).docentes.find((d) => d.personalId === uno.id)).toMatchObject({ seConfirmadas: 1, horasClase: 1 });
  });
});

describe('6–7. Consultas por grupo y por docente (mismas asignaciones)', () => {
  it('6–7. horario por grupo y por docente, horas asignadas y periodos sin información', async () => {
    await clase(A, mat, uno, 1, 0, 2);
    await clase(A, mat, uno, 3, 1, 2);
    await clase(B, esp, dos, 1, 0, 3);
    await s.confirmacion.confirmar(A.id);
    const semA = await s.vistas.semanaGrupo(A.id);
    expect(semA.map((d) => d.nombre)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
    expect(semA[0]!.segmentos[0]).toMatchObject({ tipo: 'clase', titulo: 'Matemáticas', detalle: 'Docente Ficticio', estado: 'confirmado' });
    expect(semA[0]!.segmentos.filter((x) => x.tipo === 'receso')).toHaveLength(1);
    expect(await s.revisionHorarios.sinInformacion(A.id)).toHaveLength(6 * 5 - 2);
    const r = await s.revisionHorarios.reporte(cicloId);
    expect(r.grupos.map((g) => [g.nombre, g.horasAsignadas, g.horasProgramadas, g.periodosSinInformacion, g.confirmado])).toEqual([['1° A', 2, 2, 28, true], ['1° B', 3, 1, 29, false]]);
    const d1 = r.docentes.find((d) => d.personalId === uno.id)!;
    expect(d1).toMatchObject({ grupos: ['1° A'], materias: ['Matemáticas'], horasClase: 2, minutosClase: 100, turnos: ['Matutino'] });
    const docente = await s.vistas.semanaDocente(uno.id, cicloId);
    expect(docente.dias.find((d) => d.dia === 3)!.segmentos.find((x) => x.tipo === 'clase')).toMatchObject({ titulo: '1° A Matemáticas', horaInicio: '07:50' });
  });
});

describe('8–9. Importación de horarios desde Excel', () => {
  const preparar = async (n: string) => {
    const datos = archivo(n);
    const hoja = n.endsWith('.xlsx') ? (await hojasXlsx(datos))[0]!.nombre : undefined;
    const filas = await leerTabla(n, datos, hoja);
    const enc = detectarEncabezado(filas, 'horarios');
    return { filas, enc, mapeo: sugerirMapeo(filas[enc]!, 'horarios'), cuerpo: filas.slice(enc + 1) };
  };

  it('8. encabezados equivalentes, periodo por número, previsualización y guardado con origen', async () => {
    const { enc, mapeo, cuerpo } = await preparar('horario-sinonimos.xlsx');
    expect(enc).toBe(2); // título y renglón vacío arriba
    expect(mapeo).toEqual(['grupo', 'dia', 'periodo', 'materia', 'docente']);
    expect(problemasMapeo(mapeo, 'horarios')).toEqual([]);
    const a = await s.importacion.analizarMapeado(cicloId, cuerpo, mapeo, enc + 2, 'f'.repeat(64));
    expect(a.filas.map((f) => [f.fila, f.estado])).toEqual([[4, 'nueva'], [5, 'nueva'], [6, 'nueva']]);
    expect(await db.sesiones.count()).toBe(0); // previsualizar no guarda
    const r = await s.importacion.aplicarMapeado(cicloId, cuerpo, mapeo, { archivo: 'horario-sinonimos.xlsx', hoja: 'Horario', huella: 'f'.repeat(64) }, enc + 2);
    expect(r).toMatchObject({ clases: 3, asignacionesNuevas: 3 });
    expect((await db.sesiones.toArray()).every((x) => x.origen === 'importacion')).toBe(true);
    expect(await db.importaciones.toArray()).toMatchObject([{ tipo: 'horarios', archivo: 'horario-sinonimos.xlsx', resultado: { nuevos: 3, actualizados: 0, omitidos: 0 } }]);
    // Reimportar: no sobrescribe ni duplica; avisa que el archivo ya se importó
    const b = await s.importacion.analizarMapeado(cicloId, cuerpo, mapeo, enc + 2, 'f'.repeat(64));
    expect([b.nuevas, b.existentes, b.puedeImportar]).toEqual([0, 3, false]);
    expect(b.advertencias[0]).toContain('ya se importó');
  });

  it('8b. no sobrescribe celdas ocupadas en silencio', async () => {
    await clase(A, esp, dos, 1, 0);
    const { enc, mapeo, cuerpo } = await preparar('horario-sinonimos.xlsx');
    const a = await s.importacion.analizarMapeado(cicloId, cuerpo, mapeo, enc + 2);
    expect(a.filas[0]).toMatchObject({ estado: 'conflicto' });
    expect(a.filas[0]!.mensajes.join(' ')).toContain('no reemplaza clases existentes');
  });

  it('9. cancelar o un archivo con conflictos no guarda nada', async () => {
    const { enc, mapeo, cuerpo } = await preparar('horario-conflicto.csv');
    const antes = { s: await db.sesiones.count(), a: await db.asignaciones.count(), i: await db.importaciones.count() };
    const a = await s.importacion.analizarMapeado(cicloId, cuerpo, mapeo, enc + 2);
    expect(a.filas.map((f) => f.estado)).toEqual(['conflicto', 'conflicto', 'error', 'error']);
    expect(a.filas[2]!.mensajes.join(' ')).toContain('fuera de jornada');
    expect(a.filas[3]!.mensajes.join(' ')).toContain('no existe el periodo 9');
    expect(a.puedeImportar).toBe(false);
    await expect(s.importacion.aplicarMapeado(cicloId, cuerpo, mapeo, { archivo: 'x.csv', hoja: null, huella: null }, enc + 2)).rejects.toThrow('No se importó nada');
    expect({ s: await db.sesiones.count(), a: await db.asignaciones.count(), i: await db.importaciones.count() }).toEqual(antes);
  });

  it('periodo por número, nombre u hora; lo ambiguo no se adivina (preparación para PDF)', () => {
    expect(resolverPeriodo('3', periodos)).toBe(periodos[2]);
    expect(resolverPeriodo('2°', periodos)).toBe(periodos[1]);
    expect(resolverPeriodo('Periodo 4', periodos)).toBe(periodos[3]);
    expect(resolverPeriodo('07:50 - 08:40', periodos)).toBe(periodos[1]);
    expect(resolverPeriodo(periodos[4]!.nombre, periodos)).toBe(periodos[4]);
    expect(resolverPeriodo('tercera', periodos)).toContain('No se reconoce');
    const t = aTablaSegura({ formato: 'pdf', origen: 'Página 1', filas: [
      { numero: 1, celdas: [{ texto: 'Grupo', confianza: 0.99, ambigua: false }, { texto: 'Materia', confianza: 0.99, ambigua: false }] },
      { numero: 3, celdas: [{ texto: '1A', confianza: 0.98, ambigua: false }, { texto: 'Matemát1cas', confianza: 0.4, ambigua: false }] },
      { numero: 4, celdas: [{ texto: '1B', confianza: 0.97, ambigua: true, motivo: 'Celda combinada' }, { texto: 'Español', confianza: 0.95, ambigua: false }] },
    ] });
    expect(t.filas).toEqual([['Grupo', 'Materia'], [], ['1A', ''], ['', 'Español']]);
    expect(t.avisos.map((x) => [x.fila, x.columna])).toEqual([[3, 2], [4, 1]]);
  });
});

describe('10–13. Persistencia, separación y fases anteriores', () => {
  it('10. conserva clases y SE al reabrir', async () => {
    await clase(A, mat, uno, 1, 0);
    await s.actividades.crearDocente(cicloId, uno.id, { tipo: 'servicio', dia: 2, periodoId: periodos[0]!.id, horaInicio: '07:00', horaFin: '07:50', descripcion: 'Biblioteca', confirmada: true });
    db.close();
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    const r = await s2.revisionHorarios.reporte(cicloId);
    expect(r.docentes.find((d) => d.personalId === uno.id)).toMatchObject({ horasClase: 1, seConfirmadas: 1 });
  });

  it('11. escuelas separadas: no se mezclan docentes, reportes ni conflictos', async () => {
    const otra = await s.asistente.crearEscuelaCompleta({ ...ENTRADA, escuela: { ...ENTRADA.escuela, nombre: 'Escuela Ficticia 301', cct: '32ZZZ0301A' } });
    const g = (await s.grados.listarGrupos(otra.ciclo.id))[0]!;
    const m = await s.materias.crear(otra.ciclo.id, { nombre: 'Matemáticas' });
    await expect(s.asignaciones.crear(otra.ciclo.id, { grupoId: g.id, materiaId: m.id, personalId: uno.id, horasSemana: 5 })).rejects.toThrow('docente activo de esta escuela');
    await expect(s.asignaciones.crear(cicloId, { grupoId: g.id, materiaId: m.id, personalId: null, horasSemana: 5 })).rejects.toThrow();
    await clase(A, mat, uno, 1, 0);
    const r = await s.revisionHorarios.reporte(otra.ciclo.id);
    expect(r.grupos.every((x) => x.horasProgramadas === 0)).toBe(true);
    expect(r.docentes).toEqual([]);
  });

  it('12. ciclos separados: el horario de un ciclo no choca ni aparece en otro', async () => {
    await clase(A, mat, uno, 1, 0);
    const nuevo = await s.ciclos.crear(escuelaId, { nombre: '2027-2028', fechaInicio: '2027-08-30', fechaFin: '2028-07-14' });
    const t = await s.turnos.crear(nuevo.id, { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] });
    const p = await s.horario.crear('periodo', t.jornada.id, { nombre: 'Primer periodo', horaInicio: '07:00', horaFin: '07:50' });
    const gr = await s.grados.crearGrado(nuevo.id, { numero: 1, nombre: 'Primero' });
    const g = await s.grados.crearGrupo(nuevo.id, { gradoId: gr.id, turnoId: t.turno.id, nombre: 'A', capacidad: null });
    const m = await s.materias.crear(nuevo.id, { nombre: 'Matemáticas' });
    const a = await s.asignaciones.crear(nuevo.id, { grupoId: g.id, materiaId: m.id, personalId: uno.id, horasSemana: 5 });
    await s.asignaciones.programar({ grupoId: g.id, asignacionId: a.id, dia: 1, periodoId: p.id }); // misma hora, otro ciclo: válido
    expect((await s.revisionHorarios.reporte(nuevo.id)).docentes.find((d) => d.personalId === uno.id)!.grupos).toEqual(['1° A']);
    expect((await s.vistas.semanaDocente(uno.id, cicloId)).totales.clase).toBe(50);
    expect(await s.revisionHorarios.conflictos(cicloId)).toEqual([]);
    expect(await s.revisionHorarios.conflictos(nuevo.id)).toEqual([]);
  });

  it('13. la migración v6 → v7 conserva clases y actividades (origen desconocido = null) y el resto de datos', async () => {
    const nombre = `mig7-${Date.now()}`;
    const v6 = new Dexie(nombre);
    v6.version(1).stores({ escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId', jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId', grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId' });
    v6.version(2).stores({ personal: 'id, escuelaId', materias: 'id, cicloEscolarId, escuelaId', asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId', sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId' });
    v6.version(3).stores({ actividades: 'id, cicloEscolarId, personalId, grupoId', excepciones: 'id, cicloEscolarId, personalId', confirmaciones: 'id, &grupoId, cicloEscolarId', bitacora: 'id, cicloEscolarId, entidadId' });
    v6.version(4).stores({ alumnos: 'id, grupoId, cicloEscolarId, escuelaId', pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId', asistencias: 'id, paseId, alumnoId, grupoId', salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId', reportes: 'id, alumnoId, grupoId, cicloEscolarId', ajustes: 'id' });
    v6.version(5).stores({});
    v6.version(6).stores({ alumnos: 'id, escuelaId', inscripciones: 'id, alumnoId, cicloEscolarId, grupoId, escuelaId, &[alumnoId+cicloEscolarId]', movimientos: 'id, alumnoId, cicloEscolarId', adscripciones: 'id, personalId, cicloEscolarId, &[personalId+cicloEscolarId]', importaciones: 'id, escuelaId, cicloEscolarId' });
    const m = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, escuelaId: 'e1', cicloEscolarId: 'c1' };
    await v6.table('sesiones').add({ ...m, id: 's1', asignacionId: 'a1', grupoId: 'g1', personalId: 'p1', dia: 1, periodoId: 'pe1' });
    await v6.table('actividades').add({ ...m, id: 'x1', tipo: 'servicio', personalId: 'p1', grupoId: null, periodoId: null, dia: 2, horaInicio: '08:00', horaFin: '08:50', descripcion: 'Guardia', confirmada: true, confirmadaEn: '2026-01-02T00:00:00Z' });
    await v6.table('inscripciones').add({ ...m, id: 'i1', alumnoId: 'al1', turnoId: null, gradoId: null, grupoId: 'g1', estado: 'inscrito', numeroLista: 3 });
    v6.close();
    const v7 = new BaseDatosEscolar(nombre);
    await v7.open();
    expect(v7.verno).toBe(VERSION_ESQUEMA);
    expect(await v7.sesiones.get('s1')).toEqual({ ...m, id: 's1', asignacionId: 'a1', grupoId: 'g1', personalId: 'p1', dia: 1, periodoId: 'pe1', origen: null });
    expect(await v7.actividades.get('x1')).toMatchObject({ confirmada: true, origen: null, horaInicio: '08:00' });
    expect(await v7.inscripciones.get('i1')).toMatchObject({ numeroLista: 3 });
    v7.close();
  });

  it('13b. un respaldo de esquema 6 (sin origen) se restaura; los datos de fases anteriores quedan iguales', async () => {
    await clase(A, mat, uno, 1, 0);
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia' }, { grupoId: A.id });
    const j = JSON.parse((await s.respaldos.exportar([escuelaId])).contenido);
    const viejo = { ...j, esquema: 6, huella: null, datos: { ...j.datos, sesiones: j.datos.sesiones.map((x: Record<string, unknown>) => { const c = { ...x }; delete c['origen']; return c; }) } };
    const otro = nuevoEntorno();
    expect((await otro.s.respaldos.analizar(JSON.stringify(viejo))).errores).toEqual([]);
    await otro.s.respaldos.restaurar(JSON.stringify(viejo), [escuelaId]);
    expect(await otro.db.sesiones.toArray()).toMatchObject([{ grupoId: A.id, origen: null }]);
    expect((await otro.s.alumnos.listarGrupo(A.id)).map((x) => x.nombre)).toEqual(['Ana']);
    expect(await otro.db.periodos.count()).toBe(await db.periodos.count());
  });
});
