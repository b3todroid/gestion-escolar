# Pruebas

| Comando | Qué ejecuta |
|---|---|
| `npm test` | Vitest: unitarias e integración con IndexedDB en memoria (fake-indexeddb). |
| `npm run test:e2e` | Playwright sobre la versión compilada (con Service Worker), perfil de teléfono (Pixel 7). Falla si hay errores en la consola. |
| `npm run check` | typecheck + test + build. |

Todas las pruebas usan **datos ficticios** (escuelas, personas y archivos de `tests/fixtures/`).

## Fase 2 — Catálogos e importación: 18 pruebas obligatorias
Unitarias en `tests/unit/fase2-catalogos.test.ts` (U) y funcionales en `tests/e2e/catalogos.spec.ts` (E).

| # | Prueba | Dónde |
|---|---|---|
| 1 | Registrar personal | U «registra personal…», E «altas manuales» |
| 2 | Registrar docente (y materias que puede impartir) | U, E «importa personal desde CSV» |
| 3 | Persona con múltiples funciones | U, E «altas manuales» |
| 4 | Registrar materia (tipos, sin duplicados, desactivar, SE no asignable) | U «tipos…», E «altas manuales» |
| 5 | Registrar alumno (sin CURP; CURP/matrícula únicas) | U, E «altas manuales» |
| 6 | Inscribir en grupo | U, E |
| 7 | Cambiar de grupo sin crear otra persona | U, E «altas manuales» |
| 8 | Detectar duplicados (nombre = posible duplicado, no se fusiona) | U «8 y 14», E (reimportación) |
| 9 | Importar Excel válido (sinónimos, título, varias hojas) | U «9», E «importa alumnos…» |
| 10 | Encabezados desconocidos (mapeo manual) | U «10», E «encabezados desconocidos» |
| 11 | Importar CSV (`;`, comillas, salto de línea, BOM, Windows-1252) | U «11», E «importa personal desde CSV» |
| 12 | Cancelar importación sin guardar | U «12–13», E «importa alumnos…» |
| 13 | Detectar errores | U «12–13», E (filas ERROR) |
| 14 | Actualizar registros existentes | U «8 y 14», E (reimportación) |
| 15 | Conservar al recargar | U «15», E (recarga de página) |
| 16 | Separar escuelas | U «16–17» |
| 17 | Separar ciclos | U «16–17» |
| 18 | Fase 1 íntegra (migración v5 → v6, respaldo antiguo, configuración intacta) | U «18» (dos pruebas) + todas las e2e anteriores |

Además, la prueba E «altas manuales» se ejecuta a **320 px** y verifica que no haya desplazamiento horizontal.
