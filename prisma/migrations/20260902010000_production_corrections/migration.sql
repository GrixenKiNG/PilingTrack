-- Исправление ошибочной выработки поправкой, а не удалением.
--
-- ПОЧЕМУ НЕ РЕДАКТИРОВАНИЕ. Машинист, вбивший 15 свай вместо 5, до сих пор не
-- мог сделать ничего: удаление записей убрали намеренно (стёртая выработка не
-- оставляет следа), а правки на месте не было. Правка на месте и не годится:
-- она стирает то, что человек написал на самом деле, и через месяц по журналу
-- нельзя понять, была ли ошибка ввода или кто-то подчистил смену.
--
-- ПОЧЕМУ ВСТРЕЧНАЯ ЗАПИСЬ. Поправка — это отдельная строка на разницу
-- (те самые −10 свай) со ссылкой на исходную и обязательной причиной.
-- Исходная не меняется. Главное следствие: все, кто уже считает суммой —
-- отчёт, аналитика, проекции, экран машиниста, — получают верный итог без
-- единой правки в них. Схема «пометить старую и вставить новую» потребовала бы
-- изменить каждого читателя, и первый же забытый показывал бы двойной объём.
ALTER TABLE "PileWork"
  ADD COLUMN IF NOT EXISTS "correctsId" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionNote" TEXT;

ALTER TABLE "LeaderDrilling"
  ADD COLUMN IF NOT EXISTS "correctsId" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionNote" TEXT;

ALTER TABLE "ReportDowntime"
  ADD COLUMN IF NOT EXISTS "correctsId" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionNote" TEXT;

-- «Какие поправки уже есть к этой записи» — запрос, который делает сервер
-- перед каждой новой поправкой, чтобы считать разницу от текущего итога.
CREATE INDEX IF NOT EXISTS "PileWork_corrects_idx" ON "PileWork" ("correctsId");
CREATE INDEX IF NOT EXISTS "LeaderDrilling_corrects_idx" ON "LeaderDrilling" ("correctsId");
CREATE INDEX IF NOT EXISTS "ReportDowntime_corrects_idx" ON "ReportDowntime" ("correctsId");

-- Поправка обязана объясняться. Без этого «поправка» ничем не отличается от
-- тихой подчистки смены.
ALTER TABLE "PileWork" DROP CONSTRAINT IF EXISTS "PileWork_correction_needs_note";
ALTER TABLE "PileWork" ADD CONSTRAINT "PileWork_correction_needs_note"
  CHECK ("correctsId" IS NULL OR ("correctionNote" IS NOT NULL AND length(btrim("correctionNote")) >= 3));

ALTER TABLE "LeaderDrilling" DROP CONSTRAINT IF EXISTS "LeaderDrilling_correction_needs_note";
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT "LeaderDrilling_correction_needs_note"
  CHECK ("correctsId" IS NULL OR ("correctionNote" IS NOT NULL AND length(btrim("correctionNote")) >= 3));

ALTER TABLE "ReportDowntime" DROP CONSTRAINT IF EXISTS "ReportDowntime_correction_needs_note";
ALTER TABLE "ReportDowntime" ADD CONSTRAINT "ReportDowntime_correction_needs_note"
  CHECK ("correctsId" IS NULL OR ("correctionNote" IS NOT NULL AND length(btrim("correctionNote")) >= 3));
