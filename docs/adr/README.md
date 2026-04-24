# ADR Index

Архитектурные решения PilingTrack фиксируются в формате ADR.

## Активные ADR

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-postgresql-primary-database.md) | PostgreSQL as Primary Database | Accepted | 2026-04-08 |
| [0002](0002-outbox-vs-kafka.md) | Outbox Pattern vs Kafka | Accepted | 2026-04-08 |
| [0003](0003-sync-conflict-strategy.md) | Last-Write-Wins Sync Strategy | Accepted | 2026-04-08 |
| [0004](0004-nextjs-app-router-migration.md) | Next.js App Router Migration | Superseded | 2026-04-08 |
| [0005](0005-failure-design-approach.md) | Failure Design Document Approach | Accepted | 2026-04-08 |
| [0006](0006-event-system-consolidation.md) | Event System Consolidation | Accepted | 2026-04-08 |
| [0007](0007-bounded-context-vs-service-layer.md) | Bounded Contexts vs Service Layer | Accepted | 2026-04-24 |

## Как добавить новый ADR

1. Скопировать [template.md](template.md).
2. Заполнить контекст, решение и последствия.
3. Сохранить как `NNNN-short-title.md`.
4. Обновить этот индекс.
