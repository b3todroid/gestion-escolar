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
