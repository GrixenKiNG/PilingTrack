# ДЕФЕКТ: гонка claim ключа идемпотентности

## RED до исправления

Полный последовательный прогон приложения1b0a2663: **5775 passed /1 failed /0 skipped**,512файлов,exit1,981с wrapper. tests/integration/tech-readiness-work-permits.spec.ts:329 —20одинаковых одобрений. Проверки одной подписи,одной audit/outbox-записи и одного ключа прошли; rejected-вызов принёс P2010/SQLSTATE23505 по IdempotencyKey_scope_key_key вместо ожидаемого конфликтного исхода. HTTP500 отдельно не воспроизводился.

Точный архив исходного BASEefd95008 с теми же locked-зависимостями/generated-client:
- permit-race-base-1:1passed/0failed/3filtered,exit0,4с.
- permit-race-base-2:0passed/1failed/3filtered,exit1,3с;тот же23505,сразу3rejected-вызова.

Три filtered — остальные сценарии файла,они намеренно не выполнялись в focused повторе. Тест,repository иtenant-transaction до правки побайтно совпадали сBASE. Предшествующие полные5776green не исключали гонку;последнийRED сохранён.

## Разрешение и единственная правка

Владелец27октября явно разрешил **только эту SQL-строку и проверки существующими тестами**,точечно сняв запрет AGENTS.md§1 «anything RLS/tenancy-related». Повторного разрешения не требуется;исключение не распространяется на другие функции.

Коммит **f51b0f30465c0273905853d0e1e8bc333a9ee0e5**,одна вставленная/одна удалённая строка вPrismaCommandIdempotencyRepository.tryClaim:
- было: ON CONFLICT ("tenantId", "scope", "key") DO NOTHING
- стало: ON CONFLICT DO NOTHING

IdempotencyKey сохраняет оба существующих уникальных индекса. tenantStorageScope,tenant-фильтры find/complete,actor/requestHash,lock_timeout,транзакции и retry не менялись. Схема,миграции и тесты не менялись. Не добавляли23505 в общий retry-классификатор.

[PostgreSQL18 INSERT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT) допускает отсутствие conflict_target для DO NOTHING,чтобы учитывать все применимые уникальные ограничения/индексы. Это обоснование SQL,а не подмена фактических проверок.

## Проверки исправления

Новый собственный PostgreSQL18.6,отдельный контейнер с label pilingtrack.codex.test-db=1,случайные credentials только в памяти;никаких рабочих данных.

| Проверка | Exit | Результат |
|---|---:|---|
|9 существующих файлов:PG permits/shifts/write-pipeline/idempotency-lock-timeout,unit tenant namespace/lock/transaction/command classification|0|37 passed /0 failed /0 skipped,25с|
|10 отдельных повторов существующей20-way approval race|Каждый0|Каждый1 passed /0 failed;по3 прочих сценария отфильтрованы,не названы исполненными|
|Полный wrapper focused+stress|0|60с;никакие assertions не ослаблены|

Группа37 включает все4 сценария work-permits без фильтра. Десять дополнительных повторов — ещё200конкурентных вызовов approve,а не200разных тестов. Эти результаты получены на точных байтах будущего коммитаf51b0f30;SHA256 repository записан вclaim-fix-focused-results.json.

Полный последовательный цикл наf51b0f30 завершён:build exit0 (HTTP health подтвердилSHA),tsc exit0/31с,lint exit0/75с zero warnings,полный свежий unit **5776passed/0failed/0skipped**,512файлов,exit0/901с wrapper (856,05с Vitest);default Playwright collection366/30,BASE318/28,обаexit0. Все241исторических matched и passed в этом же полном JSON. Старые18полных операторских циклов относятся к1b0a2663 и не перенесены на новыйSHA.

## Impact и сохранённые доказательства

После обновления индекса GitNexus вернул tryClaim:UNKNOWN/lower-bound,receiverTyping1. Context класса показывает интерфейсную границу. Поиск подтвердил executeIdempotentCommand→repository.tryClaim и три production-конструктора:команды defects,permits,shifts. Ноль разрешённых graph callers не принят за безопасность.

Перед коммитом полный detect_changes(scope=all):2changed/0affected,1файл,LOW,безpartial/truncated. Анонимность/DI сохраняет границы полноты графа;существующие тесты трёх путей проверены непосредственно.

Сырые файлы вD:/PillingR/night-logs/night-evidence-1026/:full-unit-v3-final.json,permit-race-baseline-results.json,permit-race-base-2.json,claim-fix-focused-results.json,claim-fix-related.*,claim-fix-stress-1…10.*,claim-fix-index.*,claim-fix-impact.log,claim-fix-context.json,claim-fix-detect.json. Полные новые проверки —claim-fix-gates-results.json и соответствующие логи по мере завершения.
