import type { FuncionPersonal, Personal } from '../models';
import { esquemaPersonal, validar, type EntradaPersonal } from '../validators/esquemas';
import { asegurarSinDuplicado } from '../domain/reglas';
import { ErrorDominio } from '../domain/errores';
import { type Contexto, metadatosActualizados, metadatosNuevos, requerir } from './contexto';

export const ETIQUETA_FUNCION: Record<FuncionPersonal, string> = {
  docente: 'Docente',
  directivo: 'Directivo',
  administrativo: 'Administrativo',
  prefectura: 'Prefectura',
  apoyo: 'Apoyo educativo',
};

export function nombreCompleto(p: Pick<Personal, 'nombre' | 'primerApellido' | 'segundoApellido'>): string {
  return [p.nombre, p.primerApellido, p.segundoApellido].filter(Boolean).join(' ');
}

export class ServicioPersonal {
  constructor(private readonly ctx: Contexto) {}

  async listar(escuelaId: string): Promise<Personal[]> {
    const lista = await this.ctx.repos.personal.listarPor('escuelaId', escuelaId);
    return lista.sort((a, b) => Number(b.activo) - Number(a.activo)
      || `${a.primerApellido} ${a.nombre}`.localeCompare(`${b.primerApellido} ${b.nombre}`, 'es'));
  }

  /** Personal activo con función docente (para asignar materias). */
  async docentes(escuelaId: string): Promise<Personal[]> {
    return (await this.listar(escuelaId)).filter((p) => p.activo && p.funciones.includes('docente'));
  }

  async obtener(id: string): Promise<Personal> {
    return requerir(this.ctx.repos.personal.obtener(id), 'a la persona');
  }

  async crear(escuelaId: string, entrada: EntradaPersonal): Promise<Personal> {
    const datos = validar(esquemaPersonal, entrada);
    return this.ctx.uow.ejecutar(async () => {
      await requerir(this.ctx.repos.escuelas.obtener(escuelaId), 'la escuela');
      await this.verificarDuplicados(escuelaId, datos, undefined);
      const p: Personal = { ...metadatosNuevos(this.ctx), escuelaId, ...datos, activo: true };
      await this.ctx.repos.personal.insertar(p);
      return p;
    });
  }

  async actualizar(id: string, entrada: EntradaPersonal): Promise<Personal> {
    const datos = validar(esquemaPersonal, entrada);
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      await this.verificarDuplicados(actual.escuelaId, datos, id);
      if (actual.funciones.includes('docente') && !datos.funciones.includes('docente')) {
        const n = await this.asignacionesVigentes(id);
        if (n > 0) {
          const mensaje = `Tiene ${n} materia(s) asignada(s) en ciclos abiertos. Reasígnalas antes de quitarle la función de docente.`;
          throw new ErrorDominio('TIENE_DEPENDENCIAS', mensaje, [{ campo: 'funciones', mensaje }]);
        }
      }
      const p: Personal = { ...actual, ...datos, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.personal.actualizar(p);
      return p;
    });
  }

  /** Dar de baja conserva el historial; sólo se impide si tiene clases en ciclos abiertos. */
  async cambiarActivo(id: string, activo: boolean): Promise<Personal> {
    return this.ctx.uow.ejecutar(async () => {
      const actual = await this.obtener(id);
      if (!activo) {
        const n = await this.asignacionesVigentes(id);
        if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Tiene ${n} materia(s) asignada(s) en ciclos abiertos. Reasígnalas antes de darle de baja.`);
      }
      const p: Personal = { ...actual, activo, ...metadatosActualizados(this.ctx, actual) };
      await this.ctx.repos.personal.actualizar(p);
      return p;
    });
  }

  /** Sólo se elimina a quien nunca tuvo asignaciones; si las tuvo, se da de baja. */
  async eliminar(id: string): Promise<void> {
    return this.ctx.uow.ejecutar(async () => {
      await this.obtener(id);
      const n = await this.ctx.repos.asignaciones.contarPor('personalId', id);
      if (n > 0) throw new ErrorDominio('TIENE_DEPENDENCIAS', `Tiene ${n} asignación(es) registradas. Para conservar el historial, dale de baja en lugar de eliminarla.`);
      await this.ctx.repos.personal.eliminar(id);
    });
  }

  private async asignacionesVigentes(personalId: string): Promise<number> {
    const asignaciones = await this.ctx.repos.asignaciones.listarPor('personalId', personalId);
    let n = 0;
    for (const a of asignaciones) {
      const ciclo = await this.ctx.repos.ciclos.obtener(a.cicloEscolarId);
      if (ciclo && ciclo.estado !== 'cerrado') n++;
    }
    return n;
  }

  private async verificarDuplicados(escuelaId: string, datos: { nombre: string; primerApellido: string; segundoApellido: string | null; numeroEmpleado: string | null }, idActual?: string) {
    const lista = await this.ctx.repos.personal.listarPor('escuelaId', escuelaId);
    if (datos.numeroEmpleado) {
      asegurarSinDuplicado(lista.filter((p) => p.numeroEmpleado), (p) => p.numeroEmpleado ?? '', datos.numeroEmpleado, idActual, 'numeroEmpleado',
        'Ya existe una persona con ese número de empleado.');
    } else {
      asegurarSinDuplicado(lista.filter((p) => !p.numeroEmpleado), nombreCompleto, nombreCompleto(datos), idActual, 'nombre',
        'Ya existe una persona con ese nombre completo. Si son personas distintas, agrega el número de empleado.');
    }
  }
}
