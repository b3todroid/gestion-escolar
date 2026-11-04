# Incidencias del piloto — Fase 10

Severidad: **CRÍTICO** (pérdida, corrupción o exposición de datos, o el sistema no sirve), **ALTO** (afecta una función esencial o la integridad), **MEDIO** (degrada el uso), **BAJO** (cosmético o menor).
Cada incidencia corregida tiene una prueba que la detecta, ejecutada después de la corrección.

## 1. Encontradas en la Fase 10
| ID | Severidad | Descripción | Cómo se detectó | Corrección | Estado | Prueba |
|---|---|---|---|---|---|---|
| INC-01 | BAJO | La prueba `flujo-integral.spec` falló una vez en la auditoría de entrada: navegaba antes de que quedara guardada la elección «Soy yo». En aislamiento pasó 6 de 6 veces. Defecto de la prueba, no de la app | Auditoría de entrada (suite completa) | La prueba espera la confirmación, igual que `docente.spec` | Corregida | `flujo-integral.spec` |
| INC-02 | MEDIO | La app exigía una CCT con formato oficial a TODA escuela: una escuela de demostración sólo podía existir inventando una clave con apariencia oficial, lo que el piloto prohíbe | Preparación de DEMO-001 | Marca explícita `demostracion` (esquema local v13, migración 0007): sin CCT, visible en toda la app, no se puede activar desde la interfaz y la base del servidor impide cambiarla | Corregida | `fase10-piloto.test`, `piloto.test`, PIL-ENT-01, PIL-CFG-01 |
| INC-03 | BAJO | Después de restaurar, la sección «Descargar un respaldo» de la misma pantalla sigue diciendo «No hay escuelas registradas» hasta cambiar de pantalla | PIL-RES-01 | — | **Abierta** (no impide nada: el informe de restauración ofrece «Ver escuelas») | — |
| INC-04 | **ALTO** | Pase de lista con sincronización: la pantalla reutilizaba un borrador en memoria hecho sobre datos que después cambiaron (lista recibida de otro dispositivo o conflicto resuelto). Mostraba marcas viejas como «EN CAPTURA», y al guardar habría **revertido sin aviso** el cambio de otra persona | PIL-MU-02 (2 dispositivos reales contra el servidor) | El borrador recuerda la huella de lo guardado sobre la que se hizo. Si lo guardado cambió, se descarta y se avisa; nunca en silencio | Corregida | PIL-MU-02 (fallaba antes; pasa después), `docente.spec` |
| INC-05 | MEDIO | Con conexión, una lista guardada esperaba hasta 30 s para enviarse al servidor (Prefectura la veía tarde) | PIL-MU-01 (35 s) | Si hay cambios por enviar y hay red, se envían en la siguiente revisión del indicador (≈5 s) | Corregida (MU-01: 35 s → 14 s, incluidos inicio de sesión y descarga) | PIL-MU-01, `e2e-servidor/sincronizacion.spec` |
| INC-06 | MEDIO | La pantalla de inicio calculaba el recordatorio de respaldo ANTES de pintarse (el mismo problema que la Fase 9 corrigió en «Mi día») | Revisión de código del piloto | Se pinta primero; el aviso aparece después | Corregida | `respaldos.spec` («tiene cambios sin respaldar») |
| INC-07 | MEDIO | El recordatorio de respaldo recorría TODOS los registros de la escuela (~165 000) en segundo plano cada vez que se abría Inicio o Mi día. Competía por la CPU con la pantalla siguiente: «Abrir pase de lista» tardó 3,1 s a escala 0.5 y más de 5 s a escala 1 en escritorio | `test:piloto:rendimiento` | `debeRecordar()`: misma regla, pero sólo recorre si el último respaldo es viejo, y se detiene en el primer cambio | Corregida (tiempos en `RESULTADOS_RENDIMIENTO.md`) | `fase10-piloto.test` (equivalencia con `estado()`), `test:piloto:rendimiento` |

## 1b. Encontradas en la Fase 11
| ID | Severidad | Descripción | Corrección | Estado | Prueba |
|---|---|---|---|---|---|
| INC-F11-01 | **ALTO** | Restaurar: una revisión que terminaba tarde (archivo anterior) reemplazaba la del archivo vigente; se podía confirmar un archivo tras ver la revisión de otro | Turno por archivo; sólo se restaura el archivo revisado | Corregida | PIL-RES-01 (3 de 6 → 6 de 6) |
| INC-F11-02 | **ALTO** (despliegue) | SMTP no implementado: producción imposible | `CorreoSmtp` (nodemailer) | Corregida | `fase11.test`, DEP-03 |
| INC-F11-03 | **ALTO** (despliegue) | Detrás de un proxy, todas las personas compartirían la IP del proxy (bloqueo general; sin freno al atacante) | `PROXIES_CONFIABLES` | Corregida | `fase11.test`, DEP-05 |
| INC-F11-04 | MEDIO | Textos de «Aplicación y datos» afirmaban que la cuenta no envía datos | Texto corregido | Corregida | `cuenta-local.spec` |

## 2. Pendientes de fases anteriores (siguen abiertas)
| ID | Severidad | Descripción | Estado |
|---|---|---|---|
| S4 | MEDIO | Base local única por dispositivo para todas las cuentas: los datos de una cuenta quedan visibles para quien use el mismo navegador mientras no se quiten (mitigado: al cerrar sesión se ofrece quitarlos) | Abierta — requisito del piloto multiusuario en dispositivos compartidos |
| S5 | BAJO | 10 vulnerabilidades en herramientas de desarrollo (0 en producción) | Abierta |
| S6 | BAJO | Better Auth tiene una versión posterior | Abierta — revisar antes del despliegue |
| U5 | BAJO | La pantalla de respaldos tarda ~2,5 s con volumen | Abierta |
| U6 | BAJO | El aviso emergente tapa el título unos segundos en teléfono | Abierta |

## 3. Bloqueos que requieren decisiones externas (no son defectos del código)
| ID | Bloqueo | Qué lo destraba | Responsable |
|---|---|---|---|
| B-01 | **No hay servidor desplegado**: el multiusuario y la sincronización funcionan y están probados sólo contra un servidor local | Autorización y contratación del hospedaje (D11), HTTPS, SMTP, respaldos del servidor, monitoreo | Escuela / operador |
| B-02 | **No se probó en dispositivos físicos** (Android y tableta sólo por emulación) | Ensayo con los teléfonos y tabletas reales de la escuela | Escuela + desarrollo |
| B-03 | **iPhone no probado**: en este entorno no hay dispositivo ni motor WebKit | Prueba en un iPhone real (Safari) | Escuela + desarrollo |
| B-04 | Aviso de privacidad y revisión jurídica (datos de menores) | Publicación por la escuela | Escuela / área jurídica |
| B-05 | Base local separada por persona (S4) en dispositivos compartidos | Decisión: dispositivos personales o implementar la separación | Escuela + desarrollo |
| B-06 | Servidor no medido con volumen (RLS por fila) | Ensayo en el servidor de prueba desplegado | Desarrollo |

No hay incidencias CRÍTICAS ni ALTAS abiertas en el código.
