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

## Prevention

- **Идемпотентность:** UNIQUE на `(scope, key)` в IdempotencyKey
- **Optimistic locking:** `version` на `Report`
- **PITR + ночной dump** — оба активны (006, 009)
- **Проекции пересобираемы** — источник истины это `Report`, аналитика производна
