import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, numero, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar, pedirTexto } from '../components/dialogo';
import { columnasSemanaDocente, leyenda } from '../components/horarioSemanal';
import type { Actividad, CicloEscolar, Personal, TipoActividad } from '../models';
import { DIAS_SEMANA } from '../services/turnos';
import { ETIQUETA_FUNCION, nombreCompleto } from '../services/personal';
import { formatoDuracion } from '../domain/tiempo';

const DIAS = DIAS_SEMANA.map((d) => ({ valor: String(d.valor), texto: d.nombre }));
const nombreDia = (n: number) => DIAS_SEMANA.find((d) => d.valor === n)?.nombre ?? '';

interface OpcionPeriodo { valor: string; texto: string; horaInicio: string; horaFin: string; dias: number[] }

function formularioActividad(ctx: ContextoPagina, ciclo: CicloEscolar, p: Personal, periodos: OpcionPeriodo[], actual: Actividad | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-actividad';
  const form = formulario(f, actual ? 'Editar actividad' : null,
    selector(f, { nombre: 'tipo', etiqueta: 'Tipo', requerido: true, valor: actual?.tipo ?? 'servicio', opciones: [{ valor: 'servicio', texto: 'Horas de servicio (SE)' }, { valor: 'otra', texto: 'Otra actividad' }] }),
    selector(f, { nombre: 'dia', etiqueta: 'Día', requerido: true, valor: String(actual?.dia ?? 1), opciones: DIAS }),
    periodos.length ? selector(f, { nombre: 'periodoId', etiqueta: 'Periodo', valor: actual?.periodoId ?? '', opciones: periodos }) : null,
    periodos.length ? h('p', { class: 'ayuda' }, 'Elige el periodo del turno, o deja «Selecciona…» y escribe un horario libre.') : null,
    h('div', { class: 'fila' },
      campo(f, { nombre: 'horaInicio', etiqueta: 'Inicio', tipo: 'time', valor: actual?.horaInicio ?? '', requerido: true }),
      campo(f, { nombre: 'horaFin', etiqueta: 'Fin', tipo: 'time', valor: actual?.horaFin ?? '', requerido: true }),
    ),
    campo(f, { nombre: 'descripcion', etiqueta: 'Descripción', valor: actual?.descripcion, requerido: true, maxlength: 120, ayuda: 'Por ejemplo: guardia en patio, apoyo en biblioteca, reunión de academia.' }),
    h('label', { class: 'casilla' }, h('input', { type: 'checkbox', name: 'confirmada', id: 'f-actividad-confirmada', checked: actual ? actual.confirmada : true }),
      h('span', {}, 'Registrar como confirmada (la persona responsable ya la validó)')),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Registrar actividad')),
  );
  // Al elegir un periodo, las horas se toman de él.
  const selPeriodo = form.querySelector<HTMLSelectElement>('[name="periodoId"]');
  const inIni = form.querySelector<HTMLInputElement>('[name="horaInicio"]')!;
  const inFin = form.querySelector<HTMLInputElement>('[name="horaFin"]')!;
  const sincronizar = () => {
    const op = periodos.find((x) => x.valor === selPeriodo?.value);
    inIni.readOnly = inFin.readOnly = !!op;
    if (op) { inIni.value = op.horaInicio; inFin.value = op.horaFin; }
  };
  selPeriodo?.addEventListener('change', sincronizar);
  sincronizar();
  return alEnviar(form, async () => {
    const entrada = {
      tipo: texto(form, 'tipo') as TipoActividad, dia: numero(form, 'dia') ?? Number.NaN, horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin'),
      descripcion: texto(form, 'descripcion'), periodoId: texto(form, 'periodoId') || null, confirmada: form.querySelector<HTMLInputElement>('[name="confirmada"]')!.checked,
    };
    if (actual) { await ctx.s.actividades.actualizarDocente(actual.id, entrada); await ctx.recargar(); }
    else { await ctx.s.actividades.crearDocente(ciclo.id, p.id, entrada); await ctx.recargar('#f-actividad-tipo'); } // sigue abierto para la siguiente
    const tipo = entrada.tipo === 'servicio' ? 'Hora de servicio (SE)' : 'Actividad';
    return entrada.confirmada ? `${tipo} registrada y confirmada.` : `${tipo} registrada (falta confirmarla).`;
  });
}

export async function paginaDocente(ctx: ContextoPagina, personalId: string, cicloId?: string): Promise<Vista> {
  const p = await ctx.s.personal.obtener(personalId);
  const escuela = await ctx.s.escuelas.obtener(p.escuelaId);
  const ciclos = await ctx.s.ciclos.listar(escuela.id);
  const ciclo = (cicloId ? ciclos.find((c) => c.id === cicloId) : undefined)
    ?? ciclos.find((c) => c.estado === 'activo') ?? ciclos.find((c) => c.estado === 'planeacion') ?? ciclos[0];
  const nombre = nombreCompleto(p);
  const selCiclo = ciclos.length > 1 && ciclo ? h('div', { class: 'campo no-imprimir' }, h('label', { for: 'ciclo-docente' }, 'Ciclo escolar'),
    h('select', { id: 'ciclo-docente', onchange: (ev: Event) => ctx.ir(`#/personal/${p.id}/ciclo/${(ev.currentTarget as HTMLSelectElement).value}`) },
      ...ciclos.map((c) => h('option', { value: c.id, selected: c.id === ciclo.id }, `Ciclo ${c.nombre}`)))) : null;
  const base = [
    migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Personal', href: `#/escuela/${escuela.id}/personal` }, { texto: nombre }]),
    encabezado(nombre, p.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', ')),
    p.activo ? null : h('p', {}, insignia('Dado(a) de baja', 'neutro', '■')),
    selCiclo,
  ];
  if (!ciclo) return { titulo: nombre, contenido: h('div', { class: 'pagina' }, ...base, vacio('La escuela aún no tiene ciclos escolares.')) };

  const { dias, totales } = await ctx.s.vistas.semanaDocente(p.id, ciclo.id);
  const actividades = await ctx.s.actividades.listarDocente(p.id, ciclo.id);
  const excepciones = await ctx.s.actividades.listarExcepciones(p.id, ciclo.id);
  const editable = ciclo.estado !== 'cerrado' && p.activo;
  const reporte = (await ctx.s.revisionHorarios.reporte(ciclo.id)).docentes.find((x) => x.personalId === p.id);
  const conflictos = (await ctx.s.revisionHorarios.conflictos(ciclo.id)).filter((c) => c.personalId === p.id);
  const clases = await ctx.s.asignaciones.horarioDocente(p.id, ciclo.id);
  const porGrupoMateria = new Map<string, { grupo: string; materia: string; n: number; grupoId: string }>();
  for (const c of clases) { const k = `${c.grupoId}|${c.materia}`; const x = porGrupoMateria.get(k); if (x) x.n++; else porGrupoMateria.set(k, { grupo: c.grupo, materia: c.materia, n: 1, grupoId: c.grupoId }); }

  // Periodos de los turnos del ciclo, para SE por periodo.
  const turnos = await ctx.s.turnos.listar(ciclo.id);
  const periodos: OpcionPeriodo[] = [];
  for (const t of turnos) {
    const r = await ctx.s.horario.resumen(t.jornada.id);
    for (const b of r.bloques.filter((x) => x.tipo === 'periodo')) {
      periodos.push({ valor: b.id, texto: `${turnos.length > 1 ? `${t.turno.nombre} · ` : ''}${b.nombre} (${b.horaInicio}–${b.horaFin})`, horaInicio: b.horaInicio, horaFin: b.horaFin, dias: t.jornada.dias });
    }
  }
  const diasTrabajo = [...new Set(dias.filter((d) => d.segmentos.some((s) => s.tipo !== 'sin_actividad' && s.tipo !== 'receso')).map((d) => d.nombre))];

  // --- Actividades
  const cont = h('div', {});
  const panel = desplegable('Registrar horas de servicio (SE) u otra actividad', false, cont);
  const alta = () => cont.replaceChildren(formularioActividad(ctx, ciclo, p, periodos, null, alta));
  alta();
  const listaActividades = actividades.length
    ? h('ul', { class: 'renglones' }, ...actividades.map((a) => h('li', { class: 'renglon renglon--bloque' },
        h('span', { class: 'renglon__texto' }, `${nombreDia(a.dia)}, ${a.horaInicio} a ${a.horaFin}: ${a.descripcion}`),
        h('span', {}, a.tipo === 'servicio'
          ? (a.confirmada ? insignia('SERVICIO confirmado', 'ok', '◆') : insignia('SERVICIO por confirmar', 'aviso', '◇'))
          : insignia('OTRA ACTIVIDAD', 'neutro', '★')),
        editable ? h('span', { class: 'renglon__acciones' },
          a.confirmada
            ? botonAccion('Quitar confirmación', async () => {
                const motivo = await pedirTexto({ titulo: 'Quitar la confirmación', mensaje: `${a.descripcion}, ${nombreDia(a.dia)} ${a.horaInicio}. Modificar una hora confirmada requiere autorización; el motivo queda registrado.`, etiqueta: 'Motivo', textoConfirmar: 'Quitar confirmación', minimo: 5, peligro: true });
                if (motivo && await ejecutar(async () => { await ctx.s.actividades.desconfirmar(a.id, motivo); return 'Confirmación retirada. El motivo quedó registrado.'; })) await ctx.recargar();
              }, 'peligro', `Quitar confirmación de ${a.descripcion}`)
            : h('span', { class: 'renglon__acciones' },
                a.tipo === 'servicio' ? botonAccion('Confirmar', async () => {
                  if (await ejecutar(async () => { await ctx.s.actividades.confirmar(a.id); return 'Hora de servicio confirmada.'; })) await ctx.recargar();
                }, 'principal', `Confirmar ${a.descripcion}`) : null,
                botonAccion('Editar', () => { cont.replaceChildren(formularioActividad(ctx, ciclo, p, periodos, a, alta)); panel.open = true; cont.querySelector('select')?.focus(); }, 'secundario', `Editar ${a.descripcion}`),
                botonAccion('Eliminar', async () => {
                  if (await confirmar({ titulo: `¿Eliminar «${a.descripcion}»?`, mensaje: 'Ese tiempo quedará como «sin actividad registrada».', textoConfirmar: 'Eliminar', peligro: true })
                    && await ejecutar(async () => { await ctx.s.actividades.eliminar(a.id); return 'Actividad eliminada.'; })) await ctx.recargar();
                }, 'peligro', `Eliminar ${a.descripcion}`),
              ),
        ) : null,
      )))
    : vacio('Sin horas de servicio ni otras actividades registradas. Un espacio vacío no se cuenta como servicio.');

  // --- Casos especiales
  const fE = 'f-excepcion';
  const formExc = alEnviar(formulario(fE, null,
    h('p', { class: 'ayuda' }, 'Sólo para situaciones reales, como un taller con dos grupos juntos. Sin un caso especial, el docente nunca puede estar en dos grupos a la vez.'),
    selector(fE, { nombre: 'dia', etiqueta: 'Día', requerido: true, valor: '1', opciones: DIAS }),
    h('div', { class: 'fila' },
      campo(fE, { nombre: 'horaInicio', etiqueta: 'Desde', tipo: 'time', requerido: true }),
      campo(fE, { nombre: 'horaFin', etiqueta: 'Hasta', tipo: 'time', requerido: true }),
    ),
    campo(fE, { nombre: 'motivo', etiqueta: 'Motivo', requerido: true, maxlength: 200 }),
    h('div', { class: 'acciones' }, botonEnviar('Autorizar caso especial')),
  ), async () => {
    const form = document.getElementById(fE) as HTMLFormElement;
    await ctx.s.actividades.crearExcepcion(ciclo.id, p.id, { dia: numero(form, 'dia') ?? Number.NaN, horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin'), motivo: texto(form, 'motivo') });
    await ctx.recargar();
    return 'Caso especial autorizado.';
  });

  const minutosTotales = totales.clase + totales.servicioConfirmado + totales.servicioPorConfirmar + totales.otra;
  return {
    titulo: nombre,
    contenido: h('div', { class: 'pagina' }, ...base,
      seccion('resumen-docente', 'Resumen del horario',
        h('dl', { class: 'datos', id: 'datos-docente' },
          h('dt', {}, 'Docente'), h('dd', {}, nombre),
          h('dt', {}, 'Escuela'), h('dd', {}, `${escuela.nombre}${escuela.cct ? ` (${escuela.cct})` : ''}`),
          h('dt', {}, 'Ciclo'), h('dd', {}, ciclo.nombre),
          h('dt', {}, 'Turnos'), h('dd', {}, reporte?.turnos.join(', ') || 'Sin clases registradas'),
          h('dt', {}, 'Días'), h('dd', {}, diasTrabajo.join(', ') || 'Ninguno'),
          h('dt', {}, 'Periodos de clase'), h('dd', {}, String(reporte?.horasClase ?? 0)),
          h('dt', {}, 'Grupos'), h('dd', {}, reporte?.grupos.join(', ') || 'Ninguno'),
          h('dt', {}, 'Materias'), h('dd', {}, reporte?.materias.join(', ') || 'Ninguna'),
          h('dt', {}, 'Horas SE'), h('dd', {}, `${reporte?.seConfirmadas ?? 0} confirmada(s)${reporte?.sePorConfirmar ? `, ${reporte.sePorConfirmar} por confirmar` : ''}`),
          h('dt', {}, 'Otras actividades'), h('dd', {}, String(reporte?.otrasActividades ?? 0)),
        ),
        porGrupoMateria.size ? h('ul', { class: 'renglones', 'aria-label': 'Clases por grupo y materia' }, ...[...porGrupoMateria.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'es', { numeric: true })).map((x) =>
          h('li', { class: 'renglon' }, h('span', { class: 'renglon__texto' }, h('a', { href: `#/grupo/${x.grupoId}` }, x.grupo), ` ${x.materia}`), h('strong', {}, `${x.n} h/sem`)))) : null,
        conflictos.length ? h('div', { class: 'mensaje mensaje--error', role: 'alert', id: 'conflictos-docente' },
          h('p', {}, icono('⚠'), ` ${conflictos.length} conflicto(s) pendiente(s):`), h('ul', {}, ...conflictos.map((c) => h('li', {}, c.mensaje)))) : null,
        h('div', { class: 'acciones acciones--izq no-imprimir' },
          h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => window.print() }, 'Imprimir horario'),
          h('a', { class: 'boton boton--secundario', href: `#/ciclo/${ciclo.id}/horarios` }, 'Todos los horarios del ciclo')),
      ),
      seccion('semana-docente', `Horario en el ciclo ${ciclo.nombre}`,
        h('dl', { class: 'totales totales--5' },
          h('div', {}, h('dt', {}, '● Clase'), h('dd', {}, formatoDuracion(totales.clase))),
          h('div', {}, h('dt', {}, '◆ Servicio confirmado'), h('dd', {}, formatoDuracion(totales.servicioConfirmado))),
          h('div', {}, h('dt', {}, '◇ Servicio por confirmar'), h('dd', {}, formatoDuracion(totales.servicioPorConfirmar))),
          h('div', {}, h('dt', {}, '★ Otra actividad'), h('dd', {}, formatoDuracion(totales.otra))),
          h('div', {}, h('dt', {}, '○ Sin actividad registrada'), h('dd', {}, formatoDuracion(totales.sinActividad))),
        ),
        minutosTotales || dias.length ? columnasSemanaDocente(dias) : vacio(p.funciones.includes('docente') ? 'Sin clases ni actividades. Las clases se programan desde la pantalla de cada grupo.' : 'Esta persona no tiene clases ni actividades registradas.'),
        dias.length ? leyenda() : null,
      ),
      seccion('actividades', 'Horas de servicio (SE) y otras actividades', listaActividades, editable ? panel : null,
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Las horas SE se registran explícitamente; un periodo vacío nunca cuenta como servicio.')),
      p.funciones.includes('docente') ? seccion('excepciones', 'Casos especiales',
        excepciones.length
          ? h('ul', { class: 'renglones' }, ...excepciones.map((e) => h('li', { class: 'renglon' },
              h('span', { class: 'renglon__texto' }, `${nombreDia(e.dia)}, ${e.horaInicio} a ${e.horaFin}`, h('span', { class: 'renglon__sub' }, ` ${e.motivo}`)),
              editable ? botonAccion('Quitar', async () => {
                if (await confirmar({ titulo: '¿Quitar el caso especial?', mensaje: 'Sin él, el docente ya no podrá tener grupos simultáneos en esa franja.', textoConfirmar: 'Quitar', peligro: true })
                  && await ejecutar(async () => { await ctx.s.actividades.eliminarExcepcion(e.id); return 'Caso especial quitado.'; })) await ctx.recargar();
              }, 'peligro', `Quitar caso especial ${nombreDia(e.dia)} ${e.horaInicio}`) : null,
            )))
          : h('p', { class: 'ayuda' }, icono('ℹ'), ' Ninguno configurado.'),
        editable ? desplegable('Autorizar un caso especial', false, formExc) : null,
      ) : null,
    ),
  };
}
