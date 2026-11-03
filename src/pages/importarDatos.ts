import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { confirmar } from '../components/dialogo';
import { hojasXlsx, leerTabla } from '../domain/importacion/tabla';
import { ErrorArchivo } from '../domain/importacion/zip';
import { CAMPOS, TIPOS_IMPORTACION, detectarEncabezado, problemasMapeo, sugerirMapeo, type Mapeo, type TipoImportacion } from '../domain/importacion/mapeo';
import { esErrorDominio } from '../domain/errores';
import type { Analisis, EstadoFila } from '../services/importacion';
import { ETIQUETA_ESTADO_FILA, type AnalisisDatos, type Decision, type EstadoFilaDatos, type FilaAnalizada } from '../services/importacionDatos';
import { navCatalogos } from './catalogos';
import { registrarError } from '../utils/registro';
import { abrirPdf, LIMITE_PAGINAS, type Cancelacion, type DocumentoPdf, type PaginaLeida } from '../lectores/pdf';
import { LIMITE_PAGINAS_OCR, OcrCancelado, reconocer } from '../lectores/ocr';
import {
  ETIQUETA_ESTRUCTURA, convertirLista, convertirSabana, detectarEstructura, marcarInciertas, reconstruirTabla,
  type EstructuraHorario, type Fragmento, type ResultadoConversion, type TablaDocumento,
} from '../domain/importacion/documento';
import { mapeoDesdePlantilla } from '../services/plantillasImportacion';
import type { PlantillaImportacion } from '../models';
import { nombreCompleto } from '../services/personal';
import { normalizarTexto } from '../domain/texto';

const TIPO: Record<TipoImportacion, { titulo: string; descripcion: string }> = {
  alumnos: { titulo: 'Alumnos', descripcion: 'Nombre, apellidos, grado, grupo y turno; opcionales número de lista, matrícula y CURP.' },
  docentes: { titulo: 'Docentes', descripcion: 'Personal con función docente; opcionales identificador, materias que puede impartir y turnos.' },
  personal: { titulo: 'Personal', descripcion: 'Cualquier función (prefectura, dirección, orientación…); opcionales identificador y turnos.' },
  materias: { titulo: 'Materias y actividades', descripcion: 'Nombre y tipo (materia, campo formativo, taller, tutoría, actividad especial o servicio).' },
  grupos: { titulo: 'Grupos', descripcion: 'Grado, grupo, turno y capacidad. Los grados y turnos deben existir.' },
  horarios: { titulo: 'Horarios', descripcion: 'Una fila por clase: grupo, día, periodo (número u hora), materia y docente. No reemplaza clases existentes ni toca horarios confirmados.' },
};

const ESTADO_HORARIO: Record<EstadoFila, [string, 'ok' | 'aviso' | 'neutro', string]> = {
  nueva: ['NUEVA', 'ok', '＋'], existente: ['YA EXISTE (SE OMITE)', 'neutro', '='], error: ['ERROR', 'aviso', '⚠'], conflicto: ['CONFLICTO', 'aviso', '✕'],
};

const VARIANTE: Record<EstadoFilaDatos, ['ok' | 'aviso' | 'neutro', string]> = {
  nuevo: ['ok', '＋'], actualizable: ['ok', '↻'], posible_duplicado: ['aviso', '≈'], conflicto: ['aviso', '✕'], error: ['aviso', '⚠'], omitido: ['neutro', '='],
};

const TEXTO_DECISION: Record<Decision, string> = { crear: 'Crear como nuevo', actualizar: 'Actualizar el existente', omitir: 'Omitir esta fila' };

const ORDEN: EstadoFilaDatos[] = ['error', 'conflicto', 'posible_duplicado', 'actualizable', 'nuevo', 'omitido'];

/** Huella SHA-256 del archivo, calculada FUERA de cualquier transacción. */
async function huellaArchivo(b: ArrayBuffer): Promise<string | null> {
  const sutil = globalThis.crypto?.subtle;
  if (!sutil) return null;
  const d = await sutil.digest('SHA-256', b);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

const letraColumna = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

interface Estado {
  tipo: TipoImportacion | null;
  archivo: { nombre: string; datos: ArrayBuffer; huella: string | null } | null;
  hojas: string[];
  hoja: string | null;
  filas: string[][];
  encabezado: number; // índice (0 = primera fila)
  mapeo: Mapeo;
  analisis: AnalisisDatos | null;
  analisisHorario: Analisis | null;
  decisiones: Record<number, Decision>;
  /** PDF: documento abierto, páginas leídas (texto digital u OCR) y página elegida. */
  pdf: { doc: DocumentoPdf; paginas: (PaginaLeida | null)[]; ocr: Map<number, Fragmento[]>; pagina: number } | null;
  documento: TablaDocumento | null;
  estructura: EstructuraHorario;
  contexto: string;
  conversion: ResultadoConversion | null;
  plantilla: PlantillaImportacion | null;
  umbral: number;
  operacion: Cancelacion | null;
}

export async function paginaImportarDatos(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const historial = await ctx.s.importacionDatos.historial(cicloId);
  const editable = ciclo.estado !== 'cerrado';

  const e: Estado = {
    tipo: null, archivo: null, hojas: [], hoja: null, filas: [], encabezado: 0, mapeo: [], analisis: null, analisisHorario: null, decisiones: {},
    pdf: null, documento: null, estructura: 'lista', contexto: '', conversion: null, plantilla: null, umbral: 0.75, operacion: null,
  };
  // Catálogos para separar celdas de sábanas y elegir grupo o docente (sólo lectura).
  const grados = await ctx.s.grados.listarGrados(cicloId);
  const nombresGrupos = (await ctx.s.grados.listarGrupos(cicloId)).filter((g) => g.activo !== false)
    .map((g) => `${grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre}`).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const nombresDocentes = (await ctx.s.personal.docentes(escuela.id)).map(nombreCompleto).sort((a, b) => a.localeCompare(b, 'es'));
  const nombresMaterias = (await ctx.s.materias.listar(cicloId, { soloActivas: true })).filter((m) => m.tipo !== 'servicio').map((m) => m.nombre);
  const zonaDocumento = h('div', { 'aria-live': 'polite' });

  const zonaArchivo = h('div', {});
  const zonaColumnas = h('div', { 'aria-live': 'polite' });
  const zonaRevision = h('div', { 'aria-live': 'polite' });
  const error = (destino: HTMLElement, mensaje: string) => reemplazar(destino, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', mensaje));

  const reiniciar = (desde: 'tipo' | 'archivo' | 'columnas' | 'documento') => {
    if (desde === 'tipo' || desde === 'archivo') {
      if (e.operacion) e.operacion.cancelado = true;
      void e.pdf?.doc.cerrar().catch(() => undefined);
      e.pdf = null; e.documento = null; e.conversion = null; reemplazar(zonaDocumento);
    }
    if (desde !== 'columnas') { e.mapeo = []; reemplazar(zonaColumnas); }
    e.analisis = null; e.analisisHorario = null; e.decisiones = {};
    reemplazar(zonaRevision);
    if (desde === 'tipo') { e.archivo = null; e.hojas = []; e.hoja = null; e.filas = []; dibujarArchivo(); }
  };

  // ---------- 1. Tipo ----------
  const opcionesTipo = h('div', { class: 'opciones-tipo', role: 'radiogroup', 'aria-labelledby': 'paso-tipo-titulo' },
    ...TIPOS_IMPORTACION.map((t) => h('label', { class: 'opcion-tipo' },
      h('input', { type: 'radio', name: 'tipo-importacion', value: t, onchange: () => { e.tipo = t; e.plantilla = null; reiniciar('tipo'); void dibujarPlantillas(); } }),
      h('span', { class: 'opcion-tipo__texto' }, h('strong', {}, TIPO[t].titulo), h('span', { class: 'opcion-tipo__desc' }, TIPO[t].descripcion)),
    )));

  // ---------- 2. Archivo y hoja ----------
  const entrada = h('input', { type: 'file', id: 'archivo-datos', accept: '.xlsx,.csv,.pdf', class: 'archivo' });
  const zonaHoja = h('div', {});
  const zonaPlantillas = h('div', {});
  async function dibujarPlantillas() {
    if (!e.tipo) { reemplazar(zonaPlantillas); return; }
    const lista = await ctx.s.plantillas.listar(escuela.id, e.tipo);
    if (!lista.length) { reemplazar(zonaPlantillas); return; }
    const sel = h('select', { id: 'plantilla-importacion', onchange: () => {
      e.plantilla = lista.find((x) => x.id === sel.value) ?? null;
      if (e.plantilla) { e.umbral = e.plantilla.umbralConfianza; if (e.plantilla.estructura !== 'automatica') e.estructura = e.plantilla.estructura; }
      if (e.documento) dibujarDocumento(); else if (e.filas.length) { aplicarPlantillaAlMapeo(); dibujarColumnas(); }
    } }, h('option', { value: '' }, 'Ninguna (detección automática)'), ...lista.map((x) => h('option', { value: x.id, selected: x.id === e.plantilla?.id }, x.nombre)));
    reemplazar(zonaPlantillas, h('div', { class: 'campo' }, h('label', { for: 'plantilla-importacion' }, 'Plantilla de reconocimiento (opcional)'), sel,
      h('p', { class: 'ayuda' }, 'Recuerda la estructura y las columnas de documentos de esta escuela. Las columnas se reconocen por su encabezado, no por su posición.')));
  }
  function aplicarPlantillaAlMapeo() {
    if (!e.plantilla || !e.tipo) return;
    const enc = e.filas[e.encabezado] ?? [];
    const dePlantilla = mapeoDesdePlantilla(e.plantilla, enc);
    const sugerido = sugerirMapeo(enc, e.tipo);
    e.mapeo = enc.map((_, i) => dePlantilla[i] ?? (dePlantilla.includes(sugerido[i] ?? '') ? null : sugerido[i] ?? null));
  }
  function dibujarArchivo() {
    entrada.value = '';
    reemplazar(zonaHoja);
    reemplazar(zonaArchivo, e.tipo
      ? h('div', {},
          zonaPlantillas,
          h('div', { class: 'campo' }, h('label', { for: 'archivo-datos' }, `Archivo de ${TIPO[e.tipo].titulo.toLowerCase()} (.xlsx, .csv o .pdf)`), entrada,
            h('p', { class: 'ayuda' }, 'Se lee en este dispositivo; no se envía a ningún servidor. Las macros, fórmulas y programas de los documentos no se ejecutan: sólo se leen los valores y el texto.')),
          h('p', {}, h('a', { class: 'boton boton--secundario boton--chico', href: `./plantilla-${e.tipo}.xlsx`, download: `plantilla-${e.tipo}.xlsx` }, `Descargar plantilla de ${TIPO[e.tipo].titulo.toLowerCase()}`)),
          zonaHoja)
      : vacio('Primero elige qué vas a importar.'));
  }

  const cargarHoja = async () => {
    if (!e.archivo || !e.tipo) return;
    reiniciar('archivo');
    try {
      e.filas = await leerTabla(e.archivo.nombre, e.archivo.datos, e.hoja ?? undefined);
      if (!e.filas.some((f) => f.some((c) => c.trim()))) { error(zonaColumnas, 'La hoja está vacía. Elige otra hoja o revisa el archivo.'); return; }
      e.encabezado = detectarEncabezado(e.filas, e.tipo);
      e.mapeo = sugerirMapeo(e.filas[e.encabezado] ?? [], e.tipo);
      dibujarColumnas();
    } catch (err) { fallo(err, zonaColumnas); }
  };

  const fallo = (err: unknown, destino: HTMLElement) => {
    const conocido = err instanceof ErrorArchivo || esErrorDominio(err);
    if (!conocido) registrarError(err);
    error(destino, conocido ? (err as Error).message : 'No se pudo leer el archivo. Verifica que sea .xlsx o .csv.');
  };

  entrada.addEventListener('change', async () => {
    const f = entrada.files?.[0];
    if (!f || !e.tipo) return;
    reiniciar('archivo');
    reemplazar(zonaHoja, h('p', {}, 'Leyendo el archivo…'));
    try {
      const datos = await f.arrayBuffer();
      e.archivo = { nombre: f.name, datos, huella: await huellaArchivo(datos) };
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { await procesarPdf(datos); return; }
      e.hojas = /\.xlsx$/i.test(f.name) ? (await hojasXlsx(datos)).map((x) => x.nombre) : [];
      e.hoja = e.hojas[0] ?? null;
      reemplazar(zonaHoja);
      if (e.hojas.length > 1) {
        const sel = h('select', { id: 'hoja-datos', onchange: () => { e.hoja = sel.value; void cargarHoja(); } }, ...e.hojas.map((x) => h('option', { value: x }, x)));
        agregar(zonaHoja, h('div', { class: 'campo' }, h('label', { for: 'hoja-datos' }, `Hoja del libro (${e.hojas.length} hojas)`), sel));
      } else if (e.hojas.length === 1) {
        agregar(zonaHoja, h('p', { class: 'ayuda' }, `Hoja: ${e.hojas[0]}`));
      }
      await cargarHoja();
    } catch (err) { e.archivo = null; fallo(err, zonaHoja); }
  });

  // ---------- PDF: páginas, OCR, estructura y corrección ----------
  /** Barra de progreso con botón de cancelar (no bloquea la interfaz). */
  const progreso = (titulo: string, op: Cancelacion) => {
    const barra = h('progress', { max: 1, value: 0, id: 'progreso-documento' });
    const texto = h('span', { class: 'progreso__texto' }, titulo);
    const caja = h('div', { class: 'progreso', role: 'status' }, texto, barra,
      h('button', { type: 'button', class: 'boton boton--secundario boton--chico', id: 'cancelar-proceso', onclick: () => { op.cancelado = true; texto.textContent = 'Cancelando…'; } }, 'Cancelar'));
    return { caja, poner: (v: number, t: string) => { barra.value = Math.max(0, Math.min(1, v)); texto.textContent = t; } };
  };
  const pausa = () => new Promise((r) => window.setTimeout(r, 0));

  async function procesarPdf(datos: ArrayBuffer) {
    const op: Cancelacion = { cancelado: false };
    e.operacion = op;
    const pr = progreso('Abriendo el PDF…', op);
    reemplazar(zonaHoja, pr.caja);
    const doc = await abrirPdf(datos);
    const paginas: (PaginaLeida | null)[] = Array.from({ length: doc.paginas }, () => null);
    e.pdf = { doc, paginas, ocr: new Map(), pagina: 1 };
    for (let n = 1; n <= doc.paginas; n++) { // por etapas: una página a la vez
      if (op.cancelado) { await doc.cerrar(); e.pdf = null; e.operacion = null; reemplazar(zonaHoja, h('p', { class: 'mensaje' }, icono('ℹ'), ' Lectura cancelada. No se guardó nada.')); return; }
      pr.poner((n - 1) / doc.paginas, `Leyendo página ${n} de ${doc.paginas}…`);
      paginas[n - 1] = await doc.leerPagina(n);
      await pausa();
    }
    e.operacion = null;
    e.hojas = paginas.map((_, i) => `Página ${i + 1}`);
    const conTexto = paginas.filter((p) => p?.tieneTexto).length;
    const sel = doc.paginas > 1 ? h('select', { id: 'pagina-pdf', onchange: () => { e.pdf!.pagina = Number(sel!.value); void prepararPagina(); } },
      ...paginas.map((p, i) => h('option', { value: i + 1 }, `Página ${i + 1}${p?.tieneTexto ? '' : ' (sin texto digital)'}`))) : null;
    reemplazar(zonaHoja,
      h('p', { id: 'resumen-pdf' }, icono('ℹ'), ` PDF de ${doc.paginas} página(s): ${conTexto} con texto digital${doc.paginas - conTexto ? `, ${doc.paginas - conTexto} sin texto (posiblemente escaneadas)` : ''}. Máximo ${LIMITE_PAGINAS} páginas.`),
      sel ? h('div', { class: 'campo' }, h('label', { for: 'pagina-pdf' }, 'Página con la tabla'), sel) : null);
    await prepararPagina();
  }

  async function prepararPagina() {
    if (!e.pdf) return;
    reiniciar('documento');
    const n = e.pdf.pagina;
    e.hoja = `Página ${n}`;
    const p = e.pdf.paginas[n - 1]!;
    const ocr = e.pdf.ocr.get(n);
    if (p.tieneTexto || ocr) { e.documento = marcarInciertas(reconstruirTabla(ocr ?? p.fragmentos), e.umbral); elegirEstructura(); dibujarDocumento(); return; }
    reemplazar(zonaDocumento,
      h('div', { class: 'mensaje mensaje--aviso', id: 'sin-texto' },
        h('p', {}, icono('⚠'), ` La página ${n} no tiene texto digital: parece un documento escaneado o una foto.`),
        h('p', {}, 'Puedes reconocer el texto (OCR) aquí mismo, sin enviarlo a ningún servidor. La primera vez se descargan unos 6 MB del reconocedor desde esta aplicación; después funciona sin conexión. Puede tardar varios segundos por página. Revisa con cuidado el resultado: el OCR puede equivocarse.'),
        e.pdf.ocr.size >= LIMITE_PAGINAS_OCR ? h('p', {}, `Límite de ${LIMITE_PAGINAS_OCR} páginas con OCR por documento.`)
          : h('button', { type: 'button', class: 'boton', id: 'boton-ocr', onclick: () => void ejecutarOcr(n) }, 'Reconocer texto (OCR) en este dispositivo')));
  }

  async function ejecutarOcr(n: number) {
    if (!e.pdf) return;
    const op: Cancelacion = { cancelado: false };
    e.operacion = op;
    const pr = progreso('Preparando la página…', op);
    reemplazar(zonaDocumento, pr.caja);
    const etapas: Record<string, string> = { 'loading tesseract core': 'Cargando el reconocedor…', 'initializing tesseract': 'Iniciando…', 'loading language traineddata': 'Cargando el idioma español…', 'initializing api': 'Iniciando…', 'recognizing text': 'Reconociendo texto…' };
    try {
      const lienzo = await e.pdf.doc.dibujar(n);
      if (op.cancelado) throw new OcrCancelado();
      const r = await reconocer(lienzo, (v, etapa) => pr.poner(etapa === 'recognizing text' ? v : 0, `${etapas[etapa] ?? 'Procesando…'}${etapa === 'recognizing text' ? ` ${Math.round(v * 100)} %` : ''}`), op);
      lienzo.width = 0; lienzo.height = 0; // libera memoria
      e.pdf.ocr.set(n, r.fragmentos);
      e.operacion = null;
      avisar(`Texto reconocido en la página ${n}${r.descartadas ? ` (${r.descartadas} trazo(s) descartados)` : ''}. Revisa las celdas marcadas como inciertas.`, 'info', 6000);
      await prepararPagina();
    } catch (err) {
      e.operacion = null;
      if (err instanceof OcrCancelado || op.cancelado) { await prepararPagina(); avisar('Reconocimiento cancelado. No se guardó nada.', 'info'); return; }
      registrarError(err);
      error(zonaDocumento, 'No se pudo reconocer el texto en este dispositivo. Prueba con un PDF digital o captura los datos en la plantilla de Excel.');
    }
  }

  function elegirEstructura() {
    if (!e.documento || !e.tipo) return;
    const d = detectarEstructura(e.documento);
    e.estructura = e.tipo !== 'horarios' ? 'lista' : e.plantilla && e.plantilla.estructura !== 'automatica' ? e.plantilla.estructura : d.estructura;
    const encontrado = d.estructura === 'sabana_grupo' ? d.grupo : d.docente;
    const opciones = d.estructura === 'sabana_grupo' ? nombresGrupos : nombresDocentes;
    e.contexto = encontrado ? opciones.find((x) => normalizarTexto(x) === normalizarTexto(encontrado)) ?? '' : '';
  }

  function dibujarDocumento() {
    const t = e.documento;
    if (!t || !e.tipo) return;
    const tipo = e.tipo;
    const det = detectarEstructura(t);
    const inciertas = t.filas.flat().filter((c) => c.ambigua).length;
    const columnas = Math.max(t.encabezados?.length ?? 0, ...t.filas.map((f) => f.length));
    const editarCelda = (fila: number, col: number, valor: string) => {
      const f = fila < 0 ? null : t.filas[fila]!;
      if (fila < 0) { t.encabezados = Array.from({ length: columnas }, (_, i) => (i === col ? valor : t.encabezados?.[i] ?? '')); return; }
      while (f!.length <= col) f!.push({ texto: '', confianza: null, ambigua: false });
      f![col] = { texto: valor, confianza: null, ambigua: false }; // corregida por la persona: ya no es incierta
      e.conversion = null;
    };
    const celdaInput = (fila: number, col: number, c: { texto: string; ambigua: boolean; motivo?: string } | undefined) => {
      const id = `celda-${fila + 1}-${col}`;
      const multiples = (c?.texto ?? '').includes('\n');
      const control = multiples
        ? h('textarea', { id, rows: (c?.texto ?? '').split('\n').length + 1, class: 'rejilla__campo', 'aria-label': `Fila ${fila + 1}, columna ${col + 1}${c?.ambigua ? ', lectura incierta' : ''}` })
        : h('input', { id, type: 'text', class: 'rejilla__campo', 'aria-label': fila < 0 ? `Encabezado ${col + 1}` : `Fila ${fila + 1}, columna ${col + 1}${c?.ambigua ? ', lectura incierta' : ''}` });
      control.value = c?.texto ?? '';
      control.addEventListener('change', () => { editarCelda(fila, col, control.value); control.closest('td,th')?.classList.remove('rejilla__celda--incierta'); });
      return h(fila < 0 ? 'th' : 'td', { class: c?.ambigua ? 'rejilla__celda--incierta' : '', title: c?.ambigua ? `${c.motivo ?? 'Lectura incierta'}: revisa y corrige` : '' },
        control, c?.ambigua ? h('span', { class: 'rejilla__aviso' }, icono('⚠'), ` ${c.motivo ?? 'Incierta'}`) : null);
    };
    const filasVisibles = t.filas.slice(0, 120);
    const selEstructura = h('select', { id: 'estructura-documento', disabled: tipo !== 'horarios', onchange: () => { e.estructura = selEstructura.value as EstructuraHorario; e.contexto = ''; dibujarDocumento(); } },
      ...(['lista', 'sabana_grupo', 'sabana_docente'] as const).filter((x) => tipo === 'horarios' || x === 'lista').map((x) => h('option', { value: x, selected: x === e.estructura }, ETIQUETA_ESTRUCTURA[x])));
    const opcionesContexto = e.estructura === 'sabana_grupo' ? nombresGrupos : nombresDocentes;
    const selContexto = e.estructura === 'lista' ? null : h('select', { id: 'contexto-documento', onchange: () => { e.contexto = selContexto!.value; e.conversion = null; } },
      h('option', { value: '' }, 'Selecciona…'), ...opcionesContexto.map((x) => h('option', { value: x, selected: x === e.contexto }, x)));
    reemplazar(zonaDocumento,
      h('h3', {}, 'Estructura reconocida'),
      t.titulo.length ? h('p', { class: 'ayuda', id: 'titulo-documento' }, `Título del documento: «${t.titulo.join(' · ').slice(0, 200)}»`) : null,
      ...t.avisos.map((x) => h('p', { class: 'mensaje mensaje--aviso' }, icono('⚠'), ' ', x)),
      h('div', { class: 'campo' }, h('label', { for: 'estructura-documento' }, 'Tipo de documento'), selEstructura,
        h('p', { class: 'ayuda' }, `Detección automática: ${ETIQUETA_ESTRUCTURA[det.estructura].split(' (')[0]}. ${det.motivo}`)),
      selContexto ? h('div', { class: 'campo' }, h('label', { for: 'contexto-documento' }, e.estructura === 'sabana_grupo' ? 'Grupo del horario' : 'Docente del horario'), selContexto,
        h('p', { class: 'ayuda' }, e.contexto ? 'Tomado del título; confírmalo.' : 'No se pudo leer con certeza en el documento: elígelo tú. No se adivina.')) : null,
      inciertas ? h('p', { class: 'mensaje mensaje--aviso', id: 'aviso-inciertas' }, icono('⚠'), ` ${inciertas} celda(s) con lectura incierta (confianza menor a ${Math.round(e.umbral * 100)} %). Corrígelas o confírmalas; mientras tanto no se convierten en registros.`) : null,
      h('p', { class: 'ayuda' }, `Revisa y corrige el texto antes de continuar. Las celdas vacías no se importan (no son horas de servicio). ${t.filas.length > filasVisibles.length ? `Se muestran ${filasVisibles.length} de ${t.filas.length} filas.` : ''}`),
      h('div', { class: 'rejilla', role: 'region', 'aria-label': 'Tabla reconocida (editable)', tabindex: '0' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { class: 'rejilla__num' }, '#'), ...Array.from({ length: columnas }, (_, i) => celdaInput(-1, i, { texto: t.encabezados?.[i] ?? '', ambigua: false })))),
          h('tbody', {}, ...filasVisibles.map((f, i) => h('tr', {},
            h('td', { class: 'rejilla__num' }, String(i + 1),
              h('button', { type: 'button', class: 'boton boton--chico boton--secundario rejilla__quitar', 'aria-label': `Quitar fila ${i + 1}`, title: 'Quitar esta fila (p. ej. ruido del OCR o una fila que no es clase)', onclick: () => { t.filas.splice(i, 1); e.conversion = null; dibujarDocumento(); } }, '✕')),
            ...Array.from({ length: columnas }, (_, j) => celdaInput(i, j, f[j]))))))),
      h('div', { class: 'acciones acciones--izq' },
        inciertas ? h('button', { type: 'button', class: 'boton boton--secundario', id: 'confirmar-inciertas', onclick: async () => {
          if (!(await confirmar({ titulo: '¿Dar por revisadas las celdas inciertas?', mensaje: 'Confirma que revisaste el texto de cada celda marcada contra el documento original.', textoConfirmar: 'Sí, las revisé' }))) return;
          for (const f of t.filas) f.forEach((c, j) => { if (c.ambigua) f[j] = { ...c, ambigua: false, confianza: null }; });
          dibujarDocumento();
        } }, 'Marcar inciertas como revisadas') : null,
        h('button', { type: 'button', class: 'boton', id: 'continuar-documento', onclick: continuarDocumento }, 'Continuar con esta tabla')),
    );
  }

  function continuarDocumento() {
    const t = e.documento;
    if (!t || !e.tipo) return;
    if (e.estructura !== 'lista' && !e.contexto) { avisar(e.estructura === 'sabana_grupo' ? 'Elige el grupo del horario.' : 'Elige el docente del horario.', 'error'); document.getElementById('contexto-documento')?.focus(); return; }
    const det = { ...detectarEstructura(t), estructura: e.estructura };
    if (e.estructura !== 'lista' && det.dias.size < 1) { avisar('No se encontraron columnas de días en los encabezados. Corrige los encabezados (Lunes, Martes…) o elige «una fila por clase».', 'error'); return; }
    e.conversion = e.estructura === 'lista' ? convertirLista(t) : convertirSabana(t, det, e.contexto, { materias: nombresMaterias, docentes: nombresDocentes, grupos: nombresGrupos });
    e.filas = e.conversion.tabla;
    e.encabezado = 0;
    e.mapeo = sugerirMapeo(e.filas[0] ?? [], e.tipo);
    aplicarPlantillaAlMapeo();
    reiniciar('columnas');
    dibujarColumnas();
    document.getElementById('paso-columnas-titulo')?.scrollIntoView({ block: 'start' });
  }

  // ---------- 3. Encabezados y columnas ----------
  function dibujarColumnas() {
    if (!e.tipo) return;
    const tipo = e.tipo;
    const encabezados = e.filas[e.encabezado] ?? [];
    const ancho = Math.max(encabezados.length, ...e.filas.slice(e.encabezado + 1, e.encabezado + 6).map((f) => f.length));
    while (e.mapeo.length < ancho) e.mapeo.push(null);
    const ejemplo = e.filas.slice(e.encabezado + 1).find((f) => f.some((c) => c.trim())) ?? [];
    const filaEnc = h('input', { id: 'fila-encabezados', type: 'number', min: 1, max: Math.min(e.filas.length, 50), value: e.encabezado + 1, inputmode: 'numeric' });
    filaEnc.addEventListener('change', () => {
      const n = Number(filaEnc.value);
      if (!Number.isInteger(n) || n < 1 || n > e.filas.length) { avisar('Escribe un número de fila válido.', 'error'); return; }
      e.encabezado = n - 1;
      e.mapeo = sugerirMapeo(e.filas[e.encabezado] ?? [], tipo);
      reiniciar('columnas');
      dibujarColumnas();
      document.getElementById('fila-encabezados')?.focus();
    });
    const problemas = h('div', { 'aria-live': 'polite' });
    const actualizarProblemas = () => {
      const p = problemasMapeo(e.mapeo, tipo);
      reemplazar(problemas, p.length ? h('ul', { class: 'mensaje mensaje--error' }, ...p.map((x) => h('li', {}, icono('⚠'), ' ', x))) : h('p', { class: 'mensaje' }, icono('✓'), ' Correspondencia completa.'));
    };
    const reconocidas = e.mapeo.filter(Boolean).length;
    const c = e.conversion;
    const nombrePlantilla = h('input', { id: 'nombre-plantilla', type: 'text', maxlength: 80, value: e.plantilla?.nombre ?? '' });
    const guardarPlantilla = h('details', { class: 'desplegable', id: 'guardar-plantilla' }, h('summary', {}, 'Guardar como plantilla de reconocimiento'),
      h('div', { class: 'campo' }, h('label', { for: 'nombre-plantilla' }, 'Nombre de la plantilla'), nombrePlantilla,
        h('p', { class: 'ayuda' }, 'Por ejemplo: «Horario por docente (formato de la dirección)». Se guarda en esta escuela; si ya existe una con ese nombre, se actualiza.')),
      h('button', { type: 'button', class: 'boton boton--secundario', onclick: async () => {
        try {
          const p = await ctx.s.plantillas.guardar(escuela.id, {
            nombre: nombrePlantilla.value, tipo, estructura: e.documento ? e.estructura : 'automatica', umbralConfianza: e.umbral,
            columnas: encabezados.map((x, i) => ({ encabezado: x, campo: e.mapeo[i] ?? null })).filter((x) => x.encabezado.trim()),
          });
          e.plantilla = p;
          avisar(`Plantilla «${p.nombre}» guardada en este dispositivo.`, 'exito');
          await dibujarPlantillas();
        } catch (err) { if (!esErrorDominio(err)) registrarError(err); avisar(esErrorDominio(err) ? err.message : 'No se pudo guardar la plantilla.', 'error'); }
      } }, 'Guardar plantilla'));
    reemplazar(zonaColumnas,
      c ? h('div', { class: 'mensaje', id: 'resumen-conversion' },
        h('p', {}, icono('ℹ'), ` Del documento salen ${c.tabla.length - 1} fila(s) de datos.${c.ignoradas.vacias ? ` ${c.ignoradas.vacias} celda(s) vacías ignoradas (no son horas de servicio).` : ''}${c.ignoradas.recesos ? ` ${c.ignoradas.recesos} receso(s) ignorados.` : ''}${c.ignoradas.servicio ? ` ${c.ignoradas.servicio} celda(s) de servicio no se importan: regístralas en el horario del docente.` : ''}`),
        c.porRevisar.length ? h('div', {}, h('p', {}, icono('⚠'), ` ${c.porRevisar.length} celda(s) no se pudieron interpretar con certeza; aparecerán como ERROR hasta que las corrijas en la tabla de arriba:`),
          h('ul', { id: 'celdas-por-revisar' }, ...c.porRevisar.slice(0, 30).map((x) => h('li', {}, `Fila ${x.fila + 1}: «${x.texto.replace(/\n/g, ' / ')}» — ${x.motivo}`)))) : null) : null,
      h('div', { class: 'campo' }, h('label', { for: 'fila-encabezados' }, 'Fila de encabezados'), filaEnc,
        h('p', { class: 'ayuda' }, `Detectada automáticamente: fila ${e.encabezado + 1}. Las filas de arriba (títulos, logotipos) se ignoran.`)),
      h('p', {}, `${reconocidas} de ${encabezados.filter((x) => x.trim()).length} columnas reconocidas. Revisa la correspondencia; las columnas marcadas «No importar» se ignoran.`),
      h('ol', { class: 'mapeo' }, ...Array.from({ length: ancho }, (_, i) => {
        const id = `mapeo-${i}`;
        const sel = h('select', { id, onchange: () => { e.mapeo[i] = sel.value || null; reiniciar('columnas'); actualizarProblemas(); } },
          h('option', { value: '' }, 'No importar'),
          ...CAMPOS[tipo].map((c) => h('option', { value: c.clave, selected: e.mapeo[i] === c.clave }, `${c.etiqueta}${c.obligatorio ? ' (obligatorio)' : ''}`)));
        return h('li', { class: 'mapeo__col' },
          h('label', { for: id }, h('span', { class: 'mapeo__letra' }, `Columna ${letraColumna(i)}`), ' ', h('strong', {}, encabezados[i]?.trim() || '(sin encabezado)')),
          h('span', { class: 'mapeo__ejemplo' }, ejemplo[i]?.trim() ? `Ejemplo: ${ejemplo[i]!.trim().slice(0, 60)}` : 'Sin datos de ejemplo'),
          sel);
      })),
      problemas,
      tipo === 'alumnos' || tipo === 'docentes' || tipo === 'personal' ? h('p', { class: 'ayuda' }, icono('ℹ'), ' Si el archivo trae el nombre completo en una sola columna, sólo se separa cuando viene como «Apellidos, Nombre(s)». En otro caso la fila se marca con error: no se adivina qué palabras son apellidos.') : null,
      guardarPlantilla,
      h('div', { class: 'acciones acciones--izq' }, h('button', { type: 'button', class: 'boton', id: 'analizar', onclick: analizar }, 'Analizar archivo')),
    );
    actualizarProblemas();
  }

  // ---------- 4. Revisión ----------
  async function analizar() {
    if (!e.tipo || !e.archivo) return;
    const p = problemasMapeo(e.mapeo, e.tipo);
    if (p.length) { avisar(p[0]!, 'error'); return; }
    reemplazar(zonaRevision, h('p', {}, 'Analizando… (todavía no se guarda nada)'));
    try {
      if (e.tipo === 'horarios') {
        e.analisisHorario = await ctx.s.importacion.analizarMapeado(cicloId, e.filas.slice(e.encabezado + 1), e.mapeo, e.encabezado + 2, e.archivo.huella);
        dibujarRevisionHorario();
        document.getElementById('paso-revision-titulo')?.scrollIntoView({ block: 'start' });
        return;
      }
      e.analisis = await ctx.s.importacionDatos.analizar(cicloId, e.tipo, e.filas.slice(e.encabezado + 1), e.mapeo, e.archivo.huella, e.encabezado + 2);
      e.decisiones = Object.fromEntries(e.analisis.filas.map((f) => [f.fila, f.decision]));
      dibujarRevision();
      document.getElementById('paso-revision-titulo')?.scrollIntoView({ block: 'start' });
    } catch (err) { fallo(err, zonaRevision); }
  }

  function dibujarRevision() {
    const a = e.analisis;
    if (!a || !e.tipo) return;
    const conteo = h('p', { class: 'resumen-decisiones', 'aria-live': 'polite' });
    const boton = h('button', { type: 'button', class: 'boton', id: 'confirmar-importacion', onclick: guardar });
    const recontar = () => {
      const d = Object.values(e.decisiones);
      const crear = d.filter((x) => x === 'crear').length; const act = d.filter((x) => x === 'actualizar').length;
      conteo.textContent = `Se guardarán ${crear} registro(s) nuevo(s) y ${act} actualización(es). ${a.filas.length - crear - act} fila(s) no se guardarán.`;
      boton.textContent = crear + act ? `Confirmar e importar (${crear + act})` : 'Nada que importar';
      boton.disabled = crear + act === 0;
    };
    const filtro = h('select', { id: 'filtro-filas' },
      h('option', { value: '' }, `Todas las filas (${a.totales.total})`),
      ...ORDEN.filter((x) => a.totales[x]).map((x) => h('option', { value: x }, `${ETIQUETA_ESTADO_FILA[x]} (${a.totales[x]})`)));
    const lista = h('ol', { class: 'filas-importacion' });
    const dibujarFilas = () => {
      const filas = [...a.filas].filter((f) => !filtro.value || f.estado === filtro.value).sort((x, y) => ORDEN.indexOf(x.estado) - ORDEN.indexOf(y.estado) || x.fila - y.fila);
      reemplazar(lista, ...filas.slice(0, 500).map((f) => filaRevision(f, recontar)));
      if (filas.length > 500) agregar(lista, h('li', { class: 'ayuda' }, `Se muestran 500 de ${filas.length} filas. Usa el filtro para ver el resto.`));
    };
    filtro.addEventListener('change', dibujarFilas);
    dibujarFilas();
    recontar();
    const t = a.totales;
    reemplazar(zonaRevision, 
      h('h3', {}, `Revisión de «${e.archivo?.nombre ?? ''}»${e.hoja && e.hojas.length > 1 ? `, hoja «${e.hoja}»` : ''}`),
      h('dl', { class: 'totales totales--importacion' },
        ...([['Filas leídas', t.total], ['Válidas', t.validos], ['Nuevas', t.nuevo], ['Actualizables', t.actualizable], ['Posibles duplicados', t.posible_duplicado], ['Conflictos', t.conflicto], ['Errores', t.error], ['Omitidas', t.omitido]] as const)
          .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, String(v))))),
      ...a.advertencias.map((x) => h('p', { class: 'mensaje mensaje--aviso', role: 'alert' }, icono('⚠'), ' ', x)),
      t.error + t.conflicto ? h('p', { class: 'ayuda' }, icono('ℹ'), ' Las filas con ERROR o CONFLICTO no se guardan. Puedes corregirlas en el archivo y volver a importarlo después.') : null,
      t.posible_duplicado ? h('p', { class: 'ayuda' }, icono('ℹ'), ' POSIBLE DUPLICADO: hay alguien con el mismo nombre. Un mismo nombre no prueba que sea la misma persona; por eso se omite salvo que tú elijas otra opción.') : null,
      h('div', { class: 'campo' }, h('label', { for: 'filtro-filas' }, 'Mostrar'), filtro),
      lista,
      conteo,
      h('div', { class: 'acciones acciones--izq' },
        h('button', { type: 'button', class: 'boton boton--secundario', id: 'cancelar-importacion', onclick: cancelar }, 'Cancelar importación'),
        editable ? boton : null),
    );
  }

  /** Horarios: todo o nada. Sólo se guarda si no hay errores ni conflictos; nunca reemplaza clases existentes. */
  function dibujarRevisionHorario() {
    const a = e.analisisHorario;
    if (!a) return;
    const orden: EstadoFila[] = ['error', 'conflicto', 'nueva', 'existente'];
    const filas = [...a.filas].sort((x, y) => orden.indexOf(x.estado) - orden.indexOf(y.estado) || x.fila - y.fila);
    reemplazar(zonaRevision,
      h('h3', {}, `Revisión de «${e.archivo?.nombre ?? ''}»${e.hoja && e.hojas.length > 1 ? `, hoja «${e.hoja}»` : ''}`),
      h('dl', { class: 'totales totales--importacion' },
        ...([['Filas leídas', a.filas.length], ['Clases nuevas', a.nuevas], ['Ya existentes', a.existentes], ['Conflictos', a.conflictos], ['Errores', a.errores]] as const)
          .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, String(v))))),
      ...a.advertencias.map((x) => h('p', { class: 'mensaje mensaje--aviso', role: 'alert' }, icono('⚠'), ' ', x)),
      a.puedeImportar
        ? h('p', { class: 'mensaje' }, icono('✓'), ` Sin errores ni conflictos. Al confirmar se agregarán ${a.nuevas} clase(s); las existentes no se modifican.`)
        : h('p', { class: 'mensaje mensaje--error', role: 'alert', id: 'horario-no-importable' }, icono('⚠'), a.errores + a.conflictos
          ? ` No se puede importar: hay ${a.errores} error(es) y ${a.conflictos} conflicto(s). Los horarios se importan completos o no se importan, para no dejar un horario a medias. Corrige el archivo o la correspondencia de columnas. No se guardó nada.`
          : ' No hay clases nuevas que importar.'),
      a.ajustes.length ? h('div', {}, h('h4', {}, 'Cambios que se harán en las asignaciones'), h('ul', {}, ...a.ajustes.map((x) => h('li', {}, x)))) : null,
      h('ol', { class: 'filas-importacion' }, ...filas.slice(0, 500).map((f) => {
        const [t, v, s] = ESTADO_HORARIO[f.estado];
        return h('li', { class: `fila-imp fila-imp--${f.estado === 'nueva' ? 'nuevo' : f.estado === 'existente' ? 'omitido' : f.estado}`, 'data-fila': f.fila },
          h('span', { class: 'fila-imp__cabeza' }, h('span', { class: 'fila-imp__num' }, `Fila ${f.fila}`), insignia(t, v, s)),
          h('span', { class: 'fila-imp__resumen' }, f.resumen),
          f.mensajes.length ? h('ul', { class: 'fila-imp__mensajes' }, ...f.mensajes.map((m) => h('li', {}, m))) : null);
      })),
      h('div', { class: 'acciones acciones--izq' },
        h('button', { type: 'button', class: 'boton boton--secundario', id: 'cancelar-importacion', onclick: cancelar }, 'Cancelar importación'),
        editable && a.puedeImportar ? h('button', { type: 'button', class: 'boton', id: 'confirmar-importacion', onclick: guardarHorario }, `Confirmar e importar (${a.nuevas})`) : null),
    );
  }

  async function guardarHorario(ev: Event) {
    const b = ev.currentTarget as HTMLButtonElement;
    if (!e.archivo || !e.analisisHorario || b.disabled) return;
    b.disabled = true; const original = b.textContent; b.textContent = 'Guardando…';
    try {
      const r = await ctx.s.importacion.aplicarMapeado(cicloId, e.filas.slice(e.encabezado + 1), e.mapeo, { archivo: e.archivo.nombre, hoja: e.hojas.length ? e.hoja : null, huella: e.archivo.huella }, e.encabezado + 2);
      reemplazar(zonaRevision,
        h('div', { class: 'mensaje mensaje--exito', role: 'status', id: 'resultado-importacion' },
          h('p', {}, icono('✓'), ' Importación terminada. Guardado en este dispositivo.'),
          h('ul', {}, h('li', {}, `${r.clases} clase(s) nueva(s)`), h('li', {}, `${r.asignacionesNuevas} asignación(es) nueva(s)`), h('li', {}, `${r.existentes} ya existían y no se modificaron`))),
        h('div', { class: 'acciones acciones--izq' },
          h('a', { class: 'boton', href: `#/ciclo/${cicloId}/horarios` }, 'Ver horarios'),
          h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => void ctx.recargar() }, 'Importar otro archivo')),
      );
      avisar(`Se importaron ${r.clases} clase(s).`, 'exito');
    } catch (err) {
      avisar(esErrorDominio(err) ? err.message : 'No se pudo importar. No se guardó nada.', 'error');
      if (!esErrorDominio(err)) registrarError(err);
      if (b.isConnected) { b.disabled = false; b.textContent = original; }
    }
  }

  const filaRevision = (f: FilaAnalizada, alCambiar: () => void) => {
    const [v, s] = VARIANTE[f.estado];
    const id = `decision-${f.fila}`;
    return h('li', { class: `fila-imp fila-imp--${f.estado}`, 'data-fila': f.fila },
      h('span', { class: 'fila-imp__cabeza' }, h('span', { class: 'fila-imp__num' }, `Fila ${f.fila}`), insignia(ETIQUETA_ESTADO_FILA[f.estado], v, s)),
      h('span', { class: 'fila-imp__resumen' }, f.resumen),
      f.existente ? h('span', { class: 'fila-imp__existente' }, `Registro existente: ${f.existente}`) : null,
      f.mensajes.length ? h('ul', { class: 'fila-imp__mensajes' }, ...f.mensajes.map((m) => h('li', {}, m))) : null,
      f.cambios.length ? h('ul', { class: 'fila-imp__cambios', 'aria-label': 'Cambios' }, ...f.cambios.map((m) => h('li', {}, m))) : null,
      f.opciones.length > 1
        ? h('div', { class: 'campo campo--compacto' }, h('label', { for: id }, '¿Qué hacer con esta fila?'),
            h('select', { id, onchange: (ev: Event) => { e.decisiones[f.fila] = (ev.currentTarget as HTMLSelectElement).value as Decision; alCambiar(); } },
              ...f.opciones.map((o) => h('option', { value: o, selected: e.decisiones[f.fila] === o }, TEXTO_DECISION[o]))))
        : null,
    );
  };

  async function cancelar() {
    if (!(await confirmar({ titulo: '¿Cancelar la importación?', mensaje: 'No se guardará nada. El archivo y la revisión se descartan.', textoConfirmar: 'Cancelar importación', textoCancelar: 'Seguir revisando' }))) return;
    e.plantilla = null;
    reiniciar('tipo');
    void dibujarPlantillas();
    avisar('Importación cancelada. No se guardó nada.', 'info');
  }

  async function guardar(ev: Event) {
    const b = ev.currentTarget as HTMLButtonElement;
    if (!e.tipo || !e.archivo || !e.analisis || b.disabled) return;
    b.disabled = true; const original = b.textContent; b.textContent = 'Guardando…';
    try {
      const r = await ctx.s.importacionDatos.aplicar(cicloId, e.tipo, e.filas.slice(e.encabezado + 1), e.mapeo, e.decisiones,
        { archivo: e.archivo.nombre, hoja: e.hojas.length ? e.hoja : null, huella: e.archivo.huella }, e.encabezado + 2);
      const destino = e.tipo === 'alumnos' ? `#/ciclo/${cicloId}/alumnos` : e.tipo === 'materias' ? `#/ciclo/${cicloId}/materias`
        : e.tipo === 'grupos' ? `#/ciclo/${cicloId}` : e.tipo === 'docentes' ? `#/ciclo/${cicloId}/docentes` : `#/escuela/${escuela.id}/personal`;
      reemplazar(zonaRevision, 
        h('div', { class: 'mensaje mensaje--exito', role: 'status', id: 'resultado-importacion' },
          h('p', {}, icono('✓'), ` Importación terminada. Guardado en este dispositivo.`),
          h('ul', {}, h('li', {}, `${r.resultado.nuevos} registro(s) nuevo(s)`), h('li', {}, `${r.resultado.actualizados} actualizado(s)`), h('li', {}, `${r.resultado.omitidos} fila(s) omitida(s) por decisión`),
            e.analisis.totales.error + e.analisis.totales.conflicto ? h('li', {}, `${e.analisis.totales.error + e.analisis.totales.conflicto} fila(s) con error o conflicto no se guardaron`) : null)),
        h('div', { class: 'acciones acciones--izq' },
          h('a', { class: 'boton', href: destino }, `Ver ${TIPO[e.tipo].titulo.toLowerCase()}`),
          h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => void ctx.recargar() }, 'Importar otro archivo')),
      );
      avisar(`Importación guardada: ${r.resultado.nuevos} nuevo(s), ${r.resultado.actualizados} actualizado(s).`, 'exito');
    } catch (err) {
      avisar(esErrorDominio(err) ? err.message : 'No se pudo importar. No se guardó nada.', 'error');
      if (!esErrorDominio(err)) registrarError(err);
      if (b.isConnected) { b.disabled = false; b.textContent = original; }
    }
  }

  dibujarArchivo();

  return {
    titulo: `Importar información, ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Importar información' }]),
      encabezado('Importar información', `Ciclo ${ciclo.nombre}. Desde Excel (.xlsx) o CSV. Nada se guarda hasta que revises y confirmes.`),
      navCatalogos(escuela.id, cicloId, 'importar'),
      editable ? null : h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' El ciclo está cerrado: puedes revisar archivos, pero no importar.'),
      seccion('paso-tipo', '1. ¿Qué vas a importar?', opcionesTipo),
      seccion('paso-archivo', '2. Elige el archivo', zonaArchivo, zonaDocumento),
      seccion('paso-columnas', '3. Revisa las columnas', zonaColumnas),
      seccion('paso-revision', '4. Revisa y confirma', zonaRevision),
      seccion('historial-importaciones', 'Importaciones anteriores',
        historial.length
          ? h('ul', { class: 'renglones' }, ...historial.map((r) => h('li', { class: 'renglon renglon--bloque' },
              h('span', { class: 'renglon__texto' }, `${new Date(r.creadoEn).toLocaleString('es-MX')}: ${TIPO[r.tipo].titulo}`),
              h('span', { class: 'renglon__meta' }, `«${r.archivo}»${r.hoja ? `, hoja «${r.hoja}»` : ''}. ${r.resultado.nuevos} nuevo(s), ${r.resultado.actualizados} actualizado(s), ${r.resultado.omitidos} omitido(s).`))))
          : vacio('Todavía no se ha importado información en este ciclo.')),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' También sigue disponible ', h('a', { href: `#/ciclo/${cicloId}/importar` }, 'la importación de horarios con columnas fijas'), '. Importación desde PDF: todavía no disponible.'),
    ),
  };
}
