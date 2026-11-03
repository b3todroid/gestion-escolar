/**
 * Compresión gzip de respaldos grandes (Fase 9), con la API estándar CompressionStream
 * (navegadores actuales y Node 18+). Sin dependencias. El resultado se guarda en un sobre JSON
 * con los bytes en base64, para que el archivo siga siendo texto y se lea igual que antes.
 */
import { ErrorDominio } from '../domain/errores';

export const FORMATO_COMPRIMIDO = 'gestion-escolar-respaldo-comprimido';

interface SobreComprimido { formato: typeof FORMATO_COMPRIMIDO; versionFormato: 1; compresion: 'gzip'; datos: string }

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(t: string): Uint8Array<ArrayBuffer> {
  const s = atob(t);
  const b = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

async function leerTodo(flujo: ReadableStream<Uint8Array>, limite: number): Promise<Uint8Array> {
  const partes: Uint8Array[] = []; let total = 0;
  const lector = flujo.getReader();
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > limite) { await lector.cancel(); throw new ErrorDominio('VALIDACION', 'El respaldo descomprimido es demasiado grande para este dispositivo.'); }
    partes.push(value);
  }
  const salida = new Uint8Array(total); let i = 0;
  for (const p of partes) { salida.set(p, i); i += p.length; }
  return salida;
}

export async function comprimir(texto: string): Promise<string> {
  const flujo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  const sobre: SobreComprimido = { formato: FORMATO_COMPRIMIDO, versionFormato: 1, compresion: 'gzip', datos: aBase64(await leerTodo(flujo, Number.MAX_SAFE_INTEGER)) };
  return JSON.stringify(sobre);
}

/** ¿Es un respaldo comprimido? Sólo mira el inicio (no analiza archivos enormes). */
export function esComprimido(contenido: string): boolean {
  return contenido.slice(0, 120).includes(`"formato":"${FORMATO_COMPRIMIDO}"`);
}

export async function descomprimir(contenido: string, limiteBytes: number): Promise<string> {
  let s: SobreComprimido;
  try { s = JSON.parse(contenido) as SobreComprimido; } catch { throw new ErrorDominio('VALIDACION', 'El archivo no es un respaldo válido (no se pudo leer).'); }
  if (s.formato !== FORMATO_COMPRIMIDO || s.versionFormato !== 1 || s.compresion !== 'gzip' || typeof s.datos !== 'string') throw new ErrorDominio('VALIDACION', 'Formato de respaldo comprimido no compatible.');
  try {
    const bytes = await leerTodo(new Blob([deBase64(s.datos)]).stream().pipeThrough(new DecompressionStream('gzip')), limiteBytes);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    if (e instanceof ErrorDominio) throw e;
    throw new ErrorDominio('VALIDACION', 'El respaldo comprimido está dañado.');
  }
}
