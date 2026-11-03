/**
 * #/sincronizacion — estado real de la cola de cada escuela vinculada con el servidor,
 * y cambios que requieren una decisión de la persona (conflictos y rechazos).
 * Nada se resuelve solo: cada botón es una decisión explícita.
 */
import type { ContextoPagina, Vista } from '../app';
import { notificarCambioSincronizacion } from '../sincronizador';
import { avisar } from '../components/avisos';
import { confirmar } from '../components/dialogo';
import { h, icono } from '../components/dom';
import { ejecutar } from '../components/formulario';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import type { CambioPendiente } from '../repositories/tipos';
import { ETIQUETA_TABLA } from '../services/respaldos';
import type { EstadoSincronizacion } from '../services/sincronizacion';
import type { TablaRespaldo } from '../validators/respaldo';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca');
const OMITIR = new Set(['creadoEn', 'actualizadoEn', 'version', 'id', 'escuelaId', 'cicloEscolarId']);

function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** Diferencias campo por campo entre lo que hay en este dispositivo y lo que tiene el servidor. */
function diferencias(c: CambioPendiente): HTMLElement {
  const local = c.datos ?? {};
  const servidor = c.servidor && c.servidor.id === c.registroId ? c.servidor : null;
  if (!servidor) {
    return h('p', { class: 'ayuda' }, c.servidor
      ? 'En el servidor ya existe otro registro equivalente (por ejemplo, la misma lista de clase y fecha guardada por otra persona).'
      : c.operacion === 'eliminar' ? 'Querías eliminar este registro.' : 'El servidor no tiene una versión de este registro que puedas ver.');
  }
  const campos = [...new Set([...Object.keys(local), ...Object.keys(servidor)])]
    .filter((k) => !OMITIR.has(k) && JSON.stringify(local[k] ?? null) !== JSON.stringify(servidor[k] ?? null)).slice(0, 10);
  if (!campos.length) return h('p', { class: 'ayuda' }, 'Los datos son iguales; sólo cambió la versión.');
  return h('table', { class: 'tabla-comparacion' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Campo'), h('th', { scope: 'col' }, 'En este dispositivo'), h('th', { scope: 'col' }, 'En el servidor'))),
    h('tbody', {}, ...campos.map((k) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, valor(local[k])), h('td', {}, valor(servidor[k]))))),
  );
}

function estadoInsignia(e: EstadoSincronizacion): HTMLElement {
  if (e.sinAcceso) return insignia('Sin acceso: tu cuenta ya no tiene acceso a esta escuela', 'aviso', '⚠');
  if (e.conflictos + e.rechazados) return insignia(`${e.conflictos + e.rechazados} cambio(s) requieren tu decisión`, 'aviso', '⚠');
  if (e.pendientes) return insignia(`${e.pendientes} cambio(s) por enviar`, 'aviso', '↻');
  if (!e.ultimaRecepcion) return insignia('Aún no se ha sincronizado', 'neutro', '○');
  return insignia('Sincronizado: no hay cambios por enviar', 'ok', '✓');
}

export async function paginaSincronizacion(ctx: ContextoPagina): Promise<Vista> {
  const estados = await ctx.s.sincronizacion.estados();
  const secciones: (HTMLElement | null)[] = [];
  for (const e of estados) {
    const porResolver = await ctx.s.sincronizacion.porResolver(e.escuelaId);
    secciones.push(seccion(`sinc-${e.escuelaId}`, e.escuela,
      h('p', { class: 'estado-sinc', 'data-escuela': e.escuelaId }, estadoInsignia(e)),
      h('dl', { class: 'datos' },
        h('dt', {}, 'Por enviar'), h('dd', {}, String(e.pendientes)),
        h('dt', {}, 'Último envío'), h('dd', {}, fecha(e.ultimoEnvio)),
        h('dt', {}, 'Última recepción'), h('dd', {}, fecha(e.ultimaRecepcion)),
      ),
      h('div', { class: 'acciones' },
        h('button', { type: 'button', class: 'boton', onclick: async (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = 'Sincronizando…';
          try {
            const r = await ctx.s.sincronizacion.sincronizar(e.escuelaId);
            notificarCambioSincronizacion();
            if (r.problema) avisar(r.problema, 'info', 8000);
            else avisar(`Listo: ${r.enviados} enviado(s), ${r.recibidos} recibido(s)${r.conflictos + r.rechazados ? `, ${r.conflictos + r.rechazados} por resolver` : ''}.`, r.conflictos + r.rechazados ? 'info' : 'exito');
          } catch (x) {
            avisar(x instanceof Error ? x.message : 'No se pudo sincronizar.', 'error');
          }
          await ctx.recargar();
        } }, 'Sincronizar ahora'),
        h('a', { class: 'boton boton--secundario', href: `#/escuela/${e.escuelaId}` }, 'Abrir escuela'),
      ),
      porResolver.length ? h('div', { id: `por-resolver-${e.escuelaId}` },
        h('h3', {}, 'Requieren tu decisión'),
        h('ul', { class: 'renglones' }, ...porResolver.map((c) => h('li', { class: 'renglon renglon--bloque', 'data-op': c.opId },
          h('p', {}, insignia(c.estado === 'conflicto' ? 'Conflicto' : 'Rechazado por el servidor', 'aviso', '⚠'), ' ',
            h('strong', {}, ETIQUETA_TABLA[c.tabla as TablaRespaldo] ?? c.tabla), ` · ${c.operacion === 'eliminar' ? 'eliminación' : 'cambio'} del ${fecha(c.creadoEn)}`),
          h('p', {}, c.mensaje ?? ''),
          diferencias(c),
          h('div', { class: 'acciones' },
            h('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: async () => {
              const ok = await confirmar({ titulo: 'Usar la versión del servidor', mensaje: 'Tu cambio en este dispositivo se descarta y se queda lo que tiene el servidor. Esta decisión no se puede deshacer.', textoConfirmar: 'Usar la del servidor' });
              if (ok && await ejecutar(async () => { await ctx.s.sincronizacion.usarVersionServidor(c.opId); await ctx.s.sincronizacion.sincronizar(e.escuelaId); notificarCambioSincronizacion(); return 'Se usó la versión del servidor.'; })) await ctx.recargar();
            } }, 'Usar la versión del servidor'),
            c.estado === 'conflicto' && c.servidor?.id === c.registroId ? h('button', { type: 'button', class: 'boton boton--chico', onclick: async () => {
              const ok = await confirmar({ titulo: 'Volver a aplicar mi cambio', mensaje: 'Tu versión reemplazará la que guardó otra persona en el servidor. Revisa antes las diferencias.', textoConfirmar: 'Aplicar mi cambio' });
              if (ok && await ejecutar(async () => { await ctx.s.sincronizacion.reaplicarMiCambio(c.opId); await ctx.s.sincronizacion.sincronizar(e.escuelaId); notificarCambioSincronizacion(); return 'Tu cambio se volvió a enviar.'; })) await ctx.recargar();
            } }, 'Volver a aplicar mi cambio') : null,
          ),
        ))),
      ) : null,
      h('details', { class: 'desplegable' }, h('summary', {}, 'Quitar esta escuela del dispositivo'),
        h('p', {}, 'Borra de este dispositivo los datos de la escuela y su cola. En el servidor no se borra nada.'),
        e.pendientes + e.conflictos + e.rechazados ? h('p', { class: 'mensaje mensaje--error' }, icono('⚠'), ` Hay ${e.pendientes + e.conflictos + e.rechazados} cambio(s) sin enviar que se perderán.`) : null,
        h('button', { type: 'button', class: 'boton boton--peligro', onclick: async () => {
          const ok = await confirmar({ titulo: `Quitar «${e.escuela}» de este dispositivo`, mensaje: 'Se borrarán de este dispositivo sus datos y los cambios sin enviar. En el servidor no se borra nada.', textoConfirmar: 'Quitar del dispositivo', peligro: true });
          if (ok && await ejecutar(async () => { await ctx.s.sincronizacion.quitar(e.escuelaId); notificarCambioSincronizacion(); return 'La escuela se quitó de este dispositivo.'; })) await ctx.recargar('h1');
        } }, 'Quitar del dispositivo'),
      ),
    ));
  }
  return {
    titulo: 'Sincronización',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Cuenta', href: '#/cuenta' }, { texto: 'Sincronización' }]),
      encabezado('Sincronización', 'Lo que falta enviar al servidor escolar y lo que requiere tu decisión.'),
      estados.length ? null : vacio('Ninguna escuela de este dispositivo se sincroniza con el servidor. Para usar una, entra a tu cuenta y elige «Usar en este dispositivo».'),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Puedes trabajar sin conexión: los cambios se guardan aquí y se envían al volver la conexión. Si otra persona cambió lo mismo, no se sobrescribe: aquí decides.'),
      ...secciones,
    ),
  };
}
