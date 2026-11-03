/**
 * Entorno de pruebas del servidor: una base PostgreSQL NUEVA por archivo de pruebas
 * (se crea y se borra al terminar), el servidor HTTP real en un puerto libre y un
 * «navegador» simulado con sus propias cookies. Sólo datos ficticios.
 * Requiere PRUEBAS_POSTGRES_URL (usuario con permiso CREATEDB), p. ej.
 *   postgres://gestion_dev:solo-desarrollo-local@localhost:5432/postgres
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { crearAuth, type Auth } from '../src/auth.ts';
import { leerConfiguracion, type Configuracion } from '../src/config.ts';
import { BuzonDesarrollo } from '../src/correo.ts';
import { crearServidorHttp } from '../src/http.ts';
import { migrar } from '../src/migrar.ts';
import { altaEscuela } from '../src/operador.ts';

export const URL_APP = 'http://localhost:5173';

export interface Entorno {
  cfg: Configuracion;
  bd: pg.Pool;
  auth: Auth;
  buzon: BuzonDesarrollo;
  base: string;
  navegador(): Navegador;
  cerrar(): Promise<void>;
}

export function urlAdministrativa(): string {
  const u = process.env.PRUEBAS_POSTGRES_URL;
  if (!u) throw new Error('Configura PRUEBAS_POSTGRES_URL (PostgreSQL local con permiso CREATEDB) para ejecutar las pruebas del servidor. Ver docs/SERVIDOR.md.');
  return u;
}

export async function crearBasePrueba(): Promise<{ url: string; borrar(): Promise<void> }> {
  const admin = urlAdministrativa();
  const nombre = `gestion_prueba_${randomBytes(6).toString('hex')}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`CREATE DATABASE ${nombre}`);
  await c.end();
  const url = new URL(admin); url.pathname = `/${nombre}`;
  return {
    url: url.toString(),
    async borrar() {
      const c2 = new pg.Client({ connectionString: admin });
      await c2.connect();
      await c2.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      await c2.end();
    },
  };
}

export async function crearEntorno(extra: Record<string, string> = {}, puerto = 0): Promise<Entorno> {
  const base = await crearBasePrueba();
  const cfg = leerConfiguracion({
    MODO: 'pruebas', DATABASE_URL: base.url, BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    URL_PUBLICA: URL_APP, LIMITE_CODIGOS_POR_MINUTO: '500', LIMITE_INTENTOS_POR_MINUTO: '500', ...extra,
  });
  const bd = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 5 });
  await migrar(bd);
  const buzon = new BuzonDesarrollo();
  const auth = crearAuth(cfg, bd, buzon);
  const { servidor, cerrar } = crearServidorHttp(cfg, bd, auth, buzon);
  await new Promise<void>((ok) => servidor.listen(puerto, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return {
    cfg, bd, auth, buzon, base: url,
    navegador: () => new Navegador(url),
    async cerrar() { await cerrar(); await bd.end(); await base.borrar(); },
  };
}

/** Cliente HTTP con cookies propias (como un navegador en un dispositivo). */
export class Navegador {
  readonly cookies = new Map<string, string>();
  private readonly base: string;
  constructor(base: string) { this.base = base; }

  async pedir(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, opciones: { origen?: string | null; redirigir?: boolean } = {}): Promise<{ estado: number; cuerpo: any; cabeceras: Headers }> {
    const cabeceras: Record<string, string> = {};
    if (this.cookies.size) cabeceras.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const origen = opciones.origen === undefined ? URL_APP : opciones.origen;
    if (metodo === 'POST' && origen) cabeceras.origin = origen;
    if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
    const r = await fetch(new URL(ruta, this.base), { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), redirect: 'manual' });
    this.guardarCookies(r.headers);
    const texto = await r.text();
    let json: unknown = texto;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* no es JSON */ }
    return { estado: r.status, cuerpo: json, cabeceras: r.headers };
  }

  guardarCookies(h: Headers): void {
    for (const c of h.getSetCookie()) {
      const [par, ...attrs] = c.split(';');
      const i = par!.indexOf('=');
      const k = par!.slice(0, i).trim(); const v = par!.slice(i + 1).trim();
      const expirada = attrs.some((a) => /max-age=0/i.test(a.trim())) || v === '';
      if (expirada) this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }

  get = (ruta: string) => this.pedir('GET', ruta);
  post = (ruta: string, cuerpo: unknown = {}, opciones?: { origen?: string | null }) => this.pedir('POST', ruta, cuerpo, opciones);
}

/** Inicia sesión con código al correo (flujo completo: pedir código → leerlo del buzón → entrar). */
export async function entrarConCodigo(e: Entorno, n: Navegador, correo: string): Promise<{ estado: number; cuerpo: any }> {
  e.buzon.vaciar();
  const envio = await n.post('/api/auth/email-otp/send-verification-otp', { email: correo, type: 'sign-in' });
  if (envio.estado !== 200) return envio;
  const codigo = e.buzon.ultimoCodigo(correo);
  if (!codigo) return { estado: 0, cuerpo: 'sin código' };
  return n.post('/api/auth/sign-in/email-otp', { email: correo, otp: codigo });
}

let contadorCct = 0;
/** Alta de escuela ficticia con su administrador invitado (como lo haría el operador). */
export async function escuelaFicticia(e: Entorno, adminCorreo: string, tipoCorreo: 'institucional' | 'personal' = 'institucional') {
  contadorCct++;
  return altaEscuela(e.bd, e.cfg, {
    nombre: `Escuela Ficticia ${contadorCct}`, cct: `32ZZZ${String(1000 + contadorCct).slice(-4)}${'ABCDEFGHJK'[contadorCct % 10]}`, nivel: 'secundaria', entidad: '32',
    municipio: 'Municipio Ejemplo', adminCorreo, adminNombre: 'Persona Administradora Ficticia', tipoCorreo, consentimiento: tipoCorreo === 'personal',
  });
}

// ---- TOTP (RFC 6238) independiente de la biblioteca, como lo haría una app de autenticación ----
function base32(texto: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const ch of texto.replace(/=+$/, '').toUpperCase()) bits += alfabeto.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function secretoDeUri(uri: string): string {
  return new URL(uri).searchParams.get('secret')!;
}
export function codigoTotp(secretoBase32: string, momento = Date.now(), periodo = 30, digitos = 6): string {
  const contador = Math.floor(momento / 1000 / periodo);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', base32(secretoBase32)).update(buf).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

/** Activa la verificación en dos pasos para la sesión del navegador y devuelve el secreto y los códigos de respaldo. */
export async function activarSegundoFactor(n: Navegador): Promise<{ secreto: string; respaldo: string[] }> {
  const r = await n.post('/api/auth/two-factor/enable', {});
  if (r.estado !== 200) throw new Error(`enable ${r.estado} ${JSON.stringify(r.cuerpo)}`);
  const secreto = secretoDeUri(r.cuerpo.totpURI);
  const v = await n.post('/api/auth/two-factor/verify-totp', { code: codigoTotp(secreto) });
  if (v.estado !== 200) throw new Error(`verify ${v.estado} ${JSON.stringify(v.cuerpo)}`);
  return { secreto, respaldo: r.cuerpo.backupCodes };
}
