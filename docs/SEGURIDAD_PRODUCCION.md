# Seguridad en producción — Gestión Escolar (Fase 11)

Complementa `docs/SEGURIDAD.md` (controles de la aplicación, Fase 9) con los controles del **despliegue**. Lo marcado ✓ está implementado y **probado en la preproducción local** (`tests/despliegue/`, `servidor/pruebas/fase11.test.ts`); lo marcado ☐ depende del despliegue real y de autorización.

## 1. Red y puertos
| Control | Estado |
|---|---|
| Sólo `web` (Caddy) publica puertos: 80 (redirección a HTTPS) y 443 (TCP y UDP/HTTP3) | ✓ DEP-01, DEP-02 |
| PostgreSQL (5432) y la API (8787) **no** se publican; sólo existen en la red de los contenedores | ✓ DEP-02 |
| La base está en una red `internal` (sin salida a internet). La API sale sólo por la red `correo` (SMTP) | ✓ DEP-02 (la base no tiene salida) |
| La API de administración de Caddy está apagada (`admin off`) | ✓ |
| Firewall del anfitrión: entrada sólo 80/443 desde internet; SSH sólo por VPN o desde IP de administración; todo lo demás cerrado | ☐ Configurar en el servidor real (ver `OPERACION_SERVIDOR.md` §2) |
| **Nunca** exponer la administración del NAS, SSH ni PostgreSQL a internet | ☐ Regla de operación |
| Docker publica puertos por encima de UFW o iptables: no agregar `ports:` a `db` ni a `servidor` | ✓ (archivo `docker-compose.yml`) |

## 2. HTTPS y certificados
- Caddy obtiene y **renueva solo** el certificado de Let's Encrypt (`TLS=correo@…`). En preproducción usa un certificado propio (`TLS=internal`).
- **HSTS** de 1 año (`includeSubDomains`). La redirección HTTP → HTTPS es automática (✓ DEP-01).
- El servidor se niega a arrancar en producción o preproducción sin `URL_PUBLICA` https (✓ pruebas).
- Cookies `Secure` y `HttpOnly` en producción y preproducción. El token nunca va en el cuerpo (`sinTokens`).
- Vigilar el vencimiento del certificado: `salud.sh` lo muestra; alertar si quedan menos de 14 días (`OPERACION_SERVIDOR.md` §5).

## 3. Cabeceras y navegador
✓ DEP-01:
- `Strict-Transport-Security`;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: no-referrer`;
- `Permissions-Policy` (cámara, micrófono y geolocalización desactivados);
- `Cross-Origin-Opener-Policy`;
- CSP: `default-src 'self'`, sin scripts ni estilos en línea, en `index.html`; más `frame-ancestors 'none'` por cabecera;
- sin cabecera `Server`;
- los mapas de código (`*.map`) no se publican.

## 4. CORS y CSRF
- **No hay CORS:** la PWA y la API comparten el **mismo origen**, así que el servidor no envía cabeceras `Access-Control-Allow-*`. Una página de otro origen no puede leer respuestas.
- **CSRF:**
  - todo POST exige `Origin` igual a `URL_PUBLICA` (✓ DEP-04: otro origen → 403);
  - los cuerpos deben ser JSON;
  - la cookie es `SameSite`.

## 5. Abuso y límites
- **Límites de intentos por IP real** (ajustados en la Fase 12, porque en una escuela muchas personas salen a internet por la MISMA IP pública):
  - 30 solicitudes de código por minuto (`LIMITE_CODIGOS_POR_MINUTO`);
  - 60 intentos de código o de segundo factor por minuto (`LIMITE_INTENTOS_POR_MINUTO`);
  - 120 peticiones por minuto en la autenticación.
- **Límite por CORREO** (Fase 12, `LIMITE_CODIGOS_POR_CORREO`, 3 cada 10 min por omisión): impide inundar el buzón de una persona aunque se cambie de IP. Preproducción usa 20 para las pruebas automáticas. Probado: `fase11.test` y DEP-05.
- **Detrás del proxy** (corregido en la Fase 11):
  - el servidor sólo cree `X-Forwarded-For` si la conexión viene de `PROXIES_CONFIABLES`, y la lee de derecha a izquierda;
  - Caddy reemplaza la cabecera que envía el cliente.
  - Resultado: una IP bloqueada no bloquea a las demás, e inventar la cabecera no evita el límite (✓ `fase11.test`, DEP-05).
- **Tamaño de los cuerpos:**
  - 64 KB en general;
  - 4 MB en sincronización;
  - 40 MB en migración (Caddy corta a 41 MB).
- **Recursos de los contenedores:** el servidor tiene un límite de memoria de 768 MB.
- ☐ Opcional en producción: limitar conexiones por IP en el firewall del proveedor, o un servicio anti-DDoS del proveedor.

## 6. Sesiones y cuentas
- Sólo personas **invitadas**; sin registro abierto ni contraseñas.
- Código de un solo uso: guardado con hash, vigente 5 minutos, 3 intentos.
- Segundo factor obligatorio para Administración, Dirección y Subdirección.
- Sesiones de 72 horas (configurable), consultadas siempre en la base: **la revocación es inmediata**. Cerrar sesión en un dispositivo no afecta a otros (✓ Fase 10 MU-03).
- Al cerrar sesión en un dispositivo compartido se ofrece quitar los datos locales.
- Reiniciar la API no invalida las sesiones (✓ DEP-08).

## 7. Autorización (cada lectura y escritura)
| Perfil (rol del servidor) | Lee | Escribe |
|---|---|---|
| Administrador (`administrador`) | Toda su escuela | Configuración, catálogos, horarios (D14), cuentas e invitaciones |
| Dirección (`direccion`) | Toda su escuela, CURP incluida | Confirmar o autorizar (D5), horarios, delegaciones |
| Subdirección (`subdireccion`) | Toda su escuela, CURP incluida | Como Dirección, según la delegación |
| Prefectura (`prefectura`) | Toda su escuela (sin CURP) | Incidencias del personal, coberturas, banco de actividades |
| Docente (`docente`) | Sus grupos | Pase de lista, salidas y reportes de sus clases |
| Personal de apoyo (`apoyo`) | Lo mínimo de su función | Lo mínimo de su función |

Fuente: matriz en la base (`acceso.matriz`) y **RLS en las 31 tablas** con el rol restringido `gestion_app`. Probado: 2 escuelas × 6 roles × 31 tablas (`aislamiento.test.ts`, 13 pruebas), comandos (`comandos.test.ts`) y DEP-04 en preproducción.

**Ocultar una pantalla no es un permiso:** el servidor rechaza aunque alguien llame a la API directamente.

## 8. Secretos y configuración
- Los secretos viven en `deploy/secretos/` (carpeta 700) y se leen como `*_FILE`. No están en el repositorio, en las imágenes ni en variables visibles (`docker inspect`). Los errores nunca muestran su valor (✓ pruebas).
- `.dockerignore` excluye `.env`, secretos, respaldos y datos del contexto de construcción.
- **Rotación:**
  - `better_auth_secret`: cierra todas las sesiones;
  - clave de la base: `ALTER ROLE` más actualizar `database_url`;
  - clave SMTP.

  Procedimiento en `OPERACION_SERVIDOR.md` §7.
- **Clave privada de age (respaldos):** nunca en el servidor. Custodia de la institución, con dos personas responsables y una copia sellada fuera de línea.

## 9. Actualizaciones de seguridad
- **Sistema del anfitrión:** actualizaciones de seguridad automáticas (`unattended-upgrades`) y reinicio programado.
- **Imágenes:** reconstruir con `construir.sh` al menos una vez al mes y ante cada aviso de seguridad de Node, Caddy o PostgreSQL. Fijar las imágenes base por resumen (`@sha256:`) en producción y registrar cuál se desplegó.
- **Dependencias:**
  - `npm audit --omit=dev` = 0 hoy;
  - Better Auth 1.7.11 tiene versiones posteriores: revisar sus notas antes de publicar (S6);
  - nodemailer 10.1.7: se eligió una versión con más de dos semanas publicada, no la más reciente.
- Cada actualización sigue el procedimiento de `OPERACION_SERVIDOR.md` §6: respaldo, preproducción y luego producción.

## 10. Registro y privacidad de los registros
- **Registros de la API:** sin datos personales. Nunca contienen correos, nombres, códigos ni contenido de peticiones; los errores del correo sólo llevan un código técnico (✓ `fase11.test`).
- **Caddy:** IP, ruta, estado y duración. Las rutas de la API contienen identificadores, no nombres. Retención sugerida: 30 días.
- **Auditoría de negocio:** `acceso.auditoria`, de sólo agregar (la base rechaza modificarla o borrarla).

## 11. Protección de datos personales (requisitos que deben revisar las autoridades responsables)
> **No se afirma cumplimiento legal.** Esta lista es una guía técnica para la revisión institucional y, cuando corresponda, la asesoría jurídica. El marco legal mexicano cambió en 2025, y su aplicación a cada escuela debe validarla un especialista.

**Marco a revisar** (verificar los textos vigentes en el DOF y con asesoría jurídica):
- **Escuelas públicas** (sujetos obligados): Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados, expedida por el decreto publicado en el DOF el 20 de marzo de 2025. Hay que confirmar qué autoridad garante corresponde a cada nivel, federal o estatal: el INAI se extinguió por ese decreto y sus funciones se reasignaron.
- **Escuelas particulares:** Ley Federal de Protección de Datos Personales en Posesión de los Particulares (nueva ley, vigente desde el 21 de marzo de 2025). Autoridad: Secretaría Anticorrupción y Buen Gobierno.
- **Datos de menores:** interés superior de la niñez (Ley General de los Derechos de Niñas, Niños y Adolescentes) y la normativa educativa de la entidad.

**Requisitos de tratamiento a definir y documentar por la institución:**
1. **Responsable** del tratamiento (la escuela o la autoridad educativa) y **encargado** (el operador técnico y, en su caso, el proveedor de nube), con un contrato que lo establezca.
2. **Aviso de privacidad** publicado antes de usar datos reales (B-04), con finalidades (control escolar, asistencia y coberturas), datos tratados y derechos ARCO.
3. **Minimización:** la app pide datos mínimos. No guarda fecha de nacimiento, domicilio ni contacto de alumnos; la CURP es opcional y sólo la ve Dirección. Mantenerlo así.
4. **Consentimiento o fundamento legal** para tratar datos de menores. Para el personal que use correo personal en lugar del institucional, la app ya pide su consentimiento expreso.
5. **Conservación y eliminación:** retención por ciclo (D7). Definir plazos para asistencia, reportes y respaldos (§ `RESPALDOS_PRODUCCION.md`), y el procedimiento para suprimir datos al terminar la relación.
6. **Proveedores y transferencias:** región en México; contrato con cláusulas de confidencialidad, seguridad, subcontratistas y devolución o borrado al terminar. El SMTP institucional procesa direcciones de correo (no datos de alumnos).
7. **Medidas de seguridad documentadas** (este documento) y su revisión periódica.
8. **Gestión de incidentes:** procedimiento de `PLAN_RECUPERACION.md` §6. Verificar con asesoría jurídica las obligaciones de notificación (a quién, en qué plazo y con qué contenido).
9. **Derechos ARCO:** canal y responsable para atender solicitudes. La app permite consultar, corregir y dar de baja, conservando el historial.

## 12. Riesgos que siguen abiertos
| # | Severidad | Riesgo | Mitigación |
|---|---|---|---|
| S4 | MEDIO | Base local única por dispositivo (cuentas que comparten un navegador) | Dispositivos personales; quitar datos al cerrar sesión (se ofrece) |
| P-01 | MEDIO | Choques de horario no recalculados por el servidor al sincronizar registros | Una persona arma los horarios de cada turno; revisión de horarios tras sincronizar |
| P-02 | MEDIO | `sincronizacion.cambios` crece sin límite (D7 pendiente) | Vigilar el tamaño (§ operación); definir la retención |
| P-03 | BAJO | Datos locales sin cifrar en reposo en los dispositivos | Bloqueo de pantalla obligatorio; dispositivos institucionales |
| P-04 | BAJO | La imagen del servidor incluye dependencias que sólo usa el navegador (OCR, PDF): 613 MB | Separar las dependencias del servidor en una versión posterior |
| S6 | BAJO | Better Auth con versión posterior | Revisar antes de publicar |

Fuentes del marco legal (consultadas el 2026-11-04; verificar los textos oficiales):
- [Cámara de Diputados — LGPDPPSO (PDF)](https://www.diputados.gob.mx/LeyesBiblio/pdf/LGPDPPSO.pdf)
- [Cámara de Diputados — LFPDPPP (PDF)](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)
- [IDC Online — la Secretaría Anticorrupción y Buen Gobierno asumirá funciones del INAI](https://idconline.mx/corporativo/2025/03/04/secretaria-anticorrupcion-y-buen-gobierno-asumira-funciones-del-inai)
- [Mondaq — extinción del INAI](https://www.mondaq.com/mexico/data-protection/1603734/extinction-of-the-national-institute-for-transparency-access-to-information-and-personal-data-protection)
- [EY — nueva LFPDPPP](https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares)
