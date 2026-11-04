/**
 * Autenticación con Better Auth (biblioteca de código abierto, autohospedada).
 * - Sin contraseñas: código de un solo uso al correo (institucional o personal con
 *   consentimiento) o cuenta institucional (Google Workspace / Microsoft 365).
 * - Sin registro abierto: sólo entran personas INVITADAS con una membresía vigente.
 * - Sesiones guardadas en PostgreSQL y revisadas en cada petición (revocación inmediata).
 * - Segundo factor (TOTP) obligatorio para roles con acceso amplio.
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { emailOTP, genericOAuth, twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';
import { activarInvitaciones, auditar, membresiasVigentes, requiereSegundoFactor } from './acceso.ts';
import { MODOS_ESTRICTOS, type Configuracion } from './config.ts';
import type { EnviadorCorreo } from './correo.ts';

export const RUTA_AUTH = '/api/auth';
/** Cabecera interna con la dirección del cliente (la escribe el servidor HTTP; nunca se acepta del exterior). */
export const CABECERA_IP = 'x-ip-cliente';

/**
 * Rutas de Better Auth que se permiten. Todo lo demás (registro, contraseñas,
 * cambio de correo, borrado de cuenta…) responde 404: superficie mínima.
 */
const RUTAS_PERMITIDAS = new Set([
  // '/get-session' y '/list-sessions' no se exponen: devuelven el token de sesión. La app usa /api/yo.
  '/sign-out', '/revoke-other-sessions', '/revoke-sessions',
  '/email-otp/send-verification-otp', '/sign-in/email-otp',
  '/sign-in/social', '/callback/:id',
  '/two-factor/enable', '/two-factor/disable', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/two-factor/generate-backup-codes',
  '/ok', '/error',
]);
/** Rutas disponibles mientras el segundo factor está pendiente en la sesión. */
const RUTAS_CON_SEGUNDO_FACTOR_PENDIENTE = new Set(['/sign-out', '/two-factor/verify-totp', '/two-factor/verify-backup-code']);
const RUTAS_VERIFICACION = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

export function crearAuth(cfg: Configuracion, bd: Pool, correo: EnviadorCorreo) {
  const minutosCodigo = 5;
  const socialProviders: BetterAuthOptions['socialProviders'] = {};
  if (cfg.proveedores.includes('google')) {
    socialProviders.google = {
      clientId: cfg.GOOGLE_CLIENT_ID!, clientSecret: cfg.GOOGLE_CLIENT_SECRET!,
      disableSignUp: true, disableImplicitSignUp: true,
      ...(cfg.GOOGLE_DOMINIO ? { hd: cfg.GOOGLE_DOMINIO } : {}),
    };
  }
  if (cfg.proveedores.includes('microsoft')) {
    socialProviders.microsoft = {
      clientId: cfg.MICROSOFT_CLIENT_ID!, clientSecret: cfg.MICROSOFT_CLIENT_SECRET!, tenantId: cfg.MICROSOFT_TENANT_ID!,
      disableSignUp: true, disableImplicitSignUp: true,
    };
  }

  const plugins = [
    emailOTP({
      disableSignUp: true,
      storeOTP: 'hashed',
      expiresIn: minutosCodigo * 60,
      allowedAttempts: 3,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') return;
        await correo.enviar({
          para: email, codigo: otp,
          asunto: 'Tu código para entrar a Gestión Escolar',
          texto: `Tu código es ${otp}. Caduca en ${minutosCodigo} minutos y sólo sirve una vez.\nSi no lo pediste, ignora este mensaje: nadie puede entrar sin el código.`,
        });
      },
    }),
    twoFactor({
      issuer: 'Gestión Escolar',
      allowPasswordless: true,
      backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
    }),
    {
      // Complemento propio: marca la sesión como verificada en dos pasos al validar un código.
      id: 'segundo-factor-sesion',
      hooks: {
        after: [{
          matcher: (ctx: { path?: string }) => RUTAS_VERIFICACION.has(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const devuelto = ctx.context.returned;
            if (!devuelto || devuelto instanceof APIError || (devuelto instanceof Response && !devuelto.ok)) return;
            // Al activar el segundo factor, Better Auth reemplaza la sesión: se marca la nueva.
            const nueva = ctx.context.newSession;
            const s = nueva ?? await getSessionFromCtx(ctx);
            if (!s) return;
            await ctx.context.internalAdapter.updateSession(s.session.token, { segundoFactorVerificado: true });
            await auditar(bd, { usuarioId: s.user.id, accion: 'segundo_factor_verificado', detalle: { metodo: ctx.path === '/two-factor/verify-totp' ? 'totp' : 'codigo_respaldo' } });
          }),
        }],
      },
    },
  ];
  if (cfg.proveedores.includes('oidc-prueba')) {
    plugins.push(genericOAuth({
      config: [{
        providerId: 'oidc-prueba', discoveryUrl: `${cfg.OIDC_PRUEBA_URL}/.well-known/openid-configuration`,
        clientId: 'gestion-escolar-prueba', clientSecret: 'secreto-de-prueba-local', scopes: ['openid', 'email', 'profile'],
        disableSignUp: true, disableImplicitSignUp: true, pkce: true,
      }],
    }) as unknown as (typeof plugins)[number]);
  }

  const porCorreo = new LimitePorClave(cfg.LIMITE_CODIGOS_POR_CORREO, 10 * 60_000);
  return betterAuth({
    appName: 'Gestión Escolar',
    baseURL: cfg.URL_PUBLICA,
    basePath: RUTA_AUTH,
    secret: cfg.BETTER_AUTH_SECRET,
    trustedOrigins: [cfg.URL_PUBLICA],
    database: bd,
    emailAndPassword: { enabled: false },
    socialProviders,
    // Vinculación: la cuenta la crea el administrador al INVITAR (correo aún sin verificar); el proveedor
    // institucional demuestra que la persona controla ese correo. Sólo proveedores configurados y mismo correo.
    account: { accountLinking: { enabled: true, trustedProviders: [...cfg.proveedores], allowDifferentEmails: false, requireLocalEmailVerified: false } },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: {
      expiresIn: cfg.SESION_HORAS * 3600,
      updateAge: Math.min(24, cfg.SESION_HORAS) * 1800,
      cookieCache: { enabled: false }, // la sesión se consulta siempre en la base: la revocación es inmediata
      additionalFields: { segundoFactorVerificado: { type: 'boolean', defaultValue: false, input: false, required: false } },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60, max: 120,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: cfg.LIMITE_CODIGOS_POR_MINUTO },
        '/sign-in/email-otp': { window: 60, max: cfg.LIMITE_INTENTOS_POR_MINUTO },
        '/two-factor/*': { window: 60, max: cfg.LIMITE_INTENTOS_POR_MINUTO },
      },
    },
    advanced: {
      cookiePrefix: 'gestion-escolar',
      useSecureCookies: MODOS_ESTRICTOS.includes(cfg.MODO),
      ipAddress: { ipAddressHeaders: [CABECERA_IP] },
    },
    telemetry: { enabled: false },
    plugins,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Las llamadas internas del propio servidor (auth.api.*) no llegan por HTTP: no se filtran.
        if (!ctx.request) return;
        const ruta = ctx.path ?? '';
        if (!RUTAS_PERMITIDAS.has(ruta)) throw new APIError('NOT_FOUND', { message: 'Ruta no disponible.' });
        if (ruta === '/email-otp/send-verification-otp' && (ctx.body as { type?: string } | undefined)?.type !== 'sign-in') {
          throw new APIError('BAD_REQUEST', { message: 'Sólo se envían códigos para iniciar sesión.' });
        }
        if (ruta === '/email-otp/send-verification-otp' && !porCorreo.permitir(String((ctx.body as { email?: unknown } | undefined)?.email ?? ''))) {
          // Igual para correos invitados y no invitados: no revela quién tiene cuenta.
          throw new APIError('TOO_MANY_REQUESTS', { message: 'Se pidieron demasiados códigos para este correo. Espera unos minutos.' });
        }
        if (RUTAS_CON_SEGUNDO_FACTOR_PENDIENTE.has(ruta) || ruta.startsWith('/sign-in') || ruta.startsWith('/callback') || ruta === '/email-otp/send-verification-otp' || ruta === '/ok' || ruta === '/error') return;
        const s = await getSessionFromCtx(ctx);
        if (!s) return; // los propios puntos de Better Auth exigen sesión cuando corresponde
        const usuario = s.user as typeof s.user & { twoFactorEnabled?: boolean | null };
        const sesion = s.session as typeof s.session & { segundoFactorVerificado?: boolean | null };
        if (usuario.twoFactorEnabled && !sesion.segundoFactorVerificado) {
          throw new APIError('FORBIDDEN', { message: 'Falta verificar el segundo factor.', code: 'SEGUNDO_FACTOR_PENDIENTE' });
        }
        if (ruta === '/two-factor/disable' && requiereSegundoFactor(await membresiasVigentes(bd, usuario.id))) {
          throw new APIError('FORBIDDEN', { message: 'Tu rol exige verificación en dos pasos: no se puede desactivar.', code: 'SEGUNDO_FACTOR_OBLIGATORIO' });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (sesion) => {
            const vigentes = await membresiasVigentes(bd, sesion.userId);
            if (vigentes.length === 0) {
              await auditar(bd, { usuarioId: sesion.userId, accion: 'inicio_rechazado', detalle: { motivo: 'sin_membresia_vigente' } });
              throw new APIError('FORBIDDEN', { message: 'Tu cuenta no tiene acceso vigente a ninguna escuela. Pide una invitación al administrador de tu escuela.', code: 'SIN_ACCESO' });
            }
            return { data: { ...sesion, segundoFactorVerificado: false } };
          },
          after: async (sesion, contexto) => {
            await activarInvitaciones(bd, sesion.userId);
            const renovada = contexto?.path?.startsWith('/two-factor/') === true;
            await auditar(bd, { usuarioId: sesion.userId, accion: renovada ? 'sesion_renovada' : 'sesion_iniciada', entidad: 'sesion', entidadId: sesion.id, detalle: { via: viaDeInicio(contexto?.path) } });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof crearAuth>;

function viaDeInicio(ruta: string | undefined): string {
  if (!ruta) return 'interna';
  if (ruta === '/sign-in/email-otp') return 'codigo_correo';
  if (ruta.startsWith('/callback')) return 'cuenta_institucional';
  if (ruta.startsWith('/two-factor/')) return 'segundo_factor';
  return 'otra';
}

/**
 * Límite deslizante en memoria por clave (Fase 12): p. ej. códigos por correo en 10 minutos.
 * Con varias réplicas de la API cada una lleva su cuenta (el límite efectivo se multiplica):
 * con una sola instancia, que es el despliegue preparado, es exacto.
 */
export class LimitePorClave {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly maximo: number, private readonly ventanaMs: number, private readonly ahora: () => number = Date.now) {}
  permitir(clave: string): boolean {
    const k = clave.trim().toLowerCase();
    const t = this.ahora();
    const recientes = (this.marcas.get(k) ?? []).filter((x) => t - x < this.ventanaMs);
    if (recientes.length >= this.maximo) { this.marcas.set(k, recientes); return false; }
    recientes.push(t); this.marcas.set(k, recientes);
    if (this.marcas.size > 10_000) for (const [c, v] of this.marcas) if (!v.some((x) => t - x < this.ventanaMs)) this.marcas.delete(c);
    return true;
  }
}
