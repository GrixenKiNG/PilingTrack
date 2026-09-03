-- Поправка вправе быть отрицательной, обычная запись — нет.
--
-- Проверки `count > 0`, `meters >= 0`, `duration >= 0` защищают от опечатки в
-- обычной записи: минус пять свай никто не забивал. Но поправка — это как раз
-- разница, и у ошибки «вбил 15 вместо 5» она равна −10. Правило не отменяем, а
-- уточняем: отрицательным может быть только то, что ссылается на исправляемую
-- запись. Ноль по-прежнему запрещён везде — поправка на ноль ничего не меняет
-- и означала бы, что человек нажал кнопку впустую.
ALTER TABLE "PileWork" DROP CONSTRAINT IF EXISTS "chk_pile_count_positive";
ALTER TABLE "PileWork" ADD CONSTRAINT "chk_pile_count_positive"
  CHECK (CASE WHEN "correctsId" IS NULL THEN count > 0 ELSE count <> 0 END);

ALTER TABLE "LeaderDrilling" DROP CONSTRAINT IF EXISTS "chk_drilling_meters_positive";
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT "chk_drilling_meters_positive"
  CHECK (CASE WHEN "correctsId" IS NULL THEN meters >= 0 ELSE true END);

ALTER TABLE "ReportDowntime" DROP CONSTRAINT IF EXISTS "chk_downtime_duration_positive";
ALTER TABLE "ReportDowntime" ADD CONSTRAINT "chk_downtime_duration_positive"
  CHECK (CASE WHEN "correctsId" IS NULL THEN duration >= 0 ELSE duration <> 0 END);
