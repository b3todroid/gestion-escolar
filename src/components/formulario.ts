import { agregar, h, icono, type Hijo } from './dom';
import { avisar } from './avisos';
import { esErrorDominio } from '../domain/errores';
import { registrarError } from '../utils/registro';

/**
 * Constructores de campos de formulario accesibles: etiqueta visible,
 * ayuda y error asociados mediante aria-describedby.
 */

interface OpcionesCampo {
  nombre: string;
  etiqueta: string;
  valor?: string | number | null;
  requerido?: boolean;
  ayuda?: string;
  tipo?: 'text' | 'time' | 'date' | 'number' | 'email';
  /** Teclado sugerido en móviles (p. ej. 'numeric' para códigos). */
  modoEntrada?: 'numeric' | 'email' | 'text';
  autocompletar?: string;
  max?: number;
  min?: number;
  maxlength?: number;
  sugerencias?: readonly string[];
  mayusculas?: boolean;
}

function ids(form: string, nombre: string) {
  return { campo: `${form}-${nombre}`, ayuda: `${form}-${nombre}-ayuda`, error: `${form}-${nombre}-error` };
}

export function campo(form: string, op: OpcionesCampo): HTMLDivElement {
  const i = ids(form, op.nombre);
  const lista = op.sugerencias ? h('datalist', { id: `${i.campo}-lista` }, ...op.sugerencias.map((s) => h('option', { value: s }))) : null;
  return h('div', { class: 'campo', 'data-campo': op.nombre },
    h('label', { for: i.campo }, op.etiqueta, op.requerido ? h('span', { class: 'requerido' }, ' (obligatorio)') : h('span', { class: 'opcional' }, ' (opcional)')),
    op.ayuda ? h('p', { class: 'ayuda', id: i.ayuda }, op.ayuda) : null,
    h('input', {
      id: i.campo, name: op.nombre, type: op.tipo ?? 'text', value: op.valor ?? '',
      required: op.requerido, autocomplete: op.autocompletar ?? 'off',
      min: op.min, max: op.max, maxlength: op.maxlength,
      inputmode: op.modoEntrada ?? (op.tipo === 'number' ? 'numeric' : undefined),
      autocapitalize: op.mayusculas ? 'characters' : undefined,
      list: lista ? `${i.campo}-lista` : undefined,
      'aria-describedby': [op.ayuda ? i.ayuda : '', i.error].filter(Boolean).join(' '),
    }),
    lista,
    h('p', { class: 'error-campo', id: i.error, hidden: true }),
  );
}

export function selector(form: string, op: { nombre: string; etiqueta: string; opciones: readonly { valor: string; texto: string }[]; valor?: string; requerido?: boolean }): HTMLDivElement {
  const i = ids(form, op.nombre);
  return h('div', { class: 'campo', 'data-campo': op.nombre },
    h('label', { for: i.campo }, op.etiqueta, op.requerido ? h('span', { class: 'requerido' }, ' (obligatorio)') : null),
    h('select', { id: i.campo, name: op.nombre, required: op.requerido, 'aria-describedby': i.error },
      h('option', { value: '' }, 'Selecciona…'),
      ...op.opciones.map((o) => h('option', { value: o.valor, selected: o.valor === op.valor }, o.texto)),
    ),
    h('p', { class: 'error-campo', id: i.error, hidden: true }),
  );
}

export function casillas(form: string, op: { nombre: string; leyenda: string; opciones: readonly { valor: string | number; texto: string }[]; marcados: readonly (string | number)[] }): HTMLFieldSetElement {
  const i = ids(form, op.nombre);
  return h('fieldset', { class: 'campo casillas', 'data-campo': op.nombre, 'aria-describedby': i.error },
    h('legend', {}, op.leyenda),
    h('div', { class: 'casillas__lista' },
      ...op.opciones.map((o) =>
        h('label', { class: 'casilla' },
          h('input', { type: 'checkbox', name: op.nombre, value: o.valor, checked: op.marcados.includes(o.valor) }),
          h('span', {}, o.texto),
        ),
      ),
    ),
    h('p', { class: 'error-campo', id: i.error, hidden: true }),
  );
}

export function botonEnviar(texto: string): HTMLButtonElement {
  return h('button', { type: 'submit', class: 'boton' }, texto);
}

export function formulario(id: string, titulo: string | null, ...hijos: Hijo[]): HTMLFormElement {
  return h('form', { id, class: 'formulario', novalidate: true, 'aria-labelledby': titulo ? `${id}-titulo` : undefined },
    titulo ? h('h3', { id: `${id}-titulo` }, titulo) : null,
    h('div', { class: 'resumen-errores', role: 'alert', tabindex: '-1', hidden: true }),
    ...hijos,
  );
}

// ---------- Lectura de valores ----------

export function texto(form: HTMLFormElement, nombre: string): string {
  const v = new FormData(form).get(nombre);
  return typeof v === 'string' ? v : '';
}

export function numero(form: HTMLFormElement, nombre: string): number | null {
  const v = texto(form, nombre).trim();
  return v === '' ? null : Number(v);
}

export function marcados(form: HTMLFormElement, nombre: string): string[] {
  return new FormData(form).getAll(nombre).filter((v): v is string => typeof v === 'string');
}

// ---------- Envío con indicador de guardado y errores ----------

function limpiarErrores(form: HTMLFormElement) {
  form.querySelectorAll<HTMLElement>('.error-campo').forEach((e) => { e.hidden = true; e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  const resumen = form.querySelector<HTMLElement>('.resumen-errores');
  if (resumen) { resumen.hidden = true; resumen.replaceChildren(); }
}

function mostrarErrores(form: HTMLFormElement, mensaje: string, campos: { campo: string; mensaje: string }[]) {
  const resumen = form.querySelector<HTMLElement>('.resumen-errores');
  let primero: HTMLElement | null = null;
  const sinCampo: string[] = [];
  for (const c of campos) {
    const cont = form.querySelector<HTMLElement>(`[data-campo="${CSS.escape(c.campo)}"]`);
    const err = cont?.querySelector<HTMLElement>('.error-campo');
    if (cont && err) {
      err.hidden = false;
      err.replaceChildren(icono('⚠'), ` ${c.mensaje}`);
      const control = cont.querySelector<HTMLElement>('input, select');
      control?.setAttribute('aria-invalid', 'true');
      primero ??= control;
    } else {
      sinCampo.push(c.mensaje);
    }
  }
  if (resumen) {
    resumen.hidden = false;
    resumen.replaceChildren();
    if (campos.length > 1) {
      agregar(resumen, h('p', {}, icono('⚠'), ` Revisa ${campos.length} campos:`), h('ul', {}, ...campos.map((c) => h('li', {}, c.mensaje))));
    } else {
      agregar(resumen, h('p', {}, icono('⚠'), ' ', mensaje));
      if (sinCampo[0] && sinCampo[0] !== mensaje) agregar(resumen, h('p', {}, sinCampo[0]));
    }
  }
  (primero ?? resumen)?.focus();
}

/**
 * Conecta el envío del formulario a una acción asíncrona.
 * Muestra «Guardando…», deshabilita el botón, y presenta errores por campo.
 * `accion` devuelve el mensaje de éxito, o null si el paso no guarda (p. ej. «Siguiente»).
 */
export function alEnviar(form: HTMLFormElement, accion: () => Promise<string | null>, textoOcupado = 'Guardando…'): HTMLFormElement {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const textoOriginal = boton?.textContent ?? '';
    if (boton?.disabled) return; // evita envíos dobles
    limpiarErrores(form);
    if (boton) { boton.disabled = true; boton.textContent = textoOcupado; }
    form.setAttribute('aria-busy', 'true');
    try {
      const mensaje = await accion();
      form.removeAttribute('data-sin-guardar'); // guardado: ya no hay cambios pendientes
      if (mensaje) avisar(`${mensaje} Guardado en este dispositivo.`, 'exito');
    } catch (e) {
      if (esErrorDominio(e)) {
        mostrarErrores(form, e.message, e.campos.length ? e.campos : [{ campo: 'formulario', mensaje: e.message }]);
        avisar(e.message, 'error');
      } else {
        registrarError(e);
        mostrarErrores(form, 'Ocurrió un error inesperado. Tus datos anteriores no se modificaron.', []);
        avisar('Ocurrió un error inesperado.', 'error');
      }
    } finally {
      form.removeAttribute('aria-busy');
      if (boton?.isConnected) { boton.disabled = false; boton.textContent = textoOriginal; }
    }
  });
  return form;
}

/** Ejecuta una acción fuera de un formulario (activar, eliminar…) con avisos. */
export async function ejecutar(accion: () => Promise<string>): Promise<boolean> {
  try {
    avisar(await accion(), 'exito');
    return true;
  } catch (e) {
    avisar(esErrorDominio(e) ? e.message : 'Ocurrió un error inesperado.', 'error');
    if (!esErrorDominio(e)) registrarError(e);
    return false;
  }
}

export function areaTexto(form: string, op: { nombre: string; etiqueta: string; ayuda?: string; filas?: number; requerido?: boolean }): HTMLDivElement {
  const i = ids(form, op.nombre);
  return h('div', { class: 'campo', 'data-campo': op.nombre },
    h('label', { for: i.campo }, op.etiqueta, op.requerido ? h('span', { class: 'requerido' }, ' (obligatorio)') : null),
    op.ayuda ? h('p', { class: 'ayuda', id: i.ayuda }, op.ayuda) : null,
    h('textarea', { id: i.campo, name: op.nombre, rows: op.filas ?? 5, required: op.requerido, 'aria-describedby': [op.ayuda ? i.ayuda : '', i.error].filter(Boolean).join(' ') }),
    h('p', { class: 'error-campo', id: i.error, hidden: true }),
  );
}
