/**
 * Sincronización (Fase 8D): RECIBIR cambios desde una secuencia y ENVIAR la cola del dispositivo.
 * Reglas (nunca «el último gana»):
 * - Cada cambio declara su `versionBase`. Si el servidor tiene otra versión → CONFLICTO
 *   (se devuelve la versión del servidor para que una PERSONA decida). Nada se fusiona solo.
 * - Registro nuevo cuya clave natural ya existe (p. ej. otra lista de la misma clase y fecha)
 *   → CONFLICTO con la versión del servidor.
 * - Cambios de una misma transacción local (`grupo`) se aplican todos o ninguno.
 * - Todo pasa por las políticas RLS, los disparadores y la validación Zod de la tabla:
 *   lo que no está permitido → RECHAZADO, con explicación; el dispositivo no lo pierde.
 * - Reenviar un cambio ya aplicado (mismo opId) → REPETIDO, sin efecto.
 */
import type { Pool } from 'pg';
import { ESQUEMAS_TABLA } from '../../src/validators/respaldo';
import {
  TABLAS_SINCRONIZADAS, esquemaEnvio, type CambioLocal, type CambioRemoto, type RespuestaEnvio, type RespuestaRecepcion, type ResultadoCambio, type TablaSincronizada,
} from '../../src/validators/sincronizacion';
import { auditar, type Rol } from './acceso.ts';
import { TABLAS_LECTURA, traducirError, type Actor, type ContextoComando, type DatosEscolares } from './datosEscolares.ts';
import { ErrorApi } from './errores.ts';
import { aCamel, consultar, type RepositorioPg } from './repositoriosPg.ts';

const LIMITE_RECEPCION = 2000;

/** Claves naturales únicas (además del id): un alta con la misma clave es un conflicto, no un duplicado. */
const CLAVES_NATURALES: Partial<Record<TablaSincronizada, [string, string?]>> = {
  pases: ['sesionId', 'fecha'], coberturas: ['sesionId', 'fecha'], inscripciones: ['alumnoId', 'cicloEscolarId'],
  adscripciones: ['personalId', 'cicloEscolarId'], jornadas: ['turnoId'], confirmaciones: ['grupoId'],
};

class Conflicto extends Error {
  readonly claveNatural: boolean;
  constructor(mensaje: string, claveNatural = false) { super(mensaje); this.claveNatural = claveNatural; }
}
class Rechazo extends Error {}

/** Columnas sensibles ocultas según el rol (las mismas reglas que la lectura por tabla). */
function ocultar(tabla: string, registro: Record<string, unknown>, roles: Set<Rol>): Record<string, unknown> {
  const def = TABLAS_LECTURA[tabla];
  if (!def?.ocultar) return registro;
  const r = { ...registro };
  for (const o of def.ocultar) if (!o.roles.some((x) => roles.has(x))) r[aCamel(o.columna)] = null;
  return r;
}

export class Sincronizacion {
  private readonly bd: Pool;
  private readonly datos: DatosEscolares;
  constructor(bd: Pool, datos: DatosEscolares) { this.bd = bd; this.datos = datos; }

  async recibir(actor: Actor, desde: number): Promise<RespuestaRecepcion> {
    const r = await this.datos.ejecutar(actor, async (c) => {
      const repo = (t: string) => c.repos[t as TablaSincronizada] as unknown as RepositorioPg<never>;
      if (desde === 0) {
        // Fotografía completa de lo que la persona puede ver (en la misma instantánea que la secuencia).
        const { rows } = await c.cliente.query<{ hasta: string }>('SELECT coalesce(max(seq), 0)::text AS hasta FROM sincronizacion.cambios WHERE escuela_id = $1', [actor.escuelaId]);
        const cambios: CambioRemoto[] = [];
        for (const t of TABLAS_SINCRONIZADAS) {
          for (const fila of await repo(t).listarTodos()) {
            const f = fila as unknown as Record<string, unknown>;
            cambios.push({ tabla: t, id: f.id as string, registro: ocultar(t, f, c.roles) });
          }
        }
        return { completa: true, cambios, hasta: Number(rows[0]!.hasta), mas: false };
      }
      const { rows } = await consultar(c.cliente, `SELECT seq, tabla, registro_id FROM sincronizacion.cambios
        WHERE escuela_id = $1 AND seq > $2 ORDER BY seq LIMIT ${LIMITE_RECEPCION}`, [actor.escuelaId, desde]);
      // Sólo importa el último estado de cada registro.
      const ultimos = new Map<string, { tabla: TablaSincronizada; id: string }>();
      for (const x of rows as { tabla: string; registro_id: string }[]) {
        const t = aCamel(x.tabla) as TablaSincronizada;
        ultimos.delete(`${t}:${x.registro_id}`);
        ultimos.set(`${t}:${x.registro_id}`, { tabla: t, id: x.registro_id });
      }
      const cambios: CambioRemoto[] = [];
      for (const { tabla, id } of ultimos.values()) {
        if (!TABLAS_SINCRONIZADAS.includes(tabla)) continue;
        const f = (await repo(tabla).obtener(id)) as unknown as Record<string, unknown> | undefined;
        cambios.push({ tabla, id, registro: f ? ocultar(tabla, f, c.roles) : null });
      }
      const ultimo = rows.at(-1) as { seq: number } | undefined;
      return { completa: false, cambios, hasta: ultimo ? Number(ultimo.seq) : desde, mas: rows.length === LIMITE_RECEPCION };
    }, undefined, { soloLectura: true });
    await auditar(this.bd, { usuarioId: actor.usuarioId, escuelaId: actor.escuelaId, accion: 'sincronizacion_recepcion', detalle: { completa: r.completa, cambios: r.cambios.length } });
    return r;
  }

  async enviar(actor: Actor, cuerpo: unknown): Promise<RespuestaEnvio> {
    const v = esquemaEnvio.safeParse(cuerpo);
    if (!v.success) throw new ErrorApi(400, 'VALIDACION', 'El lote de cambios no tiene el formato esperado.');
    const cambios = v.data.cambios;
    const resultados = new Map<string, ResultadoCambio>();
    // Ya aplicados antes (reintento del dispositivo).
    const { rows } = await this.bd.query<{ op_id: string; usuario_id: string }>('SELECT op_id, usuario_id FROM acceso.operaciones WHERE op_id = ANY($1::uuid[])', [cambios.map((x) => x.opId)]);
    for (const r of rows) {
      resultados.set(r.op_id, r.usuario_id === actor.usuarioId
        ? { opId: r.op_id, estado: 'repetido', mensaje: null, servidor: null }
        : { opId: r.op_id, estado: 'rechazado', mensaje: 'Identificador de operación ya usado.', servidor: null });
    }
    const grupos = new Map<string, CambioLocal[]>();
    for (const x of cambios) if (!resultados.has(x.opId)) grupos.set(x.grupo, [...(grupos.get(x.grupo) ?? []), x]);

    const aplicados: CambioLocal[] = [];
    await this.datos.ejecutar(actor, async (c) => {
      for (const grupo of grupos.values()) {
        await c.cliente.query('SAVEPOINT grupo');
        try {
          for (const x of grupo) await this.aplicar(c, actor, x);
          // Verifica ya (no al final del lote) las llaves foráneas del grupo.
          await c.cliente.query('SET CONSTRAINTS ALL IMMEDIATE');
          await c.cliente.query('SET CONSTRAINTS ALL DEFERRED');
          await c.cliente.query('RELEASE SAVEPOINT grupo');
          for (const x of grupo) { resultados.set(x.opId, { opId: x.opId, estado: 'aplicado', mensaje: null, servidor: null }); aplicados.push(x); }
        } catch (e) {
          await c.cliente.query('ROLLBACK TO SAVEPOINT grupo');
          await c.cliente.query('SET CONSTRAINTS ALL DEFERRED');
          const conflicto = e instanceof Conflicto;
          const mensaje = conflicto || e instanceof Rechazo ? (e as Error).message : traducirError(e).message;
          for (const x of grupo) {
            resultados.set(x.opId, {
              opId: x.opId, estado: conflicto || (e as { code?: string }).code === '23505' ? 'conflicto' : 'rechazado',
              mensaje: grupo.length > 1 ? `${mensaje} (se cambió junto con otros ${grupo.length - 1} registro(s); ninguno se aplicó).` : mensaje,
              servidor: await this.versionServidor(c, x),
            });
          }
        }
      }
    }, async (cl) => {
      for (const x of aplicados) {
        await cl.query('INSERT INTO acceso.operaciones (op_id, usuario_id, escuela_id, tipo, resultado) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [x.opId, actor.usuarioId, actor.escuelaId, `sinc:${x.tabla}`, JSON.stringify({ estado: 'aplicado' })]);
      }
      const cuenta = (e: string) => [...resultados.values()].filter((r) => r.estado === e).length;
      await auditar(cl, { usuarioId: actor.usuarioId, escuelaId: actor.escuelaId, accion: 'sincronizacion_envio',
        detalle: { aplicados: cuenta('aplicado'), repetidos: cuenta('repetido'), conflictos: cuenta('conflicto'), rechazados: cuenta('rechazado') } });
    });
    return { resultados: cambios.map((x) => resultados.get(x.opId)!) };
  }

  private async aplicar(c: ContextoComando, actor: Actor, x: CambioLocal): Promise<void> {
    const repo = c.repos[x.tabla] as unknown as RepositorioPg<never>;
    const actual = (await repo.obtener(x.id)) as unknown as { version: number } | undefined;
    if (x.operacion === 'eliminar') {
      if (!actual) return; // ya no existe: la baja ya está hecha
      if (actual.version !== x.versionBase) throw new Conflicto('Otra persona modificó este registro antes de que lo eliminaras.');
      if ((await repo.eliminarContando(x.id)) === 0) throw new Rechazo('No tienes permiso para eliminar este registro.');
      return;
    }
    const esquema = ESQUEMAS_TABLA[x.tabla];
    const v = esquema.safeParse(x.datos);
    if (!v.success) throw new Rechazo(`Dato inválido en «${v.error.issues[0]?.path.join('.') || 'registro'}».`);
    const reg = v.data as Record<string, unknown> & { id: string; version: number };
    if (reg.id !== x.id) throw new Rechazo('El identificador del registro no coincide.');
    const escuela = x.tabla === 'escuelas' ? reg.id : reg.escuelaId;
    if (escuela !== actor.escuelaId) throw new Rechazo('El registro no pertenece a esta escuela.');
    if (!actual) {
      if (x.versionBase !== null) throw new Conflicto('El registro ya no existe en el servidor o ya no tienes acceso a él.');
      try {
        await repo.insertar(reg as never);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new Conflicto('Ya existe en el servidor un registro equivalente (por ejemplo, otra persona ya guardó la lista de esta clase y fecha).', true);
        throw e;
      }
      return;
    }
    if (actual.version !== x.versionBase) throw new Conflicto('Otra persona modificó este registro mientras trabajabas sin conexión.');
    if ((await repo.actualizarExistente(reg as never)) === 0) throw new Rechazo('No tienes permiso para modificar este registro.');
  }

  /** Versión actual del servidor (por id o por clave natural), para que la persona compare y decida. */
  private async versionServidor(c: ContextoComando, x: CambioLocal): Promise<Record<string, unknown> | null> {
    const repo = c.repos[x.tabla] as unknown as RepositorioPg<never>;
    const porId = (await repo.obtener(x.id)) as unknown as Record<string, unknown> | undefined;
    if (porId) return ocultar(x.tabla, porId, c.roles);
    const clave = CLAVES_NATURALES[x.tabla];
    if (!clave || !x.datos) return null;
    const [a, b] = clave;
    const candidatos = (await repo.listarPor(a as never, x.datos[a] as never)) as unknown as Record<string, unknown>[];
    const f = candidatos.find((r) => !b || r[b] === x.datos![b]);
    return f ? ocultar(x.tabla, f, c.roles) : null;
  }
}
