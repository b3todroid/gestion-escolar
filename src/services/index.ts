import { BaseDatosEscolar } from '../database/db';
import { crearRepositoriosDexie, crearUnidadDeTrabajoDexie } from '../repositories/dexie';
import { relojSistema, type Reloj } from '../utils/reloj';
import type { Contexto } from './contexto';
import { ServicioCiclos } from './ciclos';
import { ServicioEscuelas } from './escuelas';
import { ServicioGrados } from './grados';
import { ServicioHorario } from './horario';
import { ServicioTurnos } from './turnos';
import { ServicioAsistente } from './asistente';

export interface Servicios {
  escuelas: ServicioEscuelas;
  ciclos: ServicioCiclos;
  turnos: ServicioTurnos;
  horario: ServicioHorario;
  grados: ServicioGrados;
  asistente: ServicioAsistente;
}

export function crearServiciosDesdeContexto(ctx: Contexto): Servicios {
  const base = {
    escuelas: new ServicioEscuelas(ctx),
    ciclos: new ServicioCiclos(ctx),
    turnos: new ServicioTurnos(ctx),
    horario: new ServicioHorario(ctx),
    grados: new ServicioGrados(ctx),
  };
  return { ...base, asistente: new ServicioAsistente(ctx, base) };
}

/** Punto único de composición: BD local + repositorios Dexie + servicios. */
export function crearServicios(db: BaseDatosEscolar = new BaseDatosEscolar(), reloj: Reloj = relojSistema): Servicios {
  return crearServiciosDesdeContexto({
    repos: crearRepositoriosDexie(db),
    uow: crearUnidadDeTrabajoDexie(db),
    reloj,
  });
}
