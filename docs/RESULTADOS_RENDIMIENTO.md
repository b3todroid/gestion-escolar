# Resultados de rendimiento — piloto Fase 10

**Todos los números son mediciones reales**, de una sola ejecución de `npm run test:piloto:rendimiento` (`tests/piloto/rendimiento.spec.ts`) el 2026-11-04. Ninguno es una estimación.

## Entorno y condiciones
| Concepto | Valor |
|---|---|
| Equipo | Contenedor de desarrollo en la nube: 4 vCPU Intel Xeon a 2,10 GHz y 15 GB de RAM |
| Navegador | Chromium 1243, controlado por Playwright 1.63, sin interfaz gráfica; Node 22.23 |
| Perfil «escritorio» | Chromium de escritorio, 1280 × 720 |
| Perfil «android-lento» | **Emulación** de Pixel 7 (412 px, táctil) con la CPU **4 veces más lenta** (`Emulation.setCPUThrottlingRate`). **No es un teléfono físico** |
| Aplicación | Versión compilada (`npm run build`) con Service Worker, servida en el mismo equipo |
| Datos | DEMO-001 generada con `piloto/datos.ts` y 3 semanas de asistencia, cargada con «Restaurar» en un navegador vacío |
| Método | Tiempo de reloj desde la acción hasta que la pantalla muestra el resultado. Cada pantalla se mide partiendo de una página ligera |

| Escala | Archivo | Alumnos | Grupos | Trabajadores | Marcas de asistencia |
|---|---|---|---|---|---|
| 0.1 | 8,3 MB | 200 | 4 | 24 | 18 000 |
| 0.5 | 33,0 MB | 800 | 16 | 50 | 72 000 |
| 1 (pedida por el piloto) | 61,8 MB | 1 500 | 30 | 100 | 135 000 |

## Resultados
| Medición | Escritorio 0.1 | Escritorio 0.5 | Escritorio 1 | Android lento 0.1 | Android lento 0.5 | Android lento 1 |
|---|---|---|---|---|---|---|
| Leer y validar el archivo (Zod, referencias, huella) | 416 ms | 1,1 s | 2,0 s | 1,6 s | 4,3 s | 7,6 s |
| Cargar DEMO-001 en el dispositivo (restaurar) | 2,5 s | 8,5 s | 16,9 s | 4,1 s | 13,4 s | 25,5 s |
| Abrir pantalla de inicio | 13 ms | 11 ms | 11 ms | 82 ms | 87 ms | 54 ms |
| Abrir panel de la escuela | 37 ms | 42 ms | 102 ms | 127 ms | 209 ms | 227 ms |
| Lista de alumnos del ciclo (todos) | 202 ms | 811 ms | 885 ms | 887 ms | 2,5 s | 3,5 s |
| Buscar alumno por matrícula | 97 ms | 212 ms | 316 ms | 398 ms | 1,5 s | 2,0 s |
| Abrir horario de grupo | 112 ms | 199 ms | 197 ms | 368 ms | 942 ms | 959 ms |
| Abrir horario de docente | 92 ms | 203 ms | 302 ms | 407 ms | 957 ms | 1,4 s |
| Revisión de conflictos del ciclo | 8 ms | 10 ms | 10 ms | 14 ms | 17 ms | 23 ms |
| **Abrir pase de lista** | **60 ms** | **63 ms** | **66 ms** | **272 ms** | **329 ms** | **483 ms** |
| **Guardar asistencia (50 alumnos)** | **211 ms** | **237 ms** | **231 ms** | **672 ms** | **705 ms** | **651 ms** |
| Asistencia del grupo (3 semanas) | 105 ms | 214 ms | 212 ms | 396 ms | 410 ms | 442 ms |
| Prefectura: panel del día | 97 ms | 113 ms | 209 ms | 259 ms | 329 ms | 940 ms |
| Prefectura: reporte de 30 días | 148 ms | 201 ms | 290 ms | 338 ms | 878 ms | 1,5 s |
| Importar alumnos (CSV): analizar | 281 ms (200) | 655 ms (300) | 1,1 s (300) | 1,1 s (200) | 3,2 s (300) | 5,0 s (300) |
| Importar alumnos (CSV): guardar | 2,3 s (200) | 3,5 s (300) | 3,8 s (300) | 8,0 s (200) | 16,3 s (300) | 17,2 s (300) |
| Memoria JavaScript al final (JSHeapUsedSize)* | 32,9 MB | 109,8 MB | 99,7 MB | 27,7 MB | 16,7 MB | 13,3 MB |
| Almacenamiento usado (IndexedDB y caché de la app) | 25,3 MB | 91,5 MB | 168,5 MB | 25,3 MB | 91,5 MB | 168,5 MB |

\* Es una lectura puntual al terminar, no el pico: depende de cuándo pasó el recolector de basura. Sirve para ver que no hay fugas grandes, no para dimensionar equipos.

## Corrección hecha durante la medición (INC-07)
En la primera ejecución:
- «Abrir pase de lista» tardó **3,1 s** a escala 0.5 en escritorio.
- A escala 1 no terminó dentro del límite de 5 s de la prueba.

La causa: el recordatorio de respaldo de Inicio y Mi día recorría en segundo plano todos los registros de la escuela, y competía por la CPU con la pantalla siguiente. Tras la corrección (`debeRecordar`), la misma pantalla tarda 60–66 ms en escritorio y 272–483 ms en el teléfono lento, sin depender del volumen.

Otras referencias:
- **Multiusuario** (`test:piloto:multiusuario`): con conexión, una lista guardada llega al servidor en segundos tras la corrección INC-05. El caso completo PIL-MU-01 bajó de 35 s a 14 s, incluidos inicio de sesión y descarga de la escuela.
- **Escuela de la Fase 9** (3 turnos y 157 500 marcas, `npm run test:rendimiento`): 18,1 s para guardar 1 500 alumnos importados y 22 s para restaurar. Ver `docs/AUDITORIA_FASE_9.md` §5.

## Lectura de los resultados
- **Tareas de la jornada** (abrir y guardar la lista, horario, panel de Prefectura): menos de 1 s incluso en el teléfono emulado lento y a escala completa. El tiempo de abrir y guardar la lista **no crece con el volumen**.
- **Tareas administrativas poco frecuentes:**
  - restaurar: 17–26 s;
  - importar 300 alumnos: hasta 17 s en el teléfono lento;
  - lista completa de 1 500 alumnos: 3,5 s en el teléfono lento.

  Son aceptables para operaciones masivas que se hacen pocas veces y conviene hacerlas en computadora. Se clasifican **BAJO**.
- **Búsqueda en 1 500 alumnos en el teléfono lento: 2,0 s.** Notable, pero no bloquea. Queda como mejora (BAJO).
- **Almacenamiento:** 168,5 MB a escala completa con 3 semanas de asistencia. Un ciclo completo (~40 semanas) crecería de forma aproximadamente lineal. Hay que verificar el espacio y el almacenamiento persistente en los dispositivos reales.

## Lo que NO se midió
- **Teléfonos y tabletas físicos**, incluidos los de gama baja. La emulación con CPU lenta no reproduce la memoria limitada ni el almacenamiento lento.
- **iPhone / Safari**: no hay WebKit en este entorno.
- **El servidor con volumen** (RLS por fila y muchas personas a la vez). Sólo se probó con 2 a 4 dispositivos simultáneos y DEMO-001 a escala 0.1.
- **Red móvil real** (latencia, cortes intermitentes). Sólo se simuló sin conexión.
