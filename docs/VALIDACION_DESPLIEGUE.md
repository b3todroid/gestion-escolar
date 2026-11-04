# Validación del despliegue y de la reversión — Gestión Escolar (Fase 12)

Todo lo de este documento se ejecutó **en este equipo**, contra la preproducción local en contenedores (`gestion-preprod`), con datos **ficticios**. Ningún paso se conectó a producción ni a un servidor externo.

## 1. Guion de despliegue: `deploy/scripts/desplegar.sh`
```bash
deploy/scripts/desplegar.sh -p PROYECTO -e ARCHIVO_ENTORNO -v VERSION [-c compose-extra.yml] [--con-pruebas] [--usar-imagenes] [--sin-respaldo] [--registro R]
```
| Paso | Qué hace | Si falla |
|---|---|---|
| 0 | `docker compose config` válido | No se toca nada |
| 1–2 | Árbol de git limpio (en producción es OBLIGATORIO); con `--con-pruebas`, `npm run check` | No se toca nada |
| 3 | Compila las imágenes de `VERSION` (`construir.sh`) o usa las existentes | No se toca nada |
| 4 | **Verifica la configuración con la imagen NUEVA sin arrancarla** (`cli verificar-configuracion`): configuración del modo, conexión a la base, migraciones aplicadas que la imagen no conoce (versión más vieja que la base) o con huella distinta | No se toca nada |
| 5 | Respaldo cifrado previo (obligatorio en producción; `--sin-respaldo` se rechaza en producción) y migraciones | No se levanta la versión nueva |
| 6 | `up -d --no-build servidor web` con la versión nueva | → 9 |
| 7–8 | Espera «healthy» y ejecuta `salud.sh` (PWA, API + base, HSTS, buzón de desarrollo cerrado) | → 9 |
| 9 | **Reversión**: levanta la versión anterior, devuelve `VERSION` en el archivo de entorno y vuelve a comprobar la salud. Avisa si se aplicaron migraciones no compatibles (restaurar en base nueva: `PLAN_RECUPERACION.md`) | Sale con error |

- Al terminar bien, escribe `VERSION=nueva` en el archivo de entorno (así un `up` posterior no regresa a la anterior).
- Cada paso queda en `deploy/registro/despliegues.log` (fuera del repositorio).

## 2. Casos ejecutados (2026-11-04)
| Caso | Resultado medido |
|---|---|
| 0.1.0-preprod → 0.2.0-preprod (compilando imágenes, con respaldo previo) | ✓ DESPLEGADO, sano; 39 s en total |
| 0.2.0 → **0.2.1-roto** (imagen cuyo servidor termina con error al arrancar) | ✓ Falló la salud en el paso 7 → **REVERTIDO a 0.2.0 sano** automáticamente; `VERSION` restaurada |
| Archivo de Compose inválido | ✓ Rechazado en el paso 0; nada cambió |
| `MODO=produccion` con la base `gestion_piloto_preprod` | ✓ Rechazado en el paso 4 («producción no puede apuntar a una base de pruebas»); nada cambió. Antes, rechazado en el paso 1 por árbol de git sin confirmar |
| 0.2.0 → 0.2.2-preprod (compilando, respaldo previo cifrado) | ✓ DESPLEGADO en 26 s; es la versión vigente de la preproducción |

## 3. Verificación continua (CI): `deploy/ci/verificacion.yml` — INACTIVA
- Tres trabajos: aplicación (`npm run check`, `npm audit --omit=dev`, Playwright), servidor (PostgreSQL de servicio, `test:servidor`, `test:e2e:servidor`) e imágenes (`docker build` y `compose config`).
- **No despliega, no publica imágenes y no tiene secretos.** Está fuera de `.github/workflows/` a propósito: una persona autorizada decide activarla.
- **Nada se conectó a producción** (no existe).

## 4. Validación del entorno de preproducción
| Comprobación | Cómo | Resultado |
|---|---|---|
| Salud | `deploy/scripts/salud.sh https://localhost:8443 --inseguro` | ✓ PWA, API + base, HSTS, buzón cerrado |
| Seguridad | `deploy/scripts/verificar-seguridad.sh` (§ `CONFIGURACION_PREPRODUCCION.md` 5) | ✓ 0 fallas |
| Respaldo → verificación → restauración | `respaldar.sh` → `verificar-respaldo.sh` → `restaurar.sh` | ✓ ver `FASE_12_PREPRODUCCION.md` §6 |
| Pruebas | `npm run test:despliegue` (21) y `npm run test:preproduccion:flujo` (17) | ✓ todas |

## 5. Lo que NO se validó
- Un despliegue en un servidor **externo** (no existe: requiere autorización y contratación).
- Certificados públicos (Let's Encrypt) y DNS real: en preproducción local se usa la autoridad interna de Caddy (`TLS=internal`).
- SMTP institucional real: se usó Mailpit (buzón de prueba local).
