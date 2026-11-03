import type { PlantillaImportacion } from '../models';
import { esquemaPlantillaImportacion, validar, type EntradaPlantillaImportacion } from '../validators/esquemas';
import { normalizarTexto } from '../domain/texto';
import { type Contexto, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

/**
 * Plantillas de reconocimiento por escuela (horario por docente, por grupo,
 * listas de alumnos, tablas generales…). Las columnas se recuerdan por NOMBRE
 * de encabezado, así que sirven aunque el orden cambie entre documentos.
 */
export class ServicioPlantillasImportacion {
  constructor(private readonly ctx: Contexto) {}

  async listar(escuelaId: string, tipo?: PlantillaImportacion['tipo']): Promise<PlantillaImportacion[]> {
    return (await this.ctx.repos.plantillasImportacion.listarPor('escuelaId', escuelaId))
      .filter((p) => !tipo || p.tipo === tipo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async guardar(escuelaId: string, entrada: EntradaPlantillaImportacion): Promise<PlantillaImportacion> {
    const d = validar(esquemaPlantillaImportacion, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await requerir(this.ctx.repos.escuelas.obtener(escuelaId), 'la escuela');
      const existentes = await this.listar(escuelaId);
      const columnas = d.columnas.map((c) => ({ encabezado: normalizarTexto(c.encabezado), campo: c.campo }));
      const igual = existentes.find((p) => normalizarTexto(p.nombre) === normalizarTexto(d.nombre));
      if (igual) { // mismo nombre: se actualiza (no se duplica)
        const n: PlantillaImportacion = { ...igual, ...d, columnas, ...metadatosActualizados(this.ctx, igual) };
        await this.ctx.repos.plantillasImportacion.actualizar(n);
        return n;
      }
      const p: PlantillaImportacion = { ...metadatosNuevos(this.ctx), escuelaId, ...d, columnas };
      await this.ctx.repos.plantillasImportacion.insertar(p);
      return p;
    });
  }

  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await requerir(this.ctx.repos.plantillasImportacion.obtener(id), 'la plantilla');
      await this.ctx.repos.plantillasImportacion.eliminar(id);
    });
  }
}

/** Aplica una plantilla a unos encabezados: por nombre normalizado; los no reconocidos quedan sin asignar. */
export function mapeoDesdePlantilla(p: Pick<PlantillaImportacion, 'columnas'>, encabezados: string[]): (string | null)[] {
  const por = new Map(p.columnas.map((c) => [c.encabezado, c.campo]));
  return encabezados.map((e) => por.get(normalizarTexto(e)) ?? null);
}
