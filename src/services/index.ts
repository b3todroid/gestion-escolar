import { BaseDatosEscolar, VERSION_ESQUEMA } from '../database/db';
import { ServicioRespaldos } from './respaldos';
import { crearAlmacenSincronizacionDexie, crearRepositoriosDexie, crearUnidadDeTrabajoDexie } from '../repositories/dexie';
import type { AlmacenSincronizacion } from '../repositories/tipos';
import { ServicioSincronizacion } from './sincronizacion';
import { ServicioMigracion } from './migracion';
import { ErrorDominio } from '../domain/errores';
import { relojSistema, type Reloj } from '../utils/reloj';
import type { Contexto } from './contexto';
import { ServicioCiclos } from './ciclos';
import { ServicioEscuelas } from './escuelas';
import { ServicioGrados } from './grados';
import { ServicioHorario } from './horario';
import { ServicioTurnos } from './turnos';
import { ServicioAsistente } from './asistente';
import { ServicioPersonal } from './personal';
import { ServicioMaterias } from './materias';
import { ServicioAsignaciones } from './asignaciones';
import { ServicioActividades } from './actividades';
import { ServicioConfirmacion } from './confirmacion';
import { ServicioVistas } from './vistas';
import { ServicioImportacion } from './importacion';
import { ServicioAlumnos } from './alumnos';
import { ServicioAsistencia } from './asistencia';
import { ServicioPanelDocente } from './panelDocente';
import { ServicioImportacionDatos } from './importacionDatos';
import { ServicioRevisionHorarios } from './revisionHorarios';
import { ServicioPlantillasImportacion } from './plantillasImportacion';
import { ServicioPrefectura } from './prefectura';
import { ServicioCuenta } from './cuenta';
import { ClienteServidorHttp, type ClienteServidor } from '../remoto/servidorEscolar';

export interface Servicios {
  escuelas: ServicioEscuelas;
  ciclos: ServicioCiclos;
  turnos: ServicioTurnos;
  horario: ServicioHorario;
  grados: ServicioGrados;
  asistente: ServicioAsistente;
  personal: ServicioPersonal;
  materias: ServicioMaterias;
  asignaciones: ServicioAsignaciones;
  actividades: ServicioActividades;
  confirmacion: ServicioConfirmacion;
  vistas: ServicioVistas;
  importacion: ServicioImportacion;
  alumnos: ServicioAlumnos;
  asistencia: ServicioAsistencia;
  panel: ServicioPanelDocente;
  importacionDatos: ServicioImportacionDatos;
  revisionHorarios: ServicioRevisionHorarios;
  plantillas: ServicioPlantillasImportacion;
  prefectura: ServicioPrefectura;
  respaldos: ServicioRespaldos;
  /** Cuenta en el servidor escolar (Fase 8B). No toca los datos locales. */
  cuenta: ServicioCuenta;
  /** Sincronización con el servidor escolar (Fase 8D). */
  sincronizacion: ServicioSincronizacion;
  /** Migración de una escuela local al servidor (Fase 8E). */
  migracion: ServicioMigracion;
}

/** En el servidor no hay cola local: cualquier uso es un error de programación. */
const sinAlmacen = new Proxy({}, { get: () => () => Promise.reject(new ErrorDominio('ESTADO_NO_PERMITIDO', 'Sincronización no disponible aquí.')) }) as AlmacenSincronizacion;

export function crearServiciosDesdeContexto(ctx: Contexto, servidor: ClienteServidor = new ClienteServidorHttp(), almacen: AlmacenSincronizacion = sinAlmacen): Servicios {
  const sincronizacion = new ServicioSincronizacion(almacen, servidor, ctx.repos, ctx.reloj);
  const respaldos = new ServicioRespaldos(ctx, VERSION_ESQUEMA, (id) => sincronizacion.estaVinculada(id));
  const base = {
    escuelas: new ServicioEscuelas(ctx),
    ciclos: new ServicioCiclos(ctx),
    turnos: new ServicioTurnos(ctx),
    horario: new ServicioHorario(ctx),
    grados: new ServicioGrados(ctx),
  };
  return {
    ...base,
    asistente: new ServicioAsistente(ctx, base),
    personal: new ServicioPersonal(ctx),
    materias: new ServicioMaterias(ctx),
    asignaciones: new ServicioAsignaciones(ctx),
    actividades: new ServicioActividades(ctx),
    confirmacion: new ServicioConfirmacion(ctx),
    vistas: new ServicioVistas(ctx),
    importacion: new ServicioImportacion(ctx),
    alumnos: new ServicioAlumnos(ctx),
    asistencia: new ServicioAsistencia(ctx),
    panel: new ServicioPanelDocente(ctx),
    revisionHorarios: new ServicioRevisionHorarios(ctx),
    plantillas: new ServicioPlantillasImportacion(ctx),
    prefectura: new ServicioPrefectura(ctx),
    importacionDatos: new ServicioImportacionDatos(ctx),
    respaldos,
    migracion: new ServicioMigracion(respaldos, sincronizacion, servidor, ctx.repos, almacen),
    cuenta: new ServicioCuenta(servidor),
    sincronizacion,
  };
}

/** Punto único de composición: BD local + repositorios Dexie + servicios. */
export function crearServicios(db: BaseDatosEscolar = new BaseDatosEscolar(), reloj: Reloj = relojSistema, servidor: ClienteServidor = new ClienteServidorHttp()): Servicios {
  return crearServiciosDesdeContexto({
    repos: crearRepositoriosDexie(db),
    uow: crearUnidadDeTrabajoDexie(db),
    reloj,
  }, servidor, crearAlmacenSincronizacionDexie(db));
}
