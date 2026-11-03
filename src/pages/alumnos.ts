import type { ContextoPagina, Vista } from '../app';
import { h, icono } from '../components/dom';
import { alEnviar, areaTexto, botonEnviar, campo, ejecutar, formulario, texto } from '../components/formulario';
import { botonAccion, desplegable, encabezado, insignia, migas, seccion, vacio } from '../components/piezas';
import { confirmar, pedirTexto } from '../components/dialogo';
import { ETIQUETA_REPORTE, pedirReporte } from '../components/reporte';
import { interpretarRenglon, nombreAlumno } from '../services/alumnos';
import { ErrorDominio } from '../domain/errores';
import { horaLocal, fechaLocal } from '../utils/fechas';
import { aMinutos } from '../domain/tiempo';

export async function paginaAlumnos(ctx: ContextoPagina, grupoId: string): Promise<Vista> {
  const grupo = await ctx.s.grados.obtenerGrupo(grupoId);
  const grado = (await ctx.s.grados.listarGrados(grupo.cicloEscolarId)).find((g) => g.id === grupo.gradoId);
  const ciclo = await ctx.s.ciclos.obtener(grupo.cicloEscolarId);
  const nombreGrupo = `${grado?.numero ?? ''}° ${grupo.nombre}`;
  const resumen = await ctx.s.asistencia.resumenGrupo(grupoId);
  const fuera = await ctx.s.asistencia.fueraDelAula(grupoId);
  const editable = ciclo.estado !== 'cerrado';
  const activos = resumen.filter((r) => r.alumno.activo);

  const fA = 'f-alumno';
  const formUno = alEnviar(formulario(fA, null,
    campo(fA, { nombre: 'nombre', etiqueta: 'Nombre(s)', requerido: true, maxlength: 60 }),
    h('div', { class: 'fila' },
      campo(fA, { nombre: 'primerApellido', etiqueta: 'Primer apellido', requerido: true, maxlength: 60 }),
      campo(fA, { nombre: 'segundoApellido', etiqueta: 'Segundo apellido', maxlength: 60 }),
    ),
    h('div', { class: 'acciones' }, botonEnviar('Agregar alumno')),
  ), async () => {
    const f = document.getElementById(fA) as HTMLFormElement;
    const a = await ctx.s.alumnos.crear(grupoId, { nombre: texto(f, 'nombre'), primerApellido: texto(f, 'primerApellido'), segundoApellido: texto(f, 'segundoApellido') });
    await ctx.recargar('#f-alumno-nombre');
    return `${a.nombre} agregado(a).`;
  });
  const fL = 'f-alumnos-lote';
  const formLote = alEnviar(formulario(fL, null,
    areaTexto(fL, { nombre: 'lote', etiqueta: 'Alumnos', requerido: true, filas: 8, ayuda: 'Uno por renglón: «Apellidos, Nombre(s)». Por ejemplo: «Pérez López, Ana María».' }),
    h('div', { class: 'acciones' }, botonEnviar('Agregar alumnos')),
  ), async () => {
    const f = document.getElementById(fL) as HTMLFormElement;
    const r = await ctx.s.alumnos.crearVarios(grupoId, texto(f, 'lote'));
    await ctx.recargar();
    return `${r.length} alumno(s) agregados.`;
  });

  return {
    titulo: `Alumnos de ${nombreGrupo}`,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: `Grupo ${nombreGrupo}`, href: `#/grupo/${grupoId}` }, { texto: 'Alumnos' }]),
      encabezado(`Alumnos de ${nombreGrupo}`, `Ciclo ${ciclo.nombre}. ${activos.length} alumno(s) activos.`),
      fuera.length ? seccion('fuera', 'Fuera del aula ahora',
        h('ul', { class: 'renglones' }, ...fuera.map((s) => {
          const a = resumen.find((r) => r.alumno.id === s.alumnoId)?.alumno;
          return h('li', { class: 'renglon' },
            h('span', { class: 'renglon__texto' }, a ? nombreAlumno(a) : 'Alumno', h('span', { class: 'renglon__sub' }, ` desde las ${s.salida}${s.fecha !== fechaLocal(new Date()) ? ` del ${s.fecha}` : ''}`)),
            editable ? botonAccion('Regresó', async () => {
              const ahora = horaLocal(new Date());
              const hora = s.fecha === fechaLocal(new Date()) && aMinutos(ahora) >= aMinutos(s.salida) ? ahora : s.salida;
              if (await ejecutar(async () => { await ctx.s.asistencia.reincorporar(s.id, hora); return 'Reincorporación registrada.'; })) await ctx.recargar();
            }, 'principal', `Reincorporar a ${a ? nombreAlumno(a) : 'alumno'}`) : null,
          );
        }))) : null,
      seccion('lista-alumnos', 'Asistencia del ciclo',
        activos.length
          ? h('ol', { class: 'renglones lista-resumen' }, ...activos.map((r, i) => h('li', { class: 'renglon' },
              h('span', { class: 'alumno__num', 'aria-hidden': 'true' }, String(i + 1)),
              h('a', { class: 'renglon__texto', href: `#/alumno/${r.alumno.id}` }, nombreAlumno(r.alumno)),
              h('span', { class: 'conteos' },
                r.faltas ? insignia(`${r.faltas} F`, 'aviso', '✕') : null,
                r.retardos ? insignia(`${r.retardos} R`, 'aviso', '◷') : null,
                r.salidas ? insignia(`${r.salidas} salidas`, 'neutro', '🚻') : null,
                r.reportes ? insignia(`${r.reportes} reportes`, 'neutro', '✎') : null,
                !r.faltas && !r.retardos ? h('span', { class: 'renglon__sub' }, 'Sin faltas ni retardos') : null,
              ),
            )))
          : vacio('Sin alumnos. Agrégalos uno por uno o varios a la vez.'),
        editable ? desplegable('Agregar varios alumnos', activos.length === 0, formLote) : null,
        editable ? desplegable('Agregar un alumno', false, formUno) : null,
      ),
      resumen.some((r) => !r.alumno.activo) ? seccion('bajas', 'Dados de baja',
        h('ul', { class: 'renglones' }, ...resumen.filter((r) => !r.alumno.activo).map((r) => h('li', { class: 'renglon' }, h('a', { class: 'renglon__texto', href: `#/alumno/${r.alumno.id}` }, nombreAlumno(r.alumno)))))) : null,
      h('p', { class: 'ayuda' }, icono('ℹ'), ' Sólo se guardan nombre y apellidos; no se registran CURP, fechas de nacimiento ni datos de contacto.'),
    ),
  };
}

export async function paginaAlumno(ctx: ContextoPagina, alumnoId: string): Promise<Vista> {
  const a = await ctx.s.alumnos.obtener(alumnoId);
  const grupo = await ctx.s.grados.obtenerGrupo(a.grupoId);
  const grado = (await ctx.s.grados.listarGrados(grupo.cicloEscolarId)).find((g) => g.id === grupo.gradoId);
  const ciclo = await ctx.s.ciclos.obtener(a.cicloEscolarId);
  const persona = await ctx.s.panel.perfil();
  const h0 = await ctx.s.asistencia.historialAlumno(alumnoId);
  const nombre = nombreAlumno(a);
  const nombreGrupo = `${grado?.numero ?? ''}° ${grupo.nombre}`;
  const editable = ciclo.estado !== 'cerrado';
  const faltas = h0.asistencias.filter((x) => x.marca === 'F');
  const retardos = h0.asistencias.filter((x) => x.marca === 'R');
  const fecha = (f: string) => f.split('-').reverse().join('/');

  return {
    titulo: nombre,
    contenido: h('div', { class: 'pagina' },
      migas([{ texto: 'Inicio', href: '#/' }, { texto: `Alumnos de ${nombreGrupo}`, href: `#/alumnos/${grupo.id}` }, { texto: nombre }]),
      encabezado(nombre, `${nombreGrupo}, ciclo ${ciclo.nombre}`),
      a.activo ? null : h('p', {}, insignia('Dado(a) de baja', 'neutro', '■')),
      h('dl', { class: 'totales' },
        h('div', {}, h('dt', {}, 'Faltas'), h('dd', {}, String(faltas.length))),
        h('div', {}, h('dt', {}, 'Retardos'), h('dd', {}, String(retardos.length))),
        h('div', {}, h('dt', {}, 'Salidas'), h('dd', {}, String(h0.salidas.length))),
      ),
      seccion('faltas', 'Faltas y retardos',
        h0.asistencias.length
          ? h('ul', { class: 'renglones' }, ...h0.asistencias.map((x) => h('li', { class: 'renglon' },
              insignia(x.marca === 'F' ? 'Falta' : `Retardo${x.horaLlegada ? ` (llegó ${x.horaLlegada})` : ''}`, 'aviso', x.marca === 'F' ? '✕' : '◷'),
              h('span', { class: 'renglon__texto' }, `${fecha(x.fecha)} ${x.hora}`, h('span', { class: 'renglon__sub' }, ` ${x.materia}`)))))
          : vacio('Sin faltas ni retardos registrados.')),
      seccion('salidas', 'Salidas del aula',
        h0.salidas.length
          ? h('ul', { class: 'renglones' }, ...h0.salidas.map((s) => h('li', { class: 'renglon' },
              h('span', { class: 'renglon__texto' }, `${fecha(s.fecha)}, salió ${s.salida}`, h('span', { class: 'renglon__sub' }, s.regreso ? `, regresó ${s.regreso}` : ', sigue fuera')),
              editable ? botonAccion('Anular', async () => {
                if (await confirmar({ titulo: '¿Anular esta salida?', mensaje: 'Úsalo sólo si se registró por error.', textoConfirmar: 'Anular', peligro: true })
                  && await ejecutar(async () => { await ctx.s.asistencia.anularSalida(s.id); return 'Salida anulada.'; })) await ctx.recargar();
              }, 'peligro', `Anular salida del ${fecha(s.fecha)} ${s.salida}`) : null,
            )))
          : vacio('Sin salidas registradas.')),
      seccion('reportes', 'Reportes breves',
        h0.reportes.length
          ? h('ul', { class: 'renglones' }, ...h0.reportes.map((r) => h('li', { class: 'renglon renglon--bloque' },
              h('span', {}, insignia(ETIQUETA_REPORTE[r.tipo], r.tipo === 'reconocimiento' ? 'ok' : 'neutro', '✎'), ` ${fecha(r.fecha)}`),
              h('span', { class: 'renglon__texto' }, r.texto),
              editable ? botonAccion('Eliminar', async () => {
                if (await confirmar({ titulo: '¿Eliminar este reporte?', mensaje: r.texto, textoConfirmar: 'Eliminar', peligro: true })
                  && await ejecutar(async () => { await ctx.s.asistencia.eliminarReporte(r.id); return 'Reporte eliminado.'; })) await ctx.recargar();
              }, 'peligro', 'Eliminar reporte') : null,
            )))
          : vacio('Sin reportes.'),
        editable && a.activo ? botonAccion('Nuevo reporte', async () => {
          const r = await pedirReporte(nombre);
          if (r && await ejecutar(async () => { await ctx.s.asistencia.crearReporte(a.id, r, { personalId: persona?.id ?? null, sesionId: null, fecha: fechaLocal(new Date()) }); return 'Reporte guardado.'; })) await ctx.recargar();
        }, 'principal') : null,
      ),
      editable ? seccion('datos-alumno', 'Datos',
        h('div', { class: 'acciones acciones--izq' },
          botonAccion('Corregir nombre', async () => {
            const nuevo = await pedirTexto({ titulo: 'Corregir nombre', mensaje: 'Escribe «Apellidos, Nombre(s)».', etiqueta: 'Nombre completo', textoConfirmar: 'Guardar' });
            if (!nuevo) return;
            const e = interpretarRenglon(nuevo);
            if (await ejecutar(async () => {
              if (!e) throw new ErrorDominio('VALIDACION', 'Usa el formato «Apellidos, Nombre(s)».');
              await ctx.s.alumnos.actualizar(a.id, e); return 'Nombre corregido.';
            })) await ctx.recargar();
          }, 'secundario'),
          botonAccion(a.activo ? 'Dar de baja' : 'Reactivar', async () => {
            if (a.activo && !(await confirmar({ titulo: `¿Dar de baja a ${nombre}?`, mensaje: 'Dejará de aparecer en las listas. Su historial se conserva.', textoConfirmar: 'Dar de baja' }))) return;
            if (await ejecutar(async () => { await ctx.s.alumnos.cambiarActivo(a.id, !a.activo); return a.activo ? 'Alumno dado de baja.' : 'Alumno reactivado.'; })) await ctx.recargar();
          }, 'secundario'),
          botonAccion('Eliminar', async () => {
            if (await confirmar({ titulo: `¿Eliminar a ${nombre}?`, mensaje: 'Sólo si se registró por error y no tiene asistencias ni reportes.', textoConfirmar: 'Eliminar', peligro: true })
              && await ejecutar(async () => { await ctx.s.alumnos.eliminar(a.id); return 'Alumno eliminado.'; })) ctx.ir(`#/alumnos/${grupo.id}`);
          }, 'peligro'),
        )) : null,
    ),
  };
}
