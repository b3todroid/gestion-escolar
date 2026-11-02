import type { Escuela } from '../models';
import { esquemaEscuela, validar, type EntradaEscuela } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export class ServicioEscuelas {
  constructor(private readonly ctx: Contexto) {}

  async listar(): Promise<Escuela[]> {
    const todas = await this.ctx.repos.escuelas.listarTodos();
    return todas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  obtener(id: string): Promise<Escuela> {
    return requerir(this.ctx.repos.escuelas.obtener(id), 'la escuela');
  }

  crear(entrada: EntradaEscuela): Promise<Escuela> {
    const datos = validar(esquemaEscuela, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await this.verificarDuplicados(datos.nombre, datos.cct, undefined);
      const escuela: Escuela = { ...metadatosNuevos(this.ctx), ...datos };
      await this.ctx.repos.escuelas.insertar(escuela);
      return escuela;
    });
  }

  actualizar(id: string, entrada: EntradaEscuela): Promise<Escuela> {
    const datos = validar(esquemaEscuela, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await this.verificarDuplicados(datos.nombre, datos.cct, id);
      const escuela: Escuela = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.escuelas.actualizar(escuela);
      return escuela;
    });
  }

  /** Sólo se elimina una escuela sin ciclos escolares registrados. */
  eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const ciclos = await this.ctx.repos.ciclos.contarPor('escuelaId', id);
      if (ciclos > 0) {
        throw new ErrorDominio(
          'TIENE_DEPENDENCIAS',
          `La escuela tiene ${ciclos} ciclo(s) escolar(es). Elimínalos antes de eliminar la escuela.`,
        );
      }
      await this.ctx.repos.escuelas.eliminar(id);
    });
  }

  private async verificarDuplicados(nombre: string, cct: string | null, idActual: string | undefined) {
    const todas = await this.ctx.repos.escuelas.listarTodos();
    if (cct) {
      asegurarSinDuplicado(todas.filter((e) => e.cct), (e) => e.cct ?? '', cct, idActual, 'cct',
        'Ya existe una escuela con esa clave de centro de trabajo.');
    } else {
      asegurarSinDuplicado(todas.filter((e) => !e.cct), (e) => e.nombre, nombre, idActual, 'nombre',
        'Ya existe una escuela con ese nombre y sin clave. Agrega la clave para distinguirlas.');
    }
  }
}
