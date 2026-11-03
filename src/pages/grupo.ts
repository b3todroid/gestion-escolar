import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, numero, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar, elegir } from '../components/dialogo';
import { avisar } from '../components/avisos';
import type { Materia, Personal } from '../models';
import type { AsignacionDetalle } from '../services/asignaciones';
import { DIAS_SEMANA } from '../services/turnos';
import { nombreCompleto } from '../services/personal';
import { esErrorDominio } from '../domain/errores';

/** Día elegido por grupo, para conservarlo al guardar y volver a dibujar. */
const diaPorGrupo = new Map<string, number>();

function opcionesDocente(docentes: Personal[]) {
  return [{ valor: 'pendiente', texto: 'Sin docente por ahora' }, ...docentes.map((d) => ({ valor: d.id, texto: nombreCompleto(d) }))];
}

function formularioAsignacion(ctx: ContextoPagina, grupoId: string, cicloId: string, materiasLibres: Materia[], docentes: Personal[], actual: AsignacionDetalle | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-asignacion';
  const form = formulario(f, actual ? `Editar ${actual.materia}` : null,
    actual ? null : selector(f, { nombre: 'materiaId', etiqueta: 'Materia', requerido: true, opciones: materiasLibres.map((m) => ({ valor: m.id, texto: m.nombre })), valor: materiasLibres.length === 1 ? materiasLibres[0]!.id : undefined }),
    selector(f, { nombre: 'personalId', etiqueta: 'Docente', requerido: true, valor: actual ? (actual.personalId ?? 'pendiente') : 'pendiente', opciones: opcionesDocente(docentes) }),
    campo(f, { nombre: 'horasSemana', etiqueta: 'Horas por semana', tipo: 'number', valor: actual?.horasSemana ?? '', min: 1, max: 40, requerido: true }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Asignar materia')),
  );
  return alEnviar(form, async () => {
    const elegido = texto(form, 'personalId');
    const personalId = elegido === 'pendiente' || elegido === '' ? null : elegido;
    const horasSemana = numero(form, 'horasSemana') ?? Number.NaN;
    if (actual) {
      await ctx.s.asignaciones.actualizar(actual.id, { personalId, horasSemana });
      await ctx.recargar();
      return `${actual.materia} actualizada.`;
    }
    await ctx.s.asignaciones.crear(cicloId, { grupoId, materiaId: texto(form, 'materiaId'), personalId, horasSemana });
    await ctx.recargar('#f-asignacion-materiaId');
    return 'Materia asignada.';
  });
}

export async function paginaGrupo(ctx: ContextoPagina, grupoId: string): Promise<Vista> {
  const grupo = await ctx.s.grados.obtenerGrupo(grupoId);
  const ciclo = await ctx.s.ciclos.obtener(grupo.cicloEscolarId);
  const escuela = await ctx.s.escuelas.obtener(grupo.escuelaId);
  const grado = (await ctx.s.grados.listarGrados(ciclo.id)).find((g) => g.id === grupo.gradoId);
  const { turno, jornada } = await ctx.s.turnos.obtener(grupo.turnoId);
  const asignaciones = await ctx.s.asignaciones.listarPorGrupo(grupoId);
  const materias = await ctx.s.materias.listar(ciclo.id);
  const docentes = await ctx.s.personal.docentes(escuela.id);
  const editable = ciclo.estado !== 'cerrado';
  const nombreGrupo = `${grado?.numero ?? ''}° ${grupo.nombre}`;

  const diasTurno = DIAS_SEMANA.filter((d) => jornada.dias.includes(d.valor));
  let dia = diaPorGrupo.get(grupoId) ?? diasTurno[0]?.valor ?? 1;
  if (!jornada.dias.includes(dia as never)) dia = diasTurno[0]?.valor ?? 1;
  const celdas = await ctx.s.asignaciones.horarioDelDia(grupoId, dia);
  const porId = new Map(asignaciones.map((a) => [a.id, a]));

  // ---------- Materias asignadas ----------
  const asignadas = new Set(asignaciones.map((a) => a.materiaId));
  const libres = materias.filter((m) => !asignadas.has(m.id));
  const cont = h('div', {});
  const panel = desplegable('Asignar materia', editable && asignaciones.length === 0 && libres.length > 0, cont);
  const alta = () => cont.replaceChildren(formularioAsignacion(ctx, grupoId, ciclo.id, libres, docentes, null, alta));
  alta();

  const totalHoras = asignaciones.reduce((s, a) => s + a.horasSemana, 0);
  const listaAsignaciones = asignaciones.length
    ? h('ul', { class: 'renglones' }, ...asignaciones.map((a) => {
        const completo = a.sesionesProgramadas >= a.horasSemana;
        return h('li', { class: 'renglon renglon--bloque' },
          h('span', { class: 'renglon__texto' }, a.materia),
          h('span', { class: 'renglon__meta' }, a.docente ?? 'Docente pendiente'),
          h('span', {}, insignia(`${a.sesionesProgramadas} de ${a.horasSemana} horas en el horario`, completo ? 'ok' : 'aviso', completo ? '✓' : '◐')),
          editable ? h('span', { class: 'renglon__acciones' },
            botonAccion('Editar', () => {
              cont.replaceChildren(formularioAsignacion(ctx, grupoId, ciclo.id, libres, docentes, a, alta));
              panel.open = true;
              cont.querySelector('select')?.focus();
            }, 'secundario', `Editar ${a.materia}`),
            botonAccion('Quitar', async () => {
              const ok = await confirmar({
                titulo: `¿Quitar ${a.materia} de ${nombreGrupo}?`,
                mensaje: a.sesionesProgramadas ? `También se quitarán sus ${a.sesionesProgramadas} hora(s) del horario.` : 'La materia dejará de estar asignada a este grupo.',
                textoConfirmar: 'Quitar', peligro: true,
              });
              if (ok && await ejecutar(async () => { await ctx.s.asignaciones.eliminar(a.id); return `${a.materia} quitada del grupo.`; })) await ctx.recargar();
            }, 'peligro', `Quitar ${a.materia}`),
          ) : null,
        );
      }))
    : vacio(materias.length ? 'Asigna las materias que cursa este grupo y quién las imparte.' : 'Primero registra las materias del ciclo.');

  // ---------- Horario del día ----------
  const elegirDia = h('fieldset', { class: 'dias' },
    h('legend', { class: 'solo-lectores' }, 'Día'),
    ...diasTurno.map((d) => h('label', { class: 'dias__opcion' },
      h('input', { type: 'radio', name: 'dia', value: d.valor, checked: d.valor === dia, onchange: () => { diaPorGrupo.set(grupoId, d.valor); void ctx.recargar(`input[name="dia"][value="${d.valor}"]`); } }),
      h('span', { 'aria-hidden': 'true' }, d.corto), h('span', { class: 'solo-lectores' }, d.nombre),
    )),
  );

  const nombreDia = DIAS_SEMANA.find((d) => d.valor === dia)?.nombre ?? '';
  const filas = celdas.map(({ periodo, sesion }) => {
    const a = sesion ? porId.get(sesion.asignacionId) : undefined;
    const cambiar = async () => {
      const { opciones } = await ctx.s.asignaciones.opcionesParaCelda(grupoId, dia, periodo.id);
      const r = await elegir({
        titulo: `${nombreDia}, ${periodo.horaInicio} a ${periodo.horaFin}`,
        descripcion: `${periodo.nombre} de ${nombreGrupo}`,
        opciones: opciones.map((o) => ({
          valor: o.asignacion.id, texto: o.asignacion.materia, actual: o.actual, motivo: o.motivo,
          detalle: `${o.asignacion.docente ?? 'Docente pendiente'}; ${o.asignacion.sesionesProgramadas} de ${o.asignacion.horasSemana} horas`,
        })),
        textoVacio: 'Este grupo aún no tiene materias asignadas.',
        opcionLiberar: sesion ? 'Dejar libre' : undefined,
      });
      if (r === null) return;
      try {
        if (r === '') { await ctx.s.asignaciones.quitarSesion(sesion!.id); avisar('Periodo liberado.', 'exito'); }
        else if (r !== sesion?.asignacionId) { await ctx.s.asignaciones.programar({ grupoId, asignacionId: r, dia, periodoId: periodo.id }); avisar('Clase programada. Guardado en este dispositivo.', 'exito'); }
        await ctx.recargar(`[data-periodo="${periodo.id}"] button`);
      } catch (e) {
        avisar(esErrorDominio(e) ? e.message : 'No se pudo guardar.', 'error');
      }
    };
    return h('li', { class: `celda${a ? '' : ' celda--libre'}`, 'data-periodo': periodo.id },
      h('span', { class: 'celda__hora' }, h('time', {}, periodo.horaInicio), h('span', { class: 'solo-lectores' }, ' a '), h('time', {}, periodo.horaFin)),
      h('span', { class: 'celda__cuerpo' },
        h('span', { class: 'celda__materia' }, a ? a.materia : 'Libre'),
        a ? h('span', { class: 'celda__docente' }, a.docente ?? 'Docente pendiente') : null,
      ),
      editable ? h('button', { type: 'button', class: 'boton boton--chico boton--secundario', 'aria-label': `${a ? 'Cambiar' : 'Asignar'} ${nombreDia} ${periodo.horaInicio}`, onclick: cambiar }, a ? 'Cambiar' : 'Asignar') : null,
    );
  });

  return {
    titulo: `Grupo ${nombreGrupo}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` }, { texto: `Grupo ${nombreGrupo}` }]),
      encabezado(`Grupo ${nombreGrupo}`, `Turno ${turno.nombre}, de ${jornada.horaInicio} a ${jornada.horaFin}.${grupo.capacidad ? ` ${grupo.capacidad} lugares.` : ''}`),
      seccion('materias-grupo', `Materias (${totalHoras} horas por semana)`,
        listaAsignaciones,
        editable && libres.length ? panel : null,
        editable && !materias.length ? h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}/materias` }, 'Registrar materias del ciclo') : null,
        editable && !docentes.length ? h('p', { class: 'ayuda' }, icono('ℹ'), ' No hay docentes activos. ', h('a', { href: `#/escuela/${escuela.id}/personal` }, 'Registra al personal'), ' para asignarlos.') : null,
      ),
      seccion('horario-grupo', 'Horario semanal',
        diasTurno.length ? elegirDia : null,
        celdas.length ? h('ol', { class: 'celdas', 'aria-label': `Horario del ${nombreDia.toLowerCase()}` }, ...filas) : vacio('El turno no tiene periodos de clase. Configúralos primero.'),
        h('p', { class: 'ayuda' }, 'No se puede asignar a un docente que ya tenga clase a esa hora en otro grupo, ni rebasar las horas semanales de la materia.'),
      ),
    ),
  };
}
