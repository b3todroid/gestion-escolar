import { describe, expect, it } from 'vitest';
import { BaseDatosEscolar } from '../../src/database/db';
import { crearServicios } from '../../src/services';
import { ESCUELA_FICTICIA, MATUTINO, escuelaConCiclo, nuevoEntorno } from './ayudantes';

describe('persistencia en IndexedDB', () => {
  it('conserva la configuración al cerrar y reabrir la base de datos', async () => {
    const { nombre, db, s } = nuevoEntorno();
    const { escuela, ciclo } = await escuelaConCiclo(s);
    const { jornada } = await s.turnos.crear(ciclo.id, MATUTINO);
    await s.horario.crear('periodo', jornada.id, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' });
    db.close();

    const db2 = new BaseDatosEscolar(nombre);
    const s2 = crearServicios(db2);
    expect((await s2.escuelas.obtener(escuela.id)).nombre).toBe(ESCUELA_FICTICIA.nombre);
    expect(await s2.ciclos.listar(escuela.id)).toHaveLength(1);
    const [t] = await s2.turnos.listar(ciclo.id);
    expect(t?.jornada.dias).toEqual([1, 2, 3, 4, 5]);
    expect((await s2.horario.resumen(jornada.id)).bloques.map((b) => b.nombre)).toEqual(['Módulo 1']);
    db2.close();
  });

  it('usa UUID como identificador y registra metadatos de versión', async () => {
    const { s } = nuevoEntorno();
    const e = await s.escuelas.crear({ ...ESCUELA_FICTICIA });
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(e.version).toBe(1);
    const e2 = await s.escuelas.actualizar(e.id, { ...ESCUELA_FICTICIA, nombre: 'Escuela Renombrada' });
    expect(e2.id).toBe(e.id);
    expect(e2.version).toBe(2);
    expect(e2.creadoEn).toBe(e.creadoEn);
  });

  it('las operaciones compuestas son atómicas (todo o nada)', async () => {
    const { db, s } = nuevoEntorno();
    const { ciclo } = await escuelaConCiclo(s);
    // Forzamos un fallo después de insertar el turno y antes de la jornada.
    const original = db.jornadas.add.bind(db.jornadas);
    db.jornadas.add = () => Promise.reject(new Error('fallo simulado')) as never;
    await expect(s.turnos.crear(ciclo.id, MATUTINO)).rejects.toMatchObject({ codigo: 'ALMACENAMIENTO' });
    db.jornadas.add = original;
    expect(await db.turnos.count()).toBe(0);
  });
});
