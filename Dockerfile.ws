# ============================================================
# Dockerfile — WebSocket Real-Time Server (Compiled)
# ============================================================

# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --ignore-scripts

# Stage 2: Build — Bundle TypeScript to JavaScript with esbuild
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PROVIDER=postgres
ENV SESSION_SECRET=build-time-secret-for-validation-32chars-min
ENV DEVICE_KEY_LOOKUP_SECRET=build-time-stub-for-validation-only-32chars
ENV PIN_LOOKUP_SECRET=build-time-stub-for-validation-only-32chars-xxx
ENV DATABASE_URL_POSTGRES=postgresql://build:build@localhost:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate || true

# Build Next.js (needed for shared modules)
RUN npm run build

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

# Drop dev dependencies (esbuild/next/typescript/etc. were only needed for the
# build above). The compiled bundle requires only the --external prod packages
# at runtime, so the runner can ship the pruned tree instead of the full one.
RUN npm prune --production

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

# Copy only compiled output and dependencies (pruned to production in builder)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/ws ./dist/ws
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next/standalone ./

USER nextjs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Run compiled JavaScript
CMD ["node", "dist/ws/index.js"]
