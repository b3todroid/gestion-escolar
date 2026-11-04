import type { Escuela } from '../models';
import { esquemaDatosPlantel, esquemaDatosPlantelDemostracion, esquemaEscuela, validar, type EntradaEscuela } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export class ServicioEscuelas {
  constructor(private readonly ctx: Contexto) {}

  async listar(): Promise<Escuela[]> {
    const todas = await this.ctx.repos.escuelas.listarTodos();
    return todas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async obtener(id: string): Promise<Escuela> {
    return requerir(this.ctx.repos.escuelas.obtener(id), 'la escuela');
  }

  /** `estricto`: reglas del asistente/edición (CCT, entidad y municipio obligatorios y coherentes). */
  async crear(entrada: EntradaEscuela, estricto = false): Promise<Escuela> {
    const datos = validar(estricto ? esquemaDatosPlantel : esquemaEscuela, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await this.verificarDuplicados(datos.nombre, datos.cct, undefined);
      // Desde la interfaz nunca se crea una escuela de demostración (sólo el generador del piloto).
      const escuela: Escuela = { ...metadatosNuevos(this.ctx), ...datos, demostracion: false };
      await this.ctx.repos.escuelas.insertar(escuela);
      return escuela;
    });
  }

  /** Valida datos y duplicados sin guardar (lo usa el asistente antes de avanzar). */
  async validarNueva(entrada: EntradaEscuela): Promise<void> {
    const datos = validar(esquemaDatosPlantel, entrada);
    await this.verificarDuplicados(datos.nombre, datos.cct, undefined);
  }

  async actualizar(id: string, entrada: EntradaEscuela, estricto = false): Promise<Escuela> {
    const previa = await this.obtener(id);
    const datos = validar(estricto ? (previa.demostracion ? esquemaDatosPlantelDemostracion : esquemaDatosPlantel) : esquemaEscuela, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      if (actual.demostracion && datos.cct) throw new ErrorDominio('VALIDACION', 'Una escuela de demostración no lleva CCT.', [{ campo: 'cct', mensaje: 'Una escuela de demostración no lleva CCT: no se inventa una clave oficial.' }]);
      await this.verificarDuplicados(datos.nombre, datos.cct, id);
      // La marca de demostración no cambia al editar.
      const escuela: Escuela = { ...actual, ...datos, demostracion: actual.demostracion, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.escuelas.actualizar(escuela);
      return escuela;
    });
  }

  /** Sólo se elimina una escuela sin ciclos escolares registrados. */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const ciclos = await this.ctx.repos.ciclos.contarPor('escuelaId', id);
      if (ciclos > 0) {
        throw new ErrorDominio(
          'TIENE_DEPENDENCIAS',
          `La escuela tiene ${ciclos} ciclo(s) escolar(es). Elimínalos antes de eliminar la escuela.`,
        );
      }
      const personal = await this.ctx.repos.personal.contarPor('escuelaId', id);
      if (personal > 0) {
        throw new ErrorDominio('TIENE_DEPENDENCIAS', `La escuela tiene ${personal} persona(s) registradas. Elimínalas o consérvalas dadas de baja.`);
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
