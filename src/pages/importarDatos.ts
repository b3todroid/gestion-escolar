import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { confirmar } from '../components/dialogo';
import { hojasXlsx, leerTabla } from '../domain/importacion/tabla';
import { ErrorArchivo } from '../domain/importacion/zip';
import { CAMPOS, TIPOS_IMPORTACION, detectarEncabezado, problemasMapeo, sugerirMapeo, type Mapeo, type TipoImportacion } from '../domain/importacion/mapeo';
import { esErrorDominio } from '../domain/errores';
import { ETIQUETA_ESTADO_FILA, type AnalisisDatos, type Decision, type EstadoFilaDatos, type FilaAnalizada } from '../services/importacionDatos';
import { navCatalogos } from './catalogos';

const TIPO: Record<TipoImportacion, { titulo: string; descripcion: string }> = {
  alumnos: { titulo: 'Alumnos', descripcion: 'Nombre, apellidos, grado, grupo y turno; opcionales número de lista, matrícula y CURP.' },
  docentes: { titulo: 'Docentes', descripcion: 'Personal con función docente; opcionales identificador, materias que puede impartir y turnos.' },
  personal: { titulo: 'Personal', descripcion: 'Cualquier función (prefectura, dirección, orientación…); opcionales identificador y turnos.' },
  materias: { titulo: 'Materias y actividades', descripcion: 'Nombre y tipo (materia, campo formativo, taller, tutoría, actividad especial o servicio).' },
  grupos: { titulo: 'Grupos', descripcion: 'Grado, grupo, turno y capacidad. Los grados y turnos deben existir.' },
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
  decisiones: Record<number, Decision>;
}

export async function paginaImportarDatos(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const historial = await ctx.s.importacionDatos.historial(cicloId);
  const editable = ciclo.estado !== 'cerrado';

  const e: Estado = { tipo: null, archivo: null, hojas: [], hoja: null, filas: [], encabezado: 0, mapeo: [], analisis: null, decisiones: {} };

  const zonaArchivo = h('div', {});
  const zonaColumnas = h('div', { 'aria-live': 'polite' });
  const zonaRevision = h('div', { 'aria-live': 'polite' });
  const error = (destino: HTMLElement, mensaje: string) => reemplazar(destino, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', mensaje));

  const reiniciar = (desde: 'tipo' | 'archivo' | 'columnas') => {
    if (desde !== 'columnas') { e.mapeo = []; reemplazar(zonaColumnas); }
    e.analisis = null; e.decisiones = {};
    reemplazar(zonaRevision);
    if (desde === 'tipo') { e.archivo = null; e.hojas = []; e.hoja = null; e.filas = []; dibujarArchivo(); }
  };

  // ---------- 1. Tipo ----------
  const opcionesTipo = h('div', { class: 'opciones-tipo', role: 'radiogroup', 'aria-labelledby': 'paso-tipo-titulo' },
    ...TIPOS_IMPORTACION.map((t) => h('label', { class: 'opcion-tipo' },
      h('input', { type: 'radio', name: 'tipo-importacion', value: t, onchange: () => { e.tipo = t; reiniciar('tipo'); } }),
      h('span', { class: 'opcion-tipo__texto' }, h('strong', {}, TIPO[t].titulo), h('span', { class: 'opcion-tipo__desc' }, TIPO[t].descripcion)),
    )));

  // ---------- 2. Archivo y hoja ----------
  const entrada = h('input', { type: 'file', id: 'archivo-datos', accept: '.xlsx,.csv', class: 'archivo' });
  const zonaHoja = h('div', {});
  function dibujarArchivo() {
    entrada.value = '';
    reemplazar(zonaHoja);
    reemplazar(zonaArchivo, e.tipo
      ? h('div', {},
          h('div', { class: 'campo' }, h('label', { for: 'archivo-datos' }, `Archivo de ${TIPO[e.tipo].titulo.toLowerCase()} (.xlsx o .csv)`), entrada,
            h('p', { class: 'ayuda' }, 'Se lee en este dispositivo; no se envía a ningún servidor. Las macros y fórmulas no se ejecutan: sólo se leen los valores.')),
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
    if (!conocido) console.error(err);
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
    reemplazar(zonaColumnas, 
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
      tipo !== 'materias' && tipo !== 'grupos' ? h('p', { class: 'ayuda' }, icono('ℹ'), ' Si el archivo trae el nombre completo en una sola columna, sólo se separa cuando viene como «Apellidos, Nombre(s)». En otro caso la fila se marca con error: no se adivina qué palabras son apellidos.') : null,
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
    reiniciar('tipo');
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
      if (!esErrorDominio(err)) console.error(err);
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
      seccion('paso-archivo', '2. Elige el archivo', zonaArchivo),
      seccion('paso-columnas', '3. Revisa las columnas', zonaColumnas),
      seccion('paso-revision', '4. Revisa y confirma', zonaRevision),
      seccion('historial-importaciones', 'Importaciones anteriores',
        historial.length
          ? h('ul', { class: 'renglones' }, ...historial.map((r) => h('li', { class: 'renglon renglon--bloque' },
              h('span', { class: 'renglon__texto' }, `${new Date(r.creadoEn).toLocaleString('es-MX')}: ${TIPO[r.tipo].titulo}`),
              h('span', { class: 'renglon__meta' }, `«${r.archivo}»${r.hoja ? `, hoja «${r.hoja}»` : ''}. ${r.resultado.nuevos} nuevo(s), ${r.resultado.actualizados} actualizado(s), ${r.resultado.omitidos} omitido(s).`))))
          : vacio('Todavía no se ha importado información en este ciclo.')),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Para horarios usa ', h('a', { href: `#/ciclo/${cicloId}/importar` }, 'Importar horarios'), '.'),
    ),
  };
}
