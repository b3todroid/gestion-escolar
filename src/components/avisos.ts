import { h, icono } from './dom';

/**
 * Avisos no bloqueantes (sustituyen a alert()).
 * Usan regiones vivas para que los lectores de pantalla los anuncien.
 */
let contenedor: HTMLElement | null = null;

function obtenerContenedor(): HTMLElement {
  if (!contenedor) {
    contenedor = document.getElementById('avisos') ?? document.body.appendChild(h('div', { id: 'avisos', class: 'avisos' }));
  }
  return contenedor;
}

export type TipoAviso = 'exito' | 'error' | 'info';

const SIMBOLO: Record<TipoAviso, string> = { exito: '✓', error: '⚠', info: 'ℹ' };
const PREFIJO: Record<TipoAviso, string> = { exito: 'Listo:', error: 'Error:', info: 'Aviso:' };

export function avisar(mensaje: string, tipo: TipoAviso = 'info', duracionMs = tipo === 'error' ? 8000 : 4000): void {
  const aviso = h('div', { class: `aviso aviso--${tipo}`, role: tipo === 'error' ? 'alert' : 'status' },
    icono(SIMBOLO[tipo]),
    h('span', { class: 'solo-lectores' }, PREFIJO[tipo]),
    h('span', {}, mensaje),
    h('button', { type: 'button', class: 'aviso__cerrar', 'aria-label': 'Cerrar aviso', onclick: () => aviso.remove() }, '×'),
  );
  // Sólo el aviso más reciente: al trabajar rápido no se apilan sobre el contenido.
  obtenerContenedor().replaceChildren(aviso);
  window.setTimeout(() => aviso.remove(), duracionMs);
}
