# Producto

## Propósito
Aplicación web progresiva (PWA) para que el personal directivo configure y, en fases posteriores, opere la gestión diaria de una escuela, **desde el teléfono y sin depender de una conexión permanente**.

## Usuarios (Fase 1)
Una persona responsable de la configuración (dirección, subdirección o coordinación) usando su propio dispositivo. No hay cuentas ni permisos todavía.

## Fase 1 — Configuración escolar (entregada)
- Registrar, editar y eliminar escuelas (nombre, nivel, CCT opcional, localidad).
- Ciclos escolares por escuela con estados *En planeación → Activo → Cerrado*.
- Turnos con su jornada (entrada, salida, días de clase).
- Periodos de clase (módulos) y recesos por turno, con detección de traslapes.
- Grados y grupos por ciclo, asignando cada grupo a un turno.
- Persistencia local (IndexedDB) y funcionamiento sin conexión (Service Worker).

## Fases futuras (no implementadas)
| Fase | Contenido previsto |
|---|---|
| 2 | Personal, docentes, materias, asignaciones y horarios |
| 3 | Importación Excel (ExcelJS) y PDF (PDF.js), OCR (Tesseract.js) |
| 4 | Alumnos, asistencia, incidencias, salidas del aula, coberturas, Prefectura |
| 5 | Reportes PDF (jsPDF o pdf-lib), respaldo y restauración |
| 6 | Versión institucional: backend, autenticación, permisos, sincronización, auditoría |

## Limitaciones conocidas
- Los datos viven **sólo en este navegador y dispositivo**. Se pierden si se borran los datos del sitio, se usa modo privado o se cambia de dispositivo. La app solicita almacenamiento persistente, pero el navegador decide.
- Aún no hay respaldo/restauración (previsto).
- La primera carga necesita conexión; después funciona sin ella. El modo sin conexión requiere HTTPS o `localhost`.
