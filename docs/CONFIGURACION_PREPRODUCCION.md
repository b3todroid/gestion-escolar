# Configuración de la preproducción — Gestión Escolar (Fase 12)

Hay **dos** preproducciones posibles. Sólo la **A** existe hoy.

| | A. Preproducción LOCAL (existe) | B. Preproducción INSTITUCIONAL (NO existe) |
|---|---|---|
| Dónde | Contenedores en un equipo de trabajo | Máquina virtual del proveedor que se autorice |
| URL | `https://localhost:8443` (sólo ese equipo) | p. ej. `https://preprod.DOMINIO` (por decidir) |
| Certificado | Autoridad interna de Caddy (`TLS=internal`): los navegadores no confían en él | Let's Encrypt automático (`TLS=` vacío) |
| Correo | Mailpit (buzón de prueba, `http://127.0.0.1:8025`) | SMTP institucional o de envío, cifrado |
| Datos | DEMO-001, ficticios | DEMO-001, ficticios (nunca reales) |
| Sirve para | Pruebas automáticas, ensayo de despliegue y reversión | Pruebas con **dispositivos físicos** y personas del piloto |
| Proyecto de Compose | `gestion-preprod` | `gestion-preprod` (en otra máquina que producción) |

## 1. Componentes (los mismos archivos que producción: `deploy/`)
- `web` — Caddy 2: HTTPS, HTTP→HTTPS, cabeceras de seguridad, compresión, PWA estática y `/api` hacia el servidor. **Único servicio que publica puertos.**
- `servidor` — Node 22, API y Better Auth; secretos por `*_FILE`; usuario `node`; 768 MB máx.
- `db` — PostgreSQL 16 en red interna **sin salida**; sin puertos publicados.
- `correo-prueba` — Mailpit (sólo preproducción local), publicado sólo en `127.0.0.1`.
- Archivos: `docker-compose.yml` + `compose.preproduccion.yml` + `preproduccion.env` (copia de `preproduccion.env.example`, fuera del repositorio) + `deploy/secretos/` (fuera del repositorio).

## 2. Variables de la preproducción (`deploy/preproduccion.env`)
| Variable | Valor local | Institucional |
|---|---|---|
| `MODO` | `preproduccion` (exige HTTPS y SMTP; abre `/api/desarrollo/*` NUNCA) | igual |
| `DOMINIO`, `URL_PUBLICA` | `localhost`, `https://localhost:8443` | dominio real |
| `TLS` | `internal` | vacío (Let's Encrypt) |
| `GESTION_BD` | `gestion_piloto_preprod` (los candados de limpieza sólo actúan en `gestion_piloto*`) | igual |
| `SMTP_*` | `correo-prueba:1025`, sin cifrado | proveedor real con `SMTP_SEGURIDAD=tls` o `starttls` |
| `LIMITE_CODIGOS_POR_CORREO` | `20` (pruebas automáticas) | `3`–`5` |
| `REGISTRO`, `REGISTRO_EXTRA` | `mirror.gcr.io/library`, `mirror.gcr.io` si Docker Hub limita | según el proveedor |
| `RESPALDO_DESTINATARIO`, `RESPALDO_DIR` | clave pública age de PRUEBA; carpeta fuera del repositorio | clave pública institucional; copia al NAS |

## 3. Levantar y reiniciar (local)
Pasos completos en `GUIA_PUBLICACION.md` §2. Resumen:
```bash
deploy/scripts/generar-secretos.sh preproduccion.env
```
```bash
deploy/scripts/desplegar.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml -v 0.2.2-preprod
```
```bash
deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env
```
`reiniciar-preproduccion.sh` (candados: `MODO=preproduccion`, base `gestion_piloto*` y proyecto `gestion-preprod*`) borra los contenedores y volúmenes **de la preproducción**, la levanta de nuevo y carga DEMO-001 (perfil `carga-demo` de Compose) con sus cinco cuentas ficticias (`administrador`, `direccion`, `prefectura`, `docente.uno`, `docente.dos` `.piloto@ejemplo.test`).

## 4. Registros y salud
```bash
docker compose -p gestion-preprod -f deploy/docker-compose.yml -f deploy/compose.preproduccion.yml --env-file deploy/preproduccion.env logs --tail 100 servidor web
```
```bash
deploy/scripts/salud.sh https://localhost:8443 --inseguro
```
- Los registros del servidor no incluyen correos, nombres, códigos ni tokens (`SEGURIDAD_PRODUCCION.md` §10).
- Docker rota los registros (`json-file`, tamaño máximo definido en Compose).
- Auditoría de accesos: `acceso.auditoria` (sólo agregar).

## 5. Verificación de seguridad (sólo lectura)
```bash
PUERTO_HTTP=8080 deploy/scripts/verificar-seguridad.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml -u https://localhost:8443 --inseguro
```
Revisa TLS (sin 1.0/1.1; con 1.2/1.3), HTTP→HTTPS, puertos publicados, secretos (sólo `*_FILE`, ausentes de las imágenes y del repositorio), usuario no root, cabeceras, rutas sin sesión, `/api/salud` sin configuración y auditoría sin datos personales. Sale con error si algo falla.

## 6. Respaldos
```bash
deploy/scripts/respaldar.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml
```
```bash
deploy/scripts/verificar-respaldo.sh ARCHIVO.tar.age IDENTIDAD_AGE mirror.gcr.io/library/postgres:16-alpine
```
```bash
deploy/scripts/restaurar.sh -p gestion-preprod -e deploy/preproduccion.env -c deploy/compose.preproduccion.yml -a ARCHIVO.tar.age -i IDENTIDAD_AGE -n gestion_piloto_preprod_restaurada
```
Un respaldo **no cuenta** como válido hasta pasar `verificar-respaldo.sh`.

## 7. Pruebas contra la preproducción
```bash
npm run test:despliegue
```
```bash
npm run test:preproduccion:flujo
```
- `test:despliegue` (21): DEP-01..08, dispositivos emulados (4), multiusuario (5) y rendimiento medido (4; resultados en `test-results/rendimiento-preproduccion.json`).
- `test:preproduccion:flujo` (17): las pruebas funcionales de la app, sin cambios, servidas desde la preproducción por HTTPS.
- Las pruebas usan la hora REAL; DEP-05 consume el límite de códigos de la IP durante un minuto.

## 8. Preproducción institucional (B): pasos cuando se autorice
1. Autorizar proveedor, región, tamaño y costo (`COMPARATIVA_NUBE_NAS_HIBRIDO.md`), y quién administra.
2. Registrar un subdominio (`preprod.…`) y apuntar un registro A/AAAA a la IP de la máquina.
3. Máquina: Ubuntu LTS, Docker y Compose v2, firewall con sólo 22 (restringido), 80 y 443; acceso SSH con llave.
4. Copiar el repositorio (etiqueta de la versión), crear `deploy/preproduccion.env` con `DOMINIO`, `URL_PUBLICA`, `TLS=` vacío, SMTP real cifrado, y **sin** `compose.preproduccion.yml` si no se quiere Mailpit (o con él sólo si el buzón queda en `127.0.0.1` y se consulta por túnel SSH).
5. `generar-secretos.sh`, `desplegar.sh … --con-pruebas`, y cargar DEMO-001 con el perfil `carga-demo` (`docker compose … --profile carga-demo run --rm carga-demo`).
6. `salud.sh https://preprod.DOMINIO` (sin `--inseguro`), `verificar-seguridad.sh`, y respaldo → verificación → restauración.
7. Pruebas físicas: `PRUEBAS_MULTIDISPOSITIVO.md` (protocolo).
