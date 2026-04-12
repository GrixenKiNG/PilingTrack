# Runbook: WebSocket Server Crash

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Realtime уведомления не работают, offline sync не получает updates |
| **SLA** | Восстановление < 10 мин |
| **Escalation** | On-call engineer → Tech Lead |

---

## Симптомы

- Клиенты не получают realtime обновления
- Sync status не обновляется
- Health check: `websocket: down`
- Логи WS pod: ошибки подключения, memory leaks

## Диагностика

```bash
# 1. Проверь статус pod
kubectl get pods -n pilingtrack-prod -l app=websocket

# 2. Проверь логи
kubectl logs -n pilingtrack-prod -l app=websocket --tail=100

# 3. Проверь connections
kubectl exec -n pilingtrack-prod -it deployment/websocket -- \
  curl -s http://localhost:4000/health

# 4. Проверь memory usage
kubectl top pod -n pilingtrack-prod -l app=websocket
```

## Восстановление

### Вариант 1: Pod crash — перезапуск

```bash
kubectl delete pod -n pilingtrack-prod -l app=websocket
```

### Вариант 2: Memory leak — rollout restart

```bash
kubectl rollout restart deployment -n pilingtrack-prod websocket
kubectl rollout status deployment -n pilingtrack-prod websocket
```

### Вариант 3: Redis Pub/Sub disconnected

```bash
# Проверь Redis connectivity из WS pod
kubectl exec -n pilingtrack-prod -it deployment/websocket -- \
  redis-cli -h redis-master -p 6379 ping

# Если не отвечает — перезапусти WS после Redis recovery
kubectl rollout restart deployment -n pilingtrack-prod websocket
```

## Проверка

```bash
# Health check
kubectl exec -n pilingtrack-prod -it deployment/websocket -- \
  curl -s http://localhost:4000/health

# System status
curl -s http://localhost:3000/api/system/status | jq '.components.websocket'

# Connection test (через wscat)
wscat -c ws://localhost:4001
# Должно подключиться
```

## Post-Incident

- [ ] Root cause analysis (memory leak? Redis disconnect?)
- [ ] Memory monitoring added если нужно
- [ ] Runbook обновлён

---

## Prevention

- **Memory limits**: Pod memory limit 512Mi, request 256Mi
- **Health checks**: Liveness + readiness probes
- **Auto-restart**: При memory > 80% limit — automatic restart
- **Connection monitoring**: Alert при > 5000 concurrent connections
