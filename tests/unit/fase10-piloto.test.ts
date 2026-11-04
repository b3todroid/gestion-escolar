import { describe, expect, it } from 'vitest';
import { generarPiloto, ESCUELA_DEMO } from '../../piloto/datos';
import { BaseDatosEscolar, VERSION_ESQUEMA } from '../../src/database/db';
import { escuelaConCiclo, nuevoEntorno } from './ayudantes';

// Fase 10 — escuela de DEMOSTRACIÓN del piloto (datos FICTICIOS) y limpieza segura.
describe('generador del piloto (DEMO-001)', () => {
  it('es reproducible: mismos parámetros → mismos identificadores y misma huella', () => {
    const a = generarPiloto({ escala: 0.2, semanas: 1 });
    const b = generarPiloto({ escala: 0.2, semanas: 1 });
    expect(a.huella).toBe(b.huella);
    expect(a.escuelaId).toBe(b.escuelaId);
    expect(a.contenido).toBe(b.contenido);
    expect(generarPiloto({ escala: 0.3, semanas: 1 }).huella).not.toBe(a.huella);
  });

  it('con escala 1 produce 30 grupos, 100 trabajadores y 1 500 alumnos, en dos turnos con periodos distintos', () => {
    const p = generarPiloto({ escala: 1, semanas: 1 });
    expect(p.conteos).toMatchObject({ escuelas: 1, grupos: 30, personal: 100, alumnos: 1500, inscripciones: 1500, turnos: 2, grados: 3, recesos: 2 });
    const [mat, vesp] = p.turnos;
    expect(mat!.periodos.map((x) => x.horaInicio)).toEqual(['07:00', '07:50', '08:40', '09:50', '10:40', '11:30']);
    expect(vesp!.periodos.at(-1)).toMatchObject({ horaInicio: '18:05', horaFin: '19:05' }); // periodo de 60 min
    expect(p.conteos.sesiones).toBe(30 * 30);
    expect(p.conteos.coberturas).toBeGreaterThan(0);
    expect(p.conteos.salidas).toBeGreaterThan(0);
    expect(p.conteos.cambiosAsistencia).toBeGreaterThan(0);
  });

  it('la app lo restaura sin errores; marcado como DEMOSTRACIÓN, sin CCT, sin choques de horario y con SE confirmadas', async () => {
    const p = generarPiloto({ escala: 0.4, semanas: 1 });
    const e = nuevoEntorno();
    const a = await e.s.respaldos.analizar(p.contenido);
    expect(a.errores).toEqual([]);
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    const escuela = await e.s.escuelas.obtener(p.escuelaId);
    expect(escuela).toMatchObject({ nombre: ESCUELA_DEMO.nombre, nombreCorto: 'DEMO-001', cct: null, demostracion: true });
    expect(await e.s.revisionHorarios.conflictos(p.cicloId)).toEqual([]);
    const se = await e.s.prefectura.serviciosDelDia(p.cicloId, p.hoy);
    expect(JSON.stringify(se)).toContain('Servicio escolar');
    // Integridad: cada asistencia apunta a un pase y a un alumno inscrito en ese grupo.
    const datos = JSON.parse(p.contenido).datos as Record<string, Record<string, string>[]>;
    const pases = new Set(datos.pases!.map((x) => x.id));
    const inscrito = new Set(datos.inscripciones!.map((x) => `${x.alumnoId}:${x.grupoId}`));
    expect(datos.asistencias!.every((x) => pases.has(x.paseId!) && inscrito.has(`${x.alumnoId}:${x.grupoId}`))).toBe(true);
    // Nunca falta y salida del mismo alumno en la misma clase.
    const faltas = new Set(datos.asistencias!.filter((x) => x.marca === 'F').map((x) => `${x.alumnoId}:${x.fecha}:${datos.pases!.find((q) => q.id === x.paseId)!.sesionId}`));
    expect(datos.salidas!.some((s) => faltas.has(`${s.alumnoId}:${s.fecha}:${s.sesionId}`))).toBe(false);
  });

  it('editar la escuela de demostración no exige ni admite CCT, y la marca no se puede quitar desde la interfaz', async () => {
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    const e = nuevoEntorno();
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    const ed = await e.s.escuelas.actualizar(p.escuelaId, { nombre: ESCUELA_DEMO.nombre, nombreCorto: 'DEMO-001', cct: '', nivel: 'secundaria', localidad: 'Localidad ficticia 2' }, true);
    expect(ed).toMatchObject({ localidad: 'Localidad ficticia 2', demostracion: true, cct: null });
    await expect(e.s.escuelas.actualizar(p.escuelaId, { nombre: ESCUELA_DEMO.nombre, cct: '32ZZZ0001D', nivel: 'secundaria', entidad: '32', localidad: 'X' }, true)).rejects.toThrow(/no lleva CCT/);
    // Una escuela creada desde la interfaz nunca es de demostración, aunque se intente.
    const real = await e.s.escuelas.crear({ nombre: 'Escuela Ficticia Normal', cct: '32ZZZ0003C', nivel: 'secundaria', entidad: '32', localidad: 'X', demostracion: true } as never, true);
    expect(real.demostracion).toBe(false);
    // Y sigue exigiendo CCT.
    await expect(e.s.escuelas.actualizar(real.id, { nombre: 'Escuela Ficticia Normal', cct: '', nivel: 'secundaria', entidad: '32', localidad: 'X' }, true)).rejects.toThrow(/CCT es obligatoria/);
  });
});

describe('limpieza segura del piloto', () => {
  it('quita SÓLO la escuela de demostración (con todos sus registros) y nunca una escuela real', async () => {
    const e = nuevoEntorno();
    const { escuela: real } = await escuelaConCiclo(e.s);
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    await e.s.panel.fijarPerfil(p.docente.id);

    await expect(e.s.respaldos.quitarDemostracion(real.id)).rejects.toThrow(/Sólo se pueden quitar escuelas de demostración/);
    const r = await e.s.respaldos.quitarDemostracion(p.escuelaId);
    expect(r.registros).toBe(Object.values(p.conteos).reduce((a, b) => a + b, 0));
    expect((await e.s.escuelas.listar()).map((x) => x.id)).toEqual([real.id]);
    expect(await e.s.ciclos.listar(real.id)).toHaveLength(1);
    expect(await e.s.panel.perfil()).toBeNull(); // la preferencia apuntaba a un docente ficticio
    for (const t of ['alumnos', 'asistencias', 'pases', 'personal'] as const) expect(await e.db.table(t).filter((x: { escuelaId: string }) => x.escuelaId === p.escuelaId).count()).toBe(0);
  });

  it('no quita una escuela de demostración que se sincroniza con el servidor', async () => {
    const e = nuevoEntorno();
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    await e.db.vinculos.add({ escuelaId: p.escuelaId } as never);
    await expect(e.s.respaldos.quitarDemostracion(p.escuelaId)).rejects.toThrow(/se sincroniza/);
    expect(await e.s.escuelas.obtener(p.escuelaId)).toBeTruthy();
  });

  it('la versión 13 marca las escuelas existentes como NO de demostración (sin perder datos)', async () => {
    const nombre = `v12-${Date.now()}`;
    const { default: Dexie } = await import('dexie');
    const v12 = new Dexie(nombre);
    v12.version(12).stores({ escuelas: 'id' });
    await v12.open();
    await v12.table('escuelas').add({ id: 'e1', nombre: 'Escuela Ficticia Antigua', cct: '32ZZZ0004D', creadoEn: 'x', actualizadoEn: 'x', version: 1 });
    v12.close();
    const db = new BaseDatosEscolar(nombre);
    await db.open();
    expect(db.verno).toBe(VERSION_ESQUEMA);
    expect(await db.table('escuelas').get('e1')).toMatchObject({ nombre: 'Escuela Ficticia Antigua', cct: '32ZZZ0004D', demostracion: false });
    db.close();
  });
});

describe('PIL-HOR-02 · integridad entre vistas de horario (DEMO-001)', () => {
  it('confirmado → no se cambia sin reabrir; docente ocupado → choque detectado; cambio válido se refleja en grupo y en ambos docentes', async () => {
    const p = generarPiloto({ escala: 0.2, semanas: 1 });
    const e = nuevoEntorno();
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    const grupo = p.docente.grupoId;
    const asig = (await e.s.asignaciones.listarPorGrupo(grupo)).find((a) => a.personalId === p.docente.id)!;
    // 1. Horario confirmado: bloqueado
    await expect(e.s.asignaciones.actualizar(asig.id, { personalId: p.docenteAusente.id, horasSemana: 5 })).rejects.toThrow(/confirmad/i);
    await e.s.confirmacion.reabrir(grupo, 'Cambio de docente (prueba piloto ficticia)');
    // 2. El docente de Ciencias da clase en 2° A justo a las horas de Matemáticas de 1° A: choque por hora real
    await expect(e.s.asignaciones.actualizar(asig.id, { personalId: p.docenteAusente.id, horasSemana: 5 })).rejects.toMatchObject({ codigo: 'TRASLAPE' });
    expect(await e.s.revisionHorarios.conflictos(p.cicloId)).toEqual([]); // nada quedó a medias
    // 3. Un docente sin clases (de SE) del mismo turno… cuya SE no choque: se busca uno compatible
    const candidatos = (await e.s.personal.listar(p.escuelaId)).filter((x) => x.funciones.includes('docente'));
    let nuevo: string | null = null;
    for (const c of candidatos) {
      if (c.id === p.docente.id) continue;
      try { await e.s.asignaciones.actualizar(asig.id, { personalId: c.id, horasSemana: 5 }); nuevo = c.id; break; } catch { /* ocupado: se prueba otro */ }
    }
    expect(nuevo).not.toBeNull();
    const semanaGrupo = JSON.stringify(await e.s.vistas.semanaGrupo(grupo));
    expect(semanaGrupo).toContain(nuevo!);
    const antes = (await e.s.vistas.semanaDocente(p.docente.id, p.cicloId)).totales;
    const despues = (await e.s.vistas.semanaDocente(nuevo!, p.cicloId)).totales;
    expect(JSON.stringify(despues)).not.toBe('{}');
    expect((await e.s.asignaciones.horarioDocente(p.docente.id, p.cicloId)).some((f) => JSON.stringify(f).includes(grupo))).toBe(false);
    expect((await e.s.asignaciones.horarioDocente(nuevo!, p.cicloId)).some((f) => JSON.stringify(f).includes(grupo))).toBe(true);
    expect(await e.s.revisionHorarios.conflictos(p.cicloId)).toEqual([]);
    expect((await e.s.confirmacion.bitacora(grupo)).map((b) => b.accion)).toContain('reabrir');
    void antes;
  });
});

describe('recordatorio de respaldo rápido (debeRecordar)', () => {
  it('da lo mismo que estado().recordar: vacía, con datos sin respaldo, respaldo reciente, respaldo viejo con y sin cambios', async () => {
    const e = nuevoEntorno();
    const igual = async (id: string, ahora: Date) => expect(await e.s.respaldos.debeRecordar(id, ahora)).toBe((await e.s.respaldos.estado(id, ahora)).recordar);
    const sola = await e.s.escuelas.crear({ nombre: 'Escuela Ficticia Sola', cct: '32ZZZ0011A', nivel: 'secundaria' });
    await igual(sola.id, new Date());
    const p = generarPiloto({ escala: 0.1, semanas: 1 });
    await e.s.respaldos.restaurar(p.contenido, [p.escuelaId]);
    await igual(p.escuelaId, new Date());
    expect(await e.s.respaldos.debeRecordar(p.escuelaId, new Date())).toBe(true);
    await e.s.respaldos.registrarRespaldo([p.escuelaId]);
    await igual(p.escuelaId, new Date());
    const enUnMes = new Date(Date.now() + 30 * 86_400_000);
    await igual(p.escuelaId, enUnMes); // respaldo viejo y sin cambios después
    await e.s.panel.fijarPerfil(p.docente.id); // (ajuste: no cuenta como dato escolar)
    await e.s.grados.crearGrado(p.cicloId, { numero: 4, nombre: 'Cuarto grado ficticio' }).catch(() => undefined);
    await igual(p.escuelaId, enUnMes);
  });
});
