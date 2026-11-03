import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { ejecutar } from '../components/formulario';
import { encabezado, migas, seccion, vacio } from '../components/piezas';
import { nombreCompleto } from '../services/personal';

/** Elegir qué docente usa este dispositivo. No es autenticación. */
export async function paginaPerfil(ctx: ContextoPagina): Promise<Vista> {
  const actual = await ctx.s.panel.perfil();
  const escuelas = await ctx.s.escuelas.listar();
  const grupos = await Promise.all(escuelas.map(async (e) => ({ e, docentes: await ctx.s.personal.docentes(e.id) })));
  const hay = grupos.some((g) => g.docentes.length);
  return {
    titulo: 'Modo docente',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Escuelas', href: '#/escuelas' }, { texto: 'Modo docente' }]),
      encabezado('¿Quién usa este dispositivo?', 'Al abrir la aplicación verás tu clase actual y podrás pasar lista con un toque.'),
      h('p', { class: 'mensaje' }, icono('ℹ'), ' Esto no es una cuenta ni una contraseña: es una preferencia de este dispositivo. Cualquiera que lo use puede cambiarla. Los permisos reales llegarán con la versión institucional.'),
      hay ? null : vacio('No hay docentes activos registrados. Regístralos en la sección Personal de la escuela.'),
      ...grupos.filter((g) => g.docentes.length).map(({ e, docentes }) => seccion(`perfil-${e.id}`, e.nombre,
        h('ul', { class: 'renglones' }, ...docentes.map((d) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, nombreCompleto(d), actual?.id === d.id ? h('span', { class: 'renglon__sub' }, ' (actual)') : null),
          h('button', {
            type: 'button', class: `boton boton--chico${actual?.id === d.id ? ' boton--secundario' : ''}`, disabled: actual?.id === d.id,
            onclick: async () => { if (await ejecutar(async () => { await ctx.s.panel.fijarPerfil(d.id); return `Este dispositivo ahora es de ${nombreCompleto(d)}.`; })) ctx.ir('#/'); },
          }, actual?.id === d.id ? 'Seleccionado' : 'Soy yo'),
        ))),
      )),
      actual ? h('button', {
        type: 'button', class: 'boton boton--secundario',
        onclick: async () => { if (await ejecutar(async () => { await ctx.s.panel.fijarPerfil(null); return 'Modo docente desactivado en este dispositivo.'; })) ctx.ir('#/escuelas'); },
      }, 'Dejar de usar como docente') : null,
    ),
  };
}
