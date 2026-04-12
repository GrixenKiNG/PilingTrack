# Runbook: PostgreSQL Down

| Metadata | Value |
|----------|-------|
| **Severity** | 🔴 P0 — Critical |
| **Impact** | Все записи заблокированы, чтение через cache |
| **SLA** | Восстановление < 15 мин |
| **Escalation** | DBA → Tech Lead → CTO |

---

## Симптомы

- API возвращает 500 на все write операции
- Health check `/api/system/status` показывает `database: down`
- Логи: `Connection refused`, `ECONNREFUSED`
- Мониторинг: PostgreSQL pod в CrashLoopBackOff

## Диагностика

```bash
# 1. Проверь статус pod
kubectl get pods -n pilingtrack-prod -l app=postgres

# 2. Проверь логи pod
kubectl logs -n pilingtrack-prod -l app=postgres --tail=100

# 3. Попробуй подключиться
kubectl exec -n pilingtrack-prod -it deployment/postgres -- pg_isready

# 4. Проверь PVC (disk space)
kubectl get pvc -n pilingtrack-prod
kubectl describe pvc -n pilingtrack-prod <pvc-name>
```

## Восстановление

### Вариант 1: Pod crash — перезапуск

```bash
# Удали pod — StatefulSet пересоздаст
kubectl delete pod -n pilingtrack-prod -l app=postgres
```

### Вариант 2: Disk full — очистка

```bash
# Подключись к pod
kubectl exec -n pilingtrack-prod -it deployment/postgres -- bash

# Проверь место
df -h

# Очисти WAL файлы (если нужно)
rm -rf /var/lib/postgresql/data/pg_wal/*

# Перезапусти PostgreSQL
pg_ctl restart -D /var/lib/postgresql/data
```

### Вариант 3: Corruption — restore из backup

```bash
# 1. Останови приложение
kubectl scale deployment -n pilingtrack-prod pilingtrack-prod-api --replicas=0

# 2. Restore из backup
kubectl exec -n pilingtrack-prod -it deployment/postgres -- bash
pg_restore -U postgres -d pilingtrack /backups/latest.dump

# 3. Перезапусти приложение
kubectl scale deployment -n pilingtrack-prod pilingtrack-prod-api --replicas=3
```

## Проверка

```bash
# Health check
curl -s http://localhost:3000/api/health

# System status
curl -s http://localhost:3000/api/system/status | jq .components.database

# Write test
kubectl exec -n pilingtrack-prod -it deployment/postgres -- \
  psql -U postgres -d pilingtrack -c "SELECT 1"
```

## Post-Incident

- [ ] Root cause analysis документирован
- [ ] ADR создан/обновлён если нужно
- [ ] Runbook обновлён если шаги изменились
- [ ] Мониторинг обновлён для раннего обнаружения

---

## Prevention

- **Disk monitoring**: Alert при > 80% usage
- **Automated backups**: Daily pg_dump с retention 7 дней
- **PVC autoscale**: StorageClass с allowVolumeExpansion
- **Read replica**: Для read-only fallback
