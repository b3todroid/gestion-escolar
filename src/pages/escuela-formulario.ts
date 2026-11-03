import type { ContextoPagina, Vista } from '../app';
import { h } from '../components/dom';
import { alEnviar, botonEnviar, formulario } from '../components/formulario';
import { encabezado, migas } from '../components/piezas';
import { camposPlantel, leerPlantel } from '../components/plantel';
import type { Escuela } from '../models';
import { solicitarPersistencia } from '../utils/almacenamiento';

export async function paginaEscuelaNueva(ctx: ContextoPagina): Promise<Vista> {
  return vista(ctx, null);
}

export async function paginaEscuelaEditar(ctx: ContextoPagina, id: string): Promise<Vista> {
  return vista(ctx, await ctx.s.escuelas.obtener(id));
}

/** Alta rápida (sólo datos del plantel) o edición de los datos escolares. */
function vista(ctx: ContextoPagina, escuela: Escuela | null): Vista {
  const titulo = escuela ? 'Editar datos escolares' : 'Registrar escuela';
  const f = 'f-escuela';
  const form = formulario(f, null,
    ...camposPlantel(f, escuela ?? {}),
    h('div', { class: 'acciones' },
      h('a', { class: 'boton boton--secundario', href: escuela ? `#/escuela/${escuela.id}` : '#/' }, 'Cancelar'),
      botonEnviar(escuela ? 'Guardar cambios' : 'Registrar escuela'),
    ),
  );

  alEnviar(form, async () => {
    const entrada = leerPlantel(form);
    if (escuela) {
      await ctx.s.escuelas.actualizar(escuela.id, entrada, true);
      ctx.ir(`#/escuela/${escuela.id}`);
      return 'Datos escolares actualizados.';
    }
    const nueva = await ctx.s.escuelas.crear(entrada, true);
    void solicitarPersistencia();
    ctx.ir(`#/escuela/${nueva.id}`);
    return `Escuela «${nueva.nombre}» registrada.`;
  });

  return {
    titulo,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, ...(escuela ? [{ texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }] : []), { texto: titulo }]),
      encabezado(titulo, escuela ? null : 'Para configurar todo de una vez (ciclo, jornada, grados y grupos), usa «Configurar mi escuela» desde el inicio.'),
      form,
    ),
  };
}
