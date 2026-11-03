import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { formatoDuracion } from '../domain/tiempo';
import { ETIQUETA_CONFLICTO, type ReporteHorarios } from '../services/revisionHorarios';
import { ETIQUETA_ESTADO } from '../services/ciclos';
import { cicloVigente } from './catalogos';

/** Turno elegido por ciclo (se conserva al volver a la pantalla). */
const turnoPorCiclo = new Map<string, string>();

/** #/horarios — elegir escuela y ciclo. */
export async function paginaHorariosInicio(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const tarjetas = [];
  for (const e of escuelas) {
    const ciclos = await ctx.s.ciclos.listar(e.id);
    const vigente = await cicloVigente(ctx, e.id);
    tarjetas.push(h('li', { class: 'tarjeta' },
      h('h3', {}, e.nombreCorto ?? e.nombre),
      ciclos.length
        ? h('ul', { class: 'renglones' }, ...ciclos.map((c) => h('li', { class: 'renglon' },
            h('a', { href: `#/ciclo/${c.id}/horarios`, class: 'renglon__texto' }, `Ciclo ${c.nombre}`),
            insignia(c.id === vigente?.id ? `${ETIQUETA_ESTADO[c.estado]} · vigente` : ETIQUETA_ESTADO[c.estado], c.id === vigente?.id ? 'ok' : 'neutro', c.id === vigente?.id ? '●' : '○'))))
        : vacio('Sin ciclos escolares.'),
    ));
  }
  return {
    titulo: 'Horarios',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Horarios' }]),
      encabezado('Horarios', 'Elige la escuela y el ciclo escolar. Cada ciclo tiene sus propios horarios.'),
      escuelas.length ? h('ul', { class: 'tarjetas' }, ...tarjetas) : vacio('Primero configura una escuela.'),
    ),
  };
}

/** #/ciclo/ID/horarios — turno, grupo o docente, reportes y conflictos pendientes. */
export async function paginaHorariosCiclo(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const escuelas = await ctx.s.escuelas.listar();
  const ciclos = await ctx.s.ciclos.listar(escuela.id);
  const turnos = await ctx.s.turnos.listar(cicloId);
  let turnoId = turnoPorCiclo.get(cicloId) ?? (turnos.length === 1 ? turnos[0]!.turno.id : '');
  if (turnoId && !turnos.some((t) => t.turno.id === turnoId)) turnoId = '';
  const r: ReporteHorarios = await ctx.s.revisionHorarios.reporte(cicloId, turnoId || null);

  // ---------- Selección ----------
  const selEscuela = h('select', { id: 'sel-escuela', onchange: async () => {
    const c = await cicloVigente(ctx, selEscuela.value);
    ctx.ir(c ? `#/ciclo/${c.id}/horarios` : `#/escuela/${selEscuela.value}`);
  } }, ...escuelas.map((e) => h('option', { value: e.id, selected: e.id === escuela.id }, e.nombreCorto ?? e.nombre)));
  const selCiclo = h('select', { id: 'sel-ciclo', onchange: () => ctx.ir(`#/ciclo/${selCiclo.value}/horarios`) },
    ...ciclos.map((c) => h('option', { value: c.id, selected: c.id === ciclo.id }, `${c.nombre} (${ETIQUETA_ESTADO[c.estado].toLowerCase()})`)));
  const selTurno = h('select', { id: 'sel-turno', onchange: () => { turnoPorCiclo.set(cicloId, selTurno.value); void ctx.recargar('#sel-turno'); } },
    turnos.length > 1 ? h('option', { value: '' }, 'Todos los turnos') : null,
    ...turnos.map((t) => h('option', { value: t.turno.id, selected: t.turno.id === turnoId }, t.turno.nombre)));
  const selGrupo = h('select', { id: 'sel-grupo' }, h('option', { value: '' }, 'Selecciona…'), ...r.grupos.map((g) => h('option', { value: g.grupoId }, `${g.nombre}${turnos.length > 1 && !turnoId ? ` (${g.turno})` : ''}${g.activo ? '' : ' (desactivado)'}`)));
  const selDocente = h('select', { id: 'sel-docente' }, h('option', { value: '' }, 'Selecciona…'), ...r.docentes.map((d) => h('option', { value: d.personalId }, d.nombre)));
  const ver = (sel: HTMLSelectElement, ruta: (id: string) => string) => () => { if (sel.value) ctx.ir(ruta(sel.value)); else sel.focus(); };

  // ---------- Reportes ----------
  const totalesGrupo = r.grupos.reduce((a, g) => ({ asignadas: a.asignadas + g.horasAsignadas, programadas: a.programadas + g.horasProgramadas, sin: a.sin + g.periodosSinInformacion }), { asignadas: 0, programadas: 0, sin: 0 });
  const totalSe = r.docentes.reduce((a, d) => a + d.seConfirmadas, 0);
  const listaGrupos = r.grupos.length
    ? h('ul', { class: 'tarjetas tarjetas--compactas' }, ...r.grupos.map((g) => h('li', { class: `tarjeta${g.activo ? '' : ' tarjeta--baja'}`, 'data-grupo': g.grupoId },
        h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, h('a', { href: `#/grupo/${g.grupoId}`, class: 'tarjeta__enlace' }, g.nombre)),
          g.conflictos ? insignia(`${g.conflictos} conflicto(s)`, 'aviso', '⚠') : g.confirmado ? insignia('Confirmado', 'ok', '✓') : insignia('Sin confirmar', 'neutro', '◇')),
        h('p', { class: 'tarjeta__meta' }, `Turno ${g.turno}`),
        h('dl', { class: 'datos datos--compacto' },
          h('dt', {}, 'Horas asignadas'), h('dd', {}, String(g.horasAsignadas)),
          h('dt', {}, 'En el horario'), h('dd', {}, `${g.horasProgramadas}${g.docentePendiente ? ` (${g.docentePendiente} sin docente)` : ''}`),
          h('dt', {}, 'Otras actividades'), h('dd', {}, String(g.otrasActividades)),
          h('dt', {}, 'Sin información'), h('dd', {}, `${g.periodosSinInformacion} de ${g.periodosTotales} periodos`),
        ))))
    : vacio('No hay grupos en este turno.');
  const listaDocentes = r.docentes.length
    ? h('ul', { class: 'tarjetas tarjetas--compactas' }, ...r.docentes.map((d) => h('li', { class: `tarjeta${d.activo ? '' : ' tarjeta--baja'}`, 'data-docente': d.personalId },
        h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, h('a', { href: `#/personal/${d.personalId}/ciclo/${cicloId}`, class: 'tarjeta__enlace' }, d.nombre)),
          d.conflictos ? insignia(`${d.conflictos} conflicto(s)`, 'aviso', '⚠') : null),
        h('dl', { class: 'datos datos--compacto' },
          h('dt', {}, 'Clases'), h('dd', {}, `${d.horasClase} periodo(s), ${formatoDuracion(d.minutosClase)}`),
          h('dt', {}, 'Grupos'), h('dd', {}, d.grupos.join(', ') || 'Ninguno'),
          h('dt', {}, 'Materias'), h('dd', {}, d.materias.join(', ') || 'Ninguna'),
          h('dt', {}, 'Horas SE'), h('dd', {}, `${d.seConfirmadas} confirmada(s)${d.sePorConfirmar ? `, ${d.sePorConfirmar} por confirmar` : ''}`),
          d.otrasActividades ? h('dt', {}, 'Otras actividades') : null, d.otrasActividades ? h('dd', {}, String(d.otrasActividades)) : null,
        ))))
    : vacio('No hay docentes activos.');

  const conflictos = h('div', {});
  reemplazar(conflictos, r.conflictos.length
    ? h('ul', { class: 'renglones', id: 'lista-conflictos' }, ...r.conflictos.map((c) => h('li', { class: 'renglon renglon--bloque renglon--conflicto' },
        insignia(ETIQUETA_CONFLICTO[c.tipo], 'aviso', '⚠'),
        h('span', { class: 'renglon__texto' }, c.mensaje),
        c.grupoId ? h('a', { href: `#/grupo/${c.grupoId}`, class: 'no-imprimir' }, 'Ver grupo') : c.personalId ? h('a', { href: `#/personal/${c.personalId}/ciclo/${cicloId}`, class: 'no-imprimir' }, 'Ver docente') : null)))
    : h('p', { class: 'mensaje', id: 'sin-conflictos' }, icono('✓'), ' Sin conflictos pendientes.'));

  return {
    titulo: `Horarios, ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Horarios', href: '#/horarios' }, { texto: `${escuela.nombreCorto ?? escuela.nombre}, ciclo ${ciclo.nombre}` }]),
      encabezado('Horarios', `${escuela.nombre}${escuela.cct ? ` (${escuela.cct})` : ''} · Ciclo ${ciclo.nombre}`),
      seccion('seleccion', 'Selección',
        h('div', { class: 'filtros no-imprimir' },
          escuelas.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'sel-escuela' }, 'Escuela'), selEscuela) : null,
          h('div', { class: 'campo' }, h('label', { for: 'sel-ciclo' }, 'Ciclo escolar'), selCiclo),
          turnos.length ? h('div', { class: 'campo' }, h('label', { for: 'sel-turno' }, 'Turno'), selTurno) : null,
        ),
        turnos.length ? h('div', { class: 'filtros no-imprimir' },
          h('div', { class: 'campo' }, h('label', { for: 'sel-grupo' }, 'Horario de un grupo'), selGrupo,
            h('button', { type: 'button', class: 'boton', onclick: ver(selGrupo, (id) => `#/grupo/${id}`) }, 'Ver horario del grupo')),
          h('div', { class: 'campo' }, h('label', { for: 'sel-docente' }, 'Horario de un docente'), selDocente,
            h('button', { type: 'button', class: 'boton', onclick: ver(selDocente, (id) => `#/personal/${id}/ciclo/${cicloId}`) }, 'Ver horario del docente')),
        ) : vacio('Este ciclo todavía no tiene turnos. Configúralos en el ciclo escolar.'),
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Los horarios por grupo y por docente salen de las mismas clases registradas: no hay copias separadas.'),
      ),
      seccion('resumen-horarios', 'Resumen',
        h('dl', { class: 'totales totales--5', id: 'totales-horarios' },
          h('div', {}, h('dt', {}, 'Horas asignadas'), h('dd', {}, String(totalesGrupo.asignadas))),
          h('div', {}, h('dt', {}, 'Clases en el horario'), h('dd', {}, String(totalesGrupo.programadas))),
          h('div', {}, h('dt', {}, 'Horas SE confirmadas'), h('dd', {}, String(totalSe))),
          h('div', {}, h('dt', {}, 'Periodos sin información'), h('dd', {}, String(totalesGrupo.sin))),
          h('div', {}, h('dt', {}, 'Conflictos pendientes'), h('dd', {}, String(r.conflictos.length))),
        ),
        h('div', { class: 'acciones acciones--izq no-imprimir' },
          h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => window.print() }, 'Imprimir reporte'),
          h('a', { class: 'boton boton--secundario', href: `#/ciclo/${cicloId}/importar-datos` }, 'Importar horarios desde Excel'),
        ),
      ),
      seccion('conflictos-pendientes', `Conflictos pendientes (${r.conflictos.length})`,
        conflictos,
        r.conflictos.length ? h('p', { class: 'ayuda' }, icono('ℹ'), ' La aplicación no corrige horarios por su cuenta: revisa cada caso y ajústalo en el grupo o docente correspondiente.') : null),
      seccion('horarios-grupos', `Horas por grupo (${r.grupos.length})`, listaGrupos),
      seccion('horarios-docentes', `Horas por docente (${r.docentes.length})`, listaDocentes),
    ),
  };
}
