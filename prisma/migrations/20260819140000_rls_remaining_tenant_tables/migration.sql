-- RLS на трёх последних таблицах с колонкой tenantId.
--
-- ЧТО БЫЛО. Миграция 20260808140000 обошла их стороной с формулировкой
-- «очереди и служебные журналы: воркеры разбирают их сквозь все тенанты, и
-- FORCE RLS мог бы молча урезать выборку». Для очередей это верно. Для этих
-- трёх — нет, и проверка это показала:
--
--   ReadinessAccessMatrix     — только маршруты /api/readiness/*, каждый
--                               вызов уже принимает tenantId параметром и
--                               падает без него (access-matrix-service.ts).
--   TenantAuditChain          — только внутри withReadinessTenantTransaction,
--                               которая сама выставляет app.current_tenant и
--                               падает, если он не установился.
--   ReadinessBackfillProgress — только служба дозаполнения, вызываемая по
--                               одной организации за раз.
--
-- Ни одного обхода «сквозь все тенанты» ни у одной из трёх нет. Формулировка
-- 2026-08-08 была верна для очередей и по инерции распространена на соседей.
--
-- ЧТО ОСТАЁТСЯ БЕЗ RLS. OutboxEvent и IdempotencyKey. У обеих tenantId
-- допускает пустоту, то есть строгое сравнение прятало бы строки навсегда, а
-- воркер публикации действительно разбирает очередь сквозь все организации —
-- он только из строки и узнаёт, чья она. IdempotencyKey вдобавок мертва:
-- пять экспортов, ноль вызывающих; её правильно удалить вместе с кодом, а не
-- защищать. Разбор — ADR-0046, раздел «Что осталось».
--
-- Политика строгая сразу, без промежуточного режима аудита: у всех трёх
-- tenantId объявлен NOT NULL, а пути доступа перечислены выше поимённо.

DO $$
DECLARE
  tbl text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ReadinessAccessMatrix', 'ReadinessBackfillProgress', 'TenantAuditChain'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    pol := 'tenant_isolation_' || lower(tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant'', true))',
      pol, tbl
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;
