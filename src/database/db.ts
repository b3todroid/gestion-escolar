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
import type { CicloEscolar, Escuela, Grado, Grupo, Jornada, Periodo, Receso, Turno } from '../models';

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

    // Ejemplo para fases futuras (NO descomentar sin documentar en MODELO_DATOS.md):
    // this.version(2).stores({ docentes: 'id, escuelaId, cicloEscolarId' })
    //   .upgrade(async (tx) => { /* transformar datos existentes sin perderlos */ });
  }
}
