import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { seccion, vacio } from '../components/piezas';
import { MARCA, etiquetaTipo } from '../components/horarioSemanal';
import type { Personal } from '../models';
import type { BloquePanel, Panel } from '../services/panelDocente';
import { nombreCompleto } from '../services/personal';
import { nombreAlumno } from '../services/alumnos';
import { ETIQUETA_ESTADO_ACTUAL } from '../domain/actividadActual';
import { horaLocal } from '../utils/fechas';

function fechaLarga(d: Date): string {
  const t = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tipo(b: BloquePanel) {
  return h('span', { class: `etiqueta-tipo etiqueta-tipo--${b.segmento.tipo}` }, h('span', { 'aria-hidden': 'true' }, MARCA[b.segmento.tipo].simbolo), ' ', etiquetaTipo(b.segmento));
}

function botonLista(b: BloquePanel, fecha: string, grande: boolean) {
  if (!b.sesionId) return null;
  return h('a', { class: `boton${grande ? ' boton--ancho boton--grande' : ' boton--chico'}${b.listaGuardada ? ' boton--secundario' : ''}`, href: `#/lista/${b.sesionId}/${fecha}` },
    b.listaGuardada ? '✓ Lista guardada: ver o corregir' : 'Pasar lista');
}

function tarjetaAhora(p: Panel) {
  const a = p.actual;
  if (!a) {
    return h('section', { class: 'ahora ahora--vacio', 'aria-labelledby': 'ahora-titulo', 'data-estado': p.estado },
      h('h2', { id: 'ahora-titulo' }, 'Ahora'),
      h('span', { class: 'etiqueta-tipo etiqueta-tipo--fuera' }, h('span', { 'aria-hidden': 'true' }, '◌'), ' ', ETIQUETA_ESTADO_ACTUAL.fuera_de_jornada),
      h('p', { class: 'ahora__principal' }, p.hoy.length ? 'Fuera de tu jornada de hoy' : 'Hoy no tienes clases ni actividades registradas'),
    );
  }
  const s = a.segmento;
  return h('section', { class: `ahora ahora--${s.tipo}`, 'aria-labelledby': 'ahora-titulo', 'data-estado': p.estado },
    h('h2', { id: 'ahora-titulo' }, 'Ahora'),
    tipo(a),
    s.tipo === 'clase'
      ? h('div', { class: 'ahora__clase' },
          h('p', { class: 'ahora__grupo' }, h('span', { class: 'solo-lectores' }, 'Grupo: '), a.grupo),
          h('p', { class: 'ahora__materia' }, h('span', { class: 'solo-lectores' }, 'Materia: '), a.materia))
      : h('p', { class: 'ahora__principal' }, s.tipo === 'sin_actividad' || s.tipo === 'receso' ? (s.tipo === 'receso' ? 'Receso' : 'Sin actividad registrada') : s.titulo),
    h('p', { class: 'ahora__hora' }, `${s.horaInicio} a ${s.horaFin}`, h('span', {}, ` (termina a las ${s.horaFin})`)),
    s.tipo === 'clase' ? botonLista(a, p.fecha, true) : null,
    s.tipo === 'clase' && a.grupoId ? h('a', { class: 'boton boton--secundario boton--ancho', href: `#/alumnos/${a.grupoId}` }, `Entrar al grupo ${a.grupo}`) : null,
  );
}

function tarjetaSiguiente(p: Panel) {
  const n = p.siguiente;
  return h('section', { class: 'siguiente', 'aria-labelledby': 'siguiente-titulo' },
    h('h2', { id: 'siguiente-titulo' }, 'Después'),
    n
      ? h('div', {},
          tipo(n),
          h('p', { class: 'siguiente__texto' }, n.segmento.tipo === 'clase' ? `${n.grupo}, ${n.materia}` : n.segmento.tipo === 'receso' ? 'Receso' : n.segmento.titulo),
          h('p', { class: 'siguiente__hora' }, `${n.diaNombre ? `${n.diaNombre}, ` : ''}${n.segmento.horaInicio} a ${n.segmento.horaFin}`))
      : h('p', {}, 'No hay más actividades registradas esta semana.'),
    p.siguienteClase && p.siguienteClase !== n
      ? h('p', { class: 'siguiente__clase', id: 'siguiente-clase' }, h('strong', {}, 'Siguiente clase: '),
          `${p.siguienteClase.grupo}, ${p.siguienteClase.materia} — ${p.siguienteClase.diaNombre ? `${p.siguienteClase.diaNombre}, ` : ''}${p.siguienteClase.segmento.horaInicio}`)
      : null,
  );
}

export async function paginaMiDia(ctx: ContextoPagina, persona: Personal): Promise<Vista> {
  const ahora = new Date();
  const p = await ctx.s.panel.panel(persona, ahora);
  const respaldo = await ctx.s.respaldos.estado(persona.escuelaId, ahora);
  const reloj = h('p', { class: 'reloj', 'aria-label': 'Hora actual' }, horaLocal(ahora));
  const firma = `${p.actual?.segmento.horaInicio ?? ''}|${p.siguiente?.segmento.horaInicio ?? ''}`;

  // Reloj vivo; si cambia la actividad, se vuelve a calcular el panel.
  const temporizador = window.setInterval(async () => {
    if (!reloj.isConnected) { window.clearInterval(temporizador); return; }
    const ya = new Date();
    reloj.textContent = horaLocal(ya);
    const nuevo = await ctx.s.panel.panel(persona, ya);
    if (`${nuevo.actual?.segmento.horaInicio ?? ''}|${nuevo.siguiente?.segmento.horaInicio ?? ''}` !== firma && reloj.isConnected) {
      window.clearInterval(temporizador);
      void ctx.recargar();
    }
  }, 20_000);

  const nombre = nombreCompleto(persona);
  // Alumnos fuera del aula en los grupos del docente (salidas activas: persisten al cambiar de pantalla).
  const fuera: { nombre: string; grupo: string; salida: string; sesionId: string; fecha: string }[] = [];
  for (const g of p.grupos) {
    for (const s of await ctx.s.asistencia.fueraDelAula(g.grupoId)) {
      const al = await ctx.s.alumnos.obtener(s.alumnoId);
      fuera.push({ nombre: nombreAlumno(al), grupo: g.grupo, salida: s.salida, sesionId: s.sesionId, fecha: s.fecha });
    }
  }
  return {
    titulo: 'Mi día',
    contenido: h('div', { class: 'pagina mi-dia' },
      h('header', { class: 'mi-dia__cabeza' },
        h('p', { class: 'mi-dia__fecha' }, fechaLarga(ahora)),
        reloj,
        h('h1', { tabindex: '-1' }, `Hola, ${persona.nombre}`),
        h('p', { class: 'mi-dia__escuela', id: 'mi-dia-escuela' }, p.escuela, p.turno ? ` · Turno ${p.turno}` : '', p.ciclo ? ` · Ciclo ${p.ciclo.nombre}` : ''),
      ),
      fuera.length ? h('section', { class: 'pendiente pendiente--fuera', id: 'fuera-del-aula', 'aria-labelledby': 'fuera-titulo' },
        h('h2', { id: 'fuera-titulo' }, `🚻 Fuera del aula (${fuera.length})`),
        h('ul', { class: 'renglones' }, ...fuera.map((x) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, x.nombre, h('span', { class: 'renglon__sub' }, ` ${x.grupo}, desde las ${x.salida}`)),
          h('a', { class: 'boton boton--chico', href: `#/lista/${x.sesionId}/${x.fecha}` }, 'Registrar regreso'))))) : null,
      respaldo.recordar ? h('div', { class: 'pendiente', role: 'status' },
        h('p', {}, icono('!'), ' Las listas y reportes de este dispositivo no tienen respaldo reciente.'),
        h('a', { class: 'boton boton--chico', href: '#/respaldos' }, 'Descargar respaldo')) : null,
      !p.ciclo ? h('p', { class: 'mensaje' }, icono('ℹ'), ' Tu escuela no tiene un ciclo escolar activo. Pide a la dirección que lo active.') : null,
      p.ciclo ? tarjetaAhora(p) : null,
      p.ciclo ? tarjetaSiguiente(p) : null,
      p.pendientes.length ? seccion('pendientes', 'Listas sin guardar de hoy',
        h('ul', { class: 'renglones' }, ...p.pendientes.map((b) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, `${b.segmento.horaInicio} ${b.grupo}`, h('span', { class: 'renglon__sub' }, ` ${b.materia}`)),
          botonLista(b, p.fecha, false),
        )))) : null,
      p.hoy.length ? seccion('hoy', 'Hoy',
        h('ol', { class: 'agenda' }, ...p.hoy.map((b) => h('li', { class: `agenda__item${b === p.actual ? ' agenda__item--actual' : ''}`, 'aria-current': b === p.actual ? 'time' : undefined },
          h('span', { class: 'agenda__hora' }, `${b.segmento.horaInicio}–${b.segmento.horaFin}`),
          h('span', { class: 'agenda__cuerpo' }, tipo(b), b.segmento.tipo === 'clase' ? h('span', {}, `${b.grupo}, ${b.materia}`) : b.segmento.tipo === 'servicio' || b.segmento.tipo === 'otra' ? h('span', {}, b.segmento.titulo) : null),
          b.segmento.tipo === 'clase' ? botonLista(b, p.fecha, false) : null,
        )))) : null,
      p.grupos.length ? seccion('mis-grupos', 'Mis grupos',
        h('ul', { class: 'renglones' }, ...p.grupos.map((g) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, g.grupo, h('span', { class: 'renglon__sub' }, ` ${g.materias.join(', ')}`)),
          h('a', { class: 'boton boton--chico boton--secundario', href: `#/alumnos/${g.grupoId}` }, 'Alumnos'),
        )))) : p.ciclo ? vacio('No tienes grupos asignados en el ciclo activo.') : null,
      h('nav', { class: 'mi-dia__enlaces', 'aria-label': 'Más opciones' },
        h('a', { class: 'boton boton--secundario boton--chico', href: p.ciclo ? `#/personal/${persona.id}/ciclo/${p.ciclo.id}` : `#/personal/${persona.id}` }, 'Mi horario semanal'),
        h('a', { class: 'boton boton--secundario boton--chico', href: '#/escuelas' }, 'Configuración escolar'),
        h('a', { class: 'boton boton--secundario boton--chico', href: '#/aplicacion' }, 'Aplicación y datos'),
      ),
      h('p', { class: 'ayuda mi-dia__pie' },
        `Este dispositivo está configurado para ${nombre}. No es una cuenta: cualquiera con acceso al dispositivo puede cambiarlo. `,
        h('a', { href: '#/perfil' }, 'Cambiar de docente')),
    ),
  };
}

/** Inicio: el panel del docente si el dispositivo tiene perfil; si no, las escuelas. */
export async function paginaRaiz(ctx: ContextoPagina): Promise<Vista> {
  const persona = await ctx.s.panel.perfil();
  if (persona) return paginaMiDia(ctx, persona);
  const { paginaInicio } = await import('./inicio');
  return paginaInicio(ctx);
}
