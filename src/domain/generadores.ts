/**
 * Generadores puros: convierten unos pocos parámetros en la lista completa
 * de bloques o grupos, para no capturar cada uno a mano.
 */
import { ErrorDominio } from './errores';
import { aMinutos, desdeMinutos } from './tiempo';

export interface RecesoPlantilla {
  despuesDe: number; // número de módulo tras el cual ocurre
  duracion: number; // minutos
}

export interface PlantillaHorario {
  horaInicio: string; // inicio de la jornada
  horaFin: string; // fin de la jornada
  duracionModulo: number; // minutos
  modulos: number;
  recesos: readonly RecesoPlantilla[];
}

export interface BloquePropuesto {
  tipo: 'periodo' | 'receso';
  nombre: string;
  horaInicio: string;
  horaFin: string;
}

/** Módulos consecutivos desde el inicio de la jornada, intercalando los recesos indicados. */
export function generarBloques(p: PlantillaHorario): BloquePropuesto[] {
  const bloques: BloquePropuesto[] = [];
  const fin = aMinutos(p.horaFin);
  let t = aMinutos(p.horaInicio);
  let numReceso = 0;
  const totalRecesos = p.recesos.length;
  const agregar = (tipo: BloquePropuesto['tipo'], nombre: string, duracion: number) => {
    bloques.push({ tipo, nombre, horaInicio: desdeMinutos(t), horaFin: desdeMinutos(t + duracion) });
    t += duracion;
  };
  for (let m = 1; m <= p.modulos; m++) {
    agregar('periodo', `Módulo ${m}`, p.duracionModulo);
    for (const r of p.recesos.filter((x) => x.despuesDe === m)) {
      numReceso++;
      agregar('receso', totalRecesos > 1 ? `Receso ${numReceso}` : 'Receso', r.duracion);
    }
  }
  if (t > fin) {
    const mensaje = `Los bloques terminan a las ${desdeMinutos(t)}, después de la salida (${p.horaFin}). Reduce la duración o el número de módulos, o amplía la jornada.`;
    throw new ErrorDominio('FUERA_DE_JORNADA', mensaje, [{ campo: 'modulos', mensaje }]);
  }
  return bloques;
}

/** A, B, …, Z, AA, AB, … (sin límite de 26). */
export function letraGrupo(indice: number): string {
  let n = indice + 1; let r = '';
  while (n > 0) { const m = (n - 1) % 26; r = String.fromCharCode(65 + m) + r; n = Math.floor((n - 1) / 26); }
  return r;
}

/** Nombres de grupo consecutivos: A, B, C… */
export function nombresGrupos(cantidad: number): string[] {
  return Array.from({ length: Math.max(0, cantidad) }, (_, i) => letraGrupo(i));
}

/** Número de grados habitual por nivel; es sólo una sugerencia editable. */
export function gradosSugeridos(nivel: string): number {
  return nivel === 'primaria' ? 6 : 3;
}
