import { describe, expect, it } from 'vitest';
import { cifrar } from '../../src/utils/cifrado';
import { comprimir, descomprimir, esComprimido } from '../../src/utils/compresion';
import { escuelaConCiclo, nuevoEntorno } from './ayudantes';

// Fase 9 — un respaldo de una escuela grande (75 MB con 3 semanas de asistencia) no podía
// restaurarse (límite de 25 MB). Ahora los respaldos grandes se comprimen y se leen igual.
describe('respaldos grandes (compresión gzip)', () => {
  it('comprime y descomprime sin perder nada; reconoce el formato', async () => {
    const texto = JSON.stringify({ datos: Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, marca: i % 3 ? 'P' : 'F', nombre: 'Alumna Ficticia' })) });
    const c = await comprimir(texto);
    expect(esComprimido(c)).toBe(true);
    expect(esComprimido(texto)).toBe(false);
    expect(c.length).toBeLessThan(texto.length / 5);
    expect(await descomprimir(c, texto.length)).toBe(texto);
  });

  it('rechaza datos dañados y lo que excede el límite (sin agotar la memoria)', async () => {
    const c = await comprimir('x'.repeat(100_000));
    await expect(descomprimir(c, 1000)).rejects.toThrow(/demasiado grande/);
    const danado = JSON.stringify({ ...JSON.parse(c), datos: btoa('no es gzip') });
    await expect(descomprimir(danado, 10_000_000)).rejects.toThrow(/dañado/);
  });

  it('un respaldo comprimido (y comprimido + cifrado) se analiza y restaura igual que uno normal', async () => {
    const origen = nuevoEntorno();
    const { escuela } = await escuelaConCiclo(origen.s);
    const { contenido } = await origen.s.respaldos.exportar([escuela.id], { contrasena: null });
    const comprimido = await comprimir(contenido);
    const cifrado = await cifrar(comprimido, 'clave-ficticia-segura-9', new Date().toISOString());

    const destino = nuevoEntorno();
    const a1 = await destino.s.respaldos.analizar(comprimido);
    expect(a1.errores).toEqual([]);
    expect(a1.escuelas[0]).toMatchObject({ id: escuela.id, accion: 'agregar' });
    expect(destino.s.respaldos.requiereContrasena(cifrado)).toBe(true);
    const a2 = await destino.s.respaldos.analizar(cifrado, 'clave-ficticia-segura-9');
    expect(a2.errores).toEqual([]);
    const informe = await destino.s.respaldos.restaurar(cifrado, [escuela.id], 'clave-ficticia-segura-9');
    expect(informe.agregadas).toBe(1);
    expect(await destino.s.escuelas.obtener(escuela.id)).toBeTruthy();
  });

  it('los respaldos pequeños siguen siendo JSON legible (sin comprimir)', async () => {
    const e = nuevoEntorno();
    const { escuela } = await escuelaConCiclo(e.s);
    const { contenido } = await e.s.respaldos.exportar([escuela.id], { contrasena: null });
    expect(JSON.parse(contenido).formato).toBe('gestion-escolar-respaldo');
  });
});

describe('Fase 9 — volumen', () => {
  it('exporta una tabla con cientos de miles de registros sin desbordar la pila', async () => {
    const e = nuevoEntorno();
    const { escuela } = await escuelaConCiclo(e.s);
    // Datos ficticios mínimos insertados directo en la tabla de bitácora (sólo volumen).
    const base = { escuelaId: escuela.id, creadoEn: '2026-09-01T00:00:00.000Z', actualizadoEn: '2026-09-01T00:00:00.000Z', version: 1 };
    const muchos = Array.from({ length: 200_000 }, (_, i) => ({ ...base, id: `aj-${String(i).padStart(6, '0')}`, clave: `k${i}` }));
    const srv = e.s.respaldos as unknown as { registrosDe: (id: string, t: string) => Promise<unknown[]> };
    const original = srv.registrosDe.bind(srv);
    srv.registrosDe = async (id, t) => (t === 'asistencias' ? muchos : original(id, t));
    const r = await e.s.respaldos.exportar([escuela.id], { contrasena: null });
    expect(r.registros).toBeGreaterThanOrEqual(200_000);
  }, 120_000);

  it('matrícula y CURP repetidas se siguen rechazando (consulta por índice, v12) sólo dentro de la escuela', async () => {
    const e = nuevoEntorno();
    const { escuela, ciclo } = await escuelaConCiclo(e.s);
    await e.s.alumnos.inscribirNuevo(ciclo.id, { nombre: 'Ana', primerApellido: 'Ficticia', matricula: 'M-1', curp: 'FIAA100101MZSCNN09' });
    await expect(e.s.alumnos.inscribirNuevo(ciclo.id, { nombre: 'Otra', primerApellido: 'Persona', matricula: 'M-1' })).rejects.toThrow('matrícula');
    await expect(e.s.alumnos.inscribirNuevo(ciclo.id, { nombre: 'Otra', primerApellido: 'Persona', curp: 'FIAA100101MZSCNN09' })).rejects.toThrow('CURP');
    const otra = await e.s.escuelas.crear({ nombre: 'Escuela Ficticia Dos', cct: '32ZZZ0002B', nivel: 'secundaria', localidad: 'Ejemplo' });
    const c2 = await e.s.ciclos.crear(otra.id, { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15' });
    await expect(e.s.alumnos.inscribirNuevo(c2.id, { nombre: 'Bea', primerApellido: 'Ficticia', matricula: 'M-1' })).resolves.toBeTruthy();
    expect(escuela.id).not.toBe(otra.id);
  });
});
