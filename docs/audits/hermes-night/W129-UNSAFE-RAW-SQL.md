# W129 — небезопасные вызовы сырого SQL

## Итог

Проверены все точки сырого SQL в `src/`, `scripts/` и `prisma/` (без `node_modules`
и сгенерированного клиента `src/generated/**`). Небезопасных вызовов — **10**:
`$queryRawUnsafe` / `$executeRawUnsafe`. По severity: **критично — 0, важно — 1,
мелочь — 9**. Ни один не принимает данные из запроса пользователя (тело, query
string, заголовки) — все подставляемые значения либо константы, либо переменная
окружения под белым списком.

- `Prisma.raw(` — **0** вхождений в `src/`, `scripts/`, `prisma/` (единственные
  `.raw()` в репозитории — `scripts/crop-approved-icons.cjs:46,94`, это API
  библиотеки sharp, не Prisma).
- `$queryRaw(` / `$executeRaw(` с обычной строкой-переменной вместо тега — **0**.
  Единственный вызов со скобками (`idempotency-repository.ts:32`) передаёт
  `Prisma.sql\`...\``, то есть всё равно тегированный шаблон — безопасно.
- `prisma/` — вызовов сырого SQL нет (0); совпадения «raw» там только в
  данных сида (`seed.ts:440`) и комментарии миграции.

Топ-5:

1. **`src/core/security/identity-role.ts:65`** — единственный небезопасный вызов
   в рабочем коде: `$executeRawUnsafe(\`SET LOCAL ROLE "${role}"\`)`, где `role`
   из `process.env.DB_IDENTITY_ROLE` (там же `:32-43` проверяется regex
   `^[a-z_][a-z0-9_]{0,62}$`). Формально противоречит правилу AGENTS.md.
2. `scripts/explain-analyze.ts:116` — `$queryRawUnsafe(query.sql, ...query.params)`:
   текст SQL и массив параметров передаются переменными (из константного массива
   `QUERIES`, `:29-98`), это unsafe-форма с подстановкой.
3. `scripts/apply-postgres-hardening.ts:90,159,166` — три `$executeRawUnsafe(sql)`,
   текст собирается из констант (`idempotentAdd`, `:53-57`; массив
   `partialIndexes`, `:105-151`).
4. `scripts/apply-postgres-hardening.ts:199,227` — `$queryRawUnsafe` по системному
   каталогу `pg_class` и `$executeRawUnsafe('VACUUM ANALYZE')`, константы.
5. `scripts/app-role-smoke.ts:109,110,119` — DDL-проба прав на откатываемой копии,
   константы.

## Методика

GitNexus-граф для этого класса находок не применялся: сырой SQL вызывается через
обычный property-access (`db.$queryRaw`), который граф не разрешает, — подтверждение
шло текстовым поиском по рабочему дереву (`search_files`, ripgrep).

Область: `src/`, `scripts/`, `prisma/`; исключены `node_modules/**` и
`src/generated/**` (перезаписывается `npm run db:generate`).

Образцы поиска (каждый прогонялся отдельно):

- `\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(` — сами небезопасные вызовы;
- `\$queryRaw\s*[(<]|\$executeRaw\s*[(<]` — плоский вызов со строкой вместо тега
  (тег `` $queryRaw` `` под этот образец не попадает);
- `\.\$queryRaw|\$executeRaw` (count) — все точки сырого SQL, затем ручной разбор;
- `Unsafe` — всякое упоминание, чтобы не потерять динамические/алиасные имена;
- `\.raw\(|Prisma\.raw` — альтернативный способ вставки текста.

Каждая точка открыта (`read_file` / чтение диапазона) и разобрана: имя объемлющей
функции, откуда берётся подставляемое значение, есть ли условие по `tenantId`.
Тестовые файлы (`*.test.ts`, `__tests__/`) в подсчёт вызовов не входят — там моки
(`identity-role.test.ts:23,46`, `tenant-rls.test.ts:203` — это имена методов в
списке-страже `RAW_METHODS`, не вызовы).

Всего точек сырого SQL по данным подсчёта: в `src/` 137 совпадений (включая тесты,
строку-комментарий `db.ts` и список `RAW_METHODS` `tenant-rls.ts:174-176`);
в `scripts/` 14 (9 небезопасных + 5 тегированных). В `prisma/` — 0.

## Находки

Таблица — небезопасные вызовы. Столбец «функция» — объемлющая функция; «tenantId» —
наличие условия по организации в самом тексте запроса.

| # | severity | path:line | функция | что подставляется / откуда | tenantId | проблема / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|---|---|
| 1 | важно | src/core/security/identity-role.ts:65 | `withIdentityRole` | `role` из `process.env.DB_IDENTITY_ROLE`; проверяется regex `^[a-z_][a-z0-9_]{0,62}$` там же `:32-43` | н/п — это `SET LOCAL ROLE`, не запрос к таблице; фильтр организации к команде неприменим | **Средний риск.** Единственный `Unsafe` в рабочем коде; SQL склеен интерполяцией. Пользовательского ввода нет, но вся защита держится на regex переменной окружения. Прямо противоречит правилу AGENTS.md «никогда `$queryRawUnsafe`». `SET ROLE` не принимает плейсхолдеров, поэтому тегом не заменить — но можно валидировать имя роли на стороне СУБД (`quote_ident`/`regrole`) или заводить роль заранее фиксированным списком | Оставлять regex-барьер (перепроверен). Рассмотреть передачу имени роли через `SELECT set_config(...)` нельзя; безопаснее — таблица допустимых ролей или `WHERE rolname = current_user`; минимум — оставить комментарий `eslint-disable` с обоснованием, как того требует проект |
| 2 | мелочь | scripts/explain-analyze.ts:116 | `runExplainAnalyze` | `query.sql` (string) и `query.params` (any[]) из константного массива `QUERIES:29-98` | нет; EXPLAIN по срезам таблиц, значения тестовые (`'test-site'` и т.п.) | **Низкий риск.** Значения зашиты в скрипте, но форма вызова — unsafe именно с подстановкой переменных; если кто-то расширит `QUERIES` данными извне, инъекция появится молча. Dev-скрипт, требует БД | Переписать на `$queryRawUnsafe` → параметризацию нельзя (EXPLAIN с `$1` и `Prisma.sql` — можно): собирать через `Prisma.sql` с тегом, либо оставить с явной пометкой «значения только из констант» |
| 3 | мелочь | scripts/apply-postgres-hardening.ts:90 | `applyHardening` (цикл по `checkConstraints`) | `sql` из `idempotentAdd(table,name,check)` (`:53-57`), все аргументы — строковые константы в `:59-83` | нет; DDL (`ALTER TABLE ... ADD CONSTRAINT`), не строки тенанта | **Низкий риск.** Единственное место в репозитории, где текст запроса конкатенируется шаблоном, но все имена таблиц/констрейнтов/значений зашиты в скрипте | Оставить; при желании заменить сборку на фиксированные строки без шаблонной интерполяции |
| 4 | мелочь | scripts/apply-postgres-hardening.ts:159 | `applyHardening` (цикл по `partialIndexes`) | `sql` — элементы массива `partialIndexes:105-151`, константы | нет; DDL `CREATE INDEX`, не строки тенанта | **Низкий риск.** Константы | Оставить |
| 5 | мелочь | scripts/apply-postgres-hardening.ts:166 | `applyHardening` | `sqlWithoutConcurrent = sql.replace('CONCURRENTLY ','')` от той же константы | нет; DDL `CREATE INDEX` | **Низкий риск.** Константа, производная от константы | Оставить |
| 6 | мелочь | scripts/apply-postgres-hardening.ts:199 | `applyHardening` | константная многострочная строка (запрос к `pg_class`/`pg_policy`, `:199-207`) | нет; системный каталог, организации в нём нет | **Низкий риск.** Константа, пользовательских данных нет | Оставить (можно перевести на тег `$queryRaw` без параметров) |
| 7 | мелочь | scripts/apply-postgres-hardening.ts:227 | `applyHardening` | литерал `'VACUUM ANALYZE'` | нет; служебная команда обслуживания | **Низкий риск.** Константа | Оставить |
| 8 | мелочь | scripts/app-role-smoke.ts:109 | `main` | литерал `'CREATE TABLE "app_role_smoke_probe" (id int)'` | нет; DDL-проба прав на откатываемой копии (`:36-37`,`:19-20`) | **Низкий риск.** Константа; таблица создаётся тут же (`:110` её удаляет), контур тестовый | Оставить |
| 9 | мелочь | scripts/app-role-smoke.ts:110 | `main` | литерал `'DROP TABLE "app_role_smoke_probe"'` | нет; DDL-проба | **Низкий риск.** Константа, парна к `:109` | Оставить |
| 10 | мелочь | scripts/app-role-smoke.ts:119 | `main` | литерал `'DELETE FROM "_prisma_migrations" WHERE false'` | нет; системная таблица миграций, `WHERE false` не удаляет строк | **Низкий риск.** Константа; проверка, что роль не имеет прав на запись | Оставить |

Отсутствие условий по `tenantId` в строках 1–10 **проверено** и обосновано: все это
либо не запросы к тенантным таблицам (`SET ROLE`, системный каталог, `VACUUM`), либо
DDL (`ALTER TABLE`, `CREATE INDEX`, проба прав), где фильтр организации смысла не
имеет. Ни один вызов не читает и не меняет строки данных конкретного тенанта.

### Приложение A. Тегированные запросы без условия `tenantId` (низкий риск, не Unsafe)

Не входят в 10 выше — это безопасные по форме тегированные `$queryRaw`, но в их
тексте нет фильтра по организации. Разобраны, чтобы закрыть п.3 задания.
Все — блокирующие `FOR UPDATE` по `id`, за замком сразу идёт чтение/удаление с
условием организации, поэтому истинного межтенантного доступа нет; сам замок по
голому `id` теоретически может заблокировать строку чужого тенанта при совпадении id.

| # | severity | path:line | функция | tenantId | проблема / почему важно |
|---|---|---|---|---|---|
| 11 | мелочь | src/modules/equipment/application/commands/equipment-command.service.ts:64 | `deleteEquipment` | **нет** в тексте замка | `SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR UPDATE`; `equipmentId` — параметр функции. Следующее чтение `findUnique({id, tenantId})` (`:66-67`) отсекает чужую установку, но блокировка берётся до проверки |
| 12 | мелочь | src/modules/sites/application/commands/site-admin-command.service.ts:451-453 | `deleteSiteHierarchyItem` (ветка `field`) | **нет** в тексте замков | Замки `PileField`/`Cluster`/`Picket` по `itemId`; перед этим `requireTenantSite(siteId, ctx.tenantId)` (`:444`), следом `findFirst({id, siteId})` (`:454`) |
| 13 | мелочь | src/modules/sites/application/commands/site-admin-command.service.ts:465-466,477 | `deleteSiteHierarchyItem` (ветки `cluster`/`picket`) | **нет** в тексте замков | То же; `itemId` — параметр, доступ подтверждается `siteId`-проверкой (`:444`, `:467-468`, `:478`) |
| 14 | мелочь | src/services/reports/event-handlers.ts:659 | обработчик outbox (доставка PDF) | **нет** в тексте замка | `SELECT id FROM "OutboxEvent" WHERE id = ${event.id} FOR UPDATE`; `event.id` из собственного воркера, не из запроса пользователя; `OutboxEvent` — тенантная таблица, но id не приходит от клиента |

Остальные тегированные точки сырого SQL (в `src/` и `scripts/`) содержат `tenantId`
в тексте либо получают доставку тенанта через `set_config`/`current_setting`; при
ручном разборе нарушений не найдено. Ключевые: `raw-queries.ts:140,211,256`,
`tenant-rls.ts:105,141,160,208`, `tenant-enforcement.ts:44`,
`tenant-transaction.ts:27-28,90-91`, `site-analytics-service.ts:78`,
`equipment-analytics-service.ts:67,123`, `pile-journal-totals.ts:58`,
`idempotency-repository.ts:31,32` (`Prisma.sql` + `tenantId` в `INSERT`).
Замороженные модули (`operator-mobile`, ORION) в подсчёт включались, но в отчёте
не разбираются — по правилу AGENTS.md.

## Не проверено

- **Исполнение скриптов на прод-контуре.** `apply-postgres-hardening.ts` и
  `explain-analyze.ts` разобраны статически, но не запускались: запуск требует БД
  (`DATABASE_PROVIDER=postgres`, `DATABASE_URL_POSTGRES`), а `.env*` читать
  запрещено (AGENTS.md). Не проверено, вызывается ли hardening-скрипт в CI/CD и с
  какими значениями.
- **Значение `DB_IDENTITY_ROLE` на бою.** `.env*` не открывал — не проверял, какое
  именно имя роли приходит в переменную и достаточен ли regex-барьер для любых
  возможных значений окружения. Сама проверка `SAFE_ROLE_NAME` прочитана
  (`identity-role.ts:32-43`), но её достаточность относительно фактической
  конфигурации не доказывал.
- **Сгенерированный клиент.** `src/generated/**` исключён из анализа (перезапишется
  `npm run db:generate`); там тоже есть `$queryRawUnsafe`, но это код Prisma, а не
  проекта.
- **Полнота по не-TS файлам.** Сканировались `.ts`/`.tsx`/`.js`/`.cjs`/`.mjs`. SQL
  внутри `prisma/migrations/**/*.sql` — это миграционный SQL, а не вызовы
  `$queryRaw`/`$executeRaw`, и в этой описи не разбирался. Динамически собираемые
  имена методов (`db['$' + 'queryRaw']`) не искались — в найденных файлах таких
  конструкций не встречено.
- **Функции, которые не удалось прочитать.** Таких не осталось: у каждого из 10
  небезопасных вызовов объемлющая функция и источник данных прочитаны.
