import type { Actividad, DiaSemana, Excepcion } from '../models';
import {
  esquemaActividadDocente, esquemaDescripcion, esquemaExcepcion, esquemaMotivo, validar,
  type EntradaActividadDocente, type EntradaExcepcion,
} from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { seTraslapan } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';
import { asegurarHorarioEditable, choqueDocente } from './conflictos';

/**
 * Actividades que no son clase (servicio u otra) y casos especiales.
 * Un servicio se registra explícitamente y se confirma; un hueco nunca es servicio.
 */
export class ServicioActividades {
  constructor(private readonly ctx: Contexto) {}

  // ---------- Del docente ----------

  async listarDocente(personalId: string, cicloId: string): Promise<Actividad[]> {
    return (await this.ctx.repos.actividades.listarPor('personalId', personalId))
      .filter((a) => a.cicloEscolarId === cicloId)
      .sort((a, b) => a.dia - b.dia || a.horaInicio.localeCompare(b.horaInicio));
  }

  async crearDocente(cicloId: string, personalId: string, entrada: EntradaActividadDocente): Promise<Actividad> {
    const datos = validar(esquemaActividadDocente, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const p = await requerir(this.ctx.repos.personal.obtener(personalId), 'a la persona');
      if (p.escuelaId !== ciclo.escuelaId || !p.activo) throw new ErrorDominio('VALIDACION', 'La persona no está activa en esta escuela.');
      const choque = await choqueDocente(this.ctx, cicloId, personalId, datos.dia, datos, { esActividad: true });
      if (choque) throw new ErrorDominio('TRASLAPE', choque, [{ campo: 'horaInicio', mensaje: choque }]);
      const a: Actividad = {
        ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, personalId, grupoId: null, periodoId: null,
        ...datos, dia: datos.dia as DiaSemana, confirmada: false, confirmadaEn: null,
      };
      await this.ctx.repos.actividades.insertar(a);
      return a;
    });
  }

  async actualizarDocente(id: string, entrada: EntradaActividadDocente): Promise<Actividad> {
    const datos = validar(esquemaActividadDocente, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtenerEditable(id);
      const choque = await choqueDocente(this.ctx, actual.cicloEscolarId, actual.personalId!, datos.dia, datos, { esActividad: true, excluirActividades: new Set([id]) });
      if (choque) throw new ErrorDominio('TRASLAPE', choque, [{ campo: 'horaInicio', mensaje: choque }]);
      const a: Actividad = { ...actual, ...datos, dia: datos.dia as DiaSemana, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.actividades.actualizar(a);
      return a;
    });
  }

  async confirmar(id: string): Promise<Actividad> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtenerEditable(id);
      const a: Actividad = { ...actual, confirmada: true, confirmadaEn: this.ctx.reloj(), ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.actividades.actualizar(a);
      await this.registrar(a, 'confirmar', null);
      return a;
    });
  }

  /** Quitar la confirmación es una autorización: requiere motivo y queda en bitácora. */
  async desconfirmar(id: string, motivo: string): Promise<Actividad> {
    const m = validar(esquemaMotivo, motivo);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.actividades.obtener(id), 'la actividad');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      if (!actual.confirmada) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'La actividad no está confirmada.');
      const a: Actividad = { ...actual, confirmada: false, confirmadaEn: null, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.actividades.actualizar(a);
      await this.registrar(a, 'reabrir', m);
      return a;
    });
  }

  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtenerEditable(id);
      if (actual.grupoId) await asegurarHorarioEditable(this.ctx, actual.grupoId);
      await this.ctx.repos.actividades.eliminar(id);
    });
  }

  private async obtenerEditable(id: string): Promise<Actividad> {
    const actual = await requerir(this.ctx.repos.actividades.obtener(id), 'la actividad');
    await cicloEditable(this.ctx, actual.cicloEscolarId);
    if (actual.confirmada) {
      throw new ErrorDominio('HORARIO_CONFIRMADO', 'Esta hora de servicio está confirmada. Para cambiarla, primero quita la confirmación indicando el motivo.');
    }
    return actual;
  }

  private async registrar(a: Actividad, accion: 'confirmar' | 'reabrir', motivo: string | null) {
    await this.ctx.repos.bitacora.insertar({
      ...metadatosNuevos(this.ctx), escuelaId: a.escuelaId, cicloEscolarId: a.cicloEscolarId,
      entidad: 'actividad', entidadId: a.id, accion, motivo, detalle: `${a.tipo}: ${a.descripcion}`,
    });
  }

  // ---------- Del grupo (otra actividad en un periodo) ----------

  async crearGrupo(grupoId: string, dia: number, periodoId: string, descripcion: string): Promise<Actividad> {
    const d = validar(esquemaDescripcion, descripcion);
    return this.ctx.uow.ejecutar(async () => {
      const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
      await cicloEditable(this.ctx, grupo.cicloEscolarId);
      await asegurarHorarioEditable(this.ctx, grupoId);
      const periodo = await requerir(this.ctx.repos.periodos.obtener(periodoId), 'el periodo');
      const [jornada] = await this.ctx.repos.jornadas.listarPor('turnoId', grupo.turnoId);
      if (!jornada || periodo.jornadaId !== jornada.id || !jornada.dias.includes(dia as DiaSemana)) {
        throw new ErrorDominio('VALIDACION', 'El periodo o el día no corresponden al turno del grupo.');
      }
      const ocupada = (await this.ctx.repos.sesiones.listarPor('grupoId', grupoId)).some((s) => s.dia === dia && s.periodoId === periodoId)
        || (await this.ctx.repos.actividades.listarPor('grupoId', grupoId)).some((a) => a.dia === dia && a.periodoId === periodoId);
      if (ocupada) throw new ErrorDominio('TRASLAPE', 'Ese periodo ya tiene una clase o actividad. Déjalo libre primero.');
      const a: Actividad = {
        ...metadatosNuevos(this.ctx), escuelaId: grupo.escuelaId, cicloEscolarId: grupo.cicloEscolarId, tipo: 'otra',
        personalId: null, grupoId, periodoId, dia: dia as DiaSemana, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin,
        descripcion: d, confirmada: false, confirmadaEn: null,
      };
      await this.ctx.repos.actividades.insertar(a);
      return a;
    });
  }

  async listarGrupo(grupoId: string): Promise<Actividad[]> {
    return this.ctx.repos.actividades.listarPor('grupoId', grupoId);
  }

  // ---------- Casos especiales ----------

  async listarExcepciones(personalId: string, cicloId: string): Promise<Excepcion[]> {
    return (await this.ctx.repos.excepciones.listarPor('personalId', personalId))
      .filter((e) => e.cicloEscolarId === cicloId)
      .sort((a, b) => a.dia - b.dia || a.horaInicio.localeCompare(b.horaInicio));
  }

  async crearExcepcion(cicloId: string, personalId: string, entrada: EntradaExcepcion): Promise<Excepcion> {
    const datos = validar(esquemaExcepcion, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const p = await requerir(this.ctx.repos.personal.obtener(personalId), 'a la persona');
      if (p.escuelaId !== ciclo.escuelaId || !p.funciones.includes('docente')) throw new ErrorDominio('VALIDACION', 'Sólo se configuran casos especiales para docentes de esta escuela.');
      const e: Excepcion = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, personalId, ...datos, dia: datos.dia as DiaSemana };
      await this.ctx.repos.excepciones.insertar(e);
      return e;
    });
  }

  /** No se quita un caso especial mientras haya clases simultáneas que dependan de él. */
  async eliminarExcepcion(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const e = await requerir(this.ctx.repos.excepciones.obtener(id), 'el caso especial');
      await cicloEditable(this.ctx, e.cicloEscolarId);
      const sesiones = (await this.ctx.repos.sesiones.listarPor('personalId', e.personalId)).filter((s) => s.cicloEscolarId === e.cicloEscolarId && s.dia === e.dia);
      const conHora: { horaInicio: string; horaFin: string }[] = [];
      for (const s of sesiones) { const p = await this.ctx.repos.periodos.obtener(s.periodoId); if (p && seTraslapan(p, e)) conHora.push(p); }
      const simultaneas = conHora.some((a, i) => conHora.some((b, j) => i !== j && seTraslapan(a, b)));
      if (simultaneas) throw new ErrorDominio('TIENE_DEPENDENCIAS', 'Hay clases simultáneas que dependen de este caso especial. Quita una de ellas del horario primero.');
      await this.ctx.repos.excepciones.eliminar(id);
    });
  }
}
