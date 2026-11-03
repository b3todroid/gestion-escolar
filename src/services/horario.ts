import type { Periodo, Receso } from '../models';
import { esquemaBloque, validar, type EntradaBloque } from '../validators/esquemas';
import { validarBloqueEnJornada, type BloqueHorario } from '../domain/reglas';
import { compararPorInicio, duracionMinutos } from '../domain/tiempo';
import { ErrorDominio } from '../domain/errores';
import { asegurarHorarioEditable, choqueDocente } from './conflictos';
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

  async crear(tipo: TipoBloque, jornadaId: string, entrada: EntradaBloque): Promise<Periodo | Receso> {
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

  async actualizar(tipo: TipoBloque, id: string, entrada: EntradaBloque): Promise<Periodo | Receso> {
    const datos = validar(esquemaBloque, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.repo(tipo).obtener(id), tipo === 'periodo' ? 'el periodo' : 'el receso');
      const jornada = await requerir(this.ctx.repos.jornadas.obtener(actual.jornadaId), 'la jornada');
      await cicloEditable(this.ctx, jornada.cicloEscolarId);
      const bloque = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      validarBloqueEnJornada({ ...bloque, tipo }, jornada, await bloquesDeJornada(this.ctx, jornada.id));
      if (tipo === 'periodo') {
        // Con el nuevo horario, ningún docente de este periodo puede quedar en dos grupos a la vez.
        const sesiones = await this.ctx.repos.sesiones.listarPor('periodoId', id);
        const propias = new Set(sesiones.map((s) => s.id));
        for (const grupoId of new Set(sesiones.map((s) => s.grupoId))) await asegurarHorarioEditable(this.ctx, grupoId);
        for (const s of sesiones) {
          if (!s.personalId) continue;
          const choque = await choqueDocente(this.ctx, jornada.cicloEscolarId, s.personalId, s.dia, bloque, { excluirSesiones: propias });
          if (choque) throw new ErrorDominio('TRASLAPE', `Con ese horario, ${choque.charAt(0).toLowerCase()}${choque.slice(1)}`, [{ campo: 'horaInicio', mensaje: choque }]);
        }
        // Las actividades ligadas al periodo (otra actividad del grupo, SE del docente) toman la hora nueva:
        // así no quedan dos horarios distintos para el mismo periodo.
        const ligadas = (await this.ctx.repos.actividades.listarPor('cicloEscolarId', jornada.cicloEscolarId)).filter((a) => a.periodoId === id);
        for (const a of ligadas) {
          if (a.grupoId) await asegurarHorarioEditable(this.ctx, a.grupoId);
          if (a.personalId) {
            const choque = await choqueDocente(this.ctx, jornada.cicloEscolarId, a.personalId, a.dia, bloque, { esActividad: true, excluirActividades: new Set([a.id]), excluirSesiones: propias });
            if (choque) throw new ErrorDominio('TRASLAPE', `Con ese horario, ${choque.charAt(0).toLowerCase()}${choque.slice(1)}`, [{ campo: 'horaInicio', mensaje: choque }]);
          }
          await this.ctx.repos.actividades.actualizar({ ...a, horaInicio: bloque.horaInicio, horaFin: bloque.horaFin, ...metadatosActualizados(this.ctx, a) });
        }
      }
      await this.repo(tipo).actualizar(bloque);
      return bloque;
    });
  }

  async eliminar(tipo: TipoBloque, id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.repo(tipo).obtener(id), tipo === 'periodo' ? 'el periodo' : 'el receso');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      if (tipo === 'periodo') {
        const n = await this.ctx.repos.sesiones.contarPor('periodoId', id);
        if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Hay ${n} clase(s) programadas en este periodo. Quítalas del horario de los grupos primero.`);
        const act = (await this.ctx.repos.actividades.listarPor('cicloEscolarId', actual.cicloEscolarId)).filter((a) => a.periodoId === id).length;
        if (act > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Hay ${act} actividad(es) u hora(s) de servicio registradas en este periodo. Quítalas primero.`);
      }
      await this.repo(tipo).eliminar(id);
    });
  }
}
