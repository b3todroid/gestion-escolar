import { h } from './dom';
import { TIPOS_REPORTE, type TipoReporte } from '../models';

export const ETIQUETA_REPORTE: Record<TipoReporte, string> = {
  conducta: 'Conducta',
  academico: 'Académico',
  reconocimiento: 'Reconocimiento',
  otro: 'Otro',
};

/** Diálogo breve para un reporte de alumno (máx. 280 caracteres). */
export function pedirReporte(nombre: string): Promise<{ tipo: TipoReporte; texto: string } | null> {
  return new Promise((resolver) => {
    const tipo = h('select', { id: 'reporte-tipo' }, ...TIPOS_REPORTE.map((t) => h('option', { value: t }, ETIQUETA_REPORTE[t])));
    const texto = h('textarea', { id: 'reporte-texto', rows: 3, maxlength: 280, 'aria-describedby': 'reporte-ayuda reporte-error' });
    const error = h('p', { class: 'error-campo', id: 'reporte-error', hidden: true });
    const cancelar = h('button', { type: 'button', class: 'boton boton--secundario' }, 'Cancelar');
    const form = h('form', { class: 'formulario', method: 'dialog' },
      h('div', { class: 'campo' }, h('label', { for: 'reporte-tipo' }, 'Tipo'), tipo),
      h('div', { class: 'campo' }, h('label', { for: 'reporte-texto' }, 'Reporte'), h('p', { class: 'ayuda', id: 'reporte-ayuda' }, 'Breve y objetivo; máximo 280 caracteres.'), texto, error),
      h('div', { class: 'acciones' }, cancelar, h('button', { type: 'submit', class: 'boton' }, 'Guardar reporte')),
    );
    const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'reporte-titulo' }, h('h2', { id: 'reporte-titulo' }, `Reporte de ${nombre}`), form);
    const cerrar = (r: { tipo: TipoReporte; texto: string } | null) => { dialogo.close(); dialogo.remove(); resolver(r); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = texto.value.trim();
      if (t.length < 3) { error.hidden = false; error.textContent = '⚠ Escribe al menos 3 caracteres.'; texto.setAttribute('aria-invalid', 'true'); texto.focus(); return; }
      cerrar({ tipo: tipo.value as TipoReporte, texto: t });
    });
    cancelar.addEventListener('click', () => cerrar(null));
    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
    document.body.appendChild(dialogo);
    dialogo.showModal();
    tipo.focus();
  });
}
