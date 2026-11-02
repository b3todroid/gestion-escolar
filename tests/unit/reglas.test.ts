import { describe, expect, it } from 'vitest';
import { asegurarSinDuplicado, puedeCambiarEstado, rangosFechaSeTraslapan, validarBloqueEnJornada } from '../../src/domain/reglas';
import { normalizarTexto } from '../../src/domain/texto';

describe('reglas de negocio', () => {
  it('normaliza acentos, mayúsculas y espacios', () => {
    expect(normalizarTexto('  Matutíno   Uno ')).toBe('matutino uno');
  });

  it('detecta duplicados normalizados y permite editar el mismo registro', () => {
    const lista = [{ id: '1', nombre: 'Vespertino' }];
    expect(() => asegurarSinDuplicado(lista, (x) => x.nombre, ' vespertíno', undefined, 'nombre', 'dup')).toThrow('dup');
    expect(() => asegurarSinDuplicado(lista, (x) => x.nombre, 'VESPERTINO', '1', 'nombre', 'dup')).not.toThrow();
  });

  it('sólo permite transiciones válidas del ciclo', () => {
    expect(puedeCambiarEstado('planeacion', 'activo')).toBe(true);
    expect(puedeCambiarEstado('activo', 'cerrado')).toBe(true);
    expect(puedeCambiarEstado('cerrado', 'activo')).toBe(false);
    expect(puedeCambiarEstado('activo', 'planeacion')).toBe(false);
  });

  it('detecta traslape de rangos de fechas', () => {
    expect(rangosFechaSeTraslapan({ fechaInicio: '2026-08-01', fechaFin: '2027-07-15' }, { fechaInicio: '2027-07-15', fechaFin: '2028-07-01' })).toBe(true);
    expect(rangosFechaSeTraslapan({ fechaInicio: '2026-08-01', fechaFin: '2027-07-15' }, { fechaInicio: '2027-07-16', fechaFin: '2028-07-01' })).toBe(false);
  });

  it('valida bloques contra la jornada y entre sí', () => {
    const jornada = { horaInicio: '07:00', horaFin: '13:00' };
    const otros = [{ id: 'r', nombre: 'Receso', tipo: 'receso' as const, horaInicio: '10:00', horaFin: '10:30' }];
    const b = (horaInicio: string, horaFin: string) => ({ id: 'n', nombre: 'M', tipo: 'periodo' as const, horaInicio, horaFin });
    expect(() => validarBloqueEnJornada(b('06:30', '07:20'), jornada, otros)).toThrow(/dentro de la jornada/);
    expect(() => validarBloqueEnJornada(b('09:30', '10:10'), jornada, otros)).toThrow(/receso «Receso»/);
    expect(() => validarBloqueEnJornada(b('09:10', '10:00'), jornada, otros)).not.toThrow();
  });
});
