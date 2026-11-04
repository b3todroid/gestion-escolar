# Pruebas multiusuario — Gestión Escolar (Fase 12)

Contra la preproducción local en contenedores (`https://localhost:8443`): Caddy con HTTPS, servidor Node, PostgreSQL con RLS y SMTP de prueba (Mailpit). Datos: DEMO-001 (escala 0.2, 2 semanas), cuentas ficticias `*.piloto@ejemplo.test`. Archivo: `tests/despliegue/multiusuario.spec.ts`.

**Independencia real:** cada persona usa un **CONTEXTO DE NAVEGADOR PROPIO** (cookies, IndexedDB y Service Worker separados) con otro perfil de dispositivo emulado. **No se usaron pestañas que comparten datos** como prueba de independencia. Cada inicio de sesión usa un código que llega **por SMTP** y se lee del buzón de prueba.

| Persona | Cuenta | Dispositivo emulado |
|---|---|---|
| Docente uno | `docente.uno.piloto@ejemplo.test` | Pixel 7 (teléfono) y, en MUP-04, un segundo equipo Desktop Chrome |
| Docente dos | `docente.dos.piloto@ejemplo.test` | Desktop Chrome (computadora) |
| Prefectura | `prefectura.piloto@ejemplo.test` | Galaxy Tab S4 (tableta) |

## Casos y resultado (2026-11-04: 5 de 5 ✓)
| Caso | Pasos del encargo | Qué se comprueba | Resultado |
|---|---|---|---|
| MUP-01 | 1, 2 | Dos docentes inician sesión en equipos distintos; cada una consulta su horario; cookies de sesión distintas | ✓ |
| MUP-02 | 3, 4, 5 | Las dos guardan su lista **al mismo tiempo**; cada una queda **una sola vez** en el servidor; Prefectura (tableta) ve ambas | ✓ |
| MUP-03 | 6, 7, 8 | Docente dos **sin red**: corrige la lista y registra una salida al baño; el indicador dice «por enviar» (nunca «Sincronizado»); al reconectar se envía sola; `correcciones` +1 y una salida más, **sin duplicados** | ✓ |
| MUP-04 | 9 | **Conflicto**: la docente uno cambia la MISMA lista en dos equipos sin red; el primero envía; el segundo recibe **«Conflicto»** en `#/sincronizacion` (no se sobrescribe en silencio); la persona elige «Usar la versión del servidor» y queda la marca del primero, con un solo pase | ✓ |
| MUP-05 | 10 | **Permisos**: cada docente ve en el servidor sólo inscripciones de grupos donde da clase (menos que toda la escuela); Prefectura ve los 6 grupos de la escuela; ni docente ni Prefectura pueden invitar (403/404); cerrar la sesión de la docente dos (y quitar sus datos del equipo) **no** afecta la de la docente uno | ✓ |

Hallazgo durante el diseño de MUP-05 (no es defecto): en DEMO-001 las dos docentes comparten grupos, así que la docente dos **sí** puede ver la lista de la docente uno de un grupo común (regla «g» de `PERMISOS.md`). La prueba comprueba la regla real: sólo grupos propios.

## Otras pruebas multiusuario vigentes
- `npm run test:servidor` — 129 pruebas, incluida la batería de aislamiento 2 escuelas × 6 roles × 30 tablas.
- `npm run test:piloto:multiusuario` — 3 casos con servidor real (Fase 10).
- `npm run test:despliegue` DEP-03/04/06/07 — sincronización, autorización, actualización y recuperación.

## Límites
- Todo en un mismo equipo y red local: no mide latencias de internet ni redes móviles reales.
- Máximo 4 navegadores a la vez; la concurrencia del servidor se midió aparte (50 peticiones simultáneas: `FASE_12_PREPRODUCCION.md` §7).
- Personas reales: no participaron.
