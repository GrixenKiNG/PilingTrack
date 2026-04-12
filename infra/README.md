# 🚀 PilingTrack Infrastructure

Production-grade Kubernetes infrastructure with Helm, ArgoCD GitOps, Redis caching, and query optimization.

## 📁 Structure

```
infra/
├── helm/
│   └── pilingtrack/
│       ├── Chart.yaml                    # Helm chart definition
│       ├── values.yaml                   # Default values
│       ├── values-staging.yaml           # Staging overrides
│       ├── values-prod.yaml              # Production overrides
│       └── templates/
│           ├── _helpers.tpl              # Template helpers
│           ├── deployment.yaml           # App deployment + PDB
│           ├── service.yaml              # ClusterIP service
│           ├── ingress.yaml              # Ingress with TLS
│           └── hpa.yaml                  # HorizontalPodAutoscaler
├── argocd/
│   ├── project.yaml                      # ArgoCD project + RBAC
│   ├── app-staging.yaml                  # Staging application (auto-sync)
│   ├── app-prod.yaml                     # Production application (manual)
│   ├── appset.yaml                       # ApplicationSet (multi-env)
│   └── notifications.yaml                # Slack/Email alerts
└── k8s/                                  # Raw manifests (if needed)
```

## 🛠️ Quick Start

### 1. Install Helm Chart

```bash
# Staging (self-contained with PostgreSQL + Redis)
helm install pilingtrack-staging ./infra/helm/pilingtrack \
  --namespace pilingtrack-staging \
  --create-namespace \
  --values infra/helm/pilingtrack/values-staging.yaml

# Production (external RDS + ElastiCache)
helm install pilingtrack-prod ./infra/helm/pilingtrack \
  --namespace pilingtrack-prod \
  --create-namespace \
  --values infra/helm/pilingtrack/values-prod.yaml
```

### 2. Deploy with ArgoCD

```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Apply project and applications
kubectl apply -f infra/argocd/project.yaml
kubectl apply -f infra/argocd/app-staging.yaml
kubectl apply -f infra/argocd/app-prod.yaml

# Or use ApplicationSet for multi-env
kubectl apply -f infra/argocd/appset.yaml
```

### 3. Apply Database Indexes

```bash
# Connect to PostgreSQL and run indexes
kubectl exec -it deploy/pilingtrack-postgresql -- psql -U postgres -d pilingtrack -f /tmp/indexes.sql

# Or from host
psql -h <host> -U postgres -d pilingtrack -f prisma/indexes.sql
```

### 4. Redis Cache

```bash
# Redis is enabled by default in staging via subchart
# In production, use external Redis (ElastiCache/Memorystore)

# Set REDIS_URL in Kubernetes secret
kubectl create secret generic pilingtrack-app-secrets \
  --from-literal=REDIS_URL=redis://:password@redis-host:6379 \
  --namespace pilingtrack-prod
```

## 🔄 GitOps Workflow (ArgoCD)

```
Developer → Push to main → CI/CD runs → Build Docker image → Push to registry
                                                    ↓
ArgoCD detects new commit → Syncs staging automatically → Slack notification
                                                    ↓
Tag release (v1.2.3) → ArgoCD syncs production (manual approval) → Slack notification
```

### Staging (Auto-Sync)
- Triggers on every push to `main`
- Auto-prunes orphaned resources
- Auto-heals on drift detection

### Production (Manual Approval)
- Only deploys tagged releases (`refs/tags/v*`)
- No auto-sync — requires manual approval
- Alerts on drift (does not auto-heal)

## 📊 Environment Comparison

| Feature | Staging | Production |
|---------|---------|------------|
| Replicas | 1 | 3-20 (HPA) |
| PostgreSQL | In-cluster (subchart) | External RDS |
| Redis | In-cluster (subchart) | External ElastiCache |
| Auto-Sync | ✅ Yes | ❌ No (manual) |
| Auto-Heal | ✅ Yes | ❌ No (alert only) |
| Resources | 500m CPU / 1Gi | 2000m CPU / 4Gi |
| HPA | ❌ Disabled | ✅ 3-20 replicas |
| TLS | Let's Encrypt Staging | Let's Encrypt Production |
| PDB | ❌ Disabled | ✅ minAvailable: 2 |

## 🔐 Secrets Management

### Required Secrets

```yaml
# Application secrets
apiVersion: v1
kind: Secret
metadata:
  name: pilingtrack-app-secrets
stringData:
  SESSION_SECRET: "<256-bit-random>"
  DATABASE_URL_POSTGRES: "postgresql://user:pass@host:5432/pilingtrack"
  REDIS_URL: "redis://:password@host:6379"
  SENTRY_DSN: "https://..."
  SENTRY_AUTH_TOKEN: "sntrys_..."
```

### Create Secrets

```bash
# Staging
kubectl create secret generic pilingtrack-app-secrets \
  --from-literal=SESSION_SECRET=$(openssl rand -hex 32) \
  --from-literal=DATABASE_URL_POSTGRES="postgresql://..." \
  --from-literal=REDIS_URL="redis://..." \
  --namespace pilingtrack-staging

# Production (use external secret manager — AWS Secrets Manager, Vault)
kubectl create secret generic pilingtrack-app-secrets \
  --from-literal=SESSION_SECRET=$(openssl rand -hex 32) \
  --from-literal=DATABASE_URL_POSTGRES="postgresql://..." \
  --from-literal=REDIS_URL="redis://..." \
  --namespace pilingtrack-prod
```

## 🚀 Redis Cache Integration

### Usage in Code

```typescript
import { cache, getOrSet, invalidatePattern } from '@/lib/redis-cache';
import { getCachedSitesAll, getCachedUserReports } from '@/lib/cached-queries';

// Read-through caching
const sites = await getCachedSitesAll();

// Custom cache with TTL
const reports = await getOrSet(
  `reports:site:${siteId}`,
  () => db.report.findMany({ where: { siteId } }),
  { ttl: 120 }
);

// Invalidate on write
await invalidatePattern(`reports:site:${siteId}`);
```

### Cache Patterns

| Pattern | Key | TTL |
|---------|-----|-----|
| Sites list | `sites:all` | 5 min |
| Single site | `sites:{id}` | 5 min |
| All crews | `crews:all` | 5 min |
| Dictionary | `dictionary:{type}` | 15 min |
| User reports | `reports:user:{id}` | 2 min |
| Single report | `report:{id}` | 1 min |
| Equipment | `equipment:all` | 5 min |

## 📈 Query Optimization

### Indexes Applied

All indexes are in `prisma/indexes.sql`. Run once:

```sql
-- Run via psql
\i prisma/indexes.sql

-- Or via Kubernetes
kubectl exec -it deploy/pilingtrack-postgresql -- psql -U postgres -d pilingtrack -c "
  CREATE INDEX CONCURRENTLY idx_report_site_date ON \"Report\"(\"siteId\", \"date\" DESC);
  -- ... (see indexes.sql for full list)
"
```

### Optimized Queries

Use `@/lib/db-optimization` for:
- `getReportsByPeriodOptimized()` — Single query with composite index
- `getReportStats()` — Parallel aggregations
- `getSiteDailySummary()` — Raw SQL join
- `getCrewPerformance()` — Crew metrics with single query
- `batchLoadSites()` — DataLoader pattern (no N+1)

## 🐳 Production Docker

```bash
# Build production image
docker build -f Dockerfile.prod -t ghcr.io/pilingtrack/pilingtrack:latest .

# Run locally
docker run -d \
  --name pilingtrack \
  -p 3000:3000 \
  -e DATABASE_URL_POSTGRES="postgresql://..." \
  -e REDIS_URL="redis://..." \
  ghcr.io/pilingtrack/pilingtrack:latest
```

## 🎯 CI/CD with ArgoCD

```yaml
# GitHub Actions → ArgoCD
- name: Update Helm values
  run: |
    yq eval '.image.tag = "${{ github.sha }}"' -i infra/helm/pilingtrack/values-staging.yaml
    git commit -am "Update staging image to ${{ github.sha }}"
    git push

# ArgoCD automatically detects the change and syncs
```

## 🔔 Alerts

| Event | Staging | Production |
|-------|---------|------------|
| Sync succeeded | #deployments | #deployments |
| Sync failed | #alerts | #alerts (critical) |
| Health degraded | #alerts | #alerts (warning) |
| HPA scaled up | - | #alerts |
| Pod crash | #alerts | #alerts (critical) |

## 📋 Checklist

### Pre-Deployment
- [ ] Database indexes applied
- [ ] Secrets created in all namespaces
- [ ] Docker image pushed to registry
- [ ] ArgoCD project created
- [ ] TLS certificates configured (cert-manager)

### Post-Deployment
- [ ] Health check passing (`/api/health`)
- [ ] Ready check passing (`/api/ready`)
- [ ] Redis connected (`/api/metrics`)
- [ ] Database connected
- [ ] HPA active (production only)
- [ ] Slack notifications working

### Ongoing
- [ ] Monitor cache hit rate
- [ ] Review slow queries monthly
- [ ] Update TLS certificates
- [ ] Rotate secrets quarterly
- [ ] Load test after major changes
