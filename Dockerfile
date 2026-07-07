# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
# openssl HERE too, not just at runtime: Prisma detects the libssl flavor at install/generate
# time — on a slim stage without openssl it defaults to the debian-openssl-1.1.x engine, which
# the openssl-3 runtime stage cannot load (verified on the first build of this image).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app
COPY . .
# packageManager pin (pnpm@11.9.0) drives corepack; allowBuilds in pnpm-workspace.yaml covers
# the native builders (esbuild, @swc/core, argon2 prebuilds resolve per-platform here, on linux).
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @gilgamesh/api prisma:generate \
 && pnpm --filter @gilgamesh/web build

FROM node:22-bookworm-slim
# openssl: Prisma engine requirement on debian-slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production \
    API_PORT=3001 \
    WEB_DIST_DIR=/app/apps/web/dist
EXPOSE 3001
USER node
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
