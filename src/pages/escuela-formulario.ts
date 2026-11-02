import type { ContextoPagina, Vista } from '../app';
import { h } from '../components/dom';
import { alEnviar, botonEnviar, campo, formulario, selector, texto } from '../components/formulario';
import { encabezado, migas } from '../components/piezas';
import { NIVELES_EDUCATIVOS, type Escuela } from '../models';
import { NIVEL_ETIQUETA } from './etiquetas';
import { solicitarPersistencia } from '../utils/almacenamiento';

export async function paginaEscuelaNueva(ctx: ContextoPagina): Promise<Vista> {
  return vista(ctx, null);
}

export async function paginaEscuelaEditar(ctx: ContextoPagina, id: string): Promise<Vista> {
  return vista(ctx, await ctx.s.escuelas.obtener(id));
}

function vista(ctx: ContextoPagina, escuela: Escuela | null): Vista {
  const titulo = escuela ? 'Editar escuela' : 'Registrar escuela';
  const f = 'f-escuela';
  const form = formulario(f, null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre de la escuela', valor: escuela?.nombre, requerido: true, maxlength: 150, autocompletar: 'organization' }),
    selector(f, {
      nombre: 'nivel', etiqueta: 'Nivel educativo', requerido: true, valor: escuela?.nivel ?? 'secundaria',
      opciones: NIVELES_EDUCATIVOS.map((n) => ({ valor: n, texto: NIVEL_ETIQUETA[n] })),
    }),
    campo(f, { nombre: 'cct', etiqueta: 'Clave de centro de trabajo (CCT)', valor: escuela?.cct, maxlength: 20, mayusculas: true, ayuda: 'Letras y números, sin espacios. Evita registrar la misma escuela dos veces.' }),
    campo(f, { nombre: 'localidad', etiqueta: 'Localidad o municipio', valor: escuela?.localidad, maxlength: 120 }),
    h('div', { class: 'acciones' },
      h('a', { class: 'boton boton--secundario', href: escuela ? `#/escuela/${escuela.id}` : '#/' }, 'Cancelar'),
      botonEnviar(escuela ? 'Guardar cambios' : 'Registrar escuela'),
    ),
  );

  alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), nivel: texto(form, 'nivel') as Escuela['nivel'], cct: texto(form, 'cct'), localidad: texto(form, 'localidad') };
    if (escuela) {
      await ctx.s.escuelas.actualizar(escuela.id, entrada);
      ctx.ir(`#/escuela/${escuela.id}`);
      return 'Escuela actualizada.';
    }
    const nueva = await ctx.s.escuelas.crear(entrada);
    void solicitarPersistencia(); // tras el primer registro, pedimos no borrar los datos
    ctx.ir(`#/escuela/${nueva.id}`);
    return `Escuela «${nueva.nombre}» registrada.`;
  });

  return {
    titulo,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, ...(escuela ? [{ texto: escuela.nombre, href: `#/escuela/${escuela.id}` }] : []), { texto: titulo }]),
      encabezado(titulo),
      form,
    ),
  };
}
