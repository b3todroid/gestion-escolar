/**
 * Reconocimiento óptico de caracteres (OCR) LOCAL con Tesseract.js (Apache-2.0).
 * El motor (WebAssembly) y el idioma español se sirven desde la propia
 * aplicación (`ocr/`): ningún documento ni imagen sale del dispositivo.
 * Se usa sólo cuando una página no tiene texto digital y la persona lo pide.
 */
import { palabrasAFragmentos, type Fragmento, type PalabraReconocida } from '../domain/importacion/documento';
import type { Cancelacion } from './pdf';

export const LIMITE_PAGINAS_OCR = 10;

export class OcrCancelado extends Error { constructor() { super('Reconocimiento cancelado.'); this.name = 'OcrCancelado'; } }

/** Reconoce el texto de un lienzo; `alProgresar` recibe 0–1. Cancelable. */
export async function reconocer(imagen: HTMLCanvasElement, alProgresar: (p: number, etapa: string) => void, senal: Cancelacion): Promise<{ fragmentos: Fragmento[]; descartadas: number }> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const base = new URL('ocr/', document.baseURI).href;
  const worker = await createWorker('spa', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base, // nunca el CDN predeterminado
    langPath: `${base}lang`,
    workerBlobURL: false,
    cacheMethod: 'none', // el idioma lo guarda el Service Worker, no IndexedDB
    logger: (m: { status: string; progress: number }) => alProgresar(m.progress, m.status),
  });
  const vigilante = window.setInterval(() => { if (senal.cancelado) void worker.terminate(); }, 200);
  try {
    if (senal.cancelado) throw new OcrCancelado();
    // Texto disperso: el modo adecuado para tablas (encuentra encabezados y celdas separadas).
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const r = await worker.recognize(imagen, {}, { blocks: true });
    if (senal.cancelado) throw new OcrCancelado();
    const palabras: PalabraReconocida[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) palabras.push(...(l.words as PalabraReconocida[]));
    return palabrasAFragmentos(palabras);
  } catch (e) {
    if (senal.cancelado) throw new OcrCancelado();
    throw e;
  } finally {
    window.clearInterval(vigilante);
    if (!senal.cancelado) await worker.terminate().catch(() => undefined);
  }
}
