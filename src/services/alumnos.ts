import type { Alumno, AlumnoInscrito, EstadoInscripcion, Inscripcion, MovimientoInscripcion } from '../models';
import { esquemaAlumno, esquemaAlumnosLote, esquemaInscripcion, validar, type EntradaAlumno, type EntradaInscripcion } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { type Contexto, asegurarGrupoActivo, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export function nombreAlumno(a: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>): string {
  return [a.primerApellido, a.segundoApellido].filter(Boolean).join(' ') + `, ${a.nombre}`;
}

/** Orden de lista: por apellidos y nombre (como en las listas escolares). */
export function ordenLista(a: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>, b: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>): number {
  return `${a.primerApellido} ${a.segundoApellido ?? ''} ${a.nombre}`.localeCompare(`${b.primerApellido} ${b.segundoApellido ?? ''} ${b.nombre}`, 'es');
}

export const claveNombre = (a: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>) => normalizarTexto(`${a.primerApellido} ${a.segundoApellido ?? ''} ${a.nombre}`);

/**
 * Interpreta «Apellidos, Nombre(s)». Sólo si no hay ambigüedad: uno o dos
 * apellidos antes de la coma. Con más palabras (p. ej. «De la Cruz López»)
 * no se adivina: se pide capturarlos por separado.
 */
export function interpretarRenglon(linea: string): EntradaAlumno | null {
  const partes = linea.split(',');
  if (partes.length !== 2) return null;
  const apellidos = partes[0]!.trim().split(/\s+/).filter(Boolean);
  const nombre = partes[1]!.trim();
  if (!apellidos.length || apellidos.length > 2 || !nombre) return null;
  return { primerApellido: apellidos[0]!, segundoApellido: apellidos[1] ?? null, nombre };
}

export interface FiltroAlumnos {
  gradoId?: string | null;
  grupoId?: string | null;
  sinGrupo?: boolean;
  texto?: string;
  incluirBajas?: boolean;
}

export interface ResumenMatricula {
  inscritos: number;
  bajas: number;
  sinGrupo: number;
  porGrado: { gradoId: string | null; n: number }[];
  porGrupo: { grupoId: string; n: number }[];
}

/**
 * Alumnos: IDENTIDAD (una por persona en la escuela) separada de su
 * INSCRIPCIÓN en cada ciclo (turno, grado, grupo y estado). Cambiar de grupo
 * actualiza la inscripción y deja constancia; nunca crea otra persona.
 */
export class ServicioAlumnos {
  constructor(private readonly ctx: Contexto) {}

  private async componer(ins: Inscripcion): Promise<AlumnoInscrito | null> {
    const a = await this.ctx.repos.alumnos.obtener(ins.alumnoId);
    return a ? { ...a, inscripcion: ins, grupoId: ins.grupoId, activo: ins.estado === 'inscrito' } : null;
  }

  private async componerVarios(lista: Inscripcion[]): Promise<AlumnoInscrito[]> {
    const r: AlumnoInscrito[] = [];
    for (const i of lista) { const x = await this.componer(i); if (x) r.push(x); }
    return r.sort((a, b) => Number(b.activo) - Number(a.activo) || ordenLista(a, b));
  }

  /** Alumnos inscritos en un grupo (por omisión, sólo los vigentes). */
  async listarGrupo(grupoId: string, incluirBajas = false): Promise<AlumnoInscrito[]> {
    const ins = (await this.ctx.repos.inscripciones.listarPor('grupoId', grupoId)).filter((i) => incluirBajas || i.estado === 'inscrito');
    return this.componerVarios(ins);
  }

  async listarCiclo(cicloId: string, f: FiltroAlumnos = {}): Promise<AlumnoInscrito[]> {
    let ins = (await this.ctx.repos.inscripciones.listarPor('cicloEscolarId', cicloId)).filter((i) => f.incluirBajas || i.estado === 'inscrito');
    if (f.gradoId) ins = ins.filter((i) => i.gradoId === f.gradoId);
    if (f.grupoId) ins = ins.filter((i) => i.grupoId === f.grupoId);
    if (f.sinGrupo) ins = ins.filter((i) => i.grupoId === null);
    let r = await this.componerVarios(ins);
    if (f.texto?.trim()) {
      const t = normalizarTexto(f.texto);
      r = r.filter((a) => claveNombre(a).includes(t) || normalizarTexto(`${a.nombre} ${a.primerApellido} ${a.segundoApellido ?? ''}`).includes(t) || (a.matricula && normalizarTexto(a.matricula).includes(t)));
    }
    return r;
  }

  async obtener(id: string): Promise<Alumno> {
    return requerir(this.ctx.repos.alumnos.obtener(id), 'al alumno');
  }

  /** Inscripciones del alumno, de la más reciente a la más antigua. */
  async inscripciones(alumnoId: string): Promise<Inscripcion[]> {
    const lista = await this.ctx.repos.inscripciones.listarPor('alumnoId', alumnoId);
    const fecha = new Map<string, string>();
    for (const i of lista) fecha.set(i.cicloEscolarId, (await this.ctx.repos.ciclos.obtener(i.cicloEscolarId))?.fechaInicio ?? '');
    return lista.sort((a, b) => (fecha.get(b.cicloEscolarId) ?? '').localeCompare(fecha.get(a.cicloEscolarId) ?? ''));
  }

  /** La inscripción más reciente del alumno (para pantallas sin ciclo explícito). */
  async inscripcionReciente(alumnoId: string): Promise<Inscripcion> {
    const [i] = await this.inscripciones(alumnoId);
    if (!i) throw new ErrorDominio('NO_ENCONTRADO', 'El alumno no tiene inscripciones.');
    return i;
  }

  async movimientos(alumnoId: string): Promise<MovimientoInscripcion[]> {
    return (await this.ctx.repos.movimientos.listarPor('alumnoId', alumnoId)).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }

  // ---------- Altas ----------

  /** Alta en un grupo (atajo usado por las listas y el pase de lista). */
  async crear(grupoId: string, entrada: EntradaAlumno): Promise<AlumnoInscrito> {
    const grupo = await requerir(this.ctx.repos.grupos.obtener(grupoId), 'el grupo');
    return this.inscribirNuevo(grupo.cicloEscolarId, entrada, { grupoId });
  }

  /** Alta de una persona nueva e inscripción en el ciclo (con o sin grupo). */
  async inscribirNuevo(cicloId: string, entrada: EntradaAlumno, inscripcion: EntradaInscripcion = {}): Promise<AlumnoInscrito> {
    const datos = validar(esquemaAlumno, entrada);
    const ins = validar(esquemaInscripcion, inscripcion);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificarIdentidad(ciclo.escuelaId, datos, undefined);
      const destino = await this.resolverDestino(cicloId, ins);
      if (destino.grupoId) await this.verificarNombreEnGrupo(destino.grupoId, datos, undefined);
      const a: Alumno = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, ...datos };
      await this.ctx.repos.alumnos.insertar(a);
      const i: Inscripcion = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, alumnoId: a.id, ...destino, estado: 'inscrito', numeroLista: ins.numeroLista };
      await this.ctx.repos.inscripciones.insertar(i);
      await this.registrar(i, 'alta', null, i.grupoId, null);
      return { ...a, inscripcion: i, grupoId: i.grupoId, activo: true };
    });
  }

  /** Inscribe en otro ciclo a un alumno que ya existe (no crea otra persona). */
  async inscribirExistente(alumnoId: string, cicloId: string, inscripcion: EntradaInscripcion = {}): Promise<Inscripcion> {
    const ins = validar(esquemaInscripcion, inscripcion);
    return this.ctx.uow.ejecutar(async () => {
      const a = await this.obtener(alumnoId);
      const ciclo = await cicloEditable(this.ctx, cicloId);
      if (ciclo.escuelaId !== a.escuelaId) throw new ErrorDominio('VALIDACION', 'El alumno pertenece a otra escuela.');
      if ((await this.ctx.repos.inscripciones.listarPor('alumnoId', alumnoId)).some((i) => i.cicloEscolarId === cicloId)) {
        throw new ErrorDominio('DUPLICADO', 'El alumno ya está inscrito en este ciclo.');
      }
      const destino = await this.resolverDestino(cicloId, ins);
      if (destino.grupoId) await this.verificarNombreEnGrupo(destino.grupoId, a, undefined);
      const i: Inscripcion = { ...metadatosNuevos(this.ctx), escuelaId: a.escuelaId, cicloEscolarId: cicloId, alumnoId, ...destino, estado: 'inscrito', numeroLista: ins.numeroLista };
      await this.ctx.repos.inscripciones.insertar(i);
      await this.registrar(i, 'alta', null, i.grupoId, null);
      return i;
    });
  }

  /** Varios a la vez, uno por renglón «Apellidos, Nombre(s)». Todo o nada. */
  async crearVarios(grupoId: string, texto: string): Promise<AlumnoInscrito[]> {
    const lineas = validar(esquemaAlumnosLote, texto);
    const entradas = lineas.map((l, i) => {
      const e = interpretarRenglon(l);
      if (!e) {
        const mensaje = `Renglón ${i + 1} («${l}»): usa el formato «Apellidos, Nombre(s)» con uno o dos apellidos. Si hay más palabras, captúralo por separado.`;
        throw new ErrorDominio('VALIDACION', mensaje, [{ campo: 'lote', mensaje }]);
      }
      return e;
    });
    return this.ctx.uow.ejecutar(async () => {
      const r: AlumnoInscrito[] = [];
      for (const [i, e] of entradas.entries()) {
        try { r.push(await this.crear(grupoId, e)); }
        catch (err) {
          if (err instanceof ErrorDominio) { const mensaje = `Renglón ${i + 1}: ${err.message}`; throw new ErrorDominio(err.codigo, mensaje, [{ campo: 'lote', mensaje }]); }
          throw err;
        }
      }
      return r;
    });
  }

  // ---------- Cambios ----------

  async actualizar(id: string, entrada: EntradaAlumno): Promise<Alumno> {
    const datos = validar(esquemaAlumno, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await this.verificarIdentidad(actual.escuelaId, datos, id);
      for (const i of await this.ctx.repos.inscripciones.listarPor('alumnoId', id)) {
        if (i.grupoId && i.estado === 'inscrito') await this.verificarNombreEnGrupo(i.grupoId, datos, id);
      }
      const a: Alumno = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.alumnos.actualizar(a);
      return a;
    });
  }

  /** Cambia de grupo (o deja sin grupo) dentro del mismo ciclo, con constancia en el historial. */
  async cambiarGrupo(inscripcionId: string, grupoId: string | null, motivo: string | null = null): Promise<Inscripcion> {
    return this.ctx.uow.ejecutar(async () => {
      const i = await requerir(this.ctx.repos.inscripciones.obtener(inscripcionId), 'la inscripción');
      await cicloEditable(this.ctx, i.cicloEscolarId);
      if (i.estado !== 'inscrito') throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'La inscripción está dada de baja. Reactívala primero.');
      if (i.grupoId === grupoId) throw new ErrorDominio('VALIDACION', 'El alumno ya está en ese grupo.');
      if ((await this.ctx.repos.salidas.listarPor('alumnoId', i.alumnoId)).some((s) => s.regreso === null)) {
        throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'El alumno está fuera del aula. Registra su reincorporación antes de cambiarlo de grupo.');
      }
      const destino = await this.resolverDestino(i.cicloEscolarId, { grupoId, gradoId: grupoId ? null : i.gradoId, turnoId: grupoId ? null : i.turnoId });
      if (destino.grupoId) await this.verificarNombreEnGrupo(destino.grupoId, await this.obtener(i.alumnoId), i.alumnoId);
      const n: Inscripcion = { ...i, ...destino, numeroLista: null, ...metadatosActualizados(this.ctx, i) };
      await this.ctx.repos.inscripciones.actualizar(n);
      await this.registrar(n, 'cambio_grupo', i.grupoId, n.grupoId, motivo);
      return n;
    });
  }

  /** Baja administrativa (o reactivación) de la inscripción en el ciclo. La identidad y el historial se conservan. */
  async cambiarEstado(inscripcionId: string, estado: EstadoInscripcion, motivo: string | null = null): Promise<Inscripcion> {
    return this.ctx.uow.ejecutar(async () => {
      const i = await requerir(this.ctx.repos.inscripciones.obtener(inscripcionId), 'la inscripción');
      await cicloEditable(this.ctx, i.cicloEscolarId);
      if (i.estado === estado) return i;
      if (estado === 'baja' && (await this.ctx.repos.salidas.listarPor('alumnoId', i.alumnoId)).some((s) => s.regreso === null)) {
        throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'El alumno está fuera del aula. Registra su reincorporación antes de darlo de baja.');
      }
      if (estado === 'inscrito' && i.grupoId) {
        const g = await requerir(this.ctx.repos.grupos.obtener(i.grupoId), 'el grupo');
        asegurarGrupoActivo(g);
        await this.verificarNombreEnGrupo(i.grupoId, await this.obtener(i.alumnoId), i.alumnoId);
      }
      const n: Inscripcion = { ...i, estado, ...metadatosActualizados(this.ctx, i) };
      await this.ctx.repos.inscripciones.actualizar(n);
      await this.registrar(n, estado === 'baja' ? 'baja' : 'reactivacion', i.grupoId, i.grupoId, motivo);
      return n;
    });
  }

  async fijarNumeroLista(inscripcionId: string, numeroLista: number | null): Promise<Inscripcion> {
    const n = validar(esquemaInscripcion, { numeroLista }).numeroLista;
    return this.ctx.uow.ejecutar(async () => {
      const i = await requerir(this.ctx.repos.inscripciones.obtener(inscripcionId), 'la inscripción');
      await cicloEditable(this.ctx, i.cicloEscolarId);
      const r: Inscripcion = { ...i, numeroLista: n, ...metadatosActualizados(this.ctx, i) };
      await this.ctx.repos.inscripciones.actualizar(r);
      return r;
    });
  }

  /** Compatibilidad: baja/reactivación de la inscripción más reciente. */
  async cambiarActivo(alumnoId: string, activo: boolean): Promise<Inscripcion> {
    const i = await this.inscripcionReciente(alumnoId);
    return this.cambiarEstado(i.id, activo ? 'inscrito' : 'baja');
  }

  /** Sólo si se registró por error: sin asistencias, salidas, reportes ni otros ciclos. */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const inscripciones = await this.ctx.repos.inscripciones.listarPor('alumnoId', id);
      for (const i of inscripciones) await cicloEditable(this.ctx, i.cicloEscolarId);
      const n = (await this.ctx.repos.asistencias.contarPor('alumnoId', id)) + (await this.ctx.repos.salidas.contarPor('alumnoId', id)) + (await this.ctx.repos.reportes.contarPor('alumnoId', id));
      if (n > 0 || inscripciones.length > 1) throw new ErrorDominio('TIENE_DEPENDENCIAS', 'El alumno tiene historial (asistencia, reportes u otros ciclos). Para conservarlo, dalo de baja.');
      await this.ctx.repos.movimientos.eliminarVarios((await this.ctx.repos.movimientos.listarPor('alumnoId', id)).map((m) => m.id));
      await this.ctx.repos.inscripciones.eliminarVarios(inscripciones.map((i) => i.id));
      await this.ctx.repos.alumnos.eliminar(id);
    });
  }

  // ---------- Consultas ----------

  async resumen(cicloId: string): Promise<ResumenMatricula> {
    const ins = await this.ctx.repos.inscripciones.listarPor('cicloEscolarId', cicloId);
    const vigentes = ins.filter((i) => i.estado === 'inscrito');
    const cuenta = <K extends string | null>(clave: (i: Inscripcion) => K) => {
      const m = new Map<K, number>();
      for (const i of vigentes) m.set(clave(i), (m.get(clave(i)) ?? 0) + 1);
      return m;
    };
    return {
      inscritos: vigentes.length,
      bajas: ins.length - vigentes.length,
      sinGrupo: vigentes.filter((i) => !i.grupoId).length,
      porGrado: [...cuenta((i) => i.gradoId)].map(([gradoId, n]) => ({ gradoId, n })),
      porGrupo: [...cuenta((i) => i.grupoId)].filter(([g]) => g !== null).map(([grupoId, n]) => ({ grupoId: grupoId!, n })),
    };
  }

  /**
   * Posibles inscripciones dobles: alumnos DISTINTOS con el mismo nombre
   * (normalizado) inscritos en el mismo ciclo y turno. No se fusionan: se informa.
   */
  async posiblesDuplicados(cicloId: string): Promise<AlumnoInscrito[][]> {
    const todos = await this.listarCiclo(cicloId);
    const grupos = new Map<string, AlumnoInscrito[]>();
    for (const a of todos) grupos.set(claveNombre(a), [...(grupos.get(claveNombre(a)) ?? []), a]);
    // Mismo turno, o turno desconocido (sin grupo ni turno): se considera compatible.
    return [...grupos.values()].filter((g) => g.length > 1 && new Set(g.map((x) => x.inscripcion.turnoId).filter(Boolean)).size <= 1);
  }

  // ---------- Reglas internas ----------

  /** Matrícula y CURP únicas en la escuela (son identificadores fuertes). */
  private async verificarIdentidad(escuelaId: string, d: { matricula: string | null; curp: string | null }, idActual?: string) {
    if (!d.matricula && !d.curp) return;
    // Consultas por índice (v12): sólo se leen las coincidencias, no toda la escuela.
    const otros = async (campo: 'matricula' | 'curp', valor: string) =>
      (await this.ctx.repos.alumnos.listarPor(campo, valor)).filter((a) => a.escuelaId === escuelaId && a.id !== idActual);
    if (d.matricula && (await otros('matricula', d.matricula)).length > 0) {
      const mensaje = 'Otra persona ya tiene esa matrícula en la escuela.';
      throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'matricula', mensaje }]);
    }
    if (d.curp && (await otros('curp', d.curp)).length > 0) {
      const mensaje = 'Otra persona ya tiene esa CURP en la escuela.';
      throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'curp', mensaje }]);
    }
  }

  /** En un mismo grupo no puede haber dos alumnos vigentes con el mismo nombre completo. */
  private async verificarNombreEnGrupo(grupoId: string, d: { nombre: string; primerApellido: string; segundoApellido: string | null }, alumnoIdActual?: string) {
    const clave = claveNombre(d);
    const ids = (await this.ctx.repos.inscripciones.listarPor('grupoId', grupoId)).filter((x) => x.estado === 'inscrito' && x.alumnoId !== alumnoIdActual).map((x) => x.alumnoId);
    // Una sola lectura para todo el grupo (antes, una por compañero: lento al importar en volumen).
    for (const otro of await this.ctx.repos.alumnos.obtenerVarios(ids)) {
      if (claveNombre(otro) === clave) {
        const mensaje = `Ya existe ${d.nombre} ${d.primerApellido} en este grupo.`;
        throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'nombre', mensaje }]);
      }
    }
  }

  /** Completa grado y turno a partir del grupo; valida que todo sea del ciclo. */
  private async resolverDestino(cicloId: string, ins: { grupoId: string | null; gradoId: string | null; turnoId: string | null }) {
    if (ins.grupoId) {
      const g = await requerir(this.ctx.repos.grupos.obtener(ins.grupoId), 'el grupo');
      if (g.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'El grupo pertenece a otro ciclo escolar.');
      asegurarGrupoActivo(g);
      return { grupoId: g.id, gradoId: g.gradoId, turnoId: g.turnoId };
    }
    if (ins.gradoId) {
      const gr = await requerir(this.ctx.repos.grados.obtener(ins.gradoId), 'el grado');
      if (gr.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'El grado pertenece a otro ciclo escolar.');
    }
    if (ins.turnoId) {
      const t = await requerir(this.ctx.repos.turnos.obtener(ins.turnoId), 'el turno');
      if (t.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'El turno pertenece a otro ciclo escolar.');
    }
    return { grupoId: null, gradoId: ins.gradoId, turnoId: ins.turnoId };
  }

  private async registrar(i: Inscripcion, tipo: MovimientoInscripcion['tipo'], anterior: string | null, nuevo: string | null, motivo: string | null) {
    await this.ctx.repos.movimientos.insertar({
      ...metadatosNuevos(this.ctx), escuelaId: i.escuelaId, cicloEscolarId: i.cicloEscolarId, alumnoId: i.alumnoId, inscripcionId: i.id,
      tipo, grupoAnteriorId: anterior, grupoNuevoId: nuevo, motivo,
    });
  }
}
