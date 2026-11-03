/**
 * Migración de una escuela de este dispositivo al servidor escolar (Fase 8E), en 9 pasos:
 *  1. Respaldo cifrado obligatorio (queda en manos de la persona).
 *  2. Validación del esquema y de los datos locales (la misma del respaldo: Zod, referencias, huella, conteos).
 *  3. Preparación: escuela del servidor con la MISMA CCT, vacía, y la persona es su administradora.
 *  4. Ensayo en el servidor SIN escribir nada (duplicados, referencias, reglas de la base).
 *  5. Integridad: conteos y huella calculados por el servidor iguales a los del dispositivo.
 *  6. Autorización registrada (quién, cargo, aviso de privacidad publicado, CCT escrita).
 *  7. Migración: todo o nada.
 *  8. Validación: el servidor relee lo guardado y la huella debe coincidir.
 *  9. Este dispositivo pasa a usar la versión sincronizada (los datos locales se conservan hasta aquí).
 * Reversión: el servidor quita lo migrado (si nadie cambió nada después) y el respaldo del paso 1
 * devuelve el dispositivo a como estaba.
 */
import { ErrorDominio } from '../domain/errores';
import type { ClienteServidor } from '../remoto/servidorEscolar';
import type { AlmacenSincronizacion, Repositorios } from '../repositories/tipos';
import {
  conteosDe, esquemaAutorizacionMigracion, huellaDatos, normalizarDatos,
  type AutorizacionMigracion, type InformeEnsayo, type MigracionRegistrada, type PaqueteMigracion, type ResultadoMigracion,
} from '../validators/migracion';
import { TABLAS_RESPALDO } from '../validators/respaldo';
import { validar } from '../validators/esquemas';
import type { ServicioRespaldos } from './respaldos';
import type { ServicioSincronizacion } from './sincronizacion';

export interface PreparacionMigracion {
  paquete: PaqueteMigracion;
  registros: number;
  cct: string;
}

export class ServicioMigracion {
  private readonly respaldos: ServicioRespaldos;
  private readonly sinc: ServicioSincronizacion;
  private readonly cliente: ClienteServidor;
  private readonly repos: Repositorios;
  private readonly almacen: AlmacenSincronizacion;
  constructor(respaldos: ServicioRespaldos, sinc: ServicioSincronizacion, cliente: ClienteServidor, repos: Repositorios, almacen: AlmacenSincronizacion) {
    this.respaldos = respaldos; this.sinc = sinc; this.cliente = cliente; this.repos = repos; this.almacen = almacen;
  }

  /** Paso 1: respaldo cifrado de la escuela local (la página lo descarga). */
  async respaldoCifrado(escuelaLocalId: string, contrasena: string, confirmacion: string) {
    const r = await this.respaldos.exportar([escuelaLocalId], { contrasena, confirmacion });
    await this.respaldos.registrarRespaldo([escuelaLocalId]);
    return r;
  }

  /** Pasos 2 y 3: valida los datos locales y arma el paquete con el identificador de la escuela del servidor. */
  async preparar(escuelaLocalId: string, escuelaServidorId: string, cctServidor: string | null): Promise<PreparacionMigracion> {
    if (await this.sinc.estaVinculada(escuelaLocalId)) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'Esta escuela ya se sincroniza con el servidor: no hay nada que migrar.');
    const local = await this.repos.escuelas.obtener(escuelaLocalId);
    if (!local) throw new ErrorDominio('NO_ENCONTRADO', 'No se encontró la escuela en este dispositivo.');
    if (!local.cct || !cctServidor || local.cct.toUpperCase() !== cctServidor.toUpperCase()) {
      throw new ErrorDominio('VALIDACION', `La CCT de la escuela del dispositivo (${local.cct ?? 'sin CCT'}) no coincide con la del servidor (${cctServidor ?? 'sin CCT'}): no se mezclan escuelas.`);
    }
    const { contenido } = await this.respaldos.exportar([escuelaLocalId], { contrasena: null });
    const analisis = await this.respaldos.analizar(contenido);
    if (analisis.errores.length) throw new ErrorDominio('VALIDACION', `Los datos del dispositivo no pasaron la validación: ${analisis.errores[0]}`);
    if (analisis.esquema !== this.respaldos.versionDatos()) throw new ErrorDominio('VALIDACION', 'La versión de los datos no es la actual: actualiza la aplicación antes de migrar.');
    const sobre = JSON.parse(contenido) as { datos: Record<string, Record<string, unknown>[]> };
    const reasignados: Record<string, unknown[]> = {};
    for (const t of TABLAS_RESPALDO) {
      reasignados[t] = (sobre.datos[t] ?? []).map((r) => (t === 'escuelas' ? { ...r, id: escuelaServidorId } : { ...r, escuelaId: escuelaServidorId }));
    }
    const { datos, errores } = normalizarDatos(reasignados);
    if (errores.length) throw new ErrorDominio('VALIDACION', `Los datos del dispositivo no pasaron la validación: ${errores[0]}`);
    const conteos = conteosDe(datos);
    return {
      paquete: { origenEscuelaId: escuelaLocalId, datos, conteos, huella: await huellaDatos(datos) },
      registros: Object.values(conteos).reduce((a, b) => a + b, 0),
      cct: local.cct.toUpperCase(),
    };
  }

  /** Pasos 4 y 5: ensayo en el servidor (no escribe nada). */
  ensayo(escuelaServidorId: string, paquete: PaqueteMigracion): Promise<InformeEnsayo> {
    return this.cliente.pedir<InformeEnsayo>('POST', `/api/escuelas/${encodeURIComponent(escuelaServidorId)}/migracion/ensayo`, { paquete });
  }

  /** Pasos 6 y 7: migración con autorización registrada. */
  async migrar(escuelaServidorId: string, paquete: PaqueteMigracion, autorizacion: AutorizacionMigracion): Promise<ResultadoMigracion | InformeEnsayo> {
    const a = validar(esquemaAutorizacionMigracion, autorizacion);
    return this.cliente.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaServidorId)}/migracion`, { paquete, autorizacion: a });
  }

  /** Paso 8: lo que el servidor guardó coincide con lo del dispositivo (conteos y huella). */
  coincide(paquete: PaqueteMigracion, r: InformeEnsayo): boolean {
    return r.valido && r.huella === paquete.huella && TABLAS_RESPALDO.every((t) => (r.conteos[t] ?? 0) === (paquete.conteos[t] ?? 0));
  }

  /**
   * Paso 9: este dispositivo deja la copia local y usa la sincronizada (mismos registros, con el
   * identificador de la escuela del servidor). Sólo después de una migración validada.
   */
  async usarVersionServidor(escuelaLocalId: string, escuelaServidorId: string, usuarioId: string): Promise<{ registros: number }> {
    const vigente = (await this.historial(escuelaServidorId)).find((m) => m.estado === 'aplicada');
    if (!vigente) throw new ErrorDominio('ESTADO_NO_PERMITIDO', 'No hay una migración vigente de esta escuela en el servidor.');
    if (escuelaLocalId !== escuelaServidorId) await this.almacen.quitarEscuela(escuelaLocalId);
    return this.sinc.unirse(escuelaServidorId, usuarioId);
  }

  historial(escuelaServidorId: string): Promise<MigracionRegistrada[]> {
    return this.cliente.pedir<MigracionRegistrada[]>('GET', `/api/escuelas/${encodeURIComponent(escuelaServidorId)}/migraciones`);
  }

  async revertir(escuelaServidorId: string, migracionId: string, motivo: string): Promise<{ revertida: true; registros: number }> {
    if (motivo.trim().length < 3) throw new ErrorDominio('VALIDACION', 'Escribe el motivo de la reversión.', [{ campo: 'motivo', mensaje: 'Escribe el motivo.' }]);
    return this.cliente.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaServidorId)}/migraciones/${encodeURIComponent(migracionId)}/revertir`, { motivo });
  }
}
