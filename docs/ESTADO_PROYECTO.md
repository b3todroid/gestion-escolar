# Estado del proyecto

**Última actualización:** 2026-11-03 · **Fase:** 4 — Módulo docente (completada) + **Respaldo y restauración** (completado, pendiente de revisión con el usuario)

## Respaldo y restauración (2026-11-03)
- Descargar respaldo por escuela o de todas (JSON con huella SHA-256); fecha del último respaldo y recordatorio (en Escuelas y en «Mi día») si hay cambios sin respaldar con más de 7 días o nunca.
- Restaurar con revisión previa: validación Zod de cada registro, referencias internas, huella, versión de esquema; por escuela «Se agregará» / «Reemplazará» / «No se puede» con conteos actuales vs. respaldo. Nada cambia hasta confirmar.
- Reemplazar descarga antes una copia automática de los datos actuales; todo o nada.
- **Defecto grave detectado y corregido antes de entregar:** calcular la huella dentro de la transacción hacía que IndexedDB la cerrara antes de tiempo; en un reemplazo fallido los datos actuales quedaban borrados. Ahora la verificación se hace fuera de la transacción y una prueba simula una falla a mitad del reemplazo (los datos originales quedan intactos).
- Verificación: `npm test` **96** pruebas (7 nuevas); `npm run test:e2e` **33** pruebas (3 nuevas: descargar, restaurar en navegador vacío, reemplazar con copia previa, archivo alterado), estables en repetición.

## Hecho en Fase 4
- Esquema v4 (sólo tablas nuevas): alumnos, pases, asistencias, salidas, reportes, ajustes.
- «Mi día»: fecha y hora en vivo, actividad actual, grupo, materia, siguiente actividad, pasar lista con un toque, pendientes, agenda y grupos.
- Pase de lista P/F/R optimizado para teléfono, con barra fija de guardado y conteo en vivo.
- Salidas al baño, reincorporación, reportes breves, resumen e historial por alumno.
- Reglas contra estados contradictorios en el servicio (no sólo en la interfaz).

### Verificación Fase 4 (ejecutada el 2026-11-03)
- `npm test`: 10 archivos, **89 pruebas** (12 nuevas: lote de alumnos, pase sin escribir al abrir, F/R con resto presente, corrección sin duplicar, fechas inválidas, F ⇄ salida, salidas dobles, reincorporación inválida, baja con alumno fuera, reportes, resumen, panel, persistencia).
- `npm run test:e2e`: **30 pruebas** (4 nuevas, con reloj simulado en hora de la Ciudad de México), estables en ejecuciones repetidas.
- Durante la fase sólo fallaron pruebas mal escritas (nombres, selectores ambiguos y una expectativa sobre la siguiente actividad); no se detectaron defectos de la aplicación en el módulo nuevo. Se hizo más robusta la auditoría de IndexedDB ante tablas nuevas.

## Hecho en Fase 3
- Esquema v3 (sólo tablas nuevas): actividades, casos especiales, confirmaciones, bitácora.
- Vistas semanales por grupo y por docente con los cinco tipos de bloque y leyenda.
- Horas de servicio y otras actividades del docente, con confirmación; «otra actividad» en periodos de grupo.
- Casos especiales para clases simultáneas autorizadas.
- Confirmación de horarios de grupo con reapertura autorizada (motivo en bitácora).
- Importación desde Excel/CSV con revisión previa por fila y aplicación todo o nada.

### Defectos encontrados y corregidos durante la Fase 3
1. **Choques entre ciclos** (venía de la Fase 2): las clases de un ciclo cerrado bloqueaban al docente en el ciclo nuevo. Ahora se filtra por ciclo.
2. **Toques perdidos en el asistente**: la vista previa cambiaba de tamaño al salir del campo y movía «Siguiente» bajo el dedo. Ahora se actualiza mientras se escribe.
3. **Estilos de la Fase 3 no aplicados** por un ancla de inserción inexistente (detectado por las pruebas en teléfono: la página se desbordaba y el diálogo quedaba fuera de pantalla).
4. **Texto encimado con el botón** en el editor por día a 320 px.
5. **Enlace al docente** estaba sobre el nombre de la materia; ahora está sobre el nombre del docente.
6. **Mensaje de choque no determinista** cuando había varios: ahora se informa el más temprano.
7. El formulario de actividades se cerraba tras cada alta (incoherente con el resto); ahora sigue abierto.

### Verificación Fase 3 (ejecutada el 2026-11-03)
- `npm run typecheck`: sin errores. `npm test`: 9 archivos, **77 pruebas** (13 nuevas: lector de Excel con archivos reales, tipos de bloque, casos especiales, servicio, confirmaciones, importación con conflictos intencionales, regresión entre ciclos).
- `npm run test:e2e`: **26 pruebas** (4 nuevas), estables en ejecuciones repetidas; incluye cierre y reapertura real del navegador con perfil en disco.
- `npm run build`: correcto. `npm audit --omit=dev`: 0 vulnerabilidades.

## Hecho en Fase 2
- Esquema v2 (sólo tablas nuevas) con prueba de migración desde v1 con datos.
- Personal por escuela con funciones, baja/reactivación y datos mínimos.
- Materias por ciclo, individuales o por lote.
- Asignaciones por grupo (materia, docente o pendiente, horas por semana).
- Horario semanal por grupo y día con detección de choques de docente por hora real, límite de horas y disponibilidad visible antes de elegir.
- Semana de cada docente.
- Reglas de la Fase 1 extendidas para proteger el horario (periodos, días, grupos, turnos).

### Defectos encontrados y corregidos durante la Fase 2
1. Métodos de servicio que lanzaban la validación de forma síncrona en lugar de rechazar la promesa (venía de la Fase 1; no se notaba en la interfaz). Ahora todos son `async`.
2. Los avisos se apilaban al trabajar rápido y cubrían la pantalla. Ahora se muestra sólo el más reciente.

### Verificación Fase 2 (ejecutada el 2026-11-03)
- `npm run typecheck`: sin errores. `npm test`: 7 archivos, **64 pruebas** aprobadas (13 nuevas de Fase 2, incluida la migración).
- `npm run test:e2e`: **22 pruebas** aprobadas (3 nuevas de Fase 2), estables en dos ejecuciones seguidas; fallan ante cualquier error de consola.
- `npm run build`: correcto.

## Hecho en Fase 1
- Asistente guiado de 6 pasos con generación de periodos, recesos y grupos, vista previa proporcional de la jornada («regla») y borrador recuperable.
- Identidad visual propia (pizarrón, tiza, lápiz) con tipografía de alta legibilidad y modo oscuro.
- Proyecto Vite + TypeScript estricto; arquitectura por capas.
- IndexedDB con Dexie (esquema v1), repositorios con interfaz, unidad de trabajo transaccional.
- Validación Zod; reglas de negocio puras.
- Pantallas: escuelas, alta/edición de escuela, ciclos, turnos y jornadas, periodos y recesos, grados y grupos.
- Avisos accesibles, diálogo de confirmación, errores por campo, indicador "Guardando…", indicador de conexión.
- PWA: manifest, iconos, Service Worker con precache (funciona sin conexión tras la primera carga), aviso de actualización.
- Solicitud de almacenamiento persistente y panel informativo del almacenamiento.

## Verificación (ejecutada el 2026-11-02)
- `npm run typecheck`: sin errores.
- `npm test`: 6 archivos, 51 pruebas (incluye formato CCT, generadores, asistente atómico) — validación, reglas, tiempo/traslapes, duplicados, persistencia (cerrar y reabrir BD), atomicidad, aislamiento entre escuelas/ciclos.
- `npm run test:e2e` (Chromium, perfil Pixel 7): 19 pruebas (6 funcionales + 13 de auditoría) — asistente completo con cierre y reapertura del navegador, flujo manual con recarga, errores por campo, texto no interpretado como HTML, confirmación de borrado, funcionamiento sin conexión.
- `npm run build`: correcto (≈ 70 KB JS gzip).

## Auditoría de la Fase 1 (2026-11-02)

Batería permanente nueva: `tests/e2e/auditoria.spec.ts` (10 pruebas) y `tests/e2e/navegacion.spec.ts` (3). La auditoría falla si aparece **cualquier error en consola**.

| Punto revisado | Resultado | Cómo se comprobó |
|---|---|---|
| Botones | ✓ | Se pulsaron todos: Siguiente/Atrás/Cambiar/Guardar/Descartar del asistente; Editar, Cancelar, Activar, Cerrar y Eliminar de ciclos, turnos, grados, grupos, periodos y recesos; enlaces de navegación. |
| Validación de formularios | ✓ | CCT, fechas, horas, jornada, plantilla de módulos, grados; errores junto a cada campo. |
| Guardado en IndexedDB | ✓ | Lectura directa de IndexedDB (no de la interfaz): conteos exactos por tabla. |
| Persistencia al recargar / reabrir | ✓ | Recarga y nuevo contexto de navegador con el almacenamiento guardado. |
| Edición de escuela, ciclo, turno, periodo, receso, grado y grupo | ✓ | Cada edición verificada en pantalla y tras recargar. |
| Grupos duplicados accidentales | ✓ | Doble clic en «Guardar escuela» y doble envío de «Agregar grupo»: sin duplicados. Renombrar a un grupo existente: rechazado. |
| Periodos superpuestos | ✓ | Al agregar, al editar y fuera de la jornada. |
| Uso en teléfono | ✓ tras corrección | Sin desplazamiento horizontal a 320 y 375 px; todos los controles ≥ 44 px. |
| Errores en consola | ✓ | Ninguno en las 13 pruebas de auditoría. |
| Sin pérdida al navegar | ✓ tras corrección | Asistente conserva borrador (Atrás, Inicio, botón del navegador, recarga). |

### Defectos encontrados y corregidos
1. **Los avisos bloqueaban toques** (comprobado: 49 clics reintentados en una sola prueba). Aparecían abajo, sobre los botones de acción y la barra del asistente, durante 4–8 s. → Ahora aparecen arriba, bajo la barra, y dejan pasar los toques (sólo «×» es tocable). `src/styles/main.css`.
2. **Se perdía lo escrito al navegar** desde un formulario a medio llenar (comprobado con prueba). → Diálogo «Tienes cambios sin guardar» (Seguir editando / Salir sin guardar) y aviso nativo al recargar o cerrar. Se excluye el asistente, que guarda borrador. `src/app.ts`, `src/components/formulario.ts`.

Las 3 fallas iniciales de la batería nueva eran errores de las pruebas, no de la app (selector ambiguo; un receso alargado que la app rechazó correctamente por traslape; texto de insignia con símbolo).

## Pendiente / siguientes pasos
- Fase 4, pendientes conocidos:
  - No hay alerta automática si un alumno lleva mucho tiempo fuera del aula (se muestra el tiempo).
  - No hay límite de alumnos fuera a la vez (política de cada escuela).
  - Sin reportes de asistencia por periodo (semana/mes) ni exportación.
  - El perfil de docente no es seguridad: con la versión institucional se requerirán cuentas reales.
- Fase 3, pendientes conocidos:
  - Exportar/imprimir horarios (PDF o Excel) — requiere decidir biblioteca de generación.
  - La importación no crea asignaciones con docente distinto al ya registrado ni reemplaza celdas (por diseño); para cambios masivos hay que limpiar primero.
  - La tabla semanal del grupo en teléfono se desplaza a lo ancho dentro de su recuadro; para editar en teléfono se usa «Editar por día».
  - Sin carga horaria máxima por docente.
- Fase 2, pendientes conocidos:
  - El horario se arma día por día; falta una vista semanal completa (tabla) para pantallas grandes e impresión.
  - No hay «copiar el horario de un día a otro» ni asignar una materia a varios grupos a la vez.
  - El asistente de la Fase 1 no incluye materias ni docentes; se capturan después.
  - Sin control de horas máximas por docente (carga laboral).
- Menores detectados en la auditoría (no corregidos para no cambiar funciones sin necesidad):
  - Pulsar «Editar» en un elemento reemplaza el formulario de alta del mismo panel sin preguntar; se pierde lo escrito en ese alta.
  - El aviso de éxito cubre el título de la página unos segundos (no bloquea toques).
  - El asistente crea un solo turno y el mismo número de grupos por grado; las variaciones se ajustan después en pantalla.
- Pruebas automatizadas sólo en Chromium (perfil Pixel 7); falta Firefox y Safari/iOS.
- Respaldos, pendientes conocidos: el respaldo no se cifra (es un archivo con datos personales; la persona debe guardarlo en lugar seguro); no hay respaldo automático programado (el navegador no permite escribir archivos sin acción del usuario).
1. Reportes de asistencia por periodo (semana/mes) y exportación/impresión de listas y horarios.
2. Revisión de accesibilidad con lector de pantalla real (NVDA/TalkBack/VoiceOver).
3. Pruebas e2e en Firefox y WebKit.

## Riesgos
- Pérdida de datos si se borran los datos del navegador y no hay respaldo reciente (mitigado: respaldos con recordatorio).
- El archivo de respaldo contiene datos personales sin cifrar.
- Sin autenticación: cualquiera con acceso al dispositivo puede ver/modificar.
