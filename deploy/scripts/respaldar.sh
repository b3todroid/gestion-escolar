#!/usr/bin/env bash
# Respaldo CIFRADO de la base de datos (Fase 11).
#   deploy/scripts/respaldar.sh -p PROYECTO -e ARCHIVO_ENTORNO [-c COMPOSE_EXTRA]
# - pg_dump en formato personalizado + manifiesto (conteos por tabla, migraciones, versión, fecha).
# - Cifrado con la clave PÚBLICA age (RESPALDO_DESTINATARIO): el servidor cifra pero no puede descifrar.
# - Suma SHA-256 del archivo cifrado; retención por días (sólo borra respaldos de este script).
# - Sale con error ante cualquier fallo: el monitoreo debe alertar (docs/OPERACION_SERVIDOR.md).
# Nunca escribe el respaldo sin cifrar fuera de una carpeta temporal privada.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
PROYECTO=""; ENTORNO=""; EXTRA=()
while getopts "p:e:c:" o; do case "$o" in p) PROYECTO="$OPTARG";; e) ENTORNO="$OPTARG";; c) EXTRA+=(-f "$OPTARG");; *) exit 2;; esac; done
[ -n "$PROYECTO" ] && [ -f "$ENTORNO" ] || { echo "Uso: $0 -p PROYECTO -e ARCHIVO_ENTORNO [-c compose-extra.yml]" >&2; exit 2; }
set -a; . "$ENTORNO"; set +a
: "${GESTION_BD:?}" "${RESPALDO_DESTINATARIO:?Define RESPALDO_DESTINATARIO (clave pública age)}" "${RESPALDO_DIR:?}"
command -v age >/dev/null || { echo "Falta age (https://age-encryption.org)." >&2; exit 1; }
DC=(docker compose -p "$PROYECTO" -f "$AQUI/docker-compose.yml" "${EXTRA[@]}" --env-file "$ENTORNO")

FECHA="$(date -u +%Y%m%dT%H%M%SZ)"
NOMBRE="gestion-${GESTION_BD}-${FECHA}"
mkdir -p "$RESPALDO_DIR"
TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT

# 1. Volcado consistente (una sola transacción de lectura) y manifiesto.
"${DC[@]}" exec -T db pg_dump -U postgres_admin -d "$GESTION_BD" -Fc --compress=6 > "$TMP/base.dump"
"${DC[@]}" exec -T db psql -U postgres_admin -d "$GESTION_BD" -At -v ON_ERROR_STOP=1 -c "
  SELECT json_build_object(
    'formato', 'gestion-escolar-respaldo-servidor', 'version', 1, 'base', current_database(), 'creado', now(),
    'postgres', current_setting('server_version'),
    'migraciones', (SELECT json_agg(json_build_object('nombre', nombre, 'huella', huella) ORDER BY nombre) FROM sistema.migraciones),
    'conteos', (SELECT json_object_agg(t.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', t.schemaname, t.relname), false, true, '')))[1]::text::bigint ORDER BY t.relname)
                FROM pg_stat_user_tables t WHERE t.schemaname IN ('escolar', 'acceso', 'sincronizacion'))
  )" > "$TMP/manifiesto.json"
[ -s "$TMP/base.dump" ] && [ -s "$TMP/manifiesto.json" ] || { echo "Respaldo vacío: se aborta." >&2; exit 1; }

# 2. Empaquetar y cifrar (sólo el archivo cifrado sale de la carpeta temporal).
tar -C "$TMP" -cf "$TMP/$NOMBRE.tar" base.dump manifiesto.json
age -r "$RESPALDO_DESTINATARIO" -o "$RESPALDO_DIR/$NOMBRE.tar.age" "$TMP/$NOMBRE.tar"
( cd "$RESPALDO_DIR" && sha256sum "$NOMBRE.tar.age" > "$NOMBRE.tar.age.sha256" )

# 3. Retención: sólo archivos de este script y más viejos que RESPALDO_RETENER_DIAS.
DIAS="${RESPALDO_RETENER_DIAS:-35}"
find "$RESPALDO_DIR" -maxdepth 1 -type f -name "gestion-${GESTION_BD}-*.tar.age*" -mtime +"$DIAS" -print -delete | sed 's/^/· retirado por antigüedad: /'

echo "Respaldo cifrado: $RESPALDO_DIR/$NOMBRE.tar.age ($(du -h "$RESPALDO_DIR/$NOMBRE.tar.age" | cut -f1))"
echo "IMPORTANTE: copia también este archivo FUERA del servidor (NAS u otra ubicación) y verifica que se restaura (verificar-respaldo.sh)."
