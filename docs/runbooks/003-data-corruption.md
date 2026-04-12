# Runbook: Data Corruption

| Metadata | Value |
|----------|-------|
| **Severity** | 🔴 P0 — Critical |
| **Impact** | Невозможность доверять данным, финансовые ошибки |
| **SLA** | Восстановление < 1 час |
| **Escalation** | DBA → Tech Lead → CTO |

---

## Симптомы

- Отчёты с некорректными агрегатами (суммы не сходятся)
- Дубликаты записей
- Потерянные записи (клиент сохранил, сервер не получил)
- Консистентность projection vs source нарушена

## Диагностика

```bash
# 1. Проверь DLQ размер
curl -s http://localhost:3000/api/system/slo | jq '.alerts'

# 2. Проверь integrity
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) FROM \"Report\" WHERE id IN (
      SELECT id FROM \"Report\" GROUP BY id HAVING COUNT(*) > 1
    );
  "

# 3. Проверь version consistency
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT id, version FROM \"Report\" WHERE version < 1;
  "

# 4. Проверь outbox backlog
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) FROM \"OutboxEvent\" WHERE published = false;
  "
```

## Восстановление

### Вариант 1: Из backup (point-in-time)

```bash
# 1. Останови запись
kubectl scale deployment -n pilingtrack-prod pilingtrack-prod-api --replicas=0

# 2. Восстанови из backup
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  pg_restore -U postgres -d pilingtrack -t 'Report' /backups/<timestamp>.dump

# 3. Перезапусти приложение
kubectl scale deployment -n pilingtrack-prod pilingtrack-prod-api --replicas=3
```

### Вариант 2: Replay из outbox

```bash
# 1. Перезапусти outbox worker для replay
kubectl rollout restart deployment -n pilingtrack-prod outbox-worker

# 2. Мониторь обработку
kubectl logs -n pilingtrack-prod -l app=outbox-worker --tail=100 -f
```

### Вариант 3: Ручное исправление

```sql
-- Удали дубликаты (оставь последнюю версию)
DELETE FROM "Report"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY reportId ORDER BY version DESC) as rn
    FROM "Report"
  ) sub WHERE rn > 1
);

-- Исправь version inconsistency
UPDATE "Report"
SET version = (
  SELECT MAX(version) FROM "Report" r2 WHERE r2.reportId = "Report".reportId
)
WHERE version < (
  SELECT MAX(version) FROM "Report" r2 WHERE r2.reportId = "Report".reportId
);
```

## Проверка

```bash
# Integrity check
curl -s http://localhost:3000/api/system/slo | jq '.slo[] | select(.name == "api_availability")'

# Data consistency
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) as duplicates FROM \"Report\"
    GROUP BY reportId HAVING COUNT(*) > 1;
  "
```

## Post-Incident

- [ ] Root cause analysis (как произошла corruption?)
- [ ] ADR создан если нужно изменить архитектуру
- [ ] Runbook обновлён
- [ ] Тесты добавлены для предотвращения регрессии
- [ ] Мониторинг обновлён для раннего обнаружения

---

## Prevention

- **Automated backups**: Daily pg_dump + PITR
- **Integrity checks**: Cron job для проверки дубликатов
- **Idempotency keys**: UNIQUE constraint на (scope, key)
- **Version tracking**: Optimistic locking на всех записях
