-- Решение мастера по свае. Машинист забивает и записывает замеры; принимает
-- сваю мастер — он же решает, отправить ли её на добивку. Без этого поля отказ
-- больше проектного оставался числом в журнале, по которому никто ничего не
-- постановил.
CREATE TYPE "PileAcceptance" AS ENUM ('PENDING', 'ACCEPTED', 'NEEDS_REDRIVE');

ALTER TABLE "PilePassport"
  ADD COLUMN "acceptance" "PileAcceptance" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "acceptedById" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMPTZ(3),
  ADD COLUMN "acceptanceNote" TEXT;

-- Кто записал паспорт: машинист со смены или мастер за него. Различать нужно —
-- запись «со слов» имеет другой вес при разборе, чем сделанная на месте.
ALTER TABLE "PilePassport"
  ADD COLUMN "recordedByForeman" BOOLEAN NOT NULL DEFAULT false;

-- Разбор идёт по неразобранным: этот индекс и есть рабочий список мастера.
CREATE INDEX "PilePassport_tenantId_acceptance_idx" ON "PilePassport"("tenantId", "acceptance");
