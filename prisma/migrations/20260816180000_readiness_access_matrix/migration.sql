-- Матрица доступов контура готовности, редактируемая владельцем.
--
-- До этого «роль → полномочия» жила единственной таблицей в коде
-- (ROLE_ABILITIES в capabilities.ts). Экран «Роли и доступы» только показывал
-- её, а изменить состав прав можно было лишь правкой исходников и деплоем.
--
-- Жизненный цикл повторяет ReadinessRuleSet намеренно: это такая же политика
-- организации, и владелец уже знает приём «черновик → опубликовать». Пустая
-- таблица означает «действуют значения из кода», поэтому миграция ничего не
-- заполняет: поведение до первой публикации не меняется.
CREATE TABLE "ReadinessAccessMatrix" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "version"     TEXT NOT NULL,
  "grants"      JSONB NOT NULL,
  "updatedBy"   TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReadinessAccessMatrix_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReadinessAccessMatrix_tenantId_idx" ON "ReadinessAccessMatrix" ("tenantId");
CREATE INDEX "ReadinessAccessMatrix_tenantId_status_idx" ON "ReadinessAccessMatrix" ("tenantId", "status");
