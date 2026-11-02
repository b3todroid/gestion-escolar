import { h } from './dom';

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
