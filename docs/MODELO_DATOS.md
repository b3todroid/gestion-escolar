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
| `escuelas` | nombre, cct?, nivel, localidad? | `id`, `cct` |
| `ciclosEscolares` | escuelaId, nombre, fechaInicio, fechaFin (AAAA-MM-DD), estado | `id`, `escuelaId`, `[escuelaId+estado]` |
| `turnos` | escuelaId, cicloEscolarId, nombre | `id`, `cicloEscolarId`, `escuelaId` |
| `jornadas` | escuelaId, cicloEscolarId, turnoId, horaInicio, horaFin (HH:MM), dias (1=lun…7=dom) | `id`, `&turnoId` (único), `cicloEscolarId` |
| `periodos` | escuelaId, cicloEscolarId, jornadaId, nombre, horaInicio, horaFin | `id`, `jornadaId`, `cicloEscolarId` |
| `recesos` | ídem periodos | `id`, `jornadaId`, `cicloEscolarId` |
| `grados` | escuelaId, cicloEscolarId, numero, nombre | `id`, `cicloEscolarId`, `[cicloEscolarId+numero]` |
| `grupos` | escuelaId, cicloEscolarId, gradoId, turnoId, nombre, capacidad? | `id`, `cicloEscolarId`, `gradoId`, `turnoId` |

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

## Entidades previstas (fases posteriores)
Alumno, Asistencia, Incidencia, SalidaAula, Cobertura. Todas con `escuelaId` y `cicloEscolarId` cuando corresponda.

## Versionado y migraciones
| Versión | Fecha | Cambios |
|---|---|---|
| 1 | 2026-11-02 | Esquema inicial de la Fase 1. |
| 3 | 2026-11-03 | Agrega `actividades`, `excepciones`, `confirmaciones`, `bitacora`. Sin cambios en tablas anteriores; la prueba de migración v1 → v3 conserva los datos. |
| 2 | 2026-11-03 | Agrega `personal`, `materias`, `asignaciones`, `sesiones`. Sin cambios en tablas v1; prueba de migración con datos en `tests/unit/fase2.test.ts`. |

Procedimiento:
1. No modificar `this.version(1)`. Agregar `this.version(2).stores({...})` sólo con las tablas/índices nuevos o cambiados.
2. Si los datos deben transformarse, usar `.upgrade(async (tx) => …)` conservando toda la información.
3. Nunca borrar tablas ni datos para "arreglar" el esquema.
4. Agregar una prueba que abra la versión anterior con datos y verifique la migración.
5. Registrar el cambio en esta tabla.
