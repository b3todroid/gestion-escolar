import type { ContextoPagina, Vista } from '../app';
import { agregar, h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { avisar } from '../components/avisos';
import { confirmar } from '../components/dialogo';
import { esErrorDominio } from '../domain/errores';
import { ETIQUETA_TABLA, type AnalisisRespaldo, type InformeRestauracion } from '../services/respaldos';
import { LONGITUD_MINIMA_CONTRASENA } from '../utils/cifrado';
import { descargar } from '../utils/descarga';
import { registrarError } from '../utils/registro';

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Agrega punto final sin duplicarlo («a.m.» ya termina en punto). */
const conPunto = (t: string) => (t.endsWith('.') ? t : `${t}.`);

export async function paginaRespaldos(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const estados = await Promise.all(escuelas.map(async (e) => ({ e, st: await ctx.s.respaldos.estado(e.id, new Date()) })));

  // ---------- Descargar (protegido con contraseña por omisión) ----------
  const proteger = h('input', { type: 'checkbox', id: 'proteger-respaldo', checked: true });
  const clave = h('input', { type: 'password', id: 'contrasena-respaldo', autocomplete: 'new-password', minlength: LONGITUD_MINIMA_CONTRASENA });
  const clave2 = h('input', { type: 'password', id: 'confirmacion-respaldo', autocomplete: 'new-password' });
  const camposClave = h('div', {},
    h('div', { class: 'fila' },
      h('div', { class: 'campo' }, h('label', { for: 'contrasena-respaldo' }, 'Contraseña del respaldo'), clave),
      h('div', { class: 'campo' }, h('label', { for: 'confirmacion-respaldo' }, 'Repite la contraseña'), clave2)),
    h('p', { class: 'ayuda' }, `Al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres. No se guarda en ningún lugar: si la olvidas, el respaldo no se podrá abrir.`),
  );
  const avisoSinClave = h('p', { class: 'mensaje mensaje--aviso', hidden: true }, icono('⚠'), ' Sin contraseña, cualquiera que obtenga el archivo podrá leer los datos personales de alumnos y personal.');
  proteger.addEventListener('change', () => { camposClave.hidden = !proteger.checked; avisoSinClave.hidden = proteger.checked; });

  const exportar = async (ids: string[], boton: HTMLButtonElement) => {
    if (boton.disabled) return;
    const original = boton.textContent; boton.disabled = true; boton.textContent = proteger.checked ? 'Cifrando…' : 'Preparando…';
    try {
      const r = await ctx.s.respaldos.exportar(ids, proteger.checked ? { contrasena: clave.value, confirmacion: clave2.value } : {});
      descargar(r.nombreArchivo, r.contenido);
      await ctx.s.respaldos.registrarRespaldo(ids);
      avisar(`Respaldo ${r.cifrado ? 'cifrado ' : ''}descargado (${r.registros} registros): ${r.nombreArchivo}. Guárdalo en un lugar seguro.`, 'exito', 8000);
      clave.value = ''; clave2.value = '';
      await ctx.recargar();
    } catch (e) {
      if (!esErrorDominio(e)) registrarError(e);
      avisar(esErrorDominio(e) ? e.message : 'No se pudo generar el respaldo.', 'error');
      if (esErrorDominio(e) && e.campos.some((c) => c.campo === 'contrasena')) clave.focus(); else if (esErrorDominio(e) && e.campos.length) clave2.focus();
    } finally {
      if (boton.isConnected) { boton.disabled = false; boton.textContent = original; }
    }
  };
  const botonExportar = (ids: string[], texto: string, etiqueta?: string, clase = 'boton boton--chico') => {
    const b = h('button', { type: 'button', class: clase, 'aria-label': etiqueta });
    b.textContent = texto;
    b.addEventListener('click', () => void exportar(ids, b));
    return b;
  };

  // ---------- Restaurar ----------
  const resultado = h('div', { class: 'importacion', 'aria-live': 'polite' });
  let contenido: string | null = null;
  let nombreArchivo = '';
  let claveRestaurar: string | null = null;

  const informe = (r: InformeRestauracion) => {
    reemplazar(resultado,
      h('div', { class: 'mensaje mensaje--exito', role: 'status', id: 'informe-restauracion' },
        h('p', {}, icono('✓'), ` Restauración completa: ${r.registros} registros${r.agregadas ? `; ${r.agregadas} escuela(s) agregada(s)` : ''}${r.reemplazadas ? `; ${r.reemplazadas} escuela(s) reemplazada(s)` : ''}. Guardado en este dispositivo.`),
        h('ul', {}, ...r.porTabla.map((x) => h('li', {}, `${ETIQUETA_TABLA[x.tabla]}: ${x.registros}`)))),
      h('a', { class: 'boton', href: '#/escuelas' }, 'Ver escuelas'),
    );
  };

  const mostrar = (a: AnalisisRespaldo) => {
    resultado.replaceChildren();
    const elegibles = a.escuelas.filter((x) => x.accion !== 'bloqueado');
    const marcadas = new Set(elegibles.map((x) => x.id));
    agregar(resultado,
      h('h3', {}, `Revisión de «${nombreArchivo}»`),
      h('p', {}, conPunto(`${a.cifrado ? 'Respaldo cifrado. ' : ''}${a.creadoEn ? `Creado el ${fechaHora(a.creadoEn)}` : ''}${a.esquema ? `; versión de datos ${a.esquema}` : ''}; ${a.registros} registros`)),
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
        x.ciclos.length ? h('p', { class: 'tarjeta__meta' }, `Ciclos escolares: ${x.ciclos.join(', ')}`) : null,
        x.motivo ? h('p', { class: 'error-campo' }, x.motivo) : null,
        x.accion === 'reemplazar' && x.cambiosPosteriores ? h('p', { class: 'mensaje mensaje--aviso conflicto-posterior' }, icono('⚠'),
          ` Conflicto: en este dispositivo hay ${x.cambiosPosteriores} registro(s) creados o modificados después de la fecha del respaldo. Si reemplazas, esos cambios se perderán (se descargará antes una copia).`) : null,
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
              ? `Los datos actuales de estas escuelas se sustituirán por los del respaldo. Antes se descargará automáticamente una copia de los datos actuales${a.cifrado ? ', protegida con la misma contraseña del respaldo' : ''}, por si necesitas volver.`
              : 'Se agregarán las escuelas seleccionadas a este dispositivo.',
            detalles: a.escuelas.filter((x) => ids.includes(x.id)).map((x) => `${x.nombre}: ${x.accion === 'reemplazar' ? `reemplazar${x.cambiosPosteriores ? ` (se perderán ${x.cambiosPosteriores} cambio(s) posteriores al respaldo)` : ''}` : 'agregar'}`),
            textoConfirmar: reemplazos.length ? 'Reemplazar' : 'Restaurar', peligro: reemplazos.length > 0,
          });
          if (!ok) return;
          b.disabled = true; b.textContent = 'Restaurando…';
          try {
            if (reemplazos.length) {
              const copia = await ctx.s.respaldos.exportar(reemplazos.map((x) => x.id), a.cifrado && claveRestaurar ? { contrasena: claveRestaurar } : {});
              descargar(copia.nombreArchivo.replace('respaldo-', 'copia-antes-de-restaurar-'), copia.contenido);
            }
            const r = await ctx.s.respaldos.restaurar(contenido, ids, claveRestaurar);
            contenido = null; claveRestaurar = null;
            informe(r);
            avisar('Restauración completa. Guardado en este dispositivo.', 'exito', 8000);
          } catch (e) {
            if (!esErrorDominio(e)) registrarError(e);
            avisar(esErrorDominio(e) ? e.message : 'No se pudo restaurar. No se modificó nada.', 'error', 10000);
            b.disabled = false; b.textContent = 'Restaurar';
          }
        },
      }, 'Restaurar')) : null,
    );
  };

  const analizar = async (contrasena: string | null) => {
    if (!contenido) return;
    reemplazar(resultado, h('p', {}, contrasena ? 'Descifrando y revisando el respaldo…' : 'Revisando el respaldo…'));
    try {
      const a = await ctx.s.respaldos.analizar(contenido, contrasena);
      claveRestaurar = contrasena;
      mostrar(a);
    } catch (e) {
      if (!esErrorDominio(e)) registrarError(e);
      const msg = esErrorDominio(e) ? e.message : 'No se pudo leer el archivo.';
      if (contrasena) pedirClave(msg); else reemplazar(resultado, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', msg));
    }
  };

  const pedirClave = (error: string | null) => {
    const campo = h('input', { type: 'password', id: 'contrasena-restaurar', autocomplete: 'current-password' });
    const form = h('form', { class: 'formulario', id: 'f-contrasena-restaurar', novalidate: true },
      h('p', {}, icono('🔒'), ` «${nombreArchivo}» está protegido con contraseña.`),
      error ? h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', error) : null,
      h('div', { class: 'campo' }, h('label', { for: 'contrasena-restaurar' }, 'Contraseña del respaldo'), campo),
      h('div', { class: 'acciones acciones--izq' }, h('button', { type: 'submit', class: 'boton' }, 'Abrir respaldo')));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); if (campo.value) void analizar(campo.value); else campo.focus(); });
    reemplazar(resultado, form);
    campo.focus();
  };

  const entrada = h('input', { type: 'file', id: 'archivo-respaldo', accept: '.json,application/json', class: 'archivo' });
  entrada.addEventListener('change', async () => {
    const f = entrada.files?.[0];
    if (!f) return;
    nombreArchivo = f.name; claveRestaurar = null;
    reemplazar(resultado, h('p', {}, 'Leyendo el archivo…'));
    try {
      contenido = await f.text();
      if (ctx.s.respaldos.requiereContrasena(contenido)) pedirClave(null);
      else await analizar(null);
    } catch (e) {
      contenido = null;
      if (!esErrorDominio(e)) registrarError(e);
      reemplazar(resultado, h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', esErrorDominio(e) ? e.message : 'No se pudo leer el archivo.'));
    }
  });

  return {
    titulo: 'Respaldos',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Escuelas', href: '#/escuelas' }, { texto: 'Respaldos' }]),
      encabezado('Respaldos', 'Todo se guarda sólo en este dispositivo. Un respaldo es la única forma de recuperar los datos si se borran o si cambias de dispositivo.'),
      seccion('descargar', '1. Descargar un respaldo',
        escuelas.length ? h('fieldset', { class: 'proteccion-respaldo' },
          h('legend', {}, 'Protección del archivo'),
          h('label', { class: 'casilla' }, proteger, h('span', {}, 'Proteger con contraseña (recomendado: el archivo contiene datos personales)')),
          camposClave, avisoSinClave) : null,
        escuelas.length
          ? h('ul', { class: 'tarjetas' }, ...estados.map(({ e, st }) => h('li', { class: 'tarjeta' },
              h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, e.nombre),
                st.recordar ? insignia(st.ultimo ? 'Hay cambios sin respaldar' : 'Nunca respaldada', 'aviso', '!') : insignia('Respaldo al día', 'ok', '✓')),
              h('p', { class: 'tarjeta__meta' }, st.ultimo ? conPunto(`Último respaldo: ${fechaHora(st.ultimo)}${st.cambiosDespues ? ' (hubo cambios después)' : ''}`) : 'Todavía no se ha respaldado.'),
              h('div', { class: 'acciones acciones--izq' }, botonExportar([e.id], 'Descargar respaldo', `Descargar respaldo de ${e.nombre}`)),
            )))
          : vacio('No hay escuelas registradas en este dispositivo.'),
        escuelas.length > 1 ? botonExportar(escuelas.map((e) => e.id), 'Descargar respaldo de todas las escuelas', undefined, 'boton boton--secundario') : null,
        h('p', { class: 'ayuda' }, icono('ℹ'), ' El archivo (.json) se guarda en tu carpeta de descargas. Incluye versión de datos, fecha, escuelas, ciclos, conteo de registros y una huella de verificación. Guárdalo fuera de este dispositivo (memoria USB o nube personal) y no lo compartas.'),
      ),
      seccion('restaurar', '2. Restaurar un respaldo',
        h('p', {}, 'Primero se revisa el archivo (formato, versión, integridad y conflictos) y se muestra qué cambiaría; no se modifica nada hasta que confirmes. Si se reemplazan datos, antes se descarga una copia de los actuales. La restauración es todo o nada.'),
        h('div', { class: 'campo' }, h('label', { for: 'archivo-respaldo' }, 'Archivo de respaldo (.json)'), entrada),
        resultado,
      ),
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Más información sobre el almacenamiento y la instalación: ', h('a', { href: '#/aplicacion' }, 'Aplicación y datos'), '.'),
    ),
  };
}
