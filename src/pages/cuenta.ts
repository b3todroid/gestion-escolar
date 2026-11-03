/**
 * #/cuenta — cuenta en el servidor escolar (Fase 8B, en prueba).
 * #/cuenta/escuela/ID — accesos de una escuela (administrador).
 * Iniciar sesión NO envía ni sincroniza datos escolares: siguen sólo en este dispositivo.
 * Los permisos los decide el servidor; esta pantalla sólo muestra lo que el servidor permite.
 */
import type { ContextoPagina, Vista } from '../app';
import { notificarCambioSincronizacion } from '../sincronizador';
import { avisar } from '../components/avisos';
import { confirmar, pedirTexto } from '../components/dialogo';
import { h, icono, reemplazar } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, selector, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { esErrorDominio } from '../domain/errores';
import {
  ETIQUETA_ACCION_AUDITORIA, ETIQUETA_PERMISO, ETIQUETA_PROVEEDOR, ETIQUETA_ROL_SERVIDOR, PERMISOS_DELEGABLES, ROLES_SERVIDOR,
  type ConfiguracionServidor, type FichaServidor, type Miembro, type Yo,
} from '../services/cuenta';

const AVISO_FASE = 'Función en prueba: iniciar sesión todavía NO envía ni sincroniza tus datos escolares. Todo sigue guardado sólo en este dispositivo.';

const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const ERRORES_INSTITUCIONAL: Record<string, string> = {
  account_not_linked: 'Tu cuenta institucional no coincide con una invitación vigente.',
  signup_disabled: 'Esa cuenta institucional no tiene invitación. Pide una al administrador de tu escuela.',
  email_doesn_t_match: 'El correo de la cuenta institucional no coincide con el de tu invitación.',
};

function avisoFase(): HTMLElement {
  return h('p', { class: 'mensaje', id: 'aviso-fase' }, icono('ℹ'), ' ', AVISO_FASE);
}

/** Lee y limpia el error que devuelve el proveedor institucional en la dirección. */
function errorDeRegreso(): string | null {
  const codigo = new URLSearchParams(window.location.search).get('error');
  if (!codigo) return null;
  history.replaceState(null, '', window.location.pathname + window.location.hash);
  return ERRORES_INSTITUCIONAL[codigo] ?? 'No se pudo entrar con la cuenta institucional. Verifica que tengas una invitación vigente o entra con un código al correo.';
}

export async function paginaCuenta(ctx: ContextoPagina): Promise<Vista> {
  const errorInstitucional = errorDeRegreso();
  const cfg = await ctx.s.cuenta.configuracion();
  const base = (contenido: (Node | null)[]): Vista => ({
    titulo: 'Cuenta del servidor escolar',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Aplicación y datos', href: '#/aplicacion' }, { texto: 'Cuenta' }]),
      encabezado('Cuenta del servidor escolar', 'Acceso con invitación para trabajar con varias personas (en preparación).'),
      avisoFase(),
      errorInstitucional ? h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', errorInstitucional) : null,
      ...contenido,
    ),
  });

  if (!cfg.disponible) {
    return base([seccion('sin-servidor', 'Servidor no disponible',
      h('p', { id: 'estado-servidor' }, insignia('Modo local: sin servidor escolar', 'neutro', '○')),
      h('p', {}, cfg.motivo ?? 'No hay servidor escolar en esta dirección.'),
      h('p', { class: 'ayuda' }, 'La aplicación funciona completa en este dispositivo sin cuenta. La cuenta sólo será necesaria cuando tu escuela se una al servidor escolar.'),
    )]);
  }

  let yo: Yo | null;
  try {
    yo = await ctx.s.cuenta.yo();
  } catch (e) {
    if (!esErrorDominio(e)) throw e;
    return base([seccion('error-servidor', 'No se pudo consultar la cuenta', h('p', { class: 'mensaje mensaje--error', role: 'alert' }, e.message))]);
  }

  if (!yo) return base([formularioEntrada(ctx, cfg)]);
  if (yo.segundoFactor.activo && !yo.segundoFactor.verificado) return base([formularioSegundoFactorPendiente(ctx, yo)]);
  return base(await panelCuenta(ctx, yo));
}

// ---------- Sin sesión: código al correo o cuenta institucional ----------

function formularioEntrada(ctx: ContextoPagina, cfg: ConfiguracionServidor): HTMLElement {
  const zona = h('div', { id: 'zona-entrada' });
  const pasoCorreo = () => {
    const f = alEnviar(formulario('f-entrar', null,
      campo('f-entrar', { nombre: 'correo', etiqueta: 'Correo con el que te invitaron', tipo: 'email', modoEntrada: 'email', autocompletar: 'email', requerido: true, maxlength: 120,
        ayuda: 'Puede ser institucional o personal. Te enviaremos un código de 6 dígitos; no hay contraseñas.' }),
      botonEnviar('Enviar código'),
    ), async () => {
      const correo = await ctx.s.cuenta.enviarCodigo({ correo: texto(f, 'correo') });
      pasoCodigo(correo);
      avisar('Si el correo tiene una invitación vigente, recibirás un código. Caduca en 5 minutos.', 'info', 8000);
      return null;
    }, 'Enviando…');
    reemplazar(zona, f);
  };
  const pasoCodigo = (correo: string) => {
    const f = alEnviar(formulario('f-codigo', null,
      h('p', {}, 'Escribe el código que llegó a ', h('strong', {}, correo), '.'),
      campo('f-codigo', { nombre: 'codigo', etiqueta: 'Código de 6 dígitos', modoEntrada: 'numeric', autocompletar: 'one-time-code', requerido: true, maxlength: 6 }),
      cfg.buzonDesarrollo
        ? h('p', { class: 'ayuda', id: 'ayuda-buzon' }, icono('ℹ'), ' Modo desarrollo: el código no sale por correo. Consúltalo en ', h('a', { href: `/api/desarrollo/buzon?correo=${encodeURIComponent(correo)}`, target: '_blank', rel: 'noopener' }, 'el buzón de desarrollo'), '.')
        : null,
      h('div', { class: 'acciones' },
        botonEnviar('Entrar'),
        h('button', { type: 'button', class: 'boton boton--secundario', onclick: pasoCorreo }, 'Usar otro correo'),
      ),
    ), async () => {
      await ctx.s.cuenta.entrarConCodigo(correo, { codigo: texto(f, 'codigo') });
      avisar('Sesión iniciada.', 'exito');
      await ctx.recargar('h1');
      return null;
    }, 'Entrando…');
    reemplazar(zona, f);
    f.querySelector<HTMLInputElement>('input[name="codigo"]')?.focus();
  };
  pasoCorreo();

  return h('div', {},
    seccion('entrar', 'Entrar con un código al correo', zona),
    cfg.proveedores.length ? seccion('entrar-institucional', 'Entrar con cuenta institucional',
      h('p', { class: 'ayuda' }, 'Sólo si tu escuela usa Google Workspace o Microsoft 365 y te invitaron con ese correo.'),
      h('div', { class: 'acciones' }, ...cfg.proveedores.map((p) => h('button', {
        type: 'button', class: 'boton boton--secundario', 'data-proveedor': p,
        onclick: async () => {
          try {
            window.location.assign(await ctx.s.cuenta.urlCuentaInstitucional(p, window.location.origin));
          } catch (e) { avisar(esErrorDominio(e) ? e.message : 'No se pudo abrir el proveedor institucional.', 'error'); }
        },
      }, `Entrar con ${ETIQUETA_PROVEEDOR[p]}`))),
    ) : null,
    h('p', { class: 'ayuda' }, '¿No tienes invitación? Pídela al administrador de tu escuela. No hay registro abierto.'),
  );
}

// ---------- Sesión con segundo factor pendiente ----------

function formularioSegundoFactorPendiente(ctx: ContextoPagina, yo: Yo): HTMLElement {
  const fApp = alEnviar(formulario('f-segundo-factor', null,
    campo('f-segundo-factor', { nombre: 'codigo', etiqueta: 'Código de tu aplicación de autenticación', modoEntrada: 'numeric', autocompletar: 'one-time-code', requerido: true, maxlength: 7 }),
    botonEnviar('Verificar'),
  ), async () => {
    await ctx.s.cuenta.verificarSegundoFactor({ codigo: texto(fApp, 'codigo') });
    avisar('Verificación correcta.', 'exito');
    await ctx.recargar('h1');
    return null;
  }, 'Verificando…');
  const fRespaldo = alEnviar(formulario('f-respaldo', null,
    campo('f-respaldo', { nombre: 'codigo', etiqueta: 'Código de respaldo', requerido: true, maxlength: 40, ayuda: 'Cada código de respaldo sirve una sola vez.' }),
    botonEnviar('Usar código de respaldo'),
  ), async () => {
    await ctx.s.cuenta.verificarCodigoRespaldo({ codigo: texto(fRespaldo, 'codigo') });
    avisar('Verificación correcta. Ese código de respaldo ya no sirve.', 'exito');
    await ctx.recargar('h1');
    return null;
  }, 'Verificando…');
  return seccion('segundo-factor-pendiente', 'Verificación en dos pasos',
    h('p', {}, `Hola, ${yo.usuario.nombre}. Para continuar, escribe el código de 6 dígitos de tu aplicación de autenticación.`),
    fApp,
    desplegable('¿Perdiste tu teléfono? Usa un código de respaldo', false, fRespaldo,
      h('p', { class: 'ayuda' }, 'Si tampoco tienes códigos de respaldo, pide al administrador de tu escuela que restablezca tu verificación.')),
    botonSalir(ctx),
  );
}

function botonSalir(ctx: ContextoPagina): HTMLButtonElement {
  return h('button', { type: 'button', class: 'boton boton--secundario', id: 'boton-salir', onclick: async () => {
    if (!(await ejecutar(async () => { await ctx.s.cuenta.salir(); return 'Sesión cerrada en este dispositivo.'; }))) return;
    // Dispositivo compartido: los datos descargados de escuelas sincronizadas siguen aquí. Se pregunta
    // explícitamente; nunca se borran en silencio ni se borran si hay cambios sin enviar.
    const estados = await ctx.s.sincronizacion.estados();
    if (estados.length) {
      const sinEnviar = estados.reduce((n, e) => n + e.pendientes + e.conflictos + e.rechazados, 0);
      if (sinEnviar) {
        await confirmar({ titulo: 'Datos sincronizados en este dispositivo', mensaje: `Hay ${sinEnviar} cambio(s) sin enviar: los datos se conservan en este dispositivo. Vuelve a iniciar sesión y sincroniza antes de quitarlos (por ejemplo, si el dispositivo es compartido).`, textoConfirmar: 'Entendido', soloInformar: true });
      } else if (await confirmar({ titulo: '¿Este dispositivo es compartido?', mensaje: `Los datos de ${estados.length} escuela(s) sincronizada(s) siguen guardados aquí y cualquiera con acceso al dispositivo podría verlos. Si no es tu dispositivo personal, quítalos (en el servidor no se borra nada).`, textoConfirmar: 'Quitar los datos de este dispositivo', textoCancelar: 'Conservarlos (dispositivo personal)', peligro: true })) {
        for (const e of estados) await ctx.s.sincronizacion.quitar(e.escuelaId);
        notificarCambioSincronizacion();
        avisar('Se quitaron de este dispositivo los datos de las escuelas sincronizadas.', 'exito');
      }
    }
    await ctx.recargar('h1');
  } }, 'Cerrar sesión');
}

// ---------- Sesión activa ----------

async function panelCuenta(ctx: ContextoPagina, yo: Yo): Promise<(Node | null)[]> {
  const sf = yo.segundoFactor;
  const zonaActivar = h('div', { id: 'zona-activar' });
  const iniciarActivacion = async () => {
    try {
      const a = await ctx.s.cuenta.iniciarSegundoFactor();
      const fConfirmar = alEnviar(formulario('f-activar', null,
        campo('f-activar', { nombre: 'codigo', etiqueta: 'Código de 6 dígitos que muestra la aplicación', modoEntrada: 'numeric', autocompletar: 'one-time-code', requerido: true, maxlength: 7 }),
        botonEnviar('Confirmar y activar'),
      ), async () => {
        await ctx.s.cuenta.confirmarSegundoFactor({ codigo: texto(fConfirmar, 'codigo') });
        avisar('Verificación en dos pasos activada.', 'exito');
        await ctx.recargar('h1');
        return null;
      }, 'Activando…');
      reemplazar(zonaActivar,
        h('ol', { class: 'instrucciones' },
          h('li', {}, 'Instala una aplicación de autenticación (por ejemplo, la de tu sistema o cualquier app compatible con códigos TOTP).'),
          h('li', {}, 'Agrega una cuenta con esta clave: ', h('code', { id: 'clave-totp' }, a.secreto.replace(/(.{4})/g, '$1 ').trim()),
            a.uri.startsWith('otpauth://') ? h('span', {}, ' o ', h('a', { href: a.uri }, 'ábrela directamente en la aplicación')) : null, '.'),
          h('li', {}, 'Guarda estos códigos de respaldo en un lugar seguro (sólo se muestran ahora; cada uno sirve una vez):',
            h('ul', { class: 'codigos-respaldo', id: 'codigos-respaldo' }, ...a.codigosRespaldo.map((c) => h('li', {}, h('code', {}, c))))),
          h('li', {}, 'Escribe el código que muestra la aplicación para confirmar.'),
        ),
        fConfirmar,
      );
      fConfirmar.querySelector<HTMLInputElement>('input')?.focus();
    } catch (e) {
      avisar(esErrorDominio(e) ? e.message : 'No se pudo iniciar la activación.', 'error');
    }
  };

  const sesiones = await ctx.s.cuenta.sesiones().catch(() => null);
  const vinculadas = new Set((await ctx.s.sincronizacion.estados()).map((e) => e.escuelaId));
  const yaVistas = new Set<string>(); // una persona con varios roles en la escuela: un solo botón
  const administradas = yo.membresias.filter((m) => m.rol === 'administrador');

  return [
    sf.requerido && !sf.activo
      ? h('p', { class: 'mensaje mensaje--error', role: 'alert', id: 'aviso-segundo-factor' }, icono('⚠'), ' Tu rol exige la verificación en dos pasos. Actívala para poder administrar accesos.')
      : null,
    seccion('mi-cuenta', 'Mi cuenta',
      h('dl', { class: 'datos', id: 'datos-cuenta' },
        h('dt', {}, 'Nombre'), h('dd', {}, yo.usuario.nombre),
        h('dt', {}, 'Correo'), h('dd', {}, yo.usuario.correo),
      ),
      botonSalir(ctx),
    ),
    seccion('mis-accesos', 'Mis accesos',
      yo.membresias.length
        ? h('ul', { class: 'renglones', id: 'lista-accesos' }, ...yo.membresias.map((m) => h('li', { class: 'renglon' },
            h('span', { class: 'renglon__texto' }, m.escuela, h('span', { class: 'renglon__sub' }, ` ${m.cct ?? ''} · ${m.etiquetaRol}`)),
            m.rol === 'administrador' ? h('a', { class: 'boton boton--chico boton--secundario', href: `#/cuenta/escuela/${m.escuelaId}` }, 'Administrar accesos') : null,
            vinculadas.has(m.escuelaId)
              ? h('a', { class: 'boton boton--chico', href: `#/escuela/${m.escuelaId}` }, 'Abrir en este dispositivo')
              : yaVistas.has(m.escuelaId) ? null : (yaVistas.add(m.escuelaId), h('button', { type: 'button', class: 'boton boton--chico', 'data-unirse': m.escuelaId, onclick: async (ev: Event) => {
                  const b = ev.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = 'Descargando…';
                  if (await ejecutar(async () => { const r = await ctx.s.sincronizacion.unirse(m.escuelaId, yo.usuario.id); notificarCambioSincronizacion(); return `Escuela lista en este dispositivo (${r.registros} registros). Puedes trabajar sin conexión.`; })) ctx.ir(`#/escuela/${m.escuelaId}`);
                  else { b.disabled = false; b.textContent = 'Usar en este dispositivo'; }
                } }, 'Usar en este dispositivo')),
          )))
        : vacio('No tienes accesos vigentes.'),
      h('p', { class: 'ayuda' }, '«Usar en este dispositivo» descarga lo que tu rol te permite ver para trabajar también sin conexión; los cambios se envían al servidor al sincronizar. Las escuelas que ya tenías guardadas sólo en este dispositivo no se mezclan (unirlas con el servidor es la migración, fase posterior).'),
      vinculadas.size ? h('a', { class: 'boton boton--secundario', href: '#/sincronizacion' }, 'Ver sincronización') : null,
      administradas.length ? h('a', { class: 'boton boton--secundario', href: '#/migracion' }, 'Migrar una escuela de este dispositivo') : null,
    ),
    seccion('verificacion', 'Verificación en dos pasos',
      h('p', { id: 'estado-segundo-factor' }, sf.activo ? insignia('Activa', 'ok', '✓') : sf.requerido ? insignia('Obligatoria para tu rol y aún no activa', 'aviso', '!') : insignia('No activa (opcional para tu rol)', 'neutro', '○')),
      sf.activo ? null : h('button', { type: 'button', class: 'boton', id: 'boton-activar-segundo-factor', onclick: iniciarActivacion }, 'Activar verificación en dos pasos'),
      zonaActivar,
    ),
    seccion('sesiones', 'Sesiones abiertas',
      sesiones
        ? h('ul', { class: 'renglones', id: 'lista-sesiones' }, ...sesiones.map((s) => h('li', { class: 'renglon' },
            h('span', { class: 'renglon__texto' }, s.dispositivo, s.actual ? h('span', { class: 'renglon__sub' }, ' · este dispositivo') : null,
              h('span', { class: 'renglon__sub' }, ` · desde ${fechaHora(s.creada)} · vence ${fechaHora(s.expira)}`)),
            s.actual ? null : botonAccion('Cerrar', async () => {
              if (await ejecutar(async () => { await ctx.s.cuenta.cerrarSesion(s.id); return 'Sesión cerrada en ese dispositivo.'; })) await ctx.recargar();
            }, 'secundario', `Cerrar la sesión de ${s.dispositivo}`),
          )))
        : vacio('No se pudieron consultar las sesiones.'),
      h('button', { type: 'button', class: 'boton boton--peligro', id: 'boton-salir-todos', onclick: async () => {
        const ok = await confirmar({ titulo: 'Cerrar sesión en todos los dispositivos', mensaje: 'Se cerrarán todas tus sesiones, incluida ésta. Tus datos locales no se borran.', textoConfirmar: 'Cerrar todas', peligro: true });
        if (ok && await ejecutar(async () => { await ctx.s.cuenta.salirDeTodos(); return 'Se cerraron todas tus sesiones.'; })) await ctx.recargar('h1');
      } }, 'Cerrar sesión en todos los dispositivos'),
    ),
    administradas.length === 0 ? null : h('p', { class: 'ayuda' }, `Administras ${administradas.length} escuela(s) en el servidor.`),
  ];
}

// ---------- Accesos de una escuela (administrador) ----------

function estadoMiembro(m: Miembro): HTMLElement {
  if (m.estado === 'activa') return insignia('Activo', 'ok', '✓');
  if (m.estado === 'revocada') return insignia(`Revocado${m.revocadaEn ? ` el ${fechaHora(m.revocadaEn)}` : ''}`, 'neutro', '✕');
  if (m.caducada) return insignia('Invitación caducada', 'aviso', '⌛');
  return insignia(`Invitación pendiente (vence ${fechaHora(m.expiraEn)})`, 'aviso', '◐');
}

export async function paginaAccesosEscuela(ctx: ContextoPagina, escuelaId: string): Promise<Vista> {
  const yo = await ctx.s.cuenta.yo();
  const m = yo?.membresias.find((x) => x.escuelaId === escuelaId);
  const pagina = (...hijos: Node[]): Vista => ({
    titulo: 'Accesos de la escuela',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Cuenta', href: '#/cuenta' }, { texto: m?.escuela ?? 'Accesos' }]),
      encabezado('Accesos de la escuela', m ? `${m.escuela}${m.cct ? ` · ${m.cct}` : ''}` : null),
      avisoFase(),
      ...hijos,
    ),
  });
  let miembros: Miembro[];
  let auditoria;
  let fichas: FichaServidor[];
  try {
    [miembros, auditoria, fichas] = await Promise.all([ctx.s.cuenta.miembros(escuelaId), ctx.s.cuenta.auditoria(escuelaId), ctx.s.cuenta.fichasServidor(escuelaId)]);
  } catch (e) {
    if (!esErrorDominio(e)) throw e;
    return pagina(h('p', { class: 'mensaje mensaje--error', role: 'alert' }, icono('⚠'), ' ', e.message), h('a', { class: 'boton', href: '#/cuenta' }, 'Volver a la cuenta'));
  }

  const f = formulario('f-invitar', 'Invitar a una persona',
    campo('f-invitar', { nombre: 'nombre', etiqueta: 'Nombre completo', requerido: true, maxlength: 120 }),
    campo('f-invitar', { nombre: 'correo', etiqueta: 'Correo', tipo: 'email', modoEntrada: 'email', requerido: true, maxlength: 120 }),
    selector('f-invitar', { nombre: 'rol', etiqueta: 'Rol', requerido: true, opciones: ROLES_SERVIDOR.map((r) => ({ valor: r, texto: ETIQUETA_ROL_SERVIDOR[r] })) }),
    selector('f-invitar', { nombre: 'tipoCorreo', etiqueta: 'Tipo de correo', requerido: true, valor: 'institucional', opciones: [{ valor: 'institucional', texto: 'Institucional' }, { valor: 'personal', texto: 'Personal (requiere consentimiento)' }] }),
    h('div', { class: 'campo', 'data-campo': 'consentimiento' },
      h('label', { class: 'casilla' },
        h('input', { type: 'checkbox', name: 'consentimiento', value: 'si', id: 'f-invitar-consentimiento', 'aria-describedby': 'f-invitar-consentimiento-error' }),
        h('span', {}, 'La persona aceptó usar su correo personal sólo para recibir códigos de acceso e invitaciones (conforme al aviso de privacidad de la escuela).')),
      h('p', { class: 'error-campo', id: 'f-invitar-consentimiento-error', hidden: true }),
    ),
    h('p', { class: 'ayuda' }, 'Dirección y Subdirección deberán activar la verificación en dos pasos. La invitación vence en 7 días.'),
    botonEnviar('Enviar invitación'),
  );
  alEnviar(f, async () => {
    await ctx.s.cuenta.invitar(escuelaId, {
      nombre: texto(f, 'nombre'), correo: texto(f, 'correo'), rol: texto(f, 'rol'), tipoCorreo: texto(f, 'tipoCorreo'),
      consentimiento: new FormData(f).get('consentimiento') === 'si',
    });
    avisar('Invitación enviada.', 'exito');
    await ctx.recargar('#f-invitar-nombre');
    return null;
  }, 'Enviando…');

  const nombreFicha = (f: FichaServidor) => [f.nombre, f.primerApellido, f.segundoApellido].filter(Boolean).join(' ');
  /** Ficha de personal y delegaciones (D5) de una membresía activa o pendiente. */
  const permisos = (x: Miembro) => {
    if (x.estado === 'revocada') return null;
    const ficha = fichas.find((f) => f.id === x.personalId);
    const idSel = `ficha-${x.id}`;
    const elegir = h('select', { id: idSel, name: 'personalId' },
      h('option', { value: '' }, 'Sin vincular'),
      ...fichas.map((f) => h('option', { value: f.id, selected: f.id === x.personalId }, nombreFicha(f))));
    const delegables = ['direccion', 'subdireccion'].includes(x.rol);
    return desplegable(`Ficha y permisos de ${x.nombre}`, false,
      fichas.length
        ? h('div', { class: 'campo' },
            h('label', { for: idSel }, 'Ficha de personal (define los grupos de un docente)'),
            elegir,
            h('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: async () => {
              if (await ejecutar(async () => { await ctx.s.cuenta.vincularPersonal(escuelaId, x.id, elegir.value || null); return elegir.value ? 'Ficha vinculada.' : 'Ficha desvinculada.'; })) await ctx.recargar();
            } }, 'Guardar ficha'))
        : h('p', { class: 'ayuda' }, icono('ℹ'), ' El servidor aún no tiene fichas de personal de esta escuela; llegarán con la migración de datos (fase posterior, con autorización).'),
      ficha ? h('p', {}, insignia(`Vinculada con ${nombreFicha(ficha)}`, 'ok', '✓')) : x.rol === 'docente' ? h('p', {}, insignia('Sin ficha: no verá grupos ni podrá pasar lista', 'aviso', '!')) : null,
      delegables ? h('fieldset', { class: 'campo casillas' },
        h('legend', {}, 'Permisos delegados por el administrador'),
        ...PERMISOS_DELEGABLES.map((perm) => h('label', { class: 'casilla' },
          h('input', { type: 'checkbox', name: `delegar-${x.id}`, value: perm, checked: x.permisosDelegados.includes(perm) }), h('span', {}, ETIQUETA_PERMISO[perm]))),
        h('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: async (ev: Event) => {
          const caja = (ev.currentTarget as HTMLElement).closest('fieldset')!;
          const elegidos = [...caja.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value as (typeof PERMISOS_DELEGABLES)[number]);
          if (await ejecutar(async () => { await ctx.s.cuenta.delegar(escuelaId, x.id, elegidos); return elegidos.length ? 'Permisos delegados guardados.' : 'Se retiraron los permisos delegados.'; })) await ctx.recargar();
        } }, 'Guardar permisos'),
      ) : null,
    );
  };

  const acciones = (x: Miembro) => {
    if (x.estado === 'revocada' || x.esUsted) return null;
    return h('div', { class: 'renglon__acciones' },
      x.estado === 'invitada' ? botonAccion('Reenviar invitación', async () => {
        if (await ejecutar(async () => { await ctx.s.cuenta.invitar(escuelaId, { nombre: x.nombre, correo: x.correo, rol: x.rol, tipoCorreo: x.tipoCorreo, consentimiento: x.tipoCorreo === 'personal' }); return 'Invitación renovada.'; })) await ctx.recargar();
      }, 'secundario', `Reenviar invitación a ${x.nombre}`) : null,
      x.estado === 'activa' && x.segundoFactorActivo ? botonAccion('Restablecer verificación', async () => {
        const motivo = await pedirTexto({ titulo: `Restablecer la verificación de ${x.nombre}`, mensaje: 'Úsalo sólo si perdió su teléfono y sus códigos de respaldo, tras confirmar su identidad en persona. Se cerrarán sus sesiones.', etiqueta: 'Motivo', textoConfirmar: 'Restablecer', peligro: true });
        if (motivo && await ejecutar(async () => { await ctx.s.cuenta.restablecerSegundoFactor(escuelaId, x.id, { motivo }); return 'Verificación restablecida. La persona deberá configurarla de nuevo.'; })) await ctx.recargar();
      }, 'secundario', `Restablecer la verificación de ${x.nombre}`) : null,
      botonAccion('Revocar acceso', async () => {
        const motivo = await pedirTexto({ titulo: `Revocar el acceso de ${x.nombre} (${x.etiquetaRol})`, mensaje: 'Pierde el acceso a esta escuela de inmediato. El historial se conserva.', etiqueta: 'Motivo', textoConfirmar: 'Revocar', peligro: true });
        if (motivo && await ejecutar(async () => { const r = await ctx.s.cuenta.revocar(escuelaId, x.id, { motivo }); return r.sesionesCerradas ? `Acceso revocado; se cerraron ${r.sesionesCerradas} sesión(es).` : 'Acceso revocado.'; })) await ctx.recargar();
      }, 'peligro', `Revocar el acceso de ${x.nombre}`),
    );
  };

  return pagina(
    seccion('miembros', `Personas con acceso (${miembros.filter((x) => x.estado !== 'revocada').length})`,
      miembros.length ? h('ul', { class: 'renglones', id: 'lista-miembros' }, ...miembros.map((x) => h('li', { class: 'renglon', 'data-correo': x.correo },
        h('span', { class: 'renglon__texto' }, x.nombre, x.esUsted ? h('span', { class: 'renglon__sub' }, ' (tú)') : null,
          h('span', { class: 'renglon__sub' }, ` · ${x.correo} (${x.tipoCorreo}) · ${x.etiquetaRol}`)),
        estadoMiembro(x),
        ['administrador', 'direccion', 'subdireccion'].includes(x.rol) && x.estado === 'activa'
          ? (x.segundoFactorActivo ? insignia('Dos pasos activa', 'ok', '✓') : insignia('Dos pasos pendiente', 'aviso', '!')) : null,
        acciones(x),
        permisos(x),
      ))) : vacio('Todavía no hay personas.'),
    ),
    seccion('invitar', 'Invitar', f),
    seccion('auditoria', 'Actividad reciente',
      auditoria.length ? h('ul', { class: 'renglones', id: 'lista-auditoria' }, ...auditoria.map((a) => h('li', { class: 'renglon' },
        h('span', { class: 'renglon__texto' }, ETIQUETA_ACCION_AUDITORIA[a.accion] ?? a.accion,
          h('span', { class: 'renglon__sub' }, ` · ${fechaHora(a.ocurridoEn)}${a.quien ? ` · por ${a.quien}` : ''}`)),
      ))) : vacio('Sin actividad registrada.'),
      h('p', { class: 'ayuda' }, 'Registro del servidor (hora del servidor). No se puede modificar ni borrar.'),
    ),
  );
}
