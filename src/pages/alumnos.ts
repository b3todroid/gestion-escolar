import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, areaTexto, botonEnviar, campo, ejecutar, formulario, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import { ETIQUETA_REPORTE, pedirReporte } from '../components/reporte';
import { nombreAlumno } from '../services/alumnos';
import type { Alumno } from '../models';
import type { EntradaAlumno } from '../validators/esquemas';
import { horaLocal, fechaLocal, diaIso } from '../utils/fechas';
import { aMinutos } from '../domain/tiempo';

export async function paginaAlumnos(ctx: ContextoPagina, grupoId: string): Promise<Vista> {
  const grupo = await ctx.s.grados.obtenerGrupo(grupoId);
  const grado = (await ctx.s.grados.listarGrados(grupo.cicloEscolarId)).find((g) => g.id === grupo.gradoId);
  const ciclo = await ctx.s.ciclos.obtener(grupo.cicloEscolarId);
  const nombreGrupo = `${grado?.numero ?? ''}° ${grupo.nombre}`;
  const resumen = await ctx.s.asistencia.resumenGrupo(grupoId);
  const fuera = await ctx.s.asistencia.fueraDelAula(grupoId);
  const editable = ciclo.estado !== 'cerrado';
  const activos = resumen.filter((r) => r.alumno.activo);
  // Clases de HOY de este grupo (del módulo Horarios), para pasar lista con un toque.
  const ahora = new Date();
  const hoy = fechaLocal(ahora);
  const asignaciones = await ctx.s.asignaciones.listarPorGrupo(grupoId);
  const clasesHoy = (await ctx.s.asignaciones.horarioDelDia(grupoId, diaIso(ahora))).filter((c) => c.sesion)
    .map((c) => ({ ...c, materia: asignaciones.find((a) => a.id === c.sesion!.asignacionId)?.materia ?? 'Clase' }));

  const fA = 'f-alumno';
  const formUno = alEnviar(formulario(fA, null,
    campo(fA, { nombre: 'nombre', etiqueta: 'Nombre(s)', requerido: true, maxlength: 60 }),
    h('div', { class: 'fila' },
      campo(fA, { nombre: 'primerApellido', etiqueta: 'Primer apellido', requerido: true, maxlength: 60 }),
      campo(fA, { nombre: 'segundoApellido', etiqueta: 'Segundo apellido', maxlength: 60 }),
    ),
    h('div', { class: 'acciones' }, botonEnviar('Agregar alumno')),
  ), async () => {
    const f = document.getElementById(fA) as HTMLFormElement;
    const a = await ctx.s.alumnos.crear(grupoId, { nombre: texto(f, 'nombre'), primerApellido: texto(f, 'primerApellido'), segundoApellido: texto(f, 'segundoApellido') });
    await ctx.recargar('#f-alumno-nombre');
    return `${a.nombre} agregado(a).`;
  });
  const fL = 'f-alumnos-lote';
  const formLote = alEnviar(formulario(fL, null,
    areaTexto(fL, { nombre: 'lote', etiqueta: 'Alumnos', requerido: true, filas: 8, ayuda: 'Uno por renglón: «Apellidos, Nombre(s)». Por ejemplo: «Pérez López, Ana María».' }),
    h('div', { class: 'acciones' }, botonEnviar('Agregar alumnos')),
  ), async () => {
    const f = document.getElementById(fL) as HTMLFormElement;
    const r = await ctx.s.alumnos.crearVarios(grupoId, texto(f, 'lote'));
    await ctx.recargar();
    return `${r.length} alumno(s) agregados.`;
  });

  return {
    titulo: `Alumnos de ${nombreGrupo}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: `Grupo ${nombreGrupo}`, href: `#/grupo/${grupoId}` }, { texto: 'Alumnos' }]),
      encabezado(`Alumnos de ${nombreGrupo}`, `Ciclo ${ciclo.nombre}. ${activos.length} alumno(s) activos.`),
      clasesHoy.length && activos.length && ciclo.estado === 'activo' ? h('nav', { class: 'clases-hoy', 'aria-label': 'Pasar lista hoy', id: 'clases-hoy' },
        ...clasesHoy.map((c) => h('a', { class: 'boton boton--ancho', href: `#/lista/${c.sesion!.id}/${hoy}` }, `Pasar lista: ${c.periodo.horaInicio} ${c.materia}`))) : null,
      fuera.length ? seccion('fuera', 'Fuera del aula ahora',
        h('ul', { class: 'renglones' }, ...fuera.map((s) => {
          const a = resumen.find((r) => r.alumno.id === s.alumnoId)?.alumno;
          return h('li', { class: 'renglon' },
            h('span', { class: 'renglon__texto' }, a ? nombreAlumno(a) : 'Alumno', h('span', { class: 'renglon__sub' }, ` desde las ${s.salida}${s.fecha !== fechaLocal(new Date()) ? ` del ${s.fecha}` : ''}`)),
            editable ? botonAccion('Regresó', async () => {
              const ahora = horaLocal(new Date());
              const hora = s.fecha === fechaLocal(new Date()) && aMinutos(ahora) >= aMinutos(s.salida) ? ahora : s.salida;
              if (await ejecutar(async () => { await ctx.s.asistencia.reincorporar(s.id, hora); return 'Reincorporación registrada.'; })) await ctx.recargar();
            }, 'principal', `Reincorporar a ${a ? nombreAlumno(a) : 'alumno'}`) : null,
          );
        }))) : null,
      seccion('lista-alumnos', 'Asistencia del ciclo',
        activos.length
          ? h('ol', { class: 'renglones lista-resumen' }, ...activos.map((r, i) => h('li', { class: 'renglon' },
              h('span', { class: 'alumno__num', 'aria-hidden': 'true' }, String(i + 1)),
              h('a', { class: 'renglon__texto', href: `#/alumno/${r.alumno.id}` }, nombreAlumno(r.alumno)),
              h('span', { class: 'conteos' },
                r.faltas ? insignia(`${r.faltas} F`, 'aviso', '✕') : null,
                r.retardos ? insignia(`${r.retardos} R`, 'aviso', '◷') : null,
                r.salidas ? insignia(`${r.salidas} salidas`, 'neutro', '🚻') : null,
                r.reportes ? insignia(`${r.reportes} reportes`, 'neutro', '✎') : null,
                !r.faltas && !r.retardos ? h('span', { class: 'renglon__sub' }, 'Sin faltas ni retardos') : null,
              ),
            )))
          : vacio('Sin alumnos. Agrégalos uno por uno o varios a la vez.'),
        editable ? desplegable('Agregar varios alumnos', activos.length === 0, formLote) : null,
        editable ? desplegable('Agregar un alumno', false, formUno) : null,
      ),
      resumen.some((r) => !r.alumno.activo) ? seccion('bajas', 'Dados de baja',
        h('ul', { class: 'renglones' }, ...resumen.filter((r) => !r.alumno.activo).map((r) => h('li', { class: 'renglon' }, h('a', { class: 'renglon__texto', href: `#/alumno/${r.alumno.id}` }, nombreAlumno(r.alumno)))))) : null,
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Sólo se guardan nombre y apellidos; no se registran CURP, fechas de nacimiento ni datos de contacto.'),
    ),
  };
}

export async function paginaAlumno(ctx: ContextoPagina, alumnoId: string): Promise<Vista> {
  const a = await ctx.s.alumnos.obtener(alumnoId);
  const inscripciones = await ctx.s.alumnos.inscripciones(alumnoId);
  const ins = inscripciones[0] ?? null;
  const ciclo = ins ? await ctx.s.ciclos.obtener(ins.cicloEscolarId) : null;
  const grados = ciclo ? await ctx.s.grados.listarGrados(ciclo.id) : [];
  const grupos = ciclo ? (await ctx.s.grados.listarGrupos(ciclo.id)).filter((g) => g.activo !== false) : [];
  const nombreGrupoDe = (id: string | null) => { const g = grupos.find((x) => x.id === id) ?? null; const gr = grados.find((x) => x.id === g?.gradoId); return g ? `${gr?.numero ?? ''}° ${g.nombre}` : 'Sin grupo'; };
  const grupoActual = ins?.grupoId ? await ctx.s.grados.obtenerGrupo(ins.grupoId) : null;
  const persona = await ctx.s.panel.perfil();
  const h0 = await ctx.s.asistencia.historialAlumno(alumnoId);
  const movimientos = await ctx.s.alumnos.movimientos(alumnoId);
  const nombre = nombreAlumno(a);
  const activo = ins?.estado === 'inscrito';
  const editable = !!ciclo && ciclo.estado !== 'cerrado';
  const faltas = h0.asistencias.filter((x) => x.marca === 'F');
  const retardos = h0.asistencias.filter((x) => x.marca === 'R');
  const fecha = (f: string) => f.split('-').reverse().join('/');
  const volver = ins?.grupoId ? `#/alumnos/${ins.grupoId}` : ciclo ? `#/ciclo/${ciclo.id}/alumnos` : '#/';
  const curpVisible = h('span', {}, a.curp ? `${a.curp.slice(0, 4)}••••••••••${a.curp.slice(-4)}` : 'Sin registrar');

  // Cambio de grupo (misma persona; queda en el historial)
  const fG = 'f-cambio-grupo';
  const formGrupo = ins && editable && activo ? alEnviar(formulario(fG, null,
    selector(fG, { nombre: 'grupoId', etiqueta: 'Grupo', valor: ins.grupoId ?? 'sin', opciones: [{ valor: 'sin', texto: 'Sin grupo' }, ...grupos.map((g) => ({ valor: g.id, texto: nombreGrupoDe(g.id) }))] }),
    campo(fG, { nombre: 'motivo', etiqueta: 'Motivo del cambio', maxlength: 200 }),
    h('div', { class: 'acciones' }, botonEnviar('Cambiar de grupo')),
  ), async () => {
    const f = document.getElementById(fG) as HTMLFormElement;
    const g = texto(f, 'grupoId');
    await ctx.s.alumnos.cambiarGrupo(ins.id, g === 'sin' || g === '' ? null : g, texto(f, 'motivo') || null);
    await ctx.recargar();
    return 'Cambio de grupo registrado.';
  }) : null;

  return {
    titulo: nombre,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, ...(ciclo ? [{ texto: 'Alumnos', href: `#/ciclo/${ciclo.id}/alumnos` }] : []), { texto: nombre }]),
      encabezado(nombre, ciclo ? `${grupoActual ? nombreGrupoDe(grupoActual.id) : 'Sin grupo'}, ciclo ${ciclo.nombre}` : null),
      activo ? null : h('p', {}, insignia('Inscripción dada de baja', 'neutro', '■')),
      h('dl', { class: 'totales' },
        h('div', {}, h('dt', {}, 'Faltas'), h('dd', {}, String(faltas.length))),
        h('div', {}, h('dt', {}, 'Retardos'), h('dd', {}, String(retardos.length))),
        h('div', {}, h('dt', {}, 'Salidas'), h('dd', {}, String(h0.salidas.length))),
      ),
      seccion('identidad', 'Datos del alumno',
        h('dl', { class: 'datos' },
          h('dt', {}, 'Matrícula'), h('dd', {}, a.matricula ?? 'Sin registrar'),
          h('dt', {}, 'CURP'), h('dd', {}, curpVisible, a.curp ? h('button', { type: 'button', class: 'boton boton--chico boton--secundario', onclick: (ev: Event) => { curpVisible.textContent = a.curp; (ev.currentTarget as HTMLElement).remove(); } }, 'Mostrar') : null),
          a.observaciones ? h('dt', {}, 'Observaciones') : null, a.observaciones ? h('dd', {}, a.observaciones) : null,
        ),
        editable ? botonAccion('Editar datos', () => ctx.ir(`#/alumno/${a.id}/editar`), 'secundario') : null,
      ),
      ins ? seccion('inscripcion', `Inscripción en ${ciclo?.nombre ?? 'el ciclo'}`,
        h('p', {}, `${nombreGrupoDe(ins.grupoId)}${ins.numeroLista ? `, número de lista ${ins.numeroLista}` : ''}. Estado: ${activo ? 'inscrito' : 'baja'}.`),
        formGrupo ? desplegable('Cambiar de grupo', false, formGrupo) : null,
        editable ? h('div', { class: 'acciones acciones--izq' },
          botonAccion(activo ? 'Dar de baja' : 'Reactivar inscripción', async () => {
            if (activo && !(await confirmar({ titulo: `¿Dar de baja a ${nombre}?`, mensaje: 'Dejará de aparecer en las listas de este ciclo. Su identidad e historial se conservan.', textoConfirmar: 'Dar de baja' }))) return;
            if (await ejecutar(async () => { await ctx.s.alumnos.cambiarEstado(ins.id, activo ? 'baja' : 'inscrito'); return activo ? 'Inscripción dada de baja.' : 'Inscripción reactivada.'; })) await ctx.recargar();
          }, 'secundario'),
          botonAccion('Eliminar', async () => {
            if (await confirmar({ titulo: `¿Eliminar a ${nombre}?`, mensaje: 'Sólo si se registró por error y no tiene historial.', textoConfirmar: 'Eliminar', peligro: true })
              && await ejecutar(async () => { await ctx.s.alumnos.eliminar(a.id); return 'Alumno eliminado.'; })) ctx.ir(volver);
          }, 'peligro'),
        ) : null,
      ) : null,
      movimientos.length ? seccion('historial-ins', 'Historial de inscripción',
        h('ul', { class: 'renglones' }, ...movimientos.map((m) => h('li', { class: 'renglon renglon--bloque' },
          h('span', { class: 'renglon__texto' }, `${new Date(m.creadoEn).toLocaleDateString('es-MX')}: ${({ alta: 'Alta', cambio_grupo: 'Cambio de grupo', baja: 'Baja', reactivacion: 'Reactivación', migracion: 'Registro anterior' } as const)[m.tipo]}`),
          m.tipo === 'cambio_grupo' ? h('span', { class: 'renglon__meta' }, `${nombreGrupoDe(m.grupoAnteriorId)} → ${nombreGrupoDe(m.grupoNuevoId)}`) : null,
          m.motivo ? h('span', { class: 'renglon__meta' }, m.motivo) : null,
        )))) : null,
      seccion('faltas', 'Faltas y retardos',
        h0.asistencias.length
          ? h('ul', { class: 'renglones' }, ...h0.asistencias.map((x) => h('li', { class: 'renglon' },
              insignia(x.marca === 'F' ? 'Falta' : `Retardo${x.horaLlegada ? ` (llegó ${x.horaLlegada})` : ''}`, 'aviso', x.marca === 'F' ? '✕' : '◷'),
              h('span', { class: 'renglon__texto' }, `${fecha(x.fecha)} ${x.hora}`, h('span', { class: 'renglon__sub' }, ` ${x.materia}`)))))
          : vacio('Sin faltas ni retardos registrados.')),
      seccion('salidas', 'Salidas del aula',
        h0.salidas.length
          ? h('ul', { class: 'renglones' }, ...h0.salidas.map((s) => h('li', { class: 'renglon' },
              h('span', { class: 'renglon__texto' }, `${fecha(s.fecha)}, salió ${s.salida}`, h('span', { class: 'renglon__sub' }, s.regreso ? `, regresó ${s.regreso}` : ', sigue fuera')),
              editable ? botonAccion('Anular', async () => {
                if (await confirmar({ titulo: '¿Anular esta salida?', mensaje: 'Úsalo sólo si se registró por error.', textoConfirmar: 'Anular', peligro: true })
                  && await ejecutar(async () => { await ctx.s.asistencia.anularSalida(s.id); return 'Salida anulada.'; })) await ctx.recargar();
              }, 'peligro', `Anular salida del ${fecha(s.fecha)} ${s.salida}`) : null,
            )))
          : vacio('Sin salidas registradas.')),
      seccion('reportes', 'Reportes breves',
        h0.reportes.length
          ? h('ul', { class: 'renglones' }, ...h0.reportes.map((r) => h('li', { class: 'renglon renglon--bloque' },
              h('span', {}, insignia(ETIQUETA_REPORTE[r.tipo], r.tipo === 'reconocimiento' ? 'ok' : 'neutro', '✎'), ` ${fecha(r.fecha)}${r.hora ? ` ${r.hora}` : ''} `,
                r.estado === 'atendida' ? insignia('Atendida', 'ok', '✓') : insignia('Abierta', 'aviso', '●')),
              h('span', { class: 'renglon__texto' }, r.texto),
              editable ? botonAccion(r.estado === 'atendida' ? 'Reabrir' : 'Marcar atendida', async () => {
                if (await ejecutar(async () => { await ctx.s.asistencia.cambiarEstadoReporte(r.id, r.estado === 'atendida' ? 'abierta' : 'atendida'); return r.estado === 'atendida' ? 'Incidencia reabierta.' : 'Incidencia marcada como atendida.'; })) await ctx.recargar();
              }, 'secundario', `${r.estado === 'atendida' ? 'Reabrir' : 'Marcar atendida'} reporte del ${fecha(r.fecha)}`) : null,
              editable ? botonAccion('Eliminar', async () => {
                if (await confirmar({ titulo: '¿Eliminar este reporte?', mensaje: r.texto, textoConfirmar: 'Eliminar', peligro: true })
                  && await ejecutar(async () => { await ctx.s.asistencia.eliminarReporte(r.id); return 'Reporte eliminado.'; })) await ctx.recargar();
              }, 'peligro', 'Eliminar reporte') : null,
            )))
          : vacio('Sin reportes.'),
        editable && activo && ins?.grupoId ? botonAccion('Nuevo reporte', async () => {
          const r = await pedirReporte(nombre);
          if (r && await ejecutar(async () => { await ctx.s.asistencia.crearReporte(a.id, r, { personalId: persona?.id ?? null, sesionId: null, fecha: fechaLocal(new Date()), hora: horaLocal(new Date()) }); return 'Reporte guardado.'; })) await ctx.recargar();
        }, 'principal') : null,
      ),
      h('a', { class: 'boton boton--secundario', href: volver }, 'Volver'),
    ),
  };
}

/** Campos de identidad del alumno (alta y edición). CURP opcional y con aviso. */
export function camposAlumno(f: string, a: Partial<Alumno> = {}): HTMLElement[] {
  return [
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre(s)', valor: a.nombre, requerido: true, maxlength: 60 }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'primerApellido', etiqueta: 'Primer apellido', valor: a.primerApellido, requerido: true, maxlength: 60 }),
      campo(f, { nombre: 'segundoApellido', etiqueta: 'Segundo apellido', valor: a.segundoApellido, maxlength: 60 }),
    ),
    desplegable('Datos opcionales', !!(a.matricula || a.curp || a.observaciones),
      h('div', { class: 'formulario formulario--anidado' },
        campo(f, { nombre: 'matricula', etiqueta: 'Matrícula institucional', valor: a.matricula, maxlength: 30, mayusculas: true }),
        campo(f, { nombre: 'curp', etiqueta: 'CURP', valor: a.curp, maxlength: 18, mayusculas: true, ayuda: 'Sólo si es necesaria. Es un dato personal sensible: se guarda en este dispositivo y en los respaldos.' }),
        campo(f, { nombre: 'observaciones', etiqueta: 'Observaciones administrativas', valor: a.observaciones, maxlength: 300, ayuda: 'No registres información médica ni otros datos sensibles.' }),
      )),
  ];
}

export function leerAlumno(form: HTMLFormElement): EntradaAlumno {
  return { nombre: texto(form, 'nombre'), primerApellido: texto(form, 'primerApellido'), segundoApellido: texto(form, 'segundoApellido'), matricula: texto(form, 'matricula'), curp: texto(form, 'curp'), observaciones: texto(form, 'observaciones') };
}

export async function paginaAlumnoEditar(ctx: ContextoPagina, alumnoId: string): Promise<Vista> {
  const a = await ctx.s.alumnos.obtener(alumnoId);
  const f = 'f-alumno-editar';
  const form = alEnviar(formulario(f, null, ...camposAlumno(f, a),
    h('div', { class: 'acciones' }, h('a', { class: 'boton boton--secundario', href: `#/alumno/${a.id}` }, 'Cancelar'), botonEnviar('Guardar cambios'))),
  async () => {
    await ctx.s.alumnos.actualizar(a.id, leerAlumno(document.getElementById(f) as HTMLFormElement));
    ctx.ir(`#/alumno/${a.id}`);
    return 'Datos del alumno actualizados.';
  });
  return {
    titulo: `Editar a ${nombreAlumno(a)}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: nombreAlumno(a), href: `#/alumno/${a.id}` }, { texto: 'Editar' }]),
      encabezado('Editar datos del alumno', nombreAlumno(a)),
      form,
    ),
  };
}
