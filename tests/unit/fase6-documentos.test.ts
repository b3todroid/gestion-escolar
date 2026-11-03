/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Dexie } from 'dexie';
import { createWorker } from 'tesseract.js';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import type { Servicios } from '../../src/services';
import { abrirPdf, type LibreriaPdf } from '../../src/lectores/pdf';
import { ErrorArchivo } from '../../src/domain/importacion/zip';
import {
  ENCABEZADOS_CANONICOS, convertirLista, convertirSabana, detectarEstructura, marcarInciertas, palabrasAFragmentos,
  reconstruirTabla, separarCelda, type Fragmento, type PalabraReconocida,
} from '../../src/domain/importacion/documento';
import { sugerirMapeo } from '../../src/domain/importacion/mapeo';
import { mapeoDesdePlantilla } from '../../src/services/plantillasImportacion';
import type { EntradaAsistente } from '../../src/validators/esquemas';
import { nuevoEntorno } from './ayudantes';

// Fase 6 — PDF, OCR y horarios. Documentos y personas FICTICIOS (scripts/generar_pdf_prueba.py).
const ENTRADA: EntradaAsistente = {
  escuela: { nombre: 'Escuela Secundaria Ficticia 600', cct: '32ZZZ0600A', nivel: 'secundaria', entidad: '32', localidad: 'Municipio Ejemplo' },
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 2, capacidad: null },
};
const pdf = (n: string) => { const b = readFileSync(`tests/fixtures/pdf/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const legacy = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as LibreriaPdf;
const CAT = { materias: ['Matemáticas', 'Español'], docentes: ['Docente Ficticio Uno', 'Docente Ficticia Dos'], grupos: ['1° A', '1° B'] };

async function leer(n: string) {
  const doc = await abrirPdf(pdf(n), await legacy());
  const p = await doc.leerPagina(1);
  await doc.cerrar();
  return p;
}

let s: Servicios; let db: BaseDatosEscolar; let cicloId: string; let escuelaId: string;
beforeEach(async () => {
  const e = nuevoEntorno(); s = e.s; db = e.db;
  const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
  cicloId = r.ciclo.id; escuelaId = r.escuela.id;
  await s.materias.crearVarias(cicloId, 'Matemáticas\nEspañol');
  await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticio', segundoApellido: 'Uno', funciones: ['docente'] });
  await s.personal.crear(escuelaId, { nombre: 'Docente', primerApellido: 'Ficticia', segundoApellido: 'Dos', funciones: ['docente'] });
});

/** Importa filas canónicas con el mismo servicio (y validaciones) que Excel/CSV. */
const analizar = (tabla: string[][]) => s.importacion.analizarMapeado(cicloId, tabla.slice(1), sugerirMapeo(tabla[0]!, 'horarios'), 2);

describe('1, 3 y 5. PDF digital: tabla con encabezados, horario por grupo', () => {
  it('extrae texto con posición, reconstruye la tabla y une las celdas de dos renglones', async () => {
    const p = await leer('horario-grupo-1A.pdf');
    expect(p.tieneTexto).toBe(true);
    const t = reconstruirTabla(p.fragmentos);
    expect(t.encabezados).toEqual(['Hora', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
    expect(t.titulo.join(' ')).toContain('Horario del grupo 1° A');
    expect(t.filas[0]!.map((c) => c.texto)).toEqual(['07:00-07:50', 'Matemáticas\nDocente Ficticio Uno', 'Español\nDocente Ficticia Dos', '', 'Matemáticas\nDocente Ficticio Uno', '']);
    expect(t.filas).toHaveLength(5);
  });

  it('detecta la estructura, convierte sin inventar (vacíos y receso se ignoran) e importa con validación', async () => {
    const t = reconstruirTabla((await leer('horario-grupo-1A.pdf')).fragmentos);
    const e = detectarEstructura(t);
    expect([e.estructura, e.grupo]).toEqual(['sabana_grupo', '1° A']);
    const c = convertirSabana(t, e, e.grupo!, CAT);
    expect(c.tabla[0]).toEqual(ENCABEZADOS_CANONICOS);
    expect(c.tabla.slice(1).map((f) => f.slice(0, 5))).toEqual([
      ['1° A', 'Lunes', '07:00-07:50', 'Matemáticas', 'Docente Ficticio Uno'],
      ['1° A', 'Martes', '07:00-07:50', 'Español', 'Docente Ficticia Dos'],
      ['1° A', 'Jueves', '07:00-07:50', 'Matemáticas', 'Docente Ficticio Uno'],
      ['1° A', 'Lunes', '07:50-08:40', 'Español', 'Docente Ficticia Dos'],
      ['1° A', 'Miércoles', '07:50-08:40', 'Matemáticas', 'Docente Ficticio Uno'],
      ['1° A', 'Viernes', '08:40-09:30', 'Español', 'Docente Ficticia Dos'],
    ]);
    expect(c.ignoradas).toEqual({ vacias: 14, recesos: 5, servicio: 0 }); // celdas vacías: ignoradas, NUNCA horas SE
    expect(c.porRevisar).toEqual([]);
    expect(sugerirMapeo(c.tabla[0]!, 'horarios')).toEqual(['grupo', 'dia', 'periodo', 'materia', 'docente', null]);
    const a = await analizar(c.tabla);
    expect([a.nuevas, a.errores, a.conflictos, a.puedeImportar]).toEqual([6, 0, 0, true]);
    expect(await db.sesiones.count()).toBe(0); // la vista previa no guarda
    const r = await s.importacion.aplicarMapeado(cicloId, c.tabla.slice(1), sugerirMapeo(c.tabla[0]!, 'horarios'), { archivo: 'horario-grupo-1A.pdf', hoja: 'Página 1', huella: null }, 2);
    expect(r.clases).toBe(6);
  });
});

describe('4, 6 y 9. Horario por docente: conflictos, grupos inexistentes y duplicados', () => {
  it('detecta el docente del título, el choque con otro grupo y el grupo inexistente', async () => {
    const tA = reconstruirTabla((await leer('horario-grupo-1A.pdf')).fragmentos);
    const cA = convertirSabana(tA, detectarEstructura(tA), '1° A', CAT);
    await s.importacion.aplicarMapeado(cicloId, cA.tabla.slice(1), sugerirMapeo(cA.tabla[0]!, 'horarios'), { archivo: 'a.pdf', hoja: null, huella: null }, 2);

    const t = reconstruirTabla((await leer('horario-docente-uno.pdf')).fragmentos);
    const e = detectarEstructura(t);
    expect([e.estructura, e.docente]).toEqual(['sabana_docente', 'Docente Ficticio Uno']);
    const c = convertirSabana(t, e, e.docente!, CAT);
    expect(c.tabla.slice(1).map((f) => f.slice(0, 5))).toEqual([
      ['1° B', 'Lunes', '07:00-07:50', 'Matemáticas', 'Docente Ficticio Uno'],
      ['1° B', 'Martes', '07:50-08:40', 'Matemáticas', 'Docente Ficticio Uno'],
      ['3° Z', 'Jueves', '08:40-09:30', 'Matemáticas', 'Docente Ficticio Uno'],
    ]);
    const a = await analizar(c.tabla);
    expect(a.filas.map((f) => f.estado)).toEqual(['conflicto', 'nueva', 'error']);
    expect(a.filas[0]!.mensajes.join(' ')).toContain('ya tiene clase con 1° A');
    expect(a.filas[2]!.mensajes.join(' ')).toContain('No existe el grupo 3° Z');
    expect(a.puedeImportar).toBe(false); // todo o nada: no se guarda nada
    // 9. Duplicados: volver a importar el horario de 1° A no crea clases repetidas
    const otra = await analizar(cA.tabla);
    expect([otra.nuevas, otra.existentes]).toEqual([0, 6]);
  });
});

describe('7. Campos ambiguos', () => {
  it('no adivina: varias materias, celdas sin separador, grupos no reconocibles', () => {
    expect(separarCelda('Matemáticas\nDocente Ficticio Uno', CAT.materias, 'materia')).toEqual({ a: 'Matemáticas', b: 'Docente Ficticio Uno' });
    expect(separarCelda('Español - Docente Ficticia Dos', CAT.materias, 'materia')).toEqual({ a: 'Español', b: 'Docente Ficticia Dos' });
    expect(separarCelda('Matemáticas Docente Ficticio Uno', CAT.materias, 'materia')).toEqual({ a: 'Matemáticas', b: 'Docente Ficticio Uno' });
    expect(separarCelda('Matemáticas Español', CAT.materias, 'materia')).toMatchObject({ motivo: expect.stringContaining('varias materias') });
    expect(separarCelda('Taller de lectura Ficticio', CAT.materias, 'materia')).toMatchObject({ motivo: expect.stringContaining('No se puede distinguir') });
    expect(separarCelda('Grupo mixto Matemáticas', CAT.grupos, 'grupo')).toMatchObject({ motivo: expect.stringContaining('No se reconoce el grupo') });
    expect(separarCelda('1B Español', CAT.grupos, 'grupo')).toEqual({ a: '1° B', b: 'Español' });
  });

  it('una tabla con encabezados: materia ambigua y docente desconocido quedan como ERROR', async () => {
    const t = reconstruirTabla((await leer('horario-lista.pdf')).fragmentos);
    expect(t.encabezados).toEqual(['Grupo', 'Día', 'Periodo', 'Materia', 'Docente']);
    expect(detectarEstructura(t).estructura).toBe('lista');
    const c = convertirLista(t);
    const a = await analizar(c.tabla);
    expect(a.filas.map((f) => f.estado)).toEqual(['nueva', 'error', 'error']);
    expect(a.filas[1]!.mensajes.join(' ')).toContain('«Matemáticas Español» no está registrada');
    expect(a.filas[2]!.mensajes.join(' ')).toContain('No se encontró al docente «Docente Inexistente»');
  });

  it('las celdas inciertas de una sábana se convierten en filas incompletas (ERROR) para revisar', () => {
    const t = { titulo: [], encabezados: ['Hora', 'Lunes', 'Martes'], avisos: [], filas: [[
      { texto: '07:00-07:50', confianza: 0.95, ambigua: false },
      { texto: 'Españo1\nDocente Ficticia Dos', confianza: 0.41, ambigua: false },
      { texto: '', confianza: null, ambigua: false },
    ]] };
    const m = marcarInciertas(t, 0.75);
    expect(m.filas[0]![1]).toMatchObject({ ambigua: true, motivo: 'Confianza 41 %' });
    const c = convertirSabana(m, detectarEstructura(m), '1° B', CAT);
    expect(c.porRevisar).toHaveLength(1);
    expect(c.tabla[1]!.slice(0, 5)).toEqual(['1° B', 'Lunes', '07:00-07:50', '', '']);
  });
});

describe('2. PDF escaneado y OCR local', () => {
  it('detecta que no tiene texto digital', async () => {
    const p = await leer('horario-escaneado-1B.pdf');
    expect([p.tieneTexto, p.fragmentos.length]).toEqual([false, 0]);
  });

  it('el OCR (Tesseract, idioma local) reconstruye la tabla; descarta trazos y marca lo incierto', async () => {
    const w = await createWorker('spa', 1, { langPath: `${process.cwd()}/node_modules/@tesseract.js-data/spa/4.0.0_best_int`, cachePath: `${process.cwd()}/node_modules/.cache/tess-prueba`, gzip: true });
    await w.setParameters({ tessedit_pageseg_mode: '11' as never, preserve_interword_spaces: '1' });
    const r = await w.recognize(`${process.cwd()}/tests/fixtures/pdf/horario-escaneado-1B.png`, {}, { blocks: true });
    await w.terminate();
    const palabras: PalabraReconocida[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) palabras.push(...(l.words as PalabraReconocida[]));
    const { fragmentos, descartadas } = palabrasAFragmentos(palabras);
    expect(descartadas).toBeGreaterThan(0); // líneas de la tabla leídas como «texto»
    const t = marcarInciertas(reconstruirTabla(fragmentos), 0.75);
    expect(t.encabezados).toEqual(['Hora', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
    const e = detectarEstructura(t);
    expect(e.estructura).toBe('sabana_grupo');
    // El «1°» del título se lee mal: el grupo NO se adivina; la persona lo elige.
    expect(e.grupo).toBeNull();
    const c = convertirSabana(t, e, '1° B', CAT);
    expect(c.tabla.slice(1).map((f) => f.slice(0, 5))).toEqual([
      ['1° B', 'Lunes', '07:00-07:50', 'Español', 'Docente Ficticia Dos'],
      ['1° B', 'Miércoles', '08:40-09:30', 'Español', 'Docente Ficticia Dos'],
    ]);
    expect(fragmentos.every((f) => f.confianza !== null)).toBe(true);
  }, 60_000);
});

describe('Archivos dañados, límites y plantillas', () => {
  it('rechaza un PDF dañado o que no es PDF', async () => {
    await expect(abrirPdf(pdf('danado.pdf'), await legacy())).rejects.toBeInstanceOf(ErrorArchivo);
    await expect(abrirPdf(new TextEncoder().encode('no soy un pdf').buffer as ArrayBuffer, await legacy())).rejects.toThrow('no es un PDF');
  });

  it('la reconstrucción no inventa columnas cuando no hay encabezados', () => {
    const f = (texto: string, x: number, y: number): Fragmento => ({ texto, x, y, ancho: texto.length * 5, alto: 9, confianza: null });
    const t = reconstruirTabla([f('1° A', 40, 100), f('Lunes', 120, 100), f('Matemáticas', 200, 100), f('1° B', 40, 130), f('Martes', 120, 130), f('Español', 200, 130)]);
    expect(t.encabezados).toBeNull();
    expect(t.avisos[0]).toContain('No se encontró una fila de encabezados');
    expect(t.filas.map((x) => x.map((c) => c.texto))).toEqual([['1° A', 'Lunes', 'Matemáticas'], ['1° B', 'Martes', 'Español']]);
  });

  it('plantillas por escuela: se guardan, se reutilizan por nombre de encabezado y viajan en el respaldo', async () => {
    const p = await s.plantillas.guardar(escuelaId, { nombre: 'Horario por docente (formato dirección)', tipo: 'horarios', estructura: 'sabana_docente', columnas: [{ encabezado: 'Gpo.', campo: 'grupo' }, { encabezado: 'Asignatura', campo: 'materia' }], umbralConfianza: 0.8 });
    // Mismo nombre: actualiza, no duplica
    await s.plantillas.guardar(escuelaId, { ...p, umbralConfianza: 0.7 });
    expect(await s.plantillas.listar(escuelaId, 'horarios')).toHaveLength(1);
    expect(mapeoDesdePlantilla(p, ['ASIGNATURA', 'Otra', 'gpo.'])).toEqual(['materia', null, 'grupo']);
    await expect(s.plantillas.guardar(escuelaId, { ...p, nombre: 'x' })).rejects.toThrow();
    const j = JSON.parse((await s.respaldos.exportar([escuelaId])).contenido);
    expect(j.datos.plantillasImportacion).toHaveLength(1);
  });
});

describe('10. Conservación de datos existentes', () => {
  it('la migración v8 → v9 sólo agrega la tabla de plantillas', async () => {
    const nombre = `mig9-${Date.now()}`;
    const v = new Dexie(nombre);
    v.version(1).stores({ escuelas: 'id, cct', ciclosEscolares: 'id, escuelaId, [escuelaId+estado]', turnos: 'id, cicloEscolarId, escuelaId', jornadas: 'id, &turnoId, cicloEscolarId', periodos: 'id, jornadaId, cicloEscolarId', recesos: 'id, jornadaId, cicloEscolarId', grados: 'id, cicloEscolarId, [cicloEscolarId+numero]', grupos: 'id, cicloEscolarId, gradoId, turnoId' });
    v.version(2).stores({ personal: 'id, escuelaId', materias: 'id, cicloEscolarId, escuelaId', asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId', sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId' });
    v.version(3).stores({ actividades: 'id, cicloEscolarId, personalId, grupoId', excepciones: 'id, cicloEscolarId, personalId', confirmaciones: 'id, &grupoId, cicloEscolarId', bitacora: 'id, cicloEscolarId, entidadId' });
    v.version(4).stores({ alumnos: 'id, grupoId, cicloEscolarId, escuelaId', pases: 'id, &[sesionId+fecha], grupoId, personalId, cicloEscolarId', asistencias: 'id, paseId, alumnoId, grupoId', salidas: 'id, alumnoId, grupoId, sesionId, cicloEscolarId', reportes: 'id, alumnoId, grupoId, cicloEscolarId', ajustes: 'id' });
    v.version(5).stores({});
    v.version(6).stores({ alumnos: 'id, escuelaId', inscripciones: 'id, alumnoId, cicloEscolarId, grupoId, escuelaId, &[alumnoId+cicloEscolarId]', movimientos: 'id, alumnoId, cicloEscolarId', adscripciones: 'id, personalId, cicloEscolarId, &[personalId+cicloEscolarId]', importaciones: 'id, escuelaId, cicloEscolarId' });
    v.version(7).stores({});
    v.version(8).stores({ cambiosAsistencia: 'id, paseId, alumnoId, cicloEscolarId' });
    const m = { creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '2026-01-01T00:00:00Z', version: 1, escuelaId: 'e1', cicloEscolarId: 'c1' };
    await v.table('sesiones').add({ ...m, id: 's1', asignacionId: 'a1', grupoId: 'g1', personalId: 'p1', dia: 1, periodoId: 'pe1', origen: 'importacion' });
    await v.table('cambiosAsistencia').add({ ...m, id: 'c1', paseId: 'pa1', grupoId: 'g1', alumnoId: 'al1', marcaAnterior: 'F', marcaNueva: 'R', llegadaAnterior: null, llegadaNueva: '07:10', personalId: null });
    v.close();
    const v9 = new BaseDatosEscolar(nombre);
    await v9.open();
    expect(v9.verno).toBe(VERSION_ESQUEMA);
    expect(await v9.sesiones.get('s1')).toMatchObject({ origen: 'importacion' });
    expect(await v9.cambiosAsistencia.get('c1')).toMatchObject({ marcaNueva: 'R' });
    expect(await v9.plantillasImportacion.count()).toBe(0);
    v9.close();
  });
});
