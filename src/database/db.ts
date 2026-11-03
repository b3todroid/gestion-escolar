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
import type {
  Actividad, Ajuste, Alumno, Asistencia, PaseLista, ReporteAlumno, SalidaAula, Asignacion, CicloEscolar, ConfirmacionHorario, Escuela, Excepcion, Grado, Grupo, Jornada, Materia, Periodo, Personal,
  Receso, RegistroBitacora, Sesion, Turno,
} from '../models';

export const NOMBRE_BD = 'gestion-escolar';
/** Versión actual del esquema (debe coincidir con la última this.version(n)). */
export const VERSION_ESQUEMA = 4;

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

    // Para fases futuras: agregar this.version(5) (con .upgrade() si hay que transformar
    // datos sin perderlos) y documentarlo en docs/MODELO_DATOS.md.
  }
}
