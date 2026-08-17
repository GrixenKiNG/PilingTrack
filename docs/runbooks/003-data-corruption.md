# Runbook: Data Corruption

| Metadata | Value |
|----------|-------|
| **Severity** | 🔴 P0 — Critical |
| **Impact** | Нельзя доверять данным, неверная аналитика |
| **SLA** | Восстановление < 1 час |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose. НЕ Kubernetes.

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
alias psql='dc exec postgres psql -U piling -d pilingtrack'
```

> **Таблицы техготовности требуют назвать тенанта.** С миграции
> `20260813030000_readiness_rls_fail_closed` политики `Shift`, `ShiftHandover`,
> `WorkPermit`, `WorkPermitApproval`, `ReadinessScoreSnapshot`,
> `CurrentReadiness` закрыты наглухо, и `FORCE ROW LEVEL SECURITY` действует в
> том числе на владельца таблиц. Поэтому `SELECT * FROM "Shift"` вернёт **0
> строк**, пока в начале сессии не сказано:
>
> ```sql
> SET app.current_tenant = 'orion';
> ```
>
> Пустая выборка здесь — не потеря данных. Первое, что нужно проверить, увидев
> ноль строк на этих шести таблицах. Обоснование охвата: ADR-0044.

---

## Симптомы

- Отчёты с некорректными агрегатами (суммы не сходятся)
- Дубликаты записей
- Проекции (аналитика) расходятся с источником (`Report`)
- Потерянные записи

---

## Диагностика

```bash
# 1. Дубликаты reportId (должно быть 0 строк)
psql -c 'SELECT "reportId", count(*) FROM "Report"
         GROUP BY "reportId" HAVING count(*) > 1;'

# 2. Битые версии (version всегда >= 1)
psql -c 'SELECT id, "reportId", version FROM "Report" WHERE version < 1;'

# 3. Outbox backlog — события могли не доехать до проекций
psql -c 'SELECT
           count(*) FILTER (WHERE published = false) AS unpublished,
           count(*) FILTER (WHERE projected = false) AS unprojected
         FROM "OutboxEvent";'

# 4. DLQ — упавшие события (см. runbook 004)
psql -c 'SELECT status, count(*) FROM "DeadLetterQueue" GROUP BY status;'

# 5. Проекции vs источник — расхождение по числу отчётов
psql -c 'SELECT
           (SELECT count(*) FROM "Report")          AS reports,
           (SELECT count(*) FROM "ReportAnalytics") AS analytics;'
# Если analytics заметно меньше reports — проекции отстали или битые
```

---

## Восстановление

### Вариант 1 — проекции отстали/битые: пересборка (самое частое)

Проекции (`ReportAnalytics` и т.п.) — это ПРОИЗВОДНЫЕ от `Report`. Их можно
безопасно пересобрать из источника, не трогая сами отчёты:

```bash
# Через админский API (нужен admin-токен)
curl -s -X POST -H "Cookie: <admin-session>" \
  https://orionpiling.ru/api/admin/projections/rebuild

# Либо бэкфилл-скрипт (см. package.json):
npm run backfill:analytics
```

Это решает большинство случаев «аналитика врёт» без восстановления БД.

### Вариант 2 — повреждён сам источник: PITR restore

Если повреждены строки `Report` (не проекции) — восстановление на момент
ДО повреждения. Полная процедура в **runbook 009 (PITR)**: останавливаем
app, разворачиваем базовый бэкап, replay WAL до нужной секунды.

Определить «нужную секунду» помогает поиск когда появилось повреждение:
```bash
psql -c 'SELECT "reportId", version, "updatedAt" FROM "Report"
         WHERE "reportId" IN (
           SELECT "reportId" FROM "Report" GROUP BY "reportId" HAVING count(*)>1
         ) ORDER BY "updatedAt" DESC LIMIT 20;'
```

### Вариант 3 — точечное ручное исправление

⚠️ Только если точно понимаете причину. Сначала бэкап текущего состояния
(`dc exec postgres pg_dump ...`), потом правка. Пример — снять дубликаты,
оставив максимальную версию:

```sql
-- ВНАЧАЛЕ посмотреть что удалится
SELECT id, "reportId", version FROM (
  SELECT id, "reportId", version,
         ROW_NUMBER() OVER (PARTITION BY "reportId" ORDER BY version DESC) rn
  FROM "Report"
) s WHERE rn > 1;

-- Если согласны — удалить старые дубликаты
DELETE FROM "Report" WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "reportId" ORDER BY version DESC) rn
    FROM "Report"
  ) s WHERE rn > 1
);
```

После любой ручной правки `Report` — пересоберите проекции (Вариант 1).

---

## Проверка

```bash
# Дубликатов нет
psql -c 'SELECT "reportId", count(*) FROM "Report"
         GROUP BY "reportId" HAVING count(*) > 1;'

# Проекции сошлись с источником
psql -c 'SELECT
           (SELECT count(*) FROM "Report") AS reports,
           (SELECT count(*) FROM "ReportAnalytics") AS analytics;'
```

---

## Post-Incident

- [ ] Как возникло повреждение? (баг в upsert? гонка? ручная правка?)
- [ ] Добавить тест, воспроизводящий причину
- [ ] Если повреждение от событийной рассинхронизации — проверить DLQ (004)

---

## Проверка изоляции тенанта (RLS)

Суперпользователь обходит RLS **всегда**, даже при `FORCE`. Поэтому проверять
политики из-под `postgres` (или из-под `piling`, если это суперпользователь)
бессмысленно — выборка всегда полная, и это ничего не доказывает.

Сначала выяснить, действует ли RLS вообще:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('piling','postgres','pilingtrack_app');
```

`rolsuper = t` у роли приложения означает, что вся работа по RLS на этом
контуре декоративна (см. открытый вопрос в ADR-0044).

**Если роль `pilingtrack_app` уже заведена** (ранбук 011), проверка — готовым
скриптом, он же покажет и права:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack < scripts/app-role-verify.sql
```

Ниже — та же проверка вручную, временной ролью; годится и до появления
`pilingtrack_app`:

```sql
CREATE ROLE rls_probe LOGIN PASSWORD 'probe';
GRANT USAGE ON SCHEMA public TO rls_probe;
GRANT SELECT ON "CurrentReadiness", "Shift", "Equipment" TO rls_probe;

SET ROLE rls_probe;
-- 1. Без тенанта: закрытые таблицы дают 0, Equipment (режим аудита) — всё
SELECT count(*) FROM "CurrentReadiness";   -- ожидаем 0
SELECT count(*) FROM "Equipment";          -- ожидаем полное число
-- 2. Со своим тенантом — свои строки
SET app.current_tenant = 'orion';
SELECT count(*) FROM "CurrentReadiness";   -- ожидаем > 0
-- 3. С чужим — ноль
SET app.current_tenant = 'somebody-else';
SELECT count(*) FROM "CurrentReadiness";   -- ожидаем 0
RESET ROLE;

REVOKE ALL ON "CurrentReadiness", "Shift", "Equipment" FROM rls_probe;
REVOKE USAGE ON SCHEMA public FROM rls_probe;
DROP ROLE rls_probe;
```

Пройдено локально 13.08.2026: 0 / 9 / 0 при 9 видимых `Equipment` в первом шаге.

---

## Prevention

- **Идемпотентность:** UNIQUE на `(scope, key)` в IdempotencyKey
- **Optimistic locking:** `version` на `Report`
- **PITR + ночной dump** — оба активны (006, 009)
- **Проекции пересобираемы** — источник истины это `Report`, аналитика производна
