import type { CicloEscolar, Personal } from '../models';
import type { Segmento, TipoVista } from '../domain/horarioVista';
import { actividadEn, siguienteDesde, type EstadoActual } from '../domain/actividadActual';
import { aMinutos } from '../domain/tiempo';
import { type Contexto, metadatosActualizados, metadatosNuevos } from './contexto';
import { ServicioVistas } from './vistas';
import { DIAS_SEMANA } from './turnos';
import { diaIso, fechaLocal, horaLocal, sumarDias } from '../utils/fechas';

const PERFIL = 'perfil-docente';

export interface BloquePanel {
  segmento: Segmento;
  /** Para clases: datos para entrar al grupo y pasar lista. */
  sesionId?: string;
  grupoId?: string;
  grupo?: string;
  materia?: string;
  listaGuardada?: boolean;
}

export interface Panel {
  persona: Personal;
  escuela: string;
  ciclo: CicloEscolar | null;
  fecha: string;
  hora: string;
  /** Estado en este momento: CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD, SIN ACTIVIDAD REGISTRADA o FUERA DE JORNADA. */
  estado: EstadoActual;
  /** Turno de la actividad actual (o los turnos en que trabaja hoy). */
  turno: string | null;
  actual: BloquePanel | null;
  siguiente: (BloquePanel & { diaNombre: string | null }) | null;
  siguienteClase: (BloquePanel & { diaNombre: string | null }) | null;
  hoy: BloquePanel[];
  pendientes: BloquePanel[]; // clases de hoy ya iniciadas sin lista guardada
  grupos: { grupoId: string; grupo: string; materias: string[] }[];
}

/**
 * Panel principal del docente. «Quién usa este dispositivo» es una preferencia
 * local, NO autenticación: cualquiera con acceso al dispositivo puede cambiarla.
 */
export class ServicioPanelDocente {
  private readonly vistas: ServicioVistas;
  constructor(private readonly ctx: Contexto) { this.vistas = new ServicioVistas(ctx); }

  async perfil(): Promise<Personal | null> {
    const a = await this.ctx.repos.ajustes.obtener(PERFIL);
    if (!a?.valor) return null;
    const p = await this.ctx.repos.personal.obtener(a.valor);
    return p && p.activo ? p : null;
  }

  async fijarPerfil(personalId: string | null): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.ctx.repos.ajustes.obtener(PERFIL);
      if (actual) await this.ctx.repos.ajustes.actualizar({ ...actual, valor: personalId, ...metadatosActualizados(this.ctx, actual) });
      else await this.ctx.repos.ajustes.insertar({ ...metadatosNuevos(this.ctx), id: PERFIL, valor: personalId });
    });
  }

  private async detalle(s: Segmento, fecha: string): Promise<BloquePanel> {
    if (s.tipo !== 'clase' || !s.id) return { segmento: s };
    const sesion = await this.ctx.repos.sesiones.obtener(s.id);
    if (!sesion) return { segmento: s };
    const grupo = await this.ctx.repos.grupos.obtener(sesion.grupoId);
    const grado = grupo ? await this.ctx.repos.grados.obtener(grupo.gradoId) : undefined;
    const asig = await this.ctx.repos.asignaciones.obtener(sesion.asignacionId);
    const materia = asig ? await this.ctx.repos.materias.obtener(asig.materiaId) : undefined;
    const guardada = (await this.ctx.repos.pases.listarPor('sesionId', sesion.id)).some((p) => p.fecha === fecha);
    return { segmento: s, sesionId: sesion.id, grupoId: sesion.grupoId, grupo: `${grado?.numero ?? ''}° ${grupo?.nombre ?? ''}`, materia: materia?.nombre ?? '', listaGuardada: guardada };
  }

  async panel(persona: Personal, ahora: Date): Promise<Panel> {
    const fecha = fechaLocal(ahora);
    const hora = horaLocal(ahora);
    const ciclos = await this.ctx.repos.ciclos.listarPor('escuelaId', persona.escuelaId);
    const ciclo = ciclos.find((c) => c.estado === 'activo') ?? null;
    const escuela = (await this.ctx.repos.escuelas.obtener(persona.escuelaId))?.nombre ?? '';
    const vacio: Panel = { persona, escuela, ciclo, fecha, hora, estado: 'fuera_de_jornada', turno: null, actual: null, siguiente: null, siguienteClase: null, hoy: [], pendientes: [], grupos: [] };
    if (!ciclo) return vacio;

    const { dias } = await this.vistas.semanaDocente(persona.id, ciclo.id);
    const hoyDia = diaIso(ahora);
    const min = aMinutos(hora);
    const hoySeg = dias.find((d) => d.dia === hoyDia)?.segmentos ?? [];
    const hoy = await Promise.all(hoySeg.map((s) => this.detalle(s, fecha)));
    const { estado, bloque: actual } = actividadEn(hoy, min);

    // Siguiente actividad registrada (hoy o en los próximos días) y siguiente clase.
    const buscar = async (tiposHoy: TipoVista[], tiposOtros: TipoVista[]): Promise<Panel['siguiente']> => {
      const sigHoy = siguienteDesde(hoy, min, tiposHoy);
      if (sigHoy) return { ...sigHoy, diaNombre: null };
      for (let i = 1; i <= 7; i++) {
        const otra = sumarDias(fecha, i);
        const d = dias.find((x) => x.dia === diaIso(new Date(`${otra}T12:00:00`)));
        const s = d?.segmentos.find((x) => tiposOtros.includes(x.tipo));
        if (s) return { ...(await this.detalle(s, otra)), diaNombre: i === 1 ? 'Mañana' : DIAS_SEMANA.find((x) => x.valor === d!.dia)!.nombre };
      }
      return null;
    };
    const siguiente = await buscar(['clase', 'servicio', 'otra', 'receso'], ['clase', 'servicio', 'otra']);
    const siguienteClase = siguiente?.segmento.tipo === 'clase' ? siguiente : await buscar(['clase'], ['clase']);

    // Turno: el del grupo de la clase actual; si no, los turnos de las clases de hoy.
    const turnoDeGrupo = async (grupoId: string | undefined) => {
      const g = grupoId ? await this.ctx.repos.grupos.obtener(grupoId) : undefined;
      return g ? (await this.ctx.repos.turnos.obtener(g.turnoId))?.nombre ?? null : null;
    };
    let turno = actual?.grupoId ? await turnoDeGrupo(actual.grupoId) : null;
    if (!turno) {
      const nombres = new Set<string>();
      for (const b of hoy) if (b.grupoId) { const t = await turnoDeGrupo(b.grupoId); if (t) nombres.add(t); }
      turno = [...nombres].join(', ') || null;
    }
    const pendientes = hoy.filter((b) => b.segmento.tipo === 'clase' && !b.listaGuardada && aMinutos(b.segmento.horaInicio) <= min && b !== actual);

    const asignaciones = (await this.ctx.repos.asignaciones.listarPor('personalId', persona.id)).filter((a) => a.cicloEscolarId === ciclo.id);
    const porGrupo = new Map<string, string[]>();
    for (const a of asignaciones) {
      const m = await this.ctx.repos.materias.obtener(a.materiaId);
      porGrupo.set(a.grupoId, [...(porGrupo.get(a.grupoId) ?? []), m?.nombre ?? '']);
    }
    const grupos = [];
    for (const [grupoId, materias] of porGrupo) {
      const g = await this.ctx.repos.grupos.obtener(grupoId);
      const gr = g ? await this.ctx.repos.grados.obtener(g.gradoId) : undefined;
      grupos.push({ grupoId, grupo: `${gr?.numero ?? ''}° ${g?.nombre ?? ''}`, materias: materias.sort((x, y) => x.localeCompare(y, 'es')) });
    }
    grupos.sort((a, b) => a.grupo.localeCompare(b.grupo, 'es', { numeric: true }));
    return { persona, escuela, ciclo, fecha, hora, estado, turno, actual, siguiente, siguienteClase, hoy, pendientes, grupos };
  }
}
