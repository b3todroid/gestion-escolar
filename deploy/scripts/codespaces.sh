#!/usr/bin/env bash
# Levanta la PREPRODUCCIÓN DE PRUEBA dentro de un GitHub Codespace (Fase 12). Sólo datos FICTICIOS (DEMO-001).
#   bash deploy/scripts/codespaces.sh            (lo ejecuta solo el codespace al iniciar; se puede repetir)
#   bash deploy/scripts/codespaces.sh --reiniciar (borra la base de PRUEBA y vuelve a cargar DEMO-001)
# Idempotente: la primera vez compila las imágenes, genera secretos y carga DEMO-001 (5–10 min);
# después sólo levanta los contenedores. Nunca usa datos reales ni publica la base o la API.
set -euo pipefail
cd "$(dirname "$0")/../.."
REINICIAR=0; [ "${1:-}" = "--reiniciar" ] && REINICIAR=1
mkdir -p deploy/registro
exec > >(tee -a deploy/registro/codespaces.log) 2>&1
echo "== $(date -u +%FT%TZ) · preproducción de prueba en Codespaces"

if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-${PUERTO_HTTP:-8080}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  [ -n "${URL_PUBLICA:-}" ] || { echo "Esto es para GitHub Codespaces (falta CODESPACE_NAME). Para probarlo fuera, define URL_PUBLICA."; exit 1; }
  URL="$URL_PUBLICA"
fi
PROYECTO="${PROYECTO:-gestion-codespaces}"
VERSION="${VERSION:-codespaces}"
ENV=deploy/codespaces.env   # fuera de git (deploy/*.env)

for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null 2>&1 || { echo "Docker no arrancó en el codespace. Recarga la página y vuelve a intentarlo."; exit 1; }

cat > "$ENV" <<EOF
# Generado por deploy/scripts/codespaces.sh — PRUEBAS con datos FICTICIOS. No editar a mano.
MODO=preproduccion
DOMINIO=localhost
URL_PUBLICA=$URL
TLS=internal
VERSION=$VERSION
GESTION_BD=gestion_piloto_codespaces
GESTION_USUARIO=gestion
SMTP_HOST=correo-prueba
SMTP_PUERTO=1025
SMTP_SEGURIDAD=ninguna
SMTP_USUARIO=
SMTP_CLAVE_FILE=
SMTP_REMITENTE="Gestión Escolar PRUEBAS <no-responder@pruebas.local>"
PUERTO_HTTP=${PUERTO_HTTP:-8080}
PUERTO_HTTPS=${PUERTO_HTTPS:-8443}
PUERTO_BUZON=${PUERTO_BUZON:-8025}
REGISTRO=${REGISTRO:-mirror.gcr.io/library}
REGISTRO_EXTRA=${REGISTRO_EXTRA:-mirror.gcr.io}
ESCALA_DEMO=0.2
LIMITE_CODIGOS_POR_CORREO=20
EOF
DC=(docker compose -p "$PROYECTO" -f deploy/docker-compose.yml -f deploy/compose.preproduccion.yml -f deploy/compose.codespaces.yml --env-file "$ENV")

echo "== 1 · secretos (sólo en este codespace; nunca en git)"
bash deploy/scripts/generar-secretos.sh codespaces.env

if ! docker image inspect "gestion-escolar/servidor:$VERSION" "gestion-escolar/web:$VERSION" >/dev/null 2>&1 || [ "${RECONSTRUIR:-0}" = 1 ]; then
  echo "== 2 · compilando imágenes (la primera vez tarda varios minutos)"
  bash deploy/scripts/construir.sh "$VERSION" "$(grep '^REGISTRO=' "$ENV" | cut -d= -f2)"
else
  echo "== 2 · imágenes ya compiladas"
fi

if [ $REINICIAR = 1 ]; then echo "== · borrando la base de PRUEBA"; "${DC[@]}" down -v --remove-orphans; fi
echo "== 3 · levantando contenedores"
"${DC[@]}" up -d --no-build
for _ in $(seq 1 90); do curl -sf -o /dev/null "http://127.0.0.1:${PUERTO_HTTP:-8080}/api/salud/lista" && break; sleep 2; done
curl -sf "http://127.0.0.1:${PUERTO_HTTP:-8080}/api/salud/lista" >/dev/null || { echo "La API no respondió. Revisa: ${DC[*]} logs servidor"; exit 1; }

echo "== 4 · datos de DEMOSTRACIÓN (DEMO-001, ficticios)"
hay="$("${DC[@]}" exec -T db sh -c 'psql -X -t -A -U "$POSTGRES_USER" -d gestion_piloto_codespaces -c "select count(*) from escolar.escuelas"' 2>/dev/null | tr -d '[:space:]' || true)"
if [ "${hay:-0}" = 0 ]; then "${DC[@]}" --profile carga-demo run --rm carga-demo; else echo "· DEMO-001 ya cargada"; fi

# Intento de hacer PÚBLICO el puerto 8080 (si el permiso del codespace no alcanza, se hace a mano).
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null; then
  gh codespace ports visibility "${PUERTO_HTTP:-8080}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 && echo "· puerto ${PUERTO_HTTP:-8080} público" || echo "· Haz PÚBLICO el puerto ${PUERTO_HTTP:-8080} a mano: pestaña «Puertos» → mantén presionado 8080 → Visibilidad del puerto → Público"
fi

cat <<EOF

================================================================
 LISTO · Gestión Escolar — PRUEBAS (datos ficticios DEMO-001)
 Abre en cualquier teléfono, tableta o computadora:
   $URL
 Cuentas de prueba (el código de 6 dígitos llega al BUZÓN DE PRUEBA):
   administrador.piloto@ejemplo.test   direccion.piloto@ejemplo.test
   prefectura.piloto@ejemplo.test      docente.uno.piloto@ejemplo.test
   docente.dos.piloto@ejemplo.test
 Buzón de prueba (sólo tú, con tu sesión de GitHub): pestaña «Puertos» → 8025
 Apaga el codespace al terminar para no gastar tus horas gratuitas.
================================================================
EOF
