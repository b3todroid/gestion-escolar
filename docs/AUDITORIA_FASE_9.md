# Auditoría integral — Fase 9

**Fecha:** 2026-11-03 · **Alcance:** Fases 1 a 8E. Todo se verificó **ejecutando** pruebas con datos **ficticios**. Ningún dato real, ningún despliegue y ningún servicio contratado.

La documentación anterior daba todas las fases por completadas. Esta auditoría no lo dio por hecho: cada función se probó y se buscaron defectos con flujos completos, carga de volumen y casos de seguridad. Así aparecieron dos defectos **críticos** y uno **alto** que las pruebas anteriores no cubrían (ver §4).

## 1. Matriz de funcionalidad (Fases 1–8)
Estados: **IMPLEMENTADA** (existe y su prueba pasa), **PARCIAL** (existe con límites declarados), **AUSENTE**.

| # | Función | Estado | Prueba (archivo) | Resultado | Problemas / límites | Prioridad |
|---|---|---|---|---|---|---|
| 1 | Configuración escolar (asistente de 6 pasos, plantel, CCT) | IMPLEMENTADA | `asistente.test`, `fase1-plantel.test`, `asistente.spec`, `fase1-completa.spec`, `flujo-integral.spec` | Pasa | El panel listaba como «Próximamente» módulos que ya existen: **corregido** | — |
| 2 | Turnos y jornadas (periodos, recesos, modo personalizado) | IMPLEMENTADA | `configuracion.test`, `reglas.test`, `tiempo.test`, `configuracion.spec` | Pasa | — | — |
| 3 | Grados y grupos (activar/desactivar, `asegurarGrupoActivo`) | IMPLEMENTADA | `fase2.test`, `fase1-completa.spec` | Pasa | — | — |
| 4 | Personal (identidad por identificador interno, funciones) | IMPLEMENTADA | `fase2-catalogos.test`, `catalogos.spec` | Pasa | — | — |
| 5 | Docentes (adscripciones por ciclo) | IMPLEMENTADA | `fase2-catalogos.test`, `catalogos.spec` | Pasa | — | — |
| 6 | Materias (SE no asignable, desactivadas) | IMPLEMENTADA | `fase2.test`, `fase2-catalogos.test` | Pasa | — | — |
| 7 | Alumnos (identidad + inscripción, movimientos, duplicados por nombre como «posible») | IMPLEMENTADA | `fase2-catalogos.test`, `fase4-docente.test`, `fase9-respaldos-grandes.test` | Pasa | Alta de 1 500 alumnos: 95,6 s por costo cuadrático; **corregido** con índices v12 (§5) | — |
| 8 | Importaciones Excel/CSV (analizar sin escribir, aplicar todo o nada, huella) | IMPLEMENTADA | `importacion-lector.test`, `fase2-catalogos.test`, `fase3.test`, `catalogos.spec`, `rendimiento.spec` | Pasa | Límite de 3 000 filas y 5 MB por archivo (deliberado) | — |
| 9 | Horarios (choques por hora real, confirmaciones, revisión, importación) | IMPLEMENTADA | `fase3.test`, `fase3-horarios.test`, `fase3.spec`, `horarios.spec` | Pasa | — | — |
| 10 | Asistencia (pase de lista, retardos, correcciones con historial) | IMPLEMENTADA | `fase4.test`, `fase4-docente.test`, `fase4.spec`, `docente.spec`, `flujo-integral.spec` | Pasa | — | — |
| 11 | Salidas al baño y reincorporación (F ⇄ salida incompatibles) | IMPLEMENTADA | `fase4-docente.test`, `docente.spec`, `flujo-integral.spec` | Pasa | — | — |
| 12 | Incidencias del personal (REPORTADA → CONFIRMADA/DESCARTADA; sin faltas automáticas) | IMPLEMENTADA | `fase7-prefectura.test`, `prefectura.spec`, `flujo-integral.spec` | Pasa | — | — |
| 13 | PWA / sin conexión (Service Worker sólo estáticos, instalación, almacenamiento persistente) | IMPLEMENTADA | `offline.spec`, `navegacion.spec` | Pasa | Sólo en la versión compilada (`npm run preview`) | — |
| 14 | Respaldos (cifrado AES-GCM, huella, todo o nada, conflictos por CCT) | IMPLEMENTADA | `respaldos.test`, `fase5-respaldos.test`, `fase9-respaldos-grandes.test`, `respaldos.spec` | Pasa | Escuela grande: no se podía respaldar ni restaurar; **corregido** (§4, H1 y H2) | — |
| 15 | PDF / OCR (PDF.js y Tesseract locales; lo incierto no se convierte en registro) | IMPLEMENTADA | `fase6-documentos.test`, `pdf.spec` | Pasa | Una prueba de PDF ha fallado una vez por tiempo y pasado al repetir (intermitente) | BAJO |
| 16 | Prefectura (panel del día, coberturas con autorización, banco de actividades, reportes con validados) | IMPLEMENTADA | `fase7-prefectura.test`, `prefectura.spec`, `flujo-integral.spec` | Pasa | — | — |
| 17 | Multiusuario — **diseño** (roles, matriz, decisiones D1–D14) | IMPLEMENTADA | `docs/FASE8A_MULTIUSUARIO.md`, `docs/PERMISOS.md` | — | — | — |
| 18 | Multiusuario — **operativo** (cuentas por invitación, 2FA, sesiones, RLS, aislamiento) | PARCIAL | `fase8b.test`, `sso.test`, `aislamiento.test`, `comandos.test`, `cuenta.spec` (servidor) | Pasa | Funciona y está probado **sólo en un servidor local**. **No hay servidor desplegado**: hoy **no existe multiusuario institucional operativo** para una escuela real | ALTO (para el piloto) |
| 19 | Sincronización sin conexión (cola, versión base, conflictos explícitos, idempotencia) | PARCIAL | `dispositivos.test`, `sincronizacion.spec` (servidor) | Pasa | Probada contra el servidor local. Envío con la cuenta equivocada: **corregido** (S1). Sin servidor desplegado no hay sincronización real entre dispositivos de una escuela | ALTO (para el piloto) |
| 20 | Migración local → servidor (ensayo, autorización, huella, reversión) | PARCIAL | `migracion.test`, `migracion.spec` (servidor) | Pasa | Sólo con datos ficticios en servidor local; ninguna migración real | — |

## 2. Integridad de datos
Verificado con pruebas, **sin borrar información**:
- **Transacciones todo o nada.** Asistente, importaciones, pase de lista, restauración, sincronización por grupos y migración. Las pruebas fuerzan un fallo a mitad y comprueban que no queda nada a medias.
- **Identidad.** El nombre nunca identifica: matrícula/CURP (alumnos) o identificador interno (personal). Las coincidencias por nombre son «posible duplicado» y no se fusionan solas. La unicidad de matrícula y CURP por escuela se conserva con los índices v12, con prueba nueva.
- **Referencias.** Las restauraciones verifican Zod por tabla, referencias internas y huella antes de escribir. El servidor tiene llaves foráneas diferidas y un disparador de misma escuela, también para el dueño.
- **Migraciones del esquema local.** Hay pruebas que abren versiones anteriores con datos (v1, v5, v6, v8, v9) y comprueban que llegan a la vigente (v12) sin pérdida.
- **Historiales de sólo agregar.** `bitacora`, `bitacoraPrefectura`, `cambiosAsistencia` y `acceso.auditoria`. La base del servidor rechaza modificarlos o borrarlos.
- **Valores derivados no guardados.** Estado de lista, estado de clase en Prefectura, validación de horarios e indicador de sincronización se calculan de los registros.

## 3. Seguridad
Detalle completo en `docs/SEGURIDAD.md`. En resumen:
- **Modo sólo dispositivo** (el uso actual): no hay cuentas. El «docente de este dispositivo» es una preferencia y la interfaz lo dice. **No es un permiso.**
- **Modo con servidor**: cuentas, 2FA y permisos verificados en el servidor con RLS. Funciona **sólo en entorno local**: **no hay multiusuario institucional operativo** mientras no se despliegue (requiere autorización y contratación).
- No hay permisos simulados con botones ocultos. No hay `innerHTML` con datos, ni `alert`/`confirm`/`prompt`, ni secretos en el cliente. La CSP no admite estilos ni scripts en línea.

## 4. Hallazgos y correcciones
| # | Severidad | Hallazgo | Cómo se encontró | Estado |
|---|---|---|---|---|
| H1 | **CRÍTICO** | Un respaldo de una escuela con 3 semanas de asistencia (71,5 MB) **no se podía restaurar**: el límite era 25 MB. La app generaba respaldos que ella misma rechazaba | Prueba de volumen | **Corregido**: los respaldos de más de 8 MB se comprimen con gzip (11,2 MB en este caso). Los límites suben a 120 MB por archivo y 400 MB descomprimido, con lectura por flujo y corte al exceder. Se leen cifrados, comprimidos o ambos. Con pruebas |
| H2 | **CRÍTICO** | En esa misma escuela, «Descargar respaldo» **no generaba el archivo**: `lista.push(...arreglo)` con ~157 000 asistencias desborda la pila | Prueba de volumen (la descarga nunca llegó) | **Corregido** (concatenación sin `...`), con prueba de 200 000 registros. Se revisaron los demás usos de `...` con listas que pueden crecer y se corrigieron 2 más |
| S1 | **CRÍTICO** | La cola de sincronización de una cuenta se enviaba con la sesión de otra cuenta en el mismo dispositivo | Revisión de seguridad + prueba | **Corregido**, con prueba |
| S2 | **ALTO** | Al cerrar sesión en un dispositivo compartido, los datos de la escuela quedaban sin aviso | Revisión de seguridad | **Corregido**: se ofrece quitarlos, nunca en silencio y nunca con cambios sin enviar. Con prueba |
| R1 | **ALTO** | Importar 1 500 alumnos tardaba 95,6 s: cada alta leía todos los alumnos de la escuela y, uno por uno, a los compañeros del grupo | Prueba de volumen | **Corregido** (18,1 s): esquema local v12 con índices `matricula` y `curp` (sólo índices, sin tocar datos) y una sola lectura por grupo (`obtenerVarios`) |
| U2 | **ALTO** | «Cuenta» afirmaba que iniciar sesión no sincroniza datos (falso desde 8D) | Revisión de interfaz | **Corregido** (§6) |
| U3 | MEDIO | «Mi día» tardaba 2,5 s con volumen | Revisión de interfaz | **Corregido** (§6) |
| R2 | MEDIO | Restaurar ~165 000 registros tardaba 44,5 s: consultaba el vínculo de sincronización por cada registro | Prueba de volumen | **Corregido** (22 s): una consulta por escuela |
| S3 | MEDIO | El indicador de sincronización podía quedar desactualizado | Prueba de flujo | **Corregido** |
| U1 | MEDIO | El panel de la escuela mostraba como «Próximamente» módulos ya disponibles | Revisión de interfaz | **Corregido** |
| S4 | MEDIO | Base local única por dispositivo para todas las cuentas | Revisión | **Abierto**: mitigado con S2; propuesta para antes del piloto |
| S5 | BAJO | Vulnerabilidades sólo en herramientas de desarrollo | `npm audit` | Abierto (0 en producción) |
| S6 | BAJO | Better Auth con versión posterior disponible | Revisión | Abierto |
| T1 | BAJO | Prueba de PDF intermitente por tiempo | Ejecución | Abierto |

No quedan hallazgos CRÍTICOS ni ALTOS abiertos en el código. Los dos ALTOS de la matriz (filas 18 y 19) no son defectos: son requisitos de **despliegue** que necesitan autorización y contratación, fuera del alcance de esta fase (ver `docs/PLAN_PILOTO.md`).

## 5. Rendimiento (medido, datos ficticios)
Volumen: 1 escuela, 3 turnos, 30 grupos, 100 trabajadores, 1 500 alumnos, 1 050 clases semanales, 3 semanas de asistencia (157 500 marcas, 3 150 pases). Después se importan otros 1 500 alumnos. Chromium sin interfaz en el contenedor de desarrollo, escritorio 1280 × 800. Prueba: `npm run test:rendimiento` (`tests/rendimiento/`). Los tiempos son de **una** ejecución en este equipo y no garantizan los de un teléfono escolar.

| Medición | Antes de corregir | Después |
|---|---|---|
| Generar datos ficticios (Node, fuera de la app) | 1,6 s | 1,8 s |
| Leer y validar el respaldo (Zod, referencias, huella) | 5,5 s | 3,8 s |
| Escribir el respaldo en IndexedDB (restaurar) | 44,5 s | 22,1 s |
| Panel de la escuela | 311 ms | 118 ms |
| Lista de alumnos del ciclo (1,500) | 822 ms | 837 ms |
| Buscar un alumno por matrícula | 826 ms | 833 ms |
| Grupo: horario semanal | 223 ms | 223 ms |
| Grupo: asistencia del ciclo (50 alumnos, 3 semanas) | 192 ms | 205 ms |
| Abrir pase de lista | 71 ms | 81 ms |
| Guardar pase de lista (50 alumnos) | 116 ms | 121 ms |
| Revisión de horarios del ciclo (conflictos, 1,050 clases) | 154 ms | 250 ms |
| Prefectura: panel del día | 353 ms | 361 ms |
| Prefectura: reportes | 112 ms | 82 ms |
| Prefectura: generar reporte del mes | 193 ms | 206 ms |
| Importación: leer y analizar 1,500 filas | 6,0 s | 4,7 s |
| Importación: guardar 1,500 alumnos (transacción) | 95,6 s | 18,1 s |
| Descargar respaldo sin cifrar de la escuela completa | **no se generaba** (H2) | 6,2 s |

- Archivo del respaldo de volumen: 71,5 MB sin comprimir y 11,2 MB comprimido (157 500 asistencias, 3 150 pases, 1 050 sesiones).
- Las diferencias de menos de 100 ms entre corridas son variación normal; sólo se optimizó lo que superaba lo aceptable.
- **Lo que sigue lento:** restaurar una escuela completa (22 s) e importar 1 500 alumnos (18 s). Son operaciones masivas y poco frecuentes, todo o nada, con el botón en estado «trabajando». Se clasifican **BAJO**.
- **No medido:** el servidor con volumen (RLS por fila) y teléfonos reales de gama baja. Son pendientes para antes del piloto.

## 6. Revisión de interfaz (teléfono, tableta, escritorio)
Prueba: `npm run test:ux` (`tests/ux/interfaz.spec.ts`). Usa la misma escuela ficticia de volumen y el docente del dispositivo elegido en `#/perfil`. Revisa **13 pantallas × 3 tamaños**: teléfono 360 × 780, tableta 820 × 1180 y escritorio 1280 × 800. Pantallas: Mi día, pase de lista, alumnos y horario del grupo, panel de la escuela, alumnos del ciclo, importar, horarios del ciclo, Prefectura (día, actividades, reportes), respaldos y cuenta.

En cada una comprueba, automáticamente, que no haya desplazamiento horizontal de la página ni botones, enlaces o campos de menos de 44 px. Además se revisaron a ojo las capturas (`test-results/ux/`).

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| U2 | **ALTO** | «Cuenta» decía «iniciar sesión todavía NO envía ni sincroniza tus datos». Desde la Fase 8D es falso: la escuela se sincroniza al elegir «Usar en este dispositivo». Información engañosa sobre a dónde van los datos | **Corregido**: el texto dice exactamente cuándo se envían los datos |
| U3 | MEDIO | «Mi día» (primera pantalla del docente) tardaba ~2,5 s con volumen: calculaba el recordatorio de respaldo leyendo los ~165 000 registros antes de mostrar la clase | **Corregido**: la clase se muestra en ~0,1 s (0,4 s con la espera de la prueba) y el recordatorio aparece después. Con prueba (`docente.spec`) |
| U4 | BAJO | Prefectura en escritorio: «Día anterior / Hoy / Día siguiente» apilados a todo lo ancho | **Corregido**: en fila (se acomodan en dos renglones en teléfono) |
| U5 | BAJO | La pantalla de respaldos tarda ~2,5 s en mostrarse con volumen (calcula el estado de cada escuela) | Abierto (no bloquea; es una pantalla poco frecuente) |
| U6 | BAJO | El aviso emergente tapa el título unos segundos en teléfono | Abierto (se cierra solo o con ✕) |

Resultado final: **0 desbordes y 0 objetivos chicos** en las 39 combinaciones. Los flujos de docente (Mi día → lista → salida → regreso) y Prefectura (incidencia → cobertura → reporte) ya tenían pruebas en teléfono de 320–390 px (`docente.spec`, `prefectura.spec`, proyecto «movil»), que siguen pasando.

## 7. Pruebas ejecutadas
Todas ejecutadas el 2026-11-03 en este entorno, con datos ficticios:

| Suite | Comando | Resultado |
|---|---|---|
| Tipos (app, servidor, pruebas del servidor) | `npm run typecheck` | Sin errores |
| Unitarias e integración (IndexedDB en memoria) | `npm test` | **182 de 182** (19 archivos) |
| Compilación | `npm run build` | Correcta |
| Funcionales en navegador (versión compilada con Service Worker; escritorio y móvil) | `npx playwright test` | **59 de 59** (incluye `flujo-integral.spec`, nueva) |
| Servidor (PostgreSQL 16 real) | `npm run test:servidor` | **109 de 109** (6 archivos) |
| Funcionales con servidor real (cuentas, sincronización, migración) | `npm run test:e2e:servidor` | **4 de 4** |
| Rendimiento con volumen | `npm run test:rendimiento` | 1 de 1 (tiempos en §5) |
| Interfaz en 3 tamaños | `npm run test:ux` | 1 de 1 (39 revisiones) |
| Dependencias de producción | `npm audit --omit=dev` | 0 vulnerabilidades |
| Todas las dependencias | `npm audit` | 10 (2 bajas, 8 moderadas), sólo herramientas de desarrollo (S5) |

**Pruebas pendientes** (no se pueden hacer aquí o requieren autorización):
- Servidor con volumen.
- Teléfonos y tabletas reales de gama baja.
- Instalación como app en Android e iOS reales.
- Red intermitente real.
- Varios dispositivos físicos con un servidor desplegado.
- Ensayo de migración con una copia de datos reales en un servidor aislado (requiere autorización).
- Revisión de accesibilidad con lector de pantalla.
