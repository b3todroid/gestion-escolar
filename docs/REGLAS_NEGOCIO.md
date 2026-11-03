# Reglas de negocio (Fases 1 a 4)

Implementación: reglas puras en `src/domain/reglas.ts` y `src/domain/tiempo.ts`; aplicación en `src/services/*`. Pruebas en `tests/unit/`.

## Generales
- Comparación de duplicados **normalizada**: sin acentos, sin distinguir mayúsculas, espacios colapsados (`"Matutíno "` = `"matutino"`).
- Textos recortados; se rechazan caracteres de control; longitudes máximas por campo.
- Horas en formato 24 h `HH:MM`. Fechas `AAAA-MM-DD`.
- Operaciones compuestas son atómicas (todo o nada).
- Ninguna eliminación ocurre sin confirmación explícita en la interfaz.

## Escuela (datos del plantel)
- En el asistente y en «Editar datos escolares»: nombre oficial (3–150), CCT, nivel, entidad federativa y municipio/alcaldía **obligatorios**; nombre corto, zona, sector, domicilio, teléfono, correo y logotipo opcionales.
- La CCT valida formato (10 caracteres) y que sus dos primeros dígitos coincidan con la clave de la entidad elegida. **No se afirma que la escuela exista oficialmente.** Al escribir la CCT se sugiere la entidad.
- Teléfono: 10 dígitos (se aceptan espacios, guiones, paréntesis y +52). Correo: formato válido, en minúsculas.
- Logotipo: sólo PNG, JPG o WebP (nunca SVG); se reduce a 256 px y se guarda como PNG en el dispositivo.

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
- En el asistente pueden generarse (módulos + recesos) o editarse uno por uno (nombre, inicio, fin; agregar/quitar). Se exige al menos un periodo y el bloque en conflicto se marca en su lugar.
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
- Sin límite práctico: grados 1–99 y hasta 99 grupos por grado; después de la Z siguen AA, AB…
- Asistente: generación rápida o personalizada; grados y nombres de grado sin repetir; grupos sin repetir dentro del grado (normalizado); cada grado con al menos un grupo.
- **Desactivar grupo**: se conserva con su historial y deja de recibir materias, clases, alumnos y actividades; sólo si no tiene alumnos activos ni materias asignadas. Se puede reactivar.
- «Agregar varios grupos» (grado + turno + «D, E, F»): todo o nada, sin duplicados.
- Número de grado entero 1–99, único por ciclo; nombre único por ciclo.
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
- Se registran explícitamente (día, periodo o inicio/fin, descripción). Pertenecen a un docente y no requieren grupo.
- **Por omisión se registran confirmadas** (casilla «Registrar como confirmada»; queda en bitácora). Se pueden registrar por confirmar y confirmar después con «Confirmar».
- Ligadas a un periodo: toman su horario; si el periodo cambia de hora, la SE se ajusta (y se valida que no choque). No se elimina un periodo con SE u otras actividades.
- Datos listos para consultas futuras de Prefectura: docente, día, periodo, horario, confirmada y fecha de confirmación.
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
- Desde «Importar información» (tipo Horarios): encabezados equivalentes y mapeo editable; el grupo puede venir como «1A»/«1° A»; el periodo por número («3», «3°», «Periodo 3»), nombre u hora de inicio. Si periodo y hora no coinciden, ERROR (no se adivina). Se registra el origen (archivo, hoja, huella) y se avisa al reimportar el mismo archivo.

## Módulo Horarios (Fase 3 · 2026-11)
- Selección escuela → ciclo → turno → grupo o docente (`#/horarios`, `#/ciclo/ID/horarios`). Una edición sólo afecta a su escuela y ciclo.
- **Una sola fuente**: los horarios por grupo y por docente se derivan de las mismas asignaciones, clases y actividades. La única copia desnormalizada (`sesiones.personalId`) se actualiza en la misma transacción al cambiar el docente; si alguna vez no coincide, la revisión lo informa como «dato inconsistente».
- **Estado de validación** de cada bloque (derivado, no guardado): Confirmado (horario de grupo confirmado o SE confirmada), Sin confirmar, Con conflicto.
- **Origen** de cada clase y actividad: manual, importación, o «registro anterior» (null) para lo capturado antes del esquema 7.
- Dejar libre un periodo y reemplazar una clase piden confirmación.
- **Conflictos pendientes** (revisión de sólo lectura, nunca corrige por su cuenta): docente en dos lugares a la vez; incompatibilidad entre turnos (choque en hora real entre turnos o periodo de otro turno); grupo con dos cosas en el mismo periodo; periodo, materia o docente inexistente (o docente dado de baja / sin función docente); fuera de jornada (día no laborable u horario fuera de la jornada); asignación duplicada o con más clases que horas asignadas; dato inconsistente. La captura y la importación impiden crearlos; la revisión cubre datos anteriores o restaurados.
- Reportes: horas asignadas y en el horario por grupo, periodos sin información, horas por docente (clases, grupos, materias), SE confirmadas y por confirmar, conflictos. Vistas imprimibles (`@media print`).
- Importación PDF: sólo preparada (`domain/importacion/fuentes.ts`); lo ambiguo o poco confiable se deja vacío y produce error, nunca una suposición.

# Fase 4

## Perfil del dispositivo
- «Este dispositivo es de…» es una preferencia local; no autentica ni restringe. Si la persona se da de baja, el perfil deja de aplicarse.

## Mi día
- Actividad actual: el bloque de hoy que contiene la hora actual (si hay clases simultáneas por caso especial, se prioriza la clase).
- Siguiente: el próximo bloque registrado de hoy (no «sin actividad»); si no hay, el primero de los días siguientes.
- Listas pendientes: clases de hoy ya iniciadas sin pase guardado.

## Pase de lista
- Todos los alumnos activos aparecen como **P** por omisión; se marcan sólo F y R.
- **Abrir la lista no guarda nada.** Al guardar se crea un pase por clase y fecha con la marca de cada alumno activo.
- Sólo en el día de la semana de la clase, dentro del ciclo y no en fechas futuras; el ciclo cerrado no admite registros.
- R puede llevar hora de llegada, que no puede ser antes del inicio de la clase.
- Corregir una lista guardada pide confirmación y actualiza las marcas (no duplica).
- Salir de la pantalla con marcas sin guardar pide confirmación.

## Salidas del aula
- Se registran al momento con la hora; la reincorporación también.
- **Un alumno con falta en la clase no puede salir**, y a quien salió en la clase (aunque ya regresó) no se le puede poner falta.
- Un alumno no puede tener dos salidas abiertas; la reincorporación no puede ser antes de la salida ni repetirse.
- No se da de baja a un alumno mientras está fuera del aula. Una salida registrada por error se puede anular (con confirmación).

## Alumnos y reportes
- Alta individual o por lote («Apellidos, Nombre(s)»), todo o nada; sin duplicados (normalizado) en el grupo; orden por apellidos.
- Baja conserva historial; sólo se elimina sin registros. No se elimina un grupo con alumnos ni una materia con listas registradas.
- Reporte breve: tipo (conducta, académico, reconocimiento, otro) y texto de 3 a 280 caracteres; no a alumnos dados de baja.

## Módulo docente (Fase 4 · segunda etapa, 2026-11)
- **Actividad actual**: según fecha, hora local, jornada, periodos, recesos y horario del docente (clases, SE y otras actividades). Estados: CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD, SIN ACTIVIDAD REGISTRADA (hueco dentro de la jornada: **no** es tiempo libre ni servicio), FUERA DE JORNADA (antes del inicio, después del fin, o día sin jornada). Límites exactos: cada bloque es [inicio, fin); a las 07:50 ya empezó el bloque de las 07:50. Con clases simultáneas autorizadas se muestra la clase.
- La pantalla principal muestra fecha, hora, escuela, turno (el del grupo actual o los del día), ciclo, actividad actual, grupo, materia, siguiente actividad, siguiente clase y acceso al pase de lista; también los alumnos fuera del aula en sus grupos.
- **Pase de lista**: estados NO INICIADA (sin pase), EN CAPTURA (marcas sin guardar en pantalla), GUARDADA, MODIFICADA (corregida después de guardar). Abrir no guarda; al guardar se registra fecha y hora (primer guardado y último). Un solo pase por clase y fecha; guardar sólo toca las asistencias de ese pase.
- **Correcciones**: cada cambio de marca (o de hora de llegada) queda en `cambiosAsistencia` con la marca anterior y la nueva, la fecha y hora y el docente del dispositivo; guardar sin cambios se rechaza.
- **R** = presente con retardo: no cuenta como falta.
- **Salidas**: alumno, grupo, docente, fecha, hora de salida (automática), hora de regreso (automática, nunca antes de la salida) y periodo. Se guardan al momento y se conservan al cambiar de pantalla. No se inicia una salida si el alumno tiene falta guardada en esa clase.
- **Conflicto falta ↔ salida**: marcar F a quien salió en esa clase abre un diálogo con resolución explícita: registrar su regreso (no queda falta) o anular la salida por haberse registrado por error (entonces sí queda F). Cancelar no cambia nada. El servicio rechaza siempre la contradicción.
- **Incidencias**: alumno, tipo, descripción (≤ 280), fecha, hora, docente, grupo y estado (abierta / atendida). `documentoIncidencias()` prepara los datos para un PDF en una fase posterior (no se genera PDF).
- Búsqueda rápida en la lista (más de 4 alumnos), botones ≥ 44 px, confirmación visible al guardar.

# Fase 7 — Prefectura

## Incidencias del personal
- Docente o trabajador, fecha, toda la jornada o periodos afectados, tipo (falta, retardo, permiso, salida anticipada u **otra** con nombre libre que queda como sugerencia para la escuela), observaciones.
- Se registran **REPORTADAS**. Sólo cuentan como hecho cuando alguien las **CONFIRMA**; se pueden **DESCARTAR** con motivo. Una confirmada o descartada no se vuelve a validar.
- **Nunca** se registra una falta automáticamente (p. ej. porque el docente no abrió la aplicación o no pasó lista).
- No se duplica la misma incidencia (persona, fecha, tipo y periodos) mientras no esté descartada.

## Estado de cada clase en una fecha (derivado)
Se cruzan horario oficial, asignaciones, incidencias, coberturas y listas registradas:
1. COBERTURA REALIZADA / COBERTURA ASIGNADA — si existe esa cobertura.
2. GRUPO SIN DOCENTE CONFIRMADO — clase sin docente asignado en el horario; falta, permiso o salida anticipada **confirmada** que afecta el periodo; o Prefectura confirmó en sitio («Confirmar: el grupo está sin docente», con descripción); o la cobertura no se realizó.
3. POSIBLE GRUPO SIN DOCENTE — incidencia **reportada** sin confirmar; retardo u «otra» confirmada (afecta parte del periodo); docente dado de baja.
4. ATENDIDA — hay lista de asistencia registrada.
5. SIN INFORMACIÓN SUFICIENTE — ninguna de las anteriores. **No** se presenta como problema.
Las incidencias se aplican por periodo (o por hora real si el periodo es de otro turno). El panel filtra por turno; nada se mezcla entre escuelas ni ciclos.

## Horas de servicio y coberturas
- Se listan las SE **confirmadas** del día de la semana, con su estado (disponible según registro, ausente por incidencia confirmada, cubriendo otro grupo).
- **Tener SE no autoriza automáticamente a cubrir.** La aplicación sugiere candidatos (primero SE compatible; después docentes que ese día tienen clases pero no en ese periodo, marcados «sin SE: requiere acuerdo») y **nunca asigna sola**.
- Incompatibilidades (se rechaza proponer o asignar): persona de otra escuela o dada de baja; el docente ausente; incidencia confirmada que afecta ese horario; clase propia a la misma hora real; otra actividad a esa hora; otra cobertura asignada o realizada a esa hora.
- Flujo: (confirmar sin docente) → **propuesta** (sugerencia) → **asignada** (requiere «Autorizó»: autoridad o responsable según la organización de cada escuela, con fecha y hora) → **realizada** / **no realizada** (motivo) / **cancelada** (motivo). Una realizada no se cancela.
- Una cobertura por clase y fecha. Todo cambio queda en el **historial de Prefectura** con quién lo registró (docente del dispositivo).

## Banco de actividades
- Materia, grado, título, descripción, fecha, responsable y adjunto opcional (PDF, imagen, texto, Word o Excel; ≤ 1 MB).
- Se registran como **PROPUESTA**; sólo las **VALIDADAS** se ofrecen y pueden asociarse a una cobertura. Retirar conserva el registro.

## Reportes
- Día, semana, mes o intervalo (≤ 93 días); filtros por grupo, docente, tipo de incidencia, estado de cobertura y turno.
- **Indicadores sólo con registros validados**: incidencias confirmadas (por tipo), clases sin docente confirmadas, coberturas realizadas, porcentaje cubierto. Lo reportado sin confirmar y los «posibles» se muestran aparte y no entran en los cálculos.
- Vista imprimible («Imprimir o guardar como PDF» del navegador) y datos en JSON. No se genera PDF propio.
