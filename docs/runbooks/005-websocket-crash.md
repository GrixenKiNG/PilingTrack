# Runbook: WebSocket Server Crash

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Realtime-обновления не приходят (fleet-dashboard, уведомления). Запись отчётов работает |
| **SLA** | Восстановление < 10 мин |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose. НЕ Kubernetes.
> WS-контейнер: `pilingtrack-ws`, порт **3001** (за Caddy).

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
```

---

## Симптомы

- Клиенты не получают realtime-обновления (дашборд не двигается)
- `/api/health/deep` → `websocket: "down"`
- Логи `pilingtrack-ws`: ошибки подключения, рост памяти

---

## Диагностика

```bash
# 1. Статус контейнера
dc ps ws

# 2. Логи
dc logs ws --tail 100

# 3. Здоровье через приложение (агрегированный статус)
curl -s https://orionpiling.ru/api/health/deep
# websocket должно быть "ok"

# 4. WS зависит от Redis pub/sub — если Redis лёг, WS не доставляет.
#    Проверить Redis (см. runbook 002):
RP=$(grep '^REDIS_PASSWORD=' /opt/pilingtrack/.env | cut -d= -f2-)
dc exec redis redis-cli -a "$RP" --no-auth-warning ping
```

---

## Восстановление

### Вариант 1 — контейнер упал / течёт память: перезапуск

```bash
dc restart ws
dc logs ws --tail 50 -f
# Ctrl-C когда увидите что сервер слушает порт и подключился к Redis
```

Перезапуск WS безопасен — клиенты автоматически переподключатся.
Записи отчётов идут через HTTP API, не через WS, так что данные не теряются.

### Вариант 2 — Redis pub/sub отвалился

WS раздаёт события через Redis. Если Redis лежал — сначала поднять Redis
(runbook 002), потом перезапустить WS чтобы пересоздать подписки:

```bash
# (после восстановления Redis)
dc restart ws
```

### Вариант 3 — WS не стартует после изменения кода/конфига

```bash
git pull origin main
dc build ws
dc up -d ws
```

---

## Проверка

```bash
dc ps ws                     # Up (healthy)
curl -s https://orionpiling.ru/api/health/deep   # websocket: "ok"
```

Затем откройте дашборд в браузере — realtime-показатели должны снова
обновляться.

---

## Post-Incident

- [ ] Причина: утечка памяти? падение Redis? OOM?
- [ ] Если память — снять метрики роста, проверить лимит контейнера в overlay
- [ ] Обновить runbook если шаги изменились

---

## Prevention

- **Авто-restart:** `restart: unless-stopped` уже в compose
- **Лимит памяти:** задан в `docker-compose.prod.yml` (ws: 384m)
- **Graceful degradation:** падение WS не блокирует запись отчётов —
  только realtime-обновления; клиент переподключается сам
