-- Строгая политика организации на журнале инструктажей.
--
-- ЗАЧЕМ. `BriefingRecord` создана 13.09.2026, позже перевода на строгие
-- политики (19.08 и 03.09), и в тот список не попала: у таблицы есть
-- `tenantId NOT NULL`, но защиты на уровне базы не было — организацию
-- отделял только фильтр в коде. Найдено внешним аудитом 10–12.10.2026.
--
-- ФОРМА ПОЛИТИКИ та же, что на остальных таблицах (миграция 20260903000000):
-- строгое равенство без «ИЛИ организация не задана». Запрос без контекста
-- организации вернёт ноль строк, а не строки всех организаций.
--
-- КТО ЧИТАЕТ. Только маршруты API (`/api/briefings`, `/api/briefings/journal`,
-- `/api/safety/*`) и команда допуска машиниста внутри тенантной транзакции —
-- контекст организации есть на всех концах. Воркеры таблицу не трогают.
ALTER TABLE "BriefingRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BriefingRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_briefing_record" ON "BriefingRecord";
CREATE POLICY "tenant_isolation_briefing_record" ON "BriefingRecord" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
