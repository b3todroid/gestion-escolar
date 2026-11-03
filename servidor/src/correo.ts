/**
 * Envío de correos (códigos de acceso e invitaciones).
 * - 'buzon': buzón EN MEMORIA, sólo en desarrollo y pruebas. Los mensajes no salen
 *   del servidor y no se escriben en registros (pueden leerse en /api/desarrollo/buzon).
 * - SMTP: se implementará en el despliegue (requiere autorización y la cuenta del administrador).
 */
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
