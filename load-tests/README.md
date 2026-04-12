# PilingTrack — Load Testing Suite

## Быстрый старт

### 1. k6 установка

```bash
# Windows (Chocolatey)
choco install k6

# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### 2. Подготовка

```bash
# Убедись что сервисы запущены
npm run dev           # Next.js API (порт 3000)
npx tsx src/realtime/server/index.ts   # WS server (порт 3001)

# Для event-storm — нужен Redis
redis-server          # порт 6379
```

### 3. Запуск тестов

#### HTTP нагрузка (1000 операторов)

```bash
k6 run load-tests/load-http.js
```

#### WebSocket нагрузка (1000+ соединений)

```bash
k6 run load-tests/load-ws.js
```

#### Event Storm (1000 events/sec)

```bash
npx tsx load-tests/event-storm.ts          # 1000 evt/s, 30s
npx tsx load-tests/event-storm.ts 2000 60  # 2000 evt/s, 60s
```

#### SLO Monitor (параллельно с нагрузкой)

```bash
npx tsx load-tests/slo-monitor.ts
```

## SLO Targets

| Метрика | Target | Критичность |
|---------|--------|-------------|
| API p95 latency | < 300ms | 🔴 Critical |
| API p99 latency | < 500ms | 🟡 Warning |
| Error rate | < 1% | 🔴 Critical |
| WS delivery latency | < 500ms | 🔴 Critical |
| WS connections | > 900 | 🟡 Warning |
| DB query latency | < 100ms | 🟡 Warning |

## Ожидаемые узкие места

| Компонент | Симптом | Решение |
|-----------|---------|---------|
| WS server (Node) | CPU 100%, задержки > 1s | uWebSockets.js + clustering |
| Redis Pub/Sub | lag, drop сообщений | Redis cluster / Kafka |
| DB write spikes | lock contention | batch writes, BullMQ queue |
| Sync API overload | timeout 500 | rate limit, batching, debounce |

## Capacity plan (1000 операторов)

| Компонент | Требования |
|-----------|------------|
| WS server | 2–4 vCPU |
| API server (Next.js) | 4–8 vCPU |
| Redis | 2 vCPU / 2–4GB RAM |
| PostgreSQL | 4–8 vCPU |

## Файлы

| Файл | Назначение |
|------|------------|
| `load-http.js` | k6 HTTP нагрузка (sync API) |
| `load-ws.js` | k6 WebSocket нагрузка |
| `event-storm.ts` | Flood Redis Pub/Sub событиями |
| `slo-monitor.ts` | Сбор метрик + SLO отчёты |
