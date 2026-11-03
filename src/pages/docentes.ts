import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { alEnviar, botonEnviar, casillas, formulario, marcados } from '../components/formulario';
import { botonAccion, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import type { Adscripcion, Materia, Personal } from '../models';
import { nombreCompleto } from '../services/personal';
import { ETIQUETA_TIPO_MATERIA } from '../services/materias';
import { navCatalogos } from './catalogos';

/**
 * Docentes: vista del catálogo de PERSONAL filtrado por función docente (no es
 * otra tabla). Por ciclo se registran los turnos y las materias que PUEDE
 * impartir; eso no crea asignaciones a grupos ni horarios.
 */
export async function paginaDocentes(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const docentes = (await ctx.s.personal.listar(escuela.id)).filter((p) => p.funciones.includes('docente'));
  const turnos = await ctx.s.turnos.listar(cicloId);
  const materias = await ctx.s.materias.listar(cicloId);
  const impartibles = materias.filter((m) => m.activo !== false && m.tipo !== 'servicio');
  const ads = await ctx.s.personal.adscripcionesCiclo(cicloId);
  const asignadas = await ctx.s.asignaciones.conteoPorDocente(cicloId);
  const editable = ciclo.estado !== 'cerrado';
  const nombreMateria = (id: string) => materias.find((m) => m.id === id)?.nombre ?? 'Materia eliminada';
  const nombreTurno = (id: string) => turnos.find((t) => t.turno.id === id)?.turno.nombre ?? '';

  const formAdscripcion = (p: Personal, a: Adscripcion | undefined, cont: HTMLElement) => {
    const f = `f-ads-${p.id.slice(0, 8)}`;
    // Conserva materias ya marcadas aunque después se hayan desactivado.
    const opciones: Materia[] = [...impartibles, ...materias.filter((m) => a?.materiaIds.includes(m.id) && !impartibles.includes(m))];
    const form = formulario(f, `Materias y turnos de ${nombreCompleto(p)}`,
      turnos.length ? casillas(f, { nombre: 'turnos', leyenda: 'Turnos', opciones: turnos.map((t) => ({ valor: t.turno.id, texto: t.turno.nombre })), marcados: a?.turnoIds ?? [] }) : null,
      opciones.length
        ? casillas(f, { nombre: 'materias', leyenda: 'Materias que puede impartir', opciones: opciones.map((m) => ({ valor: m.id, texto: `${m.nombre}${m.tipo !== 'materia' ? ` (${ETIQUETA_TIPO_MATERIA[m.tipo].toLowerCase()})` : ''}${m.activo === false ? ' (desactivada)' : ''}` })), marcados: a?.materiaIds ?? [] })
        : h('p', {}, 'Todavía no hay materias activas en el ciclo. ', h('a', { href: `#/ciclo/${cicloId}/materias` }, 'Registrar materias')),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Esto no asigna grupos ni crea horarios: sólo indica qué puede impartir.'),
      h('div', { class: 'acciones' }, botonAccion('Cancelar', () => reemplazar(cont)), botonEnviar('Guardar')),
    );
    return alEnviar(form, async () => {
      await ctx.s.personal.fijarAdscripcion(p.id, cicloId, { turnoIds: marcados(form, 'turnos'), materiaIds: marcados(form, 'materias') });
      await ctx.recargar();
      return `Datos de ${nombreCompleto(p)} guardados.`;
    });
  };

  const tarjeta = (p: Personal) => {
    const a = ads.get(p.id);
    const cont = h('div', {});
    const n = asignadas.get(p.id) ?? 0;
    return h('li', { class: `tarjeta${p.activo ? '' : ' tarjeta--baja'}`, 'data-docente': p.id },
      h('div', { class: 'tarjeta__cabeza' },
        h('h3', {}, h('a', { href: `#/personal/${p.id}`, class: 'tarjeta__enlace' }, nombreCompleto(p))),
        p.activo ? insignia('Activo', 'ok', '●') : insignia('Baja', 'neutro', '■'),
      ),
      p.numeroEmpleado ? h('p', { class: 'tarjeta__meta' }, `Identificador: ${p.numeroEmpleado}`) : null,
      h('dl', { class: 'datos datos--compacto' },
        h('dt', {}, 'Turnos'), h('dd', {}, a?.turnoIds.length ? a.turnoIds.map(nombreTurno).join(', ') : 'Sin registrar'),
        h('dt', {}, 'Puede impartir'), h('dd', {}, a?.materiaIds.length ? a.materiaIds.map(nombreMateria).join(', ') : 'Sin registrar'),
        h('dt', {}, 'Asignaciones a grupos'), h('dd', {}, n ? `${n} en este ciclo` : 'Ninguna'),
        p.observaciones ? h('dt', {}, 'Observaciones') : null, p.observaciones ? h('dd', {}, p.observaciones) : null,
      ),
      editable && p.activo ? h('div', { class: 'acciones acciones--izq' },
        botonAccion('Materias y turnos', () => { reemplazar(cont, formAdscripcion(p, a, cont)); cont.querySelector('input')?.focus(); }, 'secundario', `Editar materias y turnos de ${nombreCompleto(p)}`)) : null,
      cont,
    );
  };

  const lista = h('div', { 'aria-live': 'polite' });
  const buscador = h('input', { id: 'buscar-docente', type: 'search', autocomplete: 'off', placeholder: 'Nombre o identificador' });
  const selMateria = h('select', { id: 'filtro-materia' }, h('option', { value: '' }, 'Todas'), ...impartibles.map((m) => h('option', { value: m.id }, m.nombre)));
  const selTurno = h('select', { id: 'filtro-turno-docente' }, h('option', { value: '' }, 'Todos'), ...turnos.map((t) => h('option', { value: t.turno.id }, t.turno.nombre)));
  const selEstado = h('select', { id: 'filtro-estado-docente' }, h('option', { value: 'activos' }, 'Activos'), h('option', { value: 'todos' }, 'Todos'), h('option', { value: 'inactivos' }, 'Dados de baja'));
  const filtrar = async () => {
    const r = await ctx.s.personal.buscar(escuela.id, { funcion: 'docente', texto: buscador.value, estado: selEstado.value as 'activos', turnoId: selTurno.value || null, cicloId });
    const filtrados = selMateria.value ? r.filter((p) => ads.get(p.id)?.materiaIds.includes(selMateria.value)) : r;
    reemplazar(lista,
      h('p', { class: 'ayuda', id: 'conteo-docentes' }, `${filtrados.length} docente(s) mostrados.`),
      filtrados.length ? h('ul', { class: 'tarjetas' }, ...filtrados.map(tarjeta)) : vacio(docentes.length ? 'Ningún docente coincide con la búsqueda o los filtros.' : 'Aún no hay personal con función docente.'),
    );
  };
  for (const el of [buscador, selMateria, selTurno, selEstado]) el.addEventListener(el === buscador ? 'input' : 'change', () => void filtrar());
  await filtrar();

  const activos = docentes.filter((p) => p.activo);
  return {
    titulo: `Docentes del ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Docentes' }]),
      encabezado('Docentes', `Ciclo ${ciclo.nombre}. Personal con función docente; se agrega o edita en Personal.`),
      navCatalogos(escuela.id, cicloId, 'docentes'),
      h('dl', { class: 'totales' },
        h('div', {}, h('dt', {}, 'Docentes activos'), h('dd', {}, String(activos.length))),
        h('div', {}, h('dt', {}, 'Con materias registradas'), h('dd', {}, String(activos.filter((p) => ads.get(p.id)?.materiaIds.length).length))),
        h('div', {}, h('dt', {}, 'Con asignaciones'), h('dd', {}, String(activos.filter((p) => asignadas.get(p.id)).length))),
      ),
      seccion('lista-docentes', 'Docentes',
        docentes.length ? h('div', { class: 'filtros' },
          h('div', { class: 'campo' }, h('label', { for: 'buscar-docente' }, 'Buscar'), buscador),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-materia' }, 'Puede impartir'), selMateria),
          turnos.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'filtro-turno-docente' }, 'Turno'), selTurno) : null,
          h('div', { class: 'campo' }, h('label', { for: 'filtro-estado-docente' }, 'Estado'), selEstado),
        ) : null,
        lista,
        h('a', { class: 'boton boton--secundario', href: `#/escuela/${escuela.id}/personal` }, 'Agregar o editar personal'),
      ),
    ),
  };
}
