/**
 * Generador REPRODUCIBLE de la escuela FICTICIA del piloto (Fase 10).
 *
 *   ESCUELA DEMO GESTIÓN ESCOLAR · identificador DEMO-001 · SIN CCT (no se inventa una clave oficial)
 *
 * - Identificadores ESTABLES: cada id se deriva de una clave fija (SHA-256), y las marcas de
 *   asistencia de una secuencia pseudoaleatoria con semilla. Mismos parámetros = mismo archivo y
 *   misma huella.
 * - Escala configurable (`escala` 0.1–1) para equipos con pocos recursos. Con escala 1:
 *   30 grupos, 100 trabajadores y 1 500 alumnos.
 * - Dos turnos con jornadas distintas: el matutino tiene 6 periodos de 50 min; el vespertino tiene
 *   periodos de 45 min y uno de 60 min. Cada turno tiene su receso.
 * - Horario completo SIN choques (cuadrado latino por bloques de 6 grupos), SE confirmadas y
 *   pendientes, asistencia de varias semanas con faltas, retardos y correcciones, salidas al baño,
 *   reportes, incidencias del personal (confirmadas, reportadas y descartadas), coberturas
 *   autorizadas y realizadas, y banco de actividades.
 * Produce un RESPALDO formato 2 válido: se carga con «Restaurar» en un navegador del piloto.
 * Todos los nombres son FICTICIOS (apellidos «Demo», «Ejemplo», «Prueba»…). Nunca datos reales.
 */
import { createHash } from 'node:crypto';
import { TABLAS_RESPALDO } from '../src/validators/respaldo';

export interface OpcionesPiloto {
  /** 0.1 a 1 (1 = 30 grupos, 100 trabajadores, 1 500 alumnos). */
  escala?: number;
  /** Semanas de asistencia anteriores a `hoy`. */
  semanas?: number;
  /** Día de referencia (AAAA-MM-DD). La asistencia generada termina el día hábil anterior. */
  hoy?: string;
  alumnosPorGrupo?: number;
}

export interface DatosPiloto {
  contenido: string;
  conteos: Record<string, number>;
  huella: string;
  escuelaId: string; cicloId: string; hoy: string;
  turnos: { id: string; nombre: string; periodos: { id: string; horaInicio: string; horaFin: string }[] }[];
  grupos: { id: string; nombre: string; grado: number; turno: string }[];
  /** Docente con clases el día `hoy` en el matutino (para el recorrido del docente). */
  docente: { id: string; nombre: string; sesionHoyId: string; grupoId: string };
  /** Otro docente del mismo turno, para la ausencia en Prefectura. */
  docenteAusente: { id: string; nombre: string };
  prefectura: { id: string; nombre: string };
  direccion: { id: string; nombre: string };
  csvAlumnosNuevos: string;
}

export const ESCUELA_DEMO = { nombre: 'ESCUELA DEMO GESTIÓN ESCOLAR', identificador: 'DEMO-001' } as const;

const NOMBRES = ['Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fer', 'Gabi', 'Hugo', 'Iris', 'Juan', 'Karla', 'Luis', 'Mara', 'Nico', 'Olga', 'Pablo'];
const APELLIDOS = ['Demo', 'Ejemplo', 'Prueba', 'Muestra', 'Ficticio', 'Simulado', 'Modelo', 'Ensayo'];
const SEGUNDOS = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce'];
const MATERIAS = ['Español', 'Matemáticas', 'Ciencias', 'Historia', 'Inglés', 'Artes'] as const;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const fechaMas = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaIso = (f: string) => { const d = new Date(`${f}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

/** UUID estable (formato v4) derivado de una clave: el mismo dato siempre tiene el mismo id. */
function idEstable(clave: string): string {
  const h = createHash('sha256').update(`DEMO-001:${clave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Secuencia pseudoaleatoria con semilla (mulberry32): reproducible. */
function aleatorio(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Fila = Record<string, unknown> & { id: string };

export function generarPiloto(op: OpcionesPiloto = {}): DatosPiloto {
  const escala = Math.min(1, Math.max(0.1, op.escala ?? 1));
  const semanas = Math.min(8, Math.max(1, op.semanas ?? 3));
  const hoy = op.hoy ?? '2026-11-02';
  const porGrupo = Math.min(60, Math.max(5, op.alumnosPorGrupo ?? 50));
  const azar = aleatorio(20261102);
  const ahora = `${hoy}T12:00:00.000Z`;
  const m = (clave: string) => ({ id: idEstable(clave), creadoEn: ahora, actualizadoEn: ahora, version: 1 });
  const d: Record<string, Fila[]> = Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, []]));
  const agregar = (t: string, f: Fila) => { d[t]!.push(f); return f; };

  // ---------- Escuela, ciclo, turnos, jornadas, periodos y recesos ----------
  const escuela = agregar('escuelas', {
    ...m('escuela'), nombre: ESCUELA_DEMO.nombre, nombreCorto: ESCUELA_DEMO.identificador, cct: null, nivel: 'secundaria', entidad: null,
    localidad: 'Localidad ficticia', zonaEscolar: null, sector: null, domicilio: 'Domicilio ficticio s/n (DEMOSTRACIÓN)', telefono: null, correo: null, logotipo: null,
    demostracion: true,
  });
  const E = { escuelaId: escuela.id };
  const ciclo = agregar('ciclos', { ...m('ciclo'), ...E, nombre: 'DEMO 2026-2027', fechaInicio: fechaMas(hoy, -70), fechaFin: fechaMas(hoy, 230), estado: 'activo' });
  const C = { ...E, cicloEscolarId: ciclo.id };
  const grados = [1, 2, 3].map((n) => agregar('grados', { ...m(`grado-${n}`), ...C, numero: n, nombre: ['Primer', 'Segundo', 'Tercer'][n - 1] + ' grado' }));

  // Matutino: 6 × 50 min; receso de 20 min tras el 3.º. Vespertino: 5 × 45 min + 1 × 60 min (taller); receso de 20 min.
  const config = [
    { nombre: 'Matutino', inicio: 7 * 60, duraciones: [50, 50, 50, 50, 50, 50], receso: { tras: 3, min: 20 } },
    { nombre: 'Vespertino', inicio: 14 * 60, duraciones: [45, 45, 45, 45, 45, 60], receso: { tras: 3, min: 20 } },
  ];
  const turnos = config.map((c, t) => {
    const turno = agregar('turnos', { ...m(`turno-${t}`), ...C, nombre: c.nombre });
    let reloj = c.inicio;
    const periodos: Fila[] = [];
    let receso: Fila | null = null;
    c.duraciones.forEach((dur, p) => {
      if (p === c.receso.tras) { receso = { ...m(`receso-${t}`), ...C, jornadaId: '', nombre: 'Receso', horaInicio: hhmm(reloj), horaFin: hhmm(reloj + c.receso.min) }; reloj += c.receso.min; }
      periodos.push({ ...m(`periodo-${t}-${p}`), ...C, jornadaId: '', nombre: `Módulo ${p + 1}`, horaInicio: hhmm(reloj), horaFin: hhmm(reloj + dur) });
      reloj += dur;
    });
    const jornada = agregar('jornadas', { ...m(`jornada-${t}`), ...C, turnoId: turno.id, horaInicio: hhmm(c.inicio), horaFin: hhmm(reloj), dias: [1, 2, 3, 4, 5] });
    for (const p of periodos) { p.jornadaId = jornada.id; agregar('periodos', p); }
    if (receso) { (receso as Fila).jornadaId = jornada.id; agregar('recesos', receso); }
    return { turno, periodos };
  });

  // ---------- Materias (6 frente a grupo) y SE ----------
  const materias = MATERIAS.map((nombre, i) => agregar('materias', { ...m(`materia-${i}`), ...C, nombre, abreviatura: nombre.slice(0, 3).toUpperCase(), tipo: 'materia', activo: true }));
  agregar('materias', { ...m('materia-se'), ...C, nombre: 'Servicio escolar', abreviatura: 'SE', tipo: 'servicio', activo: true });

  // ---------- Grupos: gpt por turno, grado = i % 3, letras únicas por grado ----------
  const gpt = Math.max(1, Math.round(15 * escala));
  const bloques = Math.ceil(gpt / 6);
  const letraPorGrado = [0, 0, 0];
  const grupos: { g: Fila; t: number; i: number; grado: number }[] = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < gpt; i++) {
    const gr = i % 3;
    const nombre = String.fromCharCode(65 + letraPorGrado[gr]!++);
    const g = agregar('grupos', { ...m(`grupo-${t}-${i}`), ...C, gradoId: grados[gr]!.id, turnoId: turnos[t]!.turno.id, nombre, capacidad: porGrupo, activo: true });
    grupos.push({ g, t, i, grado: gr + 1 });
  }

  // ---------- Personal ----------
  // Docentes con clases: 6 materias × bloques × 2 turnos. El resto: docentes con SE, Prefectura, Dirección y apoyo.
  const nClase = 6 * bloques * 2;
  const total = Math.max(nClase + 12, Math.round(100 * escala));
  const nSE = Math.max(6, Math.round(total * 0.34));
  const funcionesApoyo: string[][] = [
    ['direccion'], ['subdireccion_academica'], ['prefectura'], ['prefectura'], ['prefectura', 'docente'], ['orientacion'],
    ['trabajo_social'], ['secretaria'], ['asistencia_escolar'], ['biblioteca'], ['udei'], ['otro'],
  ];
  const personal: Fila[] = [];
  for (let k = 0; k < total; k++) {
    const funciones = k < nClase ? (k % 9 === 4 ? ['docente', 'orientacion'] : ['docente'])
      : k < nClase + nSE ? ['docente']
        : (k - nClase - nSE) < funcionesApoyo.length ? funcionesApoyo[k - nClase - nSE]! : [['secretaria'], ['asistencia_escolar'], ['prefectura'], ['biblioteca'], ['otro']][(k - nClase - nSE) % 5]!;
    personal.push(agregar('personal', {
      ...m(`personal-${k}`), ...E, nombre: NOMBRES[k % 16], primerApellido: APELLIDOS[Math.floor(k / 16) % 8], segundoApellido: `${SEGUNDOS[Math.floor(k / 128) % 12]} ${k}`,
      numeroEmpleado: `DEMO-P-${String(k + 1).padStart(3, '0')}`, funciones, activo: true, observaciones: null,
    }));
  }
  const docentesClase = personal.slice(0, nClase);
  const docentesSE = personal.slice(nClase, nClase + nSE);
  const apoyo = personal.slice(nClase + nSE);
  const direccion = apoyo.find((p) => (p.funciones as string[]).includes('direccion'))!;
  const prefecto = apoyo.find((p) => (p.funciones as string[])[0] === 'prefectura')!;
  const docenteDe = (t: number, materia: number, bloque: number) => docentesClase[(t * bloques + bloque) * 6 + materia]!;

  // Adscripciones: turnos y materias que PUEDE impartir.
  docentesClase.forEach((p, k) => agregar('adscripciones', { ...m(`adscripcion-${k}`), ...C, personalId: p.id, turnoIds: [turnos[Math.floor(k / (6 * bloques))]!.turno.id], materiaIds: [materias[k % 6]!.id] }));
  docentesSE.forEach((p, j) => agregar('adscripciones', { ...m(`adscripcion-se-${j}`), ...C, personalId: p.id, turnoIds: [turnos[j % 2]!.turno.id], materiaIds: [materias[j % 6]!.id] }));

  // ---------- Horario: materia(g, día, periodo) = (periodo + g + día) mod 6 ----------
  // En cada (día, periodo) los grupos de un bloque tienen materias distintas, y cada bloque tiene
  // sus propios docentes: ningún docente queda en dos grupos a la misma hora.
  const sesiones = new Map<string, Fila[]>();
  for (const { g, t, i } of grupos) {
    const bloque = Math.floor(i / 6);
    const asignaciones = materias.map((mat, mi) => agregar('asignaciones', { ...m(`asignacion-${g.id}-${mi}`), ...C, grupoId: g.id, materiaId: mat.id, personalId: docenteDe(t, mi, bloque).id, horasSemana: 5 }));
    const lista: Fila[] = [];
    for (let dia = 1; dia <= 5; dia++) for (let p = 0; p < 6; p++) {
      const mi = (p + i + dia) % 6;
      const a = asignaciones[mi]!;
      lista.push(agregar('sesiones', { ...m(`sesion-${g.id}-${dia}-${p}`), ...C, asignacionId: a.id, grupoId: g.id, personalId: a.personalId, dia, periodoId: turnos[t]!.periodos[p]!.id, origen: 'manual' }));
    }
    sesiones.set(g.id, lista);
    agregar('confirmaciones', { ...m(`confirmacion-${g.id}`), ...C, grupoId: g.id });
    agregar('bitacora', { ...m(`bitacora-${g.id}`), ...C, entidad: 'horario_grupo', entidadId: g.id, accion: 'confirmar', motivo: null, detalle: 'Horario de demostración confirmado' });
  }

  // ---------- SE: cada docente de SE tiene 2 periodos al día en su turno; 1 de cada 6 queda SIN confirmar ----------
  const se: { p: Fila; t: number; periodos: number[]; confirmada: boolean }[] = [];
  docentesSE.forEach((p, j) => {
    const t = j % 2; const base = (Math.floor(j / 2) % 3) * 2; const confirmada = j % 6 !== 5;
    for (let dia = 1; dia <= 5; dia++) for (const pp of [base, base + 1]) {
      const per = turnos[t]!.periodos[pp]!;
      agregar('actividades', { ...m(`se-${j}-${dia}-${pp}`), ...C, tipo: 'servicio', personalId: p.id, grupoId: null, periodoId: per.id, dia, horaInicio: per.horaInicio, horaFin: per.horaFin, descripcion: 'Servicio escolar (SE)', confirmada, confirmadaEn: confirmada ? ahora : null, origen: 'manual' });
    }
    se.push({ p, t, periodos: [base, base + 1], confirmada });
  });

  // ---------- Alumnos ----------
  const alumnosDe = new Map<string, string[]>();
  let n = 0;
  for (const { g } of grupos) {
    const ids: string[] = [];
    for (let k = 0; k < porGrupo; k++, n++) {
      const al = agregar('alumnos', {
        ...m(`alumno-${n}`), ...E, nombre: NOMBRES[n % 16], primerApellido: APELLIDOS[Math.floor(n / 16) % 8], segundoApellido: `${SEGUNDOS[Math.floor(n / 128) % 12]} ${n}`,
        matricula: `DEMO-A-${String(n + 1).padStart(5, '0')}`, curp: null, observaciones: null,
      });
      ids.push(al.id);
      const ins = agregar('inscripciones', { ...m(`inscripcion-${n}`), ...C, alumnoId: al.id, turnoId: g.turnoId, gradoId: g.gradoId, grupoId: g.id, estado: 'inscrito', numeroLista: k + 1 });
      agregar('movimientos', { ...m(`movimiento-${n}`), ...C, alumnoId: al.id, inscripcionId: ins.id, tipo: 'alta', grupoAnteriorId: null, grupoNuevoId: g.id, motivo: null });
    }
    alumnosDe.set(g.id, ids);
  }

  // ---------- Asistencia: `semanas` de días hábiles ANTERIORES a hoy ----------
  const fechas: string[] = [];
  for (let k = 1; fechas.length < semanas * 5; k++) { const f = fechaMas(hoy, -k); if (diaIso(f) <= 5) fechas.push(f); }
  fechas.reverse();
  const periodoPorId = new Map(turnos.flatMap((t) => t.periodos.map((p) => [p.id, p] as const)));
  let salidas = 0; let correcciones = 0;
  for (const { g } of grupos) {
    const alumnos = alumnosDe.get(g.id)!;
    for (const f of fechas) {
      for (const s of sesiones.get(g.id)!.filter((x) => x.dia === diaIso(f))) {
        const per = periodoPorId.get(s.periodoId as string)!;
        const corregido = azar() < 0.02;
        const pase = agregar('pases', { ...m(`pase-${s.id}-${f}`), ...C, grupoId: g.id, sesionId: s.id, asignacionId: s.asignacionId, personalId: s.personalId, fecha: f, horaInicio: per.horaInicio, horaFin: per.horaFin, guardadoEn: `${f}T${per.horaInicio}:00.000Z`, correcciones: corregido ? 1 : 0 });
        const presentes: string[] = [];
        alumnos.forEach((al, idx) => {
          const x = azar();
          const marca = x < 0.04 ? 'F' : x < 0.10 ? 'R' : 'P';
          const llegada = marca === 'R' ? hhmm(minutos(per.horaInicio as string) + 3 + Math.floor(azar() * 12)) : null;
          agregar('asistencias', { ...m(`asistencia-${pase.id}-${idx}`), ...C, paseId: pase.id, grupoId: g.id, alumnoId: al, fecha: f, marca, horaLlegada: llegada });
          if (marca === 'P') presentes.push(al);
          if (corregido && idx === 0) {
            // Corrección registrada: el alumno 1 llegó tarde (F → R) y queda en el historial.
            const a = d.asistencias!.at(-1)!; a.marca = 'R'; a.horaLlegada = hhmm(minutos(per.horaInicio as string) + 8);
            agregar('cambiosAsistencia', { ...m(`cambio-${pase.id}`), ...C, paseId: pase.id, grupoId: g.id, alumnoId: al, marcaAnterior: 'F', marcaNueva: 'R', llegadaAnterior: null, llegadaNueva: a.horaLlegada, personalId: s.personalId });
            correcciones++;
          }
        });
        // Salidas al baño (sólo de alumnos presentes, nunca de quien tiene falta), siempre con regreso.
        if (azar() < 0.2 && presentes.length) {
          const al = presentes[Math.floor(azar() * presentes.length)]!;
          const sal = minutos(per.horaInicio as string) + 10 + Math.floor(azar() * 20);
          agregar('salidas', { ...m(`salida-${pase.id}`), ...C, grupoId: g.id, alumnoId: al, sesionId: s.id, fecha: f, salida: hhmm(sal), regreso: hhmm(sal + 3 + Math.floor(azar() * 5)), personalId: s.personalId, periodoId: s.periodoId });
          salidas++;
        }
      }
    }
  }

  // ---------- Reportes breves ----------
  const tiposReporte = ['reconocimiento', 'academico', 'conducta', 'otro'] as const;
  for (let r = 0; r < Math.round(200 * escala); r++) {
    const { g } = grupos[r % grupos.length]!;
    const s = sesiones.get(g.id)!.find((x) => x.dia === diaIso(fechas[r % fechas.length]!))!;
    agregar('reportes', { ...m(`reporte-${r}`), ...C, grupoId: g.id, alumnoId: alumnosDe.get(g.id)![r % porGrupo], personalId: s.personalId, sesionId: s.id, fecha: fechas[r % fechas.length], tipo: tiposReporte[r % 4], texto: `Reporte FICTICIO de demostración n.º ${r + 1}.`, hora: periodoPorId.get(s.periodoId as string)!.horaInicio, estado: r % 3 === 0 ? 'atendida' : 'abierta' });
  }

  // ---------- Banco de actividades ----------
  const banco = MATERIAS.map((nombre, i) => agregar('bancoActividades', { ...m(`banco-${i}`), ...C, materiaId: materias[i]!.id, gradoId: grados[i % 3]!.id, titulo: `Actividad de ${nombre} (demostración)`, descripcion: `Lectura y ejercicios de ${nombre} para cubrir una clase. Material ficticio.`, archivo: null, fecha: fechas[0], responsable: 'Prefectura (DEMOSTRACIÓN)', estado: 'validada' }));

  // ---------- Incidencias del personal y coberturas (pasadas) ----------
  let orden = Date.parse(`${fechas[0]}T08:00:00Z`) * 1000;
  const historial = (entidad: string, entidadId: string, accion: string, detalle: string | null, quien: string | null) =>
    agregar('bitacoraPrefectura', { ...m(`historial-${entidadId}-${accion}`), ...C, entidad, entidadId, accion, detalle, personalId: quien, orden: orden++ });
  for (let k = 0; k < Math.min(fechas.length, 12); k++) {
    const f = fechas[k]!;
    const ausente = docentesClase[(k * 7) % docentesClase.length]!;
    const tipo = (['falta', 'retardo', 'permiso', 'falta'] as const)[k % 4];
    const estado = k % 6 === 5 ? 'descartada' : k % 4 === 2 ? 'reportada' : 'confirmada';
    const inc = agregar('incidenciasPersonal', { ...m(`incidencia-${k}`), ...C, personalId: ausente.id, fecha: f, tipo, tipoOtro: null, alcance: 'jornada', periodoIds: [], observaciones: 'Incidencia FICTICIA de demostración.', estado, registradaPor: prefecto.id, validadaPor: estado === 'reportada' ? null : direccion.id, validadaEn: estado === 'reportada' ? null : `${f}T09:00:00.000Z`, motivoValidacion: estado === 'descartada' ? 'Se presentó (dato ficticio).' : null });
    historial('incidencia', inc.id, 'reportar', `Incidencia de demostración del ${f}`, prefecto.id);
    if (estado !== 'reportada') historial('incidencia', inc.id, estado === 'confirmada' ? 'confirmar' : 'descartar', null, direccion.id);
    if (estado !== 'confirmada' || tipo !== 'falta') continue;
    // Coberturas de sus clases de ese día: asignadas a un docente con SE CONFIRMADA en ese periodo.
    for (const { g, t } of grupos) {
      for (const s of sesiones.get(g.id)!.filter((x) => x.personalId === ausente.id && x.dia === diaIso(f))) {
        const pp = turnos[t]!.periodos.findIndex((x) => x.id === s.periodoId);
        const cubre = se.find((x) => x.confirmada && x.t === t && x.periodos.includes(pp));
        const cob = agregar('coberturas', {
          ...m(`cobertura-${s.id}-${f}`), ...C, sesionId: s.id, fecha: f, grupoId: g.id, periodoId: s.periodoId, docenteAusenteId: ausente.id, incidenciaId: inc.id,
          propuestoIds: cubre ? [cubre.p.id] : [], asignadoId: cubre?.p.id ?? null, actividadId: banco[pp % banco.length]!.id, actividadTexto: null,
          autorizadoPor: cubre ? 'Dirección (DEMOSTRACIÓN)' : null, autorizadoEn: cubre ? `${f}T09:30:00.000Z` : null, estado: cubre ? 'realizada' : 'sin_docente', observaciones: null,
        });
        if (cubre) { historial('cobertura', cob.id, 'proponer', null, prefecto.id); historial('cobertura', cob.id, 'asignar', 'autorizó: Dirección (DEMOSTRACIÓN)', prefecto.id); historial('cobertura', cob.id, 'registrar realizada', null, prefecto.id); }
        else historial('cobertura', cob.id, 'confirmar sin docente', 'Sin SE disponible (dato ficticio)', prefecto.id);
      }
    }
  }

  // ---------- Sobre del respaldo (misma huella que la app) ----------
  for (const t of TABLAS_RESPALDO) d[t]!.sort((a, b) => a.id.localeCompare(b.id));
  const conteos = Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, d[t]!.length]));
  const huella = createHash('sha256').update(JSON.stringify(d)).digest('hex');
  const respaldo = {
    formato: 'gestion-escolar-respaldo', versionFormato: 2, esquema: 13, creadoEn: ahora,
    escuelas: [{ id: escuela.id, nombre: escuela.nombre }], ciclos: [{ id: ciclo.id, escuelaId: escuela.id, nombre: ciclo.nombre }],
    conteos, huella, datos: d,
  };

  // ---------- Referencias para las pruebas ----------
  const g0 = grupos[0]!;
  const sesionHoy = sesiones.get(g0.g.id)!.find((s) => s.dia === Math.min(diaIso(hoy), 5) && s.periodoId === turnos[0]!.periodos[0]!.id)!;
  const docente = personal.find((p) => p.id === sesionHoy.personalId)!;
  // Otro docente del bloque 0 del matutino (imparte otra materia, también con clases hoy).
  const ausente = docenteDe(0, (Math.min(diaIso(hoy), 5) + 1) % 6, 0);
  const nombre = (p: Fila) => `${p.nombre} ${p.primerApellido} ${p.segundoApellido}`;
  const filas = ['Apellido paterno;Apellido materno;Nombre;Grado;Grupo;Matrícula'];
  for (let k = 0; k < grupos.length * porGrupo; k++) {
    const x = grupos[k % grupos.length]!;
    filas.push(`Importado;Demo ${k};${NOMBRES[k % 16]};${x.grado};${x.g.nombre};DEMO-I-${String(k + 1).padStart(5, '0')}`);
  }
  void salidas; void correcciones;
  return {
    contenido: JSON.stringify(respaldo), conteos, huella, escuelaId: escuela.id, cicloId: ciclo.id, hoy,
    turnos: turnos.map((t) => ({ id: t.turno.id, nombre: t.turno.nombre as string, periodos: t.periodos.map((p) => ({ id: p.id, horaInicio: p.horaInicio as string, horaFin: p.horaFin as string })) })),
    grupos: grupos.map((x) => ({ id: x.g.id, nombre: x.g.nombre as string, grado: x.grado, turno: turnos[x.t]!.turno.nombre as string })),
    docente: { id: docente.id, nombre: nombre(docente), sesionHoyId: sesionHoy.id, grupoId: g0.g.id },
    docenteAusente: { id: ausente.id, nombre: nombre(ausente) },
    prefectura: { id: prefecto.id, nombre: nombre(prefecto) },
    direccion: { id: direccion.id, nombre: nombre(direccion) },
    csvAlumnosNuevos: filas.join('\n'),
  };
}
