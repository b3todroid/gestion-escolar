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
  nombre: string;
  cct: string | null; // Clave de Centro de Trabajo SEP (opcional, formato oficial)
  nivel: NivelEducativo;
  localidad: string | null;
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
}

/** Datos de entrada (sin metadatos ni claves de ámbito). */
export type Datos<T extends Metadatos> = Omit<T, keyof Metadatos | 'escuelaId' | 'cicloEscolarId'>;

// ===================== Fase 2 =====================

export const FUNCIONES_PERSONAL = ['docente', 'directivo', 'administrativo', 'prefectura', 'apoyo'] as const;
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
}

export interface Materia extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  nombre: string;
  abreviatura: string | null;
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

/** Una celda del horario semanal: una asignación en un día y periodo. */
export interface Sesion extends Metadatos {
  escuelaId: string;
  cicloEscolarId: string;
  asignacionId: string;
  grupoId: string; // desnormalizado para consultas
  personalId: string | null; // desnormalizado para detectar choques del docente
  dia: DiaSemana;
  periodoId: string;
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
