# Fase 11 — Despliegue institucional: preparación (informe)

**Fecha:** 2026-11-04.
- **Qué se hizo:** preparar Gestión Escolar Universal para un despliegue institucional seguro y reproducible, y probarlo en una **preproducción local** con contenedores reales (HTTPS, PostgreSQL, SMTP de prueba) y la escuela ficticia DEMO-001.
- **Qué no se hizo:** no se publicó la aplicación, no se contrató ningún servicio, no se compró ningún dominio y no se usaron ni migraron datos reales.

Documentos de la fase:
- `ARQUITECTURA_PRODUCCION.md`
- `COMPARATIVA_NUBE_NAS_HIBRIDO.md`
- `SEGURIDAD_PRODUCCION.md`
- `RESPALDOS_PRODUCCION.md`
- `OPERACION_SERVIDOR.md`
- `PLAN_RECUPERACION.md`
- `GUIA_PUBLICACION.md`
- `CHECKLIST_PRODUCCION.md`

## 1. Auditoría de entrada (antes de modificar código)
| Punto | Resultado |
|---|---|
| Frontend | PWA Vite + TypeScript + Dexie (esquema local v13), Service Worker sólo con recursos estáticos |
| Backend | **Existe**: Node 22 (`servidor/`), compilado con Vite, que reutiliza los servicios de la app |
| Base de datos | PostgreSQL 16; migraciones 0001–0007 con huella; RLS en 31 tablas con el rol `gestion_app` |
| Autenticación | Real: Better Auth (código por correo, segundo factor, Google o Microsoft opcional), sólo personas invitadas |
| Permisos institucionales | Reales, en el servidor: 6 roles × 31 tablas, matriz más RLS (`aislamiento.test`) |
| Sincronización | Real contra el servidor (cola, versión base, conflictos explícitos, idempotencia); probada con varios navegadores (Fase 10) |
| Respaldos | Locales (dispositivo, cifrados). **No había respaldos del servidor** |
| Pruebas | 191 unitarias, 59 funcionales, 114 del servidor, 4 con servidor real y 3 multiusuario: **todas pasan**. `npm audit --omit=dev` = 0 |
| Compilación de producción | Correcta |
| **Bloqueos de despliegue encontrados** | (1) **SMTP no implementado:** el servidor se negaba a arrancar en producción, y sin correo nadie recibe su código. (2) El servidor sólo escuchaba en 127.0.0.1 (inviable en contenedores). (3) Detrás de un proxy, todas las personas compartirían la IP del proxy: un atacante bloquearía a toda la escuela, y el límite no lo frenaría a él. (4) La comprobación de salud no revisaba la base de datos. (5) No había empaquetado de despliegue, HTTPS, respaldos del servidor ni monitoreo. (6) Dos textos de la interfaz afirmaban que la cuenta «no envía» datos (falso desde 8D) |

**No había errores críticos ni altos abiertos en el código de las fases anteriores.** Los bloqueos (1) a (5) impedían el despliegue y se resolvieron en esta fase (§3).

## 2. Arquitectura recomendada
**Híbrida** (detalle y alternativas en `COMPARATIVA_NUBE_NAS_HIBRIDO.md`):
- la aplicación y PostgreSQL en una nube con región en México (Docker Compose en una máquina virtual para empezar);
- respaldos cifrados copiados al **NAS** de la institución, más una copia externa.

Se reutiliza la arquitectura real del proyecto, sin cambiar de base de datos ni de lenguaje. Diagramas en `ARQUITECTURA_PRODUCCION.md`.

## 3. Cambios en el código (preparación)
| Cambio | Archivos | Prueba |
|---|---|---|
| **SMTP real** (nodemailer 10.1.7, sólo en el servidor): cifrado obligatorio en producción (TLS o STARTTLS); sin cifrar sólo en preproducción con un buzón de prueba local; los errores no llevan destinatario ni contenido | `servidor/src/correo.ts` | `fase11.test` (SMTP de prueba en el proceso), DEP-03 (Mailpit) |
| **Modo `preproduccion`**, con las exigencias de producción | `config.ts`, `auth.ts`, `http.ts`, `api.ts` | `fase11.test` |
| Producción **se niega** a usar una base de desarrollo, pruebas, piloto, demostración o preproducción | `config.ts` | `fase11.test` |
| `HOST` configurable (contenedores) | `principal.ts` | Pila de preproducción |
| **IP real del cliente** sólo desde `PROXIES_CONFIABLES`, leída de derecha a izquierda | `servidor/src/ipCliente.ts` | `fase11.test`, DEP-05 |
| **Secretos `*_FILE`** (Docker secrets); variables vacías = no definidas | `config.ts`, `herramientas/piloto.ts` | `fase11.test` |
| **`/api/salud/lista`** (base de datos y migraciones) | `api.ts` | `fase11.test`, DEP-07 |
| La PWA pide confirmación antes de actualizar si hay cambios sin guardar | `src/pwa.ts` | Revisión de código; DEP-06 cubre la actualización |
| Texto falso en «Aplicación y datos» corregido | `src/pages/aplicacion.ts` | `cuenta-local.spec` |
| `VERSION_APP` por variable de entorno (etiqueta de la compilación) | `vite.config.ts` | DEP-06 |
| **INC-F11-01 (ALTO):** la restauración ya no puede mostrar la revisión de un archivo y restaurar otro | `src/pages/respaldos.ts` | PIL-RES-01 (3 de 6 fallos sin corregir → 6 de 6 con la corrección) |

## 4. Archivos preparados (`deploy/`)
| Archivo | Qué hace |
|---|---|
| `Dockerfile` | Imagen **servidor** (Node 22.23, usuario `node`, sólo lectura, comprobación de salud) e imagen **web** (Caddy con la PWA), construidas con el mismo código; soporta proxy corporativo |
| `docker-compose.yml` | db, servidor y web. Sólo `web` publica 80/443; db en red interna sin internet; secretos montados; límites; rotación de registros |
| `compose.preproduccion.yml` | Buzón SMTP de prueba (Mailpit), carga de DEMO-001 |
| `Caddyfile` | HTTPS automático, HSTS y cabeceras; `/api/desarrollo` cerrado; caché correcta para la PWA; administración apagada |
| `.env.example`, `preproduccion.env.example` | Variables **sin secretos** |
| `postgres/10-roles.sh` | Usuario de la app sin superusuario (dueño de su base, `CREATEROLE` para la migración 0004) |
| `scripts/generar-secretos.sh` | Secretos aleatorios en `deploy/secretos/` (fuera de git) |
| `scripts/construir.sh` | Imágenes con su etiqueta de versión |
| `scripts/salud.sh` | Salud externa (PWA, API y base, HSTS, buzón cerrado, certificado) |
| `scripts/respaldar.sh` | Respaldo cifrado (age, clave pública) con manifiesto y retención |
| `scripts/verificar-respaldo.sh` | Restaura en un PostgreSQL temporal **sin red** y compara con el manifiesto |
| `scripts/restaurar.sh` | Restaura en una base **nueva** (nunca sobrescribe); en producción exige autorización y respalda antes |
| `scripts/reiniciar-preproduccion.sh` | Reinicia **sólo** la preproducción (candados) |
| `scripts/avisar.sh` | Canal de alertas (a definir por la institución) |
| `.dockerignore` (raíz) | Ningún secreto, dato ni respaldo entra en el contexto de construcción |

## 5. Requisitos
**Hardware (piloto, 1 a 3 escuelas):**
- servidor con 2 vCPU, 4 GB de RAM y 40 GB de SSD;
- si es local: UPS y discos en espejo.

Medido en reposo: ~25 MB (PostgreSQL), ~45 MB (API) y ~22 MB (Caddy).

Crecimiento estimado a partir de una medición:
- ~0,5 GB por escuela de 1 500 alumnos por ciclo;
- respaldos ~10 veces más chicos.

**Software:**
- Linux LTS de 64 bits;
- Docker Engine y Docker Compose v2;
- age (en el equipo que verifica respaldos);
- un dominio con DNS;
- SMTP institucional con TLS;
- navegadores actuales en los dispositivos: Chrome o Edge en Android y computadoras; Safari en iPhone y iPad (iOS 16.4 o posterior para instalar la PWA).

**Costos:** **requieren cotización** (no hay información comercial verificada). Los componentes están listados en `COMPARATIVA_NUBE_NAS_HIBRIDO.md`.

## 6. Pruebas ejecutadas
Ejecución final del 2026-11-04 (después de la última corrección de código):

| Suite | Comando | Resultado |
|---|---|---|
| Tipos, unitarias y compilación | `npm run check` | **191 de 191**; compilación correcta |
| Funcionales (versión compilada con Service Worker) | `npx playwright test` | **59 de 59**; `respaldos.spec` y `cuenta-local.spec` se repitieron después de la última corrección: 6 de 6 |
| Servidor (PostgreSQL 16 real) | `npm run test:servidor` | **127 de 127** (13 nuevas de la Fase 11) |
| Servidor real con navegador | `npm run test:e2e:servidor` | **4 de 4** |
| Piloto local (Android, tableta y escritorio emulados) | `npm run test:piloto` | **36 de 36** (12 casos × 3; incluye PIL-RES-03 nuevo) |
| Piloto multiusuario | `npm run test:piloto:multiusuario` | **3 de 3** |
| **Despliegue contra la preproducción en contenedores** | `npm run test:despliegue` | **8 de 8** (DEP-01 a DEP-08) |
| Imágenes Docker | `deploy/scripts/construir.sh` | Correcta (servidor 613 MB, web 122 MB) |
| Respaldo, verificación aislada y restauración | `deploy/scripts/*.sh` | Correctos; alterado o clave equivocada rechazados (`RESPALDOS_PRODUCCION.md` §6) |
| Dependencias de producción | `npm audit --omit=dev` | **0** vulnerabilidades |

**Defecto encontrado en la ejecución final y corregido (INC-F11-01, ALTO):**
- **El defecto:** en «Restaurar», si se elegía otro archivo mientras el anterior todavía se revisaba, la revisión vieja podía reemplazar en pantalla a la vigente (el formulario de contraseña desaparecía). Así, se podía confirmar la restauración de un archivo después de ver la revisión de otro. El servicio vuelve a verificar el archivo al restaurar, así que nunca se escribía algo inválido, pero la confirmación no correspondía a lo que se veía.
- **La corrección:** cada archivo abre un «turno». Sólo se muestra la revisión del archivo vigente, y sólo se restaura exactamente el archivo revisado.
- **La evidencia:** la prueba original PIL-RES-01 falló 3 de 6 veces sin la corrección y pasó 6 de 6 con ella, en las mismas condiciones. La nueva PIL-RES-03 comprueba el caso, pero en su disposición actual no logró provocar la carrera sin la corrección: no se cuenta como prueba de regresión.

### Qué fue real y qué quedó pendiente
| Prueba pedida | Real (aquí) | Pendiente |
|---|---|---|
| 1. Compilación | ✓ App, servidor e imágenes Docker | — |
| 2. Inicio del frontend | ✓ Caddy con la PWA (DEP-01) | — |
| 3. Inicio del backend | ✓ Contenedor del servidor, migraciones aplicadas al arrancar | — |
| 4. Conexión con la base | ✓ Usuario sin superusuario; `/api/salud/lista` | — |
| 5. Autenticación | ✓ Código por **SMTP real** a un buzón de prueba (DEP-03) | SMTP institucional real; SPF, DKIM y DMARC |
| 6. Autorización | ✓ DEP-04 más la batería de aislamiento | — |
| 7. Tamaños de pantalla | ✓ Pruebas de la Fase 10 (3 perfiles emulados); DEP con Pixel 7 emulado | Dispositivos físicos; iPhone y Safari |
| 8. HTTPS | ✓ Con certificado **propio** de Caddy (TLS=internal) | Certificado público de Let's Encrypt con un dominio real |
| 9. Persistencia | ✓ Volúmenes; datos tras reiniciar la base y la API (DEP-07, DEP-08) | — |
| 10. Sincronización | ✓ Lista → servidor, cola sin conexión → envío (DEP-03, DEP-06, DEP-07); multiusuario (Fase 10) | Varios dispositivos físicos contra un servidor desplegado |
| 11. Respaldos | ✓ Cifrado, manifiesto y suma | Programación con cron; copia al NAS |
| 12. Restauración | ✓ Verificación aislada; restauración a una base nueva; alterado y clave equivocada rechazados | Cambio a la base restaurada; simulacro completo en un servidor nuevo (RTO) |
| 13. Actualización | ✓ PWA 0.1.0 → 0.1.1 con la cola pendiente: aviso, actualización y nada se pierde (DEP-06) | Actualización con una migración nueva en un servidor real |
| 14. Recuperación tras fallo | ✓ Caída de la base (503 → recuperación sola, sin duplicados) y reinicio de la API (DEP-07, DEP-08) | Pérdida total del servidor (simulacro) |

## 7. Problemas pendientes
| # | Severidad | Pendiente | Tipo |
|---|---|---|---|
| B-01 | Bloqueo | Servidor, dominio y SMTP institucional: **requieren autorización y contratación** | Externo |
| B-02/B-03 | Bloqueo para datos reales | Pruebas en dispositivos físicos, incluido iPhone | Externo |
| B-04 | Bloqueo para datos reales | Aviso de privacidad y revisión jurídica | Externo |
| S4 | MEDIO | Base local única por dispositivo (dispositivos compartidos) | Código / decisión |
| P-01 | MEDIO | El servidor no recalcula los choques de horario al sincronizar registros | Código |
| P-02 | MEDIO | `sincronizacion.cambios` crece sin límite (retención D7) | Código / decisión |
| B-06 | MEDIO | Servidor sin medir con volumen ni con muchas personas a la vez | Prueba |
| P-04 | BAJO | Imagen del servidor de 613 MB (incluye dependencias que sólo usa el navegador) | Código |
| S6 | BAJO | Better Auth: revisar las versiones posteriores a 1.7.11 | Mantenimiento |
| P-05 | BAJO | El archivado continuo de WAL (RPO < 24 h) no está implementado | Decisión |

**No hay riesgos críticos sin resolver en lo preparado.** Los bloqueos son externos: autorización, contratación, legal y dispositivos.

## 8. Estado del despliegue
| Estado | ¿Alcanzado? | Evidencia o motivo |
|---|---|---|
| **PREPARACIÓN COMPLETADA** | **Sí** | Arquitectura documentada; configuración reproducible (`deploy/`); pruebas locales satisfactorias (§6); sin riesgos críticos; respaldo y restauración probados en un entorno aislado; lista de requisitos completa (`CHECKLIST_PRODUCCION.md`) |
| **PREPRODUCCIÓN VALIDADA** | **No** | Sólo existe la preproducción **local**. Falta la preproducción de la institución con un dominio y certificado públicos, y la prueba en dispositivos físicos |
| **PRODUCCIÓN AUTORIZADA** | **No** | Requiere autorización escrita (infraestructura, dominio, aviso de privacidad, responsables, datos reales) |
| **PRODUCCIÓN OPERATIVA** | **No** | No hay despliegue real |

**Me detengo aquí:** antes de cualquier publicación o contratación hace falta autorización expresa (`GUIA_PUBLICACION.md` §3, pasos 🔒).
