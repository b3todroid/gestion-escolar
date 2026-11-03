/**
 * Implementación en PostgreSQL de los MISMOS contratos de repositorio que usa la
 * aplicación (src/repositories/tipos.ts). Así el servidor ejecuta los servicios y las
 * reglas de negocio de la app sin copiarlas.
 * - Cada operación usa el cliente de la transacción en curso (AsyncLocalStorage):
 *   fuera de una transacción del servidor, falla (nunca escribe «suelto»).
 * - Nombres: campo camelCase ↔ columna snake_case del esquema `escolar`.
 * - Las políticas RLS se aplican porque la transacción corre con el rol `gestion_app`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { type Pool, type PoolClient } from 'pg';
import type { Metadatos } from '../../src/models';
import type { Repositorio, Repositorios, UnidadDeTrabajo } from '../../src/repositories/tipos';
import { ErrorDominio } from '../../src/domain/errores';

// Tipos de PostgreSQL → los mismos formatos que guarda la aplicación. Sólo para las consultas
// de datos escolares (no se cambian los valores por omisión de `pg` para el resto del servidor).
const parsers: Record<number, (v: string) => unknown> = {
  1082: (v) => v, // date → 'AAAA-MM-DD'
  1184: (v) => new Date(v).toISOString(), // timestamptz → ISO 8601
  1114: (v) => new Date(`${v}Z`).toISOString(), // timestamp
  20: (v) => Number(v), // bigint (p. ej. «orden») → número
};
export const TIPOS_ESCOLARES = {
  getTypeParser: ((oid: number, formato?: 'text' | 'binary') => parsers[oid] ?? pg.types.getTypeParser(oid, formato as 'text')) as typeof pg.types.getTypeParser,
};

/** Consulta con los tipos de la aplicación. */
export function consultar(c: PoolClient, text: string, values: unknown[] = []) {
  return c.query({ text, values, types: TIPOS_ESCOLARES });
}

const transaccion = new AsyncLocalStorage<PoolClient>();

export const aSnake = (s: string) => s.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
export const aCamel = (s: string) => s.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase());

/** Tabla del servidor para cada repositorio (mismos nombres que el respaldo). */
export const TABLAS_REPOSITORIO = [
  'escuelas', 'ciclos', 'turnos', 'jornadas', 'periodos', 'recesos', 'grados', 'grupos', 'personal', 'materias',
  'asignaciones', 'sesiones', 'actividades', 'excepciones', 'confirmaciones', 'bitacora', 'alumnos', 'pases',
  'asistencias', 'salidas', 'reportes', 'cambiosAsistencia', 'plantillasImportacion', 'incidenciasPersonal',
  'coberturas', 'bancoActividades', 'bitacoraPrefectura', 'adscripciones', 'inscripciones', 'movimientos', 'importaciones',
] as const satisfies readonly Exclude<keyof Repositorios, 'ajustes'>[];

export function clienteActual(): PoolClient {
  const c = transaccion.getStore();
  if (!c) throw new Error('Operación de datos fuera de una transacción del servidor.');
  return c;
}

/** Ejecuta `fn` dentro de una transacción con el cliente dado (ya en BEGIN). */
export function conCliente<R>(cliente: PoolClient, fn: () => Promise<R>): Promise<R> {
  return transaccion.run(cliente, fn);
}

type Columnas = Map<string, string>; // columna → tipo de dato

class RepositorioPg<T extends Metadatos> implements Repositorio<T> {
  private readonly tabla: string;
  private readonly columnas: Columnas;
  constructor(tabla: string, columnas: Columnas) {
    this.tabla = `escolar.${aSnake(tabla)}`;
    this.columnas = columnas;
  }

  private columna(campo: string): string {
    const c = aSnake(campo);
    if (!this.columnas.has(c)) throw new Error(`Campo desconocido «${campo}» en ${this.tabla}.`);
    return c;
  }

  private aFila(entidad: T): { columnas: string[]; valores: unknown[] } {
    const columnas: string[] = []; const valores: unknown[] = [];
    for (const [campo, valor] of Object.entries(entidad)) {
      const c = this.columna(campo);
      columnas.push(c);
      valores.push(this.columnas.get(c) === 'jsonb' && valor !== null && valor !== undefined ? JSON.stringify(valor) : valor ?? null);
    }
    return { columnas, valores };
  }

  private aEntidad(fila: Record<string, unknown>): T {
    const e: Record<string, unknown> = {};
    for (const [c, v] of Object.entries(fila)) e[aCamel(c)] = v;
    return e as T;
  }

  async obtener(id: string) {
    const { rows } = await consultar(clienteActual(), `SELECT * FROM ${this.tabla} WHERE id = $1`, [id]);
    return rows[0] ? this.aEntidad(rows[0]) : undefined;
  }
  async listarTodos() {
    const { rows } = await consultar(clienteActual(), `SELECT * FROM ${this.tabla}`);
    return rows.map((r) => this.aEntidad(r));
  }
  async listarPor<K extends keyof T & string>(campo: K, valor: T[K]) {
    const { rows } = await consultar(clienteActual(), `SELECT * FROM ${this.tabla} WHERE ${this.columna(campo)} = $1`, [valor]);
    return rows.map((r) => this.aEntidad(r));
  }
  async contarPor<K extends keyof T & string>(campo: K, valor: T[K]) {
    const { rows } = await consultar(clienteActual(), `SELECT count(*)::int AS n FROM ${this.tabla} WHERE ${this.columna(campo)} = $1`, [valor]);
    return (rows[0] as { n: number }).n;
  }
  async insertar(entidad: T) {
    const { columnas, valores } = this.aFila(entidad);
    await consultar(clienteActual(), `INSERT INTO ${this.tabla} (${columnas.join(', ')}) VALUES (${valores.map((_, i) => `$${i + 1}`).join(', ')})`, valores);
  }
  async insertarVarios(entidades: T[]) {
    for (const e of entidades) await this.insertar(e);
  }
  async actualizar(entidad: T) {
    const { columnas, valores } = this.aFila(entidad);
    const posId = columnas.indexOf('id');
    const asignaciones = columnas.map((c, i) => `${c} = $${i + 1}`).filter((_, i) => i !== posId);
    const r = await consultar(clienteActual(), `UPDATE ${this.tabla} SET ${asignaciones.join(', ')} WHERE id = $${posId + 1}`, valores);
    // Igual que IndexedDB (put): si no existe, se inserta. Si existe pero las políticas no lo dejan ver, el INSERT falla.
    if (r.rowCount === 0) await this.insertar(entidad);
  }
  async eliminar(id: string) {
    await consultar(clienteActual(), `DELETE FROM ${this.tabla} WHERE id = $1`, [id]);
  }
  async eliminarVarios(ids: string[]) {
    if (ids.length) await consultar(clienteActual(), `DELETE FROM ${this.tabla} WHERE id = ANY($1::uuid[])`, [ids]);
  }
}

/** El servidor no guarda preferencias de dispositivo. */
const ajustesNoDisponibles = new Proxy({}, { get: () => () => Promise.reject(new ErrorDominio('ESTADO_NO_PERMITIDO', 'Los ajustes del dispositivo no existen en el servidor.')) }) as Repositorios['ajustes'];

/** Lee los tipos de columna del esquema `escolar` (una vez al arrancar). */
export async function leerColumnas(bd: Pool): Promise<Map<string, Columnas>> {
  const { rows } = await bd.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'escolar'`);
  const m = new Map<string, Columnas>();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, new Map());
    m.get(r.table_name)!.set(r.column_name, r.data_type);
  }
  return m;
}

export function crearRepositoriosPg(columnas: Map<string, Columnas>): Repositorios {
  const repos: Partial<Record<keyof Repositorios, unknown>> = { ajustes: ajustesNoDisponibles };
  for (const t of TABLAS_REPOSITORIO) {
    const c = columnas.get(aSnake(t));
    if (!c) throw new Error(`Falta la tabla escolar.${aSnake(t)}: aplica las migraciones.`);
    repos[t] = new RepositorioPg(t, c);
  }
  return repos as Repositorios;
}

let contadorPuntos = 0;
/**
 * Unidad de trabajo del servidor: corre dentro de la transacción de la petición, en un
 * punto de guardado propio (todo o nada, igual que en IndexedDB). Si falla, se deshace
 * sólo lo de esta unidad y el error sigue su curso.
 */
export const unidadDeTrabajoPg: UnidadDeTrabajo = {
  async ejecutar(operacion) {
    const c = clienteActual();
    const punto = `uow_${++contadorPuntos}`;
    await c.query(`SAVEPOINT ${punto}`);
    try {
      const r = await operacion();
      await c.query(`RELEASE SAVEPOINT ${punto}`);
      return r;
    } catch (e) {
      await c.query(`ROLLBACK TO SAVEPOINT ${punto}`);
      throw e;
    }
  },
};
