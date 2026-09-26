# Мелкие помощники, размноженные по копиям: что и где уже разошлось

Дата: 2026-09-26. Ветка: `hermes/q3-0925`. Только чтение, изменён один файл — этот отчёт.

Вопрос задания: какие небольшие помощники переписаны в нескольких местах и могут
разъехаться так же, как когда-то разъехался парсинг длины сваи (жил в семи копиях).
Область: `src/**`; замороженные зоны (варианты операторского экрана, ORION) не
разбирались — их адреса вынесены в приложение, чтобы не потерялись.

## Итог

- Всего находок: **55** — критично **0**, важно **8**, мелочь **47**.
- **Главное: того класса дефекта, из-за которого затевался аудит, в живых путях нет.**
  Метраж сваи (м.п.) резолвится ровно в одном месте — `src/lib/pile-length.ts:23`
  (`pileLengthMeters`), и через него идут все 15 боевых вызовов: экраны отчётов,
  период, PDF (одиночный и периодный), карточка установки, мониторинг парка,
  аналитика админа, мобильная смена. Это зафиксировано тестом-инвариантом
  `src/lib/__tests__/pile-meters-invariant.test.ts:29-55`. Ни одной копии
  `name.match(/\d{3}/)` в живом коде нет — единственный оставшийся экземпляр
  (`src/lib/pile-length.ts:37`) не вызывается ниоткуда, кроме тестов.
- Поэтому критично — ноль: **ни одна пара копий сегодня не выдаёт разных чисел
  для одной и той же записи на экране или в выгрузке.** Расхождение, которое
  реально видит пользователь, пока только в подписях (роли, вид техники,
  статусы) и в форматах дат — это мелочь по шкале задания.
- Топ-5:
  1. `src/modules/reports/application/commands/report-calculation.service.ts:50-56` —
     второй `getPileMetersPerUnit`, который возвращает **1 или 0** метров на сваю
     (марка есть → 1 м), при том что рабочий одноимённый помощник живёт в
     `src/components/piling/report-form/use-report-form.ts:148-151` и читает
     `lengthMm`. Если кто-то возьмёт «доменный» из модуля отчётов, метраж разойдётся
     в 30 раз. Собственный тест (`.../__tests__/report-calculation.test.ts:130-140`)
     закрепляет именно неверное поведение.
  2. `src/modules/reports/application/commands/report-calculation.service.ts:8-48` —
     третья и четвёртая реализации итогов отчёта (сваи/бурение/простой), и
     единственные две, которые **округляют до 2 знаков**; экспортированы наружу
     через фасад `src/modules/reports/index.ts:31-32`.
  3. `src/lib/pdf-generator/format.ts:6-13` — числа PDF считаются
     `toFixed(1)`/`String(int)`, то есть в подшитом документе «12.5» и «1200»,
     тогда как на экране те же значения — «12,5» и «1 200».
  4. `src/components/piling/admin-equipment/detail/equipment-documents.tsx:315-320` —
     самодельный «истекает через N дн.» (`Math.round`, порог 30 зашит) рядом с
     общим `documentExpiry` (`src/lib/document-expiry.ts:26-41`, `Math.ceil`,
     порог из вида документа): одна и та же дата на двух экранах даёт разные слова.
  5. `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:288-293`
     и `src/modules/equipment/application/queries/equipment-query.service.ts:112-127` —
     один и тот же итог установки берётся то из проекции `ReportAnalytics`, то
     пересчётом по строкам отчёта; пока проекция свежая, числа совпадают, но
     источник у них разный.

## Методика

Работа только чтением. Поиск вёлся по каждой группе из задания отдельной командой
(повторить можно буквально), затем каждое найденное объявление **открывалось
глазами** и сравнивалось тело с телом — адреса в таблице взяты из открытых файлов.

1. Склонения и подписи ролей/статусов/вида техники:

```bash
cd /d/PillingR/wt-night
grep -rn "pluralizeRu" src --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn "ROLE_LABEL\|roleLabel\|roleLabels" src --include=*.ts --include=*.tsx
grep -rn "STATUS_LABEL\|statusLabel\|STATUS_META" src --include=*.ts --include=*.tsx
grep -rn "PILE_DRIVER" src --include=*.ts --include=*.tsx | grep -v generated
```

2. Часы/минуты, простой, моточасы:

```bash
grep -rn "function fmtHours\|const fmtHours\|function formatHours\|const formatHours" src --include=*.ts --include=*.tsx
grep -rn "downtimeHoursBetween\|DOWNTIME_MAX_HOURS\|formatDowntimeHours" src --include=*.ts --include=*.tsx
grep -rn "totalDowntime\|downtimeTotal\|durationSeconds" src --include=*.ts --include=*.tsx
```

3. Итоги свай/бурения/простоя — искал не по имени функции, а по **телу**
   (`reduce` по `piles`/`drillings`/`downtimes`) и по проекции:

```bash
grep -rn "lengthMm" src --include=*.ts --include=*.tsx | grep -v "pileLengthMeters\|pile-length"   # остатки ручного /1000
grep -rn "reportAnalytics" src --include=*.ts | grep -v generated
grep -rn "duration.*reduce\|downtime.*reduce" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

4. Даты и числа — по вызовам `Intl.*`, `toLocale*`, `toISOString().slice`,
   `slice(0, 10)`, `86_400_000`, `₽`, плюс поиск одинаковых тел `fmtDate`,
   `toInputDate`, `fmtNum`, `num`:

```bash
grep -rn "toLocaleDateString\|toLocaleString\|Intl.DateTimeFormat" src --include=*.ts --include=*.tsx | grep -v generated
grep -rn "toISOString()\.slice\|toISOString()\.split" src --include=*.ts --include=*.tsx | grep -v generated
grep -rn "toInputDate\|const fmtDate\|function fmtDate\|function fmtNum\|Intl.NumberFormat" src --include=*.ts --include=*.tsx
grep -rn "86_400_000" src --include=*.ts --include=*.tsx | grep -v generated
```

5. `escapeHtml` и тенант:

```bash
grep -rn "escapeHtml" src --include=*.ts --include=*.tsx
grep -rn "requireTenantId" src --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rln "from '@/lib/tenant'" src ; grep -rln "lib/tenant-scope" src
grep -rn "DEFAULT_TENANT_ID" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

6. Чтобы не принять живую копию за мёртвую, у каждого «второго» помощника
   проверялись вызывающие: `grep -rn "<имя>" src e2e tests scripts`. Отдельно
   проверено, что `lengthMmFromGradeName` (остаток старого парсинга) не вызывается
   нигде, кроме своего теста.

Вне области (не разбиралось): замороженные зоны из AGENTS.md §1, `src/generated/**`,
`.claude/**`.

## Находки

| # | severity | path:line | проблема | сценарий / почему это важно | предлагаемое исправление |
|---|----------|-----------|----------|------------------------------|--------------------------|
| 1 | важно | `src/modules/reports/application/commands/report-calculation.service.ts:50-56` | Второй `getPileMetersPerUnit` с тем же именем, но возвращает `grade ? 1 : 0` — «метров на сваю» из наличия марки, а не из длины. Рабочий одноимённый — `src/components/piling/report-form/use-report-form.ts:148-151` (через `pileLengthMeters`) | Это ровно тот класс дефекта, из-за которого затевался аудит: рядом с правильным стоит второй, неверный, и ровно он подписан как доменный и экспортируется из `application/commands/index.ts:16`. Если им воспользуются, метраж сваи будет 1 м вместо 30 — молча, без ошибки типа. Тест `.../__tests__/report-calculation.test.ts:130-140` закрепляет неверное поведение («should return 1 when grade exists») | Удалить `getPileMetersPerUnit` из сервиса (вызывающих в `src e2e tests` нет — есть только `commands/index.ts` и тест) либо переписать через `pileLengthMeters({ gradeLengthMm: grade?.lengthMm })` |
| 2 | важно | `src/modules/reports/application/commands/report-calculation.service.ts:8-25` и `:27-48` | Третья и четвёртая реализации итогов отчёта (`calculateReportSummary`, `calculatePeriodSummary`) с округлением `Math.round(x*100)/100` для бурения и простоя; у всех остальных итогов округления нет. Обе торчат наружу через фасад `src/modules/reports/index.ts:31-32` | Итоги отчёта сегодня считаются в 12 местах (см. группу B в приложении). Эти два — единственные с округлением, то есть при подключении к экрану «2,34 ч» станет «2,34», а у соседа — «2,34 ч» из другого[^1] источника уже без округления. Пока вызывающих вне тестов нет (`grep` по имени находит только `commands/index.ts` и `__tests__`), поэтому «важно», а не «критично» | Оставить один расчёт: `getReportTotals` (`src/components/piling/admin-reports/report-totals.ts:20-31`, уже с тестами и с инвариантом метража) + `pileLengthMeters`; доменные копии удалить |
| 3 | важно | `src/lib/pdf-generator/format.ts:6-13` | `formatNumber` = `String(int)` / `toFixed(1)`, `formatMeters` = `toFixed(1)` — точка вместо запятой и без разрядов; плюс `formatRuDate` (`:15-20`) повторяет `src/lib/format.ts:56` | Через эти функции собраны все числа и даты PDF: `components.ts:174-179,187,196,206,216` (одиночный отчёт), `period-pdf.ts:32,35-37` (сводка за период), `single-pdf.ts:11-13`. В подшитом (нормативном) документе «12.5 шт/м.п.» и «1200 м», на экране того же отчёта — «12,5» и «1 200». PDF — выгрузка, то есть по шкале задания это уже не «подпись», а документ | Импортировать `formatFixed`/`formatNumber`/`formatRuDate` из `@/lib/format` |
| 4 | важно | `src/components/piling/admin-equipment/detail/equipment-documents.tsx:315-320` | `ExpiresIndicator` — самодельная копия правила срока годности: `Math.round((d - now)/86400000)`, порог «30» зашит в код; общий помощник — `documentExpiry` (`src/lib/document-expiry.ts:26-41`) с `Math.ceil` и порогом `leadTimeDays` из вида документа | Одно и то же правило посчитано по-разному: дата истечения 26.10, «сейчас» 26.09 23:00 → `documentExpiry` даёт `ceil(30,04)=31` → «действует», `ExpiresIndicator` даёт `round(30,04)=30` → «истекает через 30 дн.». Сегодня это разные сущности (документы техники vs документы людей), поэтому числа на одной записи не расходятся, но формулировка «истекает» на двух экранах означает разные пороги, а порог 30 в одном месте правится, а в другом нет | Считать через `documentExpiry(doc.expiresAt, 30)` из `@/lib/document-expiry` |
| 5 | важно | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:288-293` (в паре с `src/modules/equipment/application/queries/equipment-query.service.ts:112-127`) | Итоги одной установки берутся из двух разных источников в одном и том же месте: `a?.totalPiles ?? r.piles.reduce(...)` — из проекции `ReportAnalytics` либо пересчётом по строкам отчёта, причём по каждому полю отдельно (`pileMeters` вообще всегда из строк, `downtimeHours` — из проекции) | Пока проекция свежая, числа совпадают — потому «важно», а не «критично». Но экраны, которые считают от строк отчёта (журнал `report-query.service.ts:259-272`, PDF, период), и экраны, которые читают проекцию (мониторинг парка, карточка установки), при отставании/сбое проекции покажут разные числа за один и тот же день. Авторские комментарии в `event-handlers.ts:22-31` и `rebuild.ts:43-45` фиксируют, что такой сбой уже случался | Либо везде читать `ReportAnalytics` (и тогда добавить в проекцию `pileMeters`), либо везде считать по строкам; смешивание в одной функции (`:288-293`) убрать |
| 6 | важно | `src/services/analytics/equipment-analytics-service.ts:182-204` (своя `round1` — `:219`) против `src/modules/equipment/application/queries/equipment-query.service.ts:112-127` | Один и тот же набор «итоги установки за 30 дней» считается дважды: сервис аналитики округляет всё через локальную `round1`, модульный запрос — без округления. Вторая `round1` — `src/modules/operator-mobile/application/mobile-shift-query.ts:690` | Экран «Аналитика техники» (`equipment-analytics.tsx`) и карточка установки показывают, по сути, одну величину, посчитанную разными формулами: при 2,345 м.п. один путь хранит 2,3, другой 2,345; на экране обычно видно «2,3» у обоих, но пороги/суммы по парку (`:200-204`) считаются уже от округлённых значений | Один расчёт итогов установки (модульный запрос) + один форматтер; `round1` — в `src/lib/format.ts` |
| 7 | важно | `src/modules/reports/application/queries/report-query.service.ts:266` и `src/modules/equipment/application/queries/equipment-query.service.ts:121` против `src/modules/reports/domain/period-summary.ts:37` | Число бурений считается как `(d.count \|\| 1)` в двух местах и как `d.count ?? 1` в третьем | Сегодня расхождение недостижимо: `LeaderDrilling.count` — `Int @default(1)` (`prisma/schema.prisma:2359`), валидация требует ≥1 (`report-validation.service.ts:82-84`), мобильный ввод требует >0. То есть копии совпадают только потому, что вход не бывает нулём; строки-«поправки» (`correctsId`) и прямые вставки в БД это правило не гарантируют. При `count = 0` один экран покажет «1 скв.», другой «0» | Вынести правило в один помощник (`drillingCount(d)`) в домене отчётов |
| 8 | важно | `src/services/reports/event-handlers.ts:340-342` (плюс `fmtNum` — `:284-286`) | Четвёртый пересчёт итогов того же отчёта — уже для подписи Telegram: `d.piles.reduce(...)`, `d.drillings.reduce(...)`, `d.downtimes.reduce(...)`; числа форматируются локальным `fmtNum` (`Intl.NumberFormat('ru-RU')` с умолчанием «до 3 знаков») | Диспетчер получает в чат «⏸ Простои: 1,333 ч», тогда как на экране и в PDF та же величина — «1 ч 20 мин» (`formatDowntimeHours`) или «1,3 ч» (`formatNumber`). Это уведомление в чате, а не выгрузка, поэтому «важно» | Считать итоги тем же помощником, что и отчёт, а часы простоя печатать через `formatDowntimeHours` |
| 9 | мелочь | `src/lib/pile-length.ts:37-40` (`lengthMmFromGradeName`) | Остаток исторического парсинга `name.match(/\d{3}/)` живёт в lib, но **не вызывается ниоткуда**, кроме собственного теста (`src/lib/__tests__/pile-length.test.ts:2,20-32`). Комментарий обещает «seed при создании новой марки», но маршрут справочника требует длину явно (`src/app/api/dictionary/manage/route.ts:25`) | Вреда нет, но это единственный уцелевший экземпляр правила, которое когда-то разъехалось в семи копиях: следующий, кто возьмёт его «для новой марки», вернёт класс дефекта. И обещание в комментарии не соответствует коду | Либо удалить (вызывающих нет), либо прямо в комментарии написать, что боевого вызова нет |
| 10 | мелочь | `src/components/piling/report-form/report-form.tsx:156-159` | Пятый пересчёт итогов отчёта (в форме оператора), метраж — через хук, а сваи/бурение — своим `reduce` | Форма показывает оператору «Итого» до сохранения; сервер считает то же в `report.aggregate.ts:316-326`. Формулы совпадают, поэтому это мелочь, но третья копия правила правки не увидит | Переиспользовать `getReportTotals`/`computePeriodSummary` |
| 11 | мелочь | `src/modules/reports/domain/report.aggregate.ts:316-326` | Агрегат отчёта держит свою тройку `getTotalPiles/Drilling/Downtime` и передаёт их в событие (`:272-281`), а проекция берёт числа из события (`event-handlers.ts:74-76`) | Связка «агрегат → событие → проекция» и «rebuild по строкам» (`rebuild.ts:200-202`) считают одно и то же двумя кодами; сегодня совпадают (оба без округления) | Оставить один источник (`computePeriodSummary`/`getReportTotals`) и вызывать его из агрегата |
| 12 | мелочь | `src/modules/reports/application/projections/rebuild.ts:64-66` и `:200-202` | Два почти одинаковых агрегата итогов внутри одного файла (для `SiteDailySummary` и для `ReportAnalytics`) | Оба нужны, но правило «только `submitted`» (`:43-45`) и формулы дублируются; правка одной ветки не затронет другую | Вынести `sumReportRows(rows)` в один помощник файла |
| 13 | мелочь | `src/modules/reports/application/projections/projection-handlers.ts:72-75` | Сверка недели повторяет `reduce` по тому же `SiteDailySummary` поверх агрегата `rebuild.ts:56-70` | Два одинаковых сведения (день → неделя) в соседних ветках проекций | Общий помощник |
| 14 | мелочь | `src/app/api/admin/analytics/overview/route.ts:82-84` | Тот же пересчёт итогов отчёта, но со своим комментарием-напоминанием «HOURS (domain invariant)» | Совпадает с остальными, но это ещё одна копия правила «простой — часы» | `pileLengthMeters` уже используется; итоги — из общего расчёта |
| 15 | мелочь | `src/core/infrastructure/raw-queries.ts:134-160` | SQL-версия агрегата (`getSiteDailySummaryRaw`) считает `SUM` без фильтра `status='submitted'`, в отличие от обоих живых путей (`rebuild.ts:43-45`, `event-handlers.ts:113-116`) | Сейчас это мёртвый экспорт (вызывающих в `src` нет), но если его подключат, итог дня начнёт включать черновики и разойдётся с недельным трендом | Удалить (мёртвый) либо добавить тот же фильтр |
| 16 | мелочь | `src/components/piling/admin-reports/report-totals.ts:21` | `sum + pile.count` без защиты (`computePeriodSummary:33` — `p.count \|\| 0`) | `count` в схеме не nullable, поэтому расхождения нет; но правила совместимы только случайно | Привести к одному виду |
| 17 | мелочь | `src/components/piling/admin-reports/report-totals.ts:48-56` против `src/modules/reports/application/commands/report-validation.service.ts:18-23` | Длительность смены из «ЧЧ:ММ» считается дважды: клиентский `shiftDurationHours` и серверный `validateDowntimeWithinShift`; первый проверяет `Number.isFinite` и переводит конец через полночь сдвигом `+24*60`, второй сдвигом `+24` часа | Одна и та же «ночная смена» валидируется на сервере и показывается на экране двумя реализациями; при мусорном значении (`shiftStart='abc'`) сервер получит `NaN` и проверка простоя молча пройдёт | Один помощник `shiftDurationHours` в домене отчётов, использовать и в валидации |
| 18 | мелочь | `src/modules/reports/application/commands/report-validation.service.ts:97` | Порог простоя зашит числом `24`, при том что есть `DOWNTIME_MAX_HOURS` (`src/lib/downtime-hours.ts:39`, он же подключён в `src/lib/validation-schemas.ts:289`) | Правка максимума простоя в одном месте не изменит серверную проверку — «простой 24 ч» продолжит проходить | Импортировать `DOWNTIME_MAX_HOURS` |
| 19 | мелочь | `src/lib/format.ts:23-30` (`formatHours`) против `src/lib/downtime-hours.ts:66-76` (`formatDowntimeHours`) | Два формата «часы/минуты» для одной величины: `formatHours` округляет дробную часть от `Math.floor`, `formatDowntimeHours` — от общего числа минут | Вход, где они расходятся: `1,999 ч` → `formatHours` даёт «1 ч 60 мин» (потому что `round(0,999*60)=60`), `formatDowntimeHours` — «2 ч». На экранах показания простоя длятся минутами, поэтому сегодня это не воспроизводится, но `formatHours` ещё рисует отработанное время смены и «сегодняшний простой» (`src/components/piling/monitoring/equipment-tile-block.tsx:164`, `fleet-dashboard.tsx:346`) | Добавить в `formatHours` перенос минут в час (`if (mins === 60) …`) — это снимает возможный «1 ч 60 мин» независимо от того, какая копия победит |
| 20 | мелочь | `src/components/piling/equipment-analytics.tsx:396-403` | `fmtHours` — побайтовая копия `formatHours` из `src/lib/format.ts:23-30` (то же тело, включая отсутствие переноса 60 минут) | Правка одного формата не затронет второй экран | Импортировать `formatHours` |
| 21 | мелочь | `src/components/piling/admin-analytics-bits.tsx:66-70` | Третье `fmtHours` с тем же именем, но другим смыслом: `toFixed(1)` и «дни» при `h >= 48` | Плитка «Надёжность ТО» показывает «36.0 ч» там, где соседний экран по тому же правилу показывает «36 ч» (`formatHours`); точка вместо запятой — из аудита 17 | Переименовать в `formatDurationDays` (или использовать `formatHours` + своё «дн.») и убрать `toFixed` |
| 22 | мелочь | `src/components/piling/to/fuel-panel.tsx:41-45`, `src/components/piling/to/meter-readings-panel.tsx:26-30`, `src/components/piling/to/to-module-bits.tsx:92-97` | Три одинаковые `fmtDate` («ДД.ММ.ГГГГ» через `toLocaleDateString('ru-RU')`, с разной обработкой пустого значения) | Три копии одного формата в одном модуле ТО; правка формата отстанет на двух экранах | Одна функция (например, `formatRuDate` + разбор момента в поясе тенанта) |
| 23 | мелочь | `src/lib/pdf-generator/format.ts:15-20` | `formatRuDate` PDF-генератора — вторая реализация того же формата, что `src/lib/format.ts:56-60`, но через `new Date(Date.UTC(...))` и с возвратом исходной строки при разборе неудачи | Даты в PDF и на экране форматируются разным кодом с разным поведением на битом значении | Импортировать `formatRuDate` из `@/lib/format` |
| 24 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:49-51`, `src/components/piling/feedback-center.tsx:57-65`, `src/components/piling/admin-reports/report-list-format.ts:35-44` | Три реализации одного «ГГГГ-ММ-ДДТ… → ДД.ММ.ГГГГ, ЧЧ:ММ» | Три контура (происшествия, центр обратной связи, журнал отчётов) держат по копии правила; смена разделителя/стиля разъедется | Один помощник в `@/lib/format` |
| 25 | мелочь | `src/components/piling/admin-users/admin-users.tsx:65-71` против `src/components/piling/admin-users/user-detail.tsx:29-35` | Два `dateTimeFormatter` в одном разделе: год `'2-digit'` в списке и `'numeric'` в карточке | Один и тот же вход `2026-09-26T10:30` даёт «26.09.26, 10:30» в списке и «26.09.2026, 10:30» в карточке того же пользователя — открывается в один клик | Один форматтер на раздел (год `'numeric'`) |
| 26 | мелочь | `src/components/piling/admin-dlq.tsx:111-114` | `new Date(iso).toLocaleString('ru-RU')` — четвёртый вариант того же «дата+время», но с секундами и стилем по умолчанию | Очередь DLQ показывает время в формате, которого нет больше нигде | Тот же общий помощник |
| 27 | мелочь | `src/components/piling/admin-equipment/detail/equipment-to-tab.tsx:34` | `fmt` — пятая короткая обёртка «ISO → `toLocaleDateString('ru-RU')`» | Ещё один формат даты в карточке установки | `formatRuDate` |
| 28 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:118,228` | Дата обновления справочника форматируется прямо в JSX (`new Date(item.updatedAt).toLocaleDateString('ru-RU')`), дважды в одном файле | Правило формата живёт в разметке, а не в помощнике | Общий помощник |
| 29 | мелочь | `src/components/piling/admin-equipment/detail/equipment-documents.tsx:81`, `src/components/piling/admin-users/user-documents.tsx:64`, `src/components/piling/maintenance/work-order-detail.tsx:70`, `src/components/piling/maintenance/work-order-form-dialog.tsx:79` | Четыре байт-в-байт копии `const toInputDate = (iso) => (iso ? iso.slice(0, 10) : '')` (два варианта сигнатуры — со `undefined`) | Копия правила «момент → значение `<input type=date>`»; это тот же `slice(0,10)`, что и в `formatRuDate`, то есть правило уже есть в lib | Один `toInputDate` рядом с `formatRuDate` в `@/lib/format` |
| 30 | мелочь | `src/components/piling/admin-analytics.tsx:38`, `src/components/piling/admin-dashboard.tsx:64`, `src/components/piling/admin-reports/report-list-format.ts:21` (и похожий `src/components/piling/to/readiness/screens/reports-screen.tsx:45`) | Четыре копии арифметики «сдвинуть производственный день на N суток» через `new Date(\`${day}T12:00:00.000Z\`) + N*86_400_000` | Один и тот же трюк (полдень UTC против перевода часов) переписан четырежды; в аудите 17 он же помечен как источник UTC-ошибок в двух местах | Один `shiftDay(day, delta)` (например, рядом с `getTodayInTimezone`) |
| 31 | мелочь | `src/components/piling/to/fuel-panel.tsx:47-50` и `src/components/piling/to/meter-readings-panel.tsx:33-35` | Две копии `todayInput()` — «сегодня» по часам браузера для значения по умолчанию у `<input type=date>` | У пользователя с поясом, отличным от пояса тенанта, поле даты откроется вчерашним; в проекте для этого есть `getTodayInTimezone` (`src/lib/timezone.ts:21`) | `getTodayInTimezone(tz)` |
| 32 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:191` и `src/components/piling/report-history.tsx:149-155` | Два «длинных» формата даты отчёта («25 сент. 2026 г.») рядом с `formatRuDate` («25.09.2026»), которым пользуются остальные экраны | Один и тот же `report.date` показан тремя разными способами на трёх экранах | Свести к `formatRuDate` (или явно описать два разрешённых формата) |
| 33 | мелочь | `src/components/piling/admin-equipment/equipment-table.tsx:11-12` (и `:104`) и `src/components/piling/admin-equipment/equipment-tile.tsx:15-17` | `formatNum` определён дважды байт-в-байт в соседних файлах одной папки, плюс `num` — та же функция с `digits = 0` | Копия в файле на 147 строк и копия в файле на 177 строк; правка (например, локаль `'ru'` → `'ru-RU'`) в одном месте не дойдёт до другого | Один помощник рядом с таблицей парка |
| 34 | мелочь | `src/components/piling/analytics-dashboard/kpi-widgets.tsx:71-72` | Локальные `fmtRu`/`signed` — ещё одна пара «число/процент со знаком» | Пятая по счёту обёртка над `toLocaleString('ru-RU')` | `formatNumber`/`formatPercent` |
| 35 | мелочь | `src/components/piling/equipment-analytics.tsx:392-394` | `fmt` = `toLocaleString('ru-RU', { maximumFractionDigits: 1 })` — дубль `formatNumber(value, 1)` | То же правило, шестая копия | `formatNumber` |
| 36 | мелочь | `src/components/piling/pile-journal/index.tsx:373-375` | `num` печатает `String(value)` — замеры в журнале забивки показываются без разделителя разрядов (единственное место, где число не проходит через форматтер) | Журнал забивки — нормативная форма; в нём «1200» рядом с «1 200» на соседних экранах | `formatNumber` |
| 37 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:37-40` и `src/components/piling/admin-dictionaries.tsx:230-231` | Две одинаковые `lengthLabel`/`formatMetres`: `(lengthMm/1000).toLocaleString('ru-RU', {2 знака})` | Формат «длина марки в метрах» переписан дважды в одном разделе справочников | Один помощник |
| 38 | мелочь | `src/components/piling/admin-reports/report-list-format.ts:53-54` против `src/components/piling/admin-sites/index.tsx:68-70` (родственное — `src/components/piling/admin-dashboard-bits.tsx:163`) | `formatPercentValue` и `pct` — одинаковые «обрезать 0…100 и округлить с %», третья вариация — `clampPct` без знака «%» | Три копии правила «проценты в интерфейсе» | Один `formatPercent` в `@/lib/format` (там уже есть `formatPercent`, но он не обрезает 0…100 — решить, какое правило верное) |
| 39 | мелочь | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:222-226` (`formatCost`), `src/components/piling/admin-analytics-bits.tsx:84`, `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:361`, `src/components/piling/maintenance/maintenance-detail-panel.tsx:97` | Четыре способа напечатать рубли: `toLocaleString('ru-RU',{0 знаков})`, `toLocaleString('ru')`, `formatFixed(x, 2)`, сырое число со знаком ₽ | Стоимость ТО — денежная величина; один и тот же наряд может показать «12 000 ₽», «12000 ₽» и «12000,00 ₽» | Один `formatMoney` (в `@/lib/format`) |
| 40 | мелочь | `src/services/analytics/equipment-analytics-service.ts:219` и `src/modules/operator-mobile/application/mobile-shift-query.ts:690` | Две локальные `round1` | Одно правило округления в двух копиях, причём в других местах его нет вовсе (см. №6) | `roundTo(value, digits)` в lib |
| 41 | мелочь | `src/services/reports/event-handlers.ts:280-282` и `src/core/notifications/telegram.ts:129-134` | `escapeHtml` определён дважды; тела совпадают (экранируются `&`, `<`, `>`; кавычки не экранируются) | Сегодня копии идентичны — потому не «критично». Но это защита от подстановки HTML в текст Telegram: правка одной копии (например, добавление кавычек) не дойдёт до второй, а обе являются точкой вставки пользовательских данных (`alert.message`, имя объекта, имя оператора) | Один `escapeHtml` (например, в `src/lib/format.ts` или рядом с `logger`), импортировать в оба места |
| 42 | мелочь | `src/lib/types.ts:15-23` (`ROLE_LABELS`) против `src/lib/pdf-generator/format.ts:45-50`, `src/components/piling/admin-reports/report-list-format.ts:46-51`, `src/components/piling/to/readiness/handover-journal.ts:39-47` | Четыре карты подписей ролей; PDF-версия знает только четыре роли и по умолчанию печатает «Оператор» (`:51`), `report-list-format` тоже дефолтит в «Оператор» (`:50`), остальные два возвращают исходный код роли | Роль `MECHANIC`/`FOREMAN`/`SAFETY_ENGINEER` в PDF и журнале отчётов подписывается как «Оператор» — то есть чужая роль. Экран при этом использует `ROLE_LABELS` (`admin-users.tsx:187` и ещё ~10 файлов) и показывает «Механик» | Оставить `ROLE_LABELS` единственным источником, в остальных местах импортировать его (для неизвестного кода — возвращать код, а не «Оператор») |
| 43 | мелочь | `src/components/piling/to/readiness/screens/documents-screen.tsx:40-44` | Своя карта ролей, где `OPERATOR: 'Машинист'`, тогда как `ROLE_LABELS.OPERATOR` — «Оператор», и так же в журнале передачи и в журнале отчётов | Один и тот же человек в разделе «Документы» назван «Машинист», а в соседних экранах — «Оператор». Доменный глоссарий на стороне «Машиниста» (`.claude/skills/domain-glossary/SKILL.md:52`: «`OPERATOR` (машинист)»), PRODUCT.md — на стороне «Оператора» (`PRODUCT.md:43,58`). Решения в коде нет | Выбрать одно слово владельцем и оставить одну карту |
| 44 | мелочь | `src/components/piling/maintenance/maintenance-labels.ts:16-19` против `src/components/piling/to/to-module-bits.tsx:74-81` и `src/components/piling/admin-equipment/equipment-to-tab.tsx:29-32` | Три карты статусов одной и той же сущности `MaintenanceStatus` с разными словами: «Выполнено»/«Закрыт», «Приостановлено»/«Пауза», «Отменено»/«Отменён», «Запланировано»/«Запланирован» | Одна и та же запись ТО показана как «Выполнено» на доске ТО и «Закрыт» на вкладке ТО в карточке установки; в `maintenance-labels.test.ts` покрыта только первая карта | Оставить `maintenance-labels.ts` (типизированная, есть тест), в модуле ТО импортировать её |
| 45 | мелочь | `src/components/piling/maintenance/maintenance-labels.ts:13` против `src/components/piling/to/to-module-bits.tsx:27` и `src/components/piling/admin-equipment/equipment-to-tab.tsx:27` | Тип `SCHEDULED` подписан «Плановое ТО» в одной карте и «ТО» в двух других | Пользователь видит разные названия одного типа работ в разных местах | То же решение, что в №44 |
| 46 | мелочь | `src/services/reports/report-history.ts:33-34` против `src/lib/pdf-generator/format.ts:26-33` | `statusLabel` отчёта в двух копиях; PDF-версия знает ещё «Удалён» и возвращает исходный код при неизвестном значении, версия истории возвращает код тоже, но без «Удалён» | Черновик/отправлен совпадают (`draft`/`submitted`), поэтому сегодня числа и слова не расходятся; правило правки — разное | Оставить одну (`report-history.ts`, её импортируют экраны) |
| 47 | мелочь | `src/components/piling/admin-equipment/equipment-status.ts:33-46` (`REPORT_STATUS_META`) | Имя «статус отчёта» занято другой сущностью — «есть отчёт / ждём отчёт / нет отчёта» в парке, при том что в проекте есть `ReportStatus` = `draft \| submitted` (`src/lib/types.ts:13`) | Следующий читатель `REPORT_STATUS_META` будет искать там `draft/submitted`; смешение уже видно по подписям «Есть отчёт» vs `statusLabel` отчёта | Переименовать в `REPORT_PRESENCE_META` |
| 48 | мелочь | `src/components/piling/to/readiness/readiness-labels.ts:19-22` против `src/lib/pdf-generator/format.ts:35-41` | Подписи типа смены (`DAY`/`NIGHT`) в двух копиях; сами значения — в третьей (`src/modules/reports/domain/shift-types.ts:14`), а окна смен — в четвёртой (`src/components/piling/to/readiness/shift-create-form.tsx:48-49`, `src/modules/operator-mobile/domain/shift-window.ts:18-19`) | «Дневная/Ночная» живут в двух картах; при добавлении третьего типа смены (`shift-types.ts:14` их список) карты разъедутся | Оставить карту в `readiness-labels` (типизирована по DTO) и импортировать в PDF |
| 49 | мелочь | `src/components/piling/admin-equipment/equipment-status.ts:69-75` (`KIND_LABEL`), `src/components/piling/to/readiness/screens/equipment-permit-labels.ts:10-16` (`EQUIPMENT_KIND_LABELS`), `src/components/piling/admin-equipment/equipment-form.tsx:86-92` (`KIND_LABELS`) | Три карты подписей `EquipmentKindDTO` с разными словами: «Копёр» / «Сваебойная установка» / «Забивная установка»; «Бур» / «Буровая установка»; «Гибрид» / «Комбинированная установка» / «Гибрид (забивка + бурение)»; `OTHER` — «—» / «Прочая техника» / «Другое» | Одна и та же установка в списке парка — «Копёр», в матрице допусков — «Сваебойная установка», в форме редактирования — «Забивная установка». Пиксель одного экрана и одного `<select>` дают три разных названия одной сущности | Одна карта (её же стоит типизировать как `Record<EquipmentKindDTO, string>` — сейчас в двух из трёх это `Record<string, string>`) |
| 50 | мелочь | `src/lib/types.ts:399-404`, `src/components/piling/admin-equipment/fleet-types.ts:13-19`, `src/lib/validation-schemas.ts:164`, `src/app/api/safety/equipment-permits/route.ts:15` | Значения перечисления вида техники выписаны четырежды (тип, тип парка, zod-схема, zod-схема маршрута) | Новый вид техники (или переименование) потребует правки в четырёх местах; в трёх из них — строковый литерал без связи с типом | Один `z.enum` из общего списка (`EQUIPMENT_KINDS as const` в `@/lib/types`) |
| 51 | мелочь | `src/services/users/operator-clearance.ts:72-79` (`dayWord`) | Своё склонение «день/дня/дней» рядом с общим `pluralizeRu` (`src/lib/format.ts:104-124`) | Тела эквивалентны на всех значениях (проверено по веткам: 11–19 → «дней», 1 → «день», 2–4 → «дня», иначе «дней»), поэтому расхождения сегодня нет; но это вторая реализация правила склонения | `pluralizeRu(days, ['день','дня','дней'])` |
| 52 | мелочь | `src/lib/format.ts:104-124` (`pluralizeRu`) — при 19 вызывающих в 10 файлах (`admin-crews.tsx:121,196`, `admin-users.tsx:272`, `reports-screen.tsx:289,436,470`, `checklists-section.tsx:238,263,265,277`, `roles-section.tsx:125,228,355` и др.) | Сам склонятор один, но **словари форм задаются в каждом вызове заново**, и часть наборов намеренно неполные: `['сутки','суток','суток']`, `['пункта','пунктов','пунктов']`, `['бригаде','бригадах','бригадах']` | Форма «свая/сваи/свай» нигде не централизована: следующий вызов напишет свой набор и при неверном порядке слов получит «1 свай»/«2 свая» — ровно тот же механизм, что у длины сваи в 7 копиях, только для слов. Наборы проверить нельзя: опечатка не отличается от замысла | Держать словари домена рядом (`{ piles: [...], shifts: [...], reports: [...] }`) и вызывать `pluralizeRu(n, PLURAL.piles)` — тогда набор живёт в одном месте |
| 53 | мелочь | `src/lib/tenant.ts:25-31` против `src/lib/tenant-scope.ts:21-27` | Два разных `requireTenantId` с одним именем: первый принимает пользователя и бросает 403 «Организация пользователя не определена», второй — строку, обрезает её (`trim`) и бросает 400 «Контекст организации не определён» | Все вызовы в `src` разведены корректно (68 импортов `@/lib/tenant` — только в `src/app/api/**`, 7 импортов `@/lib/tenant-scope` — только в сервисах и модулях; файла, импортирующего оба, нет), и TypeScript не даст перепутать аргумент. Но один и тот же семантический отказ отдаётся клиенту с разными кодами (403 vs 400) и текстами в зависимости от того, какой помощник достался маршруту | Переименовать (`requireSessionTenantId(user)` и `requireTenantId(tenantId)`) и свести к одному тексту/коду ответа; оба — fail-closed, поведение по существу верное |
| 54 | мелочь | `src/core/notifications/telegram.ts:43`, `src/modules/settings/application/settings-service.ts:44` | Подстановка организации по умолчанию (`process.env.DEFAULT_TENANT_ID`) сохранилась в двух местах, хотя `src/lib/tenant.ts:1-24` описывает её как устранённый класс дефекта («было рассыпано 85 повторений») | Правило «тенант — только из сессии» в этих двух местах не выполняется: при отсутствии контекста работа продолжится на организации по умолчанию, а не откажет. `src/core/security/tenant-enforcement.ts:73` — третье место, файл не читался (см. «Не проверено») | Проверить оба места владельцем и, если подстановка не нужна, использовать `requireTenantId` |

| 55 | мелочь | `src/lib/pdf-generator/period-row.ts:7-17` (`sumPiles`/`sumDrilling`/`sumDowntime`), `src/lib/pdf-generator/single-pdf.ts:33`, `src/lib/pdf-data.ts:77` | Ещё три места в PDF-контуре считают итоги отчёта своим `reduce` (сваи, метры бурения, часы простоя) | Формулы совпадают с остальными (все с защитой `\|\| 0`), но это уже пятый-шестой код одного правила, причём часть — внутри генератора PDF, куда общий помощник не импортируется сознательно (нет зависимости от Prisma) | Вынести чистые `sumPiles/sumDrilling/sumDowntime` в `@/lib/format` или `@/lib/pile-length`-соседа и импортировать оттуда |

[^1]: «12 мест» — это группа B: `report-totals.ts:20-31` (экраны админа),
    `period-summary.ts:20-51` (`/api/reports/period`), `rebuild.ts:64-66` и
    `:200-202`, `event-handlers.ts:123-128` и `:340-342`, `report.aggregate.ts:316-326`,
    `projection-handlers.ts:72-75`, `equipment-query.service.ts:112-127`,
    `report-query.service.ts:259-272`, `admin/analytics/overview/route.ts:82-84`,
    `report-form.tsx:156-159`. Ещё одна — SQL `raw-queries.ts:134-160` (мёртвая).

## Приложение: адреса в замороженных зонах (не разбирались)

Это копии того же класса, но в зонах, которые нельзя трогать (AGENTS.md §1).
Приведены только адреса, тела не сравнивались:

- `src/app/api/orion/lead/route.ts:51` — третья `escapeHtml` (ORION);
- `src/components/piling/operator-mobile/screens/work-screen.tsx:122,382` — метраж
  сваи считается вручную (`count * lengthMm / 1000`), без `pileLengthMeters`;
- `src/components/piling/operator-v2/sheets.tsx:101` — то же, `(lengthMm / 1000).toFixed(1)`;
- `src/components/piling/operator-mobile/v7/history-v7-app.tsx:20-24` — своя карта статусов отчёта;
- `src/components/piling/operator-mobile/screens/entries-list.tsx:8-11` — свои подписи единиц;
- `src/components/piling/operator-v2/operator-shift-v2.tsx:934`, `operator-v5/operator-v5-app.tsx:1095` —
  единицы «шт/скв/ч» прямо в разметке.

## Не проверено

- **Числа на живой базе.** Все выводы — из сравнения кода; ни одного запроса к БД и
  ни одного рендера не делал. Утверждения вида «сегодня совпадает» означают
  «формулы эквивалентны при допущениях, перечисленных в строке», а не «проверено на данных».
- **Размер фактического отставания проекции `ReportAnalytics`.** Находка №5 построена
  на чтении двух запросов; насколько часто проекция отстаёт на бою (DLQ, ретраи) —
  не проверял, доступа к DLQ и метрикам не было.
- **`src/core/security/**`.** Файл `tenant-enforcement.ts:73` (третья подстановка
  `DEFAULT_TENANT_ID`) и `tenant-context.ts` — из списка off-limits AGENTS.md §1,
  читал только строки, попавшие в результат `grep`. Есть ли там свой
  `requireTenantId`-двойник, не проверено.
- **`src/services/auth/**`** не открывал (AGENTS.md §1) — копий подписей ролей там
  не искал.
- **Что видят в браузере.** Утверждения о виде строк («1 ч 60 мин», «26.09.26, 10:30»,
  «60 мин») получены из параметров функций, а не прогоном в браузере; ICU в этом
  окружении не проверялся.
- **Полнота охвата.** Искал по шаблонам из «Методики» и по телам функций; файлы, в
  которые не попал ни один шаблон, глазами не открывал. «Копий нет» в группах
  склонений и `escapeHtml` означает «не нашлось по этим командам».
- **Формы `pluralizeRu`.** Неполные наборы (`['смены','смен']` и подобные) я считаю
  намеренными; верны ли они по-русски в каждом контексте — лингвистической проверки
  не делал, кроме трёх названных в №52.
- **Тесты.** Не запускал ни `npm run test:unit`, ни `playwright`, ни `tsc`: задача
  только на чтение, а заявка на «зелёность» без прогона была бы вымыслом.
