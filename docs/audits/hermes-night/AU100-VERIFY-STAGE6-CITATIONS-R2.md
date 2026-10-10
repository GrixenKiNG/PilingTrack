# AU100-VERIFY-STAGE6-CITATIONS-R2: самопроверка ссылок «файл:строка» в AUDIT-STAGE6-DATA-HISTORY

- Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`
- Версия (git rev-parse HEAD): `071535ec0fe9a63b98d0064cfa6c9b6a87e8fcc2`
- Режим: только чтение. Ни один файл приложения не изменён.
- Дата прогона: 09.10.2026.
- Проверяемый документ: `docs/audits/hermes-night/AUDIT-STAGE6-DATA-HISTORY.md` (читать разрешено заданием).

## Итог

1. Проверены все **17** находок реестра (F-01…F-17) и **~65** упоминаний `файл:строка`,
   включая примечания и строки таблицы охвата.
2. **Полностью ПРОЙДЕНО (файл и строка существуют и содержат описанное): 15 находок.**
3. **Частично: 2** — F-01 (одна из ссылок указывает на соседнюю строку) и F-08 (цитируются
   верные миграции, но «удаляют колонки» неточно: одна из них удаляет *таблицу*, не колонку).
4. **Явно ложных ссылок на несуществующие файлы/строки: 0.** Ни одна строка не вышла за
   пределы файла; файл `src/lib/system-templates.ts` в таблице охвата указан без полного пути
   (реально `src/services/dictionaries/system-templates.ts`) — файл существует, ссылка неполная.
5. Самые надёжные улики (совпадают дословно): F-03 (`report-command.service.ts:325` —
   `expectedVersion: input.expectedVersion ?? ...`), F-12 (`timezone.ts:21` — дефолт
   `'Europe/Moscow'`), F-05/F-17 (мёртвые события `ReportUpdated` и регистрации).

## Методика

Что и как проверялось (воспроизводимо из `D:\PillingR\wt-night`, git-bash):

1. `git rev-parse HEAD` → `071535ec...` (exit 0).
2. Все ссылки из реестра находок, примечаний и таблицы охвата собраны вручную в список
   `файл::строки` и прогнаны одним скриптом на Node (`chk.mjs` в scratch): для каждой ссылки
   проверяется существование файла (`fs.existsSync`) и печатается содержимое указанных строк
   (`sed`-эквивалент через чтение файла). Строки вне диапазона файла помечаются `OUT_OF_RANGE`.
3. Дополнительно: `sed -n 'N,Mp'` для контекста вокруг спорных ссылок; `find`/`ls` для
   существования файлов-цитат; `grep -rn "audit-fix-tenancy\|apply-full-ddl"` для утверждения
   «скрипт нигде не вызывается» (F-07).
4. Разрешение сокращённых имён: `find src -name 'report.aggregate.ts' -o -name 'projection-worker.ts' …`
   (в проекте два `projection-worker.ts` — уточнено, какая ссылка куда ведёт).
5. Проверка «соответствует» делалась чтением строки и сравнением с текстом находки; где
   заявление семантическое (не дословное), в комментарии отмечено, что именно сверено.

Команды запускались без `| tail`/`| head`; код выхода — реальный.

### Проверка каждой находки

| ID | ссылка | существует | соответствует | комментарий |
|---|---|---|---|---|
| F-01 | `shared.ts:411` | да | да | `date: input.productionDate` — ровно «отчёт получает date = productionDate» |
| F-01 | `shared.ts:406` | да | **нет** | строка 406 = `reportId: RM-${...}`; описанное `date` лежит на :411 (сдвиг −5) |
| F-01 | `production.ts:273` | да | да | `occurredAt: now` |
| F-01 | `pile-journal-types.ts:232` | да | да | `export function periodBounds(` (фильтр периода журнала) |
| F-01 | `pile-journal-totals.ts:74` | да | да | `AND (` — блок фильтра по `occurredAt`, строки 79–85 используют `pw."occurredAt"` |
| F-02 | `production.ts:408–441` | да | да | блок простоя без проверки «сумма ≤ смены» |
| F-02 | `report-validation.service.ts:11–33` | да | да | `validateDowntimeWithinShift` |
| F-02 | `report.aggregate.ts:231` | да | да | `if (shiftHours && totalDowntime > shiftHours)` |
| F-03 | `report-command.service.ts:325` | да | да | `expectedVersion: input.expectedVersion ?? existing?.getState().version,` |
| F-03 | `report.repository.ts:163–166` | да | да | `reconcileReportEntries` + `group.model.deleteMany(...)` |
| F-03 | `validation-schemas.ts:252–256` | да | да | `version: z.number().int().nonnegative().optional()` с комментарием LWW |
| F-04 | `src/services/reports/audit-service.ts:99–109` | да | да | `function hashState(...)` — 32-битная хеш-свёртка на JS |
| F-04 | `append-audit.ts:35–40` | да | да | actor-поля + комментарий про ограничение БД цепочки |
| F-04 | `readiness/audit/route.ts:5` | да | да | `import { verifyAuditEvents } …` |
| F-05 | `report-event-types.ts:3` | да | да | `REPORT_UPDATED: 'ReportUpdated',` |
| F-05 | `event-handlers.ts:37,46,51,453` | да | да | регистрации на `REPORT_UPDATED` и `REPORT_VERSION_CREATED` |
| F-05 | `report.aggregate.ts:154,186,208,242,272` | да | да | эмиттеры Created/PileWorkAdded/DrillingAdded/DowntimeAdded/Submitted |
| F-05 | `delete/route.ts:117` | да | да | `createReportEvent(` внутри `saveToOutbox` |
| F-06 | `report.repository.ts:50–71,63,233` | да | да | `mapEventsToOutboxData`; `:63 payload: event.data || {}`; `:233` вызов |
| F-06 | `outbox-publisher.ts:124–137` | да | да | `looksLikeFullEvent` — логика неоднородного конверта |
| F-06 | `delete/route.ts:116` | да | да | `await saveToOutbox(tx, [` |
| F-06 | `projection-worker.ts:77` | да | да | `async function enrichReportEvent(` (модульный путь `.../projections/projection-worker.ts`) |
| F-07 | `scripts/audit-fix-tenancy.sql:18–40` | да | да | backfill `tenantId='orion'` + `SET NOT NULL` в цикле |
| F-07 | `20260924120100…/migration.sql:1–5` | да | да | комментарий про ручной скрипт мимо миграций |
| F-07 | `package.json:65` | да | да | `"db:apply-ddl": "npx tsx scripts/apply-full-ddl.ts"` |
| F-08 | `20260924120000_drop_refresh_token/migration.sql` | да | частично | файл есть; но это **`DROP TABLE "RefreshToken"`**, а не `DROP COLUMN` |
| F-08 | `20260913140000_drop_device_sync…/migration.sql` | да | да | `ALTER TABLE "DeviceSyncState" DROP COLUMN "lastAcceptedSequence"` |
| F-09 | `shift-close.ts:180–181` | да | да | `endingEngineHours` / `endingFuelPercent` заполняются при закрытии смены |
| F-09 | `upsert/route.ts:99–113` | да | да | веб-путь пишет только `addMeterReading`, поля отчёта не трогает |
| F-09 | `report-export.service.ts:366` | да | да | `r.endingFuelPercent ?? null` в выгрузке |
| F-09 | `mobile-shift-query.ts:646` | да | да | `fuelPercent: lastFuel?.endingFuelPercent ?? null` |
| F-10 | `rebuild.ts:187–196` | да | да | `rebuildReportAnalyticsForTenant` — `where: { tenantId }` без фильтра статуса |
| F-10 | `rebuild.ts:45–46` | да | да | `where: { tenantId, status: SUBMITTED_REPORT_STATUS }` (daily) |
| F-10 | `event-handlers.ts:216–217` | да | да | `where: { siteId, date, status: SUBMITTED_REPORT_STATUS }` |
| F-11 | `upsert/route.ts:69–88` | да | да | вызов `upsertReport(...)` |
| F-11 | `report-command.service.ts:280` | да | да | `aggregate.submit(` — `status:'draft'` всё равно сдаётся |
| F-11 | `validation-schemas.ts:251,283,284` | да | да | `status`; `comment`; `assistantReport` |
| F-12 | `report-validation.service.ts:38` | да | да | `const today = getTodayInTimezone();` |
| F-12 | `timezone.ts:21` | да | да | `getTodayInTimezone(timezone: string = 'Europe/Moscow')` |
| F-13 | `meter-reading.ts:265–289` | да | да | `deleteMeterReading` → `tx.meterReading.delete` (жёсткое, без audit-записи) |
| F-13 | `fuel-log.ts:134–148` | да | да | `deleteFuelEntry` → `db.fuelLog.delete` |
| F-14 | `production.ts:276,386,407,441` | да | да | `auditDiff = {'Выработка': {old: null, new: ...}}` |
| F-14 | `production-corrections.ts:32` | да | да | `{'Выработка': {old: before, new: after}}` |
| F-15 | `report-command.service.ts:95–98` | да | да | `validatePicketsBelongToSite(...)` вне транзакции |
| F-15 | `report-validation.service.ts:136` | да | да | `const pickets = await db.picket.findMany({` |
| F-16 | `report-validation.service.ts:210–215` | да | да | `client.pileWork.groupBy({ by: ['pileGradeId'], … })` |
| F-17 | `projection-worker.ts:26–38` | да | да | `const PROJECTABLE_EVENT_TYPES = new Set<string>([` |
| F-17 | `event-handlers.ts:449–453` | да | да | `registerAuditEventHandler` с мёртвыми типами |
| пр-е | `dictionary-service.ts:291–325` | да | да | `setPileGradeLength` — подтверждение пересчёта + запрет обнуления |
| пр-е | `prisma/schema.prisma:2277–2283` | да | да | снимок молота на момент забивки |
| пр-е | `delete/route.ts:73–139` | да | да | снимок+событие+аудит в одной транзакции |
| пр-е | `equipment-command.service.ts:59–121` | да | да | `deleteEquipment` блокирует удаление при истории |
| пр-е | `user-service.ts:330–366` | да | да | `deleteUser` блокирует удаление при отчётах/назначениях |
| пр-е | `validation-schemas.ts:275–280` | да | да | комментарий «простой в часах» + `duration: … max(DOWNTIME_MAX_HOURS)` |
| пр-е | `event-handlers.ts:314–320` | да | да | алерт по простою, порог в часах |
| пр-е | `report-query.service.ts:88–91` | да | да | комментарий «черновик в итоги не входит» |
| пр-е | `outbox-publisher.ts:169–232` | да | да | retry/backoff/DLQ |
| пр-е | `rebuild.ts:80–83` | да | да | транзакция wipe+createMany (daily) |
| пр-е | `rebuild.ts:164–167` | да | да | транзакция wipe+createMany (weekly) |
| охват | `src/lib/pile-length.ts` | да | да | файл существует |
| охват | `pile-journal-types.ts:232` | да | да | (см. F-01) |
| охват | `shared.ts:83` | да | да | `export function productionDateOf(timezone, now)` |
| охват | `validation-schemas.ts:280` | да | да | (см. F-11/примечания) |
| охват | `fuel-log.ts:79` | да | да | расчёт литров |
| охват | `downtime-hours.ts`, `format.ts` | да | — | файлы существуют |
| охват | `tenant-transaction.ts`, `shift-window.ts` | да | — | файлы существуют (`src/modules/readiness/infrastructure/…`, `src/modules/operator-mobile/domain/…`) |
| охват | `system-templates.ts` | да | частично | реальный путь `src/services/dictionaries/system-templates.ts`; в таблице охвата указан без каталога |
| охват | `src/lib/__tests__/pile-meters-invariant.test.ts` (+4 тест-файла) | да | да | все 5 файлов протокола существуют |

Итог числами: находок в реестре — **17**; полностью подтверждённых ссылок — **15 находок**;
с неточностями — **2** (F-01, F-08); ссылок на несуществующие строки файлов — **0**;
ссылок на несуществующие файлы — **0**. Миграций в каталоге: `ls prisma/migrations | wc -l` → **110**
(совпадает с протоколом AUDIT-STAGE6, п. 2).

## Находки

| # | серьёзность | path:line | проблема | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 1 | мелочь | `src/modules/operator-mobile/application/commands/shared.ts:406` | ссылка указывает на `reportId: RM-${...}`, а описанное `date = productionDate` — на `:411` | при перепроверке по ссылке :406 виден не тот факт; сдвиг −5 мог быть от другой версии файла | поправить ссылку на `:411` (или диапазон `:406–411`) |
| 2 | мелочь | `prisma/migrations/20260924120000_drop_refresh_token/migration.sql:6` | F-08 называет обе миграции удаляющими **колонки**, но эта — `DROP TABLE "RefreshToken"` | формулировка «схема меняется необратимо» верна, но «DROP COLUMN» неточен для одной из двух | уточнить в тексте: одна миграция удаляет таблицу, вторая — колонку |
| 3 | мелочь | таблица охвата AUDIT-STAGE6 (`system-templates.ts`) | путь без каталога | воспроизвести поиск по имени в `src/lib` нельзя — файла там нет | указать полный путь `src/services/dictionaries/system-templates.ts` |

## Не проверено

- **Семантическая верность самих находок** (что `occurredAt` действительно «уезжает» в
  следующий день у ночной смены, что RLS ведёт себя как описано и т. п.): проверено только
  наличие строки и её дословное содержание. Логика в рантайме и на реальных данных —
  НЕ ПРОВЕРЕНО (базы и браузера в этом прогоне нет).
- **Числа из «Протокола проверок» AUDIT-STAGE6** (165/185/76 тестов, 366 юнит-файлов, 11
  e2e-спеков): прогоны тестов не повторялись; сверено только число миграций (110) и
  существование 5 тест-файлов протокола. Остальные счётчики — НЕ ПРОВЕРЕНО.
- **Утверждение F-07 «скрипт нигде не вызывается»**: `grep` подтверждает отсутствие вызовов
  `audit-fix-tenancy` в CI/deploy (найдены только `package.json:65` и сам
  `scripts/apply-full-ddl.ts` — это другой скрипт, `db:apply-ddl`); полный обход всей обвязки
  деплоя (вне репозитория) — НЕ ПРОВЕРЕНО.
- **Примечания «не находки»** о CHECK-констрейнтах поправок и отсутствии FK у `ReportAudit`/
  `ReportVersion`: содержимое миграций `20260902010000_*`/`20260902020000_*` и FK-описаний
  схемы по строкам не сверялось в этом прогоне — НЕ ПРОВЕРЕНО.
- **F-04/F-05 — открытые вопросы владельца** (нужен ли отчётам tamper-evident журнал, как
  датировать ночную смену): ссылки верны, но решение за владельцем, не проверяется кодом.
