-- Обязательность документа для допуска оператора к смене.
--
-- По умолчанию false: включение обязательности останавливает работу людей,
-- и решать это должен администратор осознанно, а не миграция за него.
ALTER TABLE "UserDocumentType"
  ADD COLUMN IF NOT EXISTS "requiredForOperator" BOOLEAN NOT NULL DEFAULT false;
