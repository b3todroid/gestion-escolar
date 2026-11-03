import type { CicloEscolar, Metadatos } from '../models';
import type { Repositorios, UnidadDeTrabajo } from '../repositories/tipos';
import { ErrorDominio } from '../domain/errores';
import { nuevoId } from '../utils/id';
import type { Reloj } from '../utils/reloj';

export interface Contexto {
  repos: Repositorios;
  uow: UnidadDeTrabajo;
  reloj: Reloj;
}

export function metadatosNuevos(ctx: Contexto): Metadatos {
  const ahora = ctx.reloj();
  return { id: nuevoId(), creadoEn: ahora, actualizadoEn: ahora, version: 1 };
}

export function metadatosActualizados<T extends Metadatos>(ctx: Contexto, actual: T): Metadatos {
  return { id: actual.id, creadoEn: actual.creadoEn, actualizadoEn: ctx.reloj(), version: actual.version + 1 };
}

export async function requerir<T>(promesa: Promise<T | undefined>, que: string): Promise<T> {
  const r = await promesa;
  if (r === undefined) throw new ErrorDominio('NO_ENCONTRADO', `No se encontró ${que}.`);
  return r;
}

/** Obtiene el ciclo y verifica que pertenezca a la escuela y que no esté cerrado. */
export async function cicloEditable(ctx: Contexto, cicloId: string): Promise<CicloEscolar> {
  const ciclo = await requerir(ctx.repos.ciclos.obtener(cicloId), 'el ciclo escolar');
  if (ciclo.estado === 'cerrado') {
    throw new ErrorDominio('CICLO_CERRADO', 'El ciclo escolar está cerrado; su configuración ya no puede modificarse.');
  }
  return ciclo;
}

/** Un grupo desactivado no recibe materias, clases, alumnos ni actividades. */
export function asegurarGrupoActivo(grupo: { activo?: boolean; nombre: string }): void {
  if (grupo.activo === false) throw new ErrorDominio('ESTADO_NO_PERMITIDO', `El grupo ${grupo.nombre} está desactivado. Reactívalo para agregarle información.`);
}
