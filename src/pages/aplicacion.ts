import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion } from '../components/piezas';
import { avisar } from '../components/avisos';
import { estadoPWA, instalada, instalar } from '../pwa';

function tamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function plataforma(): 'ios' | 'android' | 'escritorio' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'escritorio';
}

/** #/aplicacion — instalación, funcionamiento sin conexión, almacenamiento y versión. */
export async function paginaAplicacion(ctx: ContextoPagina): Promise<Vista> {
  const soportaSW = 'serviceWorker' in navigator && window.isSecureContext;
  const controlada = soportaSW && !!navigator.serviceWorker.controller;
  const almacenamiento = navigator.storage;
  const estimacion = almacenamiento?.estimate ? await almacenamiento.estimate().catch(() => null) : null;
  const persistente = almacenamiento?.persisted ? await almacenamiento.persisted().catch(() => false) : false;

  // ---------- Instalación ----------
  const zonaInstalar = h('div', { id: 'zona-instalar' });
  const pintarInstalacion = () => {
    if (instalada()) { reemplazar(zonaInstalar, h('p', {}, insignia('Instalada: estás usando la aplicación instalada', 'ok', '✓'))); return; }
    const p = plataforma();
    reemplazar(zonaInstalar,
      estadoPWA.instalacion
        ? h('button', { type: 'button', class: 'boton', id: 'boton-instalar', onclick: async () => {
            const r = await instalar();
            avisar(r === 'aceptada' ? 'Aplicación instalada.' : r === 'rechazada' ? 'Instalación cancelada.' : 'Este navegador no ofrece la instalación en este momento.', r === 'aceptada' ? 'exito' : 'info');
            pintarInstalacion();
          } }, 'Instalar aplicación')
        : h('p', { class: 'ayuda' }, icono('ℹ'), ' Este navegador no ofrece un botón de instalación en este momento. Usa las instrucciones de tu dispositivo.'),
      h('ul', { class: 'instrucciones' },
        h('li', { class: p === 'ios' ? 'instrucciones--actual' : '' }, h('strong', {}, 'iPhone o iPad (Safari): '), 'botón Compartir → «Agregar a pantalla de inicio». En iPhone conviene instalarla: Safari puede borrar los datos de sitios no instalados que no se usan en varios días.'),
        h('li', { class: p === 'android' ? 'instrucciones--actual' : '' }, h('strong', {}, 'Android (Chrome, Edge, Samsung Internet): '), 'menú ⋮ → «Instalar aplicación» o «Agregar a pantalla principal».'),
        h('li', { class: p === 'escritorio' ? 'instrucciones--actual' : '' }, h('strong', {}, 'Computadora (Chrome o Edge): '), 'ícono de instalación en la barra de direcciones o menú → «Instalar Gestión Escolar». Firefox de escritorio no instala aplicaciones web; funciona igual en el navegador.'),
      ),
      h('p', { class: 'ayuda' }, 'Cada navegador ofrece la instalación de forma distinta; algunos no la ofrecen.'),
    );
  };
  pintarInstalacion();

  // ---------- Almacenamiento ----------
  const zonaPersistencia = h('div', { id: 'zona-persistencia' });
  const pintarPersistencia = (p: boolean) => reemplazar(zonaPersistencia,
    p ? h('p', {}, insignia('Almacenamiento persistente concedido: el navegador no borrará los datos por falta de espacio', 'ok', '✓'))
      : h('div', {},
          h('p', {}, insignia('Almacenamiento no persistente: el navegador podría borrar los datos si le falta espacio', 'aviso', '!')),
          almacenamiento?.persist ? h('button', { type: 'button', class: 'boton boton--secundario', onclick: async () => {
            const ok = await almacenamiento.persist().catch(() => false);
            avisar(ok ? 'El navegador concedió el almacenamiento persistente.' : 'El navegador no lo concedió ahora. Instalar la aplicación y usarla con frecuencia ayuda; mientras tanto, descarga respaldos.', ok ? 'exito' : 'info', 8000);
            pintarPersistencia(ok);
          } }, 'Pedir almacenamiento persistente') : null));
  pintarPersistencia(persistente);

  const enLinea = navigator.onLine;
  return {
    titulo: 'Aplicación y datos',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Aplicación y datos' }]),
      encabezado('Aplicación y datos', 'Instalación, uso sin conexión y dónde se guarda la información.'),
      seccion('estado-app', 'Estado',
        h('dl', { class: 'datos', id: 'estado-aplicacion' },
          h('dt', {}, 'Conexión'), h('dd', {}, enLinea ? '● En línea' : '○ Sin conexión: todo se sigue guardando en este dispositivo'),
          h('dt', {}, 'Sin conexión'), h('dd', { id: 'estado-offline' }, !soportaSW ? 'No disponible en esta dirección (requiere HTTPS o localhost)'
            : controlada || estadoPWA.listaSinConexion ? '✓ Lista para usarse sin conexión' : '◐ Preparando… vuelve a abrir la aplicación con conexión una vez'),
          h('dt', {}, 'Versión de la aplicación'), h('dd', {}, __VERSION_APP__),
          h('dt', {}, 'Versión de datos'), h('dd', {}, String(ctx.s.respaldos.versionDatos())),
          h('dt', {}, 'Sincronización'), h('dd', {}, 'No hay: los datos sólo están en este dispositivo. Para pasarlos a otro, usa un respaldo.'),
        ),
        estadoPWA.actualizacionPendiente && estadoPWA.actualizar
          ? h('button', { type: 'button', class: 'boton', onclick: () => void estadoPWA.actualizar?.(true) }, 'Actualizar a la nueva versión')
          : soportaSW && enLinea ? h('button', { type: 'button', class: 'boton boton--secundario', onclick: async () => {
              const reg = await navigator.serviceWorker.getRegistration();
              await reg?.update().catch(() => undefined);
              avisar(estadoPWA.actualizacionPendiente ? 'Hay una versión nueva: usa «Actualizar».' : 'Revisión hecha. Si hay una versión nueva, aparecerá un aviso.', 'info');
            } }, 'Buscar actualización') : null,
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Actualizar la aplicación sólo reemplaza sus archivos; tus datos (en IndexedDB) se conservan y, si cambia su estructura, se migran sin borrar nada.'),
      ),
      seccion('instalar', 'Instalar en este dispositivo', zonaInstalar),
      seccion('almacenamiento', 'Almacenamiento',
        estimacion?.usage !== undefined ? h('p', { id: 'uso-almacenamiento' }, `Uso: ${tamano(estimacion.usage)}${estimacion.quota ? ` de ${tamano(estimacion.quota)} disponibles para el sitio` : ''}.`) : null,
        zonaPersistencia,
        h('ul', { class: 'ayuda' },
          h('li', {}, 'Los datos se guardan sólo en este navegador de este dispositivo. Otro navegador o dispositivo no los ve.'),
          h('li', {}, 'Borrar los datos de navegación o del sitio elimina la información. En navegación privada se pierde al cerrar.'),
          h('li', {}, 'El «docente de este dispositivo» es una preferencia, no una cuenta ni una contraseña.'),
        ),
        h('a', { class: 'boton', href: '#/respaldos' }, 'Ir a Respaldos'),
      ),
    ),
  };
}
