-- Документы работника: допуск людей к работе.
--
-- Документы техники (EquipmentDocument) в системе были с самого начала,
-- документов людей — нет. Права на управление установкой, медосмотр,
-- удостоверение по охране труда нигде не хранились и по срокам не
-- контролировались: диспетчеру было нечего проверять, оператору нечего
-- прикладывать.
--
-- Вид документа вынесен в справочник, а не в enum: список задаётся
-- законодательством и заказчиком и будет пополняться. Enum потребовал бы
-- релиза на каждый новый вид.
--
-- RLS: обе таблицы в режиме аудита — политика пропускает запрос, если тенант
-- не назван, как у всех таблиц, к которым ходят обычные сервисы, не
-- устанавливающие app.current_tenant. Настоящая защита здесь — прикладной
-- фильтр по tenantId. Перевод в fail-closed — отдельное решение по ADR-0044.

CREATE TABLE "UserDocumentType" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "normalizedName"     TEXT NOT NULL,
  "requiresExpiry"     BOOLEAN NOT NULL DEFAULT true,
  "defaultValidMonths" INTEGER,
  "leadTimeDays"       INTEGER NOT NULL DEFAULT 30,
  "isActive"           BOOLEAN NOT NULL DEFAULT true,
  "notes"              TEXT NOT NULL DEFAULT '',
  "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "UserDocumentType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserDocument" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "typeId"    TEXT NOT NULL,
  "number"    TEXT NOT NULL DEFAULT '',
  "issuedAt"  TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "mediaId"   TEXT,
  "notes"     TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDocumentType_tenantId_normalizedName_key"
  ON "UserDocumentType" ("tenantId", "normalizedName");
CREATE INDEX "UserDocumentType_tenantId_isActive_idx"
  ON "UserDocumentType" ("tenantId", "isActive");

CREATE INDEX "UserDocument_tenantId_userId_idx"    ON "UserDocument" ("tenantId", "userId");
-- Основной рабочий запрос диспетчера: «что просрочено и что истекает».
CREATE INDEX "UserDocument_tenantId_expiresAt_idx" ON "UserDocument" ("tenantId", "expiresAt");
CREATE INDEX "UserDocument_tenantId_typeId_idx"    ON "UserDocument" ("tenantId", "typeId");

ALTER TABLE "UserDocumentType" ADD CONSTRAINT "UserDocumentType_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Удаление работника уносит его документы: без работника они бессмысленны.
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Вид документа удалить нельзя, пока по нему есть документы: Restrict, как у
-- остальных справочников проекта.
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "UserDocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserDocumentType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserDocumentType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_userdocumenttype ON "UserDocumentType"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

ALTER TABLE "UserDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_userdocument ON "UserDocument"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
