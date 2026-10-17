# N17-09-RECENT-DIFF-TENANT-RAW-SQL — изменения 15.10–17.10: tenantId, сырой SQL, права

- Ревизия: `git rev-parse HEAD` = `94732e82dedb28f058e8be4c1e1272735da0973b` (ветка `hermes/code-1011`).
- База сравнения: боевой `298f76aa`. `git diff 298f76aa HEAD --shortstat` = **177 файлов, +7434 / −596**.
- Проверяемые файлы приложения (src/ и prisma/, без тестов): **74** (`git diff … --name-only -- src prisma ":(exclude)*__tests__*" ":(exclude)*.test.*"` = 74 строки).
- Только чтение кода. Изменён/создан единственный файл — этот отчёт.

## Итог

- Найдено **0 критично**, **0 важно**, **11 мелочь/наблюдений**. Регрессов изоляции, «сырого» SQL и прав, которые ломают прод-сценарий, в диффе не обнаружено.
- Топ-1 (мелочь, но единственная асимметрия): `src/services/auth/resource-access-service.ts:50` — новая проверка владельца отчёта сужает по организации только ветку бригады; ветка `UserSiteAssignment` организации не проверяет вовсе.
- Топ-2…5: разночтение кода ответа 400/422 при закрытии наряда (`close/route.ts:16` против `commands.ts:326`); вводящий в заблуждение текст ошибки закрытия (`commands.ts:327`); удаление `prisma/indexes.sql` и `db:indexes` вопреки более раннему аудиту; `ALTER TYPE … ADD VALUE` в миграции (не проверена версия PostgreSQL).
- `pile-journal-totals.ts` — организация строгим равенством (`:74`), параметры шаблонные, вложенного `Prisma.sql` и `Unsafe` нет; изменён только `ESCAPE '\\'` (`:77`). ПРОЙДЕНО.
- `src/lib/auth-failure.ts` — корректен: 5xx от `requireAuth` → 503, остальное → 401, команда без проверенного пользователя не выполняется. ПРОЙДЕНО.
- Новые команды наряда (`close`) — валидация `safeParse` + `.strict()`, транзакция с `set_config('app.current_tenant')` и сверкой, CAS по `version`+`state`. ПРОЙДЕНО.

## Методика

Что и как искалось (чтобы можно было воспроизвести):

1. `git rev-parse HEAD`; `git diff 298f76aa HEAD --stat`; список коммитов `git log --oneline 298f76aa..HEAD`.
2. Изменённые исходники без тестов: `git diff 298f76aa HEAD --name-only -- src prisma ":(exclude)*__tests__*" ":(exclude)*.test.*"` (74 файла); построчный дифф по путям: `src/app`, `src/modules/readiness`, `src/modules/analytics`, `src/modules/system`, `src/modules/telemetry`, `src/modules/safety`, `src/modules/operator-mobile`, `src/workers`, `src/components/piling/to`, `src/services/auth`, `prisma`.
3. Сырой SQL по всему src: `git grep -c 'queryRaw' -- src`, `git grep -c 'executeRaw' -- src`; поиск опасных форм `git grep -n '\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.sql|Prisma\.raw'` по `src/**/*.ts` (11 совпадений — все разобраны).
4. Поиск запрещённого фильтра `tenantId IS NULL OR …` по `src/**/*.ts` (11 совпадений — все комментарии/тесты, кода-нарушителя нет).
5. Права на маршрутах: чтение адаптеров `withApi`/`withMutation`, `withReadinessCommand`, `resolveReadinessRequestContext`, `requireAuth`, `authFailureResponse`.
6. Отдельно открыты: итоги журнала свай, новый маршрут закрытия наряда и его команда/репозиторий/схемы, правка отчёта админом (коммит `f769518e`), `self-clearance-query.ts`, `briefing-commands.ts` и маршрут `sign`, `admission.ts`, `auth-failure.ts`.
7. Замороженные зоны (экраны оператора `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, сайт ORION) — только чтение; удалять/рефакторить не предлагаю.

Ключевые факты проекта, на которые опираются выводы (проверены в репозитории):

- RLS-расширение тенанта не перехватывает `$queryRaw` (`src/core/security/tenant-rls.ts:172`), поэтому тенант в сырых запросах задаётся вручную.
- `UserSiteAssignment` не имеет колонки `tenantId` (`prisma/schema.prisma:1920-1933`); `Crew` тоже (`:1870-1895`), но у связанных `Equipment`/`Site` `tenantId` есть.
- `requireAuth` отдаёт 401 (нет/невалидная сессия) и 500 (падение проверки), других 5xx-источников у него нет (`src/lib/auth.ts:158-212`).

## Таблица изменений (файл | что изменено | tenantId | сырой SQL | права | вывод)

| Файл (изменённый) | Что изменено | tenantId | Сырой SQL | Права | Вывод |
|---|---|---|---|---|---|
| `src/modules/reports/application/queries/pile-journal-totals.ts` | `ESCAPE '\'`→`ESCAPE '\\'` (`:77`) | `pw."tenantId" = ${input.tenantId}` (`:74`) | `$queryRaw`, только скаляры, без `Prisma.sql`/`Unsafe` | вызывается из защищённых экранов | ПРОЙДЕНО |
| `src/modules/reports/application/commands/report-command.service.ts` | `assertUserAssignedToSite`→`assertReportOwnerOnSite` (`:90`) | тенант отчёта проверяется в tx (`:158-164`) | есть advisory-lock `$executeRaw` (`:117`), шаблонный | «правка админом» (AU39-04) | ПРОЙДЕНО (см. находку №1) |
| `src/app/api/readiness/work-permits/[id]/close/route.ts` | новый POST закрытия | `withReadinessSerializableTransaction(context.tenantId)` (`:17`) | GUC в `tenant-transaction.ts:90` | `withReadinessCommand`→`withMutation` (CSRF), `safeParse` (`:15`) | ПРОЙДЕНО (находки №2,3,4) |
| `src/modules/readiness/application/permits/commands.ts` | команда `close`, `versionedAction` +`close` | `input.context.tenantId` везде (`:246`) | — | `assertPermitEditor` → `readiness.permit.edit` (`:219`) | ПРОЙДЕНО |
| `src/modules/readiness/infrastructure/permits/work-permit-repository.ts` | `close()` (`:265-273`) | `where {tenantId, id, version, state:APPROVED}` | — | требует `APPROVED`+`validFrom` | ПРОЙДЕНО |
| `src/modules/readiness/application/permits/schemas.ts` | `closeWorkPermitSchema` `.strict()` (`:75`) | — | — | — | ПРОЙДЕНО |
| `src/modules/readiness/application/scheduler.ts` | APPROVED→CLOSED(VALIDITY_ELAPSED), PENDING→EXPIRED, CAS по version | `where {tenantId,…}` (`:129`) | — | worker, `forEachTenant` | ПРОЙДЕНО |
| `src/modules/readiness/application/readiness-score.ts` | учитывает CLOSED, `permitCloseReason` | `permitScope.tenantId` (`:68`) | — | — | ПРОЙДЕНО |
| `src/modules/safety/application/self-clearance-query.ts` | отдача состояния 2-й отметки | `where {tenantId, userId}` (`:80`) | — | своих, по сессии | ПРОЙДЕНО |
| `src/modules/safety/application/briefing-commands.ts` | подпись работника/инструктора | `findFirst {id, tenantId}` (`:122`) | — | по участию в записи | ПРОЙДЕНО (находка №10) |
| `src/app/api/briefings/[id]/sign/route.ts` | (не менялся) кнопка подтверждения | `requireTenantId(actor)` (`:27`) | — | `withMutation`, только auth | ПРОЙДЕНО |
| `src/modules/operator-mobile/application/commands/admission.ts` | повтор = только запись с отметкой работника | `where {tenantId,…}` (`:163`) | — | — | ПРОЙДЕНО |
| `src/lib/auth-failure.ts` | новый 401/503-ответ на отказ auth | — | — | — | ПРОЙДЕНО |
| `src/app/api/{assistant,operator/mobile}/**/route.ts`, `admin/incidents` | переход на `authFailureResponse` | session | — | `withApi`/`withMutation`+роль (`:193`) | ПРОЙДЕНО |
| `src/modules/analytics/application/queries/*.ts` | перенос из `services/analytics` (переименование, 0 правок логики) | `s."tenantId" = ${tenantId}` (`site:168`), `e./r."tenantId"` (`equipment:78,122,134`) | `$queryRaw`, скаляры | вызывается из `admin/equipment-analytics` c `assertCan` | ПРОЙДЕНО (находка №9) |
| `src/modules/{telemetry,system}/index.ts` | фасады/реэкспорт | — | — | — | ПРОЙДЕНО |
| `prisma/migrations/20261015090000_work_permit_close/migration.sql` | `CLOSED`, `WorkPermitCloseReason`, 3 колонки | — | — | — | ПРОЙДЕНО (находка №7) |
| `prisma/indexes.sql`, `package.json` (`db:indexes`) | удалены | — | — | — | наблюдение (находка №6) |
| `src/app/api/readiness/work-permits/route.ts` | в белый список `state` добавлен `CLOSED` (`:42`) | — | — | `withApi` | ПРОЙДЕНО |

Замороженные зоны (`src/components/piling/operator-mobile/**`, `src/modules/operator-mobile/**` — новые `use-local-form-draft.ts`, `shift-thanks.tsx`, `checklist-screen.tsx` и т. п.) прочитаны выборочно как потребители, правок и предложений об удалении нет.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка | Статус |
|---|---|---|---|---|---|---|
| 1 | мелочь | `src/services/auth/resource-access-service.ts:50-54` | Ветка `UserSiteAssignment` не сужена организацией (`where {userId_siteId}`), тогда как ветка бригады сужена (`:56-65`). Аргумент `tenantId` в первой ветке не используется | Для `OPERATOR` недостижимо: пройти можно только по строке-назначению на объект чужого тенанта, которой в одностенантном проде нет. Для привилегированных ролей — «риск до арендатора №2» (владелец: ADMIN/DISPATCHER видят все тенанты намеренно). Асимметрия противоречит принципу «тенант отказывает закрыто» | В первой ветке дополнительно сверять, что `site.tenantId === tenantId` (или искать назначение вместе с `site: {tenantId}`) | ПРОЙДЕНО / эксплуатируемость ГИПОТЕЗА |
| 2 | мелочь | `src/app/api/readiness/work-permits/[id]/close/route.ts:16` vs `src/modules/readiness/application/permits/commands.ts:326` | Одна и та же схема закрытия разбирается дважды; маршрут отдаёт 400, команда — 422 | Клиент/тесты вынуждены ожидать разные коды на одну ошибку валидации; ломает контракт «422 = некорректные данные» у прочих нарядных маршрутов (`approve/route.ts:16`) | Оставить одну точку валидации и один код (422), либо согласовать коды | ПРОЙДЕНО |
| 3 | мелочь | `src/modules/readiness/application/permits/commands.ts:327` | Любой провал схемы закрытия даёт текст «Комментарий должен быть не длиннее 500 символов», даже когда причина — `expectedVersion` | Сообщение уведёт пользователя не туда; ранее в этом же файле причина отказа разобрана отдельно (`:263-264`) | Разбирать `parsed.error`, отдавать общее «Некорректные данные закрытия» с `fieldErrors` | ПРОЙДЕНО |
| 4 | мелочь | `src/app/api/readiness/work-permits/[id]/close/route.ts:23` | У маршрута закрытия нет `rateLimit`-опции; у `approve` она задана (20/мин) | Смягчено: `withMutation` даёт дефолт `MUTATION_RATE_LIMIT` 100/мин (`src/core/api-wrapper.ts:170,213`). Дыры нет, но режим действий с нарядом разъезжается | Если закрытие — «редкое и важное», задать тот же лимит, что у `approve` | ПРОЙДЕНО (не дыра) |
| 5 | мелочь | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:267-268`, `commands.ts:243` | Проверка `validFrom <= closedAt` и запрет «срок ещё не начался» — вне транзакции записи проверка не повторяется | Между проверкой и `updateMany` `validFrom` теоретически может измениться правкой наряда; `updateMany` по `validFrom` всё же ограничивает (`:268`), поэтому промах маловероятен | Не критично; при желании вынести проверку в CAS-условие репозитория | ГИПОТЕЗА |
| 6 | наблюдение | `prisma/indexes.sql` (удалён), `package.json` (удалён `db:indexes`) | Удалён ручной скрипт индексов и npm-скрипт | Индексы `Report` присутствуют в схеме (`prisma/schema.prisma:1987-1991`), т. е. набор не потерян; но более ранний аудит (в этой же ветке, `docs/audits/codex-t21.md:127`) прямо рекомендовал **не удалять**. Разногласие двух аудитов стоит зафиксировать решением владельца | Оставить удаление или восстановить файл с пометкой «устарел» — на усмотрение владельца | ПРОЙДЕНО (факт) / решение за владельцем |
| 7 | наблюдение | `prisma/migrations/20261015090000_work_permit_close/migration.sql:3` | `ALTER TYPE "WorkPermitState" ADD VALUE 'CLOSED'` в миграции | На PostgreSQL ≥ 12 допустимо в транзакции (значение в той же транзакции не используется, и оно не используется — `:2`). Тот же приём уже в 3 миграциях репозитория (`git grep -l "ALTER TYPE" -- prisma/migrations`) | Проверять версию PG при деплое; для PG < 12 приём не сработает | НЕ ПРОВЕРЕНО (версия PG) |
| 8 | мелочь | `src/modules/reports/application/commands/report-command.service.ts:90` | Проверка владельца вызывается до транзакции с advisory-lock; внутри tx (по найденной записи) перепроверяется только владелец/тенант/дата-объект, но не бригада/назначение | TOCTOU: бригада оператора может быть деактивирована между проверкой и записью; последствие — одна запись от только что снятого с бригады машиниста. Тенант-изоляция не страдает | Не критично; при желании перенести `assertReportOwnerOnSite` внутрь `$transaction` | ГИПОТЕЗА |
| 9 | наблюдение | `src/modules/analytics/application/queries/site-analytics-service.ts:106-155` | Подзапросы `rc/p/d/dt/d_all` собирают «Report/PileWork/…» без собственного фильтра организации; сужение — только внешним `s."tenantId" = ${tenantId}` и join по `siteId` | Утечки нет: `siteId` — id объекта, а внешний отбор задаёт тенант. Но при копировании SQL легко потерять единственный барьер (это уже ловил тест-«охранник» в `__tests__`). `equipment-analytics-service.ts` такой же: тенант в CTE `rep` (`:78`) и во внешнем `e."tenantId"` (`:122`) | Добавить комментарий-предупреждение у подзапросов (как в `pile-journal-totals.ts:33`) | ПРОЙДЕНО |
| 10 | мелочь | `src/modules/safety/application/briefing-commands.ts:139-144` | `db.briefingRecord.update({where:{id}})` — без фильтра организации в самом `update` | Безопасно: запись предварительно прочитана с `{id, tenantId}` (`:121-122`), и `id` уникален. Асимметрия с правилом «тенант в where» заметна ревьюеру | Добавить `tenantId` в `where` или комментарий, что запись уже сужена | ПРОЙДЕНО (не дыра) |
| 11 | мелочь | `src/modules/reports/application/commands/report-command.service.ts:341-344` | Финальный `db.report.findUnique({where:{reportId}})` для ответа — без `tenantId` | **Не в этом диффе** (строка не менялась). Отчёт только что записан этим тенантом, поэтому утечки нет; но чтение «по reportId без тенанта» стоит держать в поле зрения | Не трогать в этом потоке; учесть при следующем аудите отчётов | ПРОЙДЕНО (предсуществующее) |

Мест, где проверка **отсутствует по существу**, немного и все — в списке выше: №1 (тенант в ветке назначения), №8 (повтор бригады внутри tx), №11 (тенант в финальном чтении). Ни одно не даёт межтенантной утечки в текущем одностенантном проде.

## Что не проверено

- Не запускались сборка/тесты/типы (`npx tsc`, `npm run build`, `vitest`, `playwright`) — задача только на чтение; числа в отчёте взяты из git-команд.
- Версия PostgreSQL в проде/локально не проверялась (находка №7); вывод «допустимо» опирается на документацию PG ≥ 12 и наличие такого же приёма в трёх существующих миграциях.
- Эксплуатируемость находки №1 и TOCTOU №8 не воспроизводились на стенде — статус ГИПОТЕЗА; для №1 нужен межтенантный набор данных, которого в одностенантном проде нет.
- Межтенантные проверки RLS на живой БД не проверялись (нет доступа к prod; правило проекта).
- Тела мобильных экранов в замороженных зонах (`src/components/piling/operator-mobile/**`, `src/modules/operator-mobile/**`) считаны выборочно — цель аудита (tenantId/сырой SQL/права) в них не найдена, полного ревью не было.
- Состав и корректность индексов после удаления `prisma/indexes.sql` относительно боевой БД не сверялись (`\di+` на живой БД не делался).
