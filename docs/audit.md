# PilingTrack — Технический аудит

> **Снимок состояния на 2026-05-21.** Заменяет предыдущий аудит от 2026-04-30
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

| Категория | Открыто | Закрыто | Всего |
|---|---|---|---|
| 🔴 Critical | 0 | 3 (C-1, C-3, C-4) | 3 |
| 🟠 High | 3 (H-4, H-7, N-2) | 8 | 11 |
| 🟡 Medium | 6 | 8 | 14 |
| 🟢 Low | 2 | 1 | 3 |
| **Всего** | **11** | **20** | **31** |

**Закрыто за период 2026-04-30 → 2026-05-21:** 20 пунктов.

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

Также за это время:
- **DLQ-механизм** — был архитектурно недостижим (handlers глотали → outbox не видел провалов → MAX_RETRIES не достигалось). Исправлен в `899cecf`: `emitDomainEvent` теперь async + propagate; `moveToDlq` больше не re-queue; `unified-worker/outbox.ts` регистрирует подписчиков. См. подробный post-mortem 2026-05-20 в коммит-сообщении.
- **3 «потерянных» исправления из апрельского аудита**, не зафиксированных в документе: H-2, M-5, M-6 — все уже были сделаны без обновления этого файла. Это и есть причина новой политики «не доверять снимку без проверки».

---

## Открыто

### 🟠 High

#### H-4. Outbox-leader конфликт между Docker и local dev

**Симптом:** локальный `npm run dev` не может стать outbox-лидером, пока Docker-`workers` держит lease. Обходное решение в `start.bat` явно гасит Docker-воркеры. Это удобно, но спрятано как «скрытое знание».

**Как закрыть:** документировать в `README.md` (или новом `docs/dev-modes.md`) две конфигурации: «full Docker» vs «local dev + Docker DB only». Опционально — env-флаг `DISABLE_OUTBOX_WORKER=true` для embedded режима в dev.

**Усилие:** 1–2ч.

#### H-7. Нет prod-deployment автоматизации

**Симптом:** есть `docker-compose.production.yml`, но нет `Dockerfile.prod` с multi-stage build, нет Helm-чарта в боевом виде, нет staging-сборки. Деплой описан как раннбук в `CLAUDE.md`, но это не «один скрипт».

**Как закрыть:** `Dockerfile.prod` multi-stage (build → runtime) + минимальный `docker-compose.staging.yml`. Уже есть скрипт `npm run docker:build:prod` — нужен реальный Dockerfile.

**Усилие:** 4ч.

#### N-2. Sync v3 (клиентский автосинк) выключен

**Симптом:** `pushOutbox()` и `pullUpdates()` в `src/mobile/sync/sync-engine.ts` возвращают рано (см. header файла + коммит `89d0c7f`). Полевые операторы не получают автосинк по таймеру / при возврате online / на visibilitychange. Работает только ручная отправка через `/api/sync/v2`.

**Как закрыть:** убрать early `return` + решить, как авторизовать запросы из service-worker'а без localStorage-токена (используется httpOnly cookie). Скорее всего — отправлять `credentials: 'include'` и проверять session cookie на сервере.

**Усилие:** 1–2 спринта (включая тестирование на реальных устройствах).

### 🟡 Medium

#### M-2. 7 npm vulns (moderate)

`postcss <8.5.10` и `@hono/node-server <1.19.13` через транзитивные зависимости Next.js / Prisma. Прод-импакта нет (build-time / dev-only), но `npm audit` всегда красный.

**Как закрыть:** ждать апдейт Next/Prisma + добавить в `README.md` раздел «known advisories» с объяснением.

#### M-3. 4 миграции на 42 модели Prisma

Миграции «слиплись» в крупные. Не больно сейчас, но ревью миграций по PR превратится в ад.

**Как закрыть:** проводить миграции мельче, по одному смыслу — на каждый PR с моделью.

#### M-4. PDF worker — SPOF

Один реплика PDF-воркера. Если упадёт, очередь BullMQ копится → Telegram-уведомления о сабмите не приходят.

**Как закрыть:** запустить 2 реплики worker в проде (BullMQ корректно обрабатывает concurrent consumers).

#### M-8. Нет loading skeleton'ов на формах

Форма отчёта при первом заходе показывает `<Skeleton/>` блок и резко прыгает на готовую — UX-неприятный flash.

#### M-9. Toast как единственная error UI

`toast.error('Ошибка загрузки')` с одним и тем же текстом по всему приложению. Нет fallback на retry-кнопку. Пользователь не понимает, что сломалось.

#### M-11. PWA не доделан

Service-worker зарегистрирован, manifest есть, но реального background-sync не работает. Либо доделать (важно для офлайн-операторов на стройке), либо удалить SW-код.

### 🟢 Low

#### L-1. `NEXT_PUBLIC_WS_URL=ws://localhost:3001` хардкод

Прод-деплой требует ручного редактирования. Не баг, но грабля.

#### L-2. `text-[10px]` / `text-[11px]` magic sizes (~30 случаев)

Дизайн-долг, закрывается дизайн-системой.

---

## Latent (новые из этой серии)

#### N-4. Fire-and-forget `registerAllEventHandlers` в `domain-events.ts:117-130`

`import().then(...)` без `await` — потенциальная race для путей, которые НЕ берут sync-версию из `event-handlers.ts:313` напрямую. Прод-путь через `unified-worker` уже использует sync-версию. Мина под другие пути использования.

**Как закрыть:** убрать обёртку из `domain-events.ts`, оставить единственный путь — sync `registerAllEventHandlers` из `event-handlers.ts`.

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

**Резюме на 2026-05-21:** проект **значительно здоровее** апрельского состояния. Все Critical закрыты, 8 из 11 High закрыты, DLQ работает, тесты выросли с ~800 до 975. Архитектурный долг разгружен (modern bus удалён, границы слоёв запинены ESLint'ом). Остаются 3 High — все понятные, посильные, не блокирующие. Следующий полный аудит — рекомендую через 2-3 месяца или после следующего значимого инцидента.
