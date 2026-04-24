# PilingTrack

PilingTrack — операционная платформа для свайных работ: управление объектами, экипажами и оборудованием, сменные отчеты, офлайн-синхронизация, PDF-экспорт, realtime и административный контур.

## Что внутри

- `src/app` — Next.js App Router: страницы и API routes
- `src/components` — UI и прикладные экраны
- `src/modules` — bounded contexts с доменной логикой
- `src/services` — orchestration/service-layer, интеграции и cross-cutting logic
- `src/core` — инфраструктурные механики: event bus, outbox, observability, reliability
- `src/mobile` — офлайн-режим, local DB, sync engine
- `src/workers` — фоновые worker entrypoints
- `prisma` — схема БД и seed
- `docs/adr` — архитектурные решения

## Роли

- `ADMIN` — администрирование справочников, пользователей, объектов и отчетов
- `DISPATCHER` — диспетчерский контур и операционный контроль
- `OPERATOR` — заполнение и отправка сменных отчетов
- `ASSISTANT` — вспомогательная роль с ограниченным доступом

## Основные возможности

- управление объектами, оборудованием и бригадами
- сменные отчеты по сваям, лидерному бурению и простоям
- offline-first сценарии с синхронизацией
- CQRS/read models для аналитики и агрегатов
- PDF-экспорт сводных и одиночных отчетов
- feedback/alerts/observability контур
- Telegram-уведомления и realtime-каналы

## Технологии

- Next.js 16, React 19, TypeScript 5
- Prisma 6, PostgreSQL, Redis
- BullMQ, ws, Dexie, Zod
- Vitest, Playwright, k6
- OpenTelemetry, Sentry, Prometheus, Grafana

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Приложение поднимется на [http://localhost:3000](http://localhost:3000).

## Ключевые команды

```bash
npm run dev
npm run build
npm run start
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:e2e
```

## Архитектурное правило

В проекте используется смешанная модель, но с явными границами:

- `modules/*` — доменные bounded contexts, где живут aggregate/command/query правила
- `services/*` — service-layer и интеграции, не притворяющиеся доменом
- `core/*` — платформенные механизмы, общие для нескольких контекстов

Подробности зафиксированы в [docs/adr/0007-bounded-context-vs-service-layer.md](docs/adr/0007-bounded-context-vs-service-layer.md).

## Документация

- [ADR index](docs/adr/README.md)
- [Disaster Recovery Plan](docs/DISASTER-RECOVERY-PLAN.md)
- [Kubernetes Deployment](docs/KUBERNETES-DEPLOYMENT.md)
- [Test Architecture](docs/TEST-ARCHITECTURE.md)

## Состояние репозитория

Репозиторий хранит исходники и документацию. Временные логи, PDF-артефакты, dev-сборки и локальные результаты тестов должны оставаться вне git и удаляться после локальной диагностики.
