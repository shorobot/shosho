# SHOSHO guest site — Next.js standalone image. Build context = repo root (pnpm workspace):
#   docker build -f apps/web/Dockerfile -t shosho-web .
# Runtime env (rendered by apps/infra/_deploy.yml): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# NEXT_PUBLIC_SITE_URL — read at request time on the server (lib/env.ts), so no secrets at build time.
# Budget: 96 MB RAM on staging (docker-compose.staging.yml) → alpine, no sharp, capped V8 heap.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/
# only the web importer; backend deps (supabase binary) are not needed for the type-only import
RUN pnpm install --frozen-lockfile --filter @shosho/web --ignore-scripts

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/types ./apps/backend/types
COPY apps/web ./apps/web
RUN pnpm --filter @shosho/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="--max-old-space-size=48 --max-semi-space-size=2"
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
