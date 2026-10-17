# N17-06-DOWNTIME-PRECISION — Единица и округление простоя при показе и выгрузке

Версия: `git rev-parse HEAD` → `f3494177e781c2ab3bd5ec8d6a0775370ede207e`.
Ветка: `hermes/code-1011`. Режим: только чтение кода приложения; создан единственный файл — этот отчёт.

Расхождения в постановке задачи (не влияют на выводы, но зафиксированы):
- В тексте задачи HEAD заявлен как `1d24e24f` — фактический HEAD `f3494177`.
- В тексте задачи рабочая папка `D:/PillingR/wt-night-code-code` — такой папки нет; работа велась в `D:\PillingR\wt-night-code`.

## Итог

- Проверено 40+ мест, где простой превращается в число или строку для показа/выгрузки/ошибки/аудита.
- Счёт по важности: **критично — 1, важно — 8, мелочь — 9** (всего 18); плюс отдельно перечислены 12 согласованных мест (ПРОЙДЕНО).
- **Единица хранения** одна: час — `ReportDowntime.duration Float` (`prisma/schema.prisma:2411`). **Формула** интервального ввода — `(конец − начало)/3 600 000` без округления (`src/lib/downtime-hours.ts:102`); простой машиниста пишется числом часов, кратным 0,25 (`production.ts:437`, `isWholeDowntimeStep`).
- Что увидит человек для ключевых значений — проверено `node -e` на реальных функциях:

  | Простой | `formatDowntimeHours` | `formatDowntimeHoursOnly` | `formatNumber(h)+« ч»` | CSV/XLSX (сырое) |
  |---|---|---|---|---|
  | 3 мин (0,05) | `3 мин` | `0,05 ч` | `0,1 ч` | `0,05` |
  | 29 мин (0,4833) | `29 мин` | `0,48 ч` | `0,5 ч` | `0,4833…` |
  | 59 мин (0,9833) | `59 мин` | `0,98 ч` | `1 ч` | `0,9833…` |
  | 1 ч 1 мин (1,0167) | `1 ч 1 мин` | `1,02 ч` | `1 ч` | `1,0167…` |
  | 8 ч 10 мин (8,1667) | `8 ч 10 мин` | `8,17 ч` | `8,2 ч` | `8,1667…` |

- **Главное расхождение:** канонический `formatDowntimeHours` («ч/мин») применяют почти все экраны, PDF, Telegram и карточки техники. Но три места показывают простой через `formatNumber` («X ч» с одним знаком), одно — через собственную строку `Math.round(h*100)/100`, а выгрузки пишут сырые часы. Одна и та же остановка в 3 минуты на пяти поверхностях читается как «3 мин», «0,1 ч», «0,05 ч» и «0».
- Топ-5:
  1. `report-history.tsx:342` («Мои отчёты» оператора) — `formatNumber(totalDowntime)`: простой < 0,05 ч (≈ до 3 минут) печатается как **«0 ч»**, хотя строка простоя есть; 59 минут → «1 ч».
  2. `report-history-detail-dialog.tsx:168` и `report-form-dialog.tsx:422,445` — тот же `formatNumber`, второй и третий экран дефекта.
  3. `mobile-shift-query.ts:701` — простой смены заранее округляется `round1` (0,05 → 0,1) **до** показа: 3 минуты на экране машиниста превращаются в «0,1 ч».
  4. `admin-analytics.tsx:223` — на графике тренда `Math.round(w.downtime)`: 40 минут простоя показываются как `0`.
  5. `report-history.ts:53` (`humanizeDiff`) — в истории правок простой печатается сырым числом как «0.05 ч» (точка, не запятая).

- Заявленный в задаче симптом «мобильный экран показывает 0 ч для 3 минут» **не воспроизводится в такой формулировке**: экраны машиниста показывают `formatDowntimeHoursOnly` → «0,1 ч» (после `round1`) или «0,05 ч», но не «0 ч». Реальное «0 ч» появляется через `formatNumber` на экране «Мои отчёты» (`report-history.tsx:342`) и в выгрузках при простое короче ~3 минут. См. находки 1, 2, 4.

## Методика

Работа только чтением; изменён один файл — этот отчёт. Замороженные зоны (варианты операторского экрана, сайт ORION) читались, но не правились.

1. Точки отсчёта: `src/lib/downtime-hours.ts` (канон показа и разбора простоя) и `src/lib/format.ts` (`formatNumber`, `formatHours`).
2. Поиск по `src/` регулярками: `formatDowntimeHours\b`, `formatDowntimeHoursOnly`, `formatHours`, `fmtHours`, `downtimeHours`, `totalDowntime`, `downtime.duration`, `Простой`, `Часы простоя`, `step="`.
3. Численная проверка форматов — `node -e` на телах функций `formatDowntimeHours`, `formatDowntimeHoursOnly`, `formatHours`, `Intl.NumberFormat('ru-RU')` для значений 0,05 / 0,4833 / 0,9833 / 1,0167 / 8,1667 и граничных 0,04 / 0,999 / 1,999.
4. Сверка пути чтения (`ReportDowntime.duration` → `mobile-shift-query` / `report-totals` → UI/PDF/CSV/XLSX) с путём записи (`production.ts`, `report-command.service.ts`).

## Находки

Формула и округление указаны по фактически открытому коду; `path:line` — реально прочитанные строки.

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/report-history.tsx:342` | простой показывается `formatNumber(report.totalDowntime)` + «ч» (до 1 знака) | 3 мин (0,05 ч) → «0,1 ч»; 2 мин (0,033) → **«0 ч»**, хотя строка простоя на экране есть — цифра скрывает реальную остановку; 59 мин → «1 ч». Расходится со всеми карточками, PDF и аналитикой, где стоит `formatDowntimeHours` | `formatDowntimeHours(report.totalDowntime)` |
| 2 | важно | `src/components/piling/report-history-detail-dialog.tsx:168` | то же `formatNumber(downtime.duration)` + «ч» в диалоге деталей «Моих отчётов» | второй экран того же дефекта: < 3 мин → «0 ч», 3 мин → «0,1 ч»; не совпадает с PDF того же отчёта («3 мин») | `formatDowntimeHours(downtime.duration)` |
| 3 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:422,445` | сумма и строки в форме отчёта админа — `formatNumber(dt.duration)`/`formatNumber(formTotalDowntime)` + «ч» | админ вводит 0,05 ч и видит «0,1 ч»; итог формы округляется до десятых, тогда как сохранённое значение остаётся 0,05 | `formatDowntimeHours` для строк и итога |
| 4 | важно | `src/modules/operator-mobile/application/mobile-shift-query.ts:701` | `downtimeHours: round1(...)` — округление до 0,1 ч **в источнике данных** | 3 мин (0,05) → 0,1; экран машиниста показывает «0,1 ч» (`formatDowntimeHoursOnly`), т.е. завышение вдвое; точное значение в БД осталось 0,05 — экран и отчёт расходятся | отдавать сырую сумму, округлять только в UI |
| 5 | важно | `src/components/piling/operator-mobile/operator-work-overview.tsx:40,46` | собственный формат: `String(Math.round(state.production.downtimeHours*100)/100)` + единица «ч» | «0,05 ч» вместо «3 мин», как на соседних экранах машиниста (`work-screen`, `closing-screen`, `review-screen` — там `formatDowntimeHoursOnly`); вводит третий формат простоя на одном контуре | `formatDowntimeHoursOnly(...)` или `formatDowntimeHours(...)` |
| 6 | важно | `src/components/piling/admin-analytics.tsx:223` | на графике тренда `Простои: Math.round(w.downtime)` | 40 минут простоя (0,67 ч) рисуются как `0` — столбец исчезает; 29 мин → `0`. Отдельно отмечено в `47-analytics-numbers.md` №13 | не округлять до целого (оставить дробь часов или переводить в минуты) |
| 7 | важно | `src/services/reports/report-history.ts:53` | `fmtDowntimes` печатает сырое число: `${d.duration} ч` | в истории правок отчёта длительность уходит как «0.05 ч», «2.3333333333333335 ч» (точка и полная точность) — против «3 мин»/«2 ч 20 мин» на всех прочих экранах | `formatDowntimeHours(d.duration)` |
| 8 | важно | `src/modules/reports/application/queries/report-export.service.ts:221,334` | CSV `dtHours = csvDecimal(duration)` и XLSX `d.duration` — сырые часы; заголовки «Часы простоя» / «Простой, ч» | CSV отдаёт «0,05», XLSX — «0.05»; на экране та же цифра — «3 мин». Файл и интерфейс не сверить глазами (по числам Excel суммирует верно — сама точность здесь законна) | заголовок оставить «Часы простоя», но в отчётной выгрузке приемлемо; при желании — колонка «ч:мм» |
| 9 | важно | `src/lib/pdf-generator/components.ts:257` | заголовок таблицы простоя «Часы», а значения — `formatDowntimeHours(...)` | колонка подписана «Часы», но в ней «30 мин», «1 ч 15 мин» — единица заголовка не совпадает со значением | переименовать колонку в «Продолжительность» |
| 10 | мелочь | `src/modules/reports/application/commands/report-validation.service.ts:29` | текст ошибки `Суммарный простой (${totalDowntime}ч)` сырым числом | «Суммарный простой (0.05ч)» — точка и «0.05ч» без пробела против формата «3 мин» в интерфейсе | `formatDowntimeHours`, пробел перед «ч» |
| 11 | мелочь | `src/lib/format.ts:23-30` | `formatHours` округляет остаток после отбрасывания целой части: 1,999 ч → **«1 ч 60 мин»**, 0,999 ч → «60 мин» (проверено `node -e`) | дубль логики `formatDowntimeHours` с другим порядком округления; применяется к «Отработано» (`report-evidence-preview.tsx:201`) | свести к нормализации минут после округления либо к `formatDowntimeHours` |
| 12 | мелочь | `src/components/piling/equipment-analytics.tsx:403-410` | локальный `fmtHours` — построчная копия `formatHours`/`formatDowntimeHours` | третья копия алгоритма «ч + мин» в файле аналитики техники | импортировать общий помощник (см. `24-duplicate-helpers.md`) |
| 13 | мелочь | `src/components/piling/admin-analytics-bits.tsx:69-73` | локальный `fmtHours`: «X ч» / «≥48 → X дн.» | четвёртый формат часов (для MTBF/MTTR, не про простоя) — ещё один вариант одной сущности «часы» на соседних плитках | вынести часы-с-минутами в один помощник |
| 14 | мелочь | `src/components/piling/report-form/downtime-section.tsx:60-61` | поле ввода простоя в форме отчёта: `type="number" step="1" min="1"` placeholder «Полных часов» | ввод **только целых часов** ≥ 1: 30 минут копра в этой форме не записать; а `report-form-dialog` шагает 0,5, мобильный контур — 0,25 (`DOWNTIME_STEP_HOURS`). Три разных шага ввода одной величины | единый шаг 0,25 (`DOWNTIME_STEP_HOURS`) или осознанно задокументировать |
| 15 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:408-409` | `step="0.5" min="0.5"` — шаг вдвое крупнее мобильного 0,25 | админ может ввести только 0,5/1,0/…, машинист — 0,25/0,5/…; сервер (`production.ts:437`, `isWholeDowntimeStep`) ждёт кратность 0,25 | `step="0.25" min="0.25"` |
| 16 | мелочь | `src/modules/operator-mobile/application/mobile-shift-query.ts:102,107` | `value: Math.round(total*100)/100` и `delta: Math.round(...*100)/100` — округление записей до 0,01 ч (36 с) | при показе через `formatDowntimeHoursOnly` точность не видна, но при интервальном простое (возможны доли минуты) запись и её сумма усекаются на экране относительно БД | округлять на выводе, а не в источнике |
| 17 | мелочь | `src/modules/operator-mobile/application/commands/shift-close.ts:50` | текст отказа `Простой за смену (${formatDowntimeHoursOnly(total)}) больше…` | при простое 0,05 ч машинист читает «0,05 ч» — против «3 мин» на остальных экранах; формат один из допустимых, но не каноничный «ч/мин» | `formatDowntimeHours` |
| 18 | мелочь | `src/modules/operator-mobile/application/commands/production.ts:458,547` | в audit-diff пишется `простой: ${hours} ч` сырым числом | в истории правок длительность сохраняется как «простой: 0.05 ч» (точка), а показывается в другом формате | оформлять через `formatDowntimeHours` |

Приложение (согласованные места, ПРОЙДЕНО — единица «час», формат `formatDowntimeHours`, расхождений не найдено):
`src/components/piling/admin-dashboard.tsx:285,360` · `admin-equipment/equipment-tile.tsx:115` · `admin-equipment/detail/equipment-detail.tsx:282,408` · `admin-equipment/detail/equipment-detail-parts.tsx:181` · `admin-equipment/detail/equipment-detail-overview.tsx:166` · `admin-reports/report-evidence-row.tsx:147,227` · `admin-reports/report-evidence-preview.tsx:194,214` · `admin-sites/index.tsx:239,470` · `analytics-dashboard/kpi-widgets.tsx:114` · `report-form/report-sent-screen.tsx:43` · `report-form/downtime-section.tsx:76,89` · `lib/pdf-generator/single-pdf.ts:60,104` · `lib/pdf-generator/period-pdf.ts:45` · `services/reports/event-handlers.ts:409,648` (Telegram).

Согласованные места, использующие `formatDowntimeHoursOnly` (формат «только часы», намеренно введён решением владельца 07.10.2026 — «простой только в часах»): экраны машиниста `operator-mobile/screens/{work,closing,review,admission}-screen.tsx`, `operator-mobile/screens/entries-list.tsx:94`, `operator-mobile/v7/*`, `operator-mobile/v10/*`, `operator-v2/*`, `operator-v5/*`. Это не дефект сам по себе; дефект — соседство трёх форматов на одном продукте (находки 1–9).

## Не проверено

- **Числа на боевых данных**: отчёты и БД не читались (нет доступа, `AGENTS.md` §1). Выводы построены на телах функций и арифметике; расхождения показаны на примерах, не воспроизведены на реальных записях. Статус последствий — ГИПОТЕЗА.
- **Заявленный симптом «0 ч для 3 минут на мобильном»** достоверно проверить на устройстве не удалось; по коду он не воспроизводится так, как сформулирован (см. Итог). Возможно, речь о экране «Мои отчёты» (`report-history.tsx`), а не о сменном экране машиниста — это предположение, код экранов вариантов `operator*` читался выборочно.
- **CSS-оформление единиц** (шрифт/выравнивание колонки простоя) не разбиралось — предмет отдельного аудита.
- **Замороженные зоны** правились только чтением; варианты операторских экранов и ORION на предмет формата простоя сплошняком не проверялись.
- **`durationSeconds`** (`prisma/schema.prisma:2417`) — вторая копия длительности; проверено лишь, что показ её не использует. Отдельно не сверял, не расходится ли она с `duration` на записях, созданных до её введения.
- **Тесты**: `formatDowntimeHours` покрыт (`src/lib/__tests__/downtime-hours.test.ts`), но `formatDowntimeHoursOnly` и связка обязательств экранов — вне scope; соответствие тестов найденным дефектам не проверял.
