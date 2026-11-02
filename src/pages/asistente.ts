import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, casillas, formulario, marcados, numero, selector, texto } from '../components/formulario';
import { botonAccion, migas } from '../components/piezas';
import { regla } from '../components/regla';
import { avisar } from '../components/avisos';
import { NIVELES_EDUCATIVOS, type NivelEducativo } from '../models';
import { gradosSugeridos, nombresGrupos } from '../domain/generadores';
import { esErrorDominio } from '../domain/errores';
import { duracionMinutos, formatoDuracion } from '../domain/tiempo';
import { DIAS_SEMANA } from '../services/turnos';
import { nombreSugeridoGrado } from '../services/grados';
import { NIVEL_ETIQUETA, formatoFecha } from './etiquetas';
import { textoDias } from './ciclo';
import { borradorNuevo, descartarBorrador, guardarBorrador, leerBorrador, type Borrador } from './borrador';
import { solicitarPersistencia } from '../utils/almacenamiento';

const PASOS = [
  { clave: 'escuela', titulo: 'Escuela' },
  { clave: 'ciclo', titulo: 'Ciclo escolar' },
  { clave: 'turno', titulo: 'Turno y días' },
  { clave: 'horario', titulo: 'Periodos y recesos' },
  { clave: 'grados', titulo: 'Grados y grupos' },
  { clave: 'revisar', titulo: 'Revisar y guardar' },
] as const;
type ClavePaso = (typeof PASOS)[number]['clave'];

export async function paginaAsistente(ctx: ContextoPagina): Promise<Vista> {
  const b: Borrador = leerBorrador() ?? borradorNuevo();
  const raiz = h('div', { class: 'pagina asistente' });
  const d = b.datos;

  const ir = (paso: number) => {
    b.paso = Math.max(0, Math.min(PASOS.length - 1, paso));
    guardarBorrador(b);
    pintar();
    window.scrollTo(0, 0);
    raiz.querySelector<HTMLElement>('h1')?.focus();
  };

  const navegacion = (form: HTMLFormElement, textoSiguiente = 'Siguiente') =>
    h('div', { class: 'asistente__nav' },
      b.paso === 0
        ? h('a', { class: 'boton boton--secundario', href: '#/' }, 'Cancelar')
        : botonAccion('Atrás', () => { leerPaso(form); ir(b.paso - 1); }),
      botonEnviar(textoSiguiente),
    );

  /** Copia los valores del formulario al borrador (sin validar). */
  const leerPaso = (form: HTMLFormElement) => {
    const clave = PASOS[b.paso]!.clave;
    if (clave === 'escuela') {
      const nivelAnterior = d.escuela.nivel;
      d.escuela = { nombre: texto(form, 'nombre'), cct: texto(form, 'cct'), nivel: texto(form, 'nivel') as NivelEducativo, localidad: texto(form, 'localidad') };
      // Ajusta la sugerencia de grados si el usuario no la había cambiado.
      if (d.escuela.nivel !== nivelAnterior && d.grados.gradoHasta === gradosSugeridos(String(nivelAnterior))) {
        d.grados.gradoHasta = gradosSugeridos(String(d.escuela.nivel));
      }
    } else if (clave === 'ciclo') {
      d.ciclo = { nombre: texto(form, 'nombre'), fechaInicio: texto(form, 'fechaInicio'), fechaFin: texto(form, 'fechaFin'), enCurso: marcados(form, 'enCurso').length > 0 };
    } else if (clave === 'turno') {
      d.turno = { nombre: texto(form, 'nombre'), horaInicio: texto(form, 'horaInicio'), horaFin: texto(form, 'horaFin'), dias: marcados(form, 'dias').map(Number) };
    } else if (clave === 'horario') {
      const n = d.horario.recesos.length;
      d.horario = {
        duracionModulo: numero(form, 'duracionModulo') ?? Number.NaN,
        modulos: numero(form, 'modulos') ?? Number.NaN,
        recesos: Array.from({ length: n }, (_, i) => ({
          despuesDe: numero(form, `recesos.${i}.despuesDe`) ?? Number.NaN,
          duracion: numero(form, `recesos.${i}.duracion`) ?? Number.NaN,
        })),
      };
    } else if (clave === 'grados') {
      d.grados = { gradoDesde: numero(form, 'gradoDesde') ?? Number.NaN, gradoHasta: numero(form, 'gradoHasta') ?? Number.NaN, gruposPorGrado: numero(form, 'gruposPorGrado') ?? Number.NaN, capacidad: numero(form, 'capacidad') };
    }
    guardarBorrador(b);
  };

  const pasoConFormulario = (clave: Exclude<ClavePaso, 'revisar'>, ...campos: Parameters<typeof formulario>[2][]) => {
    const form = formulario(`f-${clave}`, null, ...campos);
    form.setAttribute('data-autoguardado', ''); // el borrador conserva lo capturado
    agregar(form, navegacion(form));
    form.addEventListener('change', () => leerPaso(form));
    return alEnviar(form, async () => {
      leerPaso(form);
      await ctx.s.asistente.validarPaso(clave, d);
      ir(b.paso + 1);
      return null;
    }, 'Revisando…');
  };

  // ---------- Pasos ----------

  const pasoEscuela = () => pasoConFormulario('escuela',
    campo('f-escuela', { nombre: 'nombre', etiqueta: 'Nombre de la escuela', valor: d.escuela.nombre, requerido: true, maxlength: 150, autocompletar: 'organization' }),
    campo('f-escuela', { nombre: 'cct', etiqueta: 'Clave de centro de trabajo (CCT)', valor: d.escuela.cct, maxlength: 14, mayusculas: true, ayuda: '10 caracteres, como aparece en documentos oficiales. Por ejemplo: 00AAA0000A.' }),
    selector('f-escuela', { nombre: 'nivel', etiqueta: 'Nivel educativo', requerido: true, valor: String(d.escuela.nivel), opciones: NIVELES_EDUCATIVOS.map((n) => ({ valor: n, texto: NIVEL_ETIQUETA[n] })) }),
    campo('f-escuela', { nombre: 'localidad', etiqueta: 'Localidad o municipio', valor: d.escuela.localidad, maxlength: 120 }),
  );

  const pasoCiclo = () => pasoConFormulario('ciclo',
    campo('f-ciclo', { nombre: 'nombre', etiqueta: 'Nombre del ciclo', valor: d.ciclo.nombre, requerido: true, maxlength: 40, ayuda: 'Por ejemplo: 2026-2027.' }),
    h('div', { class: 'fila' },
      campo('f-ciclo', { nombre: 'fechaInicio', etiqueta: 'Inicio de clases', tipo: 'date', valor: d.ciclo.fechaInicio, requerido: true }),
      campo('f-ciclo', { nombre: 'fechaFin', etiqueta: 'Fin de clases', tipo: 'date', valor: d.ciclo.fechaFin, requerido: true }),
    ),
    casillas('f-ciclo', { nombre: 'enCurso', leyenda: 'Estado', opciones: [{ valor: 'si', texto: 'Es el ciclo en curso (activarlo)' }], marcados: d.ciclo.enCurso ? ['si'] : [] }),
  );

  const pasoTurno = () => pasoConFormulario('turno',
    campo('f-turno', { nombre: 'nombre', etiqueta: 'Nombre del turno', valor: d.turno.nombre, requerido: true, maxlength: 40, sugerencias: ['Matutino', 'Vespertino', 'Nocturno', 'Tiempo completo', 'Jornada ampliada'], ayuda: 'Podrás agregar más turnos después.' }),
    h('div', { class: 'fila' },
      campo('f-turno', { nombre: 'horaInicio', etiqueta: 'Hora de entrada', tipo: 'time', valor: d.turno.horaInicio, requerido: true }),
      campo('f-turno', { nombre: 'horaFin', etiqueta: 'Hora de salida', tipo: 'time', valor: d.turno.horaFin, requerido: true }),
    ),
    casillas('f-turno', { nombre: 'dias', leyenda: 'Días laborables', opciones: DIAS_SEMANA.map((x) => ({ valor: x.valor, texto: x.nombre })), marcados: d.turno.dias }),
  );

  const pasoHorario = () => {
    const vista = h('div', { class: 'asistente__vista', 'aria-live': 'polite' });
    const actualizarVista = () => {
      vista.replaceChildren();
      try {
        const bloques = ctx.s.asistente.previsualizarBloques(d);
        const ultimo = bloques.at(-1);
        agregar(vista,
          h('p', { class: 'asistente__dato' }, `Las clases terminan a las ${ultimo?.horaFin ?? d.turno.horaInicio}; la salida es a las ${d.turno.horaFin}.`),
          regla({ horaInicio: String(d.turno.horaInicio), horaFin: String(d.turno.horaFin) }, bloques));
      } catch (e) {
        agregar(vista, h('p', { class: 'mensaje mensaje--error' }, icono('⚠'), ' ', esErrorDominio(e) ? e.message : 'Revisa los valores.'));
      }
    };
    const modulos = Number(d.horario.modulos) || 1;
    const opcionesModulo = Array.from({ length: Math.max(0, modulos - 1) }, (_, i) => ({ valor: String(i + 1), texto: `Módulo ${i + 1}` }));
    const filas = d.horario.recesos.map((r, i) =>
      h('fieldset', { class: 'receso-fila' },
        h('legend', {}, d.horario.recesos.length > 1 ? `Receso ${i + 1}` : 'Receso'),
        h('div', { class: 'fila' },
          selector('f-horario', { nombre: `recesos.${i}.despuesDe`, etiqueta: 'Después del', requerido: true, valor: String(r.despuesDe), opciones: opcionesModulo }),
          campo('f-horario', { nombre: `recesos.${i}.duracion`, etiqueta: 'Minutos', tipo: 'number', valor: Number.isFinite(r.duracion) ? r.duracion : '', min: 5, max: 120, requerido: true }),
        ),
        botonAccion('Quitar receso', () => { d.horario.recesos.splice(i, 1); guardarBorrador(b); pintar(); }, 'peligro', `Quitar receso ${i + 1}`),
      ));
    const form = pasoConFormulario('horario',
      h('p', { class: 'ayuda' }, `Los módulos se acomodan uno tras otro desde la entrada (${d.turno.horaInicio}). Después podrás ajustar cada uno.`),
      h('div', { class: 'fila' },
        campo('f-horario', { nombre: 'duracionModulo', etiqueta: 'Minutos por módulo', tipo: 'number', valor: Number.isFinite(d.horario.duracionModulo) ? d.horario.duracionModulo : '', min: 10, max: 180, requerido: true }),
        campo('f-horario', { nombre: 'modulos', etiqueta: 'Módulos al día', tipo: 'number', valor: Number.isFinite(d.horario.modulos) ? d.horario.modulos : '', min: 1, max: 15, requerido: true }),
      ),
      h('div', { 'data-campo': 'recesos' }, ...filas, h('p', { class: 'error-campo', hidden: true })),
      d.horario.recesos.length < 5 && modulos > 1
        ? botonAccion('Agregar receso', () => {
            const usados = new Set(d.horario.recesos.map((r) => r.despuesDe));
            const libre = opcionesModulo.map((o) => Number(o.valor)).find((m) => !usados.has(m)) ?? 1;
            d.horario.recesos.push({ despuesDe: libre, duracion: 20 });
            guardarBorrador(b);
            pintar();
          }, 'secundario')
        : null,
      vista,
    );
    form.addEventListener('change', (ev) => {
      // Cambiar el número de módulos cambia las opciones de los recesos.
      // Se actualizan en su lugar: volver a dibujar movería el foco del usuario.
      if ((ev.target as HTMLElement).getAttribute('name') === 'modulos') {
        const n = Number(d.horario.modulos);
        form.querySelectorAll<HTMLSelectElement>('select[name$=".despuesDe"]').forEach((sel) => {
          const actual = sel.value;
          sel.replaceChildren(h('option', { value: '' }, 'Selecciona…'),
            ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => h('option', { value: String(i + 1), selected: String(i + 1) === actual }, `Módulo ${i + 1}`)));
        });
      }
      actualizarVista();
    });
    actualizarVista();
    return form;
  };

  const pasoGrados = () => {
    const vista = h('div', { class: 'asistente__vista', 'aria-live': 'polite' });
    const actualizarVista = () => {
      const { gradoDesde: a, gradoHasta: z, gruposPorGrado: g } = d.grados;
      vista.replaceChildren();
      if (![a, z, g].every((n) => Number.isInteger(n)) || Number(a) > Number(z) || Number(g) < 1) return;
      const letras = nombresGrupos(Number(g));
      const total = (Number(z) - Number(a) + 1) * letras.length;
      agregar(vista,
        h('p', { class: 'asistente__dato' }, `Se crearán ${Number(z) - Number(a) + 1} grados y ${total} grupos en el turno ${d.turno.nombre || 'indicado'}.`),
        h('ul', { class: 'fichas' }, ...Array.from({ length: Number(z) - Number(a) + 1 }, (_, i) => Number(a) + i).flatMap((n) =>
          letras.map((l) => h('li', {}, `${n}° ${l}`)))),
      );
    };
    const form = pasoConFormulario('grados',
      h('div', { class: 'fila' },
        campo('f-grados', { nombre: 'gradoDesde', etiqueta: 'Del grado', tipo: 'number', valor: d.grados.gradoDesde, min: 1, max: 12, requerido: true }),
        campo('f-grados', { nombre: 'gradoHasta', etiqueta: 'Al grado', tipo: 'number', valor: d.grados.gradoHasta, min: 1, max: 12, requerido: true }),
      ),
      h('div', { class: 'fila' },
        campo('f-grados', { nombre: 'gruposPorGrado', etiqueta: 'Grupos por grado', tipo: 'number', valor: d.grados.gruposPorGrado, min: 1, max: 15, requerido: true }),
        campo('f-grados', { nombre: 'capacidad', etiqueta: 'Lugares por grupo', tipo: 'number', valor: d.grados.capacidad, min: 1, max: 80 }),
      ),
      h('p', { class: 'ayuda' }, 'Si algún grado tiene distinto número de grupos, ajústalo después de guardar.'),
      vista,
    );
    form.addEventListener('change', actualizarVista);
    actualizarVista();
    return form;
  };

  const pasoRevisar = () => {
    const editar = (paso: number, nombre: string) => botonAccion('Cambiar', () => ir(paso), 'secundario', `Cambiar ${nombre}`);
    let bloques: ReturnType<typeof ctx.s.asistente.previsualizarBloques> = [];
    try { bloques = ctx.s.asistente.previsualizarBloques(d); } catch { /* se informa al guardar */ }
    const minutosClase = bloques.filter((x) => x.tipo === 'periodo').reduce((s, x) => s + duracionMinutos(x.horaInicio, x.horaFin), 0);
    const nGrados = Number(d.grados.gradoHasta) - Number(d.grados.gradoDesde) + 1;
    const nivel = d.escuela.nivel as NivelEducativo;

    const resumen = (titulo: string, paso: number, ...lineas: (string | null)[]) =>
      h('section', { class: 'resumen' },
        h('div', { class: 'resumen__cabeza' }, h('h2', {}, titulo), editar(paso, titulo.toLowerCase())),
        ...lineas.filter((l): l is string => !!l).map((l) => h('p', {}, l)),
      );

    const form = formulario('f-revisar', null,
      resumen('Escuela', 0, d.escuela.nombre, NIVEL_ETIQUETA[nivel] ?? '', d.escuela.cct ? `CCT ${String(d.escuela.cct).toUpperCase().replace(/[\s-]/g, '')}` : 'Sin CCT', d.escuela.localidad || null),
      resumen('Ciclo escolar', 1, d.ciclo.nombre, `Del ${formatoFecha(d.ciclo.fechaInicio)} al ${formatoFecha(d.ciclo.fechaFin)}`, d.ciclo.enCurso ? 'Se activará como ciclo en curso' : 'Quedará en planeación'),
      resumen('Turno', 2, `${d.turno.nombre}, de ${d.turno.horaInicio} a ${d.turno.horaFin}`, textoDias(d.turno.dias.map(Number))),
      resumen('Periodos y recesos', 3, `${d.horario.modulos} módulos de ${d.horario.duracionModulo} minutos (${formatoDuracion(minutosClase)} de clase) y ${d.horario.recesos.length} receso(s)`),
      resumen('Grados y grupos', 4, `${nombreSugeridoGrado(Number(d.grados.gradoDesde))} a ${nombreSugeridoGrado(Number(d.grados.gradoHasta)).toLowerCase()}`, `${nGrados * Number(d.grados.gruposPorGrado)} grupos en total${d.grados.capacidad ? `, ${d.grados.capacidad} lugares cada uno` : ''}`),
    );
    agregar(form, h('div', { class: 'asistente__nav' }, botonAccion('Atrás', () => ir(b.paso - 1)), botonEnviar('Guardar escuela')));
    return alEnviar(form, async () => {
      const r = await ctx.s.asistente.crearEscuelaCompleta(d);
      descartarBorrador();
      void solicitarPersistencia();
      ctx.ir(`#/ciclo/${r.ciclo.id}`);
      return `«${r.escuela.nombre}» quedó configurada con ${r.bloques} bloques de horario y ${r.grupos} grupos.`;
    });
  };

  // ---------- Pintado ----------

  function pintar() {
    const paso = PASOS[b.paso]!;
    const contenido = { escuela: pasoEscuela, ciclo: pasoCiclo, turno: pasoTurno, horario: pasoHorario, grados: pasoGrados, revisar: pasoRevisar }[paso.clave]();
    document.title = `${paso.titulo} · Nueva escuela · Gestión Escolar`;
    raiz.replaceChildren(
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Nueva escuela' }]),
      h('header', { class: 'asistente__cabeza' },
        h('p', { class: 'asistente__contador' }, `Paso ${b.paso + 1} de ${PASOS.length}`),
        h('h1', { tabindex: '-1' }, paso.titulo),
      ),
      h('nav', { class: 'pasos', 'aria-label': 'Pasos de la configuración' },
        h('ol', {}, ...PASOS.map((p, i) => h('li', {
          class: i < b.paso ? 'pasos__hecho' : i === b.paso ? 'pasos__actual' : '',
          'aria-current': i === b.paso ? 'step' : undefined,
        }, h('span', { class: 'pasos__marca', 'aria-hidden': 'true' }, i < b.paso ? '✓' : String(i + 1)), h('span', { class: 'pasos__nombre' }, p.titulo),
          h('span', { class: 'solo-lectores' }, i < b.paso ? ' (completo)' : i === b.paso ? ' (actual)' : '')))),
      ),
      contenido,
    );
  }

  pintar();
  if (b.paso > 0) avisar('Retomamos la configuración donde la dejaste.', 'info');
  return { titulo: `${PASOS[b.paso]!.titulo} · Nueva escuela`, contenido: raiz };
}

export { leerBorrador, descartarBorrador };
