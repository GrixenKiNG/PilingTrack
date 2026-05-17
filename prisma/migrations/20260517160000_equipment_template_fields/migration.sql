-- Equipment template fields per operator's unified spec sheet.
--
-- The list, in operator's own wording:
--   Серийник, Вес (т), Вес с оборудованием (т),
--   габариты для логистики (Высота, длина, ширина) — все в мм,
--   Марка двигателя, Номер двигателя, Мощность двигателя (кВт),
--   Макс. длина сваи (м), Макс. глубина бурения (м),
--   Тип молота, Серийник молота, Энергия удара (кДж),
--   Госномер.
--
-- Columns already present from prior migrations are reused:
--   serialNumber, weightTons, enginePower, maxPileLength,
--   maxDrillingDepth, hammerType, hammerEnergyKj, registrationNumber.

ALTER TABLE "Equipment"
  ADD COLUMN "weightWithEquipmentTons" DOUBLE PRECISION,
  ADD COLUMN "heightMm"                INTEGER,
  ADD COLUMN "lengthMm"                INTEGER,
  ADD COLUMN "widthMm"                 INTEGER,
  ADD COLUMN "engineBrand"             TEXT,
  ADD COLUMN "engineSerialNumber"      TEXT,
  ADD COLUMN "hammerSerialNumber"      TEXT;
