import { describe, expect, it } from 'vitest';
import { esquemaDatosPlantel, validar, type EntradaAsistente } from '../../src/validators/esquemas';
import { ErrorDominio } from '../../src/domain/errores';
import { letraGrupo } from '../../src/domain/generadores';
import { nuevoEntorno } from './ayudantes';

// Datos ficticios.
const PLANTEL = { nombre: 'Escuela Secundaria Ficticia 150', cct: '32ZZZ0150A', nivel: 'secundaria' as const, entidad: '32', localidad: 'Municipio Ejemplo' };
const ENTRADA: EntradaAsistente = {
  escuela: PLANTEL,
  ciclo: { nombre: '2026-2027', fechaInicio: '2026-08-31', fechaFin: '2027-07-15', enCurso: true },
  turno: { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
  horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
  grados: { gradoDesde: 1, gradoHasta: 3, gruposPorGrado: 2, capacidad: null },
};
const campos = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ErrorDominio) return e.campos.map((c) => `${c.campo}: ${c.mensaje}`); throw e; } return []; };

describe('datos del plantel', () => {
  it('CCT, entidad y municipio obligatorios; la CCT debe iniciar con la clave de la entidad', () => {
    expect(campos(() => validar(esquemaDatosPlantel, { nombre: 'Escuela Ejemplo', nivel: 'primaria' })).join(' | ')).toMatch(/cct: La CCT es obligatoria.*entidad: Selecciona.*localidad: El municipio/);
    expect(campos(() => validar(esquemaDatosPlantel, { ...PLANTEL, cct: '09ZZZ0150A' }))).toEqual([
      'cct: La CCT inicia con 09 (Ciudad de México), pero la entidad elegida es Zacatecas (32). Revisa la CCT o la entidad.',
    ]);
  });

  it('normaliza el teléfono, valida correo y sólo acepta logotipos rasterizados', () => {
    const r = validar(esquemaDatosPlantel, { ...PLANTEL, telefono: '+52 (492) 123-4567', correo: ' Direccion@Escuela.EDU.mx ', nombreCorto: 'Sec. 150', zonaEscolar: '12', sector: '3', logotipo: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(r).toMatchObject({ telefono: '4921234567', correo: 'direccion@escuela.edu.mx', nombreCorto: 'Sec. 150', zonaEscolar: '12', sector: '3' });
    expect(campos(() => validar(esquemaDatosPlantel, { ...PLANTEL, telefono: '12345' }))[0]).toMatch(/10 dígitos/);
    expect(campos(() => validar(esquemaDatosPlantel, { ...PLANTEL, correo: 'no-es-correo' }))[0]).toMatch(/correo válido/);
    expect(campos(() => validar(esquemaDatosPlantel, { ...PLANTEL, logotipo: 'data:image/svg+xml;base64,PHN2Zz4=' }))[0]).toMatch(/PNG, JPG o WebP/);
  });

  it('se editan los datos de la escuela con las mismas reglas', async () => {
    const { s } = nuevoEntorno();
    const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
    await expect(s.escuelas.actualizar(r.escuela.id, { ...PLANTEL, cct: '09ZZZ0150A' }, true)).rejects.toMatchObject({ codigo: 'VALIDACION' });
    const e = await s.escuelas.actualizar(r.escuela.id, { ...PLANTEL, nombreCorto: 'Sec. 150', domicilio: 'Calle Ficticia 1' }, true);
    expect(e).toMatchObject({ nombreCorto: 'Sec. 150', domicilio: 'Calle Ficticia 1', version: 2 });
  });
});

describe('asistente: periodos editados uno por uno', () => {
  const con = (bloques: NonNullable<EntradaAsistente['horario']['bloques']>) => ({ ...ENTRADA, horario: { ...ENTRADA.horario, bloques } });
  it('detecta traslapes, bloques fuera de la jornada y horarios inválidos', () => {
    const { s } = nuevoEntorno();
    expect(() => s.asistente.previsualizarBloques(con([
      { tipo: 'periodo', nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:50' },
      { tipo: 'periodo', nombre: 'Módulo 2', horaInicio: '07:40', horaFin: '08:30' },
    ]))).toThrow(/«Módulo 1»: Se traslapa con el periodo «Módulo 2»/);
    expect(() => s.asistente.previsualizarBloques(con([{ tipo: 'periodo', nombre: 'Módulo 1', horaInicio: '06:30', horaFin: '07:20' }]))).toThrow(/dentro de la jornada/);
    expect(() => s.asistente.previsualizarBloques(con([{ tipo: 'periodo', nombre: 'Módulo 1', horaInicio: '08:00', horaFin: '07:00' }]))).toThrow(/posterior a la de inicio/);
    expect(() => s.asistente.previsualizarBloques(con([{ tipo: 'receso', nombre: 'Receso', horaInicio: '09:00', horaFin: '09:30' }]))).toThrow(/al menos un periodo/);
  });

  it('guarda exactamente los periodos editados (de distinta duración) y varios recesos', async () => {
    const { s } = nuevoEntorno();
    const r = await s.asistente.crearEscuelaCompleta(con([
      { tipo: 'periodo', nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '08:00' },
      { tipo: 'receso', nombre: 'Receso 1', horaInicio: '08:00', horaFin: '08:15' },
      { tipo: 'periodo', nombre: 'Módulo 2', horaInicio: '08:15', horaFin: '09:00' },
      { tipo: 'receso', nombre: 'Receso 2', horaInicio: '10:00', horaFin: '10:20' },
    ]));
    const [t] = await s.turnos.listar(r.ciclo.id);
    expect((await s.horario.resumen(t!.jornada.id)).bloques.map((b) => `${b.tipo} ${b.horaInicio}-${b.horaFin}`)).toEqual([
      'periodo 07:00-08:00', 'receso 08:00-08:15', 'periodo 08:15-09:00', 'receso 10:00-10:20',
    ]);
  });
});

describe('asistente: grados y grupos personalizados', () => {
  it('distinto número de grupos por grado, sin límite de 26 y sin duplicados', async () => {
    expect([0, 25, 26, 27, 51, 52].map(letraGrupo)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
    const { s } = nuevoEntorno();
    const con = (personalizados: NonNullable<EntradaAsistente['grados']['personalizados']>) => ({ ...ENTRADA, grados: { ...ENTRADA.grados, personalizados } });
    expect(() => s.asistente.previsualizarGrados(con([{ numero: 1, nombre: 'Primer grado', grupos: ['A', ' a '] }]))).toThrow(/« a » está repetido|está repetido/);
    expect(() => s.asistente.previsualizarGrados(con([{ numero: 1, nombre: 'Primero', grupos: ['A'] }, { numero: 1, nombre: 'Otro', grupos: ['A'] }]))).toThrow(/grado 1 está repetido/);
    const r = await s.asistente.crearEscuelaCompleta(con([
      { numero: 1, nombre: 'Primer grado', grupos: ['A', 'B', 'C', 'D'] },
      { numero: 2, nombre: 'Segundo grado', grupos: ['A', 'B'] },
      { numero: 3, nombre: 'Tercer grado', grupos: ['Único'] },
    ]));
    expect(r).toMatchObject({ grados: 3, grupos: 7 });
    expect(await s.asistente.crearEscuelaCompleta({ ...ENTRADA, escuela: { ...PLANTEL, cct: '32ZZZ0151A', nombre: 'Escuela Ficticia 151' }, grados: { gradoDesde: 1, gradoHasta: 1, gruposPorGrado: 30, capacidad: null } })).toMatchObject({ grupos: 30 });
  });
});

describe('desactivar grupos', () => {
  it('se desactiva sin borrar; un grupo inactivo no recibe materias ni alumnos; con alumnos no se desactiva', async () => {
    const { s } = nuevoEntorno();
    const r = await s.asistente.crearEscuelaCompleta(ENTRADA);
    const [A, B] = (await s.grados.listarGrupos(r.ciclo.id)).filter((g) => g.nombre === 'A' || g.nombre === 'B');
    const g = await s.grados.cambiarActivoGrupo(A!.id, false);
    expect(g.activo).toBe(false);
    expect(await s.grados.listarGrupos(r.ciclo.id)).toHaveLength(6); // se conserva
    const [m] = await s.materias.crearVarias(r.ciclo.id, 'Matemáticas');
    await expect(s.asignaciones.crear(r.ciclo.id, { grupoId: A!.id, materiaId: m!.id, horasSemana: 5 })).rejects.toThrow('desactivado');
    await expect(s.alumnos.crear(A!.id, { nombre: 'Ana', primerApellido: 'Ficticia' })).rejects.toThrow('desactivado');
    await s.grados.cambiarActivoGrupo(A!.id, true);
    await expect(s.alumnos.crear(A!.id, { nombre: 'Ana', primerApellido: 'Ficticia' })).resolves.toBeDefined();
    await expect(s.grados.cambiarActivoGrupo(A!.id, false)).rejects.toThrow('alumno(s) activos');
    await s.asignaciones.crear(r.ciclo.id, { grupoId: B!.id, materiaId: m!.id, horasSemana: 5 });
    await expect(s.grados.cambiarActivoGrupo(B!.id, false)).rejects.toThrow('materia(s) asignada(s)');
  });
});
