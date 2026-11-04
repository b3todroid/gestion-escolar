#!/usr/bin/env bash
# RESTAURA un respaldo cifrado en una base NUEVA del entorno indicado (Fase 11). Nunca sobrescribe
# ni borra la base vigente: la nueva se valida y después se cambia con un procedimiento explícito
# (docs/PLAN_RECUPERACION.md). Antes de restaurar en producción hace un respaldo de lo actual.
#   deploy/scripts/restaurar.sh -p PROYECTO -e ENTORNO -a ARCHIVO.tar.age -i IDENTIDAD_AGE -n BASE_NUEVA \
#       [-c compose-extra.yml] [--autorizado "Nombre y cargo"]   (obligatorio en MODO=produccion)
set -euo pipefail
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
PROYECTO=""; ENTORNO=""; ARCHIVO=""; IDENTIDAD=""; NUEVA=""; EXTRA=(); PASAR=(); AUTORIZADO=""
while [ $# -gt 0 ]; do case "$1" in
  -p) PROYECTO="$2"; shift 2;; -e) ENTORNO="$2"; shift 2;; -a) ARCHIVO="$2"; shift 2;; -i) IDENTIDAD="$2"; shift 2;;
  -n) NUEVA="$2"; shift 2;; -c) EXTRA+=(-f "$2"); PASAR+=(-c "$2"); shift 2;; --autorizado) AUTORIZADO="$2"; shift 2;; *) echo "Opción desconocida: $1" >&2; exit 2;; esac; done
[ -n "$PROYECTO" ] && [ -f "$ENTORNO" ] && [ -f "$ARCHIVO" ] && [ -f "$IDENTIDAD" ] && [ -n "$NUEVA" ] || { sed -n '2,7p' "$0"; exit 2; }
set -a; . "$ENTORNO"; set +a
[[ "$NUEVA" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || { echo "Nombre de base inválido." >&2; exit 2; }
[ "$NUEVA" != "${GESTION_BD:?}" ] || { echo "La base nueva no puede ser la vigente (${GESTION_BD}): nunca se sobrescribe." >&2; exit 1; }
if [ "${MODO:-}" = "produccion" ]; then
  [ -n "$AUTORIZADO" ] || { echo "En producción se requiere --autorizado \"Nombre y cargo\" (queda en el registro)." >&2; exit 1; }
  echo "Respaldo previo de lo actual (obligatorio en producción)…"
  "$AQUI/scripts/respaldar.sh" -p "$PROYECTO" -e "$ENTORNO" "${PASAR[@]}" >/dev/null || { echo "No se pudo respaldar lo actual: no se restaura." >&2; exit 1; }
fi
DC=(docker compose -p "$PROYECTO" -f "$AQUI/docker-compose.yml" "${EXTRA[@]}" --env-file "$ENTORNO")
TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
if [ -f "$ARCHIVO.sha256" ]; then ( cd "$(dirname "$ARCHIVO")" && sha256sum -c "$(basename "$ARCHIVO").sha256" >/dev/null ) || { echo "Suma SHA-256 incorrecta." >&2; exit 1; }; fi
age -d -i "$IDENTIDAD" -o "$TMP/r.tar" "$ARCHIVO" 2>/dev/null || { echo "No se pudo descifrar: archivo alterado o identidad equivocada." >&2; exit 1; }
tar -C "$TMP" -xf "$TMP/r.tar"
USUARIO="${GESTION_USUARIO:-gestion}"
EXISTE="$("${DC[@]}" exec -T db psql -U postgres_admin -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname = '$NUEVA'")"
[ -z "$EXISTE" ] || { echo "La base $NUEVA ya existe: elige otro nombre (nunca se sobrescribe)." >&2; exit 1; }
"${DC[@]}" exec -T db psql -q -U postgres_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$NUEVA\" OWNER \"$USUARIO\" TEMPLATE template0;"
"${DC[@]}" exec -T db sh -c "cat > /tmp/restaurar.dump" < "$TMP/base.dump"
"${DC[@]}" exec -T db pg_restore -U postgres_admin -d "$NUEVA" --exit-on-error --no-owner --role="$USUARIO" /tmp/restaurar.dump
"${DC[@]}" exec -T db rm -f /tmp/restaurar.dump
"${DC[@]}" exec -T db psql -q -U postgres_admin -d postgres -c "COMMENT ON DATABASE \"$NUEVA\" IS 'Restaurada $(date -u +%FT%TZ) desde $(basename "$ARCHIVO")${AUTORIZADO:+ · autorizó: $AUTORIZADO}'"
echo "Restaurado en la base NUEVA «$NUEVA». La base vigente «$GESTION_BD» no se tocó."
echo "Siguiente paso (manual y documentado): validar «$NUEVA» y, si procede, cambiar GESTION_BD/database_url y reiniciar el servidor (docs/PLAN_RECUPERACION.md)."
