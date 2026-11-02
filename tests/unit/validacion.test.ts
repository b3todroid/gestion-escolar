import { describe, expect, it } from 'vitest';
import {
  esquemaBloque, esquemaCiclo, esquemaEscuela, esquemaGrado, esquemaGrupo, esquemaTurnoConJornada, validar,
} from '../../src/validators/esquemas';
import { ErrorDominio } from '../../src/domain/errores';

function errores(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDominio) return e.campos.map((c) => c.campo);
    throw e;
  }
  return [];
}

describe('validación de escuela', () => {
  it('recorta textos, normaliza la clave y convierte vacíos en null', () => {
    const r = validar(esquemaEscuela, { nombre: '  Escuela Ejemplo  ', cct: ' 32zzz0000a ', nivel: 'secundaria', localidad: '   ' });
    expect(r).toEqual({ nombre: 'Escuela Ejemplo', cct: '32ZZZ0000A', nivel: 'secundaria', localidad: null });
  });

  it('rechaza nombre corto, nivel inválido y clave con símbolos', () => {
    expect(errores(() => validar(esquemaEscuela, { nombre: 'ab', cct: '<script>', nivel: 'x' }))).toEqual(
      expect.arrayContaining(['nombre', 'cct', 'nivel']),
    );
  });

  it('valida la CCT con el formato oficial (entidad 01–32, 3 letras, 4 dígitos, 1 letra)', () => {
    const cct = (v: string) => validar(esquemaEscuela, { nombre: 'Escuela Ejemplo', nivel: 'primaria', cct: v }).cct;
    expect(cct('32zzz-0001 a')).toBe('32ZZZ0001A'); // espacios y guiones se ignoran
    expect(cct('')).toBeNull();
    for (const mala of ['00ZZZ0001A', '33ZZZ0001A', '32ZZ0001A', '32ZZZ00011', '32ZZZ0001AB', '3ZZZZ0001A']) {
      expect(errores(() => cct(mala)), mala).toEqual(['cct']);
    }
  });

  it('acepta educación inicial como nivel', () => {
    expect(validar(esquemaEscuela, { nombre: 'Escuela Ejemplo', nivel: 'inicial' }).nivel).toBe('inicial');
  });

  it('rechaza caracteres de control', () => {
    expect(errores(() => validar(esquemaEscuela, { nombre: 'Escuela\u0000X', nivel: 'primaria' }))).toContain('nombre');
  });

  it('acepta texto con caracteres HTML como texto plano (se muestra con textContent)', () => {
    const r = validar(esquemaEscuela, { nombre: '<b>Escuela</b>', nivel: 'primaria' });
    expect(r.nombre).toBe('<b>Escuela</b>');
  });
});

describe('validación de ciclo, turno y bloques', () => {
  it('exige fecha de fin posterior a la de inicio', () => {
    expect(errores(() => validar(esquemaCiclo, { nombre: '2026-2027', fechaInicio: '2027-01-01', fechaFin: '2026-01-01' }))).toEqual(['fechaFin']);
    expect(errores(() => validar(esquemaCiclo, { nombre: '2026-2027', fechaInicio: '2026-02-30', fechaFin: '2027-01-01' }))).toEqual(['fechaInicio']);
  });

  it('exige horas válidas, fin posterior a inicio y al menos un día', () => {
    expect(errores(() => validar(esquemaTurnoConJornada, { nombre: 'Matutino', horaInicio: '13:00', horaFin: '07:00', dias: [1] }))).toEqual(['horaFin']);
    expect(errores(() => validar(esquemaTurnoConJornada, { nombre: 'Matutino', horaInicio: '7am', horaFin: '13:00', dias: [] }))).toEqual(
      expect.arrayContaining(['horaInicio', 'dias']),
    );
  });

  it('ordena y elimina días repetidos', () => {
    const r = validar(esquemaTurnoConJornada, { nombre: 'Matutino', horaInicio: '07:00', horaFin: '13:00', dias: [5, 1, 1, 3] });
    expect(r.dias).toEqual([1, 3, 5]);
  });

  it('rechaza bloques de duración cero', () => {
    expect(errores(() => validar(esquemaBloque, { nombre: 'Módulo 1', horaInicio: '07:00', horaFin: '07:00' }))).toEqual(['horaFin']);
  });
});

describe('validación de grado y grupo', () => {
  it('limita el número de grado', () => {
    expect(errores(() => validar(esquemaGrado, { numero: 0, nombre: 'X' }))).toEqual(['numero']);
    expect(errores(() => validar(esquemaGrado, { numero: 1.5, nombre: 'X' }))).toEqual(['numero']);
  });

  it('exige identificadores válidos y capacidad razonable', () => {
    expect(errores(() => validar(esquemaGrupo, { gradoId: '1° A', turnoId: 'x', nombre: 'A', capacidad: 500 }))).toEqual(
      expect.arrayContaining(['gradoId', 'turnoId', 'capacidad']),
    );
  });
});
