-- Убрана оговорка «tenantId IS NULL» из 17 политик RLS.
--
-- ЧТО БЫЛО. Политики этих таблиц выглядели так:
--   GUC IS NULL OR GUC = '' OR "tenantId" IS NULL OR "tenantId" = GUC
-- Третье условие означает: даже когда app.current_tenant выставлен правильно,
-- строка с пустым tenantId видна КАЖДОМУ тенанту. Это ровно тот шаблон
-- «IS NULL OR tenantId», который CLAUDE.md запрещает после живого IDOR
-- 31.05.2026 — только здесь он жил внутри самой политики.
--
-- ПОЧЕМУ ЭТО НЕ ТЕОРИЯ. app.current_tenant выставляется в транзакциях модуля
-- техготовности (readiness/infrastructure/tenant-transaction.ts), и внутри них
-- читаются Equipment, Site, User, AuditLog, MaintenanceRecord — все из списка
-- ниже. То есть механизм утечки живой; не сработал он лишь потому, что строк
-- с пустым тенантом сейчас нет ни одной (проверено на локальной БД и на
-- снимке прода: 0 из 0 по всем 17 таблицам).
--
-- ЧТО НЕ МЕНЯЕТСЯ. Оговорка «GUC не выставлен» остаётся. Для остальных путей
-- приложения, где GUC не ставится вовсе, поведение прежнее — RLS там по-
-- прежнему не срабатывает, защищает прикладной фильтр. Это осознанно: перевод
-- в fail-closed требует, чтобы GUC выставлялся на каждом запросе, и это
-- отдельное архитектурное решение (см. ADR-0045).
--
-- РИСК ЗАПИСИ. Политика FOR ALL без явного WITH CHECK применяет то же условие
-- ко вставкам, поэтому запись строки с пустым tenantId при выставленном GUC
-- теперь будет отклонена. Все шесть вставок в AuditLog из модуля
-- техготовности задают tenantId явно (проверено), прочие пути GUC не ставят.

DO $$
DECLARE
  tbl text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'AuditLog', 'ConflictAudit', 'DeviceKey', 'DeviceSyncState',
    'Equipment', 'EquipmentDocument', 'MaintenanceRecord', 'Media',
    'Report', 'ReportAnalytics', 'ReportPhoto', 'Site',
    'SiteWeeklyTrend', 'TelegramConfig', 'TelemetryRecord',
    'TenantInvoice', 'User'
  ] LOOP
    -- Таблицы могли быть сняты другими миграциями — пропускаем молча.
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    pol := 'tenant_isolation_' || lower(tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING ('
      || 'current_setting(''app.current_tenant'', true) IS NULL'
      || ' OR current_setting(''app.current_tenant'', true) = '''''
      || ' OR "tenantId" = current_setting(''app.current_tenant'', true))',
      pol, tbl);
  END LOOP;
END $$;
