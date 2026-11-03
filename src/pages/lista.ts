import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono } from '../components/dom';
import { encabezado, insignia, migas, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { confirmar, elegir } from '../components/dialogo';
import { pedirReporte } from '../components/reporte';
import type { MarcaAsistencia } from '../models';
import { esErrorDominio } from '../domain/errores';
import { aMinutos } from '../domain/tiempo';
import { nombreAlumno } from '../services/alumnos';
import { ETIQUETA_ESTADO_LISTA, estadoLista } from '../services/asistencia';
import { normalizarTexto } from '../domain/texto';
import { DIAS_SEMANA } from '../services/turnos';
import { diaDeFecha, fechaLocal, horaLocal } from '../utils/fechas';

interface Borrador { marcas: Map<string, MarcaAsistencia>; llegadas: Map<string, string> }

/**
 * Marcas sin guardar por clase y fecha. Viven en memoria mientras se usa la
 * app: registrar una salida o reincorporación (que sí se guarda al momento)
 * vuelve a dibujar la pantalla sin perder lo marcado. NO se guardan en la base
 * hasta «Guardar lista»: abrir la lista no registra nada.
 */
const borradores = new Map<string, Borrador>();

const ETIQUETA: Record<MarcaAsistencia, string> = { P: 'Presente', F: 'Falta', R: 'Retardo' };

function minutosDesde(hora: string, ahora: Date): number {
  return Math.max(0, aMinutos(horaLocal(ahora)) - aMinutos(hora));
}

export async function paginaLista(ctx: ContextoPagina, sesionId: string, fecha: string): Promise<Vista> {
  const l = await ctx.s.asistencia.abrirLista(sesionId, fecha);
  const ahora = new Date();
  const hoy = fechaLocal(ahora);
  const clave = `${sesionId}|${fecha}`;
  const persona = await ctx.s.panel.perfil();

  // Estado de partida: lo guardado o, si no hay, todos presentes.
  const guardadas = new Map([...l.marcas].map(([id, a]) => [id, a.marca]));
  const b: Borrador = borradores.get(clave) ?? { marcas: new Map(guardadas), llegadas: new Map([...l.marcas].filter(([, a]) => a.horaLlegada).map(([id, a]) => [id, a.horaLlegada!])) };
  borradores.set(clave, b);
  const marca = (id: string): MarcaAsistencia => b.marcas.get(id) ?? 'P';
  const salioEnClase = (id: string) => l.salidas.some((s) => s.alumnoId === id);
  const abierta = (id: string) => l.salidas.find((s) => s.alumnoId === id && s.regreso === null);
  const hayCambios = () => l.alumnos.some((a) => marca(a.id) !== (guardadas.get(a.id) ?? 'P'))
    || l.alumnos.some((a) => marca(a.id) === 'R' && (b.llegadas.get(a.id) ?? '') !== (l.marcas.get(a.id)?.horaLlegada ?? ''));
  const nombreDia = DIAS_SEMANA.find((d) => d.valor === diaDeFecha(fecha))?.nombre ?? '';
  const titulo = `${l.materia}, ${l.grupo.nombre}`;
  /** Hora de regreso: ahora (si es la clase de hoy), nunca antes de la salida. */
  const horaRegreso = (salida: string) => { const h0 = l.fecha === hoy ? horaLocal(new Date()) : salida; return aMinutos(h0) < aMinutos(salida) ? salida : h0; };

  const contador = h('p', { class: 'lista__contador', 'aria-live': 'polite' });
  const estadoEl = h('span', { id: 'estado-lista' });
  const pintarEstado = () => {
    const e = estadoLista(l.pase, hayCambios());
    const [v, s] = ({ no_iniciada: ['neutro', '○'], en_captura: ['aviso', '✎'], guardada: ['ok', '✓'], modificada: ['ok', '↻'] } as const)[e];
    estadoEl.replaceChildren(insignia(ETIQUETA_ESTADO_LISTA[e], v, s));
    if (hayCambios()) form.setAttribute('data-sin-guardar', ''); else form.removeAttribute('data-sin-guardar');
  };
  const pintarContador = () => {
    pintarEstado();
    const c = { P: 0, F: 0, R: 0 };
    for (const a of l.alumnos) c[marca(a.id)]++;
    const fuera = l.alumnos.filter((a) => abierta(a.id)).length;
    contador.replaceChildren();
    agregar(contador,
      h('span', { class: 'cuenta cuenta--P' }, `${c.P} presentes`),
      h('span', { class: 'cuenta cuenta--F' }, `${c.F} faltas`),
      h('span', { class: 'cuenta cuenta--R' }, `${c.R} retardos`),
      fuera ? h('span', { class: 'cuenta cuenta--fuera' }, `${fuera} fuera del aula`) : null,
    );
  };

  const form = h('form', { class: 'lista', id: 'f-lista', novalidate: true, 'aria-label': `Pase de lista de ${titulo}` });
  if (hayCambios()) form.setAttribute('data-sin-guardar', '');

  const accion = async (fn: () => Promise<string>) => {
    try { avisar(await fn(), 'exito'); await ctx.recargar(); }
    catch (e) { avisar(esErrorDominio(e) ? e.message : 'No se pudo guardar.', 'error'); }
  };

  const filas = l.alumnos.map((a, i) => {
    const fuera = abierta(a.id);
    const bloqueaF = salioEnClase(a.id);
    const fila = h('li', { class: `alumno alumno--${marca(a.id)}${fuera ? ' alumno--fuera' : ''}`, 'data-alumno': a.id });
    const nombre = nombreAlumno(a);
    const llegada = h('input', { type: 'time', class: 'alumno__llegada', 'aria-label': `Hora de llegada de ${nombre}`, value: b.llegadas.get(a.id) ?? '' });
    const cajaLlegada = h('label', { class: 'alumno__retardo', hidden: marca(a.id) !== 'R' }, 'Llegó a las ', llegada);
    llegada.addEventListener('input', () => { b.llegadas.set(a.id, llegada.value); });

    const grupoRadios = h('div', { class: 'marcas', role: 'radiogroup', 'aria-label': `Asistencia de ${nombre}` },
      ...(['P', 'F', 'R'] as const).map((m) => {
        const radio = h('input', { type: 'radio', name: `marca-${a.id}`, value: m, checked: marca(a.id) === m, 'aria-describedby': m === 'F' && bloqueaF ? `motivo-f-${a.id}` : undefined });
        radio.addEventListener('change', async () => {
          if (m === 'F' && bloqueaF) {
            // Conflicto: salió del aula en esta clase. Se pide una resolución explícita; nada cambia solo.
            const anterior = marca(a.id);
            fila.querySelector<HTMLInputElement>(`input[value="${anterior}"]`)!.checked = true;
            const salida = l.salidas.find((s) => s.alumnoId === a.id)!;
            const r = await elegir({
              titulo: `Conflicto: ${nombre} salió del aula`,
              descripcion: `Salió a las ${salida.salida}${salida.regreso ? ` y regresó a las ${salida.regreso}` : ' y sigue fuera'}. Un alumno que salió del aula en esta clase no puede tener falta. ¿Qué pasó?`,
              opciones: [
                ...(fuera ? [{ valor: 'regreso', texto: 'Registrar su regreso ahora', detalle: `Queda como ${ETIQUETA[anterior].toLowerCase()}.` }] : []),
                { valor: 'anular', texto: 'La salida se registró por error: anularla y marcar falta', detalle: 'Se borra la salida y el alumno queda con falta (sin guardar hasta «Guardar lista»).' },
              ],
            });
            if (r === 'regreso') await accion(async () => { await ctx.s.asistencia.reincorporar(fuera!.id, horaRegreso(fuera!.salida)); return `${a.nombre} se reincorporó al aula.`; });
            else if (r === 'anular') { b.marcas.set(a.id, 'F'); await accion(async () => { await ctx.s.asistencia.anularSalida(salida.id); return 'Salida anulada. Revisa y guarda la lista.'; }); }
            return;
          }
          b.marcas.set(a.id, m);
          if (m === 'R' && !b.llegadas.get(a.id)) { b.llegadas.set(a.id, l.fecha === hoy ? horaLocal(new Date()) : l.horaInicio); llegada.value = b.llegadas.get(a.id)!; }
          fila.className = `alumno alumno--${m}${fuera ? ' alumno--fuera' : ''}`;
          cajaLlegada.hidden = m !== 'R';
          botonBano.disabled = m === 'F' || !!fuera;
          botonBano.title = m === 'F' ? 'Tiene falta marcada' : '';
          pintarContador();
        });
        return h('label', { class: `marca marca--${m}`, title: ETIQUETA[m] },
          radio, h('span', { 'aria-hidden': 'true' }, m), h('span', { class: 'solo-lectores' }, ETIQUETA[m]));
      }),
    );

    const botonBano = h('button', { type: 'button', class: 'boton boton--chico boton--secundario', disabled: marca(a.id) === 'F' || !!fuera, 'aria-label': `Salida al baño de ${nombre}` }, 'Baño');
    botonBano.addEventListener('click', () => marca(a.id) !== 'F' && accion(async () => {
      await ctx.s.asistencia.registrarSalida(sesionId, fecha, a.id, l.fecha === hoy ? horaLocal(new Date()) : l.horaInicio, hoy, persona?.id ?? null);
      return `${a.nombre} salió al baño.`;
    }));
    const botonRegreso = fuera ? h('button', { type: 'button', class: 'boton boton--chico', 'aria-label': `Reincorporar a ${nombre}` }, 'Regresó') : null;
    botonRegreso?.addEventListener('click', () => accion(async () => {
      await ctx.s.asistencia.reincorporar(fuera!.id, horaRegreso(fuera!.salida));
      return `${a.nombre} se reincorporó al aula.`;
    }));
    const botonNota = h('button', { type: 'button', class: 'boton boton--chico boton--secundario', 'aria-label': `Reporte breve de ${nombre}` }, 'Reporte');
    botonNota.addEventListener('click', async () => {
      const r = await pedirReporte(nombre);
      if (r) await accion(async () => { await ctx.s.asistencia.crearReporte(a.id, r, { personalId: persona?.id ?? l.sesion.personalId, sesionId, fecha, hora: l.fecha === hoy ? horaLocal(new Date()) : null }); return 'Reporte guardado.'; });
    });

    agregar(fila,
      h('div', { class: 'alumno__cabeza' },
        h('span', { class: 'alumno__num', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'alumno__nombre' }, nombre),
      ),
      grupoRadios,
      cajaLlegada,
      bloqueaF ? h('p', { class: 'alumno__aviso', id: `motivo-f-${a.id}` }, icono('ℹ'), ' Salió del aula en esta clase: si marcas falta se te pedirá resolver el conflicto.') : null,
      fuera ? h('p', { class: 'alumno__fuera' }, insignia(`Fuera del aula desde las ${fuera.salida}${l.fecha === hoy ? ` (${minutosDesde(fuera.salida, ahora)} min)` : ''}`, 'aviso', '🚻')) : null,
      h('div', { class: 'alumno__acciones' }, botonRegreso ?? botonBano, botonNota),
    );
    return fila;
  });

  const guardar = h('button', { type: 'submit', class: 'boton boton--ancho boton--grande' }, l.pase ? 'Guardar cambios' : 'Guardar lista');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (guardar.disabled) return;
    if (l.pase && !hayCambios()) { avisar('No hay cambios que guardar.', 'info'); return; }
    if (l.pase && !(await confirmar({ titulo: 'Corregir la lista guardada', mensaje: `Esta lista ya se guardó. ¿Guardar los cambios?`, textoConfirmar: 'Guardar cambios' }))) return;
    guardar.disabled = true; guardar.textContent = 'Guardando…';
    try {
      const marcas = Object.fromEntries(l.alumnos.filter((a) => marca(a.id) !== 'P').map((a) => [a.id, marca(a.id)]));
      const llegadas = Object.fromEntries(l.alumnos.filter((a) => marca(a.id) === 'R' && b.llegadas.get(a.id)).map((a) => [a.id, b.llegadas.get(a.id)!]));
      const r = await ctx.s.asistencia.guardarLista(sesionId, fecha, marcas, llegadas, hoy, persona?.id ?? null);
      borradores.delete(clave);
      form.removeAttribute('data-sin-guardar');
      avisar(`${l.pase ? `Corrección guardada (${r.corregidos} cambio(s))` : 'Lista guardada'}: ${r.P} presentes, ${r.F} faltas, ${r.R} retardos. Guardado en este dispositivo.`, 'exito');
      await ctx.recargar();
    } catch (e) {
      avisar(esErrorDominio(e) ? e.message : 'No se pudo guardar la lista.', 'error');
      guardar.disabled = false; guardar.textContent = l.pase ? 'Guardar cambios' : 'Guardar lista';
    }
  });

  const buscador = h('input', { type: 'search', id: 'buscar-en-lista', autocomplete: 'off', placeholder: 'Nombre o apellido' });
  const sinCoincidencias = h('p', { class: 'vacio', hidden: true }, 'Nadie coincide con la búsqueda.');
  buscador.addEventListener('input', () => {
    const t = normalizarTexto(buscador.value);
    let n = 0;
    filas.forEach((f, i) => { const ok = !t || normalizarTexto(nombreAlumno(l.alumnos[i]!)).includes(t) || normalizarTexto(`${l.alumnos[i]!.nombre} ${l.alumnos[i]!.primerApellido}`).includes(t); f.hidden = !ok; if (ok) n++; });
    sinCoincidencias.hidden = n > 0;
  });
  const fueraAhora = l.alumnos.filter((a) => abierta(a.id));
  agregar(form,
    fueraAhora.length ? h('div', { class: 'pendiente pendiente--fuera', id: 'fuera-lista' },
      h('p', {}, h('strong', {}, `🚻 Fuera del aula (${fueraAhora.length}): `), fueraAhora.map((a) => `${nombreAlumno(a)} desde las ${abierta(a.id)!.salida}`).join('; '))) : null,
    l.alumnos.length > 4 ? h('div', { class: 'campo lista__buscar' }, h('label', { for: 'buscar-en-lista' }, 'Buscar alumno'), buscador) : null,
    sinCoincidencias,
    l.alumnos.length ? h('ol', { class: 'alumnos' }, ...filas) : null,
    l.alumnos.length ? h('div', { class: 'lista__barra' }, contador, guardar) : null,
  );
  pintarContador();

  const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const detalleEstado = l.pase
    ? `Guardada por primera vez el ${fechaHora(l.pase.creadoEn)}${l.pase.correcciones ? `; corregida ${l.pase.correcciones} vez(ces), la última el ${fechaHora(l.pase.guardadoEn)}` : ''}`
    : 'Nada se registra hasta que pulses «Guardar lista».';
  const nombreDe = (id: string) => { const x = l.alumnos.find((a) => a.id === id); return x ? nombreAlumno(x) : 'Alumno dado de baja'; };
  const historial = l.cambios.length ? h('details', { class: 'desplegable', id: 'historial-lista' },
    h('summary', {}, `Historial de correcciones (${l.cambios.length})`),
    h('ul', { class: 'renglones' }, ...l.cambios.map((c) => h('li', { class: 'renglon renglon--bloque' },
      h('span', { class: 'renglon__texto' }, `${nombreDe(c.alumnoId)}: ${ETIQUETA[c.marcaAnterior]} → ${ETIQUETA[c.marcaNueva]}${c.llegadaNueva ? ` (llegó ${c.llegadaNueva})` : ''}`),
      h('span', { class: 'renglon__meta' }, fechaHora(c.creadoEn)))))) : null;

  return {
    titulo: `Lista de ${titulo}`,
    contenido: h('div', { class: 'pagina pagina--lista' },
      migas([{ texto: 'Mi día', href: '#/' }, { texto: `Lista ${l.grupo.nombre}` }]),
      encabezado(titulo, `${nombreDia} ${fecha.split('-').reverse().join('/')}, de ${l.horaInicio} a ${l.horaFin}${l.docente ? `. ${l.docente}` : ''}`),
      h('p', { class: 'lista__estado' }, estadoEl, ' ', h('span', { class: 'ayuda' }, detalleEstado)),
      h('p', { class: 'lista__datos' }, `Grupo ${l.grupo.nombre} · ${l.materia} · ${l.periodo}`),
      l.alumnos.length
        ? h('p', { class: 'ayuda' }, 'Todos aparecen como presentes. Toca sólo las faltas (F) y los retardos (R).')
        : h('div', {}, vacio('Este grupo no tiene alumnos registrados.'), h('a', { class: 'boton', href: `#/alumnos/${l.grupo.id}` }, 'Registrar alumnos')),
      form,
      historial,
      h('a', { class: 'boton boton--secundario', href: `#/alumnos/${l.grupo.id}` }, `Ver alumnos y faltas de ${l.grupo.nombre}`),
    ),
  };
}
