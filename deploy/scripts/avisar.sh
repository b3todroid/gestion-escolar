#!/usr/bin/env bash
# Canal de alertas de la operación (Fase 11). Por omisión escribe en el registro del sistema y en stderr.
# La institución define el canal real (correo, mensajería) en AVISO_ORDEN, p. ej.:
#   AVISO_ORDEN='mail -s "Gestión Escolar" ti@escuela.example'
# Nunca incluir datos personales en el mensaje.
set -euo pipefail
MENSAJE="${1:?Uso: $0 MENSAJE}"
logger -t gestion-escolar "ALERTA: $MENSAJE" 2>/dev/null || true
echo "ALERTA $(date -u +%FT%TZ): $MENSAJE" >&2
if [ -n "${AVISO_ORDEN:-}" ]; then printf '%s\n' "$MENSAJE" | sh -c "$AVISO_ORDEN"; fi
