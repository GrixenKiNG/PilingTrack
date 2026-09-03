-- Строгие политики на таблицах, оставшихся снаружи после перевода 19.08.2026.
--
-- Тогда закрыли 46 таблиц — все, у которых `tenantId` лежит прямо в строке и
-- которые читает приложение под сессией. Снаружи осталось 27, и они не
-- однородны: часть носит организацию своим полем, часть наследует её от
-- родителя, а две оставлены намеренно (см. ниже). Разбираем каждую группу
-- своим правилом, а не одним махом.
--
-- ФОРМА ПОЛИТИКИ повторяет ту, что уже стоит на 46 таблицах: строгое
-- равенство без «ИЛИ тенант не задан». Оговорка `IS NULL OR` — это ровно тот
-- шаблон, которым в этом продукте уже случался IDOR (CLAUDE.md, 31.05.2026):
-- запрос без организации возвращал бы строки ВСЕХ организаций вместо нуля.
-- Пустой результат — правильное поведение, а не потеря данных.

-- ============================================================
-- Шаг 0. Добор организации в старых строках выработки.
-- ============================================================
--
-- ЗАЧЕМ. `tenantId` у PileWork, LeaderDrilling и ReportDowntime появился
-- позже самих таблиц и объявлен необязательным, поэтому строки, записанные
-- до него, несут NULL. Строгая политика сравнивает `NULL = 'orion'` и
-- получает NULL — то есть «не подходит». Без этого шага из журнала и
-- аналитики молча пропали бы 167 свай, 89 записей бурения и 53 простоя:
-- ровно тот симптом, о котором предупреждает ранбук 012 — пустой экран
-- вместо ошибки.
--
-- Организацию берём у родительского отчёта: он её носит всегда (проверено —
-- ни одной строки Report с пустым tenantId), и другого правильного значения
-- у дочерней строки быть не может.
UPDATE "PileWork" w SET "tenantId" = r."tenantId"
  FROM "Report" r WHERE r.id = w."reportId" AND w."tenantId" IS NULL;
UPDATE "LeaderDrilling" w SET "tenantId" = r."tenantId"
  FROM "Report" r WHERE r.id = w."reportId" AND w."tenantId" IS NULL;
UPDATE "ReportDowntime" w SET "tenantId" = r."tenantId"
  FROM "Report" r WHERE r.id = w."reportId" AND w."tenantId" IS NULL;

-- ============================================================
-- Группа 1. Организация лежит в самой строке.
-- ============================================================
--
-- Четыре таблицы выработки и происшествий пишутся модулем смены внутри
-- тенантной транзакции и читаются отчётом и аналитикой под сессией — контекст
-- организации есть на обоих концах.
ALTER TABLE "PileWork" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PileWork" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_pile_work" ON "PileWork";
CREATE POLICY "tenant_isolation_pile_work" ON "PileWork" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "LeaderDrilling" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaderDrilling" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_leader_drilling" ON "LeaderDrilling";
CREATE POLICY "tenant_isolation_leader_drilling" ON "LeaderDrilling" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "ReportDowntime" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportDowntime" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_report_downtime" ON "ReportDowntime";
CREATE POLICY "tenant_isolation_report_downtime" ON "ReportDowntime" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "SafetyIncident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SafetyIncident" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_safety_incident" ON "SafetyIncident";
CREATE POLICY "tenant_isolation_safety_incident" ON "SafetyIncident" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "RepairVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairVerification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_repair_verification" ON "RepairVerification";
CREATE POLICY "tenant_isolation_repair_verification" ON "RepairVerification" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

-- Три таблицы автономного режима достались от удалённого модуля operator-v3:
-- кода, который бы их читал, в продукте больше нет. Закрываем всё равно —
-- пустая таблица без политики завтра наполнится новым кодом и окажется
-- открытой, а вспомнить про неё будет некому.
ALTER TABLE "OfflineWorkAuthorizationRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfflineWorkAuthorizationRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_offline_work_authorization" ON "OfflineWorkAuthorizationRecord";
CREATE POLICY "tenant_isolation_offline_work_authorization" ON "OfflineWorkAuthorizationRecord" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "ServerOfflineAuthorizationKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServerOfflineAuthorizationKey" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_server_offline_key" ON "ServerOfflineAuthorizationKey";
CREATE POLICY "tenant_isolation_server_offline_key" ON "ServerOfflineAuthorizationKey" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

ALTER TABLE "TrustedOperatorDeviceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrustedOperatorDeviceRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_trusted_operator_device" ON "TrustedOperatorDeviceRecord";
CREATE POLICY "tenant_isolation_trusted_operator_device" ON "TrustedOperatorDeviceRecord" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));

-- ============================================================
-- Группа 2. Организация наследуется от родителя.
-- ============================================================
--
-- У этих таблиц своего `tenantId` нет, и добавлять его значило бы завести
-- второй источник правды об одном факте: строка принадлежит той же
-- организации, что и её объект, отчёт или установка. Политика спрашивает
-- родителя подзапросом. Это дороже равенства по колонке, но родитель ищется
-- по первичному ключу, и на объёмах этого продукта разница неизмерима.

-- Иерархия работ: поле → куст → пикет. Организация — у объекта.
ALTER TABLE "PileField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PileField" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_pile_field" ON "PileField";
CREATE POLICY "tenant_isolation_pile_field" ON "PileField" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "PileField"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "Cluster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cluster" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_cluster" ON "Cluster";
CREATE POLICY "tenant_isolation_cluster" ON "Cluster" FOR ALL
  USING (EXISTS (SELECT 1 FROM "PileField" f JOIN "Site" s ON s.id = f."siteId"
                 WHERE f.id = "Cluster"."fieldId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "Picket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Picket" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_picket" ON "Picket";
CREATE POLICY "tenant_isolation_picket" ON "Picket" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Cluster" c JOIN "PileField" f ON f.id = c."fieldId"
                 JOIN "Site" s ON s.id = f."siteId"
                 WHERE c.id = "Picket"."clusterId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

-- Планы и сводки объекта.
ALTER TABLE "SitePilePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SitePilePlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_site_pile_plan" ON "SitePilePlan";
CREATE POLICY "tenant_isolation_site_pile_plan" ON "SitePilePlan" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "SitePilePlan"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "SiteDrillingPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteDrillingPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_site_drilling_plan" ON "SiteDrillingPlan";
CREATE POLICY "tenant_isolation_site_drilling_plan" ON "SiteDrillingPlan" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "SiteDrillingPlan"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "SiteDailySummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteDailySummary" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_site_daily_summary" ON "SiteDailySummary";
CREATE POLICY "tenant_isolation_site_daily_summary" ON "SiteDailySummary" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "SiteDailySummary"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "UserSiteAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSiteAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_user_site_assignment" ON "UserSiteAssignment";
CREATE POLICY "tenant_isolation_user_site_assignment" ON "UserSiteAssignment" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "UserSiteAssignment"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

-- Бригада принадлежит объекту; помощник — бригаде.
ALTER TABLE "Crew" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Crew" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_crew" ON "Crew";
CREATE POLICY "tenant_isolation_crew" ON "Crew" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Site" s WHERE s.id = "Crew"."siteId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "CrewAssistant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrewAssistant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_crew_assistant" ON "CrewAssistant";
CREATE POLICY "tenant_isolation_crew_assistant" ON "CrewAssistant" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Crew" c JOIN "Site" s ON s.id = c."siteId"
                 WHERE c.id = "CrewAssistant"."crewId"
                 AND s."tenantId" = current_setting('app.current_tenant', true)));

-- История отчёта: версии и аудит правок.
--
-- Связь идёт по ДЕЛОВОМУ ключу `Report.reportId`, а не по первичному `id`:
-- у отчёта два идентификатора, и эти две таблицы ссылаются на второй.
-- Внешнего ключа у них нет, поэтому ошибку здесь не поймал бы никто, кроме
-- проверки на живых данных: политика по `r.id` скрывала все 254 строки.
ALTER TABLE "ReportVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportVersion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_report_version" ON "ReportVersion";
CREATE POLICY "tenant_isolation_report_version" ON "ReportVersion" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Report" r WHERE r."reportId" = "ReportVersion"."reportId"
                 AND r."tenantId" = current_setting('app.current_tenant', true)));

ALTER TABLE "ReportAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportAudit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_report_audit" ON "ReportAudit";
CREATE POLICY "tenant_isolation_report_audit" ON "ReportAudit" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Report" r WHERE r."reportId" = "ReportAudit"."reportId"
                 AND r."tenantId" = current_setting('app.current_tenant', true)));

-- ============================================================
-- Что НАМЕРЕННО остаётся снаружи
-- ============================================================
--
-- `OutboxEvent` и `IdempotencyKey` — так решено при переводе 19.08.2026
-- (ранбук 012). Обе читаются фоновыми обработчиками, у которых организации
-- нет и быть не может: публикатор WebSocket разбирает очередь целиком, а ключ
-- идемпотентности проверяется до того, как запрос дошёл до тенантного
-- контекста. Строгая политика остановила бы проекции — и остановила бы молча,
-- вернув ноль строк вместо ошибки. Закрывать их можно только вместе с
-- переводом воркеров на роль опознания, и это отдельная работа.
--
-- `_prisma_migrations` — служебная таблица Prisma. Политика на ней сломала бы
-- накат следующей же миграции.
--
-- `Tenant` — реестр организаций. Строка «организация X» принадлежит самой X,
-- и правило здесь другое: `id = current_setting(...)`, а не `tenantId`.
-- Отдельно от этой миграции, вместе с решением, как реестр читает биллинг.
--
-- `RefreshToken`, `DeadLetterQueue`, `FeedbackEvent`, `FeedbackEventRead` —
-- организации не носят ни своим полем, ни через родителя. Токен принадлежит
-- пользователю, очередь недоставленного — инфраструктуре, лента событий —
-- всему стенду. Их изоляция требует сначала решить, чья это строка, а не
-- написать политику.
