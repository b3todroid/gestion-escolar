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
