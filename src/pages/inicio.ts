import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { encabezado, insignia, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { NIVEL_ETIQUETA } from './etiquetas';
import { consultarAlmacenamiento, formatoBytes, solicitarPersistencia } from '../utils/almacenamiento';

export async function paginaInicio(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const alm = await consultarAlmacenamiento();

  const lista = escuelas.length
    ? h('ul', { class: 'tarjetas' }, ...escuelas.map((e) =>
        h('li', { class: 'tarjeta' },
          h('h3', {}, h('a', { href: `#/escuela/${e.id}`, class: 'tarjeta__enlace' }, e.nombre)),
          h('p', { class: 'tarjeta__meta' }, NIVEL_ETIQUETA[e.nivel], e.cct ? ` · CCT ${e.cct}` : '', e.localidad ? ` · ${e.localidad}` : ''),
        ),
      ))
    : vacio('Todavía no hay escuelas registradas en este dispositivo.');

  const estadoPersistencia = alm.persistente === true
    ? insignia('Almacenamiento persistente concedido', 'ok', '✓')
    : alm.persistente === false
      ? insignia('El navegador podría liberar estos datos si falta espacio', 'aviso', '!')
      : insignia('El navegador no informa si el almacenamiento es persistente', 'neutro', '?');

  return {
    titulo: 'Escuelas',
    contenido: h('div', { class: 'pagina' },
      encabezado('Escuelas', 'Registra y configura tus escuelas. Todo se guarda en este dispositivo.'),
      h('a', { class: 'boton boton--ancho', href: '#/escuela/nueva' }, icono('+'), ' Registrar escuela'),
      seccion('lista-escuelas', `Escuelas registradas (${escuelas.length})`, lista),
      seccion('almacenamiento', 'Datos en este dispositivo',
        h('p', {}, estadoPersistencia),
        alm.usadoBytes !== null && alm.cuotaBytes !== null
          ? h('p', { class: 'ayuda' }, `Espacio usado por el sitio: ${formatoBytes(alm.usadoBytes)} de ${formatoBytes(alm.cuotaBytes)} disponibles.`)
          : null,
        h('p', { class: 'ayuda' },
          'Los datos se conservan al recargar, cerrar el navegador o perder la conexión. ',
          'Se pierden si borras los datos del navegador o cambias de dispositivo. ',
          'La función de respaldo y restauración llegará en una próxima fase.'),
        alm.persistente === false
          ? h('button', {
              type: 'button', class: 'boton boton--secundario',
              onclick: async () => {
                const ok = await solicitarPersistencia();
                avisar(ok ? 'El navegador concedió almacenamiento persistente.' : 'El navegador no concedió el almacenamiento persistente. Suele concederse al instalar la aplicación o usarla con frecuencia.', ok ? 'exito' : 'info');
                await ctx.recargar();
              },
            }, 'Solicitar almacenamiento persistente')
          : null,
      ),
    ),
  };
}
