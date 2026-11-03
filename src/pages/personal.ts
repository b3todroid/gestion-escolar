import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, casillas, ejecutar, formulario, marcados, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import { FUNCIONES_PERSONAL, type Escuela, type FuncionPersonal, type Personal } from '../models';
import { ETIQUETA_FUNCION, nombreCompleto } from '../services/personal';

function formularioPersona(ctx: ContextoPagina, escuela: Escuela, actual: Personal | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-persona';
  const form = formulario(f, actual ? `Editar a ${nombreCompleto(actual)}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre(s)', valor: actual?.nombre, requerido: true, maxlength: 60, autocompletar: 'off' }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'primerApellido', etiqueta: 'Primer apellido', valor: actual?.primerApellido, requerido: true, maxlength: 60 }),
      campo(f, { nombre: 'segundoApellido', etiqueta: 'Segundo apellido', valor: actual?.segundoApellido, maxlength: 60 }),
    ),
    campo(f, { nombre: 'numeroEmpleado', etiqueta: 'Número de empleado', valor: actual?.numeroEmpleado, maxlength: 20, mayusculas: true, ayuda: 'Distingue a personas con el mismo nombre.' }),
    casillas(f, { nombre: 'funciones', leyenda: 'Funciones', opciones: FUNCIONES_PERSONAL.map((x) => ({ valor: x, texto: ETIQUETA_FUNCION[x] })), marcados: actual?.funciones ?? ['docente'] }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar persona')),
  );
  return alEnviar(form, async () => {
    const entrada = {
      nombre: texto(form, 'nombre'), primerApellido: texto(form, 'primerApellido'), segundoApellido: texto(form, 'segundoApellido'),
      numeroEmpleado: texto(form, 'numeroEmpleado'), funciones: marcados(form, 'funciones') as FuncionPersonal[],
    };
    if (actual) {
      await ctx.s.personal.actualizar(actual.id, entrada);
      await ctx.recargar();
      return 'Datos actualizados.';
    }
    const p = await ctx.s.personal.crear(escuela.id, entrada);
    await ctx.recargar('#f-persona-nombre');
    return `${nombreCompleto(p)} agregado(a).`;
  });
}

export async function paginaPersonal(ctx: ContextoPagina, escuelaId: string): Promise<Vista> {
  const escuela = await ctx.s.escuelas.obtener(escuelaId);
  const lista = await ctx.s.personal.listar(escuelaId);

  const cont = h('div', {});
  const panel = desplegable('Agregar persona', lista.length === 0, cont);
  const alta = () => cont.replaceChildren(formularioPersona(ctx, escuela, null, alta));
  alta();

  const fila = (p: Personal) => h('li', { class: `tarjeta${p.activo ? '' : ' tarjeta--baja'}` },
    h('div', { class: 'tarjeta__cabeza' },
      h('h3', {}, h('a', { href: `#/personal/${p.id}`, class: 'tarjeta__enlace' }, nombreCompleto(p))),
      p.activo ? null : insignia('Baja', 'neutro', '■'),
    ),
    h('p', { class: 'tarjeta__meta' }, [p.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', '), p.numeroEmpleado ? `núm. ${p.numeroEmpleado}` : null].filter(Boolean).join('; ')),
    h('div', { class: 'acciones acciones--izq' },
      botonAccion('Editar', () => {
        cont.replaceChildren(formularioPersona(ctx, escuela, p, alta));
        panel.open = true;
        cont.querySelector('input')?.focus();
      }, 'secundario', `Editar a ${nombreCompleto(p)}`),
      botonAccion(p.activo ? 'Dar de baja' : 'Reactivar', async () => {
        if (p.activo && !(await confirmar({ titulo: `¿Dar de baja a ${nombreCompleto(p)}?`, mensaje: 'Se conserva su historial, pero ya no aparecerá para asignarle materias. Puedes reactivarla después.', textoConfirmar: 'Dar de baja' }))) return;
        if (await ejecutar(async () => { await ctx.s.personal.cambiarActivo(p.id, !p.activo); return p.activo ? 'Persona dada de baja.' : 'Persona reactivada.'; })) await ctx.recargar();
      }, 'secundario', `${p.activo ? 'Dar de baja' : 'Reactivar'} a ${nombreCompleto(p)}`),
      botonAccion('Eliminar', async () => {
        const ok = await confirmar({ titulo: `¿Eliminar a ${nombreCompleto(p)}?`, mensaje: 'Sólo se puede eliminar a quien nunca tuvo materias asignadas. Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true });
        if (ok && await ejecutar(async () => { await ctx.s.personal.eliminar(p.id); return 'Persona eliminada.'; })) await ctx.recargar();
      }, 'peligro', `Eliminar a ${nombreCompleto(p)}`),
    ),
  );

  const activos = lista.filter((p) => p.activo).length;
  return {
    titulo: `Personal de ${escuela.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Personal' }]),
      encabezado('Personal', `${escuela.nombre}. Cada persona se registra una sola vez y sirve para todos los ciclos.`),
      seccion('lista-personal', `Personas registradas (${activos} activas)`,
        lista.length ? h('ul', { class: 'tarjetas' }, ...lista.map(fila)) : vacio('Agrega a los docentes y al resto del personal. Sólo se piden datos básicos.'),
        panel,
      ),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' No se registran CURP, RFC, teléfonos ni domicilios: no son necesarios para estas funciones.'),
    ),
  };
}
