# Lista de verificación para producción — Gestión Escolar (Fase 11)

Sustituye y amplía `docs/LISTA_VERIFICACION_DESPLIEGUE.md` (Fase 10).
- ☑ = hecho y **verificado** (en desarrollo o en la preproducción local, con datos ficticios).
- ☐ = pendiente.
- 🔒 = requiere autorización institucional.

## A. Decisiones y requisitos institucionales
- ☐ 🔒 Modelo de infraestructura elegido y cotizado (`COMPARATIVA_NUBE_NAS_HIBRIDO.md`; recomendación: híbrido).
- ☐ 🔒 Responsable del tratamiento, responsable técnico y suplente designados por escrito.
- ☐ 🔒 Aviso de privacidad publicado; revisión jurídica del tratamiento de datos de menores y del contrato con el proveedor (`SEGURIDAD_PRODUCCION.md` §11).
- ☐ 🔒 Política de conservación y eliminación (D7): plazos para asistencia, reportes y respaldos.
- ☐ 🔒 RPO y RTO aprobados (propuesta: 24 h y 4 h; `RESPALDOS_PRODUCCION.md` §4).
- ☐ 🔒 Canal de alertas y personas de guardia definidos.
- ☐ 🔒 Escuela piloto y periodo elegidos (D10).

## B. Aplicación (verificado)
- ☑ Pruebas en verde: unitarias, funcionales, servidor, servidor con navegador, piloto local y multiusuario, y despliegue (`FASE_11_DESPLIEGUE.md` §6).
- ☑ Sin incidencias CRÍTICAS ni ALTAS abiertas en el código.
- ☑ Migraciones 0001–0007 con huella; el servidor las aplica una sola vez al arrancar (candado).
- ☑ `npm audit --omit=dev` = 0.
- ☑ SMTP real implementado (cifrado obligatorio en producción) y probado.
- ☑ El servidor exige HTTPS y SMTP en producción y preproducción, y se niega a usar bases de pruebas, piloto o demostración en producción.
- ☑ IP real del cliente detrás del proxy (el límite de intentos no se puede evadir ni bloquear a todos).
- ☑ Salud: `/api/salud` y `/api/salud/lista`.
- ☐ Revisar las notas de seguridad de Better Auth posteriores a 1.7.11 (S6).
- ☐ Base local separada por persona, o dispositivos personales (S4).
- ☐ Medir el servidor con volumen y varias personas a la vez (B-06).

## C. Infraestructura
- ☑ Imágenes reproducibles (`deploy/Dockerfile`, `construir.sh`); el servidor corre sin privilegios y con sistema de archivos de sólo lectura.
- ☑ Compose con la base y la API sin puertos publicados y la base en una red sin salida a internet (✓ DEP-02).
- ☑ Caddy con HTTPS, HSTS y cabeceras; administración apagada; buzón de desarrollo cerrado (✓ DEP-01).
- ☑ Secretos fuera del repositorio y de las imágenes (`*_FILE`).
- ☐ 🔒 Servidor contratado o equipo local listo (2 vCPU, 4 GB de RAM y 40 GB de SSD como mínimo), con Linux LTS.
- ☐ 🔒 Dominio y DNS.
- ☐ 🔒 Cuenta SMTP institucional; SPF, DKIM y DMARC.
- ☐ Firewall del anfitrión (80 y 443; SSH restringido), SSH por llave y actualizaciones automáticas.
- ☐ Imágenes base fijadas por resumen (`@sha256:`).
- ☐ Monitor externo y alertas (`OPERACION_SERVIDOR.md` §5).
- ☑ Rotación de registros (`json-file`, 10 MB × 5 por servicio, en `docker-compose.yml`).

## D. Respaldos y recuperación
- ☑ Respaldo cifrado (age, clave pública en el servidor) con manifiesto y suma SHA-256.
- ☑ Verificación en un PostgreSQL temporal sin red; un archivo alterado o una clave equivocada se rechazan.
- ☑ Restauración a una base nueva, sin sobrescribir; en producción exige autorización y respalda antes.
- ☐ 🔒 Par de claves de age de producción; custodia de la clave privada (dos personas y una copia sellada).
- ☐ Cron diario, copia al NAS (cuenta que sólo escribe) y copia externa.
- ☐ Primera verificación semanal registrada.
- ☐ **Simulacro completo de recuperación** en un servidor nuevo (`PLAN_RECUPERACION.md` §5), midiendo el RTO.

## E. Dispositivos y uso
- ☑ PWA: actualización sin pérdida de datos locales ni de la cola (✓ DEP-06); confirmación si hay cambios sin guardar.
- ☐ Prueba en Android e iPhone **físicos** (instalación, sin conexión, actualización).
- ☐ Prueba en tabletas, Windows, macOS y Linux físicos (navegadores actuales).
- ☐ Bloqueo de pantalla obligatorio y almacenamiento persistente concedido.
- ☐ Capacitación por perfil.

## F. Antes de abrir a datos reales
- ☐ 🔒 Autorización escrita para producción.
- ☐ Preproducción de la institución validada (mismo dominio o subdominio de pruebas, con certificado público) con `npm run test:despliegue` adaptado a su URL.
- ☐ La escuela de demostración NO está en la base de producción (la herramienta del piloto se niega en producción).
- ☐ 🔒 Migración con ensayo, autorización y respaldo previo.
