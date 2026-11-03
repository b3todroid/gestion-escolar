import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { encabezado, insignia, migas, seccion, vacio, desplegable, botonAccion } from '../components/piezas';
import { alEnviar, botonEnviar, campo, casillas, ejecutar, formulario, marcados, selector, texto } from '../components/formulario';
import { confirmar, pedirTexto } from '../components/dialogo';
import { avisar } from '../components/avisos';
import { descargar } from '../utils/descarga';
import { fechaLocal, sumarDias, diaDeFecha } from '../utils/fechas';
import { TIPOS_INCIDENCIA_PERSONAL, type IncidenciaPersonal, type TipoIncidenciaPersonal, type EstadoCobertura } from '../models';
import {
  ETIQUETA_ESTADO_CLASE, ETIQUETA_ESTADO_COBERTURA, ETIQUETA_TIPO_INCIDENCIA, type ClaseDelDia, type EstadoClase,
} from '../services/prefectura';
import { nombreCompleto } from '../services/personal';
import { DIAS_SEMANA } from '../services/turnos';
import { cicloVigente } from './catalogos';
import { ErrorDominio } from '../domain/errores';
import type { EntradaActividadBanco } from '../validators/esquemas';

/** Turno elegido por ciclo (se conserva entre pantallas de Prefectura). */
const turnoPorCiclo = new Map<string, string>();

const VARIANTE_CLASE: Record<EstadoClase, ['ok' | 'aviso' | 'neutro', string]> = {
  sin_informacion: ['neutro', '○'], atendida: ['ok', '✓'], posible: ['aviso', '?'], confirmado: ['aviso', '⚠'], cobertura_asignada: ['ok', '◑'], cobertura_realizada: ['ok', '●'],
};
const insigniaClase = (e: EstadoClase) => insignia(ETIQUETA_ESTADO_CLASE[e], VARIANTE_CLASE[e][0], VARIANTE_CLASE[e][1]);
const insigniaIncidencia = (i: IncidenciaPersonal) => i.estado === 'confirmada' ? insignia('CONFIRMADA', 'aviso', '✓') : i.estado === 'reportada' ? insignia('REPORTADA (sin confirmar)', 'neutro', '?') : insignia('DESCARTADA', 'neutro', '✕');
const nombreDia = (f: string) => DIAS_SEMANA.find((d) => d.valor === diaDeFecha(f))?.nombre ?? '';
const fechaLarga = (f: string) => `${nombreDia(f)} ${f.split('-').reverse().join('/')}`;
const tipoTexto = (i: Pick<IncidenciaPersonal, 'tipo' | 'tipoOtro'>) => `${ETIQUETA_TIPO_INCIDENCIA[i.tipo]}${i.tipoOtro ? ` (${i.tipoOtro})` : ''}`;

function navPrefectura(cicloId: string, fecha: string, actual: 'dia' | 'actividades' | 'reportes') {
  const enlaces: [typeof actual, string, string][] = [
    ['dia', 'Panel del día', `#/ciclo/${cicloId}/prefectura/${fecha}`],
    ['actividades', 'Banco de actividades', `#/ciclo/${cicloId}/prefectura-actividades`],
    ['reportes', 'Reportes e historial', `#/ciclo/${cicloId}/prefectura-reportes`],
  ];
  return h('nav', { class: 'subnav no-imprimir', 'aria-label': 'Prefectura' },
    h('ul', {}, ...enlaces.map(([c, t, href]) => h('li', {}, h('a', { href, class: 'subnav__enlace', 'aria-current': c === actual ? 'page' : undefined }, t)))));
}

async function perfilTexto(ctx: ContextoPagina) {
  const p = await ctx.s.panel.perfil();
  return { id: p?.id ?? null, aviso: h('p', { class: 'ayuda no-imprimir' }, icono('ℹ'), p ? ` Los registros quedan a nombre de ${nombreCompleto(p)} (docente de este dispositivo). No es una cuenta ni una contraseña.` : ' Este dispositivo no tiene una persona configurada: los registros quedan sin nombre. ', p ? null : h('a', { href: '#/perfil' }, 'Configurar')) };
}

// ===================================================================== inicio

/** #/prefectura — elegir escuela y ciclo; abre el día de hoy. */
export async function paginaPrefecturaInicio(ctx: ContextoPagina): Promise<Vista> {
  const escuelas = await ctx.s.escuelas.listar();
  const hoy = fechaLocal(new Date());
  const items = [];
  for (const e of escuelas) {
    const c = await cicloVigente(ctx, e.id);
    items.push(h('li', { class: 'tarjeta' }, h('h3', {}, e.nombreCorto ?? e.nombre),
      c ? h('a', { class: 'boton', href: `#/ciclo/${c.id}/prefectura/${hoy >= c.fechaInicio && hoy <= c.fechaFin ? hoy : c.fechaInicio}` }, `Abrir Prefectura (ciclo ${c.nombre})`) : vacio('Sin ciclo escolar.')));
  }
  return {
    titulo: 'Prefectura',
    contenido: h('div', { class: 'pagina' }, migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Prefectura' }]),
      encabezado('Prefectura', 'Incidencias del personal, grupos que requieren atención, horas de servicio y coberturas.'),
      escuelas.length ? h('ul', { class: 'tarjetas' }, ...items) : vacio('Primero configura una escuela.')),
  };
}

// ============================================================ panel del día

export async function paginaPrefectura(ctx: ContextoPagina, cicloId: string, fecha: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const turnos = await ctx.s.turnos.listar(cicloId);
  let turnoId = turnoPorCiclo.get(cicloId) ?? (turnos.length === 1 ? turnos[0]!.turno.id : '');
  if (turnoId && !turnos.some((t) => t.turno.id === turnoId)) turnoId = '';
  const yo = await perfilTexto(ctx);
  const editable = ciclo.estado !== 'cerrado';

  const base = [
    migas([{ texto: 'Inicio', href: '#/' }, { texto: 'Prefectura', href: '#/prefectura' }, { texto: fechaLarga(fecha) }]),
    encabezado('Prefectura', `${escuela.nombre}${escuela.cct ? ` (${escuela.cct})` : ''} · Ciclo ${ciclo.nombre}`),
    navPrefectura(cicloId, fecha, 'dia'),
  ];
  const ir = (f: string) => ctx.ir(`#/ciclo/${cicloId}/prefectura/${f}`);
  const selFecha = h('input', { type: 'date', id: 'fecha-prefectura', value: fecha, min: ciclo.fechaInicio, max: ciclo.fechaFin, onchange: () => { if (selFecha.value) ir(selFecha.value); } });
  const selTurno = h('select', { id: 'turno-prefectura', onchange: () => { turnoPorCiclo.set(cicloId, selTurno.value); void ctx.recargar('#turno-prefectura'); } },
    turnos.length > 1 ? h('option', { value: '' }, 'Todos los turnos') : null, ...turnos.map((t) => h('option', { value: t.turno.id, selected: t.turno.id === turnoId }, t.turno.nombre)));
  const controles = h('div', { class: 'filtros no-imprimir' },
    h('div', { class: 'campo' }, h('label', { for: 'fecha-prefectura' }, 'Fecha'), selFecha,
      h('div', { class: 'acciones acciones--izq' }, botonAccion('◀ Día anterior', () => ir(sumarDias(fecha, -1))), botonAccion('Hoy', () => ir(fechaLocal(new Date()))), botonAccion('Día siguiente ▶', () => ir(sumarDias(fecha, 1))))),
    turnos.length ? h('div', { class: 'campo' }, h('label', { for: 'turno-prefectura' }, 'Turno'), selTurno) : null);

  if (fecha < ciclo.fechaInicio || fecha > ciclo.fechaFin) {
    return { titulo: 'Prefectura', contenido: h('div', { class: 'pagina' }, ...base, controles, h('p', { class: 'mensaje mensaje--aviso' }, icono('⚠'), ` La fecha está fuera del ciclo escolar (${ciclo.fechaInicio} a ${ciclo.fechaFin}).`)) };
  }

  const clases = await ctx.s.prefectura.clasesDelDia(cicloId, fecha, turnoId || null);
  const incidencias = (await ctx.s.prefectura.incidencias(cicloId, { desde: fecha, hasta: fecha }));
  const servicios = await ctx.s.prefectura.serviciosDelDia(cicloId, fecha, turnoId || null);
  const personal = (await ctx.s.personal.listar(escuela.id)).filter((p) => p.activo);
  const nombre = (id: string | null) => { const p = personal.find((x) => x.id === id); return p ? nombreCompleto(p) : 'Persona dada de baja'; };

  const atencion = clases.filter((c) => c.estado === 'posible' || c.estado === 'confirmado' || c.estado === 'cobertura_asignada' || c.estado === 'cobertura_realizada');
  const cuenta = (e: EstadoClase[]) => clases.filter((c) => e.includes(c.estado)).length;
  const pendientes = clases.filter((c) => c.cobertura && (c.cobertura.estado === 'sin_docente' || c.cobertura.estado === 'propuesta' || c.cobertura.estado === 'asignada'));

  const tarjetaClase = (c: ClaseDelDia) => h('li', { class: `tarjeta clase-pref clase-pref--${c.estado}`, 'data-sesion': c.sesionId },
    h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, `${c.grupo} · ${c.horaInicio}–${c.horaFin}`), insigniaClase(c.estado)),
    h('p', { class: 'tarjeta__meta' }, `${c.periodo} · ${c.materia} · Docente: ${c.docente ?? 'sin asignar'}${turnos.length > 1 ? ` · ${c.turno}` : ''}`),
    h('p', { class: 'clase-pref__motivo' }, c.motivo),
    c.cobertura?.asignadoId ? h('p', { class: 'tarjeta__meta' }, `Cubre: ${nombre(c.cobertura.asignadoId)}${c.cobertura.autorizadoPor ? ` · Autorizó: ${c.cobertura.autorizadoPor}` : ''}`) : null,
    h('a', { class: 'boton boton--chico no-imprimir', href: `#/cobertura/${c.sesionId}/${fecha}`, 'aria-label': `Atender ${c.grupo} ${c.horaInicio}` }, 'Atender'));

  // Vista por periodo
  const porPeriodo = new Map<string, ClaseDelDia[]>();
  for (const c of clases) { const k = `${c.horaInicio}–${c.horaFin}`; porPeriodo.set(k, [...(porPeriodo.get(k) ?? []), c]); }
  const vistaPeriodos = porPeriodo.size
    ? h('ol', { class: 'periodos-pref' }, ...[...porPeriodo].map(([hora, lista]) => h('li', { class: 'periodos-pref__fila' },
        h('span', { class: 'periodos-pref__hora' }, hora),
        h('ul', { class: 'periodos-pref__grupos' }, ...lista.map((c) => h('li', {},
          h('a', { href: `#/cobertura/${c.sesionId}/${fecha}`, class: `chip-pref chip-pref--${c.estado}`, title: `${ETIQUETA_ESTADO_CLASE[c.estado]}: ${c.motivo}` },
            h('span', { 'aria-hidden': 'true' }, VARIANTE_CLASE[c.estado][1]), ` ${c.grupo}`, h('span', { class: 'solo-lectores' }, ` ${ETIQUETA_ESTADO_CLASE[c.estado]}`))))))))
    : vacio('No hay clases en el horario oficial para este día y turno.');

  // Registrar incidencia
  const periodosTurno: { valor: string; texto: string }[] = [];
  for (const t of turnos.filter((x) => !turnoId || x.turno.id === turnoId)) {
    for (const b of (await ctx.s.horario.resumen(t.jornada.id)).bloques.filter((x) => x.tipo === 'periodo')) periodosTurno.push({ valor: b.id, texto: `${turnos.length > 1 ? `${t.turno.nombre} · ` : ''}${b.nombre} (${b.horaInicio}–${b.horaFin})` });
  }
  const otrosUsados = [...new Set((await ctx.s.prefectura.incidencias(cicloId)).map((i) => i.tipoOtro).filter((x): x is string => !!x))];
  const fI = 'f-incidencia';
  const formInc = alEnviar(formulario(fI, null,
    selector(fI, { nombre: 'personalId', etiqueta: 'Docente o trabajador', requerido: true, opciones: personal.map((p) => ({ valor: p.id, texto: nombreCompleto(p) })) }),
    selector(fI, { nombre: 'tipo', etiqueta: 'Tipo de incidencia', requerido: true, valor: 'falta', opciones: TIPOS_INCIDENCIA_PERSONAL.map((t) => ({ valor: t, texto: ETIQUETA_TIPO_INCIDENCIA[t] })) }),
    campo(fI, { nombre: 'tipoOtro', etiqueta: 'Si es «Otra»: ¿cuál?', maxlength: 60, sugerencias: otrosUsados, ayuda: 'Por ejemplo: comisión, capacitación. Las que escribas quedan como opciones para después.' }),
    selector(fI, { nombre: 'alcance', etiqueta: 'Afecta', requerido: true, valor: 'jornada', opciones: [{ valor: 'jornada', texto: 'Toda la jornada' }, { valor: 'periodos', texto: 'Sólo algunos periodos' }] }),
    casillas(fI, { nombre: 'periodoIds', leyenda: 'Periodos afectados (si no es toda la jornada)', opciones: periodosTurno, marcados: [] }),
    campo(fI, { nombre: 'observaciones', etiqueta: 'Observaciones', maxlength: 300 }),
    h('p', { class: 'ayuda' }, icono('ℹ'), ' Se guarda como REPORTADA. Sólo cuenta como hecho cuando alguien la confirma.'),
    h('div', { class: 'acciones' }, botonEnviar('Registrar incidencia'))), async () => {
    const f = document.getElementById(fI) as HTMLFormElement;
    await ctx.s.prefectura.registrarIncidencia(cicloId, {
      personalId: texto(f, 'personalId'), fecha, tipo: texto(f, 'tipo') as TipoIncidenciaPersonal, tipoOtro: texto(f, 'tipoOtro'),
      alcance: texto(f, 'alcance') as 'jornada' | 'periodos', periodoIds: marcados(f, 'periodoIds'), observaciones: texto(f, 'observaciones'),
    }, yo.id);
    await ctx.recargar();
    return 'Incidencia registrada como reportada.';
  });

  const listaIncidencias = incidencias.length
    ? h('ul', { class: 'renglones', id: 'incidencias-dia' }, ...incidencias.map((i) => h('li', { class: 'renglon renglon--bloque' },
        h('span', { class: 'renglon__texto' }, `${nombre(i.personalId)}: ${tipoTexto(i)}`, ' ', insigniaIncidencia(i)),
        h('span', { class: 'renglon__meta' }, i.alcance === 'jornada' ? 'Toda la jornada' : `${i.periodoIds.length} periodo(s)`, i.observaciones ? ` · ${i.observaciones}` : '', i.motivoValidacion ? ` · ${i.motivoValidacion}` : ''),
        editable && i.estado === 'reportada' ? h('span', { class: 'renglon__acciones no-imprimir' },
          botonAccion('Confirmar', async () => {
            if (await confirmar({ titulo: '¿Confirmar la incidencia?', mensaje: `${nombre(i.personalId)}: ${tipoTexto(i)} el ${fechaLarga(fecha)}. Confirma sólo si se verificó.`, textoConfirmar: 'Confirmar' })
              && await ejecutar(async () => { await ctx.s.prefectura.validarIncidencia(i.id, 'confirmada', yo.id); return 'Incidencia confirmada.'; })) await ctx.recargar();
          }, 'principal', `Confirmar incidencia de ${nombre(i.personalId)}`),
          botonAccion('Descartar', async () => {
            const m = await pedirTexto({ titulo: 'Descartar la incidencia', etiqueta: 'Motivo', textoConfirmar: 'Descartar', minimo: 3 });
            if (m && await ejecutar(async () => { await ctx.s.prefectura.validarIncidencia(i.id, 'descartada', yo.id, m); return 'Incidencia descartada.'; })) await ctx.recargar();
          }, 'secundario', `Descartar incidencia de ${nombre(i.personalId)}`)) : null)))
    : vacio('Sin incidencias registradas para este día. No se registra ninguna automáticamente.');

  return {
    titulo: `Prefectura ${fechaLarga(fecha)}`,
    contenido: h('div', { class: 'pagina' }, ...base, controles,
      h('p', { class: 'datos-impresion' }, `${escuela.nombre} · Ciclo ${ciclo.nombre} · ${fechaLarga(fecha)}`),
      h('dl', { class: 'totales totales--5', id: 'resumen-prefectura' },
        h('div', {}, h('dt', {}, 'Grupos con atención'), h('dd', {}, String(cuenta(['cobertura_asignada', 'cobertura_realizada'])))),
        h('div', {}, h('dt', {}, 'Sin docente confirmado'), h('dd', {}, String(cuenta(['confirmado'])))),
        h('div', {}, h('dt', {}, 'Posibles sin docente'), h('dd', {}, String(cuenta(['posible'])))),
        h('div', {}, h('dt', {}, 'Incidencias'), h('dd', {}, `${incidencias.filter((i) => i.estado !== 'descartada').length}`)),
        h('div', {}, h('dt', {}, 'Personal con SE'), h('dd', {}, String(new Set(servicios.map((x) => x.personalId)).size))),
        h('div', {}, h('dt', {}, 'Coberturas pendientes'), h('dd', {}, String(pendientes.length))),
        h('div', {}, h('dt', {}, 'Coberturas realizadas'), h('dd', {}, String(cuenta(['cobertura_realizada'])))),
      ),
      seccion('atencion', `Grupos que requieren atención (${atencion.length})`,
        atencion.length ? h('ul', { class: 'tarjetas', id: 'lista-atencion' }, ...atencion.map(tarjetaClase)) : vacio('Ningún grupo con incidencias o coberturas registradas.'),
        h('p', { class: 'ayuda' }, icono('ℹ'), ` ${cuenta(['sin_informacion'])} clase(s) sin información suficiente: no hay incidencias ni lista registrada; no se asume que falte el docente.`)),
      seccion('por-periodo', 'Vista por periodo', vistaPeriodos,
        h('ul', { class: 'leyenda-pref' }, ...(Object.keys(ETIQUETA_ESTADO_CLASE) as EstadoClase[]).map((e) => h('li', { class: `chip-pref chip-pref--${e}` }, h('span', { 'aria-hidden': 'true' }, VARIANTE_CLASE[e][1]), ` ${ETIQUETA_ESTADO_CLASE[e]}`)))),
      seccion('incidencias', 'Incidencias del personal', listaIncidencias, editable ? desplegable('Registrar incidencia', false, formInc) : null, yo.aviso),
      seccion('servicio', 'Personal con horas de servicio (SE) confirmadas',
        servicios.length ? h('ul', { class: 'renglones', id: 'lista-se' }, ...servicios.map((x) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, x.nombre, h('span', { class: 'renglon__sub' }, ` ${x.horaInicio}–${x.horaFin} · ${x.descripcion}`)),
          x.ausente ? insignia('Ausente (incidencia confirmada)', 'aviso', '✕') : x.ocupadoEn ? insignia(`Cubriendo ${x.ocupadoEn}`, 'neutro', '◑') : insignia('Disponible según registro', 'ok', '◆'))))
          : vacio('Nadie tiene horas SE confirmadas este día.'),
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Tener SE no autoriza por sí mismo a cubrir un grupo: la asignación requiere la autorización que defina la escuela.')),
      seccion('coberturas', 'Coberturas',
        pendientes.length ? h('ul', { class: 'renglones', id: 'coberturas-pendientes' }, ...pendientes.map((c) => h('li', { class: 'renglon' },
          h('span', { class: 'renglon__texto' }, `${c.grupo} ${c.horaInicio}`, h('span', { class: 'renglon__sub' }, ` ${ETIQUETA_ESTADO_COBERTURA[c.cobertura!.estado]}${c.cobertura!.asignadoId ? ` · ${nombre(c.cobertura!.asignadoId)}` : ''}`)),
          h('a', { class: 'boton boton--chico no-imprimir', href: `#/cobertura/${c.sesionId}/${fecha}` }, 'Ver')))) : vacio('Sin coberturas pendientes.'),
        h('div', { class: 'acciones acciones--izq no-imprimir' }, h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => window.print() }, 'Imprimir el día'))),
    ),
  };
}

// ================================================================= cobertura

export async function paginaCobertura(ctx: ContextoPagina, sesionId: string, fecha: string): Promise<Vista> {
  // Se busca la clase (con su estado del día) en los ciclos que incluyen la fecha.
  const clase = await buscarClase(ctx, sesionId, fecha);
  const { c, cicloId } = clase;
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const yo = await perfilTexto(ctx);
  const editable = ciclo.estado !== 'cerrado';
  const personal = (await ctx.s.personal.listar(escuela.id)).filter((p) => p.activo);
  const nombre = (id: string | null) => { const p = personal.find((x) => x.id === id); return p ? nombreCompleto(p) : '—'; };
  const cob = c.cobertura;
  const candidatos = editable && c.estado !== 'cobertura_realizada' ? await ctx.s.prefectura.candidatos(sesionId, fecha) : [];
  const actividades = await ctx.s.prefectura.actividades(cicloId, { materiaId: c.materiaId, gradoId: c.gradoId, soloValidadas: true });
  const historial = cob ? await ctx.s.prefectura.historial(cicloId, cob.id) : [];
  const volver = `#/ciclo/${cicloId}/prefectura/${fecha}`;

  const accion = async (fn: () => Promise<string>) => { if (await ejecutar(fn)) await ctx.recargar(); };

  // Propuesta: casillas sólo para compatibles
  const fP = 'f-propuesta';
  const compatibles = candidatos.filter((x) => x.compatible);
  const formProp = compatibles.length ? alEnviar(formulario(fP, null,
    casillas(fP, { nombre: 'propuestos', leyenda: 'Proponer a', opciones: compatibles.map((x) => ({ valor: x.personalId, texto: `${x.nombre} (${x.origen === 'se' ? 'SE' : 'sin SE'})` })), marcados: cob?.propuestoIds ?? [] }),
    h('p', { class: 'ayuda' }, 'Proponer no asigna: queda como sugerencia para quien autoriza.'),
    h('div', { class: 'acciones' }, botonEnviar('Registrar propuesta'))), async () => {
    const f = document.getElementById(fP) as HTMLFormElement;
    await ctx.s.prefectura.proponer(sesionId, fecha, marcados(f, 'propuestos'), yo.id);
    await ctx.recargar();
    return 'Propuesta registrada.';
  }) : null;

  // Asignación con autorización
  const fA = 'f-asignar-cobertura';
  const opcionesPersona = [...compatibles.map((x) => ({ valor: x.personalId, texto: `${x.nombre} · ${x.origen === 'se' ? 'SE confirmada' : 'sin SE'}` })),
    ...personal.filter((p) => !compatibles.some((x) => x.personalId === p.id)).map((p) => ({ valor: p.id, texto: `${nombreCompleto(p)} · revisar disponibilidad` }))];
  const formAsig = alEnviar(formulario(fA, null,
    selector(fA, { nombre: 'personalId', etiqueta: 'Personal asignado', requerido: true, valor: cob?.asignadoId ?? cob?.propuestoIds[0] ?? '', opciones: opcionesPersona }),
    campo(fA, { nombre: 'autorizadoPor', etiqueta: 'Autorizó (autoridad o responsable)', requerido: true, maxlength: 120, valor: cob?.autorizadoPor, sugerencias: ['Dirección', 'Subdirección académica', 'Subdirección de gestión', 'Coordinación'], ayuda: 'Escribe quién autorizó según la organización de tu escuela.' }),
    actividades.length ? selector(fA, { nombre: 'actividadId', etiqueta: 'Actividad del banco (validada)', valor: cob?.actividadId ?? '', opciones: actividades.map((a) => ({ valor: a.id, texto: a.titulo })) }) : h('p', { class: 'ayuda' }, 'No hay actividades validadas para esta materia y grado en el banco.'),
    campo(fA, { nombre: 'actividadTexto', etiqueta: 'Actividad (descripción breve)', maxlength: 300, valor: cob?.actividadTexto }),
    campo(fA, { nombre: 'observaciones', etiqueta: 'Observaciones', maxlength: 300 }),
    h('div', { class: 'acciones' }, botonEnviar(cob?.estado === 'asignada' ? 'Actualizar asignación' : 'Asignar cobertura'))), async () => {
    const f = document.getElementById(fA) as HTMLFormElement;
    await ctx.s.prefectura.asignar(sesionId, fecha, { personalId: texto(f, 'personalId'), autorizadoPor: texto(f, 'autorizadoPor'), actividadId: texto(f, 'actividadId') || null, actividadTexto: texto(f, 'actividadTexto'), observaciones: texto(f, 'observaciones') }, yo.id);
    await ctx.recargar();
    return 'Cobertura asignada con autorización registrada.';
  });

  return {
    titulo: `Atención de ${c.grupo}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Prefectura', href: volver }, { texto: `${c.grupo} ${c.horaInicio}` }]),
      encabezado(`${c.grupo} · ${fechaLarga(fecha)}`, `${c.periodo} (${c.horaInicio}–${c.horaFin}) · ${c.materia}`),
      seccion('situacion', 'Situación',
        h('p', { id: 'estado-clase' }, insigniaClase(c.estado), ' ', c.motivo),
        h('dl', { class: 'datos' },
          h('dt', {}, 'Docente asignado'), h('dd', {}, c.docente ?? 'Sin docente asignado'),
          h('dt', {}, 'Incidencias'), h('dd', {}, c.incidencias.length ? c.incidencias.map((i) => `${tipoTexto(i)} (${i.estado})`).join('; ') : 'Ninguna registrada'),
          cob ? h('dt', {}, 'Cobertura') : null, cob ? h('dd', { id: 'estado-cobertura' }, ETIQUETA_ESTADO_COBERTURA[cob.estado]) : null,
          cob?.propuestoIds.length ? h('dt', {}, 'Propuestos') : null, cob?.propuestoIds.length ? h('dd', {}, cob.propuestoIds.map(nombre).join(', ')) : null,
          cob?.asignadoId ? h('dt', {}, 'Asignado') : null, cob?.asignadoId ? h('dd', {}, nombre(cob.asignadoId)) : null,
          cob?.autorizadoPor ? h('dt', {}, 'Autorizó') : null, cob?.autorizadoPor ? h('dd', {}, `${cob.autorizadoPor}${cob.autorizadoEn ? ` (${new Date(cob.autorizadoEn).toLocaleString('es-MX')})` : ''}`) : null,
          cob?.actividadId || cob?.actividadTexto ? h('dt', {}, 'Actividad') : null, cob?.actividadId || cob?.actividadTexto ? h('dd', {}, [actividades.find((a) => a.id === cob.actividadId)?.titulo, cob.actividadTexto].filter(Boolean).join(' · ')) : null,
          cob?.observaciones ? h('dt', {}, 'Observaciones') : null, cob?.observaciones ? h('dd', {}, cob.observaciones) : null,
        ),
        editable && (c.estado === 'posible' || c.estado === 'sin_informacion') ? botonAccion('Confirmar: el grupo está sin docente', async () => {
          const m = await pedirTexto({ titulo: 'Confirmar grupo sin docente', mensaje: 'Registra cómo se verificó (p. ej. recorrido de prefectura).', etiqueta: 'Cómo se confirmó', textoConfirmar: 'Confirmar', minimo: 3 });
          if (m) await accion(async () => { await ctx.s.prefectura.confirmarSinDocente(sesionId, fecha, m, yo.id); return 'Grupo sin docente confirmado.'; });
        }, 'principal') : null,
        cob?.estado === 'asignada' && editable ? h('div', { class: 'acciones acciones--izq' },
          botonAccion('Registrar como realizada', async () => {
            if (await confirmar({ titulo: '¿La cobertura se realizó?', mensaje: `${nombre(cob.asignadoId)} atendió a ${c.grupo}.`, textoConfirmar: 'Sí, se realizó' })) await accion(async () => { await ctx.s.prefectura.cerrarCobertura(cob.id, 'realizada', null, yo.id); return 'Cobertura registrada como realizada.'; });
          }, 'principal'),
          botonAccion('No se realizó', async () => {
            const m = await pedirTexto({ titulo: 'Cobertura no realizada', etiqueta: 'Motivo', textoConfirmar: 'Registrar', minimo: 3 });
            if (m) await accion(async () => { await ctx.s.prefectura.cerrarCobertura(cob.id, 'no_realizada', m, yo.id); return 'Registrada como no realizada.'; });
          }, 'secundario'),
          botonAccion('Cancelar cobertura', async () => {
            const m = await pedirTexto({ titulo: 'Cancelar la cobertura', etiqueta: 'Motivo', textoConfirmar: 'Cancelar cobertura', minimo: 3, peligro: true });
            if (m) await accion(async () => { await ctx.s.prefectura.cerrarCobertura(cob.id, 'cancelada', m, yo.id); return 'Cobertura cancelada.'; });
          }, 'peligro')) : null),
      candidatos.length || editable && c.estado !== 'cobertura_realizada' ? seccion('candidatos', 'Personal sugerido',
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Sugerencias según horas SE confirmadas y horario. La aplicación no asigna a nadie por su cuenta.'),
        candidatos.length ? h('ul', { class: 'renglones', id: 'lista-candidatos' }, ...candidatos.map((x) => h('li', { class: 'renglon renglon--bloque' },
          h('span', { class: 'renglon__texto' }, x.nombre, ' ', x.compatible ? insignia(x.origen === 'se' ? 'Compatible · SE' : 'Compatible · sin SE', 'ok', '✓') : insignia('Incompatible', 'aviso', '✕')),
          h('span', { class: 'renglon__meta' }, x.detalle),
          x.problemas.length ? h('ul', { class: 'fila-imp__mensajes' }, ...x.problemas.map((p) => h('li', {}, p))) : null)))
          : vacio('No hay personal con SE ni docentes libres registrados para este horario.'),
        formProp ? desplegable('Proponer personal', false, formProp) : null) : null,
      editable && c.estado !== 'cobertura_realizada' ? seccion('asignar', 'Asignar cobertura (requiere autorización)', formAsig, yo.aviso) : null,
      historial.length ? seccion('historial-cobertura', 'Historial', h('ul', { class: 'renglones' }, ...historial.map((x) => h('li', { class: 'renglon renglon--bloque' },
        h('span', { class: 'renglon__texto' }, `${new Date(x.creadoEn).toLocaleString('es-MX')}: ${x.accion}`),
        h('span', { class: 'renglon__meta' }, [x.detalle, x.personalId ? `registró ${nombre(x.personalId)}` : null].filter(Boolean).join(' · ')))))) : null,
      h('a', { class: 'boton boton--secundario', href: volver }, 'Volver al panel del día'),
    ),
  };
}

async function buscarClase(ctx: ContextoPagina, sesionId: string, fecha: string): Promise<{ c: ClaseDelDia; cicloId: string }> {
  for (const e of await ctx.s.escuelas.listar()) {
    for (const ci of await ctx.s.ciclos.listar(e.id)) {
      if (fecha < ci.fechaInicio || fecha > ci.fechaFin) continue;
      const c = (await ctx.s.prefectura.clasesDelDia(ci.id, fecha)).find((x) => x.sesionId === sesionId);
      if (c) return { c, cicloId: ci.id };
    }
  }
  throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró esa clase en esa fecha (puede que el horario haya cambiado o que no sea un día de clase).');
}

// ====================================================== banco de actividades

export async function paginaBancoActividades(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const materias = await ctx.s.materias.listar(cicloId, { soloActivas: true });
  const grados = await ctx.s.grados.listarGrados(cicloId);
  const lista = await ctx.s.prefectura.actividades(cicloId);
  const yo = await perfilTexto(ctx);
  const editable = ciclo.estado !== 'cerrado';
  const hoy = fechaLocal(new Date());
  const f = 'f-actividad-banco';
  let archivo: { nombre: string; tipo: string; tamano: number; datos: string } | null = null;
  const entrada = h('input', { type: 'file', id: `${f}-archivo`, accept: '.pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx' });
  entrada.addEventListener('change', async () => {
    const a = entrada.files?.[0];
    archivo = null;
    if (!a) return;
    if (a.size > 1_048_576) { avisar('El archivo supera 1 MB. Usa uno más pequeño.', 'error'); entrada.value = ''; return; }
    const b = new Uint8Array(await a.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    archivo = { nombre: a.name, tipo: a.type || 'application/octet-stream', tamano: a.size, datos: btoa(s) };
  });
  const form = alEnviar(formulario(f, null,
    campo(f, { nombre: 'titulo', etiqueta: 'Título', requerido: true, maxlength: 120 }),
    h('div', { class: 'campo' }, h('label', { for: `${f}-descripcion` }, 'Descripción', h('span', { class: 'requerido' }, ' (obligatorio)')), h('textarea', { id: `${f}-descripcion`, name: 'descripcion', rows: 4, maxlength: 1000 })),
    selector(f, { nombre: 'materiaId', etiqueta: 'Materia', opciones: materias.map((m) => ({ valor: m.id, texto: m.nombre })) }),
    selector(f, { nombre: 'gradoId', etiqueta: 'Grado', opciones: grados.map((g) => ({ valor: g.id, texto: g.nombre })) }),
    campo(f, { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: hoy, requerido: true }),
    campo(f, { nombre: 'responsable', etiqueta: 'Responsable', maxlength: 120, ayuda: 'Quién elaboró o propone la actividad (p. ej. academia de la materia).' }),
    h('div', { class: 'campo' }, h('label', { for: `${f}-archivo` }, 'Archivo adjunto (opcional, máx. 1 MB)'), entrada, h('p', { class: 'ayuda' }, 'PDF, imagen, texto, Word o Excel. Se guarda en este dispositivo y en los respaldos.')),
    h('p', { class: 'ayuda' }, icono('ℹ'), ' Se registra como PROPUESTA. Sólo las actividades VALIDADAS se ofrecen al asignar coberturas.'),
    h('div', { class: 'acciones' }, botonEnviar('Registrar actividad'))), async () => {
    const el = document.getElementById(f) as HTMLFormElement;
    await ctx.s.prefectura.crearActividad(cicloId, { titulo: texto(el, 'titulo'), descripcion: texto(el, 'descripcion'), materiaId: texto(el, 'materiaId') || null, gradoId: texto(el, 'gradoId') || null, fecha: texto(el, 'fecha'), responsable: texto(el, 'responsable'), archivo: archivo as EntradaActividadBanco['archivo'] }, yo.id); // el tipo de archivo lo valida Zod
    await ctx.recargar();
    return 'Actividad registrada como propuesta.';
  });
  const nombreMat = (id: string | null) => materias.find((m) => m.id === id)?.nombre ?? 'Cualquier materia';
  const nombreGr = (id: string | null) => grados.find((g) => g.id === id)?.nombre ?? 'Cualquier grado';
  return {
    titulo: 'Banco de actividades',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Prefectura', href: `#/ciclo/${cicloId}/prefectura/${hoy}` }, { texto: 'Banco de actividades' }]),
      encabezado('Banco de actividades', `${escuela.nombre} · Ciclo ${ciclo.nombre}. Actividades para grupos sin docente.`),
      navPrefectura(cicloId, hoy, 'actividades'),
      seccion('lista-actividades', `Actividades (${lista.length})`,
        lista.length ? h('ul', { class: 'tarjetas', id: 'banco-actividades' }, ...lista.map((a) => h('li', { class: `tarjeta${a.estado === 'retirada' ? ' tarjeta--baja' : ''}` },
          h('div', { class: 'tarjeta__cabeza' }, h('h3', {}, a.titulo),
            a.estado === 'validada' ? insignia('VALIDADA', 'ok', '✓') : a.estado === 'propuesta' ? insignia('PROPUESTA (sin validar)', 'aviso', '?') : insignia('RETIRADA', 'neutro', '■')),
          h('p', { class: 'tarjeta__meta' }, `${nombreMat(a.materiaId)} · ${nombreGr(a.gradoId)} · ${a.fecha}${a.responsable ? ` · ${a.responsable}` : ''}`),
          h('p', {}, a.descripcion),
          h('div', { class: 'acciones acciones--izq' },
            a.archivo ? botonAccion(`Descargar ${a.archivo.nombre}`, () => {
              const bin = atob(a.archivo!.datos); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
              const url = URL.createObjectURL(new Blob([u], { type: a.archivo!.tipo })); const l = document.createElement('a'); l.href = url; l.download = a.archivo!.nombre; l.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
            }, 'secundario') : null,
            editable && a.estado === 'propuesta' ? botonAccion('Validar', async () => {
              if (await confirmar({ titulo: '¿Validar la actividad?', mensaje: 'Quedará disponible como actividad oficial para coberturas. Valida sólo si la revisó quien corresponde en tu escuela.', textoConfirmar: 'Validar' })
                && await ejecutar(async () => { await ctx.s.prefectura.cambiarEstadoActividad(a.id, 'validada', yo.id); return 'Actividad validada.'; })) await ctx.recargar();
            }, 'principal', `Validar ${a.titulo}`) : null,
            editable && a.estado !== 'retirada' ? botonAccion('Retirar', async () => {
              if (await ejecutar(async () => { await ctx.s.prefectura.cambiarEstadoActividad(a.id, 'retirada', yo.id); return 'Actividad retirada (se conserva en el historial).'; })) await ctx.recargar();
            }, 'secundario', `Retirar ${a.titulo}`) : null))))
          : vacio('Todavía no hay actividades registradas.'),
        editable ? desplegable('Registrar actividad', lista.length === 0, form) : null, yo.aviso),
    ),
  };
}

// =================================================================== reportes

export async function paginaReportesPrefectura(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const grupos = await ctx.s.grados.listarGrupos(cicloId);
  const grados = await ctx.s.grados.listarGrados(cicloId);
  const personal = await ctx.s.personal.listar(escuela.id);
  const turnos = await ctx.s.turnos.listar(cicloId);
  const hoy = fechaLocal(new Date());
  const ref = hoy < ciclo.fechaInicio || hoy > ciclo.fechaFin ? ciclo.fechaInicio : hoy;
  const lunes = sumarDias(ref, 1 - diaDeFecha(ref));
  const nombreG = (id: string) => { const g = grupos.find((x) => x.id === id); return g ? `${grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre}` : ''; };
  const resultado = h('div', { id: 'resultado-reporte', 'aria-live': 'polite' });
  const f = 'f-reporte';
  const form = formulario(f, null,
    selector(f, { nombre: 'periodo', etiqueta: 'Periodo', requerido: true, valor: 'semana', opciones: [{ valor: 'dia', texto: 'Día' }, { valor: 'semana', texto: 'Semana' }, { valor: 'mes', texto: 'Mes' }, { valor: 'intervalo', texto: 'Intervalo personalizado' }] }),
    h('div', { class: 'fila' }, campo(f, { nombre: 'desde', etiqueta: 'Desde', tipo: 'date', valor: lunes, requerido: true }), campo(f, { nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date', valor: sumarDias(lunes, 6), requerido: true })),
    h('div', { class: 'filtros' },
      selector(f, { nombre: 'grupoId', etiqueta: 'Grupo', opciones: grupos.map((g) => ({ valor: g.id, texto: nombreG(g.id) })) }),
      selector(f, { nombre: 'personalId', etiqueta: 'Docente o trabajador', opciones: personal.map((p) => ({ valor: p.id, texto: nombreCompleto(p) })) }),
      selector(f, { nombre: 'tipo', etiqueta: 'Tipo de incidencia', opciones: TIPOS_INCIDENCIA_PERSONAL.map((t) => ({ valor: t, texto: ETIQUETA_TIPO_INCIDENCIA[t] })) }),
      selector(f, { nombre: 'estadoCobertura', etiqueta: 'Estado de cobertura', opciones: (Object.keys(ETIQUETA_ESTADO_COBERTURA) as EstadoCobertura[]).map((e) => ({ valor: e, texto: ETIQUETA_ESTADO_COBERTURA[e] })) }),
      turnos.length > 1 ? selector(f, { nombre: 'turnoId', etiqueta: 'Turno', opciones: turnos.map((t) => ({ valor: t.turno.id, texto: t.turno.nombre })) }) : null),
    h('div', { class: 'acciones acciones--izq' }, botonEnviar('Generar reporte')));
  const selP = form.querySelector<HTMLSelectElement>('[name="periodo"]')!;
  const inD = form.querySelector<HTMLInputElement>('[name="desde"]')!;
  const inH = form.querySelector<HTMLInputElement>('[name="hasta"]')!;
  selP.addEventListener('change', () => {
    const d = inD.value || ref;
    if (selP.value === 'dia') inH.value = d;
    if (selP.value === 'semana') { const l = sumarDias(d, 1 - diaDeFecha(d)); inD.value = l; inH.value = sumarDias(l, 6); }
    if (selP.value === 'mes') { const [a, m] = d.split('-'); inD.value = `${a}-${m}-01`; const ultimo = new Date(Number(a), Number(m), 0).getDate(); inH.value = `${a}-${m}-${String(ultimo).padStart(2, '0')}`; }
  });
  alEnviar(form, async () => {
    const r = await ctx.s.prefectura.reporte(cicloId, {
      desde: texto(form, 'desde'), hasta: texto(form, 'hasta'), grupoId: texto(form, 'grupoId') || null, personalId: texto(form, 'personalId') || null,
      tipo: (texto(form, 'tipo') || null) as TipoIncidenciaPersonal | null, estadoCobertura: (texto(form, 'estadoCobertura') || null) as EstadoCobertura | null, turnoId: texto(form, 'turnoId') || null,
    });
    const ind = r.indicadores;
    reemplazar(resultado,
      h('div', { class: 'reporte-imprimible' },
        h('h2', {}, `Reporte de Prefectura · ${r.escuela}${r.cct ? ` (${r.cct})` : ''}`),
        h('p', {}, `Ciclo ${r.ciclo} · del ${r.desde.split('-').reverse().join('/')} al ${r.hasta.split('-').reverse().join('/')} · generado el ${new Date(r.generadoEn).toLocaleString('es-MX')}`),
        h('dl', { class: 'totales totales--5', id: 'indicadores-reporte' },
          h('div', {}, h('dt', {}, 'Incidencias confirmadas'), h('dd', {}, String(ind.incidenciasConfirmadas))),
          h('div', {}, h('dt', {}, 'Clases sin docente (confirmadas)'), h('dd', {}, String(ind.clasesSinDocenteConfirmadas))),
          h('div', {}, h('dt', {}, 'Coberturas realizadas'), h('dd', {}, String(ind.coberturasRealizadas))),
          h('div', {}, h('dt', {}, 'Porcentaje cubierto'), h('dd', {}, ind.porcentajeCubierto === null ? 'Sin datos' : `${ind.porcentajeCubierto} %`)),
          h('div', {}, h('dt', {}, 'Por confirmar (no se cuentan)'), h('dd', {}, `${ind.incidenciasSinConfirmar} incid. · ${ind.posiblesSinConfirmar} clases`)),
        ),
        h('p', { class: 'ayuda' }, 'Los indicadores usan sólo registros validados: incidencias confirmadas y coberturas registradas. Lo reportado sin confirmar se muestra aparte y no entra en los cálculos.'),
        h('h3', {}, 'Incidencias confirmadas por tipo'),
        h('ul', {}, ...TIPOS_INCIDENCIA_PERSONAL.map((t) => h('li', {}, `${ETIQUETA_TIPO_INCIDENCIA[t]}: ${ind.incidenciasPorTipo[t]}`))),
        h('h3', {}, `Incidencias (${r.incidencias.length})`),
        r.incidencias.length ? h('table', { class: 'tabla-reporte' }, h('thead', {}, h('tr', {}, ...['Fecha', 'Persona', 'Tipo', 'Alcance', 'Estado'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', {}, ...r.incidencias.map((i) => h('tr', {}, h('td', {}, i.fecha), h('td', {}, i.persona), h('td', {}, tipoTexto(i)), h('td', {}, i.alcance === 'jornada' ? 'Jornada' : `${i.periodoIds.length} periodo(s)`), h('td', {}, i.estado.toUpperCase())))))
          : vacio('Sin incidencias en el intervalo.'),
        h('h3', {}, `Clases que requirieron atención (${r.clases.length})`),
        r.clases.length ? h('table', { class: 'tabla-reporte', id: 'tabla-clases-reporte' }, h('thead', {}, h('tr', {}, ...['Fecha', 'Hora', 'Grupo', 'Materia', 'Docente', 'Estado', 'Cubrió', 'Autorizó'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', {}, ...r.clases.map((c) => h('tr', {}, h('td', {}, c.fecha), h('td', {}, c.horaInicio), h('td', {}, c.grupo), h('td', {}, c.materia), h('td', {}, c.docente ?? '—'), h('td', {}, ETIQUETA_ESTADO_CLASE[c.estado]), h('td', {}, c.asignado ?? '—'), h('td', {}, c.cobertura?.autorizadoPor ?? '—')))))
          : vacio('Sin clases con incidencias o coberturas en el intervalo.')),
      h('div', { class: 'acciones acciones--izq no-imprimir' },
        h('button', { type: 'button', class: 'boton', onclick: () => window.print() }, 'Imprimir o guardar como PDF'),
        h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => descargar(`reporte-prefectura-${r.desde}-${r.hasta}.json`, JSON.stringify(r, null, 2)) }, 'Descargar datos (JSON)')),
    );
    return null;
  }, 'Generando…');

  const historial = await ctx.s.prefectura.historial(cicloId);
  const nombre = (id: string | null) => { const p = personal.find((x) => x.id === id); return p ? nombreCompleto(p) : 'sin nombre'; };
  return {
    titulo: 'Reportes de Prefectura',
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Prefectura', href: `#/ciclo/${cicloId}/prefectura/${ref}` }, { texto: 'Reportes' }]),
      encabezado('Reportes e historial', `${escuela.nombre} · Ciclo ${ciclo.nombre}`),
      navPrefectura(cicloId, ref, 'reportes'),
      seccion('generar-reporte', 'Generar reporte', h('div', { class: 'no-imprimir' }, form), resultado),
      h('div', { class: 'no-imprimir' }, seccion('historial-prefectura', `Historial (${historial.length})`,
        historial.length ? h('ul', { class: 'renglones', id: 'historial-general' }, ...historial.slice(0, 200).map((x) => h('li', { class: 'renglon renglon--bloque' },
          h('span', { class: 'renglon__texto' }, `${new Date(x.creadoEn).toLocaleString('es-MX')} · ${x.entidad}: ${x.accion}`),
          h('span', { class: 'renglon__meta' }, [x.detalle, `registró ${nombre(x.personalId)}`].filter(Boolean).join(' · '))))) : vacio('Sin movimientos registrados.'))),
    ),
  };
}
