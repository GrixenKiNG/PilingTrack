-- ============================================================================
-- Роль опознания: pilingtrack_identity
--
-- Зачем нужна. После перевода политик RLS в fail-closed каждая строка видна
-- только под своей организацией. Три запроса приложения этому правилу
-- подчиниться не могут по устройству: поиск пользователя по email, поиск по
-- ПИН-коду и поиск ключа устройства. Организация лежит в той самой строке,
-- которую ищут, — знать её заранее неоткуда. Токен сессии здесь не поможет:
-- при входе его ещё нет, а контроллер телеметрии не предъявляет его никогда.
--
-- Что делает этот скрипт. Заводит роль pilingtrack_identity: не владелец
-- таблиц, без права создавать объекты, НО с BYPASSRLS — и выдаёт ей права
-- ровно на две таблицы и ровно на те действия, которые опознание совершает.
-- Приложение переключается на неё через SET LOCAL ROLE на время одной
-- транзакции (src/core/security/identity-role.ts) и тут же возвращается.
--
-- Почему так, а не «оставить User и DeviceKey в режиме аудита». Аудит
-- означает, что ЛЮБОЙ запрос без организации видит все строки этих таблиц —
-- в том числе будущий, написанный по невнимательности. Здесь же круг
-- разомкнут в трёх названных запросах, а не в таблице целиком, и границу
-- держит Postgres.
--
-- Применение (см. ранбук 011 про pilingtrack_app — порядок тот же):
--   psql -U postgres -d pilingtrack -v role_password="'...'" \
--        -f scripts/identity-role-grants.sql
--   затем DB_IDENTITY_ROLE=pilingtrack_identity в .env приложения.
--
-- Без DB_IDENTITY_ROLE приложение работает как раньше — переключения не
-- происходит. Это и есть режим локальной разработки и CI, где подключение
-- суперпользовательское и RLS не действует.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pilingtrack_identity') THEN
    CREATE ROLE pilingtrack_identity NOLOGIN;
  END IF;
END $$;

-- BYPASSRLS здесь и есть весь смысл роли. Всё остальное снято.
ALTER ROLE pilingtrack_identity
  NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;

-- Роль без LOGIN: подключиться ею нельзя, в неё можно только переключиться.
-- Право переключения выдаётся рабочей роли приложения.
GRANT pilingtrack_identity TO pilingtrack_app;

GRANT USAGE ON SCHEMA public TO pilingtrack_identity;

-- Чтение — только те колонки, которые опознание действительно читает.
-- Пароль и хеш ПИН-кода в списке: без них проверить учётные данные нельзя.
GRANT SELECT ("id", "email", "password", "pin", "pinLookup", "name", "role",
              "isActive", "tenantId", "sessionVersion")
  ON public."User" TO pilingtrack_identity;

-- Правка — только то, что опознание чинит по ходу: устаревший хеш пароля,
-- перевод ПИН-кода на bcrypt и дозапись ключа поиска. Ни роли, ни признака
-- активности, ни организации роль опознания менять не может.
GRANT UPDATE ("password", "pin", "pinLookup") ON public."User" TO pilingtrack_identity;

GRANT SELECT ("id", "keyHash", "revoked", "equipmentId", "siteId", "tenantId")
  ON public."DeviceKey" TO pilingtrack_identity;

-- Отметка последнего использования ключа — и ничего больше. Отзыв ключа
-- идёт обычным путём приложения, под организацией.
GRANT UPDATE ("lastUsedAt") ON public."DeviceKey" TO pilingtrack_identity;

COMMIT;

-- Проверка: роль видит пользователя без выставленной организации, но не
-- может тронуть ничего сверх выданного.
--
--   SET ROLE pilingtrack_identity;
--   SELECT count(*) FROM "User";                 -- строки видны
--   UPDATE "User" SET role = 'ADMIN';            -- ошибка прав
--   SELECT count(*) FROM "Report";               -- ошибка прав
--   RESET ROLE;
