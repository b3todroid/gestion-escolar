/**
 * Validación de archivos de respaldo. Cada registro se valida con su forma
 * esperada (Zod elimina campos desconocidos). Nada del archivo se guarda
 * sin pasar por aquí.
 */
import { z } from 'zod';
import {
  ESTADOS_CICLO, TIPOS_INCIDENCIA_PERSONAL, ESTADOS_INCIDENCIA_PERSONAL, ESTADOS_COBERTURA, ESTADOS_ACTIVIDAD_BANCO, ESTRUCTURAS_PLANTILLA, ESTADOS_INCIDENCIA, ORIGENES_HORARIO, TIPOS_REGISTRO_IMPORTACION, ESTADOS_INSCRIPCION, FUNCIONES_PERSONAL, MARCAS_ASISTENCIA, NIVELES_EDUCATIVOS, TIPOS_ACTIVIDAD, TIPOS_MATERIA, TIPOS_REPORTE,
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
    // Versión 13 (Fase 10); los respaldos anteriores no lo tienen.
    demostracion: z.boolean().default(false),
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
  sesiones: z.object({ ...enCiclo, asignacionId: id, grupoId: id, personalId: id.nullable(), dia, periodoId: id, origen: z.enum(ORIGENES_HORARIO).nullable().default(null) }),
  actividades: z.object({ ...enCiclo, tipo: z.enum(TIPOS_ACTIVIDAD), personalId: id.nullable(), grupoId: id.nullable(), periodoId: id.nullable(), dia, horaInicio: hora, horaFin: hora, descripcion: texto(120), confirmada: z.boolean(), confirmadaEn: marcaTiempo.nullable(), origen: z.enum(ORIGENES_HORARIO).nullable().default(null) }),
  excepciones: z.object({ ...enCiclo, personalId: id, dia, horaInicio: hora, horaFin: hora, motivo: texto(200) }),
  confirmaciones: z.object({ ...enCiclo, grupoId: id }),
  bitacora: z.object({ ...enCiclo, entidad: z.enum(['horario_grupo', 'actividad']), entidadId: id, accion: z.enum(['confirmar', 'reabrir', 'importar']), motivo: opcional(200), detalle: opcional(300) }),
  // Desde el esquema 6, el alumno es sólo identidad; su grupo y ciclo están en «inscripciones».
  alumnos: z.object({ ...enEscuela, nombre: texto(60), primerApellido: texto(60), segundoApellido: opcional(60), matricula: opcional(30).default(null), curp: opcional(18).default(null), observaciones: opcional(300).default(null) }),
  inscripciones: z.object({ ...enCiclo, alumnoId: id, turnoId: id.nullable(), gradoId: id.nullable(), grupoId: id.nullable(), estado: z.enum(ESTADOS_INSCRIPCION), numeroLista: z.number().int().min(1).max(200).nullable() }),
  movimientos: z.object({ ...enCiclo, alumnoId: id, inscripcionId: id, tipo: z.enum(['alta', 'cambio_grupo', 'baja', 'reactivacion', 'migracion']), grupoAnteriorId: id.nullable(), grupoNuevoId: id.nullable(), motivo: opcional(300) }),
  adscripciones: z.object({ ...enCiclo, personalId: id, turnoIds: z.array(id).max(20), materiaIds: z.array(id).max(200) }),
  importaciones: z.object({ ...enCiclo, tipo: z.enum(TIPOS_REGISTRO_IMPORTACION), archivo: texto(200), hoja: opcional(100), huella: z.string().regex(/^[0-9a-f]{64}$/).nullable(), resultado: z.object({ nuevos: z.number().int().min(0), actualizados: z.number().int().min(0), omitidos: z.number().int().min(0) }) }),
  pases: z.object({ ...enCiclo, grupoId: id, sesionId: id, asignacionId: id, personalId: id.nullable(), fecha, horaInicio: hora, horaFin: hora, guardadoEn: marcaTiempo, correcciones: z.number().int().min(0).default(0) }),
  asistencias: z.object({ ...enCiclo, paseId: id, grupoId: id, alumnoId: id, fecha, marca: z.enum(MARCAS_ASISTENCIA), horaLlegada: hora.nullable() }),
  salidas: z.object({ ...enCiclo, grupoId: id, alumnoId: id, sesionId: id, fecha, salida: hora, regreso: hora.nullable(), personalId: id.nullable().default(null), periodoId: id.nullable().default(null) }),
  reportes: z.object({ ...enCiclo, grupoId: id, alumnoId: id, personalId: id.nullable(), sesionId: id.nullable(), fecha, tipo: z.enum(TIPOS_REPORTE), texto: texto(280), hora: hora.nullable().default(null), estado: z.enum(ESTADOS_INCIDENCIA).default('abierta') }),
  cambiosAsistencia: z.object({ ...enCiclo, paseId: id, grupoId: id, alumnoId: id, marcaAnterior: z.enum(MARCAS_ASISTENCIA), marcaNueva: z.enum(MARCAS_ASISTENCIA), llegadaAnterior: hora.nullable(), llegadaNueva: hora.nullable(), personalId: id.nullable() }),
  plantillasImportacion: z.object({ ...enEscuela, nombre: texto(80), tipo: z.enum(TIPOS_REGISTRO_IMPORTACION), estructura: z.enum(ESTRUCTURAS_PLANTILLA), columnas: z.array(z.object({ encabezado: texto(120), campo: z.string().max(40).nullable() })).max(60), umbralConfianza: z.number().min(0).max(1) }),
  incidenciasPersonal: z.object({ ...enCiclo, personalId: id, fecha, tipo: z.enum(TIPOS_INCIDENCIA_PERSONAL), tipoOtro: opcional(60), alcance: z.enum(['jornada', 'periodos']), periodoIds: z.array(id).max(30), observaciones: opcional(300), estado: z.enum(ESTADOS_INCIDENCIA_PERSONAL), registradaPor: id.nullable(), validadaPor: id.nullable(), validadaEn: marcaTiempo.nullable(), motivoValidacion: opcional(300) }),
  coberturas: z.object({ ...enCiclo, sesionId: id, fecha, grupoId: id, periodoId: id, docenteAusenteId: id.nullable(), incidenciaId: id.nullable(), propuestoIds: z.array(id).max(20), asignadoId: id.nullable(), actividadId: id.nullable(), actividadTexto: opcional(300), autorizadoPor: opcional(120), autorizadoEn: marcaTiempo.nullable(), estado: z.enum(ESTADOS_COBERTURA), observaciones: opcional(300) }),
  bancoActividades: z.object({ ...enCiclo, materiaId: id.nullable(), gradoId: id.nullable(), titulo: texto(120), descripcion: texto(1000), archivo: z.object({ nombre: texto(150), tipo: texto(100), tamano: z.number().int().min(0).max(1_048_576), datos: z.string().max(1_500_000) }).nullable(), fecha, responsable: opcional(120), estado: z.enum(ESTADOS_ACTIVIDAD_BANCO) }),
  bitacoraPrefectura: z.object({ ...enCiclo, entidad: z.enum(['incidencia', 'cobertura', 'actividad']), entidadId: id, accion: texto(40), detalle: opcional(300), personalId: id.nullable(), orden: z.number().int().min(0) }),
} as const;

export type TablaRespaldo = keyof typeof ESQUEMAS_TABLA;
export const TABLAS_RESPALDO = Object.keys(ESQUEMAS_TABLA) as TablaRespaldo[];

export const FORMATO_RESPALDO = 'gestion-escolar-respaldo';

/** Sobre del archivo; los registros se validan después, tabla por tabla. */
export const esquemaSobre = z.object({
  formato: z.literal(FORMATO_RESPALDO, 'El archivo no es un respaldo de Gestión Escolar.'),
  versionFormato: z.union([z.literal(1), z.literal(2)], 'Formato de respaldo no compatible: actualiza la aplicación.'),
  esquema: z.number().int().min(1),
  creadoEn: marcaTiempo,
  escuelas: z.array(z.object({ id, nombre: texto(150) })).min(1).max(50),
  // Formato 2: ciclos escolares y conteo de registros por tabla (verificación adicional de integridad).
  ciclos: z.array(z.object({ id, escuelaId: id, nombre: texto(40) })).max(500).optional(),
  conteos: z.record(z.string(), z.number().int().min(0)).optional(),
  huella: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  datos: z.record(z.string(), z.array(z.unknown())),
});
