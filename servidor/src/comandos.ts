/**
 * Catálogo de COMANDOS del servidor (Fase 8C). Cada comando:
 * - declara qué roles pueden pedirlo (primera barrera, aquí);
 * - valida sus datos con Zod (y después el servicio vuelve a validar con sus propias reglas);
 * - ejecuta el MISMO servicio que usa la aplicación (reglas de negocio idénticas);
 * - corre bajo RLS con el rol `gestion_app` (segunda barrera, en la base) y con los
 *   disparadores de confirmación/autorización (tercera barrera).
 * Los datos que identifican a quien actúa (personal, «autorizó», fecha y hora) los pone
 * el servidor, nunca el cliente.
 */
import { z } from 'zod';
import { ETIQUETA_ROL, type Rol } from './acceso.ts';
import { ErrorApi } from './errores.ts';
import type { ContextoComando } from './datosEscolares.ts';

const uuid = z.uuid('Identificador inválido.');
const fecha = z.iso.date('Fecha inválida (AAAA-MM-DD).');

interface DefinicionComando<E extends z.ZodType> {
  roles: readonly Rol[];
  esquema: E;
  ejecutar(c: ContextoComando, d: z.output<E>): Promise<unknown>;
}
const definir = <E extends z.ZodType>(d: DefinicionComando<E>) => d;

const sinPermiso = (mensaje = 'No tienes permiso para esta acción en esta escuela.') => new ErrorApi(403, 'SIN_PERMISO', mensaje);

function exigirFicha(c: ContextoComando): string {
  if (!c.personalId) throw sinPermiso('Tu acceso no está vinculado con tu ficha de personal. Pide al administrador que lo vincule.');
  return c.personalId;
}

/** Un docente sin otro rol sólo actúa sobre SUS clases (la sesión debe ser suya). */
async function exigirClasePropiaSiDocente(c: ContextoComando, sesionId: string): Promise<void> {
  const otros = [...c.roles].some((r) => r !== 'docente');
  if (otros) return;
  const personal = exigirFicha(c);
  const { rows } = await c.cliente.query<{ personal_id: string | null }>('SELECT personal_id FROM escolar.sesiones WHERE id = $1', [sesionId]);
  if (!rows[0]) throw new ErrorApi(404, 'NO_ENCONTRADO', 'No se encontró la clase.');
  if (rows[0].personal_id !== personal) throw sinPermiso('Sólo puedes registrar en tus propias clases.');
}

/** Confirmar incidencias y autorizar coberturas (D5): administrador o delegación expresa. */
function exigirPermiso(c: ContextoComando, permiso: 'confirmar_incidencias' | 'autorizar_coberturas'): void {
  if (c.roles.has('administrador')) return;
  if ((c.roles.has('direccion') || c.roles.has('subdireccion')) && c.permisosDelegados.has(permiso)) return;
  throw sinPermiso(permiso === 'confirmar_incidencias'
    ? 'Sólo el administrador de la escuela (o a quien se lo delegó) confirma o descarta incidencias.'
    : 'Sólo el administrador de la escuela (o a quien se lo delegó) autoriza coberturas.');
}

function rolPrincipal(c: ContextoComando): string {
  const orden: Rol[] = ['administrador', 'direccion', 'subdireccion', 'prefectura', 'docente', 'apoyo'];
  const r = orden.find((x) => c.roles.has(x));
  return r ? ETIQUETA_ROL[r] : '';
}

export const COMANDOS = {
  // ---------- Docente: pase de lista y salidas en sus clases ----------
  'asistencia.guardarLista': definir({
    roles: ['docente'],
    esquema: z.object({ sesionId: uuid, fecha, marcas: z.record(z.string(), z.string()), llegadas: z.record(z.string(), z.string()).default({}) }),
    async ejecutar(c, d) {
      await exigirClasePropiaSiDocente(c, d.sesionId);
      return c.s.asistencia.guardarLista(d.sesionId, d.fecha, d.marcas as never, d.llegadas, c.hoy, exigirFicha(c));
    },
  }),
  'asistencia.registrarSalida': definir({
    roles: ['docente', 'prefectura'],
    esquema: z.object({ sesionId: uuid, fecha, alumnoId: uuid }),
    async ejecutar(c, d) {
      await exigirClasePropiaSiDocente(c, d.sesionId);
      return c.s.asistencia.registrarSalida(d.sesionId, d.fecha, d.alumnoId, c.hora, c.hoy, c.personalId);
    },
  }),
  'asistencia.reincorporar': definir({
    roles: ['docente', 'prefectura'],
    esquema: z.object({ salidaId: uuid }),
    async ejecutar(c, d) { return c.s.asistencia.reincorporar(d.salidaId, c.hora); },
  }),
  'asistencia.crearReporte': definir({
    roles: ['docente', 'prefectura'],
    esquema: z.object({ alumnoId: uuid, sesionId: uuid.nullable().default(null), tipo: z.string(), texto: z.string() }),
    async ejecutar(c, d) {
      if (d.sesionId) await exigirClasePropiaSiDocente(c, d.sesionId);
      else if (![...c.roles].some((r) => r !== 'docente')) throw sinPermiso('Indica la clase en la que ocurrió.');
      return c.s.asistencia.crearReporte(d.alumnoId, { tipo: d.tipo as never, texto: d.texto }, { personalId: c.personalId, sesionId: d.sesionId, fecha: c.hoy, hora: c.hora });
    },
  }),

  // ---------- Prefectura ----------
  'prefectura.registrarIncidencia': definir({
    roles: ['prefectura', 'administrador', 'direccion', 'subdireccion'],
    esquema: z.object({ cicloId: uuid, entrada: z.record(z.string(), z.unknown()) }),
    async ejecutar(c, d) { return c.s.prefectura.registrarIncidencia(d.cicloId, d.entrada as never, c.personalId); },
  }),
  'prefectura.validarIncidencia': definir({
    roles: ['administrador', 'direccion', 'subdireccion'],
    esquema: z.object({ id: uuid, estado: z.enum(['confirmada', 'descartada']), motivo: z.string().max(300).nullable().default(null) }),
    async ejecutar(c, d) {
      exigirPermiso(c, 'confirmar_incidencias');
      return c.s.prefectura.validarIncidencia(d.id, d.estado, c.personalId, d.motivo);
    },
  }),
  'prefectura.proponer': definir({
    roles: ['prefectura', 'administrador', 'direccion', 'subdireccion'],
    esquema: z.object({ sesionId: uuid, fecha, personalIds: z.array(uuid).min(1).max(20) }),
    async ejecutar(c, d) { return c.s.prefectura.proponer(d.sesionId, d.fecha, d.personalIds, c.personalId); },
  }),
  'prefectura.asignar': definir({
    roles: ['administrador', 'direccion', 'subdireccion'],
    esquema: z.object({ sesionId: uuid, fecha, personalId: uuid, actividadId: uuid.nullable().default(null), actividadTexto: z.string().max(300).nullable().default(null), observaciones: z.string().max(300).nullable().default(null) }),
    async ejecutar(c, d) {
      exigirPermiso(c, 'autorizar_coberturas');
      // «Autorizó» es la persona autenticada, no un texto que escriba el cliente.
      const autorizadoPor = `${c.actor.nombre} (${rolPrincipal(c)})`.slice(0, 120);
      return c.s.prefectura.asignar(d.sesionId, d.fecha, { personalId: d.personalId, autorizadoPor, actividadId: d.actividadId, actividadTexto: d.actividadTexto, observaciones: d.observaciones }, c.personalId);
    },
  }),
  'prefectura.crearActividad': definir({
    roles: ['administrador', 'direccion', 'subdireccion', 'prefectura', 'docente'],
    esquema: z.object({ cicloId: uuid, entrada: z.record(z.string(), z.unknown()) }),
    async ejecutar(c, d) { return c.s.prefectura.crearActividad(d.cicloId, d.entrada as never, c.personalId); },
  }),
  'prefectura.cambiarEstadoActividad': definir({
    roles: ['administrador', 'direccion', 'subdireccion'],
    esquema: z.object({ id: uuid, estado: z.enum(['validada', 'retirada']) }),
    async ejecutar(c, d) { return c.s.prefectura.cambiarEstadoActividad(d.id, d.estado, c.personalId); },
  }),

  // ---------- Dirección y Subdirección ----------
  'personal.crear': definir({
    roles: ['administrador', 'direccion'],
    esquema: z.object({ entrada: z.record(z.string(), z.unknown()) }),
    async ejecutar(c, d) { return c.s.personal.crear(c.actor.escuelaId, d.entrada as never); },
  }),
  'alumnos.inscribirNuevo': definir({
    roles: ['direccion', 'subdireccion'],
    esquema: z.object({ cicloId: uuid, entrada: z.record(z.string(), z.unknown()), inscripcion: z.record(z.string(), z.unknown()).default({}) }),
    async ejecutar(c, d) { return c.s.alumnos.inscribirNuevo(d.cicloId, d.entrada as never, d.inscripcion as never); },
  }),
  'confirmacion.confirmar': definir({
    roles: ['direccion'],
    esquema: z.object({ grupoId: uuid }),
    async ejecutar(c, d) { return c.s.confirmacion.confirmar(d.grupoId); },
  }),
  'confirmacion.reabrir': definir({
    roles: ['direccion'],
    esquema: z.object({ grupoId: uuid, motivo: z.string() }),
    async ejecutar(c, d) { await c.s.confirmacion.reabrir(d.grupoId, d.motivo); return { reabierto: true }; },
  }),
} as const;

export type TipoComando = keyof typeof COMANDOS;
export const TIPOS_COMANDO = Object.keys(COMANDOS) as TipoComando[];

export const esquemaPeticionComando = z.object({
  opId: z.uuid('Cada comando necesita un identificador de operación (UUID).'),
  tipo: z.enum(TIPOS_COMANDO as [TipoComando, ...TipoComando[]], 'Comando desconocido.'),
  datos: z.unknown(),
});

export async function ejecutarComando(c: ContextoComando, tipo: TipoComando, datos: unknown): Promise<unknown> {
  const def = COMANDOS[tipo] as DefinicionComando<z.ZodType>;
  if (!def.roles.some((r) => c.roles.has(r))) throw sinPermiso();
  const r = def.esquema.safeParse(datos ?? {});
  if (!r.success) {
    const campos: Record<string, string> = {};
    for (const i of r.error.issues) campos[i.path.join('.') || 'datos'] ??= i.message;
    throw new ErrorApi(400, 'VALIDACION', 'Revisa los datos del comando.', campos);
  }
  return def.ejecutar(c, r.data);
}
