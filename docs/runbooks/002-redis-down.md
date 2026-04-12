# Runbook: Redis Down

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Rate limiting fallback to in-memory, event bus in-memory, circuit breakers open |
| **SLA** | Восстановление < 30 мин |
| **Escalation** | On-call engineer → Tech Lead |

---

## Симптомы

- Rate limiting не распределяется между pod'ами
- Event bus fallback to in-memory (events не доставляются между pod'ами)
- Circuit breakers для Redis в состоянии OPEN
- Health check показывает `redis: down`

## Диагностика

```bash
# 1. Проверь статус pod
kubectl get pods -n pilingtrack-prod -l app=redis

# 2. Проверь Redis connectivity
kubectl exec -n pilingtrack-prod -it deployment/redis -- redis-cli ping

# 3. Проверь память
kubectl exec -n pilingtrack-prod -it deployment/redis -- redis-cli INFO memory

# 4. Проверь connected clients
kubectl exec -n pilingtrack-prod -it deployment/redis -- redis-cli INFO clients
```

## Восстановление

### Вариант 1: Pod crash — перезапуск

```bash
kubectl delete pod -n pilingtrack-prod -l app=redis
```

### Вариант 2: Out of memory — очистка

```bash
# Подключись к Redis
kubectl exec -n pilingtrack-prod -it deployment/redis -- redis-cli

# Проверь память
INFO memory

# Очисти ключи
FLUSHDB

# Настрой maxmemory-policy если нужно
CONFIG SET maxmemory-policy allkeys-lru
CONFIG SET maxmemory 512mb
```

### Вариант 3: Corruption — рестарт с чистой базой

```bash
# Удали pod и PVC (данные Redis не критичны — это cache/queue)
kubectl delete pvc -n pilingtrack-prod -l app=redis
kubectl delete pod -n pilingtrack-prod -l app=redis
```

## Проверка

```bash
# Redis ping
kubectl exec -n pilingtrack-prod -it deployment/redis -- redis-cli ping
# Должен вернуть: PONG

# Circuit breaker status
curl -s http://localhost:3000/api/system/status | jq '.components.redis'
# Должен вернуть: { "status": "ok" }
```

## Post-Incident

- [ ] Root cause analysis документирован
- [ ] Runbook обновлён если шаги изменились
- [ ] Мониторинг обновлён (memory threshold)

---

## Prevention

- **Memory monitoring**: Alert при > 80% usage
- **maxmemory-policy**: allkeys-lru для автоматической eviction
- **Redis Sentinel**: Для automatic failover в production
- **Graceful degradation**: Система работает без Redis (in-memory fallback)
