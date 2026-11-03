import type { ConfirmacionHorario, RegistroBitacora } from '../models';
import { esquemaMotivo, validar } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, cicloEditable, metadatosNuevos, requerir } from './contexto';

/**
 * Confirmación de horarios de grupo. Un horario confirmado queda bloqueado:
 * ninguna operación lo modifica (ni la importación) hasta que alguien lo
 * reabra indicando el motivo, que queda registrado en la bitácora.
 */
export class ServicioConfirmacion {
  constructor(private readonly ctx: Contexto) {}

  async estado(grupoId: string): Promise<ConfirmacionHorario | null> {
    return (await this.ctx.repos.confirmaciones.listarPor('grupoId', grupoId))[0] ?? null;
  }

  async confirmados(cicloId: string): Promise<Set<string>> {
    return new Set((await this.ctx.repos.confirmaciones.listarPor('cicloEscolarId', cicloId)).map((c) => c.grupoId));
  }

  async confirmar(grupoId: string): Promise<ConfirmacionHorario> {
    return this.ctx.uow.ejecutar(async () => {
      const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
      await cicloEditable(this.ctx, grupo.cicloEscolarId);
      if (await this.estado(grupoId)) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'El horario ya está confirmado.');
      if ((await this.ctx.repos.sesiones.contarPor('grupoId', grupoId)) === 0) {
        throw new ErrorDominio('VALIDACION', 'El horario no tiene clases. Programa al menos una antes de confirmarlo.');
      }
      const c: ConfirmacionHorario = { ...metadatosNuevos(this.ctx), escuelaId: grupo.escuelaId, cicloEscolarId: grupo.cicloEscolarId, grupoId };
      await this.ctx.repos.confirmaciones.insertar(c);
      await this.registrar(grupo.escuelaId, grupo.cicloEscolarId, grupoId, 'confirmar', null);
      return c;
    });
  }

  /** Autorización explícita: sólo con motivo, que queda en la bitácora. */
  async reabrir(grupoId: string, motivo: string): Promise<void> {
    const m = validar(esquemaMotivo, motivo);
    return this.ctx.uow.ejecutar(async () => {
      const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
      await cicloEditable(this.ctx, grupo.cicloEscolarId);
      const c = await this.estado(grupoId);
      if (!c) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'El horario no está confirmado.');
      await this.ctx.repos.confirmaciones.eliminar(c.id);
      await this.registrar(grupo.escuelaId, grupo.cicloEscolarId, grupoId, 'reabrir', m);
    });
  }

  async bitacora(entidadId: string): Promise<RegistroBitacora[]> {
    const r = await this.ctx.repos.bitacora.listarPor('entidadId', entidadId);
    return r.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }

  private async registrar(escuelaId: string, cicloEscolarId: string, entidadId: string, accion: RegistroBitacora['accion'], motivo: string | null, detalle: string | null = null) {
    await this.ctx.repos.bitacora.insertar({ ...metadatosNuevos(this.ctx), escuelaId, cicloEscolarId, entidad: 'horario_grupo', entidadId, accion, motivo, detalle });
  }
}
