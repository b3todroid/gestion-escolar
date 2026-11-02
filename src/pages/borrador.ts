/**
 * Borrador del asistente en localStorage: comodidad por dispositivo para no
 * perder lo capturado si se recarga la página. No es la fuente de verdad
 * (eso es IndexedDB) y se descarta al guardar. Todo acceso va en try/catch
 * porque el almacenamiento puede no estar disponible (modo privado, bloqueos).
 */
import type { EntradaAsistente } from '../validators/esquemas';
import { gradosSugeridos } from '../domain/generadores';
import { sugerenciaCiclo } from './escuela';

const CLAVE = 'gestion-escolar:asistente:v1';

export interface Borrador {
  paso: number;
  datos: EntradaAsistente;
}

export function borradorNuevo(): Borrador {
  return {
    paso: 0,
    datos: {
      escuela: { nombre: '', cct: '', nivel: 'secundaria', localidad: '' },
      ciclo: { ...sugerenciaCiclo(), enCurso: true },
      turno: { nombre: '', horaInicio: '07:00', horaFin: '13:00', dias: [1, 2, 3, 4, 5] },
      horario: { duracionModulo: 50, modulos: 6, recesos: [{ despuesDe: 3, duracion: 30 }] },
      grados: { gradoDesde: 1, gradoHasta: gradosSugeridos('secundaria'), gruposPorGrado: 2, capacidad: null },
    },
  };
}

export function leerBorrador(): Borrador | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as Borrador;
    // Estructura mínima; los valores se validan con Zod al avanzar y al guardar.
    if (typeof b?.paso !== 'number' || !b.datos?.escuela || !b.datos.horario) return null;
    return b;
  } catch {
    return null;
  }
}

export function guardarBorrador(b: Borrador): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(b)); } catch { /* sin almacenamiento: el asistente sigue funcionando */ }
}

export function descartarBorrador(): void {
  try { localStorage.removeItem(CLAVE); } catch { /* nada que hacer */ }
}
