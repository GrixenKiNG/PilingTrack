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
| 🟡 Medium | 4 | 0 | 10 | 14 |
| 🟢 Low | 2 | 0 | 1 | 3 |
| Latent / process | 0 | 0 | 3 (N-4, N-12, N-13) | 3 |
| **Всего** | **6** | **1** | **27** | **34** |

**Закрыто за период 2026-04-30 → 2026-05-23:** 25 пунктов.

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

Также за это время:
- **DLQ-механизм** — был архитектурно недостижим (handlers глотали → outbox не видел провалов → MAX_RETRIES не достигалось). Исправлен в `899cecf`: `emitDomainEvent` теперь async + propagate; `moveToDlq` больше не re-queue; `unified-worker/outbox.ts` регистрирует подписчиков. См. подробный post-mortem 2026-05-20 в коммит-сообщении.
- **3 «потерянных» исправления из апрельского аудита**, не зафиксированных в документе: H-2, M-5, M-6 — все уже были сделаны без обновления этого файла. Это и есть причина новой политики «не доверять снимку без проверки».

---

## Отложено осознанно

#### N-2. Sync v3 (клиентский автосинк) — отложен до появления офлайн-сценариев

**Решение от 2026-05-21.** `pushOutbox()` и `pullUpdates()` в `src/mobile/sync/sync-engine.ts` оставлены как no-op (см. обновлённый header файла). Это не «недоделка», а сознательная пауза.

**Почему отложили:**
- Операторы работают на городских объектах со стабильным 4G/Wi-Fi — реальных офлайн-сценариев в проде не зафиксировано.
- Онлайн-CRUD через `/api/reports/upsert` + ручной `/api/sync/v2` покрывают всю наблюдаемую активность.
- Авторизационный блокер устранён отдельно (коммит `4b8f4ae`, per-row ownership в `sync-engine-v2/report-processor.ts`) — при реактивации сетевые вызовы можно слать с `credentials: 'include'` без переделок на сервере.

**Что остаётся в коде:** скаффолдинг (триггеры online/visibilitychange/timer, vector clocks, conflict resolution) — корректный, заглушены только сетевые вызовы. Пошаговая инструкция «как ре-активировать» лежит в header'е `sync-engine.ts`.

**Условия реактивации:**
1. Появились объекты с нестабильной связью (загородные, подвалы, удалённые регионы), и операторы жалуются на потерю данных.
2. Либо: бизнес явно потребует «офлайн-первый» режим как фичу.

**Усилие при реактивации:** 1–2 спринта (включая тестирование на реальных устройствах).

---

## Открыто

### 🟡 Medium

#### M-2. 7 npm vulns (moderate)

`postcss <8.5.10` и `@hono/node-server <1.19.13` через транзитивные зависимости Next.js / Prisma. Прод-импакта нет (build-time / dev-only), но `npm audit` всегда красный.

**Как закрыть:** ждать апдейт Next/Prisma + добавить в `README.md` раздел «known advisories» с объяснением.

#### M-3. 4 миграции на 42 модели Prisma

Миграции «слиплись» в крупные. Не больно сейчас, но ревью миграций по PR превратится в ад.

**Как закрыть:** проводить миграции мельче, по одному смыслу — на каждый PR с моделью.

#### M-8. Нет loading skeleton'ов на формах

Форма отчёта при первом заходе показывает `<Skeleton/>` блок и резко прыгает на готовую — UX-неприятный flash.

#### M-9. Toast как единственная error UI

`toast.error('Ошибка загрузки')` с одним и тем же текстом по всему приложению. Нет fallback на retry-кнопку. Пользователь не понимает, что сломалось.

### 🟢 Low

#### L-1. `NEXT_PUBLIC_WS_URL=ws://localhost:3001` хардкод

Прод-деплой требует ручного редактирования. Не баг, но грабля.

#### L-2. `text-[10px]` / `text-[11px]` magic sizes (~30 случаев)

Дизайн-долг, закрывается дизайн-системой.

---

## Latent (новые из этой серии)

#### N-6. 8 skipped тестов

4 наших осознанных skip для sync v3 (выключенный код), 4 pre-existing (sync-engine status read, error-boundary timeout race и др.). Не критично, но коллективно создают slot для регрессии.

#### N-10. TODOs/FIXME без owner

ESLint правило `no-warning-comments: warn` теперь показывает их в lint. Закрывать постепенно — либо фиксить, либо `// eslint-disable-next-line no-warning-comments -- tracked in <ref>`.

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

**Резюме на 2026-05-23:** проект **значительно здоровее** апрельского состояния. Все Critical закрыты, 8 из 11 High закрыты, DLQ работает, тесты выросли с ~800 до 975. Архитектурный долг разгружен (modern bus удалён, границы слоёв запинены ESLint'ом). Единственный латентный баг с риском (N-4) закрыт 2026-05-23. Остаются 6 пунктов — все понятные, посильные, не блокирующие. Следующий полный аудит — рекомендую через 2-3 месяца или после следующего значимого инцидента.

**Замечание по L-2 (регрессия):** на 2026-05-23 magic sizes `text-[10px]/[11px]` выросли с ~30 до 56 случаев. Дизайн-системы как не было, так и нет; рост указывает на необходимость ESLint-правила или token'ов в `tailwind.config`.
