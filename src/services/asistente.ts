import type { CicloEscolar, Escuela, Turno } from '../models';
import {
  esquemaBloquesPersonalizados, esquemaCicloAsistente, esquemaDatosPlantel, esquemaGradosGrupos, esquemaGradosPersonalizados, esquemaPlantillaHorario,
  esquemaTurnoConJornada, validar,
  type EntradaAsistente,
} from '../validators/esquemas';
import { generarBloques, nombresGrupos, type BloquePropuesto } from '../domain/generadores';
import { validarBloqueEnJornada } from '../domain/reglas';
import { compararPorInicio } from '../domain/tiempo';
import { normalizarTexto } from '../domain/texto';
import { ErrorDominio } from '../domain/errores';
import { nombreSugeridoGrado, type ServicioGrados } from './grados';
import type { Contexto } from './contexto';
import type { ServicioCiclos } from './ciclos';
import type { ServicioEscuelas } from './escuelas';
import type { ServicioHorario } from './horario';
import type { ServicioTurnos } from './turnos';

export interface ResultadoAsistente {
  escuela: Escuela;
  ciclo: CicloEscolar;
  turno: Turno;
  bloques: number;
  grados: number;
  grupos: number;
}

/**
 * Crea la configuración inicial completa de una escuela en UNA transacción:
 * si cualquier paso falla, no se guarda nada. Reutiliza los servicios
 * existentes, por lo que aplica exactamente las mismas reglas de negocio.
 */
export class ServicioAsistente {
  constructor(
    private readonly ctx: Contexto,
    private readonly s: { escuelas: ServicioEscuelas; ciclos: ServicioCiclos; turnos: ServicioTurnos; horario: ServicioHorario; grados: ServicioGrados },
  ) {}

  /** Vista previa de los bloques, sin guardar. */
  /**
   * Bloques de la jornada: generados (módulos + recesos) o, si la persona los
   * editó uno por uno, los suyos, validados dentro de la jornada y sin traslapes.
   */
  previsualizarBloques(entrada: Pick<EntradaAsistente, 'turno' | 'horario'>): BloquePropuesto[] {
    const turno = validar(esquemaTurnoConJornada, entrada.turno);
    if (entrada.horario.bloques) {
      const bloques = validar(esquemaBloquesPersonalizados, entrada.horario.bloques).map((b, i) => {
        if (b.horaInicio >= b.horaFin) {
          const mensaje = `«${b.nombre}»: la hora de fin debe ser posterior a la de inicio.`;
          throw new ErrorDominio('VALIDACION', mensaje, [{ campo: `bloques.${i}.horaFin`, mensaje }]);
        }
        return { ...b, id: String(i) };
      });
      if (!bloques.some((b) => b.tipo === 'periodo')) throw new ErrorDominio('VALIDACION', 'Agrega al menos un periodo de clase.');
      bloques.forEach((b, i) => {
        try { validarBloqueEnJornada(b, turno, bloques); }
        catch (e) { if (e instanceof ErrorDominio) throw new ErrorDominio(e.codigo, `«${b.nombre}»: ${e.message}`, [{ campo: `bloques.${i}.horaInicio`, mensaje: e.message }]); throw e; }
      });
      return [...bloques].sort(compararPorInicio).map(({ tipo, nombre, horaInicio, horaFin }) => ({ tipo, nombre, horaInicio, horaFin }));
    }
    const horario = validar(esquemaPlantillaHorario, entrada.horario);
    return generarBloques({ ...horario, horaInicio: turno.horaInicio, horaFin: turno.horaFin });
  }

  /** Grados con sus grupos: generados (del X al Y, G grupos) o personalizados. */
  previsualizarGrados(entrada: Pick<EntradaAsistente, 'grados'>): { numero: number; nombre: string; grupos: string[] }[] {
    if (entrada.grados.personalizados) {
      const lista = validar(esquemaGradosPersonalizados, entrada.grados.personalizados);
      const numeros = new Set<number>();
      lista.forEach((g, i) => {
        if (numeros.has(g.numero)) { const mensaje = `El grado ${g.numero} está repetido.`; throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: `personalizados.${i}.numero`, mensaje }]); }
        numeros.add(g.numero);
        const vistos = new Set<string>();
        for (const n of g.grupos) {
          const k = normalizarTexto(n);
          if (vistos.has(k)) { const mensaje = `${g.nombre}: el grupo «${n}» está repetido.`; throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: `personalizados.${i}.grupos`, mensaje }]); }
          vistos.add(k);
        }
      });
      const nombres = new Set<string>();
      for (const [i, g] of lista.entries()) {
        const k = normalizarTexto(g.nombre);
        if (nombres.has(k)) { const mensaje = `El nombre «${g.nombre}» está repetido.`; throw new ErrorDominio('DUPLICADO', mensaje, [{ campo: `personalizados.${i}.nombre`, mensaje }]); }
        nombres.add(k);
      }
      return [...lista].sort((a, b) => a.numero - b.numero);
    }
    const gg = validar(esquemaGradosGrupos, entrada.grados);
    return Array.from({ length: gg.gradoHasta - gg.gradoDesde + 1 }, (_, i) => {
      const n = gg.gradoDesde + i;
      return { numero: n, nombre: nombreSugeridoGrado(n), grupos: nombresGrupos(gg.gruposPorGrado) };
    });
  }

  async validarPaso(paso: 'escuela' | 'ciclo' | 'turno' | 'horario' | 'grados', entrada: EntradaAsistente): Promise<void> {
    switch (paso) {
      case 'escuela': return this.s.escuelas.validarNueva(entrada.escuela);
      case 'ciclo': validar(esquemaCicloAsistente, entrada.ciclo); return;
      case 'turno': validar(esquemaTurnoConJornada, entrada.turno); return;
      case 'horario': this.previsualizarBloques(entrada); return;
      case 'grados': validar(esquemaGradosGrupos, entrada.grados); this.previsualizarGrados(entrada); return;
    }
  }

  async crearEscuelaCompleta(entrada: EntradaAsistente): Promise<ResultadoAsistente> {
    // Validación completa antes de abrir la transacción.
    validar(esquemaDatosPlantel, entrada.escuela);
    validar(esquemaCicloAsistente, entrada.ciclo);
    const bloques = this.previsualizarBloques(entrada);
    const gg = validar(esquemaGradosGrupos, entrada.grados);
    const grados = this.previsualizarGrados(entrada);

    return this.ctx.uow.ejecutar(async () => {
      const escuela = await this.s.escuelas.crear(entrada.escuela, true);
      const { enCurso, ...datosCiclo } = entrada.ciclo;
      let ciclo = await this.s.ciclos.crear(escuela.id, datosCiclo);
      if (enCurso) ciclo = await this.s.ciclos.cambiarEstado(ciclo.id, 'activo');
      const { turno, jornada } = await this.s.turnos.crear(ciclo.id, entrada.turno);
      for (const b of bloques) {
        await this.s.horario.crear(b.tipo, jornada.id, { nombre: b.nombre, horaInicio: b.horaInicio, horaFin: b.horaFin });
      }
      let grupos = 0;
      for (const g of grados) {
        const grado = await this.s.grados.crearGrado(ciclo.id, { numero: g.numero, nombre: g.nombre });
        for (const nombre of g.grupos) {
          await this.s.grados.crearGrupo(ciclo.id, { gradoId: grado.id, turnoId: turno.id, nombre, capacidad: gg.capacidad });
          grupos++;
        }
      }
      return { escuela, ciclo, turno, bloques: bloques.length, grados: grados.length, grupos };
    });
  }
}
