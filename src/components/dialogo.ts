import { agregar, h } from './dom';

export interface OpcionesConfirmacion {
  titulo: string;
  mensaje: string;
  detalles?: string[];
  textoConfirmar?: string;
  textoCancelar?: string;
  peligro?: boolean;
  /** Sólo informa (una acción imposible): un único botón «Entendido». */
  soloInformar?: boolean;
}

/**
 * Diálogo modal accesible (sustituye a confirm()). Usa <dialog>, que gestiona
 * el foco, la tecla Escape y el bloqueo del resto de la página.
 */
export function confirmar(op: OpcionesConfirmacion): Promise<boolean> {
  return new Promise((resolver) => {
    const titulo = h('h2', { id: 'dialogo-titulo' }, op.titulo);
    const cancelar = h('button', { type: 'button', class: 'boton boton--secundario', value: 'no' }, op.soloInformar ? 'Entendido' : (op.textoCancelar ?? 'Cancelar'));
    const aceptar = h('button', { type: 'button', class: `boton ${op.peligro ? 'boton--peligro' : ''}`, value: 'si' }, op.textoConfirmar ?? 'Confirmar');
    const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'dialogo-titulo', 'aria-describedby': 'dialogo-mensaje' },
      titulo,
      h('p', { id: 'dialogo-mensaje' }, op.mensaje),
      op.detalles?.length ? h('ul', {}, ...op.detalles.map((d) => h('li', {}, d))) : null,
      h('div', { class: 'acciones' }, cancelar, op.soloInformar ? null : aceptar),
    );
    const cerrar = (r: boolean) => {
      dialogo.close();
      dialogo.remove();
      resolver(r);
    };
    cancelar.addEventListener('click', () => cerrar(false));
    aceptar.addEventListener('click', () => cerrar(true));
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      cerrar(false);
    });
    document.body.appendChild(dialogo);
    dialogo.showModal();
    cancelar.focus(); // la opción segura recibe el foco
  });
}

export interface OpcionElegible {
  valor: string;
  texto: string;
  detalle?: string;
  /** Si existe, la opción se muestra deshabilitada con este motivo. */
  motivo?: string | null;
  actual?: boolean;
}

/**
 * Diálogo para elegir una opción de una lista. Las no disponibles se muestran
 * con el motivo (texto, no sólo color). Devuelve el valor elegido o null.
 */
export function elegir(op: { titulo: string; descripcion?: string; opciones: OpcionElegible[]; textoVacio?: string; opcionLiberar?: string }): Promise<string | null | ''> {
  return new Promise((resolver) => {
    const dialogo = h('dialog', { class: 'dialogo dialogo--lista', 'aria-labelledby': 'elegir-titulo' });
    const cerrar = (r: string | null | '') => { dialogo.close(); dialogo.remove(); resolver(r); };
    const botones = op.opciones.map((o) => {
      const b = h('button', {
        type: 'button', class: `opcion${o.actual ? ' opcion--actual' : ''}`, disabled: !!o.motivo,
        'aria-describedby': o.motivo ? `motivo-${o.valor}` : undefined,
      },
        h('span', { class: 'opcion__texto' }, o.texto, o.actual ? h('span', { class: 'opcion__marca' }, ' (actual)') : null),
        o.detalle ? h('span', { class: 'opcion__detalle' }, o.detalle) : null,
        o.motivo ? h('span', { class: 'opcion__motivo', id: `motivo-${o.valor}` }, '⚠ ', o.motivo) : null,
      );
      b.addEventListener('click', () => cerrar(o.valor));
      return h('li', {}, b);
    });
    const cancelar = h('button', { type: 'button', class: 'boton boton--secundario' }, 'Cancelar');
    cancelar.addEventListener('click', () => cerrar(null));
    const liberar = op.opcionLiberar ? h('button', { type: 'button', class: 'boton boton--peligro' }, op.opcionLiberar) : null;
    liberar?.addEventListener('click', () => cerrar(''));
    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
    agregar(dialogo,
      h('h2', { id: 'elegir-titulo' }, op.titulo),
      op.descripcion ? h('p', { class: 'ayuda' }, op.descripcion) : null,
      botones.length ? h('ul', { class: 'opciones' }, ...botones) : h('p', {}, op.textoVacio ?? 'No hay opciones disponibles.'),
      h('div', { class: 'acciones' }, liberar, cancelar),
    );
    document.body.appendChild(dialogo);
    dialogo.showModal();
    (dialogo.querySelector<HTMLButtonElement>('.opcion:not([disabled])') ?? cancelar).focus();
  });
}
