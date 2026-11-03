import { registerSW } from 'virtual:pwa-register';
import { h } from './components/dom';
import { avisar } from './components/avisos';

/**
 * Registro del Service Worker (sólo en contextos seguros: HTTPS o localhost).
 * Cuando hay una versión nueva, se ofrece actualizar sin interrumpir al usuario.
 */
interface EventoInstalacion extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Estado de la PWA para la pantalla «Aplicación y datos». */
export const estadoPWA = {
  /** Evento de instalación (sólo navegadores que lo ofrecen: Chrome, Edge, Samsung Internet…). */
  instalacion: null as EventoInstalacion | null,
  listaSinConexion: false,
  actualizacionPendiente: false,
  actualizar: null as ((recargar?: boolean) => Promise<void>) | null,
};

export function instalada(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function instalar(): Promise<'aceptada' | 'rechazada' | 'no_disponible'> {
  const ev = estadoPWA.instalacion;
  if (!ev) return 'no_disponible';
  await ev.prompt();
  const r = await ev.userChoice;
  estadoPWA.instalacion = null;
  return r.outcome === 'accepted' ? 'aceptada' : 'rechazada';
}

export function iniciarPWA(): void {
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); estadoPWA.instalacion = ev as EventoInstalacion; });
  window.addEventListener('appinstalled', () => { estadoPWA.instalacion = null; });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  void navigator.serviceWorker.ready.then(() => { estadoPWA.listaSinConexion = true; });
  const actualizar = registerSW({
    immediate: true,
    onNeedRefresh() {
      estadoPWA.actualizacionPendiente = true;
      const barra = h('div', { class: 'barra-actualizacion', role: 'status' },
        h('span', {}, 'Hay una nueva versión disponible.'),
        h('button', { type: 'button', class: 'boton boton--chico', onclick: () => void actualizar(true) }, 'Actualizar'),
        h('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => barra.remove() }, 'Más tarde'),
      );
      document.body.appendChild(barra);
    },
    onRegisteredSW(_url, registro) {
      // Revisa si hay versión nueva cada hora mientras la app está abierta (sólo con conexión).
      if (registro) window.setInterval(() => { if (navigator.onLine) void registro.update(); }, 60 * 60 * 1000);
    },
    onOfflineReady() {
      estadoPWA.listaSinConexion = true;
      avisar('La aplicación ya puede usarse sin conexión.', 'info');
    },
  });
  estadoPWA.actualizar = actualizar;
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
