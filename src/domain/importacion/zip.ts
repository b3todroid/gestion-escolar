/**
 * Lector mínimo de archivos ZIP (los .xlsx son ZIP con XML), sin dependencias.
 * Usa DecompressionStream nativo del navegador. Límites contra archivos
 * maliciosos (bombas de descompresión): tamaño por entrada y total.
 */
export const LIMITE_ARCHIVO = 5 * 1024 * 1024; // 5 MB comprimido
export const LIMITE_DESCOMPRIMIDO = 20 * 1024 * 1024; // 20 MB en total

export class ErrorArchivo extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'ErrorArchivo'; }
}

interface Entrada { nombre: string; metodo: number; comprimido: number; original: number; desplazamiento: number }

function indice(buf: Uint8Array): Map<string, Entrada> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin del directorio central (firma 0x06054b50), buscando desde el final.
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new ErrorArchivo('El archivo no es un libro de Excel válido (.xlsx).');
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const entradas = new Map<string, Entrada>();
  const dec = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw new ErrorArchivo('El archivo de Excel está dañado.');
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const original = v.getUint32(p + 24, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const desplazamiento = v.getUint32(p + 42, true);
    const nombre = dec.decode(buf.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { nombre, metodo, comprimido, original, desplazamiento });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function inflar(datos: Uint8Array, limite: number): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const lector = flujo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > limite) { await lector.cancel(); throw new ErrorArchivo('El archivo es demasiado grande para importarse.'); }
    partes.push(value);
  }
  const r = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { r.set(p, o); o += p.length; }
  return r;
}

/** Devuelve el contenido (texto) de las entradas pedidas que existan. */
export async function leerZip(archivo: ArrayBuffer, nombres: (lista: string[]) => string[]): Promise<Map<string, string>> {
  if (archivo.byteLength > LIMITE_ARCHIVO) throw new ErrorArchivo('El archivo supera 5 MB. Divide el horario en varios archivos.');
  const buf = new Uint8Array(archivo);
  const entradas = indice(buf);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const r = new Map<string, string>();
  let usado = 0;
  for (const nombre of nombres([...entradas.keys()])) {
    const e = entradas.get(nombre);
    if (!e) continue;
    if (v.getUint32(e.desplazamiento, true) !== 0x04034b50) throw new ErrorArchivo('El archivo de Excel está dañado.');
    const inicio = e.desplazamiento + 30 + v.getUint16(e.desplazamiento + 26, true) + v.getUint16(e.desplazamiento + 28, true);
    const datos = buf.subarray(inicio, inicio + e.comprimido);
    let contenido: Uint8Array;
    if (e.metodo === 0) contenido = datos;
    else if (e.metodo === 8) contenido = await inflar(datos, LIMITE_DESCOMPRIMIDO - usado);
    else throw new ErrorArchivo('El archivo usa una compresión no compatible. Guárdalo de nuevo como .xlsx.');
    usado += contenido.length;
    if (usado > LIMITE_DESCOMPRIMIDO) throw new ErrorArchivo('El archivo es demasiado grande para importarse.');
    r.set(nombre, new TextDecoder().decode(contenido));
  }
  return r;
}
