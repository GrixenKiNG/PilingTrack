# Крупные исходники (> 500 строк) и их естественные швы

Read-only разбор. Правило проекта — «файлы больше ~500 строк делить по назначению» (AGENTS.md:26).
Ниже — только инвентаризация и границы разреза; предложений, меняющих поведение, нет.

## Итог

В области `src/**` (без `src/generated`, папок `operator*`, сайта ORION и тестов) файлов больше 500 строк —
**17**; в топ-15 отобраны самые крупные × часто правимые (`git log --since='60 days ago' --oneline -- <file> | wc -l`).
По важности: **3 критично, 8 важно, 4 мелочь**. Выше 800 строк — один файл, `readiness-centre.tsx` (1049).
Сознательно **не** попали в топ-15: `reports-screen.tsx` (572 строки, 2 правки) и `rate-limiter.ts`
(510 строк, 0 правок, к тому же файл из списка «security-critical, не трогать» — AGENTS.md:13).

Топ-5 по величине проблемы:
1. `to-module.tsx:271` — 799 строк и 13 правок за 60 дней: экран смешивает разбор URL, загрузку 11 источников,
   производные расчёты и две оболочки рендера в одном компоненте (критично).
2. `readiness-centre.tsx:375` — 1049 строк, из них один компонент на 645 строк (критично).
3. `user-documents.ts:79` — 529 строк, где проверки прав и арендатора лежат вперемешку с CRUD документов и допусков (критично).
4. `types.ts:74` — 509 строк, в файле типов живут **исполняемые** функции прав (`resolveEffectiveRole`, `canActAs`);
   79 импортёров по всему `src/` (важно).
5. `pile-passport.service.ts:365` — 512 строк в папке `application/queries/`, где рядом с чтениями живёт
   **запись** (`decidePilePassport`) и сборка xlsx (важно).

## Методика

1. Список кандидатов: `find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) | grep -v '/generated/' |
   grep -v '/operator' | grep -v '/orion' | grep -v '\.test\.' | grep -v '__tests__' | xargs wc -l | sort -rn`.
   Порог — строго `> 500`.
2. Ценность = размер × частота правок: для каждого кандидата `git log --since='60 days ago' --oneline -- <file> | wc -l`
   (на дату прогона `date` → 26 сен 2026, HEAD `f35ce557`).
3. Состав назначений внутри файла: `grep -nE '^(export )?(async )?function |^(export )?const |^(export )?(interface|type) '`
   плюс чтение тел функций в найденных границах (номера строк ниже — из этих чтений).
4. Зависимые: `grep -rn "<имя модуля>" src e2e tests scripts --include='*.ts' --include='*.tsx'`.
5. Тесты: `grep -rln "<имя модуля>" src --include='*.test.ts*'` и поиск `goto('/route')` в `e2e/*.spec.ts`.
6. Замороженные области (`src/app/operator/**`, `src/app/orion/**`, `src/components/orion/**`,
   `src/modules/operator-mobile/**`, `src/components/piling/operator*/**`) исключены фильтром имени и не читались.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать (без смены поведения) |
|---|----------|-----------|----------|--------------------------|-----------------------------------|
| 1 | критично | `src/components/piling/to/to-module.tsx:271` | 799 стр., 13 правок/60 дн. Один компонент: разбор URL, 11 загрузок, производные расчёты, два рендер-контура | Любая правка загрузки перерисовывает diff на весь экран; ревьюер видит 799 строк и не может оценить радиус. Покрыт только `e2e/tech-readiness-production.spec.ts:22` (одна точка входа) | Вынести helper'ы 172–269, `loadWorkspace` 365–575 и запись URL 688–726 в три модуля той же папки |
| 2 | критично | `src/components/piling/to/readiness/screens/readiness-centre.tsx:375` | 1049 стр.; компонент `ReadinessCentre` — 375–1020 (645 стр. разметки и вычислений) | Самая правимая вручную разметка экрана (8 правок/60 дн.) лежит одним куском; ошибиться в соседнем блоке проще, чем в новом | Вынести `buildReadinessMetricTiles` (212–327), `HandoverEvent` (329–373), `evidenceMetric`+`EVIDENCE_STAGE` (1022–1049) |
| 3 | критично | `src/services/users/user-documents.ts:79` | 529 стр. Проверки прав (`assertCanRead/Write` 79–91), арендатора (`requireTenantUser` 70–78, `requireTenantDocumentType` 92–112), привязки медиа (113–135) в одном файле с CRUD типов и документов | Файл за списком запретных (AGENTS.md:13) не числится, но фактически решает, кто чей документ видит; правка CRUD идёт по тому же diff, что и проверка доступа | Отделить guard'ы в `user-documents-guards.ts`, оставив поведение и порядок вызовов дословно |
| 4 | важно | `src/components/piling/admin-sites/index.tsx:77` | 534 стр., 11 правок/60 дн. Компонент `AdminSites` 77–374 держит и данные, и таблицу, и пять диалогов; ниже — четыре независимых дочерних блока (376–534) | Самый часто правимый экран после `to-module`; e2e на `/admin/sites` нет ни одного | `SiteDetail` 376–431, `SiteCrewBoard` 451–512, `ProgressBar`/`LabeledProgress` 514–534 вынести в `./parts.tsx` |
| 5 | важно | `src/components/piling/admin-dictionaries.tsx:85` | 656 стр. Один компонент 85–656: загрузка, фильтры, три вида состояния формы (создание/переименование/длина), ресайз панели, история, инспектор | Уже вынесены `DictionaryTable` и `DictionaryForm`, но сам экран остался «всем остальным»; e2e есть (`e2e/admin-dictionaries.spec.ts:9`) | Инспектор (481–580) и операции панели (249–300) — отдельные модули; `useCompactInspector` 54–69 и `responseError` 76–84 — утилиты |
| 6 | важно | `src/components/piling/inspections/run-inspection.tsx:84` | 596 стр. Компонент 84–596: загрузка осмотра (108–144), расчёт оценки (151–201), сохранение/завершение (183–234), навигация по разделам (239–286), разметка 307–596 | Экран полевого работника, покрыт `e2e/inspection-to-flow.spec.ts:50`; правка шага «раздел» тянет за собой всю разметку пунктов | Разметка пункта/допов (409–520) и блок раздела-степпера (307–395) — отдельные компоненты; логика сохранения (183–234) — хук |
| 7 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:173` | 600 стр. `SettingsWorkspace` 54–157 — только роутер разделов; весь вес в `RulesSettings` 173–600 (правка весов, черновик, публикация, предпросмотр) | Настройки правил — единственный экран, правку которого ждёт владелец; правки черновика и публикация — 6 правок/60 дн. | Предпросмотр расчёта (524–600) и блок версии/публикации (465–521) — отдельные компоненты внутри той же папки |
| 8 | важно | `src/lib/types.ts:74` | 509 стр. В файле «только типы» — исполняемые `isActingRole` 53, `canActAs` 58, `resolveEffectiveRole` 74; **79 импортёров** | Роль «действую как» влияет на права во всём приложении; сейчас логика прав живёт в файле, который любой импортирует ради DTO, — правку не видно в диффе прав доступа | `roles.ts` для 5–76; ре-экспорт из `types.ts` сохранит все 79 импортов (шов без смены поведения) |
| 9 | важно | `src/modules/reports/application/queries/report-query.service.ts:445` | 517 стр.: чтения 40–293, выгрузка CSV/XLSX 294–503 (включая динамический импорт `@/lib/xlsx-writer` на 446) | Экспорт отчётов — тяжёлая ветка на том же модуле, что и горячие чтения дашборда; `export-reports-csv.test.ts` тестирует только часть | Вынести 294–503 в `report-export.service.ts` (импорт из `queries/index.ts` сохранить) |
| 10 | важно | `src/modules/reports/application/queries/pile-passport.service.ts:365` | 512 стр. В папке `application/queries/` — **запись** `decidePilePassport` 365–391 (tenantId строгим равенством) и сборка xlsx 410–512 | Смешение чтения и записи в одном файле усложняет причину изменения; `decide` вызывается из `src/app/api/pile-passports/[id]/decide/route.ts:9` | `decidePilePassport` → `application/commands/`; экспорт xlsx 410–512 → отдельный модуль |
| 11 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:62` | 505 стр.: карточка установки 62–182, справочники/журналы 183–231, топливо и KPI 232–357, обслуживание 359–505 | Единственный канал чтения парка; `getEquipmentDetails` (62–182) — самый большой запрос модуля и самая частая причина правок | Разрезать на `equipment-detail` (62–231), `equipment-fuel` (232–357), `equipment-maintenance` (359–505), сохранив ре-экспорт из `queries/index.ts` |
| 12 | важно | `src/components/piling/to/readiness-design-views.tsx:149` | 576 стр.: пять экспортируемых экранов (149/258/319/379/460) + шестой заглушечный (522) в одном файле | Слой «дизайн-варианты»; импортируют только типы (`maintenance-screen.tsx:15`, `types.ts:6`) и `to-module.tsx:16` | Один экран — один файл внутри папки вариантов; типы (`CrewSummary` 49, `MaintenanceSummary` 59) — отдельно |
| 13 | мелочь | `src/components/piling/admin-analytics.tsx:40` | 532 стр.; три вкладки живут блоками в одном компоненте (`tab === 'operators'` 330, `'trends'` 392, `'kpi'` 442) | Каждая вкладка — независимый набор загрузок и графиков; править одну приходится в общем файле. e2e на `/admin/analytics` нет | Вкладки 330–493 — три компонента; загрузки 70–205 — хук |
| 14 | мелочь | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:141` | 523 стр.: три загрузки (148–203), расчёт внимания `buildAttention` 97–140, разметка 210–523 одной функцией | Экран сводки для инженера ОТ; правки были 3 за 60 дней | `buildAttention` (97–140) — чистый модуль; секции 274–474 — отдельные компоненты |
| 15 | мелочь | `src/components/piling/to/readiness/screens/briefings-screen.tsx:87` | 581 стр.: загрузки 103–151, производные срезы 160–243, разметка 245–581 | Журнал инструктажей; правился 3 раза за 60 дней, тестов нет | Срезы 160–243 (статистика, опции фильтров, поиск) — хук; таблица журнала 245+ — компонент |

### Разбор по файлам (состав назначений и линии разреза)

**1. `src/components/piling/to/to-module.tsx` — 799 строк, 13 правок/60 дн.**
Назначения: константы и разбор адреса 64–170 (`VIEW_IDS` 67, `OUTCOME_STATUS` 92, `SURFACE_*` 133–155,
`parseView` 162, `parseSettingsSection` 169); helper'ы сети 172–269 (`readOptionalJson` 172, `WorkspaceIssue` 182,
`readOptionalCollectionWithIssue` 187, `readOptionalJsonWithIssue` 205, `readAuthoritativeCollection` 238,
`readReadinessPartial` 259); состояние 271–315 (23 `useState`/`useRef`); эффекты «адрес → состояние» 317–363;
`loadWorkspace` 365–575 (210 строк одним `useCallback`, `Promise.all` из 11 источников 416–444);
догрузка журнала/карточки 577–602; производные `useMemo` 604–686; запись адреса 688–726; рендер 728–798.
Резы: (а) после 269 — `to-module-data.ts` (только helper'ы, ни от чего в файле не зависят); (б) 365–575 —
хук `useToModuleWorkspace` в `to-module-workspace.ts`; (в) 688–726 + `parseView`/`parseSettingsSection` — `to-module-url.ts`.
После этого: 64–170+данные ≈ 180, состояние+рендер ≈ 290, helper'ы ≈ 100. Импорт только внутрь `./`, обратных
ссылок нет — циклов не возникнет (проверено по списку импортов 1–62: файл ничего из новых модулей не потребует).
Зависимые: `src/app/(app)/(readiness-admin)/admin/to/page.tsx:1`, `src/app/(app)/(safety)/admin/safety/page.tsx:1`.
Риск: горячий путь админки, но не security-critical; покрыт `src/components/piling/to/__tests__/to-module-shell.test.tsx`
и `e2e/tech-readiness-production.spec.ts:22` — то есть рефактор проверяем.

**2. `src/components/piling/to/readiness/screens/readiness-centre.tsx` — 1049 строк, 8 правок/60 дн.**
Назначения: `ROLE_FLOW` 16–49, `buildRoleFlowProgress` 68–107, `RoleFlowFooter` 109–154, `StageLink` 157–170,
`STAGE_PILL`/`STAGE_OWNER`/`HANDOVER_*` 176–210, `buildReadinessMetricTiles` 230–327, `HandoverEvent` 331–373,
`ReadinessCentre` 375–1020, `EVIDENCE_STAGE`+`evidenceMetric` 1028–1049.
Резы: (а) 212–327 — `readiness-metric-tiles.ts` (чистая функция + тип плитки); (б) 329–373 + 196–210 —
`handover-event.tsx` (зависит только от `../handover-journal`); (в) 1022–1049 — `evidence-metric.ts`.
Остаётся 375–1020 (645 строк) — этого мало для порога 400; дополнительно естественно распадается сама
разметка: левая колонка 509–687, центр 689–882, правая колонка 884–1015 (три блока уже в отдельных `<section>`/`<aside>`).
Зависимый: `src/components/piling/to/readiness-reference-ui.tsx:16`. Тесты: `src/components/piling/to/__tests__/readiness-reference-authority.test.ts`.
Риск: не hot path и не безопасность, но это самый тяжёлый файл области и самая правимая разметка.

**3. `src/services/users/user-documents.ts` — 529 строк, 7 правок/60 дн.**
Назначения: guard'ы — `requireTenantUser` 70, `assertCanRead` 79, `assertCanWrite` 85, `requireTenantDocumentType` 92,
`requireAttachableMedia` 113, `assertCanManageTypes` 170, `requireOwnDocument` 467; типы документов — 136–285
(list/create/update/delete); документы пользователя — 286–424 и 478–529; аудит — `auditDocumentChange` 425–457;
допуск — `getOperatorClearance` 357–377.
Резы: (а) 61–135 + 170 + 458–477 — `user-documents-guards.ts`; (б) 136–285 (типы документов) с `DAY_MS`/`toDate` 46–52 —
`user-document-types.ts`; (в) 286–356 + 357–424 + 478–529 — `user-documents.ts` (≈ 200 строк).
Зависимые: `src/modules/users/index.ts:32`, `src/components/piling/admin-users/user-detail.tsx:18`.
Тесты: `src/services/users/__tests__/user-documents.test.ts`. Риск: **высокий** — это проверки прав и арендатора;
резать только дословно, без изменения порядка проверок (fail-closed, AGENTS.md:34).

**4. `src/components/piling/admin-sites/index.tsx` — 534 строки, 11 правок/60 дн.**
Назначения: `siteRisk` 56, `pct` 68, `toListItem` 73, `AdminSites` 77–374 (данные, фильтр `allRows` 108,
`filtered` 119, таблица и пять диалогов), `SiteDetail` 376–431, `EQUIPMENT_STATE` 434, `SiteCrewBoard` 451–512,
`ProgressBar` 514, `LabeledProgress` 522.
Резы: (а) 376–431 — `site-detail.tsx`; (б) 434–534 — `site-crew-board.tsx` (вместе с `EQUIPMENT_STATE` и прогресс-барами);
(в) `siteRisk`/`pct`/`toListItem` 56–75 — `site-risk.ts`. Остаётся 77–374 ≈ 300 строк.
Зависимые: `src/components/piling/admin-sites.tsx:2` (только ре-экспорт `AdminSites`).
Тесты: юнит-тестов на файл нет; e2e на `/admin/sites` нет вообще (проверено поиском `goto(` по `e2e/*.spec.ts`).
Риск: правится часто, но не покрыт — значит, резать можно только механически.

**5–15.** Детали по остальным строкам таблицы см. в колонках «Проблема» и «Что сделать»; состав назначений
проверен по `grep -nE '^function |^export function |^const |useState|authFetch'` с последующим чтением тел
в найденных промежутках (номера строк выше — из этих чтений).

### Отдельно: два файла > 500, не вошедшие в топ-15

- `src/components/piling/to/readiness/screens/reports-screen.tsx` — 572 строки, но всего **2** правки за 60 дней;
  назначения уже частично разнесены (импорты 1–23 тянут `describeBlockers`, `shared`, `settings/audit-labels`).
  Ниже по ценности, чем `briefings-screen.tsx` (581 строка, 3 правки).
- `src/lib/rate-limiter.ts` — 510 строк, **0** правок за 60 дней; файл в списке «security-critical, не читать/не
  трогать» (AGENTS.md:13), поэтому в топ намеренно не включён. Импортёров 10, включая `src/core/api-wrapper.ts`.

## Не проверено

- **Skipped-тесты и профиль исполнения.** Не запускал `npm run test:unit` / Playwright: задача read-only и без
  изменений; утверждения о покрытии — только по факту наличия файлов и строк `goto(...)`, а не по прогону.
  Сколько тестов реально проходит/пропускается — не проверено.
- **Циклы импортов после разрезов.** Проверял только направление уже существующих импортов (что новый модуль
  не потянет родителя). Полноценную проверку отсутствия циклов можно сделать лишь после самого рефакторинга —
  сейчас не проверено.
- **`git log --follow`.** Частота правок считалась без `--follow`; для файлов, которые когда-либо переименовывали,
  число правок может быть занижено. Переименований в этих 15 путях в пределах 60 дней я не проверял.
- **GitNexus `impact`.** Не вызывал (CLI/MCP): задача не предполагает правок, а агент-инструкция требует impact
  перед изменением символа. Списки зависимых получены текстовым поиском, а не графом.
- **`src/generated`, папки `operator*`, ORION, тесты, `scripts/`** — исключены по условию задачи; файлы > 500
  строк внутри них не искались и не оценивались.
- **Стили (`.css`).** В отфильтрованной области ни одного CSS > 500 строк нет. Все найденные принадлежат
  замороженным зонам и по условию задачи исключены: `src/components/orion/orion-site.module.css` 1666,
  `src/app/operator/v7/operator-v7.css` 640, `src/app/operator/v5/operator-v5-screens.css` 628,
  `src/components/orion/orion-editorial.module.css` 605. Проверял `find src public design-previews -name '*.css'`.
- **Порядок назначений внутри `admin-analytics.tsx`, `safety-overview-screen.tsx`, `briefings-screen.tsx`.**
  Диапазоны строк для них получены по `grep` загрузок/`useMemo`/секций; полного чтения рендер-части этих трёх
  файлов не делал, поэтому границы разрезов для них — ориентировочные, а не выверенные построчно.
