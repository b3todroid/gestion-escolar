#!/usr/bin/env bash
# Verificación de SEGURIDAD de un entorno desplegado (Fase 12). SÓLO LECTURA: no cambia nada.
#   deploy/scripts/verificar-seguridad.sh -p gestion-preprod -e deploy/preproduccion.env -u https://localhost:8443 [-c deploy/compose.preproduccion.yml] [--inseguro]
# Comprueba: protocolos TLS, puertos publicados, secretos fuera de variables y de las imágenes,
# usuario no root, cabeceras, rutas de desarrollo cerradas, auditoría registrando y sin datos personales.
set -uo pipefail
cd "$(dirname "$0")/../.."
PROYECTO=""; ENV=""; URL=""; EXTRA=(); K=()
while [ $# -gt 0 ]; do case "$1" in
  -p) PROYECTO="$2"; shift 2;; -e) ENV="$2"; shift 2;; -u) URL="$2"; shift 2;;
  -c) EXTRA+=(-f "$2"); shift 2;; --inseguro) K=(-k); shift;; *) echo "Opción desconocida: $1"; exit 2;; esac; done
[ -n "$PROYECTO" ] && [ -n "$ENV" ] && [ -n "$URL" ] || { echo "Uso: $0 -p PROYECTO -e ENV -u URL [-c compose-extra] [--inseguro]"; exit 2; }
DC=(docker compose -p "$PROYECTO" -f deploy/docker-compose.yml "${EXTRA[@]}" --env-file "$ENV")
falla=0; ok() { echo "✓ $*"; }; mal() { echo "✗ $*"; falla=1; }
anfitrion="$(sed 's#https://##; s#/.*##' <<<"$URL")"; [[ "$anfitrion" == *:* ]] || anfitrion="$anfitrion:443"; nombre_tls="${anfitrion%:*}"
tls() { echo | openssl s_client -"$1" -servername "$nombre_tls" -connect "$anfitrion" 2>/dev/null | grep -q "Protocol *: *$2"; }

echo "== TLS"
# (el cliente openssl local puede no ofrecer TLS 1.0/1.1; «rechaza» significa que NO se negoció)
tls tls1 'TLSv1$' && mal "negocia TLS 1.0 (obsoleto)" || ok "no negocia TLS 1.0"
tls tls1_1 'TLSv1.1' && mal "negocia TLS 1.1 (obsoleto)" || ok "no negocia TLS 1.1"
tls tls1_2 'TLSv1.2' && ok "negocia TLS 1.2" || mal "no negocia TLS 1.2"
tls tls1_3 'TLSv1.3' && ok "negocia TLS 1.3" || mal "no negocia TLS 1.3"
r="$(curl -sS -o /dev/null -w '%{http_code}' "http://${anfitrion%:*}:${PUERTO_HTTP:-80}/" 2>/dev/null)" || r=000
[[ "$r" =~ ^30[178]$ ]] && ok "HTTP redirige a HTTPS ($r)" || echo "· HTTP en el puerto ${PUERTO_HTTP:-80}: $r (revisar si se publica)"

echo "== Puertos publicados"
while read -r nombre puertos; do
  puertos="$(tr ',' '\n' <<<"$puertos" | grep -- '->' | xargs)"  # sólo los PUBLICADOS en el anfitrión (no los EXPOSE internos)
  case "$nombre" in
    *-web-*) ok "$nombre (proxy HTTPS) publica: ${puertos:-ninguno}";;
    *-correo-prueba-*) [[ -z "$puertos" || "$puertos" != *0.0.0.0* ]] && ok "$nombre (buzón de prueba) sólo en 127.0.0.1: ${puertos:-ninguno}" || mal "$nombre publica a todas las interfaces: $puertos";;
    *) [ -z "$puertos" ] && ok "$nombre no publica puertos" || mal "$nombre publica puertos: $puertos";;
  esac
done < <(docker ps --filter "label=com.docker.compose.project=$PROYECTO" --format '{{.Names}} {{.Ports}}')

echo "== Secretos"
for c in $("${DC[@]}" ps -q); do
  n="$(docker inspect -f '{{.Name}}' "$c")"
  env="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c")"
  if grep -Eiq '^(DATABASE_URL|BETTER_AUTH_SECRET|SMTP_CLAVE|POSTGRES_PASSWORD)=' <<<"$env"; then mal "$n tiene un secreto en variables de entorno"; else ok "$n: secretos sólo como *_FILE"; fi
  u="$(docker inspect -f '{{.Config.User}}' "$c")"; [[ "$n" == *servidor* || "$n" == *web* ]] && { [ -n "$u" ] && [ "$u" != root ] && [ "$u" != 0 ] && ok "$n corre como usuario «$u»" || echo "· $n usuario: «${u:-predeterminado de la imagen}»"; }
done
for img in $("${DC[@]}" config --images 2>/dev/null | grep '^gestion-escolar/'); do
  hallado=0
  for s in deploy/secretos/*; do v="$(tr -d '\n' <"$s")"; [ ${#v} -ge 8 ] || continue
    docker history --no-trunc --format '{{.CreatedBy}}' "$img" | grep -qF "$v" && hallado=1
    docker run --rm --entrypoint sh "$img" -c 'grep -rlF -- "$0" /app /srv /etc /usr/share/caddy /config /data 2>/dev/null | head -1' "$v" | grep -q . && hallado=1
  done
  [ $hallado = 0 ] && ok "$img no contiene los secretos (historial ni archivos)" || mal "$img contiene un secreto"
done
git ls-files --error-unmatch deploy/secretos >/dev/null 2>&1 && mal "deploy/secretos está en el repositorio" || ok "deploy/secretos fuera del repositorio"
git ls-files | grep -E '(^|/)[^/]*\.env$' | grep -v ejemplo | grep -q . && mal "hay archivos .env en el repositorio" || ok "sin archivos .env reales en el repositorio (sólo ejemplos)"

echo "== Cabeceras y rutas"
h="$(curl -sSI "${K[@]}" "$URL/" | tr -d '\r')"
for c in strict-transport-security content-security-policy x-content-type-options referrer-policy; do grep -qi "^$c:" <<<"$h" && ok "cabecera $c" || mal "falta $c"; done
grep -qi '^server: ' <<<"$h" && echo "· cabecera Server: $(grep -i '^server:' <<<"$h")" || ok "no revela el servidor (Server)"
y="$(curl -sS "${K[@]}" "$URL/api/yo")"; [ "$y" = null ] && ok "/api/yo sin sesión → null (sin datos)" || mal "/api/yo sin sesión devuelve datos"
for ruta in /api/desarrollo/buzon?correo=x /api/escuelas/x/tablas/pases /api/yo/sesiones; do d="$(curl -sS "${K[@]}" -o /dev/null -w '%{http_code}' "$URL$ruta")"; [[ "$d" =~ ^40[134]$ ]] && ok "$ruta sin sesión → $d" || mal "$ruta sin sesión → $d"; done
t="$(curl -sS "${K[@]}" "$URL/api/salud")"; grep -Eiq 'postgres://|secret|password' <<<"$t" && mal "/api/salud revela configuración" || ok "/api/salud no revela configuración"

echo "== Auditoría (acceso.auditoria)"
BD="$(grep -E '^GESTION_BD=' "$ENV" | cut -d= -f2)"; BD="${BD:-gestion}"
q() { "${DC[@]}" exec -T db sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$1" -c "$0"' "$1" "$BD" 2>/dev/null; }
eventos="$(q "select accion||'='||count(*) from acceso.auditoria group by accion order by 1")"
[ -n "$eventos" ] && ok "eventos registrados: $(tr '\n' ' ' <<<"$eventos")" || mal "no se pudo leer la auditoría"
pii="$(q "select count(*) from acceso.auditoria where detalle::text ~ '@' or detalle ? 'codigo' or detalle ? 'correo' or detalle ? 'nombre'")"
[ "${pii:-x}" = 0 ] && ok "auditoría sin correos ni códigos" || mal "auditoría con posibles datos personales: ${pii:-?}"
exit $falla
