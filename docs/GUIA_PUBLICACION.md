# Guía de publicación — Gestión Escolar (Fase 11)

> **NO SE HA PUBLICADO NADA.** Esta guía describe los pasos exactos para **cuando la institución lo autorice**. Antes de cada paso marcado 🔒 se necesita una autorización expresa: contratar, comprar dominio, usar datos reales o migrar.

## 1. Requisitos previos (no técnicos)
Ver `docs/CHECKLIST_PRODUCCION.md` §A. Sin aviso de privacidad, responsables definidos y modelo de infraestructura elegido (`COMPARATIVA_NUBE_NAS_HIBRIDO.md`), **no se publica**.

## 2. Ensayo obligatorio en preproducción (local, datos ficticios)
Reproduce lo probado en la Fase 11.
1. Requisitos en el equipo: Docker y Docker Compose v2, age, Node 22 (para las pruebas) y PostgreSQL local (para `test:servidor`).
2. Archivo de entorno de preproducción:
   ```bash
   cp deploy/preproduccion.env.example deploy/preproduccion.env
   ```
   Genera un par de claves de **prueba** para los respaldos, fuera del repositorio:
   ```bash
   age-keygen -o ~/identidad-preprod.txt
   ```
   Pon la clave pública que muestra en `RESPALDO_DESTINATARIO`, y en `RESPALDO_DIR` una carpeta fuera del repositorio.
3. Secretos:
   ```bash
   deploy/scripts/generar-secretos.sh preproduccion.env
   ```
4. Imágenes (con un espejo, si Docker Hub limita: `REGISTRO=mirror.gcr.io/library` y `REGISTRO_EXTRA=mirror.gcr.io` en el archivo de entorno):
   ```bash
   deploy/scripts/construir.sh 0.1.0-preprod
   ```
5. Levantar la preproducción, cargar DEMO-001 y comprobar la salud:
   ```bash
   deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env
   ```
   ```bash
   deploy/scripts/salud.sh https://localhost:8443 --inseguro
   ```
6. Pruebas de despliegue (8 casos: HTTPS, puertos, SMTP, permisos, límite por IP real, actualización de la PWA, caída de la base y reinicio de la API):
   ```bash
   npm run test:despliegue
   ```
7. Respaldo, verificación y restauración:
   ```bash
   deploy/scripts/respaldar.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml
   ```
   ```bash
   deploy/scripts/verificar-respaldo.sh RUTA/gestion-gestion_piloto_preprod-FECHA.tar.age ~/identidad-preprod.txt
   ```
   ```bash
   deploy/scripts/restaurar.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml -a RUTA/ARCHIVO.tar.age -i ~/identidad-preprod.txt -n gestion_piloto_restaurada
   ```
8. Los correos de prueba se ven en http://127.0.0.1:8025 (sólo desde ese equipo).

## 3. Publicación (cuando se autorice)
1. 🔒 **Contratar** el servidor (región en México) o preparar el equipo local, según la decisión institucional. Mínimo para el piloto: 2 vCPU, 4 GB de RAM y 40 GB de SSD, con Linux LTS.
2. 🔒 **Dominio:** registrar o usar un subdominio institucional (p. ej. `gestion.escuela.edu.mx`) y crear el registro DNS A/AAAA hacia el servidor.
3. 🔒 **SMTP institucional:** cuenta `no-responder@…` con TLS o STARTTLS. Configurar SPF, DKIM y DMARC del dominio para que los códigos no lleguen a spam.
4. **Preparar el servidor:** `OPERACION_SERVIDOR.md` §2 (usuario, SSH por llave, firewall, actualizaciones automáticas, Docker).
5. **Instalar:** `OPERACION_SERVIDOR.md` §3.
   - `deploy/.env` con `MODO=produccion`, `DOMINIO`, `TLS=correo-de-contacto`, `GESTION_BD=gestion_produccion`, `SMTP_*` y la clave **pública** de age.
   - Generar los secretos con `generar-secretos.sh` y copiar la clave SMTP.
   - Construir con la versión etiquetada y, de preferencia, con las imágenes base fijadas por resumen.
6. Levantar los servicios:
   ```bash
   docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
   ```
   El servidor se niega a arrancar si falta HTTPS o SMTP cifrado, o si la base tiene nombre de pruebas.
7. **Verificar:**
   ```bash
   deploy/scripts/salud.sh https://DOMINIO
   ```
   Debe reportar PWA, API, base de datos, HSTS, buzón cerrado y vencimiento del certificado. Prueba también desde fuera con un analizador TLS público y en dos dispositivos (Android e iPhone).
8. **Respaldos:** programar cron (`RESPALDOS_PRODUCCION.md` §7), configurar la copia al NAS y **verificar el primer respaldo** antes de cargar datos.
9. **Monitoreo:** monitor externo sobre `/` y `/api/salud/lista`, y alertas de `OPERACION_SERVIDOR.md` §5.
10. **Primera escuela:** `cli alta-escuela` con la CCT oficial y el correo institucional de la persona administradora (🔒 datos reales). Esa persona entra, activa su segundo factor e invita al resto.
11. 🔒 **Migración de datos reales** (si la escuela ya usaba la app sólo en el dispositivo): `#/migracion`, con ensayo, autorización registrada y respaldo cifrado previo (`docs/MIGRACION.md`).
12. **Piloto controlado:** `docs/PLAN_PILOTO.md` §3, con revisión diaria de `#/sincronizacion` durante dos semanas.

## 4. Estados del despliegue
| Estado | Significado | Hoy |
|---|---|---|
| **PREPARACIÓN COMPLETADA** | Arquitectura documentada; configuración reproducible; pruebas locales satisfactorias; sin riesgos críticos; respaldo y restauración probados; requisitos completos | **Sí** (ver `FASE_11_DESPLIEGUE.md` §8) |
| **PREPRODUCCIÓN VALIDADA** | La misma pila en el servidor de preproducción **de la institución** (dominio y certificado reales), con pruebas de despliegue y en dispositivos físicos | **No** (sólo preproducción local) |
| **PRODUCCIÓN AUTORIZADA** | Autorización escrita: infraestructura, dominio, aviso de privacidad, responsables y datos reales | **No** |
| **PRODUCCIÓN OPERATIVA** | Desplegada, validada, con respaldos verificados y monitoreo activo | **No** |
