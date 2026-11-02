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
    .trim()
    .toUpperCase()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    .refine((v) => v === null || /^[A-Z0-9-]{5,20}$/.test(v), {
      message: 'La clave sólo admite letras, números y guiones (5 a 20 caracteres).',
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
