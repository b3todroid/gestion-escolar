# Permisos y aislamiento — Fase 8C

**Estado:** implementado y probado **sólo en el entorno local** con datos ficticios. No hay despliegue, el servidor no recibe datos reales y la aplicación sigue trabajando con los datos del dispositivo. La sincronización es la Fase 8D y la migración de datos la 8E.

## Cómo se aplican los permisos (tres barreras, todas en el servidor)
1. **API**:
   - Sesión vigente, segundo factor si el rol lo exige, membresía activa en la escuela de la ruta y rol permitido para el comando (`servidor/src/comandos.ts`).
   - Los datos que identifican a quien actúa los pone el **servidor**, nunca el cliente: ficha de personal, «autorizó», fecha y hora en `America/Mexico_City`.
2. **Base de datos (RLS)**: las peticiones sobre datos escolares corren con el rol restringido `gestion_app`, sin `BYPASSRLS`. La transacción lleva:
   - `app.usuario_id`: la persona autenticada.
   - `app.escuela_id`: la escuela de la ruta, a la que queda **atada** toda la transacción.

   Cada una de las **31 tablas** escolares tiene políticas de lectura, inserción, modificación y borrado. Todas consultan la matriz `acceso.matriz` y las membresías **activas**. El rol `gestion_app` no puede leer cuentas, sesiones, membresías ni la auditoría.
3. **Disparadores**:
   - Una fila nunca apunta a datos de otra escuela. Las llaves foráneas no ven la RLS, así que sin esto se podría «colgar» un registro de un grupo ajeno; la regla aplica también al dueño de la base.
   - Un ciclo cerrado es de sólo lectura.
   - Sólo Dirección confirma o reabre horarios.
   - Confirmar incidencias y autorizar coberturas: el administrador, o Dirección y Subdirección si él se los delega (D5).
   - Docentes y Prefectura sólo **proponen** actividades del banco.
   - Los historiales sólo se agregan.

Además, el servidor ejecuta **los mismos servicios** de la aplicación (`src/services`), con las mismas reglas y validaciones Zod, sobre repositorios PostgreSQL que implementan las interfaces de `src/repositories/tipos.ts` (`servidor/src/repositoriosPg.ts`). Para reutilizarlos, el servidor se compila con Vite (`npm run servidor:compilar` → `dist-servidor/`).

## Matriz de permisos (`acceso.matriz`, migración 0004)
Alcance: **E** = toda la escuela · **G** = grupos donde imparte (y sus alumnos) · **P** = lo propio (su ficha de personal) · **—** = nada. Formato: lectura / escritura.

| Tabla | Administrador | Dirección | Subdirección | Prefectura | Docente | Apoyo |
|---|---|---|---|---|---|---|
| Escuela, ciclos, turnos, jornadas, periodos, recesos, grados, personal | E / E | E / E | E / — | E / — | E / — | E / — |
| Grupos, asignaciones, sesiones, actividades | E / E | E / E | E / E | E / — | G / — | E / — |
| Materias | E / E | E / E | E / E | E / — | E / — | E / — |
| Excepciones (simultaneidad) | E / E | E / E | E / E | E / — | P / — | — |
| Confirmaciones de horario | E / E | E / E | E / — | E / — | G / — | E / — |
| Bitácora de horarios | E / E | E / E | E / E | — | — | — |
| Adscripciones | E / E | E / E | E / E | E / — | P / — | — |
| Alumnos, inscripciones, movimientos | E / — | E / E | E / E | E / — | G / — | E / — |
| Importaciones y plantillas | E / E | E / E | E / E | — | — | — |
| Pase de lista | E / — | E / — | E / — | E / — | G / **P** | — |
| Asistencias, cambios de asistencia | E / — | E / — | E / — | E / — | G / G | — |
| Salidas del aula, reportes de alumnos | E / — | E / — | E / — | E / E | G / G | E / — |
| Incidencias del personal | E / E | E / E | E / E | E / E | P / — | — |
| Coberturas | E / E | E / E | E / E | E / E | P / — | — |
| Banco de actividades | E / E | E / E | E / E | E / E (proponer) | E / E (proponer) | — |
| Bitácora de Prefectura | E / E | E / E | E / E | E / E | — / E | — |

**Columnas sensibles:** la RLS decide qué filas se ven y la API decide estas columnas.
- **CURP** del alumno: sólo Dirección y Subdirección.
- **Matrícula**: Dirección, Subdirección y Prefectura.
- **Observaciones** del alumno: Dirección y Subdirección.
- **Número de empleado** y **observaciones** del personal: Administración, Dirección y Subdirección.

**Confirmar y autorizar (D5):**

| Acción | Quién |
|---|---|
| Confirmar o descartar incidencias | Administrador; Dirección o Subdirección sólo con delegación expresa |
| Autorizar coberturas | Administrador; Dirección o Subdirección sólo con delegación expresa |
| Validar o retirar actividades del banco | Administración, Dirección o Subdirección |
| Confirmar o reabrir horarios | Dirección o administrador (D14) |

La delegación se administra en `#/cuenta/escuela/ID`, en «Ficha y permisos».

## Ficha de personal
- La membresía se vincula con la ficha de personal de la escuela, también desde «Ficha y permisos». La ficha identifica a la **persona**: una misma ficha no puede vincularse con dos cuentas.
- Un docente **sin ficha** no ve grupos, alumnos ni clases. Con ficha, ve los grupos donde tiene asignaciones o clases.

## Comandos disponibles (`POST /api/escuelas/ID/comandos`)
`{ opId: UUID, tipo, datos }`. Son **idempotentes**: el mismo `opId` devuelve el mismo resultado sin repetir la operación (tabla `acceso.operaciones`); un `opId` reutilizado para otra operación se rechaza. Cada comando aplicado o rechazado queda en la auditoría.

| Comando | Roles |
|---|---|
| `asistencia.guardarLista` | Docente, sólo en **sus** clases |
| `asistencia.registrarSalida`, `asistencia.reincorporar`, `asistencia.crearReporte` | Docente (sus clases), Prefectura |
| `prefectura.registrarIncidencia`, `prefectura.proponer` | Prefectura, Administración, Dirección, Subdirección |
| `prefectura.validarIncidencia` | Administración, o Dirección/Subdirección con delegación |
| `prefectura.asignar` | Administración, o Dirección/Subdirección con delegación; «autorizó» lo pone el servidor |
| `prefectura.crearActividad` | Todos salvo Apoyo (queda «propuesta») |
| `prefectura.cambiarEstadoActividad` | Administración, Dirección, Subdirección |
| `personal.crear` | Administración, Dirección |
| `alumnos.inscribirNuevo` | Dirección, Subdirección |
| `confirmacion.confirmar`, `confirmacion.reabrir` | Dirección |

Lectura: `GET /api/escuelas/ID/tablas/TABLA?ciclo=ID` devuelve las filas visibles para la persona (máx. 5000) y queda en la auditoría.

## Pruebas (PostgreSQL real, datos ficticios)
- `servidor/pruebas/aislamiento.test.ts` (35 pruebas):
  - La matriz de la base coincide con la especificación escrita en la prueba.
  - **2 escuelas × 6 roles × 31 tablas**: cada rol lee y modifica exactamente lo que le permite su alcance y **nada** de la otra escuela.
  - Una persona que administra dos escuelas sólo ve la de la ruta.
  - Sin usuario, con acceso revocado o con invitación sin aceptar no se ve nada.
  - Un docente sin ficha no ve grupos.
  - Se rechazan referencias cruzadas entre escuelas.
  - Ciclo cerrado; reglas de confirmar y autorizar; banco de actividades; historiales de sólo agregar.
  - Se comprobó que la batería detecta errores: al alterar la matriz a propósito, fallaron 8 pruebas.
- `servidor/pruebas/comandos.test.ts` (16 pruebas): comandos por HTTP con sesiones reales.
  - Idempotencia; regla falta ⇄ salida; clases propias y ajenas; otra escuela; fecha futura.
  - Docente sin ficha; delegación; «autorizó» puesto por el servidor; validaciones Zod de la app.
  - Columnas sensibles, ciclo cerrado y auditoría.

## Límites conocidos y pendientes
- **Rendimiento:** `acceso.permite()` se evalúa por fila. Basta para escuelas individuales; antes de producción se medirá con volúmenes reales ficticios y, si hace falta, se precalcularán los grupos por sesión.
- **Superficie de comandos:** cubre las operaciones multiusuario del día a día. La configuración completa (ciclos, horarios, importaciones) sigue haciéndose en el dispositivo y llegará al servidor con la sincronización (8D) y la migración (8E).
- **Límite de la RLS:** la RLS es una defensa en profundidad. Quien tuviera acceso directo a la base con el usuario dueño la evitaría, así que la API nunca ejecuta SQL enviado por el cliente y ese usuario debe custodiarlo el operador (D8).
- **Dato nuevo a declarar:** la auditoría registra también las **consultas** de datos. Debe mencionarse en el aviso de privacidad.

## Decisiones pendientes
| # | Decisión | Propuesta |
|---|---|---|
**Decididas (2026-11-03):** D13 se mantiene como está; D14 sí: el administrador modifica grupos y horarios (migración 0005).

| D13 | Alcance de **Personal de apoyo** (Orientación, Trabajo social…): hoy lee alumnos, inscripciones, salidas y reportes de **toda** la escuela; el diseño hablaba de «sus casos», que aún no existen en el modelo | Mantenerlo así hasta definir «casos», o restringirlo a nada |
| D14 | El **administrador** lee, pero no modifica grupos ni horarios (así venía en la matriz de 8A) | Confirmar o darle escritura |
