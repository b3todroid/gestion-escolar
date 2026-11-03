# Seguridad — Gestión Escolar (revisión de la Fase 9)

Revisión hecha sobre el código y verificada con pruebas automatizadas (datos ficticios). Distingue lo que **existe y está probado** de lo que **falta para un piloto real**.

## 1. Dos modos de uso
| Modo | Quién decide el acceso | Estado |
|---|---|---|
| **Sólo dispositivo** (por omisión; `iniciar.cmd`) | Quien tenga el dispositivo. El «docente de este dispositivo» es una **preferencia, no una cuenta**, y así lo dice la interfaz | Operativo |
| **Con servidor escolar** (Fases 8B–8E) | El **servidor**: cuentas con invitación, verificación en dos pasos, membresías, RLS | Implementado y probado **sólo en un entorno local**. **No hay servidor desplegado**: el multiusuario institucional todavía no está operativo para una escuela real |

## 2. Controles implementados (y su prueba)
| Área | Control | Prueba |
|---|---|---|
| Autenticación | Sin contraseñas; código de un solo uso al correo (con hash, 5 min, 3 intentos) o cuenta institucional (OIDC); sólo personas invitadas; correo no invitado = misma respuesta | `fase8b.test.ts`, `sso.test.ts` |
| Segundo factor | TOTP obligatorio para Administración, Dirección y Subdirección; códigos de respaldo de un uso; no se desactiva con el segundo factor pendiente | `fase8b.test.ts` |
| Sesiones | Cookie HttpOnly (Secure en producción); el token nunca va en una respuesta; revocación inmediata (se consultan en la base); cerrar una o todas | `fase8b.test.ts`, e2e |
| Autorización | Matriz por rol (`acceso.matriz`) + RLS en las 31 tablas con rol restringido `gestion_app`; transacción atada a la escuela de la ruta; reglas de confirmar y autorizar (D5) en la base | `aislamiento.test.ts` (2 escuelas × 6 roles × 31 tablas) |
| Aislamiento | Ninguna fila apunta a otra escuela (disparador, también para el dueño); sin membresía no se ve nada | `aislamiento.test.ts` |
| CSRF | POST sólo con `Origin` de la app; JSON; cuerpos con límite (64 KB; 4 MB sincronización; 40 MB migración) | `fase8b.test.ts` |
| Límites de intentos | Códigos y verificaciones por minuto y dirección | `fase8b.test.ts` |
| Superficie mínima | Rutas de autenticación en lista blanca (registro, contraseñas, cambio de correo, borrado → 404) | `fase8b.test.ts` |
| XSS | Ningún `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` ni `new Function` en `src/` (revisado); todo con `textContent` (`h()`); CSP sin estilos ni scripts en línea | `configuracion.spec` («los textos se muestran como texto») |
| Archivos | Excel/CSV ≤ 5 MB y ≤ 3000 filas; ZIP ≤ 20 MB descomprimido; PDF ≤ 20 MB y ≤ 40 páginas; OCR ≤ 10 páginas, local (sin CDN); logotipo ≤ 3 MB e imagen validada; respaldos ≤ 120 MB (≤ 400 MB descomprimidos, corte por flujo) validados con Zod por tabla, referencias y huella | pruebas de importación, PDF y respaldos |
| Secretos | Nada del servidor en la app compilada; configuración del servidor sólo por variables de entorno, validada; producción bloqueada sin HTTPS ni SMTP | `cuenta-local.spec`, `fase8b.test.ts` |
| Datos personales | CURP sólo para Dirección y Subdirección; matrícula y observaciones según rol; auditoría sin correos, nombres ni códigos; errores sin datos personales | `comandos.test.ts`, revisión |
| Auditoría | `acceso.auditoria` de sólo agregar (la base rechaza modificar, borrar y vaciar); comandos, sincronización, migración, accesos | `fase8b.test.ts`, `comandos.test.ts` |
| Respaldos | Cifrado AES-GCM + PBKDF2 (600 000) por omisión; contraseña nunca guardada; restauración todo o nada | `fase5-respaldos.test.ts`, e2e |
| Sincronización | Versión base obligatoria (nunca «el último gana»); claves naturales = conflicto; idempotencia; grupos todo o nada; **la cola sólo se envía con la sesión de la cuenta que vinculó la escuela** (corregido en la Fase 9) | `dispositivos.test.ts` |
| Service Worker | Sólo recursos estáticos; nunca responde `/api/*`; no guarda datos escolares en cachés | `offline.spec` |

## 3. Hallazgos de la Fase 9
| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| S1 | **CRÍTICO** | Con escuelas sincronizadas, si otra persona iniciaba sesión en el mismo dispositivo, la cola pendiente de la primera se enviaba con la sesión de la segunda: se le atribuía a ella y se evaluaba con sus permisos | **Corregido** (verifica la cuenta antes de enviar) y con prueba |
| S2 | **ALTO** | En un dispositivo compartido, al cerrar sesión los datos descargados de la escuela quedaban en el dispositivo sin aviso | **Corregido**: al cerrar sesión se ofrece quitarlos. Nunca se quitan en silencio, y no se permite quitarlos si hay cambios sin enviar. Con prueba |
| S3 | MEDIO | El indicador de sincronización podía quedar desactualizado (por ejemplo, «Sincronizado» después de quitar la escuela) | **Corregido**: se recalcula de la cola real cada 5 s y tras cada acción |
| S4 | MEDIO | Base local única para todas las cuentas del dispositivo: mientras no se quiten, los datos de una cuenta son visibles para quien use el mismo navegador | **Abierto**: mitigado con S2. Propuesta para antes del piloto: base local separada por persona |
| S5 | BAJO | 10 vulnerabilidades en herramientas de desarrollo (cadena `vite-plugin-pwa` → `workbox-build`: ejs, minimatch, glob, deepmerge). No llegan a la app ni al servidor (`npm audit --omit=dev` = 0) | **Abierto**: la corrección exige bajar de versión con cambios incompatibles. Revisar en cada actualización |
| S6 | BAJO | Better Auth 1.7.11 tiene versiones posteriores (1.7.15) | **Abierto**: revisar sus notas de seguridad antes del despliegue |
| S7 | **CRÍTICO** (disponibilidad e integridad) | Una escuela con algunas semanas de asistencia **no se podía respaldar** (desbordamiento de pila con ~157 000 registros) **ni restaurar** (respaldo de 71,5 MB contra un límite de 25 MB). La protección ante pérdida de datos no funcionaba justo cuando hay más datos | **Corregido**: compresión gzip (11,2 MB), límites de 120 MB por archivo y 400 MB descomprimido, con lectura por flujo y corte al exceder (evita «bombas» de compresión), sin desbordamiento. Con pruebas (`fase9-respaldos-grandes.test.ts`, `test:rendimiento`) |
| S8 | **ALTO** (información engañosa) | «Cuenta» afirmaba que iniciar sesión no envía ni sincroniza datos; desde 8D la escuela se sincroniza al elegir «Usar en este dispositivo» | **Corregido**: el texto dice exactamente cuándo salen los datos del dispositivo |

## 4. Riesgos residuales (para el piloto real)
- **Sin despliegue**: faltan HTTPS, SMTP, respaldos del servidor, monitoreo y un proxy inverso con la IP real del cliente (hoy el límite de intentos ve la IP del intermediario).
- **RLS por fila**: `acceso.permite()` se evalúa por fila. Las mediciones de la Fase 9 son del dispositivo; el servidor no se midió con volumen.
- **Dispositivo perdido o robado**: los datos locales no están cifrados en reposo; sólo los protege el bloqueo del dispositivo. Mitigación: bloqueo obligatorio en dispositivos institucionales y quitar escuelas al terminar.
- **Aviso de privacidad y revisión jurídica** por escuela (D2), antes de tratar datos reales.
