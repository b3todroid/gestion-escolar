/**
 * IP real del cliente detrás de un proxy inverso (Fase 11).
 * Los límites de intentos y la auditoría usan la IP del cliente. Detrás del proxy, la conexión TCP
 * viene del proxy; la IP real va en X-Forwarded-For. Esa cabecera la puede escribir cualquiera, así
 * que SÓLO se toma en cuenta si la conexión viene de un intermediario de confianza
 * (PROXIES_CONFIABLES), y se lee de derecha a izquierda saltando los intermediarios de confianza.
 */
import { BlockList, isIP } from 'node:net';

const limpia = (ip: string) => ip.trim().replace(/^::ffff:/, '');

export function listaConfiable(texto: string): BlockList {
  const l = new BlockList();
  for (const parte of texto.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [dir, pref] = parte.split('/');
    const tipo = isIP(dir ?? '');
    if (!tipo) throw new Error(`PROXIES_CONFIABLES: «${parte}» no es una IP ni una red válida.`);
    const familia = tipo === 4 ? 'ipv4' : 'ipv6';
    if (pref === undefined) l.addAddress(dir!, familia);
    else {
      const n = Number(pref);
      if (!Number.isInteger(n) || n < 0 || n > (tipo === 4 ? 32 : 128)) throw new Error(`PROXIES_CONFIABLES: prefijo inválido en «${parte}».`);
      l.addSubnet(dir!, n, familia);
    }
  }
  return l;
}

const confiable = (l: BlockList, ip: string) => { const t = isIP(ip); return t !== 0 && l.check(ip, t === 4 ? 'ipv4' : 'ipv6'); };

export function ipDelCliente(remota: string, xff: string | string[] | undefined, confiables: BlockList): string {
  const r = limpia(remota);
  if (!confiable(confiables, r) || !xff) return r;
  const saltos = (Array.isArray(xff) ? xff.join(',') : xff).split(',').map(limpia).filter(Boolean);
  for (let i = saltos.length - 1; i >= 0; i--) {
    const ip = saltos[i]!;
    if (!isIP(ip)) return r; // cabecera manipulada: no se confía en lo que sigue
    if (!confiable(confiables, ip)) return ip;
  }
  return r;
}
