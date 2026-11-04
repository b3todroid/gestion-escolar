/**
 * Aviso permanente de DEMOSTRACIÓN (Fase 10): si el dispositivo contiene una escuela de
 * demostración, la barra lo dice en todas las pantallas. Los datos ficticios nunca se presentan
 * como información oficial.
 */
import type { Servicios } from './services';
import { registrarError } from './utils/registro';

const REVISAR_CADA_MS = 5_000;

export function iniciarAvisoDemostracion(s: Servicios, el: HTMLElement): void {
  const pintar = async () => {
    const demo = (await s.escuelas.listar()).filter((e) => e.demostracion);
    el.hidden = demo.length === 0;
    el.textContent = demo.length
      ? `◆ DEMOSTRACIÓN — Este dispositivo contiene datos FICTICIOS de ${demo.map((e) => `«${e.nombre}»${e.nombreCorto ? ` (${e.nombreCorto})` : ''}`).join(', ')}. No son información oficial.`
      : '';
  };
  void pintar().catch(registrarError);
  window.addEventListener('hashchange', () => void pintar().catch(registrarError));
  window.setInterval(() => { if (document.visibilityState === 'visible') void pintar().catch(registrarError); }, REVISAR_CADA_MS);
}
