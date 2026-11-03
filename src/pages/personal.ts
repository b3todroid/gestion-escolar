import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { alEnviar, botonEnviar, campo, casillas, ejecutar, formulario, marcados, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import { FUNCIONES_VIGENTES, type Adscripcion, type CicloEscolar, type Escuela, type FuncionPersonal, type Personal } from '../models';
import { ETIQUETA_FUNCION, nombreCompleto, type FiltroPersonal } from '../services/personal';
import type { TurnoConJornada } from '../services/turnos';
import { cicloVigente, navCatalogos } from './catalogos';

interface Contexto { escuela: Escuela; ciclo: CicloEscolar | null; turnos: TurnoConJornada[]; ads: Map<string, Adscripcion> }

function formularioPersona(ctx: ContextoPagina, c: Contexto, actual: Personal | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-persona';
  // Funciones vigentes; una función anterior sólo aparece si la persona ya la tiene.
  const funciones = [...FUNCIONES_VIGENTES, ...(actual?.funciones.filter((x) => !(FUNCIONES_VIGENTES as readonly string[]).includes(x)) ?? [])];
  const ads = actual ? c.ads.get(actual.id) : undefined;
  const editableCiclo = c.ciclo && c.ciclo.estado !== 'cerrado' && c.turnos.length > 0;
  const form = formulario(f, actual ? `Editar a ${nombreCompleto(actual)}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre(s)', valor: actual?.nombre, requerido: true, maxlength: 60, autocompletar: 'off' }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'primerApellido', etiqueta: 'Primer apellido', valor: actual?.primerApellido, requerido: true, maxlength: 60 }),
      campo(f, { nombre: 'segundoApellido', etiqueta: 'Segundo apellido', valor: actual?.segundoApellido, maxlength: 60 }),
    ),
    campo(f, { nombre: 'numeroEmpleado', etiqueta: 'Identificador interno', valor: actual?.numeroEmpleado, maxlength: 20, mayusculas: true, ayuda: 'Número de empleado o clave propia de la escuela. Es único y distingue a personas con el mismo nombre.' }),
    casillas(f, { nombre: 'funciones', leyenda: 'Funciones (puede tener varias)', opciones: funciones.map((x) => ({ valor: x, texto: ETIQUETA_FUNCION[x] })), marcados: actual?.funciones ?? ['docente'] }),
    editableCiclo ? casillas(f, { nombre: 'turnos', leyenda: `Turnos en el ciclo ${c.ciclo!.nombre}`, opciones: c.turnos.map((t) => ({ valor: t.turno.id, texto: t.turno.nombre })), marcados: ads?.turnoIds ?? (c.turnos.length === 1 ? [c.turnos[0]!.turno.id] : []) }) : null,
    campo(f, { nombre: 'observaciones', etiqueta: 'Observaciones', valor: actual?.observaciones, maxlength: 300, ayuda: 'Administrativas. No registres datos médicos ni otros datos sensibles.' }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar persona')),
  );
  return alEnviar(form, async () => {
    const entrada = {
      nombre: texto(form, 'nombre'), primerApellido: texto(form, 'primerApellido'), segundoApellido: texto(form, 'segundoApellido'),
      numeroEmpleado: texto(form, 'numeroEmpleado'), funciones: marcados(form, 'funciones') as FuncionPersonal[], observaciones: texto(form, 'observaciones'),
    };
    const p = actual ? await ctx.s.personal.actualizar(actual.id, entrada) : await ctx.s.personal.crear(c.escuela.id, entrada);
    if (editableCiclo) {
      const turnoIds = marcados(form, 'turnos');
      const materiaIds = p.funciones.includes('docente') ? ads?.materiaIds ?? [] : [];
      if (ads || turnoIds.length) await ctx.s.personal.fijarAdscripcion(p.id, c.ciclo!.id, { turnoIds, materiaIds });
    }
    await ctx.recargar(actual ? undefined : '#f-persona-nombre');
    return actual ? 'Datos actualizados.' : `${nombreCompleto(p)} agregado(a).`;
  });
}

export async function paginaPersonal(ctx: ContextoPagina, escuelaId: string): Promise<Vista> {
  const escuela = await ctx.s.escuelas.obtener(escuelaId);
  const todos = await ctx.s.personal.listar(escuelaId);
  const ciclo = await cicloVigente(ctx, escuelaId);
  const turnos = ciclo ? await ctx.s.turnos.listar(ciclo.id) : [];
  const ads = ciclo ? await ctx.s.personal.adscripcionesCiclo(ciclo.id) : new Map<string, Adscripcion>();
  const c: Contexto = { escuela, ciclo, turnos, ads };
  const nombreTurno = (id: string) => turnos.find((t) => t.turno.id === id)?.turno.nombre ?? '';

  const cont = h('div', {});
  const panel = desplegable('Agregar persona', todos.length === 0, cont);
  const alta = () => reemplazar(cont, formularioPersona(ctx, c, null, alta));
  alta();

  const fila = (p: Personal) => {
    const a = ads.get(p.id);
    return h('li', { class: `tarjeta${p.activo ? '' : ' tarjeta--baja'}` },
      h('div', { class: 'tarjeta__cabeza' },
        h('h3', {}, h('a', { href: `#/personal/${p.id}`, class: 'tarjeta__enlace' }, nombreCompleto(p))),
        p.activo ? insignia('Activo', 'ok', '●') : insignia('Baja', 'neutro', '■'),
      ),
      h('p', { class: 'tarjeta__meta' }, [p.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', '), p.numeroEmpleado ? `id. ${p.numeroEmpleado}` : null].filter(Boolean).join('; ')),
      a?.turnoIds.length ? h('p', { class: 'tarjeta__meta' }, `Turno: ${a.turnoIds.map(nombreTurno).join(', ')}`) : null,
      p.observaciones ? h('p', { class: 'tarjeta__meta' }, p.observaciones) : null,
      h('div', { class: 'acciones acciones--izq' },
        botonAccion('Editar', () => {
          reemplazar(cont, formularioPersona(ctx, c, p, alta));
          panel.open = true;
          cont.querySelector('input')?.focus();
        }, 'secundario', `Editar a ${nombreCompleto(p)}`),
        botonAccion(p.activo ? 'Dar de baja' : 'Reactivar', async () => {
          if (p.activo && !(await confirmar({ titulo: `¿Dar de baja a ${nombreCompleto(p)}?`, mensaje: 'Se conserva su historial, pero ya no aparecerá para asignarle materias. Puedes reactivarla después.', textoConfirmar: 'Dar de baja' }))) return;
          if (await ejecutar(async () => { await ctx.s.personal.cambiarActivo(p.id, !p.activo); return p.activo ? 'Persona dada de baja.' : 'Persona reactivada.'; })) await ctx.recargar();
        }, 'secundario', `${p.activo ? 'Dar de baja' : 'Reactivar'} a ${nombreCompleto(p)}`),
        botonAccion('Eliminar', async () => {
          const ok = await confirmar({ titulo: `¿Eliminar a ${nombreCompleto(p)}?`, mensaje: 'Sólo se puede eliminar a quien se registró por error y no tiene materias, horas de servicio ni listas. Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true });
          if (ok && await ejecutar(async () => { await ctx.s.personal.eliminar(p.id); return 'Persona eliminada.'; })) await ctx.recargar();
        }, 'peligro', `Eliminar a ${nombreCompleto(p)}`),
      ),
    );
  };

  // ---------- Búsqueda y filtros (no recargan la página) ----------
  const lista = h('div', { 'aria-live': 'polite' });
  const buscador = h('input', { id: 'buscar-personal', type: 'search', autocomplete: 'off', placeholder: 'Nombre o identificador' });
  const selFuncion = h('select', { id: 'filtro-funcion' }, h('option', { value: '' }, 'Todas'),
    ...[...FUNCIONES_VIGENTES, ...(['directivo', 'administrativo', 'apoyo'] as const).filter((x) => todos.some((p) => p.funciones.includes(x)))]
      .map((x) => h('option', { value: x }, ETIQUETA_FUNCION[x])));
  const selEstado = h('select', { id: 'filtro-estado' }, h('option', { value: 'todos' }, 'Todos'), h('option', { value: 'activos' }, 'Activos'), h('option', { value: 'inactivos' }, 'Dados de baja'));
  const selTurno = h('select', { id: 'filtro-turno' }, h('option', { value: '' }, 'Todos'), ...turnos.map((t) => h('option', { value: t.turno.id }, t.turno.nombre)));
  let gen = 0;
  const filtrar = async () => {
    const g = ++gen;
    const f: FiltroPersonal = { texto: buscador.value, funcion: (selFuncion.value || null) as FuncionPersonal | null, estado: selEstado.value as FiltroPersonal['estado'], turnoId: selTurno.value || null, cicloId: ciclo?.id ?? null };
    const r = await ctx.s.personal.buscar(escuelaId, f);
    if (g !== gen) return;
    const filtrado = !!(f.texto?.trim() || f.funcion || f.turnoId || f.estado !== 'todos');
    reemplazar(lista, 
      filtrado ? h('p', { class: 'ayuda', id: 'conteo-personal' }, `${r.length} de ${todos.length} persona(s).`) : null,
      r.length ? h('ul', { class: 'tarjetas' }, ...r.map(fila))
        : vacio(todos.length ? 'Nadie coincide con la búsqueda o los filtros.' : 'Agrega a los docentes y al resto del personal. Sólo se piden datos básicos.'),
    );
  };
  for (const el of [buscador, selFuncion, selEstado, selTurno]) el.addEventListener(el === buscador ? 'input' : 'change', () => void filtrar());
  await filtrar();

  const activos = todos.filter((p) => p.activo);
  return {
    titulo: `Personal de ${escuela.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Personal' }]),
      encabezado('Personal', `${escuela.nombre}. Cada persona se registra una sola vez y sirve para todos los ciclos.`),
      navCatalogos(escuela.id, ciclo?.id ?? null, 'personal'),
      h('dl', { class: 'totales' },
        h('div', {}, h('dt', {}, 'Activos'), h('dd', {}, String(activos.length))),
        h('div', {}, h('dt', {}, 'Con función docente'), h('dd', {}, String(activos.filter((p) => p.funciones.includes('docente')).length))),
        h('div', {}, h('dt', {}, 'Dados de baja'), h('dd', {}, String(todos.length - activos.length))),
      ),
      seccion('lista-personal', `Personas registradas (${activos.length} activas)`,
        todos.length ? h('div', { class: 'filtros' },
          h('div', { class: 'campo' }, h('label', { for: 'buscar-personal' }, 'Buscar'), buscador),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-funcion' }, 'Función'), selFuncion),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-estado' }, 'Estado'), selEstado),
          turnos.length > 1 ? h('div', { class: 'campo' }, h('label', { for: 'filtro-turno' }, 'Turno'), selTurno) : null,
        ) : null,
        lista,
        panel,
      ),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' No se registran CURP, RFC, teléfonos ni domicilios: no son necesarios para estas funciones. Dar de baja conserva el historial.'),
    ),
  };
}
