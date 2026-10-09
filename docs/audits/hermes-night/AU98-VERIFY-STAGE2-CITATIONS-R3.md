# AU98 — Самопроверка отчёта «Этап 2 — функциональность» (ссылки файл:строка)

Версия проверки (git rev-parse HEAD): `44e4aefb9ea64ec2c1cfe28bdedc4aba4a9c9417` (ветка `hermes/q4-0926`).
Проверяемый отчёт: `docs/audits/hermes-night/AUDIT-STAGE2-FUNCTIONALITY.md` (267 строк, 12 находок F-01…F-12).

## Итог (для владельца)

Проверены все 12 находок этапа 2 и выборочно ~45 ссылок таблицы охвата — каждая команда
прогонялась заново (`sed -n`, `grep -n`, `git ls-files`, `wc -l`). Из 12 находок **8 полностью
подтверждены**, **3 подтверждены частично**, **1 содержит неверную ссылку** (F-05: строка
`shift-close.ts:158` не существует по смыслу — там код про топливо, а текста «вносит мастер» в
файле нет вообще). Сама проблема F-05 (мастер не может завести запись/паспорт) подтверждается
другими ссылками и остаётся в силе.

Версия в отчёте (`0b3ebe59…`) отличается от текущего HEAD (`44e4aefb…`), но `git diff` по `src/`
и `prisma/` между ними пуст — вставки только в `docs/audits/`. Поэтому номера строк проверяемы.

Статус: основная масса ссылок верна — **ПРОЙДЕНО**. Итоговая цифра: неверных ссылок 1 из ~57
проверенных (≈2 %), частичных 3.

## Методика

Как проверялось (команды воспроизводимы из корня `D:\PillingR\wt-night`):

- `git rev-parse HEAD`, `git cat-file -t 0b3ebe59…`, `git diff --stat 0b3ebe59…..HEAD -- src prisma docs`;
- для каждой ссылки `файл:строка` — `sed -n 'X,Yp' <файл>` (диапазон) и `sed -n 'Xp' <файл>` (одиночная),
  наличие файла — `wc -l <файл`;
- ссылки без пути искались через `git ls-files | grep -i "<имя>"` и `grep -rn <символ> src --include=*.ts`;
- агрегатные проверки: `find src/app/api -name route.ts | wc -l`; `grep -rn "recordedByForeman" src --include=*.ts`;
  `grep -rln "pilePassport.create\|pilePassport.upsert" src`; `grep -n "MAX_*" src/modules/reports/domain/report.aggregate.ts`;
  `grep -rniE "испытани|PileTest|несущая способн" docs/product docs/adr`.

Ограничения: приложение не запускалось, `.env` не читался, существующие отчёты `docs/audits/**`
(кроме проверяемого и этого файла) не открывались. Проверялось только *существование строки и
соответствие описанию по тексту кода*, а не поведение на данных (это и есть предмет самого этапа 2).

Полные пути для «ссылок без пути» (найдены через `git ls-files`, в отчёте этапа 2 они даны сокращённо):

| Сокращение в отчёте | Полный путь | Строк |
|---|---|---|
| `production.ts` | `src/modules/operator-mobile/application/commands/production.ts` | 594 |
| `production-corrections.ts` | `src/modules/operator-mobile/application/commands/production-corrections.ts` | 215 |
| `shift-close.ts` | `src/modules/operator-mobile/application/commands/shift-close.ts` | 340 |
| `equipment.ts` | `src/modules/operator-mobile/application/commands/equipment.ts` | 161 |
| `shared.ts` | `src/modules/operator-mobile/application/commands/shared.ts` | 440 |
| `pile-passport.ts` | `src/modules/operator-mobile/domain/pile-passport.ts` | 280 |
| `production-permit.ts` | `src/modules/operator-mobile/domain/production-permit.ts` | 141 |
| `downtime-interval.ts` | `src/modules/operator-mobile/domain/downtime-interval.ts` | 52 |
| `downtime-hours.ts` | `src/lib/downtime-hours.ts` | 129 |
| `validation-schemas.ts` | `src/lib/validation-schemas.ts` | 469 |
| `pile-passport.service.ts` | `src/modules/reports/application/queries/pile-passport.service.ts` | 76 |
| `pile-journal-list.ts` | `src/modules/reports/application/queries/pile-journal-list.ts` | — |
| `pile-journal-totals.ts` | `src/modules/reports/application/queries/pile-journal-totals.ts` | — |
| `report-command.service.ts` | `src/modules/reports/application/commands/report-command.service.ts` | 398 |
| `report-validation.service.ts` | `src/modules/reports/application/commands/report-validation.service.ts` | — |
| `report.aggregate.ts` | `src/modules/reports/domain/report.aggregate.ts` | — |
| `transitions.ts` | `src/modules/readiness/domain/shifts/transitions.ts` | 88 |
| `shift.ts` | `src/modules/readiness/domain/shifts/shift.ts` | 18 |
| `commands.ts` (готовность) | `src/modules/readiness/application/shifts/commands.ts` | 433 |
| `start-decision.ts` | `src/modules/readiness/application/shifts/start-decision.ts` | 57 |
| `readiness-facts.ts` | `src/modules/readiness/application/readiness-facts.ts` | 84 |
| `defects/defect.ts` | `src/modules/readiness/domain/defects/defect.ts` | 69 |
| `defects/commands.ts` | `src/modules/readiness/application/defects/commands.ts` | 232 |
| `route.ts` (мобильный) | `src/app/api/operator/mobile/command/route.ts` | — |

## Находки — результаты проверки ссылок

Таблица: ID | ссылка (проверенная) | существует | соответствует описанию | комментарий.

### F-01 — поправка простоя обходит предел 24 ч

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-01a | `src/modules/operator-mobile/application/commands/production-corrections.ts:185-207` | да | да | ветка DOWNTIME, пишет `duration: delta` без сверки с `DOWNTIME_MAX_HOURS` |
| F-01b | `src/app/api/operator/mobile/command/route.ts:145` | да | да | `actual: z.number().min(0).max(500)` — потолок 500 подтверждён |
| F-01c | `src/lib/downtime-hours.ts:39` | да | да | `export const DOWNTIME_MAX_HOURS = 24;` |
| F-01d | `production-corrections.ts:191` | да | да | `const delta = Math.round((actual - current) * 100) / 100;` |
| F-01e | `production-corrections.ts:200` | да | да | `duration: delta,` |

**Статус: ПРОЙДЕНО.** Все пять ссылок верны.

### F-02 — мобильный контур не сверяет сумму простоев со сменой

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-02a | `src/modules/operator-mobile/application/commands/production.ts:408-441` | да | да | ветка `} else if (typeof entry.hours === 'number') {` — простой в часах |
| F-02b | `production.ts:415-423` | да | да | проверки: `hours < STEP`, `hours > MAX`, `isWholeDowntimeStep` — по одному значению, суммы нет |
| F-02c | `src/modules/reports/application/commands/report-validation.service.ts:27` | да | да | `if (totalDowntime > shiftHours) {` — форма отчёта сумму проверяет |
| F-02d | `src/modules/reports/domain/report.aggregate.ts:231` | да | да | `if (shiftHours && totalDowntime > shiftHours) {` |
| F-02e | `src/modules/operator-mobile/application/commands/shift-close.ts:335` | да | да | `totalDowntime: report.downtimes.reduce((sum, d) => sum + d.duration, 0)` — только сумма, без сверки |

**Статус: ПРОЙДЕНО.**

### F-03 — поправка создаёт отрицательное количество

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-03a | `production-corrections.ts:110-119` | да | да | ветка PILES: `delta = Math.round(input.actual) - current`, `count: delta` |
| F-03b | `production-corrections.ts:147-160` | да | да | ветка DRILLING: `count: delta`, `meters: delta * original.metersPerUnit` |
| F-03c | `prisma/schema.prisma:2180` | да | да | `count       Int` — без ограничения (файл 2883 строки) |
| F-03d | `production.ts:260` | да | да | `if (entry.count <= 0) throw … 'Количество свай должно быть больше нуля'` |
| F-03e | `production.ts:391` | да | да | `if (entry.count <= 0) throw … 'Количество скважин должно быть больше нуля'` |

**Статус: ПРОЙДЕНО.** Контраст «прямая запись запрещает ≤0, поправка — нет» подтверждён.

### F-04 — испытания свай не реализованы (пробел)

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-04a | `prisma/schema.prisma:14-2860` | да | да | строка 14 — `model Tenant {`, 2860 — `model OrionLead {` (диапазон моделей) |
| F-04b | «поиск по `docs/product/*` и `docs/adr/*` пуст» | — | **частично** | `grep -rniE "испытани\|несущая способн" docs/product docs/adr` даёт совпадения: `docs/product/operator-shift-readiness-specification-2.0-final.md:264,392` («несущая способность»), `:755,930,972` («испытания» в смысле тестов ПО), `docs/adr/0049-operator-v3-offline-authority.md:27`. Вывод «поиск пуст» неверен, хотя совпадения не про функцию «испытание свай» |
| F-04c | отсутствие кода испытаний свай | да | да | `grep -rniE "испытани" src e2e tests prisma --include=*.ts` без строк про тесты ПО — пусто |

**Статус: ЧАСТИЧНО.** Ключевой вывод (модели/маршрута/кода испытаний свай нет) подтверждён; но
утверждение «в docs/product и docs/adr поиск пуст» — неверно, совпадения есть.

### F-05 — нет пути создания паспорта сваи для мастера

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-05a | `src/modules/reports/application/queries/pile-journal-list.ts:151` | да | да | `recordedByForeman: passport?.recordedByForeman ?? false,` — только чтение |
| F-05b | `src/modules/operator-mobile/application/commands/production.ts:344` | да | да | `await tx.pilePassport.create({` — единственный писатель паспорта |
| F-05c | `production.ts:225` | да | да | `+ 'Если запись пропущена, её вносит мастер в журнале забивки.'` |
| F-05d | `src/modules/operator-mobile/application/commands/shift-close.ts:158` | да | **нет** | строка 158 — это `const fuelPercent = typeof fuelPayload?.fuelPercent …` (про топливо). `grep -n "мастер" shift-close.ts` — совпадений НЕТ вообще. Текст-отказ «вносит мастер» есть в `production-corrections.ts:88` и `production.ts:159,225`, но НЕ в `shift-close.ts` |
| F-05e | `src/app/api/operator/mobile/command/route.ts:192` | да | да | `if (user.role !== 'OPERATOR') {` — маршрут пропускает только машиниста |

**Статус: ЧАСТИЧНО / одна ссылка неверна.** Ссылка F-05d ошибочна. Основной вывод находки
(мастер не может завести запись/паспорт; `recordedByForeman` нигде не пишется в `true`) —
подтверждён `grep`-ом: единственные вхождения — `pile-journal-list.ts:151`, тип
`pile-journal-types.ts:79`, тест `__tests__/pile-passport.service.test.ts:69`; записи `true` нет.

### F-06 — мобильный старт обходит шлюз готовности

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-06a | `src/modules/operator-mobile/application/commands/equipment.ts:75-108` | да | да | `acceptEquipment`: `tx.shift.update(... state: 'STARTED' ...)` и `tx.shift.create(... state: 'STARTED' ...)` |
| F-06b | `equipment.ts:80-107` | да | да | `state: 'STARTED', startedAt: now` — без `getOperatorClearance`/`evaluateAuthoritativeShiftStart` |
| F-06c | `src/modules/readiness/application/shifts/commands.ts:181-199` | да | да | `getOperatorClearance(...)` (422 `OPERATOR_NOT_CLEARED`) и `evaluateAuthoritativeShiftStart(...)` (422 `SHIFT_START_BLOCKED`) |
| F-06d | `production.ts:239-254` | да | да | комментарий «Простой намеренно проходит без проверки…» (зона записи выработки) |

**Статус: ПРОЙДЕНО.** Контраст двух контуров подтверждён.

### F-09 — поправка PILES не проверяет паспорт

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-09a | `production-corrections.ts:93-131` | да | да | ветка `if (input.kind === 'PILES')`: `findFirst`/`aggregate` по `pileWork`, проверки паспорта нет |

**Статус: ПРОЙДЕНО** (ссылка и описание верны; сама находка помечена в отчёте как ГИПОТЕЗА — на
данных не проверялась, здесь проверялась только ссылка).

### F-10 — журнал печатает поправочные строки отдельно

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-10a | `pile-journal-list.ts:47-89` | да | да | `:47` — `const rows = await db.pileWork.findMany({` (берёт все `PileWork`) |
| F-10b | `pile-journal-list.ts:135-141` | да | да | `count: work.count` и т.п. в сборке строки |
| F-10c | `pile-journal-totals.ts:146` | да | да | комментарий «…по всему периоду, не по странице» (признание поправок) |

**Статус: ПРОЙДЕНО.**

### F-07 — документ ссылается на устаревшие строки pile-passport.service.ts

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-07a | `docs/pile-journal.md:13-18` | да | **частично** | строки 13-18 существуют, но содержат ссылки `:268-313`, `:377-379`, `:263-267`, `:202-222`. Упомянутые в тексте F-07 номера `:309`, `:329-332`, `:717` стоят в этом файле на строках **8-9**, а не 13-18 |
| F-07b | `pile-passport.service.ts:1-22` — фасад | да | да | `src/modules/reports/application/queries/pile-passport.service.ts`, 76 строк; строки 1-22 — фасад (реэкспорт, `decidePilePassport`) |
| F-07c | «файл в репозитории 76 строк» | да | да | `wc -l` = 76 ⇒ ссылки документа на `:309/:717` не существуют в файле — довод F-07 верен |

**Статус: ЧАСТИЧНО.** Вывод (документация вводит в заблуждение — номера строк устарели) подтверждён
и даже усилен: строк 309/329-332/717 в 76-строчном файле нет. Диапазон `:13-18` в ссылке чуть смещён.

### F-08 — комментарий про округление расходится с кодом

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-08a | `production-corrections.ts:186-189` | да | да | комментарий «полные часы, неполный вверх» |
| F-08b | `production-corrections.ts:191` | да | да | `Math.round((actual - current) * 100) / 100` — округления «вверх» нет |

**Статус: ПРОЙДЕНО.**

### F-11 — несогласованные потолки количества

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-11a | `src/app/api/operator/mobile/command/route.ts:72` | да | да | `count: z.number().int().min(1).max(500),` (PILES) |
| F-11b | `route.ts:114` | да | да | `count: z.number().int().min(1).max(500),` (DRILLING) |
| F-11c | `src/lib/validation-schemas.ts:260` | да | **частично** | строка 260 — `count: z.number().int().min(1, 'Count must be at least 1')` — **без** `max`. Значение `9999` стоит рядом, на `:265-266` (это `drillings.count`/`metersPerUnit`). Т.е. «схема отчёта — 9999» для свай не подтверждается этим номером строки |
| F-11d | `report.aggregate.ts:96` | да | да | `const MAX_PILE_COUNT = 9999;` |

**Статус: ЧАСТИЧНО.** Потолок `9999` в агрегате (`:96`) и `500` в маршруте подтверждены; но
`validation-schemas.ts:260` содержит минимум без максимума — номер строки в ссылке неточен
(для бурения `9999` — на `:265-266`).

### F-12 — смену в STARTED можно отменить

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-12a | `src/modules/readiness/domain/shifts/transitions.ts:11` | да | да | `cancel: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED'],` |

**Статус: ПРОЙДЕНО.**

### Проверка ссылок таблицы охвата (выборка)

Все перечисленные ниже диапазоны открыты и существуют; содержимое соответствует описанию этапа.
Ссылки без пути уточнены полным путём (таблица выше).

| # | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| 1.2 | `operator-mobile/domain/shift-phases.ts:13-43` (164 стр.) | да | да | `export type OperatorPhase =` |
| 1.2 | `equipment.ts:22-108` | да | да | `export async function acceptEquipment(input: {` |
| 1.3 | `shift-phases.ts:74-81` | да | да | `export const STAGE_PREREQUISITES…` |
| 1.3 | `shared.ts:247-306` | да | да | `export async function requireProductionPermit(tx, input…` |
| 1.4 | `production.ts:259-440` | да | да | начинается с `if (entry.kind === 'PILES') {` |
| 1.4 | `pile-passport.ts:20-280` | да | да | файл ровно 280 строк |
| 1.4 | `pile-passport.ts:36-57` | да | да | `export function actualRefusalMm(measurement…` |
| 1.5 | `production-corrections.ts:51-214` | да | да | `export async function correctProduction(input: {` |
| 1.6 | `shift-close.ts:16-96` | да | да | `export async function finishWork(input: {` |
| 1.6 | `shift-close.ts:117-217` | да | да | `export async function submitShiftReport(tx, input…` |
| 1.6 | `shift-close.ts:67-69` | да | да | `if (!done) { throw new OperatorCommandError(409, '…ЕО после работы') }` |
| 2.1 | `readiness/domain/shifts/transitions.ts:4-75` | да | да | `const SHIFT_ALLOWED = {` |
| 2.4 | `shared.ts:312-333` | да | да | `export async function recordEvidence(tx, input…` |
| 2.5 | `start-decision.ts:19-25` | да | да | `const snapshot = await createDeduplicatedSnapshot(…` |
| 2.6 | `production-permit.ts:103-113` | да | да | `const critical = facts.openDefects.filter(… 'CRITICAL')` |
| 2.6 | `readiness-facts.ts:74-79` | да | да | `criticalDefect: summarizeDefects(defects).blockingCount > 0 \|\| …` (полный путь: `src/modules/readiness/application/readiness-facts.ts`) |
| 2.6 | `defects/defect.ts:27` | да | да | `export function blocksOperation(severity: DefectSeverity): boolean` |
| 2.7 | `defects/commands.ts:198-214` | да | да | `export async function resolveDefectCommand(input: {` |
| 2.8 | `production-permit.ts:11-18` | да | да | комментарий «Запрещается ВЫРАБОТКА — сваи, бурение…» |
| 2.8 | `production.ts:239-254` | да | да | комментарий «Простой намеренно проходит без проверки…» |
| 3.0 | `shift-close.ts:131-132` | да | да | «Отчёт может не существовать: смена без единой сваи…» |
| 3.1 | `production.ts:390-441` | да | да | `} else if (entry.kind === 'DRILLING') {` |
| 3.2 | `downtime-hours.ts:94-107` | да | да | блок про переход через сутки |
| 3.2 | `shift.ts:7-9` | да | да | `if (start && end && end <= start)` |
| 3.3 | `shared.ts:83-88` | да | да | `export function productionDateOf(timezone, now…` |
| 3.3 | `shift-window.ts:29-58` | да | да | `function zoneOffsetMinutes(at, timeZone)…` |
| 3.4 | `shared.ts:43-80` | да | да | `requireOpenShift` (блок) |
| 3.5 | `shared.ts:31-41` | да | да | `export async function requireCrew(tx, tenantId, operatorId, equipmentId)` |
| 3.5 | `report-command.service.ts:238-259` | да | да | `const operatorCrews = await tx.crew.findMany({` |
| 3.6 | `production-permit.ts:69-82` | да | да | `const invalid = facts.documents.filter(` |
| 3.7 | `production-permit.ts:94-101` | да | да | `if (!facts.equipmentActive) {` |
| 3.9 | `production.ts:216-227` | да | да | комментарий «Сданный отчёт — закрытый документ…» |
| 3.9 | `report-command.service.ts:199-219` | да | да | `if (shiftState === 'STARTED' \|\| shiftState === 'HANDOVER_PENDING') {` |
| 4.0 | `validation-schemas.ts:237-292` | да | да | `export const reportUpsertSchema = z.object({` … `});` |
| 4.0 | `downtime-hours.ts:56-85` | да | да | `export function isWholeDowntimeStep(hours)…` |
| 4.0 | `downtime-interval.ts:35-52` | да | да | `export function findDowntimeConflict(` |
| Т | `transitions.ts:4-15` | да | да | `const SHIFT_ALLOWED = {` |
| Т | `transitions.ts:66-75` | да | да | `export function transitionShift(state, command)…` |
| Т | `commands.ts:326-330` | да | да | `const submittedReport = await input.tx.report.findFirst({` |

**Статус раздела: ПРОЙДЕНО** (уточнён полный путь `readiness-facts.ts`).

### Проверка агрегатных чисел протокола

| Утверждение этапа 2 | Команда | Факт | Статус |
|---|---|---|---|
| маршрутов API — 141 | `find src/app/api -name route.ts \| wc -l` | `141` | ПРОЙДЕНО |
| `recordedByForeman` — только чтение | `grep -rn "recordedByForeman" src --include=*.ts` | `pile-journal-list.ts:151`, `pile-journal-types.ts:79`, тест `:69` | ПРОЙДЕНО |
| единственный писатель паспорта — `production.ts` | `grep -rln "pilePassport.create\|upsert" src` | `…/commands/production.ts` (+ generated) | ПРОЙДЕНО |
| `MAX_*` в агрегате = 24 / 9999 / 99999 | `grep -n "MAX_*" report.aggregate.ts` | `:95 =24`, `:96 =9999`, `:97 =99999` | ПРОЙДЕНО |
| `DOWNTIME_MAX_HOURS = 24` | `sed -n '39p' downtime-hours.ts` | `24` | ПРОЙДЕНО |
| тест `production-corrections.test.ts` существует | `git ls-files` | `src/modules/operator-mobile/application/commands/__tests__/production-corrections.test.ts` | ПРОЙДЕНО |
| версия отчёта `0b3ebe59…` | `git cat-file -t` | коммит существует; текущий HEAD `44e4aefb…`, `git diff src prisma` пуст | ПРОЙДЕНО (с оговоркой) |

## Сводка

| Показатель | Значение |
|---|---|
| Проверено находок | 12 (F-01…F-12) |
| Полностью верны | 8 (F-01, F-02, F-03, F-06, F-08, F-09, F-10, F-12) |
| Частично верны | 3 (F-04, F-07, F-11) |
| С неверной ссылкой | 1 (F-05 — `shift-close.ts:158`) |
| Проверено ссылок `файл:строка` (находки + охват + протокол) | ≈ 57 |
| Несуществующих строк | 0 (все проверенные номера строк ≤ длины файлов) |
| Несуществующих файлов | 0 (уточнён путь `readiness-facts.ts`) |
| Неверных по содержанию | 1 (F-05d) |

**Самая важная неточность:** в F-05 как доказательство «текст отказа отправляет машиниста к мастеру»
указана `shift-close.ts:158`, но в этом файле слово «мастер» не встречается ни разу (строка 158 —
про топливо). Верный адрес текста-отказа: `production-corrections.ts:88` и `production.ts:159,225`.
Вывод самой находки при этом не рушится — он опирается на F-05a/F-05b/F-05e.

## Не проверено

- Поведение на данных и в браузере (как и в этапе 2) — здесь проверялось только соответствие
  «ссылка ↔ текст кода», а не работа системы. НЕ ПРОВЕРЕНО.
- Полная вычитка **каждой** ссылки таблицы охвата построчно (проверено ≈45 диапазонов; проверялось
  существование и первая строка диапазона, не смысл всей области). Часть областей — НЕ ПРОВЕРЕНО.
- `npx playwright test --list` (утверждение «291 tests / 27 files») не перезапускалось: длительная
  операция, не относящаяся к сверке ссылок. НЕ ПРОВЕРЕНО.
- Соответствие ссылок в разделах «Охват пунктов» для пунктов 1.1, 1.7, 2.2, 2.3 (кроме
  `commands.ts:181-199`), 3.8 — не открывались отдельно. НЕ ПРОВЕРЕНО.
- Не открывались существующие отчёты `docs/audits/**` (кроме проверяемого) и `CODEX-REPORT*`,
  `docs/strategy` — по условию задачи.
- Файлы в «замороженных» областях (экран оператора, ORION) не проверялись — вне темы задачи.

Статусы по разделу: сверка ссылок находок F-01…F-12 — **ПРОЙДЕНО** (кроме отмеченных частичных/неверных);
сверка таблицы охвата — **ПРОЙДЕНО выборочно**; повторный прогон тестов — **НЕ ПРОВЕРЕНО**.
