# CODEX-REPORT-T10 — J9 → J8 → J7

Дата: 07.10.2026. Дерево: D:\PillingR\wt-codex10.
Ветка: codex/j9-j8-j7-1007, база main=e6fa7e35.

Порядок по последней команде владельца: J9, J8, J7. J1/J2/J4/J5/J6 уже
в main, повторно не исправляются. I2/I1/I3/I5 и J3 в operator-mobile
отложены до слияния owner/operator-flow-0707 в main. I4 не задан.
Ветка владельца и её незакоммиченные файлы не изменяются.

## Предыдущая работа G3 и граница H2–H4

wt-codex7 больше не существует и не используется. Сохранённый снимок:
codex/g3-wip3=a0f8d7e6, код3034e5ec, G1/G2 база35177205.
H2–H4 требуют отдельного решения владельца до начала; ни G1/G2, ни G3
не переносятся в текущую ветку автоматически. G4–G6 не объявляются готовыми.

Историческая проверка G3 в прежней сессии: security HTTP126/0skipped exit0,
Chromium6/0skipped exit0; полный unit3141passed/2244skipped/5385tests exit0;
Playwright collection135/13files exit0. Это не проверка сегодняшнего main.
Последняя матрица1840:1770passed/55failed/15skipped exit1. Четыре реальные
несогласованности платформенного ADMIN/DISPATCHER доступа к чужой технике
и истории отчёта сохранены RED; остальные падения были fixtures/конфиг.
Никаких trigger/RLS bypass не применялось. Снимок не считается завершённым G3.

## Начальные ограничения среды

npm run db:generate — exit1: DATABASE_URL_POSTGRES отсутствует в config.
.env не читается и не подделывается. Клиент скопирован из уже существующего
src/generated основного дерева; prisma schema между main и веткой владельца
совпадает. node_modules подключён junction, пакеты не устанавливались.

GitNexus MCP отсутствует; CLI query/impact exit1: gitnexus not recognized.
Bootstrap не вызывался. Риск UNKNOWN, граф не считается чистым;
зависимости дополнительно проверяются полным текстовым поиском и diff.

## J9 — реализовано

Выбран разрешённый заданием вариант: исторический снимок сохраняется,
но выведенная из работы установка не показывает текущую готовность.
Контракт активности добавляется только текущему DTO, не историческому.
Сначала RED в существующих тестах, затем минимальная правка.

Текущий API добавляет equipmentActive (при отсутствии Equipment — false).
Presentation для false: «Выведена из работы», UNCONFIRMED, без балла;
Reports исключает старые оценки из среднего/причин и не возвращает старый
производный балл. Centre не считает историческую приёмку текущей.
Исторический API, снимки, scheduler и сама установка не изменены.
В main bootstrap уже исключает неактивную установку из парка: browser
проверяет это исключение, текущий API и сохранённую историю. Отдельный DOM
тест проверяет подпись/отсутствие балла, если неактивная строка передана UI.

RED: API/presentation 2 failed/19 passed; Reports 2 failed/27 passed;
Centre 1 failed/20 skipped по фильтру. GREEN: 71 passed/0 skipped/4 files,
exit0. Browser Chromium на собственном Postgres: 1 passed/0 skipped, exit0.
Начальные ошибки browser fixture (нет ruleSetId; ожидалась скрытая bootstrap
строка) исправлены и не выдаются за доказательства дефекта.

Проверки J9:
- npx tsc --noEmit: exit0, .next/dev/types удалён только в этом дереве.
- npm run lint: exit0, 0 warnings, text integrity passed.
- npm run test:unit: exit1, 3729 passed/250 skipped/2 failed (3981 tests,
  386 files): два неизменённых filesystem scanner теста превысили 5 секунд.
  Повтор этих двух файлов: exit0, 42 passed/0 skipped. Полный повтор с
  --maxWorkers=2: exit0, 3731 passed/250 skipped/3981 tests, 372 passed/
  14 skipped files, 512.47s. Таймауты и исходники тестов не ослаблены.
- npx playwright test --list: exit0, 297 tests/29 files; добавлен один
  сценарий × три проекта, существующие specs не удалены.
- npm run build: exit0 на собственном codex-pg и Redis; финальный исходный
  код J9 включён. Предупреждение BullMQ о необязательном @valkey/valkey-glide
  сохранилось. Пакеты не устанавливались. Ошибочный прямой next build
  без штатного --webpack: exit1 (Turbopack не принимает внешний junction);
  это не результат штатной npm run build.
- GitNexus detect-changes --scope all: exit1, CLI отсутствует, UNKNOWN.
  По разрешению CODEX-DESKTOP-TASKS.md §GitNexus сделан rg по src/tests/e2e/
  scripts и review diff: consumers to-module, Fleet, Centre, Reports, DTO;
  исторический DTO не расширен. Второй агент: замечаний не обнаружено.

Строки J9 (+/-): current/route 6/0, contracts 1/0, presentation 9/2,
Reports 6/4, Centre 1/1; тесты API 49/2, presentation 30/1,
Fleet+Reports 56/0, Centre 20/1, browser 46/0. Удалённых файлов/экспортов нет.
Перестройка проекции/правка боевых данных для J9 не требуется.
Коммит J9: a49bf84d.

## J8 — индексы периода журнала

Добавлены (tenantId, occurredAt) и частичный (tenantId, receivedAt) WHERE
occurredAt IS NULL. Два отдельных migration.sql по одному CREATE INDEX
CONCURRENTLY сохраняют autocommit; это одно логическое изменение J8.
Существующий shiftId-индекс и запросы приложения не меняются. Частичный
индекс описан в schema комментарием, поскольку задан SQL-миграцией.

На собственном codex-pg-054a44aa2472 (Postgres16, порт58804) сначала RED:
exit1, 1 failed/1 pattern-skipped. Каталог индексов был пуст для этих имён;
проверки реальных ID/итогов listPilePassports уже проходили. Созданы только
собственные tenant fixtures: 120000 строк (100000+20000), 1000 дней, оба
источника времени, два объекта. AuditLog не создаётся и не удаляется.

Prisma migrate deploy --config prisma.integration.config.ts: exit0,
обе concurrent миграции успешно применены через штатный migration runner.
GREEN: exit0, 1 passed/1 pattern-skipped; 200 строк/свай без объекта,
100 с объектом, по половине occurredAt/fallback. Все четыре EXPLAIN
используют оба новых индекса. Сортировка сохраняется; Seq Scan для малого
объёма/широкого периода не запрещается. enable_seqscan не менялся.

Локальный замер до→после (мс): список 19.854→0.340, агрегат23.377→0.545;
с объектом13.334→0.549 и13.231→0.534. После — Bitmap Heap Scan, 200 строк,
113 shared-hit blocks для PileWork вместо обхода десятков тысяч лишних строк.
Это иллюстрация fixture, не SLA/оценка боевой БД. Полные EXPLAIN JSON:
output/codex-t10/j8-plans-before.json и j8-plans-after.json. План списка
выбирает ID, не измеряет все связанные Prisma presentation SELECTs;
реальное приложение отдельно проверено по ID/агрегатам.

tsc exit0; полный lint exit0/0 warnings; полный unit — неизменённый итог J9
3731 passed/250 skipped, runtime queries не редактировались. После первого
GREEN добавлен guard same local owner/app codex_test target; финальный повтор
exit0, 1 passed/1 pattern-skipped, 11.63s. GitNexus impact/detect-changes exit1 UNKNOWN, разрешённый
rg fallback: readers listPilePassports/pileJournalTotals, writers производят
те же данные, схема меняется только индексами; independent review без замечаний.

Строки J8: schema +4, интеграционный тест +154, две migration.sql +4 каждая,
runbook017 +124. Удалённых файлов/экспортов нет. Ни общая локальная, ни боевая
БД не открывались. На бою индексы ещё нужно применить владельцу; runbook017
содержит проверки объёма, свободного места, длинных транзакций и валидности.
Удаление невалидного индекса при сбое — отдельное решение владельца.
