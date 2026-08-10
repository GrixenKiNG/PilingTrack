-- Закрыть записи ТО, чей осмотр давно завершён.
--
-- Запись ТО заводится вместе с осмотром (startToInspection) и с 2026-08-10
-- закрывается вместе с ним. До этой правки закрытия не было вовсе: каждый
-- сменный осмотр навсегда оставлял запись «в работе». Журнал обслуживания
-- копил мнимые незакрытые работы, а производная готовность объявляла машину
-- требующей внимания сразу после успешного осмотра.
--
-- Скрипт разовый и идемпотентный: трогает только записи, у которых осмотр
-- уже COMPLETED, а сама запись ещё не DONE. Записи с осмотром в черновике
-- остаются в работе — они и правда не закончены.
--
-- Локально:
--   docker compose exec postgres psql -U piling -d pilingtrack \
--     -f /scripts/backfill-close-inspection-maintenance.sql
-- На проде: сначала посмотреть, что попадёт под правку (первый SELECT),
-- затем выполнить файл целиком.

BEGIN;

-- Что будет изменено — посмотреть перед фиксацией.
SELECT m.id, m."equipmentId", m.type, m.status, i."inspectionDate"
FROM "MaintenanceRecord" m
JOIN "Inspection" i ON i."maintenanceRecordId" = m.id
WHERE i.status = 'COMPLETED' AND m.status <> 'DONE'
ORDER BY i."inspectionDate";

UPDATE "MaintenanceRecord" m
SET status = 'DONE',
    -- Датой выполнения берём подпись осмотра, а не «сейчас»: работа
    -- закончилась тогда, и отчётность за прошлые периоды не должна поехать.
    "completedAt" = COALESCE(i."signedAt", i."inspectionDate"),
    "engineHoursAtService" = COALESCE(m."engineHoursAtService", i."engineHours"),
    "updatedAt" = NOW()
FROM "Inspection" i
WHERE i."maintenanceRecordId" = m.id
  AND i.status = 'COMPLETED'
  AND m.status <> 'DONE';

-- Контроль: незакрытых записей с завершённым осмотром остаться не должно.
SELECT count(*) AS "остаток_незакрытых"
FROM "MaintenanceRecord" m
JOIN "Inspection" i ON i."maintenanceRecordId" = m.id
WHERE i.status = 'COMPLETED' AND m.status <> 'DONE';

COMMIT;
