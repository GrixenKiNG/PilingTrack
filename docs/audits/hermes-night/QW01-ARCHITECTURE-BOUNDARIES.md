# Аудит QW01 — Архитектурные границы (modules / services / core / app)

Версия кода: `13355b565e004166580674774c27f26eb288a2a4` (ветка `hermes/code-1011`)
Дата: 2026-10-11. Только чтение: ни одна строка в `src/` не менялась.

## Итог

Скелет соответствует контракту (ADR-0007): `src/modules/` — 16 контекстов, `reports` —
эталонный DDD-образец, `core/` сам от `@/modules/` не зависит (0 импортов — чистый),
роуты обёрнуты в `withApi`/`withMutation` (7 публичных исключений — все обоснованы),
циклов длиной ≥3 нет. Но **три системных разрыва** нарушают «железное правило» —
«core не знает о домене», «modules не импортируют services», — и каждый из них
прикрыт десятками `eslint-disable` с формулой «парковка мигрирования (CLAUDE.md)»:

1. **`core/` тянет `services/`**: 5 файлов, 6 импортов — сессия, роли, outbox-статистика
   и сам производный event-bus проведены через инфраструктурный слой.
2. **13 файлов в `modules/`** импортируют `services/` напрямую — корневая причина: нет
   фасадов для авторизации (`services/auth/*`) и для записи аудита (`recordAuditEvent`).
3. **Циклическая пара** `services/reports/domain-events.ts` ↔ `event-handlers.ts`
   (динамический + статический импорт в противоположные стороны).

Мелочь — 38 файлов >500 строк (большинство — замороженные экраны операторов и ТО;
несколько живых сервисов).

## Методика

- Статический анализ импортов: `rg` по паттернам `from '@/modules/…'`,
  `from '@/services/…'`, `from '@/core/…'` в обе стороны по всем слоям
  (`src/app`, `src/components`, `src/lib`, `src/workers`, `src/modules`, `src/services`, `src/core`),
  тесты/`__tests__`/`*.d.ts` исключены.
- Циклы: скрипт Node по графу импортов (1 344 файла, 696 рёбер) — детект циклов длины ≥2;
  каждая найденная пара перепроверена напрямую `rg` в обе стороны.
- Каждое правило сверено с `eslint.config.mjs` (блоки `no-restricted-imports` для core /
  services / modules) и с контрактом (skill `pilingtrack-architecture-contract`,
  ADR-0006/0007, слой-карта, инвариант-чеклист).
- Каждая находка подтверждена открытием файла и точной строкой; фасадные `index.ts`
  прочитаны полностью (telemetry, analytics, users, system, operator-mobile, readiness, reports).
- Замороженные зоны (операторские экраны v2/v5/v7/v10, TO-экраны, ORION) учитывались
  при оценке, но не разбирались по существу.

## Находки

Уровень: К — критично · В — важно · М — мелочь / информация.

| # | Ур. | Нарушение | Доказательство (path:line) |
|---|-----|-----------|------------------------------|
| K1 | К | `core/` зависит от `services/` (контракт: «core knows nothing about the domain»; eslint-блок «core/ must not depend on upper layers»). Всего 6 импортов в 5 файлах (включая ре-экспорт event-bus в `core/event-bus/index.ts`), все с `eslint-disable` «legacy cross-layer import», включая аутентификацию в `api-wrapper` и `media-auth` | `src/core/api-wrapper.ts:12` (`readSessionToken` ← `@/services/auth/session-service`); `src/core/media/media-auth.ts:2` (`can, isPrivilegedRole` ← `@/services/auth/authorization-service`); `src/core/observability/health-tracker/aggregate.ts:3` и `src/core/observability/health-tracker/checkers/outbox.ts:2` (`getOutboxStats` ← `@/services/reports/outbox-publisher`) |
| K2 | К | `core/event-bus/index.ts` — публичный re-export производного event-bus из `services/`: против layer-карты контракта («core/event-bus keeps only the schema registry») и фактов про инциденты (производный шина именно `services/reports/domain-events.ts`) | `src/core/event-bus/index.ts:23-33` (re-export `DomainEvent, DomainEventType, emitDomainEvent, on, getRegisteredEventTypes, getHandlerCount` из `@/services/reports/domain-events`, комментарий «intentional public re-export facade»); живые потребители — `src/workers/outbox-worker.ts`, `src/workers/embedded-workers.ts`, `src/workers/unified-worker/outbox.ts` |
| K3 | К | Циклическая пара модулей внутри `services/reports`: `domain-events` динамически импортирует `event-handlers`, а `event-handlers` статически импортирует `domain-events` — порядок инициализации/регистрации хендлеров зависит от направления вхождения; при переводе на чистый ESM-граф это статический цикл | `src/services/reports/domain-events.ts:104` (`await import('@/services/reports/event-handlers')` в `emitDomainEvent`) ↔ `src/services/reports/event-handlers.ts:14` (`import { on } from '@/services/reports/domain-events'`); подтверждено `rg` в обе стороны, других циклов ≥2 нет |
| V1 | В | 13 файлов в `src/modules/` импортируют `@/services/*` напрямую (kонтракт-правило: «callers always import from `@/modules/<x>`»; eslint-блок modules). Все прикрыты одной и той же формулой «legacy cross-layer import pending the parked services<->modules migration». Корневая причина: **не существует фасадов** для авторизации (`isPrivilegedRole`, `resolveUserScope`, `resolveAccessibleUserId`, `assertCanAccessSite`, `assertCanManageUserScope`) и для записи аудита (`recordAuditEvent`, `writeReportAuditRow`) | `src/modules/inspections/application/commands/inspection-commands.ts:4`; `src/modules/crews/application/queries/crew-query.service.ts:9`; `src/modules/crews/application/commands/crew-command.service.ts:8`; `src/modules/sites/application/queries/site-query.service.ts:8,10`; `src/modules/sites/application/commands/site-command.service.ts:8`; `src/modules/sites/application/commands/site-admin-command.service.ts:10`; `src/modules/reports/application/commands/report-command.service.ts:26,37`; `src/modules/reports/application/queries/report-query.service.ts:13,15`; `src/modules/reports/application/projections/projection-worker.ts:17`; `src/modules/equipment/application/commands/pm-scheduler.ts:13`; `src/modules/operator-mobile/application/commands/production.ts:11`; `src/modules/operator-mobile/application/commands/production-corrections.ts:10`; `src/modules/operator-mobile/application/commands/shift-close.ts:11` |
| V2 | В | Неполный фасад telemetry: 4 роута в `app/api/` вынуждены обходить `@/modules/telemetry`, т.к. символы не выведены через фасад (`findForeignEquipmentIds`, `authenticateDeviceByKey`, `provisionDeviceKey`, `revokeDeviceKey`). Аналогично analytics: `getEquipmentAnalytics` отсутствует в фасадном `index.ts`. Нарушение правила «callers always import from `@/modules/<x>`» — но виноват фасад, не роуты | `src/app/api/telemetry/route.ts:15-21` и `src/app/api/telemetry/batch/route.ts:6` (`findForeignEquipmentIds` ∉ `src/modules/telemetry/index.ts:9-16`); `src/app/api/telemetry/ingest/route.ts:30` и `src/app/api/equipment/[id]/device-keys/route.ts:16-18` (`device-key-service` не в фасаде `src/modules/telemetry/index.ts:1-23` целиком); `src/app/api/admin/equipment-analytics/route.ts:5` (`getEquipmentAnalytics` ∉ `src/modules/analytics/index.ts:9`) |
| V3 | В | Массовые импорты внутренних подпутей `@/modules/readiness/**` мимо фасадного `index.ts`: 118 в `src/app/**` (api + страницы), 8 в `src/components/**` (в т.ч. TO-экраны), 2 в `src/workers/**`, 11 в самом `src/modules/**` (через явный серверный баррер `readiness/server.ts`). Фасад сознательно урезан до клиент-безопасных символов (комментарий прямо в `index.ts` про урок 04.09.2026 про `lib/db` в клиентском бандле), но это фактически «постоянный обход», зафиксированный комментариями, а не правилом | `src/modules/readiness/index.ts:1-12` (фасад из 2-х доменных символов + комментарий «Всё, что трогает базу… ввозится маршрутами напрямую из `application/**`»); `src/modules/readiness/server.ts:2-5` (явный серверный баррер, потребители — 11 строк в `src/modules/**`); выборочная выборка: `src/modules/inspections/application/commands/inspection-commands.ts:8`, `src/modules/operator-mobile/application/commands/shift-close.ts:9`, `src/modules/equipment/application/commands/equipment-maintenance.ts:10-11`, `src/modules/reports/application/projections/projection-worker.ts:19` |
| V4 | В | Аналогичный паттерн в `operator-mobile`: 62 импорта подпутей в `src/components/**` (большинство — санкционированный `@/modules/operator-mobile/contracts`, но часть — внутренние `application/*`), 4 в `src/app/api/**`, 11 в самом `src/modules/**`. Кросс-модульная «внутренняя» ссылка из reports в operator-mobile без фасада | `src/modules/operator-mobile/index.ts:1-23` (фасадный `index.ts` без `pile-passport`); `src/modules/reports/application/queries/pile-journal-types.ts:11` (`from '@/modules/operator-mobile/domain/pile-passport'`); выборочно: `src/components/piling/operator-mobile/v10/operator-v10-app.tsx`, `src/components/piling/operator-v5/operator-v5-app.tsx` (по 3 и 2 импорта `contracts`) |
| V5 | В | Двойной путь доступа к одним и тем же доменным типам/функциям: `modules/reports/application/projections/projection-worker.ts` импортирует `@/services/reports/outbox-publisher`, тогда как `src/services/reports/outbox-publisher.ts:18` сам импортирует `@/modules/reports/domain`. Два фасада в противоположных направлениях для одной и той же области `reports` | `src/modules/reports/application/projections/projection-worker.ts:17` (`projectOutboxEvents` ← `@/services/reports/outbox-publisher`) ↔ `src/services/reports/outbox-publisher.ts:18` (`ReportDomainEvent` ← `@/modules/reports/domain`); `src/services/reports/index.ts:1-16` (deprecated-фасад с пометкой «Legacy services are deprecated — import directly from @/modules/reports instead») |
| M1 | М | 37 файлов в `src/` > 500 строк (контракт-ориентир «крупные файлы — плохой знак»). Большинство — замороженные экраны (`src/components/piling/operator-mobile/v10/operator-v10-app.tsx` 1722, `src/components/piling/operator-v5/operator-v5-app.tsx` 1524, `src/components/piling/to/readiness/screens/readiness-centre.tsx` 1381, `src/components/piling/operator-v2/operator-shift-v2.tsx` 1361, `src/components/piling/operator-mobile/operator-mobile-app.tsx` 1116). Живые, незаблокированные: `src/services/audit/audit-service.ts` 1036, `src/modules/operator-mobile/application/mobile-shift-query.ts` 768, `src/components/piling/operator-mobile/api.ts` 754, `src/services/reports/event-handlers.ts` 683, `src/components/piling/admin-dictionaries.tsx` 694, `src/components/piling/operator-mobile/…/v7/operator-v7-app.tsx` 606 (заморожен), `src/components/piling/to/readiness/screens/settings-workspace.tsx` 668, `src/components/piling/inspections/run-inspection.tsx` 631, `src/components/piling/admin-reports/admin-reports.tsx` 624, `src/components/piling/operator-mobile/v…/v7-screens.tsx` 547, `src/modules/operator-mobile/application/commands/production.ts` 612, `src/components/piling/operator-mobile/v*/…/work-screen.tsx` 554, `src/components/piling/operator-mobile/v*/…/checklist-screen.tsx` 547, `src/modules/operator-mobile/domain/checklist-catalog.ts` 558, `src/components/piling/admin-sites/index.tsx` 604, `src/components/piling/operator-dashboard.tsx` 603 (документированный rollback-путь), `src/components/piling/report-form/use-report-form.ts` 592, `src/components/piling/admin-dashboard.tsx` 581, `src/components/piling/to/readiness-design-views.tsx` 580, `src/components/piling/operator-mobile/v*/…/assistant-v7-app.tsx` ? , `src/components/piling/admin-crews/crew-form-dialog.tsx` 544, `src/components/piling/admin-analytics.tsx` 564, `src/modules/equipment/application/queries/equipment-query.service.ts` 540, `src/modules/inspections/application/commands/inspection-commands.ts` 525, `src/core/media/media-service.ts` 524, `src/components/piling/maintenance/work-order-detail.tsx` 510, `src/lib/types.ts` 514, `src/lib/rate-limiter.ts` 506 (security-критичный, frozen по AGENTS), `src/components/piling/pile-journal/index.tsx` 507, `src/components/piling/maintenance/maintenance-board.tsx` 505 | полный список отсортирован по длине в scratch `audit-counts.js` (37 записей) |
| M2 | М | 7 роутов без `withApi`/`withMutation`: `src/app/api/alerts/webhook/route.ts` (shared-secret `ALERTMANAGER_WEBHOOK_TOKEN` + `timingSafeEqual` — своя аутентификация), `src/app/api/orion/lead/route.ts` (публичная форма + honeypot + `LEAD_RATE_LIMIT`, frozen ORION), `src/app/api/readiness/route.ts` + `src/app/api/ready/route.ts` + `src/app/api/health/route.ts` + `src/app/api/health/deep/route.ts` + `src/app/api/liveness/route.ts` (публичные infra-зонды). Не нарушение контракта — все исключения обоснованы | подтверждено `grep` по 7 маршрутам + прочтение заголовков |
| M3 | М | Служебный `src/services/reports/index.ts` помечен `@deprecated` и делегирует в `@/modules/reports/…`, но одновременно сам `src/core/event-bus/index.ts` и ряд `src/modules/**`-команд импортируют обратно в `@/services/reports/{domain-events,event-handlers,outbox-publisher}.ts`. Фактически домен `reports` имеет два «канона» для одних и тех же событий, и направление импорта зависит от случайности, какой файл открыт автор | суммарно из строк K3, V5, M2; см. также `src/services/reports/index.ts:1-16` |

### Подтверждено как чистые проверки (без нарушений)

- `src/core/` не импортирует `@/modules/` нигде (0 совпадений `rg`) — нижняя граница выдержана.
- Роуты `src/app/api/**` — 7 исключений из обёрток, все обоснованы (M2). Остальные >120 строк — только `src/app/api/readiness/shifts/[id]/start/route.ts` и пара telemetry-роутов (исключения по контракту).
- Циклов длины ≥3 в графе из 696 узлов нет (скрипт `depgraph3.js`, детект через DFS до глубины 5); единственная пара — K3, подтверждена вручную.
- Внутренняя зависимость `services/telemetry/*` — однонаправленная (`telemetry-buffer.ts`, `mqtt-ingestion-service.ts` → `telemetry-ingestion-service.ts`), цикл не образует.
- Прямой обход `@/services/users/` и `@/services/system/` из `src/app|components|lib|workers/**` — 0 совпадений (фасады пользователи держат).
- `eslint.config.mjs` действительно ограничивает три направления (core→services/app, services→modules/app, modules→services/app) с уровнем `warn`; все найденные обходы имеют точечные `eslint-disable` с комментарием, т.е. намеренны, а не случайны — что согласуется с формулой «parked migration».

## Не проверено

- Не выполнен `npm run build` / `tsc --noEmit` (задача только-чтение, кода не тронуто; статические находки основаны на тексте и не зависят от сборки).
- Не читано полное тело каждого из 38 файлов >500 строк (подсчитаны строки, не проверена внутренняя структура).
- Не проворачивался реальный Node-запуск циклической пары K3 (статический анализ; при переводе на чистый ESM-граф — статический цикл).
- Не проверялись `e2e/`, `scripts/`, `tests/` (контракт охватывает `src/`; в审计报告 не входит).
- Замороженные зоны (оператор v2/v5/v7/v10, TO, ORION) учтены только на уровне «не трогать»; их внутренняя архитектурная чистота не оценивалась.
