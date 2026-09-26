# SHOSHO back-office — Next.js standalone image. Build context = repo root (pnpm workspace):
#   docker build -f apps/backoffice/Dockerfile -t shosho-backoffice .
# Runtime env (rendered by apps/infra/_deploy.yml): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# — read at request time (lib/env.ts), so no secrets at build time. The service-role key is never used here.
# Budget: 96 MB RAM on staging (docker-compose.staging.yml) → alpine, no sharp, capped V8 heap.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/backend/package.json apps/backend/
# only the backoffice importer; backend deps (supabase binary) are not needed for the type-only import
RUN pnpm install --frozen-lockfile --filter @shosho/backoffice --ignore-scripts

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/backoffice/node_modules ./apps/backoffice/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/types ./apps/backend/types
COPY apps/backoffice ./apps/backoffice
RUN pnpm --filter @shosho/backoffice build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="--max-old-space-size=48 --max-semi-space-size=2"
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/backoffice/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/backoffice/.next/static ./apps/backoffice/.next/static
COPY --from=build --chown=node:node /repo/apps/backoffice/public ./apps/backoffice/public
USER node
EXPOSE 3000
# /login is public (no session) and renders without Supabase — a good liveness probe.
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/backoffice/server.js"]
