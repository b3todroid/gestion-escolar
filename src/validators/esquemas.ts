/**
 * Esquemas Zod para formularios e (en el futuro) importaciones.
 * Todo texto se recorta y se rechazan caracteres de control.
 * La salida de la UI se hace siempre con textContent (nunca innerHTML),
 * por lo que no se requiere escapar HTML al guardar.
 */
import { z } from 'zod';
import { NIVELES_EDUCATIVOS, ESTADOS_CICLO } from '../models';
import { PATRON_HORA, aMinutos, esHoraValida } from '../domain/tiempo';
import { ErrorDominio } from '../domain/errores';

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
  localidad: textoOpcional('La localidad', 120),
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
    .max(12, 'El grado máximo es 12.'),
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
    gradoDesde: z.number('Indica el primer grado.').int().min(1, 'El grado mínimo es 1.').max(12, 'El grado máximo es 12.'),
    gradoHasta: z.number('Indica el último grado.').int().min(1, 'El grado mínimo es 1.').max(12, 'El grado máximo es 12.'),
    gruposPorGrado: z.number('Indica cuántos grupos hay por grado.').int().min(1, 'Al menos 1 grupo.').max(15, 'Máximo 15 grupos por grado.'),
    capacidad: z.number().int('Usa un número entero.').min(1, 'La capacidad mínima es 1.').max(80, 'La capacidad máxima es 80.').nullable().optional().transform((v) => v ?? null),
  })
  .refine((v) => v.gradoDesde <= v.gradoHasta, { message: 'El último grado debe ser mayor o igual que el primero.', path: ['gradoHasta'] });

export const esquemaCicloAsistente = esquemaCiclo.and(z.object({ enCurso: z.boolean() }));

export type EntradaPlantillaHorario = z.input<typeof esquemaPlantillaHorario>;
export type EntradaGradosGrupos = z.input<typeof esquemaGradosGrupos>;

export interface EntradaAsistente {
  escuela: EntradaEscuela;
  ciclo: EntradaCiclo & { enCurso: boolean };
  turno: EntradaTurno;
  horario: EntradaPlantillaHorario;
  grados: EntradaGradosGrupos;
}
