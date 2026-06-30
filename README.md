# PilingTrack

PilingTrack — операционная платформа для свайных работ: управление объектами, экипажами и оборудованием, сменные отчеты, офлайн-синхронизация, PDF-экспорт, realtime и административный контур.

## ⚡ Установка одной командой

Требуется только **Docker Desktop** (Windows/macOS) или Docker Engine с плагином `compose` (Linux). Postgres, Redis, приложение, воркеры и WebSocket-сервер поднимаются как контейнеры — устанавливать их на хост не нужно.

**Windows:**
```cmd
git clone https://github.com/GrixenKiNG/PilingTrack.git
cd PilingTrack
setup.bat
```

**Linux / macOS:**
```bash
git clone https://github.com/GrixenKiNG/PilingTrack.git
cd PilingTrack
./setup.sh
```

Скрипт сам:
1. Сгенерирует `.env.docker` со случайными секретами (32 байта на каждый);
2. Соберёт образы и запустит стек (`docker compose up -d --build`);
3. Применит миграции Prisma и засидит БД учётными данными по умолчанию;
4. Распечатает URL и логины/пароли.

После завершения откроется [http://localhost:3000](http://localhost:3000).

| Логин | Пароль | Роль |
|-------|--------|------|
| `admin@piling.ru` | `admin123` | ADMIN |
| `dispatch@piling.ru` | `dispatch123` | DISPATCHER |
| `operator@piling.ru` | `operator123` | OPERATOR |
| `helper@piling.ru` | `helper123` | ASSISTANT |

> Поменяй пароли после первого входа. Всё остальное (схема БД, RLS-политики, сидинг справочников) уже применено автоматически.

**Остановить стек:** `docker compose --env-file .env.docker down`
**Сбросить всё (включая БД):** `docker compose --env-file .env.docker down -v && setup.bat`

Открыть на телефоне/планшете (ярлык на главный экран) — см. [INSTALL-MOBILE.md](INSTALL-MOBILE.md).

---

## Что внутри

- `src/app` — Next.js App Router: страницы и API routes
- `src/components` — UI и прикладные экраны
- `src/modules` — bounded contexts с доменной логикой
- `src/services` — orchestration/service-layer, интеграции и cross-cutting logic
- `src/core` — инфраструктурные механики: event bus, outbox, observability, reliability
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
- CQRS/read models для аналитики и агрегатов
- PDF-экспорт сводных и одиночных отчетов
- feedback/alerts/observability контур
- Telegram-уведомления и realtime-каналы

## Технологии

- Next.js 16, React 19, TypeScript 6
- Prisma 7, PostgreSQL, Redis
- BullMQ, ws, Zod
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

### Режимы разработки

В проекте три режима запуска (выбирай через `start.bat <mode>`):

| Режим | Команда | Что внутри | Когда использовать |
|---|---|---|---|
| `dev` (по умолч.) | `start.bat` | `npm run dev` + Docker для БД/Redis/MinIO | 99% времени — обычная разработка |
| `docker` | `start.bat docker` | Полный Docker-стек (app + workers + ws + БД) | Изменения в инфраструктуре, отладка cold-start |
| `prod` | `start.bat prod` | Локальный `npm run build && npm run start` | Проверка production-сборки перед деплоем |

**Важно:** не запускай `docker compose up workers` одновременно с `npm run dev` — outbox leader-election даст одному из них замолчать. Подробности и подводные камни — `docs/dev-modes.md`.

## Ключевые команды

```bash
npm run dev
npm run build
npm run start
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:e2e
npm run verify              # lint + typecheck + unit + build + smoke (запусти перед push)
npm run backfill:analytics  # восстановить ReportAnalytics за последние 7 дней
```

### Git pre-push hook (рекомендуется)

Чтобы случайно не запушить сломанную сборку (vitest зелёный, но `npm run build` падает — реальный кейс 2026-05-21), включи pre-push хук **один раз на клон**:

```bash
git config core.hooksPath .githooks
```

После этого каждый `git push` сначала прогонит `npm run verify`. Bypass для срочных случаев: `git push --no-verify`.

## Архитектурное правило

В проекте используется смешанная модель, но с явными границами:

- `modules/*` — доменные bounded contexts, где живут aggregate/command/query правила
- `services/*` — service-layer и интеграции, не притворяющиеся доменом
- `core/*` — платформенные механизмы, общие для нескольких контекстов

Подробности зафиксированы в [docs/adr/0007-bounded-context-vs-service-layer.md](docs/adr/0007-bounded-context-vs-service-layer.md).

## Документация

- [Аудит проекта](docs/audit.md) — приоритезированный список долга и рисков
- [Локальная разработка (`npm run dev` vs Docker)](docs/dev-workflow.md)
- [Развёртывание в продакшен](docs/deployment.md)
- [Ротация ключа шифрования](docs/encryption-key-rotation.md)
- [Бриф для дизайнера](docs/design-brief.md)
- [ADR index](docs/adr/README.md)
- [Disaster Recovery Plan](docs/archive/DISASTER-RECOVERY-PLAN.md) (архив, апрель 2026)
- [Test Architecture](docs/archive/TEST-ARCHITECTURE.md) (архив, апрель 2026)

## Известные предупреждения зависимостей

`npm audit` сейчас сообщает о 7 moderate-уязвимостях:

| Пакет | Где | Воздействие |
|---|---|---|
| `postcss <8.5.10` | через `next` | Build-time only. На рантайм не выходит. |
| `@hono/node-server <1.19.13` | через `@prisma/dev` | Только в dev-режиме Prisma. На прод-сборку и рантайм не влияет. |

Все — транзитивные через Next.js / Prisma. Прямого прод-импакта нет, но `npm audit fix --force` сейчас потребует мажорных откатов (`next@9`, `prisma@6.19.3`), что мы делать не будем. Резолвим через апдейт Next + Prisma на следующей мажорной версии.

## Переменные окружения для прода

Минимально: `POSTGRES_PASSWORD`, `SESSION_SECRET`, `PIN_LOOKUP_SECRET`, `DEVICE_KEY_LOOKUP_SECRET`, `ENCRYPTION_KEY` (все 32-байтные hex), `NEXT_PUBLIC_WS_URL=wss://<домен>/ws`. **`NEXT_PUBLIC_WS_URL` обязательна** — это публичный адрес WebSocket-сервера, который встраивается в bundle при сборке. По умолчанию в `.env.docker` стоит `ws://localhost:3001`, что годится только для локального dev. Полный список — `docs/deployment.md`.

## Состояние репозитория

Репозиторий хранит исходники и документацию. Временные логи, PDF-артефакты, dev-сборки и локальные результаты тестов должны оставаться вне git и удаляться после локальной диагностики.
