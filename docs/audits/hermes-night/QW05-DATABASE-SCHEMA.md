# QW05 — Аудит схемы базы данных (PilingTrack)

- Версия кода (HEAD): `83123c3b9b3dd3fdbd3e2534dfce2de3e1f53fc9`
- Дата: 2026-10-14
- Режим: только чтение. Приложение не менялось; создан только этот файл.
- Стек: Next.js 16, Prisma 7 (Postgres). Схема: `prisma/schema.prisma` — 2883 строки, **83 модели**.
- Статистика схемы: явных FK-ссылок с `onDelete` — 69 (Cascade=39, Restrict=29, SetNull=1, без `onDelete`=1); `@unique`=65, `@@unique`=52, `@@index`=227. Миграций: **109**.

## Итог

Схема в целом целостная и согласованная с миграциями: переименований-сирот нет, расхождений в значениях enum между схемой и миграциями **не найдено** (проверено скриптом), DROP-операции в миграциях соответствуют моделям, которых больше нет в схеме. Безопасности данных утечек «в чистом виде» не обнаружено: все raw-запросы используют параметризованные `$1`-параметры, `$queryRawUnsafe`/`$executeRawUnsafe` в коде приложения **не вызываются** (только имя в белом списке RLS), bcrypt с cost 12 (в пределах норм OWASP).

Три реальных риска, которые стоит закрыть до второго тенанта / перед свежим развёртыванием:

1. **Горячие индексы живут вне миграций** — они создаются ручной командой `npm run db:indexes` из `prisma/indexes.sql`. На чистой базе (новый сервер, второй арендатор) `prisma migrate deploy` их **не создаст** — индексы по Report пропадут и горячие экраны станут медленными.
2. **Одна FK без явного `onDelete`** — `TelematicsDevice.tenant` использует implicit default (Restrict) вместо явного указания, как 95 остальных tenant-FK.
3. **Архитектурная узость RLS для raw-SQL** — изоляция tenants в сырых запросах держится целиком на DB-RLS + GUC `set_config`; отсутствие политики RLS на одной таблице или raw-вызова мимо обёртки = тихая межтенантная утечка, а проверки/тест, что каждый raw-путь обёрнут и RLS включён на таблице, нет.

Остальные позиции — информационные (стиль/именование/наблюдение), без потери данных.

## Методика

- `prisma/schema.prisma` прочитан целиком (2883 строки) блоками по ~700 строк.
- Скрипты (scratch-каталог hermes): разбор FK/`onDelete` и покрытия индексов в разрезе модели; сравнение значений enum между схемой и миграциями; сверка `CREATE TABLE`/`DROP TABLE` и RENAME.
- `search_files` + точечные `read_file`/`sed` для подтверждения каждой находки по `path:line`.
- raw-SQL: поиск всех вызовов `$queryRaw`/`$executeRaw` вне generated/тестов; проверка на динамические идентификаторы и конкатенацию.
- `rg`/`grep -E` по `prisma/migrations/*` на опасные операции.

Каждая находка ниже имеет `path:line`. «Не проверено» — в конце.

## Находки

| # | severity | path:line | проблема | сценарий / воздействие | как исправить |
|---|---|---|---|---|---|
| 1 | HIGH | `package.json:64`, `prisma/indexes.sql:1-133`, `docker-compose.yml:29-37`, `scripts/deploy-prod.sh` (143 строки, без `db:indexes`) | Горячие индексы (idx_report_site_date, idx_report_user_date, idx_report_status, idx_report_crew, …) применяются ручной командой `npm run db:indexes`, **не входят в историю миграций и не вызваны ни в compose, ни в deploy-скрипте** | Prod deploy (`docker-compose.yml:29-37`) выполняет только `npx prisma migrate deploy` + seed — индексы из indexes.sql на чистой БД отсутствуют → горячие запросы периода/«Объекты» переходят на последовательный проход; деградация только при смене окружения, сейчас незаметна (prod уже применял их вручную) | Перенести индексы в миграцию (`prisma/migrate dev` с `CREATE INDEX CONCURRENTLY IF NOT EXISTS` и последующей миграцией, или отдельной миграцией). Минимум — встроить `npx prisma db execute --file prisma/indexes.sql` в команду compose-сервиса `migrate` (после `migrate deploy`) с тем же `IF NOT EXISTS` |
| 2 | MEDIUM | `prisma/schema.prisma:1681` | `TelematicsDevice.tenant` — FK на `Tenant` **без явного `onDelete`** (полагается на implicit default Restrict); у остальных 95 tenant-FK `onDelete` указан явно | Не потеря данных (Restrict помешает удалить тенант с устройствами), но хрупкость: смена default-поведения версией Prisma или ручной DDL может «прогнать» каскад; трудноаудитировать | Явно добавить `onDelete: Restrict` (или Cascade, если устройство должно жить вместе с арендатором) — как у соседних `WorkPermit.tenantId:1502` |
| 3 | MEDIUM (архитектура) | `src/core/security/tenant-rls.ts:150-212` + 37 raw-вызовов в 10 файлах | Изоляция tenants для raw-SQL опирается **полностью** на DB RLS + GUC `set_config('app.current_tenant',…,true)` внутри `wrapRawQuery`; Prisma-обёртка `$allModels` сырые запросы не ловит | Одна таблица без политики RLS **или** один raw-вызов мимо обёртки → межтенантная утечка (включая `OPERATOR`/`ASSISTANT`). Сейчас защищено обёрткой, но нет автотеста «каждый raw-путь обёрнут / RLS включён на таблицу» | Добавить fail-fast-проверку: тест, перечисляющий все таблицы `Tenant`-scoped и утверждающий наличие active RLS policy; lint-правило/конвенция запрещать `$queryRaw` вне `wrapRawQuery` |
| 4 | MEDIUM | `prisma/schema.prisma:1578` (Inspection.templateId) | FK `Inspection.templateId` — **нет индекса** с ведущим столбцом `templateId`; есть только `@@index([tenantId,equipmentId])`, `@@index([tenantId,status])`, `@@unique([tenantId,shiftId,phase])` | Запрос «все проверки по шаблону» — последовательный проход по Inspection (накопится); не критично при малом объёме, но растёт | Добавить `@@index([tenantId, templateId])`; аналогично проверить другие FK-колонки без ведущего индекса (см. §Примечание-индексы) |
| 5 | LOW/INFO | `src/core/infrastructure/raw-queries.ts:1-115` | Файл и коммиты называют запросы «raw SQL optimized hot paths / benchmark < 50ms vs ~200ms», но `getReportsByPeriodRaw` использует Prisma `db.report.findMany` с 7 вложенными `include` — **не raw**; комментарий и имя вводят в заблуждение | Новый разработчик «улучшит» на raw на основании комментария и сломает fail-closed tenancy (сырой SQL не обёрнут RLS по умолчанию) | Переименовать `getReportsByPeriodRaw` → `getReportsByPeriod` / «Query service»; обновить docstring, убрать ложное «raw» |
| 6 | INFO (полож.) | `src/services/auth/auth-service.ts:14` | `BCRYPT_ROUNDS = 12` | В пределах рекомендации OWASP для bcrypt при современном core | — |
| 7 | INFO (полож.) | `src/core/security/tenant-rls.ts:172-177` | `$queryRawUnsafe`/`$executeRawUnsafe` присутствуют **только** по имени в наборе `RAW_METHODS` (обёртка RLS); **реальных вызовов этих методов в приложении нет**. Все 37 сырых вызовов — параметризованные `\`…${v}…\`` с `$1`-плейсхолдерами | Вектор SQL-инъекции не обнаружен | — |
| 8 | INFO (полож.) | `prisma/migrations/` (109 файлов) | DROP-операций: 4 `DROP TABLE IF EXISTS` (`ReportStats`, `OperatorPerformance`, `DowntimeSummary`, `RefreshToken` — 20260817/20260924). Эти 4 модели **отсутствуют** в текущей схеме (83 модели живые; всего в миграциях 87 CREATE = 83 + 4 удаляемых). `ADD COLUMN … NOT NULL` без DEFAULT: **0**. `ALTER COLUMN … SET NOT NULL`: **не найдено**. | Опасных DDL без защиты нет | — |
| 9 | INFO | схема (244 колонки `String` без `@db.VarChar`) | Unbounded `String` → в Postgres это `TEXT`. Для Postgres безопасно (нет «big index keys», как в MySQL). Индексируемые/уникальные (`email`, `pin`, `pinLookup`) — короткие, укладываются в b-tree | — (наблюдение) | — |
| 10 | INFO | `prisma/indexes.sql:12-30` (пример: `idx_report_site_date`, `idx_report_crew WHERE crewId IS NOT NULL`) | Сам набор индексов разумный и прицельный (Report + children, частичные на Crew/Equipment). Проблема — **не их содержание**, а механика применения (находка #1) | — (см. #1) | — |

## Примечание-индексы (разбор 6 «подозрительных» FK)

Автоматический скринер показал 6 FK без индекса на ведущую колонку. Ручная сверка:

- **Ложноположительные (на самом деле индекс есть):**
  - `PilePassport.pileWorkId:2240` — `@unique` (аутоматический индекс Prisma) + `@@unique([tenantId, clientCommandId])`.
  - `TenantAuditChain.tenantId:2621` — это `@id` (part of PK), индекс по определению.
- **Покрытие тенантом (не дефekt при fail-closed tenancy, так как все запросы ведутся через `tenantId`):**
  - `UserDocument.userId:208` — есть `@@index([tenantId, userId])`.
  - `UserDocument.typeId:209` — есть `@@index([tenantId, typeId])`.
  - `Inspection.equipmentId:1577` — есть `@@index([tenantId, equipmentId])`.
- **Реальный (единственный) промах:**
  - `Inspection.templateId:1578` — **нет** индекса ни `@@index([tenantId, templateId])`, ни `@@index([templateId])`. Это находка #4.

Вывод: из 6 авто-флагов — 2 ложных, 3 покрыты тенантом, 1 реальный.

## Не проверено

- **Реальное состояние production-БД** — не подключались (правило: нет prod). Отчёт охват намерения/декларации в migrations + indexes.sql. Точный ответ на «есть ли в prod те же индексы, что и в indexes.sql?» — **нужен `\di+` на живой БД**.
- **Фактическая работа `npm run db:indexes`** — не запускали (влияет на live). Оценено статически.
- **Покрытие RLS на каждой таблице `Tenant-scoped`** — прочитан `tenant-rls.ts`, полный обзор всех `CREATE POLICY … FOR ALL USING (tenant_id = current_setting('app.current_tenant'))` в migrations не выведен построчно; утверждаем по наличию `20260425000000_enable_rls_foundation` и `20260516100000_extend_rls_tenant_scoped`. **Рекомендую** отдельный аудит «полный аудит RLS-политик».
- **Производительность конкретных запросов по `Inspection.templateId`** — не замеряли (нет live-данных, EXPLAIN не гоняли).
- **Совместимость 133 строк `indexes.sql` со схемой** — проверено визуально (Report + children); формальная сверка «всё из indexes.sql есть в migrations или намеренно вне» не проводилась.

## Итоговое число

Находок: **10** (1 HIGH, 3 MEDIUM, 1 LOW/INFO, 5 INFO). Все с `path:line`. Ошибок потери данных / SQL-инъекций **не обнаружено**.
