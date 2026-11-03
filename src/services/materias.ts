import type { Materia } from '../models';
import { esquemaMateria, esquemaMateriasLote, validar, type EntradaMateria } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { type Contexto, cicloEditable, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export class ServicioMaterias {
  constructor(private readonly ctx: Contexto) {}

  async listar(cicloId: string): Promise<Materia[]> {
    const lista = await this.ctx.repos.materias.listarPor('cicloEscolarId', cicloId);
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async crear(cicloId: string, entrada: EntradaMateria): Promise<Materia> {
    const datos = validar(esquemaMateria, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const ciclo = await cicloEditable(this.ctx, cicloId);
      await this.verificar(cicloId, datos, undefined);
      const m: Materia = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, ...datos };
      await this.ctx.repos.materias.insertar(m);
      return m;
    });
  }

  /** Alta de varias materias a la vez (una por renglón). Todo o nada. */
  async crearVarias(cicloId: string, textoLote: string): Promise<Materia[]> {
    const nombres = validar(esquemaMateriasLote, textoLote);
    const vistos = new Set<string>();
    for (const n of nombres) {
      const clave = normalizarTexto(n);
      if (vistos.has(clave)) {
        const mensaje = `«${n}» está repetida en la lista.`;
        throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: 'lote', mensaje }]);
      }
      vistos.add(clave);
    }
    return this.ctx.uow.ejecutar(async () => {
      const creadas: Materia[] = [];
      for (const nombre of nombres) {
        try {
          creadas.push(await this.crear(cicloId, { nombre }));
        } catch (e) {
          if (e instanceof ErrorDominio && e.codigo === 'DUPLICADO') {
            throw new ErrorDominio('DUPLICADO', `«${nombre}» ya existe en este ciclo. Quítala de la lista.`, [{ campo: 'lote', mensaje: `«${nombre}» ya existe en este ciclo.` }]);
          }
          throw e;
        }
      }
      return creadas;
    });
  }

  async actualizar(id: string, entrada: EntradaMateria): Promise<Materia> {
    const datos = validar(esquemaMateria, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.materias.obtener(id), 'la materia');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      await this.verificar(actual.cicloEscolarId, datos, id);
      const m: Materia = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.materias.actualizar(m);
      return m;
    });
  }

  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await requerir(this.ctx.repos.materias.obtener(id), 'la materia');
      await cicloEditable(this.ctx, actual.cicloEscolarId);
      const n = await this.ctx.repos.asignaciones.contarPor('materiaId', id);
      if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `La materia está asignada a ${n} grupo(s). Quita esas asignaciones primero.`);
      await this.ctx.repos.materias.eliminar(id);
    });
  }

  private async verificar(cicloId: string, datos: { nombre: string; abreviatura: string | null }, idActual?: string) {
    const lista = await this.ctx.repos.materias.listarPor('cicloEscolarId', cicloId);
    asegurarSinDuplicado(lista, (m) => m.nombre, datos.nombre, idActual, 'nombre', 'Ya existe una materia con ese nombre en este ciclo.');
    if (datos.abreviatura) {
      asegurarSinDuplicado(lista.filter((m) => m.abreviatura), (m) => m.abreviatura ?? '', datos.abreviatura, idActual, 'abreviatura', 'Otra materia ya usa esa abreviatura.');
    }
  }
}
