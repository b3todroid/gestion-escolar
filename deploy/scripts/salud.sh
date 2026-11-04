#!/usr/bin/env bash
# Comprobación externa de salud (Fase 11), para cron o un monitor externo. Sale con error si algo falla.
#   deploy/scripts/salud.sh https://gestion.escuela.example [--inseguro]   (--inseguro sólo con TLS=internal en pruebas)
set -euo pipefail
URL="${1:?Uso: $0 URL_PUBLICA [--inseguro]}"; K=(); [ "${2:-}" = "--inseguro" ] && K=(-k)
falla=0
r="$(curl -sS "${K[@]}" -o /dev/null -w '%{http_code}' "$URL/")" || r=000; [ "$r" = 200 ] && echo "✓ PWA ($r)" || { echo "✗ PWA ($r)"; falla=1; }
r="$(curl -sS "${K[@]}" -w ' %{http_code}' "$URL/api/salud/lista")" || r="sin respuesta 000"; [[ "$r" == *' 200' ]] && echo "✓ API y base de datos: ${r% *}" || { echo "✗ API/base de datos: $r"; falla=1; }
h="$(curl -sSI "${K[@]}" "$URL/" | tr -d '\r')"
grep -qi '^strict-transport-security:' <<<"$h" && echo "✓ HSTS" || { echo "✗ Falta HSTS"; falla=1; }
d="$(curl -sS "${K[@]}" -o /dev/null -w '%{http_code}' "$URL/api/desarrollo/buzon?correo=x")" || d=000; [ "$d" = 404 ] && echo "✓ Buzón de desarrollo cerrado" || { echo "✗ Buzón de desarrollo accesible ($d)"; falla=1; }
if [[ "$URL" == https://* ]] && [ ${#K[@]} -eq 0 ]; then
  dias="$(echo | openssl s_client -servername "$(sed 's#https://##; s#[:/].*##' <<<"$URL")" -connect "$(sed 's#https://##; s#/.*##' <<<"$URL"):443" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)"
  echo "· Certificado vence: $dias"
fi
exit $falla
