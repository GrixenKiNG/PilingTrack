# ADR-0006: Event System Consolidation

| Metadata | Value |
|----------|-------|
| **Status** | **Superseded — reversed direction** (see addendum 2026-05-21) |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/core-team |
| **Context** | Parallel event systems in services/ and modules/ |

> **Addendum 2026-05-21:** Phase 2 (migrate imports off legacy) never
> happened. The "new" event bus (`core/event-bus/event-bus.ts` and the
> Kafka/NATS adapters, ~947 lines) had zero callers in production code —
> only its own barrel and the unused `modules/reports/application/event-bus.ts`
> wrapper. Meanwhile the legacy bus in `services/reports/domain-events.ts`
> ran the production pipeline (proved during the 2026-05-20 monitoring
> incident — the bug was registration race, not the bus itself).
>
> **Reversal:** the modern bus was deleted instead of migrated to. The
> legacy bus is now the single source of truth. `core/event-bus/` keeps
> only `schema-registry/` (used by workers for event-payload validation)
> and re-exports legacy bus functions under the `@/core/event-bus`
> namespace for callers that already wrote the path.
>
> If a future feature needs Kafka/NATS or per-event Redis pub/sub, build
> that as a separate `core/event-bus-v3` with a clear adoption plan —
> don't resurrect the deleted code from git history without first
> demonstrating a caller exists for it.

---

## Context

PilingTrack имеет два параллельных event system:

1. **Legacy** (`src/services/reports/domain-events.ts`):
   - Global event bus с handlers
   - Outbox publisher
   - Event handlers registration

2. **New** (`src/modules/reports/application/event-bus.ts`):
   - Class-based EventBus interface
   - Redis support
   - Schema registry validation
   - Sequence tracking

**Проблема:**
- `src/core/event-bus/index.ts` импортирует из ОБОИХ источников
- Projection worker импортирует handlers из services/
- Непонятно где "owner" event логики
- Риск дублирования обработки событий

## Decision

**Консолидировать в единый event system с backward compatibility.**

### Архитектура после консолидации:

```
src/modules/reports/domain/          ← Domain events (single source)
src/modules/reports/application/     ← Event bus + handlers
src/core/event-bus/                  ← Public API (re-exports)
src/services/reports/domain-events.ts ← Legacy (re-exports from modules, deprecated)
```

### Что меняется:
1. **Domain events** — только в `modules/reports/domain/`
2. **Event bus** — `core/event-bus/event-bus.ts` (class-based)
3. **Handlers** — `services/reports/event-handlers.ts` (регистрация при старте)
4. **Outbox** — `services/reports/outbox-publisher.ts` (worker)
5. **Legacy exports** — реэкспорты с deprecation warning

### Что НЕ меняется:
- API handlers продолжают работать через `emitDomainEvent()`
- Projection worker продолжает работать
- Backward compatibility для всех существующих импортов

## Consequences

### Positive
- ✅ Единый источник truth для domain events
- ✅ Ясная граница между layers (domain → application → infrastructure)
- ✅ Schema validation для всех событий
- ✅ Sequence tracking для ordering
- ✅ Path для удаления legacy code

### Negative
- ❌ Временное дублирование (legacy exports)
- ❌ Необходимость обновить все импорты постепенно

### Risks
- 🟡 При неправильной миграции — дублирование обработки событий
- 🟡 Legacy code может оставаться навсегда если не удалить явно

## Alternatives Considered

1. **Полное удаление legacy сразу**
   - Pros: Чистая архитектура сразу
   - Cons: Risk breaking changes, нужно обновить все импорты одновременно
   - Why not chosen: Слишком рискованно для production системы

2. **Оставить как есть**
   - Pros: Ничего не ломается
   - Cons: Постоянная путаница, двойная обработка
   - Why not chosen: Technical debt растёт

## Implementation Notes

**Фаза 1 (сделано):**
- [x] Unified public API в `core/event-bus/index.ts`
- [x] Schema registry integration
- [x] Event ordering enforcement
- [x] Deprecation comments на legacy exports

**Фаза 2 (следующий спринт):**
- [ ] Обновить все импорты на `@/core/event-bus`
- [ ] Удалить `services/reports/domain-events.ts`
- [ ] Перенести event handlers в `modules/reports/application/handlers/`

**Фаза 3 (через квартал):**
- [ ] Удалить все legacy exports
- [ ] Добавить CI check "no imports from services/reports/"

## References

- [src/core/event-bus/index.ts](../../src/core/event-bus/index.ts)
- [src/modules/reports/domain/](../../src/modules/reports/domain/)
- [src/services/reports/domain-events.ts](../../src/services/reports/domain-events.ts)
- [ADR-0002: Outbox vs Kafka](0002-outbox-vs-kafka.md)
