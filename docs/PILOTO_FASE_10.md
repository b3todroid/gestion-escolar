# Fase 10 — Prueba piloto integral y dictamen técnico

**Fecha:** 2026-11-04 · **Estado:** COMPLETADA (aprobada por el usuario el 2026-11-04) · **Condiciones:** escolares **simuladas**, con la escuela ficticia **ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001)**. No se publicó la aplicación, no se conectaron datos reales, no se contrató ningún servicio y no se borró ningún registro existente.

Documentos de esta fase:
- `docs/CASOS_PRUEBA_PILOTO.md`: casos con objetivo, preparación, pasos, esperado, observado, estado y evidencia.
- `docs/RESULTADOS_RENDIMIENTO.md`
- `docs/INCIDENCIAS_PILOTO.md`
- `docs/LISTA_VERIFICACION_DESPLIEGUE.md`

## 1. Resumen ejecutivo
Gestión Escolar Universal **funciona correctamente en condiciones escolares simuladas**. Se probaron:
- **En el dispositivo:** la jornada completa del docente, el flujo completo de Prefectura y las consultas de Dirección, en Android, tableta y escritorio **emulados**.
- **Con un servidor real local:** dos docentes pasando lista al mismo tiempo, conflictos resueltos de forma explícita y separación de escuelas.
- **Volumen y respaldos:** rendimiento con el volumen pedido (30 grupos, 100 trabajadores, 1 500 alumnos), respaldo y recuperación.

El piloto encontró **1 defecto ALTO** y **4 MEDIOS**. Todos se corrigieron y se volvieron a probar. No quedan defectos CRÍTICOS ni ALTOS en el código.

**Dictamen:**
- APTO PARA DEMOSTRACIÓN LOCAL.
- APTO PARA PILOTO CONTROLADO **con condiciones** (§9).
- **NO APTO TODAVÍA PARA PILOTO MULTIUSUARIO**: no hay servidor desplegado. El código multiusuario pasó todas sus pruebas, pero sólo en un entorno local.

## 2. Auditoría de entrada (antes de modificar código)
- **Documentos leídos:** CLAUDE.md, ESTADO_PROYECTO, AUDITORIA_FASE_9 y PLAN_PILOTO. Se revisó el repositorio.
- **Pruebas existentes ejecutadas (2026-11-03):**
  - 182 de 182 unitarias;
  - compilación correcta;
  - **58 de 59** funcionales: `flujo-integral.spec` falló una vez y pasó 6 de 6 en aislamiento; era un defecto de la prueba, INC-01, corregido;
  - 109 de 109 del servidor;
  - 4 de 4 con servidor real;
  - `npm audit --omit=dev` = 0.
- **Migraciones:** las huellas de 0001–0006 aplicadas en `gestion_demo` coinciden con los archivos.
- **Errores críticos o altos pendientes al entrar:** ninguno.
- **¿Existe backend multiusuario real?** Existe y funciona **sólo en un entorno local** (PostgreSQL en este equipo). **No hay ningún servidor desplegado.**

## 3. Entorno del piloto
- **Escuela:** ESCUELA DEMO GESTIÓN ESCOLAR, identificador **DEMO-001**.
  - **No tiene CCT:** no se inventó una clave oficial. Para eso se agregó la marca `demostracion` (esquema local v13, migración 0007).
  - **Configuración:**
    - ciclo «DEMO 2026-2027»;
    - turno **matutino** de 6 periodos de 50 min con receso de 20 min;
    - turno **vespertino** con periodos de 45 min, uno de 60 min y su receso;
    - 3 grados y grupos en ambos turnos;
    - horario completo **sin choques** y confirmado;
    - **SE** confirmadas (y algunas sin confirmar);
    - 3 semanas de asistencia con faltas, retardos y correcciones;
    - salidas al baño, reportes, incidencias del personal (confirmadas, reportadas y descartadas), coberturas autorizadas y realizadas, y banco de actividades.
- **Datos reproducibles:** `piloto/datos.ts`. Los identificadores son estables y la escala es configurable: escala 1 = 30 grupos, 100 trabajadores y 1 500 alumnos. Todos los nombres son ficticios («Demo», «Ejemplo», «Prueba»…).
- **Aislamiento:**
  - **Dispositivo:** el piloto se sirve en un origen propio (puerto 4180), con almacenamiento separado del de desarrollo; cada prueba usa un navegador vacío.
  - **Servidor:** base temporal que se borra al terminar, o una base `gestion_piloto*`.
- **Limpieza segura:**
  - **En el dispositivo:** «Quitar escuela de demostración» sólo existe y sólo actúa en escuelas de demostración no sincronizadas.
  - **En el servidor:** `npm run piloto -- servidor limpiar` se niega con cualquier base que no sea `gestion_piloto*`, o que contenga una sola escuela que no sea de demostración. La base de datos impide cambiar la marca.
  - Ambas cosas tienen prueba.
- **Perfiles:**
  - **Sin servidor:** perfiles de DEMOSTRACIÓN. El «docente de este dispositivo» es una preferencia y la interfaz lo dice; **no es un mecanismo de seguridad**.
  - **Con servidor:** cuentas de prueba con **permisos reales**: Administración, Dirección, Prefectura y dos docentes.

## 4. Pruebas ejecutadas (ejecución final)
Todas ejecutadas el 2026-11-04, en este orden, después de la última corrección de código:

| Suite | Comando | Resultado |
|---|---|---|
| Tipos, unitarias e integración, compilación | `npm run check` | **191 de 191** (20 archivos; 9 nuevas del piloto) y compilación correcta |
| Funcionales (versión compilada con Service Worker) | `npx playwright test` | **59 de 59** |
| Servidor (PostgreSQL 16 real) | `npm run test:servidor` | **114 de 114** (7 archivos; 5 nuevas del piloto) |
| Servidor real + navegador | `npm run test:e2e:servidor` | **4 de 4** |
| **Piloto local**, Android, tableta y escritorio emulados | `npm run test:piloto` | **33 de 33** (11 casos × 3) |
| **Piloto multiusuario**, servidor real y navegadores separados | `npm run test:piloto:multiusuario` | **3 de 3** |
| **Rendimiento del piloto**, 3 escalas × 2 perfiles | `npm run test:piloto:rendimiento` | **6 de 6** (tiempos en `RESULTADOS_RENDIMIENTO.md`) |
| Interfaz en 3 tamaños | `npm run test:ux` | **1 de 1** (39 revisiones) |
| Dependencias de producción | `npm audit --omit=dev` | **0** vulnerabilidades |
| Todas las dependencias | `npm audit` | 10 (2 bajas, 8 moderadas), sólo en herramientas de desarrollo (S5) |

**Pruebas pendientes:**
- dispositivos físicos (Android, tableta y iPhone);
- Safari y Firefox;
- red móvil real;
- servidor desplegado y con volumen;
- más de 4 dispositivos simultáneos;
- lector de pantalla.

## 5. Funciones probadas y resultados por módulo
Detalle caso por caso en `docs/CASOS_PRUEBA_PILOTO.md`.

| Módulo | Casos | Aprobados | Fallidos | Notas |
|---|---|---|---|---|
| Entorno del piloto | 7 | 7 | 0 | Generador reproducible, aislamiento y candados de limpieza |
| Configuración (7) | 10 | 10 | 0 | — |
| Catálogos (8) | 10 | 10 | 0 | — |
| Importación (9) | 13 | 13 | 0 | Excel, CSV, PDF digital y escaneado (OCR local) |
| Horarios (10) | 9 | 9 | 0 | Integridad entre vistas y choques por hora real |
| Docente (11) | 14 | 14 | 0 | Jornada completa con DEMO-001 |
| Prefectura y Dirección (12) | 10 | 10 | 0 | Nada se asigna sin autorización |
| Multiusuario (13) | 5 | 5 | 0 | Servidor **local**: 2 docentes simultáneos, conflicto, permisos y separación |
| Sin conexión (14) | 10 | 10 | 0 | Sin servidor nunca dice «Sincronizado» |
| Respaldos (15) | 8 | 8 | 0 | Incluye la interrupción a mitad de una restauración |
| Seguridad (17) | 11 | 11 | 0 | — |
| Experiencia de uso (18) | 7 | 6 | 0 | **iPhone no probado** (sin dispositivo ni WebKit) |
| **Total** | **114** | **113** | **0** | 1 no probado |

**Casos fallidos durante el piloto y corregidos:**
- **PIL-MU-02:** INC-04, ALTO.
- **PIL-MU-01:** lento, INC-05.
- **Rendimiento:** «Abrir pase de lista» 3,1 s, INC-07.
- **INC-01:** la prueba intermitente de la entrada.

Los demás ajustes fueron de las propias pruebas: selectores, y vista por día en teléfono en lugar de tabla. Están descritos en el historial de cambios.

## 6. Errores corregidos y pendientes
Ver `docs/INCIDENCIAS_PILOTO.md`.

**Corregidos:**
- INC-04 (**ALTO**): el borrador viejo de la lista podía revertir en silencio el cambio de otro dispositivo.
- INC-02 (MEDIO): escuela de demostración sin CCT.
- INC-05 (MEDIO): latencia de envío.
- INC-06 (MEDIO): inicio lento.
- INC-07 (MEDIO): recordatorio de respaldo que competía por la CPU.
- INC-01 (BAJO): prueba intermitente.

**Pendientes:**
- S4 (MEDIO): base local única por dispositivo.
- INC-03, U5, U6, S5 y S6 (BAJOS).
- Bloqueos externos B-01 a B-06.

## 7. Rendimiento (resumen)
Detalle en `docs/RESULTADOS_RENDIMIENTO.md`. Escala 1 (1 500 alumnos y 135 000 marcas):

| Acción | Escritorio | Teléfono emulado (CPU 4× más lenta) |
|---|---|---|
| Abrir pase de lista | 66 ms | 483 ms |
| Guardar asistencia | 231 ms | 651 ms |
| Horario de grupo | 197 ms | 959 ms |
| Prefectura: panel del día | 209 ms | 940 ms |
| Cargar la escuela completa | 16,9 s | 25,5 s |

Almacenamiento: 168,5 MB.

## 8. Estado de seguridad, sincronización y respaldos
- **Seguridad:** no hay permisos simulados.
  - **Sin servidor:** no hay cuentas, y la interfaz lo dice.
  - **Con servidor:**
    - autenticación por invitación;
    - segundo factor para Administración y Dirección;
    - RLS en 31 tablas;
    - aislamiento entre escuelas, probado (2 escuelas × 6 roles) y en el piloto (MU-03);
    - auditoría de sólo agregar;
    - XSS, archivos malformados y secretos, verificados.

  Riesgos abiertos: S4 en dispositivos compartidos, el servidor sin desplegar (HTTPS, SMTP, IP real), y que los datos locales sin cifrar en reposo dependen del bloqueo del dispositivo.
- **Sincronización:** **implementada y probada contra un servidor local**:
  - cola en la misma transacción;
  - versión base;
  - conflictos explícitos (MU-02);
  - sin duplicados al reintentar;
  - envío en segundos con conexión.

  **No hay sincronización operativa entre dispositivos de una escuela real** porque no hay servidor desplegado. Sin servidor, los datos sólo se guardan en el dispositivo y la interfaz nunca dice «Sincronizado».
- **Respaldos:**
  - exportación cifrada (AES-GCM y PBKDF2 con 600 000 iteraciones);
  - huella;
  - restauración todo o nada (incluso si se cierra la pestaña a mitad);
  - versiones incompatibles, archivos corruptos y archivos alterados se rechazan sin escribir nada;
  - escuelas grandes, comprimidas.

## 9. Dictamen técnico
| Categoría | Dictamen | Evidencia | Condiciones o bloqueos |
|---|---|---|---|
| **APTO PARA DEMOSTRACIÓN LOCAL** | **SÍ** | 33 de 33 casos locales (11 × 3 dispositivos emulados); rendimiento a escala completa; limpieza segura | — |
| **APTO PARA PILOTO CONTROLADO** (una escuela; cada persona en su propio dispositivo; modo sólo dispositivo, sin consolidación entre dispositivos) | **SÍ, CON CONDICIONES** | Flujos de docente, Prefectura y Dirección, sin conexión y respaldos aprobados; 0 CRÍTICOS y 0 ALTOS abiertos | Antes de cargar datos reales: (1) prueba en los **dispositivos físicos** de la escuela, incluido iPhone si se usará (B-02, B-03); (2) **aviso de privacidad** publicado (B-04); (3) dispositivos personales, no compartidos (S4); (4) respaldo semanal verificado. Sin servidor, Prefectura y Dirección **no ven** las listas de los docentes: cada dispositivo tiene sus propios datos |
| **APTO PARA PILOTO MULTIUSUARIO** | **NO, BLOQUEADO** | El código pasa sus pruebas multiusuario contra un servidor **local** (5 casos MU, 109 del servidor, 4 con servidor real) | **B-01: no hay servidor desplegado** (requiere autorización, contratación, HTTPS y SMTP); B-05 (S4) y B-06 (servidor sin medir con volumen) |
| NO APTO | — | — | — |

**Recomendación:**
1. Aprobar la demostración local.
2. Autorizar, si la escuela lo decide, un piloto controlado en modo sólo dispositivo, una vez cumplidas las condiciones (1) a (4).
3. **No** iniciar un piloto multiusuario hasta cumplir la sección B de `docs/LISTA_VERIFICACION_DESPLIEGUE.md` y repetir `test:piloto:multiusuario` contra el servidor desplegado de prueba.

## 10. Compatibilidad comprobada
| Plataforma | Cómo | Resultado |
|---|---|---|
| Computadora (Chromium de escritorio) | Directa | ✓ |
| Android (Pixel 7) | **Emulación**, también con CPU 4× más lenta | ✓ |
| Tableta (Galaxy Tab S4) | **Emulación** | ✓ |
| iPhone / Safari | **No probado** (sin dispositivo ni WebKit) | — |
| Firefox | No probado | — |

**Ningún dispositivo físico se usó.**

## 11. Pasos pendientes para el despliegue institucional
Ver `docs/LISTA_VERIFICACION_DESPLIEGUE.md`:
1. Hospedaje autorizado con HTTPS, SMTP, respaldos y monitoreo.
2. Aviso de privacidad.
3. Pruebas en dispositivos físicos, incluido iPhone.
4. Decisión sobre dispositivos compartidos (S4).
5. Medir el servidor con volumen.
6. Ensayo de migración con una copia aislada.
7. Capacitación.
8. Elegir la escuela piloto.

**La Fase 11 no se inicia sin autorización expresa.**
