/**
 * Envío de correos (códigos de acceso e invitaciones).
 * - 'buzon': buzón EN MEMORIA, sólo en desarrollo y pruebas. Los mensajes no salen
 *   del servidor y no se escriben en registros (pueden leerse en /api/desarrollo/buzon).
 * - 'smtp' (Fase 11): envío real con nodemailer. En producción siempre cifrado (TLS o STARTTLS
 *   obligatorio). Nunca se registra el contenido de un mensaje ni el código.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { Configuracion } from './config.ts';
export interface MensajeCorreo { para: string; asunto: string; texto: string; enviadoEn: string; codigo: string | null }

export interface EnviadorCorreo {
  enviar(m: Omit<MensajeCorreo, 'enviadoEn'>): Promise<void>;
}

export class BuzonDesarrollo implements EnviadorCorreo {
  private readonly mensajes: MensajeCorreo[] = [];
  private static readonly MAXIMO = 200;

  async enviar(m: Omit<MensajeCorreo, 'enviadoEn'>): Promise<void> {
    this.mensajes.push({ ...m, para: m.para.toLowerCase(), enviadoEn: new Date().toISOString() });
    if (this.mensajes.length > BuzonDesarrollo.MAXIMO) this.mensajes.shift();
  }

  de(para: string): MensajeCorreo[] {
    const p = para.toLowerCase();
    return this.mensajes.filter((m) => m.para === p);
  }

  ultimoCodigo(para: string): string | null {
    return this.de(para).reverse().find((m) => m.codigo)?.codigo ?? null;
  }

  vaciar(): void { this.mensajes.length = 0; }
}

/** Envío real por SMTP (Fase 11). */
export class CorreoSmtp implements EnviadorCorreo {
  private readonly transporte: Transporter;
  private readonly remitente: string;
  constructor(cfg: Configuracion) {
    this.remitente = cfg.SMTP_REMITENTE!;
    this.transporte = nodemailer.createTransport({
      host: cfg.SMTP_HOST!,
      port: cfg.SMTP_PUERTO,
      secure: cfg.SMTP_SEGURIDAD === 'tls',
      requireTLS: cfg.SMTP_SEGURIDAD === 'starttls', // sin cifrado, no se envía
      ignoreTLS: cfg.SMTP_SEGURIDAD === 'ninguna', // sólo preproducción con un buzón de prueba local (config.ts lo impide en producción)
      auth: cfg.SMTP_USUARIO ? { user: cfg.SMTP_USUARIO, pass: cfg.SMTP_CLAVE! } : undefined,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      logger: false, debug: false,
    });
  }
  async enviar(m: Omit<MensajeCorreo, 'enviadoEn'>): Promise<void> {
    try {
      await this.transporte.sendMail({ from: this.remitente, to: m.para, subject: m.asunto, text: m.texto });
    } catch (e) {
      // Sin datos personales: ni destinatario ni contenido.
      throw new Error(`No se pudo enviar el correo (SMTP): ${(e as { code?: string }).code ?? 'error'}`);
    }
  }
  /** Comprueba la conexión con el servidor de correo (para la verificación de arranque). */
  async verificar(): Promise<void> { await this.transporte.verify(); }
}
