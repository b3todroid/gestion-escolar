/**
 * Configuración del servidor, leída SÓLO de variables de entorno y validada con Zod.
 * Los secretos nunca tienen valor por omisión ni se escriben en el código ni en el cliente.
 */
import { z } from 'zod';

export const MODOS = ['desarrollo', 'pruebas', 'produccion'] as const;
export type Modo = (typeof MODOS)[number];

const esquema = z.object({
  MODO: z.enum(MODOS).default('desarrollo'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL debe ser una cadena de conexión de PostgreSQL.'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET debe tener al menos 32 caracteres aleatorios.'),
  /** Origen público de la aplicación (la PWA y la API se sirven en el mismo origen). */
  URL_PUBLICA: z.url().default('http://localhost:5173'),
  PUERTO: z.coerce.number().int().min(1).max(65535).default(8787),
  /** 'buzon' = buzón en memoria sólo para desarrollo y pruebas (los mensajes no salen del servidor). */
  CORREO_MODO: z.enum(['buzon', 'smtp']).default('buzon'),
  /** Horas de validez de una invitación. */
  INVITACION_HORAS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  /** Duración de la sesión en horas (también es el periodo de gracia sin conexión). */
  SESION_HORAS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  /** Inicio de sesión con cuentas institucionales (opcional). */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** Dominio de Google Workspace sugerido al elegir cuenta (p. ej. escuela.edu.mx). El acceso lo decide la invitación. */
  GOOGLE_DOMINIO: z.string().min(3).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  /** Inquilino (tenant) institucional de Microsoft 365. Nunca 'common' ni 'consumers'. */
  MICROSOFT_TENANT_ID: z.string().min(3).optional(),
  /** Proveedor OIDC de PRUEBA (sólo MODO=pruebas): permite probar el flujo SSO completo sin servicios externos. */
  OIDC_PRUEBA_URL: z.url().optional(),
  /** Límite de solicitudes del inicio de sesión (por ventana de 60 s y dirección). */
  LIMITE_CODIGOS_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(3),
  /** Límite de intentos de código (correo o segundo factor) por ventana de 60 s y dirección. */
  LIMITE_INTENTOS_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(10),
});

export type Configuracion = z.infer<typeof esquema> & {
  proveedores: ('google' | 'microsoft' | 'oidc-prueba')[];
};

export function leerConfiguracion(entorno: Record<string, string | undefined> = process.env): Configuracion {
  const r = esquema.safeParse(entorno);
  if (!r.success) {
    // Sólo nombres de variables, nunca sus valores.
    const campos = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración del servidor inválida:\n  ${campos}`);
  }
  const c = r.data;
  if (c.MODO === 'produccion') {
    if (c.CORREO_MODO === 'buzon') throw new Error('En producción el correo no puede usar el buzón de desarrollo: configura CORREO_MODO=smtp.');
    if (c.CORREO_MODO === 'smtp') throw new Error('El envío por SMTP se configurará en el despliegue (pendiente de autorización); el servidor no se ejecuta en producción todavía.');
    if (!c.URL_PUBLICA.startsWith('https://')) throw new Error('En producción URL_PUBLICA debe usar https.');
    if (c.OIDC_PRUEBA_URL) throw new Error('OIDC_PRUEBA_URL sólo se permite en MODO=pruebas.');
  }
  if (c.OIDC_PRUEBA_URL && c.MODO !== 'pruebas') throw new Error('OIDC_PRUEBA_URL sólo se permite en MODO=pruebas.');
  const proveedores: Configuracion['proveedores'] = [];
  if (c.GOOGLE_CLIENT_ID || c.GOOGLE_CLIENT_SECRET) {
    if (!c.GOOGLE_CLIENT_ID || !c.GOOGLE_CLIENT_SECRET) throw new Error('Google requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.');
    proveedores.push('google');
  }
  if (c.MICROSOFT_CLIENT_ID || c.MICROSOFT_CLIENT_SECRET) {
    if (!c.MICROSOFT_CLIENT_ID || !c.MICROSOFT_CLIENT_SECRET || !c.MICROSOFT_TENANT_ID) throw new Error('Microsoft requiere MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET y MICROSOFT_TENANT_ID.');
    if (['common', 'consumers', 'organizations'].includes(c.MICROSOFT_TENANT_ID)) throw new Error('MICROSOFT_TENANT_ID debe ser el inquilino institucional, no un inquilino compartido.');
    proveedores.push('microsoft');
  }
  if (c.OIDC_PRUEBA_URL) proveedores.push('oidc-prueba');
  return { ...c, proveedores };
}
