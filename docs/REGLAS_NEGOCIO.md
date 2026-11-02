# Reglas de negocio (Fase 1)

Implementación: reglas puras en `src/domain/reglas.ts` y `src/domain/tiempo.ts`; aplicación en `src/services/*`. Pruebas en `tests/unit/`.

## Generales
- Comparación de duplicados **normalizada**: sin acentos, sin distinguir mayúsculas, espacios colapsados (`"Matutíno "` = `"matutino"`).
- Textos recortados; se rechazan caracteres de control; longitudes máximas por campo.
- Horas en formato 24 h `HH:MM`. Fechas `AAAA-MM-DD`.
- Operaciones compuestas son atómicas (todo o nada).
- Ninguna eliminación ocurre sin confirmación explícita en la interfaz.

## Escuela
- Nombre 3–150 caracteres; nivel obligatorio; CCT opcional (5–20 letras/números/guiones, se guarda en mayúsculas).
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

## Grados y grupos
- Número de grado entero 1–12, único por ciclo; nombre único por ciclo.
- Un grado con grupos no se elimina.
- Un grupo pertenece a un grado y a un turno **del mismo ciclo** (no se mezclan ciclos ni escuelas).
- Nombre de grupo único por grado + turno (puede existir 1° A matutino y 1° A vespertino).
- Capacidad opcional, entero 1–80.
