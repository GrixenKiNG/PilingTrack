# W93 — файлы больше 500 строк в `src/`

Опись (read-only). Правило проекта (CLAUDE.md): файл больше 500 строк делить по
ответственности. Отчёт нужен, чтобы владелец видел, что делить первым, и что
вообще не трогать.

## Итог

- Всего файлов `.ts`/`.tsx` в `src/` (без `src/generated/`) длиннее 500 строк: **59**.
- По папкам верхнего уровня: `components` — 38, `modules` — 9, `services` — 4,
  `lib` — 3, `core` — 3, `workers` — 1, `app` — 1.
- Из них **21 — тесты** (`__tests__/`): не делим, только перечисляем.
- Из 38 не-тестовых: **14 заморожены** (варианты экрана машиниста), **1 вне
  доступа** (`src/lib/rate-limiter.ts`, security-critical). К делению остаётся
  **23 файла**.
- Severity: критично — 0 (это опись, не дефект), важно — 23 (собственно кандидаты
  на деление), мелочь — 0.
- Топ-5 по размеру среди делимых:
  1. `src/components/piling/to/readiness/screens/readiness-centre.tsx` — 1381 стр.,
     3 экспорта, ~10 внутренних компонентов.
  2. `src/services/audit/audit-service.ts` — 987 стр., 3 экспорта, свалка
     label-функций + сервис.
  3. `src/components/piling/to/to-module.tsx` — 880 стр., 3 экспорта, роутинг
     по `?view=` + сам модуль.
  4. `src/components/piling/admin-dictionaries.tsx` — 694 стр., 1 экспорт,
     хук инспектора + большой экран.
  5. `src/services/reports/event-handlers.ts` — 683 стр., 8 экспортов, четыре
     независимых регистратора обработчиков в одном файле.

## Методика

Всё воспроизводимо из корня `D:\PillingR\wt-night` (git-bash).

1. Список файлов и строк:
   ```
   find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path 'src/generated/*' -print0 \
     | xargs -0 wc -l | sort -rn
   ```
   Порог `> 500`. `node_modules` не содержит `src/`, `src/generated/` исключён явно.
2. Экспорты/импорты по каждому файлу:
   ```
   grep -c '^export ' <file>      # число экспортов
   grep -c '^import ' <file>      # число import-строк (см. «Не проверено»)
   ```
3. Принадлежность к тестам — наличие `__tests__/` в пути.
4. Замороженность/доступ — сверка пути с AGENTS.md §1: заморожены
   `src/components/piling/operator*/**` и `src/modules/operator-mobile/**`;
   `src/lib/rate-limiter.ts` — security-critical (off-limits).
5. «Можно ли делить» — по инвентарю верхнеуровневых `export`/`function`/`class`
   в файле (`grep -nE '^(export|function|const [A-Z]|class )' <file>`), без полного
   построчного чтения тела.

Ограничение: `wc -l` считает число переводов строки; файл без завершающего
перевода строки получит на 1 меньше. Для описи это несущественно.

## Находки

Категория файла: `важно` — кандидат на деление; `тест` — не делим, пишем;
`заморожено` — AGENTS.md §1; `вне доступа` — security-critical.
Колонка «делить»: `да`/`нет` + причина одной фразой; `—` для не-делимых категорий.

| # | severity | path:line | problem | scenario / why it matters | делить / fix |
|---|----------|-----------|---------|---------------------------|--------------|
| 1 | важно | `src/components/piling/to/readiness/screens/readiness-centre.tsx:1` | 1381 стр., 3 экспорта | Один файл держит ~10 компонентов (`RoleStepsPanel:203`, `RoleFlowFooter:271`, `StageLink:341`, `HandoverEvent:568`) + `ReadinessCentre:612` | **да** — по компонентам/секциям центра готовности |
| 2 | важно | `src/services/audit/audit-service.ts:1` | 987 стр., 3 экспорта | Свалка ~20 label-функций (`pileAcceptanceLabel:114`, `changedEquipmentFields:194`, `channelLine:265`) рядом с `describeAuditEvent:912` и `recordAuditEvent:954` | **да** — форматтеры отдельно от записи/описания события |
| 3 | важно | `src/components/piling/to/to-module.tsx:1` | 880 стр., 3 экспорта | Логика разбора `?view=`/`?tab=`/`?section=` (`surfaceOfView:169`, `parseView:173`, `parseSettingsSection:180`) + сам модуль `ToModule:272` | **да** — парсинг URL и выбор поверхности отделить от рендера |
| 4 | важно | `src/services/reports/event-handlers.ts:1` | 683 стр., **8 экспортов** | Четыре независимых регистратора (`registerAnalyticsEventHandler:29`, `registerAlertEventHandler:287`, `registerAuditEventHandler:449`, `registerTelegramReportHandler:520`) + PDF-доставка (`deliverReportPdf:599`) | **да** — разбить по обработчику (analytics / alert / audit / telegram / pdf) |
| 5 | важно | `src/components/piling/admin-dictionaries.tsx:1` | 694 стр., 1 экспорт | Хук `useCompactInspector:58`, константа `KINDS:74` и весь экран `AdminDictionaries:80` в одном файле | **да** — хук + справочные константы вынести из экрана |
| 6 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:1` | 650 стр., 1 экспорт | `SettingsWorkspace:61` + вложенный `RulesSettings:185` | **да** — правила ТБ отделить от каркаса настроек |
| 7 | важно | `src/components/piling/inspections/run-inspection.tsx:1` | 631 стр., 1 экспорт | Один монолитный `RunInspection:86` на 545 строк | **да** — шаги прохождения осмотра по секциям |
| 8 | важно | `src/components/piling/admin-reports/admin-reports.tsx:1` | 624 стр., 1 экспорт | `SortHeader:52`, `countCsvDataRows:83` и `AdminReports:87` вместе | **да** — служебные хелперы/ячейки отделить |
| 9 | важно | `src/components/piling/to/readiness/screens/reports-screen.tsx:1` | 615 стр., 1 экспорт | `resolveReportPeriod:57`, `deltaDetail:80` + `ReportsScreen:87` | **да** — расчёт периода/дельт отделить от рендера |
| 10 | важно | `src/components/piling/admin-sites/index.tsx:1` | 604 стр., 1 экспорт | `AdminSites:82` + `SiteDetail:431`, `SiteCrewBoard:518`, `ProgressBar:584`, `LabeledProgress:592` | **да** — карточка объекта и её виджеты в отдельные файлы |
| 11 | важно | `src/components/piling/to/readiness/screens/briefings-screen.tsx:1` | 582 стр., 1 экспорт | `signatureCell:50`, `dayKey:57` + `BriefingsScreen:87` | **да** — хелперы дат/подписей отделить |
| 12 | важно | `src/components/piling/admin-dashboard.tsx:1` | 578 стр., 1 экспорт | `rangeFor:88` + монолитный `AdminDashboard:96` | **да** — плитки/виджеты дашборда по секциям |
| 13 | важно | `src/components/piling/to/readiness-design-views.tsx:1` | 577 стр., **8 экспортов** | Шесть отдельных представлений (`ReadinessFleetView:150`, `ReadinessShiftsView:259`, `ReadinessPermitsView:320`, `ReadinessMaintenanceView:380`, `ReadinessReportsView:461`, `ReadinessSettingsView:523`) в одном файле | **да** — это уже коллекция views; разнести по представлениям |
| 14 | важно | `src/components/piling/admin-analytics.tsx:1` | 548 стр., 1 экспорт | `TABS:32` + `AdminAnalytics:42` (большая часть — рендер вкладок) | **да** — вкладки аналитики по компонентам |
| 15 | важно | `src/components/piling/admin-crews/crew-form-dialog.tsx:1` | 544 стр., 1 экспорт | `AssistantSelector:66`, `AssistantSelectorModal:395` + `CrewFormDialog:111` | **да** — селектор помощников вынести из диалога формы |
| 16 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:1` | 535 стр., **16 экспортов** | 16 запросов разной тематики (`getEquipmentDetails:67`, `getFuelSummary:262`, `getFleetKpiData:328`, `listMaintenancePlans:367`…) | **да** — по поддоменам: оборудование / ГСМ / ТО |
| 17 | важно | `src/core/media/media-service.ts:1` | 521 стр., 3 экспорта | Один класс `MediaService:82` (~420 стр.) — по сути одна ответственность (медиа) | **нет** — класс цельный; линии роста при добавлении нового хранилища |
| 18 | важно | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:1` | 516 стр., 1 экспорт | `buildAttention:97` + `SafetyOverviewScreen:141` | **да** — расчёт внимания отделить от экрана |
| 19 | важно | `src/lib/types.ts:1` | 514 стр., **45 экспортов** | Один баррель DTO/типов на весь домен | **нет** — единая ответственность (типы); дробление ради дробления |
| 20 | важно | `src/components/piling/maintenance/work-order-detail.tsx:1` | 510 стр., 1 экспорт | `WorkOrderDetail:97` + `PersonRow:484`, `BackLink:501` | **да** — строки/ссылки-хелперы отделить |
| 21 | важно | `src/components/piling/pile-journal/index.tsx:1` | 507 стр., 2 экспорта | `journalParams:103`, `Th:501`, `Td:505` + `PileJournal:113` | **да** — ячейки таблицы и параметры URL отделить |
| 22 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:1` | 506 стр., **6 экспортов** | Четыре команды (`startToInspection:58`, `startInspection:176`, `saveAnswers:251`, `completeInspectionWithOutcome:318`) в одном файле | **да** — по командам (запуск / ответы / завершение) |
| 23 | важно | `src/components/piling/maintenance/maintenance-board.tsx:1` | 505 стр., 1 экспорт | `ALL:60` + `MaintenanceBoard:63` | **да** — доска обслуживания по секциям/колонкам |
| 24 | заморожено | `src/components/piling/operator-next/__tests__/operator-next-app.test.tsx:1` | 1786 стр. | Тест варианта оператора (AGENTS.md §1) | — |
| 25 | заморожено | `src/components/piling/operator-mobile/v10/operator-v10-app.tsx:1` | 1716 стр. | Вариант мобильного экрана машиниста, заморожен | — |
| 26 | заморожено | `src/components/piling/operator-v5/operator-v5-app.tsx:1` | 1312 стр. | Вариант экрана машиниста, заморожен | — |
| 27 | заморожено | `src/components/piling/operator-v2/operator-shift-v2.tsx:1` | 1256 стр. | Вариант экрана машиниста, заморожен | — |
| 28 | заморожено | `src/components/piling/operator-mobile/operator-mobile-app.tsx:1` | 1004 стр. | Мобильное приложение оператора, заморожено | — |
| 29 | заморожено | `src/components/piling/operator-next/operator-next-app.tsx:1` | 988 стр. | Вариант экрана машиниста, заморожен | — |
| 30 | заморожено | `src/components/piling/operator-mobile/__tests__/api.test.ts:1` | 933 стр. | Тест мобильного модуля, заморожен | — |
| 31 | заморожено | `src/components/piling/operator-mobile/api.ts:1` | 753 стр. | API мобильного модуля, заморожен | — |
| 32 | заморожено | `src/modules/operator-mobile/application/mobile-shift-query.ts:1` | 749 стр. | Приложение operator-mobile (AGENTS.md §1) | — |
| 33 | заморожено | `src/components/piling/operator-dashboard.tsx:1` | 603 стр. | Документированный путь отката экрана оператора — хранить | — |
| 34 | заморожено | `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:1` | 568 стр. | Вариант экрана машиниста, заморожен | — |
| 35 | заморожено | `src/modules/operator-mobile/domain/checklist-catalog.ts:1` | 558 стр. | Домен operator-mobile, заморожен | — |
| 36 | заморожено | `src/modules/operator-mobile/application/commands/production.ts:1` | 551 стр. | Приложение operator-mobile, заморожено | — |
| 37 | заморожено | `src/components/piling/operator-mobile/v7/v7-screens.tsx:1` | 542 стр. | Вариант экрана машиниста, заморожен | — |
| 38 | заморожено | `src/components/piling/operator-mobile/screens/checklist-screen.tsx:1` | 538 стр. | Экран мобильного модуля, заморожен | — |
| 39 | заморожено | `src/components/piling/operator-mobile/screens/work-screen.tsx:1` | 525 стр. | Экран мобильного модуля, заморожен | — |
| 40 | заморожено | `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:1` | 580 стр. | Тест домена operator-mobile, заморожен | — |
| 41 | заморожено | `src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx:1` | 510 стр. | Тест мобильного модуля, заморожен | — |
| 42 | вне доступа | `src/lib/rate-limiter.ts:1` | 515 стр., 8 экспортов | Security-critical (AGENTS.md §1): класс `RateLimiter:102`, Lua-скрипт `RATE_LIMIT_LUA:47` | — |
| 43 | тест | `src/components/piling/to/__tests__/to-module-shell.test.tsx:1` | 1292 стр., 0 экспортов | Тест shell модуля ТБ | — |
| 44 | тест | `src/services/audit/__tests__/audit-service.test.ts:1` | 1265 стр. | Тест сервиса аудита | — |
| 45 | тест | `src/app/api/__tests__/api-routes.test.ts:1` | 871 стр. | Тест API-роутов | — |
| 46 | тест | `src/services/reports/__tests__/daily-summary.test.ts:1` | 741 стр. | Тест дневной сводки | — |
| 47 | тест | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts:1` | 733 стр. | Тест команд отчёта | — |
| 48 | тест | `src/components/piling/inspections/__tests__/inspection-messages.test.tsx:1` | 641 стр. | Тест сообщений осмотра | — |
| 49 | тест | `src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx:1` | 629 стр. | Тест центра готовности | — |
| 50 | тест | `src/modules/crews/application/commands/__tests__/crew-command-service.test.ts:1` | 589 стр. | Тест команд бригад | — |
| 51 | тест | `src/components/piling/admin-reports/__tests__/admin-reports.test.tsx:1` | 576 стр. | Тест отчётов админа | — |
| 52 | тест | `src/core/observability/__tests__/health-tracker.test.ts:1` | 551 стр. | Тест трекера здоровья | — |
| 53 | тест | `src/lib/__tests__/pdf-generator.test.ts:1` | 550 стр. | Тест PDF-генератора | — |
| 54 | тест | `src/core/notifications/__tests__/telegram.test.ts:1` | 548 стр. | Тест Telegram-уведомлений | — |
| 55 | тест | `src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx:1` | 542 стр. | Тест сообщений обслуживания | — |
| 56 | тест | `src/workers/__tests__/unified-worker.test.ts:1` | 514 стр. | Тест воркера | — |
| 57 | тест | `src/components/piling/admin-equipment/detail/__tests__/equipment-detail-overview.test.tsx:1` | 513 стр. | Тест карточки оборудования | — |
| 58 | тест | `src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts:1` | 504 стр. | Тест паспорта сваи | — |
| 59 | тест | `src/components/piling/admin-users/__tests__/admin-users.test.tsx:1` | 503 стр. | Тест управления пользователями | — |

### Приложение — полная опись (строки | экспорты | import-строки)

Формат: `строки | export | import | путь`.

```
1786 |  0 |  9 | src/components/piling/operator-next/__tests__/operator-next-app.test.tsx
1716 |  3 | 19 | src/components/piling/operator-mobile/v10/operator-v10-app.tsx
1381 |  3 | 14 | src/components/piling/to/readiness/screens/readiness-centre.tsx
1312 |  3 | 13 | src/components/piling/operator-v5/operator-v5-app.tsx
1292 |  0 | 12 | src/components/piling/to/__tests__/to-module-shell.test.tsx
1265 |  0 |  3 | src/services/audit/__tests__/audit-service.test.ts
1256 |  1 | 28 | src/components/piling/operator-v2/operator-shift-v2.tsx
1004 |  1 | 26 | src/components/piling/operator-mobile/operator-mobile-app.tsx
 988 |  1 | 28 | src/components/piling/operator-next/operator-next-app.tsx
 987 |  3 |  6 | src/services/audit/audit-service.ts
 933 |  0 |  3 | src/components/piling/operator-mobile/__tests__/api.test.ts
 880 |  3 | 22 | src/components/piling/to/to-module.tsx
 871 |  0 |  4 | src/app/api/__tests__/api-routes.test.ts
 753 | 16 |  2 | src/components/piling/operator-mobile/api.ts
 749 |  1 | 16 | src/modules/operator-mobile/application/mobile-shift-query.ts
 741 |  0 |  5 | src/services/reports/__tests__/daily-summary.test.ts
 733 |  0 |  6 | src/modules/reports/application/commands/__tests__/report-command-service.test.ts
 694 |  1 | 19 | src/components/piling/admin-dictionaries.tsx
 683 |  8 | 10 | src/services/reports/event-handlers.ts
 650 |  1 | 21 | src/components/piling/to/readiness/screens/settings-workspace.tsx
 641 |  0 |  9 | src/components/piling/inspections/__tests__/inspection-messages.test.tsx
 631 |  1 | 18 | src/components/piling/inspections/run-inspection.tsx
 629 |  0 | 10 | src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx
 624 |  1 | 26 | src/components/piling/admin-reports/admin-reports.tsx
 615 |  1 | 18 | src/components/piling/to/readiness/screens/reports-screen.tsx
 604 |  1 | 24 | src/components/piling/admin-sites/index.tsx
 603 |  1 | 19 | src/components/piling/operator-dashboard.tsx
 589 |  0 |  4 | src/modules/crews/application/commands/__tests__/crew-command-service.test.ts
 582 |  1 | 16 | src/components/piling/to/readiness/screens/briefings-screen.tsx
 580 |  0 | 17 | src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts
 578 |  1 | 18 | src/components/piling/admin-dashboard.tsx
 577 |  8 | 14 | src/components/piling/to/readiness-design-views.tsx
 576 |  0 |  6 | src/components/piling/admin-reports/__tests__/admin-reports.test.tsx
 568 |  1 | 13 | src/components/piling/operator-mobile/v7/operator-v7-app.tsx
 558 |  2 |  1 | src/modules/operator-mobile/domain/checklist-catalog.ts
 551 |  5 | 10 | src/modules/operator-mobile/application/commands/production.ts
 551 |  0 |  2 | src/core/observability/__tests__/health-tracker.test.ts
 550 |  0 |  3 | src/lib/__tests__/pdf-generator.test.ts
 548 |  1 | 16 | src/components/piling/admin-analytics.tsx
 548 |  0 |  4 | src/core/notifications/__tests__/telegram.test.ts
 544 |  1 | 13 | src/components/piling/admin-crews/crew-form-dialog.tsx
 542 |  8 |  9 | src/components/piling/operator-mobile/v7/v7-screens.tsx
 542 |  0 |  8 | src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx
 538 |  1 |  7 | src/components/piling/operator-mobile/screens/checklist-screen.tsx
 535 | 16 |  7 | src/modules/equipment/application/queries/equipment-query.service.ts
 525 |  1 | 11 | src/components/piling/operator-mobile/screens/work-screen.tsx
 521 |  3 |  7 | src/core/media/media-service.ts
 516 |  1 | 14 | src/components/piling/to/readiness/screens/safety-overview-screen.tsx
 515 |  8 |  2 | src/lib/rate-limiter.ts
 514 | 45 |  0 | src/lib/types.ts
 514 |  0 |  2 | src/workers/__tests__/unified-worker.test.ts
 513 |  0 | 10 | src/components/piling/admin-equipment/detail/__tests__/equipment-detail-overview.test.tsx
 510 |  1 | 20 | src/components/piling/maintenance/work-order-detail.tsx
 510 |  0 |  7 | src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx
 507 |  2 | 11 | src/components/piling/pile-journal/index.tsx
 506 |  6 |  9 | src/modules/inspections/application/commands/inspection-commands.ts
 505 |  1 | 21 | src/components/piling/maintenance/maintenance-board.tsx
 504 |  0 |  2 | src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts
 503 |  0 |  5 | src/components/piling/admin-users/__tests__/admin-users.test.tsx
```

## Не проверено

1. **«Import из других модулей».** Считал все строки верхнего уровня `^import `
   (включая пакеты и относительные пути), а не только импорты из `@/…`. Разделение
   `внешние vs внутренние` делал выборочно (для 7 файлов). Точную цифру
   «импортов именно из других модулей» по всем 59 файлам не снимал.
2. **Полное чтение тел файлов.** Оценка «можно ли делить» опирается на инвентарь
   верхнеуровневых `export`/`function`/`class`, а не на построчное чтение. Для
   файла №17 (`media-service.ts`) и №19 (`types.ts`) вывод «нет» — по этой же
   инвентаризации; если у владельца иной критерий «ответственности», вывод может
   отличаться.
3. **Делимость НЕ подтверждена тестами/сборкой.** Задачу не выполнял — только
   читал; что реальная разбивка не сломает импорты и Playwright-коллекцию, не
   проверял (это предмет будущей задачи по делению, AGENTS.md §4).
4. **Порог ровно 500.** Файлы со ровно 500 строками не искал отдельно; граница
   `> 500`, как в задании.
5. **`src/generated/`** исключён явно; что генератор не создаёт `.tsx` длиннее
   500 под другим путём — не проверял.
6. **Замороженность** классифицирована по тексту AGENTS.md §1 (совпадение
   префикса пути), а не по фактическим (`git`) переименованиям.
