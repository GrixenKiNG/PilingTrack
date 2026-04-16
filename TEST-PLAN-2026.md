# 📋 Полный План Тестирования PilingTrack — 2026

**Дата создания:** 14 апреля 2026  
**Статус:** Active  
**Уровень:** Staff Engineer / QA Director  

---

## 📊 Содержание

1. [Обзор](#1-обзор)
2. [Пирамида тестирования](#2-пирамида-тестирования)
3. [Фазы и сроки](#3-фазы-и-сроки)
4. [Критические сценарии (P0–P4)](#4-критические-сценарии)
5. [Инструменты и инфра](#5-инструменты-и-инфра)
6. [Критерии покрытия](#6-критерии-покрытия)
7. [Сценарии отказоустойчивости](#7-сценарии-отказоустойчивости)
8. [Регрессионные и дымовые тесты](#8-регрессионные-и-дымовые-тесты)
9. [Мониторинг и метрики](#9-мониторинг-и-метрики)
10. [Governance](#10-governance)

---

## 1. Обзор

### Цель
Обеспечить надёжность, безопасность и UX качество PilingTrack в условиях:
- **Offline-first синхронизация** (основной рисковый момент)
- **Многоролевая авторизация** (Admin, Dispatcher, Operator, Assistant)
- **Real-time обновления** (WebSocket)
- **Мобильные устройства** (iOS/Android, низкая полоса пропускания)
- **PDF экспорт и Telegram интеграция**

### Принципы
- ✅ **Доверие сквозь качество** → низкий fail rate в production
- ✅ **Раннее обнаружение** → unit → integration → e2e (пирамида)
- ✅ **Сеть имеет значение** → chaos & offline тесты обязательны
- ✅ **Rolebased mindset** → каждая роль тестируется отдельно
- ✅ **Data integrity first** → ни потери, ни дублирования данных

---

## 2. Пирамида Тестирования

```
Level │ Scope             │ Tool      │ Count │ Время     │ Частота
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L0    │ Static Analysis   │ TypeScript│ 0     │ <1s       │ Per commit
      │ + Linting         │ ESLint    │       │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L1    │ Unit Tests        │ Vitest    │ 150+  │ 30–60s    │ Per PR
      │ - Shift calcs     │           │       │           │
      │ - Validation      │           │       │           │
      │ - Sync logic      │           │       │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L2    │ Integration Tests │ Vitest    │ 60+   │ 2–5 min   │ Per PR
      │ - DB + Prisma     │ + Node    │       │           │
      │ - Event Bus       │           │       │           │
      │ - Cache (Redis)   │           │       │           │
      │ - Outbox pattern  │           │       │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L3    │ Contract Tests    │ Vitest    │ 40+   │ 1–2 min   │ Per PR
      │ - OpenAPI schema  │ + Frisby  │       │           │
      │ - API endpoints   │           │       │           │
      │ - Error formats   │           │       │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L4    │ E2E Tests         │ Playwright│ 80+   │ 5–15 min  │ Per PR +
      │ - User flows      │ + Docker  │       │           │ nightly
      │ - Offline-sync    │           │       │           │
      │ - Permissions     │           │       │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L5    │ Device Tests      │ BrowserStack │ 20+  │ 10–20min  │ Daily +
      │ - Real devices    │ / Sauce Labs │      │           │ Pre-release
      │ - Performance     │               │      │           │
──────┼───────────────────┼───────────┼───────┼───────────┼─────────────
L6    │ Production        │ Datadog   │ –     │ Continuous│ 24/7
      │ Monitoring        │ + Grafana │       │           │
      │ - RUM, Synthetic  │           │       │           │
      │ - SLOs            │           │       │           │
```

**Соотношение:** ~50:35:15 (Unit:Integration:E2E)

---

## 3. Фазы и Сроки

### Фаза 1: Базовая Подготовка (неделя 1–2)
- [ ] Инвентаризация текущих тестов
- [ ] Установка/обновление фреймворков (Vitest, Playwright)
- [ ] Настройка CI/CD pipeline для тестирования
- [ ] Docker контейнеры для тестовой БД и Redis
- [ ] GitHub Actions workflow

### Фаза 2: Unit + Integration (неделя 2–4)
- [ ] Покрытие расчёт смен и отчётов (100%)
- [ ] Покрытие Prisma моделей
- [ ] Покрытие event-bus и outbox
- [ ] Cache слой (Redis)
- [ ] **Target:** 75%+ code coverage

### Фаза 3: E2E Критические Потоки (неделя 4–6)
- [ ] Offline → Online синхронизация
- [ ] Создание/редактирование отчётов (все роли)
- [ ] Экспорт PDF
- [ ] Telegram уведомления
- [ ] WebSocket real-time обновления
- [ ] Конфликты данных (concurrent edits)

### Фаза 4: Chaos & Network (неделя 6–7)
- [ ] Network throttling (3G, 4G, Wi-Fi)
- [ ] Intermittent connections (on/off cycle)
- [ ] Timeouts и retries
- [ ] Database failures
- [ ] Redis failures

### Фаза 5: Device Testing (неделя 7–8)
- [ ] iOS Safari (iPhone 12+, 14, latest)
- [ ] Android Chrome (Samsung, Xiaomi, OnePlus)
- [ ] Tablet (iPad, Samsung Tab)
- [ ] Low-end devices (Android 8)

### Фаза 6: Production Readiness (неделя 8–)
- [ ] Smoke тесты в staging
- [ ] Load testing (k6)
- [ ] RUM dashboard setup
- [ ] SLO alerts

---

## 4. Критические Сценарии

### 🟥 P0 — Offline-first (MUST PASS)

| # | Сценарий | Файл | Статус | Примечание |
|---|----|------|--------|-----------|
| 1 | Создание отчёта без сети | `e2e/offline-sync.spec.ts` | ⏳ | Основной UX |
| 2 | Закрытие браузера → восстановление | `e2e/offline-sync.spec.ts` | ⏳ | IndexedDB persistence |
| 3 | Sync после reconnect (идемпотентность) | `e2e/offline-sync.spec.ts` | ⏳ | Без дублирования |
| 4 | Конфликты данных (2 устройства) | `e2e/conflict-resolution.spec.ts` | ⏳ | Last-write-wins + UI |
| 5 | Очистка очереди sync | `e2e/offline-sync.spec.ts` | ⏳ | No zombie requests |

**Success Criteria:**
- Нет потери данных
- Sync завершается < 30s после reconnect
- Нет дублирования events

---

### 🟨 P1 — Network Chaos

| # | Сценарий | Инструмент | RTT | Loss | Статус |
|---|----|------|-----|------|--------|
| 1 | Slow 3G | tc (Linux) / Clumsy (Win) | 400ms | 2% | ⏳ |
| 2 | 4G LTE | Network throttling | 50ms | 0.5% | ⏳ |
| 3 | Intermittent (on/off) | Chaos API | 0/∞ | – | ⏳ |
| 4 | TCP resets | Playwright intercept | – | – | ⏳ |
| 5 | Timeout (30s) | Playwright timeout | 30s | 100% | ⏳ |

**Expectations:**
- UI остаётся responsive
- Graceful degradation (retry UI shown)
- No crashes

---

### 🟩 P2 — Sync Correctness (Data Integrity)

| # | Сценарий | Проверка | Тест |
|---|----|------|------|
| 1 | Exactly-once delivery | Idempotency key | `data-integrity.spec.ts` |
| 2 | Event ordering | Vector clock | `data-integrity.spec.ts` |
| 3 | No data loss | Event count check | `data-integrity.spec.ts` |
| 4 | No duplication | Aggregate counts | `data-integrity.spec.ts` |
| 5 | Stale write prevention | Vector timestamp | `conflict-resolution.spec.ts` |

---

### 🟦 P3 — Role-Based Access Control

| Role | Create Report | Edit Own | Edit Others | Delete | Export | View All |
|------|---|---|---|---|---|---|
| Admin | ✅ YES | ✅ | ✅ YES | ✅ YES | ✅ YES | ✅ YES |
| Dispatcher | ✅ YES | ✅ | ✅ Team | ❌ NO | ✅ YES | ⚠️ Team |
| Operator | ✅ YES | ✅ | ❌ NO | ❌ NO | ✅ Own | ❌ NO |
| Assistant | ⚠️ Limited | ✅ | ❌ NO | ❌ NO | ❌ NO | ❌ NO |

**Тесты:**
```
e2e/rbac/
  ├── admin-permissions.spec.ts
  ├── dispatcher-permissions.spec.ts
  ├── operator-permissions.spec.ts
  └── assistant-permissions.spec.ts
```

---

### 🟪 P4 — Production Stability

| # | Сценарий | Где | Tool |
|---|----|------|------|
| 1 | Database connection pool exhaustion | Staging | Stress test + monitoring |
| 2 | Redis cache miss cascade | Staging | Load test |
| 3 | PDF generation OOM | Staging | Large report export |
| 4 | WebSocket connection leak | E2E | Memory profiling |
| 5 | Telegram rate limit | Smoke test | Mock throttle |

---

## 5. Инструменты и Инфра

### Testing Stack (текущий)
```
┌─────────────────────────────────────────┐
│ Unit/Integration: Vitest                │
│ E2E: Playwright (Chrome, Firefox)       │
│ API: Frisby + OpenAPI Spec              │
│ Load: k6                                 │
│ Device: BrowserStack / Sauce Labs (TBD)│
│ Monitoring: Datadog / Grafana           │
└─────────────────────────────────────────┘
```

### Тестовая Инфраструктура
```yaml
# docker-compose.test.yml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: pilingtrack_test
      POSTGRES_PASSWORD: testpass
  
  redis:
    image: redis:7-alpine
  
  app:
    build:
      context: .
      target: development
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
```

### CI/CD Pipeline (GitHub Actions)
```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm run lint
      - run: npm run typecheck
  
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: codecov/codecov-action@v4
  
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        env:
          POSTGRES_PASSWORD: testpass
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:unit
  
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
      redis:
        image: redis:7
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
  
  smoke:
    runs-on: ubuntu-latest
    needs: [e2e]
    if: github.ref == 'refs/heads/main'
    env:
      STAGING_URL: https://staging.pilingtrack.dev
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:smoke:auth-access
  
  load:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/k6-action@v0.3.0
        with:
          filename: scripts/load-test.js
          cloud: true
  
  device-tests:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.modified, 'src/')
    steps:
      - uses: actions/checkout@v4
      - name: Run Device Tests (BrowserStack)
        env:
          BROWSERSTACK_USERNAME: ${{ secrets.BROWSERSTACK_USERNAME }}
          BROWSERSTACK_ACCESS_KEY: ${{ secrets.BROWSERSTACK_ACCESS_KEY }}
        run: |
          npm ci
          npm run test:e2e -- --project=browserstack-mobile
```

---

## 6. Критерии Покрытия

### Code Coverage Targets

| Слой | Target | Критический код |
|------|--------|-----------------|
| **Services** | 85%+ | Sync engine, validation |
| **Models** | 80%+ | Report, Shift, Data integrity |
| **Utils** | 75%+ | Calculations, formatters |
| **API Routes** | 80%+ | Endpoints + error handling |
| **Components** | 65%+ | Critical flows (forms, tables) |
| **Overall** | 75%+ | Здоровье codebase |

### Покрытие по типам

```
├─ Unit:
│  ├─ Shift time calculations    [100%] ← critical
│  ├─ Report validation          [95%]  ← critical
│  ├─ Report aggregation         [100%] ← critical
│  ├─ Sync idempotency logic     [100%] ← critical
│  ├─ Conflict detection         [90%]  ← high-risk
│  ├─ Cache invalidation         [85%]  ← important
│  └─ Telegram formatting        [70%]
│
├─ Integration:
│  ├─ Prisma models             [85%]
│  ├─ Event-bus                 [90%]   ← critical
│  ├─ Outbox pattern            [95%]   ← critical
│  ├─ Redis cache               [80%]
│  └─ PDF generation            [75%]
│
└─ E2E:
   ├─ Offline sync flow         [100%]  ← must-pass
   ├─ RBAC enforcement          [90%]   ← security
   ├─ Report creation flow      [95%]   ← main UX
   ├─ Conflict resolution UI    [85%]   ← complex
   └─ Export/Share              [80%]
```

### Measurement Tools
```bash
# Unit + Integration
npm run test:unit:coverage -- --reporter=html

# E2E (via Playwright)
npm run test:e2e -- --reporter=html

# Combined report
npm run test -- --coverage
# → coverage/
```

---

## 7. Сценарии Отказоустойчивости

### Chaos Engineering Matrix

```
┌────────────────────┬──────────┬────────────┬─────────────┐
│ Сценарий           │ Severity │ Frequency  │ Recovery    │
├────────────────────┼──────────┼────────────┼─────────────┤
│ DB connection down │ CRITICAL │ < 1%       │ Exponential │
│ Redis connection   │ HIGH     │ < 2%       │ Fallback    │
│ API timeout (30s)  │ HIGH     │ < 5%       │ Retry 3x    │
│ Network packet loss│ MEDIUM   │ < 3%       │ TCP retrans │
│ WebSocket disconnect│ MEDIUM   │ < 1%       │ Exponential │
│ Node OOM           │ CRITICAL │ < 0.1%     │ Restart     │
│ Disk full          │ CRITICAL │ < 0.01%    │ Manual      │
└────────────────────┴──────────┴────────────┴─────────────┘
```

### Инструменты Chaos

#### 1. Network Chaos
```typescript
// Инструмент: Playwright Network Interception
test('should recover from network timeout', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await new Promise(r => setTimeout(r, 35000)); // > 30s
    await route.abort('timedout');
  });
  
  // Should show retry UI, no crash
  await page.goto('http://localhost:3000');
  await expect(page).toContainText('Retrying...');
});
```

#### 2. Database Chaos
```bash
# Poisondb: kill connections
DATABASE_URL_CHAOS=true npm run test:integration

# In code:
if (process.env.DATABASE_CHAOS) {
  await prisma.$queryRaw`SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity WHERE state = 'idle'`;
}
```

#### 3. Redis Chaos
```bash
# Redis kill
redis-cli SHUTDOWN
# App must fallback to DB

# Rate limit
redis-cli CONFIG SET maxclients 1
# Should queue requests gracefully
```

### Failure Scenarios Tests
```
tests/
├── chaos/
│  ├── network-timeout.test.ts
│  ├── db-connection-pool.test.ts
│  ├── redis-failures.test.ts
│  ├── concurrent-writes.test.ts
│  └── cascade-failures.test.ts
│
└── scenarios/
   ├── double-submit-prevention.test.ts
   ├── transaction-rollback.test.ts
   └── long-running-sync.test.ts
```

---

## 8. Регрессионные и Дымовые Тесты

### Smoke Tests (быстрые, критические)

```bash
npm run test:smoke:auth-access
```

**Что проверяет:**
```typescript
// scripts/smoke-auth-access.js
const scenarios = [
  {
    role: 'admin',
    email: 'admin@piling.ru',
    password: 'admin123',
    endpoints: [
      'GET /api/sites',
      'GET /api/reports',
      'POST /api/reports (create)',
      'GET /api/system/status'
    ]
  },
  {
    role: 'dispatcher',
    email: 'dispatch@piling.ru',
    password: 'dispatch123',
    endpoints: [
      'GET /api/sites',
      'GET /api/reports'
    ]
  },
  {
    role: 'operator',
    email: 'operator@piling.ru',
    password: 'operator123',
    endpoints: [
      'GET /api/reports',
      'POST /api/reports (own only)'
    ]
  }
];
```

**Статус:** ✅ `npm run test:smoke:auth-access`

### Regression Test Suite (nightly)

```
e2e/regression/
├── report-creation.spec.ts (all roles)
├── report-editing.spec.ts (permissions)
├── report-deletion.spec.ts (admin only)
├── pdf-export.spec.ts
├── telegram-notifications.spec.ts
├── offline-sync-full-cycle.spec.ts
├── websocket-updates.spec.ts
└── rbac-enforcement.spec.ts
```

### Запуск Regression Suite

```bash
# Full regression (nightly)
npm run test:e2e -- --grep @regression

# Quick regression (PR)
npm run test:e2e -- --grep @smoke

# Specific flow
npm run test:e2e -- --grep "report creation"
```

---

## 9. Мониторинг и Метрики

### Real User Monitoring (RUM)

```typescript
// sentry.client.config.ts (уже есть)
Sentry.init({
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Replay({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
});
```

### Key Metrics Dashboard (Grafana/Datadog)

```
┌─────────────────────────────────────────────────┐
│ PilingTrack Health Dashboard                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ▄▄▄ Availability   ▄▄▄ P95 Latency             │
│  99.95% ● 45ms      │                          │
│                                                 │
│  ▄▄▄ Errors (24h)   ▄▄▄ Sync Success Rate       │
│  0.03%              │ 99.97%                    │
│                                                 │
│  ▄▄▄ Offline Users   ▄▄▄ Conflict Resolution    │
│  234 active         │ 0.2s avg                  │
│                                                 │
│  ▄▄▄ PDF Generation  ▄▄▄ Telegram Delivery      │
│  1.2s avg (95%)     │ 99.5%                     │
└─────────────────────────────────────────────────┘
```

### SLO Definition

```yaml
# docs/SLOs.yaml
availability:
  target: 99.9%
  window: 30d
  alerts:
    warning: > 99.95%
    critical: < 99.5%

latency:
  p50: < 200ms
  p95: < 1000ms
  p99: < 3000ms

sync_correctness:
  target: 99.99%
  metric: (total_events - lost_events) / total_events
  
offline_recovery:
  target: 100%
  metric: (recovered_syncs / failed_syncs)

error_rate:
  target: < 0.1%
  exclude: [404, rate-limit]
```

### Alerts Configuration

```typescript
// monitoring/alerts.ts
const alerts = {
  sync_failures: {
    condition: 'rate(sync_errors[5m]) > 0.01',
    severity: 'critical',
    notification: ['slack#alerts', 'pagerduty']
  },
  
  offline_cascade: {
    condition: 'offline_users > 1000 AND avg_sync_queue > 100',
    severity: 'critical'
  },
  
  conflict_resolution_slow: {
    condition: 'histogram_quantile(0.95, conflict_resolution_ms) > 10000',
    severity: 'warning'
  },
  
  pdf_generation_timeout: {
    condition: 'rate(pdf_timeout[5m]) > 0.05',
    severity: 'warning'
  }
};
```

---

## 10. Governance

### Test Ownership Matrix

| Слой | Владелец | Частота | SLA |
|------|----------|---------|-----|
| Unit + Contract | Dev + QA | Per PR | 30 min |
| Integration | Dev team | Per PR | 5 min |
| E2E (Critical) | QA + Dev | Per PR | 15 min |
| E2E (Full) | QA | Nightly | – |
| Device | QA (external) | Daily + release | – |
| Production Mon. | DevOps | 24/7 | – |

### Definition of Done (DoD)

- [ ] Unit tests pass (`npm test:unit`)
- [ ] Integration tests pass (`npm test:integration`)
- [ ] E2E smoke tests pass locally (`npm test:e2e:smoke`)
- [ ] Coverage >= target (see 6. Критерии Покрытия)
- [ ] No TypeScript errors
- [ ] ESLint clean
- [ ] Code review approved
- [ ] Changelog entry (if user-facing)

### Test Failure Triage

```
┌─────────────────────────────────────────┐
│ Test Failure Triage Process             │
├─────────────────────────────────────────┤
│                                         │
│ 1. Flaky? (run 3x)                     │
│    → Add to flaky list, investigate    │
│                                         │
│ 2. Environment? (DB, Redis, network)   │
│    → Fix CI config, re-run             │
│                                         │
│ 3. Real bug?                           │
│    → Block merge, create issue, fix    │
│                                         │
│ 4. Test bug?                           │
│    → Fix test, document, no revert     │
│                                         │
└─────────────────────────────────────────┘
```

### Escalation Path

```
Local dev    →  +30 min → Code review   →  +15 min → Merge
↓                         ↓
fail          Debug locally          fail → Block PR
              & run again                    → Triage
              
CI full suite  →  +5 min → Deploy to staging
↓
fail           →  Revert or hotfix
                  (+ root cause analysis)

Production health → 24/7 monitoring
↓
Alert threshold  →  PagerDuty → incident
                    response
```

### Metrics & Reporting

**Weekly Report:**
```markdown
## Test Metrics (Week of Apr 14)

### Coverage
- Unit: 82% (↑2%)
- Integration: 78% (↔)
- E2E: 91% (↑3%)
- Overall: 80%

### Execution
- Total tests: 290
- Passed: 288 (99.3%)
- Failed: 2 (both flaky, known)
- Skipped: 0

### Performance
- Unit suite: 45s
- E2E suite: 12m
- Full suite: 15m

### Issues Found
- 1 P1 (offline sync race condition)
- 0 P2
- 2 P3 (docs)

### Blockers
- None
```

---

## Чеклист Имплементации

- [ ] **Unit Tests**
  - [ ] Shift calculations (100%)
  - [ ] Report validation
  - [ ] Sync engine (pure functions)
  - [ ] Conflict detection

- [ ] **Integration Tests**
  - [ ] Prisma + PostgreSQL
  - [ ] Event-bus publishing
  - [ ] Outbox pattern + workers
  - [ ] Redis cache invalidation
  - [ ] PDF generation

- [ ] **E2E Tests**
  - [ ] Offline → online sync
  - [ ] RBAC enforcement (all roles)
  - [ ] Report CRUD flows
  - [ ] Conflict resolution UI
  - [ ] WebSocket updates
  - [ ] PDF export
  - [ ] Telegram notifications

- [ ] **Chaos & Network**
  - [ ] 3G throttling
  - [ ] Intermittent connections
  - [ ] Timeouts & retries
  - [ ] Database failures
  - [ ] Redis failures

- [ ] **Device Testing**
  - [ ] iOS Safari (2 devices)
  - [ ] Android Chrome (3 devices)
  - [ ] Responsiveness
  - [ ] Offline UX

- [ ] **CI/CD Pipeline**
  - [ ] GitHub Actions workflow
  - [ ] Docker Compose for test infra
  - [ ] Coverage reporting
  - [ ] Artifact storage (Playwright reports)

- [ ] **Monitoring**
  - [ ] Sentry integration (existing)
  - [ ] Grafana dashboard
  - [ ] SLO definitions
  - [ ] Alert rules

- [ ] **Documentation**
  - [ ] Test architecture doc
  - [ ] How to run tests locally
  - [ ] How to add new tests
  - [ ] Flaky tests registry
  - [ ] Production incident runbook

---

## Ссылки и Ресурсы

**Проект:**
- [README.md](README.md) — обзор
- [docs/TEST-ARCHITECTURE.md](docs/TEST-ARCHITECTURE.md) — существующий план

**Инструменты:**
- [Vitest](https://vitest.dev) — unit/integration
- [Playwright](https://playwright.dev) — e2e
- [k6](https://k6.io) — performance
- [BrowserStack](https://browserstack.com) — device testing

**CI/CD:**
- [GitHub Actions](https://github.com/features/actions)
- [Docker Compose](https://docs.docker.com/compose/)

**Мониторинг:**
- [Sentry](https://sentry.io)
- [Datadog](https://datadoghq.com)
- [Grafana](https://grafana.com)

---

**Статус:** ✅ Active  
**Последнее обновление:** 14 апреля 2026  
**Владелец:** QA Director / Staff Engineer  
**Версия:** 1.0  
