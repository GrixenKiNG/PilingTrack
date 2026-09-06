-- Одна проверка роли вместо двух.
--
-- На "User"."role" стояли ДВЕ CHECK-проверки с разными списками:
--   User_role_readiness_check → ADMIN, DISPATCHER, OPERATOR, ASSISTANT, MECHANIC
--   chk_user_role_valid       → ADMIN, DISPATCHER, OPERATOR, ASSISTANT
-- Проходить нужно обе, поэтому механика завести было нельзя (падал на второй),
-- а мастера и инженера ОТ — нельзя вдвойне (падали на обеих). Приложение при
-- этом предлагало все семь ролей в форме создания пользователя: список ролей
-- имел двух владельцев, и они разошлись.
--
-- Вторая проверка пришла из scripts/postgres-production-hardening.sql, где была
-- записана на момент четырёх ролей; скрипт обновлён тем же коммитом, иначе
-- повторный прогон вернул бы устаревший список.
--
-- Существующие строки под новый список подходят заведомо: он шире обоих
-- прежних. NOT VALID + VALIDATE — чтобы не держать долгую блокировку таблицы.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_readiness_check";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "chk_user_role_valid";

ALTER TABLE "User"
  ADD CONSTRAINT "chk_user_role_valid"
  CHECK ("role" IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER'))
  NOT VALID;

ALTER TABLE "User" VALIDATE CONSTRAINT "chk_user_role_valid";
