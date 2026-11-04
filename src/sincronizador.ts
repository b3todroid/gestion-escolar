/**
 * Sincronización automática e indicador en la barra (Fase 8D).
 * - Sólo actúa si hay escuelas vinculadas con el servidor; si no, no hace nada (modo local).
 * - Envía la cola cuando hay conexión (al volver la red, al regresar a la pestaña y cada poco),
 *   y recibe cambios de los demás periódicamente.
 * - El indicador se calcula SIEMPRE de la cola real: nunca dice «sincronizado» si hay pendientes.
 */
import type { Servicios } from './services';
import { registrarError } from './utils/registro';

const CADA_MS = 30_000;
/** El indicador se recalcula de la cola real cada pocos segundos (lectura local, barata). */
const PINTAR_CADA_MS = 5_000;
const EVENTO = 'gestion-escolar:sincronizacion';

/** Las pantallas avisan cuando cambian vínculos o la cola (unirse, quitar, resolver, sincronizar). */
export function notificarCambioSincronizacion(): void {
  window.dispatchEvent(new Event(EVENTO));
}
const RECIBIR_CADA_MS = 120_000;

export function iniciarSincronizacion(s: Servicios, indicador: HTMLAnchorElement): { ahora(): Promise<void> } {
  let corriendo = false;

  const pintar = async () => {
    const estados = await s.sincronizacion.estados();
    if (!estados.length) { indicador.hidden = true; return; }
    indicador.hidden = false;
    const pendientes = estados.reduce((n, x) => n + x.pendientes, 0);
    const porResolver = estados.reduce((n, x) => n + x.conflictos + x.rechazados, 0);
    const sinAcceso = estados.some((x) => x.sinAcceso);
    let texto: string; let estado: string;
    if (sinAcceso) { texto = '⚠ Sin acceso al servidor'; estado = 'problema'; }
    else if (porResolver) { texto = `⚠ ${porResolver} por resolver`; estado = 'problema'; }
    else if (pendientes) { texto = `↻ ${pendientes} por enviar`; estado = 'pendiente'; }
    else if (estados.every((x) => x.ultimaRecepcion)) { texto = '✓ Sincronizado'; estado = 'ok'; }
    else { texto = '↻ Sin sincronizar todavía'; estado = 'pendiente'; }
    indicador.textContent = texto;
    indicador.dataset['estado'] = estado;
    const ultima = estados.map((x) => x.ultimaRecepcion).filter(Boolean).sort()[0];
    indicador.title = ultima ? `Última recepción: ${new Date(ultima).toLocaleString('es-MX')}` : 'Aún no se ha recibido información del servidor';
  };

  const ciclo = async (forzar = false) => {
    if (corriendo) return;
    corriendo = true;
    try {
      if (navigator.onLine) {
        for (const e of await s.sincronizacion.estados()) {
          if (e.sinAcceso) continue;
          const tarde = !e.ultimaRecepcion || Date.now() - Date.parse(e.ultimaRecepcion) > RECIBIR_CADA_MS;
          if (forzar || e.pendientes > 0 || tarde) await s.sincronizacion.sincronizar(e.escuelaId);
        }
      }
    } catch (e) {
      registrarError(e);
    } finally {
      corriendo = false;
      await pintar().catch(registrarError);
    }
  };

  window.addEventListener('online', () => void ciclo(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void ciclo(); });
  window.addEventListener('hashchange', () => void pintar().catch(registrarError));
  window.addEventListener(EVENTO, () => void pintar().catch(registrarError));
  // Fase 10: un cambio guardado con conexión se envía en segundos (antes esperaba al ciclo de 30 s).
  const enviarPendientes = async () => {
    if (corriendo || !navigator.onLine) return;
    if ((await s.sincronizacion.estados()).some((e) => e.pendientes > 0 && !e.sinAcceso)) await ciclo();
  };
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void pintar().then(enviarPendientes).catch(registrarError);
  }, PINTAR_CADA_MS);
  setInterval(() => { if (document.visibilityState === 'visible') void ciclo(); }, CADA_MS);
  void ciclo();
  return { ahora: () => ciclo(true) };
}
