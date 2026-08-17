-- Снос трёх проекций, которых никто не читал.
--
-- Обработчики (projectReportStats, projectOperatorPerformance,
-- projectDowntimeSummary) удалены 17.08.2026: их единственным читателем был
-- мёртвый cqrs-query.service.ts. Каждое сохранение отчёта делало три upsert-а,
-- и каждый тянул отчёт со всеми дочерними строками — работа впустую.
--
-- Безопасность сноса: внешних ключей ни в одну, ни из одной таблицы нет
-- (проверено через pg_constraint), в schema.prisma обратных связей тоже нет.
--
-- Данные не теряются: все три проекции целиком выводятся из Report, который и
-- есть источник истины. Формулы pilesPerHour / drillingPerHour, каких у живой
-- аналитики нет, сохранены в истории git.
--
-- ВНИМАНИЕ при накатке на прод: там в ReportStats и OperatorPerformance по 115
-- строк. Снимите дамп перед применением.

DROP TABLE IF EXISTS "ReportStats";
DROP TABLE IF EXISTS "OperatorPerformance";
DROP TABLE IF EXISTS "DowntimeSummary";
