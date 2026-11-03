/**
 * Validación de archivos de respaldo. Cada registro se valida con su forma
 * esperada (Zod elimina campos desconocidos). Nada del archivo se guarda
 * sin pasar por aquí.
 */
import { z } from 'zod';
import {
  ESTADOS_CICLO, ESTADOS_INSCRIPCION, FUNCIONES_PERSONAL, MARCAS_ASISTENCIA, NIVELES_EDUCATIVOS, TIPOS_ACTIVIDAD, TIPOS_MATERIA, TIPOS_REPORTE,
} from '../models';

const id = z.string().min(1).max(64);
const texto = (max: number) => z.string().max(max);
const opcional = (max: number) => z.string().max(max).nullable();
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fecha = z.iso.date();
const dia = z.number().int().min(1).max(7);
const marcaTiempo = z.string().min(10).max(40);

const meta = { id, creadoEn: marcaTiempo, actualizadoEn: marcaTiempo, version: z.number().int().min(1) };
const enEscuela = { ...meta, escuelaId: id };
const enCiclo = { ...enEscuela, cicloEscolarId: id };

export const ESQUEMAS_TABLA = {
  escuelas: z.object({
    ...meta, nombre: texto(150), cct: opcional(20), nivel: z.enum(NIVELES_EDUCATIVOS), localidad: opcional(120),
    // Campos de la versión 5; los respaldos anteriores no los tienen.
    nombreCorto: opcional(60).default(null), entidad: opcional(2).default(null), zonaEscolar: opcional(20).default(null), sector: opcional(20).default(null),
    domicilio: opcional(200).default(null), telefono: opcional(10).default(null), correo: opcional(120).default(null),
    logotipo: z.string().max(400_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).nullable().default(null),
  }),
  ciclos: z.object({ ...enEscuela, nombre: texto(40), fechaInicio: fecha, fechaFin: fecha, estado: z.enum(ESTADOS_CICLO) }),
  turnos: z.object({ ...enCiclo, nombre: texto(40) }),
  jornadas: z.object({ ...enCiclo, turnoId: id, horaInicio: hora, horaFin: hora, dias: z.array(dia).max(7) }),
  periodos: z.object({ ...enCiclo, jornadaId: id, nombre: texto(40), horaInicio: hora, horaFin: hora }),
  recesos: z.object({ ...enCiclo, jornadaId: id, nombre: texto(40), horaInicio: hora, horaFin: hora }),
  grados: z.object({ ...enCiclo, numero: z.number().int().min(1).max(99), nombre: texto(40) }),
  grupos: z.object({ ...enCiclo, gradoId: id, turnoId: id, nombre: texto(20), capacidad: z.number().int().min(1).max(80).nullable(), activo: z.boolean().default(true) }),
  personal: z.object({ ...enEscuela, nombre: texto(60), primerApellido: texto(60), segundoApellido: opcional(60), numeroEmpleado: opcional(20), funciones: z.array(z.enum(FUNCIONES_PERSONAL)).max(15), activo: z.boolean(), observaciones: opcional(300).default(null) }),
  materias: z.object({ ...enCiclo, nombre: texto(80), abreviatura: opcional(12), tipo: z.enum(TIPOS_MATERIA).default('materia'), activo: z.boolean().default(true) }),
  asignaciones: z.object({ ...enCiclo, grupoId: id, materiaId: id, personalId: id.nullable(), horasSemana: z.number().int().min(1).max(40) }),
  sesiones: z.object({ ...enCiclo, asignacionId: id, grupoId: id, personalId: id.nullable(), dia, periodoId: id }),
  actividades: z.object({ ...enCiclo, tipo: z.enum(TIPOS_ACTIVIDAD), personalId: id.nullable(), grupoId: id.nullable(), periodoId: id.nullable(), dia, horaInicio: hora, horaFin: hora, descripcion: texto(120), confirmada: z.boolean(), confirmadaEn: marcaTiempo.nullable() }),
  excepciones: z.object({ ...enCiclo, personalId: id, dia, horaInicio: hora, horaFin: hora, motivo: texto(200) }),
  confirmaciones: z.object({ ...enCiclo, grupoId: id }),
  bitacora: z.object({ ...enCiclo, entidad: z.enum(['horario_grupo', 'actividad']), entidadId: id, accion: z.enum(['confirmar', 'reabrir', 'importar']), motivo: opcional(200), detalle: opcional(300) }),
  // Desde el esquema 6, el alumno es sólo identidad; su grupo y ciclo están en «inscripciones».
  alumnos: z.object({ ...enEscuela, nombre: texto(60), primerApellido: texto(60), segundoApellido: opcional(60), matricula: opcional(30).default(null), curp: opcional(18).default(null), observaciones: opcional(300).default(null) }),
  inscripciones: z.object({ ...enCiclo, alumnoId: id, turnoId: id.nullable(), gradoId: id.nullable(), grupoId: id.nullable(), estado: z.enum(ESTADOS_INSCRIPCION), numeroLista: z.number().int().min(1).max(200).nullable() }),
  movimientos: z.object({ ...enCiclo, alumnoId: id, inscripcionId: id, tipo: z.enum(['alta', 'cambio_grupo', 'baja', 'reactivacion', 'migracion']), grupoAnteriorId: id.nullable(), grupoNuevoId: id.nullable(), motivo: opcional(300) }),
  adscripciones: z.object({ ...enCiclo, personalId: id, turnoIds: z.array(id).max(20), materiaIds: z.array(id).max(200) }),
  importaciones: z.object({ ...enCiclo, tipo: z.enum(['alumnos', 'docentes', 'personal', 'materias', 'grupos']), archivo: texto(200), hoja: opcional(100), huella: z.string().regex(/^[0-9a-f]{64}$/).nullable(), resultado: z.object({ nuevos: z.number().int().min(0), actualizados: z.number().int().min(0), omitidos: z.number().int().min(0) }) }),
  pases: z.object({ ...enCiclo, grupoId: id, sesionId: id, asignacionId: id, personalId: id.nullable(), fecha, horaInicio: hora, horaFin: hora, guardadoEn: marcaTiempo }),
  asistencias: z.object({ ...enCiclo, paseId: id, grupoId: id, alumnoId: id, fecha, marca: z.enum(MARCAS_ASISTENCIA), horaLlegada: hora.nullable() }),
  salidas: z.object({ ...enCiclo, grupoId: id, alumnoId: id, sesionId: id, fecha, salida: hora, regreso: hora.nullable() }),
  reportes: z.object({ ...enCiclo, grupoId: id, alumnoId: id, personalId: id.nullable(), sesionId: id.nullable(), fecha, tipo: z.enum(TIPOS_REPORTE), texto: texto(280) }),
} as const;

export type TablaRespaldo = keyof typeof ESQUEMAS_TABLA;
export const TABLAS_RESPALDO = Object.keys(ESQUEMAS_TABLA) as TablaRespaldo[];

export const FORMATO_RESPALDO = 'gestion-escolar-respaldo';

/** Sobre del archivo; los registros se validan después, tabla por tabla. */
export const esquemaSobre = z.object({
  formato: z.literal(FORMATO_RESPALDO, 'El archivo no es un respaldo de Gestión Escolar.'),
  versionFormato: z.literal(1, 'Formato de respaldo no compatible.'),
  esquema: z.number().int().min(1),
  creadoEn: marcaTiempo,
  escuelas: z.array(z.object({ id, nombre: texto(150) })).min(1).max(50),
  huella: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  datos: z.record(z.string(), z.array(z.unknown())),
});
