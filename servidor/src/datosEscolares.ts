/**
 * Acceso a datos escolares desde la API (Fase 8C).
 * Cada petición corre en UNA transacción con el rol restringido `gestion_app`, el usuario
 * en `app.usuario_id` y la escuela de la ruta en `app.escuela_id`: las políticas RLS
 * filtran cada fila. Los servicios de la aplicación se ejecutan tal cual sobre repositorios
 * PostgreSQL (mismas reglas de negocio y validaciones Zod que en el dispositivo).
 */
import type { Pool, PoolClient } from 'pg';
import { crearServiciosDesdeContexto, type Servicios } from '../../src/services';
import type { ClienteServidor } from '../../src/remoto/servidorEscolar';
import { esErrorDominio } from '../../src/domain/errores';
import { relojSistema } from '../../src/utils/reloj';
import { auditar, type Membresia, type Rol } from './acceso.ts';
import { ErrorApi } from './errores.ts';
import { conCliente, consultar, crearRepositoriosPg, leerColumnas, unidadDeTrabajoPg } from './repositoriosPg.ts';

/** El servidor nunca llama a otro servidor desde los servicios. */
const sinServidor: ClienteServidor = { pedir: () => Promise.reject(new Error('No disponible en el servidor.')) };

export interface Actor {
  usuarioId: string;
  nombre: string;
  escuelaId: string;
  /** Membresías ACTIVAS del usuario en esta escuela. */
  membresias: Membresia[];
}

export interface ContextoComando {
  s: Servicios;
  actor: Actor;
  roles: Set<Rol>;
  /** Ficha de personal vinculada (para docentes y prefectura). */
  personalId: string | null;
  permisosDelegados: Set<string>;
  /** Fecha y hora del SERVIDOR en la zona de la escuela. */
  hoy: string;
  hora: string;
  cliente: PoolClient;
}

function ahoraEnZona(zona: string): { hoy: string; hora: string } {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { hoy: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

/** Traduce errores de PostgreSQL y de dominio a respuestas sin revelar datos de otras escuelas. */
export function traducirError(e: unknown): ErrorApi {
  if (e instanceof ErrorApi) return e;
  if (esErrorDominio(e)) {
    const estado = e.codigo === 'NO_ENCONTRADO' ? 404 : e.codigo === 'VALIDACION' ? 400 : 409;
    return new ErrorApi(estado, e.codigo, e.message, Object.fromEntries(e.campos.map((c) => [c.campo, c.mensaje])));
  }
  const pg = e as { code?: string; message?: string };
  if (pg.code === '42501') {
    // Mensajes propios de los disparadores (en español) o violación de políticas RLS.
    const propio = pg.message && !/row-level security|permission denied/i.test(pg.message) ? pg.message : 'No tienes permiso para esta acción en esta escuela.';
    return new ErrorApi(403, 'SIN_PERMISO', propio);
  }
  if (pg.code === '23505') return new ErrorApi(409, 'DUPLICADO', 'Ya existe un registro igual.');
  if (pg.code === '23503') return new ErrorApi(409, 'REFERENCIA', 'El registro hace referencia a datos que no existen o que no puedes usar.');
  return new ErrorApi(500, 'INTERNO', 'Ocurrió un error en el servidor. Intenta de nuevo.');
}

export class DatosEscolares {
  private readonly bd: Pool;
  private readonly zona: string;
  private columnas: Awaited<ReturnType<typeof leerColumnas>> | null = null;
  constructor(bd: Pool, zona = 'America/Mexico_City') {
    this.bd = bd; this.zona = zona;
  }

  /**
   * Ejecuta `fn` con los permisos del usuario en la escuela. Al terminar, con el rol
   * del dueño, registra la auditoría (y la operación, si se pidió) en la MISMA transacción.
   */
  async ejecutar<R>(actor: Actor, fn: (c: ContextoComando) => Promise<R>, despues?: (c: PoolClient, resultado: R) => Promise<void>): Promise<R> {
    this.columnas ??= await leerColumnas(this.bd);
    const s = crearServiciosDesdeContexto({ repos: crearRepositoriosPg(this.columnas), uow: unidadDeTrabajoPg, reloj: relojSistema }, sinServidor);
    const cliente = await this.bd.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET LOCAL ROLE gestion_app');
      await cliente.query(`SELECT set_config('app.usuario_id', $1, true), set_config('app.escuela_id', $2, true)`, [actor.usuarioId, actor.escuelaId]);
      const { hoy, hora } = ahoraEnZona(this.zona);
      const deEscuela = actor.membresias.filter((m) => m.escuelaId === actor.escuelaId);
      const ctx: ContextoComando = {
        s, actor, cliente, hoy, hora,
        roles: new Set(deEscuela.map((m) => m.rol)),
        personalId: deEscuela.find((m) => m.personalId)?.personalId ?? null,
        permisosDelegados: new Set(deEscuela.flatMap((m) => m.permisosDelegados)),
      };
      const r = await conCliente(cliente, () => fn(ctx));
      await cliente.query('RESET ROLE');
      if (despues) await despues(cliente, r);
      await cliente.query('COMMIT');
      return r;
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw traducirError(e);
    } finally {
      cliente.release();
    }
  }

  /** Lectura de una tabla con las filas que la persona puede ver (RLS) y columnas según su rol. */
  async leerTabla(actor: Actor, tabla: string, cicloId: string | null): Promise<Record<string, unknown>[]> {
    const def = TABLAS_LECTURA[tabla];
    if (!def) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Tabla no disponible.');
    return this.ejecutar(actor, async (c) => {
      const filtro = cicloId && def.ciclo ? ' WHERE ciclo_escolar_id = $1' : '';
      const { rows } = await consultar(c.cliente, `SELECT * FROM escolar.${def.sql}${filtro} LIMIT 5000`, filtro ? [cicloId] : []);
      const ocultas = def.ocultar?.filter((x) => !x.roles.some((r) => c.roles.has(r))).map((x) => x.columna) ?? [];
      return rows.map((r) => {
        const salida: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) salida[k.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase())] = ocultas.includes(k) ? null : v;
        return salida;
      });
    }, async (cl) => { await auditar(cl, { usuarioId: actor.usuarioId, escuelaId: actor.escuelaId, accion: 'lectura', entidad: tabla }); });
  }
}

/**
 * Tablas que se pueden leer por la API y columnas sensibles que sólo ven ciertos roles
 * (la RLS decide QUÉ FILAS; aquí se decide qué COLUMNAS sensibles se muestran).
 */
const CON_CICLO = true;
export const TABLAS_LECTURA: Record<string, { sql: string; ciclo: boolean; ocultar?: { columna: string; roles: Rol[] }[] }> = {
  escuelas: { sql: 'escuelas', ciclo: false },
  ciclos: { sql: 'ciclos', ciclo: false },
  turnos: { sql: 'turnos', ciclo: CON_CICLO }, jornadas: { sql: 'jornadas', ciclo: CON_CICLO }, periodos: { sql: 'periodos', ciclo: CON_CICLO },
  recesos: { sql: 'recesos', ciclo: CON_CICLO }, grados: { sql: 'grados', ciclo: CON_CICLO }, grupos: { sql: 'grupos', ciclo: CON_CICLO },
  personal: { sql: 'personal', ciclo: false, ocultar: [
    { columna: 'numero_empleado', roles: ['administrador', 'direccion', 'subdireccion'] },
    { columna: 'observaciones', roles: ['administrador', 'direccion', 'subdireccion'] }] },
  materias: { sql: 'materias', ciclo: CON_CICLO }, asignaciones: { sql: 'asignaciones', ciclo: CON_CICLO }, sesiones: { sql: 'sesiones', ciclo: CON_CICLO },
  actividades: { sql: 'actividades', ciclo: CON_CICLO }, excepciones: { sql: 'excepciones', ciclo: CON_CICLO }, confirmaciones: { sql: 'confirmaciones', ciclo: CON_CICLO },
  bitacora: { sql: 'bitacora', ciclo: CON_CICLO }, adscripciones: { sql: 'adscripciones', ciclo: CON_CICLO },
  alumnos: { sql: 'alumnos', ciclo: false, ocultar: [
    { columna: 'curp', roles: ['direccion', 'subdireccion'] },
    { columna: 'matricula', roles: ['direccion', 'subdireccion', 'prefectura'] },
    { columna: 'observaciones', roles: ['direccion', 'subdireccion'] }] },
  inscripciones: { sql: 'inscripciones', ciclo: CON_CICLO }, movimientos: { sql: 'movimientos', ciclo: CON_CICLO },
  importaciones: { sql: 'importaciones', ciclo: CON_CICLO }, plantillasImportacion: { sql: 'plantillas_importacion', ciclo: false },
  pases: { sql: 'pases', ciclo: CON_CICLO }, asistencias: { sql: 'asistencias', ciclo: CON_CICLO }, cambiosAsistencia: { sql: 'cambios_asistencia', ciclo: CON_CICLO },
  salidas: { sql: 'salidas', ciclo: CON_CICLO }, reportes: { sql: 'reportes', ciclo: CON_CICLO },
  incidenciasPersonal: { sql: 'incidencias_personal', ciclo: CON_CICLO }, coberturas: { sql: 'coberturas', ciclo: CON_CICLO },
  bancoActividades: { sql: 'banco_actividades', ciclo: CON_CICLO }, bitacoraPrefectura: { sql: 'bitacora_prefectura', ciclo: CON_CICLO },
};
