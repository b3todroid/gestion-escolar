# Estado del proyecto

**Última actualización:** 2026-11-02 · **Fase:** 1 — Configuración escolar · **Estado:** completada

## Hecho en Fase 1
- Proyecto Vite + TypeScript estricto; arquitectura por capas.
- IndexedDB con Dexie (esquema v1), repositorios con interfaz, unidad de trabajo transaccional.
- Validación Zod; reglas de negocio puras.
- Pantallas: escuelas, alta/edición de escuela, ciclos, turnos y jornadas, periodos y recesos, grados y grupos.
- Avisos accesibles, diálogo de confirmación, errores por campo, indicador "Guardando…", indicador de conexión.
- PWA: manifest, iconos, Service Worker con precache (funciona sin conexión tras la primera carga), aviso de actualización.
- Solicitud de almacenamiento persistente y panel informativo del almacenamiento.

## Verificación (ejecutada el 2026-11-02)
- `npm run typecheck`: sin errores.
- `npm test`: 5 archivos, 41 pruebas — validación, reglas, tiempo/traslapes, duplicados, persistencia (cerrar y reabrir BD), atomicidad, aislamiento entre escuelas/ciclos.
- `npm run test:e2e` (Chromium, perfil Pixel 7): 5 pruebas — flujo completo con recarga, errores por campo, texto no interpretado como HTML, confirmación de borrado, funcionamiento sin conexión.
- `npm run build`: correcto (≈ 70 KB JS gzip).

## Pendiente / siguientes pasos
1. **Respaldo y restauración** (exportar/importar JSON validado con Zod). Prioridad alta: mitiga la pérdida de datos locales.
2. Fase 2: personal, docentes, materias, asignaciones, horarios.
3. Revisión de accesibilidad con lector de pantalla real (NVDA/TalkBack/VoiceOver).
4. Pruebas e2e en Firefox y WebKit.

## Riesgos
- Pérdida de datos si se borran los datos del navegador (sin respaldo todavía).
- Sin autenticación: cualquiera con acceso al dispositivo puede ver/modificar.
