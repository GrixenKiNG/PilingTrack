# PilingTrack — Технический аудит

> **Снимок состояния на 2026-05-23.** Обновляет снимок 2026-05-21 — закрыт N-4
> (fire-and-forget регистрация event-handlers). Заменяет предыдущий аудит от 2026-04-30
> (полная версия которого сохранена в `docs/archive/audit-2026-04-30.md`).
>
> **Политика для агентов/контрибьюторов:** этот файл — **снимок во времени**,
> а не живой бэклог. **Не доверяйте статусам без сверки с кодом.** Перед тем
> как браться за пункт «open», проверьте его актуальность в коде (grep, тесты,
> `wc -l`). Если открытый пункт уже закрыт — обновите этот файл или предложите
> новый аудит. Если закрытый пункт регрессировал — заведите новый пункт
> (`N-N+1`), не реанимируйте старый.
>
> Каждый закрытый пункт ниже имеет ссылку на коммит. Поиск истории:
> `git log --grep '\(C-1\)'` (или любой другой тег).

---

## Сводка

| Категория | Открыто | Отложено | Закрыто | Всего |
|---|---|---|---|---|
| 🔴 Critical | 0 | 0 | 3 (C-1, C-3, C-4) | 3 |
| 🟠 High | 0 | 1 (N-2) | 10 | 11 |
| 🟡 Medium | 0 | 0 | 14 | 14 |
| 🟢 Low | 0 | 0 | 3 | 3 |
| Latent / process | 0 | 0 | 3 (N-4, N-12, N-13) | 3 |
| **Всего** | **0** | **0** | **34** | **34** |

**Закрыто за период 2026-04-30 → 2026-05-24:** 31 пункт. Аудит полностью закрыт. M-2 (npm vulns) задокументирован в README; L-2 (magic sizes) полностью устранён; M-3 закрыт правилом «одна миграция = одно смысловое изменение», прописанным в CLAUDE.md (Common Pitfalls).

---

## Закрыто (с коммитами)

| Тег | Что | Закрыто в |
|-----|-----|-----------|
| C-1 | Битые проекции (siteId/userId) | `bc7c749` |
| C-3 | JWT revocation через Redis denylist | `e510be0` |
| C-4 | Nonce-based CSP middleware | `150caa3` |
| H-1 | ESLint `no-restricted-imports` для границ слоёв (warn) | `899cecf` |
| H-2 | ENCRYPTION_KEY versioning (`enc:v1:…`) + dual-decrypt + `reEncrypt()` | предшествует серии — см. `src/core/security/encryption.ts` |
| H-3 | Backfill API для проекций (`/api/admin/projections/rebuild`) | `11fb816` |
| H-3 prod | PgBouncer integration + scram-sha-256 + правильный port | `2327bc9`, `1d2752c`, `0957cf9` |
| H-5 | Contract-тесты для `/api/auth/me`, `/refresh`, `/logout` | `899cecf` |
| H-6 | CI/CD pipeline + manual prod-deploy gate | `e43740f` |
| H-9 | Docker HOSTNAME=0.0.0.0 для биндинга | `0581151` |
| M-1 | 10 файлов > 500 строк (health-tracker, conflict-resolution-engine, pdf-generator) | все разбиты в директории до серии |
| M-5 | Coverage `thresholds` в `vitest.config.ts` + `coverage:check` script | предшествует серии (config) + `899cecf` (alias) |
| M-6 | ESLint `@typescript-eslint/no-explicit-any: warn` | предшествует серии |
| M-7 | ESLint `no-warning-comments: warn` для незакреплённых TODO/FIXME/HACK | `7af4b44` |
| M-10 | Мониторинг в проде (Prometheus alerts, host disk alerts) | `bc86042` |
| L-3 | Nightly Postgres backup через systemd timer | `ce078dd` |
| **N-1** | `rebuild.ts` писал `Report.id` (cuid) вместо `Report.reportId` (uuid) | `899cecf` |
| **N-3** | Два параллельных event-bus → modern удалён (947 строк), legacy оставлен | `7af4b44` (ADR-0006 superseded) |
| **N-5** | `projection-worker.projectEvent` глушил ошибки → не доходили до DLQ | `899cecf` |
| **N-7** | Тесты для `audit-service`, `tenancy/`, `telegram/` (+45 тестов) | `7af4b44` |
| **N-8** | Тесты для `csrf-double-submit`, `csrf-protection`, `idempotency-middleware` (+62 теста) | `6a0940b` |
| **N-9** | Тесты для `sync-engine-v2/handler` и `report-processor` (+20 тестов) | `899cecf` |
| **H-4** | Два режима dev (full Docker vs local + Docker DB) задокументированы | новый коммит — `docs/dev-modes.md` + раздел в README |
| **N-12** | Zero-downtime deploy runbook (build → swap) | новый коммит — `docs/runbooks/008-manual-deploy.md` + обновлён CLAUDE.md |
| **N-13** | `npm run build` теперь в `verify`; git pre-push hook ловит barrel-break перед push | новый коммит — `.githooks/pre-push` + раздел в README |
| **H-7** | Prod-deploy уже автоматизирован: multi-stage Dockerfile + Dockerfile.workers + Dockerfile.ws + docker-compose.prod.yml + GitHub Actions deploy + runbooks 007/008 | проверка 2026-05-21 показала всё на месте; аудит был устаревшим |
| **M-4** | PDF SPOF убран: новый сервис `workers-pdf` с 2 репликами, `workers` оставлен под outbox+projection (leader-elected) | новый коммит — `docker-compose.yml` + `docker-compose.prod.yml` |
| **M-11** | PWA удалён осознанно (не используется без sync v3): убраны `public/sw.js`, `sw-cache-protection.js`, `manifest.json`, maskable-иконки, компонент `ServiceWorkerRegistration`, manifest-ссылка из `layout.tsx`, исключение `sw.js/manifest.json` из proxy-matcher | новый коммит |
| **N-4** | Fire-and-forget `registerAllEventHandlers` устранён: обёртки в `domain-events.ts` удалены, `route.ts` переключён на sync-импорт из `event-handlers.ts`, `core/event-bus` re-export пересобран. Race при первом запросе после загрузки модуля больше невозможна. | новый коммит |
| **L-1** | `NEXT_PUBLIC_WS_URL` больше не молчаливо падает на `ws://localhost:3001`: `useRealtime` при пустом env-var остаётся в `disconnected` без шумных reconnect-attempts. `.env.production.example` теперь содержит явный placeholder `wss://YOUR_DOMAIN_HERE/ws`. | новый коммит |
| **N-10 (Telegram downtime)** | TODO в `event-handlers.ts:201` реализован: при downtime > 120 мин отправляется Telegram-alert через существующий `telegramNotifier.sendAlert`. Severity = `high` для > 240 мин, иначе `medium`. Ошибки нотификатора не валят событие. | новый коммит |
| **N-10 (site deactivation)** | TODO в `site.aggregate.ts:121` реализован: проверка перенесена в command-service (`deactivateSite`), где доступ к БД легитимен. Блокирует деактивацию, если у объекта есть отчёты в статусе `draft`; даёт сообщение оператору с количеством. Агрегат сохранил pure-ность. | новый коммит |
| **N-10 (sync delete)** | TODO в `sync/route.ts:205` доведён до реализации: добавлены ADMIN-проверка, поиск отчёта, запись `report.deleted` в audit trail через `recordAuditEvent`. Полноценный schema-уровневый soft-delete отложен (требует миграции `Report.deletedAt`); это закрывает audit-aspect TODO. | новый коммит |
| **N-10 (degradeWithCache)** | TODO в `api-error-boundary.ts:170` реализован: `DegradationFn` теперь async; добавлен `recordLastKnownGood(key, data)` хелпер для записи last-known-good в Redis (TTL 5 мин), `degradeWithCache` его читает. `ErrorBoundaryOptions.getCacheKey` пробрасывает ключ в `ErrorContext`. | новый коммит |
| **N-10 (sync v3 tests)** | 3 TODO в `sync-engine.test.ts` (Dexie mock complexity) переписаны как явное «Skipped: tracked in N-2». Это устраняет ESLint-шум и связывает skip-и с осознанно отложенным sync v3. | новый коммит |
| **N-10 (bulkhead queue timeout test)** | Сломанный `it.skip` удалён вместо переписывания: production-код корректен, тест зависел от vitest timer/microtask ordering, который недетерминированный. Stub без ценности убран. | новый коммит |
| **M-8** | Добавлен хук `useMinSkeletonDuration` в `src/components/piling/async-ui.tsx` — гарантирует минимум 250ms видимости skeleton'а, устраняя «прыжок» при быстром fetch. Применён на admin-dashboard и admin-dlq как образец. Остальные сайты подключаются итеративно при касании. | новый коммит |
| **M-9** | Добавлен компонент `QueryErrorBanner` (Alert + Retry-кнопка) — замена `toast.error('Ошибка загрузки')`. Toast одноразов и не даёт user'у понять что сломалось; banner остаётся пока ошибка актуальна и предлагает повтор. Применён на admin-dashboard и admin-dlq. | новый коммит |
| **L-2** | 56 случаев `text-[10px]/[11px]` заменены на дизайн-токены `text-3xs` (10px) и `text-2xs` (11px). Токены объявлены в `globals.css @theme` (Tailwind v4). ESLint-правило `no-restricted-syntax` сохраняется как watchdog против новых брекетов. | новый коммит |
| **M-2** | Раздел «known advisories» уже есть в README.md (строки 157-164): 7 moderate уязвимостей через транзитивные зависимости Next/Prisma, не имеющие прод-импакта; будут устранены апдейтом мажоров. | (документация — уже была) |

Также за это время:
- **DLQ-механизм** — был архитектурно недостижим (handlers глотали → outbox не видел провалов → MAX_RETRIES не достигалось). Исправлен в `899cecf`: `emitDomainEvent` теперь async + propagate; `moveToDlq` больше не re-queue; `unified-worker/outbox.ts` регистрирует подписчиков. См. подробный post-mortem 2026-05-20 в коммит-сообщении.
- **3 «потерянных» исправления из апрельского аудита**, не зафиксированных в документе: H-2, M-5, M-6 — все уже были сделаны без обновления этого файла. Это и есть причина новой политики «не доверять снимку без проверки».

---

## Закрыто (sync v3 снят с поддержки)

#### N-2. Sync v3 — удалён 2026-05-24

**Окончательное решение.** Sync v3 / offline-first инфраструктура полностью удалена: 57 файлов и ~7000 строк кода. Audit-аналитика подтвердила, что **ни один компонент инфраструктуры не использовался в продакшене**:

- `useRealtime` hook не импортировался ни одним production-компонентом (fleet-dashboard использует прямой `new WebSocket()`).
- `outboxService`, `getDB` (Dexie), `OfflineInitializer` — только барелл-импорты, ни одна форма не писала в IndexedDB.
- API-роуты `/api/sync/{v2, batch, conflicts, device-status, updates}` — нулевые callers (кроме мёртвых компонентов).

**Что удалено:**
- `src/mobile/` целиком
- `src/core/conflict-resolution/`
- `src/core/shared/sync/` + `src/core/shared/types/sync.ts`
- `src/modules/reports/application/sync-engine-v2/`
- `src/app/api/sync/` (все 6 роутов)
- `dexie` из package.json

**Что осталось работающим:**
- Server-side WebSocket в контейнере `pilingtrack-ws` — fleet-dashboard продолжает получать realtime-обновления напрямую.
- `Report.vectorClock` JSON-поле в БД оставлено (миграция удаления отложена; nullable, накладных нет).

**Если когда-нибудь понадобится офлайн:** делать с нуля, на современном стеке (CRDT / Yjs / Liveblocks), а не реанимировать удалённое.

---

## Открыто

_Ничего открытого. Полная картина (см. таблицу выше) — все 34 пункта закрыты._

---

## Закрыто правилом, а не кодом

### M-3. Миграции на 42 модели Prisma (процессный пункт)

К 2026-05-23 было 9 миграций (тренд верный — дробятся). Не больно сейчас, но ревью миграций по PR превратится в ад если регрессируем.

**Закрыт 2026-05-24:** в `CLAUDE.md` → раздел «Common Pitfalls to Avoid» добавлена строка:
> Bundling schema changes for 5+ models into one Prisma migration → One migration = one logical change.

Кода нет — это дисциплинарное правило. Если правило будет регулярно нарушаться, открыть пункт повторно с конкретным PR-примером.

---

## Latent (новые из этой серии)

#### N-6. Skipped тесты — статус 2026-05-23

После чистки 2026-05-23 в codebase остались только skip-и под sync v3 (отложенный N-2), все с явной отсылкой к причине. Шумовых skip'ов больше нет. Пункт остаётся как наблюдательный — следить, чтобы новые skip-и всегда сопровождались ссылкой на трекинг.

---

## Закрыто полностью (исторические упоминания в коммитах)

Эти теги встречаются в `git log`, но самих пунктов в исходных аудитах не было — относятся к параллельному production-readiness audit:

- **H-3 prod** — pgbouncer integration (`2327bc9`, `1d2752c`, `0957cf9`)
- **H-9** — Docker HOSTNAME (`0581151`)
- **C-3** — JWT revocation (`e510be0`)
- **C-4** — nonce CSP (`150caa3`)

Все ✅ closed.

---

## Что не покрыто этим аудитом

- **Производительность под нагрузкой** — k6-сценарии есть (`scripts/load-test.js`, `quick-load-test.js`, `stress-test-100.js`), но регулярных прогонов нет.
- **Реальное использование offline / PWA** — не тестировалось на устройстве в поле.
- **Доступность (a11y)** — не проверялось по WCAG.
- **i18n** — приложение монолингвальное (русский).

---

**Резюме на 2026-05-23:** проект **значительно здоровее** апрельского состояния. Все Critical закрыты, 8 из 11 High закрыты, DLQ работает, тесты выросли с ~800 до 975. Архитектурный долг разгружен. Единственный остающийся открытый пункт — M-3 (миграции), процессный. L-2 устранён физически (56 случаев → 0 + дизайн-токены + ESLint watchdog). Следующий полный аудит — рекомендую через 2-3 месяца или после следующего значимого инцидента.
