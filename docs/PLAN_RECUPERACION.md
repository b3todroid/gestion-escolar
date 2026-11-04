# Plan de recuperación — Gestión Escolar (Fase 11)

Complementa `docs/RECUPERACION.md` (dispositivos y respaldos locales, Fase 5) con la recuperación del **servidor**.

Principios:
- **Nunca se sobrescribe ni se borra** la base vigente para «arreglar» algo: se restaura en una base **nueva**, se valida y sólo entonces se cambia.
- Los dispositivos conservan sus datos y su cola. Cuando el servidor vuelve, la cola se envía sin duplicados (✓ DEP-07).
- Cada recuperación queda registrada: quién, cuándo, por qué y qué respaldo se usó.

## 1. Mientras el servidor no está
Las personas **siguen trabajando** en sus dispositivos: pase de lista, salidas, incidencias y consultas. Todo queda en la cola («↻ por enviar»), y la app nunca dice «Sincronizado» con pendientes. **No** hay que borrar datos del navegador ni reinstalar la app.

## 2. Escenarios
| # | Escenario | Detección | Acción |
|---|---|---|---|
| E1 | La API no responde | `salud.sh` / monitor externo | El orquestador la reinicia solo (`restart: unless-stopped`, ✓ DEP-08). Si persiste: revisar registros y, si fue una actualización, §3 |
| E2 | La base de datos se cae o se reinicia | `/api/salud/lista` = 503 | Al volver, la API se recupera sola (✓ DEP-07). Si no arranca: revisar el disco y los registros de `db`. Si hay corrupción, §4 |
| E3 | Actualización defectuosa | Pruebas tras desplegar (`OPERACION_SERVIDOR.md` §6, paso 5) | Volver a `VERSION` anterior. Si hubo una migración no compatible, §4 con el respaldo previo a la actualización |
| E4 | Pérdida total del servidor (disco, cuenta de nube, desastre) | Monitor | §5 (servidor nuevo) |
| E5 | Ransomware o compromiso del servidor | Monitor, archivos cifrados, accesos extraños | **Aislar** (apagar la red pública), no pagar ni negociar, §6 (incidente). Reconstruir en un servidor **nuevo y limpio** (§5) con un respaldo **anterior** al compromiso. Rotar **todos** los secretos |
| E6 | Secreto filtrado (`better_auth_secret`, claves) | Aviso o auditoría | Rotar (`OPERACION_SERVIDOR.md` §7). Con el secreto de sesiones: todos vuelven a entrar. §6 si hubo acceso a datos |
| E7 | Cuenta comprometida | Auditoría, aviso de la persona | Revocar la membresía o las sesiones (`#/cuenta/escuela/ID`); si es Administración o Dirección, restablecer su segundo factor (`cli restablecer-segundo-factor`); revisar la auditoría; §6 |
| E8 | Dispositivo perdido o robado | Aviso | Revocar sus sesiones desde la cuenta; los datos del servidor no se afectan. Los datos locales sólo los protege el bloqueo del dispositivo (riesgo P-03) |
| E9 | Error de una persona (se borró o se cambió algo) | Aviso | Primero revisar el historial (bitácoras, cambios de asistencia). Si hace falta, restaurar un respaldo en una base **aparte** (§4, pasos 1 a 3) **sólo para consultar** y corregir a mano con autorización |
| E10 | Falla el correo SMTP | Alerta «No se pudo enviar el correo» | Nadie nuevo puede entrar (las sesiones vigentes siguen). Corregir con el proveedor; no habilitar otros métodos sin autorización |

## 3. Revertir una versión
1. Cambiar en `deploy/.env` a `VERSION=ANTERIOR`.
2. Levantar con la versión anterior:
   ```bash
   docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
   ```
3. Si `/api/salud/lista` responde 503 «migraciones-pendientes» o hay errores de esquema, la versión nueva cambió la base de forma no compatible: seguir el §4 con el respaldo **previo** a la actualización.

## 4. Restaurar la base (sin sobrescribir)
1. Elegir el respaldo (el más reciente verificado, anterior al problema) y **verificarlo**:
   ```bash
   deploy/scripts/verificar-respaldo.sh ARCHIVO.tar.age IDENTIDAD_AGE
   ```
2. Restaurar en una base **nueva**. En producción el script respalda antes lo actual y exige `--autorizado`:
   ```bash
   deploy/scripts/restaurar.sh -p gestion-prod -e deploy/.env -a ARCHIVO.tar.age -i IDENTIDAD_AGE -n gestion_produccion_r20261104 --autorizado "Nombre, cargo"
   ```
3. Validar la base nueva: conteos (los muestra `verificar-respaldo.sh`) y una revisión con una cuenta de Administración.
4. Cambiar a la base nueva: en `deploy/.env`, `GESTION_BD=gestion_produccion_r20261104`; en `deploy/secretos/database_url`, el nuevo nombre de base. Después:
   ```bash
   docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build servidor
   ```
5. La base anterior **se conserva** (no se borra) hasta que la institución autorice eliminarla, con su propio respaldo.
6. Avisar a las personas: los dispositivos vuelven a enviar lo que tenían pendiente. Los cambios hechos en el servidor **después** del respaldo y que ningún dispositivo conserve se pierden (RPO). Revisar `#/sincronizacion` (posibles conflictos).

Probado en preproducción: los pasos 1 y 2 (✓, `RESPALDOS_PRODUCCION.md` §6). El cambio de base de los pasos 4 y 5 está documentado, **no** probado.

## 5. Servidor nuevo desde cero
1. Preparar el servidor (`OPERACION_SERVIDOR.md` §2) y clonar la **misma versión** del repositorio.
2. Recuperar `deploy/.env` (copia junto a los respaldos) y los secretos (copia custodiada), o generar secretos nuevos. Si son nuevos, todas las sesiones se cierran.
3. Construir las imágenes y levantar sólo la base:
   ```bash
   docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d db
   ```
4. Restaurar el respaldo en una base nueva (§4, pasos 1 y 2), ajustar `GESTION_BD` y `database_url`, y levantar todo.
5. Si cambió la IP, actualizar el DNS. Caddy obtiene un certificado nuevo solo.
6. Verificar con `salud.sh`, entrar con una cuenta de prueba y revisar la sincronización de un dispositivo.

**RTO propuesto: 4 horas** (§ `RESPALDOS_PRODUCCION.md` §4). **No se ha ensayado completo** en un servidor real: es requisito antes de producción (`CHECKLIST_PRODUCCION.md`).

## 6. Incidentes de seguridad o de datos personales
1. **Contener:** aislar el servidor o la cuenta, revocar sesiones y rotar secretos. **No** borrar evidencia.
2. **Evaluar:** qué datos, de quiénes, desde cuándo. Fuentes: `acceso.auditoria`, registros de Caddy y del servidor.
3. **Notificar:** según el procedimiento institucional y la normativa aplicable, que debe confirmar la asesoría jurídica (`SEGURIDAD_PRODUCCION.md` §11): autoridad competente, personas afectadas, madres, padres o tutores.
4. **Recuperar** (§3 a §5) y **documentar** las lecciones aprendidas.

Responsables: **definir** por la institución (responsable del tratamiento, responsable técnico y suplente). Sin esa definición no se debe operar con datos reales.
