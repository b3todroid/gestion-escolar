/** Fuente de tiempo inyectable (facilita pruebas deterministas). */
export type Reloj = () => string;
export const relojSistema: Reloj = () => new Date().toISOString();
