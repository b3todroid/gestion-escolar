# Reglas de negocio (Fases 1, 2 y 3)

Implementación: reglas puras en `src/domain/reglas.ts` y `src/domain/tiempo.ts`; aplicación en `src/services/*`. Pruebas en `tests/unit/`.

## Generales
- Comparación de duplicados **normalizada**: sin acentos, sin distinguir mayúsculas, espacios colapsados (`"Matutíno "` = `"matutino"`).
- Textos recortados; se rechazan caracteres de control; longitudes máximas por campo.
- Horas en formato 24 h `HH:MM`. Fechas `AAAA-MM-DD`.
- Operaciones compuestas son atómicas (todo o nada).
- Ninguna eliminación ocurre sin confirmación explícita en la interfaz.

## Escuela
- Nombre 3–150 caracteres; nivel obligatorio; CCT opcional; si se captura debe cumplir el formato SEP: entidad 01–32, 3 letras, 4 dígitos y 1 letra verificadora (p. ej. `00AAA0000A`). Se ignoran espacios y guiones y se guarda en mayúsculas. Sólo se valida la estructura, no que la clave exista.
- Niveles: educación inicial, preescolar, primaria, secundaria, media superior, otro.
- No puede haber dos escuelas con el mismo CCT. Si no tienen CCT, no puede repetirse el nombre.
- Sólo se elimina si no tiene ciclos escolares.

## Ciclo escolar
- Nombre único por escuela; fecha de fin posterior a la de inicio.
- Los ciclos de una misma escuela no pueden traslaparse en fechas (fechas límite inclusivas).
- Estados: `planeacion → activo → cerrado`, o `planeacion → cerrado`. Un ciclo cerrado **no se reabre**.
- Sólo un ciclo **activo** por escuela.
- Un ciclo cerrado es de sólo lectura: no se crean/editan/eliminan turnos, bloques, grados ni grupos.
- Sólo se elimina si no tiene turnos ni grados.

## Turno y jornada
- Cada turno tiene exactamente una jornada (entrada, salida, ≥ 1 día). Salida posterior a entrada.
- Nombre de turno único por ciclo.
- No se puede reducir la jornada si deja periodos o recesos fuera; se informa cuáles.
- Al eliminar un turno se eliminan su jornada, periodos y recesos (previa confirmación que muestra cuántos). Se bloquea si tiene grupos asignados.

## Periodos y recesos
- Deben quedar completamente dentro de la jornada.
- No pueden traslaparse entre sí (periodos con periodos, ni con recesos). Bloques **contiguos** (uno termina 08:40 y otro inicia 08:40) sí se permiten.
- Duración mayor que cero.
- Se muestran ordenados por hora de inicio; el resumen calcula minutos de clase, receso y sin asignar.

## Asistente de configuración
- Pasos: escuela → ciclo → turno y días laborables → periodos y recesos → grados y grupos → revisar y guardar. Cada paso se valida antes de avanzar (la escuela, también contra duplicados).
- Periodos: N módulos de M minutos consecutivos desde la entrada; recesos intercalados «después del módulo k» (k < N, uno por posición, máx. 5). Si el último bloque termina después de la salida, se informa la hora exacta y no se avanza.
- Grados del X al Y (sugerencia: 6 en primaria, 3 en otros niveles; editable) con G grupos por grado nombrados A, B, C…, todos en el turno capturado.
- «Es el ciclo en curso» activa el ciclo al guardar.
- Todo se guarda en una sola transacción y con las mismas reglas que la edición manual.

## Grados y grupos
- Número de grado entero 1–12, único por ciclo; nombre único por ciclo.
- Un grado con grupos no se elimina.
- Un grupo pertenece a un grado y a un turno **del mismo ciclo** (no se mezclan ciclos ni escuelas).
- Nombre de grupo único por grado + turno (puede existir 1° A matutino y 1° A vespertino).
- Capacidad opcional, entero 1–80.

# Fase 2

## Personal
- Se registra por escuela; sirve para todos los ciclos.
- Nombre y primer apellido obligatorios; al menos una función.
- Número de empleado opcional y único por escuela. Sin número, no puede repetirse el nombre completo (normalizado).
- **Baja** en lugar de borrado: se conserva el historial. No se da de baja, ni se le quita la función docente, si tiene materias asignadas en ciclos no cerrados.
- Sólo se elimina a quien nunca tuvo asignaciones.

## Materias
- Por ciclo; nombre único y abreviatura única (si se captura).
- Alta por lote (una por renglón): todo o nada; se rechazan repetidas en la lista y las que ya existen.
- No se elimina una materia asignada a algún grupo.

## Asignaciones
- Una materia una sola vez por grupo; grupo y materia del mismo ciclo.
- Docente: activo, de la misma escuela y con función docente; puede quedar «pendiente».
- Horas por semana 1–40; no pueden bajar de las ya puestas en el horario.
- Al cambiar el docente se revisan choques en todas sus horas ya programadas.
- Al quitar una asignación se quitan también sus horas del horario (con confirmación que indica cuántas).

## Horario semanal (sesiones)
- Sólo en días laborables del turno del grupo y en periodos de ese turno (no en recesos).
- Una materia por celda; asignar sobre una celda ocupada la reemplaza.
- No se rebasan las horas semanales de la materia.
- **Un docente no puede tener dos clases que se traslapen en hora real**, aunque sean de turnos con periodos distintos.
- El diálogo de selección muestra de antemano qué materias no caben y por qué.

## Protección del horario frente a cambios de configuración
- No se elimina un periodo con clases, ni un grupo con materias asignadas.
- No se quita un día laborable del turno si hay clases ese día.
- No se cambia de turno un grupo con clases programadas.
- Si cambian las horas de un periodo, se verifica que ningún docente quede en dos grupos a la vez.
- No se elimina un ciclo con materias, ni una escuela con personal registrado.

# Fase 3

## Tipos de bloque
- CLASE (sesión programada), SERVICIO (registrado; «por confirmar» hasta confirmarlo), RECESO (del turno, si no hay otra actividad encima), OTRA ACTIVIDAD, SIN ACTIVIDAD REGISTRADA.
- **Un espacio vacío nunca significa servicio**: dentro de la jornada del docente se muestra como «sin actividad registrada» y se contabiliza aparte.
- En el docente, el rango del día es la jornada de los turnos donde da clases ese día.

## Choques
- Un docente no puede tener, **en el mismo ciclo**, dos bloques que se traslapen en hora real (clase–clase, clase–actividad, actividad–actividad).
- Excepción: dos o más **clases** simultáneas se permiten sólo si un **caso especial** (día + franja + motivo) cubre la franja. Nunca para servicio u otras actividades.
- No se quita un caso especial mientras haya clases simultáneas que dependan de él.
- Un grupo no puede tener dos cosas en el mismo periodo: clase u «otra actividad», no ambas.
- Cuando hay varios choques, se informa el más temprano.

## Horas de servicio
- Se registran explícitamente (día, inicio, fin, descripción). Se confirman con «Confirmar».
- Confirmadas: no se editan ni eliminan; primero hay que quitar la confirmación con motivo (≥ 5 caracteres), que queda en la bitácora.

## Horarios confirmados
- Requiere al menos una clase. Al confirmar se listan las materias con horas pendientes.
- Bloquea: programar o quitar clases, otras actividades del grupo, cambiar docente u horas de una asignación con clases, quitar la asignación, cambiar horas de periodos con clases del grupo, y la importación.
- Reabrir exige motivo y queda registrado.

## Importación de horarios (Excel/CSV)
- Una fila por clase: Grado, Grupo, Turno (opcional si no hay ambigüedad), Día, Inicio (hora de inicio del periodo), Materia (nombre o abreviatura), Docente (número de empleado o nombre; vacío = pendiente).
- No crea grupos, materias ni docentes (un dato se captura una vez).
- Errores por fila: datos faltantes, día u hora inválidos, grupo/materia/docente inexistente, día no laborable, periodo inexistente.
- Conflictos por fila: dos clases del mismo grupo en el mismo periodo dentro del archivo; docente simultáneo (en el archivo o contra la app); celda ya ocupada por otra clase u actividad; materia ya asignada con otro docente; horario confirmado.
- Filas idénticas a lo ya registrado se omiten (no se duplican).
- Antes de guardar se muestran los ajustes (materias que se asignarán, horas que aumentarán).
- **Todo o nada**: si hay cualquier error o conflicto no se guarda nada; al aplicar se vuelve a validar dentro de la transacción.
- Límites: 5 MB, 3 000 filas, 20 MB descomprimido; sólo la primera hoja; .xls (97-2003) no compatible.
