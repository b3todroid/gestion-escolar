/**
 * Cliente HTTP del servidor escolar (Fase 8B). Mismo origen que la aplicación (/api),
 * con la sesión en una cookie HttpOnly que JavaScript no puede leer.
 * No contiene secretos ni configuración del servidor. No envía datos escolares:
 * sólo correo, códigos de acceso y datos de cuentas.
 */
import { ErrorDominio } from '../domain/errores';

export interface ClienteServidor {
  pedir<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T>;
}

/** Errores de Better Auth y del servidor, en español. */
const MENSAJES: Record<string, string> = {
  INVALID_OTP: 'El código no es correcto o ya caducó. Pide uno nuevo si es necesario.',
  OTP_EXPIRED: 'El código caducó. Pide uno nuevo.',
  TOO_MANY_ATTEMPTS: 'Demasiados intentos con ese código. Pide uno nuevo.',
  INVALID_CODE: 'El código no es correcto. Revisa la hora de tu teléfono y vuelve a intentarlo.',
  INVALID_BACKUP_CODE: 'El código de respaldo no es válido o ya se usó.',
  INVALID_TWO_FACTOR_COOKIE: 'La verificación caducó. Vuelve a iniciar sesión.',
  TOTP_NOT_ENABLED: 'La verificación en dos pasos no está activa.',
  ACCOUNT_LOCKED: 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.',
  INVALID_EMAIL: 'Escribe un correo válido.',
};

/** Códigos que el servidor escolar agrega a Better Auth con mensaje ya en español. */
const CODIGOS_PROPIOS = new Set(['SIN_ACCESO', 'SEGUNDO_FACTOR_PENDIENTE', 'SEGUNDO_FACTOR_OBLIGATORIO']);

export class ErrorServidor extends ErrorDominio {
  readonly estado: number;
  readonly codigoServidor: string;
  constructor(estado: number, codigoServidor: string, mensaje: string, campos: { campo: string; mensaje: string }[] = []) {
    super(estado === 0 ? 'SIN_SERVIDOR' : 'SERVIDOR', mensaje, campos);
    this.estado = estado;
    this.codigoServidor = codigoServidor;
  }
}

export class ClienteServidorHttp implements ClienteServidor {
  private readonly base: string;
  private readonly espera: number;
  constructor(base = '', espera = 15_000) {
    this.base = base;
    this.espera = espera;
  }

  async pedir<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), this.espera);
    let r: Response;
    try {
      r = await fetch(`${this.base}${ruta}`, {
        method: metodo,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: metodo === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
        signal: control.signal,
      });
    } catch {
      throw new ErrorServidor(0, 'SIN_CONEXION', 'No hay conexión con el servidor escolar. La aplicación sigue funcionando con los datos de este dispositivo.');
    } finally {
      clearTimeout(temporizador);
    }
    const tipo = r.headers.get('content-type') ?? '';
    // Sin servidor configurado, el servidor de archivos responde la página (HTML) o un error del intermediario.
    if (!tipo.includes('application/json')) {
      if (r.ok || r.status >= 500 || r.status === 404) throw new ErrorServidor(0, 'SIN_SERVIDOR', 'No hay un servidor escolar disponible en esta dirección. La aplicación funciona en modo local.');
    }
    const datos: unknown = tipo.includes('application/json') ? await r.json().catch(() => null) : null;
    if (r.ok) return datos as T;
    const d = (datos ?? {}) as { codigo?: string; code?: string; mensaje?: string; message?: string; campos?: Record<string, string> };
    const codigo = d.codigo ?? d.code ?? (r.status === 429 ? 'LIMITE' : `HTTP_${r.status}`);
    const mensaje = r.status === 429
      ? 'Demasiados intentos en poco tiempo. Espera un minuto y vuelve a intentarlo.'
      : MENSAJES[codigo] ?? d.mensaje ?? (CODIGOS_PROPIOS.has(codigo) ? d.message : undefined) ?? (r.status >= 500 ? 'El servidor escolar tuvo un problema. Intenta de nuevo más tarde.' : 'El servidor escolar no aceptó la solicitud.');
    const campos = Object.entries(d.campos ?? {}).map(([campo, m]) => ({ campo, mensaje: m }));
    throw new ErrorServidor(r.status, codigo, mensaje, campos);
  }
}
