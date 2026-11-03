# Importaciones

Hay dos importadores independientes:

| Pantalla | Ruta | Qué importa | Servicio |
|---|---|---|---|
| Importar horarios (Fase 3) | `#/ciclo/ID/importar` | Clases del horario | `services/importacion.ts` (todo o nada) |
| **Importar información** | `#/ciclo/ID/importar-datos` | Alumnos, docentes, personal, materias, grupos y **horarios**, desde .xlsx, .csv o **.pdf** (con OCR local) | `services/importacionDatos.ts`; horarios: `ServicioImportacion.analizarMapeado/aplicarMapeado` |

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

- **Horarios** (Fase 3): una fila por clase. Campos: Grado (opcional si el grupo viene como «1A» o «1° A»), Grupo, Turno (sólo si hay ambigüedad), Día, Periodo (número, nombre u hora «07:50» / «07:50-08:40») **o** Hora de inicio, Materia (nombre o abreviatura), Docente (nombre completo o identificador; vacío = pendiente). Sinónimos: «Gpo», «Día de la semana», «Módulo», «Asignatura», «Profesor»… Estados: NUEVA, YA EXISTE (se omite), ERROR, CONFLICTO. **Todo o nada**: con cualquier error o conflicto no se guarda nada (un horario a medias sería engañoso). Nunca reemplaza celdas ocupadas ni toca horarios confirmados. Las clases importadas quedan con `origen: 'importacion'` y la importación en `importaciones` (tipo `horarios`).

## PDF y OCR (Fase 6)
Flujo: **seleccionar archivo → analizar (páginas) → identificar estructura → corregir → mapear → validar → previsualizar → confirmar → guardar**. Cancelar en cualquier paso no modifica nada.

1. **PDF.js** (cargado sólo al abrir un PDF) lee página por página con barra de progreso y botón Cancelar. Límites: 20 MB y 40 páginas. PDF protegido con contraseña o dañado → mensaje claro. No se ejecuta JavaScript del documento (`isEvalSupported: false`, sin scripting).
2. Si la página **tiene texto digital**, se usan sus fragmentos con posición. Si **no** tiene (escaneado o foto), se ofrece **OCR local** con Tesseract.js (máximo 10 páginas por documento, cancelable). El motor y el idioma español se sirven desde la propia aplicación (`ocr/`); nada sale del dispositivo. La primera vez se descargan ~6 MB desde la app y quedan guardados para usarse sin conexión.
3. **Reconstrucción de la tabla** (`domain/importacion/documento.ts`): renglones por posición vertical; columnas a partir de la fila de encabezados reconocible (días, Hora, Grupo, Materia, Docente…); la segunda línea de una celda se une a su fila. Sin encabezados reconocibles se deducen columnas por posición y se avisa.
4. **Estructura** detectada (la persona puede cambiarla):
   - **Una fila por clase** (lista) → pasa al mapeo de columnas como Excel/CSV.
   - **Horario de un grupo** (días en columnas; celdas «Materia / Docente»): el grupo se toma del título («Horario del grupo 1° A») o lo elige la persona.
   - **Horario de un docente** (celdas «1° B Matemáticas»): el docente se toma del título («Docente: …») o lo elige la persona.
   Las celdas se separan por renglones o separadores explícitos (` - `, ` / `, ` | `); sin separador, sólo si exactamente una materia del catálogo coincide al inicio. Si no, la celda queda **por revisar**.
5. **Corrección manual**: la tabla reconocida se muestra editable (cada celda; «Quitar fila» para ruido o filas que no son clases). Las celdas de OCR con confianza menor al umbral (75 % por omisión) se marcan **inciertas** con su porcentaje; mientras no se corrijan o se confirmen explícitamente («Marcar inciertas como revisadas»), **no se convierten en registros** (quedan vacías y la fila sale como ERROR).
6. Celdas **vacías** se ignoran: **nunca** son horas SE. «RECESO» se ignora. Celdas «SE/Servicio» no se importan (las horas SE se registran en el horario del docente).
7. Las filas resultantes (GRUPO + DÍA + PERIODO + MATERIA + DOCENTE, más «Celda de origen» informativa) pasan por la **misma validación** que Excel/CSV: docentes desconocidos, grupos inexistentes, materias no registradas, periodos incompatibles, fuera de jornada, duplicados (ya existentes), conflictos y docentes simultáneos. Todo o nada; no reemplaza clases ni toca horarios confirmados.

### Qué funciona y qué requiere revisión
| Documento | Resultado |
|---|---|
| PDF digital generado por Excel, Word o un sistema (tabla con encabezados de días o columnas Grupo/Día/Periodo/Materia/Docente) | Automático; revisar y confirmar |
| PDF digital con celdas «Materia + Docente» en dos renglones o con separador | Automático |
| Celdas sin separador («Matemáticas Docente X») | Automático sólo si la materia está en el catálogo; si no, por revisar |
| Celdas combinadas que abarcan varios días o periodos, tablas rotadas, varias tablas por página | **Revisión manual** (la estructura puede no reconocerse) |
| PDF escaneado de buena calidad | OCR; **revisar siempre** las celdas inciertas y el título |
| Fotos inclinadas, sombras, letra manuscrita, baja resolución | OCR poco fiable: **captura manual** o plantilla de Excel |
| PDF protegido con contraseña, dañado, > 20 MB o > 40 páginas | Se rechaza con mensaje |

### Contrato para otras fuentes
`src/domain/importacion/fuentes.ts` (`ExtractorTabla`, `aTablaSegura`) sigue disponible: lo ambiguo queda vacío y se informa.

## Plantillas de reconocimiento (por escuela)
Tabla `plantillasImportacion` (esquema v9): nombre, tipo de importación, estructura (automática, lista, horario de grupo, horario de docente), columnas por **nombre de encabezado normalizado** → campo, y umbral de confianza OCR. Se elige en el paso 2 y se guarda desde el paso de columnas («Guardar como plantilla»). Como se basa en nombres de encabezado y no en posiciones, funciona aunque el orden de columnas cambie; no hay reglas fijas para una sola escuela. Se incluye en los respaldos.

## Plantillas
`public/plantilla-{alumnos,docentes,personal,materias,grupos,horarios}.xlsx` (hoja de datos con un ejemplo ficticio + hoja «Instrucciones»). Se generan con `python3 scripts/generar_plantillas_catalogos.py` (openpyxl), que también crea los archivos de prueba de `tests/fixtures/`.
