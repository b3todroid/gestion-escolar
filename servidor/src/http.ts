/**
 * Servidor HTTP (node:http, sin marcos de trabajo). Atiende /api/auth/* con Better Auth
 * y /api/* con la API propia. Reglas comunes:
 * - Cuerpo JSON de hasta 64 KB; respuestas con Cache-Control: no-store.
 * - Peticiones que modifican (POST) exigen el Origin de la aplicación (protección CSRF).
 * - La dirección del cliente la escribe el servidor (no se confía en cabeceras externas).
 * - Las respuestas de autenticación nunca devuelven el token de sesión en el cuerpo:
 *   la sesión viaja sólo en una cookie HttpOnly.
 * - Los errores inesperados se registran sin datos personales.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Pool } from 'pg';
import { ApiEscolar } from './api.ts';
import { ErrorApi } from './errores.ts';
import { CABECERA_IP, RUTA_AUTH, type Auth } from './auth.ts';
import { MODOS_ESTRICTOS, type Configuracion } from './config.ts';
import { ipDelCliente, listaConfiable } from './ipCliente.ts';
import type { BuzonDesarrollo, EnviadorCorreo } from './correo.ts';

const LIMITE_CUERPO = 64 * 1024;
/** Los lotes de sincronización pueden traer registros completos (p. ej. adjuntos del banco de actividades ≤ 1 MB). */
const LIMITE_SINCRONIZACION = 4 * 1024 * 1024;
/** Una migración trae la escuela completa de una sola vez. */
const LIMITE_MIGRACION = 40 * 1024 * 1024;

export interface ServidorEscolar { servidor: Server; cerrar(): Promise<void> }

function leerCuerpo(req: IncomingMessage, limite = LIMITE_CUERPO): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const demasiado = () => new ErrorApi(413, 'DEMASIADO_GRANDE', 'La petición es demasiado grande.');
    if (Number(req.headers['content-length'] ?? 0) > limite) { req.resume(); rechazar(demasiado()); return; }
    const partes: Buffer[] = []; let total = 0; let excedido = false;
    req.on('data', (c: Buffer) => {
      if (excedido) return; // se descarta el resto sin guardarlo
      total += c.length;
      if (total > limite) { excedido = true; partes.length = 0; rechazar(demasiado()); return; }
      partes.push(c);
    });
    req.on('end', () => resolver(Buffer.concat(partes)));
    req.on('error', rechazar);
  });
}

/** Quita recursivamente los campos «token» de una respuesta JSON de autenticación. */
export function sinTokens(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(sinTokens);
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) if (k !== 'token') salida[k] = sinTokens(v);
    return salida;
  }
  return valor;
}

function enviarJson(res: ServerResponse, estado: number, cuerpo: unknown): void {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(cuerpo));
}

export function crearServidorHttp(cfg: Configuracion, bd: Pool, auth: Auth, correo: EnviadorCorreo, registrar: (mensaje: string) => void = () => {}): ServidorEscolar {
  const api = new ApiEscolar(cfg, bd, auth, correo);
  const origen = new URL(cfg.URL_PUBLICA).origin;
  const proxies = listaConfiable(cfg.PROXIES_CONFIABLES);
  const buzon = !MODOS_ESTRICTOS.includes(cfg.MODO) && cfg.CORREO_MODO === 'buzon' ? (correo as BuzonDesarrollo) : null;

  const servidor = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url ?? '/', origen);
      if (!url.pathname.startsWith('/api/')) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Ruta no disponible.');
      const metodo = req.method ?? 'GET';
      if (!['GET', 'POST'].includes(metodo)) throw new ErrorApi(405, 'METODO', 'Método no permitido.');
      const cabeceras = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || k === CABECERA_IP) continue;
        for (const x of Array.isArray(v) ? v : [v]) cabeceras.append(k, x);
      }
      const ip = req.socket.remoteAddress ?? '';
      const ipCliente = ipDelCliente(ip, req.headers['x-forwarded-for'], proxies);
      if (isIP(ipCliente)) cabeceras.set(CABECERA_IP, ipCliente);

      // Buzón de desarrollo: sólo fuera de producción y desde el propio equipo.
      if (url.pathname === '/api/desarrollo/buzon' && metodo === 'GET') {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
        if (!buzon || !local) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Ruta no disponible.');
        enviarJson(res, 200, buzon.de(url.searchParams.get('correo') ?? ''));
        return;
      }

      const cuerpoCrudo = metodo === 'POST' ? await leerCuerpo(req, url.pathname.endsWith('/sincronizacion') ? LIMITE_SINCRONIZACION : /\/migracion(\/ensayo)?$/.test(url.pathname) ? LIMITE_MIGRACION : LIMITE_CUERPO) : Buffer.alloc(0);
      if (metodo === 'POST') {
        const o = req.headers.origin;
        if (o !== origen) throw new ErrorApi(403, 'ORIGEN', 'Origen no permitido.');
        if (cuerpoCrudo.length && !(req.headers['content-type'] ?? '').startsWith('application/json')) throw new ErrorApi(415, 'TIPO', 'Se espera JSON.');
      }

      if (url.pathname === RUTA_AUTH || url.pathname.startsWith(`${RUTA_AUTH}/`)) {
        const peticion = new Request(url, { method: metodo, headers: cabeceras, ...(metodo === 'POST' ? { body: new Uint8Array(cuerpoCrudo) } : {}) });
        const r = await auth.handler(peticion);
        res.statusCode = r.status;
        for (const [k, v] of r.headers) if (k !== 'set-cookie' && k !== 'content-length') res.setHeader(k, v);
        const cookies = r.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        const texto = await r.text();
        if ((r.headers.get('content-type') ?? '').includes('application/json') && texto) {
          res.end(JSON.stringify(sinTokens(JSON.parse(texto))));
        } else {
          res.end(texto);
        }
        return;
      }

      let cuerpo: unknown = undefined;
      if (cuerpoCrudo.length) {
        try { cuerpo = JSON.parse(cuerpoCrudo.toString('utf8')); } catch { throw new ErrorApi(400, 'JSON', 'El cuerpo no es JSON válido.'); }
      }
      const r = await api.atender({ metodo, ruta: url.pathname, consulta: url.searchParams, cabeceras, cuerpo });
      enviarJson(res, r.estado, r.cuerpo);
    } catch (e) {
      if (e instanceof ErrorApi) {
        if (e.estado === 413) res.setHeader('Connection', 'close');
        enviarJson(res, e.estado, { codigo: e.codigo, mensaje: e.message, campos: e.campos });
        return;
      }
      // Sin datos personales: sólo el tipo de error.
      registrar(`Error inesperado en ${req.method} ${(req.url ?? '').split('?')[0]}: ${(e as Error).name}`);
      enviarJson(res, 500, { codigo: 'INTERNO', mensaje: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
    }
  });

  return {
    servidor,
    cerrar: () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  };
}
