import type { ContextoPagina, Vista } from '../app';
import { h } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { DIAS_SEMANA } from '../services/turnos';
import { ETIQUETA_FUNCION, nombreCompleto } from '../services/personal';
import { duracionMinutos, formatoDuracion } from '../domain/tiempo';

export async function paginaDocente(ctx: ContextoPagina, personalId: string): Promise<Vista> {
  const p = await ctx.s.personal.obtener(personalId);
  const escuela = await ctx.s.escuelas.obtener(p.escuelaId);
  const ciclos = await ctx.s.ciclos.listar(escuela.id);
  const ciclo = ciclos.find((c) => c.estado === 'activo') ?? ciclos.find((c) => c.estado === 'planeacion') ?? ciclos[0];
  const clases = ciclo ? await ctx.s.asignaciones.horarioDocente(p.id, ciclo.id) : [];
  const minutos = clases.reduce((s, c) => s + duracionMinutos(c.horaInicio, c.horaFin), 0);

  const porDia = DIAS_SEMANA.map((d) => ({ d, lista: clases.filter((c) => c.dia === d.valor) })).filter((x) => x.lista.length);

  return {
    titulo: nombreCompleto(p),
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Personal', href: `#/escuela/${escuela.id}/personal` }, { texto: nombreCompleto(p) }]),
      encabezado(nombreCompleto(p), p.funciones.map((f) => ETIQUETA_FUNCION[f]).join(', ')),
      p.activo ? null : h('p', {}, insignia('Dado(a) de baja', 'neutro', '■')),
      seccion('semana-docente', ciclo ? `Horario en el ciclo ${ciclo.nombre}` : 'Horario',
        clases.length ? h('p', { class: 'asistente__dato' }, `${clases.length} clases por semana (${formatoDuracion(minutos)}).`) : null,
        porDia.length
          ? h('div', { class: 'semana' }, ...porDia.map(({ d, lista }) => h('section', { class: 'semana__dia', 'aria-label': d.nombre },
              h('h3', {}, d.nombre),
              h('ul', { class: 'renglones' }, ...lista.map((c) => h('li', { class: 'renglon' },
                h('span', { class: 'celda__hora' }, `${c.horaInicio}–${c.horaFin}`),
                h('span', { class: 'renglon__texto' }, h('a', { href: `#/grupo/${c.grupoId}` }, c.grupo), ` ${c.materia}`),
              ))),
            )))
          : vacio(p.funciones.includes('docente') ? 'Sin clases programadas. Se asignan desde la pantalla de cada grupo.' : 'Esta persona no tiene la función de docente.'),
      ),
    ),
  };
}
