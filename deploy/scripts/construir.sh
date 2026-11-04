#!/usr/bin/env bash
# Construye las imágenes servidor y web con una etiqueta de versión (Fase 11).
#   deploy/scripts/construir.sh VERSION [REGISTRO]
# Variables opcionales (proxy corporativo): HTTPS_PROXY, HTTP_PROXY, NO_PROXY y CA_EXTRA=/ruta/ca.pem.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:?Uso: $0 VERSION [REGISTRO]}"; REGISTRO="${2:-${REGISTRO:-docker.io/library}}"
ARGS=(--build-arg "REGISTRO=$REGISTRO" --build-arg "VERSION_APP=$VERSION")
[ -n "${HTTPS_PROXY:-}" ] && ARGS+=(--network host --build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}" --build-arg "NO_PROXY=${NO_PROXY:-}")
[ -n "${CA_EXTRA:-}" ] && ARGS+=(--secret "id=ca_extra,src=$CA_EXTRA")
for objetivo in servidor web; do
  docker build -f deploy/Dockerfile --target "$objetivo" "${ARGS[@]}" -t "gestion-escolar/$objetivo:$VERSION" .
done
docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep "gestion-escolar/.*:$VERSION"
