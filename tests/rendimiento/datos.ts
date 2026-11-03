/**
 * Generador de datos FICTICIOS de volumen para la prueba de rendimiento (Fase 9):
 * 1 escuela · 3 turnos (7 periodos c/u) · 30 grupos · 100 trabajadores (70 con clases) ·
 * 1,500 alumnos · horario completo (35 clases por grupo a la semana, sin choques) ·
 * 3 semanas de asistencia. Produce un RESPALDO formato 2 válido (misma huella que la app).
 */
import { createHash, randomUUID } from 'node:crypto';
import { TABLAS_RESPALDO } from '../../src/validators/respaldo';

export interface DatosVolumen {
  contenido: string;
  escuelaId: string; cicloId: string; grupoMuestra: string; sesionHoy: string; hoy: string;
  conteos: Record<string, number>;
  csvAlumnos: string;
}

const NOMBRES = ['Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fer', 'Gabi', 'Hugo', 'Iris', 'Juan', 'Karla', 'Luis', 'Mara', 'Nico', 'Olga', 'Pablo'];
const APELLIDOS = ['Ficticio', 'Ejemplo', 'Prueba', 'Muestra', 'Demo', 'Simulado', 'Modelo', 'Patrón'];
const fechaMenos = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const diaIso = (f: string) => { const d = new Date(`${f}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function generarVolumen(hoy: string): DatosVolumen {
  const ahora = `${hoy}T12:00:00.000Z`;
  const m = () => ({ id: randomUUID(), creadoEn: ahora, actualizadoEn: ahora, version: 1 });
  const d: Record<string, Record<string, unknown>[]> = Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, []]));
  const escuela = { ...m(), nombre: 'Escuela Secundaria Ficticia de Volumen', nombreCorto: null, cct: '32ZZZ0777R', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo', zonaEscolar: null, sector: null, domicilio: null, telefono: null, correo: null, logotipo: null };
  d.escuelas!.push(escuela);
  const E = { escuelaId: escuela.id };
  const ciclo = { ...m(), ...E, nombre: '2026-2027', fechaInicio: fechaMenos(hoy, 70), fechaFin: fechaMenos(hoy, -230), estado: 'activo' };
  d.ciclos!.push(ciclo);
  const C = { ...E, cicloEscolarId: ciclo.id };
  const grados = [1, 2, 3].map((n) => ({ ...m(), ...C, numero: n, nombre: `Grado ${n}` }));
  d.grados!.push(...grados);
  const inicios = [7 * 60, 13 * 60 + 30, 20 * 60 - 10 - 6 * 50]; // matutino, vespertino, tarde-noche (sin traslapes)
  const turnos = ['Matutino', 'Vespertino', 'Nocturno'].map((nombre, t) => {
    const turno = { ...m(), ...C, nombre };
    const ini = inicios[t]!;
    const jornada = { ...m(), ...C, turnoId: turno.id, horaInicio: hhmm(ini), horaFin: hhmm(ini + 7 * 50), dias: [1, 2, 3, 4, 5] };
    const periodos = Array.from({ length: 7 }, (_, p) => ({ ...m(), ...C, jornadaId: jornada.id, nombre: `Módulo ${p + 1}`, horaInicio: hhmm(ini + p * 50), horaFin: hhmm(ini + (p + 1) * 50) }));
    d.turnos!.push(turno); d.jornadas!.push(jornada); d.periodos!.push(...periodos);
    return { turno, periodos };
  });
  const materias = ['Español', 'Matemáticas', 'Ciencias', 'Historia', 'Geografía', 'Inglés', 'Artes'].map((nombre) => ({ ...m(), ...C, nombre, abreviatura: nombre.slice(0, 3).toUpperCase(), tipo: 'materia', activo: true }));
  d.materias!.push(...materias);
  const personal = Array.from({ length: 100 }, (_, i) => ({ ...m(), ...E, nombre: NOMBRES[i % NOMBRES.length], primerApellido: `${APELLIDOS[i % APELLIDOS.length]}${i}`, segundoApellido: null, numeroEmpleado: `P-${1000 + i}`, funciones: i < 80 ? ['docente'] : i < 90 ? ['prefectura'] : ['secretaria'], activo: true, observaciones: null }));
  d.personal!.push(...personal);
  // 30 grupos: 10 por turno. Docente k = (posición i del grupo en su turno)*7 + materia → mismas horas en turnos distintos: sin choques.
  const letras = 'ABCDEFGHIJ';
  const grupos: { g: Record<string, unknown>; turno: number; i: number }[] = [];
  for (let t = 0; t < 3; t++) for (let i = 0; i < 10; i++) {
    const g = { ...m(), ...C, gradoId: grados[i % 3]!.id, turnoId: turnos[t]!.turno.id, nombre: letras[t * 3 + Math.floor(i / 3)] ?? letras[i], capacidad: 50, activo: true };
    grupos.push({ g, turno: t, i });
  }
  // Nombres únicos por grado: (grado, letra) sin repetir.
  const usados = new Set<string>();
  for (const x of grupos) {
    let k = 0; let nombre = '';
    do { nombre = `${String.fromCharCode(65 + k)}`; k++; } while (usados.has(`${x.g.gradoId}:${nombre}`));
    usados.add(`${x.g.gradoId}:${nombre}`); x.g.nombre = nombre;
    d.grupos!.push(x.g);
  }
  const sesionesPorGrupo = new Map<string, Record<string, unknown>[]>();
  for (const { g, turno, i } of grupos) {
    const lista: Record<string, unknown>[] = [];
    materias.forEach((mat, mi) => {
      const docente = personal[i * 7 + mi]!;
      const a = { ...m(), ...C, grupoId: g.id, materiaId: mat.id, personalId: docente.id, horasSemana: 5 };
      d.asignaciones!.push(a);
      for (let dia = 1; dia <= 5; dia++) {
        const s = { ...m(), ...C, asignacionId: a.id, grupoId: g.id, personalId: docente.id, dia, periodoId: turnos[turno]!.periodos[mi]!.id, origen: 'manual' };
        d.sesiones!.push(s); lista.push(s);
      }
    });
    sesionesPorGrupo.set(g.id as string, lista);
    d.confirmaciones!.push({ ...m(), ...C, grupoId: g.id });
    d.bitacora!.push({ ...m(), ...C, entidad: 'horario_grupo', entidadId: g.id, accion: 'confirmar', motivo: null, detalle: null });
  }
  for (let i = 0; i < 80; i++) d.adscripciones!.push({ ...m(), ...C, personalId: personal[i]!.id, turnoIds: turnos.map((t) => t.turno.id), materiaIds: [materias[i % 7]!.id] });
  // 1,500 alumnos: 50 por grupo
  const alumnosPorGrupo = new Map<string, string[]>();
  let n = 0;
  for (const { g } of grupos) {
    const ids: string[] = [];
    for (let k = 0; k < 50; k++, n++) {
      const al = { ...m(), ...E, nombre: NOMBRES[n % NOMBRES.length], primerApellido: APELLIDOS[n % APELLIDOS.length], segundoApellido: `${APELLIDOS[(n * 3) % APELLIDOS.length]}${n}`, matricula: `MV-${10000 + n}`, curp: null, observaciones: null };
      d.alumnos!.push(al); ids.push(al.id);
      const ins = { ...m(), ...C, alumnoId: al.id, turnoId: g.turnoId, gradoId: g.gradoId, grupoId: g.id, estado: 'inscrito', numeroLista: k + 1 };
      d.inscripciones!.push(ins);
      d.movimientos!.push({ ...m(), ...C, alumnoId: al.id, inscripcionId: ins.id, tipo: 'alta', grupoAnteriorId: null, grupoNuevoId: g.id, motivo: null });
    }
    alumnosPorGrupo.set(g.id as string, ids);
  }
  // 3 semanas de asistencia (días hábiles anteriores a hoy)
  const fechas: string[] = [];
  for (let k = 1; fechas.length < 15; k++) { const f = fechaMenos(hoy, k); if (diaIso(f) <= 5) fechas.push(f); }
  let r = 0;
  for (const { g } of grupos) {
    const alumnos = alumnosPorGrupo.get(g.id as string)!;
    for (const f of fechas) {
      for (const s of sesionesPorGrupo.get(g.id as string)!.filter((x) => x.dia === diaIso(f))) {
        const pase = { ...m(), ...C, grupoId: g.id, sesionId: s.id, asignacionId: s.asignacionId, personalId: s.personalId, fecha: f, horaInicio: '07:00', horaFin: '07:50', guardadoEn: ahora, correcciones: 0 };
        d.pases!.push(pase);
        for (const al of alumnos) {
          r++;
          const marca = r % 23 === 0 ? 'F' : r % 17 === 0 ? 'R' : 'P';
          d.asistencias!.push({ ...m(), ...C, paseId: pase.id, grupoId: g.id, alumnoId: al, fecha: f, marca, horaLlegada: marca === 'R' ? '07:10' : null });
        }
        if (r % 7 === 0) d.salidas!.push({ ...m(), ...C, grupoId: g.id, alumnoId: alumnos[r % 50], sesionId: s.id, fecha: f, salida: '07:20', regreso: '07:26', personalId: s.personalId, periodoId: s.periodoId });
      }
    }
  }
  for (let i = 0; i < 300; i++) {
    const { g } = grupos[i % 30]!;
    d.reportes!.push({ ...m(), ...C, grupoId: g.id, alumnoId: alumnosPorGrupo.get(g.id as string)![i % 50], personalId: personal[i % 70]!.id, sesionId: null, fecha: fechas[i % 15], tipo: 'reconocimiento', texto: 'Reporte ficticio de volumen', hora: '08:00', estado: 'abierta' });
  }
  for (let i = 0; i < 20; i++) {
    const inc = { ...m(), ...C, personalId: personal[i]!.id, fecha: fechas[i % 15], tipo: 'retardo', tipoOtro: null, alcance: 'jornada', periodoIds: [], observaciones: null, estado: 'confirmada', registradaPor: personal[80]!.id, validadaPor: null, validadaEn: ahora, motivoValidacion: null };
    d.incidenciasPersonal!.push(inc);
    d.bitacoraPrefectura!.push({ ...m(), ...C, entidad: 'incidencia', entidadId: inc.id, accion: 'reportar', detalle: null, personalId: personal[80]!.id, orden: 1_700_000_000_000_000 + i });
  }
  for (const t of TABLAS_RESPALDO) d[t]!.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const conteos = Object.fromEntries(TABLAS_RESPALDO.map((t) => [t, d[t]!.length]));
  const huella = createHash('sha256').update(JSON.stringify(d)).digest('hex');
  const respaldo = {
    formato: 'gestion-escolar-respaldo', versionFormato: 2, esquema: 11, creadoEn: ahora,
    escuelas: [{ id: escuela.id, nombre: escuela.nombre }], ciclos: [{ id: ciclo.id, escuelaId: escuela.id, nombre: ciclo.nombre }],
    conteos, huella, datos: d,
  };
  // 1,500 alumnos NUEVOS para medir la importación (mismos grupos)
  const filas = ['Apellido paterno;Apellido materno;Nombre;Grado;Grupo;Matrícula'];
  let k = 0;
  for (const { g } of grupos) for (let j = 0; j < 50; j++, k++) {
    const grado = grados.find((x) => x.id === g.gradoId)!.numero;
    filas.push(`Importado${k};Volumen;${NOMBRES[k % NOMBRES.length]};${grado};${g.nombre};MI-${20000 + k}`);
  }
  const g0 = grupos[0]!.g;
  return {
    contenido: JSON.stringify(respaldo), escuelaId: escuela.id, cicloId: ciclo.id, grupoMuestra: g0.id as string,
    sesionHoy: (sesionesPorGrupo.get(g0.id as string)!.find((s) => s.dia === Math.min(diaIso(hoy), 5)) ?? sesionesPorGrupo.get(g0.id as string)![0]!).id as string,
    hoy, conteos, csvAlumnos: filas.join('\n'),
  };
}
