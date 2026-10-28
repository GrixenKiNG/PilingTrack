-- Паспорт сваи нельзя удалить каскадом вместе с записью выработки и отчётом.
-- Паспорт — исполнительный документ; след удаления отчёта хранит только суммы дня.
-- Откат: вернуть ON DELETE CASCADE.

-- Предпроверка: ключ создаётся заново, значит паспортов без записи выработки быть не должно.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PilePassport" p
    WHERE NOT EXISTS (SELECT 1 FROM "PileWork" w WHERE w."id" = p."pileWorkId")
  ) THEN
    RAISE EXCEPTION 'PilePassport без записи PileWork: исправьте данные до миграции';
  END IF;
END $$;

ALTER TABLE "PilePassport" DROP CONSTRAINT "PilePassport_pileWorkId_fkey";
ALTER TABLE "PilePassport"
  ADD CONSTRAINT "PilePassport_pileWorkId_fkey"
  FOREIGN KEY ("pileWorkId") REFERENCES "PileWork"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
