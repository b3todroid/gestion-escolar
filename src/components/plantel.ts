import { h } from './dom';
import { campo, selector, texto } from './formulario';
import { desplegable } from './piezas';
import { avisar } from './avisos';
import { NIVELES_EDUCATIVOS, type NivelEducativo } from '../models';
import { ENTIDADES } from '../domain/catalogos';
import type { EntradaEscuela } from '../validators/esquemas';

export const NIVEL_TEXTO: Record<NivelEducativo, string> = {
  inicial: 'Educación inicial', preescolar: 'Preescolar', primaria: 'Primaria', secundaria: 'Secundaria', media_superior: 'Media superior', otro: 'Otro',
};

const LADO_LOGO = 256;
const LIMITE_LOGO = 3 * 1024 * 1024;

/**
 * Reduce el logotipo a 256 px y lo convierte a PNG en el propio dispositivo
 * (se descartan metadatos). Sólo PNG, JPG o WebP; nunca SVG.
 */
export async function procesarLogotipo(archivo: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) throw new Error('El logotipo debe ser una imagen PNG, JPG o WebP.');
  if (archivo.size > LIMITE_LOGO) throw new Error('La imagen supera 3 MB.');
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_LOGO / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  return lienzo.toDataURL('image/png');
}

/** Valores iniciales (nombres de campo = propiedades de EntradaEscuela). */
export type ValoresPlantel = Partial<Record<keyof EntradaEscuela, string | null>>;

/**
 * Campos del plantel: obligatorios a la vista y los opcionales en un
 * desplegable (formularios breves). La entidad se sugiere a partir de la CCT.
 */
export function camposPlantel(f: string, v: ValoresPlantel, abrirOpcionales = false, demostracion = false): HTMLElement[] {
  const hayOpcionales = ['zonaEscolar', 'sector', 'domicilio', 'telefono', 'correo', 'logotipo'].some((k) => v[k as keyof EntradaEscuela]);
  const logo = h('input', { type: 'hidden', name: 'logotipo', value: v.logotipo ?? '' });
  const vista = h('img', { class: 'logo-vista', alt: 'Vista previa del logotipo', hidden: !v.logotipo, src: v.logotipo || undefined, width: 96, height: 96 });
  const quitar = h('button', { type: 'button', class: 'boton boton--chico boton--secundario', hidden: !v.logotipo }, 'Quitar logotipo');
  const archivo = h('input', { type: 'file', id: `${f}-logotipo-archivo`, accept: 'image/png,image/jpeg,image/webp', class: 'archivo', 'aria-describedby': `${f}-logotipo-ayuda` });
  const cambiar = (dato: string) => {
    logo.value = dato;
    vista.hidden = !dato; if (dato) vista.src = dato; else vista.removeAttribute('src');
    quitar.hidden = !dato;
    logo.dispatchEvent(new Event('input', { bubbles: true }));
    logo.dispatchEvent(new Event('change', { bubbles: true }));
  };
  archivo.addEventListener('change', async () => {
    const a = archivo.files?.[0];
    if (!a) return;
    try { cambiar(await procesarLogotipo(a)); } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo usar esa imagen.', 'error'); }
    archivo.value = '';
  });
  quitar.addEventListener('click', () => cambiar(''));

  const opcionales = desplegable('Datos adicionales (opcionales)', abrirOpcionales || hayOpcionales,
    h('div', { class: 'formulario formulario--anidado' },
      h('div', { class: 'fila' },
        campo(f, { nombre: 'zonaEscolar', etiqueta: 'Zona escolar', valor: v.zonaEscolar, maxlength: 20 }),
        campo(f, { nombre: 'sector', etiqueta: 'Sector', valor: v.sector, maxlength: 20 }),
      ),
      campo(f, { nombre: 'domicilio', etiqueta: 'Domicilio', valor: v.domicilio, maxlength: 200, autocompletar: 'street-address' }),
      h('div', { class: 'fila' },
        campo(f, { nombre: 'telefono', etiqueta: 'Teléfono', valor: v.telefono, maxlength: 20, autocompletar: 'tel', ayuda: '10 dígitos.' }),
        campo(f, { nombre: 'correo', etiqueta: 'Correo institucional', valor: v.correo, maxlength: 120, autocompletar: 'email' }),
      ),
      h('div', { class: 'campo', 'data-campo': 'logotipo' },
        h('label', { for: `${f}-logotipo-archivo` }, 'Logotipo', h('span', { class: 'opcional' }, ' (opcional)')),
        h('p', { class: 'ayuda', id: `${f}-logotipo-ayuda` }, 'PNG, JPG o WebP. Se reduce automáticamente y se guarda sólo en este dispositivo.'),
        h('div', { class: 'logo-campo' }, vista, h('div', { class: 'logo-campo__acciones' }, archivo, quitar)),
        logo,
        h('p', { class: 'error-campo', id: `${f}-logotipo-error`, hidden: true }),
      ),
    ),
  );

  // Escuela de DEMOSTRACIÓN (Fase 10): sin CCT; nunca se inventa una clave oficial.
  const cct = demostracion
    ? campo(f, { nombre: 'cct', etiqueta: 'Clave de centro de trabajo (CCT)', valor: '', maxlength: 14, ayuda: 'No aplica: es una escuela de DEMOSTRACIÓN con datos ficticios (identificador DEMO-001). No se inventa una clave oficial.' })
    : campo(f, { nombre: 'cct', etiqueta: 'Clave de centro de trabajo (CCT)', valor: v.cct, requerido: true, maxlength: 14, mayusculas: true, ayuda: '10 caracteres, como aparece en documentos oficiales (por ejemplo 00AAA0000A). Sólo se revisa el formato; no se consulta ningún registro oficial.' });
  if (demostracion) cct.querySelector('input')!.disabled = true;
  const entidad = selector(f, { nombre: 'entidad', etiqueta: 'Entidad federativa', requerido: !demostracion, valor: v.entidad ?? undefined, opciones: ENTIDADES.map(([c, n]) => ({ valor: c, texto: n })) });
  // Sugiere la entidad a partir de los dos primeros dígitos de la CCT (si no se eligió otra).
  const inCct = cct.querySelector('input')!;
  const selEntidad = entidad.querySelector('select')!;
  let sugerida = '';
  inCct.addEventListener('input', () => {
    const clave = inCct.value.trim().slice(0, 2);
    if (/^\d{2}$/.test(clave) && ENTIDADES.some(([c]) => c === clave) && (selEntidad.value === '' || selEntidad.value === sugerida)) {
      selEntidad.value = clave; sugerida = clave;
      selEntidad.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  return [
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre oficial de la escuela', valor: v.nombre, requerido: true, maxlength: 150, autocompletar: 'organization' }),
    campo(f, { nombre: 'nombreCorto', etiqueta: 'Nombre corto', valor: v.nombreCorto, maxlength: 60, ayuda: 'Cómo la llaman en el día a día, por ejemplo «Secundaria 15».' }),
    cct,
    selector(f, { nombre: 'nivel', etiqueta: 'Nivel educativo', requerido: true, valor: v.nivel ?? 'secundaria', opciones: NIVELES_EDUCATIVOS.map((n) => ({ valor: n, texto: NIVEL_TEXTO[n] })) }),
    h('div', { class: 'fila' },
      entidad,
      campo(f, { nombre: 'localidad', etiqueta: 'Municipio o alcaldía', valor: v.localidad, requerido: true, maxlength: 120 }),
    ),
    opcionales,
  ];
}

export function leerPlantel(form: HTMLFormElement): EntradaEscuela {
  return {
    nombre: texto(form, 'nombre'), nombreCorto: texto(form, 'nombreCorto'), cct: texto(form, 'cct'), nivel: texto(form, 'nivel') as NivelEducativo,
    entidad: texto(form, 'entidad'), localidad: texto(form, 'localidad'), zonaEscolar: texto(form, 'zonaEscolar'), sector: texto(form, 'sector'),
    domicilio: texto(form, 'domicilio'), telefono: texto(form, 'telefono'), correo: texto(form, 'correo'), logotipo: texto(form, 'logotipo') || null,
  };
}
