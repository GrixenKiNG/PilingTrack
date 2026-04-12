# ADR-0001: PostgreSQL as Primary Database (SQLite Migration)

| Metadata | Value |
|----------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/core-team |
| **Context** | Dual-runtime SQLite/PostgreSQL complexity |

---

## Context

PilingTrack изначально разрабатывался с поддержкой двух runtime: SQLite (для локальной разработки) и PostgreSQL (для production). Это создало:

- Union type `AppPrismaClient = SqlitePrismaClient | PostgresPrismaClient` — компилятор не может проверить типобезопасность
- Два сгенерированных Prisma клиента (`@prisma/client` + `src/generated/postgres-client/`)
- `patch-postgres-client.js` — хак, который ломается при обновлении Prisma
- 30% unnecessary complexity в коде и CI/CD

Миграция SQLite → PostgreSQL завершена. Все production инстансы используют PostgreSQL.

## Decision

**Удалить поддержку SQLite как runtime.** PostgreSQL становится единственной поддерживаемой базой данных.

### Что удаляется:
- `DATABASE_PROVIDER` environment variable
- SQLite Prisma client (`@prisma/client`)
- `patch-postgres-client.js`
- Dual-runtime переключатели в `src/lib/db.ts`

### Что остаётся:
- Единственный Prisma client: `src/generated/postgres-client/`
- Единственный datasource: PostgreSQL 16+

## Consequences

### Positive
- ✅ -30% complexity в конфигурации и type definitions
- ✅ Полная type-safety от компилятора
- ✅ Упрощение CI/CD pipeline
- ✅ Удаление hack-скриптов

### Negative
- ❌ Локальная разработка требует PostgreSQL (решается через Docker)
- ❌ Breaking change для существующих SQLite deployments

### Risks
- 🔴 При неудачной миграции — потеря данных у пользователей SQLite
- 🟡 Увеличение требований к developer machine (нужен Docker или локальный PostgreSQL)

## Alternatives Considered

1. **Оставить dual-runtime**
   - Pros: Гибкость для разработчиков без Docker
   - Cons: Постоянная сложность, type-safety проблемы, hack-скрипты
   - Why not chosen: Стоимость поддержки превышает пользу для 1-2 разработчиков

2. **Использовать SQLite только для unit-тестов**
   - Pros: Быстрые тесты без Docker
   - Cons: Тесты проходят на другой БД чем production — риск incompatibility
   - Why not chosen: Лучше использовать testcontainers с реальным PostgreSQL

## Implementation Notes

1. Удалить `DATABASE_PROVIDER` из `.env.example`
2. Удалить SQLite Prisma client и `patch-postgres-client.js`
3. Упростить `src/lib/db.ts` до единого Prisma client
4. Обновить `Dockerfile` — удалить SQLite зависимости
5. Обновить документацию локальной разработки (добавить `docker-compose dev`)

## References

- [prisma/schema.postgres.prisma](../../prisma/schema.postgres.prisma)
- [src/lib/db.ts](../../src/lib/db.ts)
- [scripts/patch-postgres-client.js](../../scripts/patch-postgres-client.js)
