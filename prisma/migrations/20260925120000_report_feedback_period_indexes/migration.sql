-- Индексы под запросы, которые растут вместе с историей (аудит R3, 25.09.2026):
-- выгрузка и аналитика берут отчёты организации за период (tenantId + date),
-- история записи читает журнал событий по scope + targetId, новые сверху.
-- Таблицы на бою маленькие (база ~130 МБ), обычное построение займёт доли секунды.
CREATE INDEX "Report_tenantId_date_idx" ON "Report"("tenantId", "date");
CREATE INDEX "FeedbackEvent_scope_targetId_createdAt_idx" ON "FeedbackEvent"("scope", "targetId", "createdAt");
