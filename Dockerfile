# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM node:22-alpine AS deps
WORKDIR /app

# Install libc6-compat for Alpine
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json ./
# Strict install: fail the build if the lockfile is out of sync
# (the old `|| npm install` fallback silently ran postinstall scripts
# that --ignore-scripts had intentionally skipped — supply-chain risk).
# Prisma's postinstall is run explicitly below via `npx prisma generate`.
RUN npm ci --prefer-offline --no-audit --ignore-scripts

# ============================================================
# Stage 2: Build application
# ============================================================
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
RUN npx prisma generate --schema prisma/schema.prisma

# Build Next.js standalone
RUN npm run build

# ============================================================
# Stage 2b: Migrate — lean image for `prisma migrate deploy` (+ dev seed)
# ============================================================
# The migrate compose service previously used `target: builder`, dragging in
# the full dev node_modules, the entire source tree AND the Next.js build
# output (~2.46 GB) just to run `prisma migrate deploy`. This stage keeps only
# what migrate + the dev seed need: deps' node_modules (carries the prisma CLI
# devDep), the prisma/ folder, and the generated client. No `npm run build`,
# no `COPY . .`.
FROM node:22-alpine AS migrate
WORKDIR /app
RUN apk add --no-cache openssl
ENV DATABASE_PROVIDER=postgres
# Build-time stub: prisma.config.ts eagerly resolves env('DATABASE_URL_POSTGRES')
# when `prisma generate` loads it. The real URL is injected at runtime by compose.
ENV DATABASE_URL_POSTGRES=postgresql://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
# prisma.config.ts holds the datasource.url (env-based) + seed command — Prisma 7
# requires it for `migrate deploy`/`status`; the schema has no inline url.
COPY package.json tsconfig.json prisma.config.ts ./
# Generate the client (seed.ts imports it from ../src/generated/postgres-client)
# and prime the engine binaries used by `migrate deploy`.
RUN npx prisma generate --schema prisma/schema.prisma

# ============================================================
# Stage 3: Production runtime (minimal, secure)
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV PORT=3000
# Next.js standalone server defaults to binding the container hostname only.
# Forcing 0.0.0.0 makes it listen on all interfaces so the compose healthcheck
# (wget http://localhost:3000/api/health) actually reaches it.
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Next.js standalone не трассирует кастомный Prisma client из src/generated/postgres-client.
# Явно копируем @prisma и .prisma — иначе runtime падает с
# "Cannot find module '@prisma/client-runtime-utils'".
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# Install wget for health checks
RUN apk add --no-cache wget

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Switch to non-root user (numeric UID for K8s runAsNonRoot compatibility)
USER 1001:1001

EXPOSE 3000

# Start application
CMD ["node", "server.js"]
