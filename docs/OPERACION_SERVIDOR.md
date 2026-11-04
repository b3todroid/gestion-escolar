# Operación del servidor — Gestión Escolar (Fase 11)

Manual para la persona que administra el servidor. Todo se probó en una **preproducción local** con datos ficticios; nada se ejecutó contra un servidor real.

## 1. Requisitos
- **Equipo (mínimo para el piloto: 1 a 3 escuelas):** 2 vCPU, 4 GB de RAM y 40 GB de SSD.
  - En reposo, los contenedores usan ~25 MB (PostgreSQL), ~45 MB (API) y ~22 MB (Caddy).
  - Para crecer, ver `ARQUITECTURA_PRODUCCION.md` §8.
- **Sistema:** Linux de 64 bits con soporte largo (Ubuntu Server LTS o Debian estable), Docker Engine y Docker Compose v2. Opcionales: age (si el servidor verifica respaldos; en producción se recomienda verificar en otro equipo) y curl.
- **Red:**
  - dominio con DNS (registro A/AAAA) apuntando al servidor;
  - entrada 80 y 443;
  - salida al SMTP institucional (587 o 465) y a Let's Encrypt.

## 2. Preparación del servidor (una vez)
1. Usuario administrativo con SSH por llave; contraseña y acceso de root por SSH deshabilitados.
2. Firewall:
   ```bash
   sudo ufw default deny incoming
   ```
   ```bash
   sudo ufw allow from IP_DE_ADMINISTRACION to any port 22 proto tcp
   ```
   ```bash
   sudo ufw allow 80,443/tcp
   ```
   ```bash
   sudo ufw allow 443/udp
   ```
   ```bash
   sudo ufw enable
   ```
   Si es posible, restringe también el SSH en el firewall del proveedor (o por VPN). Docker publica sus puertos por fuera de UFW: por eso `db` y `servidor` **no tienen** `ports:`.
3. Actualizaciones automáticas de seguridad (`unattended-upgrades`) y sincronización de hora (NTP).
4. Instalar Docker Engine y Docker Compose según la documentación oficial de Docker.
5. Clonar el repositorio en `/opt/gestion-escolar`, en la versión (etiqueta) autorizada.

## 3. Instalación
```bash
cd /opt/gestion-escolar
```
```bash
cp deploy/.env.example deploy/.env
```
Edita `deploy/.env`: `DOMINIO`, `TLS` (correo de Let's Encrypt), `SMTP_*`, `GESTION_BD=gestion_produccion`, `VERSION` y `RESPALDO_DESTINATARIO` (clave pública de age).
```bash
deploy/scripts/generar-secretos.sh .env
```
Copia la clave SMTP del proveedor en `deploy/secretos/smtp_clave`.
```bash
deploy/scripts/construir.sh 0.1.0
```
```bash
docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
```
```bash
deploy/scripts/salud.sh https://gestion.escuela.example
```
Alta de la escuela y de su primer administrador (CLI del servidor, dentro del contenedor). Sustituye los valores de ejemplo por los reales sólo con autorización; la persona administradora entra con el código que recibe por correo y activa su segundo factor:
```bash
docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env exec servidor node dist-servidor/cli.mjs alta-escuela --nombre "Nombre oficial" --cct 00AAA0000A --nivel secundaria --entidad 00 --municipio "Municipio" --admin-correo administracion@escuela.example --admin-nombre "Nombre de la persona" --tipo-correo institucional
```

### Construcción con proxy corporativo
Si la red sale por un proxy con su propia CA:
```bash
HTTPS_PROXY=http://proxy:3128 CA_EXTRA=/ruta/ca.pem deploy/scripts/construir.sh 0.1.0
```
La CA sólo se usa durante la construcción y no queda en la imagen. Si Docker Hub limita las descargas, usa un espejo de las imágenes oficiales con `REGISTRO` (en las pruebas se usó `mirror.gcr.io/library`).
Si `NO_PROXY` incluye el registro de npm pero la construcción no tiene salida directa, `npm ci` falla con «Exit handler never called!» (visto en la Fase 12): limita `NO_PROXY` a `localhost,127.0.0.1` para la construcción.

### Fijar las imágenes base
Para producción, registra el resumen exacto de cada imagen base y fíjalo:
```bash
docker image inspect --format '{{index .RepoDigests 0}}' postgres:16-alpine
```
Después usa `NODE_IMAGEN=node:22.23-slim@sha256:…` y `CADDY_IMAGEN=caddy:2@sha256:…` en la construcción (`--build-arg`).

## 4. Operación diaria
| Tarea | Cómo |
|---|---|
| Estado | `docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env ps` (todo «healthy») |
| Salud externa | `deploy/scripts/salud.sh https://DOMINIO` cada 5 min desde un monitor externo |
| Registros | `docker compose … logs --since 1h servidor web` (sin datos personales) |
| Respaldo | Automático 03:10 (`RESPALDOS_PRODUCCION.md` §7) |
| Verificación de respaldos | Semanal, en el equipo con la clave privada |
| Sincronización | Revisar en la app los conflictos y rechazos de `#/sincronizacion` (Administración) |
| Crecimiento | `SELECT pg_size_pretty(pg_database_size('gestion_produccion'))`; el tamaño de `sincronizacion.cambios` |

## 5. Monitoreo y alertas (qué vigilar)
| Señal | Fuente | Alerta |
|---|---|---|
| Disponibilidad | `GET https://DOMINIO/` y `/api/salud/lista` | Cualquier respuesta distinta de 200 durante 2 revisiones seguidas |
| Base de datos | `/api/salud/lista`: 503 «sin-base-de-datos» | Inmediata |
| Migraciones pendientes | `/api/salud/lista`: 503 «migraciones-pendientes» | Inmediata (despliegue incompleto) |
| Errores del servidor | Estados 5xx en el registro de Caddy | > 1 % de las peticiones en 10 min |
| Autenticación | Ráfagas de 429 en `/api/auth/*`; errores «No se pudo enviar el correo (SMTP)» | Si el SMTP falla, nadie puede entrar: inmediata |
| Sincronización | Respuestas 4xx en `/sincronizacion`, y conflictos o rechazos visibles en la app | Revisión diaria |
| Respaldos | Código de salida de `respaldar.sh`, de la copia al NAS y de `verificar-respaldo.sh` | Inmediata |
| Certificado | `salud.sh` (vencimiento) | < 14 días |
| Recursos | `docker stats`, disco del anfitrión | Disco > 80 %; memoria del servidor cerca de 768 MB |
| Rendimiento | Duración de las peticiones en el registro de Caddy | p95 > 2 s |

La herramienta de monitoreo (Uptime Kuma, el monitor del proveedor de nube u otra) es **decisión institucional**. No registrar contraseñas ni datos personales.

## 6. Actualización (procedimiento)
**Desde la Fase 12 hay un guion que hace los pasos 2 a 7 con reversión automática** (`deploy/scripts/desplegar.sh`, ver `docs/VALIDACION_DESPLIEGUE.md`):
```bash
deploy/scripts/desplegar.sh -p gestion-prod -e deploy/.env -v NUEVA --con-pruebas
```
Verifica Compose y la configuración ANTES de tocar nada, respalda (obligatorio en producción), migra, levanta, revisa la salud y, si falla, vuelve sola a la versión anterior. Lo que sigue es el procedimiento manual equivalente.

1. **Preparar la versión:** etiqueta en git; notas de cambios; revisar si trae migraciones (`servidor/migraciones/NNNN_*.sql`) y si son compatibles hacia atrás. Las migraciones nunca se editan: sólo se agregan.
2. **Pruebas:**
   ```bash
   npm run check
   ```
   Después, con `PRUEBAS_POSTGRES_URL`, ejecuta `npm run test:servidor` y `npx playwright test`, y en preproducción `npm run test:despliegue` (ver `GUIA_PUBLICACION.md` §2).
3. **Respaldo previo y verificado:**
   ```bash
   deploy/scripts/respaldar.sh -p gestion-prod -e deploy/.env
   ```
   Después `verificar-respaldo.sh` en el equipo con la clave privada.
4. **Construir y desplegar:**
   ```bash
   deploy/scripts/construir.sh NUEVA
   ```
   Cambia `VERSION=NUEVA` en `deploy/.env` y levanta:
   ```bash
   docker compose -p gestion-prod -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
   ```
   El servidor aplica las migraciones pendientes al arrancar, con un candado: una sola vez.
5. **Verificar:**
   ```bash
   deploy/scripts/salud.sh https://DOMINIO
   ```
   Después entra con una cuenta de prueba, abre una lista y revisa `#/sincronizacion`.
6. **PWA:** cada dispositivo ve «Hay una nueva versión» y decide cuándo actualizar.
   - Lo guardado y la cola por enviar se conservan (✓ DEP-06).
   - Si hay una lista sin guardar, se pide confirmación.
   - Los cambios del esquema local se aplican con `version(n+1)` y `upgrade()`, que conservan los datos.
7. **Revertir, si algo falla:** vuelve `VERSION` a la anterior y ejecuta `up -d --no-build` (las imágenes anteriores siguen en el equipo).
   - Si la versión nueva aplicó una migración **no compatible** con la anterior, no basta con volver la imagen: hay que restaurar el respaldo previo **en una base nueva** y cambiar a ella (`PLAN_RECUPERACION.md` §3).
   - Por eso las migraciones deben ser compatibles hacia atrás siempre que sea posible.

## 7. Rotación de secretos
| Secreto | Procedimiento | Efecto |
|---|---|---|
| `better_auth_secret` | Nuevo valor en el archivo y reiniciar `servidor` | Se cierran todas las sesiones: todos vuelven a entrar |
| Clave del usuario de la base | `ALTER ROLE gestion PASSWORD '…'` (como `postgres_admin`); actualizar `pg_gestion` y `database_url`; reiniciar `servidor` | Ninguno para los usuarios |
| Clave SMTP | Actualizar `smtp_clave`; reiniciar `servidor` | Ninguno |
| Par de claves de age | Generar uno nuevo; cambiar `RESPALDO_DESTINATARIO`; **conservar la clave privada anterior** mientras existan respaldos cifrados con ella | Ninguno |

## 8. Entornos
- **Producción** es el proyecto `gestion-prod`; **preproducción**, el proyecto `gestion-preprod`.
- Nunca se comparten volúmenes, secretos ni archivos de entorno entre ellos.
- Reiniciar la preproducción a un estado conocido (sólo funciona con `MODO=preproduccion` y una base `gestion_piloto*`):
  ```bash
  deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env
  ```
