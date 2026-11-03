/**
 * #/migracion — llevar una escuela de este dispositivo al servidor escolar (Fase 8E).
 * Nueve pasos, cada uno explícito; nada avanza solo. Sólo el administrador de la escuela del
 * servidor (lo verifica el servidor). Los datos locales se conservan hasta el paso 9.
 */
import type { ContextoPagina, Vista } from '../app';
import { avisar } from '../components/avisos';
import { confirmar, pedirTexto } from '../components/dialogo';
import { h, icono, reemplazar } from '../components/dom';
import { ejecutar } from '../components/formulario';
import { encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { esErrorDominio } from '../domain/errores';
import type { Escuela } from '../models';
import { ETIQUETA_TABLA } from '../services/respaldos';
import type { PreparacionMigracion } from '../services/migracion';
import { LONGITUD_MINIMA_CONTRASENA } from '../utils/cifrado';
import { descargar } from '../utils/descarga';
import type { InformeEnsayo } from '../validators/migracion';
import { TABLAS_RESPALDO } from '../validators/respaldo';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function paso(n: number, titulo: string, ...hijos: (Node | null)[]): HTMLElement {
  return h('section', { class: 'seccion paso-migracion', id: `paso-${n}`, 'aria-labelledby': `paso-${n}-titulo` },
    h('h2', { id: `paso-${n}-titulo` }, `Paso ${n}. ${titulo}`), ...hijos);
}

function informe(r: InformeEnsayo, coincide: boolean): HTMLElement {
  return h('div', { class: 'informe-migracion' },
    r.valido && coincide
      ? h('p', {}, insignia('Sin errores: conteos y huella del servidor iguales a los de este dispositivo', 'ok', '✓'))
      : h('div', { class: 'mensaje mensaje--error', role: 'alert' }, h('p', {}, icono('⚠'), ' No se puede migrar todavía:'), h('ul', {}, ...(r.errores.length ? r.errores : ['Los conteos o la huella no coinciden.']).map((x) => h('li', {}, x)))),
    r.advertencias.length ? h('ul', { class: 'ayuda' }, ...r.advertencias.map((x) => h('li', {}, icono('!'), ' ', x))) : null,
    r.posiblesDuplicados.length ? h('details', { class: 'desplegable' }, h('summary', {}, 'Posibles duplicados por nombre (no se fusionan)'),
      h('ul', {}, ...r.posiblesDuplicados.map((d) => h('li', {}, `${d.tabla === 'alumnos' ? 'Alumno' : 'Personal'}: «${d.nombre}» aparece ${d.registros} veces`)))) : null,
    h('details', { class: 'desplegable' }, h('summary', {}, 'Registros por tabla'),
      h('ul', {}, ...TABLAS_RESPALDO.filter((t) => (r.conteos[t] ?? 0) > 0).map((t) => h('li', {}, `${ETIQUETA_TABLA[t] ?? t}: ${r.conteos[t]}`)))),
  );
}

export async function paginaMigracion(ctx: ContextoPagina): Promise<Vista> {
  const pagina = (...hijos: (Node | null)[]): Vista => ({
    titulo: 'Migrar al servidor',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Cuenta', href: '#/cuenta' }, { texto: 'Migrar al servidor' }]),
      encabezado('Migrar una escuela al servidor', 'Lleva los datos de este dispositivo a la escuela del servidor, con respaldo, ensayo, autorización y reversión.'),
      ...hijos,
    ),
  });
  const yo = await ctx.s.cuenta.yo().catch(() => null);
  if (!yo) return pagina(h('p', {}, 'Inicia sesión como administrador de la escuela para migrar.'), h('a', { class: 'boton', href: '#/cuenta' }, 'Ir a la cuenta'));
  const administradas = yo.membresias.filter((m) => m.rol === 'administrador');
  if (!administradas.length) return pagina(vacio('Sólo el administrador de la escuela en el servidor puede migrar sus datos.'));
  if (yo.segundoFactor.requerido && !(yo.segundoFactor.activo && yo.segundoFactor.verificado)) {
    return pagina(h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' Activa y verifica la verificación en dos pasos antes de migrar.'), h('a', { class: 'boton', href: '#/cuenta' }, 'Ir a la cuenta'));
  }
  const vinculadas = new Set((await ctx.s.sincronizacion.estados()).map((x) => x.escuelaId));
  const locales = (await ctx.s.escuelas.listar()).filter((e) => !vinculadas.has(e.id));

  // ---------- Historial y reversión (escuelas que administra) ----------
  const historial = h('div', { id: 'historial-migraciones' });
  for (const m of administradas) {
    const lista = await ctx.s.migracion.historial(m.escuelaId).catch(() => []);
    if (!lista.length) continue;
    historial.append(h('h3', {}, m.escuela), h('ul', { class: 'renglones' }, ...lista.map((x) => h('li', { class: 'renglon renglon--bloque' },
      h('p', {}, x.estado === 'aplicada' ? insignia('Aplicada', 'ok', '✓') : insignia('Revertida', 'neutro', '↶'), ` ${fecha(x.aplicadaEn)} · autorizó ${x.autorizadoPor} (${x.cargo})${x.quien ? ` · realizó ${x.quien}` : ''}`),
      x.estado === 'revertida' ? h('p', { class: 'ayuda' }, `Revertida el ${fecha(x.revertidaEn)}: ${x.motivoReversion ?? ''}`) : null,
      x.estado === 'aplicada' && x.cambiosPosteriores > 0 ? h('p', { class: 'ayuda' }, icono('ℹ'), ` Hubo ${x.cambiosPosteriores} cambio(s) después: ya no se revierte automáticamente.`) : null,
      x.estado === 'aplicada' && x.cambiosPosteriores === 0 ? h('button', { type: 'button', class: 'boton boton--peligro boton--chico', onclick: async () => {
        const motivo = await pedirTexto({ titulo: 'Revertir la migración', mensaje: 'Se quitará del servidor todo lo que agregó esta migración y la escuela del servidor volverá a como estaba. Para recuperar este dispositivo usa el respaldo del paso 1.', etiqueta: 'Motivo', textoConfirmar: 'Revertir', peligro: true });
        if (motivo && await ejecutar(async () => { const r = await ctx.s.migracion.revertir(m.escuelaId, x.id, motivo); return `Migración revertida: se quitaron ${r.registros} registros del servidor.`; })) await ctx.recargar();
      } }, 'Revertir esta migración') : null,
    ))));
  }

  if (!locales.length) return pagina(vacio('No hay escuelas en este dispositivo que falte migrar.'), historial.childElementCount ? seccion('historial', 'Migraciones', historial) : null);

  // ---------- Selección ----------
  const selLocal = h('select', { id: 'migracion-local' }, ...locales.map((e) => h('option', { value: e.id }, `${e.nombre} · ${e.cct ?? 'sin CCT'}`)));
  const selServidor = h('select', { id: 'migracion-servidor' }, ...administradas.map((m) => h('option', { value: m.escuelaId }, `${m.escuela} · ${m.cct ?? 'sin CCT'}`)));
  const pasos = h('div', { id: 'pasos-migracion' });
  const escuelaLocal = (): Escuela => locales.find((e) => e.id === selLocal.value)!;
  const servidor = () => administradas.find((m) => m.escuelaId === selServidor.value)!;

  const comenzar = () => {
    let prep: PreparacionMigracion | null = null;
    // Paso 1
    const clave = h('input', { type: 'password', id: 'migracion-clave', autocomplete: 'new-password', minlength: LONGITUD_MINIMA_CONTRASENA });
    const clave2 = h('input', { type: 'password', id: 'migracion-clave2', autocomplete: 'new-password' });
    const zona2 = h('div', {});
    const p1 = paso(1, 'Respaldo cifrado (obligatorio)',
      h('p', {}, 'Antes de migrar, descarga un respaldo cifrado de esta escuela. Es tu forma de volver atrás en este dispositivo.'),
      h('div', { class: 'fila' },
        h('div', { class: 'campo' }, h('label', { for: 'migracion-clave' }, 'Contraseña del respaldo'), clave),
        h('div', { class: 'campo' }, h('label', { for: 'migracion-clave2' }, 'Repite la contraseña'), clave2)),
      h('button', { type: 'button', class: 'boton', id: 'boton-respaldo-migracion', onclick: async (ev: Event) => {
        const b = ev.currentTarget as HTMLButtonElement;
        try {
          const r = await ctx.s.migracion.respaldoCifrado(escuelaLocal().id, clave.value, clave2.value);
          descargar(r.nombreArchivo, r.contenido);
          clave.value = ''; clave2.value = '';
          b.disabled = true;
          p1.append(h('p', {}, insignia(`Respaldo cifrado descargado: ${r.nombreArchivo}. Guárdalo fuera de este dispositivo.`, 'ok', '✓')));
          mostrarPaso2();
        } catch (e) { avisar(esErrorDominio(e) ? e.message : 'No se pudo generar el respaldo.', 'error'); }
      } }, 'Descargar respaldo cifrado'),
    );
    const mostrarPaso2 = () => reemplazar(zona2, paso(2, 'Validar los datos y preparar', h('p', {}, 'Se verifican los datos del dispositivo (formato, referencias, conteos) y que la escuela del servidor tenga la MISMA CCT.'),
      h('button', { type: 'button', class: 'boton', id: 'boton-preparar', onclick: async (ev: Event) => {
        const b = ev.currentTarget as HTMLButtonElement; b.disabled = true;
        try {
          prep = await ctx.s.migracion.preparar(escuelaLocal().id, servidor().escuelaId, servidor().cct);
          zona2.append(h('p', {}, insignia(`Datos válidos: ${prep.registros} registros listos (CCT ${prep.cct}).`, 'ok', '✓')), paso4());
        } catch (e) { b.disabled = false; avisar(esErrorDominio(e) ? e.message : 'No se pudo preparar.', 'error'); }
      } }, 'Validar y preparar')));
    const paso4 = () => {
      const zona = h('div', {});
      return paso(4, 'Ensayo en el servidor (no escribe nada)', h('p', {}, 'El servidor hace todo y al final lo deshace: así se ven errores, duplicados y referencias antes de migrar de verdad.'),
        h('button', { type: 'button', class: 'boton', id: 'boton-ensayo', onclick: async () => {
          try {
            const r = await ctx.s.migracion.ensayo(servidor().escuelaId, prep!.paquete);
            const ok = ctx.s.migracion.coincide(prep!.paquete, r);
            reemplazar(zona, informe(r, ok), ok ? paso6() : null);
          } catch (e) { avisar(esErrorDominio(e) ? e.message : 'No se pudo hacer el ensayo.', 'error'); }
        } }, 'Hacer el ensayo'), zona);
    };
    const paso6 = () => {
      const nombre = h('input', { id: 'migracion-autoriza', maxlength: 120, autocomplete: 'name' });
      const cargo = h('input', { id: 'migracion-cargo', maxlength: 120 });
      const aviso = h('input', { type: 'checkbox', id: 'migracion-aviso' });
      const cct = h('input', { id: 'migracion-cct', maxlength: 10, autocapitalize: 'characters' });
      const zona = h('div', {});
      return paso(6, 'Autorización', h('p', {}, 'La migración de datos personales (incluidos de menores) requiere la autorización del responsable de la escuela (decisión D2).'),
        h('div', { class: 'campo' }, h('label', { for: 'migracion-autoriza' }, 'Nombre de quien autoriza'), nombre),
        h('div', { class: 'campo' }, h('label', { for: 'migracion-cargo' }, 'Cargo'), cargo),
        h('label', { class: 'casilla', for: 'migracion-aviso' }, aviso, h('span', {}, 'El aviso de privacidad de la escuela ya está publicado e informa este tratamiento.')),
        h('div', { class: 'campo' }, h('label', { for: 'migracion-cct' }, `Para confirmar, escribe la CCT de la escuela (${prep!.cct})`), cct),
        h('button', { type: 'button', class: 'boton boton--peligro', id: 'boton-migrar', onclick: async (ev: Event) => {
          const b = ev.currentTarget as HTMLButtonElement;
          const ok = await confirmar({ titulo: 'Migrar al servidor', mensaje: `Se copiarán ${prep!.registros} registros a la escuela del servidor. En este dispositivo no se borra nada todavía.`, textoConfirmar: 'Migrar' });
          if (!ok) return;
          b.disabled = true;
          try {
            const r = await ctx.s.migracion.migrar(servidor().escuelaId, prep!.paquete, { autorizadoPor: nombre.value, cargo: cargo.value, avisoPrivacidad: aviso.checked as true, confirmacionCct: cct.value });
            const coincide = ctx.s.migracion.coincide(prep!.paquete, r);
            reemplazar(zona, paso(7, 'Migración', informe(r, coincide)), r.valido && coincide ? paso8() : null);
            if (!(r.valido && coincide)) b.disabled = false;
          } catch (e) { b.disabled = false; avisar(esErrorDominio(e) ? e.message : 'No se pudo migrar.', 'error'); }
        } }, 'Migrar'), zona);
    };
    const paso8 = () => paso(8, 'Validación', h('p', { id: 'migracion-validada' }, insignia('Validada: el servidor releyó lo guardado y la huella coincide con la de este dispositivo', 'ok', '✓')),
      paso(9, 'Usar en este dispositivo la versión sincronizada', h('p', {}, 'La escuela local se reemplaza por la del servidor (los mismos registros). A partir de aquí, los cambios se sincronizan.'),
        h('button', { type: 'button', class: 'boton', id: 'boton-usar-servidor', onclick: async () => {
          const ok = await confirmar({ titulo: 'Usar la versión sincronizada', mensaje: 'Se quitará la copia local de la escuela y se descargará la del servidor. Tienes el respaldo del paso 1.', textoConfirmar: 'Usar la versión sincronizada' });
          if (ok && await ejecutar(async () => { const r = await ctx.s.migracion.usarVersionServidor(escuelaLocal().id, servidor().escuelaId, yo.usuario.id); return `Listo: ${r.registros} registros sincronizados en este dispositivo.`; })) ctx.ir(`#/escuela/${servidor().escuelaId}`);
        } }, 'Usar la versión sincronizada')));
    reemplazar(pasos, p1, zona2);
  };

  return pagina(
    h('p', { class: 'mensaje' }, icono('ℹ'), ' Sólo con autorización del responsable de la escuela y con un respaldo cifrado. La escuela del servidor debe tener la misma CCT y estar vacía: nunca se mezclan ni se fusionan datos.'),
    seccion('eleccion', 'Escuelas',
      h('div', { class: 'campo' }, h('label', { for: 'migracion-local' }, 'Escuela de este dispositivo'), selLocal),
      h('div', { class: 'campo' }, h('label', { for: 'migracion-servidor' }, 'Escuela en el servidor (la administras)'), selServidor),
      h('button', { type: 'button', class: 'boton', id: 'boton-comenzar-migracion', onclick: comenzar }, 'Comenzar'),
    ),
    pasos,
    historial.childElementCount ? seccion('historial', 'Migraciones', historial) : null,
  );
}
