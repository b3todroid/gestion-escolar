#!/usr/bin/env bash
# Reinicia la PREPRODUCCIÓN a un estado conocido (Fase 11): borra SUS volúmenes y vuelve a cargar DEMO-001.
# Candados: sólo con un archivo de entorno MODO=preproduccion, base «gestion_piloto*» y proyecto «gestion-preprod*».
#   deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env [PROYECTO]
set -euo pipefail
cd "$(dirname "$0")/../.."
ENTORNO="${1:?Uso: $0 ARCHIVO_ENTORNO [PROYECTO]}"; PROYECTO="${2:-gestion-preprod}"
set -a; . "$ENTORNO"; set +a
[ "${MODO:-}" = "preproduccion" ] || { echo "Sólo para MODO=preproduccion. No se hizo nada." >&2; exit 1; }
[[ "${GESTION_BD:-}" == gestion_piloto* ]] || { echo "Sólo con una base gestion_piloto*. No se hizo nada." >&2; exit 1; }
[[ "$PROYECTO" == gestion-preprod* ]] || { echo "Sólo con un proyecto gestion-preprod*. No se hizo nada." >&2; exit 1; }
DC=(docker compose -p "$PROYECTO" -f deploy/docker-compose.yml -f deploy/compose.preproduccion.yml --env-file "$ENTORNO")
"${DC[@]}" down -v --remove-orphans
"${DC[@]}" up -d --no-build
for _ in $(seq 1 60); do curl -sk -o /dev/null -w '%{http_code}' "${URL_PUBLICA:-https://${DOMINIO}}/api/salud/lista" 2>/dev/null | grep -q 200 && break; sleep 2; done
"${DC[@]}" --profile carga-demo run --rm carga-demo
echo "Preproducción reiniciada con DEMO-001 (datos ficticios)."
