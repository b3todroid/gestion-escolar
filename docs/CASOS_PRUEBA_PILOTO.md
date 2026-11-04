# Casos de prueba del piloto — Fase 10

Todos los casos usan **datos ficticios**. La mayoría usa la escuela **ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001)**, que genera `piloto/datos.ts`; el resto, escuelas ficticias que crea cada prueba. Cada caso es **reproducible**: se ejecuta con el comando indicado. Nada se dio por bueno sin ejecutarlo.

**Cómo leer la tabla**
- **Preparación**:
  - «DEMO» = DEMO-001 cargada con «Restaurar» en un navegador vacío del piloto (escala 0.2: 6 grupos, 24 trabajadores, 300 alumnos y 3 semanas de asistencia).
  - «Propia» = la prueba crea su escuela ficticia.
  - «Servidor» = servidor real con una base PostgreSQL temporal que se borra al terminar.
- **Evidencia**: archivo de la prueba y nombre del caso. El informe de la última ejecución queda en `test-results/` (no se versiona).
- **Estado**: ✓ APROBADO = la prueba pasó en la ejecución final del 2026-11-04 (`docs/PILOTO_FASE_10.md` §4). ⚠ NO PROBADO = no se pudo probar en este entorno (se dice por qué).

## Comandos
| Suite | Comando |
|---|---|
| Piloto local (Android, tableta y escritorio **emulados**) | `npm run test:piloto` |
| Piloto multiusuario (servidor real) | `PRUEBAS_POSTGRES_URL=… npm run test:piloto:multiusuario` |
| Rendimiento del piloto | `npm run test:piloto:rendimiento` |
| Unitarias e integración | `npm test` |
| Servidor | `PRUEBAS_POSTGRES_URL=… npm run test:servidor` |
| Funcionales | `npx playwright test` y `npm run test:e2e:servidor` |

## 0. Entorno del piloto
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| ENT-01 | Entorno aislado y escuela marcada | Navegador vacío (origen propio, puerto 4180) | Comprobar 0 escuelas → restaurar DEMO-001 → revisar barra, inicio y panel | Barra «DEMOSTRACIÓN — datos FICTICIOS», insignia en inicio, «CCT: No aplica», conteos iguales al archivo | Igual | ✓ | `tests/piloto/local.spec.ts` PIL-ENT-01 |
| ENT-02 | Generador reproducible | — | Generar dos veces con los mismos parámetros | Mismos identificadores y misma huella; escala 1 = 30 grupos, 100 trabajadores, 1 500 alumnos, 2 turnos | Igual | ✓ | `tests/unit/fase10-piloto.test.ts` (generador) |
| ENT-03 | Datos coherentes | — | Restaurar en la app; revisar conflictos, SE y referencias | Sin errores de validación, 0 conflictos de horario, SE confirmadas, ninguna salida de un alumno con falta | Igual | ✓ | `fase10-piloto.test.ts` |
| ENT-04 | Limpieza local segura | DEMO + una escuela ficticia NO de demostración | «Quitar escuela de demostración» | Sólo se borra DEMO-001; la otra escuela no tiene ese botón y queda intacta | Igual | ✓ | PIL-LIM-01; unitaria «quita SÓLO la escuela de demostración» |
| ENT-05 | La limpieza nunca toca escuelas reales | Escuela real ficticia (sin marca) | Llamar a la limpieza sobre ella; y sobre una escuela de demostración sincronizada | Rechazo en ambos casos; nada se borra | Igual | ✓ | `fase10-piloto.test.ts` |
| ENT-06 | Servidor del piloto con candados | PostgreSQL local | `npm run piloto -- servidor iniciar\|limpiar` sobre una base que no es del piloto, sobre una base del piloto con una escuela no marcada y sobre una sólo con DEMO-001 | Se niega a la base ajena y a la que tiene una escuela real; limpia sólo la de DEMO-001; carga con huella verificada | Igual | ✓ | `servidor/pruebas/piloto.test.ts` |
| ENT-07 | La marca de demostración no se puede falsear | Servidor | `UPDATE … demostracion=false`; insertar una de demostración con CCT; editar la demo con CCT; crear desde la interfaz con `demostracion: true` | Todo rechazado, o la marca se ignora | Igual | ✓ | `piloto.test.ts`; `fase10-piloto.test.ts` |

## 7. Configuración
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| CFG-01 | Crear escuela | Propia | Asistente de 6 pasos | Escuela, ciclo, turno, periodos, grados y grupos en una transacción | Igual | ✓ | `asistente.spec` «el asistente crea una escuela completa…»; `fase1-completa.spec` |
| CFG-02 | Editar escuela | DEMO y Propia | Editar datos y recargar | Cambios guardados; la DEMO no pide ni admite CCT; una real sí la exige | Igual | ✓ | PIL-CFG-01; `configuracion.spec` «editar escuela, ciclo, turno…»; unitaria de la marca |
| CFG-03 | Configurar turno | DEMO y Propia | Turno matutino y vespertino | Dos turnos con jornadas distintas | Igual | ✓ | PIL-CFG-01; `configuracion.spec` |
| CFG-04 | Configurar jornada | Propia | Horas de entrada y salida, días | Se valida que los periodos quepan | Igual | ✓ | `asistente.spec` (error «después de la salida») |
| CFG-05 | Periodos de duración variable | DEMO | Ver turno vespertino | 45 min y uno de 60 min (18:05–19:05) | Igual | ✓ | PIL-CFG-01; ENT-02 |
| CFG-06 | Detectar solapamientos | Propia | Agregar o editar un periodo traslapado | Se rechaza y se marca en su lugar | Igual | ✓ | `configuracion.spec` «detecta periodos superpuestos…»; `fase1-completa.spec` «el periodo que se traslapa…» |
| CFG-07 | Crear grados | Propia | Asistente y panel | Grados creados y editables | Igual | ✓ | `configuracion.spec` «editar … grado y grupo» |
| CFG-08 | Crear grupos | Propia | Asistente y panel | Grupos por grado y turno | Igual | ✓ | `fase1-completa.spec` |
| CFG-09 | Evitar duplicados | Propia | Doble clic en Guardar; doble envío del formulario de grupo | Nada duplicado | Igual | ✓ | `configuracion.spec` (2 casos) |
| CFG-10 | Persistencia al recargar | Propia y DEMO | Cerrar y reabrir el navegador; recargar | Todo se conserva | Igual | ✓ | `asistente.spec`; PIL-CFG-01 |

## 8. Catálogos
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| CAT-01 | Crear personal | Propia | Alta manual | Persona creada | Igual | ✓ | `catalogos.spec` «altas manuales…» |
| CAT-02 | Varias funciones | Propia y DEMO | Alta con docente + otra función | Se guardan ambas | Igual | ✓ | `catalogos.spec`; la DEMO incluye docente+orientación y prefectura+docente |
| CAT-03 | Registrar docentes | Propia | Importar personal (CSV) y verlo en Docentes | Aparece como docente | Igual | ✓ | `catalogos.spec` «importa personal desde CSV…» |
| CAT-04 | Registrar alumnos | DEMO | Inscribir alumno | Alta con grupo | Igual | ✓ | PIL-CAT-01; `catalogos.spec` |
| CAT-05 | Asignar grupos | DEMO | Inscribir con grupo | Inscripción con turno y grado del grupo | Igual | ✓ | PIL-CAT-01 |
| CAT-06 | Cambiar de grupo | DEMO | Cambiar con motivo y recargar | Misma persona; historial «A → B»; se conserva | Igual | ✓ | PIL-CAT-01; `catalogos.spec` |
| CAT-07 | Registrar materias | Propia | Alta por tipo | Materia y SE como tipos distintos | Igual | ✓ | `catalogos.spec`; `fase2.spec` |
| CAT-08 | Buscar y filtrar | DEMO (300 alumnos) | Buscar por matrícula | 1 resultado | Igual | ✓ | PIL-CAT-01 |
| CAT-09 | Desactivar registros | Propia | Desactivar materia y grupo | No reciben registros nuevos | Igual | ✓ | `catalogos.spec`; `fase2.spec` «reglas de baja…» |
| CAT-10 | Evitar duplicados | DEMO | Alta con matrícula existente | «Otra persona ya tiene esa matrícula» y nada se crea | Igual | ✓ | PIL-CAT-01; `fase9-respaldos-grandes.test` (índices) |

## 9. Importación
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| IMP-01 | Excel válido | Propia | Importar alumnos (.xlsx con sinónimos y varias hojas) | Importado | Igual | ✓ | `catalogos.spec` «importa alumnos desde Excel…» |
| IMP-02 | CSV válido | Propia y DEMO | Importar personal; importar hasta 300 alumnos en la DEMO | Importado | Igual | ✓ | `catalogos.spec`; `tests/piloto/rendimiento.spec.ts` |
| IMP-03 | PDF digital | Propia | Horario por grupo en PDF | Estructura, corrección, validación y guardado | Igual | ✓ | `pdf.spec` «1, 3 y 5…» |
| IMP-04 | PDF escaneado | Propia | OCR local | Campos inciertos marcados; la persona decide | Igual | ✓ | `pdf.spec` «2. PDF escaneado…» |
| IMP-05 | Horario por grupo | Propia | Excel y PDF | Horario armado | Igual | ✓ | `horarios.spec`; `pdf.spec` |
| IMP-06 | Horario por docente | Propia | PDF por docente | Conflictos y grupos inexistentes se señalan | Igual | ✓ | `pdf.spec` «4, 6, 9 y 8…» |
| IMP-07 | Duplicados | Propia | Reimportar; nombres iguales | «Posible duplicado»; nada se fusiona solo | Igual | ✓ | `pdf.spec`; `fase2-catalogos.test` «8 y 14…» |
| IMP-08 | Encabezados desconocidos | Propia | Columnas sin reconocer | Se asignan a mano antes de analizar | Igual | ✓ | `catalogos.spec` «encabezados desconocidos…» |
| IMP-09 | Campos incompletos | Propia | Filas con datos faltantes | Error por fila; no se importan | Igual | ✓ | `fase3.spec`; `fase2-catalogos.test` |
| IMP-10 | Conflictos | Propia | Importación con choques | Se muestran y no se guarda nada | Igual | ✓ | `fase3.spec` «conflictos intencionales…» |
| IMP-11 | Cancelación | Propia | Cancelar tras analizar | Nada cambia | Igual | ✓ | `catalogos.spec` «…cancela y reimporta»; `pdf.spec` 10 |
| IMP-12 | Restauración después de error | Propia | Importación PDF fallida o cancelada | Los datos quedan como antes | Igual | ✓ | `pdf.spec` «10. Conservación de datos…» |
| IMP-13 | No alterar lo confirmado | Propia | Importar sobre un horario confirmado | Lo confirmado no se toca | Igual | ✓ | `fase3.test` «…respeta lo existente y lo confirmado» |

## 10. Horarios
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| HOR-01 | Horario por grupo | DEMO | Abrir grupo (teléfono: lista por día; tableta y escritorio: tabla) | 30 h/semana, materias, receso, «confirmado» | Igual | ✓ | PIL-HOR-01 |
| HOR-02 | Horario por docente | DEMO | Abrir semana del docente | Sus grupos | Igual | ✓ | PIL-HOR-01 |
| HOR-03 | Materias | DEMO | Ver materias del grupo | 6 materias × 5 h | Igual | ✓ | PIL-HOR-01 |
| HOR-04 | Periodos y recesos | DEMO | Ver horario | Receso 09:30–09:50 | Igual | ✓ | PIL-HOR-01 |
| HOR-05 | Horas SE | DEMO | Prefectura: SE del día | «Disponible según registro»; una SE sin confirmar no cuenta | Igual | ✓ | PIL-PRE-01; `fase3-horarios.test` «un hueco nunca es SE» |
| HOR-06 | Conflictos | DEMO | Asignar a un docente ocupado a esa hora | Rechazo «TRASLAPE» y 0 conflictos guardados | Igual | ✓ | `fase10-piloto.test` PIL-HOR-02; `horarios.spec` |
| HOR-07 | Cambios de horario | DEMO | Cambiar el docente de un horario confirmado | Exige reabrir con motivo (bitácora) | Igual | ✓ | PIL-HOR-02 |
| HOR-08 | Integridad entre vistas | DEMO | Tras el cambio, revisar el grupo y ambos docentes | El grupo muestra al nuevo; el anterior ya no tiene la clase; el nuevo sí | Igual | ✓ | PIL-HOR-02 |
| HOR-09 | Persistencia | Propia | Cerrar y reabrir el navegador | Horarios intactos | Igual | ✓ | `fase3.spec` «los horarios se conservan…» |

## 11. Jornada del docente (DEMO, 07:15 del lunes 2 de noviembre de 2026)
| ID | Objetivo | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|
| DOC-01 | Abrir aplicación | «Soy yo» → Mi día | Mi día del docente (aviso: no es una cuenta) | Igual | ✓ | PIL-DOC-01 |
| DOC-02 | Actividad actual | Mi día | CLASE · 1° A · Matemáticas | Igual | ✓ | PIL-DOC-01; `docente.spec` (límites exactos) |
| DOC-03 | Consultar grupo | «Entrar al grupo» | Clases del grupo | Igual | ✓ | PIL-DOC-01 |
| DOC-04 | Abrir lista | «Pasar lista» | NO INICIADA; abrir no escribe | Igual | ✓ | PIL-DOC-01; `docente.spec` |
| DOC-05 a 07 | Presentes, faltas y retardos | Todos P; marcar F y R | Contadores correctos | Igual | ✓ | PIL-DOC-01 |
| DOC-08 | Guardar asistencia | «Guardar lista» | 1 pase nuevo; «1 faltas, 1 retardos» | Igual | ✓ | PIL-DOC-01 |
| DOC-09 | Modificar un registro | F → R y confirmar | MODIFICADA e historial «Falta → Retardo» | Igual | ✓ | PIL-DOC-01 |
| DOC-10 | Salida al baño | Salida a las 07:20 | «Fuera del aula desde las 07:20» | Igual | ✓ | PIL-DOC-01 |
| DOC-11 | Reincorporación | Regreso a las 07:26 | «se reincorporó» | Igual | ✓ | PIL-DOC-01 |
| DOC-12 | Crear incidencia | Reporte breve (conducta) | Guardado y visible en el alumno | Igual | ✓ | PIL-DOC-01 |
| DOC-13 | Historial y persistencia | Recargar; ver historial y ficha | Se conserva todo | Igual | ✓ | PIL-DOC-01 |
| DOC-14 | Estados contradictorios | Salida de un alumno con falta | Botón deshabilitado; F ⇄ salida exige resolver | Igual | ✓ | PIL-DOC-01; `docente.spec` (conflicto) |

## 12. Prefectura (DEMO)
| ID | Objetivo | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|
| PRE-01 | Ausencia | Registrar falta | REPORTADA (sin confirmar); 0 coberturas automáticas | Igual | ✓ | PIL-PRE-01 |
| PRE-02 | Grupo afectado | Ver panel; confirmar | «POSIBLE» → «GRUPO SIN DOCENTE CONFIRMADO» | Igual | ✓ | PIL-PRE-01 |
| PRE-03 | Horas SE | Panel | SE disponible | Igual | ✓ | PIL-PRE-01 |
| PRE-04 | Propuesta | Atender → candidatos → proponer | «Compatible · SE»; proponer no asigna | Igual | ✓ | PIL-PRE-01 |
| PRE-05 | Autorización | Asignar sin «Autorizó» | Rechazado | Igual | ✓ | PIL-PRE-01 |
| PRE-06 | Asignación | Con autorización | COBERTURA ASIGNADA | Igual | ✓ | PIL-PRE-01; `prefectura.spec` (rechazo por choque) |
| PRE-07 | Registro de actividad | Descripción de la actividad | Guardada | Igual | ✓ | PIL-PRE-01; banco en `prefectura.spec` |
| PRE-08 | Confirmación | «Sí, se realizó» | COBERTURA REALIZADA e historial | Igual | ✓ | PIL-PRE-01 |
| PRE-09 | Reporte | Reporte del día | 1 incidencia confirmada, 1 cobertura realizada | Igual | ✓ | PIL-PRE-01 |
| PRE-10 | Dirección: consulta y seguimiento | Asistencia del grupo; reporte de 30 días con el historial generado | Indicadores > 0 y historial de coberturas | Igual | ✓ | PIL-DIR-01 |

## 13. Multiusuario (servidor REAL; cada persona = un navegador con almacenamiento propio)
| ID | Objetivo | Preparación | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| MU-01 | Dos docentes a la vez; Prefectura consulta | Servidor con DEMO-001 (escala 0.1) y cuentas reales | Docente Uno y Docente Dos entran, «Usar en este dispositivo», guardan su lista **al mismo tiempo**; Prefectura sincroniza | El servidor tiene las 2 listas; el dispositivo de Prefectura las recibe | Igual (llegaron en segundos tras la corrección INC-05) | ✓ | `tests/piloto/multiusuario.spec.ts` PIL-MU-01 |
| MU-02 | Cambios concurrentes y conflicto | Misma docente en 2 dispositivos | Ambos sin conexión cambian la misma lista; A sincroniza; B sincroniza | B ve CONFLICTO (no «Sincronizado»); decide «Usar la versión del servidor»; queda igual al servidor, sin duplicados | Igual (tras corregir INC-04) | ✓ | PIL-MU-02 |
| MU-03 | Sesiones, permisos y separación de escuelas | 2 escuelas en el servidor | Leer la otra escuela con la docente y con Prefectura; sin sesión; cerrar la sesión de la docente | 403/404; sin sesión 401/403; la sesión de Prefectura sigue | Igual | ✓ | PIL-MU-03 |
| MU-04 | Restricciones por rol (6 roles × 31 tablas × 2 escuelas) | Servidor | Lectura y escritura por rol | Sólo lo que permite la matriz | Igual | ✓ | `servidor/pruebas/aislamiento.test.ts` |
| MU-05 | Reintentos sin duplicados; cuenta equivocada | Servidor + dispositivos simulados | Perder la respuesta; otra cuenta en el dispositivo | Sin duplicados; la cola no se envía con otra cuenta | Igual | ✓ | `servidor/pruebas/dispositivos.test.ts` |

## 14. Sin conexión
| ID | Objetivo | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|
| OFF-01 | Carga sin internet tras instalar | Service Worker listo → sin red → recargar | La app abre | Igual | ✓ | PIL-OFF-01; `offline.spec` |
| OFF-02 | Consulta de horarios | Sin red | Horario visible | Igual | ✓ | PIL-OFF-01 |
| OFF-03 | Pase de lista | Sin red | «Guardado en este dispositivo» | Igual | ✓ | PIL-OFF-01 |
| OFF-04 | Incidencias | Sin red | REPORTADA | Igual | ✓ | PIL-OFF-01 |
| OFF-05 | Persistencia local | Recargar sin red | Se conserva | Igual | ✓ | PIL-OFF-01 |
| OFF-06 | Cierre y reapertura | Cerrar y abrir el navegador sin red | Se conserva | Igual | ✓ | `offline.spec` «…persisten al cerrar y abrir el navegador» |
| OFF-07 | Honestidad | Sin servidor | Nunca dice «Sincronizado» | Igual | ✓ | PIL-OFF-01 |
| OFF-08 | Reconexión y sincronización posterior | Con servidor: sin red → guardar → volver la red | «por enviar» → «✓ Sincronizado» y la lista está en el servidor | Igual | ✓ | `e2e-servidor/sincronizacion.spec`; PIL-MU-02 |
| OFF-09 | Prevención de duplicados | Reintentos | 1 registro | Igual | ✓ | `dispositivos.test`; PIL-MU-02 |
| OFF-10 | Conflictos | Ver MU-02 | Decisión explícita | Igual | ✓ | PIL-MU-02 |

## 15. Respaldos y recuperación (navegadores aislados)
| ID | Objetivo | Pasos | Esperado | Observado | Estado | Evidencia |
|---|---|---|---|---|---|---|
| RES-01 | Exportación cifrada | Descargar DEMO con contraseña | Archivo cifrado sin texto legible | Igual | ✓ | PIL-RES-01 |
| RES-02 | Restauración en otro dispositivo | Restaurar el cifrado | Conteos idénticos | Igual | ✓ | PIL-RES-01; `respaldos.spec` |
| RES-03 | Versión incompatible | Esquema 99 | «versión más nueva»; nada se escribe | Igual | ✓ | PIL-RES-01 |
| RES-04 | Archivo corrupto | Archivo truncado | «no es un respaldo válido» | Igual | ✓ | PIL-RES-01 |
| RES-05 | Integridad | Un dato alterado | Huella distinta: rechazado | Igual | ✓ | PIL-RES-01; `respaldos.spec` |
| RES-06 | Conflictos | Misma escuela; misma CCT con otra escuela | Copia previa antes de reemplazar; mezcla bloqueada | Igual | ✓ | `respaldos.spec`; `fase5-respaldos.test` |
| RES-07 | Recuperación tras interrupción | Cerrar la pestaña a mitad de una restauración | Todo o nada | Igual | ✓ | PIL-RES-02 |
| RES-08 | Escuela grande | 71,5 MB / 157 500 marcas | Se respalda y se restaura | Igual | ✓ | `fase9-respaldos-grandes.test`; `test:rendimiento` |

## 17. Seguridad
| ID | Objetivo | Esperado | Estado | Evidencia |
|---|---|---|---|---|
| SEG-01 | Autenticación | Sólo invitados; código de un uso; segundo factor obligatorio para Administración y Dirección | ✓ | `fase8b.test`, `sso.test`, `e2e-servidor/cuenta.spec` |
| SEG-02 | Autorización | Matriz por rol + RLS | ✓ | `aislamiento.test`, `comandos.test`, PIL-MU-03 |
| SEG-03 | Acceso entre escuelas | 403/404 | ✓ | `aislamiento.test`, PIL-MU-03 |
| SEG-04 | Protección de datos | Respaldos cifrados; CURP sólo para Dirección; auditoría sin datos personales | ✓ | `fase5-respaldos.test`, `comandos.test` |
| SEG-05 | Sesiones | Revocación inmediata; cerrar sesión no afecta a otros | ✓ | `fase8b.test`, PIL-MU-03 |
| SEG-06 | Validación de entradas | Zod en todo; errores junto al campo | ✓ | `validacion.test`, `configuracion.spec` |
| SEG-07 | Archivos malformados | Rechazo sin escribir nada | ✓ | PIL-RES-01, `importacion-lector.test`, `pdf.spec` |
| SEG-08 | XSS | Los textos se muestran como texto | ✓ | `configuracion.spec` «los textos se muestran como texto…» |
| SEG-09 | Exposición de secretos | La compilación no contiene secretos | ✓ | `cuenta-local.spec` |
| SEG-10 | Auditoría | Sólo agregar; la base rechaza modificar o borrar | ✓ | `fase8b.test` |
| SEG-11 | Herramientas del piloto | Nunca actúan fuera del piloto | ✓ | ENT-04 a ENT-07 |

## 18. Experiencia de uso
| ID | Dispositivo | Cómo se probó | Estado | Evidencia |
|---|---|---|---|---|
| UX-01 | Android | **Emulación** de Chromium (Pixel 7, 412 px), con toque y sin CPU lenta; y con CPU 4× más lenta para el rendimiento | ✓ (emulado) | `test:piloto` proyecto «android»; `test:piloto:rendimiento` |
| UX-02 | iPhone | **No probado**: no hay dispositivo ni motor WebKit en este entorno (sólo Chromium) | ⚠ NO PROBADO | — |
| UX-03 | Tableta | **Emulación** (Galaxy Tab S4) | ✓ (emulado) | `test:piloto` proyecto «tableta» |
| UX-04 | Computadora | Chromium de escritorio | ✓ | `test:piloto` proyecto «escritorio» |
| UX-05 | Botones, desplazamiento horizontal | 13 pantallas × 3 tamaños: 0 desbordes y 0 objetivos < 44 px | ✓ | `test:ux` (Fase 9) |
| UX-06 | Pasar lista rápido | La docente toca sólo F y R; un toque por alumno; guardado en ~0,1–0,2 s | ✓ | PIL-DOC-01, `RESULTADOS_RENDIMIENTO.md` |
| UX-07 | Registrar coberturas | Candidatos ordenados (SE primero); autorización obligatoria; 4 toques + autorización | ✓ | PIL-PRE-01 |

**Ningún dispositivo físico se usó.** Android y tableta se probaron por emulación. La prueba en los teléfonos reales de la escuela es requisito del piloto real (`docs/LISTA_VERIFICACION_DESPLIEGUE.md`).
