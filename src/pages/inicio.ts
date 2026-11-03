import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { insignia, seccion } from '../components/piezas';
import { avisar } from '../components/avisos';
import { NIVEL_ETIQUETA } from './etiquetas';
import { descartarBorrador, leerBorrador } from './borrador';
import { confirmar } from '../components/dialogo';
import { consultarAlmacenamiento, formatoBytes, solicitarPersistencia } from '../utils/almacenamiento';

export async function paginaInicio(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const alm = await consultarAlmacenamiento();
  const borrador = leerBorrador();
  const sinRespaldo = [];
  for (const e of escuelas) if ((await ctx.s.respaldos.estado(e.id, new Date())).recordar) sinRespaldo.push(e.nombre);

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

  // Cada escuela es un solo enlace grande para continuar con su información.
  const lista = escuelas.length
    ? h('ul', { class: 'tarjetas' }, ...escuelas.map((e) =>
        h('li', {},
          h('a', { class: 'tarjeta-escuela', href: `#/escuela/${e.id}` },
            e.logotipo ? h('img', { class: 'tarjeta-escuela__logo', src: e.logotipo, alt: '', width: 48, height: 48 }) : h('span', { class: 'tarjeta-escuela__logo tarjeta-escuela__logo--vacio', 'aria-hidden': 'true' }, (e.nombreCorto ?? e.nombre).charAt(0)),
            h('span', { class: 'tarjeta-escuela__texto' },
              h('span', { class: 'tarjeta-escuela__nombre' }, e.nombre),
              h('span', { class: 'tarjeta__meta' }, [NIVEL_ETIQUETA[e.nivel], e.cct ? `CCT ${e.cct}` : null, e.localidad].filter(Boolean).join(', '))),
            h('span', { class: 'tarjeta-escuela__accion' }, 'Continuar'),
          ),
        ),
      ))
    : null;

  const estadoPersistencia = alm.persistente === true
    ? insignia('Almacenamiento persistente concedido', 'ok', '✓')
    : alm.persistente === false
      ? insignia('El navegador podría liberar estos datos si falta espacio', 'aviso', '!')
      : insignia('El navegador no informa si el almacenamiento es persistente', 'neutro', '?');

  return {
    titulo: escuelas.length ? 'Escuelas' : 'Bienvenida',
    contenido: h('div', { class: 'pagina' },
      h('header', { class: 'bienvenida' },
        h('img', { class: 'bienvenida__marca', src: './icono.svg', alt: '', width: 64, height: 64 }),
        h('h1', { tabindex: '-1', class: 'bienvenida__titulo' }, 'Gestión escolar'),
        h('p', { class: 'bienvenida__subtitulo' }, 'Sistema de administración y organización escolar'),
      ),
      pendiente,
      sinRespaldo.length ? h('div', { class: 'pendiente', role: 'status' },
        h('p', {}, icono('!'), ` ${sinRespaldo.length === 1 ? `«${sinRespaldo[0]}» tiene` : `${sinRespaldo.length} escuelas tienen`} cambios sin respaldar.`),
        h('a', { class: 'boton boton--chico', href: '#/respaldos' }, 'Descargar respaldo')) : null,
      !escuelas.length && !borrador ? h('section', { class: 'bienvenida__inicio', 'aria-label': 'Primeros pasos' },
        h('a', { class: 'boton boton--ancho boton--grande boton--principal-alto', href: '#/asistente' }, 'Configurar mi escuela'),
        h('ol', { class: 'bienvenida__pasos' },
          h('li', {}, h('strong', {}, 'Datos del plantel'), h('span', {}, ' Nombre, CCT, nivel, entidad, ciclo y turno.')),
          h('li', {}, h('strong', {}, 'Jornada'), h('span', {}, ' Días, horario, periodos y recesos.')),
          h('li', {}, h('strong', {}, 'Grados y grupos'), h('span', {}, ' Todos los que tenga tu escuela.')),
          h('li', {}, h('strong', {}, 'Revisión'), h('span', {}, ' Nada se guarda hasta que confirmes.')),
        ),
        h('p', { class: 'ayuda' }, icono('ℹ'), ' La información se guarda sólo en este dispositivo y funciona sin internet.'),
      ) : null,
      escuelas.length ? seccion('lista-escuelas', escuelas.length === 1 ? 'Tu escuela' : `Escuelas registradas (${escuelas.length})`, lista,
        borrador ? null : h('a', { class: 'boton boton--secundario', href: '#/asistente' }, icono('+'), ' Configurar otra escuela')) : null,
      seccion('modo-docente', 'Modo docente',
        h('p', {}, 'Si este dispositivo es de un docente, al abrir la aplicación verá su clase actual y podrá pasar lista con un toque.'),
        h('a', { class: 'boton boton--secundario', href: '#/perfil' }, 'Elegir docente de este dispositivo'),
      ),
      seccion('almacenamiento', 'Datos en este dispositivo',
        h('p', {}, estadoPersistencia),
        alm.usadoBytes !== null && alm.cuotaBytes !== null
          ? h('p', { class: 'ayuda' }, `Espacio usado por el sitio: ${formatoBytes(alm.usadoBytes)} de ${formatoBytes(alm.cuotaBytes)} disponibles.`)
          : null,
        h('p', { class: 'ayuda' },
          'Los datos se conservan al recargar, cerrar el navegador o perder la conexión. ',
          'Se pierden si borras los datos del navegador o cambias de dispositivo: descarga respaldos con regularidad.'),
        h('a', { class: 'boton boton--secundario', href: '#/respaldos' }, 'Respaldos'),
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
