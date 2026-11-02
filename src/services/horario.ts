import type { Periodo, Receso } from '../models';
import { esquemaBloque, validar, type EntradaBloque } from '../validators/esquemas';
import { validarBloqueEnJornada, type BloqueHorario } from '../domain/reglas';
import { compararPorInicio, duracionMinutos } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export type TipoBloque = 'periodo' | 'receso';

export async function bloquesDeJornada(ctx: Contexto, jornadaId: string): Promise<BloqueHorario[]> {
  const periodos = await ctx.repos.periodos.listarPor('jornadaId', jornadaId);
  const recesos = await ctx.repos.recesos.listarPor('jornadaId', jornadaId);
  return [
    ...periodos.map((p) => ({ ...p, tipo: 'periodo' as const })),
    ...recesos.map((r) => ({ ...r, tipo: 'receso' as const })),
  ].sort(compararPorInicio);
}

export interface ResumenHorario {
  bloques: BloqueHorario[];
  minutosClase: number;
  minutosReceso: number;
  minutosLibres: number;
}

export class ServicioHorario {
  constructor(private readonly ctx: Contexto) {}

  private repo(tipo: TipoBloque) {
    return tipo === 'periodo' ? this.ctx.repos.periodos : this.ctx.repos.recesos;
  }

  async resumen(jornadaId: string): Promise<ResumenHorario> {
    const jornada = await requerir(this.ctx.repos.jornadas.obtener(jornadaId), 'la jornada');
    const bloques = await bloquesDeJornada(this.ctx, jornadaId);
    const suma = (t: TipoBloque) =>
      bloques.filter((b) => b.tipo === t).reduce((s, b) => s + duracionMinutos(b.horaInicio, b.horaFin), 0);
    const minutosClase = suma('periodo');
    const minutosReceso = suma('receso');
    return {
      bloques,
      minutosClase,
      minutosReceso,
      minutosLibres: duracionMinutos(jornada.horaInicio, jornada.horaFin) - minutosClase - minutosReceso,
    };
  }

  crear(tipo: TipoBloque, jornadaId: string, entrada: EntradaBloque): Promise<Periodo | Receso> {
    const datos = validar(esquemaBloque, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const jornada = await requerir(this.ctx.repos.jornadas.obtener(jornadaId), 'la jornada');
      await cicloEditable(this.ctx, jornada.cicloEscolarId);
      const bloque = {
        ...metadatosNuevos(this.ctx),
        escuelaId: jornada.escuelaId, cicloEscolarId: jornada.cicloEscolarId, jornadaId, ...datos,
      };
      validarBloqueEnJornada({ ...bloque, tipo }, jornada, await bloquesDeJornada(this.ctx, jornadaId));
      await this.repo(tipo).insertar(bloque);
      return bloque;
    });
  }

  actualizar(tipo: TipoBloque, id: string, entrada: EntradaBloque): Promise<Periodo | Receso> {
    const datos = validar(esquemaBloque, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.repo(tipo).obtener(id), tipo === 'periodo' ? 'el periodo' : 'el receso');
      const jornada = await requerir(this.ctx.repos.jornadas.obtener(actual.jornadaId), 'la jornada');
      await cicloEditable(this.ctx, jornada.cicloEscolarId);
      const bloque = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      validarBloqueEnJornada({ ...bloque, tipo }, jornada, await bloquesDeJornada(this.ctx, jornada.id));
      await this.repo(tipo).actualizar(bloque);
      return bloque;
    });
  }

  eliminar(tipo: TipoBloque, id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.repo(tipo).obtener(id), tipo === 'periodo' ? 'el periodo' : 'el receso');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.repo(tipo).eliminar(id);
    });
  }
}
