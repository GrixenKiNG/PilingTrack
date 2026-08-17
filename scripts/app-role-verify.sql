-- ============================================================
-- Проверка роли pilingtrack_app
-- ------------------------------------------------------------
-- Запускать ролью-владельцем (piling / postgres) на той базе, где применён
-- scripts/app-role-grants.sql:
--
--   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack \
--     < scripts/app-role-verify.sql
--
-- Пять проверок. Каждая печатает либо строки-нарушители, либо пусто.
-- Пусто = хорошо, кроме проверок 1 и 5, где ожидаются конкретные числа.
-- ============================================================

\echo '=== 1. Атрибуты ролей (ожидаем: pilingtrack_app super=f, bypassrls=f) ==='
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles
WHERE rolname IN ('piling', 'postgres', 'pilingtrack_app')
ORDER BY rolname;

\echo ''
\echo '=== 2. Таблицы без полного набора DML-прав (ожидаем: пусто) ==='
-- _prisma_migrations исключён намеренно — журнал миграций приложению не нужен.
SELECT t.tablename,
       has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT') AS sel,
       has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'INSERT') AS ins,
       has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'UPDATE') AS upd,
       has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'DELETE') AS del
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename <> '_prisma_migrations'
  AND NOT (
    has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT') AND
    has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'INSERT') AND
    has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'UPDATE') AND
    has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'DELETE')
  )
ORDER BY t.tablename;

\echo ''
\echo '=== 3. Права на будущие таблицы (ожидаем одну строку с defaclacl, где есть pilingtrack_app) ==='
-- Без этой записи новая таблица из очередной миграции окажется недоступна
-- приложению: «permission denied for table X» уже в проде.
SELECT pg_get_userbyid(d.defaclrole) AS "владелец", d.defaclobjtype AS "тип", d.defaclacl::text AS acl
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public'
  AND d.defaclacl::text LIKE '%pilingtrack_app%';

\echo ''
\echo '=== 4. Приложение не должно уметь DDL (ожидаем: f) ==='
SELECT has_schema_privilege('pilingtrack_app', 'public', 'CREATE') AS "может_создавать_объекты";

\echo ''
\echo '=== 5. Изоляция тенанта под настоящей ролью ==='
-- Смысл: под владельцем-суперпользователем эта проверка ничего не доказывает,
-- он обходит RLS всегда. SET ROLE переключает эффективную роль, и политики
-- начинают действовать — это и есть то, как будет ходить приложение.
--
-- Таблицы проверяются через to_regclass: на контуре, куда миграции
-- техготовности ещё не накатаны (прод до деплоя модуля), их просто нет, и
-- скрипт должен это сказать, а не упасть.
SET ROLE pilingtrack_app;

DO $$
DECLARE
  scenario RECORD;
  tbl TEXT;
  cnt BIGINT;
  line TEXT;
  closed_tables TEXT[] := ARRAY['CurrentReadiness', 'Shift', 'WorkPermit'];
BEGIN
  FOR scenario IN
    SELECT * FROM (VALUES
      (NULL,             '5a. без тенанта: fail-closed → 0, режим аудита → всё'),
      ('orion',          '5b. свой тенант: fail-closed → свои строки'),
      ('somebody-else',  '5c. чужой тенант: fail-closed → 0')
    ) AS s(tenant, title)
  LOOP
    PERFORM set_config('app.current_tenant', coalesce(scenario.tenant, ''), false);
    line := '';

    FOREACH tbl IN ARRAY closed_tables LOOP
      IF to_regclass(format('public.%I', tbl)) IS NULL THEN
        line := line || format('%s=нет таблицы  ', tbl);
      ELSE
        EXECUTE format('SELECT count(*) FROM %I', tbl) INTO cnt;
        line := line || format('%s=%s  ', tbl, cnt);
      END IF;
    END LOOP;

    EXECUTE 'SELECT count(*) FROM "Equipment"' INTO cnt;
    line := line || format('Equipment=%s (режим аудита)', cnt);

    RAISE NOTICE '%', scenario.title;
    RAISE NOTICE '    %', line;
  END LOOP;
END $$;

RESET app.current_tenant;
RESET ROLE;

\echo ''
\echo '=== Готово. 5a и 5c: fail-closed таблицы = 0. 5b: не нули, если данные есть. ==='
\echo '=== Equipment: полное число в 5a (режим аудита пропускает всё без тенанта), ==='
\echo '=== свои строки в 5b, 0 в 5c — прикладной фильтр там и есть защита. ==='
\echo '=== «нет таблицы» в 5a-5c — миграции техготовности на этот контур не накатаны. ==='
