# J8 — индексы периода журнала забивки

Это порядок для владельца. Codex проверяет только собственный одноразовый
`codex-pg-*`; боевые команды и подключения не выполняет.

Изменение добавляет два индекса, не меняет строки `PileWork`, RLS, правила
датирования или сортировку. `listPilePassports` читает период через две ветки:
`occurredAt` и `receivedAt`, когда `occurredAt IS NULL`. Агрегат титула использует
тот же период. Существующий `(tenantId, shiftId, occurredAt)` не даёт поиска по
дате без `shiftId`. Индекс по `COALESCE` существующий OR не заменяет.

## Перед применением

Подтвердить БД, схему `public`, владельца, резервную копию и свободное место на
диске. Построение индекса расходует I/O и место; `CONCURRENTLY` допускает запись,
но может ждать длинные транзакции и конфликтующий DDL. По малой локальной таблице
нельзя судить о размере и длительности построения на бою.

Выполнить только чтение в согласованной владельцем БД:

```sql
SELECT current_database(), current_user, current_schema();
SELECT pg_size_pretty(pg_relation_size('public."PileWork"')) AS table_bytes,
       pg_size_pretty(pg_total_relation_size('public."PileWork"')) AS total_bytes,
       reltuples::bigint AS estimated_rows
FROM pg_class WHERE oid = 'public."PileWork"'::regclass;

SELECT pid, now() - xact_start AS transaction_age, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = current_database() AND xact_start IS NOT NULL
ORDER BY xact_start;

SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public."PileWork"'::regclass
ORDER BY c.relname;

SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20261007130000_pile_work_tenant_occurred_at_index',
  '20261007130100_pile_work_received_at_fallback_index'
);
```

При совпадении имени уже существующего индекса проверить его определение и
валидность. Не продолжать вслепую и не использовать `IF NOT EXISTS`: этот флаг
может скрыть невалидный или другой индекс под нужным именем.

## Применение

Обе миграции содержат по одному `CREATE INDEX CONCURRENTLY`, без `BEGIN`/`COMMIT`.
Не оборачивать `prisma migrate deploy` или содержимое файлов в общую транзакцию.
Два concurrent statement в одном SQL-пакете также не следует объединять.
Сначала проверить тот же инструмент применения на одноразовой БД; реальные
exit codes записать в журнал изменения. Codex использует конфигурацию
`prisma.integration.config.ts`, которая не читает `.env`.

Если владельцу требуется отдельное ручное построение, выполнить каждый SQL
самостоятельной autocommit-командой:

```sql
CREATE INDEX CONCURRENTLY "PileWork_tenantId_occurredAt_idx"
ON public."PileWork" ("tenantId", "occurredAt");
```

```sql
CREATE INDEX CONCURRENTLY "PileWork_tenantId_receivedAt_null_occurredAt_idx"
ON public."PileWork" ("tenantId", "receivedAt") WHERE "occurredAt" IS NULL;
```

После ручного применения и проверки ниже владелец отмечает **каждую** миграцию
через `prisma migrate resolve --applied <точное имя>` с согласованной конфигурацией
БД. Отмечать до успешного построения нельзя. Не запускать `migrate reset`,
`migrate dev`, `db push` или обычный неконкурентный индекс как запасной путь.

## Проверка и восстановление после ошибки

```sql
SELECT c.relname, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public."PileWork"'::regclass
  AND c.relname IN (
    'PileWork_tenantId_occurredAt_idx',
    'PileWork_tenantId_receivedAt_null_occurredAt_idx'
  );
```

Должны быть ровно две строки с `indisvalid = true`, `indisready = true`, ожидаемым
порядком колонок; у второго — `("occurredAt" IS NULL)`. Первый индекс не частичный.
Сверить успешные записи `_prisma_migrations`.

Неудачный concurrent build может оставить невалидный индекс. Владелец проверяет
имя/таблицу/определение и причину, отдельно удаляет только этот невалидный индекс
через `DROP INDEX CONCURRENTLY`, отмечает неудачную миграцию `resolve --rolled-back`
и повторяет соответствующую миграцию. Рабочий индекс первой миграции при ошибке
второй сохраняется. Автоматической замены или удаления данных нет.

## Повторяемое доказательство на codex-pg

Существующий `tests/integration/disposable-analytics-performance.spec.ts`, группа
`J8 pile journal period indexes`, создаёт собственные уникальные два тенанта,
120000 строк (100000 + 20000), 1000 дней, оба источника даты и два объекта.
AuditLog не создаётся; очистка удаляет только строки собственных тенантов.

До миграций тест сохраняет `output/codex-t10/j8-plans-before.json`, сверяет реальные
строки/итоги приложения, затем падает на отсутствии двух индексов. После миграций
тот же сценарий сохраняет `j8-plans-after.json`: 200 строк/свай без фильтра объекта,
100 с фильтром, половина каждой выборки из fallback-ветки. Проверяются реальные
ID и итоги `listPilePassports`, каталог индексов и использование обоих индексов
в четырёх `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.

SQL списка в EXPLAIN сохраняет tenant/time OR/site predicates, сортировку и LIMIT,
но выбирает только ID и не включает дополнительные presentation SELECTs Prisma.
SQL агрегата содержит те же SELECT, JOIN и фильтры, что `pileJournalTotals` для
этого сценария. Отдельный вызов реального приложения проверяет их согласованность.
Это доказательство периода и объекта; поиск номера/решения и план всех связанных
запросов этим тестом не измеряются. `enable_seqscan` не отключается, порог времени
не навязывается. Сортировка и Seq Scan на маленькой таблице или широком периоде
могут остаться; данное изменение не обещает их устранения во всех запросах.

Владелец снимает EXPLAIN до/после для характерного объёма и периода своей БД,
сверяет набор строк и итоги. Перестройка аналитических проекций не требуется.
