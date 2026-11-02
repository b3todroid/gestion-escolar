import type { CicloEscolar, Escuela, Turno } from '../models';
import {
  esquemaCicloAsistente, esquemaEscuela, esquemaGradosGrupos, esquemaPlantillaHorario, esquemaTurnoConJornada, validar,
  type EntradaAsistente,
} from '../validators/esquemas';
import { generarBloques, nombresGrupos, type BloquePropuesto } from '../domain/generadores';
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
  previsualizarBloques(entrada: Pick<EntradaAsistente, 'turno' | 'horario'>): BloquePropuesto[] {
    const turno = validar(esquemaTurnoConJornada, entrada.turno);
    const horario = validar(esquemaPlantillaHorario, entrada.horario);
    return generarBloques({ ...horario, horaInicio: turno.horaInicio, horaFin: turno.horaFin });
  }

  /** Valida un paso del asistente antes de avanzar (incluye duplicados de escuela). */
  async validarPaso(paso: 'escuela' | 'ciclo' | 'turno' | 'horario' | 'grados', entrada: EntradaAsistente): Promise<void> {
    switch (paso) {
      case 'escuela': return this.s.escuelas.validarNueva(entrada.escuela);
      case 'ciclo': validar(esquemaCicloAsistente, entrada.ciclo); return;
      case 'turno': validar(esquemaTurnoConJornada, entrada.turno); return;
      case 'horario': this.previsualizarBloques(entrada); return;
      case 'grados': validar(esquemaGradosGrupos, entrada.grados); return;
    }
  }

  crearEscuelaCompleta(entrada: EntradaAsistente): Promise<ResultadoAsistente> {
    // Validación completa antes de abrir la transacción.
    validar(esquemaEscuela, entrada.escuela);
    validar(esquemaCicloAsistente, entrada.ciclo);
    const bloques = this.previsualizarBloques(entrada);
    const gg = validar(esquemaGradosGrupos, entrada.grados);

    return this.ctx.uow.ejecutar(async () => {
      const escuela = await this.s.escuelas.crear(entrada.escuela);
      const { enCurso, ...datosCiclo } = entrada.ciclo;
      let ciclo = await this.s.ciclos.crear(escuela.id, datosCiclo);
      if (enCurso) ciclo = await this.s.ciclos.cambiarEstado(ciclo.id, 'activo');
      const { turno, jornada } = await this.s.turnos.crear(ciclo.id, entrada.turno);
      for (const b of bloques) {
        await this.s.horario.crear(b.tipo, jornada.id, { nombre: b.nombre, horaInicio: b.horaInicio, horaFin: b.horaFin });
      }
      let grupos = 0;
      for (let n = gg.gradoDesde; n <= gg.gradoHasta; n++) {
        const grado = await this.s.grados.crearGrado(ciclo.id, { numero: n, nombre: nombreSugeridoGrado(n) });
        for (const nombre of nombresGrupos(gg.gruposPorGrado)) {
          await this.s.grados.crearGrupo(ciclo.id, { gradoId: grado.id, turnoId: turno.id, nombre, capacidad: gg.capacidad });
          grupos++;
        }
      }
      return { escuela, ciclo, turno, bloques: bloques.length, grados: gg.gradoHasta - gg.gradoDesde + 1, grupos };
    });
  }
}
