# Importaciones

Hay dos importadores independientes:

| Pantalla | Ruta | Qué importa | Servicio |
|---|---|---|---|
| Importar horarios (Fase 3) | `#/ciclo/ID/importar` | Clases del horario | `services/importacion.ts` (todo o nada) |
| **Importar información** (Fase 2 catálogos) | `#/ciclo/ID/importar-datos` | Alumnos, docentes, personal, materias y grupos | `services/importacionDatos.ts` |

## Formatos
- **.xlsx**: lector propio (`domain/importacion/zip.ts` + `tabla.ts`), sin dependencias. Sólo lee valores; **no ejecuta macros ni fórmulas** (.xlsm/.xls no se aceptan). Libros con varias hojas: se elige la hoja. Los números de fila mostrados son los reales de la hoja.
- **.csv**: UTF-8 (con o sin BOM) y, si no es UTF-8 válido, Windows-1252. Separador `;` o `,` (se detecta). Comillas dobles, comillas escapadas (`""`) y saltos de línea dentro de un campo. Límite 5 MB y 3000 filas de datos.
- Nada se envía a servidores: el archivo se lee en el navegador.

## Flujo (Importar información)
1. Tipo de información.
2. Archivo (+ plantilla descargable del tipo).
3. Hoja (si hay varias).
4. **Fila de encabezados**: se detecta entre las primeras 10 (la que reconoce más campos, mínimo 2); se puede corregir. Las filas de título de arriba se ignoran.
5. **Correspondencia de columnas** sugerida con nombres equivalentes (`domain/importacion/mapeo.ts`: p. ej. «Apellido paterno» → primer apellido, «Gpo» → grupo, «No. lista» → número de lista, «Profesor» → nombre completo). Cada columna se puede reasignar o marcar «No importar». Se valida antes de analizar (campos obligatorios, sin campos repetidos).
6. **Análisis** (área temporal en memoria; no escribe nada). Cada fila queda como:
   - **NUEVO** — se creará.
   - **ACTUALIZABLE** — coincide por identificador fuerte (matrícula, CURP o identificador interno del personal; nombre exacto en materias; grado+grupo+turno en grupos) y hay datos que cambiar.
   - **POSIBLE DUPLICADO** — coincide sólo el nombre. Por omisión se **omite**; la persona puede elegir crear (homónimo) o actualizar. Nunca se fusiona automáticamente.
   - **CONFLICTO** — contradicción con datos existentes o con otra fila del mismo archivo (p. ej. matrícula repetida).
   - **ERROR** — dato inválido (grado/grupo/turno inexistente, función desconocida, CURP con formato inválido, nombre completo ambiguo…). No se guarda.
   - **OMITIDO** — ya existe igual; no hay nada que cambiar.
7. Totales (leídas, válidas, nuevas, actualizables, posibles duplicados, conflictos, errores, omitidas) y decisión por fila (crear / actualizar / omitir) donde hay opción.
8. **Cancelar** descarta todo (no se guarda nada). **Confirmar** vuelve a analizar dentro de **una transacción** y aplica sólo las decisiones confirmadas; si los datos cambiaron mientras tanto, no guarda nada y pide volver a analizar. Las filas con error o conflicto no se guardan; se informan en el resultado.
9. Se registra el origen en `importaciones` (archivo, hoja, fecha, tipo, huella SHA-256 y resultado). Si el mismo archivo (misma huella) ya se importó, se avisa antes de confirmar.

## Reglas por tipo
- **Alumnos**: nombre y primer apellido (o «Nombre completo» como «Apellidos, Nombre(s)» con uno o dos apellidos; en otro caso ERROR, no se adivina). Grado, grupo y turno deben existir; sin grupo → inscripción sin grupo. Número de lista 1–200. Matrícula y CURP opcionales y únicas. Al actualizar un alumno existente: completa datos vacíos, inscribe en el ciclo si no lo estaba, cambia de grupo registrando el movimiento («Importación»). No se importan datos médicos.
- **Docentes / Personal**: identificador interno único. Funciones por nombre o sinónimo (Docente, Profesor(a), Prefecto(a), Director(a)…); una desconocida es ERROR. En «Docentes» se agrega la función docente. Materias que puede impartir y turnos se guardan en la adscripción del ciclo (deben existir). No crea asignaciones a grupos.
- **Materias**: tipo por nombre (Materia, Campo formativo, Taller, Tutoría, Actividad especial, Servicio/SE); vacío = Materia.
- **Grupos**: grado y turno existentes (si hay un solo turno, puede omitirse). No crea grados ni turnos.

## Plantillas
`public/plantilla-{alumnos,docentes,personal,materias,grupos}.xlsx` (hoja de datos con un ejemplo ficticio + hoja «Instrucciones»). Se generan con `python3 scripts/generar_plantillas_catalogos.py` (openpyxl), que también crea los archivos de prueba de `tests/fixtures/`.
