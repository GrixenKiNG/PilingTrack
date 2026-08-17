-- Виды работ наряда-допуска: справочник вместо перечисления в коде.
--
-- Контекст. В наряде до сих пор был только `risk` (обычный / повышенный) —
-- голая категория без предметного смысла. Владелец попросил выбор вида работ
-- плитками (огневые, высотные, земляные, электро, грузоподъёмные, прочие) и
-- отдельно решил 16.08.2026, что список должен быть РЕДАКТИРУЕМЫМ: у разных
-- заказчиков свои перечни работ повышенной опасности.
--
-- Почему риск лежит здесь, а не в коде. Правило «огневые работы = повышенный
-- риск» напрашивается зашить в приложение. Но раз админ может завести свой вид
-- работ («работы в замкнутом пространстве»), захардкоженная таблица соответствий
-- о нём не знает — и новый, заведомо опасный вид работ молча получил бы обычный
-- риск и одну подпись вместо двух. Риск по умолчанию поэтому — колонка строки
-- справочника, которую админ заполняет вместе с названием.
--
-- hazardPresets — типовые опасные факторы вида работ. Владелец просил, чтобы
-- вписанный руками фактор можно было сохранить и переиспользовать; шаблон
-- живёт на виде работ, а не отдельной сущностью, потому что «открытый огонь»
-- осмыслен именно применительно к огневым работам.
--
-- RLS: режим аудита, как у всех справочников проекта (PileGrade, DrillingType,
-- UserDocumentType). К этой таблице ходит обычный сервис справочников, который
-- не устанавливает app.current_tenant; fail-closed политика вернула бы ему ноль
-- строк молча. Настоящая защита здесь — прикладной фильтр по tenantId.
-- Перевод в fail-closed — отдельное решение по ADR-0044.

CREATE TABLE "PermitWorkType" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "hint"           TEXT NOT NULL DEFAULT '',
  "icon"           TEXT NOT NULL DEFAULT '',
  "defaultRisk"    "WorkPermitRisk" NOT NULL DEFAULT 'NORMAL',
  "hazardPresets"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PermitWorkType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermitWorkType_tenantId_normalizedName_key"
  ON "PermitWorkType" ("tenantId", "normalizedName");
-- Составной ключ под FK наряда: связь идёт по паре [tenantId, id], чтобы база
-- сама запрещала сослаться на вид работ чужого тенанта. Тот же приём, что у
-- Shift и WorkPermit.
CREATE UNIQUE INDEX "PermitWorkType_tenantId_id_key"
  ON "PermitWorkType" ("tenantId", "id");
-- Рабочий запрос формы: активные виды работ по порядку показа.
CREATE INDEX "PermitWorkType_tenantId_isActive_sortOrder_idx"
  ON "PermitWorkType" ("tenantId", "isActive", "sortOrder");

ALTER TABLE "PermitWorkType" ADD CONSTRAINT "PermitWorkType_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PermitWorkType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PermitWorkType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permitworktype ON "PermitWorkType"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

-- Засев шести видов работ из макета — каждому существующему тенанту.
--
-- Риск по умолчанию расставлен по тому, требует ли вид работ наряда-допуска по
-- правилам работ повышенной опасности. Земляные оставлены обычными намеренно:
-- опасными они становятся при глубине или рядом с коммуникациями, а не всегда,
-- и это решение конкретного наряда — риск в форме остаётся поднимаемым вручную.
-- Админ может изменить любую из этих строк, на то и справочник.
INSERT INTO "PermitWorkType" (
  "id", "tenantId", "name", "normalizedName", "hint", "icon",
  "defaultRisk", "hazardPresets", "sortOrder", "updatedAt"
)
SELECT
  'pwt_' || replace(gen_random_uuid()::text, '-', ''),
  t."id",
  v."name",
  v."normalizedName",
  v."hint",
  v."icon",
  v."defaultRisk"::"WorkPermitRisk",
  v."hazardPresets",
  v."sortOrder",
  CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('Огневые работы', 'огневые работы', 'Сварка, резка, пайка', 'flame', 'ELEVATED',
   ARRAY['Открытый огонь', 'Высокая температура', 'Искры и брызги металла', 'Давление в системе'], 1),
  ('Высотные работы', 'высотные работы', 'Работы на высоте', 'height', 'ELEVATED',
   ARRAY['Падение с высоты', 'Падение предметов', 'Неустойчивая опора'], 2),
  ('Земляные работы', 'земляные работы', 'Разработка грунта', 'ground', 'NORMAL',
   ARRAY['Обрушение стенок выемки', 'Подземные коммуникации', 'Работа техники в котловане'], 3),
  ('Электроработы', 'электроработы', 'Работы с электрикой', 'electric', 'ELEVATED',
   ARRAY['Поражение электрическим током', 'Наведённое напряжение', 'Электрическая дуга'], 4),
  ('Грузоподъёмные работы', 'грузоподъёмные работы', 'Подъём и перемещение грузов', 'crane', 'ELEVATED',
   ARRAY['Падение груза', 'Опрокидывание техники', 'Нахождение под стрелой'], 5),
  ('Другие работы', 'другие работы', 'Прочие виды работ', 'other', 'NORMAL',
   ARRAY[]::TEXT[], 6)
) AS v("name", "normalizedName", "hint", "icon", "defaultRisk", "hazardPresets", "sortOrder")
ON CONFLICT ("tenantId", "normalizedName") DO NOTHING;
