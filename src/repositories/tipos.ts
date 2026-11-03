/**
 * Contratos de repositorio. Los servicios dependen de estas interfaces,
 * no de Dexie. En una fase futura se podrá crear una implementación
 * que combine el almacenamiento local con un backend seguro (sincronización).
 */
import type {
  Actividad, Adscripcion, Ajuste, Inscripcion, MovimientoInscripcion, RegistroImportacion, Alumno, Asistencia, PaseLista, ReporteAlumno, SalidaAula, Asignacion, CicloEscolar, ConfirmacionHorario, Escuela, Excepcion, RegistroBitacora, Grado, Grupo, Jornada, Materia, Metadatos, Periodo, Personal, Receso, Sesion, Turno, CambioAsistencia, PlantillaImportacion, IncidenciaPersonal, Cobertura, ActividadBanco, RegistroPrefectura } from '../models';

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
  cambiosAsistencia: Repositorio<CambioAsistencia>;
  plantillasImportacion: Repositorio<PlantillaImportacion>;
  incidenciasPersonal: Repositorio<IncidenciaPersonal>;
  coberturas: Repositorio<Cobertura>;
  bancoActividades: Repositorio<ActividadBanco>;
  bitacoraPrefectura: Repositorio<RegistroPrefectura>;
  adscripciones: Repositorio<Adscripcion>;
  inscripciones: Repositorio<Inscripcion>;
  movimientos: Repositorio<MovimientoInscripcion>;
  importaciones: Repositorio<RegistroImportacion>;
}

/** Ejecuta varias operaciones de forma atómica (todo o nada). */
export interface UnidadDeTrabajo {
  ejecutar<R>(operacion: () => Promise<R>): Promise<R>;
}

// ===================== Fase 8D · Sincronización =====================

/** Estado de un cambio local en la cola: por enviar, o devuelto por el servidor para que una persona decida. */
export type EstadoPendiente = 'pendiente' | 'conflicto' | 'rechazado';

/** Cambio hecho en el dispositivo (en la MISMA transacción que el dato) que falta enviar al servidor. */
export interface CambioPendiente {
  orden?: number; // autoincremental: conserva el orden en que ocurrieron
  opId: string;
  /** Cambios de la misma operación local (se aplican todos o ninguno en el servidor). */
  grupo: string;
  escuelaId: string;
  tabla: string;
  operacion: 'guardar' | 'eliminar';
  registroId: string;
  versionBase: number | null;
  datos: Record<string, unknown> | null;
  creadoEn: string;
  estado: EstadoPendiente;
  mensaje: string | null;
  /** Versión del servidor recibida en un conflicto (para comparar). */
  servidor: Record<string, unknown> | null;
}

/** Escuela de este dispositivo que se sincroniza con el servidor escolar. */
export interface VinculoServidor {
  escuelaId: string;
  usuarioId: string;
  /** Última secuencia del servidor ya recibida. */
  cursor: number;
  estado: 'activo' | 'sin_acceso';
  unidoEn: string;
  ultimaRecepcion: string | null;
  ultimoEnvio: string | null;
}

export interface RegistroRemoto { tabla: string; id: string; registro: Record<string, unknown> | null }

export interface ResultadoRemoto { opId: string; estado: 'aplicado' | 'repetido' | 'conflicto' | 'rechazado'; mensaje: string | null; servidor: Record<string, unknown> | null }

/** Almacenamiento local de la sincronización (cola y vínculos). Escribe SIN volver a encolar. */
export interface AlmacenSincronizacion {
  vinculos(): Promise<VinculoServidor[]>;
  vinculo(escuelaId: string): Promise<VinculoServidor | undefined>;
  guardarVinculo(v: VinculoServidor): Promise<void>;
  /** Cambios de la escuela, en orden. */
  cola(escuelaId: string, estados?: EstadoPendiente[]): Promise<CambioPendiente[]>;
  /** Aplica las respuestas del servidor: quita lo aplicado y marca conflictos o rechazos. */
  registrarResultados(resultados: ResultadoRemoto[]): Promise<void>;
  /**
   * Escribe los registros recibidos del servidor SIN encolarlos. No pisa registros con cambios
   * locales sin resolver (a esos sólo les guarda la versión del servidor). `completa` = fotografía:
   * quita además lo local de la escuela que ya no está en el servidor (salvo cambios sin resolver).
   */
  aplicarRemotos(escuelaId: string, cambios: RegistroRemoto[], completa: boolean): Promise<{ aplicados: number; omitidos: number }>;
  /** Descarta el cambio local (y los posteriores del mismo registro) y deja la versión del servidor. */
  usarVersionServidor(opId: string): Promise<void>;
  /** Vuelve a encolar un cambio en conflicto sobre la versión del servidor (decisión explícita). */
  reintentar(opId: string, nuevoOpId: string): Promise<void>;
  /** Quita del dispositivo TODOS los datos de la escuela, su cola y su vínculo. */
  quitarEscuela(escuelaId: string): Promise<void>;
}
