import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { alEnviar, areaTexto, botonEnviar, campo, ejecutar, formulario, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import { TIPOS_MATERIA, type CicloEscolar, type Materia, type TipoMateria } from '../models';
import { ETIQUETA_TIPO_MATERIA } from '../services/materias';
import { SUGERENCIAS_SECUNDARIA } from '../domain/catalogos';
import { normalizarTexto } from '../domain/texto';
import { navCatalogos } from './catalogos';

const OPCIONES_TIPO = TIPOS_MATERIA.map((t) => ({ valor: t, texto: ETIQUETA_TIPO_MATERIA[t] }));

function formularioMateria(ctx: ContextoPagina, ciclo: CicloEscolar, actual: Materia | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-materia';
  const form = formulario(f, actual ? `Editar ${actual.nombre}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre', valor: actual?.nombre, requerido: true, maxlength: 80 }),
    selector(f, { nombre: 'tipo', etiqueta: 'Tipo', requerido: true, valor: actual?.tipo ?? 'materia', opciones: OPCIONES_TIPO }),
    campo(f, { nombre: 'abreviatura', etiqueta: 'Abreviatura', valor: actual?.abreviatura, maxlength: 12, ayuda: 'Para vistas compactas del horario. Por ejemplo: MAT.' }),
    h('p', { class: 'ayuda' }, icono('ℹ'), ' «Horas de servicio (SE)» es un tipo de actividad del docente: no se asigna a grupos.'),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar materia')),
  );
  return alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), abreviatura: texto(form, 'abreviatura'), tipo: (texto(form, 'tipo') || undefined) as TipoMateria | undefined };
    if (actual) {
      await ctx.s.materias.actualizar(actual.id, entrada);
      await ctx.recargar();
      return 'Materia actualizada.';
    }
    const m = await ctx.s.materias.crear(ciclo.id, entrada);
    await ctx.recargar('#f-materia-nombre');
    return `${m.nombre} agregada.`;
  });
}

export async function paginaMaterias(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const materias = await ctx.s.materias.listar(cicloId);
  const editable = ciclo.estado !== 'cerrado';

  const cont = h('div', {});
  const panel = desplegable('Agregar una materia o actividad', false, cont);
  const alta = () => reemplazar(cont, formularioMateria(ctx, ciclo, null, alta));
  alta();

  const fLote = 'f-lote';
  const formLote = alEnviar(formulario(fLote, null,
    areaTexto(fLote, { nombre: 'lote', etiqueta: 'Materias', requerido: true, filas: 6, ayuda: 'Escribe una por renglón, tal como aparecen en el plan de estudios de tu escuela.' }),
    selector(fLote, { nombre: 'tipo', etiqueta: 'Tipo de todas', valor: 'materia', opciones: OPCIONES_TIPO }),
    h('div', { class: 'acciones' }, botonEnviar('Agregar materias')),
  ), async () => {
    const creadas = await ctx.s.materias.crearVarias(ciclo.id, texto(formLote, 'lote'), (texto(formLote, 'tipo') || 'materia') as TipoMateria);
    await ctx.recargar();
    return `${creadas.length} materia(s) agregada(s).`;
  });
  const panelLote = desplegable('Agregar varias a la vez', editable && materias.length === 0, formLote);

  // Sugerencias para secundaria: sólo se agregan si la persona las elige.
  const registradas = new Set(materias.map((m) => normalizarTexto(m.nombre)));
  const pendientes = SUGERENCIAS_SECUNDARIA.filter((s) => !registradas.has(normalizarTexto(s.nombre)));
  const sugerencias = escuela.nivel === 'secundaria' && editable && pendientes.length
    ? desplegable(`Sugerencias para secundaria (${pendientes.length})`, false,
        h('p', { class: 'ayuda' }, 'Opcionales. Agrega sólo las que correspondan a tu plan de estudios; ninguna se registra sola.'),
        h('ul', { class: 'sugerencias' }, ...pendientes.map((s) => h('li', {},
          botonAccion(`+ ${s.nombre}`, async () => {
            if (await ejecutar(async () => { await ctx.s.materias.crear(ciclo.id, { nombre: s.nombre, tipo: s.tipo }); return `${s.nombre} agregada.`; })) await ctx.recargar();
          }, 'secundario', `Agregar ${s.nombre} (${ETIQUETA_TIPO_MATERIA[s.tipo].toLowerCase()})`)))))
    : null;

  const renglon = (m: Materia) => {
    const activa = m.activo !== false;
    return h('li', { class: `renglon${activa ? '' : ' renglon--inactivo'}` },
      h('span', { class: 'renglon__texto' }, m.nombre,
        h('span', { class: 'renglon__sub' }, ` ${[ETIQUETA_TIPO_MATERIA[m.tipo ?? 'materia'], m.abreviatura].filter(Boolean).join(' · ')}`),
        activa ? null : h('span', {}, ' ', insignia('Desactivada', 'neutro', '■'))),
      editable ? h('span', { class: 'renglon__acciones' },
        botonAccion('Editar', () => { reemplazar(cont, formularioMateria(ctx, ciclo, m, alta)); panel.open = true; cont.querySelector('input')?.focus(); }, 'secundario', `Editar ${m.nombre}`),
        botonAccion(activa ? 'Desactivar' : 'Activar', async () => {
          if (activa && !(await confirmar({ titulo: `¿Desactivar ${m.nombre}?`, mensaje: 'Se conservan sus asignaciones y su historial; sólo deja de ofrecerse para asignaciones nuevas.', textoConfirmar: 'Desactivar' }))) return;
          if (await ejecutar(async () => { await ctx.s.materias.cambiarActivo(m.id, !activa); return activa ? `${m.nombre} desactivada.` : `${m.nombre} activada.`; })) await ctx.recargar();
        }, 'secundario', `${activa ? 'Desactivar' : 'Activar'} ${m.nombre}`),
        botonAccion('Eliminar', async () => {
          const ok = await confirmar({ titulo: `¿Eliminar ${m.nombre}?`, mensaje: 'Sólo se puede eliminar si ningún grupo la tiene asignada. Para conservarla en el historial, mejor desactívala.', textoConfirmar: 'Eliminar', peligro: true });
          if (ok && await ejecutar(async () => { await ctx.s.materias.eliminar(m.id); return `${m.nombre} eliminada.`; })) await ctx.recargar();
        }, 'peligro', `Eliminar ${m.nombre}`),
      ) : null,
    );
  };

  const lista = h('div', { 'aria-live': 'polite' });
  const buscador = h('input', { id: 'buscar-materia', type: 'search', autocomplete: 'off' });
  const selTipo = h('select', { id: 'filtro-tipo' }, h('option', { value: '' }, 'Todos'), ...OPCIONES_TIPO.map((o) => h('option', { value: o.valor }, o.texto)));
  const selEstado = h('select', { id: 'filtro-estado-materia' }, h('option', { value: 'todas' }, 'Todas'), h('option', { value: 'activas' }, 'Activas'), h('option', { value: 'inactivas' }, 'Desactivadas'));
  const filtrar = async () => {
    let r = await ctx.s.materias.listar(cicloId, { texto: buscador.value, tipo: (selTipo.value || null) as TipoMateria | null, soloActivas: selEstado.value === 'activas' });
    if (selEstado.value === 'inactivas') r = r.filter((m) => m.activo === false);
    const filtrado = !!(buscador.value.trim() || selTipo.value || selEstado.value !== 'todas');
    reemplazar(lista,
      filtrado ? h('p', { class: 'ayuda' }, `${r.length} de ${materias.length}.`) : null,
      r.length ? h('ul', { class: 'renglones' }, ...r.map(renglon)) : vacio(materias.length ? 'Ninguna coincide con la búsqueda o los filtros.' : 'Sin materias. Captúralas una vez para todo el ciclo.'),
    );
  };
  for (const el of [buscador, selTipo, selEstado]) el.addEventListener(el === buscador ? 'input' : 'change', () => void filtrar());
  await filtrar();

  const activas = materias.filter((m) => m.activo !== false);
  return {
    titulo: `Materias del ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` }, { texto: 'Materias' }]),
      encabezado('Materias y actividades', `Ciclo ${ciclo.nombre}. Después asígnalas a cada grupo con su docente.`),
      navCatalogos(escuela.id, cicloId, 'materias'),
      seccion('lista-materias', `Materias del ciclo (${materias.length})`,
        materias.length ? h('p', { class: 'ayuda' }, `${activas.length} activa(s); ${TIPOS_MATERIA.map((t) => [t, activas.filter((m) => m.tipo === t).length] as const).filter(([, n]) => n).map(([t, n]) => `${ETIQUETA_TIPO_MATERIA[t].toLowerCase()}: ${n}`).join(', ')}.`) : null,
        materias.length ? h('div', { class: 'filtros' },
          h('div', { class: 'campo' }, h('label', { for: 'buscar-materia' }, 'Buscar'), buscador),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-tipo' }, 'Tipo'), selTipo),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-estado-materia' }, 'Estado'), selEstado),
        ) : null,
        lista,
        editable ? panelLote : null,
        editable ? panel : null,
        sugerencias,
      ),
      h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}` }, 'Volver al ciclo'),
    ),
  };
}
