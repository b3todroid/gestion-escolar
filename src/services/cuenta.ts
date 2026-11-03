/**
 * Cuenta en el servidor escolar (Fase 8B): inicio de sesión, verificación en dos pasos,
 * sesiones y administración de accesos por escuela.
 * IMPORTANTE: iniciar sesión NO envía ni sincroniza datos escolares; todo sigue guardado
 * sólo en este dispositivo. Los permisos los aplica el servidor en cada petición.
 */
import { z } from 'zod';
import { ErrorDominio } from '../domain/errores';
import type { ClienteServidor } from '../remoto/servidorEscolar';
import { ErrorServidor } from '../remoto/servidorEscolar';
import { validar } from '../validators/esquemas';

export const ROLES_SERVIDOR = ['administrador', 'direccion', 'subdireccion', 'prefectura', 'docente', 'apoyo'] as const;
export type RolServidor = (typeof ROLES_SERVIDOR)[number];
export const ETIQUETA_ROL_SERVIDOR: Record<RolServidor, string> = {
  administrador: 'Administrador de la escuela', direccion: 'Dirección', subdireccion: 'Subdirección',
  prefectura: 'Prefectura', docente: 'Docente', apoyo: 'Personal de apoyo',
};
export type Proveedor = 'google' | 'microsoft' | 'oidc-prueba';
export const ETIQUETA_PROVEEDOR: Record<Proveedor, string> = {
  google: 'Google Workspace (cuenta institucional)', microsoft: 'Microsoft 365 (cuenta institucional)', 'oidc-prueba': 'Proveedor institucional de PRUEBA',
};

export interface ConfiguracionServidor { disponible: boolean; proveedores: Proveedor[]; buzonDesarrollo: boolean; motivo: string | null }
export interface MembresiaPropia { id: string; escuelaId: string; escuela: string; cct: string | null; rol: RolServidor; etiquetaRol: string; personalId: string | null; permisosDelegados: PermisoDelegable[] }

export const PERMISOS_DELEGABLES = ['confirmar_incidencias', 'autorizar_coberturas'] as const;
export type PermisoDelegable = (typeof PERMISOS_DELEGABLES)[number];
export const ETIQUETA_PERMISO: Record<PermisoDelegable, string> = { confirmar_incidencias: 'Confirmar o descartar incidencias del personal', autorizar_coberturas: 'Autorizar coberturas de grupos' };
/** Ficha de personal guardada en el servidor (sólo nombre: lo demás lo decide el servidor por rol). */
export interface FichaServidor { id: string; nombre: string; primerApellido: string; segundoApellido: string | null; activo: boolean }
export interface Yo {
  usuario: { id: string; nombre: string; correo: string };
  segundoFactor: { activo: boolean; verificado: boolean; requerido: boolean };
  membresias: MembresiaPropia[];
}
export interface SesionPropia { id: string; creada: string; expira: string; dispositivo: string; actual: boolean }
export interface Miembro {
  id: string; usuarioId: string; nombre: string; correo: string; rol: RolServidor; etiquetaRol: string;
  estado: 'invitada' | 'activa' | 'revocada'; caducada: boolean; tipoCorreo: 'institucional' | 'personal';
  invitadaEn: string | null; expiraEn: string | null; aceptadaEn: string | null; revocadaEn: string | null;
  motivoRevocacion: string | null; segundoFactorActivo: boolean; esUsted: boolean;
  personalId: string | null; permisosDelegados: PermisoDelegable[];
}
export interface EventoAuditoria { ocurridoEn: string; accion: string; entidad: string | null; detalle: Record<string, unknown>; quien: string | null }
export interface ActivacionSegundoFactor { uri: string; secreto: string; codigosRespaldo: string[] }

const correo = z.email('Escribe un correo válido, por ejemplo nombre@escuela.edu.mx.').max(120, 'El correo es demasiado largo.');
const esquemaCorreo = z.object({ correo: z.string().trim().toLowerCase().pipe(correo) });
const esquemaCodigoCorreo = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.') });
const esquemaCodigoApp = z.object({ codigo: z.string().transform((c) => c.replace(/\s/g, '')).pipe(z.string().regex(/^\d{6}$/, 'El código de la aplicación tiene 6 dígitos.')) });
const esquemaRespaldo = z.object({ codigo: z.string().trim().min(6, 'Escribe el código de respaldo completo.').max(40) });
export const esquemaInvitacionCliente = z.object({
  correo: z.string().trim().toLowerCase().pipe(correo),
  nombre: z.string().trim().min(2, 'Escribe el nombre de la persona.').max(120, 'Máximo 120 caracteres.'),
  rol: z.enum(ROLES_SERVIDOR, 'Elige un rol.'),
  tipoCorreo: z.enum(['institucional', 'personal'], 'Indica si el correo es institucional o personal.'),
  consentimiento: z.boolean(),
}).refine((d) => d.tipoCorreo === 'institucional' || d.consentimiento, { path: ['consentimiento'], message: 'Para usar un correo personal, la persona debe dar su consentimiento.' });
const esquemaMotivo = z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres).').max(300) });

export class ServicioCuenta {
  private readonly c: ClienteServidor;
  constructor(cliente: ClienteServidor) {
    this.c = cliente;
  }

  /** ¿Hay servidor escolar? Si no, la aplicación funciona en modo local (decisión D9). */
  async configuracion(): Promise<ConfiguracionServidor> {
    try {
      const r = await this.c.pedir<{ proveedores: Proveedor[]; buzonDesarrollo: boolean }>('GET', '/api/configuracion');
      return { disponible: true, proveedores: r.proveedores ?? [], buzonDesarrollo: r.buzonDesarrollo === true, motivo: null };
    } catch (e) {
      if (e instanceof ErrorDominio) return { disponible: false, proveedores: [], buzonDesarrollo: false, motivo: e.message };
      throw e;
    }
  }

  /** Datos de la sesión actual, o null si no hay sesión. */
  async yo(): Promise<Yo | null> {
    try {
      return (await this.c.pedir<Yo | null>('GET', '/api/yo')) ?? null;
    } catch (e) {
      if (e instanceof ErrorServidor && e.estado === 401) return null;
      throw e;
    }
  }

  async enviarCodigo(datos: { correo: string }): Promise<string> {
    const d = validar(esquemaCorreo, datos);
    await this.c.pedir('POST', '/api/auth/email-otp/send-verification-otp', { email: d.correo, type: 'sign-in' });
    return d.correo;
  }

  async entrarConCodigo(correoNormalizado: string, datos: { codigo: string }): Promise<void> {
    const d = validar(esquemaCodigoCorreo, datos);
    await this.c.pedir('POST', '/api/auth/sign-in/email-otp', { email: correoNormalizado, otp: d.codigo });
  }

  /** Dirección del proveedor institucional a la que debe ir el navegador. */
  async urlCuentaInstitucional(proveedor: Proveedor, origen: string): Promise<string> {
    const r = await this.c.pedir<{ url: string }>('POST', '/api/auth/sign-in/social', { provider: proveedor, callbackURL: `${origen}/#/cuenta`, errorCallbackURL: `${origen}/#/cuenta`, disableRedirect: true });
    return r.url;
  }

  async verificarSegundoFactor(datos: { codigo: string }): Promise<void> {
    const d = validar(esquemaCodigoApp, datos);
    await this.c.pedir('POST', '/api/auth/two-factor/verify-totp', { code: d.codigo });
  }

  async verificarCodigoRespaldo(datos: { codigo: string }): Promise<void> {
    const d = validar(esquemaRespaldo, datos);
    await this.c.pedir('POST', '/api/auth/two-factor/verify-backup-code', { code: d.codigo });
  }

  async iniciarSegundoFactor(): Promise<ActivacionSegundoFactor> {
    const r = await this.c.pedir<{ totpURI: string; backupCodes: string[] }>('POST', '/api/auth/two-factor/enable', {});
    const secreto = new URL(r.totpURI).searchParams.get('secret') ?? '';
    return { uri: r.totpURI, secreto, codigosRespaldo: r.backupCodes };
  }

  async confirmarSegundoFactor(datos: { codigo: string }): Promise<void> {
    await this.verificarSegundoFactor(datos);
  }

  async salir(): Promise<void> {
    await this.c.pedir('POST', '/api/auth/sign-out', {});
  }

  /** Cierra la sesión en TODOS los dispositivos (incluido éste). */
  async salirDeTodos(): Promise<void> {
    await this.c.pedir('POST', '/api/auth/revoke-sessions', {});
  }

  sesiones(): Promise<SesionPropia[]> {
    return this.c.pedir<SesionPropia[]>('GET', '/api/yo/sesiones');
  }

  async cerrarSesion(id: string): Promise<void> {
    await this.c.pedir('POST', `/api/yo/sesiones/${encodeURIComponent(id)}/cerrar`, {});
  }

  // ---------- Administración de accesos de una escuela (sólo administrador; lo valida el servidor) ----------

  miembros(escuelaId: string): Promise<Miembro[]> {
    return this.c.pedir<Miembro[]>('GET', `/api/escuelas/${encodeURIComponent(escuelaId)}/miembros`);
  }

  async invitar(escuelaId: string, datos: unknown): Promise<void> {
    const d = validar(esquemaInvitacionCliente, datos);
    await this.c.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/invitaciones`, d);
  }

  async revocar(escuelaId: string, membresiaId: string, datos: { motivo: string }): Promise<{ sesionesCerradas: number }> {
    const d = validar(esquemaMotivo, datos);
    return this.c.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/membresias/${encodeURIComponent(membresiaId)}/revocar`, d);
  }

  async restablecerSegundoFactor(escuelaId: string, membresiaId: string, datos: { motivo: string }): Promise<{ sesionesCerradas: number }> {
    const d = validar(esquemaMotivo, datos);
    return this.c.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/membresias/${encodeURIComponent(membresiaId)}/restablecer-segundo-factor`, d);
  }

  /** Delegación del administrador (D5) a Dirección o Subdirección. */
  async delegar(escuelaId: string, membresiaId: string, permisos: PermisoDelegable[]): Promise<void> {
    const d = validar(z.object({ permisos: z.array(z.enum(PERMISOS_DELEGABLES)).max(2) }), { permisos });
    await this.c.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/membresias/${encodeURIComponent(membresiaId)}/delegaciones`, d);
  }

  async vincularPersonal(escuelaId: string, membresiaId: string, personalId: string | null): Promise<void> {
    const d = validar(z.object({ personalId: z.uuid('Elige una ficha de personal.').nullable() }), { personalId });
    await this.c.pedir('POST', `/api/escuelas/${encodeURIComponent(escuelaId)}/membresias/${encodeURIComponent(membresiaId)}/vincular-personal`, d);
  }

  /** Fichas de personal de la escuela EN EL SERVIDOR (vacío hasta la migración de datos, Fase 8E). */
  fichasServidor(escuelaId: string): Promise<FichaServidor[]> {
    return this.c.pedir<FichaServidor[]>('GET', `/api/escuelas/${encodeURIComponent(escuelaId)}/tablas/personal`);
  }

  auditoria(escuelaId: string): Promise<EventoAuditoria[]> {
    return this.c.pedir<EventoAuditoria[]>('GET', `/api/escuelas/${encodeURIComponent(escuelaId)}/auditoria`);
  }
}

export const ETIQUETA_ACCION_AUDITORIA: Record<string, string> = {
  escuela_dada_de_alta_por_operador: 'Escuela dada de alta en el servidor',
  invitacion_creada: 'Invitación enviada',
  invitacion_renovada: 'Invitación renovada',
  membresia_revocada: 'Acceso revocado',
  segundo_factor_restablecido: 'Verificación en dos pasos restablecida',
  personal_vinculado: 'Ficha de personal vinculada',
  personal_desvinculado: 'Ficha de personal desvinculada',
  delegacion_cambiada: 'Permisos delegados cambiados',
  comando: 'Operación registrada',
  comando_rechazado: 'Operación rechazada por permisos',
  lectura: 'Consulta de datos',
};
