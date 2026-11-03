/**
 * Sincronización con el servidor escolar (Fase 8D).
 * - El dispositivo sigue siendo la fuente para trabajar SIN CONEXIÓN: cada cambio local de una
 *   escuela vinculada se guarda en la cola en la misma transacción que el dato.
 * - Sincronizar = ENVIAR la cola (en orden, por grupos) y RECIBIR los cambios de los demás.
 * - Nada se resuelve en silencio: un conflicto o un rechazo queda visible hasta que una persona
 *   decide (usar la versión del servidor o volver a aplicar su cambio sobre ella).
 * - El estado que se muestra se calcula de la cola real; nunca se afirma «sincronizado» si no lo está.
 */
import { ErrorDominio } from '../domain/errores';
import type { Escuela } from '../models';
import type { ClienteServidor } from '../remoto/servidorEscolar';
import { ErrorServidor } from '../remoto/servidorEscolar';
import type { AlmacenSincronizacion, CambioPendiente, Repositorios } from '../repositories/tipos';
import { nuevoId } from '../utils/id';
import { MAX_CAMBIOS_POR_ENVIO, type RespuestaEnvio, type RespuestaRecepcion } from '../validators/sincronizacion';

/** Tamaño aproximado máximo de un envío (el servidor acepta hasta 4 MB). */
const MAX_BYTES_POR_ENVIO = 3_000_000;

export interface EstadoSincronizacion {
  escuelaId: string;
  escuela: string;
  vinculada: boolean;
  sinAcceso: boolean;
  pendientes: number;
  conflictos: number;
  rechazados: number;
  ultimaRecepcion: string | null;
  ultimoEnvio: string | null;
}

export interface ResumenSincronizacion {
  enviados: number;
  conflictos: number;
  rechazados: number;
  recibidos: number;
  /** null si todo salió bien; si no, por qué se detuvo (sin conexión, sin acceso…). */
  problema: string | null;
}

export class ServicioSincronizacion {
  private readonly almacen: AlmacenSincronizacion;
  private readonly cliente: ClienteServidor;
  private readonly repos: Repositorios;
  private readonly reloj: () => string;
  private enCurso = new Map<string, Promise<ResumenSincronizacion>>();
  constructor(almacen: AlmacenSincronizacion, cliente: ClienteServidor, repos: Repositorios, reloj: () => string) {
    this.almacen = almacen; this.cliente = cliente; this.repos = repos; this.reloj = reloj;
  }

  async estaVinculada(escuelaId: string): Promise<boolean> {
    return !!(await this.almacen.vinculo(escuelaId));
  }

  async estados(): Promise<EstadoSincronizacion[]> {
    const lista: EstadoSincronizacion[] = [];
    for (const v of await this.almacen.vinculos()) lista.push(await this.estado(v.escuelaId));
    return lista;
  }

  async estado(escuelaId: string): Promise<EstadoSincronizacion> {
    const v = await this.almacen.vinculo(escuelaId);
    const cola = v ? await this.almacen.cola(escuelaId) : [];
    const e = await this.repos.escuelas.obtener(escuelaId);
    return {
      escuelaId, escuela: e?.nombre ?? 'Escuela', vinculada: !!v, sinAcceso: v?.estado === 'sin_acceso',
      pendientes: cola.filter((c) => c.estado === 'pendiente').length,
      conflictos: cola.filter((c) => c.estado === 'conflicto').length,
      rechazados: cola.filter((c) => c.estado === 'rechazado').length,
      ultimaRecepcion: v?.ultimaRecepcion ?? null, ultimoEnvio: v?.ultimoEnvio ?? null,
    };
  }

  /** Cambios que requieren una decisión (conflictos y rechazos), en orden. */
  async porResolver(escuelaId: string): Promise<CambioPendiente[]> {
    return this.almacen.cola(escuelaId, ['conflicto', 'rechazado']);
  }

  /**
   * Usar en este dispositivo una escuela del servidor: descarga la fotografía de lo que la
   * persona puede ver. No mezcla escuelas: si ya hay una escuela local con ese identificador
   * o con la misma CCT, se detiene (vincular datos locales existentes es la migración, 8E).
   */
  async unirse(escuelaId: string, usuarioId: string): Promise<{ registros: number }> {
    if (await this.almacen.vinculo(escuelaId)) throw new ErrorDominio('DUPLICADO', 'Esta escuela ya se sincroniza en este dispositivo.');
    if (await this.repos.escuelas.obtener(escuelaId)) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Esta escuela ya existe en el dispositivo con datos locales. Unir esos datos con el servidor es parte de la migración (fase posterior, con autorización).');
    const r = await this.cliente.pedir<RespuestaRecepcion>('GET', `/api/escuelas/${encodeURIComponent(escuelaId)}/sincronizacion?desde=0`);
    const escuela = r.cambios.find((c) => c.tabla === 'escuelas' && c.id === escuelaId)?.registro as Escuela | undefined;
    if (escuela?.cct) {
      const locales = await this.repos.escuelas.listarTodos();
      if (locales.some((x) => x.cct?.toUpperCase() === escuela.cct!.toUpperCase())) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Ya hay en el dispositivo otra escuela con la misma CCT: no se mezclan escuelas.');
    }
    // Primero el vínculo (cursor 0) y después los datos: si algo falla, «Sincronizar» lo completa.
    await this.almacen.guardarVinculo({ escuelaId, usuarioId, cursor: 0, estado: 'activo', unidoEn: this.reloj(), ultimaRecepcion: null, ultimoEnvio: null });
    const { aplicados } = await this.almacen.aplicarRemotos(escuelaId, r.cambios, true);
    const v = (await this.almacen.vinculo(escuelaId))!;
    await this.almacen.guardarVinculo({ ...v, cursor: r.hasta, ultimaRecepcion: this.reloj() });
    return { registros: aplicados };
  }

  /** Envía la cola y recibe cambios. Si ya hay una sincronización de esa escuela en curso, se espera la misma. */
  sincronizar(escuelaId: string): Promise<ResumenSincronizacion> {
    const actual = this.enCurso.get(escuelaId);
    if (actual) return actual;
    const p = this.sincronizarUnaVez(escuelaId).finally(() => this.enCurso.delete(escuelaId));
    this.enCurso.set(escuelaId, p);
    return p;
  }

  private async sincronizarUnaVez(escuelaId: string): Promise<ResumenSincronizacion> {
    const resumen: ResumenSincronizacion = { enviados: 0, conflictos: 0, rechazados: 0, recibidos: 0, problema: null };
    const v = await this.almacen.vinculo(escuelaId);
    if (!v) throw new ErrorDominio('NO_ENCONTRADO', 'Esta escuela no está vinculada con el servidor.');
    try {
      // 1. Enviar, en el orden en que ocurrieron y sin partir grupos.
      for (;;) {
        const cola = await this.almacen.cola(escuelaId, ['pendiente']);
        if (!cola.length) break;
        const lote = tomarLote(cola);
        const r = await this.cliente.pedir<RespuestaEnvio>('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/sincronizacion`, {
          cambios: lote.map((c) => ({ opId: c.opId, grupo: c.grupo, tabla: c.tabla, operacion: c.operacion, id: c.registroId, versionBase: c.versionBase, datos: c.datos })),
        });
        await this.almacen.registrarResultados(r.resultados);
        for (const x of r.resultados) {
          if (x.estado === 'aplicado' || x.estado === 'repetido') resumen.enviados++;
          else if (x.estado === 'conflicto') resumen.conflictos++;
          else resumen.rechazados++;
        }
        await this.almacen.guardarVinculo({ ...(await this.almacen.vinculo(escuelaId))!, ultimoEnvio: this.reloj(), estado: 'activo' });
      }
      // 2. Recibir desde la última secuencia.
      for (;;) {
        const actual = (await this.almacen.vinculo(escuelaId))!;
        const r = await this.cliente.pedir<RespuestaRecepcion>('GET', `/api/escuelas/${encodeURIComponent(escuelaId)}/sincronizacion?desde=${actual.cursor}`);
        const { aplicados } = await this.almacen.aplicarRemotos(escuelaId, r.cambios, r.completa);
        resumen.recibidos += aplicados;
        await this.almacen.guardarVinculo({ ...actual, cursor: r.hasta, ultimaRecepcion: this.reloj(), estado: 'activo' });
        if (!r.mas) break;
      }
    } catch (e) {
      if (e instanceof ErrorServidor && (e.estado === 401 || e.estado === 403)) {
        if (e.estado === 403 && e.codigoServidor === 'SIN_PERMISO') await this.almacen.guardarVinculo({ ...(await this.almacen.vinculo(escuelaId))!, estado: 'sin_acceso' });
        resumen.problema = e.estado === 401 ? 'Inicia sesión para sincronizar. Tus cambios siguen guardados en este dispositivo.' : e.message;
        return resumen;
      }
      if (e instanceof ErrorServidor && e.estado === 0) {
        resumen.problema = 'Sin conexión con el servidor escolar. Tus cambios siguen guardados en este dispositivo y se enviarán después.';
        return resumen;
      }
      throw e;
    }
    return resumen;
  }

  /** Decisión de la persona ante un conflicto o rechazo: quedarse con lo que tiene el servidor. */
  async usarVersionServidor(opId: string): Promise<void> {
    await this.almacen.usarVersionServidor(opId);
  }

  /** Decisión de la persona ante un conflicto: volver a aplicar su cambio SOBRE la versión del servidor. */
  async reaplicarMiCambio(opId: string): Promise<void> {
    await this.almacen.reintentar(opId, nuevoId());
  }

  /** Quita del dispositivo la escuela sincronizada (datos, cola y vínculo). Acción explícita. */
  async quitar(escuelaId: string): Promise<void> {
    await this.almacen.quitarEscuela(escuelaId);
  }
}

/** Lote que no parte grupos y respeta los límites de cantidad y tamaño. */
function tomarLote(cola: CambioPendiente[]): CambioPendiente[] {
  const lote: CambioPendiente[] = [];
  let bytes = 0;
  let i = 0;
  while (i < cola.length) {
    const grupo = cola[i]!.grupo;
    const del = [] as CambioPendiente[];
    while (i < cola.length && cola[i]!.grupo === grupo) del.push(cola[i++]!);
    const tam = JSON.stringify(del).length;
    if (lote.length && (lote.length + del.length > MAX_CAMBIOS_POR_ENVIO || bytes + tam > MAX_BYTES_POR_ENVIO)) break;
    lote.push(...del); bytes += tam;
  }
  // Un solo grupo enorme (más de MAX cambios) se envía en partes: es el único caso que pierde atomicidad.
  return lote.slice(0, MAX_CAMBIOS_POR_ENVIO);
}
