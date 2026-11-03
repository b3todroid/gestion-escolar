# Modelo de datos

Base IndexedDB `gestion-escolar`, gestionada con Dexie (`src/database/db.ts`). Tipos en `src/models/index.ts`.

## Metadatos comunes
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID v4 | Identificador interno estable. Nunca se usa un nombre como id. |
| `creadoEn` / `actualizadoEn` | ISO 8601 | Marcas de tiempo. |
| `version` | entero | Inicia en 1; +1 en cada actualización (sincronización futura). |

## Entidades (Fase 1)
```
Escuela 1─* CicloEscolar 1─* Turno 1─1 Jornada 1─* Periodo
                         │                     └─* Receso
                         ├─* Grado 1─* Grupo *─1 Turno
```
| Tabla | Campos | Índices |
|---|---|---|
| `escuelas` | nombre (oficial), nombreCorto?, cct?, nivel, entidad? (clave INEGI '01'–'32'), localidad? (municipio o alcaldía), zonaEscolar?, sector?, domicilio?, telefono? (10 dígitos), correo?, logotipo? (data URL PNG reducida a 256 px) | `id`, `cct` |
| `ciclosEscolares` | escuelaId, nombre, fechaInicio, fechaFin (AAAA-MM-DD), estado | `id`, `escuelaId`, `[escuelaId+estado]` |
| `turnos` | escuelaId, cicloEscolarId, nombre | `id`, `cicloEscolarId`, `escuelaId` |
| `jornadas` | escuelaId, cicloEscolarId, turnoId, horaInicio, horaFin (HH:MM), dias (1=lun…7=dom) | `id`, `&turnoId` (único), `cicloEscolarId` |
| `periodos` | escuelaId, cicloEscolarId, jornadaId, nombre, horaInicio, horaFin | `id`, `jornadaId`, `cicloEscolarId` |
| `recesos` | ídem periodos | `id`, `jornadaId`, `cicloEscolarId` |
| `grados` | escuelaId, cicloEscolarId, numero, nombre | `id`, `cicloEscolarId`, `[cicloEscolarId+numero]` |
| `grupos` | escuelaId, cicloEscolarId, gradoId, turnoId, nombre, capacidad?, activo | `id`, `cicloEscolarId`, `gradoId`, `turnoId` |

Toda entidad dentro de un ciclo guarda `escuelaId` y `cicloEscolarId` (desnormalizados) para consultar y aislar datos por escuela/ciclo, y para futuras reglas de permisos y sincronización.

## Entidades de la Fase 2 (versión 2 del esquema)
```
Escuela 1─* Personal (funciones: docente, directivo, …)
CicloEscolar 1─* Materia
Grupo 1─* Asignacion *─1 Materia, *─0..1 Personal (docente)
Asignacion 1─* Sesion *─1 Periodo   (Sesion = una hora del horario: día + periodo)
```
| Tabla | Campos | Índices |
|---|---|---|
| `personal` | escuelaId, nombre, primerApellido, segundoApellido?, numeroEmpleado?, funciones[], activo | `id`, `escuelaId` |
| `materias` | escuelaId, cicloEscolarId, nombre, abreviatura? | `id`, `cicloEscolarId`, `escuelaId` |
| `asignaciones` | escuelaId, cicloEscolarId, grupoId, materiaId, personalId?, horasSemana | `id`, `cicloEscolarId`, `grupoId`, `materiaId`, `personalId` |
| `sesiones` | escuelaId, cicloEscolarId, asignacionId, grupoId, personalId?, dia (1–7), periodoId | `id`, `cicloEscolarId`, `grupoId`, `personalId`, `asignacionId`, `periodoId` |

Decisiones:
- **Docente no es una tabla aparte**: es una función de `Personal`. Una persona puede ser docente y prefecta sin duplicarse.
- `Personal` pertenece a la escuela, no al ciclo: se reutiliza en todos los ciclos. Materias y asignaciones sí son por ciclo.
- `Sesion` guarda `grupoId` y `personalId` desnormalizados para consultar rápido los choques del docente; al cambiar el docente de una asignación se actualizan sus sesiones en la misma transacción.
- **Datos personales mínimos**: no se guardan CURP, RFC, teléfonos ni domicilios.

## Entidades de la Fase 3 (versión 3 del esquema)
| Tabla | Campos | Índices |
|---|---|---|
| `actividades` | escuelaId, cicloEscolarId, tipo (servicio/otra), personalId?, grupoId?, periodoId?, dia, horaInicio, horaFin, descripcion, confirmada, confirmadaEn? | `id`, `cicloEscolarId`, `personalId`, `grupoId` |
| `excepciones` | escuelaId, cicloEscolarId, personalId, dia, horaInicio, horaFin, motivo | `id`, `cicloEscolarId`, `personalId` |
| `confirmaciones` | escuelaId, cicloEscolarId, grupoId | `id`, `&grupoId` (único), `cicloEscolarId` |
| `bitacora` | escuelaId, cicloEscolarId, entidad, entidadId, accion (confirmar/reabrir/importar), motivo?, detalle? | `id`, `cicloEscolarId`, `entidadId` |

- Una actividad es **del docente** (personalId, horario libre) o **del grupo** (grupoId + periodoId, sólo «otra»).
- La confirmación es una tabla aparte (no un campo del grupo) para no alterar registros de la Fase 1.
- La bitácora registra las autorizaciones (reabrir, quitar confirmación) con su motivo: base para la auditoría de la versión institucional.

## Entidades de la Fase 4 (versión 4 del esquema)
| Tabla | Campos | Índices |
|---|---|---|
| `alumnos` | escuelaId, cicloEscolarId, grupoId, nombre, primerApellido, segundoApellido?, activo | `id`, `grupoId`, `cicloEscolarId`, `escuelaId` |
| `pases` | escuelaId, cicloEscolarId, grupoId, sesionId, asignacionId, personalId?, fecha, horaInicio, horaFin (copia), guardadoEn | `id`, `&[sesionId+fecha]` (único), `grupoId`, `personalId`, `cicloEscolarId` |
| `asistencias` | paseId, grupoId, alumnoId, fecha, marca (P/F/R), horaLlegada? | `id`, `paseId`, `alumnoId`, `grupoId` |
| `salidas` | grupoId, alumnoId, sesionId, fecha, salida (HH:MM), regreso? | `id`, `alumnoId`, `grupoId`, `sesionId`, `cicloEscolarId` |
| `reportes` | grupoId, alumnoId, personalId?, sesionId?, fecha, tipo, texto (≤ 280) | `id`, `alumnoId`, `grupoId`, `cicloEscolarId` |
| `ajustes` | id = clave (p. ej. `perfil-docente`), valor | `id` |

- Alumnos por grupo y ciclo (cambian de grupo cada año). Datos mínimos: sin CURP, fecha de nacimiento ni contacto.
- El pase guarda copia de la hora y la asignación para que el historial no dependa de cambios posteriores del horario.
- Un pase sólo existe si se guardó: abrir la lista no crea registros.

## Fase 2 · Catálogos (versión 6 del esquema)
| Tabla | Campos | Índices |
|---|---|---|
| `alumnos` (**identidad**) | escuelaId, nombre, primerApellido, segundoApellido?, matricula?, curp?, observaciones? | `id`, `escuelaId` |
| `inscripciones` | escuelaId, cicloEscolarId, alumnoId, turnoId?, gradoId?, grupoId?, estado (inscrito/baja), numeroLista? | `id`, `alumnoId`, `cicloEscolarId`, `grupoId`, `escuelaId`, `&[alumnoId+cicloEscolarId]` (una por ciclo) |
| `movimientos` | escuelaId, cicloEscolarId, alumnoId, inscripcionId, tipo (alta/cambio_grupo/baja/reactivacion/migracion), grupoAnteriorId?, grupoNuevoId?, motivo? | `id`, `alumnoId`, `cicloEscolarId` |
| `adscripciones` | escuelaId, cicloEscolarId, personalId, turnoIds[], materiaIds[] (materias que **puede** impartir) | `id`, `personalId`, `cicloEscolarId`, `&[personalId+cicloEscolarId]` |
| `importaciones` | escuelaId, cicloEscolarId, tipo, archivo, hoja?, huella (SHA-256)?, resultado {nuevos, actualizados, omitidos} | `id`, `escuelaId`, `cicloEscolarId` |

Campos nuevos en tablas existentes: `personal.observaciones`; `materias.tipo` (materia, campo_formativo, taller, tutoria, actividad_especial, servicio) y `materias.activo`.

- **Identidad separada de inscripción**: el alumno es una sola persona en la escuela; grado, grupo, turno, estado y número de lista son de su inscripción en cada ciclo. Cambiar de grupo actualiza la inscripción y agrega un `movimiento`; nunca crea otra persona. Las asistencias, salidas y reportes conservan su `grupoId` original.
- Matrícula y CURP (opcionales) son únicas por escuela; el nombre **no** identifica a nadie (homónimos posibles).
- **Docentes** no es una tabla: es el personal con función `docente`. Funciones vigentes: docente, prefectura, dirección, subdirección académica, subdirección de gestión, orientación, trabajo social, UDEI, secretaría, asistencia escolar, biblioteca, otro. Las funciones anteriores (`directivo`, `administrativo`, `apoyo`) se conservan tal cual en registros existentes: no se convierten porque no hay forma segura de saber a cuál corresponden.
- Materias de tipo `servicio` (horas SE) no se asignan a grupos.

## Fase 3 · Horarios (versión 7 del esquema)
Modelo relacional de horarios (todo con `escuelaId` y `cicloEscolarId`):

| Concepto | Dónde vive |
|---|---|
| Escuela, ciclo, turno | `escuelas`, `ciclosEscolares`, `turnos` |
| Días de la semana | `jornadas.dias` (1 = lunes … 7 = domingo), por turno |
| Periodo | `periodos` (de la jornada del turno; recesos en `recesos`) |
| Grupo, docente, materia | `grupos`, `personal` (función docente), `materias` |
| Asignación de clase | `asignaciones` (grupo + materia + docente + horas por semana) |
| Clase en el horario | `sesiones` (asignación + día + periodo; `grupoId` y `personalId` desnormalizados, mantenidos en la misma transacción) |
| SE y otras actividades | `actividades` (`tipo` servicio/otra; del docente con `periodoId` opcional, o del grupo con periodo) |
| Tipo de actividad | CLASE (sesión), SERVICIO / OTRA ACTIVIDAD (actividad), RECESO (receso del turno), SIN ACTIVIDAD REGISTRADA (ausencia de registro: **no se guarda**) |
| Estado de validación | derivado: confirmaciones de grupo, `actividades.confirmada`, revisión de conflictos |
| Origen del registro | `sesiones.origen`, `actividades.origen`: `manual` · `importacion` · `null` (anterior a v7) |

Versión 7: sin cambios de índices; agrega `origen` (null en registros existentes). `importaciones.tipo` admite `horarios`.

## Fase 4 · Módulo docente (versión 8 del esquema)
| Tabla / campo | Descripción | Índices |
|---|---|---|
| `cambiosAsistencia` (nueva) | escuelaId, cicloEscolarId, paseId, grupoId, alumnoId, marcaAnterior, marcaNueva, llegadaAnterior, llegadaNueva, personalId (docente del dispositivo; no es autenticación) | `id`, `paseId`, `alumnoId`, `cicloEscolarId` |
| `pases.correcciones` | veces que se corrigió tras el primer guardado (0 = GUARDADA, > 0 = MODIFICADA). Primer guardado = `creadoEn`; último = `guardadoEn` | — |
| `salidas.personalId`, `salidas.periodoId` | docente que registró la salida y periodo de la clase | — |
| `reportes.hora`, `reportes.estado` | hora de la incidencia (`null` en registros anteriores: no se inventa) y `abierta` / `atendida` | — |

- El estado de la lista (NO INICIADA / EN CAPTURA / GUARDADA / MODIFICADA) se deriva: no se guarda. EN CAPTURA sólo existe en pantalla (marcas sin guardar).
- La actividad actual (CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD, SIN ACTIVIDAD REGISTRADA, FUERA DE JORNADA) se calcula al momento desde el horario (`domain/actividadActual.ts`); no se guarda.

## Fase 6 · Plantillas de importación (versión 9 del esquema)
| Tabla | Campos | Índices |
|---|---|---|
| `plantillasImportacion` | escuelaId, nombre, tipo (alumnos, docentes, personal, materias, grupos, horarios), estructura (automatica, lista, sabana_grupo, sabana_docente), columnas [{encabezado normalizado, campo}], umbralConfianza | `id`, `escuelaId` |

## Fase 7 · Prefectura (versión 10 del esquema)
| Tabla | Campos | Índices |
|---|---|---|
| `incidenciasPersonal` | escuelaId, cicloEscolarId, personalId, fecha, tipo (falta, retardo, permiso, salida_anticipada, otra), tipoOtro, alcance (jornada / periodos), periodoIds, observaciones, estado (reportada, confirmada, descartada), registradaPor, validadaPor, validadaEn, motivoValidacion | `id`, `cicloEscolarId`, `personalId`, `fecha`, `escuelaId` |
| `coberturas` | escuelaId, cicloEscolarId, sesionId, fecha, grupoId, periodoId, docenteAusenteId, incidenciaId, propuestoIds, asignadoId, actividadId, actividadTexto, autorizadoPor (texto), autorizadoEn, estado (sin_docente, propuesta, asignada, realizada, no_realizada, cancelada), observaciones | `id`, `cicloEscolarId`, `fecha`, `&[sesionId+fecha]` (una por clase y fecha), `asignadoId`, `escuelaId` |
| `bancoActividades` | escuelaId, cicloEscolarId, materiaId, gradoId, titulo, descripcion, archivo (≤ 1 MB en base64, viaja en respaldos), fecha, responsable, estado (propuesta, validada, retirada) | `id`, `cicloEscolarId`, `escuelaId` |
| `bitacoraPrefectura` | escuelaId, cicloEscolarId, entidad (incidencia, cobertura, actividad), entidadId, accion, detalle, personalId, orden (creciente; desempata acciones del mismo milisegundo) | `id`, `cicloEscolarId`, `entidadId`, `escuelaId` |

- El **estado de cada clase** en una fecha se deriva (no se guarda) de horario, asignaciones, incidencias, coberturas y listas.
- `registradaPor`, `validadaPor` y `personalId` son el docente configurado en el dispositivo: **no es autenticación**.

## Entidades previstas (fases posteriores)
 Asistencia, Incidencia, SalidaAula, Cobertura. Todas con `escuelaId` y `cicloEscolarId` cuando corresponda.

## Versionado y migraciones
| Versión | Fecha | Cambios |
|---|---|---|
| 1 | 2026-11-02 | Esquema inicial de la Fase 1. |
| 10 | 2026-11-03 | Agrega `incidenciasPersonal`, `coberturas`, `bancoActividades`, `bitacoraPrefectura` (sólo tablas nuevas). Probada v9 → v10. |
| 9 | 2026-11-03 | Agrega `plantillasImportacion` (sólo tabla nueva; sin `upgrade`). Probada v8 → v9 con datos. |
| 8 | 2026-11-03 | Agrega `cambiosAsistencia`. `upgrade()`: salidas → `personalId` y `periodoId` desde su clase; reportes → `hora: null`, `estado: 'abierta'`; pases → `correcciones: 0`. Probada v7 → v8; los respaldos anteriores se restauran con esos mismos valores. |
| 7 | 2026-11-03 | Sin cambios de índices. `upgrade()` agrega `origen: null` a `sesiones` y `actividades` (no se inventa un origen que no se guardó). Probada v6 → v7; los respaldos de esquema 6 se restauran con `origen: null`. |
| 6 | 2026-11-03 | Agrega `inscripciones`, `movimientos`, `adscripciones`, `importaciones`; `alumnos` pasa a índice `escuelaId`. `upgrade()`: por cada alumno anterior crea su inscripción (turno y grado tomados del grupo; estado según `activo`) y un movimiento `migracion`, y deja en `alumnos` sólo la identidad; personal → `observaciones: null`; materias → `tipo: 'materia'`, `activo: true`. Nada se borra. Probada v5 → v6 con asistencias. Los respaldos con esquema < 6 se convierten igual al restaurar (después de verificar la huella). |
| 5 | 2026-11-03 | Sin cambios de índices. `upgrade()` completa en registros existentes: escuelas → campos del plantel en `null`; grupos → `activo: true`. Probada con datos v1 → v5. Los respaldos de esquemas anteriores se aceptan (los campos faltantes toman esos mismos valores). |
| 4 | 2026-11-03 | Agrega `alumnos`, `pases`, `asistencias`, `salidas`, `reportes`, `ajustes`. Sin cambios en tablas anteriores; migración v1 → v4 probada. |
| 3 | 2026-11-03 | Agrega `actividades`, `excepciones`, `confirmaciones`, `bitacora`. Sin cambios en tablas anteriores; la prueba de migración v1 → v3 conserva los datos. |
| 2 | 2026-11-03 | Agrega `personal`, `materias`, `asignaciones`, `sesiones`. Sin cambios en tablas v1; prueba de migración con datos en `tests/unit/fase2.test.ts`. |

Procedimiento:
1. No modificar `this.version(1)`. Agregar `this.version(2).stores({...})` sólo con las tablas/índices nuevos o cambiados.
2. Si los datos deben transformarse, usar `.upgrade(async (tx) => …)` conservando toda la información.
3. Nunca borrar tablas ni datos para "arreglar" el esquema.
4. Agregar una prueba que abra la versión anterior con datos y verifique la migración.
5. Registrar el cambio en esta tabla.
