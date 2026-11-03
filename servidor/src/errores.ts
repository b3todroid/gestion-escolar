/** Error de la API con estado HTTP, código estable y errores por campo (en español). */
export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  readonly campos: Record<string, string>;
  constructor(estado: number, codigo: string, mensaje: string, campos: Record<string, string> = {}) {
    super(mensaje);
    this.estado = estado; this.codigo = codigo; this.campos = campos;
  }
}
