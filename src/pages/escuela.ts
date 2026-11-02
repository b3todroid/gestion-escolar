import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import type { CicloEscolar, Escuela, EstadoCiclo } from '../models';
import { ETIQUETA_ESTADO } from '../services/ciclos';
import { NIVEL_ETIQUETA, formatoFecha } from './etiquetas';

const INSIGNIA_ESTADO: Record<EstadoCiclo, [variante: 'ok' | 'aviso' | 'neutro', simbolo: string]> = {
  activo: ['ok', '●'],
  planeacion: ['aviso', '◐'],
  cerrado: ['neutro', '■'],
};

export function insigniaCiclo(estado: EstadoCiclo): HTMLElement {
  const [v, s] = INSIGNIA_ESTADO[estado];
  return insignia(ETIQUETA_ESTADO[estado], v, s);
}

/** Sugiere el siguiente ciclo (p. ej. "2026-2027") a partir de la fecha actual. */
export function sugerenciaCiclo(): { nombre: string; fechaInicio: string; fechaFin: string } {
  const hoy = new Date();
  const a = hoy.getMonth() >= 6 ? hoy.getFullYear() : hoy.getFullYear() - 1;
  return { nombre: `${a}-${a + 1}`, fechaInicio: `${a}-08-31`, fechaFin: `${a + 1}-07-15` };
}

function formularioCiclo(ctx: ContextoPagina, escuela: Escuela, ciclo: CicloEscolar | null, alCancelar: () => void): HTMLFormElement {
  const f = 'f-ciclo';
  const valores = ciclo ?? sugerenciaCiclo();
  const form = formulario(f, ciclo ? `Editar ciclo ${ciclo.nombre}` : null,
    campo(f, { nombre: 'nombre', etiqueta: 'Nombre del ciclo', valor: valores.nombre, requerido: true, maxlength: 40, ayuda: 'Por ejemplo: 2026-2027.' }),
    h('div', { class: 'fila' },
      campo(f, { nombre: 'fechaInicio', etiqueta: 'Inicio', tipo: 'date', valor: valores.fechaInicio, requerido: true }),
      campo(f, { nombre: 'fechaFin', etiqueta: 'Fin', tipo: 'date', valor: valores.fechaFin, requerido: true }),
    ),
    h('div', { class: 'acciones' },
      ciclo ? botonAccion('Cancelar', alCancelar) : null,
      botonEnviar(ciclo ? 'Guardar cambios' : 'Agregar ciclo'),
    ),
  );
  return alEnviar(form, async () => {
    const entrada = { nombre: texto(form, 'nombre'), fechaInicio: texto(form, 'fechaInicio'), fechaFin: texto(form, 'fechaFin') };
    if (ciclo) {
      await ctx.s.ciclos.actualizar(ciclo.id, entrada);
      await ctx.recargar();
      return 'Ciclo actualizado.';
    }
    const nuevo = await ctx.s.ciclos.crear(escuela.id, entrada);
    await ctx.recargar();
    return `Ciclo ${nuevo.nombre} agregado.`;
  });
}

export async function paginaEscuela(ctx: ContextoPagina, id: string): Promise<Vista> {
  const escuela = await ctx.s.escuelas.obtener(id);
  const ciclos = await ctx.s.ciclos.listar(id);

  const contenedorForm = h('div', {});
  const panelForm = desplegable('Agregar ciclo escolar', ciclos.length === 0, contenedorForm);
  const mostrarAlta = () => contenedorForm.replaceChildren(formularioCiclo(ctx, escuela, null, mostrarAlta));
  mostrarAlta();

  const tarjetaCiclo = (c: CicloEscolar) => {
    const acciones = h('div', { class: 'acciones acciones--izq' },
      h('a', { class: 'boton boton--chico', href: `#/ciclo/${c.id}` }, 'Configurar'),
    );
    if (c.estado !== 'cerrado') {
      acciones.appendChild(botonAccion('Editar', () => {
        contenedorForm.replaceChildren(formularioCiclo(ctx, escuela, c, mostrarAlta));
        panelForm.open = true;
        contenedorForm.querySelector('input')?.focus();
      }, 'secundario', `Editar ciclo ${c.nombre}`));
    }
    if (c.estado === 'planeacion') {
      acciones.appendChild(botonAccion('Activar', async () => {
        if (await ejecutar(async () => { await ctx.s.ciclos.cambiarEstado(c.id, 'activo'); return `Ciclo ${c.nombre} activado.`; })) await ctx.recargar();
      }, 'secundario', `Activar ciclo ${c.nombre}`));
    }
    if (c.estado !== 'cerrado') {
      acciones.appendChild(botonAccion('Cerrar', async () => {
        const ok = await confirmar({
          titulo: `¿Cerrar el ciclo ${c.nombre}?`,
          mensaje: 'Un ciclo cerrado ya no puede modificarse ni reabrirse. Su información se conserva para consulta.',
          textoConfirmar: 'Cerrar ciclo', peligro: true,
        });
        if (ok && await ejecutar(async () => { await ctx.s.ciclos.cambiarEstado(c.id, 'cerrado'); return `Ciclo ${c.nombre} cerrado.`; })) await ctx.recargar();
      }, 'secundario', `Cerrar ciclo ${c.nombre}`));
    }
    acciones.appendChild(botonAccion('Eliminar', async () => {
      const ok = await confirmar({
        titulo: `¿Eliminar el ciclo ${c.nombre}?`,
        mensaje: 'Sólo se puede eliminar un ciclo sin turnos ni grados. Esta acción no se puede deshacer.',
        textoConfirmar: 'Eliminar', peligro: true,
      });
      if (ok && await ejecutar(async () => { await ctx.s.ciclos.eliminar(c.id); return `Ciclo ${c.nombre} eliminado.`; })) await ctx.recargar();
    }, 'peligro', `Eliminar ciclo ${c.nombre}`));

    return h('li', { class: 'tarjeta' },
      h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, `Ciclo ${c.nombre}`), insigniaCiclo(c.estado)),
      h('p', { class: 'tarjeta__meta' }, `${formatoFecha(c.fechaInicio)} – ${formatoFecha(c.fechaFin)}`),
      acciones,
    );
  };

  return {
    titulo: escuela.nombre,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre }]),
      encabezado(escuela.nombre, NIVEL_ETIQUETA[escuela.nivel]),
      seccion('datos', 'Datos generales',
        h('dl', { class: 'datos' },
          h('dt', {}, 'Clave (CCT)'), h('dd', {}, escuela.cct ?? 'Sin registrar'),
          h('dt', {}, 'Localidad'), h('dd', {}, escuela.localidad ?? 'Sin registrar'),
        ),
        h('div', { class: 'acciones acciones--izq' },
          h('a', { class: 'boton boton--secundario boton--chico', href: `#/escuela/${escuela.id}/editar` }, 'Editar datos'),
          botonAccion('Eliminar escuela', async () => {
            const ok = await confirmar({
              titulo: `¿Eliminar «${escuela.nombre}»?`,
              mensaje: 'Sólo se puede eliminar una escuela sin ciclos escolares. Esta acción no se puede deshacer.',
              textoConfirmar: 'Eliminar', peligro: true,
            });
            if (ok && await ejecutar(async () => { await ctx.s.escuelas.eliminar(escuela.id); return 'Escuela eliminada.'; })) ctx.ir('#/');
          }, 'peligro'),
        ),
      ),
      seccion('ciclos', 'Ciclos escolares',
        ciclos.length ? h('ul', { class: 'tarjetas' }, ...ciclos.map(tarjetaCiclo)) : vacio('Agrega el primer ciclo escolar para configurar turnos, periodos, grados y grupos.'),
        panelForm,
      ),
      ciclos.length ? null : h('p', { class: 'ayuda' }, icono('ℹ'), ' Cada ciclo escolar tiene su propia configuración; los datos de un ciclo no se mezclan con los de otro.'),
    ),
  };
}
