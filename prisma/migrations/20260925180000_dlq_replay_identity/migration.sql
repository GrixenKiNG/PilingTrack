-- DLQ хранит, чьё это событие и какой потребитель на нём упал, чтобы повтор
-- воссоздавал его с тем же tenantId/aggregateType и не будил второго потребителя.
-- Колонки допускают NULL: старые строки остаются повторяемыми как раньше.
ALTER TABLE "DeadLetterQueue" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "DeadLetterQueue" ADD COLUMN "aggregateType" TEXT;
ALTER TABLE "DeadLetterQueue" ADD COLUMN "consumer" TEXT;
