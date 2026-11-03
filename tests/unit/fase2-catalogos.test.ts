/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Dexie } from 'dexie';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import { leerTabla, hojasXlsx, leerCsv } from '../../src/domain/importacion/tabla';
import { detectarEncabezado, problemasMapeo, sugerirMapeo } from '../../src/domain/importacion/mapeo';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Escuelas, personas y archivos ficticios.
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 200', cct: '32ZZZ0200A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
const archivo = (n: string) => { const b = readFileSync(`tests/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

let s: Servicios; let db: BaseDatosEscolar; let nombreBd: string;
let escuelaId: string; let cicloId: string; let A: Grupo; let B: Grupo;

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  escuelaId = r.escuela.id; cicloId = r.ciclo.id;
  const gs = await s.grados.listarGrupos(cicloId);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
});

describe('1–3. Personal, docentes y funciones', () => {
  it('registra personal sin asignaciones, con varias funciones, turnos y búsqueda', async () => {
    const p = await s.personal.crear(escuelaId, { nombre: 'Laura', primerApellido: 'Ficticia', numeroEmpleado: 'p-001', funciones: ['prefectura', 'orientacion', 'prefectura'], observaciones: 'Apoyo en recreo' });
    expect(p).toMatchObject({ numeroEmpleado: 'P-001', funciones: ['prefectura', 'orientacion'], activo: true, observaciones: 'Apoyo en recreo' });
    const d = await s.personal.crear(escuelaId, { nombre: 'Mario', primerApellido: 'Ficticio', funciones: ['docente', 'udei'] });
    const [t] = await s.turnos.listar(cicloId);
    const [mat] = await s.materias.crearVarias(cicloId, 'Matemáticas');
    await s.personal.fijarAdscripcion(d.id, cicloId, { turnoIds: [t!.turno.id], materiaIds: [mat!.id] });
    expect((await s.personal.docentes(escuelaId)).map((x) => x.nombre)).toEqual(['Mario']); // la vista de docentes usa el mismo catálogo
    expect(await s.asignaciones.listarPorGrupo(A.id)).toHaveLength(0); // no se inventan asignaciones
    expect((await s.personal.buscar(escuelaId, { texto: 'lau' })).map((x) => x.nombre)).toEqual(['Laura']);
    expect((await s.personal.buscar(escuelaId, { funcion: 'udei' })).map((x) => x.nombre)).toEqual(['Mario']);
    expect((await s.personal.buscar(escuelaId, { turnoId: t!.turno.id, cicloId })).map((x) => x.nombre)).toEqual(['Mario']);
    await expect(s.personal.fijarAdscripcion(p.id, cicloId, { turnoIds: [], materiaIds: [mat!.id] })).rejects.toThrow('función docente');
    await s.personal.cambiarActivo(p.id, false);
    expect((await s.personal.buscar(escuelaId, { estado: 'inactivos' })).map((x) => x.nombre)).toEqual(['Laura']);
  });
});

describe('4. Materias y actividades', () => {
  it('tipos, sin duplicados, desactivar y SE no asignable a grupo', async () => {
    const m = await s.materias.crear(cicloId, { nombre: 'Lenguajes', tipo: 'campo_formativo' });
    await expect(s.materias.crear(cicloId, { nombre: 'lenguajes' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    const se = await s.materias.crear(cicloId, { nombre: 'Horas de servicio', tipo: 'servicio', abreviatura: 'SE' });
    await expect(s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: se.id, horasSemana: 2 })).rejects.toThrow('horas de servicio');
    await s.materias.cambiarActivo(m.id, false);
    await expect(s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: m.id, horasSemana: 2 })).rejects.toThrow('desactivada');
    expect((await s.materias.listar(cicloId, { soloActivas: true })).map((x) => x.nombre)).toEqual(['Horas de servicio']);
    expect((await s.materias.listar(cicloId, { tipo: 'campo_formativo' })).map((x) => x.nombre)).toEqual(['Lenguajes']);
  });
});

describe('5–8. Alumnos, inscripción, cambio de grupo y duplicados', () => {
  it('registra sin CURP, valida CURP y matrícula únicas, inscribe y cambia de grupo sin crear otra persona', async () => {
    const ana = await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia', matricula: 'm-1' }, { grupoId: A.id, numeroLista: 3 });
    expect(ana).toMatchObject({ matricula: 'M-1', curp: null, grupoId: A.id, activo: true });
    await expect(s.alumnos.inscribirNuevo(cicloId, { nombre: 'Otra', primerApellido: 'Persona', matricula: 'M-1' })).rejects.toThrow('matrícula');
    await expect(s.alumnos.inscribirNuevo(cicloId, { nombre: 'Otra', primerApellido: 'Persona', curp: 'NOESCURP' })).rejects.toThrow('CURP');
    const sinGrupo = await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Beto', primerApellido: 'Ficticio' });
    expect((await s.alumnos.listarCiclo(cicloId, { sinGrupo: true })).map((x) => x.nombre)).toEqual(['Beto']);
    // Cambio de grupo: misma persona, queda en el historial; el historial de asistencia conserva su grupo original
    const i = await s.alumnos.cambiarGrupo(ana.inscripcion.id, B.id, 'Reasignación');
    expect(i.grupoId).toBe(B.id);
    expect(await db.alumnos.count()).toBe(2);
    expect((await s.alumnos.movimientos(ana.id)).map((m) => m.tipo)).toEqual(['cambio_grupo', 'alta']);
    expect((await s.alumnos.listarGrupo(A.id))).toHaveLength(0);
    expect((await s.alumnos.listarGrupo(B.id)).map((x) => x.nombre)).toEqual(['Ana']);
    // Posible inscripción doble: mismo nombre, mismo ciclo y turno (no se fusiona)
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Beto', primerApellido: 'Ficticio' }, { grupoId: A.id });
    const dups = await s.alumnos.posiblesDuplicados(cicloId);
    expect(dups.map((g) => g.map((x) => x.nombre))).toEqual([['Beto', 'Beto']]);
    expect(await db.alumnos.count()).toBe(3);
    // Resumen real
    expect(await s.alumnos.resumen(cicloId)).toMatchObject({ inscritos: 3, sinGrupo: 1, bajas: 0 });
    await s.alumnos.cambiarEstado(sinGrupo.inscripcion.id, 'baja');
    expect(await s.alumnos.resumen(cicloId)).toMatchObject({ inscritos: 2, sinGrupo: 0, bajas: 1 });
  });
});

describe('9–14. Centro de importación', () => {
  it('9. Excel con sinónimos, títulos y varias hojas: detecta encabezados, sugiere mapeo, clasifica y aplica', async () => {
    expect((await hojasXlsx(archivo('alumnos-sinonimos.xlsx'))).map((h) => h.nombre)).toEqual(['Lista 2026', 'Notas']);
    const filas = await leerTabla('alumnos-sinonimos.xlsx', archivo('alumnos-sinonimos.xlsx'), 'Lista 2026');
    const fe = detectarEncabezado(filas, 'alumnos');
    expect(fe).toBe(2); // tras el título y una fila vacía
    const mapeo = sugerirMapeo(filas[fe]!, 'alumnos');
    expect(mapeo).toEqual(['primerApellido', 'segundoApellido', 'nombre', 'grado', 'grupo', 'numeroLista', 'matricula']);
    const a = await s.importacionDatos.analizar(cicloId, 'alumnos', filas.slice(fe + 1), mapeo, null, fe + 2);
    expect(a.totales).toMatchObject({ total: 5, nuevo: 4, error: 1 });
    expect(a.filas.find((f) => f.estado === 'error')!.mensajes.join(' ')).toMatch(/El grado «9» no existe/);
    const r = await s.importacionDatos.aplicar(cicloId, 'alumnos', filas.slice(fe + 1), mapeo, {}, { archivo: 'alumnos-sinonimos.xlsx', hoja: 'Lista 2026', huella: 'a'.repeat(64) }, fe + 2);
    expect(r.resultado).toEqual({ nuevos: 4, actualizados: 0, omitidos: 1 });
    expect(await s.alumnos.resumen(cicloId)).toMatchObject({ inscritos: 4, sinGrupo: 1 });
    // 14. Reimportar: advertencia de archivo repetido y nada nuevo
    const b = await s.importacionDatos.analizar(cicloId, 'alumnos', filas.slice(fe + 1), mapeo, 'a'.repeat(64), fe + 2);
    expect(b.advertencias[0]).toMatch(/ya se importó/);
    expect(b.totales).toMatchObject({ nuevo: 0 });
  });

  it('10. encabezados desconocidos: sin sugerencias, se exige mapeo manual y luego funciona', async () => {
    const filas = await leerTabla('alumnos-desconocidos.xlsx', archivo('alumnos-desconocidos.xlsx'));
    const sug = sugerirMapeo(filas[0]!, 'alumnos');
    expect(sug.every((x) => x === null)).toBe(true);
    expect(problemasMapeo(sug, 'alumnos')).toEqual(['Asigna columnas a «Nombre(s)» y «Primer apellido», o a «Nombre completo».']);
    await expect(s.importacionDatos.analizar(cicloId, 'alumnos', filas.slice(1), sug)).rejects.toThrow('Asigna columnas');
    const manual = ['primerApellido', 'nombre', 'grado', 'grupo'];
    const a = await s.importacionDatos.analizar(cicloId, 'alumnos', filas.slice(1), manual);
    expect(a.totales).toMatchObject({ nuevo: 2 });
  });

  it('11. CSV con «;», comillas, salto de línea dentro de un campo, BOM y Windows-1252', async () => {
    const filas = await leerTabla('personal.csv', archivo('personal.csv'));
    expect(filas).toHaveLength(4);
    expect(filas[1]![5]).toBe('Turno matutino,\r\napoyo en recreo'.replace('\r\n', '\n').replace('\n', '\r\n'));
    const mapeo = sugerirMapeo(filas[0]!, 'personal');
    const a = await s.importacionDatos.analizar(cicloId, 'personal', filas.slice(1), mapeo);
    expect(a.filas.map((f) => f.estado)).toEqual(['nuevo', 'nuevo', 'error']);
    expect(a.filas[0]!.resumen).toMatch(/Prefectura, Orientación/);
    expect(a.filas[2]!.mensajes.join(' ')).toMatch(/Función desconocida «Astronauta»/);
    const m = await leerTabla('materias-1252.csv', archivo('materias-1252.csv'));
    expect(m[1]![0]).toBe('Español');
    const am = await s.importacionDatos.analizar(cicloId, 'materias', m.slice(1), sugerirMapeo(m[0]!, 'materias'));
    expect(am.filas.map((f) => f.datos['tipo'])).toEqual(['materia', 'materia', 'tutoria', 'servicio']);
    expect(leerCsv('a,b\n"x\ny",2\n')).toEqual([['a', 'b'], ['x\ny', '2']]);
  });

  it('12–13. cancelar no guarda nada; se detectan errores y ambigüedades', async () => {
    const antes = { alumnos: await db.alumnos.count(), ins: await db.inscripciones.count(), imp: await db.importaciones.count() };
    const cuerpo = [['Pérez López, Ana', '1', 'A'], ['De la Cruz López Ana', '1', 'A'], ['Ruiz, Eva', '1', 'Z'], ['Ruiz, Eva', '1', 'A']];
    const a = await s.importacionDatos.analizar(cicloId, 'alumnos', cuerpo, ['nombreCompleto', 'grado', 'grupo']);
    expect(a.filas.map((f) => f.estado)).toEqual(['nuevo', 'error', 'error', 'nuevo']);
    expect(a.filas[1]!.mensajes[0]).toMatch(/No se separan nombre y apellidos/);
    expect(a.filas[2]!.mensajes[0]).toMatch(/No existe el grupo 1° Z/);
    // «Cancelar» = no llamar a aplicar: nada cambió
    expect({ alumnos: await db.alumnos.count(), ins: await db.inscripciones.count(), imp: await db.importaciones.count() }).toEqual(antes);
  });

  it('8 y 14. por nombre: POSIBLE DUPLICADO (no se fusiona); por matrícula: ACTUALIZABLE con cambio de grupo', async () => {
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia', matricula: 'M-100' }, { grupoId: A.id });
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Beto', primerApellido: 'Ficticio' }, { grupoId: A.id });
    const cuerpo = [['Ficticia', 'Ana', '1', 'B', 'M-100'], ['Ficticio', 'Beto', '1', 'B', ''], ['Ficticia', 'Ana', '1', 'A', 'M-999']];
    const mapeo = ['primerApellido', 'nombre', 'grado', 'grupo', 'matricula'];
    const a = await s.importacionDatos.analizar(cicloId, 'alumnos', cuerpo, mapeo);
    expect(a.filas.map((f) => f.estado)).toEqual(['actualizable', 'posible_duplicado', 'posible_duplicado']);
    expect(a.filas[0]!.cambios).toEqual(['grupo: 1° A → 1° B']);
    expect(a.filas[1]!.decision).toBe('omitir'); // propuesta segura
    const r = await s.importacionDatos.aplicar(cicloId, 'alumnos', cuerpo, mapeo, { 4: 'crear' }, { archivo: 'x.csv', hoja: null, huella: null }, 2);
    expect(r.resultado).toEqual({ nuevos: 1, actualizados: 1, omitidos: 1 });
    expect((await s.alumnos.listarGrupo(B.id)).map((x) => x.nombre)).toEqual(['Ana']);
    expect(await db.alumnos.count()).toBe(3); // Beto no se duplicó; la segunda Ana se creó porque así se decidió
    const ana = (await s.alumnos.listarCiclo(cicloId, { texto: 'M-100' }))[0]!;
    expect((await s.alumnos.movimientos(ana.id))[0]).toMatchObject({ tipo: 'cambio_grupo', motivo: 'Importación' });
  });
});

describe('15–18. Persistencia y separación', () => {
  it('15. conserva todo al reabrir la base de datos', async () => {
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia' }, { grupoId: A.id });
    await s.personal.crear(escuelaId, { nombre: 'Laura', primerApellido: 'Ficticia', funciones: ['secretaria'] });
    db.close();
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    expect((await s2.alumnos.listarGrupo(A.id)).map((x) => x.nombre)).toEqual(['Ana']);
    expect((await s2.personal.listar(escuelaId)).map((x) => x.funciones)).toEqual([['secretaria']]);
  });

  it('16–17. separa escuelas y ciclos; la misma persona se inscribe en otro ciclo sin duplicarse', async () => {
    const otra = await s.asistente.crearEscuelaCompleta({ ...ENTRADA, escuela: { ...ENTRADA.escuela, nombre: 'Escuela Ficticia 201', cct: '32ZZZ0201A' } });
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia', matricula: 'M-1' }, { grupoId: A.id });
    // La misma matrícula es válida en otra escuela (son personas de escuelas distintas)
    await s.alumnos.inscribirNuevo(otra.ciclo.id, { nombre: 'Ana', primerApellido: 'Ficticia', matricula: 'M-1' });
    expect(await s.alumnos.listarCiclo(cicloId)).toHaveLength(1);
    expect(await s.alumnos.listarCiclo(otra.ciclo.id)).toHaveLength(1);
    // Otro ciclo de la misma escuela
    await s.ciclos.cambiarEstado(cicloId, 'cerrado');
    const nuevo = await s.ciclos.crear(escuelaId, { nombre: '2027-2028', fechaInicio: '2027-08-30', fechaFin: '2028-07-14' });
    expect(await s.alumnos.listarCiclo(nuevo.id)).toHaveLength(0);
    const ana = (await s.alumnos.listarCiclo(cicloId))[0]!;
    await s.alumnos.inscribirExistente(ana.id, nuevo.id);
    expect(await s.alumnos.listarCiclo(nuevo.id)).toHaveLength(1);
    expect((await db.alumnos.where('escuelaId').equals(escuelaId).count())).toBe(1);
    await expect(s.alumnos.inscribirExistente(ana.id, nuevo.id)).rejects.toThrow('ya está inscrito');
  });

  it('18. la migración v5 → v6 conserva alumnos, asistencias y la configuración de la Fase 1', async () => {
    const nombre = `mig6-${Date.now()}`;
    const v5 = new Dexie(nombre);
    v5.version(1).stores({ escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId', jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId', grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId' });
    v5.version(2).stores({ personal: 'id, escuelaId', materias: 'id, cicloEscolarId, escuelaId', asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId', sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId' });
    v5.version(3).stores({ actividades: 'id, cicloEscolarId, personalId, grupoId', excepciones: 'id, cicloEscolarId, personalId', confirmaciones: 'id, &grupoId, cicloEscolarId', bitacora: 'id, cicloEscolarId, entidadId' });
    v5.version(4).stores({ alumnos: 'id, grupoId, cicloEscolarId, escuelaId', pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId', asistencias: 'id, paseId, alumnoId, grupoId', salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId', reportes: 'id, alumnoId, grupoId, cicloEscolarId', ajustes: 'id' });
    v5.version(5).stores({});
    const m = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1 };
    await v5.table('grupos').add({ ...m, id: 'g1', escuelaId: 'e1', cicloEscolarId: 'c1', gradoId: 'gr1', turnoId: 't1', nombre: 'A', capacidad: null, activo: true });
    await v5.table('alumnos').add({ ...m, id: 'a1', escuelaId: 'e1', cicloEscolarId: 'c1', grupoId: 'g1', nombre: 'Ana', primerApellido: 'Ficticia', segundoApellido: null, activo: true });
    await v5.table('alumnos').add({ ...m, id: 'a2', escuelaId: 'e1', cicloEscolarId: 'c1', grupoId: 'g1', nombre: 'Beto', primerApellido: 'Ficticio', segundoApellido: null, activo: false });
    await v5.table('asistencias').add({ ...m, id: 'x1', escuelaId: 'e1', cicloEscolarId: 'c1', paseId: 'p1', grupoId: 'g1', alumnoId: 'a1', fecha: '2026-11-02', marca: 'F', horaLlegada: null });
    await v5.table('materias').add({ ...m, id: 'm1', escuelaId: 'e1', cicloEscolarId: 'c1', nombre: 'Matemáticas', abreviatura: null });
    v5.close();
    const v6 = new BaseDatosEscolar(nombre);
    await v6.open();
    expect(v6.verno).toBe(VERSION_ESQUEMA); // migra hasta la versión vigente
    expect(await v6.alumnos.get('a1')).toEqual({ ...m, id: 'a1', escuelaId: 'e1', nombre: 'Ana', primerApellido: 'Ficticia', segundoApellido: null, matricula: null, curp: null, observaciones: null });
    const ins = (await v6.inscripciones.toArray()).sort((x, y) => x.alumnoId.localeCompare(y.alumnoId));
    expect(ins.map((i) => [i.alumnoId, i.grupoId, i.gradoId, i.turnoId, i.estado])).toEqual([['a1', 'g1', 'gr1', 't1', 'inscrito'], ['a2', 'g1', 'gr1', 't1', 'baja']]);
    expect(await v6.movimientos.count()).toBe(2);
    expect(await v6.asistencias.get('x1')).toMatchObject({ alumnoId: 'a1', marca: 'F' });
    expect(await v6.materias.get('m1')).toMatchObject({ tipo: 'materia', activo: true });
    expect(await v6.grupos.get('g1')).toMatchObject({ nombre: 'A' });
    v6.close();
  });

  it('18. las importaciones no alteran la configuración de la Fase 1 y un respaldo antiguo se restaura', async () => {
    const antes = { grupos: await db.grupos.count(), periodos: await db.periodos.count(), recesos: await db.recesos.count() };
    await s.importacionDatos.aplicar(cicloId, 'grupos', [['1', 'C', ''], ['1', 'A', '']], ['grado', 'grupo', 'turno'], {}, { archivo: 'g.csv', hoja: null, huella: null });
    expect({ grupos: await db.grupos.count(), periodos: await db.periodos.count(), recesos: await db.recesos.count() }).toEqual({ ...antes, grupos: antes.grupos + 1 });
    // Respaldo con alumnos al estilo anterior (esquema 5): se convierte al restaurar
    await s.alumnos.inscribirNuevo(cicloId, { nombre: 'Ana', primerApellido: 'Ficticia' }, { grupoId: A.id });
    const j = JSON.parse((await s.respaldos.exportar([escuelaId])).contenido);
    const viejoAlumno = { ...j.datos.alumnos[0], cicloEscolarId: cicloId, grupoId: A.id, activo: true };
    delete viejoAlumno.matricula; delete viejoAlumno.curp; delete viejoAlumno.observaciones;
    const anterior = { ...j, versionFormato: 1, conteos: undefined, ciclos: undefined, esquema: 5, huella: null, datos: { ...j.datos, alumnos: [viejoAlumno], inscripciones: [], movimientos: [] } };
    const otro = nuevoEntorno();
    const an = await otro.s.respaldos.analizar(JSON.stringify(anterior));
    expect(an.errores).toEqual([]);
    await otro.s.respaldos.restaurar(JSON.stringify(anterior), [escuelaId]);
    expect((await otro.s.alumnos.listarGrupo(A.id)).map((x) => x.nombre)).toEqual(['Ana']);
  });
});
