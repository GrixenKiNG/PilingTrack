# ADR-0007: Bounded Contexts vs Service Layer

- Status: Accepted
- Date: 2026-04-24

## Context

Кодовая база выросла до состояния, где одновременно используются:

- bounded contexts в `src/modules/*`
- интеграционные и orchestration-сервисы в `src/services/*`
- платформенные инфраструктурные механики в `src/core/*`

Без явного правила границы между DDD и service-layer начинают размываться:

- доменная логика утекает в API routes
- сервисы начинают вести себя как aggregates, но без инвариантов
- Prisma-запросы размазываются по нескольким слоям

## Decision

Мы фиксируем следующую архитектурную дисциплину.

### 1. `src/modules/*` — bounded contexts

Используются для бизнес-сущностей, где есть:

- устойчивые инварианты
- жизненный цикл сущности
- доменные события
- команды и запросы, привязанные к конкретному контексту

Примеры:

- `reports`
- `crews`
- `sites`
- `equipment`

Внутри `modules/*` допустим Prisma, но только как инфраструктурная деталь контекста, а не как замена доменной модели.

### 2. `src/services/*` — service-layer

Используются для:

- orchestration между контекстами
- auth/access policies
- feedback, notifications, integrations
- адаптеров вокруг БД, очередей, внешних API

`services/*` не должен притворяться bounded context. Если в сервисе появляются:

- инварианты
- lifecycle state transitions
- доменные события
- богатые команды/запросы

это сигнал, что код нужно вынести в `modules/*`.

### 3. `src/core/*` — platform/runtime layer

Используется для cross-cutting механизмов:

- event bus
- outbox / DLQ
- observability / SLO / health
- infrastructure resiliency
- cache / circuit breakers / leader election

`core/*` не должен знать прикладные бизнес-правила конкретного домена.

### 4. API routes

API routes:

- аутентифицируют пользователя
- валидируют вход
- вызывают command/query/service слой
- не содержат доменную бизнес-логику

Допустимы только лёгкие response-shaping и transport concerns.

### 5. Raw SQL

Raw SQL допускается только для:

- hot paths
- агрегатов
- отчётных выборок
- случаев, где Prisma создаёт существенный overhead

Каждый raw-query должен иметь явный тест на контракт и безопасную параметризацию.

## Consequences

Плюсы:

- понятнее, куда класть новый код
- меньше архитектурной энтропии
- проще ревьюить изменения

Минусы:

- нужно сознательно удерживать границы
- часть старого кода ещё останется гибридной до постепенного выравнивания

## Follow-up

- при ревью новых фич проверять слой размещения
- не добавлять новые доменные инварианты в `services/*`
- выносить повторяющуюся бизнес-логику из routes в modules/services
