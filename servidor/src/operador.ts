/**
 * Operaciones del operador del servidor (CLI). Validan con Zod y escriben en una transacción.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { auditar, enTransaccion } from './acceso.ts';
import type { Configuracion } from './config.ts';

/** Mismo formato que la aplicación (src/validators/esquemas.ts: PATRON_CCT). Sólo formato, no existencia. */
export const PATRON_CCT = /^(0[1-9]|[12]\d|3[0-2])[A-Z]{3}\d{4}[A-Z]$/;

const esquemaAlta = z.object({
  id: z.uuid().optional(),
  nombre: z.string().trim().min(3, 'Nombre de al menos 3 caracteres.').max(150, 'Nombre de máximo 150 caracteres.'),
  cct: z.string('Indica la CCT.').trim().toUpperCase().regex(PATRON_CCT, 'CCT con formato 00AAA0000A.'),
  nivel: z.enum(['inicial', 'preescolar', 'primaria', 'secundaria', 'media_superior', 'otro'], 'Nivel: inicial, preescolar, primaria, secundaria, media_superior u otro.'),
  entidad: z.string().regex(/^(0[1-9]|[12]\d|3[0-2])$/, 'Entidad de dos dígitos (01 a 32).'),
  municipio: z.string('Indica el municipio.').trim().min(2, 'Municipio de al menos 2 caracteres.').max(120),
  adminCorreo: z.email('Correo del administrador inválido.').transform((c) => c.trim().toLowerCase()),
  adminNombre: z.string('Indica el nombre del administrador.').trim().min(2, 'Nombre del administrador de al menos 2 caracteres.').max(120),
  tipoCorreo: z.enum(['institucional', 'personal'], 'Tipo de correo: institucional o personal.'),
  consentimiento: z.boolean(),
}).refine((d) => d.cct.slice(0, 2) === d.entidad, { path: ['cct'], message: 'La CCT debe iniciar con la clave de la entidad.' })
  .refine((d) => d.tipoCorreo === 'institucional' || d.consentimiento, { path: ['consentimiento'], message: 'Un correo personal requiere --consentimiento.' });

function validar<T>(esquema: z.ZodType<T>, datos: unknown): T {
  const r = esquema.safeParse(datos);
  if (!r.success) throw new Error(`Datos inválidos: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

export async function altaEscuela(bd: Pool, cfg: Pick<Configuracion, 'INVITACION_HORAS'>, datos: Record<string, unknown>): Promise<{ escuelaId: string; usuarioId: string; membresiaId: string; expira: string }> {
  const d = validar(esquemaAlta, datos);
  return enTransaccion(bd, async (c) => {
    const repetida = await c.query('SELECT 1 FROM escolar.escuelas WHERE upper(cct) = $1', [d.cct]);
    if (repetida.rowCount) throw new Error('Ya existe una escuela con esa CCT en el servidor: no se mezclan escuelas.');
    const escuelaId = d.id ?? randomUUID();
    await c.query(`INSERT INTO escolar.escuelas (id, creado_en, actualizado_en, version, nombre, cct, nivel, entidad, localidad)
      VALUES ($1, now(), now(), 1, $2, $3, $4, $5, $6)`, [escuelaId, d.nombre, d.cct, d.nivel, d.entidad, d.municipio]);
    let { rows } = await c.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [d.adminCorreo]);
    let usuarioId = rows[0]?.id;
    if (!usuarioId) {
      usuarioId = randomUUID();
      await c.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, false, false, now(), now())`, [usuarioId, d.adminNombre, d.adminCorreo]);
    }
    ({ rows } = await c.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, tipo_correo, consentimiento_correo_en, expira_en)
      VALUES ($1, $2, 'administrador', $3, CASE WHEN $3 = 'personal' THEN now() ELSE NULL END, now() + make_interval(hours => $4)) RETURNING id, expira_en`,
      [usuarioId, escuelaId, d.tipoCorreo, cfg.INVITACION_HORAS]));
    const m = rows[0] as unknown as { id: string; expira_en: Date };
    await auditar(c, { usuarioId: null, escuelaId, accion: 'escuela_dada_de_alta_por_operador', entidad: 'escuela', entidadId: escuelaId });
    await auditar(c, { usuarioId: null, escuelaId, accion: 'invitacion_creada', entidad: 'membresia', entidadId: m.id, detalle: { rol: 'administrador', tipoCorreo: d.tipoCorreo } });
    return { escuelaId, usuarioId, membresiaId: m.id, expira: m.expira_en.toISOString() };
  });
}

export async function restablecerSegundoFactorOperador(bd: Pool, datos: Record<string, unknown>): Promise<{ sesionesCerradas: number }> {
  const d = validar(z.object({ correo: z.email('Correo inválido.').transform((c) => c.toLowerCase()), motivo: z.string('Indica el motivo.').trim().min(3, 'Motivo de al menos 3 caracteres.').max(300) }), datos);
  return enTransaccion(bd, async (c) => {
    const { rows } = await c.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1 FOR UPDATE', [d.correo]);
    const id = rows[0]?.id;
    if (!id) throw new Error('No existe una cuenta con ese correo.');
    await c.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [id]);
    await c.query(`UPDATE "user" SET "twoFactorEnabled" = false, "updatedAt" = now() WHERE id = $1`, [id]);
    const cerradas = (await c.query('DELETE FROM "session" WHERE "userId" = $1', [id])).rowCount ?? 0;
    await auditar(c, { usuarioId: null, accion: 'segundo_factor_restablecido_por_operador', entidad: 'usuario', entidadId: id, detalle: { motivo: d.motivo, sesionesCerradas: cerradas } });
    return { sesionesCerradas: cerradas };
  });
}
