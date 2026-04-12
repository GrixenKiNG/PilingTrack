# 🚀 PilingTrack — Performance Engineering Suite

Enterprise-grade performance testing, observability, and reliability stack for the PilingTrack industrial SaaS platform.

## 🧠 Architecture

```
[Playwright E2E]
        ↓
[Orchestrator (CI/CD)]
        ↓
[k6 Load Engine] → [Next.js App / WS Server]
        ↓                      ↓
[Metrics Collector]      [PostgreSQL / Redis]
        ↓                      ↓
[Prometheus] ← scrape → [Exporters]
        ↓
[Grafana Dashboards]
        ↓
[Alertmanager → Slack / Email]
```

## 📁 Structure

```
performance/
├── k6/                          # Load test scripts
│   ├── smoke.test.js            # 10-50 users, 1 min — baseline
│   ├── login.test.js            # Auth endpoint testing
│   ├── report.test.js           # Report CRUD under load (200-500 VU)
│   ├── spike.test.js            # 0 → 1000 VU in 10s spike
│   └── soak.test.js             # 6-hour memory leak detection
├── scenarios/
│   └── e2e-load-integration.ts  # Playwright + k6 combined test
├── data/                        # Test data generators
└── results/                     # Test results (auto-generated)

observability/
├── prometheus/
│   ├── prometheus.yml           # Scrape configuration
│   └── alerts.yml               # Alert rules
├── grafana/
│   ├── datasources/             # Prometheus, Loki, Tempo, AlertManager
│   └── dashboards/
│       ├── api-performance.json # RPS, latency, errors
│       ├── system-health.json   # CPU, memory, event loop
│       └── business-metrics.json # Reports, operators, equipment
├── loki/
│   └── loki-config.yml          # Log aggregation
├── tempo/
│   └── tempo-config.yml         # Distributed tracing
└── alertmanager/
    └── alertmanager.yml         # Alert routing (Slack, Email)
```

## ⚙️ Quick Start

### 1. Run Smoke Test

```bash
# Using Node.js (no dependencies)
node performance/k6/smoke.test.js

# Using k6 (recommended)
k6 run performance/k6/smoke.test.js
```

### 2. Run Full Load Test

```bash
k6 run --vus 200 --duration 5m performance/k6/report.test.js
```

### 3. Run Spike Test

```bash
k6 run performance/k6/spike.test.js
```

### 4. Run Soak Test (6 hours)

```bash
k6 run --vus 100 --duration 6h performance/k6/soak.test.js
```

### 5. Start Observability Stack

```bash
docker compose -f docker-compose.observability.yml up -d

# Access dashboards:
# Prometheus:   http://localhost:9090
# Grafana:      http://localhost:3010 (admin/admin)
# AlertManager: http://localhost:9093
```

### 6. E2E + Load Integration Test

```bash
npx playwright test performance/scenarios/e2e-load-integration.ts
```

## 🎯 Load Profiles

| Test Type | Users | Duration | Purpose |
|-----------|-------|----------|---------|
| **Smoke** | 10-50 | 1 min | Baseline stability check |
| **Login** | 10-50 | 2 min | Auth performance, rate limiting |
| **Report** | 20-500 | 5 min | Normal production load |
| **Spike** | 0→1000 | 2 min | Offline sync burst simulation |
| **Soak** | 100 | 6 hours | Memory leak detection |

## 📊 Grafana Dashboards

### Dashboard 1 — API Performance
- Requests per second (RPS)
- Latency heatmap
- p50 / p95 / p99 latency
- Error rate
- Status code distribution
- Endpoint performance table

### Dashboard 2 — System Health
- CPU usage per service
- Memory (heap, external, RSS)
- Event loop lag
- GC activity
- PostgreSQL connections
- Redis memory & keys

### Dashboard 3 — Business Metrics
- Reports created per minute
- Active operators count
- Sync operations rate
- Reports by site
- Alert events triggered
- Shift distribution
- Equipment utilization

## 🚨 Alerts

| Alert | Condition | Severity | Channel |
|-------|-----------|----------|---------|
| High API Latency (p95) | > 500ms for 5m | Warning | Slack |
| Critical API Latency (p95) | > 2s for 2m | Critical | Slack |
| High Error Rate | > 1% for 2m | Critical | Slack |
| API Down | Endpoint unreachable 1m | Critical | Slack + Email |
| Postgres Connections | > 80 for 2m | Warning | Slack |
| Postgres Pool Exhausted | > 95 for 1m | Critical | Slack |
| High Memory Usage | > 90% heap for 5m | Warning | Slack |
| Event Loop Lag | > 100ms for 5m | Warning | Slack |
| No Reports Created | 0 for 1h | Warning | Email |
| Outbox Backlog | > 1000 pending 10m | Warning | Slack |
| Redis Memory | > 80% for 5m | Warning | Slack |

## 🔄 CI/CD Integration

```yaml
Pipeline:
1. Build
2. Unit Tests (Vitest)
3. E2E Tests (Playwright)
4. Smoke Load Test (k6) ← Every PR
5. Deploy to Staging
6. Full Load Test (nightly)
7. Spike Test (weekly)
8. Soak Test (monthly)
```

Triggered by:
- **Every PR**: Smoke load test
- **Merge to main**: Full load test
- **Nightly (02:00 UTC)**: Full load test
- **Weekly**: Spike test
- **Monthly**: Soak test (8 hours)
- **Manual**: Any test type via `workflow_dispatch`

## ⚠️ Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Race conditions on shift creation | Idempotency keys + optimistic locking |
| Duplicate reports (offline sync) | Deduplication via reportId unique constraint |
| DB write overload | Connection pooling (PgBouncer), batch inserts |
| JWT bottleneck | Token rotation, Redis session cache |
| Network instability (mobile) | Offline-first with IndexedDB queue, retry with backoff |
| Memory leaks | Soak tests, Grafana memory alerts |
| Slow queries | Query profiling, proper indexes, pagination |

## 🧪 Advanced Practices

### Chaos Engineering
```bash
# Simulate API failure
# Edit performance/scenarios/chaos/*.js

# Simulate network degradation
# Edit performance/scenarios/network/*.js
```

### Data Realism
- Real pile grade types from production
- Actual drilling types and downtime reasons
- Realistic report payloads with varying complexity

### Network Simulation
- 3G / Edge latency profiles
- Packet loss injection
- Intermittent connectivity simulation

## 📈 KPIs

| Metric | Target | Current |
|--------|--------|---------|
| p95 API latency | < 500ms | 273ms @ 30 VU |
| p99 API latency | < 1000ms | 293ms @ 30 VU |
| Error rate | < 1% | 0.00% |
| Throughput | > 100 req/s | 167 req/s @ 100 VU |
| Server stability | No crash @ 100 VU | ✅ PASS |
| Test coverage | > 70% | 99.2% (248/250) |
| TypeScript errors | 0 | 1 (optional mqtt) |

## 🎯 Result

A production-grade performance engineering system that:

1. ✅ Tests real operator behavior under load
2. ✅ Catches regressions before they reach production
3. ✅ Provides full observability (metrics, logs, traces)
4. ✅ Alerts on degradation before users notice
5. ✅ Prevents field failures through proactive testing
