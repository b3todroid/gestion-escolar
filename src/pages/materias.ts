import type { ContextoPagina, Vista } from '../app';
import { h } from '../components/dom';
import { alEnviar, areaTexto, botonEnviar, campo, ejecutar, formulario, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import type { CicloEscolar, Materia } from '../models';

function formularioMateria(ctx: ContextoPagina, ciclo: CicloEscolar, actual: Materia | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-materia';
  const form = formulario(f, actual ? `Editar ${actual.nombre}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre de la materia', valor: actual?.nombre, requerido: true, maxlength: 80 }),
    campo(f, { nombre: 'abreviatura', etiqueta: 'Abreviatura', valor: actual?.abreviatura, maxlength: 12, ayuda: 'Para vistas compactas del horario. Por ejemplo: MAT.' }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar materia')),
  );
  return alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), abreviatura: texto(form, 'abreviatura') };
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
  const panel = desplegable('Agregar una materia', false, cont);
  const alta = () => cont.replaceChildren(formularioMateria(ctx, ciclo, null, alta));
  alta();

  const fLote = 'f-lote';
  const formLote = alEnviar(formulario(fLote, null,
    areaTexto(fLote, { nombre: 'lote', etiqueta: 'Materias', requerido: true, filas: 6, ayuda: 'Escribe una materia por renglón, tal como aparecen en el plan de estudios de tu escuela.' }),
    h('div', { class: 'acciones' }, botonEnviar('Agregar materias')),
  ), async () => {
    const creadas = await ctx.s.materias.crearVarias(ciclo.id, texto(formLote, 'lote'));
    await ctx.recargar();
    return `${creadas.length} materia(s) agregada(s).`;
  });
  const panelLote = desplegable('Agregar varias a la vez', editable && materias.length === 0, formLote);

  return {
    titulo: `Materias del ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` }, { texto: 'Materias' }]),
      encabezado('Materias', `Ciclo ${ciclo.nombre}. Después asígnalas a cada grupo con su docente.`),
      seccion('lista-materias', `Materias del ciclo (${materias.length})`,
        materias.length
          ? h('ul', { class: 'renglones' }, ...materias.map((m) => h('li', { class: 'renglon' },
              h('span', { class: 'renglon__texto' }, m.nombre, m.abreviatura ? h('span', { class: 'renglon__sub' }, ` ${m.abreviatura}`) : null),
              editable ? h('span', { class: 'renglon__acciones' },
                botonAccion('Editar', () => { cont.replaceChildren(formularioMateria(ctx, ciclo, m, alta)); panel.open = true; cont.querySelector('input')?.focus(); }, 'secundario', `Editar ${m.nombre}`),
                botonAccion('Eliminar', async () => {
                  const ok = await confirmar({ titulo: `¿Eliminar ${m.nombre}?`, mensaje: 'Sólo se puede eliminar si ningún grupo la tiene asignada.', textoConfirmar: 'Eliminar', peligro: true });
                  if (ok && await ejecutar(async () => { await ctx.s.materias.eliminar(m.id); return `${m.nombre} eliminada.`; })) await ctx.recargar();
                }, 'peligro', `Eliminar ${m.nombre}`),
              ) : null,
            )))
          : vacio('Sin materias. Captúralas una vez para todo el ciclo.'),
        editable ? panelLote : null,
        editable ? panel : null,
      ),
      h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}` }, 'Volver al ciclo'),
    ),
  };
}
