# Pruebas multidispositivo — Gestión Escolar (Fase 12)

## Advertencia principal
**Ninguna prueba se hizo en un dispositivo FÍSICO.** Todo es **EMULACIÓN en Chromium** (tamaño de pantalla, densidad, toque y agente de usuario de Playwright). El entorno no tiene WebKit/Safari: **el perfil «iPhone» NO prueba Safari**, sólo el diseño a ese tamaño. Por eso **no se afirma compatibilidad con iPhone/iPad ni con Safari**, ni con un Android o Windows real.

## Qué se probó (`tests/despliegue/dispositivos.spec.ts`, contra `https://localhost:8443`)
| Perfil emulado | HTTPS / contexto seguro | Service Worker activo | Instalable (Chromium, `Page.getInstallabilityErrors`) | Sin desbordes y objetivos ≥ 44 px (5 pantallas) | Reabre sin conexión |
|---|---|---|---|---|---|
| Android — Pixel 7 | ✓ | ✓ | ✓ sin errores | ✓ | ✓ |
| Tableta Android — Galaxy Tab S4 | ✓ | ✓ | ✓ sin errores | ✓ | ✓ |
| iPhone 13 — **sólo tamaño, en Chromium** | ✓ | ✓ (de Chromium) | no aplica a iOS | ✓ | ✓ (de Chromium) |
| Windows / escritorio — Desktop Chrome | ✓ | ✓ | ✓ sin errores | ✓ | ✓ |

Pantallas revisadas: inicio, cuenta, aplicación, respaldos y asistente. Además, el manifiesto declara `display: standalone`, íconos de 192 y 512 px y hay `apple-touch-icon`.

Otras pruebas con perfiles emulados contra la preproducción:
- Multiusuario (Pixel 7, Desktop Chrome, Galaxy Tab S4): `PRUEBAS_MULTIUSUARIO.md`.
- Flujo funcional completo (Pixel 7): `FASE_12_PREPRODUCCION.md` §5.
- Fases anteriores: `npm run test:ux` (13 pantallas × 3 tamaños) y `test:piloto` (3 dispositivos emulados).

## Estado por plataforma
| Plataforma | Estado |
|---|---|
| Android (teléfono) | **Emulado en Chromium: ✓.** Físico: **NO PROBADO** |
| Tableta Android | **Emulado: ✓.** Física: **NO PROBADA** |
| iPhone / iPad (Safari) | **NO PROBADO.** Sólo el tamaño de pantalla en Chromium. Riesgos conocidos de iOS que hay que revisar en un equipo real: instalación desde «Compartir → Agregar a inicio», cuota y desalojo del almacenamiento (IndexedDB) si la app no se usa, comportamiento del Service Worker y del modo sin conexión |
| Windows (Chrome / Edge) | **Chromium de Linux con perfil de escritorio: ✓.** Windows real, Edge y Firefox: **NO PROBADOS** |

## Protocolo para la prueba FÍSICA (requiere la preproducción institucional con dominio y certificado público)
Con un certificado interno (`TLS=internal`) los teléfonos no confían en el sitio y **la PWA no se puede instalar**: por eso la prueba física necesita la preproducción institucional (`FASE_12_PREPRODUCCION.md` §9) o instalar a mano la autoridad de Caddy en cada equipo de prueba (no recomendado).

Para cada equipo (Android, iPhone, tableta, Windows), con una cuenta ficticia `*.piloto@ejemplo.test` y DEMO-001:
1. Abrir la URL → candado válido; instalar la app (Android: «Instalar»; iPhone: Safari → Compartir → «Agregar a inicio»).
2. Entrar con el código recibido por correo → «Usar en este dispositivo».
3. Abrir «Mi día», abrir una lista, marcar F y R, guardar → «✓ Sincronizado» en ≤ 1 min.
4. Modo avión → reabrir la app desde el ícono → la lista y el horario se ven; registrar una salida → «por enviar».
5. Quitar el modo avión → se envía sola; comprobar en otro equipo (Prefectura) que llegó una sola vez.
6. Girar la pantalla; revisar que no haya texto cortado ni botones pequeños.
7. Cerrar la app 1 día y volver: los datos siguen (sobre todo en iPhone).
8. Registrar: modelo, sistema y versión, navegador, resultado de cada paso y capturas. Ese registro es la única base para afirmar compatibilidad.
