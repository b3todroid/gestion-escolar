import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import type { Jornada } from '../models';
import type { BloqueHorario } from '../domain/reglas';
import type { TipoBloque } from '../services/horario';
import { aMinutos, desdeMinutos, duracionMinutos, formatoDuracion } from '../domain/tiempo';
import { textoDias } from './ciclo';
import { regla } from '../components/regla';

const DURACION_SUGERIDA = 50; // minutos

function formularioBloque(ctx: ContextoPagina, jornada: Jornada, bloques: BloqueHorario[], actual: BloqueHorario | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-bloque';
  const ultimo = bloques.at(-1);
  const inicio = actual?.horaInicio ?? ultimo?.horaFin ?? jornada.horaInicio;
  const fin = actual?.horaFin ?? desdeMinutos(Math.min(aMinutos(inicio) + DURACION_SUGERIDA, aMinutos(jornada.horaFin)));
  const nPeriodos = bloques.filter((b) => b.tipo === 'periodo').length;

  const form = formulario(f, actual ? `Editar ${actual.nombre}` : null,
    actual
      ? h('p', {}, insignia(actual.tipo === 'periodo' ? 'Periodo de clase' : 'Receso', 'neutro', actual.tipo === 'periodo' ? '▤' : '☕'))
      : selector(f, { nombre: 'tipo', etiqueta: 'Tipo de bloque', requerido: true, valor: 'periodo', opciones: [{ valor: 'periodo', texto: 'Periodo de clase' }, { valor: 'receso', texto: 'Receso' }] }),
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre', valor: actual?.nombre ?? `Módulo ${nPeriodos + 1}`, requerido: true, maxlength: 40 }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'horaInicio', etiqueta: 'Inicio', tipo: 'time', valor: inicio, requerido: true }),
      campo(f, { nombre: 'horaFin', etiqueta: 'Fin', tipo: 'time', valor: fin, requerido: true }),
    ),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Agregar bloque')),
  );

  // Sugerencia de nombre al cambiar el tipo (sólo si no se personalizó).
  const tipoSel = form.querySelector<HTMLSelectElement>('[name="tipo"]');
  const inNombre = form.querySelector<HTMLInputElement>('[name="nombre"]')!;
  tipoSel?.addEventListener('change', () => {
    const sugerencias = [`Módulo ${nPeriodos + 1}`, 'Receso'];
    if (sugerencias.includes(inNombre.value) || inNombre.value === '') inNombre.value = tipoSel.value === 'receso' ? 'Receso' : `Módulo ${nPeriodos + 1}`;
  });

  return alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin') };
    if (actual) {
      await ctx.s.horario.actualizar(actual.tipo, actual.id, entrada);
      await ctx.recargar();
      return `${entrada.nombre} actualizado.`;
    }
    const tipo = (texto(form, 'tipo') || 'periodo') as TipoBloque;
    await ctx.s.horario.crear(tipo, jornada.id, entrada);
    await ctx.recargar('#f-bloque-horaFin');
    return `${entrada.nombre.trim()} agregado (${entrada.horaInicio} a ${entrada.horaFin}).`;
  });
}

export async function paginaHorario(ctx: ContextoPagina, turnoId: string): Promise<Vista> {
  const { turno, jornada } = await ctx.s.turnos.obtener(turnoId);
  const ciclo = await ctx.s.ciclos.obtener(turno.cicloEscolarId);
  const escuela = await ctx.s.escuelas.obtener(turno.escuelaId);
  const r = await ctx.s.horario.resumen(jornada.id);
  const editable = ciclo.estado !== 'cerrado';

  const cont = h('div', {});
  const panel = desplegable('Agregar periodo o receso', editable, cont);
  const alta = () => cont.replaceChildren(formularioBloque(ctx, jornada, r.bloques, null, alta));
  alta();

  let numPeriodo = 0;
  const lista = r.bloques.length
    ? h('ol', { class: 'linea-tiempo' }, ...r.bloques.map((b) => {
        const esReceso = b.tipo === 'receso';
        if (!esReceso) numPeriodo++;
        return h('li', { class: `bloque bloque--${b.tipo}` },
          h('div', { class: 'bloque__horas' }, h('time', {}, b.horaInicio), h('span', { 'aria-hidden': 'true' }, '–'), h('span', { class: 'solo-lectores' }, ' a '), h('time', {}, b.horaFin)),
          h('div', { class: 'bloque__cuerpo' },
            h('p', { class: 'bloque__nombre' }, b.nombre),
            h('p', { class: 'bloque__meta' },
              insignia(esReceso ? 'Receso' : `Clase ${numPeriodo}`, esReceso ? 'aviso' : 'neutro', esReceso ? '☕' : '▤'),
              ' ', formatoDuracion(duracionMinutos(b.horaInicio, b.horaFin)),
            ),
            editable ? h('div', { class: 'acciones acciones--izq' },
              botonAccion('Editar', () => {
                cont.replaceChildren(formularioBloque(ctx, jornada, r.bloques, b, alta));
                panel.open = true;
                cont.querySelector('input')?.focus();
              }, 'secundario', `Editar ${b.nombre}`),
              botonAccion('Eliminar', async () => {
                const ok = await confirmar({ titulo: `¿Eliminar ${b.nombre}?`, mensaje: `${b.horaInicio} a ${b.horaFin}. Esta acción no se puede deshacer.`, textoConfirmar: 'Eliminar', peligro: true });
                if (ok && await ejecutar(async () => { await ctx.s.horario.eliminar(b.tipo, b.id); return `${b.nombre} eliminado.`; })) await ctx.recargar();
              }, 'peligro', `Eliminar ${b.nombre}`),
            ) : null,
          ),
        );
      }))
    : vacio('Sin periodos. Agrega el primer módulo de clase; la hora de inicio se sugiere automáticamente.');

  return {
    titulo: `Turno ${turno.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([
        { texto: 'Inicio', href: '#/' },
        { texto: escuela.nombre, href: `#/escuela/${escuela.id}` },
        { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` },
        { texto: `Turno ${turno.nombre}` },
      ]),
      encabezado(`Turno ${turno.nombre}`, `${textoDias(jornada.dias)}, de ${jornada.horaInicio} a ${jornada.horaFin}`),
      h('dl', { class: 'totales' },
        h('div', {}, h('dt', {}, 'Clase'), h('dd', {}, formatoDuracion(r.minutosClase))),
        h('div', {}, h('dt', {}, 'Recesos'), h('dd', {}, formatoDuracion(r.minutosReceso))),
        h('div', {}, h('dt', {}, 'Sin asignar'), h('dd', {}, formatoDuracion(r.minutosLibres))),
      ),
      editable ? null : h('p', { class: 'mensaje' }, icono('ℹ'), ' El ciclo está cerrado: sólo consulta.'),
      r.bloques.length ? seccion('vista-jornada', 'Así se ve la jornada', regla(jornada, r.bloques)) : null,
      seccion('bloques', 'Periodos y recesos', lista, editable ? panel : null),
      h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}` }, '← Volver al ciclo'),
    ),
  };
}
