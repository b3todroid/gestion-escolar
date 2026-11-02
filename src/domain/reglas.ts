/**
 * Reglas de negocio puras de la configuración escolar.
 * No acceden a la base de datos: reciben datos y devuelven decisiones.
 */
import type { EstadoCiclo } from '../models';
import { ErrorDominio } from './errores';
import { normalizarTexto } from './texto';
import { estaDentro, seTraslapan, type Intervalo } from './tiempo';

/** Transiciones permitidas del ciclo escolar. Un ciclo cerrado no se reabre. */
export const TRANSICIONES_CICLO: Readonly<Record<EstadoCiclo, readonly EstadoCiclo[]>> = {
  planeacion: ['activo', 'cerrado'],
  activo: ['cerrado'],
  cerrado: [],
};

export function puedeCambiarEstado(actual: EstadoCiclo, nuevo: EstadoCiclo): boolean {
  return TRANSICIONES_CICLO[actual].includes(nuevo);
}

/**
 * Lanza DUPLICADO si `valor` ya existe (comparación normalizada) en `existentes`,
 * ignorando el registro con `idActual` (edición).
 */
export function asegurarSinDuplicado<T extends { id: string }>(
  existentes: readonly T[],
  obtener: (x: T) => string,
  valor: string,
  idActual: string | undefined,
  campo: string,
  mensaje: string,
): void {
  const clave = normalizarTexto(valor);
  const repetido = existentes.some((x) => x.id !== idActual && normalizarTexto(obtener(x)) === clave);
  if (repetido) throw new ErrorDominio('DUPLICADO', mensaje, [{ campo, mensaje }]);
}

export interface BloqueHorario extends Intervalo {
  id: string;
  nombre: string;
  tipo: 'periodo' | 'receso';
}

/**
 * Valida que un bloque (periodo o receso) quepa en la jornada
 * y no se traslape con otros bloques del mismo turno.
 */
export function validarBloqueEnJornada(
  bloque: BloqueHorario,
  jornada: Intervalo,
  otros: readonly BloqueHorario[],
): void {
  if (!estaDentro(bloque, jornada)) {
    const mensaje = `Debe estar dentro de la jornada (${jornada.horaInicio} a ${jornada.horaFin}).`;
    throw new ErrorDominio('FUERA_DE_JORNADA', mensaje, [{ campo: 'horaInicio', mensaje }]);
  }
  const choque = otros.find((o) => o.id !== bloque.id && seTraslapan(o, bloque));
  if (choque) {
    const tipo = choque.tipo === 'receso' ? 'el receso' : 'el periodo';
    const mensaje = `Se traslapa con ${tipo} «${choque.nombre}» (${choque.horaInicio} a ${choque.horaFin}).`;
    throw new ErrorDominio('TRASLAPE', mensaje, [{ campo: 'horaInicio', mensaje }]);
  }
}

/** Bloques que quedarían fuera si la jornada cambiara a `nueva`. */
export function bloquesFueraDeJornada(bloques: readonly BloqueHorario[], nueva: Intervalo): BloqueHorario[] {
  return bloques.filter((b) => !estaDentro(b, nueva));
}

export function rangosFechaSeTraslapan(
  a: { fechaInicio: string; fechaFin: string },
  b: { fechaInicio: string; fechaFin: string },
): boolean {
  // Fechas ISO (AAAA-MM-DD) se comparan correctamente como texto.
  return a.fechaInicio <= b.fechaFin && b.fechaInicio <= a.fechaFin;
}
