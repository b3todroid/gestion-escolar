/**
 * Base de datos local (IndexedDB) gestionada con Dexie.
 *
 * VERSIONADO DEL ESQUEMA
 * - Nunca modificar una versión ya publicada: agregar `this.version(n + 1)`.
 * - Las migraciones de datos van en `.upgrade(tx => …)` y deben conservar
 *   la información existente. Nunca borrar tablas o datos como atajo.
 * - Sólo se declaran los campos indexados; el resto del objeto se guarda igual.
 * Ver docs/MODELO_DATOS.md.
 */
import { Dexie, type Table } from 'dexie';
import { nuevoId } from '../utils/id';
import type {
  Actividad, Adscripcion, Ajuste, Alumno, Asistencia, Inscripcion, MovimientoInscripcion, PaseLista, RegistroImportacion, ReporteAlumno, SalidaAula, Asignacion, CicloEscolar, ConfirmacionHorario, Escuela, Excepcion, Grado, Grupo, Jornada, Materia, Periodo, Personal,
  Receso, RegistroBitacora, Sesion, Turno, CambioAsistencia } from '../models';

export const NOMBRE_BD = 'gestion-escolar';
/** Versión actual del esquema (debe coincidir con la última this.version(n)). */
export const VERSION_ESQUEMA = 8;

export class BaseDatosEscolar extends Dexie {
  escuelas!: Table<Escuela, string>;
  ciclosEscolares!: Table<CicloEscolar, string>;
  turnos!: Table<Turno, string>;
  jornadas!: Table<Jornada, string>;
  periodos!: Table<Periodo, string>;
  recesos!: Table<Receso, string>;
  grados!: Table<Grado, string>;
  grupos!: Table<Grupo, string>;
  personal!: Table<Personal, string>;
  materias!: Table<Materia, string>;
  asignaciones!: Table<Asignacion, string>;
  sesiones!: Table<Sesion, string>;
  actividades!: Table<Actividad, string>;
  excepciones!: Table<Excepcion, string>;
  confirmaciones!: Table<ConfirmacionHorario, string>;
  bitacora!: Table<RegistroBitacora, string>;
  alumnos!: Table<Alumno, string>;
  pases!: Table<PaseLista, string>;
  asistencias!: Table<Asistencia, string>;
  salidas!: Table<SalidaAula, string>;
  reportes!: Table<ReporteAlumno, string>;
  ajustes!: Table<Ajuste, string>;
  cambiosAsistencia!: Table<CambioAsistencia, string>;
  adscripciones!: Table<Adscripcion, string>;
  inscripciones!: Table<Inscripcion, string>;
  movimientos!: Table<MovimientoInscripcion, string>;
  importaciones!: Table<RegistroImportacion, string>;

  constructor(nombre: string = NOMBRE_BD) {
    super(nombre);

    // Versión 1 — Fase 1: configuración escolar.
    this.version(1).stores({
      escuelas: 'id, cct',
      ciclosEscolares: 'id, escuelaId, [escuelaId+estado]',
      turnos: 'id, cicloEscolarId, escuelaId',
      jornadas: 'id, &turnoId, cicloEscolarId',
      periodos: 'id, jornadaId, cicloEscolarId',
      recesos: 'id, jornadaId, cicloEscolarId',
      grados: 'id, cicloEscolarId, [cicloEscolarId+numero]',
      grupos: 'id, cicloEscolarId, gradoId, turnoId',
    });

    // Versión 2 — Fase 2: personal, materias, asignaciones y horario semanal.
    // Sólo agrega tablas; las de la versión 1 y sus datos no se modifican.
    this.version(2).stores({
      personal: 'id, escuelaId',
      materias: 'id, cicloEscolarId, escuelaId',
      asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId',
      sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId',
    });

    // Versión 3 — Fase 3: actividades (servicio/otra), casos especiales,
    // confirmación de horarios y bitácora. Sólo agrega tablas.
    this.version(3).stores({
      actividades: 'id, cicloEscolarId, personalId, grupoId',
      excepciones: 'id, cicloEscolarId, personalId',
      confirmaciones: 'id, &grupoId, cicloEscolarId',
      bitacora: 'id, cicloEscolarId, entidadId',
    });

    // Versión 4 — Fase 4: alumnos, pase de lista, salidas del aula, reportes y ajustes.
    // Sólo agrega tablas. Un pase por clase y fecha: índice único [sesionId+fecha].
    this.version(4).stores({
      alumnos: 'id, grupoId, cicloEscolarId, escuelaId',
      pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId',
      asistencias: 'id, paseId, alumnoId, grupoId',
      salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId',
      reportes: 'id, alumnoId, grupoId, cicloEscolarId',
      ajustes: 'id',
    });

    // Versión 5 — Fase 1 ampliada: datos del plantel (nombre corto, entidad, zona, sector,
    // domicilio, teléfono, correo, logotipo) y grupos activables. No cambia índices:
    // la migración sólo COMPLETA los campos nuevos en los registros existentes.
    this.version(5).stores({}).upgrade(async (tx) => {
      await tx.table('escuelas').toCollection().modify((e: Record<string, unknown>) => {
        for (const c of ['nombreCorto', 'entidad', 'zonaEscolar', 'sector', 'domicilio', 'telefono', 'correo', 'logotipo']) if (e[c] === undefined) e[c] = null;
      });
      await tx.table('grupos').toCollection().modify((g: Record<string, unknown>) => { if (g['activo'] === undefined) g['activo'] = true; });
    });

    // Versión 6 — Catálogos e importación: identidad del alumno separada de su
    // inscripción por ciclo; adscripciones del personal; tipos de materia; registro
    // de importaciones. La migración NO borra información: la mueve.
    this.version(6).stores({
      alumnos: 'id, escuelaId', // antes también por grupo y ciclo: eso pasa a la inscripción
      inscripciones: 'id, alumnoId, cicloEscolarId, grupoId, escuelaId, &[alumnoId+cicloEscolarId]',
      movimientos: 'id, alumnoId, cicloEscolarId',
      adscripciones: 'id, personalId, cicloEscolarId, &[personalId+cicloEscolarId]',
      importaciones: 'id, escuelaId, cicloEscolarId',
    }).upgrade(async (tx) => {
      const ahora = new Date().toISOString();
      const meta = () => ({ id: nuevoId(), creadoEn: ahora, actualizadoEn: ahora, version: 1 });
      const grupos = new Map((await tx.table('grupos').toArray()).map((g: { id: string; gradoId: string; turnoId: string }) => [g.id, g]));
      const inscripciones: unknown[] = [];
      const movimientos: unknown[] = [];
      await tx.table('alumnos').toCollection().modify((a: Record<string, unknown>) => {
        if (a['cicloEscolarId'] !== undefined) {
          const g = grupos.get(a['grupoId'] as string);
          const ins = {
            ...meta(), escuelaId: a['escuelaId'], cicloEscolarId: a['cicloEscolarId'], alumnoId: a['id'],
            turnoId: g?.turnoId ?? null, gradoId: g?.gradoId ?? null, grupoId: a['grupoId'] ?? null,
            estado: a['activo'] === false ? 'baja' : 'inscrito', numeroLista: null,
          };
          inscripciones.push(ins);
          movimientos.push({ ...meta(), escuelaId: a['escuelaId'], cicloEscolarId: a['cicloEscolarId'], alumnoId: a['id'], inscripcionId: ins.id, tipo: 'migracion', grupoAnteriorId: null, grupoNuevoId: ins.grupoId, motivo: 'Migración a la versión 6 (identidad e inscripción separadas)' });
          delete a['cicloEscolarId']; delete a['grupoId']; delete a['activo'];
        }
        for (const c of ['matricula', 'curp', 'observaciones']) if (a[c] === undefined) a[c] = null;
      });
      await tx.table('inscripciones').bulkAdd(inscripciones);
      await tx.table('movimientos').bulkAdd(movimientos);
      await tx.table('personal').toCollection().modify((p: Record<string, unknown>) => { if (p['observaciones'] === undefined) p['observaciones'] = null; });
      await tx.table('materias').toCollection().modify((m: Record<string, unknown>) => {
        if (m['tipo'] === undefined) m['tipo'] = 'materia';
        if (m['activo'] === undefined) m['activo'] = true;
      });
    });

    // v7 (Fase 3 · horarios): origen de cada clase y actividad (manual / importación).
    // Sin cambios de índices. Los registros anteriores quedan con origen null
    // («registro anterior»): no se inventa un origen que no se guardó.
    this.version(7).stores({}).upgrade(async (tx) => {
      for (const t of ['sesiones', 'actividades']) {
        await tx.table(t).toCollection().modify((r: Record<string, unknown>) => { if (r['origen'] === undefined) r['origen'] = null; });
      }
    });

    // v8 (Fase 4 · módulo docente): historial de correcciones de asistencia;
    // salidas con docente y periodo; incidencias con hora y estado; pases con
    // contador de correcciones. Nada se borra: se completan campos.
    this.version(8).stores({
      cambiosAsistencia: 'id, paseId, alumnoId, cicloEscolarId',
    }).upgrade(async (tx) => {
      const sesiones = new Map((await tx.table('sesiones').toArray()).map((s: { id: string; personalId: string | null; periodoId: string }) => [s.id, s]));
      await tx.table('salidas').toCollection().modify((r: Record<string, unknown>) => {
        const s = sesiones.get(r['sesionId'] as string);
        if (r['personalId'] === undefined) r['personalId'] = s?.personalId ?? null;
        if (r['periodoId'] === undefined) r['periodoId'] = s?.periodoId ?? null;
      });
      await tx.table('reportes').toCollection().modify((r: Record<string, unknown>) => {
        if (r['hora'] === undefined) r['hora'] = null; // no se inventa una hora que no se registró
        if (r['estado'] === undefined) r['estado'] = 'abierta';
      });
      await tx.table('pases').toCollection().modify((r: Record<string, unknown>) => { if (r['correcciones'] === undefined) r['correcciones'] = 0; });
    });

    // Para fases futuras: agregar this.version(9) (con .upgrade() si hay que transformar
    // datos sin perderlos) y documentarlo en docs/MODELO_DATOS.md.
  }
}
