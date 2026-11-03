/**
 * Base de datos local (IndexedDB) gestionada con Dexie.
 *
 * VERSIONADO DEL ESQUEMA
 * - Nunca modificar una versión ya publicada: agregar `this.version(n + 1)`.
 * - Las migraciones de datos van en `.upgrade(tx => …)` y deben conservar
 *   la información existente. Nunca borrar tablas o datos como atajo.
 * - Sólo se declaran los campos indexados; el resto del objeto se guarda igual.
 * Ver docs/MODELO_DATOS.md.
 */
import { Dexie, type Table } from 'dexie';
import type { Asignacion, CicloEscolar, Escuela, Grado, Grupo, Jornada, Materia, Periodo, Personal, Receso, Sesion, Turno } from '../models';

export const NOMBRE_BD = 'gestion-escolar';

export class BaseDatosEscolar extends Dexie {
  escuelas!: Table<Escuela, string>;
  ciclosEscolares!: Table<CicloEscolar, string>;
  turnos!: Table<Turno, string>;
  jornadas!: Table<Jornada, string>;
  periodos!: Table<Periodo, string>;
  recesos!: Table<Receso, string>;
  grados!: Table<Grado, string>;
  grupos!: Table<Grupo, string>;
  personal!: Table<Personal, string>;
  materias!: Table<Materia, string>;
  asignaciones!: Table<Asignacion, string>;
  sesiones!: Table<Sesion, string>;

  constructor(nombre: string = NOMBRE_BD) {
    super(nombre);

    // Versión 1 — Fase 1: configuración escolar.
    this.version(1).stores({
      escuelas: 'id, cct',
      ciclosEscolares: 'id, escuelaId, [escuelaId+estado]',
      turnos: 'id, cicloEscolarId, escuelaId',
      jornadas: 'id, &turnoId, cicloEscolarId',
      periodos: 'id, jornadaId, cicloEscolarId',
      recesos: 'id, jornadaId, cicloEscolarId',
      grados: 'id, cicloEscolarId, [cicloEscolarId+numero]',
      grupos: 'id, cicloEscolarId, gradoId, turnoId',
    });

    // Versión 2 — Fase 2: personal, materias, asignaciones y horario semanal.
    // Sólo agrega tablas; las de la versión 1 y sus datos no se modifican.
    this.version(2).stores({
      personal: 'id, escuelaId',
      materias: 'id, cicloEscolarId, escuelaId',
      asignaciones: 'id, cicloEscolarId, grupoId, materiaId, personalId',
      sesiones: 'id, cicloEscolarId, grupoId, personalId, asignacionId, periodoId',
    });

    // Para fases futuras: agregar this.version(3) (con .upgrade() si hay que transformar
    // datos sin perderlos) y documentarlo en docs/MODELO_DATOS.md.
  }
}
