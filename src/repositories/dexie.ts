import type { Table } from 'dexie';
import type { BaseDatosEscolar } from '../database/db';
import type { Metadatos } from '../models';
import { ErrorDominio, esErrorDominio } from '../domain/errores';
import type { Repositorio, Repositorios, UnidadDeTrabajo } from './tipos';

class RepositorioDexie<T extends Metadatos> implements Repositorio<T> {
  constructor(private readonly tabla: Table<T, string>) {}

  obtener(id: string) {
    return this.tabla.get(id);
  }
  listarTodos() {
    return this.tabla.toArray();
  }
  listarPor<K extends keyof T & string>(campo: K, valor: T[K]) {
    return this.tabla.where(campo).equals(valor as never).toArray();
  }
  contarPor<K extends keyof T & string>(campo: K, valor: T[K]) {
    return this.tabla.where(campo).equals(valor as never).count();
  }
  async insertar(entidad: T) {
    await this.tabla.add(entidad);
  }
  async actualizar(entidad: T) {
    await this.tabla.put(entidad);
  }
  async eliminar(id: string) {
    await this.tabla.delete(id);
  }
  async eliminarVarios(ids: string[]) {
    await this.tabla.bulkDelete(ids);
  }
}

export function crearRepositoriosDexie(db: BaseDatosEscolar): Repositorios {
  return {
    escuelas: new RepositorioDexie(db.escuelas),
    ciclos: new RepositorioDexie(db.ciclosEscolares),
    turnos: new RepositorioDexie(db.turnos),
    jornadas: new RepositorioDexie(db.jornadas),
    periodos: new RepositorioDexie(db.periodos),
    recesos: new RepositorioDexie(db.recesos),
    grados: new RepositorioDexie(db.grados),
    grupos: new RepositorioDexie(db.grupos),
  };
}

/** Traduce errores técnicos de IndexedDB a mensajes comprensibles. */
export function traducirErrorAlmacenamiento(e: unknown): ErrorDominio {
  if (esErrorDominio(e)) return e;
  const nombre = e instanceof Error ? e.name : '';
  if (nombre === 'QuotaExceededError' || /quota/i.test(String(e))) {
    return new ErrorDominio('ALMACENAMIENTO', 'No hay espacio suficiente en el dispositivo para guardar los datos.');
  }
  if (nombre === 'ConstraintError') {
    return new ErrorDominio('DUPLICADO', 'Ya existe un registro con esos datos.');
  }
  console.error(e);
  return new ErrorDominio('ALMACENAMIENTO', 'No se pudo guardar la información en este dispositivo. Intenta de nuevo.');
}

export function crearUnidadDeTrabajoDexie(db: BaseDatosEscolar): UnidadDeTrabajo {
  return {
    async ejecutar(operacion) {
      try {
        return await db.transaction('rw', db.tables, operacion);
      } catch (e) {
        throw traducirErrorAlmacenamiento(e);
      }
    },
  };
}
