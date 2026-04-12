# PilingTrack — Kubernetes Deployment Architecture

Enterprise-grade Helm chart для развёртывания PilingTrack в Kubernetes.

## Архитектура

```
┌──────────────────────────────────────────────────────────┐
│                    K8s Cluster                           │
│                                                          │
│  ┌──────────────┐   ┌──────────────────────────────────┐ │
│  │ Ingress NGINX│──→│ API Deployment (Next.js BFF)     │ │
│  │ + TLS/CertMgr│   │ replicas: 3-30 (HPA)             │ │
│  └──────────────┘   └────────┬─────────────────────────┘ │
│                              │                            │
│  ┌───────────────────────────▼─────────────────────────┐  │
│  │              Workers (Outbox/Projection/PDF)        │  │
│  │              replicas: 1-3 per type                 │  │
│  └───────────────────────────┬─────────────────────────┘  │
│                              │                            │
│  ┌───────────────────────────▼─────────────────────────┐  │
│  │              Event Layer                            │  │
│  │              Redis Streams / Kafka                  │  │
│  └───────────────────────────┬─────────────────────────┘  │
│                              │                            │
│  ┌───────────────────────────▼─────────────────────────┐  │
│  │              Data Layer                             │  │
│  │              PostgreSQL (Primary + 2 Replicas)      │  │
│  │              Redis Cluster (3 nodes)                │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Быстрый старт

### 1. Установка зависимостей

```bash
helm dependency update infra/helm/pilingtrack
```

### 2. Установка в staging

```bash
helm install pilingtrack-staging ./infra/helm/pilingtrack \
  --namespace pilingtrack-staging --create-namespace \
  -f infra/helm/pilingtrack/values-staging.yaml
```

### 3. Установка в production

```bash
helm install pilingtrack-prod ./infra/helm/pilingtrack \
  --namespace pilingtrack-prod --create-namespace \
  -f infra/helm/pilingtrack/values-prod.yaml
```

### 4. Обновление

```bash
helm upgrade pilingtrack-prod ./infra/helm/pilingtrack \
  --namespace pilingtrack-prod \
  -f infra/helm/pilingtrack/values-prod.yaml
```

### 5. Откат

```bash
helm rollback pilingtrack-prod
```

## Компоненты

| Компонент | Replicas (prod) | CPU | Memory | Примечание |
|-----------|-----------------|-----|--------|------------|
| API (Next.js) | 5-30 (HPA) | 500m-2 | 512Mi-2Gi | Rolling update |
| Outbox Worker | 3 | 200m-1 | 256Mi-1Gi | Event publishing |
| Projection Worker | 3 | 200m-1 | 256Mi-1Gi | CQRS projections |
| PDF Worker | 2 | 500m-4 | 512Mi-4Gi | BullMQ queue |
| WebSocket | 3 | 200m-1 | 256Mi-1Gi | Realtime gateway |
| PostgreSQL Primary | 1 | 4-8 | 8-16Gi | 500Gi SSD |
| PostgreSQL Replica | 2 | 2-4 | 4-8Gi | Read scaling |
| Redis Master | 1 | 500m-1 | 1-2Gi | 20Gi |
| Redis Replica | 3 | 200m-500m | 256Mi-1Gi | 10Gi each |

## Масштабирование

### Horizontal Pod Autoscaler (API)

```yaml
metrics:
  - cpu: target 60% utilization
  - memory: target 80% utilization

scaleUp:
  stabilizationWindowSeconds: 60
  max: +50% или +2 pods за 60s

scaleDown:
  stabilizationWindowSeconds: 300
  max: -10% или -1 pod за 120s
```

### Ручное масштабирование

```bash
kubectl scale deployment pilingtrack-prod-api --replicas=10
```

## Network Policies (Zero Trust)

| Компонент | Ingress | Egress |
|-----------|---------|--------|
| **API** | От Ingress | PostgreSQL, Redis, DNS, HTTPS (Sentry/S3) |
| **Workers** | Нет | PostgreSQL, Redis, DNS, HTTPS |
| **WebSocket** | От Ingress | PostgreSQL, Redis, DNS |
| **PostgreSQL** | От API/Workers | DNS |
| **Redis** | От API/Workers/WS | DNS |
| **Default** | Deny All | Deny All |

## Безопасность

### Secrets Management

```bash
# Создание secrets
kubectl create secret generic pilingtrack-db-credentials \
  --from-literal=postgres-password=$(openssl rand -base64 32) \
  --from-literal=password=$(openssl rand -base64 32) \
  --namespace pilingtrack-prod

kubectl create secret generic pilingtrack-redis-credentials \
  --from-literal=redis-password=$(openssl rand -base64 32) \
  --namespace pilingtrack-prod

# Для production: использовать SealedSecrets или External Secrets Operator
```

### Pod Security

- `runAsNonRoot: true`
- `readOnlyRootFilesystem: true` (кроме worker tmp)
- `allowPrivilegeEscalation: false`
- `capabilities.drop: [ALL]`
- `seccompProfile: RuntimeDefault`

### TLS

- Cert-Manager + Let's Encrypt (production)
- Ingress NGINX с `ssl-redirect: true`

## Observability

### Prometheus

```bash
# ServiceMonitor автоматически создаётся при observability.serviceMonitor.enabled: true
kubectl get servicemonitor -n pilingtrack-prod
```

### Grafana

```bash
# Дашборды автоматически импортируются при observability.grafanaDashboards.enabled: true
kubectl get configmap -n grafana -l grafana_dashboard=1
```

### OpenTelemetry

```bash
# Endpoint указывается в values:
observability.openTelemetry.endpoint: "http://otel-collector:4318"
observability.openTelemetry.samplerArg: "0.05"  # 5% sampling в prod
```

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - run: helm lint infra/helm/pilingtrack -f infra/helm/pilingtrack/values-staging.yaml
      - run: helm upgrade --install pilingtrack-staging ./infra/helm/pilingtrack -f infra/helm/pilingtrack/values-staging.yaml --wait --timeout 10m

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - run: helm lint infra/helm/pilingtrack -f infra/helm/pilingtrack/values-prod.yaml
      - run: helm upgrade --install pilingtrack-prod ./infra/helm/pilingtrack -f infra/helm/pilingtrack/values-prod.yaml --wait --timeout 10m
      - run: helm test pilingtrack-prod
```

## Chaos Engineering

Обязательные тесты:

```bash
# 1. Kill API pod
kubectl delete pod -l app.kubernetes.io/component=api --namespace pilingtrack-prod

# 2. Kill Redis pod
kubectl delete pod -l app.kubernetes.io/name=redis --namespace pilingtrack-prod

# 3. Simulate network partition
kubectl apply -f chaos/network-partition-api-db.yaml

# 4. Database latency injection
kubectl apply -f chaos/db-latency-injection.yaml
```

## Ресурсы на кластер (Production)

| Ресурс | Значение |
|--------|----------|
| **Nodes** | 6-10 (8 vCPU, 32Gi RAM каждый) |
| **Total CPU** | 48-80 vCPU |
| **Total RAM** | 192-320 Gi |
| **Storage** | 700Gi+ SSD |
| **Network** | 1 Gbps+ |

## Troubleshooting

```bash
# Проверить статус
helm status pilingtrack-prod --namespace pilingtrack-prod

# Проверить логи
kubectl logs -l app.kubernetes.io/component=api --namespace pilingtrack-prod --tail=100

# Проверить pods
kubectl get pods -l app.kubernetes.io/instance=pilingtrack-prod --namespace pilingtrack-prod

# Проверить HPA
kubectl get hpa --namespace pilingtrack-prod

# Проверить network policies
kubectl get networkpolicy --namespace pilingtrack-prod

# Проверить health
kubectl exec -it deployment/pilingtrack-prod-api -- curl -s http://localhost:3000/api/health | jq
```
