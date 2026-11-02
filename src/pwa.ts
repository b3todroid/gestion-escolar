import { registerSW } from 'virtual:pwa-register';
import { h } from './components/dom';
import { avisar } from './components/avisos';

/**
 * Registro del Service Worker (sólo en contextos seguros: HTTPS o localhost).
 * Cuando hay una versión nueva, se ofrece actualizar sin interrumpir al usuario.
 */
export function iniciarPWA(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const actualizar = registerSW({
    onNeedRefresh() {
      const barra = h('div', { class: 'barra-actualizacion', role: 'status' },
        h('span', {}, 'Hay una nueva versión disponible.'),
        h('button', { type: 'button', class: 'boton boton--chico', onclick: () => void actualizar(true) }, 'Actualizar'),
        h('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => barra.remove() }, 'Más tarde'),
      );
      document.body.appendChild(barra);
    },
    onOfflineReady() {
      avisar('La aplicación ya puede usarse sin conexión.', 'info');
    },
  });
}

/** Indicador de conexión: informa que los datos siguen guardándose localmente. */
export function iniciarIndicadorConexion(el: HTMLElement): void {
  const pintar = () => {
    const enLinea = navigator.onLine;
    el.dataset['estado'] = enLinea ? 'en-linea' : 'sin-conexion';
    el.textContent = enLinea ? '● En línea' : '○ Sin conexión · los datos se guardan en este dispositivo';
  };
  window.addEventListener('online', pintar);
  window.addEventListener('offline', pintar);
  pintar();
}
