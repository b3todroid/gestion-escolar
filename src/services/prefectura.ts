import type {
  ActividadBanco, Cobertura, DiaSemana, EstadoCobertura, IncidenciaPersonal, Periodo, Personal, RegistroPrefectura, Sesion, TipoIncidenciaPersonal,
} from '../models';
import {
  esquemaActividadBanco, esquemaAsignacionCobertura, esquemaFecha, esquemaIncidenciaPersonal, validar,
  type EntradaActividadBanco, type EntradaAsignacionCobertura, type EntradaIncidenciaPersonal,
} from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { seTraslapan, type Intervalo } from '../domain/tiempo';
import { diaDeFecha, sumarDias } from '../utils/fechas';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';
import { nombreCompleto } from './personal';

/**
 * PREFECTURA: incidencias del personal, grupos que requieren atención,
 * horas de servicio (SE) y coberturas.
 *
 * Principios:
 * - Una incidencia es REPORTADA hasta que alguien la CONFIRMA. Nunca se crea
 *   una falta automáticamente (p. ej. porque el docente no abrió la aplicación).
 * - El estado de cada clase se DERIVA (no se guarda) y distingue inferencias de
 *   hechos: SIN INFORMACIÓN SUFICIENTE · POSIBLE GRUPO SIN DOCENTE · GRUPO SIN
 *   DOCENTE CONFIRMADO · COBERTURA ASIGNADA · COBERTURA REALIZADA.
 * - La aplicación SUGIERE personal disponible; nunca asigna sola. Asignar exige
 *   indicar quién autorizó y pasa por la verificación de incompatibilidades.
 * - Tener SE no implica autorización automática para cubrir.
 */

export type EstadoClase = 'sin_informacion' | 'atendida' | 'posible' | 'confirmado' | 'cobertura_asignada' | 'cobertura_realizada';

export const ETIQUETA_ESTADO_CLASE: Record<EstadoClase, string> = {
  sin_informacion: 'SIN INFORMACIÓN SUFICIENTE',
  atendida: 'ATENDIDA (lista registrada)',
  posible: 'POSIBLE GRUPO SIN DOCENTE',
  confirmado: 'GRUPO SIN DOCENTE CONFIRMADO',
  cobertura_asignada: 'COBERTURA ASIGNADA',
  cobertura_realizada: 'COBERTURA REALIZADA',
};

export const ETIQUETA_TIPO_INCIDENCIA: Record<TipoIncidenciaPersonal, string> = {
  falta: 'Falta', retardo: 'Retardo', permiso: 'Permiso', salida_anticipada: 'Salida anticipada', otra: 'Otra',
};

export const ETIQUETA_ESTADO_COBERTURA: Record<EstadoCobertura, string> = {
  sin_docente: 'Sin docente (confirmado)', propuesta: 'Propuesta', asignada: 'Asignada', realizada: 'Realizada', no_realizada: 'No realizada', cancelada: 'Cancelada',
};

/** Tipos cuya confirmación deja al grupo sin docente en los periodos afectados. */
const DEJA_SIN_DOCENTE: TipoIncidenciaPersonal[] = ['falta', 'permiso', 'salida_anticipada'];

export interface ClaseDelDia {
  sesionId: string; grupoId: string; grupo: string; gradoId: string | null; turnoId: string; turno: string;
  periodoId: string; periodo: string; horaInicio: string; horaFin: string;
  materiaId: string | null; materia: string; docenteId: string | null; docente: string | null;
  estado: EstadoClase; motivo: string;
  incidencias: IncidenciaPersonal[]; cobertura: Cobertura | null; listaGuardada: boolean;
}

export interface Candidato {
  personalId: string; nombre: string;
  origen: 'se' | 'libre'; // SE confirmada en ese horario, o sin clase en ese horario (sin SE)
  detalle: string;
  compatible: boolean;
  problemas: string[];
}

export interface FiltroReporte {
  desde: string; hasta: string;
  grupoId?: string | null; personalId?: string | null; tipo?: TipoIncidenciaPersonal | null; estadoCobertura?: EstadoCobertura | null; turnoId?: string | null;
}

const MAX_DIAS_REPORTE = 93;
let ultimoOrden = 0;

export class ServicioPrefectura {
  constructor(private readonly ctx: Contexto) {}

  // ------------------------------------------------------------------ datos

  private async datos(cicloId: string) {
    const r = this.ctx.repos;
    const ciclo = await requerir(r.ciclos.obtener(cicloId), 'el ciclo escolar');
    return {
      ciclo,
      escuela: await requerir(r.escuelas.obtener(ciclo.escuelaId), 'la escuela'),
      grados: await r.grados.listarPor('cicloEscolarId', cicloId),
      grupos: await r.grupos.listarPor('cicloEscolarId', cicloId),
      turnos: await r.turnos.listarPor('cicloEscolarId', cicloId),
      jornadas: await r.jornadas.listarPor('cicloEscolarId', cicloId),
      periodos: await r.periodos.listarPor('cicloEscolarId', cicloId),
      materias: await r.materias.listarPor('cicloEscolarId', cicloId),
      asignaciones: await r.asignaciones.listarPor('cicloEscolarId', cicloId),
      sesiones: await r.sesiones.listarPor('cicloEscolarId', cicloId),
      actividades: await r.actividades.listarPor('cicloEscolarId', cicloId),
      personal: await r.personal.listarPor('escuelaId', ciclo.escuelaId),
      incidencias: await r.incidenciasPersonal.listarPor('cicloEscolarId', cicloId),
      coberturas: await r.coberturas.listarPor('cicloEscolarId', cicloId),
    };
  }
  private nombreGrupo(d: Awaited<ReturnType<ServicioPrefectura['datos']>>, grupoId: string) {
    const g = d.grupos.find((x) => x.id === grupoId);
    return g ? `${d.grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre}` : 'Grupo eliminado';
  }
  private validarFecha(d: { ciclo: { fechaInicio: string; fechaFin: string } }, fecha: string) {
    const f = validar(esquemaFecha, fecha);
    if (f < d.ciclo.fechaInicio || f > d.ciclo.fechaFin) throw new ErrorDominio('VALIDACION', `La fecha está fuera del ciclo escolar (${d.ciclo.fechaInicio} a ${d.ciclo.fechaFin}).`, [{ campo: 'fecha', mensaje: 'Fecha fuera del ciclo escolar.' }]);
    return f;
  }
  private async registrar(escuelaId: string, cicloId: string, entidad: RegistroPrefectura['entidad'], entidadId: string, accion: string, detalle: string | null, personalId: string | null) {
    const meta = metadatosNuevos(this.ctx);
    const existentes = await this.ctx.repos.bitacoraPrefectura.listarPor('entidadId', entidadId);
    ultimoOrden = Math.max(Date.parse(meta.creadoEn) * 1000, ultimoOrden + 1, ...existentes.map((x) => x.orden + 1));
    await this.ctx.repos.bitacoraPrefectura.insertar({ ...meta, escuelaId, cicloEscolarId: cicloId, entidad, entidadId, accion, detalle: detalle?.slice(0, 300) ?? null, personalId, orden: ultimoOrden });
  }

  /** ¿La incidencia afecta este intervalo (periodo) de esa fecha? */
  private afecta(i: IncidenciaPersonal, fecha: string, periodo: Intervalo & { id: string }, periodos: Periodo[]): boolean {
    if (i.fecha !== fecha) return false;
    if (i.alcance === 'jornada') return true;
    if (i.periodoIds.includes(periodo.id)) return true;
    // Periodos de otro turno: por hora real
    return i.periodoIds.some((pid) => { const p = periodos.find((x) => x.id === pid); return p ? seTraslapan(p, periodo) : false; });
  }

  // ------------------------------------------------------------ incidencias

  async registrarIncidencia(cicloId: string, entrada: EntradaIncidenciaPersonal, registradaPor: string | null = null): Promise<IncidenciaPersonal> {
    const v = validar(esquemaIncidenciaPersonal, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const d = { ciclo };
      const fecha = this.validarFecha(d, v.fecha);
      const p = await requerir(this.ctx.repos.personal.obtener(v.personalId), 'a la persona');
      if (p.escuelaId !== ciclo.escuelaId) throw new ErrorDominio('VALIDACION', 'La persona no pertenece a esta escuela.');
      if (!p.activo) throw new ErrorDominio('VALIDACION', 'La persona está dada de baja.');
      const periodoIds = v.alcance === 'jornada' ? [] : v.periodoIds;
      for (const pid of periodoIds) if ((await this.ctx.repos.periodos.obtener(pid))?.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'Un periodo no pertenece a este ciclo.');
      const repetida = (await this.ctx.repos.incidenciasPersonal.listarPor('personalId', p.id))
        .find((x) => x.fecha === fecha && x.tipo === v.tipo && x.estado !== 'descartada' && (x.alcance === 'jornada' || v.alcance === 'jornada' || x.periodoIds.some((y) => periodoIds.includes(y))));
      if (repetida) throw new ErrorDominio('DUPLICADO', `Ya hay una incidencia «${ETIQUETA_TIPO_INCIDENCIA[v.tipo]}» de ${nombreCompleto(p)} para esa fecha y periodo (${repetida.estado}).`);
      const i: IncidenciaPersonal = {
        ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, personalId: p.id, fecha, tipo: v.tipo,
        tipoOtro: v.tipo === 'otra' ? v.tipoOtro : null, alcance: v.alcance, periodoIds, observaciones: v.observaciones,
        estado: 'reportada', registradaPor, validadaPor: null, validadaEn: null, motivoValidacion: null,
      };
      await this.ctx.repos.incidenciasPersonal.insertar(i);
      await this.registrar(ciclo.escuelaId, cicloId, 'incidencia', i.id, 'reportar', `${ETIQUETA_TIPO_INCIDENCIA[i.tipo]}${i.tipoOtro ? ` (${i.tipoOtro})` : ''} de ${nombreCompleto(p)} el ${fecha}`, registradaPor);
      return i;
    });
  }

  /** Confirmar (hecho validado) o descartar (no ocurrió / error de captura). */
  async validarIncidencia(id: string, estado: 'confirmada' | 'descartada', quien: string | null, motivo: string | null = null): Promise<IncidenciaPersonal> {
    return this.ctx.uow.ejecutar(async () => {
      const i = await requerir(this.ctx.repos.incidenciasPersonal.obtener(id), 'la incidencia');
      await cicloEditable(this.ctx, i.cicloEscolarId);
      if (i.estado !== 'reportada') throw new ErrorDominio('ESTADO_NO_PERMITIDO', `La incidencia ya está ${i.estado}.`);
      if (estado === 'descartada' && (!motivo || motivo.trim().length < 3)) throw new ErrorDominio('VALIDACION', 'Indica el motivo para descartarla.', [{ campo: 'motivo', mensaje: 'Indica el motivo.' }]);
      const n: IncidenciaPersonal = { ...i, estado, validadaPor: quien, validadaEn: this.ctx.reloj(), motivoValidacion: motivo?.trim() || null, ...metadatosActualizados(this.ctx, i) };
      await this.ctx.repos.incidenciasPersonal.actualizar(n);
      await this.registrar(i.escuelaId, i.cicloEscolarId, 'incidencia', i.id, estado === 'confirmada' ? 'confirmar' : 'descartar', motivo, quien);
      return n;
    });
  }

  async incidencias(cicloId: string, f: Partial<FiltroReporte> & { estado?: IncidenciaPersonal['estado'] | null } = {}): Promise<IncidenciaPersonal[]> {
    return (await this.ctx.repos.incidenciasPersonal.listarPor('cicloEscolarId', cicloId))
      .filter((i) => (!f.desde || i.fecha >= f.desde) && (!f.hasta || i.fecha <= f.hasta) && (!f.personalId || i.personalId === f.personalId)
        && (!f.tipo || i.tipo === f.tipo) && (!f.estado || i.estado === f.estado))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
  }

  // ---------------------------------------------------------- clases del día

  /** Todas las clases del horario oficial en esa fecha, con su estado derivado. */
  async clasesDelDia(cicloId: string, fecha: string, turnoId: string | null = null): Promise<ClaseDelDia[]> {
    const d = await this.datos(cicloId);
    const f = this.validarFecha(d, fecha);
    return this.clasesDe(d, f, turnoId, await this.pasesDe(cicloId, f));
  }

  private async pasesDe(cicloId: string, fecha: string): Promise<Set<string>> {
    const pases = await this.ctx.repos.pases.listarPor('cicloEscolarId', cicloId);
    return new Set(pases.filter((p) => p.fecha === fecha).map((p) => p.sesionId));
  }

  private clasesDe(d: Awaited<ReturnType<ServicioPrefectura['datos']>>, fecha: string, turnoId: string | null, conLista: Set<string>): ClaseDelDia[] {
    const dia = diaDeFecha(fecha) as DiaSemana;
    const r: ClaseDelDia[] = [];
    for (const s of d.sesiones.filter((x) => x.dia === dia)) {
      const g = d.grupos.find((x) => x.id === s.grupoId);
      if (!g || g.activo === false || (turnoId && g.turnoId !== turnoId)) continue;
      const jornada = d.jornadas.find((j) => j.turnoId === g.turnoId);
      if (!jornada?.dias.includes(dia)) continue;
      const periodo = d.periodos.find((p) => p.id === s.periodoId);
      if (!periodo) continue;
      const asig = d.asignaciones.find((a) => a.id === s.asignacionId);
      const materia = d.materias.find((m) => m.id === asig?.materiaId);
      const docente = d.personal.find((p) => p.id === s.personalId);
      const incid = s.personalId ? d.incidencias.filter((i) => i.personalId === s.personalId && i.estado !== 'descartada' && this.afecta(i, fecha, periodo, d.periodos)) : [];
      const cobertura = d.coberturas.find((c) => c.sesionId === s.id && c.fecha === fecha && c.estado !== 'cancelada') ?? null;
      const [estado, motivo] = this.estadoDe(s, docente, incid, cobertura, conLista.has(s.id));
      r.push({
        sesionId: s.id, grupoId: g.id, grupo: this.nombreGrupo(d, g.id), gradoId: g.gradoId, turnoId: g.turnoId, turno: d.turnos.find((t) => t.id === g.turnoId)?.nombre ?? '',
        periodoId: periodo.id, periodo: periodo.nombre, horaInicio: periodo.horaInicio, horaFin: periodo.horaFin,
        materiaId: materia?.id ?? null, materia: materia?.nombre ?? 'Materia eliminada', docenteId: s.personalId, docente: docente ? nombreCompleto(docente) : null,
        estado, motivo, incidencias: incid, cobertura, listaGuardada: conLista.has(s.id),
      });
    }
    return r.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.grupo.localeCompare(b.grupo, 'es', { numeric: true }));
  }

  private estadoDe(s: Sesion, docente: Personal | undefined, incid: IncidenciaPersonal[], cobertura: Cobertura | null, conLista: boolean): [EstadoClase, string] {
    if (cobertura?.estado === 'realizada') return ['cobertura_realizada', 'La cobertura se registró como realizada.'];
    if (cobertura?.estado === 'asignada') return ['cobertura_asignada', `Cobertura asignada${cobertura.autorizadoPor ? `, autorizada por ${cobertura.autorizadoPor}` : ''}.`];
    if (!s.personalId) return ['confirmado', 'La clase no tiene docente asignado en el horario oficial.'];
    const confirmada = incid.find((i) => i.estado === 'confirmada' && DEJA_SIN_DOCENTE.includes(i.tipo));
    if (confirmada) return ['confirmado', `${ETIQUETA_TIPO_INCIDENCIA[confirmada.tipo]} confirmada del docente.`];
    if (cobertura?.estado === 'sin_docente' || cobertura?.estado === 'propuesta' || cobertura?.estado === 'no_realizada') {
      return ['confirmado', cobertura.estado === 'no_realizada' ? 'La cobertura asignada no se realizó.' : 'Prefectura confirmó que el grupo está sin docente.'];
    }
    const reportada = incid.find((i) => i.estado === 'reportada') ?? incid.find((i) => i.estado === 'confirmada');
    if (reportada) {
      return ['posible', reportada.estado === 'reportada'
        ? `${ETIQUETA_TIPO_INCIDENCIA[reportada.tipo]}${reportada.tipoOtro ? ` (${reportada.tipoOtro})` : ''} reportada, sin confirmar.`
        : `${ETIQUETA_TIPO_INCIDENCIA[reportada.tipo]}${reportada.tipoOtro ? ` (${reportada.tipoOtro})` : ''} confirmada: el grupo podría quedar sin docente parte del periodo.`];
    }
    if (docente && !docente.activo) return ['posible', 'El docente asignado está dado de baja.'];
    if (conLista) return ['atendida', 'Hay lista de asistencia registrada para esta clase.'];
    return ['sin_informacion', 'No hay incidencias ni lista registrada. No se asume falta.'];
  }

  // -------------------------------------------------------------- servicio SE

  /** Horas SE CONFIRMADAS de esa fecha (día de la semana), por turno si se indica. */
  async serviciosDelDia(cicloId: string, fecha: string, turnoId: string | null = null) {
    const d = await this.datos(cicloId);
    const f = this.validarFecha(d, fecha);
    const dia = diaDeFecha(f);
    const jornadasTurno = turnoId ? new Set(d.jornadas.filter((j) => j.turnoId === turnoId).map((j) => j.id)) : null;
    return d.actividades.filter((a) => a.tipo === 'servicio' && a.confirmada && a.personalId && a.dia === dia
      && (!jornadasTurno || !a.periodoId || jornadasTurno.has(d.periodos.find((p) => p.id === a.periodoId)?.jornadaId ?? '')))
      .map((a) => {
        const p = d.personal.find((x) => x.id === a.personalId);
        const ausente = d.incidencias.some((i) => i.personalId === a.personalId && i.estado === 'confirmada' && DEJA_SIN_DOCENTE.includes(i.tipo) && this.afecta(i, f, { id: a.periodoId ?? '', horaInicio: a.horaInicio, horaFin: a.horaFin }, d.periodos));
        const ocupado = d.coberturas.find((c) => c.fecha === f && c.asignadoId === a.personalId && (c.estado === 'asignada' || c.estado === 'realizada')
          && seTraslapan(d.periodos.find((x) => x.id === c.periodoId) ?? { horaInicio: '00:00', horaFin: '00:00' }, a));
        return { actividadId: a.id, personalId: a.personalId!, nombre: p ? nombreCompleto(p) : 'Persona eliminada', activo: p?.activo ?? false, horaInicio: a.horaInicio, horaFin: a.horaFin, descripcion: a.descripcion, ausente, ocupadoEn: ocupado ? this.nombreGrupo(d, ocupado.grupoId) : null };
      })
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  // ------------------------------------------------------------- coberturas

  /** Problemas para que una persona cubra esa clase en esa fecha (vacío = compatible). */
  private problemas(d: Awaited<ReturnType<ServicioPrefectura['datos']>>, fecha: string, s: Sesion, periodo: Periodo, personalId: string, excluirCobertura: string | null): string[] {
    const p = d.personal.find((x) => x.id === personalId);
    if (!p) return ['La persona no pertenece a esta escuela.'];
    const r: string[] = [];
    if (!p.activo) r.push('Está dada de baja.');
    if (personalId === s.personalId) r.push('Es el docente ausente de esta clase.');
    const dia = diaDeFecha(fecha);
    const ausencia = d.incidencias.find((i) => i.personalId === personalId && i.estado === 'confirmada' && DEJA_SIN_DOCENTE.includes(i.tipo) && this.afecta(i, fecha, periodo, d.periodos));
    if (ausencia) r.push(`Tiene ${ETIQUETA_TIPO_INCIDENCIA[ausencia.tipo].toLowerCase()} confirmada en ese horario.`);
    for (const o of d.sesiones.filter((x) => x.personalId === personalId && x.dia === dia && x.id !== s.id)) {
      const po = d.periodos.find((x) => x.id === o.periodoId);
      if (po && seTraslapan(po, periodo)) { r.push(`Tiene clase con ${this.nombreGrupo(d, o.grupoId)} de ${po.horaInicio} a ${po.horaFin}.`); break; }
    }
    const otra = d.actividades.find((a) => a.personalId === personalId && a.tipo === 'otra' && a.dia === dia && seTraslapan(a, periodo));
    if (otra) r.push(`Tiene otra actividad («${otra.descripcion}») a esa hora.`);
    const cob = d.coberturas.find((c) => c.id !== excluirCobertura && c.fecha === fecha && c.asignadoId === personalId && (c.estado === 'asignada' || c.estado === 'realizada')
      && seTraslapan(d.periodos.find((x) => x.id === c.periodoId) ?? { horaInicio: '00:00', horaFin: '00:00' }, periodo));
    if (cob) r.push(`Ya cubre a ${this.nombreGrupo(d, cob.grupoId)} a esa hora.`);
    return r;
  }

  /** Sugerencias (NO asignaciones): personal con SE confirmada en ese horario y docentes sin clase a esa hora. */
  async candidatos(sesionId: string, fecha: string): Promise<Candidato[]> {
    const s = await requerir(this.ctx.repos.sesiones.obtener(sesionId), 'la clase');
    const d = await this.datos(s.cicloEscolarId);
    const f = this.validarFecha(d, fecha);
    const periodo = await requerir(this.ctx.repos.periodos.obtener(s.periodoId), 'el periodo');
    const dia = diaDeFecha(f);
    const cob = d.coberturas.find((c) => c.sesionId === s.id && c.fecha === f && c.estado !== 'cancelada');
    const r: Candidato[] = [];
    const conSe = new Set<string>();
    for (const a of d.actividades.filter((x) => x.tipo === 'servicio' && x.confirmada && x.personalId && x.dia === dia && seTraslapan(x, periodo))) {
      if (conSe.has(a.personalId!)) continue;
      conSe.add(a.personalId!);
      const p = d.personal.find((x) => x.id === a.personalId);
      if (!p) continue;
      const problemas = this.problemas(d, f, s, periodo, p.id, cob?.id ?? null);
      r.push({ personalId: p.id, nombre: nombreCompleto(p), origen: 'se', detalle: `SE confirmada ${a.horaInicio}–${a.horaFin}: ${a.descripcion}`, compatible: !problemas.length, problemas });
    }
    // Docentes que ese día tienen clases (están en la escuela) pero no en ese periodo.
    const conClaseHoy = new Set(d.sesiones.filter((x) => x.dia === dia && x.personalId).map((x) => x.personalId!));
    for (const pid of conClaseHoy) {
      if (conSe.has(pid)) continue;
      const p = d.personal.find((x) => x.id === pid);
      if (!p || !p.activo) continue;
      const problemas = this.problemas(d, f, s, periodo, p.id, cob?.id ?? null);
      if (problemas.length) continue; // los ocupados no se listan como «libres»
      r.push({ personalId: p.id, nombre: nombreCompleto(p), origen: 'libre', detalle: 'Sin clase en ese horario (no tiene SE registrada: requiere acuerdo).', compatible: true, problemas: [] });
    }
    return r.sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(a.origen === 'libre') - Number(b.origen === 'libre') || a.nombre.localeCompare(b.nombre, 'es'));
  }

  private async coberturaDe(sesionId: string, fecha: string): Promise<{ s: Sesion; c: Cobertura | null; d: Awaited<ReturnType<ServicioPrefectura['datos']>>; periodo: Periodo; f: string }> {
    const s = await requerir(this.ctx.repos.sesiones.obtener(sesionId), 'la clase');
    await cicloEditable(this.ctx, s.cicloEscolarId);
    const d = await this.datos(s.cicloEscolarId);
    const f = this.validarFecha(d, fecha);
    if (diaDeFecha(f) !== s.dia) throw new ErrorDominio('VALIDACION', 'Esa clase no se imparte en esa fecha (otro día de la semana).');
    const periodo = await requerir(this.ctx.repos.periodos.obtener(s.periodoId), 'el periodo');
    const c = d.coberturas.find((x) => x.sesionId === s.id && x.fecha === f) ?? null;
    return { s, c, d, periodo, f };
  }

  private nueva(s: Sesion, f: string, d: Awaited<ReturnType<ServicioPrefectura['datos']>>, estado: EstadoCobertura): Cobertura {
    const incid = d.incidencias.find((i) => i.personalId === s.personalId && i.estado === 'confirmada' && i.fecha === f) ?? null;
    return {
      ...metadatosNuevos(this.ctx), escuelaId: s.escuelaId, cicloEscolarId: s.cicloEscolarId, sesionId: s.id, fecha: f, grupoId: s.grupoId, periodoId: s.periodoId,
      docenteAusenteId: s.personalId, incidenciaId: incid?.id ?? null, propuestoIds: [], asignadoId: null, actividadId: null, actividadTexto: null,
      autorizadoPor: null, autorizadoEn: null, estado, observaciones: null,
    };
  }
  private async guardar(c: Cobertura, nueva: boolean, accion: string, detalle: string | null, quien: string | null) {
    if (nueva) await this.ctx.repos.coberturas.insertar(c); else await this.ctx.repos.coberturas.actualizar(c);
    await this.registrar(c.escuelaId, c.cicloEscolarId, 'cobertura', c.id, accion, detalle, quien);
    return c;
  }

  /** Prefectura confirma en sitio que el grupo está sin docente (hecho observado). */
  async confirmarSinDocente(sesionId: string, fecha: string, observaciones: string, quien: string | null = null): Promise<Cobertura> {
    return this.ctx.uow.ejecutar(async () => {
      const { s, c, d, f } = await this.coberturaDe(sesionId, fecha);
      if (!observaciones || observaciones.trim().length < 3) throw new ErrorDominio('VALIDACION', 'Describe brevemente cómo se confirmó.', [{ campo: 'observaciones', mensaje: 'Describe cómo se confirmó.' }]);
      if (c && c.estado !== 'cancelada') return c;
      const n = c ? { ...c, estado: 'sin_docente' as const, observaciones: observaciones.trim(), ...metadatosActualizados(this.ctx, c) } : { ...this.nueva(s, f, d, 'sin_docente'), observaciones: observaciones.trim() };
      return this.guardar(n, !c, 'confirmar sin docente', observaciones.trim(), quien);
    });
  }

  /** Propuesta de personal (sugerencia; no es asignación). Se rechazan personas incompatibles. */
  async proponer(sesionId: string, fecha: string, personalIds: string[], quien: string | null = null): Promise<Cobertura> {
    return this.ctx.uow.ejecutar(async () => {
      const { s, c, d, periodo, f } = await this.coberturaDe(sesionId, fecha);
      if (!personalIds.length) throw new ErrorDominio('VALIDACION', 'Selecciona al menos una persona para proponer.');
      if (c && (c.estado === 'asignada' || c.estado === 'realizada')) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'La cobertura ya está asignada.');
      for (const pid of personalIds) {
        const pr = this.problemas(d, f, s, periodo, pid, c?.id ?? null);
        if (pr.length) throw new ErrorDominio('TRASLAPE', `${nombreCompleto(d.personal.find((x) => x.id === pid) ?? { nombre: 'La persona', primerApellido: '', segundoApellido: null })}: ${pr[0]}`);
      }
      const base = c && c.estado !== 'cancelada' ? c : this.nueva(s, f, d, 'propuesta');
      const n: Cobertura = { ...base, propuestoIds: [...new Set(personalIds)], estado: 'propuesta', ...(c ? metadatosActualizados(this.ctx, c) : {}) };
      return this.guardar(n, !c, 'proponer', personalIds.map((x) => nombreCompleto(d.personal.find((p) => p.id === x)!)).join(', '), quien);
    });
  }

  /** Asignación con autorización explícita (texto: quién autorizó según la organización de la escuela). */
  async asignar(sesionId: string, fecha: string, entrada: EntradaAsignacionCobertura, quien: string | null = null): Promise<Cobertura> {
    const v = validar(esquemaAsignacionCobertura, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const { s, c, d, periodo, f } = await this.coberturaDe(sesionId, fecha);
      if (c && (c.estado === 'realizada')) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'La cobertura ya se registró como realizada.');
      const pr = this.problemas(d, f, s, periodo, v.personalId, c?.id ?? null);
      if (pr.length) throw new ErrorDominio('TRASLAPE', `No se puede asignar: ${pr.join(' ')}`, [{ campo: 'personalId', mensaje: pr[0]! }]);
      if (v.actividadId) {
        const act = await this.ctx.repos.bancoActividades.obtener(v.actividadId);
        if (!act || act.cicloEscolarId !== s.cicloEscolarId) throw new ErrorDominio('VALIDACION', 'La actividad no existe en este ciclo.');
        if (act.estado !== 'validada') throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Sólo se pueden asignar actividades validadas del banco.');
      }
      const base = c && c.estado !== 'cancelada' ? c : this.nueva(s, f, d, 'asignada');
      const asignado = d.personal.find((x) => x.id === v.personalId)!;
      const n: Cobertura = {
        ...base, asignadoId: v.personalId, propuestoIds: base.propuestoIds.includes(v.personalId) ? base.propuestoIds : [...base.propuestoIds, v.personalId],
        actividadId: v.actividadId, actividadTexto: v.actividadTexto, autorizadoPor: v.autorizadoPor, autorizadoEn: this.ctx.reloj(),
        observaciones: v.observaciones ?? base.observaciones, estado: 'asignada', ...(c ? metadatosActualizados(this.ctx, c) : {}),
      };
      return this.guardar(n, !c, 'asignar', `${nombreCompleto(asignado)}; autorizó: ${v.autorizadoPor}`, quien);
    });
  }

  async cerrarCobertura(coberturaId: string, estado: 'realizada' | 'no_realizada' | 'cancelada', observaciones: string | null, quien: string | null = null): Promise<Cobertura> {
    return this.ctx.uow.ejecutar(async () => {
      const c = await requerir(this.ctx.repos.coberturas.obtener(coberturaId), 'la cobertura');
      await cicloEditable(this.ctx, c.cicloEscolarId);
      if (estado !== 'cancelada' && c.estado !== 'asignada') throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Sólo una cobertura asignada puede marcarse como realizada o no realizada.');
      if (c.estado === 'realizada' && estado === 'cancelada') throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Una cobertura realizada no se cancela: queda en el historial.');
      if ((estado === 'no_realizada' || estado === 'cancelada') && (!observaciones || observaciones.trim().length < 3)) throw new ErrorDominio('VALIDACION', 'Indica el motivo.', [{ campo: 'observaciones', mensaje: 'Indica el motivo.' }]);
      const n: Cobertura = { ...c, estado, observaciones: observaciones?.trim() || c.observaciones, ...metadatosActualizados(this.ctx, c) };
      return this.guardar(n, false, estado === 'realizada' ? 'registrar realizada' : estado === 'no_realizada' ? 'registrar no realizada' : 'cancelar', observaciones, quien);
    });
  }

  async historial(cicloId: string, entidadId: string | null = null): Promise<RegistroPrefectura[]> {
    const lista = entidadId ? await this.ctx.repos.bitacoraPrefectura.listarPor('entidadId', entidadId) : await this.ctx.repos.bitacoraPrefectura.listarPor('cicloEscolarId', cicloId);
    return lista.filter((x) => x.cicloEscolarId === cicloId).sort((a, b) => b.orden - a.orden);
  }

  // -------------------------------------------------------- banco de actividades

  async crearActividad(cicloId: string, entrada: EntradaActividadBanco, quien: string | null = null): Promise<ActividadBanco> {
    const v = validar(esquemaActividadBanco, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      if (v.materiaId && (await this.ctx.repos.materias.obtener(v.materiaId))?.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'La materia no pertenece a este ciclo.');
      if (v.gradoId && (await this.ctx.repos.grados.obtener(v.gradoId))?.cicloEscolarId !== cicloId) throw new ErrorDominio('VALIDACION', 'El grado no pertenece a este ciclo.');
      const a: ActividadBanco = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...v, estado: 'propuesta' };
      await this.ctx.repos.bancoActividades.insertar(a);
      await this.registrar(ciclo.escuelaId, cicloId, 'actividad', a.id, 'registrar', a.titulo, quien);
      return a;
    });
  }

  async cambiarEstadoActividad(id: string, estado: 'validada' | 'retirada', quien: string | null = null): Promise<ActividadBanco> {
    return this.ctx.uow.ejecutar(async () => {
      const a = await requerir(this.ctx.repos.bancoActividades.obtener(id), 'la actividad');
      await cicloEditable(this.ctx, a.cicloEscolarId);
      const n = { ...a, estado, ...metadatosActualizados(this.ctx, a) };
      await this.ctx.repos.bancoActividades.actualizar(n);
      await this.registrar(a.escuelaId, a.cicloEscolarId, 'actividad', a.id, estado === 'validada' ? 'validar' : 'retirar', a.titulo, quien);
      return n;
    });
  }

  async actividades(cicloId: string, f: { materiaId?: string | null; gradoId?: string | null; soloValidadas?: boolean } = {}): Promise<ActividadBanco[]> {
    return (await this.ctx.repos.bancoActividades.listarPor('cicloEscolarId', cicloId))
      .filter((a) => (!f.materiaId || a.materiaId === f.materiaId || a.materiaId === null) && (!f.gradoId || a.gradoId === f.gradoId || a.gradoId === null) && (!f.soloValidadas || a.estado === 'validada'))
      .sort((a, b) => Number(b.estado === 'validada') - Number(a.estado === 'validada') || b.fecha.localeCompare(a.fecha));
  }

  // ----------------------------------------------------------------- reportes

  /**
   * Reporte de un intervalo. Los INDICADORES usan sólo registros validados
   * (incidencias confirmadas, coberturas realizadas o asignadas con autorización);
   * lo reportado sin confirmar se lista aparte y no entra en los cálculos.
   */
  async reporte(cicloId: string, f: FiltroReporte) {
    const d = await this.datos(cicloId);
    const desde = this.validarFecha(d, f.desde); const hasta = this.validarFecha(d, f.hasta);
    if (hasta < desde) throw new ErrorDominio('VALIDACION', 'La fecha final es anterior a la inicial.');
    const pases = await this.ctx.repos.pases.listarPor('cicloEscolarId', cicloId);
    const dias: string[] = [];
    for (let x = desde; x <= hasta; x = sumarDias(x, 1)) { dias.push(x); if (dias.length > MAX_DIAS_REPORTE) throw new ErrorDominio('VALIDACION', `El intervalo máximo es de ${MAX_DIAS_REPORTE} días.`); }
    const clases: (ClaseDelDia & { fecha: string })[] = [];
    for (const dia of dias) {
      const conLista = new Set(pases.filter((p) => p.fecha === dia).map((p) => p.sesionId));
      for (const c of this.clasesDe(d, dia, f.turnoId ?? null, conLista)) {
        if (f.grupoId && c.grupoId !== f.grupoId) continue;
        if (f.personalId && c.docenteId !== f.personalId && c.cobertura?.asignadoId !== f.personalId) continue;
        if (c.estado === 'sin_informacion' || c.estado === 'atendida') continue;
        if (f.estadoCobertura && c.cobertura?.estado !== f.estadoCobertura) continue;
        clases.push({ ...c, fecha: dia });
      }
    }
    const incidencias = d.incidencias.filter((i) => i.fecha >= desde && i.fecha <= hasta && (!f.personalId || i.personalId === f.personalId) && (!f.tipo || i.tipo === f.tipo));
    const confirmadas = incidencias.filter((i) => i.estado === 'confirmada');
    const porTipo = Object.fromEntries((['falta', 'retardo', 'permiso', 'salida_anticipada', 'otra'] as const).map((t) => [t, confirmadas.filter((i) => i.tipo === t).length])) as Record<TipoIncidenciaPersonal, number>;
    const sinDocente = clases.filter((c) => c.estado === 'confirmado' || c.estado === 'cobertura_asignada' || c.estado === 'cobertura_realizada');
    const realizadas = clases.filter((c) => c.estado === 'cobertura_realizada').length;
    const nombre = (id: string | null) => { const p = d.personal.find((x) => x.id === id); return p ? nombreCompleto(p) : null; };
    return {
      escuela: d.escuela.nombre, cct: d.escuela.cct, ciclo: d.ciclo.nombre, desde, hasta, generadoEn: this.ctx.reloj(),
      indicadores: {
        incidenciasConfirmadas: confirmadas.length, incidenciasPorTipo: porTipo,
        incidenciasSinConfirmar: incidencias.filter((i) => i.estado === 'reportada').length,
        clasesSinDocenteConfirmadas: sinDocente.length,
        coberturasRealizadas: realizadas,
        coberturasAsignadasPendientes: clases.filter((c) => c.estado === 'cobertura_asignada').length,
        porcentajeCubierto: sinDocente.length ? Math.round((realizadas / sinDocente.length) * 100) : null,
        posiblesSinConfirmar: clases.filter((c) => c.estado === 'posible').length,
      },
      incidencias: incidencias.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((i) => ({ ...i, persona: nombre(i.personalId) ?? 'Persona eliminada' })),
      clases: clases.map((c) => ({ ...c, asignado: nombre(c.cobertura?.asignadoId ?? null) })),
    };
  }
}
