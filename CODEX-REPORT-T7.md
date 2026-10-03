# CODEX-REPORT-T7 — поток 7, 03–04.10.2026

Worktree D:\PillingR\wt-codex7; ветка codex/long-1004; начальная версия
2c1c34cf. Порядок G1→G6. Production, SSH/SCP/push, .env и реальные учётки
не используются. Учётные данные генерирует supervisor в памяти.
Все изменяемые контейнеры собственные codex-* с метками владения.

GitNexus query и impact createFixture/BriefingRecord: exit 1, CLI отсутствует.
GITNEXUS_INVOCATION=gitnexus исключает автозагрузку. Применён разрешённый
правилами потока 5 резервный анализ rg+diff. Риск UNKNOWN, не низкий.

## G1 — изоляция оставшихся таблиц (в работе)

codex-pg-bdf0dfc194ca после 107 исходных миграций: 84 таблицы, 76 строгих
политик, 0 audit-mode, 8 таблиц без RLS. Число «46 + около19» устарело.
Отсутствие изоляции BriefingRecord подтверждено: RED RLS suite exit 1,
20 passed / 4 failed / 0 skipped. После расширения проверок RED exit 1,
38 passed / 7 failed и ошибка cleanup: мой тест сохранял INSERT.
Тест INSERT теперь всегда выполняется в rollback-транзакции.

Миграция 20261004000000_briefing_record_rls применена только на своей
базе: migrate deploy exit 0. Первая проверка exit 1, 44 passed / 1 failed:
мой тест повторно создавал отчёт с тем же user/site/date и нарушал
существующий уникальный ключ. Исправлен только тест: UPDATE своей строки
и отдельный INSERT BriefingRecord. Первый полный integration на старой
версии теста exit 1, 227 passed / 1 failed / 0 skipped, 10 files.
Финальные числа добавлю после FeedbackEventRead и повторного прогона.

Перед выкладкой требуется решение владельца для каждой из двух новых
RLS-миграций. SQL, порядок и узкий откат — runbook012/G1. Схема Prisma
и бизнес-данные миграциями не изменяются.

### Проверки G1 и ограничения

Фактический PostgreSQL после двух политик: 78 / audit-mode 0 / RLS без
FORCE 0. Четыре SQL prechecks инструктажей/читателей — все ноль.
Feedback RED exit1 5 failed / 2 passed; миграция exit0; GREEN exit0
7 passed / 0 skipped. Полный integration после исправления фикстуры:
exit0, 235 passed / 0 skipped, 11 files, 51.57s.

TypeScript (node node_modules/typescript/bin/tsc --noEmit): exit0.
Перед запуском удалён только проверенный .next/dev/types этого worktree.
npm run lint: exit0, 0 errors / 0 warnings, Text integrity passed.
Build собственного supervisor: exit0, production Next start + unified
workers; этот build выполнен до последних тестовых правок G1.
Playwright list: exit0, 117 tests / 12 files, число не уменьшено.
Первый полный Playwright: exit1, 105 passed / 11 skipped / 1 failed,
9.0m. Отказ SAFETY_ENGINEER Mobile Safari — timeout60000ms.
Отдельный повтор того же сценария без изменения кода/таймаутов:
exit0, 1 passed, 25.3s. Общий прогон не объявляется зелёным.
S3 не включён: два дополнительных пропуска фото относительно F8;
остальные девять — прежние условные пропуски.
OPERATOR/ASSISTANT прошли настоящие ознакомление/тест знаний/досылку
документов, F7 — настоящий bootstrap/журнал и печать; это подтверждает
прикладные пути BriefingRecord после строгой политики.

Первый полный Vitest: exit1, 3125 passed / 2 failed / 281 skipped,
3408 tests / 355 files. Два прежних теста health worker и auth module
exports упали по timeout30000ms. Отдельный повтор: exit0, 19 passed /
0 skipped, 2 files. Полный повтор выполняется; результат добавляется ниже.
Warnings process listeners, Vite config, Node FORCE_COLOR и Next
compression/httpxy не скрывались; причина исходных таймаутов не доказана.

GitNexus detect-changes --scope all --repo .: exit1, CLI недоступен,
UNKNOWN. Fallback rg+diff --check применён. Один первоначальный вызов
субагента ошибочно начал bootstrap в общий кеш; прерван, повтор без
bootstrap отказал по отсутствию CLI. Package/lock diff пуст. Полное
описание ошибки и текстовый разбор в docs/audits/codex-t7-rls.md.

Оставлены шесть таблиц без RLS: OutboxEvent, DeadLetterQueue,
IdempotencyKey, Tenant, FeedbackEvent, _prisma_migrations. Обоснования
и background/write paths для каждого — в аудите. Переключение только
двух честно изолируемых таблиц; старые миграции и schema.prisma не менялись.
Удалений файлов/экспортов нет; исходники frozen operator/ORION не менялись.

Полный повтор npm run test:unit: exit0, 3127 passed / 281 skipped /
0 failed, 355 files (340 passed / 15 skipped), 113.57s. Первые таймауты
не повторились; причинную связь с G1 или параллельной нагрузкой не утверждаю.

Коммит BriefingRecord: 4a4ec346. Второй логический коммит G1 включает
FeedbackEventRead, аудит, адресный rollout и этот отчёт. Изменения первого
коммита: миграция9+, RLS spec23+, fixture4+/3-. Изменения второго —
точные numstat в коммите. G1 реализован с указанным ограничением полного
Playwright; все 235 реальные интеграционные тесты passed без skips.
G2–G6 ещё не завершены, финальный merge Hermes ещё не выполнялся.
