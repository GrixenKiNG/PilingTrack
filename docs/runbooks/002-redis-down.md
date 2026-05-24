# Runbook: Redis Down

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Rate-limit fallback to in-memory, JWT denylist недоступен, очереди/pub-sub стоят |
| **SLA** | Восстановление < 30 мин |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose. НЕ Kubernetes.

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
# redis под паролем — без -a будет NOAUTH. Достаём из .env:
RP=$(grep '^REDIS_PASSWORD=' /opt/pilingtrack/.env | cut -d= -f2-)
```

---

## ДВА Redis-инстанса — важно различать

| Контейнер | Роль | Persistence | FLUSHDB безопасен? |
|---|---|---|---|
| `pilingtrack-redis` | rate-limit, очереди (BullMQ), JWT denylist, pub/sub | да (`redis_data`) | ❌ потеряете denylist + очереди задач |
| `pilingtrack-redis-cache` | только кэш | нет (`--save ""`) | ✅ кэш отстроится сам |

Прежде чем что-то чистить — поймите КАКОЙ инстанс лёг.

---

## Симптомы

- `/api/health/deep` → `redis: "down"`
- Rate-limit перестал быть распределённым (fallback in-memory)
- Telegram/realtime тормозят (pub/sub очереди стоят)
- Logout/отозванные токены снова работают (denylist недоступен) — **риск безопасности**

---

## Диагностика

```bash
# 1. Статус обоих контейнеров
dc ps redis redis-cache

# 2. Пинг (с паролем!)
dc exec redis       redis-cli -a "$RP" --no-auth-warning ping
dc exec redis-cache redis-cli -a "$RP" --no-auth-warning ping
# Оба должны вернуть PONG

# 3. Память state-инстанса
dc exec redis redis-cli -a "$RP" --no-auth-warning INFO memory | grep -E "used_memory_human|maxmemory_human"

# 4. Логи
dc logs redis --tail 50
dc logs redis-cache --tail 50
```

---

## Восстановление

### Вариант 1 — контейнер упал: перезапуск

```bash
dc restart redis          # или redis-cache — тот что лёг
dc exec redis redis-cli -a "$RP" --no-auth-warning ping
```

### Вариант 2 — кэш переполнен / странное поведение кэша

Безопасно очистить ТОЛЬКО cache-инстанс:

```bash
dc exec redis-cache redis-cli -a "$RP" --no-auth-warning FLUSHALL
# Кэш отстроится при следующих запросах. Данные не теряются.
```

### Вариант 3 — state-инстанс переполнен памятью

НЕ делайте FLUSHALL на `pilingtrack-redis` — потеряете JWT denylist
(отозванные токены снова станут валидными) и очереди задач. Вместо этого
проверьте политику вытеснения и что именно занимает память:

```bash
dc exec redis redis-cli -a "$RP" --no-auth-warning INFO memory | grep used_memory_human
dc exec redis redis-cli -a "$RP" --no-auth-warning --bigkeys
# Если реально некуда деваться и нужен срочный рестарт — данные на диске
# (redis_data), переживут перезапуск контейнера:
dc restart redis
```

---

## Проверка

```bash
dc exec redis       redis-cli -a "$RP" --no-auth-warning ping
dc exec redis-cache redis-cli -a "$RP" --no-auth-warning ping

curl -s https://orionpiling.ru/api/health/deep
# redis должно быть "ok"
```

---

## Post-Incident

- [ ] Какой инстанс лёг и почему (OOM? краш?)
- [ ] Если денилист был недоступен — проверить не остались ли валидными
      токены, которые должны были быть отозваны
- [ ] Memory alert если упёрлись в лимит

---

## Prevention

- **Graceful degradation:** приложение переживает падение Redis
  (in-memory fallback для rate-limit), но denylist при этом не работает —
  это известный риск, минимизировать время простоя
- **Разделение инстансов** уже сделано: кэш отдельно от состояния, чтобы
  очистка кэша не сносила денилист
