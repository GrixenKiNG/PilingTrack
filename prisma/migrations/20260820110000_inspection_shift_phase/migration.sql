-- Осмотр знает свою смену и фазу.
--
-- ЗАЧЕМ. Ежесменный осмотр проводится дважды: перед работой и после неё.
-- Без пары «смена + фаза» два осмотра одной смены неразличимы, а значит
-- нельзя сказать главного — что изменилось в машине за смену. Сравнение
-- «гидравлика: норма → течь» появляется именно отсюда.
--
-- ПОЧЕМУ NULLABLE. Осмотры до 20.08.2026 смены не знают. Плановое ТО механика
-- к смене не привязано вовсе и останется с null — это нормальное состояние,
-- а не пропуск данных.
--
-- PRE_SHIFT ПО УМОЛЧАНИЮ. Все существующие осмотры — предсменные: другой
-- фазы до сегодняшнего дня в системе не существовало.
--
-- RLS не трогаем: политика у таблицы уже есть, колонки её не меняют.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InspectionPhase') THEN
    CREATE TYPE "InspectionPhase" AS ENUM ('PRE_SHIFT', 'POST_SHIFT');
  END IF;
END $$;

ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "shiftId" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "phase" "InspectionPhase" NOT NULL DEFAULT 'PRE_SHIFT';

CREATE INDEX IF NOT EXISTS "Inspection_tenantId_shiftId_phase_idx"
  ON "Inspection" ("tenantId", "shiftId", "phase");
