-- Seed Sites
INSERT INTO "Site" (id, name, "plannedPiles", "plannedDrilling", status, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Объект: ЖК Центральный', 500, 1200.0, 'ACTIVE', true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "Site" (id, name, "plannedPiles", "plannedDrilling", status, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Объект: Мост Волга', 200, 800.0, 'ACTIVE', true, now(), now())
ON CONFLICT DO NOTHING;

-- Get IDs for hierarchy
DO $$
DECLARE
  s1 TEXT;
  f1 TEXT;
  c1 TEXT;
  e1 TEXT;
  o1 TEXT;
BEGIN
  SELECT id INTO s1 FROM "Site" WHERE name LIKE '%Центральный%' LIMIT 1;
  IF s1 IS NOT NULL THEN
    INSERT INTO "PileField" (id, name, "siteId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Поле-1', s1, now(), now())
    ON CONFLICT DO NOTHING;
    SELECT id INTO f1 FROM "PileField" WHERE "siteId" = s1 LIMIT 1;
    IF f1 IS NOT NULL THEN
      INSERT INTO "Cluster" (id, name, "fieldId", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'Куст-1', f1, now(), now())
      ON CONFLICT DO NOTHING;
      SELECT id INTO c1 FROM "Cluster" WHERE "fieldId" = f1 LIMIT 1;
      IF c1 IS NOT NULL THEN
        INSERT INTO "Picket" (id, name, "clusterId", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'Пикет-1', c1, now(), now()),
               (gen_random_uuid(), 'Пикет-2', c1, now(), now()),
               (gen_random_uuid(), 'Пикет-3', c1, now(), now())
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  SELECT id INTO e1 FROM "Equipment" WHERE name = 'Установка-1' LIMIT 1;
  SELECT id INTO o1 FROM "User" WHERE email = 'operator@piling.ru' LIMIT 1;
  IF o1 IS NOT NULL AND e1 IS NOT NULL AND s1 IS NOT NULL THEN
    INSERT INTO "Crew" (id, name, "operatorId", "equipmentId", "siteId", "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Бригада-1', o1, e1, s1, true, now(), now())
    ON CONFLICT ("operatorId") DO NOTHING;
  END IF;
END $$;

SELECT 'Users: ' || count(*) FROM "User";
SELECT 'Sites: ' || count(*) FROM "Site";
SELECT 'Fields: ' || count(*) FROM "PileField";
SELECT 'Clusters: ' || count(*) FROM "Cluster";
SELECT 'Pickets: ' || count(*) FROM "Picket";
SELECT 'Crews: ' || count(*) FROM "Crew";
