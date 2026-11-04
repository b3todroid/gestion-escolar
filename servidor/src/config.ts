/**
 * Configuración del servidor, leída SÓLO de variables de entorno y validada con Zod.
 * Los secretos nunca tienen valor por omisión ni se escriben en el código ni en el cliente.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const MODOS = ['desarrollo', 'pruebas', 'preproduccion', 'produccion'] as const;
/** Modos con las exigencias de producción (HTTPS, SMTP real, cookies seguras, sin buzón de desarrollo). Fase 11. */
export const MODOS_ESTRICTOS: readonly Modo[] = ['preproduccion', 'produccion'];
export type Modo = (typeof MODOS)[number];

const esquema = z.object({
  MODO: z.enum(MODOS).default('desarrollo'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL debe ser una cadena de conexión de PostgreSQL.'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET debe tener al menos 32 caracteres aleatorios.'),
  /** Origen público de la aplicación (la PWA y la API se sirven en el mismo origen). */
  URL_PUBLICA: z.url().default('http://localhost:5173'),
  PUERTO: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Dirección de escucha. 127.0.0.1 por omisión; 0.0.0.0 sólo dentro de una red privada de contenedores. */
  HOST: z.string().min(2).default('127.0.0.1'),
  /**
   * Intermediarios de confianza (proxy inverso), separados por comas: IP o red IPv4/IPv6 en notación CIDR.
   * Sólo si la conexión viene de uno de ellos se toma la IP del cliente de X-Forwarded-For (Fase 11).
   */
  PROXIES_CONFIABLES: z.string().default(''),
  /** 'buzon' = buzón en memoria sólo para desarrollo y pruebas (los mensajes no salen del servidor). */
  CORREO_MODO: z.enum(['buzon', 'smtp']).default('buzon'),
  /** SMTP (Fase 11). La contraseña sólo por variable de entorno o secreto del contenedor; nunca en el repositorio. */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PUERTO: z.coerce.number().int().min(1).max(65535).default(587),
  /** 'tls' (puerto 465), 'starttls' (587, obligatorio cifrar) o 'ninguna' (SÓLO preproducción con un buzón de prueba local). */
  SMTP_SEGURIDAD: z.enum(['tls', 'starttls', 'ninguna']).default('starttls'),
  SMTP_USUARIO: z.string().min(1).optional(),
  SMTP_CLAVE: z.string().min(1).optional(),
  /** Remitente visible, p. ej. «Gestión Escolar <no-responder@escuela.edu.mx>». */
  SMTP_REMITENTE: z.string().min(3).optional(),
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
  /** Zona horaria de las escuelas (fecha y hora del servidor para pases de lista, salidas, etc.). */
  ZONA_HORARIA: z.string().min(3).default('America/Mexico_City'),
  /**
   * Límite de solicitudes de código por ventana de 60 s y dirección IP. Fase 12: 30 por omisión, porque
   * todo el personal de una escuela suele salir a internet por la MISMA IP pública (NAT).
   */
  LIMITE_CODIGOS_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(30),
  /** Límite de intentos de código (correo o segundo factor) por ventana de 60 s y dirección IP. */
  LIMITE_INTENTOS_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(60),
  /** Fase 12: códigos por correo en 10 minutos (frena el abuso sin depender de la IP compartida). */
  LIMITE_CODIGOS_POR_CORREO: z.coerce.number().int().min(1).max(100).default(3),
});

export type Configuracion = z.infer<typeof esquema> & {
  proveedores: ('google' | 'microsoft' | 'oidc-prueba')[];
};

/** Variables que pueden venir de un archivo (secretos de Docker/Kubernetes): `NOMBRE_FILE=/run/secrets/…`. */
export const SECRETOS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'SMTP_CLAVE', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_SECRET'] as const;

/** Fase 11: completa los secretos leídos de archivo. Nunca se registra su contenido. */
export function conSecretosDeArchivo(entorno: Record<string, string | undefined>, leer: (ruta: string) => string = (r) => readFileSync(r, 'utf8')): Record<string, string | undefined> {
  const salida = { ...entorno };
  for (const n of SECRETOS) {
    const ruta = entorno[`${n}_FILE`];
    if (!ruta) continue;
    if (entorno[n]) throw new Error(`Define ${n} o ${n}_FILE, no ambos.`);
    let valor: string;
    try { valor = leer(ruta).trim(); } catch { throw new Error(`No se pudo leer el secreto ${n}_FILE.`); }
    if (!valor) throw new Error(`El secreto ${n}_FILE está vacío.`);
    salida[n] = valor;
  }
  return salida;
}

export function leerConfiguracion(entornoCrudo: Record<string, string | undefined> = process.env): Configuracion {
  // Una variable vacía (p. ej. `SMTP_USUARIO=` en un archivo de entorno) cuenta como no definida.
  const entorno = conSecretosDeArchivo(Object.fromEntries(Object.entries(entornoCrudo).filter(([, v]) => v !== '')));
  const r = esquema.safeParse(entorno);
  if (!r.success) {
    // Sólo nombres de variables, nunca sus valores.
    const campos = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración del servidor inválida:\n  ${campos}`);
  }
  const c = r.data;
  if (c.CORREO_MODO === 'smtp' && (!c.SMTP_HOST || !c.SMTP_REMITENTE)) throw new Error('CORREO_MODO=smtp requiere SMTP_HOST y SMTP_REMITENTE.');
  if ((c.SMTP_USUARIO && !c.SMTP_CLAVE) || (!c.SMTP_USUARIO && c.SMTP_CLAVE)) throw new Error('SMTP_USUARIO y SMTP_CLAVE van juntos.');
  if (MODOS_ESTRICTOS.includes(c.MODO)) {
    const nombre = c.MODO === 'produccion' ? 'producción' : 'preproducción';
    if (c.CORREO_MODO === 'buzon') throw new Error(`En ${nombre} el correo no puede usar el buzón de desarrollo: configura CORREO_MODO=smtp.`);
    if (!c.URL_PUBLICA.startsWith('https://')) throw new Error(`En ${nombre} URL_PUBLICA debe usar https.`);
    if (c.OIDC_PRUEBA_URL) throw new Error('OIDC_PRUEBA_URL sólo se permite en MODO=pruebas.');
  }
  if (c.MODO === 'produccion') {
    if (c.SMTP_SEGURIDAD === 'ninguna') throw new Error('En producción el SMTP debe ir cifrado (SMTP_SEGURIDAD=tls o starttls).');
    // Entornos separados: producción nunca apunta a una base de desarrollo, pruebas, piloto o demostración.
    let base = '';
    try { base = decodeURIComponent(new URL(c.DATABASE_URL).pathname.replace(/^\//, '')); } catch { /* validado arriba */ }
    if (/(dev|prueba|test|piloto|demo|preprod)/i.test(base)) throw new Error(`En producción DATABASE_URL no puede apuntar a una base de desarrollo, pruebas, piloto o demostración («${base}»).`);
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
