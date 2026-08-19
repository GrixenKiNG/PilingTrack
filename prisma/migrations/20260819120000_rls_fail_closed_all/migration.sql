-- Остальные 37 политик RLS переводятся из режима аудита в fail-closed.
--
-- ЧТО БЫЛО. Политика выглядела так:
--   current_setting('app.current_tenant', true) IS NULL
--   OR current_setting('app.current_tenant', true) = ''
--   OR "tenantId" = current_setting('app.current_tenant', true)
-- Первые две ветки означают «соединение не назвало организацию — показать
-- всё». Защита срабатывала только у того, кто и так делает правильно, то есть
-- почти никогда. Шесть таблиц техготовности перевели ещё 13.08.2026
-- (20260813030000), остальные ждали, пока каждый путь запроса научится
-- называть организацию. Научился — см. ADR-0046.
--
-- ЧТО СТАНОВИТСЯ. Остаётся одно условие: "tenantId" = GUC. При незаданной
-- переменной current_setting(..., true) возвращает NULL, сравнение даёт NULL,
-- строка не проходит. Отдельная ветка на NULL не нужна и была бы ровно той
-- дырой, которую здесь закрывают.
--
-- ЧТО ЭТО ЗАЩИЩАЕТ. Не пользователей друг от друга — это дело прикладных
-- проверок прав. А организации друг от друга на случай запроса, в котором
-- забыли фильтр по tenantId. Такое уже случалось дважды (IDOR 31.05.2026 и
-- 22.06.2026), и оба раза ловилось глазами. Теперь ловит Postgres.
--
-- ВАЖНО: порядок раскатки. Миграция бессмысленна и опасна сама по себе.
-- Перед ней на базе обязаны существовать роль опознания и её права
-- (scripts/identity-role-grants.sql), а у приложения — переменная окружения
-- DB_IDENTITY_ROLE. Иначе вход по паролю и по ПИН-коду перестанет работать
-- мгновенно и для всех: организация лежит в той самой строке пользователя,
-- которую политика больше не отдаст. Полный порядок — в ранбуке 012.
--
-- ЧЕГО МИГРАЦИЯ НЕ ДЕЛАЕТ. Пять таблиц с колонкой tenantId, у которых RLS не
-- включён вовсе (IdempotencyKey, OutboxEvent, ReadinessAccessMatrix,
-- ReadinessBackfillProgress, TenantAuditChain), остаются как есть: две из них
-- обслуживают воркеры, которые ходят в базу заведомо без организации, и
-- включение их сломало бы. Это отдельное решение, см. ADR-0046, раздел
-- «Что осталось».
--
-- ПРОВЕРЕНО НА СТЕНДЕ 19.08.2026 — копия боевых данных, все 43 политики
-- строгие, приложение под ролью pilingtrack_app без BYPASSRLS: 63 маршрута
-- чтения, запись отчёта, справочника, объекта, пересчёт проекций, цепочка
-- outbox→проекция, вход по паролю и по ПИН-коду, уведомление в Telegram,
-- роли администратора и оператора. Отчёт: docs/adr/0046-rls-fail-closed.md.

DO $$
DECLARE
  tbl text;
  pol text;
  flipped int := 0;
  leftover int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'AuditLog', 'ChecklistItem', 'ChecklistSection', 'ChecklistTemplate',
    'ConflictAudit', 'DeviceKey', 'DeviceSyncState', 'DowntimeReason',
    'DrillingType', 'Equipment', 'EquipmentDefect', 'EquipmentDocument',
    'Inspection', 'InspectionAnswer', 'MaintenancePlan', 'MaintenanceRecord',
    'Media', 'MeterReading', 'ModuleLayoutTemplate', 'PermitWorkType',
    'PileGrade', 'ReadinessRuleSet', 'Report', 'ReportAnalytics',
    'ReportPhoto', 'Site', 'SiteWeeklyTrend', 'TelegramConfig',
    'TelematicsDevice', 'TelematicsDeviceAssignment', 'TelemetryRecord',
    'TenantInvoice', 'TenantSettings', 'User', 'UserDocument',
    'UserDocumentType', 'UserPlacePreset'
  ] LOOP
    -- Таблица могла быть снята другой миграцией — пропускаем молча, как в
    -- 20260817230000.
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Имя политики не выводится из имени таблицы: часть заведена в нижнем
    -- регистре сплошняком (tenant_isolation_auditlog), часть — с
    -- подчёркиваниями (tenant_isolation_checklist_item). Берём фактическое.
    SELECT policyname INTO pol
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND policyname LIKE 'tenant\_isolation\_%';

    IF pol IS NULL THEN
      RAISE EXCEPTION 'У таблицы % нет политики tenant_isolation_* — состояние базы не то, которого ждёт миграция', tbl;
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', pol, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant'', true))',
      pol, tbl
    );

    -- ENABLE/FORCE уже стоят, но повтор безопасен и делает миграцию
    -- самодостаточной при накатке на чистую базу. FORCE обязателен: без него
    -- владелец таблиц (роль миграций) политику не соблюдает.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    flipped := flipped + 1;
  END LOOP;

  -- Список выше выписан руками, чтобы миграцию можно было прочитать глазами.
  -- Обратная сторона — он может разойтись с базой, если таблицу добавили
  -- позже. Тогда политика тихо осталась бы в режиме аудита, и никто бы не
  -- узнал. Поэтому падаем громко.
  SELECT count(*) INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public' AND qual LIKE '%IS NULL%';

  IF leftover > 0 THEN
    RAISE EXCEPTION
      'После перевода осталось % политик в режиме аудита. Скорее всего таблицу добавили позже списка в этой миграции — допишите её и накатывайте заново.',
      leftover;
  END IF;

  RAISE NOTICE 'Переведено в fail-closed: % политик. В режиме аудита не осталось ни одной.', flipped;
END $$;
