import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, casillas, formulario, marcados, numero, selector, texto } from '../components/formulario';
import { botonAccion, migas } from '../components/piezas';
import { regla } from '../components/regla';
import { avisar } from '../components/avisos';
import type { NivelEducativo } from '../models';
import { gradosSugeridos, letraGrupo } from '../domain/generadores';
import { esErrorDominio } from '../domain/errores';
import { aMinutos, desdeMinutos, duracionMinutos, formatoDuracion } from '../domain/tiempo';
import { confirmar, pedirTexto } from '../components/dialogo';
import { DIAS_SEMANA } from '../services/turnos';
import { nombreSugeridoGrado } from '../services/grados';
import { NIVEL_ETIQUETA, formatoFecha } from './etiquetas';
import { camposPlantel, leerPlantel, type ValoresPlantel } from '../components/plantel';
import { nombreEntidad } from '../domain/catalogos';
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
      d.escuela = leerPlantel(form);
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
      if (d.horario.bloques) {
        d.horario.bloques = d.horario.bloques.map((bq, i) => ({ tipo: bq.tipo, nombre: texto(form, `bloques.${i}.nombre`), horaInicio: texto(form, `bloques.${i}.horaInicio`), horaFin: texto(form, `bloques.${i}.horaFin`) }));
        guardarBorrador(b);
        return;
      }
      d.horario = {
        duracionModulo: numero(form, 'duracionModulo') ?? Number.NaN,
        modulos: numero(form, 'modulos') ?? Number.NaN,
        recesos: Array.from({ length: n }, (_, i) => ({
          despuesDe: numero(form, `recesos.${i}.despuesDe`) ?? Number.NaN,
          duracion: numero(form, `recesos.${i}.duracion`) ?? Number.NaN,
        })),
      };
    } else if (clave === 'grados') {
      if (d.grados.personalizados) {
        d.grados.personalizados = d.grados.personalizados.map((g, i) => ({ ...g, numero: numero(form, `personalizados.${i}.numero`) ?? Number.NaN, nombre: texto(form, `personalizados.${i}.nombre`) }));
        d.grados.capacidad = numero(form, 'capacidad');
      } else {
        d.grados = { gradoDesde: numero(form, 'gradoDesde') ?? Number.NaN, gradoHasta: numero(form, 'gradoHasta') ?? Number.NaN, gruposPorGrado: numero(form, 'gruposPorGrado') ?? Number.NaN, capacidad: numero(form, 'capacidad'), personalizados: null };
      }
    }
    guardarBorrador(b);
  };

  const pasoConFormulario = (clave: Exclude<ClavePaso, 'revisar'>, ...campos: Parameters<typeof formulario>[2][]) => {
    const form = formulario(`f-${clave}`, null, ...campos);
    form.setAttribute('data-autoguardado', ''); // el borrador conserva lo capturado
    agregar(form, navegacion(form));
    // Se actualiza mientras se escribe: si la vista previa cambiara al salir del campo,
    // el botón «Siguiente» se movería bajo el dedo y el toque se perdería.
    form.addEventListener('input', () => leerPaso(form));
    form.addEventListener('change', () => leerPaso(form));
    return alEnviar(form, async () => {
      leerPaso(form);
      await ctx.s.asistente.validarPaso(clave, d);
      ir(b.paso + 1);
      return null;
    }, 'Revisando…');
  };

  // ---------- Pasos ----------

  const pasoEscuela = () => pasoConFormulario('escuela', ...camposPlantel('f-escuela', d.escuela as ValoresPlantel));

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
      // Marca en su lugar el bloque con problema (en teléfono, el resumen queda lejos).
      raiz.querySelectorAll('.bloque-edicion--error').forEach((f) => f.classList.remove('bloque-edicion--error'));
      raiz.querySelectorAll('.bloque-edicion__error').forEach((x) => x.remove());
      try {
        const bloques = ctx.s.asistente.previsualizarBloques(d);
        const ultimo = bloques.at(-1);
        agregar(vista,
          h('p', { class: 'asistente__dato' }, `${bloques.filter((x) => x.tipo === 'periodo').length} periodos y ${bloques.filter((x) => x.tipo === 'receso').length} receso(s). Las clases terminan a las ${ultimo?.horaFin ?? d.turno.horaInicio}; la salida es a las ${d.turno.horaFin}.`),
          regla({ horaInicio: String(d.turno.horaInicio), horaFin: String(d.turno.horaFin) }, bloques));
      } catch (e) {
        agregar(vista, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', esErrorDominio(e) ? e.message : 'Revisa los valores.'));
        const indice = esErrorDominio(e) ? /^bloques\.(\d+)\./.exec(e.campos[0]?.campo ?? '')?.[1] : undefined;
        const fila = indice !== undefined ? raiz.querySelectorAll('.bloque-edicion')[Number(indice)] : undefined;
        if (fila && esErrorDominio(e)) {
          fila.classList.add('bloque-edicion--error');
          fila.appendChild(h('p', { class: 'bloque-edicion__error error-campo' }, icono('⚠'), ' ', e.campos[0]!.mensaje));
        }
      }
    };

    // ----- Modo personalizado: cada periodo y receso editable -----
    if (d.horario.bloques) {
      const bloques = d.horario.bloques;
      const filas = bloques.map((bq, i) => h('fieldset', { class: `bloque-edicion bloque-edicion--${bq.tipo}` },
        h('legend', {}, bq.tipo === 'receso' ? '☕ Receso' : `● Periodo`),
        campo('f-horario', { nombre: `bloques.${i}.nombre`, etiqueta: 'Nombre', valor: bq.nombre, requerido: true, maxlength: 40 }),
        h('div', { class: 'fila' },
          campo('f-horario', { nombre: `bloques.${i}.horaInicio`, etiqueta: 'Inicio', tipo: 'time', valor: bq.horaInicio, requerido: true }),
          campo('f-horario', { nombre: `bloques.${i}.horaFin`, etiqueta: 'Fin', tipo: 'time', valor: bq.horaFin, requerido: true }),
        ),
        // leer() reemplaza la lista: siempre se modifica la vigente (d.horario.bloques), no la capturada.
        botonAccion('Quitar', () => { leer(); d.horario.bloques!.splice(i, 1); guardarBorrador(b); pintar(); }, 'peligro', `Quitar ${bq.nombre}`),
      ));
      const agregarBloque = (tipo: 'periodo' | 'receso') => {
        leer();
        const vigentes = d.horario.bloques!;
        const ordenados = [...vigentes].sort((x, y) => x.horaInicio.localeCompare(y.horaInicio));
        const inicio = ordenados.at(-1)?.horaFin ?? String(d.turno.horaInicio);
        const dur = tipo === 'receso' ? 20 : (Number(d.horario.duracionModulo) || 50);
        const fin = desdeMinutos(Math.min(aMinutos(inicio) + dur, aMinutos(String(d.turno.horaFin))));
        const n = vigentes.filter((x) => x.tipo === tipo).length + 1;
        vigentes.push({ tipo, nombre: tipo === 'receso' ? `Receso ${n}` : `Módulo ${n}`, horaInicio: inicio, horaFin: fin });
        guardarBorrador(b); pintar();
      };
      const leer = () => {
        const f = raiz.querySelector<HTMLFormElement>('#f-horario');
        if (f) leerPaso(f);
      };
      const form = pasoConFormulario('horario',
        h('p', { class: 'ayuda' }, 'Edita cada periodo y receso. Se revisa en vivo que queden dentro de la jornada y sin encimarse.'),
        h('div', { 'data-campo': 'bloques' }, ...filas, h('p', { class: 'error-campo', hidden: true })),
        h('div', { class: 'acciones acciones--izq' },
          botonAccion('Agregar periodo', () => agregarBloque('periodo'), 'secundario'),
          botonAccion('Agregar receso', () => agregarBloque('receso'), 'secundario'),
          botonAccion('Volver a generar automáticamente', async () => {
            if (await confirmar({ titulo: '¿Volver a la generación automática?', mensaje: 'Se descartarán los cambios hechos a cada periodo.', textoConfirmar: 'Descartar cambios', peligro: true })) {
              d.horario.bloques = null; guardarBorrador(b); pintar();
            }
          }, 'secundario'),
        ),
        vista,
      );
      form.addEventListener('input', actualizarVista);
      actualizarVista();
      return form;
    }

    // ----- Modo automático: módulos consecutivos con recesos intercalados -----
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
      h('p', { class: 'ayuda' }, `Los módulos se acomodan uno tras otro desde la entrada (${d.turno.horaInicio}). Después puedes editarlos uno por uno.`),
      h('div', { class: 'fila' },
        campo('f-horario', { nombre: 'duracionModulo', etiqueta: 'Minutos por módulo', tipo: 'number', valor: Number.isFinite(d.horario.duracionModulo) ? d.horario.duracionModulo : '', min: 10, max: 180, requerido: true }),
        campo('f-horario', { nombre: 'modulos', etiqueta: 'Módulos al día', tipo: 'number', valor: Number.isFinite(d.horario.modulos) ? d.horario.modulos : '', min: 1, max: 15, requerido: true }),
      ),
      h('div', { 'data-campo': 'recesos' }, ...filas, h('p', { class: 'error-campo', hidden: true })),
      h('div', { class: 'acciones acciones--izq' },
        d.horario.recesos.length < 5 && modulos > 1
          ? botonAccion('Agregar receso', () => {
              const usados = new Set(d.horario.recesos.map((r) => r.despuesDe));
              const libre = opcionesModulo.map((o) => Number(o.valor)).find((m) => !usados.has(m)) ?? 1;
              d.horario.recesos.push({ despuesDe: libre, duracion: 20 });
              guardarBorrador(b);
              pintar();
            }, 'secundario')
          : null,
        botonAccion('Editar periodos uno por uno', () => {
          const f = raiz.querySelector<HTMLFormElement>('#f-horario');
          if (f) leerPaso(f);
          try {
            d.horario.bloques = ctx.s.asistente.previsualizarBloques(d).map((x) => ({ ...x }));
            guardarBorrador(b); pintar();
          } catch (e) { avisar(esErrorDominio(e) ? `Primero corrige la generación: ${e.message}` : 'Revisa los valores.', 'error'); }
        }, 'secundario'),
      ),
      vista,
    );
    form.addEventListener('change', (ev) => {
      // Cambiar el número de módulos cambia las opciones de los recesos.
      // Se actualizan en su lugar: volver a dibujar movería el foco del usuario.
      if ((ev.target as HTMLElement).getAttribute('name') === 'modulos' && ev.type === 'change') {
        const n = Number(d.horario.modulos);
        form.querySelectorAll<HTMLSelectElement>('select[name$=".despuesDe"]').forEach((sel) => {
          const actual = sel.value;
          sel.replaceChildren(h('option', { value: '' }, 'Selecciona…'),
            ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => h('option', { value: String(i + 1), selected: String(i + 1) === actual }, `Módulo ${i + 1}`)));
        });
      }
      actualizarVista();
    });
    form.addEventListener('input', actualizarVista);
    actualizarVista();
    return form;
  };

  const pasoGrados = () => {
    const vista = h('div', { class: 'asistente__vista', 'aria-live': 'polite' });
    const actualizarVista = () => {
      vista.replaceChildren();
      try {
        const grados = ctx.s.asistente.previsualizarGrados(d);
        const total = grados.reduce((s, g) => s + g.grupos.length, 0);
        agregar(vista,
          h('p', { class: 'asistente__dato' }, `Se crearán ${grados.length} grado(s) y ${total} grupo(s) en el turno ${d.turno.nombre || 'indicado'}.`),
          d.grados.personalizados ? null : h('ul', { class: 'fichas' }, ...grados.flatMap((g) => g.grupos.map((l) => h('li', {}, `${g.numero}° ${l}`)))),
        );
      } catch (e) {
        agregar(vista, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', esErrorDominio(e) ? e.message : 'Revisa los valores.'));
      }
    };
    const capacidad = campo('f-grados', { nombre: 'capacidad', etiqueta: 'Lugares por grupo', tipo: 'number', valor: d.grados.capacidad, min: 1, max: 80 });

    // ----- Modo personalizado -----
    if (d.grados.personalizados) {
      const lista = d.grados.personalizados;
      const leer = () => { const f = raiz.querySelector<HTMLFormElement>('#f-grados'); if (f) leerPaso(f); };
      const tarjetas = lista.map((g, i) => h('fieldset', { class: 'grado-edicion' },
        h('legend', {}, `${g.numero}°`),
        h('div', { class: 'fila' },
          campo('f-grados', { nombre: `personalizados.${i}.numero`, etiqueta: 'Número', tipo: 'number', valor: g.numero, min: 1, max: 99, requerido: true }),
          campo('f-grados', { nombre: `personalizados.${i}.nombre`, etiqueta: 'Nombre del grado', valor: g.nombre, requerido: true, maxlength: 40 }),
        ),
        h('div', { 'data-campo': `personalizados.${i}.grupos` },
          h('p', { class: 'grado-edicion__titulo' }, `Grupos (${g.grupos.length})`),
          h('ul', { class: 'fichas fichas--editables' }, ...g.grupos.map((n, j) => h('li', {},
            h('span', {}, `${g.numero}° ${n}`),
            h('button', { type: 'button', class: 'ficha__quitar', 'aria-label': `Quitar grupo ${g.numero}° ${n}`, onclick: () => { leer(); d.grados.personalizados![i]!.grupos.splice(j, 1); guardarBorrador(b); pintar(); } }, '×'),
          ))),
          h('p', { class: 'error-campo', hidden: true }),
        ),
        h('div', { class: 'acciones acciones--izq' },
          botonAccion('Agregar grupo', () => {
            leer();
            const grupos = d.grados.personalizados![i]!.grupos;
            const usados = new Set(grupos.map((x) => x.toUpperCase()));
            let k = 0; while (usados.has(letraGrupo(k))) k++;
            grupos.push(letraGrupo(k)); guardarBorrador(b); pintar();
          }, 'secundario', `Agregar grupo a ${g.nombre}`),
          botonAccion('Agregar varios', async () => {
            leer();
            const t = await pedirTexto({ titulo: `Grupos de ${g.nombre}`, mensaje: 'Escribe los nombres separados por comas, por ejemplo: D, E, F.', etiqueta: 'Grupos', textoConfirmar: 'Agregar', minimo: 1 });
            if (!t) return;
            for (const n of t.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) d.grados.personalizados![i]!.grupos.push(n);
            guardarBorrador(b); pintar();
          }, 'secundario', `Agregar varios grupos a ${g.nombre}`),
          botonAccion('Quitar grado', () => { leer(); d.grados.personalizados!.splice(i, 1); guardarBorrador(b); pintar(); }, 'peligro', `Quitar ${g.nombre}`),
        ),
      ));
      const form = pasoConFormulario('grados',
        h('p', { class: 'ayuda' }, 'Ajusta cada grado y sus grupos. No se permiten grupos repetidos dentro de un grado.'),
        ...tarjetas,
        h('div', { class: 'acciones acciones--izq' },
          botonAccion('Agregar grado', () => {
            leer();
            const vigentes = d.grados.personalizados!;
            const n = Math.max(0, ...vigentes.map((x) => Number(x.numero) || 0)) + 1;
            vigentes.push({ numero: n, nombre: nombreSugeridoGrado(n), grupos: ['A'] }); guardarBorrador(b); pintar();
          }, 'secundario'),
          botonAccion('Volver a la generación rápida', async () => {
            if (await confirmar({ titulo: '¿Volver a la generación rápida?', mensaje: 'Se descartarán los cambios hechos a cada grado.', textoConfirmar: 'Descartar cambios', peligro: true })) {
              d.grados.personalizados = null; guardarBorrador(b); pintar();
            }
          }, 'secundario'),
        ),
        capacidad,
        vista,
      );
      form.addEventListener('input', actualizarVista);
      actualizarVista();
      return form;
    }

    // ----- Generación rápida -----
    const form = pasoConFormulario('grados',
      h('div', { class: 'fila' },
        campo('f-grados', { nombre: 'gradoDesde', etiqueta: 'Del grado', tipo: 'number', valor: d.grados.gradoDesde, min: 1, max: 99, requerido: true }),
        campo('f-grados', { nombre: 'gradoHasta', etiqueta: 'Al grado', tipo: 'number', valor: d.grados.gradoHasta, min: 1, max: 99, requerido: true }),
      ),
      h('div', { class: 'fila' },
        campo('f-grados', { nombre: 'gruposPorGrado', etiqueta: 'Grupos por grado', tipo: 'number', valor: d.grados.gruposPorGrado, min: 1, max: 99, requerido: true }),
        capacidad,
      ),
      h('div', { class: 'acciones acciones--izq' }, botonAccion('Personalizar grados y grupos', () => {
        const f = raiz.querySelector<HTMLFormElement>('#f-grados');
        if (f) leerPaso(f);
        try {
          d.grados.personalizados = ctx.s.asistente.previsualizarGrados(d).map((g) => ({ ...g, grupos: [...g.grupos] }));
          guardarBorrador(b); pintar();
        } catch (e) { avisar(esErrorDominio(e) ? `Primero corrige los valores: ${e.message}` : 'Revisa los valores.', 'error'); }
      }, 'secundario')),
      h('p', { class: 'ayuda' }, 'Personaliza si algún grado tiene distinto número de grupos o grupos con otros nombres.'),
      vista,
    );
    form.addEventListener('input', actualizarVista);
    actualizarVista();
    return form;
  };

  const pasoRevisar = () => {
    const editar = (paso: number, nombre: string) => botonAccion('Cambiar', () => ir(paso), 'secundario', `Cambiar ${nombre}`);
    let bloques: ReturnType<typeof ctx.s.asistente.previsualizarBloques> = [];
    try { bloques = ctx.s.asistente.previsualizarBloques(d); } catch { /* se informa al guardar */ }
    let grados: ReturnType<typeof ctx.s.asistente.previsualizarGrados> = [];
    try { grados = ctx.s.asistente.previsualizarGrados(d); } catch { /* se informa al guardar */ }
    const periodos = bloques.filter((x) => x.tipo === 'periodo');
    const recesos = bloques.filter((x) => x.tipo === 'receso');
    const minutosClase = periodos.reduce((s, x) => s + duracionMinutos(x.horaInicio, x.horaFin), 0);
    const e = d.escuela;
    const nivel = e.nivel as NivelEducativo;
    const cct = e.cct ? String(e.cct).toUpperCase().replace(/[\s-]/g, '') : null;

    const resumen = (titulo: string, paso: number, ...lineas: (string | HTMLElement | null)[]) =>
      h('section', { class: 'resumen' },
        h('div', { class: 'resumen__cabeza' }, h('h2', {}, titulo), editar(paso, titulo.toLowerCase())),
        ...lineas.filter((l): l is string | HTMLElement => !!l).map((l) => (typeof l === 'string' ? h('p', {}, l) : l)),
      );

    const form = formulario('f-revisar', null,
      resumen('Escuela', 0,
        e.logotipo ? h('img', { class: 'logo-vista', src: e.logotipo, alt: 'Logotipo de la escuela', width: 64, height: 64 }) : null,
        e.nombre, e.nombreCorto ? `Nombre corto: ${e.nombreCorto}` : null, `CCT ${cct ?? 'sin capturar'}`, NIVEL_ETIQUETA[nivel] ?? '',
        [e.localidad, nombreEntidad(e.entidad)].filter(Boolean).join(', ') || null,
        [e.zonaEscolar ? `Zona ${e.zonaEscolar}` : null, e.sector ? `Sector ${e.sector}` : null].filter(Boolean).join(', ') || null,
        e.domicilio || null, [e.telefono, e.correo].filter(Boolean).join(', ') || null),
      resumen('Ciclo escolar', 1, d.ciclo.nombre, `Del ${formatoFecha(d.ciclo.fechaInicio)} al ${formatoFecha(d.ciclo.fechaFin)}`, d.ciclo.enCurso ? 'Se activará como ciclo en curso' : 'Quedará en planeación'),
      resumen('Turno y jornada', 2, `${d.turno.nombre}, de ${d.turno.horaInicio} a ${d.turno.horaFin}`, textoDias(d.turno.dias.map(Number))),
      resumen('Periodos y recesos', 3,
        `${periodos.length} periodo(s) (${formatoDuracion(minutosClase)} de clase) y ${recesos.length} receso(s)`,
        h('ol', { class: 'resumen__lista' }, ...bloques.map((x) => h('li', {}, `${x.horaInicio}–${x.horaFin} ${x.tipo === 'receso' ? '☕ ' : ''}${x.nombre}`)))),
      resumen('Grados y grupos', 4,
        `${grados.length} grado(s) y ${grados.reduce((s, g) => s + g.grupos.length, 0)} grupo(s)${d.grados.capacidad ? `, ${d.grados.capacidad} lugares cada uno` : ''}`,
        h('ul', { class: 'resumen__lista' }, ...grados.map((g) => h('li', {}, `${g.nombre}: ${g.grupos.join(', ')}`)))),
    );
    agregar(form, h('p', { class: 'ayuda' }, 'Nada se guarda hasta que pulses «Guardar escuela».'), h('div', { class: 'asistente__nav' }, botonAccion('Atrás', () => ir(b.paso - 1)), botonEnviar('Guardar escuela')));
    return alEnviar(form, async () => {
      const r = await ctx.s.asistente.crearEscuelaCompleta(d);
      descartarBorrador();
      void solicitarPersistencia();
      ctx.ir(`#/escuela/${r.escuela.id}`);
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
