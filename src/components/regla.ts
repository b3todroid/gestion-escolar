import { h } from './dom';
import { aMinutos, desdeMinutos, duracionMinutos, formatoDuracion } from '../domain/tiempo';

interface BloqueRegla {
  tipo: 'periodo' | 'receso';
  nombre: string;
  horaInicio: string;
  horaFin: string;
}

const PX_POR_MINUTO = 1.15;

/** Posición vía CSSOM (permitido por la CSP, a diferencia del atributo style). */
function posicionar<T extends HTMLElement>(el: T, estilos: Partial<Record<'top' | 'height', number>>): T {
  for (const [k, v] of Object.entries(estilos)) el.style.setProperty(k, `${v}px`);
  return el;
}

/**
 * La jornada dibujada como una regla vertical: cada bloque mide en proporción
 * a sus minutos, de modo que huecos y recesos se ven de un vistazo.
 * La parte gráfica es decorativa (aria-hidden); la lista oculta da el mismo
 * contenido a lectores de pantalla.
 */
export function regla(jornada: { horaInicio: string; horaFin: string }, bloques: readonly BloqueRegla[]): HTMLElement {
  const inicio = aMinutos(jornada.horaInicio);
  const total = aMinutos(jornada.horaFin) - inicio;
  const y = (hora: string) => (aMinutos(hora) - inicio) * PX_POR_MINUTO;

  const marcas: HTMLElement[] = [];
  for (let m = Math.ceil(inicio / 60) * 60; m <= inicio + total; m += 60) {
    marcas.push(posicionar(h('span', { class: 'regla__hora' }, desdeMinutos(m)), { top: (m - inicio) * PX_POR_MINUTO }));
  }

  let n = 0;
  const piezas = bloques.map((b) => {
    const min = duracionMinutos(b.horaInicio, b.horaFin);
    if (b.tipo === 'periodo') n++;
    return posicionar(h('div', {
      class: `regla__bloque regla__bloque--${b.tipo}${min < 25 ? ' regla__bloque--corto' : ''}`,
    },
      h('span', { class: 'regla__nombre' }, b.tipo === 'periodo' ? String(n) : '', b.tipo === 'periodo' ? h('span', { class: 'regla__sub' }, ` ${b.nombre}`) : b.nombre),
      h('span', { class: 'regla__rango' }, `${b.horaInicio}–${b.horaFin}`),
    ), { top: y(b.horaInicio), height: min * PX_POR_MINUTO });
  });

  return h('figure', { class: 'regla' },
    posicionar(h('div', { class: 'regla__lienzo', 'aria-hidden': 'true' },
      h('div', { class: 'regla__escala' }, ...marcas),
      h('div', { class: 'regla__pista' }, ...piezas),
    ), { height: total * PX_POR_MINUTO }),
    h('figcaption', { class: 'regla__pie' },
      `Entrada ${jornada.horaInicio}, salida ${jornada.horaFin}. ${bloques.length} bloques.`),
    h('ol', { class: 'solo-lectores' }, ...bloques.map((b) =>
      h('li', {}, `${b.nombre}, ${b.tipo === 'receso' ? 'receso' : 'clase'}, de ${b.horaInicio} a ${b.horaFin}, ${formatoDuracion(duracionMinutos(b.horaInicio, b.horaFin))}.`),
    )),
  );
}
