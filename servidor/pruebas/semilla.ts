/**
 * Datos FICTICIOS completos para una escuela: al menos un registro en cada una de las
 * 30 tablas escolares, con dos grupos (G1 del Docente Uno, G2 de la Docente Dos) para
 * comprobar los alcances «grupos» y «propio». Se insertan con el rol dueño (sin RLS)
 * a través de los repositorios PostgreSQL (también prueba el mapeo de campos).
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { conCliente, crearRepositoriosPg, leerColumnas } from '../src/repositoriosPg.ts';

export interface Semilla {
  escuelaId: string; cicloId: string; turnoId: string; jornadaId: string; periodo1: string; periodo2: string; gradoId: string;
  g1: string; g2: string; d1: string; d2: string; pf: string; materiaId: string; s1: string; s2: string;
  al1: string; al2: string; i1: string; i2: string; pa1: string; incidencia1: string; incidencia2: string;
  cobertura2: string; banco: string; hoy: string; diaHoy: number;
}

/** Fecha de hoy en la zona de la escuela y su día ISO (1 = lunes … 7 = domingo). */
export function hoyEnMexico(): { hoy: string; dia: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${f}T12:00:00Z`).getUTCDay();
  return { hoy: f, dia: d === 0 ? 7 : d };
}

function haceDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function sembrar(bd: Pool, escuelaId: string): Promise<Semilla> {
  const repos = crearRepositoriosPg(await leerColumnas(bd));
  const ahora = new Date().toISOString();
  const meta = () => ({ id: randomUUID(), creadoEn: ahora, actualizadoEn: ahora, version: 1 });
  const { hoy, dia } = hoyEnMexico();
  const semanaPasada = haceDias(hoy, 7);
  const c = await bd.connect();
  try {
    await c.query('BEGIN');
    const s = await conCliente(c, async () => {
      const E = { escuelaId };
      const ciclo = { ...meta(), ...E, nombre: '2026-2027', fechaInicio: haceDias(hoy, 60), fechaFin: haceDias(hoy, -200), estado: 'activo' as const };
      await repos.ciclos.insertar(ciclo);
      const C = { ...E, cicloEscolarId: ciclo.id };
      const turno = { ...meta(), ...C, nombre: 'Matutino' }; await repos.turnos.insertar(turno);
      const jornada = { ...meta(), ...C, turnoId: turno.id, horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5, 6, 7] as (1 | 2 | 3 | 4 | 5 | 6 | 7)[] };
      await repos.jornadas.insertar(jornada);
      const p1 = { ...meta(), ...C, jornadaId: jornada.id, nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' };
      const p2 = { ...meta(), ...C, jornadaId: jornada.id, nombre: 'Módulo 2', horaInicio: '07:50', horaFin: '08:40' };
      await repos.periodos.insertar(p1); await repos.periodos.insertar(p2);
      await repos.recesos.insertar({ ...meta(), ...C, jornadaId: jornada.id, nombre: 'Receso', horaInicio: '10:30', horaFin: '11:00' });
      const grado = { ...meta(), ...C, numero: 1, nombre: 'Primer grado' }; await repos.grados.insertar(grado);
      const g1 = { ...meta(), ...C, gradoId: grado.id, turnoId: turno.id, nombre: 'A', capacidad: 35, activo: true };
      const g2 = { ...meta(), ...C, gradoId: grado.id, turnoId: turno.id, nombre: 'B', capacidad: 35, activo: true };
      await repos.grupos.insertar(g1); await repos.grupos.insertar(g2);
      const persona = (nombre: string, funciones: ('docente' | 'prefectura')[]) => ({ ...meta(), ...E, nombre, primerApellido: 'Ficticio', segundoApellido: null, numeroEmpleado: `E-${nombre}`, funciones, activo: true, observaciones: 'Observación administrativa ficticia' });
      const d1 = persona('Docente Uno', ['docente']); const d2 = persona('Docente Dos', ['docente']); const pf = persona('Prefecto', ['prefectura']);
      for (const p of [d1, d2, pf]) await repos.personal.insertar(p);
      const materia = { ...meta(), ...C, nombre: 'Matemáticas', abreviatura: 'MAT', tipo: 'materia' as const, activo: true }; await repos.materias.insertar(materia);
      const a1 = { ...meta(), ...C, grupoId: g1.id, materiaId: materia.id, personalId: d1.id, horasSemana: 5 };
      const a2 = { ...meta(), ...C, grupoId: g2.id, materiaId: materia.id, personalId: d2.id, horasSemana: 5 };
      await repos.asignaciones.insertar(a1); await repos.asignaciones.insertar(a2);
      const diaHoy = dia as 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const s1 = { ...meta(), ...C, asignacionId: a1.id, grupoId: g1.id, personalId: d1.id, dia: diaHoy, periodoId: p1.id, origen: 'manual' as const };
      const s2 = { ...meta(), ...C, asignacionId: a2.id, grupoId: g2.id, personalId: d2.id, dia: diaHoy, periodoId: p2.id, origen: 'manual' as const };
      await repos.sesiones.insertar(s1); await repos.sesiones.insertar(s2);
      const otroDia = (((dia % 7) + 1)) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
      for (const [personalId, periodo] of [[d1.id, p1], [d2.id, p2]] as const) {
        await repos.actividades.insertar({ ...meta(), ...C, tipo: 'servicio', personalId, grupoId: null, periodoId: periodo.id, dia: otroDia, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin, descripcion: 'Guardia ficticia', confirmada: true, confirmadaEn: ahora, origen: 'manual' });
        await repos.excepciones.insertar({ ...meta(), ...C, personalId, dia: otroDia, horaInicio: '12:00', horaFin: '12:50', motivo: 'Taller conjunto ficticio' });
        await repos.adscripciones.insertar({ ...meta(), ...C, personalId, turnoIds: [turno.id], materiaIds: [materia.id] });
      }
      for (const g of [g1, g2]) await repos.confirmaciones.insertar({ ...meta(), ...C, grupoId: g.id });
      await repos.bitacora.insertar({ ...meta(), ...C, entidad: 'horario_grupo', entidadId: g1.id, accion: 'confirmar', motivo: null, detalle: 'Confirmación ficticia' });
      const al1 = { ...meta(), ...E, nombre: 'Alumna', primerApellido: 'Ficticia', segundoApellido: 'Uno', matricula: `M-${randomUUID().slice(0, 8)}`, curp: null, observaciones: null };
      const al2 = { ...meta(), ...E, nombre: 'Alumno', primerApellido: 'Ficticio', segundoApellido: 'Dos', matricula: `M-${randomUUID().slice(0, 8)}`, curp: null, observaciones: null };
      await repos.alumnos.insertar(al1); await repos.alumnos.insertar(al2);
      const i1 = { ...meta(), ...C, alumnoId: al1.id, turnoId: turno.id, gradoId: grado.id, grupoId: g1.id, estado: 'inscrito' as const, numeroLista: 1 };
      const i2 = { ...meta(), ...C, alumnoId: al2.id, turnoId: turno.id, gradoId: grado.id, grupoId: g2.id, estado: 'inscrito' as const, numeroLista: 1 };
      await repos.inscripciones.insertar(i1); await repos.inscripciones.insertar(i2);
      for (const [ins, g] of [[i1, g1], [i2, g2]] as const) await repos.movimientos.insertar({ ...meta(), ...C, alumnoId: ins.alumnoId, inscripcionId: ins.id, tipo: 'alta', grupoAnteriorId: null, grupoNuevoId: g.id, motivo: null });
      await repos.importaciones.insertar({ ...meta(), ...C, tipo: 'alumnos', archivo: 'alumnos-ficticios.xlsx', hoja: 'Hoja1', huella: 'a'.repeat(64), resultado: { nuevos: 2, actualizados: 0, omitidos: 0 } });
      await repos.plantillasImportacion.insertar({ ...meta(), ...E, nombre: 'Plantilla ficticia', tipo: 'horarios', estructura: 'sabana_grupo', columnas: [{ encabezado: 'dia', campo: 'dia' }], umbralConfianza: 0.6 });
      const pases = [];
      for (const [s, g, d, al] of [[s1, g1, d1, al1], [s2, g2, d2, al2]] as const) {
        const pase = { ...meta(), ...C, grupoId: g.id, sesionId: s.id, asignacionId: s.asignacionId, personalId: d.id, fecha: semanaPasada, horaInicio: '07:00', horaFin: '07:50', guardadoEn: ahora, correcciones: 1 };
        await repos.pases.insertar(pase); pases.push(pase);
        await repos.asistencias.insertar({ ...meta(), ...C, paseId: pase.id, grupoId: g.id, alumnoId: al.id, fecha: semanaPasada, marca: 'R', horaLlegada: '07:10' });
        await repos.cambiosAsistencia.insertar({ ...meta(), ...C, paseId: pase.id, grupoId: g.id, alumnoId: al.id, marcaAnterior: 'F', marcaNueva: 'R', llegadaAnterior: null, llegadaNueva: '07:10', personalId: d.id });
        await repos.salidas.insertar({ ...meta(), ...C, grupoId: g.id, alumnoId: al.id, sesionId: s.id, fecha: semanaPasada, salida: '07:20', regreso: '07:25', personalId: d.id, periodoId: s.periodoId });
        await repos.reportes.insertar({ ...meta(), ...C, grupoId: g.id, alumnoId: al.id, personalId: d.id, sesionId: s.id, fecha: semanaPasada, tipo: 'reconocimiento', texto: 'Participación ficticia destacada', hora: '07:30', estado: 'abierta' });
      }
      const incidencias = [];
      for (const d of [d1, d2]) {
        const inc = { ...meta(), ...C, personalId: d.id, fecha: semanaPasada, tipo: 'retardo' as const, tipoOtro: null, alcance: 'jornada' as const, periodoIds: [], observaciones: null, estado: 'reportada' as const, registradaPor: pf.id, validadaPor: null, validadaEn: null, motivoValidacion: null };
        await repos.incidenciasPersonal.insertar(inc); incidencias.push(inc);
      }
      const banco = { ...meta(), ...C, materiaId: materia.id, gradoId: grado.id, titulo: 'Ejercicios ficticios', descripcion: 'Hoja de ejercicios ficticios', archivo: null, fecha: semanaPasada, responsable: null, estado: 'propuesta' as const };
      await repos.bancoActividades.insertar(banco);
      const coberturas = [];
      for (const [s, g, ausente, asignado] of [[s1, g1, d1, null], [s2, g2, d2, pf.id]] as const) {
        const co = { ...meta(), ...C, sesionId: s.id, fecha: semanaPasada, grupoId: g.id, periodoId: s.periodoId, docenteAusenteId: ausente.id, incidenciaId: null, propuestoIds: asignado ? [asignado] : [], asignadoId: asignado, actividadId: null, actividadTexto: null, autorizadoPor: asignado ? 'Administración ficticia' : null, autorizadoEn: asignado ? ahora : null, estado: asignado ? 'asignada' as const : 'sin_docente' as const, observaciones: null };
        await repos.coberturas.insertar(co); coberturas.push(co);
      }
      for (const p of [pf, d1]) await repos.bitacoraPrefectura.insertar({ ...meta(), ...C, entidad: 'cobertura', entidadId: coberturas[0]!.id, accion: 'registrar', detalle: null, personalId: p.id, orden: Date.now() * 1000 });
      return {
        escuelaId, cicloId: ciclo.id, turnoId: turno.id, jornadaId: jornada.id, periodo1: p1.id, periodo2: p2.id, gradoId: grado.id, g1: g1.id, g2: g2.id,
        d1: d1.id, d2: d2.id, pf: pf.id, materiaId: materia.id, s1: s1.id, s2: s2.id, al1: al1.id, al2: al2.id, i1: i1.id, i2: i2.id, pa1: pases[0]!.id,
        incidencia1: incidencias[0]!.id, incidencia2: incidencias[1]!.id, cobertura2: coberturas[1]!.id, banco: banco.id, hoy, diaHoy: dia,
      };
    });
    await c.query('COMMIT');
    return s;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
