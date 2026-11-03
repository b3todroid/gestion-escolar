/**
 * Entidades federativas de México con su clave de dos dígitos (catálogo INEGI),
 * la misma con la que inicia la Clave de Centro de Trabajo (CCT).
 */
export const ENTIDADES = [
  ['01', 'Aguascalientes'], ['02', 'Baja California'], ['03', 'Baja California Sur'], ['04', 'Campeche'],
  ['05', 'Coahuila de Zaragoza'], ['06', 'Colima'], ['07', 'Chiapas'], ['08', 'Chihuahua'],
  ['09', 'Ciudad de México'], ['10', 'Durango'], ['11', 'Guanajuato'], ['12', 'Guerrero'],
  ['13', 'Hidalgo'], ['14', 'Jalisco'], ['15', 'México'], ['16', 'Michoacán de Ocampo'],
  ['17', 'Morelos'], ['18', 'Nayarit'], ['19', 'Nuevo León'], ['20', 'Oaxaca'],
  ['21', 'Puebla'], ['22', 'Querétaro'], ['23', 'Quintana Roo'], ['24', 'San Luis Potosí'],
  ['25', 'Sinaloa'], ['26', 'Sonora'], ['27', 'Tabasco'], ['28', 'Tamaulipas'],
  ['29', 'Tlaxcala'], ['30', 'Veracruz de Ignacio de la Llave'], ['31', 'Yucatán'], ['32', 'Zacatecas'],
] as const;

export type ClaveEntidad = (typeof ENTIDADES)[number][0];
export const CLAVES_ENTIDAD = ENTIDADES.map(([c]) => c) as unknown as readonly [ClaveEntidad, ...ClaveEntidad[]];

export function nombreEntidad(clave: string | null | undefined): string | null {
  return ENTIDADES.find(([c]) => c === clave)?.[1] ?? null;
}

/**
 * Sugerencias para secundaria (plan de estudios 2022, Nueva Escuela Mexicana).
 * Son sólo sugerencias: la escuela elige cuáles agregar y puede escribir las suyas.
 */
export const SUGERENCIAS_SECUNDARIA: { nombre: string; tipo: 'materia' | 'campo_formativo' | 'tutoria' | 'servicio' }[] = [
  { nombre: 'Lenguajes', tipo: 'campo_formativo' },
  { nombre: 'Saberes y Pensamiento Científico', tipo: 'campo_formativo' },
  { nombre: 'Ética, Naturaleza y Sociedades', tipo: 'campo_formativo' },
  { nombre: 'De lo Humano y lo Comunitario', tipo: 'campo_formativo' },
  { nombre: 'Español', tipo: 'materia' }, { nombre: 'Inglés', tipo: 'materia' }, { nombre: 'Artes', tipo: 'materia' },
  { nombre: 'Matemáticas', tipo: 'materia' }, { nombre: 'Biología', tipo: 'materia' }, { nombre: 'Física', tipo: 'materia' },
  { nombre: 'Química', tipo: 'materia' }, { nombre: 'Geografía', tipo: 'materia' }, { nombre: 'Historia', tipo: 'materia' },
  { nombre: 'Formación Cívica y Ética', tipo: 'materia' }, { nombre: 'Tecnología', tipo: 'materia' },
  { nombre: 'Educación Física', tipo: 'materia' }, { nombre: 'Tutoría', tipo: 'tutoria' },
  { nombre: 'Horas de servicio (SE)', tipo: 'servicio' },
];
