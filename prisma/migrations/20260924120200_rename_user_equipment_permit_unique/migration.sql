-- Миграция 20260914100000 задала уникальному индексу имя длиннее 63 символов,
-- и Postgres обрезал его по-своему ("…equipmentM_ke"), а Prisma ждёт своё
-- сокращение ("…equipment_key"). Расхождение висело в каждом `migrate diff`.
-- Переименование индекса — мгновенная операция над каталогом, данные не трогает.
ALTER INDEX "UserEquipmentPermit_tenantId_userId_equipmentKind_equipmentM_ke" RENAME TO "UserEquipmentPermit_tenantId_userId_equipmentKind_equipment_key";
