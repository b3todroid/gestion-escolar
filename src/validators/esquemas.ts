/**
 * Esquemas Zod para formularios e (en el futuro) importaciones.
 * Todo texto se recorta y se rechazan caracteres de control.
 * La salida de la UI se hace siempre con textContent (nunca innerHTML),
 * por lo que no se requiere escapar HTML al guardar.
 */
import { z } from 'zod';
import { NIVELES_EDUCATIVOS, ESTADOS_CICLO, FUNCIONES_PERSONAL, TIPOS_ACTIVIDAD, MARCAS_ASISTENCIA, TIPOS_REPORTE, TIPOS_MATERIA } from '../models';
import { PATRON_HORA, aMinutos, esHoraValida } from '../domain/tiempo';
import { ErrorDominio } from '../domain/errores';
import { CLAVES_ENTIDAD, nombreEntidad } from '../domain/catalogos';

// eslint-disable-next-line no-control-regex
const SIN_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

const texto = (campo: string, min: number, max: number) =>
  z
    .string(`${campo} es obligatorio.`)
    .trim()
    .min(min, min <= 1 ? `${campo} es obligatorio.` : `${campo} debe tener al menos ${min} caracteres.`)
    .max(max, `${campo} admite como máximo ${max} caracteres.`)
    .regex(SIN_CONTROL, `${campo} contiene caracteres no permitidos.`);

const textoOpcional = (campo: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${campo} admite como máximo ${max} caracteres.`)
    .regex(SIN_CONTROL, `${campo} contiene caracteres no permitidos.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/**
 * Clave de Centro de Trabajo (SEP): 2 dígitos de entidad federativa (01–32),
 * 3 letras (sostenimiento y tipo de servicio), 4 dígitos (consecutivo) y
 * 1 letra verificadora. Sólo se valida la estructura, no su existencia.
 */
export const PATRON_CCT = /^(0[1-9]|[12]\d|3[0-2])[A-Z]{3}\d{4}[A-Z]$/;

const hora = (campo: string) =>
  z.string(`${campo} es obligatoria.`).trim().regex(PATRON_HORA, `${campo} debe tener formato HH:MM (24 h).`);

const fecha = (campo: string) =>
  z.iso.date(`${campo} debe ser una fecha válida (AAAA-MM-DD).`);

const conRangoHoras = <T extends z.ZodType<{ horaInicio: string; horaFin: string }>>(s: T) =>
  s.refine(
    // Si alguna hora ya es inválida, ese error se reporta en su campo.
    (v) => !esHoraValida(v.horaInicio) || !esHoraValida(v.horaFin) || aMinutos(v.horaInicio) < aMinutos(v.horaFin),
    {
      message: 'La hora de fin debe ser posterior a la de inicio.',
      path: ['horaFin'],
    },
  );

export const esquemaEscuela = z.object({
  nombre: texto('El nombre', 3, 150),
  cct: z
    .string()
    .toUpperCase()
    .transform((v) => v.replace(/[\s-]/g, '')) // se aceptan espacios o guiones al capturar
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    .refine((v) => v === null || PATRON_CCT.test(v), {
      message: 'La CCT debe tener 10 caracteres: entidad (01 a 32), 3 letras, 4 dígitos y 1 letra. Formato: 00AAA0000A.',
    }),
  nivel: z.enum(NIVELES_EDUCATIVOS, 'Selecciona un nivel educativo.'),
  localidad: textoOpcional('El municipio o alcaldía', 120),
  nombreCorto: textoOpcional('El nombre corto', 60),
  entidad: z.string().transform((v) => (v === '' ? null : v)).nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || (CLAVES_ENTIDAD as readonly string[]).includes(v), { message: 'Selecciona una entidad federativa.' }),
  zonaEscolar: textoOpcional('La zona escolar', 20),
  sector: textoOpcional('El sector', 20),
  domicilio: textoOpcional('El domicilio', 200),
  telefono: z.string().transform((v) => v.replace(/[\s().-]/g, '').replace(/^\+?52/, '')).transform((v) => (v === '' ? null : v)).nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || /^\d{10}$/.test(v), { message: 'El teléfono debe tener 10 dígitos (puedes usar espacios o guiones).' }),
  correo: z.string().trim().toLowerCase().transform((v) => (v === '' ? null : v)).nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || (v.length <= 120 && z.email().safeParse(v).success), { message: 'Escribe un correo válido, por ejemplo direccion@escuela.edu.mx.' }),
  // Sólo imágenes rasterizadas reducidas (nunca SVG, que puede contener código).
  logotipo: z.string().nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || (v.length <= 400_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)), { message: 'El logotipo debe ser una imagen PNG, JPG o WebP.' }),
});

/**
 * Datos del plantel para el asistente y la edición: CCT, entidad y municipio
 * obligatorios, y la CCT debe iniciar con la clave de la entidad elegida.
 * Sólo se valida el FORMATO; no se afirma que la escuela exista oficialmente.
 */
export const esquemaDatosPlantel = esquemaEscuela
  .refine((v) => v.cct !== null, { message: 'La CCT es obligatoria.', path: ['cct'] })
  .refine((v) => v.entidad !== null, { message: 'Selecciona la entidad federativa.', path: ['entidad'] })
  .refine((v) => v.localidad !== null, { message: 'El municipio o alcaldía es obligatorio.', path: ['localidad'] })
  .superRefine((v, ctx) => {
    if (v.cct && v.entidad && v.cct.slice(0, 2) !== v.entidad) {
      ctx.addIssue({ code: 'custom', path: ['cct'], message: `La CCT inicia con ${v.cct.slice(0, 2)}${nombreEntidad(v.cct.slice(0, 2)) ? ` (${nombreEntidad(v.cct.slice(0, 2))})` : ''}, pero la entidad elegida es ${nombreEntidad(v.entidad)} (${v.entidad}). Revisa la CCT o la entidad.` });
    }
  });

export const esquemaCiclo = z
  .object({
    nombre: texto('El nombre del ciclo', 4, 40),
    fechaInicio: fecha('La fecha de inicio'),
    fechaFin: fecha('La fecha de fin'),
  })
  .refine((v) => v.fechaInicio < v.fechaFin, {
    message: 'La fecha de fin debe ser posterior a la de inicio.',
    path: ['fechaFin'],
  });

export const esquemaEstadoCiclo = z.enum(ESTADOS_CICLO);

const dias = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Selecciona al menos un día.')
  .transform((d) => [...new Set(d)].sort((a, b) => a - b) as (1 | 2 | 3 | 4 | 5 | 6 | 7)[]);

export const esquemaTurnoConJornada = conRangoHoras(
  z.object({
    nombre: texto('El nombre del turno', 2, 40),
    horaInicio: hora('La hora de inicio'),
    horaFin: hora('La hora de fin'),
    dias,
  }),
);

export const esquemaBloque = conRangoHoras(
  z.object({
    nombre: texto('El nombre', 1, 40),
    horaInicio: hora('La hora de inicio'),
    horaFin: hora('La hora de fin'),
  }),
);

export const esquemaGrado = z.object({
  numero: z
    .number('El número de grado es obligatorio.')
    .int('El grado debe ser un número entero.')
    .min(1, 'El grado mínimo es 1.')
    .max(99, 'El grado máximo es 99.'),
  nombre: texto('El nombre del grado', 1, 40),
});

export const esquemaGrupo = z.object({
  gradoId: z.uuid('Selecciona un grado.'),
  turnoId: z.uuid('Selecciona un turno.'),
  nombre: texto('El nombre del grupo', 1, 20),
  capacidad: z
    .number()
    .int('La capacidad debe ser un número entero.')
    .min(1, 'La capacidad mínima es 1.')
    .max(80, 'La capacidad máxima es 80.')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type EntradaEscuela = z.input<typeof esquemaEscuela>;
export type EntradaCiclo = z.input<typeof esquemaCiclo>;
export type EntradaTurno = z.input<typeof esquemaTurnoConJornada>;
export type EntradaBloque = z.input<typeof esquemaBloque>;
export type EntradaGrado = z.input<typeof esquemaGrado>;
export type EntradaGrupo = z.input<typeof esquemaGrupo>;

/** Valida y convierte los errores de Zod en ErrorDominio con errores por campo. */
export function validar<S extends z.ZodType>(esquema: S, datos: unknown): z.output<S> {
  const r = esquema.safeParse(datos);
  if (r.success) return r.data;
  const campos = r.error.issues.map((i) => ({
    campo: i.path.map(String).join('.') || 'formulario',
    mensaje: i.message,
  }));
  throw new ErrorDominio('VALIDACION', campos[0]?.mensaje ?? 'Datos inválidos.', campos);
}

// ---------- Asistente de configuración ----------

export const esquemaPlantillaHorario = z
  .object({
    duracionModulo: z.number('Indica la duración del módulo.').int('Usa minutos enteros.').min(10, 'Mínimo 10 minutos.').max(180, 'Máximo 180 minutos.'),
    modulos: z.number('Indica cuántos módulos hay.').int('Usa un número entero.').min(1, 'Al menos 1 módulo.').max(15, 'Máximo 15 módulos.'),
    recesos: z
      .array(z.object({
        despuesDe: z.number('Indica después de qué módulo.').int().min(1, 'Elige un módulo.'),
        duracion: z.number('Indica la duración del receso.').int('Usa minutos enteros.').min(5, 'Mínimo 5 minutos.').max(120, 'Máximo 120 minutos.'),
      }))
      .max(5, 'Máximo 5 recesos.'),
  })
  .refine((v) => v.recesos.every((r) => r.despuesDe < v.modulos), {
    message: 'Cada receso debe ir entre dos módulos (antes del último).',
    path: ['recesos'],
  })
  .refine((v) => new Set(v.recesos.map((r) => r.despuesDe)).size === v.recesos.length, {
    message: 'Hay dos recesos después del mismo módulo.',
    path: ['recesos'],
  });

export const esquemaGradosGrupos = z
  .object({
    gradoDesde: z.number('Indica el primer grado.').int().min(1, 'El grado mínimo es 1.').max(99, 'El grado máximo es 99.'),
    gradoHasta: z.number('Indica el último grado.').int().min(1, 'El grado mínimo es 1.').max(99, 'El grado máximo es 99.'),
    gruposPorGrado: z.number('Indica cuántos grupos hay por grado.').int().min(1, 'Al menos 1 grupo.').max(99, 'Máximo 99 grupos por grado.'),
    capacidad: z.number().int('Usa un número entero.').min(1, 'La capacidad mínima es 1.').max(80, 'La capacidad máxima es 80.').nullable().optional().transform((v) => v ?? null),
  })
  .refine((v) => v.gradoDesde <= v.gradoHasta, { message: 'El último grado debe ser mayor o igual que el primero.', path: ['gradoHasta'] });

export const esquemaCicloAsistente = esquemaCiclo.and(z.object({ enCurso: z.boolean() }));

export type EntradaPlantillaHorario = z.input<typeof esquemaPlantillaHorario>;
export type EntradaGradosGrupos = z.input<typeof esquemaGradosGrupos>;

/** Periodos y recesos editados uno por uno (en lugar de la generación automática). */
export const esquemaBloquesPersonalizados = z.array(z.object({
  tipo: z.enum(['periodo', 'receso']),
  nombre: texto('El nombre', 1, 40),
  horaInicio: hora('La hora de inicio'),
  horaFin: hora('La hora de fin'),
})).min(1, 'Agrega al menos un periodo.').max(40, 'Máximo 40 bloques.');

/** Grados con sus grupos, editados uno por uno. */
export const esquemaGradosPersonalizados = z.array(z.object({
  numero: z.number('Indica el número de grado.').int().min(1, 'El grado mínimo es 1.').max(99, 'El grado máximo es 99.'),
  nombre: texto('El nombre del grado', 1, 40),
  grupos: z.array(texto('El nombre del grupo', 1, 20)).min(1, 'Cada grado necesita al menos un grupo.').max(99, 'Máximo 99 grupos por grado.'),
})).min(1, 'Agrega al menos un grado.').max(99, 'Máximo 99 grados.');

export type BloquePersonalizado = z.input<typeof esquemaBloquesPersonalizados>[number];
export type GradoPersonalizado = z.input<typeof esquemaGradosPersonalizados>[number];

export interface EntradaAsistente {
  escuela: EntradaEscuela;
  ciclo: EntradaCiclo & { enCurso: boolean };
  turno: EntradaTurno;
  horario: EntradaPlantillaHorario & { bloques?: BloquePersonalizado[] | null };
  grados: EntradaGradosGrupos & { personalizados?: GradoPersonalizado[] | null };
}

// ===================== Fase 2 =====================

export const esquemaPersonal = z.object({
  nombre: texto('El nombre', 2, 60),
  primerApellido: texto('El primer apellido', 2, 60),
  segundoApellido: textoOpcional('El segundo apellido', 60),
  numeroEmpleado: textoOpcional('El número de empleado', 20)
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z0-9-]+$/.test(v), { message: 'El número de empleado sólo admite letras, números y guiones.' }),
  funciones: z.array(z.enum(FUNCIONES_PERSONAL)).min(1, 'Selecciona al menos una función.')
    .transform((f) => [...new Set(f)]),
  observaciones: textoOpcional('Las observaciones', 300),
});

export const esquemaMateria = z.object({
  nombre: texto('El nombre de la materia', 2, 80),
  abreviatura: textoOpcional('La abreviatura', 12),
  tipo: z.enum(TIPOS_MATERIA, 'Selecciona el tipo.').optional().transform((v) => v ?? 'materia'),
});

/** Varias materias, una por renglón (captura rápida). */
export const esquemaMateriasLote = z
  .string()
  .transform((t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  .pipe(z.array(texto('Cada materia', 2, 80)).min(1, 'Escribe al menos una materia.').max(40, 'Máximo 40 materias a la vez.'));

export const esquemaAsignacion = z.object({
  grupoId: z.uuid('Selecciona un grupo.'),
  materiaId: z.uuid('Selecciona una materia.'),
  personalId: z.uuid('Selecciona un docente válido.').nullable().optional().transform((v) => v ?? null),
  horasSemana: z.number('Indica las horas por semana.').int('Usa un número entero.').min(1, 'Mínimo 1 hora.').max(40, 'Máximo 40 horas.'),
});

export const esquemaSesion = z.object({
  grupoId: z.uuid(),
  asignacionId: z.uuid('Selecciona una materia.'),
  periodoId: z.uuid(),
  dia: z.number().int().min(1).max(7),
});

export type EntradaPersonal = z.input<typeof esquemaPersonal>;
export type EntradaMateria = z.input<typeof esquemaMateria>;
export type EntradaAsignacion = z.input<typeof esquemaAsignacion>;
export type EntradaSesion = z.input<typeof esquemaSesion>;

// ===================== Fase 3 =====================

const diaSemana = z.number('Selecciona un día.').int().min(1, 'Selecciona un día.').max(7, 'Selecciona un día.');

export const esquemaActividadDocente = conRangoHoras(z.object({
  tipo: z.enum(TIPOS_ACTIVIDAD, 'Selecciona el tipo de actividad.'),
  dia: diaSemana,
  horaInicio: hora('La hora de inicio'),
  horaFin: hora('La hora de fin'),
  descripcion: texto('La descripción', 3, 120),
}));

export const esquemaExcepcion = conRangoHoras(z.object({
  dia: diaSemana,
  horaInicio: hora('La hora de inicio'),
  horaFin: hora('La hora de fin'),
  motivo: texto('El motivo', 5, 200),
}));

export const esquemaMotivo = texto('El motivo', 5, 200);
export const esquemaDescripcion = texto('La descripción', 3, 120);

export type EntradaActividadDocente = z.input<typeof esquemaActividadDocente>;
export type EntradaExcepcion = z.input<typeof esquemaExcepcion>;

// ===================== Fase 4 =====================

/** CURP: estructura de 18 caracteres. Sólo se valida el formato. */
export const PATRON_CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

export const esquemaAlumno = z.object({
  nombre: texto('El nombre', 2, 60),
  primerApellido: texto('El primer apellido', 2, 60),
  segundoApellido: textoOpcional('El segundo apellido', 60),
  matricula: textoOpcional('La matrícula', 30).transform((v) => (v ? v.toUpperCase() : null)),
  curp: z.string().transform((v) => v.trim().toUpperCase()).transform((v) => (v === '' ? null : v)).nullable().optional().transform((v) => v ?? null)
    .refine((v) => v === null || PATRON_CURP.test(v), { message: 'La CURP debe tener 18 caracteres con el formato oficial.' }),
  observaciones: textoOpcional('Las observaciones', 300),
});

export const esquemaInscripcion = z.object({
  grupoId: z.uuid('Selecciona un grupo válido.').nullable().optional().transform((v) => v ?? null),
  gradoId: z.uuid('Selecciona un grado válido.').nullable().optional().transform((v) => v ?? null),
  turnoId: z.uuid('Selecciona un turno válido.').nullable().optional().transform((v) => v ?? null),
  numeroLista: z.number().int('Usa un número entero.').min(1, 'El número de lista mínimo es 1.').max(200, 'El número de lista máximo es 200.').nullable().optional().transform((v) => v ?? null),
});
export type EntradaInscripcion = z.input<typeof esquemaInscripcion>;

/**
 * Varios alumnos, uno por renglón, con el formato «Apellidos, Nombre(s)».
 * El primer apellido es la primera palabra antes de la coma; el resto, el segundo.
 */
export const esquemaAlumnosLote = z
  .string()
  .transform((t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  .pipe(z.array(z.string()).min(1, 'Escribe al menos un alumno.').max(60, 'Máximo 60 alumnos a la vez.'));

export const esquemaMarcas = z.record(z.uuid(), z.enum(MARCAS_ASISTENCIA));
export const esquemaFecha = z.iso.date('Fecha inválida (AAAA-MM-DD).');
export const esquemaHora = hora('La hora');

export const esquemaReporte = z.object({
  tipo: z.enum(TIPOS_REPORTE, 'Selecciona el tipo de reporte.'),
  texto: texto('El reporte', 3, 280),
});

export type EntradaAlumno = z.input<typeof esquemaAlumno>;
export type EntradaReporte = z.input<typeof esquemaReporte>;
