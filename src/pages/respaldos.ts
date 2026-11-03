import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { confirmar } from '../components/dialogo';
import { esErrorDominio } from '../domain/errores';
import { ETIQUETA_TABLA, type AnalisisRespaldo } from '../services/respaldos';
import { descargar } from '../utils/descarga';

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Agrega punto final sin duplicarlo («a.m.» ya termina en punto). */
const conPunto = (t: string) => (t.endsWith('.') ? t : `${t}.`);

export async function paginaRespaldos(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const estados = await Promise.all(escuelas.map(async (e) => ({ e, st: await ctx.s.respaldos.estado(e.id, new Date()) })));

  const exportar = async (ids: string[]) => {
    try {
      const r = await ctx.s.respaldos.exportar(ids);
      descargar(r.nombreArchivo, r.contenido);
      await ctx.s.respaldos.registrarRespaldo(ids);
      avisar(`Respaldo descargado (${r.registros} registros): ${r.nombreArchivo}. Guárdalo en un lugar seguro.`, 'exito', 8000);
      await ctx.recargar();
    } catch (e) {
      avisar(esErrorDominio(e) ? e.message : 'No se pudo generar el respaldo.', 'error');
    }
  };

  // ---------- Restaurar ----------
  const resultado = h('div', { class: 'importacion', 'aria-live': 'polite' });
  let contenido: string | null = null;

  const mostrar = (a: AnalisisRespaldo, nombre: string) => {
    resultado.replaceChildren();
    const elegibles = a.escuelas.filter((x) => x.accion !== 'bloqueado');
    const marcadas = new Set(elegibles.map((x) => x.id));
    agregar(resultado,
      h('h3', {}, `Revisión de «${nombre}»`),
      a.creadoEn ? h('p', {}, conPunto(`Respaldo creado el ${fechaHora(a.creadoEn)}`)) : null,
      a.errores.length ? h('div', { class: 'mensaje mensaje--error', role: 'alert' },
        h('p', {}, icono('⚠'), ' No se puede restaurar este archivo. No se modificó nada.'),
        h('ul', {}, ...a.errores.map((x) => h('li', {}, x)))) : null,
      a.advertencias.length ? h('ul', { class: 'ayuda' }, ...a.advertencias.map((x) => h('li', {}, x))) : null,
      ...a.escuelas.map((x) => h('section', { class: `respaldo-escuela respaldo-escuela--${x.accion}` },
        h('div', { class: 'tarjeta__cabeza' },
          a.errores.length || x.accion === 'bloqueado'
            ? h('h4', {}, x.nombre)
            : h('label', { class: 'casilla' },
                h('input', { type: 'checkbox', checked: true, onchange: (ev: Event) => { const c = (ev.target as HTMLInputElement).checked; if (c) marcadas.add(x.id); else marcadas.delete(x.id); } }),
                h('span', {}, x.nombre)),
          x.accion === 'agregar' ? insignia('Se agregará', 'ok', '+') : x.accion === 'reemplazar' ? insignia('Reemplazará los datos actuales', 'aviso', '⟳') : insignia('No se puede restaurar', 'aviso', '✕'),
        ),
        x.motivo ? h('p', { class: 'error-campo' }, x.motivo) : null,
        h('table', { class: 'conteos-respaldo' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Datos'), h('th', { scope: 'col' }, 'En este dispositivo'), h('th', { scope: 'col' }, 'En el respaldo'))),
          h('tbody', {}, ...x.conteos.map((c) => h('tr', { class: c.actual !== c.respaldo ? 'difiere' : '' },
            h('th', { scope: 'row' }, ETIQUETA_TABLA[c.tabla]), h('td', {}, String(c.actual)), h('td', {}, String(c.respaldo)))))),
      )),
      a.puedeRestaurar ? h('div', { class: 'acciones acciones--izq' }, h('button', {
        type: 'button', class: 'boton',
        onclick: async (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement;
          const ids = [...marcadas];
          if (!contenido || !ids.length || b.disabled) { if (!ids.length) avisar('Selecciona al menos una escuela.', 'info'); return; }
          const reemplazos = a.escuelas.filter((x) => ids.includes(x.id) && x.accion === 'reemplazar');
          const ok = await confirmar({
            titulo: reemplazos.length ? '¿Reemplazar los datos actuales?' : '¿Restaurar el respaldo?',
            mensaje: reemplazos.length
              ? 'Los datos actuales de estas escuelas se sustituirán por los del respaldo. Antes se descargará automáticamente una copia de los datos actuales, por si necesitas volver.'
              : 'Se agregarán las escuelas seleccionadas a este dispositivo.',
            detalles: a.escuelas.filter((x) => ids.includes(x.id)).map((x) => `${x.nombre}: ${x.accion === 'reemplazar' ? 'reemplazar' : 'agregar'}`),
            textoConfirmar: reemplazos.length ? 'Reemplazar' : 'Restaurar', peligro: reemplazos.length > 0,
          });
          if (!ok) return;
          b.disabled = true; b.textContent = 'Restaurando…';
          try {
            if (reemplazos.length) {
              const copia = await ctx.s.respaldos.exportar(reemplazos.map((x) => x.id));
              descargar(copia.nombreArchivo.replace('respaldo-', 'copia-antes-de-restaurar-'), copia.contenido);
            }
            const r = await ctx.s.respaldos.restaurar(contenido, ids);
            avisar(`Restauración completa: ${r.registros} registros${r.reemplazadas ? `; ${r.reemplazadas} escuela(s) reemplazada(s)` : ''}${r.agregadas ? `; ${r.agregadas} agregada(s)` : ''}.`, 'exito', 8000);
            ctx.ir('#/escuelas');
          } catch (e) {
            avisar(esErrorDominio(e) ? e.message : 'No se pudo restaurar. No se modificó nada.', 'error', 10000);
            b.disabled = false; b.textContent = 'Restaurar';
          }
        },
      }, 'Restaurar')) : null,
    );
  };

  const entrada = h('input', { type: 'file', id: 'archivo-respaldo', accept: '.json,application/json', class: 'archivo' });
  entrada.addEventListener('change', async () => {
    const f = entrada.files?.[0];
    if (!f) return;
    resultado.replaceChildren(h('p', {}, 'Revisando el respaldo…'));
    try {
      contenido = await f.text();
      mostrar(await ctx.s.respaldos.analizar(contenido), f.name);
    } catch (e) {
      contenido = null;
      if (!esErrorDominio(e)) console.error(e);
      resultado.replaceChildren(h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', esErrorDominio(e) ? e.message : 'No se pudo leer el archivo.'));
    }
  });

  return {
    titulo: 'Respaldos',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Escuelas', href: '#/escuelas' }, { texto: 'Respaldos' }]),
      encabezado('Respaldos', 'Todo se guarda sólo en este dispositivo. Un respaldo es la única forma de recuperar los datos si se borran o si cambias de dispositivo.'),
      seccion('descargar', '1. Descargar un respaldo',
        escuelas.length
          ? h('ul', { class: 'tarjetas' }, ...estados.map(({ e, st }) => h('li', { class: 'tarjeta' },
              h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, e.nombre),
                st.recordar ? insignia(st.ultimo ? 'Hay cambios sin respaldar' : 'Nunca respaldada', 'aviso', '!') : insignia('Respaldo al día', 'ok', '✓')),
              h('p', { class: 'tarjeta__meta' }, st.ultimo ? conPunto(`Último respaldo: ${fechaHora(st.ultimo)}${st.cambiosDespues ? ' (hubo cambios después)' : ''}`) : 'Todavía no se ha respaldado.'),
              h('div', { class: 'acciones acciones--izq' }, h('button', { type: 'button', class: 'boton boton--chico', onclick: () => exportar([e.id]), 'aria-label': `Descargar respaldo de ${e.nombre}` }, 'Descargar respaldo')),
            )))
          : vacio('No hay escuelas registradas en este dispositivo.'),
        escuelas.length > 1 ? h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => exportar(escuelas.map((e) => e.id)) }, 'Descargar respaldo de todas las escuelas') : null,
        h('p', { class: 'ayuda' }, icono('ℹ'), ' El archivo (.json) se guarda en tu carpeta de descargas. Contiene datos personales de alumnos y personal: guárdalo en un lugar seguro (por ejemplo, tu memoria USB o tu nube personal) y no lo compartas.'),
      ),
      seccion('restaurar', '2. Restaurar un respaldo',
        h('p', {}, 'Primero se revisa el archivo y se muestra qué cambiaría; no se modifica nada hasta que confirmes. Si se reemplazan datos, antes se descarga una copia de los actuales.'),
        h('div', { class: 'campo' }, h('label', { for: 'archivo-respaldo' }, 'Archivo de respaldo (.json)'), entrada),
        resultado,
      ),
    ),
  };
}
