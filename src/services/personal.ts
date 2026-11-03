import type { Adscripcion, FuncionPersonal, Personal } from '../models';
import { normalizarTexto } from '../domain/texto';
import { cicloEditable } from './contexto';
import { esquemaPersonal, validar, type EntradaPersonal } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export const ETIQUETA_FUNCION: Record<FuncionPersonal, string> = {
  docente: 'Docente',
  prefectura: 'Prefectura',
  direccion: 'Dirección',
  subdireccion_academica: 'Subdirección académica',
  subdireccion_gestion: 'Subdirección de gestión',
  orientacion: 'Orientación',
  trabajo_social: 'Trabajo social',
  udei: 'UDEI',
  secretaria: 'Secretaría',
  asistencia_escolar: 'Asistencia escolar',
  biblioteca: 'Biblioteca',
  otro: 'Otro',
  // Funciones anteriores (se conservan sin convertir; se pueden cambiar a mano)
  directivo: 'Directivo (función anterior)',
  administrativo: 'Administrativo (función anterior)',
  apoyo: 'Apoyo educativo (función anterior)',
};

export interface FiltroPersonal { texto?: string; funcion?: FuncionPersonal | null; estado?: 'activos' | 'inactivos' | 'todos'; turnoId?: string | null; cicloId?: string | null }

export function nombreCompleto(p: Pick<Personal, 'nombre' | 'primerApellido' | 'segundoApellido'>): string {
  return [p.nombre, p.primerApellido, p.segundoApellido].filter(Boolean).join(' ');
}

export class ServicioPersonal {
  constructor(private readonly ctx: Contexto) {}

  async listar(escuelaId: string): Promise<Personal[]> {
    const lista = await this.ctx.repos.personal.listarPor('escuelaId', escuelaId);
    return lista.sort((a, b) => Number(b.activo) - Number(a.activo)
      || `${a.primerApellido} ${a.nombre}`.localeCompare(`${b.primerApellido} ${b.nombre}`, 'es'));
  }

  /** Búsqueda y filtros (nombre, número de empleado, función, estado y turno del ciclo). */
  async buscar(escuelaId: string, f: FiltroPersonal = {}): Promise<Personal[]> {
    let lista = await this.listar(escuelaId);
    const estado = f.estado ?? 'activos';
    if (estado !== 'todos') lista = lista.filter((p) => p.activo === (estado === 'activos'));
    if (f.funcion) lista = lista.filter((p) => p.funciones.includes(f.funcion!));
    if (f.texto?.trim()) { const t = normalizarTexto(f.texto); lista = lista.filter((p) => normalizarTexto(`${nombreCompleto(p)} ${p.numeroEmpleado ?? ''}`).includes(t)); }
    if (f.turnoId && f.cicloId) {
      const ads = new Map((await this.ctx.repos.adscripciones.listarPor('cicloEscolarId', f.cicloId)).map((a) => [a.personalId, a]));
      lista = lista.filter((p) => ads.get(p.id)?.turnoIds.includes(f.turnoId!));
    }
    return lista;
  }

  /** Adscripciones de todo el ciclo, por persona. */
  async adscripcionesCiclo(cicloId: string): Promise<Map<string, Adscripcion>> {
    return new Map((await this.ctx.repos.adscripciones.listarPor('cicloEscolarId', cicloId)).map((a) => [a.personalId, a]));
  }

  /** Turnos y materias que puede impartir en un ciclo (null si no se ha registrado). */
  async adscripcion(personalId: string, cicloId: string): Promise<Adscripcion | null> {
    return (await this.ctx.repos.adscripciones.listarPor('personalId', personalId)).find((a) => a.cicloEscolarId === cicloId) ?? null;
  }

  /**
   * Guarda la adscripción del ciclo. Las materias son las que PUEDE impartir:
   * no crean asignaciones a grupos ni horarios.
   */
  async fijarAdscripcion(personalId: string, cicloId: string, datos: { turnoIds: string[]; materiaIds: string[] }): Promise<Adscripcion> {
    return this.ctx.uow.ejecutar(async () => {
      const p = await this.obtener(personalId);
      const ciclo = await cicloEditable(this.ctx, cicloId);
      if (ciclo.escuelaId !== p.escuelaId) throw new ErrorDominio('VALIDACION', 'La persona pertenece a otra escuela.');
      const turnoIds = [...new Set(datos.turnoIds)];
      const materiaIds = [...new Set(datos.materiaIds)];
      for (const t of turnoIds) if ((await this.ctx.repos.turnos.obtener(t))?.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'Un turno no pertenece a este ciclo.');
      for (const m of materiaIds) {
        const mat = await this.ctx.repos.materias.obtener(m);
        if (mat?.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'Una materia no pertenece a este ciclo.');
      }
      if (materiaIds.length && !p.funciones.includes('docente')) throw new ErrorDominio('VALIDACION', 'Sólo el personal con función docente tiene materias que puede impartir.');
      const actual = await this.adscripcion(personalId, cicloId);
      const a: Adscripcion = actual
        ? { ...actual, turnoIds, materiaIds, ...metadatosActualizados(this.ctx, actual) }
        : { ...metadatosNuevos(this.ctx), escuelaId: p.escuelaId, cicloEscolarId: cicloId, personalId, turnoIds, materiaIds };
      if (actual) await this.ctx.repos.adscripciones.actualizar(a); else await this.ctx.repos.adscripciones.insertar(a);
      return a;
    });
  }

  /** Personal activo con función docente (para asignar materias). */
  async docentes(escuelaId: string): Promise<Personal[]> {
    return (await this.listar(escuelaId)).filter((p) => p.activo && p.funciones.includes('docente'));
  }

  async obtener(id: string): Promise<Personal> {
    return requerir(this.ctx.repos.personal.obtener(id), 'a la persona');
  }

  async crear(escuelaId: string, entrada: EntradaPersonal): Promise<Personal> {
    const datos = validar(esquemaPersonal, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await requerir(this.ctx.repos.escuelas.obtener(escuelaId), 'la escuela');
      await this.verificarDuplicados(escuelaId, datos, undefined);
      const p: Personal = { ...metadatosNuevos(this.ctx), escuelaId, ...datos, activo: true };
      await this.ctx.repos.personal.insertar(p);
      return p;
    });
  }

  async actualizar(id: string, entrada: EntradaPersonal): Promise<Personal> {
    const datos = validar(esquemaPersonal, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await this.verificarDuplicados(actual.escuelaId, datos, id);
      if (actual.funciones.includes('docente') && !datos.funciones.includes('docente')) {
        const n = await this.asignacionesVigentes(id);
        if (n > 0) {
          const mensaje = `Tiene ${n} materia(s) asignada(s) en ciclos abiertos. Reasígnalas antes de quitarle la función de docente.`;
          throw new ErrorDominio('TIENE_DEPENDENCIAS', mensaje, [{ campo: 'funciones', mensaje }]);
        }
      }
      const p: Personal = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.personal.actualizar(p);
      return p;
    });
  }

  /** Dar de baja conserva el historial; sólo se impide si tiene clases en ciclos abiertos. */
  async cambiarActivo(id: string, activo: boolean): Promise<Personal> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      if (!activo) {
        const n = await this.asignacionesVigentes(id);
        if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Tiene ${n} materia(s) asignada(s) en ciclos abiertos. Reasígnalas antes de darle de baja.`);
      }
      const p: Personal = { ...actual, activo, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.personal.actualizar(p);
      return p;
    });
  }

  /** Sólo se elimina a quien nunca tuvo asignaciones; si las tuvo, se da de baja. */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const n = await this.ctx.repos.asignaciones.contarPor('personalId', id);
      if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Tiene ${n} asignación(es) registradas. Para conservar el historial, dale de baja en lugar de eliminarla.`);
      const historial = (await this.ctx.repos.actividades.contarPor('personalId', id)) + (await this.ctx.repos.pases.contarPor('personalId', id));
      if (historial > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', 'Tiene horas de servicio o listas registradas. Para conservar el historial, dale de baja.');
      const prefectura = (await this.ctx.repos.incidenciasPersonal.contarPor('personalId', id)) + (await this.ctx.repos.coberturas.contarPor('asignadoId', id));
      if (prefectura > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', 'Tiene incidencias o coberturas registradas en Prefectura. Para conservar el historial, dale de baja.');
      await this.ctx.repos.adscripciones.eliminarVarios((await this.ctx.repos.adscripciones.listarPor('personalId', id)).map((a) => a.id));
      await this.ctx.repos.personal.eliminar(id);
    });
  }

  private async asignacionesVigentes(personalId: string): Promise<number> {
    const asignaciones = await this.ctx.repos.asignaciones.listarPor('personalId', personalId);
    let n = 0;
    for (const a of asignaciones) {
      const ciclo = await this.ctx.repos.ciclos.obtener(a.cicloEscolarId);
      if (ciclo && ciclo.estado !== 'cerrado') n++;
    }
    return n;
  }

  private async verificarDuplicados(escuelaId: string, datos: { nombre: string; primerApellido: string; segundoApellido: string | null; numeroEmpleado: string | null }, idActual?: string) {
    const lista = await this.ctx.repos.personal.listarPor('escuelaId', escuelaId);
    if (datos.numeroEmpleado) {
      asegurarSinDuplicado(lista.filter((p) => p.numeroEmpleado), (p) => p.numeroEmpleado ?? '', datos.numeroEmpleado, idActual, 'numeroEmpleado',
        'Ya existe una persona con ese número de empleado.');
    } else {
      asegurarSinDuplicado(lista.filter((p) => !p.numeroEmpleado), nombreCompleto, nombreCompleto(datos), idActual, 'nombre',
        'Ya existe una persona con ese nombre completo. Si son personas distintas, agrega el número de empleado.');
    }
  }
}
