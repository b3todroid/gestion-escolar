# Reglas de negocio (Fase 1)

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
