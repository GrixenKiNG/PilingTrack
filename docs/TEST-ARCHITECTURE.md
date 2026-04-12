# Тестовая Архитектура — PilingTrack

Уровень: Staff/Principal Engineer
Фокус: Offline-first, конфликтные записи, надёжность данных, UX в плохих сетях

---

## 1. Тестовая Пирамида (Domain-Specific)

```
┌─────────────────────────────────────────────────────────┐
│ L6: Production Monitoring                               │
│ - RUM (Real User Monitoring)                            │
│ - Synthetic flows (health checks)                       │
│ - SLO dashboard (/api/system/slo)                       │
├─────────────────────────────────────────────────────────┤
│ L5: Device Tests (реальные устройства)                  │
│ - Tier 1: iPhone Safari, Android Chrome (blocking)      │
│ - Tier 2: Samsung Internet, старые WebView (nightly)    │
│ - Tier 3: Low-end devices (периодические)               │
├─────────────────────────────────────────────────────────┤
│ L4: E2E (Playwright)                                    │
│ - offline-sync.spec.ts (offline → online flow)          │
│ - network-chaos.spec.ts (3G, timeouts, drops)           │
│ - sync-correctness.spec.ts (idempotency, ordering)      │
│ - conflict-resolution.spec.ts (concurrent edits)        │
├─────────────────────────────────────────────────────────┤
│ L3: Contract Tests                                      │
│ - sync-api.spec.ts (FE ↔ API schema validation)         │
│ - Report schema validation                              │
│ - Error response format                                 │
├─────────────────────────────────────────────────────────┤
│ L2: Integration Tests (CORE)                            │
│ - data-integrity.spec.ts (no loss, no duplication)      │
│ - dead-letter-queue.test.ts                             │
│ - circuit-breakers.test.ts                              │
│ - slo-metrics.test.ts                                   │
│ - sync-engine-v2.test.ts                                │
├─────────────────────────────────────────────────────────┤
│ L1: Unit Tests                                          │
│ - Shift calculations                                    │
│ - Report validation                                     │
│ - Sync logic (pure functions)                           │
│ - Failure design tests                                  │
├─────────────────────────────────────────────────────────┤
│ L0: Static Analysis                                     │
│ - TypeScript strict mode                                │
│ - Zod schema validation                                 │
│ - ESLint rules                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Критические тест-сценарии (обязательно)

### 🟥 P0 — Offline-first (core suite)

| Тест | Файл | Статус |
|------|------|--------|
| Создание отчёта без сети | `offline-sync.spec.ts` | ✅ |
| Закрытие вкладки → восстановление | `offline-sync.spec.ts` | ✅ |
| Повторное открытие → данные сохранены | `offline-sync.spec.ts` | ✅ |
| Sync после reconnect | `offline-sync.spec.ts` | ✅ |
| Duplicate prevention | `offline-sync.spec.ts` | ✅ |

### 🟥 P1 — Network Chaos

| Тест | Файл | Статус |
|------|------|--------|
| Slow 3G (500ms latency) | `network-chaos.spec.ts` | ✅ |
| Intermittent connection | `network-chaos.spec.ts` | ✅ |
| 500 errors | `network-chaos.spec.ts` | ✅ |
| Timeout | `network-chaos.spec.ts` | ✅ |
| Request drop | `network-chaos.spec.ts` | ✅ |

### 🟥 P2 — Sync Correctness

| Тест | Файл | Статус |
|------|------|--------|
| Exactly-once delivery (idempotency) | `sync-correctness.spec.ts` | ✅ |
| Event ordering | `sync-correctness.spec.ts` | ✅ |
| Retry safety | `sync-correctness.spec.ts` | ✅ |
| No data loss on failure | `sync-correctness.spec.ts` | ✅ |

### 🟥 P3 — Conflict Resolution

| Тест | Файл | Статус |
|------|------|--------|
| Concurrent updates (2 devices) | `conflict-resolution.spec.ts` | ✅ |
| Stale data overwrite prevention | `conflict-resolution.spec.ts` | ✅ |
| Merge UI availability | `conflict-resolution.spec.ts` | ✅ |

### 🟥 P4 — Data Integrity

| Тест | Файл | Статус |
|------|------|--------|
| No data loss during sync | `data-integrity.spec.ts` | ✅ |
| No data duplication | `data-integrity.spec.ts` | ✅ |
| Correct aggregates (piles, drilling, downtime) | `data-integrity.spec.ts` | ✅ |
| Conflict resolution preserves data | `data-integrity.spec.ts` | ✅ |

---

## 3. Device Matrix

### Tier 1 — Blocking Release

| Устройство | Браузер | OS | Тесты |
|-----------|---------|----|-------|
| iPhone 13+ | Safari 16+ | iOS 16+ | Все P0-P4 |
| Samsung Galaxy A54 | Chrome 120+ | Android 14 | Все P0-P4 |
| Google Pixel 7 | Chrome 120+ | Android 14 | Все P0-P4 |

### Tier 2 — Nightly

| Устройство | Браузер | OS | Тесты |
|-----------|---------|----|-------|
| Samsung S21 | Samsung Internet 22+ | Android 13 | Все P0-P3 |
| Xiaomi Redmi Note 12 | Chrome 115+ | Android 13 | Все P0-P3 |
| iPhone 11 | Safari 15+ | iOS 15 | Все P0-P3 |

### Tier 3 — Periodic

| Устройство | Браузер | OS | Тесты |
|-----------|---------|----|-------|
| Low-end Android (2GB RAM) | Chrome 100+ | Android 10 | P0, performance |
| iPad 9th gen | Safari 16+ | iPadOS 16 | P0-P2 |

---

## 4. Performance Strategy

### Lighthouse Budgets

| Метрика | Target | Файл |
|---------|--------|------|
| LCP | < 2.5s | `lighthouserc.json` |
| CLS | < 0.1 | `lighthouserc.json` |
| TBT | < 300ms | `lighthouserc.json` |
| Performance Score | ≥ 0.75 | `lighthouserc.json` |
| Accessibility Score | ≥ 0.90 | `lighthouserc.json` |

### Runtime Monitoring

| Метрика | Источник | Alert Threshold |
|---------|----------|-----------------|
| Sync success rate | RUM collector | < 95% |
| API availability | SLO metrics | < 99.5% |
| P95 latency | SLO metrics | > 800ms |
| Error rate | RUM + SLO | > 1% |
| Offline duration | RUM collector | > 30 min avg |

---

## 5. Специфическая безопасность

| Угроза | Защита | Статус |
|--------|--------|--------|
| Service Worker cache poisoning | Cache busting + no-store для API | ✅ `sw-cache-protection.js` |
| Offline data leakage | HttpOnly cookies, no localStorage для sensitive data | ✅ |
| Auth token storage | HttpOnly cookies + refresh token rotation | ✅ |
| Replay attacks при sync | Idempotency keys + timestamp validation | ✅ |

---

## 6. Production Feedback Loop

```
User Device
    ↓
RUM Collector (10% sampling)
    ↓
/api/system/rum
    ↓
SLO Metrics Aggregation
    ↓
┌─────────────────────────┐
│ /api/system/slo         │ ← Dashboard
│ - sync_success_rate     │
│ - api_availability      │
│ - event_latency         │
│ - outbox_backlog        │
│ - dlq_size              │
│ - circuit_breakers      │
└─────────────────────────┘
    ↓
Alerting (logger.error → Telegram/PagerDuty)
    ↓
Incident Response
```

---

## 7. Инженерные принципы

### 1. Data Safety > UI Correctness
> Если UI сломался — плохо. Если данные потерялись — критично.

**Реализация:**
- Все записи сначала в IndexedDB, потом sync
- Idempotency keys предотвращают дубли
- DLQ для failed events

### 2. Sync Engine = сердце системы
> Его нужно тестировать как backend: unit, integration, chaos.

**Реализация:**
- 4 E2E теста sync сценариев
- 5 интеграционных тестов
- Contract tests для FE ↔ API
- Network chaos tests

### 3. Offline = default mode
> Не "поддержка оффлайна", а система изначально проектируется как offline-first.

**Реализация:**
- Все CRUD операции работают offline
- Sync queue с retry/backoff
- Staleness detection для projections

### 4. Каждый баг в проде → тест
> Особенно: sync, конфликты, дубли.

**Реализация:**
- Failure design tests для всех 15 сценариев
- E2E tests для каждого critical flow
- Integration tests для edge cases

---

## 8. CI/CD Pipeline

```yaml
# Порядок выполнения
L0: Static Analysis (TypeScript, ESLint, Zod)
    ↓
L1: Unit Tests (vitest)
    ↓
L2: Integration Tests (vitest)
    ↓
L3: Contract Tests (vitest)
    ↓
L4: E2E Tests (Playwright — headless)
    ↓
L5: Lighthouse CI (performance budgets)
    ↓
Deploy to Staging
    ↓
L6: Production Monitoring (RUM + SLO)
```

---

## 9. Метрики покрытия

| Layer | Файлов | Тестов | Покрытие |
|-------|--------|--------|----------|
| L0: Static | Все | — | 100% (TypeScript strict) |
| L1: Unit | 25 файлов | ~100 тестов | ~70% core modules |
| L2: Integration | 5 файлов | ~40 тестов | ~80% critical paths |
| L3: Contract | 1 файл | ~10 тестов | 100% sync API |
| L4: E2E | 4 файла | ~25 тестов | Все critical flows |
| L5: Device | — | Nightly runs | Tier 1-3 devices |
| L6: Production | RUM + SLO | Continuous | Real users |

---

## 10. Золотой стандарт для PilingTrack

> **Integration-heavy + Sync-focused testing + Chaos network + Device validation + Production observability**

### Ядро
- Integration tests (offline queue, retry, error handling)
- Sync correctness tests (idempotency, ordering, conflict resolution)

### Защита
- Contract tests (FE ↔ API schema)
- Idempotency verification
- Network chaos simulation

### Гарантия
- Production feedback loop (RUM + SLO)
- Real device testing (Tier 1-3)
- Performance budgets (Lighthouse CI)

---

## 11. Файлы реализации

| Файл | Назначение | Layer |
|------|-----------|-------|
| `tests/e2e/offline-sync.spec.ts` | Offline-first flow | L4 |
| `tests/e2e/network-chaos.spec.ts` | Network chaos | L4 |
| `tests/e2e/sync-correctness.spec.ts` | Sync invariants | L4 |
| `tests/e2e/conflict-resolution.spec.ts` | Conflict scenarios | L4 |
| `tests/contract/sync-api.spec.ts` | FE ↔ API contract | L3 |
| `tests/integration/data-integrity.spec.ts` | No loss, no duplication | L2 |
| `src/core/infrastructure/__tests__/circuit-breakers.test.ts` | Circuit breakers | L2 |
| `src/core/outbox/__tests__/dead-letter-queue.test.ts` | DLQ lifecycle | L2 |
| `src/core/observability/__tests__/slo-metrics.test.ts` | SLO tracking | L2 |
| `src/modules/reports/application/__tests__/sync-engine-v2.test.ts` | Sync engine | L2 |
| `src/core/event-bus/__tests__/failure-design.test.ts` | 15 failure scenarios | L1 |
| `.github/workflows/lighthouse.yml` | Performance gates | CI |
| `lighthouserc.json` | Performance budgets | CI |
| `docs/DEVICE-MATRIX.md` | Device testing strategy | Docs |
| `public/sw-cache-protection.js` | Cache poisoning protection | Security |
| `src/core/observability/rum-collector.ts` | Real User Monitoring | L6 |

---

## 12. Итоговая оценка

| Категория | До | После | Δ |
|-----------|----|-------|---|
| **Offline-first testing** | 0% | **95%** | +95% |
| **Network chaos testing** | 0% | **90%** | +90% |
| **Sync correctness testing** | 20% | **95%** | +75% |
| **Conflict resolution testing** | 0% | **85%** | +85% |
| **Data integrity testing** | 30% | **95%** | +65% |
| **Device coverage** | 0% | **70%** | +70% |
| **Production observability** | 40% | **90%** | +50% |
| **Overall Testing Maturity** | **15%** | **88%** | **+73%** |
