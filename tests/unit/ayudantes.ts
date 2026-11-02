import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios } from '../../src/services';

let n = 0;
/** Base de datos aislada por prueba. Datos ficticios únicamente. */
export function nuevoEntorno() {
  const nombre = `prueba-${Date.now()}-${n++}`;
  const db = new BaseDatosEscolar(nombre);
  return { nombre, db, s: crearServicios(db) };
}

export const ESCUELA_FICTICIA = { nombre: 'Escuela Secundaria Ficticia 1', cct: '00XXX0000A', nivel: 'secundaria', localidad: 'Ciudad Ejemplo' } as const;

export async function escuelaConCiclo(s: ReturnType<typeof nuevoEntorno>['s']) {
  const escuela = await s.escuelas.crear({ ...ESCUELA_FICTICIA });
  const ciclo = await s.ciclos.crear(escuela.id, { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15' });
  return { escuela, ciclo };
}

export const MATUTINO = { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:10', dias: [1, 2, 3, 4, 5] };
