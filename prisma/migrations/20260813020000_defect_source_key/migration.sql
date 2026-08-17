-- Ключ источника дефекта: пара «установка + пункт чек-листа».
--
-- По нему завершение осмотра узнаёт уже открытый дефект и не заводит дубль.
-- Без этого одна незакрытая течь давала бы новую запись каждую смену, и
-- журнал дефектов, который только начал показываться в интерфейсе, утонул бы
-- за неделю.
ALTER TABLE "EquipmentDefect" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;
CREATE INDEX IF NOT EXISTS "EquipmentDefect_tenantId_sourceKey_status_idx"
  ON "EquipmentDefect" ("tenantId", "sourceKey", "status");
