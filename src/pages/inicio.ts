import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { encabezado, insignia, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { NIVEL_ETIQUETA } from './etiquetas';
import { descartarBorrador, leerBorrador } from './borrador';
import { confirmar } from '../components/dialogo';
import { consultarAlmacenamiento, formatoBytes, solicitarPersistencia } from '../utils/almacenamiento';

export async function paginaInicio(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const alm = await consultarAlmacenamiento();
  const borrador = leerBorrador();

  const pendiente = borrador
    ? h('section', { class: 'pendiente', 'aria-labelledby': 'pendiente-titulo' },
        h('h2', { id: 'pendiente-titulo' }, 'Configuración sin terminar'),
        h('p', {}, borrador.datos.escuela.nombre ? `«${borrador.datos.escuela.nombre}», paso ${borrador.paso + 1} de 6.` : `Quedaste en el paso ${borrador.paso + 1} de 6.`),
        h('div', { class: 'acciones acciones--izq' },
          h('a', { class: 'boton', href: '#/asistente' }, 'Continuar'),
          h('button', {
            type: 'button', class: 'boton boton--secundario',
            onclick: async () => {
              if (await confirmar({ titulo: '¿Descartar la configuración sin terminar?', mensaje: 'Se borrará lo capturado en el asistente. Las escuelas ya guardadas no se modifican.', textoConfirmar: 'Descartar', peligro: true })) {
                descartarBorrador();
                avisar('Configuración descartada.', 'info');
                await ctx.recargar();
              }
            },
          }, 'Descartar'),
        ),
      )
    : null;

  const lista = escuelas.length
    ? h('ul', { class: 'tarjetas' }, ...escuelas.map((e) =>
        h('li', { class: 'tarjeta' },
          h('h3', {}, h('a', { href: `#/escuela/${e.id}`, class: 'tarjeta__enlace' }, e.nombre)),
          h('p', { class: 'tarjeta__meta' }, [NIVEL_ETIQUETA[e.nivel], e.cct ? `CCT ${e.cct}` : null, e.localidad].filter(Boolean).join(', ')),
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
      encabezado('Escuelas', 'Configura cada escuela una vez: datos, ciclo, turno, horario, grados y grupos. Todo se guarda en este dispositivo.'),
      pendiente,
      borrador ? null : h('a', { class: 'boton boton--ancho', href: '#/asistente' }, icono('+'), ' Configurar una escuela nueva'),
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
