# Fase 12 — Preproducción y validación multidispositivo (2026-11-04)

## Dictamen
| Estado | ¿Se alcanzó? |
|---|---|
| **CONFIGURACIÓN PREPARADA** | **SÍ** — archivos, guiones, verificación y documentación listos para un servidor externo |
| **PREPRODUCCIÓN DESPLEGADA** | **SÍ, sólo LOCAL** — contenedores reales en este equipo (`https://localhost:8443`). **No** hay preproducción institucional en un servidor externo |
| **PREPRODUCCIÓN VALIDADA** | **SÍ, sólo LOCAL y con dispositivos EMULADOS** — funcionales, multiusuario, seguridad, respaldos y rendimiento satisfactorios |
| **BLOQUEADA** | **La preproducción INSTITUCIONAL** — falta autorizar proveedor, costo, dominio y SMTP. Sin ella no se pueden hacer las pruebas con dispositivos físicos ni con iPhone |

Producción: **NO** desplegada, **NO** autorizada. No se contrató, compró, publicó ni migró nada. No se usaron datos reales.

## 1. Auditoría de entrada
| Suite | Resultado |
|---|---|
| `npm run check` (tipos + unitarias + compilación) | ✓ 191 unitarias |
| `npm run test:e2e` | ✓ 59 |
| `npm run test:servidor` | ✓ 127 |
| `npm run test:e2e:servidor` | ✓ 4 |
| `npm run test:piloto:multiusuario` | ✓ 3 |
| `npm audit --omit=dev` | ✓ 0 vulnerabilidades |

Hallazgos de la auditoría, corregidos en esta fase:
- **MEDIO** — límite de 3 códigos por minuto **por IP**: en una escuela todas las personas salen por la misma IP pública (NAT), así que el personal se bloquearía al llegar. Se sube a 30/min por IP y se agrega un límite **por correo** (3 cada 10 min, `LimitePorClave`). Pruebas: `fase11.test` y DEP-05.
- **BAJO** — el despliegue de la Fase 11 era manual (cambiar `VERSION` y `up`), sin verificación previa ni reversión. Ahora existe `desplegar.sh` (`VALIDACION_DESPLIEGUE.md`).
- **BAJO** — la CLI del servidor imprimía la traza completa ante un error de configuración. Ahora sólo muestra el mensaje.

## 2. Decisiones de arquitectura (validadas; las institucionales siguen PENDIENTES)
| Decisión | Estado | Elección / alternativas |
|---|---|---|
| Arquitectura | Validada | PWA local-first + API Node + PostgreSQL con RLS; un servicio por contenedor |
| Proveedor y región | **PENDIENTE (institucional)** | Recomendado: híbrido (nube en México + respaldos cifrados al NAS). Alternativas: (a) VM en la nube en región México o EE. UU.; (b) NAS o servidor en el plantel con túnel; (c) PostgreSQL administrado más adelante. `COMPARATIVA_NUBE_NAS_HIBRIDO.md` |
| Backend | Validado | Node 22 + Better Auth 1.7.11, imagen `servidor` |
| Base de datos | Validada | PostgreSQL 16 en contenedor para el piloto; administrado al crecer |
| Autenticación | Validada | Código por correo (OTP) + 2FA para administración y dirección; sólo invitados |
| Almacenamiento | Validado | IndexedDB en el dispositivo; volumen de Docker para PostgreSQL; respaldos `age` |
| Sincronización | Validada | Cola local + versión base + conflictos que decide la persona (`SINCRONIZACION.md`) |
| Respaldos | Validados | `pg_dump` cifrado con clave PÚBLICA; verificación aislada; restauración a base nueva |
| DNS | **PENDIENTE** | Requiere un dominio o subdominio institucional (A/AAAA a la IP del servidor) |
| HTTPS | Validado en local; **público PENDIENTE** | Caddy: `TLS=internal` en local; Let's Encrypt automático con dominio real |
| SMTP | **PENDIENTE** | Correo institucional (Google Workspace / Microsoft 365) o servicio de envío; siempre cifrado |

## 3. Entorno de preproducción (local)
`CONFIGURACION_PREPRODUCCION.md`. Proyecto `gestion-preprod`, versión **0.2.2-preprod**, base `gestion_piloto_preprod`, DEMO-001 ficticia (6 grupos, 300 alumnos, 24 personas, 180 clases semanales, 5 cuentas `*.piloto@ejemplo.test`). HTTPS con la autoridad interna de Caddy, registros con rotación, salud `/api/salud/lista`, respaldos cifrados, buzón Mailpit. Se reutilizaron los archivos de `deploy/` de la Fase 11, sin rehacerlos.

## 4. Pruebas contra la preproducción
| Suite | Qué cubre | Resultado |
|---|---|---|
| `npm run test:despliegue` — DEP-01..08 | HTTPS y cabeceras, puertos, SMTP real, sincronización, autorización, límites por IP y correo, actualización de la PWA, caída de la base y reinicio de la API | ✓ 8/8 |
| — DIS (4) | Multidispositivo **emulado** (`PRUEBAS_MULTIDISPOSITIVO.md`) | ✓ 4/4 |
| — MUP-01..05 | Multiusuario en navegadores independientes (`PRUEBAS_MULTIUSUARIO.md`) | ✓ 5/5 |
| — REN-01..04 | Rendimiento medido (§7) | ✓ 4/4 |
| `npm run test:preproduccion:flujo` | Flujo funcional (§5) | ✓ 17/17 |
| `verificar-seguridad.sh` | Seguridad (§8) | ✓ 0 fallas |

Corrección en las pruebas (no en la app): DEP-03 fallaba según la hora del día porque la prueba marcaba «Retardo» antes de que empezara la clase, y la app lo rechaza correctamente («La llegada … es antes del inicio de la clase»). La utilidad ahora alterna Falta ⇄ Presente y falla de inmediato si la app rechaza el guardado. Además, `entrar` espera y reintenta cuando el límite por IP (que DEP-05 agota a propósito) responde «Demasiados intentos», como haría una persona. Corrida final en una sola ejecución: **21/21**.

## 5. Flujo funcional (CONFIGURACIÓN → … → RESPALDOS)
Se ejecutan **sin cambios** las pruebas funcionales de la app contra la versión servida por la preproducción (HTTPS, Service Worker, imagen `web`). Cada una crea su **propia escuela ficticia** en un navegador nuevo, así que no se modificó ningún registro existente (DEMO-001 intacta).
| Etapa | Prueba | Resultado |
|---|---|---|
| Configuración (asistente, escuela, ciclo, turno, periodos, grupos) | `flujo-integral` | ✓ |
| Personal (docentes, adscripciones, importación) | `flujo-integral`, `catalogos` | ✓ |
| Alumnos (importación, inscripción, cambio de grupo) | `flujo-integral`, `catalogos` | ✓ |
| Horarios (asignación, horario confirmado, vista por día, reportes) | `flujo-integral`, `horarios` | ✓ |
| Asistencia (lista, retardo, salida y regreso, correcciones) | `flujo-integral`, `docente` | ✓ |
| Prefectura (incidencias, coberturas, reportes) | `prefectura` | ✓ |
| Reportes | `flujo-integral`, `prefectura` | ✓ |
| Respaldos (cifrado, restauración, conflictos) | `respaldos` | ✓ |
La parte **multiusuario** del flujo (sincronización, permisos y conflictos con el servidor real) está en `PRUEBAS_MULTIUSUARIO.md`.

## 6. Respaldos con restauración (preproducción)
| Paso | Resultado medido |
|---|---|
| `respaldar.sh` | ✓ 1.9 MB cifrado en 1 s |
| `verificar-respaldo.sh` (PostgreSQL temporal SIN RED) | ✓ suma SHA-256, descifrado, restauración sin errores, 7 migraciones y 38 tablas idénticas (40 571 registros), en 6 s |
| `restaurar.sh` a una base NUEVA (`gestion_piloto_preprod_rest_f12`) | ✓ en 2 s; la base vigente no se tocó |
| Comparación vigente vs. restaurada | ✓ 300 alumnos, 362 pases, 18 100 asistencias, 5 membresías en ambas |
La base restaurada se borró después: era una copia de prueba.

## 7. Rendimiento (medido el 2026-11-04; contenedores en ESTE equipo)
Medido en un solo equipo, sin red real de por medio: los números **no** representan internet ni redes móviles. Datos crudos en `test-results/rendimiento-preproduccion.json`. La tabla es la primera corrida; una segunda corrida completa el mismo día dio valores parecidos: primera carga 384 ms, `asistencias` mediana 374 ms, 50 simultáneas mediana 1 550 ms / p95 2 391 ms, descarga inicial 9.4 s, guardar → servidor 4.8 s.
| Medición | Resultado |
|---|---|
| Primera carga sin caché (local) | 363 ms; DOMContentLoaded 211 ms; 243 KB transferidos |
| Primera carga con red lenta **emulada** (≈1.6 Mbps, 150 ms) | 1 760 ms |
| Segunda carga (Service Worker) | 170 ms (local) / 183 ms (red lenta) |
| API `tablas/sesiones` (86 KB), 20 repeticiones | mediana 27 ms, p95 37 ms |
| API `tablas/inscripciones` (144 KB) | mediana 51 ms, p95 201 ms |
| API `tablas/pases` (206 KB) | mediana 46 ms, p95 55 ms |
| API `tablas/asistencias` (2.2 MB sin comprimir) | mediana 363 ms, p95 417 ms |
| `sincronizacion?desde=0` (todo el historial) | mediana 1 576 ms, p95 1 820 ms |
| **50 peticiones simultáneas** | todas ✓; mediana 1 319 ms, p95 2 238 ms, total 2.6 s |
| Descarga inicial de la escuela («Usar en este dispositivo», Prefectura) | 9.0 s |
| Guardar lista en el teléfono → visible en el servidor | mediana 5.0 s (incluye la espera del ciclo de envío de 5 s, `PINTAR_CADA_MS`) |
| Recursos tras las pruebas | servidor 111 MB / 768 MB; PostgreSQL 37 MB; Caddy 47 MB; Mailpit 12 MB; CPU en reposo < 1 % |
| Errores de red | caída de la base → API «no lista» y se recupera sola (DEP-07); sin conexión → cola y envío al volver (MUP-03, DEP-06) |
| Importaciones | se hacen en el navegador, no en el servidor: medidas en `RESULTADOS_RENDIMIENTO.md` (Fase 10). No se repitieron aquí |

Observaciones (no bloquean el piloto):
- **R-01 (MEDIO):** `asistencias` y `sincronizacion?desde=0` crecen con el historial: la descarga inicial completa tarda segundos y crecerá con el ciclo escolar. Se recomienda paginar por fecha o por secuencia antes de usarlo con varias escuelas (relacionado con P-02).
- **R-02 (BAJO):** el envío de un cambio espera hasta 5 s al ciclo del indicador. Se puede disparar al guardar.

## 8. Seguridad (preproducción)
`verificar-seguridad.sh`: ✓ todas las comprobaciones.
- **TLS:** sin 1.0/1.1; con 1.2/1.3; HTTP→HTTPS (308).
- **Puertos:** sólo `web` publica (80/443); `servidor` y `db` sin puertos; Mailpit sólo en 127.0.0.1.
- **Secretos:** sólo `*_FILE`; ausentes del historial y los archivos de las imágenes; fuera del repositorio.
- **Servidor:** corre como `node`.
- **Cabeceras:** HSTS, CSP, nosniff, Referrer-Policy; no revela el software.
- **Sin sesión:** 401/404 sin sesión; `/api/yo` → `null`.
- **Auditoría:** registra inicios de sesión, lecturas y sincronización, sin correos ni códigos.

Además: DEP-02 (la base no tiene salida a internet), DEP-04 y MUP-05 (autorización en el servidor), y DEP-05 (inventar `X-Forwarded-For` no evita el límite).
- **Abierto:** la imagen `web` (Caddy) corre con el usuario predeterminado de su imagen oficial.

## 9. Automatización del despliegue
`VALIDACION_DESPLIEGUE.md`: `desplegar.sh` (9 pasos con reversión automática, probada con una versión rota) y la verificación continua `deploy/ci/verificacion.yml`, que está **inactiva** y no despliega. Nada se conectó a producción.

## 10. Problemas pendientes
| Id | Severidad | Problema | Requiere |
|---|---|---|---|
| — | **BLOQUEO** | No existe preproducción institucional (servidor, dominio, certificado público, SMTP) | Autorización y costo |
| — | ALTO para el piloto | Sin pruebas en dispositivos **físicos**; iPhone/Safari **no probado** | Preproducción institucional |
| R-01 | MEDIO | Descargas completas que crecen con el historial | Código (fase siguiente) |
| P-01 | MEDIO | El servidor no recalcula choques de horario al sincronizar | Código |
| P-02 | MEDIO | `sincronizacion.cambios` crece sin límite | Código / decisión |
| S4 | MEDIO | Base local única por dispositivo compartido | Código / decisión |
| — | MEDIO | Aviso de privacidad y responsables de datos | Institucional |
| R-02 | BAJO | Envío hasta 5 s después de guardar | Código |

## 11. Para avanzar (requiere AUTORIZACIÓN EXPRESA; no se hizo nada de esto)
1. Elegir proveedor y región, y aprobar el costo mensual (cotización).
2. Designar un subdominio de preproducción y a quien administre el DNS.
3. Definir el SMTP de envío (cuenta institucional o servicio), con SPF/DKIM.
4. Designar a quien administre el servidor y resguarde la clave privada de respaldos.
5. Con eso: seguir `CONFIGURACION_PREPRODUCCION.md` §8 y el protocolo físico de `PRUEBAS_MULTIDISPOSITIVO.md`.
