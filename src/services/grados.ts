import type { Grado, Grupo } from '../models';
import { esquemaGrado, esquemaGrupo, validar, type EntradaGrado, type EntradaGrupo } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

const ORDINALES = ['Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo', 'Undécimo', 'Duodécimo'];

export function nombreSugeridoGrado(numero: number): string {
  const o = ORDINALES[numero - 1];
  return o ? `${o} grado` : `Grado ${numero}`;
}

export class ServicioGrados {
  constructor(private readonly ctx: Contexto) {}

  // ---------- Grados ----------

  async listarGrados(cicloId: string): Promise<Grado[]> {
    const grados = await this.ctx.repos.grados.listarPor('cicloEscolarId', cicloId);
    return grados.sort((a, b) => a.numero - b.numero);
  }

  crearGrado(cicloId: string, entrada: EntradaGrado): Promise<Grado> {
    const datos = validar(esquemaGrado, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificarGrado(cicloId, datos, undefined);
      const grado: Grado = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos };
      await this.ctx.repos.grados.insertar(grado);
      return grado;
    });
  }

  actualizarGrado(id: string, entrada: EntradaGrado): Promise<Grado> {
    const datos = validar(esquemaGrado, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grados.obtener(id), 'el grado');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificarGrado(actual.cicloEscolarId, datos, id);
      const grado: Grado = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.grados.actualizar(grado);
      return grado;
    });
  }

  eliminarGrado(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grados.obtener(id), 'el grado');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      const grupos = await this.ctx.repos.grupos.contarPor('gradoId', id);
      if (grupos > 0) {
        throw new ErrorDominio('TIENE_DEPENDENCIAS', `El grado tiene ${grupos} grupo(s). Elimínalos primero.`);
      }
      await this.ctx.repos.grados.eliminar(id);
    });
  }

  private async verificarGrado(cicloId: string, datos: { numero: number; nombre: string }, idActual?: string) {
    const grados = await this.ctx.repos.grados.listarPor('cicloEscolarId', cicloId);
    if (grados.some((g) => g.id !== idActual && g.numero === datos.numero)) {
      const mensaje = `Ya existe el grado ${datos.numero} en este ciclo.`;
      throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'numero', mensaje }]);
    }
    asegurarSinDuplicado(grados, (g) => g.nombre, datos.nombre, idActual, 'nombre',
      'Ya existe un grado con ese nombre en este ciclo.');
  }

  // ---------- Grupos ----------

  listarGrupos(cicloId: string): Promise<Grupo[]> {
    return this.ctx.repos.grupos.listarPor('cicloEscolarId', cicloId);
  }

  crearGrupo(cicloId: string, entrada: EntradaGrupo): Promise<Grupo> {
    const datos = validar(esquemaGrupo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificarGrupo(cicloId, datos, undefined);
      const grupo: Grupo = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos };
      await this.ctx.repos.grupos.insertar(grupo);
      return grupo;
    });
  }

  actualizarGrupo(id: string, entrada: EntradaGrupo): Promise<Grupo> {
    const datos = validar(esquemaGrupo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificarGrupo(actual.cicloEscolarId, datos, id);
      const grupo: Grupo = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.grupos.actualizar(grupo);
      return grupo;
    });
  }

  eliminarGrupo(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.ctx.repos.grupos.eliminar(id);
    });
  }

  /** El grado y el turno deben pertenecer al mismo ciclo; el nombre es único por grado y turno. */
  private async verificarGrupo(cicloId: string, datos: { gradoId: string; turnoId: string; nombre: string }, idActual?: string) {
    const grado = await this.ctx.repos.grados.obtener(datos.gradoId);
    if (!grado || grado.cicloEscolarId !== cicloId) {
      throw new ErrorDominio('VALIDACION', 'El grado seleccionado no pertenece a este ciclo.', [{ campo: 'gradoId', mensaje: 'Selecciona un grado válido.' }]);
    }
    const turno = await this.ctx.repos.turnos.obtener(datos.turnoId);
    if (!turno || turno.cicloEscolarId !== cicloId) {
      throw new ErrorDominio('VALIDACION', 'El turno seleccionado no pertenece a este ciclo.', [{ campo: 'turnoId', mensaje: 'Selecciona un turno válido.' }]);
    }
    const hermanos = (await this.ctx.repos.grupos.listarPor('gradoId', datos.gradoId)).filter((g) => g.turnoId === datos.turnoId);
    asegurarSinDuplicado(hermanos, (g) => g.nombre, datos.nombre, idActual, 'nombre',
      `Ya existe el grupo «${datos.nombre}» en ${grado.nombre}, turno ${turno.nombre}.`);
  }
}
