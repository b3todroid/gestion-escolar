# Gestión Escolar — imágenes de despliegue (Fase 11). Construcción reproducible:
#   docker build -f deploy/Dockerfile --target servidor -t gestion-escolar/servidor:VERSION .
#   docker build -f deploy/Dockerfile --target web      -t gestion-escolar/web:VERSION .
# REGISTRO permite usar un espejo de las imágenes oficiales (p. ej. mirror.gcr.io/library).
# Detrás de un proxy corporativo: ver «Construcción con proxy» en docs/OPERACION_SERVIDOR.md.
# Para producción conviene fijar cada imagen base por su resumen (@sha256:…); ver docs/OPERACION_SERVIDOR.md.
ARG REGISTRO=docker.io/library
ARG NODE_IMAGEN=node:22.23-slim
ARG CADDY_IMAGEN=caddy:2

# ---------- 1. Compilación (no llega a producción) ----------
FROM ${REGISTRO}/${NODE_IMAGEN} AS construccion
WORKDIR /app
ENV CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 HUSKY=0
COPY package.json package-lock.json ./
# Proxy corporativo (opcional): --build-arg HTTPS_PROXY=… y --secret id=ca_extra,src=ca.pem.
# Sin ellos no cambia nada. La CA sólo existe durante este paso: no queda en la imagen.
RUN --mount=type=secret,id=ca_extra,required=false \
    if [ -f /run/secrets/ca_extra ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_extra; fi; \
    npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG VERSION_APP=
ENV VERSION_APP=${VERSION_APP}
# Misma verificación de tipos que en desarrollo; después, PWA y servidor.
RUN npm run typecheck && npm run build && npm run servidor:compilar

# ---------- 2. Dependencias de ejecución del servidor ----------
FROM ${REGISTRO}/${NODE_IMAGEN} AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca_extra,required=false \
    if [ -f /run/secrets/ca_extra ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_extra; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---------- 3. Servidor (API) ----------
FROM ${REGISTRO}/${NODE_IMAGEN} AS servidor
ENV NODE_ENV=production MIGRACIONES_DIR=/app/servidor/migraciones HOST=0.0.0.0 PUERTO=8787
WORKDIR /app
COPY --from=dependencias --chown=root:root /app/node_modules ./node_modules
COPY --from=construccion --chown=root:root /app/dist-servidor ./dist-servidor
COPY --from=construccion --chown=root:root /app/servidor/migraciones ./servidor/migraciones
COPY --chown=root:root package.json ./
# Sin privilegios: el código pertenece a root y es de sólo lectura para el proceso.
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PUERTO||8787)+'/api/salud/lista').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-servidor/principal.mjs"]

# ---------- 4. Web (PWA estática + HTTPS + proxy de /api) ----------
FROM ${REGISTRO}/${CADDY_IMAGEN} AS web
COPY --from=construccion /app/dist /srv/app
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# La validez de la configuración se comprueba al construir.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1 || (echo "Caddyfile inválido" && exit 1)
EXPOSE 80 443
