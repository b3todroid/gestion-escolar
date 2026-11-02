# Estado del proyecto

**Última actualización:** 2026-11-02 (auditoría de Fase 1) · **Fase:** 1 — Configuración escolar · **Estado:** completada

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
- Menores detectados en la auditoría (no corregidos para no cambiar funciones sin necesidad):
  - Pulsar «Editar» en un elemento reemplaza el formulario de alta del mismo panel sin preguntar; se pierde lo escrito en ese alta.
  - El aviso de éxito cubre el título de la página unos segundos (no bloquea toques).
  - El asistente crea un solo turno y el mismo número de grupos por grado; las variaciones se ajustan después en pantalla.
- Pruebas automatizadas sólo en Chromium (perfil Pixel 7); falta Firefox y Safari/iOS.
1. **Respaldo y restauración** (exportar/importar JSON validado con Zod). Prioridad alta: mitiga la pérdida de datos locales.
2. Fase 2: personal, docentes, materias, asignaciones, horarios.
3. Revisión de accesibilidad con lector de pantalla real (NVDA/TalkBack/VoiceOver).
4. Pruebas e2e en Firefox y WebKit.

## Riesgos
- Pérdida de datos si se borran los datos del navegador (sin respaldo todavía).
- Sin autenticación: cualquiera con acceso al dispositivo puede ver/modificar.
