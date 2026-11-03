/**
 * Fuentes de importación de horarios — PREPARACIÓN para PDF (Fase 3).
 *
 * Hoy sólo existen lectores de .xlsx y .csv (tabla.ts). Un lector de PDF (y,
 * más adelante, OCR) deberá implementar `ExtractorTabla` y entregar celdas con
 * su grado de certeza. NO se instala ninguna biblioteca de PDF en esta fase.
 *
 * Regla: lo ambiguo no se adivina. Una celda marcada como ambigua (o con
 * confianza menor al umbral) se entrega VACÍA y con un aviso: la fila acabará
 * como ERROR en el análisis y la persona decidirá cómo corregirla.
 */

export type FormatoFuente = 'xlsx' | 'csv' | 'pdf';

export interface CeldaExtraida {
  texto: string;
  /** 0–1 para extracciones con incertidumbre (PDF/OCR); null cuando el formato es exacto (xlsx/csv). */
  confianza: number | null;
  /** El extractor no pudo decidir (p. ej. texto que cruza dos celdas, celdas combinadas). */
  ambigua: boolean;
  motivo?: string;
}

export interface TablaExtraida {
  formato: FormatoFuente;
  /** Página (PDF) u hoja (Excel) de origen. */
  origen: string;
  /** Filas con su número real en el documento (para mostrarlo a la persona). */
  filas: { numero: number; celdas: CeldaExtraida[] }[];
}

/** Contrato que deberá cumplir un futuro lector de PDF. */
export interface ExtractorTabla {
  formato: FormatoFuente;
  /** Páginas u hojas disponibles. */
  secciones(archivo: ArrayBuffer): Promise<string[]>;
  extraer(archivo: ArrayBuffer, seccion: string): Promise<TablaExtraida>;
}

export const UMBRAL_CONFIANZA = 0.9;

export interface AvisoExtraccion { fila: number; columna: number; mensaje: string }

/**
 * Convierte una tabla extraída en la tabla de texto que usa el análisis de
 * importación. Las celdas ambiguas o poco confiables quedan vacías (nunca se
 * completan con una suposición) y se informan como avisos.
 */
export function aTablaSegura(t: TablaExtraida, umbral = UMBRAL_CONFIANZA): { filas: string[][]; avisos: AvisoExtraccion[] } {
  const avisos: AvisoExtraccion[] = [];
  const filas: string[][] = [];
  for (const f of t.filas) {
    while (filas.length < f.numero - 1) filas.push([]); // conserva la numeración real
    filas.push(f.celdas.map((c, i) => {
      if (c.ambigua || (c.confianza !== null && c.confianza < umbral)) {
        avisos.push({ fila: f.numero, columna: i + 1, mensaje: c.motivo ?? (c.ambigua ? 'Texto ambiguo: revísalo en el documento original.' : `Lectura poco confiable («${c.texto}»).`) });
        return '';
      }
      return c.texto;
    }));
  }
  return { filas, avisos };
}

/** Extractores disponibles. PDF todavía no: se informa claramente en la interfaz. */
export const EXTRACTORES_DISPONIBLES: readonly FormatoFuente[] = ['xlsx', 'csv'];
