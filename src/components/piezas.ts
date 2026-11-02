import { h, icono, type Hijo } from './dom';

export interface Miga { texto: string; href?: string }

export function migas(lista: Miga[]): HTMLElement {
  return h('nav', { class: 'migas', 'aria-label': 'Ruta de navegación' },
    h('ol', {}, ...lista.map((m, i) =>
      h('li', {}, m.href && i < lista.length - 1 ? h('a', { href: m.href }, m.texto) : h('span', { 'aria-current': 'page' }, m.texto)),
    )),
  );
}

export function encabezado(titulo: string, subtitulo?: string | null): HTMLElement {
  return h('header', { class: 'encabezado-pagina' },
    h('h1', { tabindex: '-1' }, titulo),
    subtitulo ? h('p', { class: 'subtitulo' }, subtitulo) : null,
  );
}

export function seccion(id: string, titulo: string, ...hijos: Hijo[]): HTMLElement {
  return h('section', { class: 'seccion', 'aria-labelledby': `${id}-titulo` },
    h('h2', { id: `${id}-titulo` }, titulo),
    ...hijos,
  );
}

export function vacio(mensaje: string): HTMLElement {
  return h('p', { class: 'vacio' }, icono('○'), ' ', mensaje);
}

/** Etiqueta de estado: texto + símbolo (no depende sólo del color). */
export function insignia(textoVisible: string, variante: 'ok' | 'aviso' | 'neutro', simbolo: string): HTMLElement {
  return h('span', { class: `insignia insignia--${variante}` }, icono(simbolo), ' ', textoVisible);
}

/** Bloque desplegable para formularios de alta: mantiene las pantallas breves. */
export function desplegable(resumen: string, abierto: boolean, ...hijos: Hijo[]): HTMLDetailsElement {
  return h('details', { class: 'desplegable', open: abierto }, h('summary', {}, resumen), ...hijos);
}

export function botonAccion(texto: string, alPulsar: () => void, variante: 'secundario' | 'peligro' | 'principal' = 'secundario', etiquetaAccesible?: string): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: `boton boton--${variante} boton--chico`,
    'aria-label': etiquetaAccesible,
    onclick: alPulsar,
  }, texto);
}
