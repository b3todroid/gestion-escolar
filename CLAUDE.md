# CLAUDE.md — Gestión Escolar

PWA **local-first** para gestión escolar. Estado: Fases 1 a 4 completadas, más respaldos. Fase 1 ampliada completada. Fase 2 (catálogos) completada. Fases 3 (horarios, v7) y 4 (módulo docente, v8) completadas. Fase 5 (PWA, offline, respaldos) completada. Fase 6 (PDF/OCR, v9) completada. **Fase 7 — Prefectura** (esquema v10) — completada. **Fase 8A — diseño** (`docs/FASE8A_MULTIUSUARIO.md`) entregado. **Fase 8B — backend y autenticación** (`docs/SERVIDOR.md`, sólo local) — completada, pendiente de revisión; **no iniciar 8C ni desplegar sin autorización**. **No avanzar de fase sin autorización explícita.**
Leer antes de trabajar: `docs/ESTADO_PROYECTO.md`, `docs/ARQUITECTURA.md`, `docs/REGLAS_NEGOCIO.md`, `docs/MODELO_DATOS.md` (y `docs/IMPORTACIONES.md`, `docs/PRUEBAS.md` según la tarea).

## Comandos
- `npm run dev` — servidor de desarrollo (http://localhost:5173)
- `npm run typecheck` — TypeScript estricto
- `npm test` — Vitest (unitarias + integración con IndexedDB en memoria)
- `npm run test:e2e` — Playwright (compila y prueba la versión de producción con Service Worker)
- `npm run build` / `npm run preview`
- `npm run check` — typecheck + test + build. Ejecutarlo antes de declarar terminada una tarea.

## Stack
Vite 8 · TypeScript 7 (estricto) · Dexie 4 (IndexedDB) · Zod 4 · vite-plugin-pwa 2 · Vitest 5 · Playwright.
**Sin frameworks de UI** (React/Vue/Angular…): DOM nativo con `src/components/dom.ts`. Justificar por escrito antes de introducir uno.

## Inicio
- `#/` → «Mi día» si el dispositivo tiene docente; si no, **bienvenida** (`pages/inicio.ts`): «Gestión escolar», subtítulo y «Configurar mi escuela» (sin escuelas) o «Continuar» por escuela. Nunca mostrar datos ficticios como reales.
- Tras guardar el asistente se abre el **panel principal** `#/escuela/ID` (resumen, «Editar datos escolares», «Administrar periodos», «Administrar grupos»; módulos futuros como texto «Próximamente», sin botones).

## Flujo principal
`#/asistente` (pages/asistente.ts): 6 pasos que crean escuela, ciclo, turno, periodos/recesos generados, grados y grupos en **una** transacción (`services/asistente.ts`, que reutiliza los demás servicios). El borrador vive en localStorage sólo como comodidad. Paso 1 usa `components/plantel.ts` (también en «Editar datos escolares») con `esquemaDatosPlantel` (CCT, entidad y municipio obligatorios; CCT debe iniciar con la clave de la entidad; sólo formato, no existencia). Jornada y grados admiten **modo personalizado** (`horario.bloques`, `grados.personalizados`). Al modificar listas del borrador después de `leerPaso`, usar SIEMPRE la referencia vigente (`d.horario.bloques`, `d.grados.personalizados`): `leerPaso` las reemplaza. Las pantallas `#/escuela/ID`, `#/ciclo/ID`, `#/turno/ID` permiten ajustar después.

## Fase 2 (rutas)
`#/escuela/ID/personal` (personal por escuela) · `#/personal/ID` (semana del docente) · `#/ciclo/ID/materias` · `#/grupo/ID` (materias asignadas + horario por día).
Regla central: un docente no puede tener dos clases que se traslapen en **hora real** (aunque sean de turnos con periodos distintos): `services/conflictos.ts`.

## Fase 2 — Catálogos (esquema v6)
Rutas: `#/ciclo/ID/docentes` · `#/ciclo/ID/alumnos` · `#/ciclo/ID/importar-datos`; menú `pages/catalogos.ts` (`navCatalogos`).
- **Alumno = identidad** (`alumnos`, por escuela) **+ inscripción por ciclo** (`inscripciones`: turno, grado, grupo, estado, número de lista). Cambiar de grupo actualiza la inscripción y agrega un `movimiento`; nunca crea otra persona. Usar `ServicioAlumnos.listarGrupo/listarCiclo` (devuelven `AlumnoInscrito`), no leer `alumnos` por grupo.
- El nombre **nunca** identifica a una persona: sólo matrícula/CURP (alumnos) o identificador interno (personal). Coincidencias por nombre = «posible duplicado», jamás se fusionan solas.
- Docentes = personal con función `docente` (no otra tabla). Turnos y materias que **puede** impartir: `adscripciones` por ciclo (no crean asignaciones). Funciones anteriores (`directivo`, `administrativo`, `apoyo`) se conservan sin convertir.
- Materias tipo `servicio` (SE) no se asignan a grupos; materias desactivadas no reciben asignaciones nuevas.
- Importación de catálogos (`services/importacionDatos.ts`): `analizar` no escribe; `aplicar` re-analiza dentro de `uow` y sólo ejecuta decisiones confirmadas; la huella SHA-256 se calcula en la página, fuera de la transacción. Detalle en `docs/IMPORTACIONES.md`.

## Fase 3 (horarios)
- Tipos de bloque explícitos: CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD, SIN ACTIVIDAD REGISTRADA (`domain/horarioVista.ts`, `components/horarioSemanal.ts`). **Un hueco nunca es servicio.**
- Choques de docente (`services/conflictos.ts`): por hora real, filtrados por ciclo, contra clases y actividades; simultaneidad sólo con caso especial (`excepciones`).
- Horarios confirmados (`confirmaciones`): todo cambio pasa por `asegurarHorarioEditable`; reabrir exige motivo (queda en `bitacora`).
- Importación (`services/importacion.ts`): analizar → aplicar (todo o nada; no crea entidades, no reemplaza celdas, no toca confirmados). Lector .xlsx/.csv propio sin dependencias (`domain/importacion/`). Plantilla y archivos de prueba: `scripts/generar_plantillas.py` (openpyxl).
- Rutas nuevas: `#/ciclo/ID/importar`.
- Módulo Horarios (esquema v7): `#/horarios`, `#/ciclo/ID/horarios`, `#/personal/ID/ciclo/ID`. Horarios de grupo y docente se **derivan** de asignaciones/sesiones/actividades: no guardar copias; `sesiones.personalId` se actualiza en la misma transacción que la asignación.
- `services/revisionHorarios.ts` (conflictos pendientes y reportes) es **sólo lectura**: nunca corrige horarios por su cuenta. Estado de validación (confirmado / sin confirmar / con conflicto) se deriva, no se guarda.
- `origen` en sesiones y actividades: `manual` | `importacion` | `null` (anterior a v7). `programar(..., origen)` y `crearDocente(..., origen)`.
- Actividades con `periodoId` toman la hora del periodo; al cambiar un periodo se actualizan en la misma transacción.
- PDF (Fase 6): `lectores/pdf.ts` (PDF.js, carga diferida, `isEvalSupported:false`) y `lectores/ocr.ts` (Tesseract local en `ocr/`, NUNCA el CDN por omisión: siempre `workerPath/corePath/langPath`). Lógica pura y probada en `domain/importacion/documento.ts`. Lo ambiguo o incierto no se convierte en registro; celdas vacías nunca son SE. Las filas canónicas pasan por `importacion.analizarMapeado` (misma validación que Excel).
- Plantillas de reconocimiento: `plantillasImportacion` (v9), columnas por encabezado normalizado (no por posición).

## Fase 4 (módulo docente)
- `#/` muestra **Mi día** si el dispositivo tiene docente elegido (`#/perfil`, tabla `ajustes`); si no, las escuelas (`#/escuelas`). **No es autenticación**: decirlo así en la interfaz.
- Pase de lista `#/lista/SESION/AAAA-MM-DD`: todos P por omisión; sólo se tocan F y R. **Abrir no escribe nada**; sólo «Guardar lista» crea `pases` + `asistencias` (un pase por clase y fecha).
- Salidas al baño y reincorporación se guardan al momento (`salidas`). Reglas en `services/asistencia.ts`: F ⇄ salida en la misma clase son incompatibles; una salida abierta por alumno; regreso ≥ salida.
- Alumnos: `#/alumnos/GRUPO`, `#/alumno/ID`. Datos mínimos (nombre y apellidos). Reportes breves ≤ 280.
- Los servicios reciben la fecha/hora actual como parámetro (pruebas con `page.clock`).
- Actividad actual: `domain/actividadActual.ts` (puro; [inicio, fin); FUERA DE JORNADA fuera de los bloques). El panel la deriva de `vistas.semanaDocente`: no guardar copias.
- Esquema v8: `cambiosAsistencia` (historial de correcciones), `pases.correcciones`, `salidas.personalId/periodoId`, `reportes.hora/estado`. Estado de la lista derivado con `estadoLista()`.
- Falta ⇄ salida: el servicio siempre lo rechaza; la interfaz pide resolución explícita (registrar regreso o anular la salida). Nunca resolver en silencio.
- CSS: `[hidden] { display: none !important; }` — no quitarlo (los componentes con `display` anulaban `hidden`).

## Fase 7 (Prefectura, `services/prefectura.ts`, `pages/prefectura.ts`)
- Rutas: `#/prefectura`, `#/ciclo/ID/prefectura/AAAA-MM-DD`, `#/cobertura/SESION/AAAA-MM-DD`, `#/ciclo/ID/prefectura-actividades`, `#/ciclo/ID/prefectura-reportes`.
- Incidencias del personal: REPORTADA → CONFIRMADA / DESCARTADA. **Nunca** crear faltas automáticas. El estado de cada clase (`clasesDelDia`) se **deriva**; no se guarda. No presentar inferencias como hechos: «posible» ≠ «confirmado».
- Coberturas: la app sugiere (`candidatos`), nunca asigna sola; `asignar` exige `autorizadoPor` y pasa por `problemas()` (incompatibilidades por hora real). SE no implica autorización.
- Indicadores de reportes sólo con registros validados. Todo cambio va a `bitacoraPrefectura` (campo `orden` para el historial).

## Fase 8B (servidor, `servidor/`, `docs/SERVIDOR.md`)
- Node 22 con tipos nativos (imports con `.ts`), PostgreSQL, Better Auth 1.7.11. `npm run servidor`, `npm run servidor:cli -- …`, `npm run test:servidor` y `npm run test:e2e:servidor` (requieren `PRUEBAS_POSTGRES_URL`).
- Migraciones: **nunca** editar un `.sql` ya aplicado; agregar `NNNN_nuevo.sql` (el ejecutor verifica huellas).
- Sin contraseñas ni registro abierto: sólo invitados (`acceso.membresias`). Permisos verificados en el servidor en cada petición; no ocultar botones como permiso.
- Rutas de Better Auth: lista de permitidas en `auth.ts`; nunca exponer el token (`sinTokens` en `http.ts`). POST exige `Origin` de la app.
- Auditoría `acceso.auditoria` de sólo agregar, sin correos, nombres ni códigos.
- El cliente (`src/remoto`, `services/cuenta.ts`) **no** toca los datos locales ni importa código de `servidor/`; la API va por el mismo origen `/api` (intermediario de Vite; el SW la excluye).

## Respaldos (`#/respaldos`, `services/respaldos.ts`)
- Archivo JSON por escuela (o todas) con versión de esquema y huella SHA-256. Excluye `ajustes` (preferencias del dispositivo).
- Restaurar: verificar archivo (Zod por tabla + referencias internas + huella) **fuera** de la transacción → comparar y escribir **dentro**. Nunca hacer operaciones asíncronas ajenas a IndexedDB (p. ej. `crypto.subtle`, `fetch`) dentro de `uow.ejecutar`: Dexie cierra la transacción antes de tiempo.
- Reemplazar descarga antes una copia de los datos actuales. Escuela distinta con la misma CCT: bloqueado (no se mezclan).
- `VERSION_ESQUEMA` (db.ts) debe igualar la última `this.version(n)`; hay prueba que lo verifica.
- Formato de respaldo 2 (`ciclos`, `conteos`); se aceptan 1 y 2. Cifrado opcional (por omisión en la interfaz) con `utils/cifrado.ts` (AES-GCM + PBKDF2 600 000): descifrar **fuera** de `uow`. Nunca guardar contraseñas.
- Service Worker: sólo precarga de recursos estáticos; **no** agregar `runtimeCaching` que pueda guardar datos escolares. Pantalla `#/aplicacion` (instalación, almacenamiento persistente, versión).
- Errores inesperados: `registrarError()` (utils/registro.ts), nunca `console.error(objeto)` con datos.
- Riesgos y procedimientos de recuperación: `docs/RECUPERACION.md`. Probar offline con `npm run preview` (el servidor de desarrollo no registra el Service Worker).

## Capas (dependencias sólo hacia abajo)
`pages/` + `components/` (presentación) → `services/` → `domain/` (reglas puras) + `validators/` (Zod) → `repositories/` (interfaces + Dexie) → `database/` (esquema Dexie).
- Las páginas **nunca** usan Dexie directamente; sólo `ctx.s.<servicio>`.
- Los servicios dependen de las interfaces de `repositories/tipos.ts`, no de Dexie.
- Toda operación de escritura va dentro de `ctx.uow.ejecutar(...)` (transacción atómica).

## Reglas obligatorias
- Grupos desactivados (`activo: false`): no reciben materias, clases, alumnos ni actividades (`asegurarGrupoActivo`).
- IDs: `nuevoId()` (UUID). Nunca usar nombres como identificador.
- Todo registro de configuración lleva `escuelaId` y `cicloEscolarId` cuando aplica. No mezclar escuelas ni ciclos.
- Los métodos públicos de servicio que devuelven promesa son `async` (los errores de validación llegan como rechazo, nunca como excepción síncrona).
- Validar toda entrada con Zod (`validators/esquemas.ts` + `validar()`), errores como `ErrorDominio` con `campos`.
- **Nunca** `innerHTML`/`outerHTML`/`insertAdjacentHTML` con datos: usar `h()` (textContent).
- Estilos dinámicos sólo vía CSSOM (`el.style.setProperty`): la CSP bloquea atributos `style="…"`.
- Identidad visual: verde pizarrón, tiza, amarillo lápiz; fuente Atkinson Hyperlegible Next (local, sin CDN). Tokens en `src/styles/main.css`.
- **Nunca** `alert()`, `confirm()`, `prompt()`: usar `avisar()` y `confirmar()`.
- Estados con texto + símbolo, no sólo color. Etiquetas visibles en todos los campos. Objetivos táctiles ≥ 44–48 px.
- Esquema de BD: **nunca** modificar una versión publicada; agregar `version(n+1)` con `upgrade()` que conserve datos. Documentar en `docs/MODELO_DATOS.md`.
- No enviar datos escolares a servicios externos. No secretos en el cliente. Sólo datos ficticios en pruebas.
- No afirmar que las pruebas pasan sin ejecutarlas.
- ExcelJS se evaluó y se descartó en la Fase 3. PDF.js 6.4.299 y Tesseract.js 7.0.0 evaluados e instalados en la Fase 6 (ver `docs/ARQUITECTURA.md`). No instalar jsPDF/pdf-lib hasta la fase que los use; antes, evaluar y documentar igual.

## Fuera de alcance hasta nuevas fases
Generación de PDF propio, sincronización multiusuario (8D), despliegue en la nube, RLS (8C).
No simular permisos ocultando botones: IndexedDB no ofrece autenticación ni multiusuario.
