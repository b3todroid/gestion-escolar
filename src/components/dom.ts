/**
 * Creación segura de elementos. Los textos siempre se insertan como nodos de
 * texto (nunca como HTML), lo que evita inyección de HTML o scripts.
 * Está prohibido usar innerHTML/outerHTML/insertAdjacentHTML con datos del usuario.
 */
export type Hijo = Node | string | number | null | undefined | false;
type Manejador = (ev: Event) => void;
export type Props = Record<string, string | number | boolean | Manejador | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(etiqueta: K, props: Props = {}, ...hijos: Hijo[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (typeof valor === 'function') {
      if (!clave.startsWith('on')) throw new Error(`Manejador inválido: ${clave}`);
      el.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === 'class') {
      el.className = String(valor);
    } else {
      el.setAttribute(clave, valor === true ? '' : String(valor));
    }
  }
  agregar(el, ...hijos);
  return el;
}

export function agregar(padre: Node, ...hijos: Hijo[]): void {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    padre.appendChild(typeof hijo === 'string' || typeof hijo === 'number' ? document.createTextNode(String(hijo)) : hijo);
  }
}

export function vaciar(el: Element): void {
  el.replaceChildren();
}

/** Ícono decorativo; el significado siempre va también en texto. */
export function icono(simbolo: string): HTMLSpanElement {
  return h('span', { class: 'icono', 'aria-hidden': 'true' }, simbolo);
}

/** Reemplaza el contenido de un elemento (admite hijos nulos u omitidos). */
export function reemplazar(el: Element, ...hijos: Hijo[]): void {
  vaciar(el);
  agregar(el, ...hijos);
}
