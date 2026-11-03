/**
 * Lectura de la PRIMERA hoja de un .xlsx o de un .csv como tabla de textos.
 * El XML se recorre con expresiones acotadas (no se ejecuta nada ni se
 * resuelven entidades externas); funciona igual en el navegador y en pruebas.
 */
import { ErrorArchivo, leerZip } from './zip';

export const LIMITE_FILAS = 3000;

function desescapar(t: string): string {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, x: string) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Texto de un nodo con <t> (posiblemente varios, texto enriquecido). */
function textoDe(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1] ?? '')).join('');
}

function columna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

/** Una hora guardada por Excel como fracción del día (0.2916… = 07:00). */
function numeroATexto(v: string, estilo: boolean): string {
  const n = Number(v);
  if (estilo && Number.isFinite(n) && n > 0 && n < 1) {
    const min = Math.round(n * 1440);
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  return Number.isInteger(n) ? String(n) : v;
}

export async function leerXlsx(archivo: ArrayBuffer): Promise<string[][]> {
  const partes = await leerZip(archivo, () => ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);
  const libro = partes.get('xl/workbook.xml');
  if (!libro) throw new ErrorArchivo('El archivo no es un libro de Excel válido (.xlsx).');
  const primera = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro) ?? /<sheet\b[^>]*\bid="([^"]+)"/.exec(libro);
  const rels = partes.get('xl/_rels/workbook.xml.rels') ?? '';
  const destino = primera ? new RegExp(`<Relationship\\b[^>]*Id="${primera[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${primera[1]}"`).exec(rels)?.[1] : undefined;
  const rutaHoja = destino ? (destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const hoja = (await leerZip(archivo, () => [rutaHoja])).get(rutaHoja);
  if (!hoja) throw new ErrorArchivo('No se encontró la primera hoja del libro.');

  const compartidas = [...(partes.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1] ?? ''));
  const filas: string[][] = [];
  for (const f of hoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (filas.length >= LIMITE_FILAS) throw new ErrorArchivo(`El archivo tiene más de ${LIMITE_FILAS} filas.`);
    const fila: string[] = [];
    for (const c of (f[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const conEstilo = /\bs="[1-9]\d*"/.test(attrs);
      const cuerpo = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor = '';
      if (tipo === 's') valor = compartidas[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (tipo === 'str' || tipo === 'b') valor = desescapar(v ?? '');
      else if (v !== undefined) valor = numeroATexto(v, conEstilo);
      const i = ref ? columna(ref) : fila.length;
      while (fila.length < i) fila.push('');
      fila[i] = valor.trim();
    }
    filas.push(fila);
  }
  return filas;
}

/** CSV con separador «,» o «;» (Excel en español usa ambos), comillas y BOM. */
export function leerCsv(textoCsv: string): string[][] {
  const t = textoCsv.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo.trim()); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo.trim()); filas.push(fila); fila = []; campo = '';
      if (filas.length > LIMITE_FILAS) throw new ErrorArchivo(`El archivo tiene más de ${LIMITE_FILAS} filas.`);
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo.trim()); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c !== ''));
}

export async function leerTabla(nombre: string, contenido: ArrayBuffer): Promise<string[][]> {
  if (/\.xlsx$/i.test(nombre)) return leerXlsx(contenido);
  if (/\.csv$/i.test(nombre)) return leerCsv(new TextDecoder().decode(contenido));
  if (/\.xls$/i.test(nombre)) throw new ErrorArchivo('El formato .xls (Excel 97-2003) no es compatible. Ábrelo en Excel y guárdalo como .xlsx.');
  throw new ErrorArchivo('Selecciona un archivo .xlsx o .csv.');
}
