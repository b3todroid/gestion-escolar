import { BaseDatosEscolar, VERSION_ESQUEMA } from '../database/db';
import { ServicioRespaldos } from './respaldos';
import { crearRepositoriosDexie, crearUnidadDeTrabajoDexie } from '../repositories/dexie';
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
  respaldos: ServicioRespaldos;
}

export function crearServiciosDesdeContexto(ctx: Contexto): Servicios {
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
    respaldos: new ServicioRespaldos(ctx, VERSION_ESQUEMA),
  };
}

/** Punto único de composición: BD local + repositorios Dexie + servicios. */
export function crearServicios(db: BaseDatosEscolar = new BaseDatosEscolar(), reloj: Reloj = relojSistema): Servicios {
  return crearServiciosDesdeContexto({
    repos: crearRepositoriosDexie(db),
    uow: crearUnidadDeTrabajoDexie(db),
    reloj,
  });
}
