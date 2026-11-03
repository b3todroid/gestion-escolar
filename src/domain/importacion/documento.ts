/**
 * Reconstrucción de tablas a partir de fragmentos de texto con posición
 * (PDF digital vía PDF.js u OCR vía Tesseract) y conversión de horarios a filas
 * canónicas: GRUPO + DÍA + PERIODO + MATERIA + DOCENTE.
 *
 * Reglas:
 * - No se asume que el documento tenga una tabla perfecta: si no se reconoce,
 *   se informa y la persona corrige.
 * - Lo ambiguo NO se adivina: se marca para revisión y nunca se convierte en
 *   registro por sí solo.
 * - Una celda vacía no es hora de servicio (SE) ni tiempo libre: se ignora.
 * Funciones puras; sin acceso a datos ni al DOM.
 */
import { normalizarTexto } from '../texto';
import type { CeldaExtraida } from './fuentes';

/** Fragmento de texto con su caja. `y` crece hacia ABAJO (como en la pantalla). */
export interface Fragmento {
  texto: string;
  x: number; y: number; ancho: number; alto: number;
  /** 0–1 en OCR; null en PDF digital (texto exacto). */
  confianza: number | null;
}

export interface TablaDocumento {
  /** Renglones de texto antes de la tabla (títulos): sirven para identificar grupo o docente. */
  titulo: string[];
  encabezados: string[] | null;
  filas: CeldaExtraida[][];
  /** Avisos de la reconstrucción (p. ej. no se encontró una fila de encabezados). */
  avisos: string[];
}

export type EstructuraHorario = 'lista' | 'sabana_grupo' | 'sabana_docente';

export const ETIQUETA_ESTRUCTURA: Record<EstructuraHorario, string> = {
  lista: 'Tabla con una fila por clase (columnas Grupo, Día, Periodo, Materia, Docente…)',
  sabana_grupo: 'Horario de un grupo (días en columnas; cada celda: materia y docente)',
  sabana_docente: 'Horario de un docente (días en columnas; cada celda: grupo y materia)',
};

const DIAS: [string, number][] = [['lunes', 1], ['martes', 2], ['miercoles', 3], ['jueves', 4], ['viernes', 5], ['sabado', 6], ['domingo', 7],
  ['lun', 1], ['mar', 2], ['mie', 3], ['jue', 4], ['vie', 5], ['sab', 6], ['dom', 7]];
const NOMBRE_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const PALABRAS_ENCABEZADO = ['hora', 'horario', 'periodo', 'modulo', 'grupo', 'gpo', 'dia', 'materia', 'asignatura', 'docente', 'profesor', 'maestro', 'grado', 'turno', 'inicio', 'sesion'];
const SIN_CLASE = /^(receso|recreo|descanso|comida|almuerzo|honores)$/;

const n = (t: string) => normalizarTexto(t).replace(/[.:]/g, '').trim();
export function diaDeTexto(t: string): number | null {
  const v = n(t);
  return DIAS.find(([d]) => d === v)?.[1] ?? null;
}
const esEncabezado = (t: string) => diaDeTexto(t) !== null || PALABRAS_ENCABEZADO.includes(n(t));

const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };

interface Segmento { texto: string; x: number; fin: number; y: number; alto: number; confianza: number | null }

/** Renglones: fragmentos con el mismo centro vertical; dentro del renglón, los cercanos se unen. */
function renglones(frag: Fragmento[]): Segmento[][] {
  const f = frag.filter((x) => x.texto.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const alto = mediana(f.map((x) => x.alto)) || 10;
  const lineas: Fragmento[][] = [];
  for (const x of f) {
    const centro = x.y + x.alto / 2;
    const l = lineas.find((li) => Math.abs(li[0]!.y + li[0]!.alto / 2 - centro) < alto * 0.5);
    if (l) l.push(x); else lineas.push([x]);
  }
  return lineas.sort((a, b) => a[0]!.y - b[0]!.y).map((l) => {
    const orden = l.sort((a, b) => a.x - b.x);
    const segs: Segmento[] = [];
    for (const x of orden) {
      const ultimo = segs.at(-1);
      // Separación pequeña (≈ un espacio) = misma celda; grande = otra columna.
      if (ultimo && x.x - ultimo.fin < alto * 0.9) {
        ultimo.texto += (x.x - ultimo.fin > alto * 0.15 ? ' ' : '') + x.texto.trim();
        ultimo.fin = Math.max(ultimo.fin, x.x + x.ancho);
        ultimo.confianza = ultimo.confianza === null || x.confianza === null ? (ultimo.confianza ?? x.confianza) : Math.min(ultimo.confianza, x.confianza);
      } else segs.push({ texto: x.texto.trim(), x: x.x, fin: x.x + x.ancho, y: x.y, alto: x.alto, confianza: x.confianza });
    }
    return segs;
  });
}

/**
 * Reconstruye la tabla: el renglón con más encabezados reconocibles (días,
 * «Hora», «Grupo», «Materia»…) define las columnas; los renglones de
 * continuación (sin texto en la primera columna y muy cercanos) se unen a la
 * fila anterior como segunda línea de la celda.
 */
export function reconstruirTabla(frag: Fragmento[]): TablaDocumento {
  const lineas = renglones(frag);
  const avisos: string[] = [];
  if (!lineas.length) return { titulo: [], encabezados: null, filas: [], avisos: ['El documento no tiene texto en esta página.'] };
  const alto = mediana(lineas.flat().map((s) => s.alto)) || 10;

  let iEnc = -1; let mejor = 1;
  lineas.forEach((l, i) => { const p = l.filter((s) => esEncabezado(s.texto)).length; if (p > mejor && l.length >= 2) { mejor = p; iEnc = i; } });

  let limites: number[]; // inicio de cada columna
  let encabezados: string[] | null = null;
  if (iEnc >= 0) {
    const enc = lineas[iEnc]!;
    encabezados = enc.map((s) => s.texto);
    // Frontera entre columnas: punto medio entre el fin de un encabezado y el inicio del siguiente
    // (funciona con encabezados alineados a la izquierda o centrados).
    limites = enc.map((s, i) => (i === 0 ? -Infinity : (enc[i - 1]!.fin + s.x) / 2));
  } else {
    avisos.push('No se encontró una fila de encabezados reconocible; las columnas se dedujeron por posición. Revisa la tabla.');
    // Agrupa los inicios de texto que se repiten en varios renglones.
    const inicios = lineas.flatMap((l) => l.map((s) => s.x)).sort((a, b) => a - b);
    const grupos: number[][] = [];
    for (const x of inicios) { const g = grupos.at(-1); if (g && x - g.at(-1)! < alto * 1.5) g.push(x); else grupos.push([x]); }
    const frecuentes = grupos.filter((g) => g.length >= Math.max(2, lineas.length * 0.3)).map((g) => Math.min(...g));
    limites = (frecuentes.length ? frecuentes : grupos.map((g) => Math.min(...g))).map((x, i) => (i === 0 ? -Infinity : x - alto * 0.5));
  }
  const columna = (s: Segmento) => { let c = 0; limites.forEach((l, i) => { if (s.x >= l) c = i; }); return c; };

  const titulo = (iEnc >= 0 ? lineas.slice(0, iEnc) : []).map((l) => l.map((s) => s.texto).join(' '));
  const cuerpo = iEnc >= 0 ? lineas.slice(iEnc + 1) : lineas;
  const filas: CeldaExtraida[][] = [];
  let yAnterior = -Infinity;
  for (const l of cuerpo) {
    const celdas: (Segmento[])[] = limites.map(() => []);
    for (const s of l) celdas[columna(s)]!.push(s);
    const y = l[0]!.y;
    const continuacion = filas.length > 0 && celdas[0]!.length === 0 && y - yAnterior < alto * 1.6;
    if (continuacion) {
      const f = filas.at(-1)!;
      celdas.forEach((c, i) => {
        if (!c.length) return;
        const t = c.map((s) => s.texto).join(' ');
        const conf = minConf(c);
        f[i] = { ...f[i]!, texto: f[i]!.texto ? `${f[i]!.texto}\n${t}` : t, confianza: combinar(f[i]!.confianza, conf) };
      });
    } else {
      filas.push(celdas.map((c) => ({ texto: c.map((s) => s.texto).join(' '), confianza: minConf(c), ambigua: false })));
    }
    yAnterior = y;
  }
  return { titulo, encabezados, filas, avisos };
}
function minConf(c: Segmento[]): number | null { const v = c.map((s) => s.confianza).filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; }
function combinar(a: number | null, b: number | null) { return a === null ? b : b === null ? a : Math.min(a, b); }

// ---------------------------------------------------------------------------
// Estructura

export interface EstructuraDetectada {
  estructura: EstructuraHorario;
  /** Grupo («1° A») o docente leído del título, si se encontró. */
  grupo: string | null;
  docente: string | null;
  /** Columnas que son días (índice de columna → día 1–7). */
  dias: Map<number, number>;
  motivo: string;
}

const RE_GRUPO = /^(\d{1,2})\s*[°ºo]?\s*-?\s*([A-Za-zÑñ]{1,2})\b/;

export function detectarEstructura(t: TablaDocumento): EstructuraDetectada {
  const dias = new Map<number, number>();
  (t.encabezados ?? []).forEach((e, i) => { const d = diaDeTexto(e); if (d) dias.set(i, d); });
  const titulo = t.titulo.join(' ');
  const mg = /grupo\s*:?\s*(\d{1,2}\s*[°º]?\s*[A-Za-zÑñ]{1,2})\b/i.exec(titulo);
  const md = /(?:docente|profesor|profesora|maestro|maestra)\s*:\s*([^·|,\n]+?)(?:\s*[·|,]|$)/i.exec(titulo);
  const grupo = mg ? mg[1]!.replace(/\s+/g, ' ').trim() : null;
  const docente = md ? md[1]!.trim() : null;
  if (dias.size < 2) return { estructura: 'lista', grupo, docente, dias, motivo: 'Los días no están en columnas: se trata como una fila por clase.' };
  if (docente && !grupo) return { estructura: 'sabana_docente', grupo, docente, dias, motivo: `El título indica el docente «${docente}».` };
  if (grupo && !docente) return { estructura: 'sabana_grupo', grupo, docente, dias, motivo: `El título indica el grupo «${grupo}».` };
  // Sin título claro: si la mayoría de las celdas empiezan con un grupo («1° A …»), es horario de docente.
  const celdas = t.filas.flatMap((f) => [...dias.keys()].map((i) => f[i]?.texto ?? '')).filter((x) => x.trim());
  const conGrupo = celdas.filter((x) => RE_GRUPO.test(x.trim())).length;
  return conGrupo > celdas.length / 2
    ? { estructura: 'sabana_docente', grupo, docente, dias, motivo: 'Las celdas comienzan con un grupo («1° A …»).' }
    : { estructura: 'sabana_grupo', grupo, docente, dias, motivo: 'Las celdas contienen materias; indica el grupo si no aparece en el título.' };
}

// ---------------------------------------------------------------------------
// Conversión a filas canónicas

export const ENCABEZADOS_CANONICOS = ['Grupo', 'Día', 'Periodo', 'Materia', 'Docente', 'Celda de origen'];

export interface CeldaPorRevisar { fila: number; columna: number; texto: string; motivo: string }

export interface ResultadoConversion {
  /** Primera fila = ENCABEZADOS_CANONICOS. */
  tabla: string[][];
  porRevisar: CeldaPorRevisar[];
  ignoradas: { vacias: number; recesos: number; servicio: number };
}

export interface Catalogo { materias: string[]; docentes: string[]; grupos: string[] }

/** Separa el texto de una celda en dos partes sin adivinar. */
export function separarCelda(texto: string, primeros: string[], tipoPrimero: 'materia' | 'grupo'): { a: string; b: string } | { motivo: string } {
  const t = texto.trim();
  if (tipoPrimero === 'grupo') {
    const m = RE_GRUPO.exec(t);
    if (!m) return { motivo: 'No se reconoce el grupo al inicio de la celda.' };
    const resto = t.slice(m[0].length).replace(/^[\s\-–/|,:]+/, '').replace(/\n/g, ' ').trim();
    if (!resto) return { motivo: 'Falta la materia.' };
    return { a: `${m[1]}° ${m[2]!.toUpperCase()}`, b: resto };
  }
  // materia + docente: renglones, luego separadores explícitos, luego catálogo.
  const lineas = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (lineas.length === 2) return { a: lineas[0]!, b: lineas[1]! };
  if (lineas.length > 2) return { motivo: 'La celda tiene más de dos renglones.' };
  const sep = /\s+[-–/|]\s+/.exec(t);
  if (sep) return { a: t.slice(0, sep.index).trim(), b: t.slice(sep.index + sep[0].length).trim() };
  // Sin separador: sólo si exactamente una materia del catálogo coincide al inicio.
  const nt = normalizarTexto(t);
  const coincide = primeros.filter((m) => { const nm = normalizarTexto(m); return nt === nm || nt.startsWith(`${nm} `); });
  const contenidas = primeros.filter((m) => nt.includes(normalizarTexto(m)));
  if (contenidas.length > 1) return { motivo: `La celda menciona varias materias (${contenidas.join(', ')}).` };
  if (coincide.length === 1) return { a: coincide[0]!, b: t.slice(coincide[0]!.length).trim() };
  return { motivo: 'No se puede distinguir la materia del docente.' };
}

/**
 * Convierte una sábana (días en columnas) en filas canónicas. `contexto` es el
 * grupo (sábana por grupo) o el docente (sábana por docente), elegido o
 * confirmado por la persona. Celdas vacías y recesos se ignoran.
 */
export function convertirSabana(t: TablaDocumento, e: EstructuraDetectada, contexto: string, cat: Catalogo): ResultadoConversion {
  const tabla: string[][] = [ENCABEZADOS_CANONICOS];
  const porRevisar: CeldaPorRevisar[] = [];
  const ignoradas = { vacias: 0, recesos: 0, servicio: 0 };
  const colPeriodo = [...Array((t.encabezados ?? []).length).keys()].find((i) => !e.dias.has(i)) ?? 0;
  t.filas.forEach((f, iFila) => {
    const periodo = (f[colPeriodo]?.texto ?? '').replace(/\n/g, ' ').trim();
    for (const [col, dia] of e.dias) {
      const celda = f[col];
      const texto = (celda?.texto ?? '').trim();
      const origen = `${NOMBRE_DIA[dia]} · ${periodo || `fila ${iFila + 1}`}`;
      if (!texto) { ignoradas.vacias++; continue; }
      if (SIN_CLASE.test(n(texto))) { ignoradas.recesos++; continue; }
      if (/^(se|servicio|horas? de servicio)$/.test(n(texto))) { ignoradas.servicio++; continue; } // SE no se importa desde documentos
      if (celda?.ambigua) { porRevisar.push({ fila: iFila, columna: col, texto, motivo: 'Lectura incierta: revisa el texto.' }); tabla.push([e.estructura === 'sabana_grupo' ? contexto : '', NOMBRE_DIA[dia]!, periodo, '', e.estructura === 'sabana_docente' ? contexto : '', `${origen}: «${texto}» (incierta)`]); continue; }
      const r = separarCelda(texto, e.estructura === 'sabana_grupo' ? cat.materias : cat.grupos, e.estructura === 'sabana_grupo' ? 'materia' : 'grupo');
      if ('motivo' in r) {
        porRevisar.push({ fila: iFila, columna: col, texto, motivo: r.motivo });
        // Fila incompleta a propósito: el análisis la marca como ERROR hasta que se corrija.
        tabla.push([e.estructura === 'sabana_grupo' ? contexto : '', NOMBRE_DIA[dia]!, periodo, '', e.estructura === 'sabana_docente' ? contexto : '', `${origen}: «${texto.replace(/\n/g, ' / ')}» (${r.motivo})`]);
        continue;
      }
      tabla.push(e.estructura === 'sabana_grupo'
        ? [contexto, NOMBRE_DIA[dia]!, periodo, r.a, r.b, `${origen}: «${texto.replace(/\n/g, ' / ')}»`]
        : [r.a, NOMBRE_DIA[dia]!, periodo, r.b, contexto, `${origen}: «${texto.replace(/\n/g, ' / ')}»`]);
    }
  });
  return { tabla, porRevisar, ignoradas };
}

/** Lista (una fila por clase): encabezados del documento + filas; las celdas inciertas quedan vacías. */
export function convertirLista(t: TablaDocumento): ResultadoConversion {
  const porRevisar: CeldaPorRevisar[] = [];
  const filas = t.filas.map((f, i) => f.map((c, j) => {
    if (c.ambigua) { porRevisar.push({ fila: i, columna: j, texto: c.texto, motivo: 'Lectura incierta: revisa el texto.' }); return ''; }
    return c.texto.replace(/\n/g, ' ');
  }));
  return { tabla: [t.encabezados ?? (t.filas[0] ?? []).map((_, i) => `Columna ${i + 1}`), ...filas], porRevisar, ignoradas: { vacias: 0, recesos: 0, servicio: 0 } };
}

/** Marca como inciertas (ambiguas) las celdas con confianza OCR menor al umbral. */
export function marcarInciertas(t: TablaDocumento, umbral: number): TablaDocumento {
  return { ...t, filas: t.filas.map((f) => f.map((c) => (c.confianza !== null && c.confianza < umbral && c.texto.trim() ? { ...c, ambigua: true, motivo: `Confianza ${Math.round(c.confianza * 100)} %` } : c))) };
}

// ---------------------------------------------------------------------------
// OCR → fragmentos

export interface PalabraReconocida { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** Por debajo de esta confianza (0–1) lo reconocido suele ser un trazo de la tabla, no texto: se descarta. */
export const CONFIANZA_RUIDO = 0.2;

/** Palabras de Tesseract → fragmentos (confianza 0–1). Descarta el ruido y lo informa. */
export function palabrasAFragmentos(palabras: PalabraReconocida[]): { fragmentos: Fragmento[]; descartadas: number } {
  let descartadas = 0;
  const fragmentos: Fragmento[] = [];
  for (const w of palabras) {
    const conf = Math.max(0, Math.min(1, w.confidence / 100));
    const texto = w.text.trim();
    const alfanum = (texto.match(/[\p{L}\p{N}]/gu) ?? []).length;
    // Trazos de la tabla, manchas o letras sueltas con baja confianza: no son datos.
    if (!texto || conf < CONFIANZA_RUIDO || alfanum === 0 || (alfanum <= 2 && conf < 0.6)) { descartadas++; continue; }
    fragmentos.push({ texto, x: w.bbox.x0, y: w.bbox.y0, ancho: w.bbox.x1 - w.bbox.x0, alto: w.bbox.y1 - w.bbox.y0, confianza: conf });
  }
  return { fragmentos, descartadas };
}
