# 51 — Единый формат «N шт. / M м.п.»: где ещё остался разнобой

Ветка ревью: `hermes/q4-0926` (HEAD `0fee2351`), рабочая копия `D:\PillingR\wt-night`.
Решение владельца 28.09.2026: сваи и бурение показываются человеку ВЕЗДЕ как
«N шт. / M м.п.» (сначала штуки, затем погонные метры) через `formatCountMeters(count, meters)` из `src/lib/format.ts`.
Админские экраны закрыты коммитом `3e5f90eb` (ветка `main`).

## Итог

- Всего находок: 8 — критично 1, важно 4, мелочь 3. Всё остальное — в «Не проверено».
- **Самый важный:** `src/services/reports/event-handlers.ts:602-603` — подпись Telegram к PDF отчёта пишет
  «🔩 Свай забито: N шт» и отдельной строкой «🌀 Бурение: M м.п.»: у бурения нет штук, у свай нет метров.
  Это тот же разнобой, из-за которого владелец и принял решение, — и он уходит наружу, в мессенджер, вместе с PDF.
- PDF: сводные плитки (`single-pdf.ts:54-55`, `period-pdf.ts:40-41`) уже печатают штуки первыми — близко к формату,
  но не через `formatCountMeters`. А таблицы «Список отчётов» и «Детализация работ»
  (`src/lib/pdf-generator/components.ts:207-208, 224-228, 234-238`) печатают голые числа без единиц:
  рядом стоят «Сваи» = штуки и «Бурение» = метры — метры бурения легко принять за метры свай.
- CSV/XLSX-выгрузка (`src/modules/reports/application/queries/report-export.service.ts:155`) не имеет
  колонки «Кол-во бурений» вовсе — у свай есть `Кол-во свай` + `Свай, м.п.`, у бурения только `Метры бурения`.
- Локальный хелпер `src/lib/pdf-generator/format.ts:11-18` дублирует правила форматирования и не печатает единицы —
  это ответ, почему PDF отстал от админки.

## Методика

Всё read-only, файлы не менялись. Что делалось:

1. Прочитаны `AGENTS.md` (доверие, замороженные зоны, «выглядит мёртвым — не трогать») и `src/lib/format.ts`.
2. Установлено, что в этой рабочей копии `formatCountMeters` **отсутствует**:
   `grep -rn "formatCountMeters" src/` → 0 совпадений; `git merge-base --is-ancestor 3e5f90eb HEAD` → «no».
   Ветка отстаёт от `main` на 21 коммит (`git rev-list --left-right --count main...HEAD` → `21 103`),
   поэтому админские файлы здесь ещё в старом формате, и эталон — только `git show 3e5f90eb`.
   Эталонный вспомогатель (из `git show 3e5f90eb -- src/lib/format.ts`):
   `return `${formatNumber(count, 0)} шт. / ${formatNumber(meters, 1)} м.п.`;`
3. Список «уже сделано» взят из `git show --stat 3e5f90eb` (28 файлов, все — админские и `queries/*`, включая
   `report-query.service.ts`, `fleet-monitoring.service.ts`, `analytics/overview`, `reports/all`).
   Их я не перепроверял в этой копии (в ней они в старом виде) — сравнение с `main` не делалось.
4. Поиск мест, показывающих количества, — по всей `src/`:
   `grep -rn "м\.п\." src/` (118 совпадений, список файлов), `grep -rn "пог\. м|погон|м'"`,
   `grep -rn "шт\|метров\|Meters"` по pdf/xlsx/csv/telegram/notification-файлам.
5. Целевые области из задания: `src/lib/pdf-generator/**` (прочитаны `format.ts`, `single-pdf.ts`,
   `period-pdf.ts`, `components.ts`, `period-row.ts`), `src/lib/pdf-data.ts`, `src/lib/xlsx-writer.ts`,
   `src/modules/reports/application/queries/report-export.service.ts`,
   `src/modules/readiness/application/csv-export.ts`, `src/app/api/reports/export/**`,
   `src/core/notifications/**`, `src/services/telegram/**`, `src/services/reports/event-handlers.ts`.
6. Операторские экраны (замороженная зона по `AGENTS.md` §1) и сайт ORION не проверялись: задание предлагает
   «пропускать замороженное, если задание не говорит иного», но бюджет времени закончился раньше —
   см. «Не проверено». Код операторских экранов не открывался.

## Находки

| № | severity | path:line | сейчас | должно быть | примечание |
|---|----------|-----------|--------|-------------|------------|
| 1 | критично | src/services/reports/event-handlers.ts:602-603 | `🔩 Свай забито: <b>${fmtNum(totalPiles)}</b> шт` и `🌀 Бурение: <b>${fmtNum(totalDrilling)}</b> м.п.` — две строки, у бурения нет штук, у свай нет метров | `formatCountMeters(totalPiles, totalPileMeters)` и `formatCountMeters(totalDrillingCount, totalDrilling)` | Подпись уходит в Telegram вместе с PDF. При этом в функции (строки 581-583) `totalPileMeters` и число бурений ВООБЩЕ не считаются — есть только `totalPiles` и `totalDrilling` (метры). То есть исправление не косметическое: нужен новый расчёт. Метры бурения и метры свай здесь оба в «м.п.» и различимы только эмодзи/подписью — путаница вероятна |
| 2 | важно | src/lib/pdf-generator/components.ts:207-208 | Таблица «Список отчётов»: колонка «Сваи» = `formatNumber(sumPiles(report))` (голые штуки), колонка «Бурение» = `formatNumber(sumDrilling(report))` (голые метры, `period-row.ts:11-13`) | «Сваи» = `formatCountMeters(шт., м.п.)`, «Бурение» = `formatCountMeters(шт., м.п.)` | Две числовые колонки рядом без единиц: 42 и 380 — читаются как одно и то же. Метры бурения можно принять за метры свай (или наоборот за штуки). `sumDrilling` считает только метры, `sumPiles` — только штуки: пар нет в принципе |
| 3 | важно | src/lib/pdf-generator/components.ts:234-238 | «Детализация работ», таблица `['Бурение', 'Метров']` → `formatNumber(drilling.meters || 0)` | `formatCountMeters(drilling.count \|\| 1, drilling.meters)` — штуки + метры | Количество бурений в отчёте есть (`drilling.count`, см. `single-pdf.ts:34,85`), но в PDF-период его не выводят. Заголовок «Метров» не отличает метры бурения от метров свай |
| 4 | важно | src/lib/pdf-generator/components.ts:224-228 | «Детализация работ», таблица `['Свайные работы', 'Кол-во']` → `formatNumber(pile.count)` | `formatCountMeters(pile.count, count × длина марки)` | У свай показаны только штуки, м.п. отсутствуют — прямое нарушение решения (штуки без метров). Метраж считаем через `pileLengthMeters` (`src/lib/pile-length.ts`), как в `single-pdf.ts:30-33` |
| 5 | важно | src/modules/reports/application/queries/report-export.service.ts:155 | CSV-шапка: `...Марка сваи;Кол-во свай;Свай, м.п.;Тип бурения;Метры бурения;Причина простоя;...` (строка данных — :195, `drillMeters: String(drilling.meters)`; XLSX-шапка — :303, строка — :321,:324) | добавить «Кол-во бурений» перед «Метры бурения» | У свай две колонки (штуки + м.п.), у бурения одна (метры). Машиночитаемая выгрузка — но её смотрит человек в Excel; колонки «Свай, м.п.» и «Метры бурения» идут подряд и без штук бурения не различимы на глаз |
| 6 | мелочь | src/lib/pdf-generator/single-pdf.ts:54-55; src/lib/pdf-generator/period-pdf.ts:40-41 | `['Свай забито', `${formatNumber(totalPiles)} / ${formatMeters(totalPileMeters)}`, 'шт/м.п.']` и такая же строка для бурения | `formatCountMeters(...)` в одно значение | Порядок верный (штуки первыми), формат визуально совпадает — но это не общий хелпер, а самодельная пара «значение / единица». Ловушка при переводе: `addMetricStrip` (`components.ts:112-122`) разбивает и значение, и единицу строго по `' / '`; если подставить `formatCountMeters` как значение, разбиение сломается (3 части вместо 2) — правку надо делать парой «значение + единица» |
| 7 | мелочь | src/lib/pdf-generator/format.ts:11-18 | локальные `formatNumber()`/`formatMeters()` (`formatFixed(…, 1)`) возвращают число без единицы | единый формат с «шт. / м.п.» | Причина, по которой PDF отстал от админки: у генератора PDF свой слой форматирования, `formatCountMeters` в него не заведён. Комментарий на :1-3 прямо говорит, что правила берутся из `@/lib/format`, — но только числовые |
| 8 | мелочь | src/lib/pdf-generator/components.ts:9-10 | `PILE_METERS_INCOMPLETE_NOTE = '(неполный: у марки не задана длина)'` — пометка к итогу м.п. | формат не меняется, но при переходе на `formatCountMeters` пометку нужно сохранить | Предупреждение, а не дефект: при слиянии штук и метров в одну строку пометка «неполный» относится только к метрам и должна остаться рядом (иначе потеряется смысл). Проверено по `single-pdf.ts:37,54`, `period-pdf.ts:33-35,40` |

## Не проверено

Бюджет времени закончился; ниже — то, что задание требует, а я не успел открыть. Всё это **не факты**, а открытые точки.

- `src/lib/pdf-data.ts` — не открывался. Неизвестно, готовит ли он пары «штуки/метры» для PDF; если да, находки 2-4 могут иметь общий корень здесь.
- `src/workers/unified-worker/pdf.ts`, `src/workers/pdf-worker.ts`, `src/lib/pdf-queue.ts`, `src/components/piling/pdf-preview-dialog.tsx`
  — не открывались. Возможны свои тексты/превью с количествами.
- Ежедневная сводка и прочие Telegram-тексты: `src/core/notifications/telegram.ts` и `src/services/telegram/**`
  проверены только grep-ом по «м.п./шт./метров/свай» — совпадений не найдено, но тексты могли собираться из переменных,
  поэтому «нет совпадений» ≠ «нет нарушений». `src/components/piling/admin-telegram.tsx` (админский экран) не смотрел.
- E-mail/прочие уведомления: отдельных e-mail-сборщиков не искал вовсе (grep по `src/core/notifications` пустой,
  но других каналов я не перечислял).
- `src/app/api/reports/export/route.ts`, `src/lib/xlsx-writer.ts` — открыт только grep-ом (`xlsx-writer.ts` — это
  генератор XML, заголовков с количествами в нём нет); сам route выгрузки не читал.
- `src/modules/readiness/application/csv-export.ts` и `src/app/api/readiness/export/**`, `src/app/api/pile-passports/export/**`
  — grep не дал совпадений по «шт/м.п./метров»; не читал.
- Операторские экраны (`src/components/piling/operator*/**`, `src/app/operator/**`, `src/modules/operator-mobile/**`) —
  замороженная зона по `AGENTS.md` §1, задание их называет возможной целью. Не открывал ни одного файла;
  при этом в этой копии вне заморозки лежат `src/components/piling/operator-mobile/**` (найден `м.п.` в v7/v10/review/work-screen)
  и `operator-v2`, `operator-v5` — формально это варианты операторского экрана, то есть тоже заморозка.
- ORION (`src/components/orion/**`) — заморозка, не проверялся (там только технические «м», не наши количества).
- `src/services/analytics/**`, `src/services/audit/audit-service.ts` — `м.п.` встречается, но это, судя по grep,
  комментарии/строки аудита; не читал.
- Так как эта копия на 21 коммит позади `main`, часть найденного может быть уже исправлена в `main` вне `3e5f90eb`
  (например `0eca0a0d` и др.). Сверку с `main` по каждому файлу я не делал.
