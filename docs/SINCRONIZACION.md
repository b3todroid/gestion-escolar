# Sincronización sin conexión — Fase 8D

**Estado:** implementado y probado **sólo en el entorno local** con datos ficticios. No hay despliegue ni datos reales. Las escuelas que ya existían sólo en un dispositivo **no** se suben: eso es la migración (8E).

## Cómo funciona
1. **Usar en este dispositivo** (`#/cuenta`, «Mis accesos»): el dispositivo descarga una fotografía de lo que el rol de la persona puede ver.
   - Las mismas políticas RLS de la Fase 8C, sin columnas sensibles que no le corresponden.
   - Queda registrado el vínculo en la tabla local `vinculos`.
   - Se niega si ya existe en el dispositivo una escuela con ese identificador o con la misma CCT (no se mezclan escuelas).
2. **Trabajo sin conexión**:
   - La app usa exactamente los mismos servicios y reglas de siempre.
   - Cada cambio en una escuela vinculada se agrega a la **cola** (`pendientes`) **en la misma transacción** que el dato: si una falla, fallan las dos.
   - Todos los cambios de una misma operación comparten un `grupo`.
3. **Sincronizar**: es automático al volver la conexión, al regresar a la app y cada 30 s si hay pendientes; también con «Sincronizar ahora». Tiene dos pasos:
   - **Enviar**: la cola se manda en orden, sin partir grupos (`POST /api/escuelas/ID/sincronizacion`).
   - **Recibir**: llegan los cambios de los demás desde la última secuencia (`GET …?desde=N`).

## Reglas del servidor (nunca «el último gana»)
| Caso | Resultado |
|---|---|
| Cambio sobre la misma versión que tiene el servidor (`versionBase`) | **Aplicado** |
| El servidor ya tiene otra versión (otra persona lo cambió) | **Conflicto**: se devuelve la versión del servidor; el servidor no cambia |
| Alta con una clave natural que ya existe (misma lista de clase y fecha, misma inscripción…) | **Conflicto**: nunca se duplica |
| Sin permiso (RLS), otra escuela, ciclo cerrado, datos inválidos (Zod de la tabla), referencia rota | **Rechazado**, con explicación |
| Reenvío de un cambio ya aplicado (mismo `opId`) | **Repetido**, sin efecto (idempotencia) |
| Un cambio de un grupo falla | **Ningún** cambio del grupo se aplica |

Además:
- **Secuencia segura:** cada cambio en el servidor queda en `sincronizacion.cambios` con un número de secuencia y un candado por escuela, así que un dispositivo nunca «salta» un cambio confirmado tarde.
- **Bajas:** se propagan como «eliminado».
- **Pérdida de acceso:** si la persona deja de poder ver un registro (por ejemplo, cambió de grupo), el dispositivo recibe la orden de quitarlo.
- **Auditoría:** cada envío y cada recepción quedan registrados, sin datos personales.

## En el dispositivo
- **Indicador** en la barra superior (texto y símbolo), calculado siempre de la cola real:
  - «↻ N por enviar»
  - «⚠ N por resolver»
  - «⚠ Sin acceso al servidor»
  - «✓ Sincronizado»: sólo si no hay nada pendiente.

  Sin escuelas vinculadas no aparece.
- **`#/sincronizacion`:** estado por escuela y lista de lo que **requiere tu decisión**, con la diferencia campo por campo entre el dispositivo y el servidor. Las decisiones posibles:
  - **Usar la versión del servidor**: descarta el cambio local (todo su grupo) y vuelve a descargar la fotografía para no dejar huecos.
  - **Volver a aplicar mi cambio**: lo reenvía sobre la versión del servidor; la versión nunca retrocede. No se permite si el servidor ya tiene un registro equivalente distinto.
  - **Quitar esta escuela del dispositivo**: borra sólo los datos locales, con confirmación y aviso de los cambios sin enviar.
- Lo recibido del servidor **no pisa** cambios locales sin resolver: sólo se guarda como «versión del servidor» para comparar.
- Una escuela vinculada **no se restaura desde un respaldo**: se mezclarían versiones sin control. Su copia de referencia es el servidor.
- **Sesión:**
  - Si caduca, la cola se conserva y se pide iniciar sesión.
  - Si el acceso se revoca, la sincronización se detiene sin borrar nada en silencio; quitar los datos del dispositivo es una acción explícita.

## Esquema
- **Local v11:** `pendientes` (`++orden, &opId, escuelaId, estado, [tabla+registroId]`) y `vinculos` (`escuelaId`). Sólo tablas nuevas, propias del dispositivo, que no van en los respaldos.
- **Servidor 0005:**
  - `sincronizacion.cambios` con un disparador en las 31 tablas.
  - Política de lectura por escuela.
  - Decisión D14: el administrador modifica grupos, materias y horarios, y confirma o reabre horarios.

## Pruebas (PostgreSQL real, IndexedDB simulada, datos ficticios)
`servidor/pruebas/dispositivos.test.ts` (12 pruebas). Cada dispositivo simulado tiene su propia IndexedDB, su sesión y la misma app:
- Al unirse, cada rol descarga sólo lo suyo.
- Pase de lista sin conexión → cola → no se pierde → se envía al volver.
- Otro dispositivo recibe el cambio y aplica las mismas reglas.
- Las bajas se propagan.
- Conflicto de versión entre Dirección y Subdirección, resuelto reaplicando.
- Misma lista desde dos dispositivos: no se duplica y se usa la del servidor.
- Un rechazo por permisos queda visible y se resuelve.
- Idempotencia; rechazo de datos de otra escuela o inválidos; bloqueo de restauración; revocación.
- Se comprobó que la prueba detecta errores: al desactivar a propósito la verificación de versión, falla la prueba de conflicto.

`tests/e2e-servidor/sincronizacion.spec.ts` (navegador real con el servidor compilado): unirse, pasar lista sin conexión, indicador «por enviar», volver la conexión y quedar «✓ Sincronizado», con la lista ya en el servidor.

## Límites y pendientes
- **Base local por persona** (diseño 8A): por ahora las escuelas vinculadas viven en la misma base del dispositivo que las locales. En un dispositivo compartido conviene «Quitar esta escuela del dispositivo» al terminar. Se propone separarla por persona antes del piloto.
- **Grupos enormes:** un grupo de más de 2000 cambios (p. ej. una importación muy grande) se envía en partes y pierde la atomicidad entre partes.
- **Reglas entre tablas:** las reglas de negocio se aplican en el dispositivo (los mismos servicios). En el servidor, la sincronización por registros valida esquema, permisos, ciclo cerrado, misma escuela, confirmar/autorizar y claves únicas. Reglas como los choques de horario del docente no se vuelven a calcular en el servidor al sincronizar; las operaciones del día a día también existen como comandos (8C), que sí las ejecutan.
- **Registro de cambios:** `sincronizacion.cambios` crece sin límite. Su depuración se definirá con la retención de 1 ciclo (D7).
- **Clientes sin conexión mucho tiempo:** reciben todo lo pendiente por partes de 2000 cambios.
