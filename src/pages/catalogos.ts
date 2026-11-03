import type { ContextoPagina } from '../app';
import { h } from '../components/dom';
import type { CicloEscolar } from '../models';

export type SeccionCatalogo = 'personal' | 'docentes' | 'materias' | 'alumnos' | 'importar';

/** Ciclo vigente de la escuela: activo, si no el de planeación, si no el más reciente. */
export async function cicloVigente(ctx: ContextoPagina, escuelaId: string): Promise<CicloEscolar | null> {
  const ciclos = await ctx.s.ciclos.listar(escuelaId);
  return ciclos.find((c) => c.estado === 'activo') ?? ciclos.find((c) => c.estado === 'planeacion') ?? ciclos[0] ?? null;
}

/** Menú de catálogos escolares (Personal, Docentes, Materias, Alumnos, Importar información). */
export function navCatalogos(escuelaId: string, cicloId: string | null, actual: SeccionCatalogo, marcarActual = true): HTMLElement {
  const enlaces: [SeccionCatalogo, string, string | null][] = [
    ['personal', 'Personal', `#/escuela/${escuelaId}/personal`],
    ['docentes', 'Docentes', cicloId ? `#/ciclo/${cicloId}/docentes` : null],
    ['materias', 'Materias', cicloId ? `#/ciclo/${cicloId}/materias` : null],
    ['alumnos', 'Alumnos', cicloId ? `#/ciclo/${cicloId}/alumnos` : null],
    ['importar', 'Importar información', cicloId ? `#/ciclo/${cicloId}/importar-datos` : null],
  ];
  return h('nav', { class: 'subnav', 'aria-label': 'Catálogos escolares' },
    h('ul', {}, ...enlaces.filter(([, , href]) => href).map(([clave, texto, href]) =>
      h('li', {}, h('a', { href: href!, class: 'subnav__enlace', 'aria-current': marcarActual && clave === actual ? 'page' : undefined }, texto)))));
}
