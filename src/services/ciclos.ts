import type { CicloEscolar, EstadoCiclo } from '../models';
import { esquemaCiclo, esquemaEstadoCiclo, validar, type EntradaCiclo } from '../validators/esquemas';
import { asegurarSinDuplicado, puedeCambiarEstado, rangosFechaSeTraslapan } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export const ETIQUETA_ESTADO: Record<EstadoCiclo, string> = {
  planeacion: 'En planeación',
  activo: 'Activo',
  cerrado: 'Cerrado',
};

export class ServicioCiclos {
  constructor(private readonly ctx: Contexto) {}

  async listar(escuelaId: string): Promise<CicloEscolar[]> {
    const ciclos = await this.ctx.repos.ciclos.listarPor('escuelaId', escuelaId);
    return ciclos.sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
  }

  obtener(id: string): Promise<CicloEscolar> {
    return requerir(this.ctx.repos.ciclos.obtener(id), 'el ciclo escolar');
  }

  crear(escuelaId: string, entrada: EntradaCiclo): Promise<CicloEscolar> {
    const datos = validar(esquemaCiclo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await requerir(this.ctx.repos.escuelas.obtener(escuelaId), 'la escuela');
      await this.verificar(escuelaId, datos, undefined);
      const ciclo: CicloEscolar = { ...metadatosNuevos(this.ctx), escuelaId, ...datos, estado: 'planeacion' };
      await this.ctx.repos.ciclos.insertar(ciclo);
      return ciclo;
    });
  }

  actualizar(id: string, entrada: EntradaCiclo): Promise<CicloEscolar> {
    const datos = validar(esquemaCiclo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await cicloEditable(this.ctx, id);
      await this.verificar(actual.escuelaId, datos, id);
      const ciclo: CicloEscolar = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.ciclos.actualizar(ciclo);
      return ciclo;
    });
  }

  cambiarEstado(id: string, nuevo: EstadoCiclo): Promise<CicloEscolar> {
    const estado = validar(esquemaEstadoCiclo, nuevo);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      if (!puedeCambiarEstado(actual.estado, estado)) {
        throw new ErrorDominio('ESTADO_NO_PERMITIDO',
          `No se puede pasar de «${ETIQUETA_ESTADO[actual.estado]}» a «${ETIQUETA_ESTADO[estado]}».`);
      }
      if (estado === 'activo') {
        const activos = await this.ctx.repos.ciclos.listarPor('escuelaId', actual.escuelaId);
        const otro = activos.find((c) => c.estado === 'activo' && c.id !== id);
        if (otro) {
          throw new ErrorDominio('ESTADO_NO_PERMITIDO',
            `Ya hay un ciclo activo («${otro.nombre}»). Ciérralo antes de activar otro.`);
        }
      }
      const ciclo: CicloEscolar = { ...actual, estado, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.ciclos.actualizar(ciclo);
      return ciclo;
    });
  }

  /** Sólo se elimina un ciclo vacío (sin turnos ni grados). */
  eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const turnos = await this.ctx.repos.turnos.contarPor('cicloEscolarId', id);
      const grados = await this.ctx.repos.grados.contarPor('cicloEscolarId', id);
      if (turnos + grados > 0) {
        throw new ErrorDominio('TIENE_DEPENDENCIAS',
          `El ciclo tiene ${turnos} turno(s) y ${grados} grado(s). Elimínalos antes de eliminar el ciclo.`);
      }
      await this.ctx.repos.ciclos.eliminar(id);
    });
  }

  private async verificar(escuelaId: string, datos: { nombre: string; fechaInicio: string; fechaFin: string }, idActual?: string) {
    const ciclos = await this.ctx.repos.ciclos.listarPor('escuelaId', escuelaId);
    asegurarSinDuplicado(ciclos, (c) => c.nombre, datos.nombre, idActual, 'nombre',
      'Ya existe un ciclo escolar con ese nombre en esta escuela.');
    const choque = ciclos.find((c) => c.id !== idActual && rangosFechaSeTraslapan(c, datos));
    if (choque) {
      const mensaje = `Las fechas se traslapan con el ciclo «${choque.nombre}» (${choque.fechaInicio} a ${choque.fechaFin}).`;
      throw new ErrorDominio('TRASLAPE', mensaje, [{ campo: 'fechaInicio', mensaje }]);
    }
  }
}
