# 55 — История отчёта пуста у мобильного контура оператора (F-04)

## Итог

Проверка только чтением, код не менялся. Разобраны две ветки записи `Report` — мобильный
контур оператора (`src/modules/operator-mobile/**`) и диспетчерская форма отчёта
(`report-command.service.ts`) — и единственный читатель истории
(`GET /api/reports/[id]/history`).

Главное: **историю (`ReportAudit`/`ReportVersion`) пишет ровно один путь — диспетчерская
форма через `PrismaReportRepository.save()`**. Мобильный контур создаёт и меняет `Report`
напрямую (`tx.report.upsert` в `ensureReport`), минуя репозиторий. Поэтому:

- `ReportVersion` мобильного отчёта не создаётся **никогда** — `versions: []` гарантированно
  на любой сборке (единственный `reportVersion.create` — `report.repository.ts:243`, файл:строка).
- `ReportAudit` на текущей ветке `hermes/q4-0926` пишется **одной** строкой сдачи
  (`shift-close.ts:204`, коммит `20a4cf9f` F-R34-4), а записи выработки и поправки — ни одной.
- На `origin/main` (и на сборке, которую, вероятно, смотрел AutoClaw 29.09) `shift-close.ts`
  **не содержит** `writeReportAuditRow` вовсе (проверено `git show origin/main:...`). Это и
  даёт наблюдаемое `{"events":[],"versions":[]}`.

Итого находок: **критично 3, важно 3, мелочь 2** (8). Топ-5:

1. **критично** — `ReportVersion` мобильного отчёта не пишется (versions всегда пусто): `report.repository.ts:243` — единственный писатель, мобильный путь его не вызывает.
2. **критично** — на `origin/main` сдача смены не пишет `ReportAudit`: `git show origin/main:src/modules/operator-mobile/application/commands/shift-close.ts` — импорта/вызова `writeReportAuditRow` нет (события пусто).
3. **критично** — создание отчёта и выработка мобильного контура не оставляют ни следа, ни версии: `shared.ts:380`, `production.ts:253,315,378,455`, `production-corrections.ts:88,121,161`.
4. **важно** — `ensureReport` возвращает первичный ключ (`report.id`), а история ищется и пишется по деловому `reportId`: `shared.ts:396-399` против `report-history-service.ts:40-41`.
5. **важно** — `writeReportAuditRow` молча выходит, если модель отсутствует в сгенерированном клиенте: `audit-service.ts:37`.

Пустая история — **не by design**: нет ни комментария, ни документа, объявляющего историю
диспетчерской формой; наоборот, `report.repository.ts:5` заявляет «SINGLE write path — no
duplicate persistence elsewhere», что мобильный путь нарушает, а `docs/audits/hermes-night/34-audit-trail.md` (п. #3)
фиксирует это как дефект с рекомендацией того же фикса.

## Методика

Что искал и как (повторяемо):
- `rg "reportAudit|reportVersion"` по всему `src/` — исчерпывающий список писателей/читателей.
- `rg "writeReportAuditRow|recordPostCommitAuditEvent|recordAudit\("` по `src/`.
- `rg "getReportHistory|report-history"` по `src/` — маршрут и потребители.
- `git log -- <file>` и `git show origin/main:<file>` — на какой ветке живёт фикс сдачи.
- Прочитаны целиком/частями: `production.ts`, `production-corrections.ts`, `shift-close.ts`,
  `shared.ts`, `report-command.service.ts`, `report.repository.ts`, `audit-service.ts`,
  `report-history-service.ts`, `report-history.ts`, `event-handlers.ts`,
  `api/reports/[id]/history/route.ts`, `use-report-history.ts`, `admin-reports.tsx`,
  `prisma/schema.prisma:1927-2028`, `docs/audits/hermes-night/34-audit-trail.md`.

### Маршрут истории

`GET /api/reports/[id]/history` → `getReportHistory(id)` (`api/reports/[id]/history/route.ts:15`),
где `id` — **деловой** `reportId` (`RM-…`); клиент передаёт `report.reportId`
(`use-report-history.ts:23`, `admin-reports.tsx:115`). Читает:
`db.reportAudit.findMany({where:{reportId}})` и `db.reportVersion.findMany({where:{reportId}})`
(`report-history-service.ts:40-41`). Требуется право `reports.read_all` (`route.ts:13`).
Обе таблицы ключуются **строковым** `reportId` (не ПК) — `schema.prisma:1995,2012`.

### Таблица: путь записи → история

| путь записи | ReportAudit (events) | ReportVersion (versions) | файл:строка |
|---|---|---|---|
| Мобильный: заведение отчёта | нет | нет | `shared.ts:380` (`ensureReport` → `tx.report.upsert`) |
| Мобильный: сваи / паспорт / бурение / простой | нет | нет | `production.ts:253,315,378,455` |
| Мобильный: поправка выработки (10→8) | нет | нет | `production-corrections.ts:88,121,161` |
| Мобильный: сдача (`closeShift`/`submitReport`) | **да, 1 строка** (только ветка; на main — нет) | нет | `shift-close.ts:204` (запись), `:172-185` (статус) |
| Диспетчерская форма: `upsertReport` | да (`created`/`updated`) | **да** | `report-command.service.ts:323`, `report.repository.ts:243` |

### Минимальный план исправления

Цель — чтобы мобильный цикл писал `ReportAudit` и `ReportVersion` в **той же транзакции**,
что и изменение отчёта (`withReadinessTenantTransaction`), по деловому `reportId`.

1. **`ReportAudit` на всех шагах.** В `logProduction` (после `tx.pileWork.create` /
   `leaderDrilling.create` / `reportDowntime.create`), в `correctProduction` (после `create`
   поправки) и в `submitShiftReport` (уже есть) вызвать `writeReportAuditRow(record, auditTx)`
   с деловым `reportId`. Для этого `ensureReport` должен вернуть не только `report.id` (ПК),
   но и деловой `reportId` (`select: {id, reportId}` в `shared.ts:396`), либо команда читает
   его отдельным `tx.report.findUnique`.
2. **`ReportVersion`.** Сейчас снапшот пишет только `PrismaReportRepository.save()`
   (`report.repository.ts:239-257`). Минимально — вынести формирование снапшота в общий
   helper (например, `modules/reports`) и вызывать его в той же транзакции после записи
   строк выработки/поправки/сдачи (`version = report.version + 1`, `actorId = operatorId`,
   `data` — снимок строк отчёта). Альтернатива — прогонять мобильные изменения через
   `repository.save()` (крупнее, но даёт один путь записи, как заявлено в комментарии
   `report.repository.ts:5`).
3. **Согласованность идентификатора.** Везде (audit + version) использовать деловой
   `reportId`, как это уже делает `shift-close.ts:205` (`submittedReport.reportId`) и
   `report-command.service.ts:298`.

Оговорка: точную форму снапшота и точку вызова (общий helper против `repository.save`)
надо согласовать с владельцем — это архитектурное решение, здесь дан минимальный вариант.

### By design?

Нет. `report.repository.ts:5` («SINGLE write path — no duplicate persistence elsewhere»)
предполагает, что **все** записи отчёта идут через репозиторий; мобильный путь это нарушает.
Ни комментария, ни документа «история только для диспетчерской формы» не найдено.
`docs/audits/hermes-night/34-audit-trail.md` (п. #3, «критично») прямо фиксирует отсутствие
шага «Сдано» в мобильном контуре как дефект. Единственный исторический след — коммит
`20a4cf9f` (F-R34-4), которым дописана строка сдачи, — но только на ветке `hermes/q4-0926`,
не на `main`.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | критично | src/modules/reports/infrastructure/report.repository.ts:243 | `ReportVersion` пишет единственный путь — `PrismaReportRepository.save()`; мобильный контур его не вызывает | Любой отчёт, заведённый с телефона, имеет `versions: []` навсегда. Снапшоты нужны для отката/разбора конфликтов — их нет | Вынести снапшот в helper и вызывать в мобильной транзакции (см. план п.2) |
| 2 | критично | src/modules/operator-mobile/application/commands/shift-close.ts:204 (на origin/main — отсутствует; проверено `git show origin/main:...`) | На основной ветке сдача смены не пишет `ReportAudit` | Ветка `hermes/q4-0926` не в main; сборка из main даёт `events: []` после цикла — ровно F-04 | Влить фикс `20a4cf9f` в main / не считать дефект закрытым до слияния |
| 3 | критично | src/modules/operator-mobile/application/commands/shared.ts:380; production.ts:253,315,378,455; production-corrections.ts:88,121,161 | Создание отчёта, запись и поправка выработки не пишут ни `ReportAudit`, ни `ReportVersion` | «Создан»/«Изменён» в истории есть только у формы; по циклу оператора (сваи, 10→8, сдача) истории нет вовсе | `writeReportAuditRow` в тех же транзакциях + снапшот версии |
| 4 | важно | src/modules/operator-mobile/application/commands/shared.ts:396-399 | `ensureReport` возвращает `report.id` (cuid, ПК), тогда как история адресуется полем `reportId` | Прямое использование результата `ensureReport` как ключа истории даст промах; сейчас спасает лишь отдельное чтение `reportId` в `submitShiftReport` | Возвращать `{id, reportId}` из `ensureReport` |
| 5 | важно | src/services/reports/audit-service.ts:37 | `writeReportAuditRow` молча `return`, если `client.reportAudit` нет в клиенте; вызывающий считает след записанным | В среде со старым `src/generated` отчёт сдаётся «без следа» и без ошибки — трудно диагностировать | Логировать `logger.warn`, как в `services/audit/audit-service.ts` |
| 6 | важно | src/services/reports/report-history-service.ts:40-41 | Обе выборки идут строго по деловому `reportId`, а не по ПК | Если потребитель когда-либо передаст ПК (список отчётов/иной экран), история пуста без ошибки — легко принять за баг записи | Задокументировать контракт `reportId` у маршрута или принимать оба ключа |
| 7 | мелочь | docs/audits/hermes-night/34-audit-trail.md:14 | Отчёт №34 описывает уже исправленное на ветке состояние (сдача без аудита), но лежит как актуальный | Ревьюер, читая №34, считает фикс отсутствующим (или наоборот) — расходится с кодом ветки | Пометить №34 «сверять с веткой» / сослаться на `20a4cf9f` |
| 8 | мелочь | src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts:69 | Тест проверяет вызов `writeReportAuditRow`, но не `reportVersion.create` | Регресс «версии не пишутся» тестом не ловится — именно поэтому `versions: []` не был замечен | Добавить ожидание снапшота версии после фикса |

## Не проверено

- **Живую БД не открывал** (ни локальную, ни прод): все выводы — чтением кода и `git`.
  Фактическое содержимое `ReportAudit`/`ReportVersion` в данных не смотрел.
- **Сборку, которую тестировал AutoClaw 29.09**, не воспроизводил: вывод «на main нет фикса»
  сделан из `git show origin/main:...`, а не из запуска. Точная дата/коммит сборки AutoClaw
  неизвестны.
- **Экран оператора (UI) и маршрут `/api/operator/mobile/command`** прочитал лишь частично;
  какой именно шаг UI зовёт `closeShift` против `submitReport` в конкретном цикле F-04 —
  не прослеживал (косвенно: `operator-v10-app.tsx:1724` зовёт `closeShift`).
- **Форму снапшота `ReportVersion.data`** и точку интеграции (общий helper против
  `repository.save`) не проектировал детально — это решение владельца.
- **`getReportHistory` под разными ролями** (какие роли реально имеют `reports.read_all`) —
  не проверял, это `authorization-service` (вне скоупа).
- Проверки §6 AGENTS.md (`tsc`, `lint`, тесты, Playwright) не запускал — задача read-only,
  код не менялся; создан только этот файл.
