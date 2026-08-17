-- ============================================================
-- Роль приложения: pilingtrack_app
-- ------------------------------------------------------------
-- Зачем. Приложение, воркеры и ws сегодня ходят в базу ролью-владельцем
-- (`piling` на проде, `postgres` локально). На проде эта роль — суперпользователь
-- (проверено 13.08.2026: rolsuper=t, rolbypassrls=t), а суперпользователь
-- обходит RLS ВСЕГДА: FORCE ROW LEVEL SECURITY на него не распространяется.
-- Значит все политики tenant_isolation_* на 25 таблицах — включая fail-closed
-- миграцию 20260813030000 — там декоративны. Единственная реальная защита
-- сейчас — прикладной фильтр (tenantWhere). См. ADR-0044 и ADR-0042 п. 7.
--
-- Что делает этот скрипт. Заводит непривилегированную роль pilingtrack_app:
-- НЕ владелец таблиц, БЕЗ BYPASSRLS, без права создавать объекты. Ей выдаются
-- только DML-права на таблицы схемы public. С этого момента RLS для неё
-- работает по-настоящему.
--
-- Чего он НЕ делает: не задаёт пароль и не переключает DATABASE_URL. Пароль
-- ставится отдельной командой (он не должен лежать в git), переключение — в
-- ранбуке 011. Роль создаётся с LOGIN, но без пароля: при scram-sha-256
-- войти ею до установки пароля невозможно, то есть промежуточное состояние
-- безопасно.
--
-- Как запускать (той же ролью, что накатывает миграции — это важно, см. ниже):
--   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack \
--     < scripts/app-role-grants.sql
--
-- Скрипт идемпотентен: повторный запуск ничего не ломает.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Защита от запуска не той ролью.
--
-- ALTER DEFAULT PRIVILEGES ниже без «FOR ROLE» привязывается к current_user.
-- Если запустить скрипт ролью, которая НЕ создаёт таблицы, права на будущие
-- таблицы не выдадутся — и это выяснится не сейчас, а на первой миграции,
-- добавляющей таблицу: приложение получит «permission denied» в проде.
-- Поэтому падаем громко здесь.
-- ------------------------------------------------------------
DO $$
DECLARE
  owner_role TEXT;
BEGIN
  SELECT tableowner INTO owner_role
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'Report';

  IF owner_role IS NULL THEN
    RAISE EXCEPTION 'Таблица "Report" не найдена в схеме public — скрипт запущен не на той базе';
  END IF;

  IF owner_role <> current_user THEN
    RAISE EXCEPTION
      'Скрипт запущен ролью %, а таблицы принадлежат %. Запустите его ролью-владельцем (той же, что делает prisma migrate deploy), иначе права на будущие таблицы не выдадутся.',
      current_user, owner_role;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Сама роль
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pilingtrack_app') THEN
    CREATE ROLE pilingtrack_app LOGIN;
  END IF;
END $$;

-- Явно снимаем всё лишнее — в том числе если роль завели раньше и руками.
-- NOBYPASSRLS здесь и есть весь смысл упражнения.
ALTER ROLE pilingtrack_app
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;

-- ------------------------------------------------------------
-- 2. Доступ к базе и схеме
--
-- CREATE на схему public не выдаём: приложение не должно уметь DDL.
-- В Postgres 15+ CREATE на public у PUBLIC и так отозван, но полагаться на
-- умолчание не будем — проверка прав в scripts/app-role-verify.sql это ловит.
-- ------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pilingtrack_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO pilingtrack_app;
REVOKE CREATE ON SCHEMA public FROM pilingtrack_app;

-- ------------------------------------------------------------
-- 3. Права на существующие объекты
--
-- Последовательностей в схеме сегодня нет (все идентификаторы — cuid), но
-- грант выдаём: он ничего не стоит, а появление serial-колонки иначе уронит
-- вставку в проде.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pilingtrack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pilingtrack_app;

-- Журнал миграций приложению не нужен ни на чтение, ни тем более на запись.
-- Единственный, кто его трогает, — prisma migrate deploy под ролью-владельцем.
REVOKE ALL ON TABLE "_prisma_migrations" FROM pilingtrack_app;

-- ------------------------------------------------------------
-- 4. Права на будущие объекты
--
-- Без этого каждая миграция, добавляющая таблицу, будет требовать ручного
-- GRANT — и рано или поздно про него забудут. Привязка к current_user
-- проверена в шаге 0.
-- ------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pilingtrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pilingtrack_app;

-- ------------------------------------------------------------
-- 5. Итог в лог
-- ------------------------------------------------------------
DO $$
DECLARE
  tables_total INT;
  tables_granted INT;
BEGIN
  SELECT count(*) INTO tables_total
  FROM pg_tables WHERE schemaname = 'public';

  SELECT count(*) INTO tables_granted
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND has_table_privilege('pilingtrack_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT');

  RAISE NOTICE 'pilingtrack_app: права на % из % таблиц схемы public (_prisma_migrations исключён намеренно)',
    tables_granted, tables_total;
  RAISE NOTICE 'Дальше: задать пароль и переключить DATABASE_URL — см. docs/runbooks/011-app-db-role.md';
END $$;
