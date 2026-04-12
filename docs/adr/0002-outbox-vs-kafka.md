# ADR-0002: Outbox Pattern vs Kafka for Event Streaming

| Metadata | Value |
|----------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/core-team |
| **Context** | Event delivery reliability at scale |

---

## Context

PilingTrack использует event-driven архитектуру для:
- Обновления CQRS projections (OperatorPerformance, DowntimeSummary, etc.)
- Realtime уведомлений через WebSocket
- Аудита и compliance

Текущая реализация: Transactional Outbox Pattern с polling worker (каждые 10 секунд).

**Проблема при масштабе:** При >500 events/sec polling становится bottleneck. Worker не успевает обработать очередь, backlog растёт.

## Decision

**Фаза 1 (текущая):** Оставить Outbox Pattern с polling. Это достаточно для текущего масштаба (50-1000 пользователей).

**Фаза 2 (при >500 events/sec):** Мигрировать на Redis Streams или NATS JetStream для push-based delivery.

**Фаза 3 (при >5000 events/sec):** Рассмотреть Kafka для durability и ordering guarantees.

### Критерии миграции:
| Метрика | Порог | Действие |
|---------|-------|----------|
| Outbox backlog | > 10,000 events | Увеличить concurrency worker |
| Event processing lag P95 | > 30s | Миграция на Redis Streams |
| Event processing lag P95 | > 5min | Миграция на Kafka |

## Consequences

### Positive (текущее решение)
- ✅ Zero external dependencies (только PostgreSQL)
- ✅ Exactly-once delivery через idempotency keys
- ✅ Простота отладки — events в БД, можно query
- ✅ DLQ для failed events

### Negative
- ❌ Polling latency 10s (не real-time)
- ❌ Не масштабируется за пределы одного worker без sharding
- ❌ Backlog растёт линейно при burst нагрузки

### Risks
- 🟡 При росте >500 events/sec — degraded realtime experience
- 🟡 Миграция на Kafka потребует изменения consumer кода

## Alternatives Considered

1. **Kafka прямо сейчас**
   - Pros: Высокая пропускная способность, ordering, durability, replay
   - Cons: Сложность operational (ZooKeeper/KRaft, brokers, topics, partitions)
   - Why not chosen: Overkill для текущего масштаба (50-1000 users)

2. **Redis Streams**
   - Pros: Push-based delivery, consumer groups, автоматический failover
   - Cons: Нет durability при crash (AOF помогает, но не guarantee)
   - Why not chosen: Redis уже есть в стеке, но durability не sufficient для audit events

3. **NATS JetStream**
   - Pros: Проще Kafka, durable, ordering guarantees
   - Cons: Дополнительный operational overhead
   - Why not chosen: Новый стек, нет экспертизы в команде

## Implementation Notes

**Текущая оптимизация:**
- Увеличить concurrency worker до 5
- Уменьшить poll interval до 5 секунд
- Добавить exponential backoff для retry

**Миграция на Redis Streams (будущее):**
- Создать stream `pilingtrack:events`
- Worker потребляет через consumer group
- Idempotency keys остаются для exactly-once
- DLQ переносится в stream `pilingtrack:dlq`

## References

- [src/services/reports/outbox-publisher.ts](../../src/services/reports/outbox-publisher.ts)
- [src/core/outbox/dead-letter-queue.ts](../../src/core/outbox/dead-letter-queue.ts)
- [FAILURE-DESIGN-DOCUMENT.md](../FAILURE-DESIGN-DOCUMENT.md)
