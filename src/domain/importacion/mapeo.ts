/**
 * Mapeo de columnas para la importación de catálogos: campos por tipo, nombres
 * equivalentes de encabezados, detección de la fila de encabezados y sugerencias.
 * Todo es puro: no toca la base de datos.
 */
import { normalizarTexto } from '../texto';

export const TIPOS_IMPORTACION = ['alumnos', 'docentes', 'personal', 'materias', 'grupos'] as const;
export type TipoImportacion = (typeof TIPOS_IMPORTACION)[number];

export interface CampoImportable {
  clave: string;
  etiqueta: string;
  obligatorio?: boolean;
  alias: string[];
}

const PERSONA: CampoImportable[] = [
  { clave: 'nombre', etiqueta: 'Nombre(s)', alias: ['nombre', 'nombres', 'nombre s', 'nombre(s)'] },
  { clave: 'primerApellido', etiqueta: 'Primer apellido', alias: ['primer apellido', 'apellido paterno', 'paterno', 'ap paterno', 'apellido 1', 'apellido1', 'apellido'] },
  { clave: 'segundoApellido', etiqueta: 'Segundo apellido', alias: ['segundo apellido', 'apellido materno', 'materno', 'ap materno', 'apellido 2', 'apellido2'] },
  { clave: 'nombreCompleto', etiqueta: 'Nombre completo (una sola columna)', alias: ['nombre completo', 'alumno', 'alumna', 'nombre del alumno', 'docente', 'profesor', 'profesora', 'maestro', 'maestra', 'trabajador', 'nombre del docente', 'persona'] },
];

export const CAMPOS: Record<TipoImportacion, CampoImportable[]> = {
  alumnos: [
    ...PERSONA,
    { clave: 'grado', etiqueta: 'Grado', alias: ['grado', 'gr', 'gdo', 'año', 'ano'] },
    { clave: 'grupo', etiqueta: 'Grupo', alias: ['grupo', 'gpo', 'grp', 'seccion', 'sección'] },
    { clave: 'turno', etiqueta: 'Turno', alias: ['turno'] },
    { clave: 'numeroLista', etiqueta: 'Número de lista', alias: ['numero de lista', 'número de lista', 'no lista', 'no. lista', 'num lista', 'lista', 'n lista', 'no', 'num', 'número', 'numero'] },
    { clave: 'matricula', etiqueta: 'Matrícula', alias: ['matricula', 'matrícula', 'matricula institucional', 'no de control', 'numero de control', 'número de control'] },
    { clave: 'curp', etiqueta: 'CURP', alias: ['curp'] },
    { clave: 'observaciones', etiqueta: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
  ],
  docentes: [
    ...PERSONA,
    { clave: 'numeroEmpleado', etiqueta: 'Identificador interno', alias: ['identificador', 'id', 'numero de empleado', 'número de empleado', 'no empleado', 'clave', 'clave interna', 'rfc interno', 'expediente'] },
    { clave: 'materias', etiqueta: 'Materias que puede impartir', alias: ['materias', 'materia', 'asignatura', 'asignaturas', 'materias que imparte'] },
    { clave: 'turnos', etiqueta: 'Turnos', alias: ['turno', 'turnos'] },
    { clave: 'observaciones', etiqueta: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
  ],
  personal: [
    ...PERSONA,
    { clave: 'numeroEmpleado', etiqueta: 'Identificador interno', alias: ['identificador', 'id', 'numero de empleado', 'número de empleado', 'no empleado', 'clave', 'clave interna', 'expediente'] },
    { clave: 'funciones', etiqueta: 'Funciones', alias: ['funcion', 'función', 'funciones', 'puesto', 'cargo', 'area', 'área'] },
    { clave: 'turnos', etiqueta: 'Turnos', alias: ['turno', 'turnos'] },
    { clave: 'observaciones', etiqueta: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
  ],
  materias: [
    { clave: 'nombre', etiqueta: 'Nombre', obligatorio: true, alias: ['materia', 'asignatura', 'nombre', 'nombre de la materia', 'actividad'] },
    { clave: 'tipo', etiqueta: 'Tipo', alias: ['tipo', 'clase', 'categoria', 'categoría'] },
    { clave: 'abreviatura', etiqueta: 'Abreviatura', alias: ['abreviatura', 'clave', 'siglas', 'abrev'] },
  ],
  grupos: [
    { clave: 'grado', etiqueta: 'Grado', obligatorio: true, alias: ['grado', 'gr', 'gdo'] },
    { clave: 'grupo', etiqueta: 'Grupo', obligatorio: true, alias: ['grupo', 'gpo', 'grp', 'seccion', 'sección'] },
    { clave: 'turno', etiqueta: 'Turno', alias: ['turno'] },
    { clave: 'capacidad', etiqueta: 'Capacidad', alias: ['capacidad', 'cupo', 'lugares'] },
  ],
};

/** Mapeo: índice de columna → clave de campo (o null para ignorarla). */
export type Mapeo = (string | null)[];

const n = (t: string) => normalizarTexto(t).replace(/[.:#°º()]/g, ' ').replace(/\s+/g, ' ').trim();

function puntuar(encabezado: string, campo: CampoImportable): number {
  const e = n(encabezado);
  if (!e) return 0;
  if (campo.alias.some((a) => n(a) === e)) return 3;
  if (campo.alias.some((a) => n(a).length > 3 && (e.startsWith(n(a)) || e.endsWith(n(a))))) return 1;
  return 0;
}

/** Sugiere a qué campo corresponde cada columna; una columna por campo, la de mejor coincidencia. */
export function sugerirMapeo(encabezados: string[], tipo: TipoImportacion): Mapeo {
  const mapeo: Mapeo = encabezados.map(() => null);
  const candidatos: { col: number; clave: string; p: number }[] = [];
  encabezados.forEach((e, col) => { for (const c of CAMPOS[tipo]) { const p = puntuar(e, c); if (p) candidatos.push({ col, clave: c.clave, p }); } });
  candidatos.sort((a, b) => b.p - a.p || a.col - b.col);
  const usados = new Set<string>();
  for (const c of candidatos) if (!mapeo[c.col] && !usados.has(c.clave)) { mapeo[c.col] = c.clave; usados.add(c.clave); }
  return mapeo;
}

/**
 * Fila de encabezados: entre las primeras 10, la que más coincide con campos
 * conocidos (al menos 2); si ninguna, la primera fila no vacía.
 */
export function detectarEncabezado(filas: string[][], tipo: TipoImportacion): number {
  let mejor = -1; let mejorP = 1;
  filas.slice(0, 10).forEach((f, i) => {
    const p = sugerirMapeo(f, tipo).filter(Boolean).length;
    if (p > mejorP) { mejor = i; mejorP = p; }
  });
  if (mejor >= 0) return mejor;
  return Math.max(0, filas.findIndex((f) => f.some((c) => c.trim() !== '')));
}

/** Valida el mapeo antes de analizar: obligatorios presentes y sin campos repetidos. */
export function problemasMapeo(mapeo: Mapeo, tipo: TipoImportacion): string[] {
  const p: string[] = [];
  const usados = mapeo.filter((x): x is string => !!x);
  const repetidos = usados.filter((x, i) => usados.indexOf(x) !== i);
  for (const r of new Set(repetidos)) p.push(`«${CAMPOS[tipo].find((c) => c.clave === r)?.etiqueta}» está asignado a más de una columna.`);
  for (const c of CAMPOS[tipo].filter((x) => x.obligatorio)) if (!usados.includes(c.clave)) p.push(`Asigna una columna a «${c.etiqueta}».`);
  if (tipo === 'alumnos' || tipo === 'docentes' || tipo === 'personal') {
    const separado = usados.includes('nombre') && usados.includes('primerApellido');
    if (!separado && !usados.includes('nombreCompleto')) p.push('Asigna columnas a «Nombre(s)» y «Primer apellido», o a «Nombre completo».');
  }
  return p;
}

/** Valor de una celda según el mapeo. */
export function valor(fila: string[], mapeo: Mapeo, clave: string): string {
  const i = mapeo.indexOf(clave);
  // Espacios, tabuladores y saltos de línea internos se normalizan a un espacio.
  return i < 0 ? '' : (fila[i] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Separa «Apellidos, Nombre(s)» sólo si no hay ambigüedad (coma y uno o dos
 * apellidos). Sin coma, o con más palabras, devuelve null: no se adivina.
 */
export function separarNombreCompleto(texto: string): { nombre: string; primerApellido: string; segundoApellido: string | null } | null {
  const partes = texto.split(',');
  if (partes.length !== 2) return null;
  const ap = partes[0]!.trim().split(/\s+/).filter(Boolean);
  const nombre = partes[1]!.trim();
  if (!nombre || ap.length < 1 || ap.length > 2) return null;
  return { nombre, primerApellido: ap[0]!, segundoApellido: ap[1] ?? null };
}
