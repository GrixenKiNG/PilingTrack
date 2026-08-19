-- ============================================================================
-- Состояние RLS: одна страница, только чтение.
--
-- Отвечает на четыре вопроса, которые иначе приходится собирать по кускам:
--   1. Сколько политик строгих, сколько ещё в режиме аудита (и каких).
--   2. Есть ли таблицы с колонкой tenantId, но без RLS вовсе.
--   3. Есть ли таблицы с RLS, но без FORCE — на владельца политика не
--      распространяется, и защита декоративна.
--   4. Кто ходит в базу и обходит ли он RLS.
--
-- Запуск:
--   docker compose exec -T postgres psql -U piling -d pilingtrack -f - < scripts/rls-state.sql
-- локально:
--   docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test < scripts/rls-state.sql
--
-- Ничего не меняет. Безопасно запускать на бою в любой момент.
-- ============================================================================

\pset border 2

\echo
\echo '== 1. Политики: строгие против режима аудита =========================='

SELECT
  CASE WHEN qual LIKE '%IS NULL%' THEN 'аудит (fail-open)' ELSE 'строгая' END AS "режим",
  count(*) AS "политик"
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY 1
ORDER BY 1;

\echo
\echo '-- Если строка «аудит» есть — вот кто в ней:'

SELECT tablename AS "таблица", policyname AS "политика"
FROM pg_policies
WHERE schemaname = 'public' AND qual LIKE '%IS NULL%'
ORDER BY 1;

\echo
\echo '== 2. Таблицы с tenantId, но без RLS =================================='
\echo '-- Ожидаются ровно две, обе — осознанное решение (ADR-0046):'
\echo '-- OutboxEvent (воркер разбирает очередь сквозь все организации) и'
\echo '-- IdempotencyKey (мёртвая: пять экспортов, ноль вызывающих).'
\echo '-- У обеих tenantId допускает пустоту — строгое сравнение прятало бы'
\echo '-- такие строки навсегда.'

SELECT c.relname AS "таблица"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenantId'
  )
  AND NOT c.relrowsecurity
ORDER BY 1;

\echo
\echo '== 3. RLS включён, но без FORCE ======================================='
\echo '-- Здесь должно быть пусто. Без FORCE владелец таблиц политику не'
\echo '-- соблюдает, а миграции и ручной psql ходят именно владельцем.'

SELECT c.relname AS "таблица"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relrowsecurity
  AND NOT c.relforcerowsecurity
ORDER BY 1;

\echo
\echo '== 4. Роли: кто обходит RLS ==========================================='
\echo '-- pilingtrack_app обязан иметь rolbypassrls = f, иначе всё выше'
\echo '-- не имеет силы. pilingtrack_identity обязан иметь t — в этом её смысл,'
\echo '-- и она же обязана быть без LOGIN.'

SELECT rolname AS "роль", rolsuper AS "суперпользователь",
       rolbypassrls AS "обходит RLS", rolcanlogin AS "может входить"
FROM pg_roles
WHERE rolname IN ('pilingtrack_app', 'pilingtrack_identity', 'piling', 'postgres')
   OR rolsuper OR rolbypassrls
ORDER BY 1;

\echo
