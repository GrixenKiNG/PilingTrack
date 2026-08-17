-- Наряд-допуск: поля формы оформления (вид работ, наименование, место,
-- опасные факторы, ответственные лица).
--
-- Контекст. До сих пор весь наряд помещался в одно текстовое поле `scope`
-- («состав и границы работ») плюс риск и срок. Владелец принёс макет
-- «Создание наряда-допуска», где содержание разложено на пять разделов, и это
-- не перекраска: половины полей в базе не существовало.
--
-- Почему всё добавлено со значениями по умолчанию и без переписывания данных.
-- На проде живут уже выписанные наряды. Сделать колонки обязательными значило
-- бы придумать за прошлое: подставить кому-то «производителя работ», которого
-- в том наряде не назначали. Поэтому в БАЗЕ поля необязательны, а
-- обязательность новых нарядов включена в валидации команды создания. Старый
-- наряд остаётся честно неполным, новый — полным.
--
-- workTypeId связан парой [tenantId, id], а не одним id: так база сама
-- запрещает сослаться на вид работ чужой организации. RESTRICT — тот же
-- барьер, что у остальных справочников: пока по виду работ есть наряды, его
-- нельзя удалить, только архивировать.
--
-- У трёх ответственных лиц ВНЕШНЕГО КЛЮЧА НЕТ — намеренно, как у соседних
-- authorId и revokedById. ФИО хранится отдельной колонкой и заполняется всегда,
-- даже когда выбран пользователь: наряд это документ, и он не должен меняться
-- задним числом от переименования или удаления учётной записи. Ссылка на
-- учётку — вспомогательная, ФИО — то, что подписано.

ALTER TABLE "WorkPermit"
  ADD COLUMN "workTypeId"     TEXT,
  ADD COLUMN "title"          TEXT NOT NULL DEFAULT '',
  ADD COLUMN "location"       TEXT NOT NULL DEFAULT '',
  ADD COLUMN "objectName"     TEXT NOT NULL DEFAULT '',
  ADD COLUMN "hazards"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "producerUserId" TEXT,
  ADD COLUMN "producerName"   TEXT NOT NULL DEFAULT '',
  ADD COLUMN "observerUserId" TEXT,
  ADD COLUMN "observerName"   TEXT NOT NULL DEFAULT '',
  ADD COLUMN "safetyUserId"   TEXT,
  ADD COLUMN "safetyName"     TEXT NOT NULL DEFAULT '';

ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_tenantId_workTypeId_fkey"
  FOREIGN KEY ("tenantId", "workTypeId") REFERENCES "PermitWorkType"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Под защиту справочника: «вид работ используется, удаление недоступно».
CREATE INDEX "WorkPermit_tenantId_workTypeId_idx"
  ON "WorkPermit" ("tenantId", "workTypeId");
