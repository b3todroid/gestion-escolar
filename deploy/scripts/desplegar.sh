#!/usr/bin/env bash
# DESPLIEGUE REPRODUCIBLE con reversión automática (Fase 12).
#   deploy/scripts/desplegar.sh -p PROYECTO -e ARCHIVO_ENTORNO -v VERSION [-c compose-extra.yml]
#       [--con-pruebas] [--usar-imagenes] [--sin-respaldo] [--registro REGISTRO]
# Pasos:
#   1. Validar el código (árbol de git limpio; con --con-pruebas: npm run check).
#   2. Ejecutar pruebas (con --con-pruebas) — la imagen además vuelve a verificar tipos al compilar.
#   3. Compilar las imágenes de VERSION (o usarlas si ya existen: --usar-imagenes).
#   4. Verificar la configuración con la imagen NUEVA, sin arrancarla (cli verificar-configuracion).
#   5. Respaldo previo (obligatorio en producción) y migraciones compatibles con la imagen nueva.
#   6. Desplegar (servidor y web con VERSION).
#   7. Comprobar la salud (comprobaciones de Docker + /api/salud/lista).
#   8. Pruebas rápidas (salud.sh: PWA, API, base, HSTS, buzón cerrado).
#   9. Si 7 u 8 fallan: REVERTIR a la versión anterior y comprobar su salud.
# No toca la base de datos para revertir: si una migración no compatible ya se aplicó, el script lo
# dice y remite a docs/PLAN_RECUPERACION.md §4 (restaurar el respaldo previo en una base NUEVA).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$RAIZ"
PROYECTO=""; ENTORNO=""; VERSION_NUEVA=""; EXTRA=(); PASAR=(); PRUEBAS=0; USAR=0; RESPALDO=1; REG="${REGISTRO:-docker.io/library}"
while [ $# -gt 0 ]; do case "$1" in
  -p) PROYECTO="$2"; shift 2;; -e) ENTORNO="$2"; shift 2;; -v) VERSION_NUEVA="$2"; shift 2;;
  -c) EXTRA+=(-f "$2"); PASAR+=(-c "$2"); shift 2;; --con-pruebas) PRUEBAS=1; shift;; --usar-imagenes) USAR=1; shift;;
  --sin-respaldo) RESPALDO=0; shift;; --registro) REG="$2"; shift 2;; *) echo "Opción desconocida: $1" >&2; exit 2;; esac; done
[ -n "$PROYECTO" ] && [ -f "$ENTORNO" ] && [ -n "$VERSION_NUEVA" ] || { sed -n '2,5p' "$0"; exit 2; }
set -a; . "$ENTORNO"; set +a
[ "${MODO:-}" = "produccion" ] && [ "$RESPALDO" = 0 ] && { echo "En producción el respaldo previo es obligatorio." >&2; exit 1; }
DC=(docker compose -p "$PROYECTO" -f deploy/docker-compose.yml "${EXTRA[@]}" --env-file "$ENTORNO")
URL="${URL_PUBLICA:-https://${DOMINIO}}"; INSEGURO=(); [ "${TLS:-}" = "internal" ] && INSEGURO=(--inseguro)
mkdir -p deploy/registro
REGISTRO_DESPLIEGUE="deploy/registro/despliegues.log"
anotar() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$PROYECTO" "$VERSION_NUEVA" "$1" >> "$REGISTRO_DESPLIEGUE"; echo "== $1"; }

if ! errores="$("${DC[@]}" config --quiet 2>&1)"; then anotar "0 · configuración de Compose INVÁLIDA: no se despliega (nada cambió)"; echo "$errores" >&2; exit 1; fi
ANTERIOR="$("${DC[@]}" ps --format '{{.Image}}' servidor 2>/dev/null | sed -n 's#.*:##p' | head -1)"
anotar "inicio (versión anterior: ${ANTERIOR:-ninguna})"

# 1-2. Validar y probar
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then echo "! El árbol de git tiene cambios sin confirmar: el despliegue no corresponde a una versión registrada." >&2; [ "${MODO:-}" = "produccion" ] && exit 1; fi
if [ "$PRUEBAS" = 1 ]; then npm run check >/dev/null && anotar "1-2 · validación y pruebas: correctas"; else anotar "1-2 · pruebas omitidas (se validan tipos al compilar)"; fi

# 3. Compilar
if [ "$USAR" = 1 ]; then
  docker image inspect "gestion-escolar/servidor:$VERSION_NUEVA" "gestion-escolar/web:$VERSION_NUEVA" >/dev/null || { echo "No existen las imágenes $VERSION_NUEVA." >&2; exit 1; }
  anotar "3 · imágenes existentes"
else
  deploy/scripts/construir.sh "$VERSION_NUEVA" "$REG" >/dev/null && anotar "3 · imágenes compiladas"
fi

# 4. Verificar configuración con la imagen nueva (sin arrancarla)
VERSION="$VERSION_NUEVA" "${DC[@]}" up -d --no-build db >/dev/null 2>&1
VERSION="$VERSION_NUEVA" "${DC[@]}" run --rm --no-deps -T servidor node dist-servidor/cli.mjs verificar-configuracion \
  || { anotar "4 · configuración INVÁLIDA: no se despliega (nada cambió)"; exit 1; }
anotar "4 · configuración verificada"

# 5. Respaldo previo y migraciones
if [ "$RESPALDO" = 1 ] && [ -n "${RESPALDO_DESTINATARIO:-}" ]; then
  deploy/scripts/respaldar.sh -p "$PROYECTO" -e "$ENTORNO" "${PASAR[@]}" | tail -1 && anotar "5 · respaldo previo cifrado"
elif [ "${MODO:-}" = "produccion" ]; then echo "Falta RESPALDO_DESTINATARIO: no se despliega en producción sin respaldo." >&2; exit 1
else anotar "5 · sin respaldo previo (no configurado en este entorno)"; fi
VERSION="$VERSION_NUEVA" "${DC[@]}" run --rm --no-deps -T servidor node dist-servidor/cli.mjs migrar && anotar "5 · migraciones al día"

# 6. Desplegar
VERSION="$VERSION_NUEVA" "${DC[@]}" up -d --no-build servidor web >/dev/null 2>&1 || true
anotar "6 · contenedores con $VERSION_NUEVA"

# 7-8. Salud y pruebas rápidas
sano() {
  local v="$1"
  for _ in $(seq 1 45); do
    estado="$("${DC[@]}" ps --format '{{.Service}} {{.Health}}' servidor 2>/dev/null)"
    [[ "$estado" == *healthy* && "$estado" != *unhealthy* ]] && break; sleep 2
  done
  [[ "${estado:-}" == *healthy* && "${estado:-}" != *unhealthy* ]] || { echo "servidor $v sin salud: ${estado:-sin estado}"; return 1; }
  for _ in $(seq 1 20); do deploy/scripts/salud.sh "$URL" "${INSEGURO[@]}" >/dev/null 2>&1 && return 0; sleep 3; done
  deploy/scripts/salud.sh "$URL" "${INSEGURO[@]}"; return 1
}
if sano "$VERSION_NUEVA"; then
  deploy/scripts/salud.sh "$URL" "${INSEGURO[@]}" | sed 's/^/   /'
  anotar "7-8 · salud y pruebas rápidas correctas: DESPLEGADO $VERSION_NUEVA"
  exit 0
fi

# 9. Revertir
anotar "7-8 · FALLÓ la salud de $VERSION_NUEVA"
if [ -z "$ANTERIOR" ] || [ "$ANTERIOR" = "$VERSION_NUEVA" ]; then anotar "9 · no hay versión anterior a la cual volver"; exit 1; fi
VERSION="$ANTERIOR" "${DC[@]}" up -d --no-build servidor web >/dev/null 2>&1 || true
if sano "$ANTERIOR"; then anotar "9 · REVERTIDO a $ANTERIOR (sano)"; else anotar "9 · REVERSIÓN a $ANTERIOR SIN SALUD: atender de inmediato (docs/PLAN_RECUPERACION.md)"; fi
echo "Si $VERSION_NUEVA aplicó migraciones no compatibles con $ANTERIOR, restaura el respaldo previo en una base NUEVA (docs/PLAN_RECUPERACION.md §4)." >&2
exit 1
