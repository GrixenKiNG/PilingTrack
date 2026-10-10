# AU46-S2-PLAN-VS-FACT — План и факт свайных работ: как считаются по объекту, полю, кусту, пикету

Версия кода: `git rev-parse HEAD` = `5f727474beea5608507a7bf2f5c4b597f3e1061f`
(рабочая папка `D:\PillingR\wt-night`, ветка `hermes/q4-0926`).
Все `path:line` открыты и проверены; номера строк приведены по этой ревизии.

## Итог

План свай в системе существует ТОЛЬКО на объекте: `Site.plannedPiles` (шт) и `SitePilePlan`
(марка → шт × м/ед.). У `PileField`/`Cluster`/`Picket` нет ни одного планового поля, поэтому
«план по полю/кусту/пикету» в коде отсутствует — задача в этой части не реализована (не баг, а
незакрытая функциональность). Факт по пикету/кусту/полю считается лишь как охранная проверка
перед удалением узла и в интерфейсе как прогресс не выводится.

Найдено 15 расхождений: критично 1, важно 7, мелочь 7. Главное — по одному и тому же объекту на
одном экране «Дашборд» показываются ДВА разных процента свай: верхняя плитка «Сваи» считает процент
в погонных метрах (`actualPileMetersAllTime / plannedPileMeters`, admin-dashboard.tsx:313), а блок
«План-факт по объектам» и список рисков — в штуках (`a.pileProgress`, admin-dashboard.tsx:236,266).
Экран «Объекты» тоже показывает штучный процент (admin-sites/index.tsx:237). Критично: цифра
«выполнено свай» на дашборде может отличаться от той же цифры в разделе «Объекты».

## Методика (как воспроизвести)

Поиск и чтение через инструменты проекта (не менял ни одного существующего файла):

- Схема: `prisma/schema.prisma` — модели `Site` (1746), `SitePilePlan` (1780),
  `SiteDrillingPlan` (1797), `PileField` (1811), `Cluster` (1825), `Picket` (1839),
  `PileWork` (2172), `PileGrade` (2439).
- Расчёты и читатели факта: `src/services/analytics/site-analytics-service.ts`,
  `src/modules/reports/application/queries/pile-journal-totals.ts`, `.../period-summary.ts`,
  `.../report-query.service.ts`, `src/services/analytics/equipment-analytics-service.ts`,
  `src/modules/operator-mobile/application/mobile-shift-query.ts`.
- Проценты в интерфейсе: `src/components/piling/admin-dashboard.tsx`,
  `.../admin-dashboard-bits.tsx`, `.../dashboard-kpis.ts`, `.../admin-sites/index.tsx`,
  `.../admin-sites/hierarchy-tree.tsx`, `.../admin-sites/site-editor/plan-helpers.ts`.
- Поправки/исправления: `src/modules/operator-mobile/application/commands/production-corrections.ts`,
  `src/modules/reports/infrastructure/report.repository.ts`,
  `src/modules/reports/infrastructure/reconcile-report-entries.ts`.
- PDF: `src/lib/pdf-generator/period-pdf.ts`, `.../single-pdf.ts`; формат чисел — `src/lib/format.ts`.
- Черновики: `src/lib/report-status.ts` (`SUBMITTED_REPORT_STATUS = 'submitted'`).

Команды (exit code 0):

```
git rev-parse HEAD
  -> 5f727474beea5608507a7bf2f5c4b597f3e1061f
grep -n "pileProgress\|actualPilesAllTime /" src/services/analytics/site-analytics-service.ts
  -> 191:    pileProgress:
     192:      row.plannedPiles > 0 ? Math.min(100, (row.actualPilesAllTime / row.plannedPiles) * 100) : 0,
grep -n "plannedPileMeters > 0\|pileProgress < 50" src/components/piling/admin-dashboard.tsx
  -> 266:      if (a.plannedPiles > 0 && a.pileProgress < 50) {
     313:  const pileProgress = kpis.plannedPileMeters > 0 ? (kpis.actualPileMetersAllTime / kpis.plannedPileMeters) * 100 : 0;
grep -n "SUBMITTED_REPORT_STATUS" src/lib/report-status.ts
  -> 2:export const SUBMITTED_REPORT_STATUS = 'submitted' as const;
grep -n "planOverrun\|sitePileVolume" src/modules/operator-mobile/application/mobile-shift-query.ts
  -> 573:    planOverrun: sitePlan
     720:async function sitePileVolume(
     728:    where: {report: {tenantId, siteId}},      # фильтра статуса отчёта нет
```

## План и факт: формулы

| Показатель | Формула | Файл:строка | Расхождения между экранами |
| --- | --- | --- | --- |
| План свай, шт | `Site.plannedPiles`; заполняется как Σ `SitePilePlan.count` | prisma/schema.prisma:1757; site-admin-command.service.ts:67,98 | Поля/куста/пикета у плана нет — на иерархии только объект |
| План свай, м.п. (аналитика) | Σ `SitePilePlan.count × COALESCE(NULLIF(metersPerUnit,0), lengthMm/1000, 0)` | site-analytics-service.ts:100-106 | В «Сводке плана» карточки тот же план = `count × metersPerUnit` (без fallback) — hierarchy-tree.tsx:234,246 |
| План бурения, шт | Σ `SiteDrillingPlan.count` | site-analytics-service.ts:112 | — |
| План бурения, м | `Site.plannedDrilling` = Σ(`count × metersPerUnit`) | site-admin-command.service.ts:68-71; schema:1758 | Имя `plannedDrilling` читается как «скважины», хранит метры |
| Факт свай, шт (объект, сданные) | Σ `PileWork.count` по `Report.status = 'submitted'` | site-analytics-service.ts:127,132 | Журнал забивки считает ВСЕ отчёты (pile-journal-totals.ts:60); мобайл «факт по объекту» — тоже без фильтра (mobile-shift-query.ts:728) |
| Факт свай, м.п. | Σ(`count × PileGrade.lengthMm / 1000`) | site-analytics-service.ts:126,128 | Длина берётся из марки, план в м. — из `metersPerUnit` (критерий длины разный) |
| % свай (сервер, экран «Объекты») | `min(100, actualPilesAllTime / plannedPiles × 100)` | site-analytics-service.ts:191-192 | В штуках, c ограничением 100 |
| % свай (плитка дашборда) | `actualPileMetersAllTime / plannedPileMeters × 100` (без cap) | admin-dashboard.tsx:313 | В метрах, без ограничения 100 — другой процент, чем на «Объектах» |
| % бурения | `min(100, actualDrillingAllTime / plannedDrilling × 100)` | site-analytics-service.ts:193-196 | В метрах |
| Поправка выработки оператора | `count = round(actual) − current`, `correctsId` | production-corrections.ts:104-120 | Знаковая дельта; читатели суммируют — корректно |
| Черновики в факт | не входят (только `submitted`) | report-status.ts:2; site-analytics-service.ts:119,132 | Журнал: отдельный счётчик `draftPiles` (pile-journal-totals.ts:61); мобайл: входят в объём (mobile-shift-query.ts:728) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | рекоменд. правка | статус |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | критично | src/components/piling/admin-dashboard.tsx:313 | Плитка «Сваи» считает процент в м.п. (`actualPileMetersAllTime/plannedPileMeters`), а блок «План-факт» PlanTile и «Риски дня» — в шт. (`a.pileProgress`) | На одном экране «Дашборд» по объекту видно два разных «% выполнения»; при metersPerUnit ≠ длине марки числа расходятся | Один источник процента на дашборд: считать и плитку по `a.pileProgress` (шт), либо явно подписать «% по м.п.» | ПРОЙДЕНО |
| 2 | важно | src/components/piling/admin-sites/index.tsx:237,475 | Раздел «Объекты» показывает `a.pileProgress` (шт, cap 100, site-analytics-service.ts:192); дашборд — м.п. | Владелец сравнивает «73%» в «Объектах» с «85%» на дашборде по одному объекту и не понимает, где правда | Свести оба экрана к одной метрике (шт как базовая; м.п. — отдельным показателем) | ПРОЙДЕНО |
| 3 | важно | src/services/analytics/site-analytics-service.ts:101-105 | План в м.п. считается по `SitePilePlan.metersPerUnit`, тогда как `pile-length.ts:10-12` прямо называет это значение ненадёжным (пример: 123 м/свая) и НЕ источником длины | `plannedPileMeters` (и м.п.-процент плитки) может быть завышен/занижен относительно факта, который считается по длине марки | План в м.п. тоже считать по `PileGrade.lengthMm` (как факт), `metersPerUnit` не использовать | ПРОЙДЕНО |
| 4 | важно | src/services/analytics/site-analytics-service.ts:119,132; src/modules/operator-mobile/application/mobile-shift-query.ts:728; src/modules/reports/application/queries/pile-journal-totals.ts:61 | Три разных «факта по объекту»: аналитика — только сданные; журнал — все строки + `draftPiles`; мобайл-обзор объекта — все строки без фильтра статуса | «Свай на объекте» на дашборде, в журнале и на телефоне машиниста — три числа | Задокументировать правило «сданные = прогресс, черновики отдельно» и привести мобайл-обзор к тому же фильтру, либо помечать «вкл. черновики» | ПРОЙДЕНО |
| 5 | важно | prisma/schema.prisma:1811,1825,1839 | `PileField`/`Cluster`/`Picket` не имеют плановых полей; план есть только у `Site` | «План-факт по полю/кусту/пикету» из задачи в коде не существует — разбить план по месту работ нельзя | Если нужен — завести план на узле иерархии; иначе зафиксировать, что план только на объекте | ПРОЙДЕНО |
| 6 | важно | src/modules/sites/application/commands/site-admin-command.service.ts:361-378 | Факт по пикету/кусту/полю считается лишь перед удалением: `countSubtreeProductionRows` возвращает ЧИСЛО СТРОК `PileWork`+`LeaderDrilling` (не сваи, не м.п.), без фильтра статуса | Это не прогресс и не показывается в интерфейсе; смешение «строк» и «свай» вводит в заблуждение при попытке использовать его как факт | Не выдавать это число как выработку; для прогресса по узлу считать Σ `count` сданных отчётов | ПРОЙДЕНО |
| 7 | важно | src/modules/operator-mobile/application/commands/production-corrections.ts:112-123 | Поправка сваи создаётся без `picketId` (в `data` есть `pileGradeId`, `count`, `correctsId`, но не `picketId`) | Строка-поправка теряет привязку к пикету: факт по объекту верен (сумма), но любая разбивка по пикетам/охранный подсчёт по узлу поправку не увидит | Копировать `picketId` исходной записи в строку-поправку | ПРОЙДЕНО |
| 8 | важно | src/modules/reports/infrastructure/report.repository.ts:152-174; reconcile-report-entries.ts:44-53 | Админ-правка отчёта удаляет/перезаписывает строки `PileWork` на месте; при этом операторская поправка — знаковая дельта (production-corrections.ts:79-123) | Две несовместимые модели исправления: правка мастером может стереть историю поправок/паспортов (блокируется только при паспорте, reconcile:41,45) | Свести мастер-правку сданного отчёта к тому же журнальному пути, что и поправка оператора | ГИПОТЕЗА (частично: не проверено, доступна ли правка сданного отчёта) |
| 9 | мелочь | src/components/piling/admin-sites/hierarchy-tree.tsx:231,234,246 | «Сводка плана» карточки печатает `count × metersPerUnit` и Σ так же; при `metersPerUnit = 0` даёт 0 м | Тот же план в аналитике (site-analytics-service.ts:101-105) подставит длину марки → «метры плана» расходятся | Единый расчёт метров плана обоих мест | ПРОЙДЕНО |
| 10 | мелочь | prisma/schema.prisma:1758 | `Site.plannedDrilling` (Float) хранит МЕТРЫ (site-admin-command.service.ts:68-71), но имя читается как число скважин | Читающий код и отчёты легко примут метры за штуки | Переименовать в `plannedDrillingMeters` или задокументировать единицы рядом с полем | ПРОЙДЕНО |
| 11 | мелочь | src/components/piling/admin-sites/index.tsx:129 | Fallback-строка объекта без аналитики задаёт `plannedPileMeters: 0`, а `plannedPileMeters` из плана не подставляется | Для объекта, где аналитика не ответила, «Сваи план» шт. есть, а м.п. план = 0 | Брать метры плана из того же источника, что и аналитика, либо помечать «—» | ПРОЙДЕНО |
| 12 | мелочь | src/components/piling/admin-sites/index.tsx:231 (число) vs 233 (бар) | Число показывает `actualPiles` (за период запроса), а бар — `pileProgress` (всегда накопительно, site-analytics-service.ts:188-192) | Сейчас хук зовёт `/api/analytics/sites` без периода, поэтому совпадает; при появлении периода число и бар разойдутся | Если период появится — брать обе величины из одного среза (all-time для бара, период — отдельно) | ГИПОТЕЗА |
| 13 | мелочь | src/app/api/analytics/sites/route.ts:28-32 | Ответ аналитики кэшируется в Redis 5 мин (ключ tenant+период+site) | После сдачи отчёта процент на «Объектах» может отставать до 5 минут | Оставить; в интерфейсе можно помечать «обновлено N мин назад» | ПРОЙДЕНО |
| 14 | мелочь | src/lib/pdf-generator/period-pdf.ts:42-44 | PDF печатает только итоги периода («Отчётов», «Свай забито», «Бурение»); плана и процента выполнения нет | «Вывод в PDF» план-факта отсутствует — в подшиваемом документе нет «выполнено X из Y» | Добавить в титул план/факт и %, если это требование владельца | ПРОЙДЕНО |
| 15 | мелочь | src/services/analytics/site-analytics-service.ts:191-192; src/lib/format.ts:132-134 | Процент свай всегда в ШТУКАХ, хотя плитка/плитки показывают и «м.п.» | Владелец может читать «% свай» как процент по метрам (по аналогии с бурением, где процент в метрах — стр. 193-196) | Подписать единицу у процента: «% штук свай» | ПРОЙДЕНО |

## Что не проверено

- Не проверено (нет доступа к БД): фактические значения `SitePilePlan.metersPerUnit` в проде и
  масштаб расхождения с `PileGrade.lengthMm` — вывод о расхождении метра плана и факта сделан по
  коду и по комментарию `pile-length.ts:10-12`, а не по данным.
- Не проверено: доступна ли админская правка СДАННОГО отчёта через `report-form-dialog` (находка 8);
  поэтому она помечена ГИПОТЕЗОЙ. Путь `report.repository.ts` reconcile прочитан, но условие
  «только черновик» в маршруте правки отчёта не подтверждено.
- Не проверено (находка 12): появится ли у `/api/analytics/sites` период на экране «Объекты» — сейчас
  хук `use-sites-overview.ts:89` зовёт маршрут без параметров дат.
- Не проверено: единицы `SiteDrillingPlan.metersPerUnit` относительно фактических `LeaderDrilling.meters`
  (не сверял, что план и факт бурения в одних метрах на реальных данных).
- Не проверено: поведение процента при отрицательной сумме `PileWork.count` (возможна из-за того, что
  поправка — знаковая дельта, production-corrections.ts:110-119): код использует `Math.min`, но не
  `Math.max`, поэтому отрицательный факт дал бы отрицательный процент до отсечения на клиенте.
- Пропущено сознательно (замороженные зоны по AGENTS.md): ORION-сайт и варианты экранов оператора.
  Файл `mobile-shift-query.ts` (модуль `operator-mobile`) прочитан только для анализа, не правился.
