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

## Entidades previstas (fases posteriores)
Personal, Docente, Alumno, Materia, Asignación, Horario, Asistencia, Incidencia, SalidaAula, Cobertura. Todas con `escuelaId` y `cicloEscolarId` cuando corresponda.

## Versionado y migraciones
| Versión | Fecha | Cambios |
|---|---|---|
| 1 | 2026-11-02 | Esquema inicial de la Fase 1. |

Procedimiento:
1. No modificar `this.version(1)`. Agregar `this.version(2).stores({...})` sólo con las tablas/índices nuevos o cambiados.
2. Si los datos deben transformarse, usar `.upgrade(async (tx) => …)` conservando toda la información.
3. Nunca borrar tablas ni datos para "arreglar" el esquema.
4. Agregar una prueba que abra la versión anterior con datos y verifique la migración.
5. Registrar el cambio en esta tabla.
