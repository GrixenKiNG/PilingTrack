# PilingTrack — Технический аудит

Дата: 2026-04-30
Ветка: `chore/april-accumulated-work`

Аудит **не исчерпывающий** — это пробежка по верхам с замерами и выборочным чтением кода. Проблемы перечислены с условной шкалой важности:

- **🔴 Critical** — исправить как можно скорее, риск данных или безопасности.
- **🟠 High** — заметно бьёт по продукту/команде, но можно жить пока.
- **🟡 Medium** — технический долг, накапливается, не горит.
- **🟢 Low** — мелочь, исправляется по случаю.

---

## 1. Обзор

| Метрика | Значение |
|---|---|
| TypeScript-файлов (без сгенерированных) | ~485 |
| Реальный LoC | ~68 000 |
| API-роутов | 65 |
| Прайма-моделей | 42 |
| Миграций | 4 |
| Тест-файлов | 64 (≈ 800 кейсов, ~12% от файлов кода) |
| Сервисов в docker-compose | 10 (postgres, redis, app, ws, workers, pgbouncer, minio, pgadmin, migrate, minio-init) |
| `as any` | 108 |
| `console.log/warn/error` (вне `__tests__`) | 22 (в основном легитимно: logger.ts, service-worker, seed) |
| TODO/FIXME/HACK | 14 |

**Вердикт верхнеуровневый:** проект **зрелый, разумно структурированный, продуманный**. CQRS, outbox, проекции, leader-election, observability, tests — всё это редко встречается в продуктах такого размера. Но накопился характерный долг, и есть несколько острых углов, которые надо притупить.

---

## 2. Архитектура

### Что хорошо

- **Чёткое разделение слоёв:** `modules/` (DDD), `services/` (cross-cutting), `core/` (infra), `app/api/` (HTTP). Это редкость в Next.js-проектах.
- **CQRS**: отдельные command-handlers и query-services, проекции выносят чтение из горячего пути.
- **Outbox + projection-worker** через Redis-leases — корректный паттерн для надёжной публикации событий.
- **Все 60 route.ts используют `withApi`/`withMutation`** — нет дублирования CSRF/rate-limit/error-handling по кускам. Это важная дисциплина.
- **42 модели** в Prisma + 4 миграции = накатывается одной командой, без обходных путей.

### Проблемы

#### 🟠 H-1. Размытое разделение `modules/` / `services/` / `core/`

`services/reports/event-handlers.ts` импортирует из всех трёх слоёв. Похожая проблема в `core/event-bus/schema-registry.ts`. По заявленным правилам в `CLAUDE.md` это **запрещено**, но никто не проверяет.

**Рекомендация:** ESLint-правило `import/no-restricted-paths` с белым списком: `modules/` импортирует только из `modules/` и `core/`; `services/` — из `services/` и `core/`; `core/` — ничего из верхних слоёв.

#### 🟡 M-1. 10 файлов > 500 строк

```
789  src/core/observability/health-tracker.ts
778  src/core/conflict-resolution/conflict-resolution-engine.ts
726  src/components/ui/sidebar.tsx          (это shadcn boilerplate, ок)
715  src/lib/pdf-generator.ts
624  src/core/event-bus/schema-registry.ts
554  src/workers/unified-worker.ts
532  src/modules/reports/application/sync-engine-v2.ts
531  src/components/piling/admin-sites/index.tsx
508  src/lib/rate-limiter.ts
```

`pdf-generator.ts` в 715 строк — раз в 6 месяцев в нём всё перепутывается. Разбить по типу документа (period-report / single-report / shared helpers). `admin-sites/index.tsx` — типичный «компонент-монолит» с состояниями и диалогами.

---

## 3. Безопасность

### Что хорошо

- **`withMutation`** даёт CSRF + rate-limit для всех mutating-роутов, без шанса забыть.
- **HMAC-хэширование** для PIN и DeviceKey lookup (`PIN_LOOKUP_SECRET`, `DEVICE_KEY_LOOKUP_SECRET`).
- **Шифрование at-rest** (`ENCRYPTION_KEY`) для секретных полей вроде Telegram bot-token.
- **`crypto.timingSafeEqual`** в auth-сравнениях (проверял в прошлой сессии).
- В `services/auth/`, `core/security/`, `lib/auth.ts`, `lib/rate-limiter.ts` — **0 случаев `as any`**. Это правильное место для строгой типизации.

### Проблемы

#### 🟠 H-2. ENCRYPTION_KEY rotation = data loss

Сегодня смена `ENCRYPTION_KEY` в `.env` ломает все ранее зашифрованные данные (Telegram токены, и любые будущие зашифрованные поля). В прошлой сессии это сожгло токен и пришлось пересохранять.

**Рекомендация:** добавить **версионирование ключа** (`enc:v1:...`, `enc:v2:...`) и поддержать **dual-decrypt** на переходный период. В коде уже есть префикс `enc:` — расширить до `enc:v1:`. Без этого ротация ключей в проде = выходной для всей команды.

#### 🟡 M-2. 7 npm vulns (moderate)

```
postcss <8.5.10  — XSS via unescaped </style> (через next)
@hono/node-server <1.19.13  — middleware bypass (через @prisma/dev)
```

Все через транзитивные зависимости Next.js + Prisma. Нет прямого прода-импакта (postcss работает только в build-time, hono/node-server — только в dev-инструменте Prisma). Но `npm audit` всегда красный = команда привыкает игнорировать.

**Рекомендация:** дождаться обновления Next/Prisma и переаудит. До этого добавить в README раздел «known advisories» с пояснением почему это не блокер.

#### 🟢 L-1. PUBLIC_WS_URL хардкодится в localhost

```
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

Прод-деплой потребует ручного редактирования. Не баг, но грабли.

---

## 4. Данные (Prisma + проекции)

### Что хорошо

- **42 модели** с понятными названиями, индексами, каскадами.
- **`Prisma.sql` template literals** везде — нет `$queryRawUnsafe` в пользовательском коде (есть только в сгенерированном клиенте).
- **`tenantId`** на всех моделях, поддержка multi-tenant заложена.
- **Cursor pagination** через `lib/pagination.ts` — не offset.

### Проблемы

#### 🔴 C-1. Битые проекции из event-handlers.ts

Найдено в этой сессии: `services/reports/event-handlers.ts:69` строит `SiteDailySummary` с фолбэками `siteId || ''` и `new Date()`. Если в событии нет `siteId`, в БД попадают строки с пустым ключом, которые потом отбрасывают агрегаты на фронте.

В этой сессии очистили битые строки, но **код, который их создаёт, остался**. Следующий новый отчёт без siteId → опять появятся.

**Рекомендация:** в `handlePileWorkForAnalytics`, `handleDrillingForAnalytics`, `handleDowntimeForAnalytics`:
- Если `event.siteId` пуст — **не писать** (а не писать с пустым ключом).
- `date` брать из `event.occurredAt`, не из `new Date()` (события могут идти с задержкой).

Минимум: добавить `if (!event.siteId) return;` в начало каждого хэндлера.

#### 🟠 H-3. OperatorPerformance + SiteWeeklyTrend без backfill-стратегии

Тоже всплыло в этой сессии: проекторы могут отстать от состояния БД (новые проекторы, миграция данных, restore из дампа). Сейчас единственный путь — `scripts/backfill-projections.ts`, который мы написали.

**Рекомендация:** превратить backfill-скрипт в **API-эндпоинт** `/api/admin/projections/rebuild?name=OperatorPerformance` или CLI-команду через `package.json` script. Чтобы не нужно было лезть в код для recovery.

#### 🟡 M-3. Только 4 миграции на 42 модели

Похоже, миграции «слиплись» в крупные. После двух команд `prisma migrate dev` модельных правок ставится в полночи. Это не больно сейчас, но ревью схемы по PR превратится в ад.

---

## 5. Фоновые работы (workers)

### Что хорошо

- **3 типа воркеров:** outbox-publisher, projection-worker, pdf-worker — каждый со своей ролью.
- **Embedded mode** (внутри Next.js процесса) + **standalone mode** (`unified-worker.ts`) — оба работают, выбираются leader-election'ом.
- **BullMQ** для PDF — правильный выбор (retry, concurrency, persistence).
- **dotenv/config** в воркерах (поправили в этой сессии).

### Проблемы

#### 🟠 H-4. Конфликт outbox-leader между Docker-стэком и local dev

В этой сессии было: Docker workers держал leader-lease, локальный `npm run dev` не мог стать лидером, события застревали. Сейчас `start.bat` явно останавливает Docker-воркеры — это **обходное решение**, а не фикс.

**Рекомендация:** документировать в README два режима использования: «полный Docker» и «локальный dev + Docker DB». Сейчас лежит спрятанным знанием.

#### 🟡 M-4. PDF worker — single point of failure

Только один PDF worker. Если он падает, очередь BullMQ копится, `report.pdf` для Telegram-уведомлений не приходит → отчёты «теряются» из чата.

**Рекомендация:** запускать 2 реплики worker в проде, BullMQ корректно обрабатывает concurrent consumers.

---

## 6. Тесты

### Что хорошо

- **64 тест-файла**, ~800 кейсов, **vitest + happy-dom**, всё прогоняется за ~7 секунд.
- Чёткое деление: unit в `__tests__/`, integration в `tests/integration/`, contract в `tests/contract/`.
- В этой сессии добавили regression-тесты для свежих фиксов (4 файла, 17 кейсов).

### Проблемы

#### 🟠 H-5. Untested API routes

Из 65 роутов покрытие выборочное. **Не покрыты тестами:**

```
/api/admin/analytics/operator-performance
/api/admin/analytics/site-weekly-trend
/api/admin/dlq
/api/analytics/sites
/api/auth/logout
/api/auth/me
/api/auth/refresh
/api/crews/all
... (по меньшей мере 30+ роутов)
```

Auth-роуты особенно болезненно — `me` и `refresh` это горячий путь, регрессии будут заметны мгновенно.

**Рекомендация:** **минимально** покрыть auth-роуты (logout/me/refresh/login — login и pin уже покрыты) + analytics (потому что мы только что чинили проекции). Это 5–6 файлов.

#### 🟡 M-5. Coverage не измеряется в CI

В `vitest.config.ts` настроен coverage-reporter (v8, lcov), но в `package.json` нет CI-команды, которая бы его прогоняла и роняла билд при падении ниже порога.

**Рекомендация:** `coverage:check` script + threshold (хотя бы `lines: 60, functions: 50` для начала).

---

## 7. Качество кода

### Что хорошо

- **Все 60 роутов** используют `withApi`/`withMutation` — нет нарушителей.
- **0 `as any` в auth/security** — правильно охраняемая зона.
- **Logger** через `lib/logger` с уровнями, не `console.log` — **22 случая `console.*` все легитимные** (logger сам, instrumentation, service-worker, seed-скрипты).

### Проблемы

#### 🟡 M-6. 108 `as any` по кодовой базе

Конкретно `analytics/operator-performance/route.ts:42` (`Map<string, ...>`) — там `as any` помогает обойти Prisma return types. Это норма для срочных фиксов, но 108 случаев = код не успели типизировать после генерации Prisma client.

**Рекомендация:** ESLint `@typescript-eslint/no-explicit-any` хотя бы как `warn`, чтобы новые `as any` бросались в глаза в PR.

#### 🟡 M-7. 14 TODO/FIXME без owner / due

```
TODO: implement leader takeover  — health-tracker.ts
FIXME: tenant scoping  — admin-analytics
HACK: fall back to pileLengthFromName  — pdf-generator
```

Это нормально, что они есть. Но без даты/тикета они мхом обрастают.

**Рекомендация:** ESLint-правило `eslint-plugin-no-warning-comments` или просто соглашение «TODO без линка на тикет = не мержим».

#### 🟢 L-2. `text-[10px]` / `text-[11px]` magic sizes

Раньше в этой сессии вычистили, потом откатили дизайнерские правки. На текущей ветке снова ~30 случаев. Не баг, но дизайн-долг (закрывается дизайн-системой из брифа).

---

## 8. UI / UX

Подробный разбор в **`docs/design-brief.md`**. Кратко: иерархия плохая, цвет размыт, типографика плывёт. Лечится дизайн-системой.

Дополнительно (что в дизайн-бриф не вошло):

#### 🟡 M-8. Нет loading skeleton'ов на формах

Форма отчёта (`report-form/`) при первом заходе показывает большой `<Skeleton/>` блок, а потом резко прыгает на готовую форму. UX-неприятный flash.

#### 🟡 M-9. Toast вместо нормальной обработки ошибок

`toast.error('Ошибка загрузки')` с одинаковым текстом по всему приложению. Пользователь не понимает, что именно сломалось. Нет fallback на retry-кнопку.

---

## 9. Operations / DevOps

### Что хорошо

- **Docker Compose** с 10 сервисами, поднимается одной командой.
- **Health-checks** через `core/observability/health-checks.ts`.
- **MinIO** для PDF-хранилища, S3-совместимо (можно мигрировать на AWS).
- **Sentry-интеграция** заложена (env vars, опциональная).

### Проблемы

#### 🟠 H-6. Нет CI/CD pipeline

В репо нет `.github/workflows/`, `.gitlab-ci.yml`, ничего. Тесты прогоняются только локально. Никто не следит, что main не сломан.

**Рекомендация:** GitHub Actions / GitLab CI с минимумом: `npm ci → typecheck → test → lint`. Это 30 минут работы.

#### 🟠 H-7. Нет prod-deployment'а / staging

Я не нашёл в репо ни Dockerfile с многоступенчатой сборкой для прода, ни Helm-чарта, ни Terraform, ни инструкции «как деплоить». Если завтра нужно поднять staging — это не «один скрипт», а проектная работа.

**Рекомендация:** `Dockerfile.prod` (multi-stage build) + минимальный compose-файл `docker-compose.prod.yml`. Это первый шаг.

#### 🟡 M-10. Нет монитринга в продакшене

OTEL-флаги есть (`OTEL_ENABLED=false` по умолчанию), Prometheus endpoint есть, но реального дашборда / алертов нет. `health-tracker.ts` собирает метрики «в стол».

**Рекомендация:** Grafana + Prometheus в `docker-compose.observability.yml` (он уже есть, по упоминаниям) — минимально 4 дашборда: HTTP latency, DB latency, BullMQ queue depth, outbox lag.

#### 🟢 L-3. Нет backup-стратегии для Postgres

Нет `pg_dump` cron-задания, нет процедуры восстановления из дампа. На локальном dev это терпимо, но если прод-деплой будет — критично.

---

## 10. PWA / Offline

В коде есть:
- `public/manifest.json` для PWA
- `service-worker-registration.tsx` с handler для background sync
- `mobile/sync/` модуль для offline-first

Но я не тестировал реальный offline-режим, и в этой сессии видно warning'и в консоли при регистрации SW — это **скорее всего работает не до конца**.

#### 🟡 M-11. Не доделанный PWA

**Рекомендация:** или дотянуть и протестировать (включая background-sync для отчётов в плохом интернете на стройке — это **реально полезный сценарий**), или удалить SW-код, чтобы не подавать ложных надежд.

---

## 11. Что точно нужно сделать в ближайшее время

Если выбрать **только 5 пунктов** в порядке отдачи:

1. **C-1 → H-2 → H-6 → H-3 → H-5** — в таком порядке.
2. C-1: фикс в event-handlers (1 час)
3. H-2: версионирование ENCRYPTION_KEY (3–4 часа)
4. H-6: GitHub Actions CI (30 минут)
5. H-3: API-эндпоинт для backfill проекций (1 час)
6. H-5: тесты на auth/me, /refresh, /logout, и analytics (3–4 часа)

**Один день** работы покроет всё критичное. Остальное — фоном.

---

## 12. Что не покрыто этим аудитом

- **Производительность под нагрузкой** — нагрузочного тестирования не делал. Стоит хотя бы k6-сценарий «100 операторов одновременно отправляют отчёт».
- **Реальное использование offline / PWA** — не запускал.
- **Email/Telegram/SMS-нотификации** — посмотрел только Telegram, и то поверхностно.
- **i18n** — приложение монолингвальное (русский). Если планируется международный продукт, это отдельный проект.
- **Доступность (a11y)** — не проверял по WCAG.

---

**Резюме:** проект **в целом здоров**. Архитектура правильная, тесты есть, security-зона охраняется. Острых углов несколько — главный (C-1 с битыми проекциями) и шифрование (H-2) надо чинить, остальное — нормальный технический долг для проекта такого размера.
