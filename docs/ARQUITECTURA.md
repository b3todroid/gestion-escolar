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
- Sin red: ningún dato sale del dispositivo. Sin credenciales en el código.
- Eliminaciones con diálogo de confirmación; las que dejarían huérfanos se bloquean.
- **Limitación honesta**: IndexedDB no ofrece autenticación ni control de acceso. Cualquiera con acceso al navegador ve los datos. Los permisos reales llegarán con el backend.

## Sincronización futura (diseño previsto, no implementado)
Backend con autenticación institucional, permisos por rol y escuela, repositorio "sincronizado" que escribe local y encola cambios (outbox), resolución de conflictos por `version`/`actualizadoEn`, eliminaciones como marcas (tombstones) en lugar de borrado físico, auditoría y respaldos centralizados.
