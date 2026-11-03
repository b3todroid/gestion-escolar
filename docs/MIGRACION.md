# Migración de datos locales al servidor — Fase 8E

**Estado:** herramienta implementada y probada **sólo con datos ficticios** en el entorno local, incluido un piloto institucional ficticio de punta a punta en el navegador. **No se migró ningún dato real** y no hay despliegue. Una migración real requiere el servidor desplegado (D11), el aviso de privacidad publicado por la escuela (D2) y la autorización registrada en el paso 6.

## Quién y dónde
- **Quién:** sólo el **administrador** de la escuela en el servidor, con verificación en dos pasos. Lo comprueba el servidor.
- **Dónde:** desde el dispositivo que tiene los datos, en `#/migracion` (también hay un enlace en `#/cuenta`).
- **Requisitos de la escuela del servidor:**
  - La da de alta el operador (`alta-escuela`).
  - Debe tener la **misma CCT** que la escuela del dispositivo.
  - Debe estar **vacía**: nunca se mezclan escuelas ni se fusionan datos.

## Los 9 pasos (cada uno explícito)
| Paso | Qué hace | Dónde se garantiza |
|---|---|---|
| 1. Respaldo | Respaldo **cifrado** obligatorio (AES-GCM + PBKDF2) que la persona descarga y guarda | Dispositivo (Fase 5) |
| 2. Validar esquema | Versión de datos actual; Zod por tabla, referencias internas, huella y conteos del respaldo | Dispositivo |
| 3. Preparar | Misma CCT y paquete con el identificador de la escuela del servidor (los demás identificadores **no cambian**), con conteos y huella canónica SHA-256 | Dispositivo |
| 4. Ensayo / duplicados | El servidor hace **todo** y luego lo deshace. Revisa duplicados por matrícula o CURP (rechazo), posibles duplicados por nombre (aviso, nunca se fusionan), referencias y reglas de la base | Servidor (no escribe nada) |
| 5. Integridad | Conteos y huella del servidor iguales a los del dispositivo, también al **releer** lo que guardaría | Servidor |
| 6. Autorización | Nombre y cargo de quien autoriza, aviso de privacidad publicado y CCT escrita para confirmar. Queda registrada | Servidor (`acceso.migraciones`) |
| 7. Migrar | Todo o nada en una transacción. Se cargan también los ciclos ya cerrados (historial), con una excepción que sólo existe dentro de esta transacción del servidor y nunca para la API | Servidor |
| 8. Validar | El servidor relee lo guardado y la huella debe coincidir; si no, no se guarda nada | Servidor y dispositivo |
| 9. Cambiar el dispositivo | Con una migración vigente: se quita la copia local y se descarga la sincronizada (mismos registros). Desde aquí rige la Fase 8D | Dispositivo |

## Reversión
- **En el servidor** («Revertir esta migración», con motivo):
  - Quita exactamente los registros que agregó, devuelve la escuela del servidor a como estaba y desvincula las fichas de personal de las cuentas (las cuentas se conservan).
  - **Sólo se permite si nadie hizo cambios después.** Si hubo cambios, se bloquea, porque revertir los borraría; la pantalla dice cuántos.
- **En el dispositivo:** el respaldo del paso 1 restaura la escuela local (`#/respaldos`). Antes de restaurar hay que quitar la versión sincronizada desde `#/sincronizacion`.
- **Registro:** todo queda en la auditoría (`migracion_ensayo`, `migracion_aplicada`, `migracion_revertida`) y en el historial de `#/migracion`.

## Esquema (migración 0006)
- `acceso.migraciones`: autorización, conteos, huella, escuela previa, secuencia final y estado. Una sola migración vigente por escuela.
- `acceso.migracion_registros`: los registros agregados por cada migración.
- `plantillas_importacion.umbral_confianza` pasa a `double precision`. Con `real`, 0.6 cambiaba al guardarse y la huella no coincidía; la prueba lo detectó.

## Pruebas (datos ficticios)
- `servidor/pruebas/migracion.test.ts` (9): IndexedDB simulada con la app real y servidor real.
  - CCT distinta bloqueada.
  - Paquete con las 31 tablas.
  - Ensayo sin escritura, con aviso de duplicados por nombre.
  - Paquete alterado rechazado por la huella.
  - Sólo el administrador puede migrar; sin autorización correcta no se migra.
  - Migrar, validar, revertir y volver a migrar.
  - El dispositivo pasa a la versión sincronizada con los **mismos** registros.
  - Reversión bloqueada tras cambios posteriores.
  - Se comprobó que las pruebas detectan errores: al quitar a propósito la comprobación de CCT y el deshacer del ensayo, fallaron 6.
- `tests/e2e-servidor/migracion.spec.ts` (**piloto institucional ficticio**, en el navegador):
  - Se crea la escuela en el dispositivo con el asistente y el administrador entra con verificación en dos pasos.
  - Recorre los 9 pasos, incluida la descarga del respaldo cifrado.
  - El dispositivo queda sincronizado y la migración aparece en el historial.

## Antes de una migración real (decisiones y tareas pendientes)
1. **Despliegue** en la nube elegida (D11), con HTTPS, envío de correo por SMTP, respaldos del servidor y monitoreo. Requiere autorización.
2. **Aviso de privacidad** de cada escuela publicado (D2) y revisión jurídica (LGPDPPSO o LFPDPPP; datos de menores).
3. **Escuela piloto** (D10) durante un ciclo escolar.
4. **Base local separada por persona** (pendiente de 8D) antes de usar dispositivos compartidos.
5. **Ensayo con una copia** del respaldo real **en un servidor de prueba sin conexión externa**, con autorización, antes de la migración definitiva.
