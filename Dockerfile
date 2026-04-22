# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM node:22-alpine AS deps
WORKDIR /app

# Install libc6-compat for Alpine
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --ignore-scripts 2>/dev/null || npm install --prefer-offline --no-audit

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
# Stage 3: Production runtime (minimal, secure)
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

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
