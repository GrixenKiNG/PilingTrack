# W25-BRANCH-SECURITY-REVIEW: проверка безопасности правок ветки q4-0926

Ревизия `git diff main...HEAD -- src` (67 файлов, 36 коммитов) взглядом атакующего.
READ-ONLY: изменялся только этот отчёт.

## Итог

- Найдено **6** замечаний: критично — **0**, важно — **1**, мелочь — **5**.
- Межорганизационной утечки (IDOR), обхода прав на данных, SQL-инъекции, XSS и открытого перехода **не найдено**. Подтверждено кодом и запросами к локальной БД.
- Топ-5:
  1. **[важно]** У `/api/pile-passports/export` нет ограничения частоты — выгрузка до 20000 строк собирается в памяти на каждый запрос (`export/route.ts:26`, `api-wrapper.ts:62`, `pile-passport.service.ts:175,640`).
  2. **[мелочь]** `ILIKE` в агрегатном запросе принимает номер сваи без экранирования `%`/`_` (`pile-passport.service.ts:263`); тот же фильтр в списке идёт через Prisma `contains` — расхождение титула и строк.
  3. **[мелочь]** `LEFT JOIN "Report"`/`"PilePassport"` без своего условия организации (`pile-passport.service.ts:293-294`) — сегодня закрыто строгим RLS (проверено), но это defense-in-depth.
  4. **[мелочь]** `?from=` на `/no-access` нигде не проставляется гвардами — параметр мёртв (`require-page-ability.ts:22`, `admin/layout.tsx:15`, `(readiness-admin)/layout.tsx:16`).
  5. **[мелочь]** Гвард страницы не учитывает режим «действую как» (`require-page-ability.ts:20`, `page-session.ts:27-31`) — оболочка раздела открывается, а API отвечает 403.
- Отдельно: на локальной БД живёт остаточная схема `tenant_dict_*` без RLS (см. находку 6).

## Методика

Что смотрел и как это повторить:

1. Объём правок:
   `git diff main...HEAD --name-only -- src`, `git diff main...HEAD --stat -- src`,
   `git log --oneline origin/main..HEAD`.
2. Точки, названные в задании: `src/modules/reports/application/queries/pile-passport.service.ts`,
   `src/app/api/pile-passports/route.ts`, `src/app/api/pile-passports/export/route.ts`,
   `src/app/api/pile-passports/[id]/decide/route.ts`, `src/lib/require-page-ability.ts`,
   `src/lib/routes.ts`, `src/app/(app)/no-access/page.tsx`, `src/app/(app)/admin/layout.tsx`,
   `src/app/(app)/(readiness-admin)/layout.tsx`, `src/app/(app)/monitoring/page.tsx`,
   `src/lib/use-ability.ts`, `src/app/api/analytics/sites/route.ts`,
   `src/services/auth/authorization-service.ts`, `src/core/api-wrapper.ts`,
   `src/core/security/tenant-rls.ts`, `src/core/security/tenant-context.ts`, `src/lib/page-session.ts`.
3. Поиск опасных паттернов по диффу:
   `git diff main...HEAD -- src | grep -nE "queryRawUnsafe|executeRaw|dangerouslySetInnerHTML|IS NULL OR|role ==="`.
   `$queryRawUnsafe`/`$executeRawUnsafe` в правках **нет**; `tenantId IS NULL OR` в правках **нет**.
4. RLS — по миграциям и на живой локальной БД (docker `pilingtrack-postgres`, БД `pilingtrack_test`, порт 5435).
   Запросы:
   `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('PileWork','Report','PilePassport','PileDrivingSet');`
   `SELECT tablename, policyname, qual FROM pg_policies WHERE tablename IN ('PileWork','Report','PilePassport','PileDrivingSet');`
   Проверка исполнением (роль приложения `pilingtrack_app`, без BYPASSRLS):
   `SET ROLE pilingtrack_app; SELECT count(*) FROM public."PileWork";` и далее с `set_config('app.current_tenant', …)`.
5. Права в маршрутах: читал `assertCan` до обращения к данным в каждом выгрузочном и журнальном маршруте.
6. Ограничение частоты: искал `middleware.*` (нет ни `src/middleware.ts`, ни корневого), читал `withApi`/`withMutation`.

Ключевые факты из проверок (сырые результаты):

- Локально `pg_class`: `PileWork|t|t`, `Report|t|t`, `PilePassport|t|t`, `PileDrivingSet|t|t` — RLS включён И форсирован.
- `pg_policies` (public): политики строгие, без оговорки «тенант не задан»:
  `("tenantId" = current_setting('app.current_tenant'::text, true))` на всех четырёх таблицах.
- Исполнение ролью `pilingtrack_app`:
  - GUC не выставлен → `count(*) "PileWork" = 0` (fail-closed);
  - `app.current_tenant = '__nonexistent__'` → `PileWork 0`, `Report 0`, `PilePassport 0`;
  - `app.current_tenant = 'orion'` → `PileWork 280`, `Report 269`, `PilePassport 10` (совпадает с раскладкой по тенантам у суперпользователя: `orion|280`).
- Ролью `postgres` (суперпользователь) политики **не** срабатывают (298 строк) — это ожидаемое поведение Postgres, а не дефект.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|----------|-----------|---------|---------------------------|---------------|
| 1 | важно | `src/app/api/pile-passports/export/route.ts:26` + `src/core/api-wrapper.ts:62` | GET-выгрузка идёт через `withApi`, а `withApi` частоту **не** ограничивает — лимит есть только у `withMutation` (`api-wrapper.ts:178-222`). Файла `middleware.*` в проекте нет. | Пользователь с `piles.manage` (ADMIN/DISPATCHER/FOREMAN) в цикле дёргает `/api/pile-passports/export` — на каждый запрос в памяти строится .xlsx до 20000 строк плюс лист залогов (`pile-passport.service.ts:175,640,764`). Это CPU/память одного процесса; при нескольких клиентах — отказ обслуживания. Право есть у трёх ролей. | Вешать на экспорт отдельный лимит (как `withMutation`, но без CSRF) либо кэш/дебаунс на пользователя; рассмотреть понижение `PILE_JOURNAL_EXPORT_LIMIT` под реальный размер. |
| 2 | мелочь | `src/modules/reports/application/queries/pile-passport.service.ts:263` | `p."pileNumber" ILIKE ${'%' + input.pileNumber + '%'}` — параметризовано (инъекции нет), но `%` и `_` из пользовательского ввода не экранированы. Списочный запрос фильтрует тем же полем через Prisma `contains` (`:331`). | Ввод `%` превращается в «любой хвост» — пользователь неявно расширяет выборку в пределах своей организации; ведущий `%` снимает индекс `PilePassport_tenantId_pileNumber_idx` → скан. Если Prisma экранирует `%` иначе, чем raw ILIKE, титул (агрегат) и строки разойдутся при одном и том же поиске. | Экранировать `%`,`_` (`replace` + `ESCAPE '\'`) либо искать по нормализованному номеру; привести оба запроса к одному способу фильтрации. |
| 3 | мелочь | `src/modules/reports/application/queries/pile-passport.service.ts:293-294` | В raw-агрегате `LEFT JOIN "Report" r ON r.id = pw."reportId"` и `LEFT JOIN "PilePassport" p ON p."pileWorkId" = pw.id` — без условия `r."tenantId"`/`p."tenantId"`. Списочный путь (`:345-358` include) устроен так же. | Утечки сейчас нет: обе присоединяемые таблицы под строгим форсированным RLS (проверено исполнением, см. «Методика»), а связь идёт по PK/FK, где коллизия id между тенантами практически невозможна. Замечание — про будущее: если RLS на `Report` когда-нибудь ослабят или FK будет нарушен ручной правкой, фильтр по `pw."tenantId"` сам JOIN не прикрывает. | Продублировать организацию в JOIN: `AND r."tenantId" = ${tenantId}` и `AND p."tenantId" = ${tenantId}` — нулевая цена, вторая линия. |
| 4 | мелочь | `src/lib/require-page-ability.ts:22`, `src/app/(app)/admin/layout.tsx:15`, `src/app/(app)/(readiness-admin)/layout.tsx:16` | Гварды делают `redirect('/no-access')` без `?from=`, но страница читает и печатает `from` (`no-access/page.tsx:29,41`). | Параметр всегда пуст, блок «Запрошенный адрес» никогда не показывается — заявленная в комментарии ценность не работает (единственный, кто передаёт `from`, — e2e `e2e/qa-ac/no-access.spec.ts:79`). Не уязвимость, а мёртвая ветка. | Либо передавать исходный путь (`/no-access?from=${encodeURIComponent(path)}`), либо убрать параметр вместе с блоком. |
| 5 | мелочь | `src/lib/require-page-ability.ts:20-22`, `src/lib/page-session.ts:27-31,73` | Гвард страницы считает право через `can(user, ability)`, но `PageSessionUser` не несёт `actingAs`; API-проверки `actingAs` учитывают (`authorization-service.ts:158-159`). | Администратор в режиме «Действую как механик» откроет оболочку раздела, куда механика пускать не должны: страница отрисуется, а каждый её API ответит 403. Данных не отдаёт (эскалации нет — `actingAs` только сужает), но экран и сервер отвечают по-разному. | Добавить `actingAs` в `PageSessionUser` (тем же способом, что в `lib/auth.ts`) и считать право по исполняемой роли. |
| 6 | мелочь | локальная БД: схема `tenant_dict_1782120416099_bc35e53b3ec27` | В схеме лежат копии `PileWork`, `Report`, `Site`, `PileGrade` и др. с `relrowsecurity = f` (RLS не включён вовсе). | Остаток прерванного прогона `tests/integration/tenant-dictionary-migration.spec.ts:20` (создаёт схему; `afterAll:86` её drop'ает — значит прогон упал). Роль приложения доступа не имеет: `SET ROLE pilingtrack_app; SELECT … FROM tenant_dict_…` → `permission denied for schema`. Кода, который бы в неё ходил, в репозитории нет (`grep` пуст). Практического риска на локальной БД нет; на проде существование такой схемы **не проверено**. | Удалить остаточную схему на локальной БД; убедиться, что на проде схем `tenant_dict_*` нет. |

## Проверено — без замечаний (перечень)

- **Право на журнал и выгрузку проверяется ДО чтения данных.** `assertCan(user, 'piles.manage')` стоит первой проверкой после `requireAuth`, до `listPilePassports`/`exportPileJournalXlsx`: `route.ts:34`, `export/route.ts:32`; в решении по свае — до `findFirst`: `[id]/decide/route.ts:29`. `piles.manage` = ADMIN/DISPATCHER/FOREMAN (`authorization-service.ts:71`). Организация — из сессии, `requireTenantId` отказывает 403 при пустом (`tenant.ts:27-31`).
- **Организация везде строгим равенством, без `IS NULL OR`.** Список: `pile-passport.service.ts:322`; агрегат: `:258`; решение: `:590`; сопоставление «кто принял»: `:375`. В правках шаблона `tenantId IS NULL OR` нет (проверено grep по диффу; тест `not.toContain('IS NULL OR')`).
- **SQL-инъекции нет.** Все параметры идут через `Prisma.sql`/шаблонные метки (`:258-296`); конкатенации пользовательского ввода в текст запроса нет; `$queryRawUnsafe`/`$executeRawUnsafe` не используются.
- **RLS на присоединяемых таблицах — включён, форсирован, строгий (fail-closed).** Подтверждено локально `pg_class`/`pg_policies` и исполнением ролью `pilingtrack_app` (см. «Методика»); источники политик — `prisma/migrations/20260903000000_rls_remaining_tables`, `20260905090000_pile_passport:62-65`, `20260914090000_pile_driving_set:38-41`, строгие для `Report` — `20260819120000_rls_fail_closed_all`. Сырой запрос тенанта не теряет: `wrapRawQuery` добавляет `set_config('app.current_tenant', …, true)` в ту же транзакцию (`core/security/tenant-rls.ts:198-211`).
- **`/no-access` — XSS и открытого перехода нет.** `from` выводится как текстовый потомок JSX (`page.tsx:41`) — React экранирует; в `href` не попадает. Кнопка ведёт на `roleHomeRoute(user.role)` (`:44`) — цель считается на сервере из роли, не из URL. Без сессии — `redirect('/login')` (`:27`). `roleHomeRoute` не содержит участка, куда можно подставить ввод.
- **`dangerouslySetInnerHTML` в правках — только статический CSS.** `briefing-journal-print.tsx:45,64` — константа `JOURNAL_PRINT_CSS`, пользовательских данных нет.
- **Выгрузка .xlsx — не CSV-инъекция.** Значения пишутся как inline-строки (`xlsx-writer.ts:80`), а не формулы; ведущий `=`/`+` Excel не исполняет.
- **Аналитика мастеру (W9).** Правка ветки — только показ блока на экране мониторинга по праву `analytics.read` (`monitoring/page.tsx:10`, `use-ability.ts:5-8`). Данные блока берутся из `/api/admin/equipment-analytics`, который требует то же `analytics.read` и берёт `tenantId` из сессии (`equipment-analytics/route.ts:14,26-36`) — экран и сервер согласованы. Отдельный `/api/analytics/sites` требует `sites.read_all` и жёстко фильтрует по `s."tenantId" = ${tenantId}` (`site-analytics-service.ts:168`); мастеру он отдаёт **всю организацию**, а не «его объекты» — это соответствует модели доверия (FOREMAN и SAFETY_ENGINEER — привилегированные/platform-роли, доступ к данным мастера есть только через исполнение роли администратором), но пообъектного сужения у него нет.
- **Обход гварда страницы через API — не проходит.** Гварды раскладок (`require-page-ability.ts`, `admin/layout.tsx`, `(readiness-admin)/layout.tsx`) — только UI; данные закрыты серверными `assertCan` в маршрутах. Понижение роли в клиентском сторе меняет лишь видимость блока, не доступ к данным.

## Не проверено

- **RLS на проде.** Проверял только локальную БД (`docker pilingtrack-postgres`, `pilingtrack_test`). Что прод-подключение идёт ролью без BYPASSRLS — по документации проекта (`scripts/app-role-grants.sql:5-8`: «прод переключён 13.08.2026»), а не по живому соединению. Роль, которой ходит приложение в локальный .env, я не читал (запрет на `.env`) — если локально это `postgres` (суперпользователь), локальные экраны RLS на себе не чувствуют; факт требует проверки на живой конфигурации.
- **Экранирование `%`/`_` в Prisma `contains`.** Документацию Context7 по этому вопросу получить не удалось; поведение Prisma `contains` (экранирует ли он метасимволы) не подтверждено кодом — отсюда формулировка находки 2 про «возможное расхождение», а не «расхождение точно есть».
- **Наличие схем `tenant_dict_*` на проде** и полнота картины по всем схемам, кроме `public`.
- **Живой DoS-тест** экспорта (реальная нагрузка 20000 строк) не запускал — оценка по коду (лимит строк, отсутствие частотного лимита), не по замеру.
- **Не читал и не менял**: `.env*`, `prisma/schema.prisma`, `prisma/migrations/**` (кроме чтения), `docker-compose*`, `scripts/deploy-*`, замороженные области (варианты экрана оператора, сайт ORION) — в них не заглядывал, кроме упоминаний в общем диффе.
