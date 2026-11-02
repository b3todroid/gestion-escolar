/** Códigos de error de negocio. La interfaz los traduce a mensajes comprensibles. */
export type CodigoError =
  | 'VALIDACION'
  | 'DUPLICADO'
  | 'NO_ENCONTRADO'
  | 'TRASLAPE'
  | 'FUERA_DE_JORNADA'
  | 'TIENE_DEPENDENCIAS'
  | 'ESTADO_NO_PERMITIDO'
  | 'CICLO_CERRADO'
  | 'ALMACENAMIENTO';

export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

export class ErrorDominio extends Error {
  readonly codigo: CodigoError;
  readonly campos: ErrorCampo[];

  constructor(codigo: CodigoError, mensaje: string, campos: ErrorCampo[] = []) {
    super(mensaje);
    this.name = 'ErrorDominio';
    this.codigo = codigo;
    this.campos = campos;
  }
}

export function esErrorDominio(e: unknown): e is ErrorDominio {
  return e instanceof ErrorDominio;
}
