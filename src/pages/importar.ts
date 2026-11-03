import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono } from '../components/dom';
import { encabezado, insignia, migas, seccion } from '../components/piezas';
import { avisar } from '../components/avisos';
import { leerTabla } from '../domain/importacion/tabla';
import { ErrorArchivo } from '../domain/importacion/zip';
import { esErrorDominio } from '../domain/errores';
import type { Analisis, EstadoFila } from '../services/importacion';
import { registrarError } from '../utils/registro';

const ESTADO: Record<EstadoFila, [string, 'ok' | 'aviso' | 'neutro', string]> = {
  nueva: ['Se importará', 'ok', '✓'],
  existente: ['Ya existe, se omite', 'neutro', '='],
  error: ['Error', 'aviso', '⚠'],
  conflicto: ['Conflicto', 'aviso', '✕'],
};

export async function paginaImportar(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const resultado = h('div', { class: 'importacion', 'aria-live': 'polite' });
  let tabla: string[][] | null = null;

  const mostrar = (a: Analisis, nombre: string) => {
    resultado.replaceChildren();
    const problemas = a.filas.filter((f) => f.estado === 'error' || f.estado === 'conflicto');
    agregar(resultado,
      h('h3', {}, `Revisión de «${nombre}»`),
      h('ul', { class: 'resumen-importacion' },
        h('li', {}, insignia(`${a.nuevas} clase(s) nuevas`, 'ok', '✓')),
        h('li', {}, insignia(`${a.existentes} ya existentes`, 'neutro', '=')),
        h('li', {}, insignia(`${a.errores} error(es)`, a.errores ? 'aviso' : 'neutro', '⚠')),
        h('li', {}, insignia(`${a.conflictos} conflicto(s)`, a.conflictos ? 'aviso' : 'neutro', '✕')),
      ),
      a.puedeImportar
        ? h('p', { class: 'mensaje' }, icono('✓'), ' El archivo es válido. Revisa los cambios y confirma para guardarlos.')
        : h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), problemas.length
          ? ` No se puede importar: corrige ${problemas.length} fila(s) en el archivo y vuelve a cargarlo. No se guardó nada.`
          : ' No hay clases nuevas que importar.'),
      a.ajustes.length ? h('div', {}, h('h4', {}, 'Cambios que se harán'), h('ul', {}, ...a.ajustes.map((x) => h('li', {}, x)))) : null,
      h('ol', { class: 'filas-importacion' }, ...[...problemas, ...a.filas.filter((f) => f.estado === 'nueva' || f.estado === 'existente')].map((f) => {
        const [t, v, s] = ESTADO[f.estado];
        return h('li', { class: `fila-imp fila-imp--${f.estado}` },
          h('span', { class: 'fila-imp__cabeza' }, h('span', { class: 'fila-imp__num' }, `Fila ${f.fila}`), insignia(t, v, s)),
          h('span', { class: 'fila-imp__resumen' }, f.resumen),
          f.mensajes.length ? h('ul', { class: 'fila-imp__mensajes' }, ...f.mensajes.map((m) => h('li', {}, m))) : null,
        );
      })),
      a.puedeImportar ? h('div', { class: 'acciones acciones--izq' }, h('button', {
        type: 'button', class: 'boton',
        onclick: async (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement;
          if (!tabla || b.disabled) return;
          b.disabled = true; b.textContent = 'Guardando…';
          try {
            const r = await ctx.s.importacion.aplicar(cicloId, tabla);
            avisar(`Se importaron ${r.clases} clase(s). Guardado en este dispositivo.`, 'exito');
            ctx.ir(`#/ciclo/${cicloId}`);
          } catch (e) {
            avisar(esErrorDominio(e) ? e.message : 'No se pudo importar. No se guardó nada.', 'error');
            b.disabled = false; b.textContent = `Importar ${a.nuevas} clase(s)`;
          }
        },
      }, `Importar ${a.nuevas} clase(s)`)) : null,
    );
  };

  const entrada = h('input', { type: 'file', id: 'archivo-horario', accept: '.xlsx,.csv', class: 'archivo' });
  entrada.addEventListener('change', async () => {
    const archivo = entrada.files?.[0];
    if (!archivo) return;
    resultado.replaceChildren(h('p', {}, 'Revisando el archivo…'));
    try {
      tabla = await leerTabla(archivo.name, await archivo.arrayBuffer());
      mostrar(await ctx.s.importacion.analizar(cicloId, tabla), archivo.name);
    } catch (e) {
      tabla = null;
      const mensaje = e instanceof ErrorArchivo || esErrorDominio(e) ? e.message : 'No se pudo leer el archivo.';
      if (!(e instanceof ErrorArchivo) && !esErrorDominio(e)) registrarError(e);
      resultado.replaceChildren(h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', mensaje));
    }
  });

  return {
    titulo: `Importar horarios del ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: `Ciclo ${ciclo.nombre}`, href: `#/ciclo/${ciclo.id}` }, { texto: 'Importar horarios' }]),
      encabezado('Importar horarios', 'Desde un archivo de Excel (.xlsx) o CSV, con una fila por clase.'),
      seccion('paso-plantilla', '1. Prepara el archivo',
        h('p', {}, 'Columnas: Grado, Grupo, Turno, Día, Inicio, Materia y Docente. Los grupos, materias y docentes deben estar registrados antes; la importación no los crea.'),
        h('a', { class: 'boton boton--secundario', href: './plantilla-horario.xlsx', download: 'plantilla-horario.xlsx' }, 'Descargar plantilla de Excel'),
      ),
      seccion('paso-archivo', '2. Elige el archivo',
        h('div', { class: 'campo' }, h('label', { for: 'archivo-horario' }, 'Archivo de horario'), entrada,
          h('p', { class: 'ayuda' }, 'El archivo se lee en este dispositivo; no se envía a ningún servidor.')),
      ),
      seccion('paso-revision', '3. Revisa antes de guardar',
        h('p', { class: 'ayuda' }, 'Nada se guarda hasta que confirmes, y sólo si no hay errores ni conflictos. No se reemplazan clases existentes ni se modifican horarios confirmados.'),
        resultado,
      ),
    ),
  };
}
