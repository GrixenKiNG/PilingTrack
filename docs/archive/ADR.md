# Architecture Decision Records (ADR)

## ADR-001: Conflict Resolution Strategy — Vector Clock + Semantic Merge

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** Offline sync использовал last-write-wins, что приводило к потере данных при concurrent edits.

### Decision
Внедрён многоуровневый Conflict Resolution Engine:
1. **Vector Clock** для causal ordering (определяет concurrent modifications)
2. **Semantic Merge** для domain-specific collections:
   - Piles: union by grade, take max count
   - Drillings: union by type, additive meters
   - Downtimes: union by reason, additive duration
3. **Field Classification**: critical fields → server wins, temporal → client wins
4. **Conflict Audit Trail**: все конфликты логируются в `ConflictAudit` таблицу

### Alternatives Considered
- **Last-Write-Wins**: отвергнут — data loss unacceptable
- **Operational Transformation**: отвергнут — слишком сложен для этого домена
- **CRDTs**: отвергнут — overhead для offline-first сценария

### Consequences
- ✅ No data loss при concurrent offline edits
- ✅ Audit trail для всех конфликтов
- ⚠️ Сложность: 4 стратегии merge, field classification
- ⚠️ Требует vector clock на каждом устройстве

---

## ADR-002: Failure Isolation — Bulkhead + Error Boundary

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** Modular monolith — один unhandled exception валил весь процесс.

### Decision
1. **API Error Boundary**: middleware-level error catching с classification ошибок
2. **Bulkhead Pattern**: per-domain concurrency limits (reports=50, auth=100, analytics=10)
3. **Circuit Breakers**: на все внешние сервисы (Redis, S3, Telegram, DB)
4. **Graceful Degradation**: configurable fallback per endpoint

### Alternatives Considered
- **Try/catch в каждом handler**: отвергнут — inconsistent, легко забыть
- **Global error handler Next.js**: отвергнут — нет graceful degradation
- **Full microservices**: отвергнут — premature для текущей нагрузки

### Consequences
- ✅ Отказ одного домена не влияет на другие
- ✅ Auto-recovery через circuit breaker half-open state
- ⚠️ Overhead: bulkhead tracking per request
- ⚠️ Требуется tuning concurrency limits

---

## ADR-003: Event Bus Transport — Abstract Interface

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** Текущий InMemory/Redis event bus не даёт durability и replay.

### Decision
Создан абстрактный `EventBusTransport` интерфейс с адаптерами:
- **InMemory**: default для разработки
- **Redis**: текущий production
- **Kafka**: готов для миграции (когда throughput > 1000 events/sec)
- **NATS**: готов для миграции (lighter alternative)

Миграция = замена factory config, без изменения consumer кода.

### Alternatives Considered
- **Сразу Kafka**: отвергнут — operational overhead преждевременен
- **Redis Streams**: рассмотрен — достаточно для текущего масштаба
- **Custom queue**: отвергнут — reinventing the wheel

### Consequences
- ✅ Zero-code-change migration на Kafka/NATS
- ✅ Тестирование на in-memory, production на Redis
- ⚠️ Kafkajs dependency (опциональная)
- ⚠️ NATS dependency (опциональная)

---

## ADR-004: Response Cache — LRU + Request Coalescing

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** 40+ API endpoints, многие read-heavy, без кэширования.

### Decision
1. **In-memory LRU cache** с TTL per endpoint
2. **Request coalescing**: identical concurrent requests → один DB query
3. **Stale-while-revalidate**: serve stale data during refresh
4. **Cache invalidation on mutations** by entity type + tenant scope

### Alternatives Considered
- **Redis cache**: рассмотрен — для multi-instance нужен будет Redis
- **Next.js revalidate**: отвергнут — не работает для API routes с auth
- **No cache**: отвергнут — unnecessary DB load

### Consequences
- ✅ Reduction в DB load для read-heavy endpoints
- ✅ Request coalescing предотвращает thundering herd
- ⚠️ In-memory = cache не shared между instances (нужен Redis для production cluster)
- ⚠️ Cache invalidation complexity

---

## ADR-005: SLO Enforcement — Google SRE Methodology

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** Metrics есть (Prometheus), но нет error budget или burn rate alerts.

### Decision
1. **Per-domain SLO tracking**: reports=99.9%, sites=99.5%, etc.
2. **Multi-window burn rate alerts** (Google SRE pattern):
   - 5m/1h @ 14.4x → P1
   - 30m/6h @ 6x → P2
   - 2h/1d @ 3x → P3
   - 6h/3d @ 1x → P4
3. **Automatic request recording** via middleware wrapper

### Alternatives Considered
- **Prometheus-only SLO**: отвергнут — требует отдельной alert config
- **Simple error rate threshold**: отвергнут — не учитывает error budget
- **No SLO**: отвергнут — нет enforcement reliability targets

### Consequences
- ✅ Proactive alerting до exhaustion error budget
- ✅ Visibility в реаль-time reliability
- ⚠️ In-memory tracking = data loss on restart (нужен Redis для production)
- ⚠️ Требуется tuning SLO targets

---

## ADR-006: SQL Injection Fix — Parameterized Queries

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** `POST /api/sync/batch` использовал string interpolation для raw SQL.

### Decision
Заменить `$executeRawUnsafe` с string interpolation на:
- `$executeRaw` с template literals (parameterized) для report upsert
- `createMany` Prisma API для child collections (piles, drillings, downtimes)

### Consequences
- ✅ SQL injection vulnerability устранена
- ✅ Type safety через Prisma schema
- ⚠️ Minor performance hit (Prisma overhead vs raw SQL)

---

## ADR-007: Monolith First — Incremental Microservice Migration

**Date:** 2026-04-09  
**Status:** ACCEPTED  
**Context:** Target Architecture v2 предлагает 13 микросервисов.

### Decision
Миграция поэтапная:
1. **Stage 1** (now): Foundation — event bus interface, conflict resolution, error boundary
2. **Stage 2** (next): Вынести sync-service + realtime-service
3. **Stage 3**: Вынести reports-service
4. **Stage 4**: Telemetry + analytics split
5. **Stage 5**: API Gateway + full microservices

**Критерии для перехода к следующему этапу:**
- Team size > 10 developers
- Sustained throughput > 1000 requests/sec
- Deployment frequency bottleneck
- Clear operational pain from monolith

### Consequences
- ✅ Manageable operational overhead
- ✅ Team can learn distributed systems patterns
- ⚠️ Долгий migration timeline (months)
- ⚠️ Risk of partial migration (half-monolith, half-microservice)
