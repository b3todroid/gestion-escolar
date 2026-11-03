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

## Fase 3 — Horarios: 13 pruebas obligatorias
Unitarias en `tests/unit/fase3-horarios.test.ts` (U) y funcionales en `tests/e2e/horarios.spec.ts` (E).

| # | Prueba | Dónde |
|---|---|---|
| 1 | Crear asignación (docente + materia + grupo + día + periodo, origen manual) | U «1.», E «demuestra la detección…» |
| 2 | Editar asignación (cambio de docente reflejado en grupo y docente) | U «2.» |
| 3 | Docente duplicado (rechazo antes de guardar; revisión de datos anteriores; entre turnos) | U «3.», «3b.», E (diálogo de captura y archivo con choques) |
| 4 | Grupo duplicado (y periodo/materia/docente inexistentes, fuera de jornada) | U «4.», «8b.» |
| 5 | Registrar SE (confirmada, por periodo, sin grupo; un hueco no es SE; sigue al periodo) | U «5.», E «importa un horario…» |
| 6 | Consultar horario por grupo | U «6–7.», E (tabla semanal con estado y origen) |
| 7 | Consultar horario por docente | U «6–7.», E (resumen del docente) |
| 8 | Importar Excel (encabezados equivalentes, periodo por número, sin sobrescribir) | U «8.», «8b.», E |
| 9 | Cancelar importación / archivo con conflictos no guarda nada | U «9.», E «demuestra la detección…» |
| 10 | Mantener datos al recargar | U «10.», E (recarga) |
| 11 | Escuelas separadas | U «11.» |
| 12 | Ciclos separados | U «12.» |
| 13 | No alterar datos de fases anteriores (migración v6 → v7, respaldo de esquema 6) | U «13.», «13b.» + todas las pruebas anteriores |

También: vista imprimible (E, `emulateMedia('print')`), vista por día en 320 px sin desplazamiento horizontal (E) y `aTablaSegura` / `resolverPeriodo` (U).
