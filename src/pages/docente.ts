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

function formularioActividad(ctx: ContextoPagina, ciclo: CicloEscolar, p: Personal, actual: Actividad | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-actividad';
  const form = formulario(f, actual ? 'Editar actividad' : null,
    selector(f, { nombre: 'tipo', etiqueta: 'Tipo', requerido: true, valor: actual?.tipo ?? 'servicio', opciones: [{ valor: 'servicio', texto: 'Hora de servicio' }, { valor: 'otra', texto: 'Otra actividad' }] }),
    selector(f, { nombre: 'dia', etiqueta: 'Día', requerido: true, valor: String(actual?.dia ?? 1), opciones: DIAS }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'horaInicio', etiqueta: 'Inicio', tipo: 'time', valor: actual?.horaInicio ?? '', requerido: true }),
      campo(f, { nombre: 'horaFin', etiqueta: 'Fin', tipo: 'time', valor: actual?.horaFin ?? '', requerido: true }),
    ),
    campo(f, { nombre: 'descripcion', etiqueta: 'Descripción', valor: actual?.descripcion, requerido: true, maxlength: 120, ayuda: 'Por ejemplo: guardia en patio, apoyo en biblioteca, reunión de academia.' }),
    h('div', { class: 'acciones' }, actual ? botonAccion('Cancelar', alCancelar) : null, botonEnviar(actual ? 'Guardar cambios' : 'Registrar actividad')),
  );
  return alEnviar(form, async () => {
    const entrada = { tipo: texto(form, 'tipo') as TipoActividad, dia: numero(form, 'dia') ?? Number.NaN, horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin'), descripcion: texto(form, 'descripcion') };
    if (actual) { await ctx.s.actividades.actualizarDocente(actual.id, entrada); await ctx.recargar(); }
    else { await ctx.s.actividades.crearDocente(ciclo.id, p.id, entrada); await ctx.recargar('#f-actividad-tipo'); } // sigue abierto para la siguiente
    return entrada.tipo === 'servicio' ? 'Hora de servicio registrada (falta confirmarla).' : 'Actividad registrada.';
  });
}

export async function paginaDocente(ctx: ContextoPagina, personalId: string): Promise<Vista> {
  const p = await ctx.s.personal.obtener(personalId);
  const escuela = await ctx.s.escuelas.obtener(p.escuelaId);
  const ciclos = await ctx.s.ciclos.listar(escuela.id);
  const ciclo = ciclos.find((c) => c.estado === 'activo') ?? ciclos.find((c) => c.estado === 'planeacion') ?? ciclos[0];
  const nombre = nombreCompleto(p);
  const base = [
    migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Personal', href: `#/escuela/${escuela.id}/personal` }, { texto: nombre }]),
    encabezado(nombre, p.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', ')),
    p.activo ? null : h('p', {}, insignia('Dado(a) de baja', 'neutro', '■')),
  ];
  if (!ciclo) return { titulo: nombre, contenido: h('div', { class: 'pagina' }, ...base, vacio('La escuela aún no tiene ciclos escolares.')) };

  const { dias, totales } = await ctx.s.vistas.semanaDocente(p.id, ciclo.id);
  const actividades = await ctx.s.actividades.listarDocente(p.id, ciclo.id);
  const excepciones = await ctx.s.actividades.listarExcepciones(p.id, ciclo.id);
  const editable = ciclo.estado !== 'cerrado' && p.activo;

  // --- Actividades
  const cont = h('div', {});
  const panel = desplegable('Registrar hora de servicio u otra actividad', false, cont);
  const alta = () => cont.replaceChildren(formularioActividad(ctx, ciclo, p, null, alta));
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
                botonAccion('Editar', () => { cont.replaceChildren(formularioActividad(ctx, ciclo, p, a, alta)); panel.open = true; cont.querySelector('select')?.focus(); }, 'secundario', `Editar ${a.descripcion}`),
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
      seccion('actividades', 'Horas de servicio y otras actividades', listaActividades, editable ? panel : null),
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
