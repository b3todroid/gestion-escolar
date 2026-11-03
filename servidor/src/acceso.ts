/**
 * Membresías (quién puede entrar a qué escuela y con qué rol) y auditoría.
 * Las comprobaciones se hacen en el SERVIDOR en cada petición: ocultar botones en
 * la aplicación no es un permiso.
 */
import type { Pool, PoolClient } from 'pg';

export const ROLES = ['administrador', 'direccion', 'subdireccion', 'prefectura', 'docente', 'apoyo'] as const;
export type Rol = (typeof ROLES)[number];
/** Roles con acceso amplio: exigen verificación en dos pasos (TOTP). */
export const ROLES_CON_SEGUNDO_FACTOR: readonly Rol[] = ['administrador', 'direccion', 'subdireccion'];

export const ETIQUETA_ROL: Record<Rol, string> = {
  administrador: 'Administrador de la escuela', direccion: 'Dirección', subdireccion: 'Subdirección',
  prefectura: 'Prefectura', docente: 'Docente', apoyo: 'Personal de apoyo',
};

export type EstadoMembresia = 'invitada' | 'activa' | 'revocada';

export interface Membresia {
  id: string;
  usuarioId: string;
  escuelaId: string;
  escuelaNombre: string;
  cct: string | null;
  rol: Rol;
  estado: EstadoMembresia;
  /** true si la invitación caducó sin usarse. */
  caducada: boolean;
}

type Consulta = Pool | PoolClient;

const SELECT_MEMBRESIA = `SELECT m.id, m.usuario_id, m.escuela_id, e.nombre AS escuela_nombre, e.cct, m.rol, m.estado,
  (m.estado = 'invitada' AND m.expira_en <= now()) AS caducada
  FROM acceso.membresias m JOIN escolar.escuelas e ON e.id = m.escuela_id`;

function aMembresia(r: Record<string, unknown>): Membresia {
  return {
    id: r.id as string, usuarioId: r.usuario_id as string, escuelaId: r.escuela_id as string,
    escuelaNombre: r.escuela_nombre as string, cct: (r.cct as string | null) ?? null,
    rol: r.rol as Rol, estado: r.estado as EstadoMembresia, caducada: r.caducada === true,
  };
}

/** Membresías que permiten entrar: activas o invitaciones sin caducar. */
export async function membresiasVigentes(bd: Consulta, usuarioId: string): Promise<Membresia[]> {
  const { rows } = await bd.query(`${SELECT_MEMBRESIA} WHERE m.usuario_id = $1
    AND (m.estado = 'activa' OR (m.estado = 'invitada' AND m.expira_en > now())) ORDER BY e.nombre, m.rol`, [usuarioId]);
  return rows.map(aMembresia);
}

export async function membresiasActivas(bd: Consulta, usuarioId: string): Promise<Membresia[]> {
  const { rows } = await bd.query(`${SELECT_MEMBRESIA} WHERE m.usuario_id = $1 AND m.estado = 'activa' ORDER BY e.nombre, m.rol`, [usuarioId]);
  return rows.map(aMembresia);
}

/** Al iniciar sesión por primera vez, las invitaciones vigentes pasan a activas. */
export async function activarInvitaciones(bd: Consulta, usuarioId: string): Promise<number> {
  const r = await bd.query(`UPDATE acceso.membresias SET estado = 'activa', aceptada_en = now(), actualizada_en = now()
    WHERE usuario_id = $1 AND estado = 'invitada' AND expira_en > now()`, [usuarioId]);
  return r.rowCount ?? 0;
}

export function requiereSegundoFactor(membresias: Pick<Membresia, 'rol'>[]): boolean {
  return membresias.some((m) => ROLES_CON_SEGUNDO_FACTOR.includes(m.rol));
}

export interface EventoAuditoria {
  usuarioId: string | null;
  escuelaId?: string | null;
  accion: string;
  entidad?: string | null;
  entidadId?: string | null;
  /** Sólo identificadores y valores no personales (nunca correos, nombres ni códigos). */
  detalle?: Record<string, string | number | boolean | null>;
}

/** Registro de auditoría de sólo agregar (la base rechaza modificaciones y borrados). */
export async function auditar(bd: Consulta, e: EventoAuditoria): Promise<void> {
  await bd.query(`INSERT INTO acceso.auditoria (usuario_id, escuela_id, accion, entidad, entidad_id, detalle)
    VALUES ($1, $2, $3, $4, $5, $6)`, [e.usuarioId, e.escuelaId ?? null, e.accion, e.entidad ?? null, e.entidadId ?? null, JSON.stringify(e.detalle ?? {})]);
}

export async function enTransaccion<T>(bd: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await bd.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
