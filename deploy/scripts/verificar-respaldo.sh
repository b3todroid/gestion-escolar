#!/usr/bin/env bash
# VERIFICA que un respaldo se puede restaurar (Fase 11), en un contenedor PostgreSQL TEMPORAL,
# SIN RED y que se borra al terminar. Nunca toca la base de producción ni ninguna otra.
#   deploy/scripts/verificar-respaldo.sh ARCHIVO.tar.age IDENTIDAD_AGE [IMAGEN_POSTGRES]
# Comprueba: suma SHA-256, descifrado, restauración completa sin errores, mismas migraciones
# (nombre y huella) y los MISMOS conteos por tabla que el manifiesto tomado al respaldar.
# Un respaldo no se considera confiable hasta pasar esta verificación.
set -euo pipefail
ARCHIVO="${1:?Uso: $0 ARCHIVO.tar.age IDENTIDAD_AGE [IMAGEN]}"; IDENTIDAD="${2:?Falta la identidad (clave privada) age}"
IMAGEN="${3:-${REGISTRO:-docker.io/library}/postgres:16-alpine}"
[ -f "$ARCHIVO" ] && [ -f "$IDENTIDAD" ] || { echo "No existe el archivo o la identidad." >&2; exit 2; }
TMP="$(mktemp -d)"; chmod 700 "$TMP"
NOMBRE_CONT="verificar-respaldo-$$"
limpiar() { docker rm -f "$NOMBRE_CONT" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap limpiar EXIT

if [ -f "$ARCHIVO.sha256" ]; then
  ( cd "$(dirname "$ARCHIVO")" && sha256sum -c "$(basename "$ARCHIVO").sha256" >/dev/null 2>&1 ) || { echo "✗ La suma SHA-256 no coincide: archivo alterado. RESPALDO NO VÁLIDO." >&2; exit 1; }
  echo "✓ Suma SHA-256 correcta"
else echo "! Sin archivo .sha256 (se continúa)"; fi
age -d -i "$IDENTIDAD" -o "$TMP/r.tar" "$ARCHIVO" 2>/dev/null || { echo "✗ No se pudo descifrar: archivo alterado o identidad equivocada. RESPALDO NO VÁLIDO." >&2; exit 1; }
echo "✓ Descifrado"
tar -C "$TMP" -xf "$TMP/r.tar"
BASE="$(sed -n 's/.*"base" *: *"\([^"]*\)".*/\1/p' "$TMP/manifiesto.json")"
[ -n "$BASE" ] || { echo "Manifiesto ilegible." >&2; exit 1; }

# PostgreSQL temporal sin red (--network none): aislado por completo.
docker run -d --rm --name "$NOMBRE_CONT" --network none -e POSTGRES_PASSWORD=solo-verificacion -e POSTGRES_USER=postgres_admin "$IMAGEN" >/dev/null
for _ in $(seq 1 60); do docker exec "$NOMBRE_CONT" pg_isready -U postgres_admin >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker cp "$TMP/base.dump" "$NOMBRE_CONT:/tmp/base.dump" >/dev/null
docker exec "$NOMBRE_CONT" psql -q -U postgres_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE gestion LOGIN CREATEROLE" -c "CREATE ROLE gestion_app NOLOGIN" -c "CREATE DATABASE \"$BASE\" OWNER gestion"
docker exec "$NOMBRE_CONT" pg_restore -U postgres_admin -d "$BASE" --exit-on-error --no-owner --role=gestion /tmp/base.dump
echo "✓ Restauración completa sin errores en un PostgreSQL temporal aislado"

# Comparación con el manifiesto.
docker exec "$NOMBRE_CONT" psql -U postgres_admin -d "$BASE" -At -v ON_ERROR_STOP=1 -c "
  SELECT json_build_object(
    'migraciones', (SELECT json_agg(json_build_object('nombre', nombre, 'huella', huella) ORDER BY nombre) FROM sistema.migraciones),
    'conteos', (SELECT json_object_agg(t.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', t.schemaname, t.relname), false, true, '')))[1]::text::bigint ORDER BY t.relname)
                FROM pg_stat_user_tables t WHERE t.schemaname IN ('escolar', 'acceso', 'sincronizacion')))" > "$TMP/restaurado.json"
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const errores = [];
  if (JSON.stringify(m.migraciones) !== JSON.stringify(r.migraciones)) errores.push("las migraciones (nombre o huella) no coinciden");
  for (const [t, n] of Object.entries(m.conteos)) if (Number(r.conteos[t]) !== Number(n)) errores.push(`${t}: ${n} en el manifiesto, ${r.conteos[t]} restaurados`);
  const total = Object.values(m.conteos).reduce((a, b) => a + Number(b), 0);
  if (errores.length) { console.error("✗ " + errores.join("\n✗ ")); process.exit(1); }
  console.log(`✓ ${m.migraciones.length} migraciones y ${Object.keys(m.conteos).length} tablas idénticas (${total} registros) · respaldo del ${m.creado}`);
' "$TMP/manifiesto.json" "$TMP/restaurado.json"
echo "RESPALDO VERIFICADO: se puede restaurar."
