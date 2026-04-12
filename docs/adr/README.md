# Architectural Decision Records (ADR) Index

Список всех архитектурных решений PilingTrack.

---

## ADR Template

См. [template.md](template.md) для создания нового ADR.

---

## Active ADRs

| # | Title | Status | Date | Description |
|---|-------|--------|------|-------------|
| [0001](0001-postgresql-primary-database.md) | PostgreSQL as Primary Database | ✅ Accepted | 2026-04-08 | Удаление dual-runtime SQLite/PostgreSQL |
| [0002](0002-outbox-vs-kafka.md) | Outbox Pattern vs Kafka | ✅ Accepted | 2026-04-08 | Event delivery reliability at scale |
| [0003](0003-sync-conflict-strategy.md) | Last-Write-Wins Sync Strategy | ✅ Accepted | 2026-04-08 | Offline-first conflict resolution |
| [0004](0004-nextjs-app-router-migration.md) | Next.js App Router Migration | ⏸️ Superseded | 2026-04-08 | SPA vs file-based routing |
| [0005](0005-failure-design-approach.md) | Failure Design Document Approach | ✅ Accepted | 2026-04-08 | Failure-first design process |
| [0006](0006-event-system-consolidation.md) | Event System Consolidation | ✅ Accepted | 2026-04-08 | Merge services/ and modules/ event systems |

---

## Создание нового ADR

1. Скопируй [template.md](template.md)
2. Заполни по шаблону
3. Сохрани как `NNNN-short-title.md`
4. Обнови этот index
5. Приложи к PR

---

## Статусы

| Статус | Значение |
|--------|----------|
| **Proposed** | Предложено, не принято |
| **Accepted** | Принято, реализуется или реализовано |
| **Deprecated** | Больше не актуально |
| **Superseded** | Заменено другим ADR |
