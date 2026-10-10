# AU39-S2-CREW-ASSIGNMENTS — Бригады и назначения: правила связи техники, оператора и объекта

Аудит первого прохода, только чтение. Версия кода: `git rev-parse HEAD` = `e51a2355765e10258de812d3cd06cb19e41703eb`
(ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`). Существующие отчёты в `docs/audits/` не читались.

## Итог

- Правил закрепления бригады всего два «с железом»: одна установка = одна активная бригада
  (приложение + частичный уникальный индекс в БД) и «оператор заводит смену только на своей установке».
- Обратного правила «один оператор — одна бригада» больше НЕТ: с 20.08.2026 оператору можно
  закрепить список установок (несколько активных бригад на человека). Это задумано, не баг.
- Помощник без бригады невозможен структурно (CrewAssistant всегда принадлежит бригаде с оператором);
  обратное — помощник в НЕСКОЛЬКИХ бригадах и оператор без помощников — правилами не запрещено.
- Критичных находок нет. Важных — 4: правка бригады не сверяется с открытой сменой; перенос
  установки освобождает её даже при активной смене; бригада отчёта не сверяется с объектом отчёта;
  создание бригады не требует, чтобы оператор был назначен на объект бригады.
- Мелочей — 9 (пагинация, произвольная бригада в `/api/crews/my`, устаревшее сообщение об ошибке,
  игнорируемый `crewId` из тела запроса, дубли помощников, отсутствие tenant в двух проверках и др.).
- Все числа и `path:line` — из прочитанных файлов; команды приведены в разделе «Методика».

## Методика

Что и как искал (можно перезапустить):

```bash
git rev-parse HEAD                                  # e51a2355765e10258de812d3cd06cb19e41703eb
git status --short                                  # только "M AGENTS.md" (ничего не менял)
# карта кода: где вообще упоминается бригада
search_files pattern='Crew|crew' path=src  (полнотекст, 100 файлов)
search_files pattern='model Crew' path=prisma/schema.prisma
# миграции, задающие ограничения БД
for f in 20260820150000_crew_operator_many_rigs 20260624000000_crew_equipment_active_unique \
         20260622030000_crew_assistant_user_link; do cat prisma/migrations/$f/migration.sql; done
grep -n -i "unique\|CREATE INDEX\|WHERE" prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql
```

Прочитанные ключевые файлы (полностью): `src/modules/crews/**` (aggregate, command service,
repository, query service, command-схемы), `src/app/api/crews/**`, `src/modules/readiness/**`
(commands, shift-repository, handover, capabilities, access-matrix, capability-defaults,
operator-shift-query), `src/modules/operator-mobile/application/assistant-query.ts`,
`src/modules/reports/application/commands/report-command.service.ts`, `src/app/api/reports/upsert/route.ts`,
`src/app/api/reports/admin-upsert/route.ts`, `src/lib/validation-schemas.ts`,
`src/services/auth/resource-access-service.ts`, `src/services/users/user-service.ts`,
`src/components/piling/admin-crews/**`, `prisma/schema.prisma` (модели Crew, CrewAssistant, Shift,
Report, UserSiteAssignment).

Статусы: **ПРОЙДЕНО** — факт подтверждён чтением кода (файл открыт); **ГИПОТЕЗА** — вывод опирается
на допущение о поведении во время выполнения, отдельного теста нет; **НЕ ПРОВЕРЕНО** — не подтверждено.

## Правила закрепления (по коду)

| Правило | Где проверяется (файл:строка) | Ограничение в БД | Тест | Статус |
|---|---|---|---|---|
| Один оператор может вести НЕСКОЛЬКО бригад (список установок) | `prisma/schema.prisma:1862-1866` (комментарий), `createCrew` `src/modules/crews/application/commands/crew-command.service.ts:129-159` | уникального по `operatorId` НЕТ — индекс снят миграцией `20260820150000_crew_operator_many_rigs/migration.sql` (`DROP INDEX "Crew_operatorId_key"`); остался обычный `@@index([operatorId])` | `src/modules/crews/application/commands/__tests__/crew-command-service.test.ts:227` | ПРОЙДЕНО |
| Одна установка — одна АКТИВНАЯ бригада | `assertEquipmentNotDoubleBooked` `crew-command.service.ts:38-46`; вызовы при создании `:159`, при переносе `:257-259`, при реактивации `:284` | частичный уникальный индекс `Crew_equipmentId_active_unique` `prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql:1-4` (в `schema.prisma` не выражается) | `src/modules/crews/__tests__/crew-command.rules.test.ts:118,140,169` | ПРОЙДЕНО |
| Машинист бригады обязан иметь роль `OPERATOR` | `crew-command.service.ts:148` (создание), `:235` (правка) | на самого `Crew.operatorId` — нет; роль `User` ограничена CHECK-констрейнтом `prisma/migrations/20260730101000_readiness_mechanic_role/migration.sql:12-18` | `crew-command-service.test.ts:213-222` | ПРОЙДЕНО |
| Помощник — пользователь с ролью `ASSISTANT` из того же арендатора | `buildAssistantRows` `crew-command.service.ts:81-105` (фильтр `role: 'ASSISTANT'` `:88`, сверка тенанта `:94-98`) | нет (кроме FK `CrewAssistant.userId` → `User` ON DELETE SET NULL, `schema.prisma:1893-1894`) | `crew-command-service.test.ts:272-308` | ПРОЙДЕНО |
| Оператор, установка и объект бригады — ОДИН арендатор (якорь — объект) | `assertSameTenant` `crew-command.service.ts:65-75`; вызовы `:154-158`, `:250-254` | нет (тенант берётся из `Site`) | `crew-command.rules.test.ts:194-228` | ПРОЙДЕНО |
| Оператор открывает смену только на закреплённой за ним установке | `requireOperatorAssignment` `src/modules/readiness/infrastructure/shifts/shift-repository.ts:35-39`; вызов `src/modules/readiness/application/shifts/commands.ts:108-110` | нет (запрос к `Crew` с `operatorId+equipmentId+isActive`) | покрытие см. `src/modules/readiness/application/__tests__/operator-shift-query.test.ts` | ПРОЙДЕНО |
| Одна активная смена на установку (`STARTED`/`HANDOVER_PENDING`) | маппинг ошибки БД `shift-repository.ts:107-117` | частичный уникальный индекс `Shift_one_active_per_equipment_key` `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41` | — (теста не нашёл) | ПРОЙДЕНО по коду, тест НЕ ПРОВЕРЕН |
| Бригада отчёта фиксируется на момент СОЗДАНИЯ и не переписывается | `report-command.service.ts:230-273`; FK `Report.crewId` ON DELETE SET NULL `schema.prisma:1965` | FK на `Crew`, уникальности нет | — | ПРОЙДЕНО |
| Оператор сдаёт отчёт только на назначенном ему объекте | `assertUserAssignedToSite` вызов `report-command.service.ts:90`, реализация `src/services/auth/resource-access-service.ts:19-28` | `UserSiteAssignment @@unique([userId, siteId])` `schema.prisma:1918` | — | ПРОЙДЕНО |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/modules/crews/application/commands/crew-command.service.ts:211-338` | `updateCrew` (правка оператора/установки/объекта/состава) НЕ обращается к таблице `Shift` вообще | Изменение бригады после старта смены ничем не ограничено: меняют оператора/установку/объект — открытая смена продолжает жить со старым `startedById` (`prisma/schema.prisma:1096`), отчёты — со старой `crewId`. Явного запрета «нельзя править бригаду при идущей смене» нет | Решить владельцем: либо запрет правки при наличии смены в `STARTED`/`HANDOVER_PENDING`, либо явный «перевод» смены на нового оператора | ГИПОТЕЗА (отсутствие проверки — факт; поведение среднего состояния тестом не покрыто) |
| 2 | важно | `src/modules/crews/application/commands/crew-command.service.ts:256-259` | При переносе бригады на другую установку старая освобождается немедленно; проверка смотрит только на занятость НОВОЙ | Установку с АКТИВНОЙ сменой можно перевести на бригаду B (частичный индекс снимется), и B закрепится за машиной, на которой ещё идёт смена другого оператора. Смен две одновременно индекс не даст, но владелец машины в справочнике разъедется со сменой | Перед сменой `equipmentId` проверять, нет ли по старой установке смены `STARTED`/`HANDOVER_PENDING` | ГИПОТЕЗА |
| 3 | важно | `src/modules/reports/application/commands/report-command.service.ts:238-259` | Бригада отчёта выбирается из бригад ОПЕРАТОРА и не сверяется с `input.siteId` отчёта | Отчёт на объект S может получить `crewId` бригады другого объекта T (если оператор в нескольких бригадах и активная смена идёт по машине объекта T). Аналитика по бригадам отнесёт выработку не туда | Сверять `operatorCrew` с `input.siteId`; при расхождении писать `null` | ГИПОТЕЗА |
| 4 | важно | `src/modules/crews/application/commands/crew-command.service.ts:129-159` | `createCrew` не проверяет, что оператор назначен на объект бригады (`UserSiteAssignment`) | Администратор заводит бригаду на объект, куда оператор не назначен: бригада существует, машина закреплена, но сдать отчёт оператор не может — `assertUserAssignedToSite` даст 403 (`report-command.service.ts:90`). Противоречие «бригада есть — работать нельзя» | Либо требовать назначение оператора на объект при создании бригады, либо предупреждать в UI | ПРОЙДЕНО (проверка отсутствует; последствие — по коду) |
| 5 | мелочь | `src/modules/crews/application/queries/crew-query.service.ts:26-27` | Пагинация: `orderBy: { name: 'asc' }` вместе с `cursor: { id }` | Курсор должен опираться на то же (уникальное) поле, что и порядок. При сортировке по не уникальному `name` страницы могут пропускать/дублировать бригады-тёзки |Сортировать по `[name, id]` и курсор по обоим, либо курсорить по `name` | ПРОЙДЕНО |
| 6 | мелочь | `src/modules/crews/application/queries/crew-query.service.ts:68-81` | `getCrewForOperator` использует `findFirst` без сортировки по `OR`(operatorId или assistant) | У оператора с несколькими бригадами `/api/crews/my` вернёт произвольную (обычно первую по внутреннему порядку). Экран, полагающийся на неё как на «мою бригаду», покажет случайную | Отдавать список (`options` уже есть в мобильном модуле) или явно выбирать по активной смене | ПРОЙДЕНО |
| 7 | мелочь | `src/modules/crews/application/commands/crew-command.service.ts:184-186` | Catch ловит `'UNIQUE'`/`'unique'` и отдаёт «Бригада с этим машинистом уже существует» | Единственный оставшийся уникальный индекс — по `equipmentId`, поэтому текст вводит в заблуждение. Ошибка Prisma `P2002` («Unique constraint failed…») не содержит ни `UNIQUE`, ни `unique` → при гонке вернётся общий 500 «Не удалось создать бригаду» вместо 409 | Отдельно обработать `P2002` по `Crew_equipmentId_active_unique` и переписать текст под установку | ПРОЙДЕНО |
| 8 | мелочь | `src/lib/validation-schemas.ts:241,414` против `src/app/api/reports/upsert/route.ts:69-85` и `src/app/api/reports/admin-upsert/route.ts:45-62` | Поле `crewId` принимается схемой отчёта (и админской), но в `upsertReport` не передаётся | Клиент/админ может прислать `crewId` — он молча отбрасывается; бригада всегда выводится сервером. Схема обещает поле, которого на записи нет | Убрать `crewId` из схемы либо честно обрабатывать его | ПРОЙДЕНО |
| 9 | мелочь | `prisma/schema.prisma:1886-1902` | У `CrewAssistant` нет уникальности `(crewId, userId)`; ветка свободных имён не дедуплицируется (`crew-command.service.ts:101-104`) | Повторный помощник (или одинаковое свободное имя) может попасть в состав дважды; счётчик помощников завышен | Добавить `@@unique([crewId, userId])` и дедуп имён | ПРОЙДЕНО |
| 10 | мелочь | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:35-39,47-53` | `requireOperatorAssignment` и `crewOperatorId` ищут бригаду по `operatorId/equipmentId` без `tenantId` | При (нештатных) данных бригада/оператор чужого арендатора могли бы повлиять на выбор оператора смены | Добавить tenant-скоуп (для `crewOperatorId` он есть у вызывающего) | ПРОЙДЕНО |
| 11 | мелочь | `src/lib/validation-schemas.ts:228-231` | `crewAssignSchema` (`crewId`+`siteId`) объявлен и не используется нигде (поиск по `src` даёт только объявление) | Мёртвая схема; «перевод бригады на объект» идёт общим `PUT /api/crews/:id`, что и делает находку №1 возможной | Удалить либо завести отдельный маршрут перевода с проверками | ПРОЙДЕНО |
| 12 | мелочь | `prisma/schema.prisma:1873` | `Crew.operator` имеет `onDelete: Cascade` | Прямое удаление оператора унесло бы и строку бригады (жёстко, вопреки мягкому удалению). Сейчас прикрыто проверкой `deleteUser` (`src/services/users/user-service.ts:351-353`, блокирует при непустом `crews`) | Сменить на `Restrict`/`SetNull` при следующей допустимой миграции | ПРОЙДЕНО (сейчас не воспроизводится — прикрыто на уровне сервиса) |
| 13 | мелочь | `src/modules/readiness/domain/shifts/handover.ts:47-49` | Самоприёмка передачи разрешена (решение владельца 27.08.2026) | Сдал и принял один и тот же оператор; фиксируется признаком `selfAccepted`, но в правилах «бригада/смена» это послабление, из-за одной активной бригады на машину | Вне рамок задачи; отмечаю как известное послабление | ПРОЙДЕНО |

## Сценарии, не покрытые правилами

1. **Замена оператора посреди смены.** Команды «передать смену другому оператору» нет. `updateCrew`
   (`crew-command.service.ts:263-265`, `assignOperator`) меняет `Crew.operatorId` мгновенно, а смена
   хранит `startedById`/`startedAt` (`schema.prisma:1095-1096`) и не обновляется. Следующая смена
   подхватит уже нового оператора (`crewOperatorId`, `shift-repository.ts:47-53`). — ГИПОТЕЗА.
2. **Изменение бригады после старта смены.** Правила нет (находка №1). Правки проходят молча. — ГИПОТЕЗА.
3. **Перевод техники на другой объект.** Меняется только `Crew.siteId` (через `PUT /api/crews/:id`).
   Смена привязана к установке (`Shift.equipmentId`, `schema.prisma:1084`), объект — на отчёте
   (`Report.siteId`). Ничто не мешает «перевести» установку с активной сменой. — ГИПОТЕЗА.
4. **Перенос бригады освобождает занятую установку** при активной смене (находка №2). — ГИПОТЕЗА.
5. **Оператор в бригаде, но не назначен на объект бригады** → не может сдать отчёт (находка №4). — ПРОЙДЕНО.
6. **Отчёт может сослаться на бригаду другого объекта** (находка №3). — ГИПОТЕЗА.
7. **`crewId` из тела запроса игнорируется** (находка №8). — ПРОЙДЕНО.
8. **Помощник в нескольких бригадах** — разрешено (нет ни уникальности, ни проверки). Отражение —
   экран помощника `src/modules/operator-mobile/application/assistant-query.ts:68-82` перечисляет все его бригады. — ПРОЙДЕНО.
9. **`/api/crews/my` возвращает одну произвольную бригаду** при нескольких активных (находка №6). — ПРОЙДЕНО.

## Не проверено

- Не запускал тесты, `tsc`, `lint`, `build` (задача — только чтение; регламент §6 AGENTS.md к аудиту
  не применялся). Соответствие поведения тестам оценивал по их исходникам, не по прогону.
- Не проверял реальные данные: не запускал `npm run db:generate`, не подключался к БД, не смотрел,
  нет ли в проде двух активных бригад на одну установку (миграция `20260624000000` это ловит на
  постфактум, deploy-урок в скилле `piling-domain-reference` §9).
- Теста на уникальность активной смены (`Shift_one_active_per_equipment_key`) не нашёл; существование
  ограничения подтверждено только SQL миграции, поведение под гонкой не воспроизводил.
- Находки №1–3 и §«Сценарии» 1–4, 6 — рассуждение о времени выполнения по чтению кода; отдельного
  теста/репро нет, статус умышленно «ГИПОТЕЗА».
- Кросс-тенантную модель не пересматривал: по решению владельца ADMIN/DISPATCHER видят все арендаторы,
  а проверки `assertSameTenant`/`requireTenantCrew` закрывают запись. Отдельного IDOR не искал.
- Навык `piling-domain-reference` §9 утверждает «`Crew.operatorId @unique`» — это устарело (снято
  20.08.2026); код и схема расходятся со скиллом, скилл я не правил (вне задачи).
- Значение строк проверял по прочитанным файлам; строки в таблицах соответствуют выведенным
  `read_file` номерам на версии `e51a2355`.
