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

## Fase 4 — Módulo docente: 15 pruebas obligatorias
Unitarias en `tests/unit/fase4-docente.test.ts` (U) y funcionales en `tests/e2e/docente.spec.ts` (E), con reloj simulado (lunes 2 de noviembre de 2026, hora de la Ciudad de México).

| # | Prueba | Dónde |
|---|---|---|
| 1 | Clase actual (escuela, turno, grupo, materia) | U «1–2.», E «ABRIR → …» |
| 2 | Siguiente clase / siguiente actividad | U «1–2.», «3.» (sábado → lunes), E (fuera de jornada) |
| 3 | Receso (y hueco sin actividad, fuera de jornada, límites exactos) | U «3.», «respeta los límites», E «actividad actual…» |
| 4 | Hora SE confirmada como actividad actual | U «4.», E «actividad actual…» |
| 5 | Pase de lista (abrir no guarda; NO INICIADA → EN CAPTURA) | U «5–7.», E |
| 6 | Guardado de asistencia con fecha y hora | U «5–7.», E |
| 7 | Retardos (R no es falta) | U «5–7.», E |
| 8 | Correcciones (un pase, historial, MODIFICADA) | U «8.», E |
| 9 | Salida al baño (docente, periodo, hora automática) | U «9–10.», E |
| 10 | Reincorporación | U «9–10.», E |
| 11 | Prevención de contradicciones (falta ⇄ salida, resolución explícita) | U «11.», E |
| 12 | Persistencia (recargar, reabrir, cambiar de pantalla) | U «12.», E |
| 13 | Funcionamiento móvil (320 px, búsqueda, objetivos ≥ 44 px) | E «móvil 320 px…» |
| 14 | Separación entre escuelas | U «14.» |
| 15 | Integridad de fases anteriores (migración v7 → v8, respaldo con historial) | U «15.», «15b.» + todas las pruebas anteriores |

## Fase 5 — PWA, offline y respaldos: 11 pruebas obligatorias
Unitarias en `tests/unit/fase5-respaldos.test.ts` (U); funcionales en `tests/e2e/offline.spec.ts` (O) y `tests/e2e/respaldos.spec.ts` (R).

| # | Prueba | Dónde |
|---|---|---|
| 1 | Instalación PWA (manifiesto, iconos PNG 192/512 y maskable, Service Worker activo, apple-touch-icon, pantalla «Aplicación y datos»). La instalación en sí no se puede automatizar en un navegador sin interfaz | O «instalación PWA…» |
| 2 | Carga offline (perfil en disco, red cortada, `goto('/')` servido por el Service Worker) | O «sin conexión…» |
| 3 | Guardado offline: consultas de escuelas, grupos, docentes, alumnos y horarios; pase de lista con retardo; salida; regreso; incidencia — verificado en IndexedDB | O «sin conexión…» |
| 4 | Persistencia tras reiniciar (cierre real del navegador y reapertura **sin conexión**) | O, U «4.» |
| 5 | Exportación (versión, fecha, escuela, ciclos, conteos, huella; con y sin cifrado) | U «5.», «Cifrado…», R |
| 6 | Restauración (en dispositivo vacío, reemplazo con copia previa, informe final) | U, R |
| 7 | Archivo corrupto (ilegible, truncado, incompleto, referencias rotas, alterado) | U «7.», R |
| 8 | Versión incompatible (esquema o formato más nuevo) | U «8.» |
| 9 | Conflictos (cambios posteriores al respaldo, misma CCT, contraseña incorrecta) | U «9.», «Cifrado…», R |
| 10 | Conservación de fases anteriores (todas las pruebas anteriores; volcado completo antes/después) | U, todas |
| 11 | Actualización sin pérdida (Service Worker y cachés reemplazados → datos intactos; cachés sin datos escolares) | O, U «11.» |

Además: importación interrumpida a mitad (U «Recuperación…»), sal/IV únicos por archivo (U).

## Fase 6 — PDF, OCR y horarios: 10 pruebas obligatorias
Documentos ficticios generados con `python3 scripts/generar_pdf_prueba.py` → `tests/fixtures/pdf/` (sábana de grupo, sábana de docente con choque y grupo inexistente, lista con celda ambigua y docente desconocido, escaneado sólo imagen, PDF dañado).
Unitarias en `tests/unit/fase6-documentos.test.ts` (U: PDF.js «legacy» y Tesseract en Node) y funcionales en `tests/e2e/pdf.spec.ts` (E: Chromium, OCR real en WebAssembly).

| # | Prueba | Dónde |
|---|---|---|
| 1 | PDF digital | U, E «1, 3 y 5» |
| 2 | PDF escaneado (detección sin texto, OCR local, ruido descartado, campos inciertos, sin peticiones externas) | U «2.», E «2.» |
| 3 | Tablas con encabezados | U «7.» (lista), E «7.» |
| 4 | Horarios por docente | U «4, 6 y 9», E «4, 6, 9 y 8» |
| 5 | Horarios por grupo | U «1, 3 y 5», E «1, 3 y 5» |
| 6 | Conflictos (docente simultáneo, grupo inexistente) | U, E |
| 7 | Campos ambiguos (varias materias, sin separador, grupo ilegible, celdas inciertas) | U «7.», E «7.» y «2.» |
| 8 | Cancelación (de la importación y del OCR a mitad) | E «4…» y «2.» |
| 9 | Duplicados (reimportar no crea clases; aviso de archivo repetido) | U, E |
| 10 | Conservación de datos (migración v8 → v9; importación fallida o descartada no altera nada; todas las pruebas anteriores) | U «10.», E «10.» |

También: PDF dañado / no PDF, tabla sin encabezados, plantillas (guardar, actualizar sin duplicar, aplicar por nombre de encabezado, incluidas en respaldos).

## Fase 7 — Prefectura: 12 pruebas obligatorias
Unitarias en `tests/unit/fase7-prefectura.test.ts` (U) y funcionales en `tests/e2e/prefectura.spec.ts` (E), con reloj fijo (lunes 2-nov-2026 07:15, Ciudad de México).

| # | Prueba | Dónde |
|---|---|---|
| 1 | Registro de incidencia (reportada; sin duplicados; «otra» configurable) | U «1–3», E (ambas) |
| 2 | Detección de grupo potencialmente descubierto | U «1–3», «retardo…», E |
| 3 | Confirmación de grupo sin docente (por incidencia confirmada o en sitio) | U, E «3 y 12» |
| 4 | Consulta de SE y candidatos (sugerir no asigna) | U «4.», E |
| 5 | Registro de cobertura (propuesta → asignada → realizada) | U «5–7», E |
| 6 | Prevención de asignaciones incompatibles | U «5–7», E |
| 7 | Registro de autorización (obligatoria, con fecha y hora) | U «4.», «5–7», E |
| 8 | Consulta de historial | U «8.», E |
| 9 | Generación de reportes (día, semana, mes, intervalo; filtros; indicadores validados; imprimible) | U «9.», E |
| 10 | Separación entre escuelas (y turnos) | U «10.», «turnos separados» |
| 11 | Persistencia | U «11.», E (recarga) |
| 12 | Integridad de datos anteriores (migración v9 → v10; respaldo con Prefectura; no se elimina personal con historial; conteos intactos) | U «12.», E «3 y 12» + todas las anteriores |


## Fase 8B — servidor
- `npm run test:servidor` (35, PostgreSQL real por archivo, requiere `PRUEBAS_POSTGRES_URL`): migraciones y huellas, espejo = respaldo, auditoría inmutable, configuración, alta del operador, código al correo (invitados, no invitados, hash, intentos, caducidad, límite), rutas cerradas, segundo factor (obligatorio, pendiente, respaldo, no desactivable), invitaciones con consentimiento, aislamiento entre escuelas, CSRF y tamaño, cierre y revocación de sesiones, restablecimiento, SSO con proveedor OIDC simulado, sin secretos en `src/`.
- `npm run test:e2e:servidor` (2, navegador + servidor real + base temporal): flujo completo administrador/docente y segundo factor pendiente.
- `tests/e2e/cuenta-local.spec.ts`: modo local sin servidor y compilación sin secretos.
