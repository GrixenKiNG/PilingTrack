# Event Contracts & Schema Registry

Enterprise-grade система контрактов событий с валидацией, версионированием и проверкой обратной совместимости.

## Архитектура

```
Producer (API)
  │
  ├─ 1. Создать EventEnvelope { meta + payload }
  ├─ 2. SchemaRegistry.validate(eventType, version, payload)
  ├─ 3. Записать в Outbox (атомарно с бизнес-данными)
  │
  ▼
Outbox Worker
  │
  ├─ 4. Прочитать unpublished events
  ├─ 5. SchemaRegistry.validate() (defensive)
  ├─ 6. Publish в Event Bus
  ├─ 7. Mark processed
  │
  ▼
Consumers (Handlers)
  │
  ├─ 8. Обработать событие
  └─ 9. При ошибке → Dead Letter Queue
```

## Типы событий (20 контрактов)

| Тип | Версия | Совместимость | Payload |
|-----|--------|---------------|---------|
| `report.created` | v1 | BACKWARD | id, userId, siteId, date, status, piles[], drillings[], downtimes[] |
| `report.updated` | v1 | BACKWARD | id, version, updatedAt, status?, changes[] |
| `report.submitted` | v1 | BACKWARD | id, userId, submittedAt, version |
| `report.deleted` | v1 | BACKWARD | id, userId, deletedAt, version |
| `crew.created` | v1 | BACKWARD | id, operatorId, equipmentId, siteId, name |
| `crew.updated` | v1 | BACKWARD | id, changes[], updatedAt |
| `crew.deactivated` | v1 | BACKWARD | id, reason?, deactivatedAt |
| `site.created` | v1 | BACKWARD | id, name, tenantId |
| `site.updated` | v1 | BACKWARD | id, changes[], updatedAt |
| `site.deleted` | v1 | BACKWARD | id, deletedAt |
| `equipment.created` | v1 | BACKWARD | id, name, model, qty |
| `equipment.updated` | v1 | BACKWARD | id, changes[], updatedAt |
| `equipment.deleted` | v1 | BACKWARD | id, deletedAt |
| `telemetry.recorded` | v1 | BACKWARD | equipmentId, siteId?, type, value, unit, timestamp |
| `sync.completed` | v1 | BACKWARD | deviceId, userId, changesApplied, changesPulled, conflictsResolved, syncDurationMs |
| `sync.failed` | v1 | BACKWARD | deviceId, userId, error, attempts |
| `sync.conflict_resolved` | v1 | BACKWARD | deviceId, reportId, strategy, resolvedAt |
| `system.degraded` | v1 | BACKWARD | component, previousStatus, currentStatus, detectedAt |
| `system.recovered` | v1 | BACKWARD | component, previousStatus, currentStatus, recoveredAt |

## EventMeta — стандартные метаданные

```typescript
interface EventMeta {
  eventId: UUID;          // UUID события
  eventType: string;      // "report.created"
  eventVersion: number;   // версия схемы
  occurredAt: string;     // ISO timestamp
  tenantId: UUID;         // тенант
  aggregateId: UUID;      // ID сущности
  aggregateType: string;  // "report", "crew", etc.
  correlationId?: UUID;   // ID цепочки запросов
  causationId?: UUID;     // ID события-причины
  producer: string;       // "pilingtrack-api"
}
```

## Schema Registry

### Регистрация схем

```typescript
import { schemaRegistry, registerAllEventSchemas } from '@/core/event-bus/schema-registry';

// Однократно при старте приложения
registerAllEventSchemas();

// Валидация при публикации
schemaRegistry.validate('report.created', 1, payload);
```

### API

| Endpoint | Описание |
|----------|----------|
| `GET /api/system/schemas` | Список всех зарегистрированных схем |

### Правила обратной совместимости

| Действие | BACKWARD | FORWARD | FULL |
|----------|----------|---------|------|
| Добавить optional поле | ✅ | ✅ | ✅ |
| Добавить required поле с default | ✅ | ✅ | ✅ |
| Добавить required поле без default | ❌ | ✅ | ❌ |
| Удалить optional поле | ✅ | ❌ | ❌ |
| Удалить required поле | ✅ | ❌ | ❌ |
| Изменить тип поля | ❌ | ❌ | ❌ |

## Контрактные тесты

```bash
npx vitest run src/core/event-bus/__tests__/schema-registry.test.ts
```

Тесты проверяют:
1. Валидные payloads проходят валидацию
2. Невалидные payloads отклоняются
3. Версионирование работает корректно
4. Все ожидаемые типы событий зарегистрированы
5. Все схемы имеют BACKWARD совместимость

## Эволюция

| Стадия | Реализация |
|--------|------------|
| **Сейчас** | In-memory Ajv Schema Registry |
| **Production** | Schema Registry Service + REST API |
| **FAANG** | Kafka + Confluent Schema Registry (Avro/Protobuf) |

## Безопасность

- HMAC подпись событий (future)
- Проверка producer (в EventMeta)
- Audit trail через OutboxEvent
