import type { Jornada, Turno } from '../models';
import { esquemaTurnoConJornada, validar, type EntradaTurno } from '../validators/esquemas';
import { asegurarSinDuplicado, bloquesFueraDeJornada } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { compararPorInicio } from '../domain/tiempo';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';
import { bloquesDeJornada } from './horario';

export interface TurnoConJornada {
  turno: Turno;
  jornada: Jornada;
}

export const DIAS_SEMANA = [
  { valor: 1, nombre: 'Lunes', corto: 'Lun' },
  { valor: 2, nombre: 'Martes', corto: 'Mar' },
  { valor: 3, nombre: 'Miércoles', corto: 'Mié' },
  { valor: 4, nombre: 'Jueves', corto: 'Jue' },
  { valor: 5, nombre: 'Viernes', corto: 'Vie' },
  { valor: 6, nombre: 'Sábado', corto: 'Sáb' },
  { valor: 7, nombre: 'Domingo', corto: 'Dom' },
] as const;

export class ServicioTurnos {
  constructor(private readonly ctx: Contexto) {}

  async listar(cicloId: string): Promise<TurnoConJornada[]> {
    const turnos = await this.ctx.repos.turnos.listarPor('cicloEscolarId', cicloId);
    const jornadas = await this.ctx.repos.jornadas.listarPor('cicloEscolarId', cicloId);
    const porTurno = new Map(jornadas.map((j) => [j.turnoId, j]));
    return turnos
      .flatMap((turno) => {
        const jornada = porTurno.get(turno.id);
        return jornada ? [{ turno, jornada }] : [];
      })
      .sort((a, b) => compararPorInicio(a.jornada, b.jornada));
  }

  async obtener(turnoId: string): Promise<TurnoConJornada> {
    const turno = await requerir(this.ctx.repos.turnos.obtener(turnoId), 'el turno');
    const [jornada] = await this.ctx.repos.jornadas.listarPor('turnoId', turnoId);
    if (!jornada) throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró la jornada del turno.');
    return { turno, jornada };
  }

  async crear(cicloId: string, entrada: EntradaTurno): Promise<TurnoConJornada> {
    const datos = validar(esquemaTurnoConJornada, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const turnos = await this.ctx.repos.turnos.listarPor('cicloEscolarId', cicloId);
      asegurarSinDuplicado(turnos, (t) => t.nombre, datos.nombre, undefined, 'nombre',
        'Ya existe un turno con ese nombre en este ciclo.');
      const ambito = { escuelaId: ciclo.escuelaId, cicloEscolarId: ciclo.id };
      const turno: Turno = { ...metadatosNuevos(this.ctx), ...ambito, nombre: datos.nombre };
      const jornada: Jornada = {
        ...metadatosNuevos(this.ctx), ...ambito, turnoId: turno.id,
        horaInicio: datos.horaInicio, horaFin: datos.horaFin, dias: datos.dias,
      };
      await this.ctx.repos.turnos.insertar(turno);
      await this.ctx.repos.jornadas.insertar(jornada);
      return { turno, jornada };
    });
  }

  async actualizar(turnoId: string, entrada: EntradaTurno): Promise<TurnoConJornada> {
    const datos = validar(esquemaTurnoConJornada, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(turnoId);
      await cicloEditable(this.ctx, actual.turno.cicloEscolarId);
      const turnos = await this.ctx.repos.turnos.listarPor('cicloEscolarId', actual.turno.cicloEscolarId);
      asegurarSinDuplicado(turnos, (t) => t.nombre, datos.nombre, turnoId, 'nombre',
        'Ya existe un turno con ese nombre en este ciclo.');

      const fuera = bloquesFueraDeJornada(await bloquesDeJornada(this.ctx, actual.jornada.id), datos);
      if (fuera.length > 0) {
        const lista = fuera.map((b) => `«${b.nombre}» (${b.horaInicio}–${b.horaFin})`).join(', ');
        const mensaje = `La nueva jornada dejaría fuera: ${lista}. Ajusta o elimina esos bloques primero.`;
        throw new ErrorDominio('FUERA_DE_JORNADA', mensaje, [{ campo: 'horaInicio', mensaje }]);
      }

      const diasQuitados = actual.jornada.dias.filter((d) => !datos.dias.includes(d));
      if (diasQuitados.length > 0) {
        const grupos = await this.ctx.repos.grupos.listarPor('turnoId', turnoId);
        for (const g of grupos) {
          const ocupado = (await this.ctx.repos.sesiones.listarPor('grupoId', g.id)).find((s) => diasQuitados.includes(s.dia));
          if (ocupado) {
            const dia = DIAS_SEMANA.find((d) => d.valor === ocupado.dia)?.nombre ?? '';
            const mensaje = `Hay clases programadas el ${dia.toLowerCase()} en grupos de este turno. Quítalas antes de quitar ese día.`;
            throw new ErrorDominio('TIENE_DEPENDENCIAS', mensaje, [{ campo: 'dias', mensaje }]);
          }
        }
      }
      const turno: Turno = { ...actual.turno, nombre: datos.nombre, ...metadatosActualizados(this.ctx, actual.turno) };
      const jornada: Jornada = {
        ...actual.jornada, horaInicio: datos.horaInicio, horaFin: datos.horaFin, dias: datos.dias,
        ...metadatosActualizados(this.ctx, actual.jornada),
      };
      await this.ctx.repos.turnos.actualizar(turno);
      await this.ctx.repos.jornadas.actualizar(jornada);
      return { turno, jornada };
    });
  }

  /** Cuántos registros dependientes se eliminarían junto con el turno (para la confirmación). */
  async resumenDependencias(turnoId: string) {
    const { jornada } = await this.obtener(turnoId);
    return {
      periodos: await this.ctx.repos.periodos.contarPor('jornadaId', jornada.id),
      recesos: await this.ctx.repos.recesos.contarPor('jornadaId', jornada.id),
      grupos: await this.ctx.repos.grupos.contarPor('turnoId', turnoId),
    };
  }

  /**
   * Elimina el turno con su jornada, periodos y recesos.
   * Se bloquea si hay grupos asignados al turno (información de otra entidad).
   */
  async eliminar(turnoId: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const { turno, jornada } = await this.obtener(turnoId);
      await cicloEditable(this.ctx, turno.cicloEscolarId);
      const grupos = await this.ctx.repos.grupos.contarPor('turnoId', turnoId);
      if (grupos > 0) {
        throw new ErrorDominio('TIENE_DEPENDENCIAS',
          `El turno tiene ${grupos} grupo(s) asignado(s). Reasígnalos o elimínalos primero.`);
      }
      const alumnos = (await this.ctx.repos.inscripciones.listarPor('cicloEscolarId', turno.cicloEscolarId)).filter((i) => i.turnoId === turnoId).length;
      if (alumnos > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Hay ${alumnos} alumno(s) inscritos en este turno.`);
      for (const a of await this.ctx.repos.adscripciones.listarPor('cicloEscolarId', turno.cicloEscolarId)) {
        if (a.turnoIds.includes(turnoId)) await this.ctx.repos.adscripciones.actualizar({ ...a, turnoIds: a.turnoIds.filter((x) => x !== turnoId), ...metadatosActualizados(this.ctx, a) });
      }
      const periodos = await this.ctx.repos.periodos.listarPor('jornadaId', jornada.id);
      const recesos = await this.ctx.repos.recesos.listarPor('jornadaId', jornada.id);
      await this.ctx.repos.periodos.eliminarVarios(periodos.map((p) => p.id));
      await this.ctx.repos.recesos.eliminarVarios(recesos.map((r) => r.id));
      await this.ctx.repos.jornadas.eliminar(jornada.id);
      await this.ctx.repos.turnos.eliminar(turnoId);
    });
  }
}
