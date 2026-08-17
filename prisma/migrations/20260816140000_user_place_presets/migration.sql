-- Личные шаблоны мест работ.
--
-- Контекст. В макете наряда «Место работы» и «Объект» — выпадающие списки, но
-- владелец уточнил (16.08.2026), что вписывать их всё равно придётся руками:
-- места меняются, и заранее их никто не перечислит. Просьба была другая — чтобы
-- одно и то же не приходилось набирать по сто раз, и чтобы учитывалось, что у
-- одного человека таких мест и баз может быть много.
--
-- Отсюда форма решения: не справочник организации, а личный список, который
-- растёт сам. Пользователь вписал место, нажал «сохранить» — и дальше оно есть
-- в подсказках. Общий справочник тут был бы хуже: админу пришлось бы заводить
-- площадки наперёд, а чужие площадки засоряли бы подсказки.
--
-- Хранится ПАРОЙ «место + объект», а не двумя списками: на практике они ходят
-- вместе («Площадка 3» на «Промышленном комплексе»), и выбор одной строки
-- заполняет оба поля сразу.
--
-- В сам наряд копируется ТЕКСТ, ссылки на эту таблицу у наряда нет. Наряд —
-- документ: удаление шаблона не должно менять то, что уже подписано.
--
-- Связь идёт парой [tenantId, userId], чтобы база сама запрещала шаблон,
-- приписанный пользователю чужой организации. CASCADE — данные личные и
-- вспомогательные: удалили работника, ушли и его подсказки.
--
-- RLS: режим аудита, как у прочих таблиц, к которым ходят обычные сервисы без
-- app.current_tenant. Настоящая защита — прикладной фильтр по tenantId И userId:
-- личный список чужим не показывается в принципе.

CREATE TABLE "UserPlacePreset" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "location"      TEXT NOT NULL,
  "objectName"    TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "usedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "UserPlacePreset_pkey" PRIMARY KEY ("id")
);

-- Защита от дублей: «Площадка 3» и «площадка 3» — одно и то же место.
CREATE UNIQUE INDEX "UserPlacePreset_tenantId_userId_normalizedKey_key"
  ON "UserPlacePreset" ("tenantId", "userId", "normalizedKey");
-- Рабочий запрос подсказок: мои шаблоны, недавние первыми.
CREATE INDEX "UserPlacePreset_tenantId_userId_usedAt_idx"
  ON "UserPlacePreset" ("tenantId", "userId", "usedAt");

ALTER TABLE "UserPlacePreset" ADD CONSTRAINT "UserPlacePreset_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPlacePreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserPlacePreset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_userplacepreset ON "UserPlacePreset"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
