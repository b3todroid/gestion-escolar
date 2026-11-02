import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, casillas, ejecutar, formulario, marcados, numero, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import type { CicloEscolar, Grado, Grupo } from '../models';
import { DIAS_SEMANA, type TurnoConJornada } from '../services/turnos';
import { nombreSugeridoGrado } from '../services/grados';
import { formatoDuracion, duracionMinutos } from '../domain/tiempo';
import { insigniaCiclo } from './escuela';
import { formatoFecha } from './etiquetas';

export function plural(n: number, palabra: string): string {
  return `${n} ${palabra}${n === 1 ? '' : 's'}`;
}

export function textoDias(dias: readonly number[]): string {
  if (dias.join() === '1,2,3,4,5') return 'Lunes a viernes';
  if (dias.join() === '1,2,3,4,5,6') return 'Lunes a sábado';
  return dias.map((d) => DIAS_SEMANA.find((x) => x.valor === d)?.corto ?? '?').join(', ');
}

// ---------- Turnos ----------

function formularioTurno(ctx: ContextoPagina, ciclo: CicloEscolar, actual: TurnoConJornada | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-turno';
  const form = formulario(f, actual ? `Editar turno ${actual.turno.nombre}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre del turno', valor: actual?.turno.nombre, requerido: true, maxlength: 40, sugerencias: ['Matutino', 'Vespertino', 'Nocturno', 'Tiempo completo', 'Discontinuo'] }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'horaInicio', etiqueta: 'Entrada', tipo: 'time', valor: actual?.jornada.horaInicio ?? '07:00', requerido: true }),
      campo(f, { nombre: 'horaFin', etiqueta: 'Salida', tipo: 'time', valor: actual?.jornada.horaFin ?? '13:00', requerido: true }),
    ),
    casillas(f, { nombre: 'dias', leyenda: 'Días de clase', opciones: DIAS_SEMANA.map((d) => ({ valor: d.valor, texto: d.nombre })), marcados: actual?.jornada.dias ?? [1, 2, 3, 4, 5] }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar turno')),
  );
  return alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin'), dias: marcados(form, 'dias').map(Number) };
    if (actual) {
      await ctx.s.turnos.actualizar(actual.turno.id, entrada);
      await ctx.recargar();
      return 'Turno actualizado.';
    }
    const r = await ctx.s.turnos.crear(ciclo.id, entrada);
    await ctx.recargar('#f-turno-nombre');
    return `Turno ${r.turno.nombre} agregado.`;
  });
}

// ---------- Grados ----------

function formularioGrado(ctx: ContextoPagina, ciclo: CicloEscolar, grados: Grado[], actual: Grado | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-grado';
  const siguiente = actual?.numero ?? Math.max(0, ...grados.map((g) => g.numero)) + 1;
  const form = formulario(f, actual ? `Editar ${actual.nombre}` : null,
    h('div', { class: 'fila' },
      campo(f, { nombre: 'numero', etiqueta: 'Número', tipo: 'number', valor: siguiente, min: 1, max: 12, requerido: true }),
      campo(f, { nombre: 'nombre', etiqueta: 'Nombre', valor: actual?.nombre ?? nombreSugeridoGrado(siguiente), requerido: true, maxlength: 40 }),
    ),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar grado')),
  );
  // Al cambiar el número, actualiza el nombre sugerido si el usuario no lo personalizó.
  const inNumero = form.querySelector<HTMLInputElement>('[name="numero"]')!;
  const inNombre = form.querySelector<HTMLInputElement>('[name="nombre"]')!;
  inNumero.addEventListener('input', () => {
    const anterior = nombreSugeridoGrado(Number(inNumero.defaultValue));
    if (inNombre.value === anterior || inNombre.value === inNombre.dataset['sugerido']) {
      inNombre.value = nombreSugeridoGrado(Number(inNumero.value));
      inNombre.dataset['sugerido'] = inNombre.value;
    }
  });
  return alEnviar(form, async () => {
    const entrada = { numero: numero(form, 'numero') ?? Number.NaN, nombre: texto(form, 'nombre') };
    if (actual) {
      await ctx.s.grados.actualizarGrado(actual.id, entrada);
      await ctx.recargar();
      return 'Grado actualizado.';
    }
    const g = await ctx.s.grados.crearGrado(ciclo.id, entrada);
    await ctx.recargar('#f-grado-numero');
    return `${g.nombre} agregado.`;
  });
}

// ---------- Grupos ----------

function formularioGrupo(ctx: ContextoPagina, ciclo: CicloEscolar, grados: Grado[], turnos: TurnoConJornada[], actual: Grupo | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-grupo';
  const form = formulario(f, actual ? `Editar grupo ${actual.nombre}` : null,
    selector(f, { nombre: 'gradoId', etiqueta: 'Grado', requerido: true, valor: actual?.gradoId ?? (grados.length === 1 ? grados[0]!.id : undefined), opciones: grados.map((g) => ({ valor: g.id, texto: g.nombre })) }),
    selector(f, { nombre: 'turnoId', etiqueta: 'Turno', requerido: true, valor: actual?.turnoId ?? (turnos.length === 1 ? turnos[0]!.turno.id : undefined), opciones: turnos.map((t) => ({ valor: t.turno.id, texto: t.turno.nombre })) }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'nombre', etiqueta: 'Grupo', valor: actual?.nombre, requerido: true, maxlength: 20, mayusculas: true, ayuda: 'Por ejemplo: A, B, C.' }),
      campo(f, { nombre: 'capacidad', etiqueta: 'Capacidad', tipo: 'number', valor: actual?.capacidad, min: 1, max: 80, ayuda: 'Lugares disponibles.' }),
    ),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar grupo')),
  );
  return alEnviar(form, async () => {
    const entrada = { gradoId: texto(form, 'gradoId'), turnoId: texto(form, 'turnoId'), nombre: texto(form, 'nombre').toUpperCase(), capacidad: numero(form, 'capacidad') };
    if (actual) {
      await ctx.s.grados.actualizarGrupo(actual.id, entrada);
      await ctx.recargar();
      return 'Grupo actualizado.';
    }
    const g = await ctx.s.grados.crearGrupo(ciclo.id, entrada);
    await ctx.recargar('#f-grupo-nombre');
    return `Grupo ${g.nombre} agregado.`;
  });
}

// ---------- Página ----------

export async function paginaCiclo(ctx: ContextoPagina, id: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(id);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const turnos = await ctx.s.turnos.listar(id);
  const grados = await ctx.s.grados.listarGrados(id);
  const grupos = await ctx.s.grados.listarGrupos(id);
  const resumenes = await Promise.all(turnos.map((t) => ctx.s.horario.resumen(t.jornada.id)));
  const editable = ciclo.estado !== 'cerrado';
  const nombreTurno = new Map(turnos.map((t) => [t.turno.id, t.turno.nombre]));

  // --- Turnos
  const contTurno = h('div', {});
  const panelTurno = desplegable('Agregar turno', editable && turnos.length === 0, contTurno);
  const altaTurno = () => contTurno.replaceChildren(formularioTurno(ctx, ciclo, null, altaTurno));
  altaTurno();

  const listaTurnos = turnos.length
    ? h('ul', { class: 'tarjetas' }, ...turnos.map((t, i) => {
        const r = resumenes[i]!;
        const nPeriodos = r.bloques.filter((b) => b.tipo === 'periodo').length;
        const nRecesos = r.bloques.length - nPeriodos;
        return h('li', { class: 'tarjeta' },
          h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, t.turno.nombre),
            nPeriodos ? insignia(`${plural(nPeriodos, 'periodo')} · ${plural(nRecesos, 'receso')}`, 'ok', '✓') : insignia('Sin periodos', 'aviso', '!')),
          h('p', { class: 'tarjeta__meta' }, `${t.jornada.horaInicio} a ${t.jornada.horaFin} (${formatoDuracion(duracionMinutos(t.jornada.horaInicio, t.jornada.horaFin))}) · ${textoDias(t.jornada.dias)}`),
          h('div', { class: 'acciones acciones--izq' },
            h('a', { class: 'boton boton--chico', href: `#/turno/${t.turno.id}` }, editable ? 'Periodos y recesos' : 'Ver periodos'),
            editable ? botonAccion('Editar', () => {
              contTurno.replaceChildren(formularioTurno(ctx, ciclo, t, altaTurno));
              panelTurno.open = true;
              contTurno.querySelector('input')?.focus();
            }, 'secundario', `Editar turno ${t.turno.nombre}`) : null,
            editable ? botonAccion('Eliminar', async () => {
              const dep = await ctx.s.turnos.resumenDependencias(t.turno.id);
              const ok = await confirmar({
                titulo: `¿Eliminar el turno ${t.turno.nombre}?`,
                mensaje: dep.grupos > 0
                  ? `No se puede eliminar: tiene ${dep.grupos} grupo(s) asignado(s).`
                  : 'Se eliminará también lo siguiente. Esta acción no se puede deshacer.',
                detalles: dep.grupos > 0 ? [] : ['La jornada del turno', `${dep.periodos} periodo(s)`, `${dep.recesos} receso(s)`],
                textoConfirmar: 'Eliminar', peligro: true, soloInformar: dep.grupos > 0,
              });
              if (ok && await ejecutar(async () => { await ctx.s.turnos.eliminar(t.turno.id); return `Turno ${t.turno.nombre} eliminado.`; })) await ctx.recargar();
            }, 'peligro', `Eliminar turno ${t.turno.nombre}`) : null,
          ),
        );
      }))
    : vacio('Sin turnos. Agrega al menos uno (por ejemplo, Matutino) con su horario de entrada y salida.');

  // --- Grados y grupos
  const contGrado = h('div', {});
  const panelGrado = desplegable('Agregar grado', editable && grados.length === 0, contGrado);
  const altaGrado = () => contGrado.replaceChildren(formularioGrado(ctx, ciclo, grados, null, altaGrado));
  altaGrado();

  const contGrupo = h('div', {});
  const panelGrupo = desplegable('Agregar grupo', editable && grados.length > 0 && turnos.length > 0 && grupos.length === 0, contGrupo);
  const altaGrupo = () => contGrupo.replaceChildren(formularioGrupo(ctx, ciclo, grados, turnos, null, altaGrupo));
  altaGrupo();

  const listaGrados = grados.length
    ? h('ul', { class: 'tarjetas' }, ...grados.map((g) => {
        const suyos = grupos.filter((x) => x.gradoId === g.id)
          .sort((a, b) => (nombreTurno.get(a.turnoId) ?? '').localeCompare(nombreTurno.get(b.turnoId) ?? '') || a.nombre.localeCompare(b.nombre, 'es'));
        return h('li', { class: 'tarjeta' },
          h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, g.nombre), insignia(plural(suyos.length, 'grupo'), suyos.length ? 'ok' : 'aviso', suyos.length ? '✓' : '!')),
          suyos.length
            ? h('ul', { class: 'grupos' }, ...suyos.map((gr) => h('li', { class: 'grupo' },
                h('span', { class: 'grupo__nombre' }, `${g.numero}° ${gr.nombre}`),
                h('span', { class: 'grupo__meta' }, nombreTurno.get(gr.turnoId) ?? 'Turno desconocido', gr.capacidad ? ` · ${gr.capacidad} lugares` : ''),
                editable ? h('span', { class: 'grupo__acciones' },
                  botonAccion('Editar', () => {
                    contGrupo.replaceChildren(formularioGrupo(ctx, ciclo, grados, turnos, gr, altaGrupo));
                    panelGrupo.open = true;
                    contGrupo.querySelector('select')?.focus();
                  }, 'secundario', `Editar grupo ${g.numero}° ${gr.nombre}`),
                  botonAccion('Eliminar', async () => {
                    const ok = await confirmar({ titulo: `¿Eliminar el grupo ${g.numero}° ${gr.nombre}?`, mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true });
                    if (ok && await ejecutar(async () => { await ctx.s.grados.eliminarGrupo(gr.id); return `Grupo ${gr.nombre} eliminado.`; })) await ctx.recargar();
                  }, 'peligro', `Eliminar grupo ${g.numero}° ${gr.nombre}`),
                ) : null,
              )))
            : null,
          editable ? h('div', { class: 'acciones acciones--izq' },
            botonAccion('Editar grado', () => {
              contGrado.replaceChildren(formularioGrado(ctx, ciclo, grados, g, altaGrado));
              panelGrado.open = true;
              contGrado.querySelector('input')?.focus();
            }, 'secundario', `Editar ${g.nombre}`),
            botonAccion('Eliminar grado', async () => {
              const ok = await confirmar({ titulo: `¿Eliminar ${g.nombre}?`, mensaje: 'Sólo se puede eliminar un grado sin grupos. Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true });
              if (ok && await ejecutar(async () => { await ctx.s.grados.eliminarGrado(g.id); return `${g.nombre} eliminado.`; })) await ctx.recargar();
            }, 'peligro', `Eliminar ${g.nombre}`),
          ) : null,
        );
      }))
    : vacio('Sin grados. Agrega los grados que atiende la escuela (por ejemplo, 1, 2 y 3).');

  // --- Avance de la configuración (texto + símbolo, no sólo color)
  const pasos: [string, boolean][] = [
    ['Turno con jornada', turnos.length > 0],
    ['Periodos de clase', resumenes.some((r) => r.bloques.some((b) => b.tipo === 'periodo'))],
    ['Grados', grados.length > 0],
    ['Grupos', grupos.length > 0],
  ];

  return {
    titulo: `Ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}` }]),
      encabezado(`Ciclo ${ciclo.nombre}`, `${escuela.nombre} · ${formatoFecha(ciclo.fechaInicio)} – ${formatoFecha(ciclo.fechaFin)}`),
      h('p', {}, insigniaCiclo(ciclo.estado)),
      editable ? null : h('p', { class: 'mensaje' }, icono('ℹ'), ' Este ciclo está cerrado: su configuración se muestra sólo para consulta.'),
      h('section', { class: 'avance', 'aria-label': 'Avance de la configuración' },
        h('ol', {}, ...pasos.map(([t, ok]) => h('li', { class: ok ? 'hecho' : 'pendiente' }, icono(ok ? '✓' : '○'), ' ', t, h('span', { class: 'solo-lectores' }, ok ? ': completo' : ': pendiente')))),
      ),
      seccion('turnos', 'Turnos y jornadas', listaTurnos, editable ? panelTurno : null),
      seccion('grados', 'Grados y grupos',
        listaGrados,
        editable ? panelGrado : null,
        editable && grados.length > 0 && turnos.length > 0 ? panelGrupo : null,
        editable && grados.length > 0 && turnos.length === 0 ? h('p', { class: 'ayuda' }, icono('ℹ'), ' Para agregar grupos, primero registra al menos un turno.') : null,
      ),
    ),
  };
}
