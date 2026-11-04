#!/usr/bin/env bash
# Genera los secretos del despliegue en deploy/secretos/ (excluido de git). Fase 11.
# No sobrescribe secretos existentes: rotarlos es un procedimiento aparte (docs/OPERACION_SERVIDOR.md).
# Uso: deploy/scripts/generar-secretos.sh [archivo-de-entorno]   (por omisión deploy/.env)
set -euo pipefail
cd "$(dirname "$0")/.."
ENTORNO="${1:-.env}"
[ -f "$ENTORNO" ] || { echo "No existe $ENTORNO (copia .env.example)." >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$ENTORNO"; set +a
: "${GESTION_BD:?}" ; USUARIO="${GESTION_USUARIO:-gestion}"
umask 077
mkdir -p secretos
aleatorio() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
crear() { [ -s "secretos/$1" ] && { echo "· $1 ya existe (no se cambia)"; return; }; printf '%s' "$2" > "secretos/$1"; echo "· $1 creado"; }
crear pg_superusuario "$(aleatorio)"
crear pg_gestion "$(aleatorio)"
crear better_auth_secret "$(aleatorio)"
crear database_url "postgres://${USUARIO}:$(cat secretos/pg_gestion)@db:5432/${GESTION_BD}"
# La clave SMTP la entrega el proveedor de correo: se copia a mano. Si no hay, queda vacía.
[ -e secretos/smtp_clave ] || { : > secretos/smtp_clave; echo "· smtp_clave vacío: escribe la clave del proveedor SMTP (o déjalo vacío si no usa autenticación)"; }
# La CARPETA es privada (700: ninguna otra cuenta del servidor entra). Los archivos son 644 para que los
# procesos SIN privilegios de los contenedores (postgres, node) puedan leer el archivo montado.
chmod 700 secretos; chmod 644 secretos/*
echo "Secretos listos en deploy/secretos/ (carpeta 700). Respáldalos FUERA del servidor, separados de los respaldos de datos."
