# Arquitectura

## Principios
Local-first, ligera (sin framework de UI), segura por defecto, capas con dependencias en un solo sentido, preparada para sincronización futura.

## Capas
```
PRESENTACIÓN   src/pages, src/components, src/styles, src/app.ts (router por hash)
      │  sólo llama a servicios
SERVICIOS      src/services        orquestan validación + reglas + repositorios en transacción
      │
REGLAS         src/domain          funciones puras: tiempo, traslapes, duplicados, estados
VALIDACIÓN     src/validators      esquemas Zod → ErrorDominio con errores por campo
      │
REPOSITORIOS   src/repositories    interfaces (tipos.ts) + implementación Dexie (dexie.ts)
      │
ALMACENAMIENTO src/database        esquema Dexie versionado (IndexedDB)
```
`src/services/index.ts` es el único punto de composición (BD → repositorios → servicios).

## Decisiones
| Decisión | Motivo |
|---|---|
| DOM nativo + `h()` en vez de React/Vue | Pocas pantallas, formularios simples; menos peso y dependencias. `h()` inserta texto con nodos de texto: evita XSS por diseño. |
| Router por hash (`#/escuela/ID`) | Funciona sin configuración del servidor y sin conexión. |
| Repositorios con interfaz propia | Permite sustituir/combinar Dexie con un backend sin tocar servicios ni UI. |
| `UnidadDeTrabajo` (transacción Dexie `rw` sobre todas las tablas) | Operaciones compuestas atómicas (p. ej. turno + jornada). |
| Unicidad verificada en servicios (normalizada) | Los índices únicos no ignoran acentos/mayúsculas; el volumen por ciclo es pequeño. |
| Metadatos `creadoEn`, `actualizadoEn`, `version` | Base para detectar cambios y conflictos al sincronizar. |
| CSP estricta sólo en build | El servidor de desarrollo requiere estilos en línea y WebSocket. |
| Asistente que reutiliza servicios en transacciones anidadas de Dexie | Las mismas reglas aplican al alta guiada y a la edición; si un paso falla no queda nada a medias. |
| Generadores puros (`domain/generadores.ts`) | Un dato se captura una vez: 3 parámetros producen todos los módulos y recesos; grados × letras producen los grupos. |
| Borrador del asistente en localStorage | Comodidad por dispositivo; IndexedDB sigue siendo la única fuente de verdad. |
| Choques de docentes por hora real (`services/conflictos.ts`) | Turnos distintos pueden tener periodos con horas diferentes; comparar por número de periodo no detectaría choques. |
| Disponibilidad calculada antes de elegir (`opcionesParaCelda`) | La persona ve qué no se puede y por qué antes de intentarlo, en vez de recibir un error después. |
| Un solo aviso visible a la vez | Al trabajar rápido, los avisos apilados cubrían la pantalla del teléfono. |
| Respaldo: verificación fuera de la transacción | Operaciones asíncronas ajenas a IndexedDB (`crypto.subtle`) cierran la transacción de Dexie antes de tiempo; se detectó porque provocaba pérdida de datos en un reemplazo fallido. |
| Respaldo con huella SHA-256 | Detecta archivos dañados o editados a mano antes de restaurar. |
| `esquemaDatosPlantel` separado de `esquemaEscuela` | Las reglas completas del plantel aplican en el asistente y la edición sin romper registros y respaldos anteriores, que no tenían esos campos. |
| Migración v5 sin cambios de índices | Completa campos nuevos con valores explícitos (`null`, `activo: true`) en lugar de dejar `undefined`. |
| Logotipo reducido con `canvas` en el dispositivo | Evita guardar imágenes grandes o con metadatos; se excluye SVG por poder contener código. |
| `registerType: 'prompt'` en la PWA | El usuario decide cuándo actualizar; no se recarga a mitad de una captura. |

## Dependencias (verificadas el 2026-11-02)
| Paquete | Versión | Licencia | Uso | Notas |
|---|---|---|---|---|
| dexie | 4.4.7 | Apache-2.0 | IndexedDB | Producción. Mantenimiento activo. |
| zod | 4.6.7 | MIT | Validación | Producción. Mayor parte del bundle (~70 KB gzip total). |
| @fontsource/atkinson-hyperlegible-next | 5.3.0 | OFL-1.1 | Tipografía legible, servida localmente (offline, sin CDN) | Producción. 2 pesos latin, 12 KB cada uno. |
| vite | 8.3.5 | MIT | Dev/build | |
| typescript | 7.0.2 | Apache-2.0 | Tipos | |
| vite-plugin-pwa | 2.0.0 | MIT | Service Worker (Workbox) | Compatible con Vite 8. |
| vitest | 5.1.0 | MIT | Pruebas | |
| fake-indexeddb | 6.2.7 | Apache-2.0 | IndexedDB en memoria para pruebas | Sólo dev. |
| @playwright/test | 1.63.0 | Apache-2.0 | E2E | Fijado a la versión del navegador del entorno. |

`npm audit --omit=dev`: **0 vulnerabilidades**. `npm audit` completo reporta 10 avisos low/moderate en la cadena de compilación `vite-plugin-pwa → workbox-build` (glob, minimatch, ejs, deepmerge). Se ejecutan sólo al compilar, no llegan al navegador. No se aplicó `audit fix --force` (forzaría versiones incompatibles). Revisar en cada actualización.

## ExcelJS: evaluada y descartada (Fase 3, 2026-11-03)
| Criterio | ExcelJS 4.4.0 |
|---|---|
| Mantenimiento | Última versión estable oct. 2023; sólo un prerelease en dic. 2024. |
| Vulnerabilidades | 9 moderadas en dependencias de producción (uuid, archiver, minimatch…). |
| Tamaño | 928 KB minificado (≈ 4 veces la app). |
| Necesidad | Sólo leer la primera hoja de una tabla simple. |

**Decisión:** lector propio y acotado en `src/domain/importacion/` (ZIP con `DecompressionStream` nativo + extracción de celdas sin evaluar XML externo). Límites contra bombas de descompresión. Se prueba con archivos reales generados por openpyxl (independiente). Si en el futuro se necesita **generar** Excel con formato, reevaluar ExcelJS u otra opción.

| Paquete añadido | Versión | Licencia | Uso |
|---|---|---|---|
| @types/node | 22.x | MIT | Sólo pruebas (leer archivos de prueba). |

## Bibliotecas de fases futuras (NO instaladas)
PDF.js (lectura PDF), Tesseract.js (OCR local), jsPDF o pdf-lib (reportes). Se cargarán con `import()` dinámico para no penalizar la carga inicial. Antes de instalar: repositorio oficial, compatibilidad, mantenimiento, licencia, vulnerabilidades, tamaño; documentar aquí.

## Seguridad
- Zod en todas las entradas; caracteres de control rechazados; longitudes máximas.
- Salida siempre como texto (`textContent`); prohibido `innerHTML` con datos.
- CSP: `default-src 'self'`, sin scripts/estilos en línea ni orígenes externos.
- Modo sólo dispositivo: ningún dato sale del dispositivo. Con servidor escolar (8B–8E), sólo las escuelas vinculadas expresamente se envían al servidor propio de la escuela (mismo origen `/api`). Sin credenciales en el código.
- Eliminaciones con diálogo de confirmación; las que dejarían huérfanos se bloquean.
- **Limitación honesta**: IndexedDB no ofrece autenticación ni control de acceso. Cualquiera con acceso al navegador ve los datos locales. Los permisos reales están en el servidor (8C), que **no está desplegado**. Detalle y riesgos: `docs/SEGURIDAD.md`.

## Sincronización
Implementada en la Fase 8D (`docs/SINCRONIZACION.md`): cola local en la misma transacción, versión base obligatoria y conflictos explícitos. Probada sólo con un servidor local; sin despliegue no hay sincronización real entre dispositivos de una escuela.

## Fase 5 — PWA, respaldos cifrados y recuperación
- **Cifrado de respaldos**: Web Crypto nativa (`crypto.subtle`), sin bibliotecas: AES-GCM 256 (cifrado autenticado) + PBKDF2-SHA-256 con 600 000 iteraciones (recomendación OWASP 2023), sal de 16 bytes e IV de 12 bytes aleatorios por archivo. Al leer se acotan las iteraciones (100 000–5 000 000) para que un archivo manipulado no fuerce parámetros débiles ni trabajo excesivo. Se evaluó y descartó agregar dependencias (libsodium, crypto-js): Web Crypto está en todos los navegadores objetivo y no aumenta el tamaño. `src/utils/cifrado.ts`.
- **Service Worker** (vite-plugin-pwa / Workbox): precarga sólo recursos estáticos de la compilación (JS, CSS, HTML, iconos, fuentes, plantillas). **No hay caché en tiempo de ejecución**: ningún dato escolar llega a Cache Storage. Actualización con aviso («Hay una nueva versión») y revisión cada hora con conexión; `cleanupOutdatedCaches`. Los datos (IndexedDB) no se tocan al actualizar.
- **Instalación**: `beforeinstallprompt` sólo donde el navegador lo ofrece; instrucciones por plataforma en `#/aplicacion` (iOS no tiene botón programable).
- **Almacenamiento persistente**: `navigator.storage.persist()` a petición de la persona; uso y cuota con `estimate()`.
- **Registro de errores**: `utils/registro.ts` escribe sólo tipo y mensaje (sin objetos con datos personales).
- Detalle operativo y riesgos: `docs/RECUPERACION.md`.

## Fase 6 — PDF.js y Tesseract.js (evaluación previa a instalarlos)
| | pdfjs-dist | tesseract.js (+ tesseract.js-core, @tesseract.js-data/spa) |
|---|---|---|
| Versión elegida | 6.4.299 (2026-10-03; se evitó la 6.5.438 publicada hace 2 días) | 7.0.0 (2025-12) · core 7.0.0 · spa 1.0.0 (`4.0.0_best_int`) |
| Repositorio / responsable | github.com/mozilla/pdf.js (Mozilla) | github.com/naptha/tesseract.js |
| Licencia | Apache-2.0 | Apache-2.0 (datos de idioma: paquete MIT, tessdata Apache-2.0) |
| Mantenimiento | Publicaciones mensuales | Activo (última mayor dic-2025) |
| Vulnerabilidades (`npm audit --omit=dev`) | 0. Se usa `isEvalSupported: false` y sin scripting (mitiga la clase de fallas tipo CVE-2024-4367, corregida desde 4.2.67) | 0 |
| Tamaño servido | ~430 KB (módulo, carga diferida) + 1,26 MB (worker) — precargados | worker 111 KB + motor WASM ~3,9 MB (uno de tres según el navegador) + español 2,1 MB — **no** precargados: se guardan en caché `recursos-ocr` la primera vez |
| Datos externos | Ninguno (no se configuran fuentes ni CMaps remotos) | Ninguno: `workerPath`, `corePath` y `langPath` apuntan a `ocr/` (por omisión usaría un CDN) |

Decisiones:
- Ambas se cargan con `import()` dinámico: no afectan la carga inicial.
- El worker de Tesseract se crea desde un archivo del mismo origen (`workerBlobURL: false`); el idioma no se guarda en IndexedDB (`cacheMethod: 'none'`), lo guarda el Service Worker.
- OCR con `PSM.SPARSE_TEXT` (adecuado para tablas) y `user_defined_dpi=300`; se descartan lecturas con confianza < 20 % o letras sueltas < 60 % (trazos de las líneas de la tabla).
- La lógica de tablas es pura (`domain/importacion/documento.ts`) y se prueba con PDF reales ficticios en Node (PDF.js «legacy» y Tesseract en Node).
- Las vulnerabilidades de `npm audit` completo (sin `--omit=dev`) están en herramientas de compilación (cadena de vite-plugin-pwa → ejs/jake/minimatch) y no llegan a la aplicación; la corrección sugerida rebaja vite-plugin-pwa a una versión mayor anterior y no se aplicó.


## Fase 8B — servidor
`servidor/` (Node, sin marcos HTTP) → Better Auth + API propia → PostgreSQL. El cliente lo usa sólo desde `src/remoto/servidorEscolar.ts` (capa equivalente a `repositories/`) a través de `services/cuenta.ts`, en el mismo origen `/api`. Dependencias nuevas: `better-auth@1.7.11`, `pg@8.23.1` (producción del servidor; no entran al paquete de la app) y `oauth2-mock-server@9.3.0` (sólo pruebas). Justificación y alternativas en `docs/SERVIDOR.md`.

## Fase 8C — permisos
El servidor se compila con Vite (`servidor/vite.config.ts`) para **reutilizar** `src/services`, `src/domain`, `src/validators` y `src/models`. `servidor/src/repositoriosPg.ts` implementa `Repositorios`/`UnidadDeTrabajo` sobre PostgreSQL: cada servicio usa la transacción de la petición y cada unidad de trabajo es un punto de guardado. Las peticiones de datos escolares corren con el rol `gestion_app` bajo RLS (`docs/PERMISOS.md`). La capa de presentación no cambia: la app sigue local.

## Fase 9 — volumen y estabilización
- **Respaldos grandes** (`utils/compresion.ts`): de más de 8 MB se comprimen con gzip (`CompressionStream`, sin dependencias) en un sobre JSON con base64. Se detectan por prefijo y se descomprimen por flujo con límite (400 MB). Orden al abrir: descifrar → descomprimir → validar, todo **fuera** de `uow`. La migración envía el paquete sin comprimir (el servidor valida JSON).
- **Sin `push(...arreglo)` ni `Math.min(...arreglo)` con listas que crecen con los datos**: más de ~120 000 elementos desbordan la pila de V8.
- **Esquema local v12**: índices `matricula` y `curp` en `alumnos`. `Repositorio.obtenerVarios(ids)` (Dexie `bulkGet`; PostgreSQL `id = ANY($1::uuid[])`) para leer muchos por id en una consulta.
- `insertarVarios` consulta el vínculo de sincronización una vez por escuela, no por registro.
- «Mi día» pinta primero y calcula el recordatorio de respaldo después (recorre todos los registros de la escuela).

## Fase 11 — despliegue
- **nodemailer 10.1.7** (sólo en el servidor, licencia MIT-0, sin dependencias): envío SMTP de códigos e invitaciones. Se eligió la biblioteca estándar de Node para SMTP en lugar de escribir un cliente propio (TLS, STARTTLS y autenticación son delicados). Se fijó una versión publicada hace más de dos semanas, no la más reciente. Tipos: `@types/nodemailer` 8.0.2 (sólo desarrollo).
- Contenedores (`deploy/`): Node 22.23-slim, Caddy 2 y PostgreSQL 16-alpine (imágenes oficiales; espejo configurable). Arquitectura completa: `docs/ARQUITECTURA_PRODUCCION.md`.
- Servidor: modos `preproduccion` y `produccion` (estrictos); `HOST`, `PROXIES_CONFIABLES` (`servidor/src/ipCliente.ts`), secretos `*_FILE`, `/api/salud/lista`.
