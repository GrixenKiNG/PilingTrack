# ДЕФЕКТ: гонка claim ключа идемпотентности (ожидает разрешения)

Новый полный последовательный прогон кода1b0a2663: **5775 passed / 1 failed / 0 skipped**,512files,exit1,981с wrapper. Падает tests/integration/tech-readiness-work-permits.spec.ts:329 —20одинаковыходобрений. Бизнес-проверки одной подписи/одной записи audit/outbox/одного ключа прошли; один rejected-вызов принёс необработанный P2010/SQLSTATE23505 по IdempotencyKey_scope_key_key вместо ожидаемого конфликтного исхода.

## Воспроизводимость до изменений

На точном архиве BASEefd95008 с теми же locked-зависимостями и generated-client:
- permit-race-base-1:1passed/0failed/3filtered,exit0,4с.
- permit-race-base-2:0passed/1failed/3filtered,exit1,3с; тот же23505, сразу3 rejected вызова.
Три filtered — остальные проверки файла, они не выполнялись в этом focused повторе. Порядок/тела/assertions исходного теста не менялись.

Тест, idempotency-repository.ts и tenant-transaction.ts побайтно одинаковы в BASE и ветке (gitdiffпустой,fs.equals=true). Это существующий конкурентный дефект; предшествующие два полных5776green не исключали его. Красный финальный прогон не стёрт и не назван успешным.

## Причина и минимальное предложение

В IdempotencyKey одновременно сохранены UNIQUE(scope,key) и UNIQUE(tenantId,scope,key). tryClaim обрабатывает только второй arbiter через ON CONFLICT(tenantId,scope,key). При гонке может сработать первый индекс и вернуть23505. Уже существующий tenantStorageScope однозначно включает tenant в scope; lookup/complete дополнительно фильтруют tenantId.

Предложение — одна SQL-строка внутри PrismaCommandIdempotencyRepository.tryClaim:
- было: ON CONFLICT ("tenantId", "scope", "key") DO NOTHING
- станет: ON CONFLICT DO NOTHING

Это оставляет оба индекса, tenantStorageScope, все tenant-фильтры, actor/requestHash, lock_timeout, транзакции и retry/DLQ прежними. Не удалять глобальную legacy-уникальность и не добавлять23505 в общий retry-классификатор: это скрывало бы посторонние нарушения уникальности.

[PostgreSQL18 INSERT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT) документирует: для DO NOTHING можно опустить conflict_target, тогда учитываются все применимые уникальные ограничения/индексы. Это обоснование предложения, не доказательство его GREEN — до разрешения правка не применена.

## Ограничение и impact

AGENTS.md:14 запрещает anything RLS/tenancy-related без исключения. Здесь меняется обработка индексов в tenant-scoped идемпотентности; требуется точечное разрешение владельца. Нового разрешения пока нет, файл не изменён.

GitNexus tryClaim: UNKNOWN/lower-bound из-за интерфейсного вызова; не принят за отсутствие влияния. Поиск подтвердил executeIdempotentCommand→repository.tryClaim и три конструктора в командах defects/permits/shifts, плюс PG/unit tests. Индекс на4commitпозади, но перечисленные файлы не менялись; перед разрешённой правкой обновить индекс/impact. Схема, RLS, auth, tenant-transaction.ts, DTO/права не предлагаются к изменению.

Сырые данные: full-unit-v3-final.json, permit-race-baseline-results.json, permit-race-base-2.json; proposal-permit-idempotency.patch — внешняя папка night-evidence-1026. Приложение/тесты ради обхода ошибки не правились.
