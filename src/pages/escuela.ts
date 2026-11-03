import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, botonEnviar, campo, ejecutar, formulario, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar } from '../components/dialogo';
import type { CicloEscolar, Escuela, EstadoCiclo } from '../models';
import { ETIQUETA_ESTADO } from '../services/ciclos';
import { NIVEL_ETIQUETA, formatoFecha } from './etiquetas';
import { nombreEntidad } from '../domain/catalogos';
import { textoDias } from './ciclo';
import { navCatalogos } from './catalogos';

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
  const personal = await ctx.s.personal.listar(id);

  // ---------- Panel principal: resumen del ciclo vigente ----------
  const ciclo = ciclos.find((c) => c.estado === 'activo') ?? ciclos.find((c) => c.estado === 'planeacion') ?? ciclos[0] ?? null;
  const turnos = ciclo ? await ctx.s.turnos.listar(ciclo.id) : [];
  const grados = ciclo ? await ctx.s.grados.listarGrados(ciclo.id) : [];
  const grupos = ciclo ? await ctx.s.grados.listarGrupos(ciclo.id) : [];
  const activos = grupos.filter((g) => g.activo !== false);
  const jornadas = await Promise.all(turnos.map(async (t) => {
    const r = await ctx.s.horario.resumen(t.jornada.id);
    const p = r.bloques.filter((b) => b.tipo === 'periodo').length;
    return { t, texto: `${textoDias(t.jornada.dias)}, de ${t.jornada.horaInicio} a ${t.jornada.horaFin}; ${p} periodo(s) y ${r.bloques.length - p} receso(s)` };
  }));
  const dato = (etiqueta: string, valor: string | null, vacioTexto = 'Sin capturar') =>
    h('div', { class: 'panel-escuela__dato' }, h('dt', {}, etiqueta), h('dd', {}, valor ?? vacioTexto));
  const panel = h('section', { class: 'panel-escuela', 'aria-labelledby': 'panel-titulo' },
    h('div', { class: 'panel-escuela__cabeza' },
      escuela.logotipo ? h('img', { class: 'panel-escuela__logo', src: escuela.logotipo, alt: `Logotipo de ${escuela.nombre}`, width: 72, height: 72 }) : null,
      h('div', {},
        h('h2', { id: 'panel-titulo' }, escuela.nombreCorto ?? escuela.nombre),
        escuela.nombreCorto ? h('p', { class: 'panel-escuela__oficial' }, escuela.nombre) : null,
        h('p', { class: 'panel-escuela__oficial' }, [NIVEL_ETIQUETA[escuela.nivel], escuela.localidad, nombreEntidad(escuela.entidad)].filter(Boolean).join(', ')),
      ),
    ),
    h('dl', { class: 'panel-escuela__datos' },
      dato('CCT', escuela.cct),
      dato('Ciclo escolar', ciclo ? `${ciclo.nombre} (${ETIQUETA_ESTADO[ciclo.estado].toLowerCase()})` : null, 'Sin ciclo'),
      dato(turnos.length > 1 ? 'Turnos' : 'Turno', turnos.length ? turnos.map((t) => t.turno.nombre).join(', ') : null, 'Sin turno'),
      dato('Grados', String(grados.length)),
      dato('Grupos', `${activos.length}${grupos.length > activos.length ? ` activos (${grupos.length - activos.length} desactivados)` : ''}`),
    ),
    jornadas.length ? h('div', { class: 'panel-escuela__jornada' }, h('h3', {}, 'Jornada configurada'), ...jornadas.map((j) => h('p', {}, jornadas.length > 1 ? `${j.t.turno.nombre}: ${j.texto}` : j.texto))) : null,
    h('nav', { class: 'panel-escuela__accesos', 'aria-label': 'Administración' },
      h('a', { class: 'boton', href: `#/escuela/${escuela.id}/editar` }, 'Editar datos escolares'),
      turnos.length === 1 ? h('a', { class: 'boton', href: `#/turno/${turnos[0]!.turno.id}` }, 'Administrar periodos')
        : ciclo ? h('a', { class: 'boton', href: `#/ciclo/${ciclo.id}` }, 'Administrar periodos') : null,
      ciclo ? h('a', { class: 'boton', href: `#/ciclo/${ciclo.id}` }, 'Administrar grupos') : null,
      ciclo ? h('a', { class: 'boton', href: `#/ciclo/${ciclo.id}/horarios` }, 'Horarios') : null,
    ),
  );
  // ---------- Resumen de catálogos (conteos reales del ciclo vigente) ----------
  const activosPersonal = personal.filter((p) => p.activo);
  const matricula = ciclo ? await ctx.s.alumnos.resumen(ciclo.id) : null;
  const materias = ciclo ? (await ctx.s.materias.listar(ciclo.id)).filter((m) => m.activo !== false) : [];
  const cifra = (etiqueta: string, valor: number, href: string | null) =>
    h('div', {}, h('dt', {}, etiqueta), h('dd', {}, href ? h('a', { href }, String(valor)) : String(valor)));
  const catalogos = h('section', { class: 'seccion', 'aria-labelledby': 'catalogos-titulo' },
    h('h2', { id: 'catalogos-titulo' }, 'Catálogos escolares'),
    navCatalogos(escuela.id, ciclo?.id ?? null, 'personal', false),
    h('dl', { class: 'totales totales--5', id: 'resumen-catalogos' },
      cifra('Personal activo', activosPersonal.length, `#/escuela/${escuela.id}/personal`),
      cifra('Docentes', activosPersonal.filter((p) => p.funciones.includes('docente')).length, ciclo ? `#/ciclo/${ciclo.id}/docentes` : null),
      cifra('Alumnos inscritos', matricula?.inscritos ?? 0, ciclo ? `#/ciclo/${ciclo.id}/alumnos` : null),
      cifra('Alumnos sin grupo', matricula?.sinGrupo ?? 0, ciclo ? `#/ciclo/${ciclo.id}/alumnos` : null),
      cifra('Materias activas', materias.length, ciclo ? `#/ciclo/${ciclo.id}/materias` : null),
    ),
    matricula && matricula.inscritos ? h('p', { class: 'ayuda' }, 'Por grado: ', grados.map((g) => `${g.nombre} ${matricula.porGrado.find((x) => x.gradoId === g.id)?.n ?? 0}`).join(' · '), '.') : null,
    matricula && matricula.inscritos ? h('p', { class: 'ayuda' }, 'Por grupo: ', grupos.filter((g) => g.activo !== false).map((g) => `${grados.find((x) => x.id === g.gradoId)?.numero ?? ''}° ${g.nombre} ${matricula.porGrupo.find((x) => x.grupoId === g.id)?.n ?? 0}`).join(' · '), '.') : null,
  );
  const herramientas = h('section', { class: 'seccion', 'aria-labelledby': 'mas-titulo' },
    h('h2', { id: 'mas-titulo' }, 'Otros módulos'),
    h('ul', { class: 'modulos' },
      ciclo ? h('li', {}, h('a', { href: `#/ciclo/${ciclo.id}/importar` }, 'Importar horarios desde Excel'), h('span', { class: 'modulos__estado' }, 'Disponible')) : null,
      h('li', {}, h('a', { href: '#/respaldos' }, 'Respaldos'), h('span', { class: 'modulos__estado' }, 'Disponible')),
      h('li', {}, h('a', { href: '#/aplicacion' }, 'Aplicación y datos (instalar, sin conexión)'), h('span', { class: 'modulos__estado' }, 'Disponible')),
      ...['Prefectura', 'Reportes de asistencia por periodo', 'Sincronización entre dispositivos'].map((m) =>
        h('li', { class: 'modulos__futuro' }, h('span', {}, m), h('span', { class: 'modulos__estado' }, 'Próximamente'))),
    ),
  );

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
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre }]),
      encabezado(escuela.nombre, 'Panel principal'),
      panel,
      seccion('datos', 'Datos del plantel',
        h('dl', { class: 'datos' },
          h('dt', {}, 'Clave (CCT)'), h('dd', {}, escuela.cct ?? 'Sin registrar'),
          h('dt', {}, 'Entidad'), h('dd', {}, nombreEntidad(escuela.entidad) ?? 'Sin registrar'),
          h('dt', {}, 'Municipio o alcaldía'), h('dd', {}, escuela.localidad ?? 'Sin registrar'),
          escuela.zonaEscolar ? h('dt', {}, 'Zona escolar') : null, escuela.zonaEscolar ? h('dd', {}, escuela.zonaEscolar) : null,
          escuela.sector ? h('dt', {}, 'Sector') : null, escuela.sector ? h('dd', {}, escuela.sector) : null,
          escuela.domicilio ? h('dt', {}, 'Domicilio') : null, escuela.domicilio ? h('dd', {}, escuela.domicilio) : null,
          escuela.telefono ? h('dt', {}, 'Teléfono') : null, escuela.telefono ? h('dd', {}, escuela.telefono.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1 $2 $3')) : null,
          escuela.correo ? h('dt', {}, 'Correo') : null, escuela.correo ? h('dd', {}, escuela.correo) : null,
        ),
        h('div', { class: 'acciones acciones--izq' },
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
      catalogos,
      herramientas,
      seccion('personal', 'Personal',
        h('p', {}, personal.length ? `${activosPersonal.length} persona(s) activa(s), ${activosPersonal.filter((p) => p.funciones.includes('docente')).length} con función docente.` : 'Registra una vez a docentes y demás personal; sirve para todos los ciclos.'),
        h('a', { class: 'boton boton--chico', href: `#/escuela/${escuela.id}/personal` }, personal.length ? 'Ver personal' : 'Registrar personal'),
      ),
      seccion('ciclos', 'Ciclos escolares',
        ciclos.length ? h('ul', { class: 'tarjetas' }, ...ciclos.map(tarjetaCiclo)) : vacio('Agrega el primer ciclo escolar para configurar turnos, periodos, grados y grupos.'),
        panelForm,
      ),
      ciclos.length ? null : h('p', { class: 'ayuda' }, icono('ℹ'), ' Cada ciclo escolar tiene su propia configuración; los datos de un ciclo no se mezclan con los de otro.'),
    ),
  };
}
