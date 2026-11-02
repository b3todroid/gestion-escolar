import { describe, expect, it } from 'vitest';
import { aMinutos, duracionMinutos, esHoraValida, estaDentro, seTraslapan } from '../../src/domain/tiempo';

describe('tiempo', () => {
  it('valida el formato HH:MM de 24 horas', () => {
    expect(esHoraValida('07:00')).toBe(true);
    expect(esHoraValida('23:59')).toBe(true);
    expect(esHoraValida('24:00')).toBe(false);
    expect(esHoraValida('7:00')).toBe(false);
    expect(esHoraValida('07:60')).toBe(false);
  });

  it('convierte a minutos y calcula duraciones', () => {
    expect(aMinutos('07:30')).toBe(450);
    expect(duracionMinutos('07:00', '07:50')).toBe(50);
    expect(() => aMinutos('xx')).toThrow(RangeError);
  });

  it('detecta traslapes de periodos', () => {
    const a = { horaInicio: '07:00', horaFin: '07:50' };
    expect(seTraslapan(a, { horaInicio: '07:40', horaFin: '08:30' })).toBe(true);
    expect(seTraslapan(a, { horaInicio: '06:30', horaFin: '08:00' })).toBe(true); // contiene
    expect(seTraslapan(a, { horaInicio: '07:10', horaFin: '07:20' })).toBe(true); // contenido
  });

  it('periodos contiguos no se traslapan', () => {
    expect(seTraslapan({ horaInicio: '07:00', horaFin: '07:50' }, { horaInicio: '07:50', horaFin: '08:40' })).toBe(false);
  });

  it('verifica que un bloque quede dentro de la jornada', () => {
    const j = { horaInicio: '07:00', horaFin: '13:00' };
    expect(estaDentro({ horaInicio: '07:00', horaFin: '13:00' }, j)).toBe(true);
    expect(estaDentro({ horaInicio: '06:59', horaFin: '07:30' }, j)).toBe(false);
    expect(estaDentro({ horaInicio: '12:30', horaFin: '13:01' }, j)).toBe(false);
  });
});
