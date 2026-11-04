#!/bin/sh
# Primer arranque de PostgreSQL (Fase 11): crea el usuario de la aplicación y su base.
# - El usuario de la aplicación NO es superusuario: es dueño de su base y puede crear roles
#   (la migración 0004 crea el rol restringido gestion_app que usan las peticiones, con RLS).
# - Las contraseñas vienen de secretos montados en /run/secrets (nunca de variables visibles).
set -eu
CLAVE="$(cat /run/secrets/pg_gestion)"
: "${GESTION_BD:?falta GESTION_BD}" "${GESTION_USUARIO:?falta GESTION_USUARIO}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v usuario="$GESTION_USUARIO" -v clave="$CLAVE" -v bd="$GESTION_BD" <<'SQL'
CREATE ROLE :"usuario" LOGIN PASSWORD :'clave' NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION;
CREATE DATABASE :"bd" OWNER :"usuario" ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE :"bd" FROM PUBLIC;
\connect :"bd"
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"usuario";
SQL
echo "Base ${GESTION_BD} y usuario ${GESTION_USUARIO} creados."
