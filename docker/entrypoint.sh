#!/bin/sh
# Staging entrypoint (spec staging-deploy §3): apply migrations, then boot the API.
# A failed migration fails the container visibly (Log Analytics) instead of booting stale.
set -e
cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
exec node -r @swc-node/register src/main.ts
