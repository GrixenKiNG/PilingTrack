# AU115-S6-TEST-RISK-GAPS: покрытие тестами по риску — 20 самых слабых мест

Версия (git rev-parse HEAD): `fe72f91055afb051f565c7d8308244502d9bdf43`
Ветка: `hermes/q4-0926`. Строка сгенерирована командой `git rev-parse HEAD` от 2026-10-11.
Аудит только по чтению кода; файлы приложения не менялись.

## Итог

- Всего непустых файлов-тестов в репозитории: unit 366 (`src/**/*.test.ts(x)`), contract 9, integration 20, e2e 11 — посчитано командами (ниже в «Методике»). Это заметно больше «150 unit» из skill pilingtrack-testing-and-evidence (снимок 2026-07-08): набор тестов вырос.
- Карта модулей: 251 файл исходников в `src/modules` + `src/services`; 184 из них подключены хотя бы одним тестом (прямо или через barrel/реэкспорт), 67 — нет ни одним тестом.
- Самый слабый по риску: `src/modules/readiness/infrastructure/permits/work-permit-repository.ts` — репозиторий наряд-допусков (права/смена) без прямого теста; проверки прав (`403`, `404`) живут в нём и ни разу не исполняются тестом.
- Составлены 20 самых рискованных файлов (деньги/данные/права/смена) без прямого теста: **критично 9, важно 9, мелочь 2**.
- Единственная денежная колонка приложения (стоимость наряда ТО) — в `src/modules/equipment/application/commands/equipment-maintenance.ts`, у неё тест ЕСТЬ; отдельного финанс/зарплата-модуля в коде нет.

Топ-5 из таблицы (по риску):
1. `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:61` — права/наряд-допуск.
2. `src/modules/readiness/application/defects/commands.ts:56` — фиксация/разбор дефектов, проверка права `403`.
3. `src/modules/readiness/application/readiness-score.ts:18` — расчёт готовности (гейт старта смены), без теста.
4. `src/modules/safety/application/equipment-permits.ts:114` — выдача/удаление допуска к технике, `403`+`404`.
5. `src/modules/readiness/infrastructure/shifts/shift-repository.ts:15` — репозиторий смен, проверка «установка за вами не закреплена».

Статусы: всё в таблице ниже — ПРОЙДЕНО (файл открыт, строки взяты из вывода команд). Гарантии отсутствия теста — по методике ниже (скрипт-резолвер + текстовый поиск).

## Методика (воспроизводимо)

Все числа получены командами из корня `D:/PillingR/wt-night`. Полные пути в таблицах указаны от корня репозитория.

1. Число исходников и тестов по модулю/сервису:
   `for d in src/modules/*/ src/services/*/; do find "$d" -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/__tests__/*' ! -name '*.test.*' ! -name '*.spec.*' | wc -l; ... done`
2. Число тестов всего: `find src -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l` (366);
   `ls tests/contract/*.spec.ts | wc -l` (9); `ls tests/integration/*.spec.ts | wc -l` (20); `ls e2e/*.spec.ts | wc -l` (11).
3. Карта «есть ли прямой тест»: скрипт на node (в scratch, не в репозитории) парсит `import`/`require`/`import()` и `export ... from` во всех тестах `src/**` и `tests/**`, резолвит `@/` и относительные пути в файл, транзитивно разворачивает barrel-реэкспорты и строит множество «файл исходника -> тесты, которые его подключают». `vi.mock('...')` НЕ считается тестом (мок доказывает обратное — реальный код не исполняется). Результат: 184 с тестом, 67 без.
4. Проверка «без прямого теста» дублирована текстовым поиском (`grep -rl <ИМЯ> src tests --include='*.test.ts' --include='*.test.tsx' --include='*.spec.ts'`) — совпадает со скриптом. Совпадения только в комментариях (`defects/commands.ts` в `audit-labels.test.ts:10`) и `vi.mock` (`@/lib/cache-strategies`, `@/lib/xlsx-writer`) отброшены.
5. Наличие тестов на отказы/права по каталогу:
   `grep -rlE "403|Недостаточно прав|Forbidden|Unauthorized|toThrow|rejects" <dir> --include='*.test.ts' --include='*.test.tsx' | wc -l` против общего числа тестов в каталоге.
6. Порог покрытия (ratchet) — из `vitest.config.ts`: `lines: 24, statements: 23, functions: 19, branches: 19` (`vitest.config.ts:thresholds`).

## Карта: src/modules и src/services

Источник чисел — команды из «Методики» п.1-2, п.5. «Тесты на отказ/права» — сколько тестов каталога содержат маркеры `403`/`Недостаточно прав`/`toThrow`/`rejects`.

Модули (`src/modules`):

| Модуль | исходники | тесты | тесты/исходники | из них на отказ/права |
|---|---|---|---|---|
| analytics | 1 | 0 | 0.00 | 0/0 |
| crews | 12 | 5 | 0.42 | 5/5 |
| equipment | 21 | 11 | 0.52 | 9/11 |
| inspections | 12 | 9 | 0.75 | 5/9 |
| layout | 5 | 1 | 0.20 | 1/1 |
| monitoring | 3 | 2 | 0.67 | 1/2 |
| operator-mobile | 38 | 10 | 0.26 | 7/10 |
| readiness | 72 | 21 | 0.29 | 10/21 |
| reports | 27 | 10 | 0.37 | 9/10 |
| safety | 7 | 3 | 0.43 | 1/3 |
| settings | 3 | 2 | 0.67 | 1/2 |
| sites | 13 | 7 | 0.54 | 6/7 |
| system | 1 | 0 | 0.00 | 0/0 |
| telemetry | 1 | 0 | 0.00 | 0/0 |
| users | 1 | 0 | 0.00 | 0/0 |

Сервисы (`src/services`):

| Сервис | исходники | тесты | тесты/исходники | из них на отказ/права |
|---|---|---|---|---|
| analytics | 2 | 2 | 1.00 | 2/2 |
| audit | 2 | 2 | 1.00 | 2/2 |
| auth | 4 | 5 | 1.25 | 2/5 |
| dictionaries | 3 | 2 | 0.67 | 1/2 |
| feedback | 1 | 0 | 0.00 | 0/0 |
| notifications | 1 | 1 | 1.00 | 1/1 |
| reports | 7 | 3 | 0.43 | 3/3 |
| system | 1 | 0 | 0.00 | 0/0 |
| telegram | 1 | 1 | 1.00 | 1/1 |
| telemetry | 4 | 3 | 0.75 | 2/3 |
| tenancy | 1 | 1 | 1.00 | 0/1 |
| users | 5 | 2 | 0.40 | 2/2 |
| weather | 1 | 1 | 1.00 | 0/1 |

Замечания к карте:
- `modules/analytics`, `modules/system`, `modules/telemetry`, `modules/users` — это фасады-барели по 1 файлу (`src/modules/users/index.ts` — 39 строк); реальный код живёт в `src/services/*` и там тестируется. Ноль тестов внутри каталога здесь не означает «нет покрытия».
- Два «нулевых» сервиса с реальным кодом: `src/services/feedback` (файл `src/services/feedback/feedback-event-service.ts`, 281 строка, 0 тестов) и `src/services/system` (`src/services/system/system-service.ts`, 74 строки, 0 тестов).
- Низкая доля у `modules/readiness` и `modules/operator-mobile` объяснима: значительная часть их тестов лежит не в модуле, а рядом с экранами (`src/components/piling/to/**`, `src/components/piling/operator-mobile/**`) и в `tests/integration/tech-readiness-*.spec.ts` — в таблице они не учтены по каталогу модуля.

## Находки: 20 самых рискованных файлов без прямого теста

Колонка «Тест» = результат резолвера (п.3) — во всех строках это «нет ни одного теста ни напрямую, ни через barrel».

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая починка |
|---|---|---|---|---|---|
| 1 | критично | src/modules/readiness/infrastructure/permits/work-permit-repository.ts:61 | Класс `WorkPermitRepository` (наряд-допуск, 264 строки) без теста. Проверки `requireActor` (`403`), `requireEquipment`/`requireWorkType`/`requireUserName` (`404` — строки 58, 83, 97), `tenantTimezone` тут же | Проверка «актор активен и в своём тенанте» (`:62 tenantId, id: actorId, isActive`) — это граница прав; ошибка в `where` даёт допуск к наряду чужого/неактивного пользователя. Ни один тест этот файл не подключает | Добавить кейс в существующий `tests/integration/tech-readiness-work-permits.spec.ts`: `requireActor` неактивного/чужого актора бросает `403` |
| 2 | критично | src/modules/readiness/application/defects/commands.ts:56 | Команды дефектов (`create`/`triage`/`resolve`/`reject`, строки 116, 176, 198, 216) без прямого теста. Внутри — проверки права: `:56 'Нет права фиксировать дефекты'` и `:63 'Нет права разбирать дефекты'` | Дефект — предпосылка блокировки техники и наряда. Тест на право есть у соседних команд (напр. наряды в `tests/integration`), а у дефектов — нет; снятие/перестановка проверки не покраснеет | Один тест на отказ в `src/modules/readiness/application/defects/__tests__` (или в integration-спеке дефектов): роли без права → `403` |
| 3 | критично | src/modules/readiness/application/readiness-score.ts:18 | `evaluateAuthoritativeReadiness` (расчёт готовности, 223 строки) без прямого теста; `:95 throw new Error('Authoritative equipment row is unavailable')` — центральная ветка отказа | Готовность гейтит старт смены и допуск к работам. Перепутанный агрегат/порог здесь = техника стартует при дефекте или, наоборот, смена вечно заблокирована | Юнит-тест на `evaluateAuthoritativeReadiness`: нет строки техники → throw; запрет по дефекту/ТО → `allowed=false` |
| 4 | критично | src/modules/safety/application/equipment-permits.ts:114 | `upsertEquipmentPermit` (выдача допуска к технике) без теста; `:62`, `:114`, `:173` — проверки права на просмотр/выдачу/удаление (`403`), `:64/:116/:175` — `tenantId is required`, `:182` — `404` при удалении 0 строк | Допуск к технике — правовой факт ТБ. Ошибка в проверке `403` = выдача допуска без права; ошибка в `where` удаления = удаление чужого допуска | Тест на отказ: роль без права на `upsert`/`delete` → `403`; пустой `tenantId` → `400` |
| 5 | критично | src/modules/readiness/infrastructure/shifts/shift-repository.ts:15 | Класс `ShiftRepository` (смена, 162 строки) без теста. `:15 requireActor` (`403`), `:21 requireEquipment` (`404`), `:37 'Эта установка за вами не закреплена'` (`403`) | Здесь право «смена только на закреплённой технике». Регресс в `:37` = машинист ведёт смену на чужой/непривязанной установке. Ни один тест файл не подключает | Тест на `requireActorForEquipment` (или аналог): чужой `equipmentId` → `403` |
| 6 | критично | src/modules/readiness/infrastructure/shifts/handover-repository.ts:56 | `HandoverRepository` (передача смены, 83 строки) без теста: `accept` (`:56`), `rework` (`:64`), `resubmit` (`:45`) через `updateMany` с версией и состоянием | Передача смены — смена ответственности/охрана труда. `updateMany` с `version`+`state` — это и есть защита от двойного принятия (optimistic lock); без теста поломка вернёт двойной `accept` | Тест: повторный `accept` с тем же `version` → conflict; неверное состояние → конфликт |
| 7 | критично | src/modules/readiness/domain/capability-defaults.ts:52 | `ROLE_ABILITIES` (роль→способности готовности, 137 строк) без прямого теста. `:11 READINESS_ABILITIES`, `:42 READINESS_ROLE_LIST` | Карта прав по ролям. Правка матрицы тут не покраснеет — прямое варево эскалации прав. (Матрица `authorization-service` покрыта `tests/integration/authorization-boundaries.spec.ts`, а эта — нет) | Тест-снапшот `ROLE_ABILITIES` (как у authorization-boundaries): фиксирует матрицу |
| 8 | критично | src/modules/readiness/application/shifts/start-decision.ts:7 | `evaluateAuthoritativeShiftStart` (решение о старте смены, 58 строк) без теста. `:39 const allowed = evaluation.allowed || waiver !== null` — исключение по `waiver` | Точка, где `waiver` (отступление) обходит блокировки. Ошибка приоритета = старт при запрете. Рядом — `:32`/`:43` `updateMany` по `shiftId` | Тест: `allowed=false` и `waiver=null` → старт запрещён; `waiver≠null` → разрешён и записан снимок |
| 9 | критично | src/modules/readiness/application/projection/project-event.ts:26 | `projectReadinessEvent` (проекция outbox-событий готовности, 74 строки) без теста. `:41 'Readiness outbox event has no tenant'` | Outbox/проекция — известное слабое место (см. pilingtrack-architecture-contract). Ошибка тут = заявка на снимок готовности обрабатывается для не того тенанта/не проектируется | Тест: событие без `tenantId` → throw; успешная проекция создаёт снимок |
| 10 | важно | src/modules/operator-mobile/application/commands/incidents.ts:30 | `reportIncident` (регистрация инцидента оператором, 166 строк) без прямого теста. `:57 withReadinessTenantTransaction`, `:58 requireOpenShift`, `:59 requireCrew`, `:62` идемпотентность по `clientCommandId` | Инцидент — это ТБ + тревога (`:119 enqueueAlert`). Соседние команды оператора (admission/production/checklist/shift-close) тесты имеют, а `incidents` — нет | Тест: `requireOpenShift` без открытой смены → ошибка; повтор с тем же `clientCommandId` не дублирует инцидент |
| 11 | важно | src/services/reports/audit-service.ts:29 | Сервис аудита отчётов (132 строки): `writeReportAuditRow` (`:29`), `recordAudit` (`:55`), `recordPostCommitAuditEvent` (`:81`) без теста | Аудит-след изменений отчёта. `recordAudit` (`:66 tenantId: record.tenantId || null`) допускает `null` — важно, чтобы это не стало молчаливым «без тенанта» на боевом пути | Тест: tenant-scoped запись проставляет `tenantId`; `null` — только явно системный путь |
| 12 | важно | src/services/users/user-document-access.ts:20 | Хелперы доступа к документам работника (88 строк): `assertCanRead` (`:20`, `403`), `assertCanWrite` (`:26`, `403`), `assertCanManageTypes` (`:73`, `403`), `requireAttachableMedia` (`:54`, `403`) — без теста | Чтение/изменение персональных документов. Хотя `user-documents.test.ts` покрывает соседний файл, эти `assert*` не исполняются тестом; смена условия = доступ к чужим документам внутри тенанта | Тест на `assertCanRead/Write`: свой vs чужой `targetUserId` → 403/ок |
| 13 | важно | src/modules/readiness/infrastructure/defects/defect-repository.ts:24 | `DefectRepository` (155 строк) без теста. `:34 requireActor` (`403`), `:27 requireEquipment` (`404`), `:43 requireRecord`, `:73 get` | Репозиторий дефектов; вместе с №2 закрывает «дефекты без отказов». Ошибка в `where` = чтение/правка дефекта чужой техники | Тест: `get` по чужому `equipmentId` → `404`, чужой актор → `403` |
| 14 | важно | src/modules/safety/application/briefing-commands.ts:48 | `conductBriefing` (`:48`) и `signBriefingRecord` (`:114`) без теста. `:56`/`:133` — `403`, `:71` `404`, `:73`/`:80` — `400` | Инструктаж ТБ — юридически значимое действие (`:90 userRole: employee.role`). Ошибка в `:133 'Подписать эту запись может только её работник или инструктор'` = подпись не тем лицом | Тест: подпись не-своим пользователем → `403`; инструктаж будущей датой → `400` |
| 15 | важно | src/modules/operator-mobile/application/assistant-query.ts:45 | `queryAssistantState` (161 строка) без теста. Строит состояние помощника по `tenantId` (`:52`, `:56`, `:71`, `:93`) | Чтение по нескольким коллекциям; ошибка в фильтре `tenantId`/`userId` = чужие смены/дефекты в выдаче (`:109 toDefectViews`) | Тест: запрос чужого тенанта не возвращает строк |
| 16 | важно | src/modules/readiness/application/backfill/backfill-service.ts:10 | `backfillTenantReadiness` (96 строк) без теста; `:8 READINESS_BACKFILL_BATCH_SIZE=200`, батч по `isActive` техники (`:26`), прогресс/complete/fail | Массовая запись данных готовности по всему тенанту. Ошибка = массово неверные снимки; сам процесс не под тестом | Тест на батч: N техник → N снимков, повтор не дублирует (progress-repository) |
| 17 | важно | src/modules/operator-mobile/domain/production-permit.ts:133 | `productionPermit` (`:133`), `productionBlocks` (`:66`), `productionRefusal` (`:139`) без теста | Доменное решение «можно ли вести выработку» (`:135 allowed = blocks.length===0`). Это гейт записей выработки; без теста — безопасный раньше, ломается тихо | Юнит-тест: набор блокеров → не разрешено + текст отказа |
| 18 | важно | src/modules/readiness/application/permits/queries.ts:31 | `queryWorkPermits` (`:31`) / `queryWorkPermit` (`:56`) без теста; `:24` разбор курсора, `:27` `400` | Чтение списка наряд-допусков с фильтрами и курсором по `tenantId` (`:38`). Ошибка фильтра = чужие наряды | Тест: фильтр по тенанту + неверный курсор → `400` |
| 19 | мелочь | src/services/telemetry/mqtt-ingestion-service.ts:1 | MQTT-ингест (208 строк) без теста | Спящий до подключения железа; в `vitest.config.ts` его дают исключать из coverage не просто так (п.3 skill). Риск отложенный, не боевой | Не заводить тест сейчас; вернуться при включении железа |
| 20 | мелочь | src/modules/operator-mobile/domain/view-contracts.ts:174 | `OperatorMobileState` и прочие контракты представления (294 строки, типы) без теста | Только типы: ошибка не в рантайме, а в рассинхроне контракта клиент↔сервер (сравните с замороженными `view-contracts`) | Контрактный снапшот формы при изменении; сейчас — наблюдать |

(В таблице ровно 20 строк — 20 риск-файлов: критично 9, важно 9, мелочь 2. Строка 19 — MQTT честно отнесён к «мелочь»: он спящий и намеренно исключён из coverage, но в списке «без теста» он присутствует.)

### Приложение A: остальные файлы `src/modules`/`src/services` без прямого теста

Всего без прямого теста — 67 файлов: 20 в таблице выше + 25 ниже + 22 бареля `index.ts`.
Числа — из скрипта «Методики» п.3; формат «строк файла путь от корня».

- 116 src/modules/inspections/domain/lubrication-maps.ts
- 99 src/modules/operator-mobile/domain/safety-checklist-period.ts
- 74 src/services/system/system-service.ts
- 72 src/modules/readiness/application/permits/schemas.ts
- 66 src/modules/readiness/application/defects/queries.ts
- 57 src/modules/operator-mobile/application/defect-views.ts
- 57 src/modules/sites/infrastructure/site.prisma.mapper.ts
- 52 src/modules/readiness/application/defects/schemas.ts
- 39 src/modules/readiness/domain/shifts/types.ts (`:29` контрактная строка, если правкой)
- 37 src/modules/operator-mobile/domain/defect-labels.ts
- 37 src/modules/readiness/application/command-pipeline/errors.ts
- 36 src/modules/operator-mobile/application/mobile-shift-commands.ts
- 33 src/modules/readiness/application/shifts/schemas.ts
- 31 src/modules/crews/application/commands/crew.command.ts
- 30 src/modules/sites/application/commands/site.command.ts
- 26 src/modules/readiness/infrastructure/audit/record-audit.ts
- 23 src/modules/reports/domain/shift-types.ts
- 20 src/modules/equipment/infrastructure/equipment.prisma.mapper.ts
- 17 src/modules/readiness/infrastructure/snapshots/outbox-repository.ts
- 16 src/modules/readiness/application/shifts/queries.ts
- 14 src/modules/readiness/application/projection/consumer.ts
- 9 src/modules/equipment/application/commands/equipment.command.ts
- 9 src/modules/readiness/application/command-pipeline/correlation.ts
- 6 src/modules/readiness/server.ts
- 4 src/modules/readiness/domain/evaluation/facts.ts

Барели без теста (не риск, перечислены для полноты — 22):
src/services/reports/index.ts, src/modules/reports/index.ts, src/modules/users/index.ts,
src/modules/safety/index.ts, src/modules/sites/index.ts, src/modules/crews/index.ts,
src/modules/reports/application/queries/index.ts, src/modules/telemetry/index.ts,
src/modules/operator-mobile/index.ts, src/modules/monitoring/index.ts,
src/modules/sites/application/commands/index.ts, src/modules/inspections/index.ts,
src/modules/reports/application/commands/index.ts, src/modules/system/index.ts,
src/modules/equipment/infrastructure/index.ts, src/modules/sites/infrastructure/index.ts,
src/modules/crews/application/commands/index.ts, src/modules/equipment/application/commands/index.ts,
src/modules/reports/application/index.ts, src/modules/crews/application/queries/index.ts,
src/modules/equipment/application/queries/index.ts, src/modules/sites/application/queries/index.ts.

Проверено отдельно (НЕ входят в «без теста», вопреки первому впечатлению):
`src/services/users/user-document-types.ts` (тест `src/services/users/__tests__/user-documents.test.ts`),
`src/services/feedback/feedback-event-service.ts` (подключается из `src/app/api/reports/single-pdf/__tests__/route.test.ts`),
`src/modules/reports/domain/report.events.ts`, `src/modules/crews/domain/crew.events.ts`,
`src/services/reports/report-history.ts` — у каждого есть подключение тестом.

## Что не проверено (не выдавать за факт)

1. **Фактический прогон тестов не выполнялся.** Не запускались `npm run test:unit`, `test:contract`, `test:integration`, `test:e2e`; числа «366/9/20/11» — это число ФАЙЛОВ тестов, а не пройденных кейсов. Реальный pass/skip не измерялся: интеграционные спеки гейтятся на `DATABASE_URL` и при его отсутствии молча пропускаются (см. `vitest.config.ts`, комментарий о `describe.skipIf`), а `.env` не читался (правило «не читать секреты»).
2. **«Без прямого теста» ≠ «нет покрытия».** Файлы могут исполняться косвенно через код, который тестируется (логика вызывается из покрытого вызывающего). Резолвер ловит только подключение файла тестом; транзитивное исполнение через вызывающего не анализировалось.
3. **Моки не считались тестом.** `vi.mock('@/lib/cache-strategies')` и `vi.mock('@/lib/xlsx-writer')` — реальный код этих файлов тестом не исполняется; если считать мок достаточным, они выпадут из «без тестов». Решение задокументировано в «Методике» п.3.
4. **Разделы `src/app/**` и `src/components/**` не картировались.** Задание просит карту модулей/сервисов; риск по маршрутам API и экранам здесь не считался. В приложении A к ним отсылок нет.
5. **История и «зачем так»** (например, почему `mqtt-ingestion` исключён из coverage, почему у `defects/commands` нет теста при тестах наряда) по коду не восстанавливается — это требует чтения `docs/strategy`/ADR, которые читать запрещено заданием. Любые такие объяснения — ГИПОТЕЗА, не факт.
6. **Проверка номеров строк**: `:56`, `:61` и т.п. — из вывода `grep -n`/`read_file` на момент `HEAD=fe72f910`; при дальнейших правках номера сдвинутся.
