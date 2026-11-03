/**
 * API propia del servidor (fuera de /api/auth). Cada ruta comprueba EN EL SERVIDOR:
 * sesión vigente → segundo factor → membresía activa en la escuela → rol.
 * Las respuestas de «sin permiso» son iguales exista o no la escuela (no revelan datos).
 * En la Fase 8B el servidor no guarda ni envía datos escolares: sólo cuentas y accesos.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  ETIQUETA_ROL, PERMISOS_DELEGABLES, ROLES, auditar, enTransaccion, membresiasActivas, membresiasVigentes, requiereSegundoFactor,
  type Membresia, type Rol,
} from './acceso.ts';
import type { Auth } from './auth.ts';
import type { Configuracion } from './config.ts';
import type { EnviadorCorreo } from './correo.ts';
import { ErrorApi } from './errores.ts';
import { DatosEscolares, type Actor } from './datosEscolares.ts';
import { ejecutarComando, esquemaPeticionComando } from './comandos.ts';
import { Sincronizacion } from './sincronizacion.ts';

export { ErrorApi };

export interface Peticion {
  metodo: string;
  ruta: string; // sin la consulta
  consulta: URLSearchParams;
  cabeceras: Headers;
  cuerpo: unknown;
}

export interface Respuesta { estado: number; cuerpo: unknown }

interface Contexto {
  usuario: { id: string; nombre: string; correo: string; segundoFactorActivo: boolean };
  sesion: { id: string; segundoFactorVerificado: boolean };
  membresias: Membresia[]; // activas
}

const uuid = z.uuid('Identificador inválido.');
const esquemaInvitacion = z.object({
  correo: z.email('Escribe un correo válido.').max(120).transform((c) => c.trim().toLowerCase()),
  nombre: z.string().trim().min(2, 'Escribe el nombre de la persona.').max(120),
  rol: z.enum(ROLES, 'Elige un rol.'),
  tipoCorreo: z.enum(['institucional', 'personal'], 'Indica si el correo es institucional o personal.'),
  consentimiento: z.boolean().default(false),
}).refine((d) => d.tipoCorreo === 'institucional' || d.consentimiento, { path: ['consentimiento'], message: 'Para usar un correo personal, la persona debe dar su consentimiento.' });
const esquemaMotivo = z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres).').max(300) });

function validar<T>(esquema: z.ZodType<T>, datos: unknown): T {
  const r = esquema.safeParse(datos ?? {});
  if (r.success) return r.data;
  const campos: Record<string, string> = {};
  for (const i of r.error.issues) { const k = i.path.join('.') || 'datos'; campos[k] ??= i.message; }
  throw new ErrorApi(400, 'VALIDACION', 'Revisa los datos marcados.', campos);
}

const SIN_PERMISO = () => new ErrorApi(403, 'SIN_PERMISO', 'No tienes permiso para esta acción en esta escuela.');

export class ApiEscolar {
  private readonly cfg: Configuracion;
  private readonly bd: Pool;
  private readonly auth: Auth;
  private readonly correo: EnviadorCorreo;
  private readonly datos: DatosEscolares;
  private readonly sinc: Sincronizacion;
  constructor(cfg: Configuracion, bd: Pool, auth: Auth, correo: EnviadorCorreo) {
    this.cfg = cfg; this.bd = bd; this.auth = auth; this.correo = correo;
    this.datos = new DatosEscolares(bd, cfg.ZONA_HORARIA);
    this.sinc = new Sincronizacion(bd, this.datos);
  }

  async atender(p: Peticion): Promise<Respuesta> {
    const r = (metodo: string, patron: RegExp) => (p.metodo === metodo ? patron.exec(p.ruta) : null);
    let m: RegExpExecArray | null;
    if (r('GET', /^\/api\/salud$/)) return { estado: 200, cuerpo: { estado: 'ok' } };
    if (r('GET', /^\/api\/configuracion$/)) return { estado: 200, cuerpo: { proveedores: this.cfg.proveedores, buzonDesarrollo: this.cfg.CORREO_MODO === 'buzon' && this.cfg.MODO !== 'produccion' } };
    if (r('GET', /^\/api\/yo$/)) return this.yo(p);
    if (r('GET', /^\/api\/yo\/sesiones$/)) return this.sesiones(p);
    if ((m = r('POST', /^\/api\/yo\/sesiones\/([^/]+)\/cerrar$/))) return this.cerrarSesion(p, m[1]!);
    if ((m = r('GET', /^\/api\/escuelas\/([^/]+)\/miembros$/))) return this.miembros(p, m[1]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/invitaciones$/))) return this.invitar(p, m[1]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/membresias\/([^/]+)\/revocar$/))) return this.revocar(p, m[1]!, m[2]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/membresias\/([^/]+)\/restablecer-segundo-factor$/))) return this.restablecerSegundoFactor(p, m[1]!, m[2]!);
    if ((m = r('GET', /^\/api\/escuelas\/([^/]+)\/auditoria$/))) return this.auditoria(p, m[1]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/membresias\/([^/]+)\/vincular-personal$/))) return this.vincularPersonal(p, m[1]!, m[2]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/membresias\/([^/]+)\/delegaciones$/))) return this.delegar(p, m[1]!, m[2]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/comandos$/))) return this.comando(p, m[1]!);
    if ((m = r('GET', /^\/api\/escuelas\/([^/]+)\/tablas\/([A-Za-z]+)$/))) return this.leerTabla(p, m[1]!, m[2]!);
    if ((m = r('GET', /^\/api\/escuelas\/([^/]+)\/sincronizacion$/))) return this.recibirCambios(p, m[1]!);
    if ((m = r('POST', /^\/api\/escuelas\/([^/]+)\/sincronizacion$/))) return this.enviarCambios(p, m[1]!);
    throw new ErrorApi(404, 'NO_ENCONTRADO', 'Ruta no disponible.');
  }

  // ---------- Contexto y comprobaciones ----------

  private async contexto(p: Peticion, opciones: { permitirPendiente?: boolean } = {}): Promise<Contexto> {
    const s = await this.auth.api.getSession({ headers: p.cabeceras });
    if (!s) throw new ErrorApi(401, 'SIN_SESION', 'Inicia sesión para continuar.');
    const u = s.user as typeof s.user & { twoFactorEnabled?: boolean | null };
    const ses = s.session as typeof s.session & { segundoFactorVerificado?: boolean | null };
    const ctx: Contexto = {
      usuario: { id: u.id, nombre: u.name, correo: u.email, segundoFactorActivo: u.twoFactorEnabled === true },
      sesion: { id: ses.id, segundoFactorVerificado: ses.segundoFactorVerificado === true },
      membresias: await membresiasActivas(this.bd, u.id),
    };
    if (!opciones.permitirPendiente) {
      if (ctx.usuario.segundoFactorActivo && !ctx.sesion.segundoFactorVerificado) throw new ErrorApi(403, 'SEGUNDO_FACTOR_PENDIENTE', 'Escribe el código de tu aplicación de autenticación para continuar.');
      if (requiereSegundoFactor(ctx.membresias) && !ctx.usuario.segundoFactorActivo) throw new ErrorApi(403, 'SEGUNDO_FACTOR_REQUERIDO', 'Tu rol exige activar la verificación en dos pasos antes de continuar.');
    }
    return ctx;
  }

  private exigirRol(ctx: Contexto, escuelaId: string, roles: readonly Rol[]): Membresia {
    if (!uuid.safeParse(escuelaId).success) throw SIN_PERMISO();
    const m = ctx.membresias.find((x) => x.escuelaId === escuelaId && roles.includes(x.rol));
    if (!m) throw SIN_PERMISO();
    return m;
  }

  // ---------- Rutas ----------

  private async yo(p: Peticion): Promise<Respuesta> {
    // Sin sesión no es un error: la aplicación sólo necesita saberlo (null).
    if (!(await this.auth.api.getSession({ headers: p.cabeceras }))) return { estado: 200, cuerpo: null };
    const ctx = await this.contexto(p, { permitirPendiente: true });
    const requerido = requiereSegundoFactor(ctx.membresias);
    return {
      estado: 200,
      cuerpo: {
        usuario: { id: ctx.usuario.id, nombre: ctx.usuario.nombre, correo: ctx.usuario.correo },
        segundoFactor: { activo: ctx.usuario.segundoFactorActivo, verificado: ctx.sesion.segundoFactorVerificado, requerido },
        membresias: ctx.membresias.map((m) => ({ id: m.id, escuelaId: m.escuelaId, escuela: m.escuelaNombre, cct: m.cct, rol: m.rol, etiquetaRol: ETIQUETA_ROL[m.rol], personalId: m.personalId, permisosDelegados: m.permisosDelegados })),
      },
    };
  }

  private async sesiones(p: Peticion): Promise<Respuesta> {
    const ctx = await this.contexto(p, { permitirPendiente: true });
    const { rows } = await this.bd.query(`SELECT id, "createdAt" AS creada, "expiresAt" AS expira, "userAgent" AS agente
      FROM "session" WHERE "userId" = $1 AND "expiresAt" > now() ORDER BY "createdAt" DESC`, [ctx.usuario.id]);
    return { estado: 200, cuerpo: rows.map((r) => ({ id: r.id, creada: (r.creada as Date).toISOString(), expira: (r.expira as Date).toISOString(), dispositivo: resumirAgente(r.agente as string | null), actual: r.id === ctx.sesion.id })) };
  }

  private async cerrarSesion(p: Peticion, sesionId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const r = await this.bd.query('DELETE FROM "session" WHERE id = $1 AND "userId" = $2', [sesionId, ctx.usuario.id]);
    if (!r.rowCount) throw new ErrorApi(404, 'NO_ENCONTRADO', 'La sesión ya no existe.');
    await auditar(this.bd, { usuarioId: ctx.usuario.id, accion: 'sesion_cerrada_por_usuario', entidad: 'sesion', entidadId: sesionId });
    return { estado: 200, cuerpo: { cerrada: true } };
  }

  private async miembros(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { rows } = await this.bd.query(`SELECT m.id, m.usuario_id, u.name AS nombre, u.email AS correo, m.rol, m.estado,
        (m.estado = 'invitada' AND m.expira_en <= now()) AS caducada, m.tipo_correo, m.invitada_en, m.expira_en, m.aceptada_en, m.revocada_en,
        m.motivo_revocacion, coalesce(u."twoFactorEnabled", false) AS segundo_factor, m.personal_id, m.permisos_delegados
      FROM acceso.membresias m JOIN "user" u ON u.id = m.usuario_id
      WHERE m.escuela_id = $1 ORDER BY m.estado = 'revocada', u.name, m.rol`, [escuelaId]);
    const fecha = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
    return {
      estado: 200,
      cuerpo: rows.map((r) => ({
        id: r.id, usuarioId: r.usuario_id, nombre: r.nombre, correo: r.correo, rol: r.rol, etiquetaRol: ETIQUETA_ROL[r.rol as Rol],
        estado: r.estado, caducada: r.caducada, tipoCorreo: r.tipo_correo, invitadaEn: fecha(r.invitada_en), expiraEn: fecha(r.expira_en),
        aceptadaEn: fecha(r.aceptada_en), revocadaEn: fecha(r.revocada_en), motivoRevocacion: r.motivo_revocacion, segundoFactorActivo: r.segundo_factor,
        esUsted: r.usuario_id === ctx.usuario.id, personalId: r.personal_id, permisosDelegados: r.permisos_delegados,
      })),
    };
  }

  private async invitar(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const admin = this.exigirRol(ctx, escuelaId, ['administrador']);
    const d = validar(esquemaInvitacion, p.cuerpo);
    const horas = this.cfg.INVITACION_HORAS;
    const resultado = await enTransaccion(this.bd, async (c) => {
      let { rows } = await c.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [d.correo]);
      let usuarioId = rows[0]?.id;
      if (!usuarioId) {
        usuarioId = randomUUID();
        await c.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, false, false, now(), now())`, [usuarioId, d.nombre, d.correo]);
      }
      ({ rows } = await c.query(`SELECT id, estado FROM acceso.membresias WHERE usuario_id = $1 AND escuela_id = $2 AND rol = $3 AND estado <> 'revocada' FOR UPDATE`, [usuarioId, escuelaId, d.rol]));
      const previa = rows[0] as { id: string; estado: string } | undefined;
      if (previa?.estado === 'activa') throw new ErrorApi(409, 'YA_ES_MIEMBRO', 'Esa persona ya tiene ese rol activo en esta escuela.', { correo: 'Ya tiene ese rol activo.' });
      let membresiaId: string;
      if (previa) {
        membresiaId = previa.id;
        await c.query(`UPDATE acceso.membresias SET expira_en = now() + make_interval(hours => $2), invitada_en = now(), invitada_por = $3,
          tipo_correo = $4, consentimiento_correo_en = CASE WHEN $4 = 'personal' THEN now() ELSE NULL END, actualizada_en = now() WHERE id = $1`,
          [membresiaId, horas, ctx.usuario.id, d.tipoCorreo]);
      } else {
        ({ rows } = await c.query(`INSERT INTO acceso.membresias (usuario_id, escuela_id, rol, tipo_correo, consentimiento_correo_en, invitada_por, expira_en)
          VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'personal' THEN now() ELSE NULL END, $5, now() + make_interval(hours => $6)) RETURNING id`,
          [usuarioId, escuelaId, d.rol, d.tipoCorreo, ctx.usuario.id, horas]));
        membresiaId = (rows[0] as { id: string }).id;
      }
      await auditar(c, { usuarioId: ctx.usuario.id, escuelaId, accion: previa ? 'invitacion_renovada' : 'invitacion_creada', entidad: 'membresia', entidadId: membresiaId, detalle: { rol: d.rol, tipoCorreo: d.tipoCorreo } });
      return { membresiaId };
    });
    await this.correo.enviar({
      para: d.correo, codigo: null,
      asunto: `Invitación a Gestión Escolar · ${admin.escuelaNombre}`,
      texto: `Te invitaron a ${admin.escuelaNombre} como ${ETIQUETA_ROL[d.rol]}.\nEntra en ${this.cfg.URL_PUBLICA}/#/cuenta con este correo: recibirás un código de acceso.\nLa invitación vence en ${Math.round(horas / 24)} día(s). Si no la esperabas, ignora este mensaje.`,
    });
    return { estado: 201, cuerpo: resultado };
  }

  private async membresiaDeEscuela(c: Pick<Pool, 'query'>, escuelaId: string, membresiaId: string): Promise<{ id: string; usuario_id: string; rol: Rol; estado: string }> {
    if (!uuid.safeParse(membresiaId).success) throw new ErrorApi(404, 'NO_ENCONTRADO', 'No existe esa membresía en esta escuela.');
    const { rows } = await c.query('SELECT id, usuario_id, rol, estado FROM acceso.membresias WHERE id = $1 AND escuela_id = $2 FOR UPDATE', [membresiaId, escuelaId]);
    const m = rows[0] as { id: string; usuario_id: string; rol: Rol; estado: string } | undefined;
    if (!m) throw new ErrorApi(404, 'NO_ENCONTRADO', 'No existe esa membresía en esta escuela.');
    return m;
  }

  private async revocar(p: Peticion, escuelaId: string, membresiaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { motivo } = validar(esquemaMotivo, p.cuerpo);
    const r = await enTransaccion(this.bd, async (c) => {
      const m = await this.membresiaDeEscuela(c, escuelaId, membresiaId);
      if (m.estado === 'revocada') throw new ErrorApi(409, 'YA_REVOCADA', 'Ese acceso ya estaba revocado.');
      if (m.usuario_id === ctx.usuario.id) throw new ErrorApi(409, 'PROPIA', 'No puedes revocar tu propio acceso. Pide a otro administrador que lo haga.');
      if (m.rol === 'administrador' && m.estado === 'activa') {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM acceso.membresias WHERE escuela_id = $1 AND rol = 'administrador' AND estado = 'activa'`, [escuelaId]);
        if ((rows[0] as { n: number }).n <= 1) throw new ErrorApi(409, 'ULTIMO_ADMINISTRADOR', 'Es el único administrador activo: la escuela quedaría sin administración.');
      }
      await c.query(`UPDATE acceso.membresias SET estado = 'revocada', revocada_por = $2, revocada_en = now(), motivo_revocacion = $3, actualizada_en = now() WHERE id = $1`, [m.id, ctx.usuario.id, motivo]);
      // Sin otro acceso vigente, se cierran todas sus sesiones al instante.
      const vigentes = await membresiasVigentes(c, m.usuario_id);
      let sesionesCerradas = 0;
      if (vigentes.length === 0) sesionesCerradas = (await c.query('DELETE FROM "session" WHERE "userId" = $1', [m.usuario_id])).rowCount ?? 0;
      await auditar(c, { usuarioId: ctx.usuario.id, escuelaId, accion: 'membresia_revocada', entidad: 'membresia', entidadId: m.id, detalle: { rol: m.rol, sesionesCerradas } });
      return { revocada: true, sesionesCerradas };
    });
    return { estado: 200, cuerpo: r };
  }

  /**
   * Recuperación cuando alguien perdió su aplicación de autenticación y sus códigos de respaldo.
   * Sólo dentro de la propia escuela: si la persona tiene acceso a otras escuelas, lo hace el operador del servidor.
   */
  private async restablecerSegundoFactor(p: Peticion, escuelaId: string, membresiaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { motivo } = validar(esquemaMotivo, p.cuerpo);
    const r = await enTransaccion(this.bd, async (c) => {
      const m = await this.membresiaDeEscuela(c, escuelaId, membresiaId);
      if (m.estado === 'revocada') throw new ErrorApi(409, 'YA_REVOCADA', 'Ese acceso está revocado.');
      if (m.usuario_id === ctx.usuario.id) throw new ErrorApi(409, 'PROPIA', 'No puedes restablecer tu propia verificación: pide a otro administrador o al operador del servidor.');
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM acceso.membresias WHERE usuario_id = $1 AND escuela_id <> $2 AND estado <> 'revocada'`, [m.usuario_id, escuelaId]);
      if ((rows[0] as { n: number }).n > 0) throw new ErrorApi(409, 'OTRAS_ESCUELAS', 'Esa persona tiene acceso a otras escuelas: el restablecimiento lo hace el operador del servidor.');
      await c.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [m.usuario_id]);
      await c.query(`UPDATE "user" SET "twoFactorEnabled" = false, "updatedAt" = now() WHERE id = $1`, [m.usuario_id]);
      const cerradas = (await c.query('DELETE FROM "session" WHERE "userId" = $1', [m.usuario_id])).rowCount ?? 0;
      await auditar(c, { usuarioId: ctx.usuario.id, escuelaId, accion: 'segundo_factor_restablecido', entidad: 'membresia', entidadId: m.id, detalle: { motivo, sesionesCerradas: cerradas } });
      return { restablecido: true, sesionesCerradas: cerradas };
    });
    return { estado: 200, cuerpo: r };
  }

  private async auditoria(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { rows } = await this.bd.query(`SELECT a.ocurrido_en, a.accion, a.entidad, a.detalle, u.name AS quien
      FROM acceso.auditoria a LEFT JOIN "user" u ON u.id = a.usuario_id
      WHERE a.escuela_id = $1 ORDER BY a.id DESC LIMIT 100`, [escuelaId]);
    return { estado: 200, cuerpo: rows.map((r) => ({ ocurridoEn: (r.ocurrido_en as Date).toISOString(), accion: r.accion, entidad: r.entidad, detalle: r.detalle, quien: r.quien })) };
  }
  // ---------- Fase 8C: datos escolares con permisos por fila ----------

  private actor(ctx: Contexto, escuelaId: string): Actor {
    if (!uuid.safeParse(escuelaId).success || !ctx.membresias.some((m) => m.escuelaId === escuelaId)) throw SIN_PERMISO();
    return { usuarioId: ctx.usuario.id, nombre: ctx.usuario.nombre, escuelaId, membresias: ctx.membresias };
  }

  /** Comando con idempotencia: el mismo opId devuelve el mismo resultado sin repetir la operación. */
  private async comando(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const actor = this.actor(ctx, escuelaId);
    const pet = validar(esquemaPeticionComando, p.cuerpo);
    const previa = await this.bd.query<{ usuario_id: string; escuela_id: string; tipo: string; resultado: unknown }>(
      'SELECT usuario_id, escuela_id, tipo, resultado FROM acceso.operaciones WHERE op_id = $1', [pet.opId]);
    if (previa.rows[0]) {
      const o = previa.rows[0];
      if (o.usuario_id !== actor.usuarioId || o.escuela_id !== escuelaId || o.tipo !== pet.tipo) throw new ErrorApi(409, 'OPERACION_DISTINTA', 'Ese identificador de operación ya se usó para otra operación.');
      return { estado: 200, cuerpo: { repetida: true, resultado: o.resultado } };
    }
    try {
      const resultado = await this.datos.ejecutar(actor, (c) => ejecutarComando(c, pet.tipo, pet.datos), async (cl, res) => {
        await cl.query('INSERT INTO acceso.operaciones (op_id, usuario_id, escuela_id, tipo, resultado) VALUES ($1, $2, $3, $4, $5)',
          [pet.opId, actor.usuarioId, escuelaId, pet.tipo, JSON.stringify(res ?? null)]);
        await auditar(cl, { usuarioId: actor.usuarioId, escuelaId, accion: 'comando', entidad: pet.tipo, entidadId: pet.opId });
      });
      return { estado: 200, cuerpo: { repetida: false, resultado } };
    } catch (e) {
      // Dos envíos simultáneos del mismo opId: el segundo devuelve lo que guardó el primero.
      if (e instanceof ErrorApi && e.codigo === 'DUPLICADO') {
        const ya = await this.bd.query('SELECT resultado FROM acceso.operaciones WHERE op_id = $1 AND usuario_id = $2', [pet.opId, actor.usuarioId]);
        if (ya.rows[0]) return { estado: 200, cuerpo: { repetida: true, resultado: ya.rows[0].resultado } };
      }
      if (e instanceof ErrorApi && e.estado === 403) await auditar(this.bd, { usuarioId: actor.usuarioId, escuelaId, accion: 'comando_rechazado', entidad: pet.tipo, entidadId: pet.opId });
      throw e;
    }
  }

  private async leerTabla(p: Peticion, escuelaId: string, tabla: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const actor = this.actor(ctx, escuelaId);
    const ciclo = p.consulta.get('ciclo');
    if (ciclo !== null && !uuid.safeParse(ciclo).success) throw new ErrorApi(400, 'VALIDACION', 'Ciclo inválido.');
    return { estado: 200, cuerpo: await this.datos.leerTabla(actor, tabla, ciclo) };
  }

  // ---------- Fase 8D: sincronización ----------

  private async recibirCambios(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const actor = this.actor(ctx, escuelaId);
    const desde = Number(p.consulta.get('desde') ?? '0');
    if (!Number.isSafeInteger(desde) || desde < 0) throw new ErrorApi(400, 'VALIDACION', 'Secuencia inválida.');
    return { estado: 200, cuerpo: await this.sinc.recibir(actor, desde) };
  }

  private async enviarCambios(p: Peticion, escuelaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    const actor = this.actor(ctx, escuelaId);
    return { estado: 200, cuerpo: await this.sinc.enviar(actor, p.cuerpo) };
  }

  /** Vincula la membresía con la ficha de personal de la escuela (define los grupos de un docente). */
  private async vincularPersonal(p: Peticion, escuelaId: string, membresiaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { personalId } = validar(z.object({ personalId: uuid.nullable() }), p.cuerpo);
    const r = await enTransaccion(this.bd, async (c) => {
      const m = await this.membresiaDeEscuela(c, escuelaId, membresiaId);
      if (m.estado === 'revocada') throw new ErrorApi(409, 'YA_REVOCADA', 'Ese acceso está revocado.');
      if (personalId) {
        const f = await c.query('SELECT 1 FROM escolar.personal WHERE id = $1 AND escuela_id = $2', [personalId, escuelaId]);
        if (!f.rowCount) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Esa ficha de personal no existe en esta escuela.', { personalId: 'No existe en esta escuela.' });
        const otra = await c.query(`SELECT 1 FROM acceso.membresias WHERE escuela_id = $1 AND personal_id = $2 AND usuario_id <> $3 AND estado <> 'revocada'`, [escuelaId, personalId, m.usuario_id]);
        if (otra.rowCount) throw new ErrorApi(409, 'YA_VINCULADA', 'Esa ficha ya está vinculada con otra persona.', { personalId: 'Ya está vinculada con otra persona.' });
      }
      // La ficha identifica a la PERSONA: se vincula en todas sus membresías de esta escuela.
      await c.query(`UPDATE acceso.membresias SET personal_id = $3, actualizada_en = now() WHERE escuela_id = $1 AND usuario_id = $2 AND estado <> 'revocada'`, [escuelaId, m.usuario_id, personalId]);
      await auditar(c, { usuarioId: ctx.usuario.id, escuelaId, accion: personalId ? 'personal_vinculado' : 'personal_desvinculado', entidad: 'membresia', entidadId: m.id });
      return { vinculada: personalId !== null };
    });
    return { estado: 200, cuerpo: r };
  }

  /** Delegación (D5): el administrador delega confirmar incidencias o autorizar coberturas a Dirección o Subdirección. */
  private async delegar(p: Peticion, escuelaId: string, membresiaId: string): Promise<Respuesta> {
    const ctx = await this.contexto(p);
    this.exigirRol(ctx, escuelaId, ['administrador']);
    const { permisos } = validar(z.object({ permisos: z.array(z.enum(PERMISOS_DELEGABLES, 'Permiso no delegable.')).max(2).transform((v) => [...new Set(v)].sort()) }), p.cuerpo);
    const r = await enTransaccion(this.bd, async (c) => {
      const m = await this.membresiaDeEscuela(c, escuelaId, membresiaId);
      if (m.estado === 'revocada') throw new ErrorApi(409, 'YA_REVOCADA', 'Ese acceso está revocado.');
      if (!['direccion', 'subdireccion'].includes(m.rol)) throw new ErrorApi(409, 'ROL_NO_DELEGABLE', 'Sólo se delega a Dirección o Subdirección.');
      await c.query('UPDATE acceso.membresias SET permisos_delegados = $2, actualizada_en = now() WHERE id = $1', [m.id, permisos]);
      await auditar(c, { usuarioId: ctx.usuario.id, escuelaId, accion: 'delegacion_cambiada', entidad: 'membresia', entidadId: m.id, detalle: { permisos: permisos.join(',') || 'ninguno' } });
      return { permisos };
    });
    return { estado: 200, cuerpo: r };
  }
}

/** Descripción breve del navegador (sin guardar ni mostrar el agente completo). */
export function resumirAgente(agente: string | null): string {
  if (!agente) return 'Dispositivo desconocido';
  const so = /Android/i.test(agente) ? 'Android' : /iPhone|iPad|iOS/i.test(agente) ? 'iOS' : /Windows/i.test(agente) ? 'Windows' : /Mac OS/i.test(agente) ? 'macOS' : /Linux/i.test(agente) ? 'Linux' : 'Otro sistema';
  const nav = /Edg\//.test(agente) ? 'Edge' : /Firefox\//.test(agente) ? 'Firefox' : /Chrome\//.test(agente) ? 'Chrome' : /Safari\//.test(agente) ? 'Safari' : 'otro navegador';
  return `${nav} en ${so}`;
}
