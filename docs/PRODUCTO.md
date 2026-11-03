# Producto

## Propósito
Plataforma para escuelas de México, inicialmente de educación básica, configurable por nivel, plantel y turno. Principio: **un dato se captura una sola vez y se reutiliza** (las entidades se relacionan por identificador, nunca se vuelve a escribir un nombre).

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

## Fase 2 — Personal, materias y horarios (entregada)
- Personal por escuela (se registra una vez para todos los ciclos), con funciones: docente, directivo, administrativo, prefectura, apoyo educativo. Alta, edición, baja (conserva historial) y reactivación.
- Materias por ciclo, una por una o varias a la vez (una por renglón).
- Asignaciones por grupo: materia, docente (o «pendiente») y horas por semana.
- Horario semanal de cada grupo por día; al elegir la materia de cada hora se ve de antemano cuáles no se pueden y por qué.
- Semana de cada docente con todos sus grupos.

## Fase 3 — Horarios escolares (entregada)
- Horario semanal por grupo (tabla) y por docente (columnas por día), con cinco tipos visibles: **CLASE, SERVICIO, RECESO, OTRA ACTIVIDAD y SIN ACTIVIDAD REGISTRADA**.
- Horas de servicio y otras actividades del docente; el servicio se confirma explícitamente. Un espacio vacío nunca cuenta como servicio.
- «Otra actividad» en periodos de grupo (honores, ceremonias…).
- Casos especiales autorizados (con motivo) para que un docente atienda grupos simultáneos.
- Confirmación de horarios de grupo: bloqueados hasta reabrirlos con motivo registrado.
- Importación desde Excel (.xlsx) o CSV con revisión previa: errores y conflictos por fila; nada se guarda si hay alguno.

## Fases futuras (no implementadas)
| Fase | Contenido previsto |
|---|---|
| 2 | ✓ Personal, docentes, materias, asignaciones y horarios |
| 3 | ✓ Horarios escolares e importación de horarios desde Excel/CSV. Pendiente para otra fase: PDF (PDF.js) y OCR (Tesseract.js) |
| 4 | Alumnos, asistencia, incidencias, salidas del aula, coberturas, Prefectura |
| 5 | Reportes PDF (jsPDF o pdf-lib), respaldo y restauración |
| 6 | Versión institucional: backend, autenticación, permisos, sincronización, auditoría |

## Limitaciones conocidas
- Los datos viven **sólo en este navegador y dispositivo**. Se pierden si se borran los datos del sitio, se usa modo privado o se cambia de dispositivo. La app solicita almacenamiento persistente, pero el navegador decide.
- Aún no hay respaldo/restauración (previsto).
- La primera carga necesita conexión; después funciona sin ella. El modo sin conexión requiere HTTPS o `localhost`.
