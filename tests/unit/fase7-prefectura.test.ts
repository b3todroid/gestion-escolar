import { beforeEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { crearServicios, type Servicios } from '../../src/services';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import type { Grupo, Periodo, Personal, Sesion } from '../../src/models';
import { nuevoEntorno } from './ayudantes';

// Fase 7 — Prefectura. Escuela, personal y alumnos ficticios. 2026-11-02 es lunes.
const LUNES = '2026-11-02';
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 700', cct: '32ZZZ0700A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};

let s: Servicios; let db: BaseDatosEscolar; let nombreBd: string; let escuelaId: string; let cicloId: string;
let A: Grupo; let B: Grupo; let p: Periodo[];
let uno: Personal; let dos: Personal; let tres: Personal; let prefecta: Personal;
let claseA: Sesion; let claseB: Sesion;

beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db; nombreBd = e.nombre;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  escuelaId = r.escuela.id; cicloId = r.ciclo.id;
  const gs = await s.grados.listarGrupos(cicloId);
  A = gs.find((g) => g.nombre === 'A')!; B = gs.find((g) => g.nombre === 'B')!;
  const doc = (n: string, ap: string) => s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: ap, segundoApellido: n, funciones: ['docente'] });
  uno = await doc('Uno', 'Ficticio'); dos = await doc('Dos', 'Ficticia'); tres = await doc('Tres', 'Ficticio');
  prefecta = await s.personal.crear(escuelaId, { nombre: 'Prefecta', primerApellido: 'Ficticia', funciones: ['prefectura'] });
  const [mat, esp] = await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol');
  p = (await s.asignaciones.horarioDelDia(A.id, 1)).map((c) => c.periodo);
  const aA = await s.asignaciones.crear(cicloId, { grupoId: A.id, materiaId: mat!.id, personalId: uno.id, horasSemana: 5 });
  const aB = await s.asignaciones.crear(cicloId, { grupoId: B.id, materiaId: esp!.id, personalId: dos.id, horasSemana: 5 });
  claseA = await s.asignaciones.programar({ grupoId: A.id, asignacionId: aA.id, dia: 1, periodoId: p[0]!.id }); // lunes 07:00 1° A (Uno)
  claseB = await s.asignaciones.programar({ grupoId: B.id, asignacionId: aB.id, dia: 1, periodoId: p[0]!.id }); // lunes 07:00 1° B (Dos)
  // Tres: SE confirmada el lunes 07:00–07:50 y clase a las 07:50
  await s.actividades.crearDocente(cicloId, tres.id, { tipo: 'servicio', dia: 1, periodoId: p[0]!.id, horaInicio: '07:00', horaFin: '07:50', descripcion: 'Guardia', confirmada: true });
  const aT = await s.asignaciones.crear(cicloId, { grupoId: B.id, materiaId: mat!.id, personalId: tres.id, horasSemana: 5 });
  await s.asignaciones.programar({ grupoId: B.id, asignacionId: aT.id, dia: 1, periodoId: p[1]!.id });
});

const estadoDe = async (sesionId: string, turnoId: string | null = null) => (await s.prefectura.clasesDelDia(cicloId, LUNES, turnoId)).find((c) => c.sesionId === sesionId)!;

describe('1–3. Incidencias y grupos que requieren atención', () => {
  it('sin incidencias: SIN INFORMACIÓN SUFICIENTE (no se asume falta); con lista: ATENDIDA', async () => {
    expect((await estadoDe(claseA.id)).estado).toBe('sin_informacion');
    expect(await db.incidenciasPersonal.count()).toBe(0); // nada se registra automáticamente
    const [al] = await s.alumnos.crearVarios(A.id, 'Alumna Ficticia, Ana');
    await s.asistencia.guardarLista(claseA.id, LUNES, {}, {}, LUNES, uno.id);
    expect((await estadoDe(claseA.id)).estado).toBe('atendida');
    void al;
  });

  it('1–3. falta reportada = POSIBLE; confirmada = SIN DOCENTE CONFIRMADO; descartada = sin efecto', async () => {
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada', observaciones: 'Avisó por teléfono' }, prefecta.id);
    expect(i).toMatchObject({ estado: 'reportada', registradaPor: prefecta.id, periodoIds: [] });
    const c1 = await estadoDe(claseA.id);
    expect([c1.estado, c1.motivo]).toEqual(['posible', 'Falta reportada, sin confirmar.']);
    await expect(s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' })).rejects.toThrow('Ya hay una incidencia');
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    const c2 = await estadoDe(claseA.id);
    expect([c2.estado, c2.grupo, c2.materia, c2.docente]).toEqual(['confirmado', '1° A', 'Matemáticas', 'Docente Ficticio Uno']);
    expect((await estadoDe(claseB.id)).estado).toBe('sin_informacion'); // otro docente, otro grupo
    // Otra incidencia configurable, por periodo, descartada
    const o = await s.prefectura.registrarIncidencia(cicloId, { personalId: dos.id, fecha: LUNES, tipo: 'otra', tipoOtro: 'Comisión sindical', alcance: 'periodos', periodoIds: [p[0]!.id] });
    expect((await estadoDe(claseB.id)).motivo).toContain('Comisión sindical');
    await expect(s.prefectura.validarIncidencia(o.id, 'descartada', prefecta.id)).rejects.toThrow('motivo');
    await s.prefectura.validarIncidencia(o.id, 'descartada', prefecta.id, 'Se presentó a tiempo');
    expect((await estadoDe(claseB.id)).estado).toBe('sin_informacion');
    await expect(s.prefectura.validarIncidencia(o.id, 'confirmada', prefecta.id)).rejects.toThrow('ya está descartada');
  });

  it('retardo confirmado sólo es POSIBLE (parte del periodo); confirmación en sitio sin incidencia', async () => {
    const r = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'retardo', alcance: 'periodos', periodoIds: [p[0]!.id] });
    await s.prefectura.validarIncidencia(r.id, 'confirmada', prefecta.id);
    expect((await estadoDe(claseA.id)).estado).toBe('posible');
    await expect(s.prefectura.confirmarSinDocente(claseB.id, LUNES, '')).rejects.toThrow('Describe');
    await s.prefectura.confirmarSinDocente(claseB.id, LUNES, 'Recorrido de prefectura: el grupo está solo', prefecta.id);
    expect((await estadoDe(claseB.id)).estado).toBe('confirmado');
  });
});

describe('4–7. SE, coberturas, incompatibilidades y autorización', () => {
  it('4. SE confirmadas del día y candidatos sugeridos (no asignados)', async () => {
    const se = await s.prefectura.serviciosDelDia(cicloId, LUNES);
    expect(se.map((x) => [x.nombre, x.horaInicio, x.horaFin])).toEqual([['Docente Ficticio Tres', '07:00', '07:50']]);
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' });
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    const cands = await s.prefectura.candidatos(claseA.id, LUNES);
    expect(cands[0]).toMatchObject({ nombre: 'Docente Ficticio Tres', origen: 'se', compatible: true });
    expect(cands.some((c) => c.personalId === dos.id)).toBe(false); // tiene clase a esa hora: no es «libre»
    expect(await db.coberturas.count()).toBe(0); // sugerir no asigna
    // SE no es autorización automática: se exige quién autorizó
    await expect(s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: '' })).rejects.toThrow('Quién autorizó');
  });

  it('5–7. propuesta → asignación con autorización → realizada; incompatibles rechazados', async () => {
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' });
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    // 6. Incompatibles: Dos tiene clase a la misma hora; Uno es el ausente
    await expect(s.prefectura.proponer(claseA.id, LUNES, [dos.id])).rejects.toThrow('Tiene clase con 1° B');
    await expect(s.prefectura.asignar(claseA.id, LUNES, { personalId: uno.id, autorizadoPor: 'Subdirección académica' })).rejects.toThrow('Es el docente ausente');
    const prop = await s.prefectura.proponer(claseA.id, LUNES, [tres.id], prefecta.id);
    expect(prop).toMatchObject({ estado: 'propuesta', propuestoIds: [tres.id], asignadoId: null, docenteAusenteId: uno.id, incidenciaId: i.id });
    expect((await estadoDe(claseA.id)).estado).toBe('confirmado'); // una propuesta no es cobertura
    // Actividad del banco: sólo validadas
    const act = await s.prefectura.crearActividad(cicloId, { titulo: 'Ejercicios de fracciones', descripcion: 'Hoja de 10 ejercicios ficticios.', fecha: LUNES, responsable: 'Academia de Matemáticas' }, prefecta.id);
    await expect(s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Subdirección académica', actividadId: act.id })).rejects.toThrow('validadas');
    await s.prefectura.cambiarEstadoActividad(act.id, 'validada', prefecta.id);
    const asig = await s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Subdirección académica (Ficticia)', actividadId: act.id }, prefecta.id);
    expect(asig).toMatchObject({ estado: 'asignada', asignadoId: tres.id, autorizadoPor: 'Subdirección académica (Ficticia)' });
    expect(asig.autorizadoEn).toMatch(/^\d{4}-/);
    expect((await estadoDe(claseA.id)).estado).toBe('cobertura_asignada');
    // Tres ya cubre a 1° A: no puede cubrir otra clase a la misma hora
    await s.prefectura.confirmarSinDocente(claseB.id, LUNES, 'Grupo solo', prefecta.id);
    await expect(s.prefectura.asignar(claseB.id, LUNES, { personalId: tres.id, autorizadoPor: 'Dirección' })).rejects.toThrow('Ya cubre a 1° A');
    await s.prefectura.cerrarCobertura(asig.id, 'realizada', 'Se trabajó la hoja completa', prefecta.id);
    expect((await estadoDe(claseA.id)).estado).toBe('cobertura_realizada');
    await expect(s.prefectura.cerrarCobertura(asig.id, 'cancelada', 'error')).rejects.toThrow('no se cancela');
  });
});

describe('8–9. Historial y reportes', () => {
  it('8. historial completo de la cobertura y la incidencia', async () => {
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'permiso', alcance: 'jornada' }, prefecta.id);
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    const a = await s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Dirección (Ficticia)' }, prefecta.id);
    await s.prefectura.cerrarCobertura(a.id, 'realizada', null, prefecta.id);
    expect((await s.prefectura.historial(cicloId, a.id)).map((h) => h.accion)).toEqual(['registrar realizada', 'asignar']);
    expect((await s.prefectura.historial(cicloId, i.id)).map((h) => h.accion)).toEqual(['confirmar', 'reportar']);
    expect((await s.prefectura.historial(cicloId)).every((h) => h.personalId === prefecta.id)).toBe(true);
  });

  it('9. reportes por intervalo, docente, tipo y cobertura; indicadores sólo con registros validados', async () => {
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' });
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    await s.prefectura.registrarIncidencia(cicloId, { personalId: dos.id, fecha: LUNES, tipo: 'retardo', alcance: 'periodos', periodoIds: [p[0]!.id] }); // sólo reportada
    const a = await s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Dirección' });
    await s.prefectura.cerrarCobertura(a.id, 'realizada', null);
    const semana = await s.prefectura.reporte(cicloId, { desde: '2026-11-02', hasta: '2026-11-08' });
    expect(semana.indicadores).toMatchObject({ incidenciasConfirmadas: 1, incidenciasSinConfirmar: 1, clasesSinDocenteConfirmadas: 1, coberturasRealizadas: 1, porcentajeCubierto: 100, posiblesSinConfirmar: 1 });
    expect(semana.indicadores.incidenciasPorTipo.falta).toBe(1);
    expect(semana.indicadores.incidenciasPorTipo.retardo).toBe(0); // el retardo no está confirmado
    expect(semana.clases.find((c) => c.sesionId === claseA.id)).toMatchObject({ fecha: LUNES, asignado: 'Docente Ficticio Tres', estado: 'cobertura_realizada' });
    expect((await s.prefectura.reporte(cicloId, { desde: LUNES, hasta: LUNES, personalId: dos.id })).incidencias).toHaveLength(1);
    expect((await s.prefectura.reporte(cicloId, { desde: LUNES, hasta: LUNES, tipo: 'permiso' })).indicadores.incidenciasConfirmadas).toBe(0);
    expect((await s.prefectura.reporte(cicloId, { desde: LUNES, hasta: LUNES, estadoCobertura: 'realizada' })).clases).toHaveLength(1);
    const mes = await s.prefectura.reporte(cicloId, { desde: '2026-11-01', hasta: '2026-11-30' });
    expect(mes.indicadores.clasesSinDocenteConfirmadas).toBe(1); // sólo el lunes 2 tiene la falta
    await expect(s.prefectura.reporte(cicloId, { desde: '2026-09-01', hasta: '2026-12-31' })).rejects.toThrow('intervalo máximo');
    await expect(s.prefectura.reporte(cicloId, { desde: '2026-11-08', hasta: '2026-11-02' })).rejects.toThrow('anterior');
  });
});

describe('10–12. Separación, persistencia e integridad', () => {
  it('10. separación entre escuelas: personal y fechas de otra escuela no se mezclan', async () => {
    const otra = await s.asistente.crearEscuelaCompleta({ ...ENTRADA, escuela: { ...ENTRADA.escuela, nombre: 'Escuela Ficticia 701', cct: '32ZZZ0701A' } });
    const ajeno = await s.personal.crear(otra.escuela.id, { nombre: 'Docente', primerApellido: 'Ajeno', funciones: ['docente'] });
    await expect(s.prefectura.registrarIncidencia(cicloId, { personalId: ajeno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' })).rejects.toThrow('no pertenece a esta escuela');
    await expect(s.prefectura.asignar(claseA.id, LUNES, { personalId: ajeno.id, autorizadoPor: 'Dirección' })).rejects.toThrow('no pertenece a esta escuela');
    expect(await s.prefectura.clasesDelDia(otra.ciclo.id, LUNES)).toEqual([]);
    expect((await s.prefectura.serviciosDelDia(otra.ciclo.id, LUNES))).toEqual([]);
    await expect(s.prefectura.clasesDelDia(cicloId, '2027-08-02')).rejects.toThrow('fuera del ciclo');
  });

  it('turnos separados: el panel filtra por turno', async () => {
    const vesp = await s.turnos.crear(cicloId, { nombre: 'Vespertino', horaInicio: '13:30', horaFin: '19:30', dias: [1, 2, 3, 4, 5] });
    expect(await s.prefectura.clasesDelDia(cicloId, LUNES, vesp.turno.id)).toEqual([]);
    expect((await s.prefectura.clasesDelDia(cicloId, LUNES, A.turnoId)).length).toBe(3);
  });

  it('11. persistencia al reabrir', async () => {
    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' });
    await s.prefectura.validarIncidencia(i.id, 'confirmada', null);
    await s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Dirección' });
    db.close();
    const s2 = crearServicios(new BaseDatosEscolar(nombreBd));
    expect((await s2.prefectura.clasesDelDia(cicloId, LUNES)).find((c) => c.sesionId === claseA.id)!.estado).toBe('cobertura_asignada');
  });

  it('12. migración v9 → v10 sólo agrega tablas; respaldo con Prefectura se restaura; no se elimina personal con historial', async () => {
    const nombre = `mig10-${Date.now()}`;
    const v = new Dexie(nombre);
    v.version(1).stores({ escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId', jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId', grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId' });
    v.version(2).stores({ personal: 'id, escuelaId', materias: 'id, cicloEscolarId, escuelaId', asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId', sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId' });
    v.version(3).stores({ actividades: 'id, cicloEscolarId, personalId, grupoId', excepciones: 'id, cicloEscolarId, personalId', confirmaciones: 'id, &grupoId, cicloEscolarId', bitacora: 'id, cicloEscolarId, entidadId' });
    v.version(4).stores({ alumnos: 'id, grupoId, cicloEscolarId, escuelaId', pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId', asistencias: 'id, paseId, alumnoId, grupoId', salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId', reportes: 'id, alumnoId, grupoId, cicloEscolarId', ajustes: 'id' });
    v.version(5).stores({});
    v.version(6).stores({ alumnos: 'id, escuelaId', inscripciones: 'id, alumnoId, cicloEscolarId, grupoId, escuelaId, &[alumnoId+cicloEscolarId]', movimientos: 'id, alumnoId, cicloEscolarId', adscripciones: 'id, personalId, cicloEscolarId, &[personalId+cicloEscolarId]', importaciones: 'id, escuelaId, cicloEscolarId' });
    v.version(7).stores({});
    v.version(8).stores({ cambiosAsistencia: 'id, paseId, alumnoId, cicloEscolarId' });
    v.version(9).stores({ plantillasImportacion: 'id, escuelaId' });
    const m = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1 };
    await v.table('plantillasImportacion').add({ ...m, id: 'pl1', escuelaId: 'e1', nombre: 'Plantilla ficticia', tipo: 'horarios', estructura: 'lista', columnas: [], umbralConfianza: 0.75 });
    v.close();
    const v10 = new BaseDatosEscolar(nombre);
    await v10.open();
    expect(v10.verno).toBe(VERSION_ESQUEMA);
    expect(await v10.plantillasImportacion.get('pl1')).toMatchObject({ nombre: 'Plantilla ficticia' });
    expect(await v10.incidenciasPersonal.count()).toBe(0);
    v10.close();

    const i = await s.prefectura.registrarIncidencia(cicloId, { personalId: uno.id, fecha: LUNES, tipo: 'falta', alcance: 'jornada' });
    await s.prefectura.validarIncidencia(i.id, 'confirmada', prefecta.id);
    const act = await s.prefectura.crearActividad(cicloId, { titulo: 'Lectura guiada', descripcion: 'Texto ficticio.', fecha: LUNES, archivo: { nombre: 'lectura.txt', tipo: 'text/plain', tamano: 12, datos: btoa('hola ficticio') } });
    await s.prefectura.cambiarEstadoActividad(act.id, 'validada');
    await s.prefectura.asignar(claseA.id, LUNES, { personalId: tres.id, autorizadoPor: 'Dirección', actividadId: act.id });
    await expect(s.personal.eliminar(uno.id)).rejects.toThrow();
    const contenido = (await s.respaldos.exportar([escuelaId])).contenido;
    const otro = nuevoEntorno();
    expect((await otro.s.respaldos.analizar(contenido)).errores).toEqual([]);
    await otro.s.respaldos.restaurar(contenido, [escuelaId]);
    expect((await otro.s.prefectura.clasesDelDia(cicloId, LUNES)).find((c) => c.sesionId === claseA.id)!.estado).toBe('cobertura_asignada');
    expect((await otro.s.prefectura.actividades(cicloId))[0]!.archivo?.nombre).toBe('lectura.txt');
    expect(await otro.db.bitacoraPrefectura.count()).toBe(await db.bitacoraPrefectura.count());
  });
});
