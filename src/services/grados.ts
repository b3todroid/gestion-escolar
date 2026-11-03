import type { Grado, Grupo } from '../models';
import { esquemaGrado, esquemaGrupo, validar, type EntradaGrado, type EntradaGrupo } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
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

  async crearGrado(cicloId: string, entrada: EntradaGrado): Promise<Grado> {
    const datos = validar(esquemaGrado, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificarGrado(cicloId, datos, undefined);
      const grado: Grado = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos };
      await this.ctx.repos.grados.insertar(grado);
      return grado;
    });
  }

  async actualizarGrado(id: string, entrada: EntradaGrado): Promise<Grado> {
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

  async eliminarGrado(id: string): Promise<void> {
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

  async obtenerGrupo(id: string): Promise<Grupo> {
    return requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
  }

  async listarGrupos(cicloId: string): Promise<Grupo[]> {
    return this.ctx.repos.grupos.listarPor('cicloEscolarId', cicloId);
  }

  async crearGrupo(cicloId: string, entrada: EntradaGrupo): Promise<Grupo> {
    const datos = validar(esquemaGrupo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificarGrupo(cicloId, datos, undefined);
      const grupo: Grupo = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos, activo: true };
      await this.ctx.repos.grupos.insertar(grupo);
      return grupo;
    });
  }

  async actualizarGrupo(id: string, entrada: EntradaGrupo): Promise<Grupo> {
    const datos = validar(esquemaGrupo, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificarGrupo(actual.cicloEscolarId, datos, id);
      if (datos.turnoId !== actual.turnoId && (await this.ctx.repos.sesiones.contarPor('grupoId', id)) > 0) {
        const mensaje = 'El grupo ya tiene clases en el horario de su turno. Quítalas antes de cambiarlo de turno.';
        throw new ErrorDominio('TIENE_DEPENDENCIAS', mensaje, [{ campo: 'turnoId', mensaje }]);
      }
      const grupo: Grupo = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.grupos.actualizar(grupo);
      return grupo;
    });
  }

  /** Varios grupos de un grado y turno a la vez. Todo o nada; sin duplicados. */
  async crearVariosGrupos(cicloId: string, entrada: { gradoId: string; turnoId: string; nombres: string[]; capacidad?: number | null }): Promise<Grupo[]> {
    if (!entrada.nombres.length) throw new ErrorDominio('VALIDACION', 'Escribe al menos un grupo.', [{ campo: 'nombres', mensaje: 'Escribe al menos un grupo.' }]);
    const vistos = new Set<string>();
    for (const n of entrada.nombres) {
      const k = normalizarTexto(n);
      if (vistos.has(k)) { const mensaje = `«${n}» está repetido en la lista.`; throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'nombres', mensaje }]); }
      vistos.add(k);
    }
    return this.ctx.uow.ejecutar(async () => {
      const r: Grupo[] = [];
      for (const nombre of entrada.nombres) {
        try { r.push(await this.crearGrupo(cicloId, { gradoId: entrada.gradoId, turnoId: entrada.turnoId, nombre, capacidad: entrada.capacidad ?? null })); }
        catch (e) { if (e instanceof ErrorDominio) throw new ErrorDominio(e.codigo, e.message, [{ campo: 'nombres', mensaje: e.message }]); throw e; }
      }
      return r;
    });
  }

  /**
   * Desactivar conserva el grupo y su historial, pero deja de recibir materias,
   * clases y alumnos. Sólo si no tiene alumnos activos ni materias asignadas.
   */
  async cambiarActivoGrupo(id: string, activo: boolean): Promise<Grupo> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      if (!activo) {
        const alumnos = (await this.ctx.repos.alumnos.listarPor('grupoId', id)).filter((a) => a.activo).length;
        if (alumnos > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `El grupo tiene ${alumnos} alumno(s) activos. Cámbialos de grupo o dalos de baja antes de desactivarlo.`);
        const materias = await this.ctx.repos.asignaciones.contarPor('grupoId', id);
        if (materias > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `El grupo tiene ${materias} materia(s) asignada(s). Quítalas antes de desactivarlo.`);
      }
      const g: Grupo = { ...actual, activo, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.grupos.actualizar(g);
      return g;
    });
  }

  async eliminarGrupo(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.grupos.obtener(id), 'el grupo');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      const asignadas = await this.ctx.repos.asignaciones.contarPor('grupoId', id);
      if (asignadas > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `El grupo tiene ${asignadas} materia(s) asignada(s). Quítalas primero.`);
      const alumnos = await this.ctx.repos.alumnos.contarPor('grupoId', id);
      if (alumnos > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `El grupo tiene ${alumnos} alumno(s) registrados. No se puede eliminar.`);
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
