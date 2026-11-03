/**
 * Contratos de repositorio. Los servicios dependen de estas interfaces,
 * no de Dexie. En una fase futura se podrá crear una implementación
 * que combine el almacenamiento local con un backend seguro (sincronización).
 */
import type {
  Actividad, Adscripcion, Ajuste, Inscripcion, MovimientoInscripcion, RegistroImportacion, Alumno, Asistencia, PaseLista, ReporteAlumno, SalidaAula, Asignacion, CicloEscolar, ConfirmacionHorario, Escuela, Excepcion, RegistroBitacora, Grado, Grupo, Jornada, Materia, Metadatos, Periodo, Personal, Receso, Sesion, Turno,
} from '../models';

export interface Repositorio<T extends Metadatos> {
  obtener(id: string): Promise<T | undefined>;
  listarTodos(): Promise<T[]>;
  /** Registros cuyo campo indexado `campo` es igual a `valor`. */
  listarPor<K extends keyof T & string>(campo: K, valor: T[K]): Promise<T[]>;
  contarPor<K extends keyof T & string>(campo: K, valor: T[K]): Promise<number>;
  insertar(entidad: T): Promise<void>;
  /** Inserción masiva (restauración de respaldos). Falla si algún id ya existe. */
  insertarVarios(entidades: T[]): Promise<void>;
  actualizar(entidad: T): Promise<void>;
  eliminar(id: string): Promise<void>;
  eliminarVarios(ids: string[]): Promise<void>;
}

export interface Repositorios {
  escuelas: Repositorio<Escuela>;
  ciclos: Repositorio<CicloEscolar>;
  turnos: Repositorio<Turno>;
  jornadas: Repositorio<Jornada>;
  periodos: Repositorio<Periodo>;
  recesos: Repositorio<Receso>;
  grados: Repositorio<Grado>;
  grupos: Repositorio<Grupo>;
  personal: Repositorio<Personal>;
  materias: Repositorio<Materia>;
  asignaciones: Repositorio<Asignacion>;
  sesiones: Repositorio<Sesion>;
  actividades: Repositorio<Actividad>;
  excepciones: Repositorio<Excepcion>;
  confirmaciones: Repositorio<ConfirmacionHorario>;
  bitacora: Repositorio<RegistroBitacora>;
  alumnos: Repositorio<Alumno>;
  pases: Repositorio<PaseLista>;
  asistencias: Repositorio<Asistencia>;
  salidas: Repositorio<SalidaAula>;
  reportes: Repositorio<ReporteAlumno>;
  ajustes: Repositorio<Ajuste>;
  adscripciones: Repositorio<Adscripcion>;
  inscripciones: Repositorio<Inscripcion>;
  movimientos: Repositorio<MovimientoInscripcion>;
  importaciones: Repositorio<RegistroImportacion>;
}

/** Ejecuta varias operaciones de forma atómica (todo o nada). */
export interface UnidadDeTrabajo {
  ejecutar<R>(operacion: () => Promise<R>): Promise<R>;
}
