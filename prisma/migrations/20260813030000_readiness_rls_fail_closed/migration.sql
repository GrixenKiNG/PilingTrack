-- RLS без ветки fail-open — на тех таблицах, где это доказуемо безопасно.
--
-- Контекст. Все политики tenant_isolation_* писались в «режиме аудита»:
--   current_setting('app.current_tenant', true) IS NULL OR ... = '' OR "tenantId" = ...
-- Первые две ветки означают «соединение не назвало тенанта → показать всё».
-- Это защита, которая срабатывает только у того, кто и так делает всё
-- правильно, — то есть почти никакая. Убрать её разом по всей базе нельзя:
-- подавляющее большинство запросов приложения (планировщик ТО, отчёты,
-- справочники, воркеры) идут без установки GUC и молча начали бы возвращать
-- ноль строк. Молчаливый ноль хуже открытой политики.
--
-- Поэтому строго по факту кода. Шесть таблиц ниже обслуживаются ИСКЛЮЧИТЕЛЬНО
-- через withReadinessTenantTransaction (src/modules/readiness/infrastructure/
-- tenant-transaction.ts): обёртка ставит app.current_tenant внутри транзакции,
-- тут же перечитывает его и падает, если значение не установилось. Проверено:
-- обращений к этим таблицам мимо обёртки в src/ нет — ни через Prisma, ни
-- сырым SQL.
--
-- Что меняется: если GUC не установлен, строки этих таблиц не видны. Это и
-- есть цель — незаданный тенант становится отказом, а не пропуском.
--
-- ВНИМАНИЕ, побочный эффект для эксплуатации: в psql под владельцем (FORCE RLS
-- действует и на него) `SELECT * FROM "Shift"` теперь вернёт 0 строк. Это не
-- потеря данных. В начале сессии нужно назвать тенанта:
--     SET app.current_tenant = 'orion';
-- Записано в ранбук 003-data-corruption.md.
--
-- Остальные таблицы остаются в режиме аудита сознательно, пока каждый путь
-- запроса не научится ставить GUC. Это зафиксировано в
-- docs/adr/0044-rls-fail-closed-scope.md, а не оставлено молча.

DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
  tables TEXT[] := ARRAY[
    'Shift', 'ShiftHandover', 'WorkPermit', 'WorkPermitApproval',
    'ReadinessScoreSnapshot', 'CurrentReadiness'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    pol := 'tenant_isolation_' || lower(tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, tbl);
    -- current_setting(..., true) при незаданном GUC возвращает NULL, сравнение
    -- даёт NULL, строка не проходит. Отдельная ветка на NULL не нужна и была бы
    -- ровно той дырой, которую здесь закрывают.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant'', true))',
      pol, tbl
    );
    -- ENABLE/FORCE уже стоят с 20260808140000, но повтор безопасен и делает
    -- миграцию самодостаточной при накатке на чистую базу.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;
