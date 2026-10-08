# W98 — сырой SQL в обход защиты (RAW-SQL-UNSAFE)

## Итог

Проверены все вызовы сырого SQL в `src/`, `scripts/` и `prisma/` (без `node_modules`,
без сгенерированного клиента). Всего **63** точки вызова сырого SQL:
**48** тегированных шаблонов `$queryRaw`/`$executeRaw` в `src/`, **5** тегированных в
`scripts/`, **10** вызовов `*Unsafe`.

- Небезопасных вызовов (`$queryRawUnsafe` / `$executeRawUnsafe`): **10** —
  1 в `src/`, 9 в `scripts/`. Из них **0** с данными из запроса пользователя
  (тело/query string/заголовки): все значения — либо константы, либо переменная
  окружения `DB_IDENTITY_ROLE`.
- `Prisma.raw(` — **0** вхождений во всём репозитории.
- `$queryRaw`/`$executeRaw`, вызванный плоской строкой-переменной вместо тега
  (не шаблон) — **0** в `src/` (плоский вызов встречается только в сгенерированном
  клиенте `src/generated/**`, который в поставку не входит).
- Конкатенация строк внутри сырого запроса — **1** реальный случай: сборка SQL
  шаблоном в `scripts/apply-postgres-hardening.ts` (`idempotentAdd`) из
  констант, результат уходит в `$executeRawUnsafe`.
- Запросов без фильтра `tenantId`: **8** (все — блокирующие `FOR UPDATE` /
  advisory-замки, за проверкой которых данных нет; фильтр организации стоит в
  следующем за замком чтении). Нарушений fail-closed по `tenantId IS NULL OR` нет.

Топ-5:

1. **`src/core/security/identity-role.ts:65`** — единственный небезопасный вызов в
   рабочем коде: `$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)`. Единственная защита —
   regex-проверка имени роли. Противоречит правилу CLAUDE.md «без `Unsafe`».
2. `scripts/apply-postgres-hardening.ts:90,159,166,199,227` — 5 небезопасных
   вызовов, строки SQL собираются из констант скрипта.
3. `scripts/app-role-smoke.ts:109,110,119` — 3 небезопасных вызова, константы.
4. `scripts/explain-analyze.ts:116` — `$queryRawUnsafe(query.sql, ...params)`,
   SQL и параметры из константного массива `QUERIES`.
5. Замки без `tenantId`: `equipment-command.service.ts:64`,
   `site-admin-command.service.ts:451-477`, `event-handlers.ts:659` — риск низкий
   (следом идёт чтение с фильтром организации), но фильтра в самом тексте нет.

## Методика

Индекс `.gitnexus` для этого класса находок не применялся: сырой SQL вызывается
через обычные property-access (`db.$queryRaw`), которые граф не разрешает —
подтверждение шло текстовым поиском по всему рабочему дереву.

Поиск (`search_files`, rg) по `src/`, `scripts/`, `prisma/`, исключая `node_modules`
и `src/generated/**`, по образцам:

- `\$queryRawUnsafe`, `\$executeRawUnsafe`
- `Prisma\.raw\(`
- `\$queryRaw\(|\$executeRaw\(` (плоский вызов, не тег)
- `\$queryRaw|\$executeRaw` (все точки, затем ручной разбор каждой)
- `\$\{(req|request|body|params|searchParams|query|input|url|headers|user|id)\b`
  (попытка найти подстановку пользовательских данных)

Каждая точка вызова открыта (`read_file`) и разобрана: что за метод, откуда берутся
переменные, есть ли рядом `tenantId`. Тестовые файлы (`*.test.ts`, `__tests__/`)
исключены из подсчёта вызовов — в них только моки.

## Находки

| # | severity | path:line | вызов | источник переменных | tenantId есть | риск (причина) |
|---|---|---|---|---|---|---|
| 1 | важно | src/core/security/identity-role.ts:65 | `tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)` | `process.env.DB_IDENTITY_ROLE`, проверяется regex `^[a-z_][a-z0-9_]{0,62}$` (там же :32) | н/п (SET ROLE, не запрос к таблице) | средний — не данные пользователя, но SQL склеен интерполяцией строки, защита целиком на regex; единственный `Unsafe` в рабочем коде, вопреки CLAUDE.md |
| 2 | мелочь | scripts/apply-postgres-hardening.ts:90 | `prisma.$executeRawUnsafe(sql)` | `sql` из `idempotentAdd('User', 'chk_...', ...)` (:53-83) — константы | нет (DDL на `ALTER TABLE`, не строки тенанта) | низкий — все имена таблиц/констрейнтов зашиты в скрипте |
| 3 | мелочь | scripts/apply-postgres-hardening.ts:159,166 | `prisma.$executeRawUnsafe(sql)` / `(sqlWithoutConcurrent)` | элементы массива `partialIndexes` (:105-151) — константы; `.replace('CONCURRENTLY ','')` | нет (DDL `CREATE INDEX`) | низкий — константы |
| 4 | мелочь | scripts/apply-postgres-hardening.ts:199 | `prisma.$queryRawUnsafe(`SELECT ... pg_class ...`)` | константная строка (:199-207) | нет (системный каталог `pg_class`) | низкий — константа |
| 5 | мелочь | scripts/apply-postgres-hardening.ts:227 | `prisma.$executeRawUnsafe('VACUUM ANALYZE')` | константа | нет (служебная команда) | низкий |
| 6 | мелочь | scripts/app-role-smoke.ts:109,110 | `db.$executeRawUnsafe('CREATE TABLE ... / DROP TABLE ...')` | константы (:109-110) | нет (DDL-проба прав) | низкий |
| 7 | мелочь | scripts/app-role-smoke.ts:119 | `db.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE false')` | константа | нет | низкий — проба прав, `WHERE false` |
| 8 | мелочь | scripts/explain-analyze.ts:116 | `prisma.$queryRawUnsafe(query.sql, ...query.params)` | `query.sql`/`query.params` из массива `QUERIES` (:29-98) — константы | нет (EXPLAIN по срезам таблиц) | низкий — dev-скрипт, значения константные; но сама форма unsafe-вызова с переменными |
| 9 | мелочь | src/modules/equipment/application/commands/equipment-command.service.ts:64 | `tx.$queryRaw`SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR UPDATE`` | `equipmentId` — параметр функции (id записи) | **нет** | низкий — строку удаляет/проверяет следующее `findUnique({id, tenantId})` (:66), но сам замок берёт строку по id без организации → возможна блокировка чужой строки при совпадении id |
| 10 | мелочь | src/modules/sites/application/commands/site-admin-command.service.ts:451,452,453 | `tx.$queryRaw`SELECT id FROM "PileField"/"Cluster"/"Picket" ... FOR UPDATE`` | `itemId` — параметр функции | **нет** | низкий — перед этим `requireTenantSite(siteId, ctx.tenantId)` (:444) и следом `findFirst({id, siteId})` (:454); сам замок без организации |
| 11 | мелочь | src/modules/sites/application/commands/site-admin-command.service.ts:465,466,477 | `tx.$queryRaw`SELECT id FROM "Cluster"/"Picket" ... FOR UPDATE`` | `itemId` | **нет** | низкий — то же, что #10 для ветвей cluster/picket |
| 12 | мелочь | src/services/reports/event-handlers.ts:659 | `tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${event.id} FOR UPDATE`` | `event.id` — из воркера outbox, не из запроса пользователя | **нет** | низкий — `OutboxEvent` тенантная таблица, но id приходит от собственного воркера, не от клиента; следующий `findUnique` тоже по id |
| 13 | мелочь | scripts/apply-postgres-hardening.ts:53-57 | сборка SQL шаблоном `idempotentAdd('${table}', ${name}, ${check})` → в `$executeRawUnsafe` | `table`/`name`/`check` — константы вызова | нет (DDL) | низкий — единственный случай конкатенации текста запроса, но из зашитых строк |

Примечание к таблице >13. Строки 1-8 и 13 — единственные небезопасные
вызовы и конкатенация. Остальные **48** тегированных точек в `src/` и **5** в
`scripts/` безопасны (параметры через плейсхолдеры, не через текст запроса);
абсолютный список — в приложении.

## Приложение: остальные точки сырого SQL (безопасные теги, path:line)

Тегированные `$queryRaw`/`$executeRaw` в `src/` (организация либо в тексте, либо
в ключе замка, либо не требуется):

- advisory-замки с `tenantId` в ключе: `src/services/users/user-service.ts:272`,
  `src/modules/settings/application/settings-service.ts:99`,
  `src/modules/readiness/application/readiness-rules-service.ts:106,225`,
  `src/modules/readiness/application/access-matrix-service.ts:169,206`,
  `src/modules/equipment/application/commands/pm-scheduler.ts:105`,
  `src/modules/inspections/application/commands/inspection-commands.ts:386`,
  `src/modules/operator-mobile/application/commands/checklist.ts:195` (замороженная зона),
  `src/modules/reports/application/commands/report-command.service.ts:117`,
  `src/modules/reports/application/commands/report-validation.service.ts:209`
- запросы с `tenantId` строгим равенством: `src/core/infrastructure/raw-queries.ts:140,211,256`,
  `src/services/analytics/site-analytics-service.ts:78`,
  `src/services/analytics/equipment-analytics-service.ts:67,123`,
  `src/core/observability/lag-monitor.ts:171`,
  `src/modules/reports/application/queries/pile-journal-totals.ts:58`,
  `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:222`,
  `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:31,32`,
  `src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts:24`,
  `src/modules/readiness/infrastructure/audit/audit-repository.ts:26,34`,
  `src/modules/readiness/application/projection/current-read-model.ts:13`,
  `src/modules/equipment/application/commands/meter-reading.ts:106,123`,
  `src/modules/equipment/application/commands/equipment-command.service.ts:25`
- доставка тенанта (`set_config`/`current_setting`): `src/core/security/tenant-rls.ts:105,141,160,208`,
  `src/core/security/tenant-enforcement.ts:44`,
  `src/modules/readiness/infrastructure/tenant-transaction.ts:27,28,90,91`
- запросы без тенанта (тенант не нужен): `src/services/system/system-service.ts:29`,
  `src/core/observability/health-checks.ts:42`,
  `src/core/observability/health-tracker/checkers/database.ts:9`
- блокировка outbox: `src/services/notifications/durable-alert-delivery.ts:44` (has tenantId, в отличие от #12)
- сайтовая иерархия: `src/modules/sites/application/commands/site-admin-command.service.ts:451,452,453,465,466,477` (см. #10-11)
- комплектация: `src/lib/db.ts` (комментарий, не вызов)

`scripts/` (теги): `scripts/app-role-smoke.ts:44,76,93`,
`scripts/verify-readiness.ts:131,133`.

## Не проверено

- **Доступность/исполнение скриптов на проде.** `scripts/apply-postgres-hardening.ts`
  и `scripts/explain-analyze.ts` разобраны статически, но не запускались: запуск
  требует БД (`DATABASE_PROVIDER=postgres`, `DATABASE_URL_POSTGRES`), а `.env*`
  читать запрещено (AGENTS.md). Не проверено, вызывается ли hardening-скрипт в CI/CD.
- **Сгенерированный клиент.** `src/generated/**` исключён из анализа (npm `db:generate`
  его перезапишет). Точное число плоских вызовов `$queryRaw(...)` в нём не считалось
  (поиск нашёл 27 совпадений в 9 gitignored-файлах рантайма).
- **Контекст вызова `identity-role.ts:65`.** Не проверял, как именно `DB_IDENTITY_ROLE`
  задаётся на бою (какое значение приходит в переменную) — `.env*` не открывал.
  Достаточность regex-барьера для любых возможных значений env не доказывал.
- **`Prisma.raw(`.** Не найдено ни одного вхождения в `src/`, `scripts/`, `prisma/`
  (0 совпадений), но это результат поиска rg, а не ручного просмотра каждого файла.
- **Полнота по не-TS файлам.** Сканировались `.ts`/`.tsx`; SQL внутри `prisma/migrations/**/*.sql`
  не относится к `$queryRaw`/`$executeRaw` и в этом отчёте не разбирался.
