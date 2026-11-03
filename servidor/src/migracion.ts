/**
 * Migración de una escuela del dispositivo al servidor (Fase 8E).
 * - ENSAYO: hace TODO (valida, inserta, vuelve a leer y compara la huella) y al final deshace. No deja nada.
 * - APLICAR: lo mismo, pero sólo con autorización registrada; todo o nada.
 * - REVERTIR: quita exactamente lo que agregó esa migración y devuelve la escuela del servidor a
 *   como estaba, sólo si nadie hizo cambios después (si no, se perderían).
 * Sólo el administrador de la escuela (con verificación en dos pasos). La escuela del servidor
 * debe tener la MISMA CCT y estar vacía: nunca se mezclan escuelas ni se fusionan datos.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { TABLAS_RESPALDO, type TablaRespaldo } from '../../src/validators/respaldo';
import {
  conteosDe, esquemaAutorizacionMigracion, esquemaPaqueteMigracion, huellaDatos, normalizarDatos,
  type InformeEnsayo, type MigracionRegistrada, type ResultadoMigracion,
} from '../../src/validators/migracion';
import { normalizarTexto } from '../../src/domain/texto';
import { auditar, enTransaccion } from './acceso.ts';
import { traducirError } from './datosEscolares.ts';
import { ErrorApi } from './errores.ts';
import { aSnake, conCliente, consultar, crearRepositoriosPg, leerColumnas, type RepositorioPg } from './repositoriosPg.ts';

export class Migracion {
  private readonly bd: Pool;
  constructor(bd: Pool) { this.bd = bd; }

  async historial(escuelaId: string): Promise<MigracionRegistrada[]> {
    const { rows } = await this.bd.query(`SELECT m.*, u.name AS quien,
        (SELECT count(*)::int FROM sincronizacion.cambios c WHERE c.escuela_id = m.escuela_id AND c.seq > m.seq_final) AS posteriores
      FROM acceso.migraciones m LEFT JOIN "user" u ON u.id = m.usuario_id WHERE m.escuela_id = $1 ORDER BY m.aplicada_en DESC`, [escuelaId]);
    return rows.map((r) => ({
      id: r.id, estado: r.estado, aplicadaEn: (r.aplicada_en as Date).toISOString(), autorizadoPor: r.autorizado_por, cargo: r.cargo, quien: r.quien,
      conteos: r.conteos, huella: r.huella, revertidaEn: r.revertida_en ? (r.revertida_en as Date).toISOString() : null, motivoReversion: r.motivo_reversion,
      cambiosPosteriores: r.estado === 'aplicada' ? r.posteriores : 0,
    }));
  }

  /** Ensayo (aplicar = false) o migración (aplicar = true, con autorización). */
  async procesar(usuarioId: string, escuelaId: string, cuerpo: unknown, aplicar: boolean): Promise<InformeEnsayo | ResultadoMigracion> {
    const pet = (cuerpo ?? {}) as { paquete?: unknown; autorizacion?: unknown };
    const p = esquemaPaqueteMigracion.safeParse(pet.paquete);
    if (!p.success) throw new ErrorApi(400, 'VALIDACION', 'El paquete de migración no tiene el formato esperado.');
    const paquete = p.data;
    const errores: string[] = []; const advertencias: string[] = [];
    const { datos, errores: invalidos } = normalizarDatos(paquete.datos);
    for (const e of invalidos) errores.push(e);
    const conteos = conteosDe(datos);
    for (const t of TABLAS_RESPALDO) if ((paquete.conteos[t] ?? 0) !== conteos[t]) errores.push(`Conteo distinto en ${t}: el paquete declara ${paquete.conteos[t] ?? 0} y trae ${conteos[t]} registros válidos.`);
    if (!errores.length && (await huellaDatos(datos)) !== paquete.huella) errores.push('La huella del paquete no coincide: los datos se alteraron en el camino. Vuelve a prepararlo.');

    const servidor = await this.bd.query<{ cct: string | null }>('SELECT cct FROM escolar.escuelas WHERE id = $1', [escuelaId]);
    const cctServidor = servidor.rows[0]?.cct?.toUpperCase() ?? null;
    const escuela = datos.escuelas[0];
    if (datos.escuelas.length !== 1 || escuela?.id !== escuelaId) errores.push('El paquete debe traer exactamente esta escuela.');
    else if (!cctServidor || String(escuela.cct ?? '').toUpperCase() !== cctServidor) errores.push(`La CCT de la escuela del dispositivo (${escuela.cct ?? 'sin CCT'}) no coincide con la del servidor (${cctServidor ?? 'sin CCT'}): no se mezclan escuelas.`);
    for (const t of TABLAS_RESPALDO) {
      if (t !== 'escuelas' && datos[t].some((r) => r.escuelaId !== escuelaId)) { errores.push(`Hay registros de otra escuela en ${t}.`); break; }
    }
    const previa = await this.bd.query(`SELECT 1 FROM acceso.migraciones WHERE escuela_id = $1 AND estado = 'aplicada'`, [escuelaId]);
    if (previa.rowCount) errores.push('Esta escuela ya se migró. Para repetirla, primero revierte la migración vigente.');
    for (const t of TABLAS_RESPALDO) {
      if (t === 'escuelas') continue;
      const { rows } = await this.bd.query(`SELECT count(*)::int AS n FROM escolar.${aSnake(t)} WHERE escuela_id = $1`, [escuelaId]);
      if (rows[0].n > 0) { errores.push('La escuela del servidor ya tiene datos: la migración sólo se hace sobre una escuela vacía (no se fusionan datos).'); break; }
    }
    let autorizacion: { autorizadoPor: string; cargo: string } | null = null;
    if (aplicar) {
      const a = esquemaAutorizacionMigracion.safeParse(pet.autorizacion);
      if (!a.success) errores.push(a.error.issues[0]?.message ?? 'Falta la autorización.');
      else if (a.data.confirmacionCct !== cctServidor) errores.push('La CCT escrita para confirmar no coincide con la de la escuela.');
      else autorizacion = a.data;
    }
    const posiblesDuplicados = duplicadosPorNombre(datos);
    if (posiblesDuplicados.length) advertencias.push(`${posiblesDuplicados.length} posible(s) duplicado(s) por nombre: revísalos; no se fusionan solos.`);
    const informe = { valido: false, errores, advertencias, conteos, huella: paquete.huella, posiblesDuplicados };
    if (errores.length) return informe;

    const columnas = await leerColumnas(this.bd);
    const migracionId = randomUUID();
    const c = await this.bd.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.migracion', 'si', true)`);
      const repos = crearRepositoriosPg(columnas);
      const repo = (t: TablaRespaldo) => repos[t] as unknown as RepositorioPg<never>;
      let enCurso: TablaRespaldo = 'escuelas';
      let escuelaPrevia: unknown = null;
      try {
        await conCliente(c, async () => {
          escuelaPrevia = await repo('escuelas').obtener(escuelaId);
          await repo('escuelas').actualizarExistente(escuela as never);
          for (const t of TABLAS_RESPALDO) {
            if (t === 'escuelas') continue;
            enCurso = t;
            for (const r of datos[t]) await repo(t).insertar(r as never);
          }
        });
        enCurso = 'escuelas';
        await c.query('SET CONSTRAINTS ALL IMMEDIATE'); // referencias completas ya, no al confirmar
      } catch (e) {
        await c.query('ROLLBACK');
        return { ...informe, errores: [`${enCurso}: ${traducirError(e).message}`] };
      }
      // Lo que quedó guardado, leído de vuelta, debe dar la MISMA huella.
      const guardado = {} as Record<string, unknown[]>;
      await conCliente(c, async () => {
        for (const t of TABLAS_RESPALDO) {
          const col = t === 'escuelas' ? 'id' : 'escuela_id';
          guardado[t] = (await consultar(c, `SELECT * FROM escolar.${aSnake(t)} WHERE ${col} = $1`, [escuelaId])).rows
            .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase()), v])));
        }
      });
      const releido = normalizarDatos(guardado);
      const huellaGuardada = await huellaDatos(releido.datos);
      if (huellaGuardada !== paquete.huella || releido.errores.length) {
        await c.query('ROLLBACK');
        return { ...informe, huella: huellaGuardada, errores: ['Lo guardado no coincide exactamente con el paquete (huella distinta). No se guardó nada.'] };
      }
      if (!aplicar) {
        await c.query('ROLLBACK');
        await auditar(this.bd, { usuarioId, escuelaId, accion: 'migracion_ensayo', detalle: { registros: Object.values(conteos).reduce((a, b) => a + b, 0) } });
        return { ...informe, valido: true };
      }
      const { rows } = await c.query<{ s: string }>('SELECT coalesce(max(seq), 0)::text AS s FROM sincronizacion.cambios WHERE escuela_id = $1', [escuelaId]);
      await c.query(`INSERT INTO acceso.migraciones (id, escuela_id, origen_escuela_id, usuario_id, autorizado_por, cargo, aviso_privacidad, conteos, huella, escuela_previa, seq_final)
        VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)`,
        [migracionId, escuelaId, paquete.origenEscuelaId, usuarioId, autorizacion!.autorizadoPor, autorizacion!.cargo, JSON.stringify(conteos), paquete.huella, JSON.stringify(escuelaPrevia), Number(rows[0]!.s)]);
      for (const t of TABLAS_RESPALDO) {
        if (t === 'escuelas' || !datos[t].length) continue;
        await c.query('INSERT INTO acceso.migracion_registros (migracion_id, tabla, registro_id) SELECT $1, $2, unnest($3::uuid[])', [migracionId, t, datos[t].map((r) => r.id)]);
      }
      await auditar(c, { usuarioId, escuelaId, accion: 'migracion_aplicada', entidad: 'migracion', entidadId: migracionId, detalle: { registros: Object.values(conteos).reduce((a, b) => a + b, 0), huella: paquete.huella } });
      await c.query('COMMIT');
      return { ...informe, valido: true, migracionId };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Reversión completa de una migración, sólo si no hubo cambios posteriores en el servidor. */
  async revertir(usuarioId: string, escuelaId: string, migracionId: string, motivo: string): Promise<{ revertida: true; registros: number }> {
    const columnas = await leerColumnas(this.bd);
    return enTransaccion(this.bd, async (c: PoolClient) => {
      await c.query(`SELECT set_config('app.migracion', 'si', true)`);
      const { rows } = await c.query('SELECT * FROM acceso.migraciones WHERE id = $1 AND escuela_id = $2 FOR UPDATE', [migracionId, escuelaId]);
      const m = rows[0];
      if (!m) throw new ErrorApi(404, 'NO_ENCONTRADO', 'No existe esa migración en esta escuela.');
      if (m.estado !== 'aplicada') throw new ErrorApi(409, 'YA_REVERTIDA', 'Esa migración ya se revirtió.');
      const post = await c.query('SELECT count(*)::int AS n FROM sincronizacion.cambios WHERE escuela_id = $1 AND seq > $2', [escuelaId, m.seq_final]);
      if (post.rows[0].n > 0) throw new ErrorApi(409, 'CAMBIOS_POSTERIORES', `Hubo ${post.rows[0].n} cambio(s) en el servidor después de la migración: revertirla los borraría. Ya no se puede revertir automáticamente.`);
      // Las fichas de personal que se borran dejan de estar vinculadas a cuentas (las cuentas se conservan).
      await c.query(`UPDATE acceso.membresias SET personal_id = NULL, actualizada_en = now() WHERE escuela_id = $1
        AND personal_id IN (SELECT registro_id FROM acceso.migracion_registros WHERE migracion_id = $2 AND tabla = 'personal')`, [escuelaId, migracionId]);
      let registros = 0;
      for (const t of [...TABLAS_RESPALDO].reverse()) {
        if (t === 'escuelas') continue;
        const r = await c.query(`DELETE FROM escolar.${aSnake(t)} WHERE id IN (SELECT registro_id FROM acceso.migracion_registros WHERE migracion_id = $1 AND tabla = $2)`, [migracionId, t]);
        registros += r.rowCount ?? 0;
      }
      await conCliente(c, async () => {
        const repo = crearRepositoriosPg(columnas).escuelas as unknown as RepositorioPg<never>;
        await repo.actualizarExistente(m.escuela_previa as never);
      });
      await c.query(`UPDATE acceso.migraciones SET estado = 'revertida', revertida_en = now(), revertida_por = $2, motivo_reversion = $3 WHERE id = $1`, [migracionId, usuarioId, motivo]);
      await auditar(c, { usuarioId, escuelaId, accion: 'migracion_revertida', entidad: 'migracion', entidadId: migracionId, detalle: { motivo, registros } });
      return { revertida: true as const, registros };
    });
  }
}

/** Mismo nombre completo = POSIBLE duplicado (informativo; el nombre nunca identifica a una persona). */
function duplicadosPorNombre(datos: Record<TablaRespaldo, Record<string, unknown>[]>): InformeEnsayo['posiblesDuplicados'] {
  const salida: InformeEnsayo['posiblesDuplicados'] = [];
  for (const tabla of ['alumnos', 'personal'] as const) {
    const grupos = new Map<string, number>();
    for (const r of datos[tabla]) {
      const n = normalizarTexto([r.nombre, r.primerApellido, r.segundoApellido].filter(Boolean).join(' '));
      grupos.set(n, (grupos.get(n) ?? 0) + 1);
    }
    for (const [nombre, registros] of grupos) if (registros > 1) salida.push({ tabla, nombre, registros });
  }
  return salida;
}
