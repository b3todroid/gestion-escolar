import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, numero, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar, elegir, pedirTexto } from '../components/dialogo';
import { leyenda, tablaSemanaGrupo, MARCA } from '../components/horarioSemanal';
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
  const confirmacion = await ctx.s.confirmacion.estado(grupoId);
  const cicloAbierto = ciclo.estado !== 'cerrado';
  const editable = cicloAbierto && !confirmacion;
  const semana = await ctx.s.vistas.semanaGrupo(grupoId);
  const actividadesGrupo = await ctx.s.actividades.listarGrupo(grupoId);
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
  const OTRA = '__otra__';
  const filas = celdas.map(({ periodo, sesion }) => {
    const a = sesion ? porId.get(sesion.asignacionId) : undefined;
    const act = actividadesGrupo.find((x) => x.dia === dia && x.periodoId === periodo.id);
    const guardar = async (fn: () => Promise<string>) => {
      try { avisar(await fn(), 'exito'); await ctx.recargar(`[data-periodo="${periodo.id}"] button`); }
      catch (e) { avisar(esErrorDominio(e) ? e.message : 'No se pudo guardar.', 'error'); }
    };
    const cambiar = async () => {
      const { opciones } = await ctx.s.asignaciones.opcionesParaCelda(grupoId, dia, periodo.id);
      const r = await elegir({
        titulo: `${nombreDia}, ${periodo.horaInicio} a ${periodo.horaFin}`,
        descripcion: `${periodo.nombre} de ${nombreGrupo}`,
        opciones: [
          ...opciones.map((o) => ({
            valor: o.asignacion.id, texto: o.asignacion.materia, actual: o.actual, motivo: o.motivo,
            detalle: `${o.asignacion.docente ?? 'Docente pendiente'}; ${o.asignacion.sesionesProgramadas} de ${o.asignacion.horasSemana} horas`,
          })),
          ...(sesion ? [] : [{ valor: OTRA, texto: 'Otra actividad', detalle: 'Honores, ceremonia, evento… (sin materia ni docente)' }]),
        ],
        textoVacio: 'Este grupo aún no tiene materias asignadas.',
        opcionLiberar: sesion ? 'Dejar libre' : undefined,
      });
      if (r === null) return;
      if (r === OTRA) {
        const desc = await pedirTexto({ titulo: 'Otra actividad', mensaje: `${nombreDia}, ${periodo.horaInicio} a ${periodo.horaFin}`, etiqueta: 'Descripción', textoConfirmar: 'Guardar actividad' });
        if (desc) await guardar(async () => { await ctx.s.actividades.crearGrupo(grupoId, dia, periodo.id, desc); return 'Actividad registrada. Guardado en este dispositivo.'; });
        return;
      }
      if (r === '') await guardar(async () => { await ctx.s.asignaciones.quitarSesion(sesion!.id); return 'Periodo liberado.'; });
      else if (r !== sesion?.asignacionId) await guardar(async () => { await ctx.s.asignaciones.programar({ grupoId, asignacionId: r, dia, periodoId: periodo.id }); return 'Clase programada. Guardado en este dispositivo.'; });
    };
    const quitarActividad = async () => {
      if (act && await confirmar({ titulo: `¿Quitar «${act.descripcion}»?`, mensaje: `${nombreDia}, ${periodo.horaInicio} a ${periodo.horaFin}. El periodo quedará sin actividad registrada.`, textoConfirmar: 'Quitar', peligro: true })) {
        await guardar(async () => { await ctx.s.actividades.eliminar(act.id); return 'Actividad quitada.'; });
      }
    };
    const tipo = a ? 'clase' : act ? 'otra' : 'sin_actividad';
    return h('li', { class: `celda celda--${tipo}`, 'data-periodo': periodo.id },
      h('span', { class: 'celda__hora' }, h('time', {}, periodo.horaInicio), h('span', { class: 'solo-lectores' }, ' a '), h('time', {}, periodo.horaFin)),
      h('span', { class: 'celda__cuerpo' },
        h('span', { class: 'celda__tipo' }, h('span', { 'aria-hidden': 'true' }, MARCA[tipo].simbolo), ' ', MARCA[tipo].etiqueta),
        a ? h('span', { class: 'celda__materia' }, a.materia) : act ? h('span', { class: 'celda__materia' }, act.descripcion) : null,
        a ? h('span', { class: 'celda__docente' }, a.docente ?? 'Docente pendiente') : null,
      ),
      act
        ? h('button', { type: 'button', class: 'boton boton--chico boton--peligro', 'aria-label': `Quitar actividad ${nombreDia} ${periodo.horaInicio}`, onclick: quitarActividad }, 'Quitar')
        : h('button', { type: 'button', class: 'boton boton--chico boton--secundario', 'aria-label': `${a ? 'Cambiar' : 'Asignar'} ${nombreDia} ${periodo.horaInicio}`, onclick: cambiar }, a ? 'Cambiar' : 'Asignar'),
    );
  });

  // ---------- Confirmación ----------
  const pendientes = asignaciones.filter((x) => x.sesionesProgramadas < x.horasSemana);
  const barraConfirmacion = confirmacion
    ? h('div', { class: 'confirmado' },
        h('p', {}, insignia(`Horario confirmado el ${new Date(confirmacion.creadoEn).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`, 'ok', '🔒')),
        h('p', { class: 'ayuda' }, 'No se puede modificar, ni con importaciones, hasta reabrirlo.'),
        cicloAbierto ? botonAccion('Reabrir para editar', async () => {
          const motivo = await pedirTexto({ titulo: `Reabrir el horario de ${nombreGrupo}`, mensaje: 'Modificar un horario confirmado requiere autorización. El motivo quedará registrado.', etiqueta: 'Motivo', textoConfirmar: 'Reabrir horario', minimo: 5, peligro: true });
          if (motivo && await ejecutar(async () => { await ctx.s.confirmacion.reabrir(grupoId, motivo); return 'Horario reabierto. El motivo quedó registrado.'; })) await ctx.recargar();
        }, 'peligro') : null,
      )
    : cicloAbierto ? h('div', { class: 'acciones acciones--izq' }, botonAccion('Confirmar horario', async () => {
        const ok = await confirmar({
          titulo: `¿Confirmar el horario de ${nombreGrupo}?`,
          mensaje: 'Quedará bloqueado: para cambiarlo habrá que reabrirlo indicando un motivo.',
          detalles: pendientes.length ? pendientes.map((x) => `${x.materia}: ${x.sesionesProgramadas} de ${x.horasSemana} horas en el horario`) : undefined,
          textoConfirmar: 'Confirmar horario',
        });
        if (ok && await ejecutar(async () => { await ctx.s.confirmacion.confirmar(grupoId); return 'Horario confirmado.'; })) await ctx.recargar();
      }, 'principal')) : null;

  return {
    titulo: `Grupo ${nombreGrupo}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` }, { texto: `Grupo ${nombreGrupo}` }]),
      encabezado(`Grupo ${nombreGrupo}`, `Turno ${turno.nombre}, de ${jornada.horaInicio} a ${jornada.horaFin}.${grupo.capacidad ? ` ${grupo.capacidad} lugares.` : ''}`),
      h('a', { class: 'boton boton--secundario', href: `#/alumnos/${grupoId}` }, `Alumnos y asistencia de ${nombreGrupo}`),
      seccion('materias-grupo', `Materias (${totalHoras} horas por semana)`,
        listaAsignaciones,
        editable && libres.length ? panel : null,
        editable && !materias.length ? h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}/materias` }, 'Registrar materias del ciclo') : null,
        editable && !docentes.length ? h('p', { class: 'ayuda' }, icono('ℹ'), ' No hay docentes activos. ', h('a', { href: `#/escuela/${escuela.id}/personal` }, 'Registra al personal'), ' para asignarlos.') : null,
      ),
      seccion('horario-grupo', 'Horario semanal',
        barraConfirmacion,
        semana.length && celdas.length ? tablaSemanaGrupo(semana, `Horario semanal de ${nombreGrupo}`) : vacio('El turno no tiene periodos de clase. Configúralos primero.'),
        semana.length ? leyenda(['clase', 'receso', 'otra', 'sin_actividad']) : null,
      ),
      editable && celdas.length ? seccion('editar-horario', 'Editar por día',
        diasTurno.length ? elegirDia : null,
        h('ol', { class: 'celdas', 'aria-label': `Horario del ${nombreDia.toLowerCase()}` }, ...filas),
        h('p', { class: 'ayuda' }, 'Un periodo vacío no es servicio ni descanso: queda como «sin actividad registrada». No se puede asignar a un docente que ya tenga clase o actividad a esa hora, salvo un caso especial configurado en su ficha.'),
      ) : null,
    ),
  };
}
