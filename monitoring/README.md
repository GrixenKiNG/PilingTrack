# 📊 PilingTrack Monitoring Stack

## Components

| Component | Port | Description |
|-----------|------|-------------|
| **Prometheus** | 9090 | Metrics collection and storage |
| **Grafana** | 3010 | Visualization and dashboards |
| **PostgreSQL Exporter** | 9187 | PostgreSQL metrics |
| **Redis Exporter** | 9121 | Redis metrics |

## Quick Start

```bash
# Start monitoring stack
docker compose -f docker-compose.monitoring.yml up -d

# Access Grafana
open http://localhost:3010
# Login: admin / admin

# Access Prometheus
open http://localhost:9090
```

## Key Dashboards

### 1. API Performance
- **p95/p99 latency** — target: < 200ms / < 500ms
- **Requests per second** — throughput
- **Error rate** — target: < 0.1%
- **Status code distribution**

### 2. WebSocket Health
- **Active connections** — target: 1000+
- **Connection rate** — opens vs closes
- **Message throughput** — in/out per second
- **Channel subscriptions**

### 3. Database Performance
- **Active connections** — target: < 80% of pool
- **Query duration** — slow queries
- **Cache hit ratio** — target: > 95%
- **Deadlocks** — target: 0

### 4. System Resources
- **CPU usage** — per service
- **Memory usage** — per service
- **Disk I/O** — read/write throughput
- **Network I/O** — bandwidth usage

## Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High API Latency | p95 > 200ms for 5m | Warning |
| High Error Rate | > 5% for 2m | Critical |
| Postgres Pool Exhausted | > 90 connections | Critical |
| Redis Memory > 80% | Usage > 80% for 5m | Warning |
| Outbox Stuck | > 1000 pending for 10m | Warning |
| Target Down | Service unreachable for 2m | Critical |

## Run Load Tests

```bash
# Basic: 1000 VU for 5 minutes
k6 run --vus 1000 --duration 5m load-tests/stress-test.js

# With results export
k6 run --vus 500 --duration 3m --out json=load-results.json load-tests/stress-test.js

# With Prometheus output
k6 run --vus 1000 --duration 5m --out experimental-prometheus=remote:port load-tests/stress-test.js
```
