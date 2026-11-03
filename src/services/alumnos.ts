import type { Alumno } from '../models';
import { esquemaAlumno, esquemaAlumnosLote, validar, type EntradaAlumno } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export function nombreAlumno(a: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>): string {
  return [a.primerApellido, a.segundoApellido].filter(Boolean).join(' ') + `, ${a.nombre}`;
}

/** Orden de lista: por apellidos y nombre (como en las listas escolares). */
export function ordenLista(a: Alumno, b: Alumno): number {
  return `${a.primerApellido} ${a.segundoApellido ?? ''} ${a.nombre}`.localeCompare(`${b.primerApellido} ${b.segundoApellido ?? ''} ${b.nombre}`, 'es');
}

/** Interpreta «Apellidos, Nombre(s)». */
export function interpretarRenglon(linea: string): EntradaAlumno | null {
  const partes = linea.split(',');
  if (partes.length !== 2) return null;
  const apellidos = partes[0]!.trim().split(/\s+/).filter(Boolean);
  const nombre = partes[1]!.trim();
  if (!apellidos.length || !nombre) return null;
  return { primerApellido: apellidos[0]!, segundoApellido: apellidos.slice(1).join(' ') || null, nombre };
}

export class ServicioAlumnos {
  constructor(private readonly ctx: Contexto) {}

  async listarGrupo(grupoId: string, incluirBajas = false): Promise<Alumno[]> {
    const lista = await this.ctx.repos.alumnos.listarPor('grupoId', grupoId);
    return lista.filter((a) => incluirBajas || a.activo).sort((a, b) => Number(b.activo) - Number(a.activo) || ordenLista(a, b));
  }

  async obtener(id: string): Promise<Alumno> {
    return requerir(this.ctx.repos.alumnos.obtener(id), 'al alumno');
  }

  async crear(grupoId: string, entrada: EntradaAlumno): Promise<Alumno> {
    const datos = validar(esquemaAlumno, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
      await cicloEditable(this.ctx, grupo.cicloEscolarId);
      await this.verificarDuplicado(grupoId, datos, undefined);
      const a: Alumno = { ...metadatosNuevos(this.ctx), escuelaId: grupo.escuelaId, cicloEscolarId: grupo.cicloEscolarId, grupoId, ...datos, activo: true };
      await this.ctx.repos.alumnos.insertar(a);
      return a;
    });
  }

  /** Varios a la vez, uno por renglón «Apellidos, Nombre(s)». Todo o nada. */
  async crearVarios(grupoId: string, texto: string): Promise<Alumno[]> {
    const lineas = validar(esquemaAlumnosLote, texto);
    const entradas = lineas.map((l, i) => {
      const e = interpretarRenglon(l);
      if (!e) {
        const mensaje = `Renglón ${i + 1} («${l}»): usa el formato «Apellidos, Nombre(s)».`;
        throw new ErrorDominio('VALIDACION', mensaje, [{ campo: 'lote', mensaje }]);
      }
      return e;
    });
    return this.ctx.uow.ejecutar(async () => {
      const r: Alumno[] = [];
      for (const [i, e] of entradas.entries()) {
        try { r.push(await this.crear(grupoId, e)); }
        catch (err) {
          if (err instanceof ErrorDominio) {
            const mensaje = `Renglón ${i + 1}: ${err.message}`;
            throw new ErrorDominio(err.codigo, mensaje, [{ campo: 'lote', mensaje }]);
          }
          throw err;
        }
      }
      return r;
    });
  }

  async actualizar(id: string, entrada: EntradaAlumno): Promise<Alumno> {
    const datos = validar(esquemaAlumno, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificarDuplicado(actual.grupoId, datos, id);
      const a: Alumno = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.alumnos.actualizar(a);
      return a;
    });
  }

  /** La baja conserva su historial de asistencia y reportes. */
  async cambiarActivo(id: string, activo: boolean): Promise<Alumno> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      if (!activo) {
        const fuera = (await this.ctx.repos.salidas.listarPor('alumnoId', id)).some((s) => s.regreso === null);
        if (fuera) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'El alumno está fuera del aula. Registra su reincorporación antes de darlo de baja.');
      }
      const a: Alumno = { ...actual, activo, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.alumnos.actualizar(a);
      return a;
    });
  }

  /** Sólo se elimina si no tiene asistencias, salidas ni reportes (si no, se da de baja). */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      const n = (await this.ctx.repos.asistencias.contarPor('alumnoId', id)) + (await this.ctx.repos.salidas.contarPor('alumnoId', id)) + (await this.ctx.repos.reportes.contarPor('alumnoId', id));
      if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', 'El alumno tiene registros de asistencia o reportes. Para conservar el historial, dale de baja.');
      await this.ctx.repos.alumnos.eliminar(id);
    });
  }

  private async verificarDuplicado(grupoId: string, d: { nombre: string; primerApellido: string; segundoApellido: string | null }, idActual?: string) {
    const clave = normalizarTexto(`${d.primerApellido} ${d.segundoApellido ?? ''} ${d.nombre}`);
    const lista = await this.ctx.repos.alumnos.listarPor('grupoId', grupoId);
    if (lista.some((a) => a.id !== idActual && normalizarTexto(`${a.primerApellido} ${a.segundoApellido ?? ''} ${a.nombre}`) === clave)) {
      const mensaje = `Ya existe ${d.nombre} ${d.primerApellido} en este grupo.`;
      throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'nombre', mensaje }]);
    }
  }
}
