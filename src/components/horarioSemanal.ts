import { h, type Hijo } from './dom';
import type { DiaVista } from '../services/vistas';
import type { Segmento, TipoVista } from '../domain/horarioVista';
import { duracionMinutos, formatoDuracion } from '../domain/tiempo';

/** Etiqueta + símbolo por tipo: el estado nunca depende sólo del color. */
export const MARCA: Record<TipoVista, { etiqueta: string; simbolo: string }> = {
  clase: { etiqueta: 'CLASE', simbolo: '●' },
  servicio: { etiqueta: 'SERVICIO', simbolo: '◆' },
  receso: { etiqueta: 'RECESO', simbolo: '☕' },
  otra: { etiqueta: 'OTRA ACTIVIDAD', simbolo: '★' },
  sin_actividad: { etiqueta: 'SIN ACTIVIDAD REGISTRADA', simbolo: '○' },
};

export function etiquetaTipo(s: Pick<Segmento, 'tipo' | 'confirmada'>): string {
  const base = MARCA[s.tipo].etiqueta;
  return s.tipo === 'servicio' && s.confirmada === false ? `${base} (POR CONFIRMAR)` : base;
}

function tipoClase(s: Segmento): string {
  return `bloque-h bloque-h--${s.tipo}${s.tipo === 'servicio' && s.confirmada === false ? ' bloque-h--porconfirmar' : ''}${s.simultanea ? ' bloque-h--simultanea' : ''}`;
}

export function leyenda(tipos: TipoVista[] = ['clase', 'servicio', 'receso', 'otra', 'sin_actividad']): HTMLElement {
  return h('ul', { class: 'leyenda', 'aria-label': 'Tipos de bloque' },
    ...tipos.map((t) => h('li', { class: `bloque-h bloque-h--${t}` }, h('span', { class: 'bloque-h__tipo' }, h('span', { 'aria-hidden': 'true' }, MARCA[t].simbolo), ' ', MARCA[t].etiqueta))));
}

function contenidoSegmento(s: Segmento, conHora: boolean): Hijo[] {
  const titulo: Hijo = s.enlace ? h('a', { href: s.enlace }, s.titulo) : s.titulo;
  return [
    h('span', { class: 'bloque-h__tipo' }, h('span', { 'aria-hidden': 'true' }, MARCA[s.tipo].simbolo), ' ', etiquetaTipo(s), s.simultanea ? ' (CASO ESPECIAL)' : ''),
    conHora ? h('span', { class: 'bloque-h__hora' }, `${s.horaInicio}–${s.horaFin}`, h('span', { class: 'bloque-h__dur' }, ` ${formatoDuracion(duracionMinutos(s.horaInicio, s.horaFin))}`)) : null,
    s.tipo === 'sin_actividad' || s.tipo === 'receso' ? null : h('span', { class: 'bloque-h__titulo' }, titulo),
    s.detalle ? h('span', { class: 'bloque-h__detalle' }, s.enlaceDetalle ? h('a', { href: s.enlaceDetalle }, s.detalle) : s.detalle) : null,
  ];
}

/**
 * Tabla semanal de un grupo: filas = periodos y recesos del turno (iguales
 * todos los días), columnas = días. Va en un contenedor con desplazamiento
 * propio para que la página no se desborde en teléfonos.
 */
export function tablaSemanaGrupo(dias: DiaVista[], titulo: string): HTMLElement {
  const filas = dias[0]?.segmentos.map((s) => ({ horaInicio: s.horaInicio, horaFin: s.horaFin })) ?? [];
  return h('div', { class: 'tabla-semana', role: 'region', 'aria-label': titulo, tabindex: '0' },
    h('table', {},
      h('caption', { class: 'solo-lectores' }, titulo),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Hora'), ...dias.map((d) => h('th', { scope: 'col' }, d.nombre)))),
      h('tbody', {}, ...filas.map((f, i) => h('tr', {},
        h('th', { scope: 'row', class: 'tabla-semana__hora' }, f.horaInicio, h('br', {}), f.horaFin),
        ...dias.map((d) => {
          const s = d.segmentos[i];
          return h('td', {}, s ? h('div', { class: tipoClase(s) }, ...contenidoSegmento(s, false)) : null);
        }),
      ))),
    ),
  );
}

/** Semana de un docente: cada día es una columna con sus bloques en orden. */
export function columnasSemanaDocente(dias: DiaVista[]): HTMLElement {
  return h('div', { class: 'semana-docente' }, ...dias.map((d) => h('section', { class: 'semana-docente__dia', 'aria-label': d.nombre },
    h('h3', {}, d.nombre),
    d.segmentos.length
      ? h('ol', { class: 'semana-docente__lista' }, ...d.segmentos.map((s) => h('li', { class: tipoClase(s) }, ...contenidoSegmento(s, true))))
      : h('p', { class: 'bloque-h bloque-h--sin_actividad' }, h('span', { class: 'bloque-h__tipo' }, '○ SIN ACTIVIDAD REGISTRADA')),
  )));
}
