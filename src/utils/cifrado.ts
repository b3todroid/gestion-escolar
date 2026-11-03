/**
 * Cifrado autenticado de respaldos con contraseña (Web Crypto, sin dependencias).
 * - Clave: PBKDF2-SHA-256, 600 000 iteraciones, sal aleatoria de 16 bytes.
 * - Cifrado: AES-GCM 256 bits, IV aleatorio de 12 bytes (la etiqueta de 128 bits
 *   detecta cualquier modificación del archivo).
 * La contraseña nunca se guarda. Requiere contexto seguro (HTTPS o localhost).
 * Estas operaciones son asíncronas y ajenas a IndexedDB: NUNCA llamarlas dentro
 * de `uow.ejecutar` (cerraría la transacción antes de tiempo).
 */
import { ErrorDominio } from '../domain/errores';

export const FORMATO_CIFRADO = 'gestion-escolar-respaldo-cifrado';
export const ITERACIONES_PBKDF2 = 600_000;
export const LONGITUD_MINIMA_CONTRASENA = 10;
// Límites al leer un archivo: evitan que un archivo manipulado fuerce trabajo excesivo o inseguro.
const ITERACIONES_MIN = 100_000;
const ITERACIONES_MAX = 5_000_000;

export interface SobreCifrado {
  formato: typeof FORMATO_CIFRADO;
  versionFormato: 1;
  creadoEn: string;
  kdf: { algoritmo: 'PBKDF2'; hash: 'SHA-256'; iteraciones: number; sal: string };
  cifrado: { algoritmo: 'AES-GCM'; iv: string };
  datos: string; // base64
}

function sutil(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Este navegador no permite cifrar en esta dirección. Abre la aplicación desde HTTPS o localhost.');
  return s;
}

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(t: string): Uint8Array<ArrayBuffer> {
  const s = atob(t);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function validarContrasena(contrasena: string, confirmacion?: string): void {
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
    const m = `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`;
    throw new ErrorDominio('VALIDACION', m, [{ campo: 'contrasena', mensaje: m }]);
  }
  if (confirmacion !== undefined && confirmacion !== contrasena) {
    const m = 'Las contraseñas no coinciden.';
    throw new ErrorDominio('VALIDACION', m, [{ campo: 'confirmacion', mensaje: m }]);
  }
}

async function derivarClave(contrasena: string, sal: Uint8Array<ArrayBuffer>, iteraciones: number): Promise<CryptoKey> {
  const base = await sutil().importKey('raw', new TextEncoder().encode(contrasena), 'PBKDF2', false, ['deriveKey']);
  return sutil().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function cifrar(texto: string, contrasena: string, creadoEn: string, iteraciones = ITERACIONES_PBKDF2): Promise<string> {
  validarContrasena(contrasena);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clave = await derivarClave(contrasena, sal, iteraciones);
  const cifrado = new Uint8Array(await sutil().encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(texto)));
  const sobre: SobreCifrado = {
    formato: FORMATO_CIFRADO, versionFormato: 1, creadoEn,
    kdf: { algoritmo: 'PBKDF2', hash: 'SHA-256', iteraciones, sal: aBase64(sal) },
    cifrado: { algoritmo: 'AES-GCM', iv: aBase64(iv) },
    datos: aBase64(cifrado),
  };
  return JSON.stringify(sobre);
}

/** ¿El contenido es un respaldo cifrado? (no lanza) */
export function esCifrado(contenido: string): boolean {
  // Sólo el inicio: un respaldo grande no se analiza dos veces (el sobre siempre empieza con «formato»).
  const inicio = contenido.slice(0, 120).replace(/\s/g, '');
  if (inicio.startsWith(`{"formato":"${FORMATO_CIFRADO}"`)) return true;
  if (contenido.length > 1_000_000) return false;
  try { return (JSON.parse(contenido) as { formato?: unknown }).formato === FORMATO_CIFRADO; } catch { return false; }
}

export async function descifrar(contenido: string, contrasena: string): Promise<string> {
  let s: SobreCifrado;
  try { s = JSON.parse(contenido) as SobreCifrado; } catch { throw new ErrorDominio('VALIDACION', 'El archivo no es un respaldo válido (no se pudo leer).'); }
  const valido = s && s.formato === FORMATO_CIFRADO && s.versionFormato === 1 && s.kdf?.algoritmo === 'PBKDF2' && s.kdf.hash === 'SHA-256'
    && Number.isInteger(s.kdf.iteraciones) && s.cifrado?.algoritmo === 'AES-GCM' && typeof s.kdf.sal === 'string' && typeof s.cifrado.iv === 'string' && typeof s.datos === 'string';
  if (!valido) throw new ErrorDominio('VALIDACION', 'Formato de respaldo cifrado no compatible.');
  if (s.kdf.iteraciones < ITERACIONES_MIN || s.kdf.iteraciones > ITERACIONES_MAX) throw new ErrorDominio('VALIDACION', 'Parámetros de cifrado no admitidos.');
  let sal: Uint8Array<ArrayBuffer>; let iv: Uint8Array<ArrayBuffer>; let datos: Uint8Array<ArrayBuffer>;
  try { sal = deBase64(s.kdf.sal); iv = deBase64(s.cifrado.iv); datos = deBase64(s.datos); } catch { throw new ErrorDominio('VALIDACION', 'El archivo cifrado está dañado.'); }
  if (sal.length !== 16 || iv.length !== 12) throw new ErrorDominio('VALIDACION', 'El archivo cifrado está dañado.');
  if (!contrasena) throw new ErrorDominio('VALIDACION', 'Escribe la contraseña del respaldo.', [{ campo: 'contrasena', mensaje: 'Escribe la contraseña del respaldo.' }]);
  const clave = await derivarClave(contrasena, sal, s.kdf.iteraciones);
  try {
    return new TextDecoder().decode(await sutil().decrypt({ name: 'AES-GCM', iv }, clave, datos));
  } catch {
    // AES-GCM no distingue (a propósito) entre contraseña incorrecta y archivo alterado.
    const m = 'Contraseña incorrecta o archivo dañado. No se modificó nada.';
    throw new ErrorDominio('VALIDACION', m, [{ campo: 'contrasena', mensaje: m }]);
  }
}
