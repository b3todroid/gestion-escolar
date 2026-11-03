import type { ContextoPagina, Vista } from '../app';
import { h, icono, reemplazar } from '../components/dom';
import { alEnviar, botonEnviar, campo, formulario, numero, selector, texto } from '../components/formulario';
import { desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import type { AlumnoInscrito, Grado, Grupo } from '../models';
import { nombreAlumno } from '../services/alumnos';
import { ErrorDominio } from '../domain/errores';
import { camposAlumno, leerAlumno } from './alumnos';
import { navCatalogos } from './catalogos';

const LIMITE = 300;

/** Módulo de alumnos del ciclo: búsqueda, filtros, alta, resumen y posibles dobles inscripciones. */
export async function paginaAlumnosCiclo(ctx: ContextoPagina, cicloId: string): Promise<Vista> {
  const ciclo = await ctx.s.ciclos.obtener(cicloId);
  const escuela = await ctx.s.escuelas.obtener(ciclo.escuelaId);
  const grados = await ctx.s.grados.listarGrados(cicloId);
  const grupos = await ctx.s.grados.listarGrupos(cicloId);
  const turnos = await ctx.s.turnos.listar(cicloId);
  const resumen = await ctx.s.alumnos.resumen(cicloId);
  const duplicados = await ctx.s.alumnos.posiblesDuplicados(cicloId);
  const editable = ciclo.estado !== 'cerrado';
  const variosTurnos = turnos.length > 1;

  const grado = (id: string | null) => grados.find((g) => g.id === id);
  const nombreGrupo = (g: Grupo) => `${grado(g.gradoId)?.numero ?? ''}° ${g.nombre}${variosTurnos ? ` (${turnos.find((t) => t.turno.id === g.turnoId)?.turno.nombre ?? ''})` : ''}`;
  const grupoDe = (id: string | null) => grupos.find((g) => g.id === id);
  const ordenGrupos = [...grupos].sort((a, b) => (grado(a.gradoId)?.numero ?? 0) - (grado(b.gradoId)?.numero ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
  const gruposActivos = ordenGrupos.filter((g) => g.activo !== false);

  // ---------- Alta ----------
  const f = 'f-alumno-alta';
  const form = alEnviar(formulario(f, null,
    ...camposAlumno(f),
    selector(f, { nombre: 'grupoId', etiqueta: 'Grupo', opciones: [{ valor: 'ninguno', texto: 'Sin grupo por ahora' }, ...gruposActivos.map((g) => ({ valor: g.id, texto: nombreGrupo(g) }))], valor: gruposActivos.length === 1 ? gruposActivos[0]!.id : '' }),
    selector(f, { nombre: 'gradoId', etiqueta: 'Grado (si no tiene grupo)', opciones: grados.map((g: Grado) => ({ valor: g.id, texto: g.nombre })) }),
    campo(f, { nombre: 'numeroLista', etiqueta: 'Número de lista', tipo: 'number', min: 1, max: 200 }),
    h('div', { class: 'acciones' }, botonEnviar('Inscribir alumno')),
  ), async () => {
    const el = document.getElementById(f) as HTMLFormElement;
    const g = texto(el, 'grupoId');
    if (!g) throw new ErrorDominio('VALIDACION', 'Elige un grupo o «Sin grupo por ahora».', [{ campo: 'grupoId', mensaje: 'Elige un grupo o «Sin grupo por ahora».' }]);
    const a = await ctx.s.alumnos.inscribirNuevo(cicloId, leerAlumno(el), { grupoId: g === 'ninguno' ? null : g, gradoId: g === 'ninguno' ? texto(el, 'gradoId') || null : null, numeroLista: numero(el, 'numeroLista') });
    await ctx.recargar(`#${f}-nombre`);
    return `${nombreAlumno(a)} inscrito(a).`;
  });

  // ---------- Búsqueda y filtros ----------
  const lista = h('div', { 'aria-live': 'polite' });
  const buscador = h('input', { id: 'buscar-alumno', type: 'search', autocomplete: 'off', placeholder: 'Nombre, apellidos o matrícula' });
  const selGrado = h('select', { id: 'filtro-grado' }, h('option', { value: '' }, 'Todos'), ...grados.map((g) => h('option', { value: g.id }, g.nombre)));
  const selGrupo = h('select', { id: 'filtro-grupo' }, h('option', { value: '' }, 'Todos'), h('option', { value: 'sin' }, 'Sin grupo'), ...ordenGrupos.map((g) => h('option', { value: g.id }, nombreGrupo(g))));
  const selEstado = h('select', { id: 'filtro-estado-alumno' }, h('option', { value: 'inscritos' }, 'Inscritos'), h('option', { value: 'todos' }, 'Incluir bajas'));
  const fila = (a: AlumnoInscrito) => {
    const g = grupoDe(a.grupoId);
    return h('li', { class: `renglon${a.activo ? '' : ' renglon--inactivo'}` },
      h('span', { class: 'renglon__texto' }, h('a', { href: `#/alumno/${a.id}` }, nombreAlumno(a)),
        h('span', { class: 'renglon__sub' }, ` ${[g ? nombreGrupo(g) : `Sin grupo${a.inscripcion.gradoId ? `, ${grado(a.inscripcion.gradoId)?.nombre ?? ''}` : ''}`, a.inscripcion.numeroLista ? `núm. ${a.inscripcion.numeroLista}` : null, a.matricula ? `matr. ${a.matricula}` : null].filter(Boolean).join(' · ')}`)),
      a.activo ? (g ? null : insignia('Sin grupo', 'aviso', '○')) : insignia('Baja', 'neutro', '■'),
    );
  };
  let gen = 0;
  const filtrar = async () => {
    const n = ++gen;
    const r = await ctx.s.alumnos.listarCiclo(cicloId, { texto: buscador.value, gradoId: selGrado.value || null, grupoId: selGrupo.value && selGrupo.value !== 'sin' ? selGrupo.value : null, sinGrupo: selGrupo.value === 'sin', incluirBajas: selEstado.value === 'todos' });
    if (n !== gen) return;
    reemplazar(lista,
      h('p', { class: 'ayuda', id: 'conteo-alumnos' }, `${r.length} alumno(s)${r.length > LIMITE ? `; se muestran los primeros ${LIMITE}. Usa la búsqueda o los filtros.` : '.'}`),
      r.length ? h('ul', { class: 'renglones' }, ...r.slice(0, LIMITE).map(fila))
        : vacio(resumen.inscritos + resumen.bajas ? 'Nadie coincide con la búsqueda o los filtros.' : 'Todavía no hay alumnos inscritos en este ciclo. Inscríbelos aquí, desde cada grupo o con «Importar información».'),
    );
  };
  for (const el of [buscador, selGrado, selGrupo, selEstado]) el.addEventListener(el === buscador ? 'input' : 'change', () => void filtrar());
  await filtrar();

  const porGrado = grados.map((g) => ({ texto: g.nombre, n: resumen.porGrado.find((x) => x.gradoId === g.id)?.n ?? 0 }));
  const porGrupo = ordenGrupos.map((g) => ({ g, n: resumen.porGrupo.find((x) => x.grupoId === g.id)?.n ?? 0 }));

  return {
    titulo: `Alumnos del ciclo ${ciclo.nombre}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: escuela.nombreCorto ?? escuela.nombre, href: `#/escuela/${escuela.id}` }, { texto: 'Alumnos' }]),
      encabezado('Alumnos', `Ciclo ${ciclo.nombre}. Cada alumno es una sola persona; su inscripción (grado, grupo y estado) es por ciclo.`),
      navCatalogos(escuela.id, cicloId, 'alumnos'),
      h('dl', { class: 'totales', id: 'resumen-alumnos' },
        h('div', {}, h('dt', {}, 'Inscritos'), h('dd', {}, String(resumen.inscritos))),
        h('div', {}, h('dt', {}, 'Sin grupo'), h('dd', {}, String(resumen.sinGrupo))),
        h('div', {}, h('dt', {}, 'Bajas'), h('dd', {}, String(resumen.bajas))),
      ),
      resumen.inscritos ? desplegable('Inscritos por grado y por grupo', false,
        h('div', { class: 'resumen-matricula' },
          h('ul', { class: 'renglones' }, ...porGrado.map((x) => h('li', { class: 'renglon' }, h('span', { class: 'renglon__texto' }, x.texto), h('strong', {}, String(x.n))))),
          h('ul', { class: 'renglones' }, ...porGrupo.map((x) => h('li', { class: 'renglon' }, h('span', { class: 'renglon__texto' }, h('a', { href: `#/alumnos/${x.g.id}` }, nombreGrupo(x.g)), x.g.activo === false ? ' (desactivado)' : ''), h('strong', {}, String(x.n))))),
        )) : null,
      duplicados.length ? seccion('posibles-duplicados', `Posibles inscripciones dobles (${duplicados.length})`,
        h('p', { class: 'mensaje mensaje--aviso' }, icono('⚠'), ' Hay registros distintos con el mismo nombre en el mismo turno. Puede tratarse de homónimos: revisa cada caso. Nada se fusiona automáticamente.'),
        h('ul', { class: 'renglones' }, ...duplicados.map((d) => h('li', { class: 'renglon renglon--bloque' },
          h('span', { class: 'renglon__texto' }, nombreAlumno(d[0]!)),
          h('span', { class: 'renglon__meta' }, ...d.flatMap((a, i) => [i ? ' · ' : '', h('a', { href: `#/alumno/${a.id}` }, `${grupoDe(a.grupoId) ? nombreGrupo(grupoDe(a.grupoId)!) : 'Sin grupo'}${a.matricula ? `, matr. ${a.matricula}` : ''}`)])))))) : null,
      seccion('lista-alumnos', 'Buscar alumnos',
        h('div', { class: 'filtros' },
          h('div', { class: 'campo' }, h('label', { for: 'buscar-alumno' }, 'Buscar'), buscador),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-grado' }, 'Grado'), selGrado),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-grupo' }, 'Grupo'), selGrupo),
          h('div', { class: 'campo' }, h('label', { for: 'filtro-estado-alumno' }, 'Estado'), selEstado),
        ),
        lista,
      ),
      editable ? seccion('alta-alumno', 'Inscribir alumno', desplegable('Inscribir un alumno nuevo', resumen.inscritos + resumen.bajas === 0, form),
        h('p', { class: 'ayuda' }, icono('ℹ'), ' Para muchos alumnos usa ', h('a', { href: `#/ciclo/${cicloId}/importar-datos` }, 'Importar información'), ' o la captura por renglones de cada grupo.')) : null,
    ),
  };
}
