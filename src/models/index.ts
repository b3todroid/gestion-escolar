/**
 * Entidades persistidas. Todas usan `id` interno (UUID), nunca nombres.
 * Los metadatos (creadoEn, actualizadoEn, version) preparan la futura
 * sincronización con un backend (detección de cambios y conflictos).
 */

export interface Metadatos {
  id: string;
  creadoEn: string; // ISO 8601
  actualizadoEn: string; // ISO 8601
  version: number; // se incrementa en cada actualización
}

export const NIVELES_EDUCATIVOS = ['inicial', 'preescolar', 'primaria', 'secundaria', 'media_superior', 'otro'] as const;
export type NivelEducativo = (typeof NIVELES_EDUCATIVOS)[number];

export const ESTADOS_CICLO = ['planeacion', 'activo', 'cerrado'] as const;
export type EstadoCiclo = (typeof ESTADOS_CICLO)[number];

/** 1 = lunes … 7 = domingo (ISO 8601). */
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Escuela extends Metadatos {
  nombre: string; // nombre oficial
  nombreCorto: string | null;
  cct: string | null; // Clave de Centro de Trabajo SEP (formato validado; no se afirma que exista)
  nivel: NivelEducativo;
  entidad: string | null; // clave INEGI de dos dígitos ('01'…'32')
  localidad: string | null; // municipio o alcaldía
  zonaEscolar: string | null;
  sector: string | null;
  domicilio: string | null;
  telefono: string | null; // 10 dígitos
  correo: string | null;
  logotipo: string | null; // imagen reducida como data URL (png/jpeg/webp)
}

export interface CicloEscolar extends Metadatos {
  escuelaId: string;
  nombre: string; // p. ej. "2026-2027"
  fechaInicio: string; // AAAA-MM-DD
  fechaFin: string;
  estado: EstadoCiclo;
}

export interface Turno extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  nombre: string; // Matutino, Vespertino…
}

/** Horario general de un turno. Relación 1:1 con Turno. */
export interface Jornada extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  turnoId: string;
  horaInicio: string; // HH:MM
  horaFin: string;
  dias: DiaSemana[];
}

/** Bloque de clase (módulo) dentro de una jornada. */
export interface Periodo extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  jornadaId: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
}

export interface Receso extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  jornadaId: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
}

export interface Grado extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  numero: number; // 1, 2, 3…
  nombre: string; // "Primer grado"
}

export interface Grupo extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  gradoId: string;
  turnoId: string;
  nombre: string; // "A", "B"…
  capacidad: number | null;
  activo: boolean; // un grupo desactivado conserva sus datos pero no recibe nuevos registros
}

/** Datos de entrada (sin metadatos ni claves de ámbito). */
export type Datos<T extends Metadatos> = Omit<T, keyof Metadatos | 'escuelaId' | 'cicloEscolarId'>;

// ===================== Fase 2 =====================

/** Funciones vigentes (las que se ofrecen al capturar). */
export const FUNCIONES_VIGENTES = [
  'docente', 'prefectura', 'direccion', 'subdireccion_academica', 'subdireccion_gestion', 'orientacion',
  'trabajo_social', 'udei', 'secretaria', 'asistencia_escolar', 'biblioteca', 'otro',
] as const;
/**
 * Funciones anteriores (versión 4). Se conservan tal cual: convertirlas
 * automáticamente sería inventar datos («Directivo» puede ser Dirección o
 * Subdirección). Se muestran y se pueden cambiar a mano.
 */
export const FUNCIONES_ANTERIORES = ['directivo', 'administrativo', 'apoyo'] as const;
export const FUNCIONES_PERSONAL = [...FUNCIONES_VIGENTES, ...FUNCIONES_ANTERIORES] as const;
export type FuncionPersonal = (typeof FUNCIONES_PERSONAL)[number];

/**
 * Persona que trabaja en la escuela. Pertenece a la escuela (no al ciclo):
 * se captura una vez y se reutiliza en todos los ciclos.
 * «Docente» es una función, no una entidad aparte, para no duplicar personas.
 * Datos mínimos a propósito: no se piden CURP, RFC, teléfono ni domicilio.
 */
export interface Personal extends Metadatos {
  escuelaId: string;
  nombre: string;
  primerApellido: string;
  segundoApellido: string | null;
  numeroEmpleado: string | null; // clave interna opcional
  funciones: FuncionPersonal[];
  activo: boolean;
  observaciones: string | null; // administrativas, no sensibles
}

/**
 * Adscripción de una persona a un ciclo: turnos en los que trabaja y, para
 * docentes, materias que PUEDE impartir (no son asignaciones a grupos).
 */
export interface Adscripcion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  personalId: string;
  turnoIds: string[];
  materiaIds: string[];
}

export const TIPOS_MATERIA = ['materia', 'campo_formativo', 'taller', 'tutoria', 'actividad_especial', 'servicio'] as const;
export type TipoMateria = (typeof TIPOS_MATERIA)[number];

export interface Materia extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  nombre: string;
  abreviatura: string | null;
  tipo: TipoMateria; // «servicio» (SE) es un tipo de actividad, no una materia frente a grupo
  activo: boolean;
}

/** Qué materia recibe un grupo, con qué docente y cuántas horas por semana. */
export interface Asignacion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  grupoId: string;
  materiaId: string;
  personalId: string | null; // null = docente pendiente
  horasSemana: number;
}

/** Origen de un registro de horario. null = registro anterior a la versión 7 (origen no guardado). */
export const ORIGENES_HORARIO = ['manual', 'importacion'] as const;
export type OrigenHorario = (typeof ORIGENES_HORARIO)[number];

/** Una celda del horario semanal: una asignación en un día y periodo. */
export interface Sesion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  asignacionId: string;
  grupoId: string; // desnormalizado para consultas
  personalId: string | null; // desnormalizado para detectar choques del docente
  dia: DiaSemana;
  periodoId: string;
  origen: OrigenHorario | null;
}

// ===================== Fase 3 =====================

/**
 * Actividad que no es clase:
 * - de docente (personalId): «servicio» u «otra»; horario libre dentro del día.
 *   Una hora de servicio sólo cuenta como tal cuando está CONFIRMADA:
 *   un espacio vacío nunca se interpreta como servicio.
 * - de grupo (grupoId + periodoId): «otra» (p. ej. honores, ceremonia) en un periodo.
 */
export const TIPOS_ACTIVIDAD = ['servicio', 'otra'] as const;
export type TipoActividad = (typeof TIPOS_ACTIVIDAD)[number];

export interface Actividad extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  tipo: TipoActividad;
  personalId: string | null;
  grupoId: string | null;
  periodoId: string | null;
  dia: DiaSemana;
  horaInicio: string;
  horaFin: string;
  descripcion: string;
  confirmada: boolean;
  confirmadaEn: string | null;
  origen: OrigenHorario | null;
}

/**
 * Caso especial configurado explícitamente: permite que un docente atienda
 * grupos simultáneos en un día y franja (p. ej. taller con dos grupos juntos).
 */
export interface Excepcion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  personalId: string;
  dia: DiaSemana;
  horaInicio: string;
  horaFin: string;
  motivo: string;
}

/** Horario de grupo confirmado: queda bloqueado hasta que alguien lo reabra con motivo. */
export interface ConfirmacionHorario extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  grupoId: string;
}

/** Registro de acciones que requieren autorización (base para auditoría futura). */
export interface RegistroBitacora extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  entidad: 'horario_grupo' | 'actividad';
  entidadId: string;
  accion: 'confirmar' | 'reabrir' | 'importar';
  motivo: string | null;
  detalle: string | null;
}

// ===================== Fase 4 =====================

/**
 * Alumno de un grupo en un ciclo. Datos mínimos a propósito:
 * no se guardan CURP, fecha de nacimiento ni datos de contacto.
 */
/**
 * IDENTIDAD del alumno en la escuela (no cambia de un ciclo a otro).
 * Datos mínimos: no se guarda información médica ni otros datos sensibles.
 * La CURP es opcional y sólo debe capturarse cuando haya necesidad justificada.
 */
export interface Alumno extends Metadatos {
  escuelaId: string;
  nombre: string;
  primerApellido: string;
  segundoApellido: string | null;
  matricula: string | null; // matrícula institucional (única en la escuela)
  curp: string | null;
  observaciones: string | null; // administrativas, no sensibles
}

export const ESTADOS_INSCRIPCION = ['inscrito', 'baja'] as const;
export type EstadoInscripcion = (typeof ESTADOS_INSCRIPCION)[number];

/** INSCRIPCIÓN del alumno en un ciclo: turno, grado y grupo (pueden faltar). Una por alumno y ciclo. */
export interface Inscripcion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  alumnoId: string;
  turnoId: string | null;
  gradoId: string | null;
  grupoId: string | null; // null = sin grupo
  estado: EstadoInscripcion;
  numeroLista: number | null;
}

/** Historial de cambios de la inscripción (altas, cambios de grupo, bajas). */
export interface MovimientoInscripcion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  alumnoId: string;
  inscripcionId: string;
  tipo: 'alta' | 'cambio_grupo' | 'baja' | 'reactivacion' | 'migracion';
  grupoAnteriorId: string | null;
  grupoNuevoId: string | null;
  motivo: string | null;
}

/** Alumno con su inscripción en un ciclo (vista de trabajo). */
export interface AlumnoInscrito extends Alumno {
  inscripcion: Inscripcion;
  grupoId: string | null;
  activo: boolean; // inscripción vigente
}

/** Registro de cada importación aplicada (origen, fecha, tipo y resultado). */
export const TIPOS_REGISTRO_IMPORTACION = ['alumnos', 'docentes', 'personal', 'materias', 'grupos', 'horarios'] as const;

export interface RegistroImportacion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  tipo: (typeof TIPOS_REGISTRO_IMPORTACION)[number];
  archivo: string;
  hoja: string | null;
  huella: string | null; // SHA-256 del archivo, para advertir reimportaciones
  resultado: { nuevos: number; actualizados: number; omitidos: number };
}

export const MARCAS_ASISTENCIA = ['P', 'F', 'R'] as const;
export type MarcaAsistencia = (typeof MARCAS_ASISTENCIA)[number];

/**
 * Pase de lista de una clase (sesión del horario) en una fecha.
 * Sólo existe cuando el docente lo GUARDA; abrir la lista no lo crea.
 */
export interface PaseLista extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  grupoId: string;
  sesionId: string;
  asignacionId: string;
  personalId: string | null;
  fecha: string; // AAAA-MM-DD
  horaInicio: string; // copia del periodo al momento de guardar
  horaFin: string;
  guardadoEn: string; // fecha y hora del último guardado (el primero es creadoEn)
  /** Veces que se corrigió después del primer guardado (0 = GUARDADA, > 0 = MODIFICADA). */
  correcciones: number;
}

/** Historial de correcciones del pase de lista (una fila por alumno cuya marca cambió). */
export interface CambioAsistencia extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  paseId: string;
  grupoId: string;
  alumnoId: string;
  marcaAnterior: MarcaAsistencia;
  marcaNueva: MarcaAsistencia;
  llegadaAnterior: string | null;
  llegadaNueva: string | null;
  /** Docente configurado en el dispositivo al corregir (no es autenticación). */
  personalId: string | null;
}

export interface Asistencia extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  paseId: string;
  grupoId: string;
  alumnoId: string;
  fecha: string;
  marca: MarcaAsistencia;
  horaLlegada: string | null; // sólo para R (HH:MM)
}

/** Salida del aula (baño) y su reincorporación. */
export interface SalidaAula extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  grupoId: string;
  alumnoId: string;
  sesionId: string;
  fecha: string;
  salida: string; // HH:MM
  regreso: string | null; // HH:MM; null = sigue fuera
  personalId: string | null; // docente que registró (o el de la clase)
  periodoId: string | null; // periodo de la clase
}

export const TIPOS_REPORTE = ['conducta', 'academico', 'reconocimiento', 'otro'] as const;
export type TipoReporte = (typeof TIPOS_REPORTE)[number];

/** Reporte breve de un alumno (máx. 280 caracteres). */
export interface ReporteAlumno extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  grupoId: string;
  alumnoId: string;
  personalId: string | null;
  sesionId: string | null;
  fecha: string;
  tipo: TipoReporte;
  texto: string;
  hora: string | null; // HH:MM; null en registros anteriores a v8
  estado: EstadoIncidencia;
}

export const ESTADOS_INCIDENCIA = ['abierta', 'atendida'] as const;
export type EstadoIncidencia = (typeof ESTADOS_INCIDENCIA)[number];

/** Ajustes del dispositivo (p. ej. quién lo usa como docente). No es autenticación. */
export interface Ajuste extends Metadatos {
  valor: string | null;
}

// ===================== Fase 6 =====================

export const ESTRUCTURAS_PLANTILLA = ['automatica', 'lista', 'sabana_grupo', 'sabana_docente'] as const;

/**
 * Plantilla de reconocimiento guardada por escuela: cómo leer un tipo de
 * documento (estructura y correspondencia de columnas por NOMBRE de encabezado,
 * no por posición, para no depender de un formato rígido).
 */
export interface PlantillaImportacion extends Metadatos {
  escuelaId: string;
  nombre: string;
  tipo: (typeof TIPOS_REGISTRO_IMPORTACION)[number];
  estructura: (typeof ESTRUCTURAS_PLANTILLA)[number];
  /** encabezado normalizado → campo (o null = no importar). */
  columnas: { encabezado: string; campo: string | null }[];
  /** Umbral de confianza OCR (0–1) para marcar celdas inciertas. */
  umbralConfianza: number;
}
