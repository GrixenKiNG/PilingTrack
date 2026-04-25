# 📊 PilingTrack Observability Stack

Full metrics + logs + traces + alerts pipeline. Replaces the older
`monitoring/` directory which only carried Prometheus + Grafana.

## Components

| Component | Port | Description |
|-----------|------|-------------|
| **Prometheus** | 9090 | Metrics collection and storage |
| **Grafana** | 3010 | Visualization and dashboards |
| **Loki** | 3100 | Log aggregation |
| **Tempo** | 3200 | Distributed tracing backend |
| **Alertmanager** | 9093 | Alert routing and notification |
| **PostgreSQL Exporter** | 9187 | PostgreSQL metrics |
| **Redis Exporter** | 9121 | Redis metrics |

## Quick Start

Two compose files target this directory:

```bash
# Full stack (app + observability), best for local end-to-end work
docker compose -f docker-compose.observability.yml up -d

# Observability-only (no app), best when the app runs natively or on a
# different host
docker compose -f docker-compose.monitoring-standalone.yml up -d

# Access Grafana
# http://localhost:3010 — login: admin / admin

# Access Prometheus
# http://localhost:9090
```

## Layout

```
observability/
├── alertmanager/
│   └── alertmanager.yml         — routing + receivers (Slack/email)
├── grafana/
│   ├── dashboards/              — provisioned JSON dashboards
│   │   ├── api-performance.json
│   │   ├── business-metrics.json
│   │   ├── redis-performance.json
│   │   ├── resilience-overview.json
│   │   └── system-health.json
│   └── datasources/
│       ├── datasources.yml      — Prometheus + Loki + Tempo
│       └── dashboards.yml       — auto-load from /etc/grafana/.../files
├── loki/
│   └── loki-config.yml
├── prometheus/
│   ├── prometheus.yml           — full stack (with alertmanager)
│   ├── prometheus-standalone.yml — observability-only variant
│   └── alerts.yml               — alert rules
└── tempo/
    └── tempo-config.yml
```

## Provisioned Dashboards

| Dashboard | What it covers |
|-----------|----------------|
| **api-performance** | p95/p99 latency, requests/sec, error rate, status code distribution |
| **business-metrics** | Reports submitted, active operators, telemetry ingestion rate |
| **redis-performance** | Memory usage, commands/sec, keyspace hits/misses, evictions |
| **resilience-overview** | Circuit breaker states, rate-limit hits, retry counts, DLQ depth |
| **system-health** | CPU, memory, disk I/O, network I/O per service |

## Alerts

Rules live in `prometheus/alerts.yml`. Highlights:

| Alert | Condition | Severity |
|-------|-----------|----------|
| `HighAPILatencyP95` | p95 > 500ms for 5m | warning |
| `HighErrorRate` | 5xx rate > 5% for 2m | critical |
| `PostgresPoolNearExhaustion` | active connections > 90% of pool | critical |
| `RedisMemoryHigh` | usage > 80% for 5m | warning |
| `OutboxBacklogStuck` | pending > 1000 for 10m | warning |
| `TargetDown` | scrape target unreachable for 2m | critical |

Each alert carries a `runbook_url` annotation pointing to the wiki.

## Load tests against the metrics pipeline

```bash
# Basic: 1000 VUs for 5 minutes
k6 run --vus 1000 --duration 5m load-tests/stress-test.js

# Export to JSON for later analysis
k6 run --vus 500 --duration 3m --out json=load-results.json load-tests/stress-test.js

# Live-export to Prometheus
k6 run --vus 1000 --duration 5m \
  --out experimental-prometheus=remote:port \
  load-tests/stress-test.js
```
