import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { leerConfiguracion } from '../src/config.ts';
import { CorreoSmtp } from '../src/correo.ts';
import { ipDelCliente, listaConfiable } from '../src/ipCliente.ts';
import { crearEntorno, URL_APP, type Entorno } from './entorno.ts';

// Fase 11 — preparación del despliegue: configuración por entorno, SMTP real, IP del cliente detrás
// del proxy y comprobación de salud. Sin servicios externos (SMTP de prueba en este mismo proceso).
const base = { DATABASE_URL: 'postgres://x@localhost/gestion_produccion', BETTER_AUTH_SECRET: 'a'.repeat(40) };
const smtp = { CORREO_MODO: 'smtp', SMTP_HOST: 'smtp.escuela.example', SMTP_REMITENTE: 'Gestión Escolar <no-responder@escuela.example>' };

describe('Configuración por entorno', () => {
  test('producción y preproducción exigen HTTPS y SMTP (nunca el buzón de desarrollo)', () => {
    for (const MODO of ['produccion', 'preproduccion']) {
      expect(() => leerConfiguracion({ ...base, MODO, CORREO_MODO: 'buzon', URL_PUBLICA: 'https://escuela.example' })).toThrow(/buzón/);
      expect(() => leerConfiguracion({ ...base, MODO, ...smtp, URL_PUBLICA: 'http://escuela.example' })).toThrow(/https/);
    }
  });
  test('producción con SMTP cifrado y HTTPS es una configuración válida (antes era imposible arrancar)', () => {
    const c = leerConfiguracion({ ...base, MODO: 'produccion', ...smtp, URL_PUBLICA: 'https://escuela.example', SMTP_USUARIO: 'u', SMTP_CLAVE: 'clave-ficticia' });
    expect(c).toMatchObject({ MODO: 'produccion', CORREO_MODO: 'smtp', SMTP_SEGURIDAD: 'starttls', HOST: '127.0.0.1' });
  });
  test('producción nunca acepta SMTP sin cifrar ni una base de desarrollo, pruebas, piloto o demostración', () => {
    const prod = { ...base, MODO: 'produccion', ...smtp, URL_PUBLICA: 'https://escuela.example' };
    expect(() => leerConfiguracion({ ...prod, SMTP_SEGURIDAD: 'ninguna' })).toThrow(/cifrado/);
    for (const bd of ['gestion_dev', 'gestion_piloto', 'gestion_prueba_1', 'gestion_demo', 'gestion_preprod']) {
      expect(() => leerConfiguracion({ ...prod, DATABASE_URL: `postgres://x@localhost/${bd}` })).toThrow(/no puede apuntar/);
    }
    // Preproducción sí puede usar un buzón SMTP de prueba sin cifrar y una base del piloto.
    expect(leerConfiguracion({ ...base, MODO: 'preproduccion', ...smtp, SMTP_SEGURIDAD: 'ninguna', URL_PUBLICA: 'https://preprod.local', DATABASE_URL: 'postgres://x@db/gestion_piloto_preprod' }).MODO).toBe('preproduccion');
  });
  test('SMTP requiere servidor y remitente; usuario y clave van juntos; la clave nunca aparece en los errores', () => {
    expect(() => leerConfiguracion({ ...base, CORREO_MODO: 'smtp' })).toThrow(/SMTP_HOST/);
    let m = '';
    try { leerConfiguracion({ ...base, ...smtp, SMTP_CLAVE: 'clave-secreta-ficticia' }); } catch (e) { m = (e as Error).message; }
    expect(m).toMatch(/van juntos/);
    expect(m).not.toContain('clave-secreta-ficticia');
  });
  test('PROXIES_CONFIABLES inválido se rechaza al arrancar', () => {
    expect(() => listaConfiable('10.0.0.0/99')).toThrow(/prefijo/);
    expect(() => listaConfiable('no-es-ip')).toThrow(/no es una IP/);
  });
});

describe('IP del cliente detrás del proxy', () => {
  const red = listaConfiable('172.16.0.0/12,127.0.0.1');
  test('sin proxy de confianza se usa la conexión y X-Forwarded-For se ignora (no se puede falsear)', () => {
    expect(ipDelCliente('203.0.113.7', '1.1.1.1', listaConfiable(''))).toBe('203.0.113.7');
    expect(ipDelCliente('203.0.113.7', '1.1.1.1', red)).toBe('203.0.113.7');
  });
  test('detrás del proxy de confianza se toma la IP real, de derecha a izquierda (lo que el cliente inventa queda a la izquierda)', () => {
    expect(ipDelCliente('172.18.0.5', '6.6.6.6, 198.51.100.20', red)).toBe('198.51.100.20');
    expect(ipDelCliente('::ffff:172.18.0.5', '198.51.100.20, 172.18.0.9', red)).toBe('198.51.100.20');
    expect(ipDelCliente('172.18.0.5', 'basura, 198.51.100.20', red)).toBe('198.51.100.20');
    expect(ipDelCliente('172.18.0.5', '198.51.100.20, basura', red)).toBe('172.18.0.5');
    expect(ipDelCliente('172.18.0.5', undefined, red)).toBe('172.18.0.5');
  });
});

describe('Servidor detrás del proxy', () => {
  let e: Entorno;
  beforeAll(async () => { e = await crearEntorno({ LIMITE_CODIGOS_POR_MINUTO: '2', PROXIES_CONFIABLES: '127.0.0.1' }); });
  afterAll(async () => { await e.cerrar(); });
  const pedirCodigo = async (xff: string) => (await fetch(new URL('/api/auth/email-otp/send-verification-otp', e.base), {
    method: 'POST', headers: { origin: URL_APP, 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ email: 'limite@ejemplo.test', type: 'sign-in' }),
  })).status;

  test('el límite de intentos es por persona: una IP bloqueada no bloquea a las demás', async () => {
    expect([await pedirCodigo('198.51.100.1'), await pedirCodigo('198.51.100.1'), await pedirCodigo('198.51.100.1')]).toEqual([200, 200, 429]);
    expect(await pedirCodigo('198.51.100.2')).toBe(200);
  });
  test('comprobación de salud: viva y lista (base de datos y migraciones al día), sin datos internos', async () => {
    const viva = await e.navegador().get('/api/salud');
    expect(viva).toMatchObject({ estado: 200, cuerpo: { estado: 'ok' } });
    const lista = await e.navegador().get('/api/salud/lista');
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo).toMatchObject({ estado: 'lista', baseDeDatos: 'ok' });
    expect(lista.cuerpo.migraciones).toBe(lista.cuerpo.esperadas);
    expect(JSON.stringify(lista.cuerpo)).not.toMatch(/postgres:|password|secret/i);
  });
});

describe('Correo SMTP', () => {
  // SMTP mínimo de prueba (RFC 5321) en este proceso: sólo recibe y guarda; nada sale del equipo.
  let srv: Server; let puerto = 0; const recibidos: string[] = [];
  beforeAll(async () => {
    srv = createServer((s) => {
      let datos = false; let cuerpo = '';
      s.write('220 prueba ESMTP\r\n');
      s.on('data', (b) => {
        for (const linea of b.toString().split('\r\n').filter((x, i, a) => x || i < a.length - 1)) {
          if (datos) { if (linea === '.') { datos = false; recibidos.push(cuerpo); s.write('250 OK\r\n'); } else cuerpo += `${linea}\n`; continue; }
          const c = linea.slice(0, 4).toUpperCase();
          if (c === 'EHLO' || c === 'HELO') s.write('250-prueba\r\n250 OK\r\n');
          else if (c === 'DATA') { datos = true; cuerpo = ''; s.write('354 OK\r\n'); }
          else if (c === 'QUIT') { s.write('221 Adios\r\n'); s.end(); }
          else if (linea) s.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    puerto = (srv.address() as { port: number }).port;
  });
  afterAll(() => { srv.close(); });

  test('envía el código por SMTP real (preproducción con buzón de prueba)', async () => {
    const cfg = leerConfiguracion({ ...base, MODO: 'preproduccion', ...smtp, SMTP_HOST: '127.0.0.1', SMTP_PUERTO: String(puerto), SMTP_SEGURIDAD: 'ninguna', URL_PUBLICA: 'https://preprod.local', DATABASE_URL: 'postgres://x@db/gestion_piloto_x' });
    await new CorreoSmtp(cfg).enviar({ para: 'docente.ficticia@ejemplo.test', asunto: 'Tu código de acceso', texto: 'Código: 123456', codigo: '123456' });
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0]).toContain('docente.ficticia@ejemplo.test');
    expect(recibidos[0]).toContain('123456');
  });
  test('con STARTTLS obligatorio no envía si el servidor no ofrece cifrado; el error no incluye destinatario ni contenido', async () => {
    const cfg = leerConfiguracion({ ...base, MODO: 'produccion', ...smtp, SMTP_HOST: '127.0.0.1', SMTP_PUERTO: String(puerto), URL_PUBLICA: 'https://escuela.example' });
    let m = '';
    try { await new CorreoSmtp(cfg).enviar({ para: 'docente.ficticia@ejemplo.test', asunto: 'Tu código', texto: 'Código: 654321', codigo: '654321' }); } catch (e) { m = (e as Error).message; }
    expect(m).toMatch(/No se pudo enviar el correo/);
    expect(m).not.toContain('docente.ficticia');
    expect(m).not.toContain('654321');
    expect(recibidos.some((r) => r.includes('654321'))).toBe(false);
  });
});

describe('Secretos en archivo (*_FILE)', () => {
  test('se leen del archivo, no se mezclan con la variable y su contenido nunca aparece en errores', async () => {
    const { conSecretosDeArchivo } = await import('../src/config.ts');
    const archivos: Record<string, string> = { '/run/secrets/auth': 'b'.repeat(40) + '\n' };
    const leer = (r: string) => { if (!(r in archivos)) throw new Error('no existe'); return archivos[r]!; };
    expect(conSecretosDeArchivo({ BETTER_AUTH_SECRET_FILE: '/run/secrets/auth' }, leer).BETTER_AUTH_SECRET).toBe('b'.repeat(40));
    expect(() => conSecretosDeArchivo({ BETTER_AUTH_SECRET: 'x', BETTER_AUTH_SECRET_FILE: '/run/secrets/auth' }, leer)).toThrow(/no ambos/);
    let m = '';
    try { conSecretosDeArchivo({ SMTP_CLAVE_FILE: '/run/secrets/falta' }, leer); } catch (e) { m = (e as Error).message; }
    expect(m).toMatch(/No se pudo leer el secreto SMTP_CLAVE_FILE/);
    expect(m).not.toContain('/run/secrets/falta');
  });
});

test('una variable vacía cuenta como no definida (archivos de entorno de Compose)', () => {
  const c = leerConfiguracion({ ...base, CORREO_MODO: 'buzon', SMTP_USUARIO: '', SMTP_CLAVE_FILE: '', GOOGLE_CLIENT_ID: '' });
  expect(c.SMTP_USUARIO).toBeUndefined();
  expect(c.proveedores).toEqual([]);
});
