# ============================================================
# Dockerfile — WebSocket Real-Time Server (Compiled)
# ============================================================
#
# ПОЧЕМУ БЕЗ СБОРКИ NEXT И ПОЛНОГО node_modules (23.09.2026). Сервер — один
# esbuild-бандл в ~300 КБ, а образ весил 1.86 ГБ: в него клался весь
# production node_modules (~1.1 ГБ) и .next/standalone, откуда бандл брал
# единственное — сгенерированный клиент Prisma (src/lib/db.ts грузит его по
# пути через eval('require'), поэтому esbuild его не видит). Теперь рантайм
# собирается трассировкой: бандл + клиент + ровно их зависимости.
# ============================================================

# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --ignore-scripts

# Stage 2: Build — Prisma client, esbuild bundle, runtime trace
FROM node:22-alpine AS builder
WORKDIR /app
ENV DATABASE_URL_POSTGRES=postgresql://build:build@localhost:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/patch-postgres-client.js scripts/trace-runtime-deps.cjs ./scripts/
COPY src ./src

# Тот же генератор, что у app (db:generate = prisma generate + патч клиента):
# в бою ws годами работал с пропатченным клиентом из сборки Next.
RUN npm run db:generate

# Bundle WebSocket server with esbuild (fast, single-file output)
RUN npx esbuild src/core/realtime/server/index.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --outfile=dist/ws/index.js \
    --external:@prisma/client \
    --external:ws \
    --external:ioredis \
    --external:bullmq \
    --external:pino \
    --external:next \
    --external:@sentry/nextjs \
    --format=cjs \
    --minify

# Рантайм — трассировкой от бандла и клиента Prisma (его бандл грузит по пути,
# а не импортом). Клиент кладём целиком: движок и wasm он открывает по путям.
RUN node scripts/trace-runtime-deps.cjs /out \
      dist/ws/index.js src/generated/postgres-client/index.js && \
    rm -rf /out/src/generated/postgres-client && \
    mkdir -p /out/src/generated && \
    cp -r src/generated/postgres-client /out/src/generated/ && \
    rm -f /out/src/generated/postgres-client/query_engine-windows.dll.node

# Stage 3: Production — Minimal image with compiled JS
FROM node:22-alpine AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV WS_PORT=3001

COPY --from=builder /out ./

USER nextjs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Run compiled JavaScript
CMD ["node", "dist/ws/index.js"]
