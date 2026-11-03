import { Dexie, type Table, type Transaction } from 'dexie';
import type { BaseDatosEscolar } from '../database/db';
import type { Metadatos } from '../models';
import { ErrorDominio, esErrorDominio } from '../domain/errores';
import type { AlmacenSincronizacion, CambioPendiente, EstadoPendiente, RegistroRemoto, Repositorio, Repositorios, ResultadoRemoto, UnidadDeTrabajo, VinculoServidor } from './tipos';
import { registrarError } from '../utils/registro';
import { nuevoId } from '../utils/id';

/** Nombre lógico (el del respaldo y el servidor) → tabla de IndexedDB. */
export const TABLA_LOCAL: Record<string, string> = {
  escuelas: 'escuelas', ciclos: 'ciclosEscolares', turnos: 'turnos', jornadas: 'jornadas', periodos: 'periodos', recesos: 'recesos',
  grados: 'grados', grupos: 'grupos', personal: 'personal', materias: 'materias', asignaciones: 'asignaciones', sesiones: 'sesiones',
  actividades: 'actividades', excepciones: 'excepciones', confirmaciones: 'confirmaciones', bitacora: 'bitacora', alumnos: 'alumnos',
  pases: 'pases', asistencias: 'asistencias', salidas: 'salidas', reportes: 'reportes', cambiosAsistencia: 'cambiosAsistencia',
  plantillasImportacion: 'plantillasImportacion', incidenciasPersonal: 'incidenciasPersonal', coberturas: 'coberturas',
  bancoActividades: 'bancoActividades', bitacoraPrefectura: 'bitacoraPrefectura', adscripciones: 'adscripciones',
  inscripciones: 'inscripciones', movimientos: 'movimientos', importaciones: 'importaciones',
};

const escuelaDe = (tabla: string, r: Record<string, unknown>) => (tabla === 'escuelas' ? r.id : r.escuelaId) as string | undefined;

/**
 * Fase 8D: si la escuela del registro está vinculada con el servidor, el cambio se agrega a la
 * cola EN LA MISMA TRANSACCIÓN que el dato (si una falla, fallan las dos). Todos los cambios de
 * una misma unidad de trabajo comparten `grupo` (el servidor los aplica todos o ninguno).
 */
async function encolar(db: BaseDatosEscolar, tabla: string, operacion: 'guardar' | 'eliminar', registro: Record<string, unknown>, versionBase: number | null): Promise<void> {
  const escuelaId = escuelaDe(tabla, registro);
  if (!escuelaId) return;
  const v = await db.vinculos.get(escuelaId);
  if (!v) return;
  const tx = Dexie.currentTransaction as (Transaction & { grupoSincronizacion?: string }) | null;
  const grupo = tx ? (tx.grupoSincronizacion ??= nuevoId()) : nuevoId();
  const c: CambioPendiente = {
    opId: nuevoId(), grupo, escuelaId, tabla, operacion, registroId: registro.id as string, versionBase,
    datos: operacion === 'guardar' ? structuredClone(registro) : null, creadoEn: new Date().toISOString(),
    estado: 'pendiente', mensaje: null, servidor: null,
  };
  await db.pendientes.add(c);
}

class RepositorioDexie<T extends Metadatos> implements Repositorio<T> {
  constructor(private readonly tabla: Table<T, string>, private readonly rastreo: { db: BaseDatosEscolar; nombre: string } | null = null) {}

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
  private async registrar(op: 'guardar' | 'eliminar', r: T, versionBase: number | null) {
    if (this.rastreo) await encolar(this.rastreo.db, this.rastreo.nombre, op, r as unknown as Record<string, unknown>, versionBase);
  }
  async insertar(entidad: T) {
    await this.tabla.add(entidad);
    await this.registrar('guardar', entidad, null);
  }
  async insertarVarios(entidades: T[]) {
    if (entidades.length) await this.tabla.bulkAdd(entidades);
    for (const e of entidades) await this.registrar('guardar', e, null);
  }
  async actualizar(entidad: T) {
    const previo = this.rastreo ? await this.tabla.get(entidad.id) : undefined;
    await this.tabla.put(entidad);
    await this.registrar('guardar', entidad, previo?.version ?? null);
  }
  async eliminar(id: string) {
    const previo = this.rastreo ? await this.tabla.get(id) : undefined;
    await this.tabla.delete(id);
    if (previo) await this.registrar('eliminar', previo, previo.version);
  }
  async eliminarVarios(ids: string[]) {
    const previos = this.rastreo ? (await this.tabla.bulkGet(ids)).filter((x): x is T => !!x) : [];
    await this.tabla.bulkDelete(ids);
    for (const p of previos) await this.registrar('eliminar', p, p.version);
  }
}

export function crearRepositoriosDexie(db: BaseDatosEscolar): Repositorios {
  const repos: Record<string, unknown> = { ajustes: new RepositorioDexie(db.ajustes) }; // preferencias del dispositivo: nunca se sincronizan
  for (const [nombre, local] of Object.entries(TABLA_LOCAL)) {
    repos[nombre] = new RepositorioDexie((db as unknown as Record<string, Table<Metadatos, string>>)[local]!, { db, nombre });
  }
  return repos as unknown as Repositorios;
}

/** Cola y vínculos de sincronización en IndexedDB. Sus escrituras NO se vuelven a encolar. */
export function crearAlmacenSincronizacionDexie(db: BaseDatosEscolar): AlmacenSincronizacion {
  const tablaDe = (nombre: string) => {
    const local = TABLA_LOCAL[nombre];
    if (!local) throw new ErrorDominio('VALIDACION', 'Tabla desconocida en la sincronización.');
    return (db as unknown as Record<string, Table<Record<string, unknown>, string>>)[local]!;
  };
  const sinResolver = async (escuelaId: string) => {
    const s = new Set<string>();
    for (const c of await db.pendientes.where('escuelaId').equals(escuelaId).toArray()) s.add(`${c.tabla}:${c.registroId}`);
    return s;
  };
  const escribir = async (tabla: string, id: string, registro: Record<string, unknown> | null) => {
    const t = tablaDe(tabla);
    if (registro) await t.put(registro); else await t.delete(id);
  };
  return {
    vinculos: () => db.vinculos.toArray(),
    vinculo: (id) => db.vinculos.get(id),
    async guardarVinculo(v: VinculoServidor) { await db.vinculos.put(v); },
    async cola(escuelaId: string, estados?: EstadoPendiente[]) {
      const todos = await db.pendientes.where('escuelaId').equals(escuelaId).sortBy('orden');
      return estados ? todos.filter((c) => estados.includes(c.estado)) : todos;
    },
    async registrarResultados(resultados: ResultadoRemoto[]) {
      await db.transaction('rw', db.pendientes, async () => {
        for (const r of resultados) {
          const c = await db.pendientes.where('opId').equals(r.opId).first();
          if (!c) continue;
          if (r.estado === 'aplicado' || r.estado === 'repetido') await db.pendientes.delete(c.orden!);
          else await db.pendientes.update(c.orden!, { estado: r.estado, mensaje: r.mensaje, servidor: r.servidor });
        }
      });
    },
    async aplicarRemotos(escuelaId: string, cambios: RegistroRemoto[], completa: boolean) {
      return db.transaction('rw', db.tables, async () => {
        const reservados = await sinResolver(escuelaId);
        let aplicados = 0; let omitidos = 0;
        for (const c of cambios) {
          if (!TABLA_LOCAL[c.tabla]) { omitidos++; continue; }
          if (c.registro && escuelaDe(c.tabla, c.registro) !== escuelaId) { omitidos++; continue; } // nunca mezclar escuelas
          if (reservados.has(`${c.tabla}:${c.id}`)) {
            // Hay un cambio local sin resolver: no se pisa; se guarda la versión del servidor para comparar.
            const ps = await db.pendientes.where('[tabla+registroId]').equals([c.tabla, c.id]).toArray();
            for (const p of ps) if (p.estado !== 'pendiente') await db.pendientes.update(p.orden!, { servidor: c.registro });
            omitidos++; continue;
          }
          try {
            await escribir(c.tabla, c.id, c.registro);
            aplicados++;
          } catch (e) {
            // Choque con una clave única local (p. ej. una lista local de la misma clase y fecha aún sin enviar).
            if ((e as Error).name === 'ConstraintError') { omitidos++; continue; }
            throw e;
          }
        }
        if (completa) {
          const enServidor = new Set(cambios.map((c) => `${c.tabla}:${c.id}`));
          for (const nombre of Object.keys(TABLA_LOCAL)) {
            const t = tablaDe(nombre);
            const locales = await t.filter((r) => escuelaDe(nombre, r) === escuelaId).primaryKeys();
            for (const id of locales) if (!enServidor.has(`${nombre}:${id}`) && !reservados.has(`${nombre}:${id}`)) await t.delete(id);
          }
        }
        return { aplicados, omitidos };
      });
    },
    async usarVersionServidor(opId: string) {
      await db.transaction('rw', db.tables, async () => {
        const c = await db.pendientes.where('opId').equals(opId).first();
        if (!c) return;
        // Se resuelve el GRUPO completo (p. ej. una lista y sus marcas) y los cambios posteriores de esos registros.
        const delGrupo = (await db.pendientes.where('escuelaId').equals(c.escuelaId).toArray()).filter((x) => x.grupo === c.grupo);
        const desde = Math.min(...delGrupo.map((x) => x.orden!));
        const afectados = new Set(delGrupo.map((x) => `${x.tabla}:${x.registroId}`));
        for (const x of await db.pendientes.where('escuelaId').equals(c.escuelaId).toArray()) {
          if (x.orden! >= desde && afectados.has(`${x.tabla}:${x.registroId}`)) await db.pendientes.delete(x.orden!);
        }
        for (const x of delGrupo) {
          const delMismo = x.servidor && x.servidor.id === x.registroId ? x.servidor : null;
          try { await escribir(x.tabla, x.registroId, delMismo); } catch (e) { if ((e as Error).name !== 'ConstraintError') throw e; }
        }
        // Lo que el servidor tiene en su lugar (p. ej. la lista que guardó otra persona) llega con una fotografía nueva.
        const v = await db.vinculos.get(c.escuelaId);
        if (v) await db.vinculos.put({ ...v, cursor: 0 });
      });
    },
    async reintentar(opId: string, nuevoOpId: string) {
      await db.transaction('rw', db.tables, async () => {
        const c = await db.pendientes.where('opId').equals(opId).first();
        if (!c || c.estado !== 'conflicto') throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Ese cambio ya no está en conflicto.');
        const delGrupo = (await db.pendientes.where('escuelaId').equals(c.escuelaId).toArray()).filter((x) => x.grupo === c.grupo);
        if (delGrupo.some((x) => x.versionBase === null && x.servidor)) {
          throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Ya existe en el servidor un registro equivalente: usa la versión del servidor y, si hace falta, corrígela después.');
        }
        let primero = true;
        for (const x of delGrupo) {
          const base = x.servidor && x.servidor.id === x.registroId ? (x.servidor.version as number) : x.versionBase === null ? null : x.versionBase;
          // La versión local se coloca después de la del servidor (nunca retrocede).
          const datos = x.datos ? { ...x.datos, version: (base ?? 0) + 1 } : null;
          if (datos) await tablaDe(x.tabla).put(datos);
          await db.pendientes.update(x.orden!, { opId: primero ? nuevoOpId : nuevoId(), versionBase: base, datos, estado: 'pendiente', mensaje: null, servidor: null });
          primero = false;
        }
      });
    },
    async quitarEscuela(escuelaId: string) {
      await db.transaction('rw', db.tables, async () => {
        for (const nombre of Object.keys(TABLA_LOCAL)) {
          const t = tablaDe(nombre);
          await t.bulkDelete(await t.filter((r) => escuelaDe(nombre, r) === escuelaId).primaryKeys());
        }
        await db.pendientes.where('escuelaId').equals(escuelaId).delete();
        await db.vinculos.delete(escuelaId);
      });
    },
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
  registrarError(e);
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
