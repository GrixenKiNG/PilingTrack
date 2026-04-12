# Runbook: Outbox Backlog > 10K

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Projections устаревают, realtime не работает, аналитика неверна |
| **SLA** | Восстановление < 30 мин |
| **Escalation** | On-call engineer → Tech Lead |

---

## Симптомы

- `/api/system/slo` показывает `outbox_lag > 10s`
- Projections (OperatorPerformance, DowntimeSummary) не обновляются
- Realtime уведомления не приходят
- Health check: `outbox: backlog 10000+`

## Диагностика

```bash
# 1. Проверь размер backlog
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) as unpublished FROM \"OutboxEvent\" WHERE published = false;
  "

# 2. Проверь oldest unprocessed event
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT id, type, created_at FROM \"OutboxEvent\"
    WHERE published = false ORDER BY created_at ASC LIMIT 5;
  "

# 3. Проверь worker статус
kubectl logs -n pilingtrack-prod -l app=outbox-worker --tail=50

# 4. Проверь DLQ размер
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) as dlq_pending FROM \"DeadLetterQueue\" WHERE status = 'pending';
  "
```

## Восстановление

### Вариант 1: Worker завис — перезапуск

```bash
# Перезапусти worker
kubectl rollout restart deployment -n pilingtrack-prod outbox-worker

# Мониторь обработку
kubectl logs -n pilingtrack-prod -l app=outbox-worker --tail=100 -f
```

### Вариант 2: Worker не успевает — увеличение concurrency

```bash
# Увеличь реплики worker
kubectl scale deployment -n pilingtrack-prod outbox-worker --replicas=5

# Мониторь backlog
watch -n 5 'kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c \
  "SELECT COUNT(*) FROM \"OutboxEvent\" WHERE published = false;"'
```

### Вариант 3: Failed events блокируют — skip failed

```bash
# Перемести failed events в DLQ
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    UPDATE \"OutboxEvent\" SET published = true, last_error = 'Skipped - manual intervention'
    WHERE published = false AND attempts >= 5;
  "

# Перезапусти worker
kubectl rollout restart deployment -n pilingtrack-prod outbox-worker
```

### Вариант 4: Массовый backlog — batch processing

```sql
-- Обработай batch вручную (mark as published)
UPDATE "OutboxEvent"
SET published = true, published_at = NOW()
WHERE id IN (
  SELECT id FROM "OutboxEvent"
  WHERE published = false
  ORDER BY created_at ASC
  LIMIT 1000
);
```

## Проверка

```bash
# Backlog должен уменьшаться
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "
    SELECT COUNT(*) FROM \"OutboxEvent\" WHERE published = false;
  "

# SLO должен восстановиться
curl -s http://localhost:3000/api/system/slo | jq '.alerts'
# Должно быть пусто или только warnings
```

## Post-Incident

- [ ] Root cause analysis (почему backlog вырос?)
- [ ] Увеличить polling frequency если нужно
- [ ] Добавить alert при backlog > 1000 (раньше)
- [ ] Рассмотреть миграцию на Redis Streams (ADR-0002)

---

## Prevention

- **Early alerting**: Alert при backlog > 1000, не 10K
- **Auto-scaling**: HPA для outbox-worker по backlog size
- **Batch processing**: Worker обрабатывает батчами по 100
- **Dead letter queue**: Failed events не блокируют очередь
