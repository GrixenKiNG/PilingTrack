-- Полный вердикт готовности рядом с его двоичной проекцией.
--
-- Домен считает четыре исхода (ALLOWED / CONFIRMATION_REQUIRED /
-- RETURN_TO_OPERATOR / DENIED), а снимок хранил только READY/BLOCKED. Три
-- разных исхода схлопывались в один красный статус: «нужно подтверждение
-- диспетчера» выглядело на экране так же, как «эксплуатация запрещена».
--
-- Колонка nullable и ничем не заполняется задним числом: снимок неизменяем,
-- и вычислять вердикт для прошлых строк из сохранённых блокеров означало бы
-- дописывать историю. Старые строки показываются по status, новые — по verdict.
ALTER TABLE "ReadinessScoreSnapshot" ADD COLUMN IF NOT EXISTS "verdict" TEXT;
ALTER TABLE "CurrentReadiness" ADD COLUMN IF NOT EXISTS "verdict" TEXT;
