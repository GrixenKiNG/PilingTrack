# AU199-S6-PLAN-FACT-PILES: План и факт по сваям

Версия (git rev-parse HEAD): `7dd939d1696d4bf9279fb24f49dae11fc9ddb927`
Ветка: `hermes/q4-0926`. Аудит только по коду: приложение не менялось, БД/прод не читались,
существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Итог (для владельца, 5 строк)

1. План по сваям живёт на объекте двумя способами: штуки — скаляром `Site.plannedPiles`,
   метраж — из строк `SitePilePlan`. Факт (сваи/м.п.) считается только по СДАННЫМ отчётам.
2. Главная проблема — длина для плана берётся из `metersPerUnit`, а для факта из `PileGrade.lengthMm`;
   это разные источники, поэтому «план м.п.» и «факт м.п.» считаются по разным формулам (находка №1).
3. Второе — процент выполнения свай считается по-разному: на дашборде по метрам, на «Объектах» по штукам —
   один и тот же объект показывает два разных «%» (находка №2).
4. Плана по полю/кусту в коде НЕТ вообще, а факт по кусту неполон: у свай `picketId` необязателен (находки №3).
5. Правка плана не сбрасывает кэш план-факта дашборда (5 минут расхождения), а проверка «превышение плана»
   считает и черновики, которых нет в факте (находки №5, №6).

Итого: критично — 0, важно — 6, мелочь — 8. Все находки со статусом ПРОЙДЕНО (проверены по коду);
двe помечены ГИПОТЕЗА. Данные в БД не проверялись (см. «Не проверено»).

## План/факт: формулы по экранам (показатель | файл:строка | формула | риск)

| Показатель | Файл:строка | Формула | Риск |
|---|---|---|---|
| План свай, шт (объект) | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:83` | `Site.plannedPiles` (скаляр) | Дрейфует от строк `SitePilePlan` при каскаде |
| План свай, м.п. (дашборд) | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:100-106` | `SUM(count × COALESCE(NULLIF(metersPerUnit,0), lengthMm/1000, 0))` | metersPerUnit как источник длины — против инварианта |
| План свай, м.п. (редактор объекта) | `D:\PillingR\wt-night\src\components\piling\admin-sites\site-editor\plan-helpers.ts:20-21` | `SUM(count × metersPerUnit)` | Без fallback на lengthMm → 0 там, где дашборд показывает метры |
| План бурения, м (объект) | `D:\PillingR\wt-night\src\modules\sites\application\commands\site-admin-command.service.ts:68-71` | `SUM(count × metersPerUnit)` | metersPerUnit=0 → план 0 м при count>0 |
| Факт свай, шт (период) | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:125` | `SUM(pw.count) FILTER(по дате)`, `status=submitted` | ОК |
| Факт свай, м.п. (период/всего) | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:126-128` | `SUM(count × lengthMm/1000)` | lengthMm=null → 0 м (by design) |
| Факт свай, м.п. (отчёт) | `D:\PillingR\wt-night\src\components\piling\admin-reports\report-totals.ts:22-25` | `Σ count × pileLengthMeters(lengthMm)` | Совпадает с аналитикой |
| Факт свай, м.п. (сводный PDF) | `D:\PillingR\wt-night\src\lib\pdf-generator\period-pdf.ts:28-35` | `Σ count × pileLengthMeters(lengthMm)` | Дублирует расчёт pdf-data |
| % выполнения свай (дашборд, плитка) | `D:\PillingR\wt-night\src\components\piling\admin-dashboard.tsx:313` | `actualPileMetersAllTime / plannedPileMeters × 100` | Метры/метры |
| % выполнения свай (объекты, сервер) | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:191-192` | `actualPilesAllTime / plannedPiles × 100` | Штуки/штуки — другой результат |
| Проверка «превышение плана» | `D:\PillingR\wt-night\src\modules\reports\application\commands\report-validation.service.ts:210-214` | `SUM(pw.count)` по объекту БЕЗ фильтра статуса | Считает черновики |

## Методика

Поиск и чтение по коду (только чтение), фиксированный HEAD `7dd939d1`:

- `search_files` по `plannedPiles|plannedDrilling|SitePilePlan|SiteDrillingPlan|metersPerUnit` (70 файлов) и по
  `pileLengthMeters|lengthMm|lengthMmFromGradeName` (79 файлов).
- Чтение схемы: `prisma/schema.prisma:1746-1852` (Site, SitePilePlan, SiteDrillingPlan, PileField, Cluster, Picket),
  `:2113-2127` (SiteDailySummary), `:2172-2212` (PileWork), `:2439-2466` (PileGrade).
- Чтение источников план/факт: `site-analytics-service.ts`, `site-admin-command.service.ts`, `site-command.service.ts`,
  `site.aggregate.ts`, `plan-helpers.ts`, `report-validation.service.ts`, `event-handlers.ts`,
  `report-query.service.ts`, `pile-journal-totals.ts`, `pile-journal-list.ts`, `raw-queries.ts`, `pdf-data.ts`,
  `period-pdf.ts`, `report-totals.ts`, `period-summary.ts`, `admin-dashboard.tsx`, `admin-sites/index.tsx`,
  `api/analytics/sites/route.ts`, `api/sites/[id]/route.ts`, `admin/analytics/overview/route.ts`, `cached-queries.ts`.
- `git rev-parse HEAD` = `7dd939d1696d4bf9279fb24f49dae11fc9ddb927` (`M AGENTS.md` — рабочее дерево, в аудит не трогалось).
- Значения с `path:line` — из открытых файлов; числа в БД не запрашивались (прод/локальная БД не читались).

Повторить: `rg -n "plannedPiles|metersPerUnit|pileLengthMeters" src` и чтение перечисленных файлов по строкам.

## Находки

| # | severity | статус | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:100-106` | План свай в м.п. считается по `SitePilePlan.metersPerUnit` (с fallback на `lengthMm/1000`), тогда как факт (`:125-128`) — только по `lengthMm`. Инвариант `D:\PillingR\wt-night\src\lib\pile-length.ts:10-12` прямо запрещает `metersPerUnit` как источник длины. | Если админ ввёл «метры на сваю» в плане, план м.п. и факт м.п. складываются из разных длин: один объект, две несогласованные величины «план м.п. / факт м.п.». | Считать план м.п. из `PileGrade.lengthMm` (как факт), либо явно задокументировать, что план — «метры по проекту», а не длина сваи, и развести подписи. |
| 2 | важно | ПРОЙДЕНО | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:191-192` против `D:\PillingR\wt-night\src\components\piling\admin-dashboard.tsx:313` | Серверный `pileProgress` = штуки/штуки (`actualPilesAllTime/plannedPiles`), а плитка «Сваи» дашборда = метры/метры (`actualPileMetersAllTime/plannedPileMeters`). | Один и тот же объект показывает разный «% свай» на дашборде и на «Объектах»: марка с отличающимися `lengthMm`/`metersPerUnit` даёт расхождение. | Оставить одну формулу (штуки — основной план) и использовать её и в плитке, и в строке объекта. |
| 3 | важно | ПРОЙДЕНО | `D:\PillingR\wt-night\prisma\schema.prisma:1811-1852` и `:2178` | У `PileField`/`Cluster`/`Picket` нет ни одной колонки плана (только id/name/родитель). `PileWork.picketId` nullable, `LeaderDrilling.picketId` тоже. | «План по полю/кусту» в коде невозможен в принципе; «факт по кусту» занижается: сваи, записанные без пикета, ни одному кусту не принадлежат и в разбивку по кустам не попадут. | Либо добавить `plannedPiles` на уровень поля/куста (схема — отдельная задача), либо прямо писать в UI, что план — только по объекту, а факт по кусту — «только привязанные к пикету». |
| 4 | важно | ГИПОТЕЗА | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:83` + `D:\PillingR\wt-night\prisma\schema.prisma:1785` | `plannedPiles` берётся скаляром `Site`, а `plannedPileMeters` — из строк `SitePilePlan`. FK `SitePilePlan.pileGrade` — `onDelete: Cascade`: удаление марки сваи стирает строки плана, но `Site.plannedPiles` не пересчитывается. | Знаменатель `pileProgress` (штуки) останется старым при удалении марки из плана → % выполнения «застревает». Вероятность зависит от того, бывает ли жёсткое удаление `PileGrade` (в справочнике — архивация); в БД не проверял. | Пересчитывать `Site.plannedPiles` из строк плана (как в `site-admin-command.service.ts:67`) или запретить hard-delete марки с планами. |
| 5 | важно | ПРОЙДЕНО | `D:\PillingR\wt-night\src\modules\reports\application\commands\report-validation.service.ts:210-214` | Проверка «превышение плана по марке» делает `pileWork.groupBy` по объекту БЕЗ фильтра `status`, т.е. учитывает сваи из черновиков. | Черновик идущей смены считается в лимит плана, но не входит в факт (факт — только `submitted`: `site-analytics-service.ts:132`). Оператор упирается в «превышение плана», не видя этих свай в цифрах факта. | Фильтровать по `status: submitted` (или `status: { not: 'draft' }`) — либо явно объяснять в ошибке, что учтены и черновики. |
| 6 | важно | ПРОЙДЕНО | `D:\PillingR\wt-night\src\app\api\sites\[id]\route.ts:102` | После правки плана объекта вызывается только `invalidateSites` (кэши `sites`), но НЕ `invalidateSiteAnalytics`. Ключ план-факта `analytics:sites:v3:*` (`src/app/api/analytics/sites/route.ts:28`, TTL 300 в `:32`) чистится только из событий отчёта (`src/services/reports/event-handlers.ts:190-191`). | Сохранил новый план — на дашборде до 5 минут виден старый план; выглядит как «план не сохранился». | Вызывать `invalidateSiteAnalytics(tenantId)` в PUT/DELETE `/api/sites/[id]` и `/api/sites/create` рядом с `invalidateSites`. |
| 7 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\components\piling\admin-sites\index.tsx:129` | Fallback-строка для объекта, которого нет в ответе аналитики (деактивированный объект без сданных отчётов за период), ставит `plannedPileMeters: 0`. | В таблице объектов у закрытого объекта «план м.п.» = 0, хотя строки `SitePilePlan` есть. | Для отсутствующих строк брать план из карточки объекта, а не ноль; либо помечать «—». |
| 8 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\services\analytics\site-analytics-service.ts:194-195` и `D:\PillingR\wt-night\src\modules\sites\application\commands\site-admin-command.service.ts:68-71` | `drillingProgress` делит метры факта на `plannedDrilling` (метры = `SUM(count × metersPerUnit)`), а `plannedDrillingCount` — отдельный счётчик штук. Если у строк плана `metersPerUnit=0`, `plannedDrilling=0` → прогресс бурения 0 при непустом плане по штукам. | «Бурение 0 %» при введённом плане (штуки без метров на единицу). | Требовать `metersPerUnit` при вводе дренажного плана или считать прогресс по штукам, когда метры плана нулевые. |
| 9 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\modules\operator-mobile\application\commands\production.ts:288`, `D:\PillingR\wt-night\src\components\piling\operator-v2\sheets.tsx:102`, `D:\PillingR\wt-night\src\components\piling\operator-mobile\screens\work-screen.tsx:452` | Длина сваи считается напрямую `lengthMm / 1000`, минуя `pileLengthMeters`. В `production.ts:288` возвращается `null` при неизвестной длине, в остальных двух — `0.0 м` (null/1000 = 0). | Мобильный экран покажет «0.0 м» там, где длина марки неизвестна, тогда как остальной продукт считает 0 м «неизвестно». | Все три места перевести на `pileLengthMeters` (файлы `operator-*` — замороженная зона, править только с разрешения владельца). |
| 10 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\lib\pdf-data.ts:128-140` и `D:\PillingR\wt-night\src\lib\pdf-generator\period-pdf.ts:28-35` | Сводный PDF считает метры свай сам (`period-pdf.ts`), а `summarizePeriodReports` (`pdf-data.ts`) метража не считает вообще — две параллельные формулы для одного документа. | При правке одной формулы PDF разойдётся сам с собой (сейчас сходятся). Риск дрейфа. | Оставить один расчёт метража (например, в `pdf-data.ts`) и передавать число в PDF. |
| 11 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\modules\reports\application\queries\report-query.service.ts:336-348` + `D:\PillingR\wt-night\prisma\schema.prisma:2113-2127` | `getDashboardStats` читает `SiteDailySummary`, в модели нет метража (`totalPiles` — штуки), при отсутствии строки возвращает нули как факт. Живых вызовов в коде нет (только реэкспорты `src/modules/reports/index.ts:43`, `.../queries/index.ts:9`). | Если подключить к «дашборду дня» — «0 свай» вместо «нет данных» и KPI без метража. | Не подключать как есть; отличать «нет строки проекции» от реального нуля. |
| 12 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\prisma\schema.prisma:2117-2118` | В `SiteDailySummary` рядом лежат `totalPiles` (штуки) и `totalDrilling` (метры) — разные единицы в одной строке. | Читатель легко сложит или сравнит их как однородные. | Комментарий к полям с указанием единиц (штуки/метры) по образцу `PileGrade.lengthMm`. |
| 13 | мелочь | ГИПОТЕЗА | `D:\PillingR\wt-night\src\components\piling\admin-dashboard.tsx:351` и `:313` | Значение плитки «Сваи» — периодные `actualPiles/actualPileMeters`, а прогресс-бар — накопительный (`actualPileMetersAllTime`). | В режиме «7 дней» факт и полоса прогресса стоят на разных базах: «0 шт / 0 м.п.» при полосе ~90 %. Замысел (F-R52) задокументирован, но несоответствие видно. | Пометить в подписи, что бар — «с начала объекта», либо показывать накопительный факт. |
| 14 | мелочь | ПРОЙДЕНО | `D:\PillingR\wt-night\src\app\api\admin\analytics\overview\route.ts:51-89` | «Аналитика» (обзор периода) считает только факт (метры/сваи/бурение), плана нет ни у KPI, ни в `siteRating`. | Раздел «Аналитика» не может показать выполнение плана — сравнение доступно только на дашборде/«Объектах». | Если нужен план — добавить в ответ `planned` из `SitePilePlan`/`Site.plannedPiles`. |

## Не проверено

- **Данные в БД не читались.** Локальная/prod БД, прод-доступ, `docs/strategy` — вне доступа по правилам задачи.
  Реальные расхождения план/факт (сколько объектов с `metersPerUnit≠lengthMm`, сколько свай без пикета) —
  НЕ ПРОВЕРЕНО, только структурные выводы по коду.
- **Находка №4 (дрейф `Site.plannedPiles`)** — ГИПОТЕЗА: не подтверждал, что жёсткое удаление `PileGrade` с
  планами реально доступно через UI/API. Проверено только `onDelete: Cascade` в схеме и отсутствие пересчёта
  скаляра в командах сохранения плана.
- **Находка №13** — ГИПОТЕЗА: реальный вид плитки в режиме периода глазами не проверялся (UI не запускался).
- **`actualPilesAllTime` и `picketId`** — долю свай без пикета (влияет на «факт по кусту») числом не измерил.
- **`validatePicketsBelongToSite`** (`report-validation.service.ts:129-148`) — читал, но не проверял, что все
  пути записи `PileWork` вызывают её (косвенно влияет на корректность факта по кусту).
- **Кэш `analytics:sites:v3` при других мутациях** (например, архивация марки) — не проверял все точки
  инвалидации, только PUT/DELETE объекта и события отчётов.
- Проверки §6 AGENTS.md (tsc/lint/test/build) НЕ запускались: задача только на чтение кода, изменений нет.
