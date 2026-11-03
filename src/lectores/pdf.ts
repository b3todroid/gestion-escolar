/**
 * Lectura de PDF con PDF.js (Mozilla, Apache-2.0), cargado bajo demanda.
 * Sólo se extrae texto con posición; no se ejecuta JavaScript del documento
 * (`isEvalSupported: false`, sin scripting) y no se descarga nada externo.
 * Se procesa página por página para no bloquear la interfaz y poder cancelar.
 */
import { ErrorArchivo } from '../domain/importacion/zip';
import type { Fragmento } from '../domain/importacion/documento';

export const LIMITE_PDF_BYTES = 20 * 1024 * 1024;
export const LIMITE_PAGINAS = 40;

/** Subconjunto de la API de PDF.js que se usa (permite usar la versión «legacy» en pruebas). */
export interface LibreriaPdf {
  getDocument(p: Record<string, unknown>): { promise: Promise<DocumentoPdfJs>; destroy(): Promise<void> };
}
interface DocumentoPdfJs { numPages: number; getPage(n: number): Promise<PaginaPdfJs> }
interface PaginaPdfJs {
  getViewport(p: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }>;
  render(p: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}

export interface Cancelacion { cancelado: boolean }

export interface PaginaLeida { numero: number; ancho: number; alto: number; fragmentos: Fragmento[]; tieneTexto: boolean }

export interface DocumentoPdf {
  paginas: number;
  leerPagina(n: number): Promise<PaginaLeida>;
  /** Dibuja la página en un lienzo (para OCR). Escala limitada para cuidar la memoria. */
  dibujar(n: number, anchoMaximo?: number): Promise<HTMLCanvasElement>;
  cerrar(): Promise<void>;
}

let cargada: Promise<LibreriaPdf> | null = null;
/** Carga diferida de PDF.js y su worker (mismo origen; sin CDN). */
export function cargarPdfJs(): Promise<LibreriaPdf> {
  cargada ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib as unknown as LibreriaPdf;
  })();
  return cargada;
}

export async function abrirPdf(datos: ArrayBuffer, lib?: LibreriaPdf): Promise<DocumentoPdf> {
  if (datos.byteLength > LIMITE_PDF_BYTES) throw new ErrorArchivo(`El PDF supera ${LIMITE_PDF_BYTES / 1024 / 1024} MB. Divídelo o expórtalo de nuevo.`);
  const cab = new Uint8Array(datos.slice(0, 1024));
  if (!new TextDecoder('latin1').decode(cab).includes('%PDF-')) throw new ErrorArchivo('El archivo no es un PDF.');
  const pdfjs = lib ?? await cargarPdfJs();
  const tarea = pdfjs.getDocument({
    data: new Uint8Array(datos.slice(0)), isEvalSupported: false, enableScripting: false, disableFontFace: true,
    useSystemFonts: false, stopAtErrors: false, verbosity: 0,
  });
  let doc: DocumentoPdfJs;
  try { doc = await tarea.promise; } catch (e) {
    void tarea.destroy().catch(() => undefined);
    const nombre = (e as { name?: string }).name;
    if (nombre === 'PasswordException') throw new ErrorArchivo('El PDF está protegido con contraseña; no se puede leer. Quita la protección y vuelve a intentarlo.');
    throw new ErrorArchivo('El PDF está dañado o incompleto; no se pudo abrir.');
  }
  if (doc.numPages > LIMITE_PAGINAS) { await tarea.destroy(); throw new ErrorArchivo(`El PDF tiene ${doc.numPages} páginas; el máximo es ${LIMITE_PAGINAS}. Divide el documento.`); }
  return {
    paginas: doc.numPages,
    async leerPagina(n) {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1 });
      let contenido;
      try { contenido = await p.getTextContent(); } catch { throw new ErrorArchivo(`No se pudo leer el texto de la página ${n}; puede estar dañada.`); }
      const fragmentos: Fragmento[] = [];
      for (const it of contenido.items) {
        const texto = it.str ?? '';
        if (!texto.trim() || !it.transform) continue;
        const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number];
        const alto = it.height || Math.hypot(c, d) || Math.hypot(a, b);
        // PDF: y crece hacia arriba desde la línea base; aquí y = borde superior, creciendo hacia abajo.
        fragmentos.push({ texto, x: e, y: vp.height - f - alto, ancho: it.width ?? 0, alto, confianza: null });
      }
      p.cleanup();
      return { numero: n, ancho: vp.width, alto: vp.height, fragmentos, tieneTexto: fragmentos.length > 0 };
    },
    async dibujar(n, anchoMaximo = 2400) {
      const p = await doc.getPage(n);
      const base = p.getViewport({ scale: 1 });
      const escala = Math.min(3, anchoMaximo / base.width);
      const vp = p.getViewport({ scale: escala });
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.floor(vp.width); lienzo.height = Math.floor(vp.height);
      const ctx = lienzo.getContext('2d');
      if (!ctx) throw new ErrorArchivo('Este navegador no puede dibujar la página para el reconocimiento de texto.');
      await p.render({ canvasContext: ctx, viewport: vp, canvas: lienzo }).promise;
      p.cleanup();
      return lienzo;
    },
    cerrar: () => tarea.destroy(),
  };
}
