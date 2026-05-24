# Runbook: Outbox backlog / Dead Letter Queue

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Projections устаревают, realtime не работает, аналитика отстаёт, Telegram-уведомления не уходят |
| **SLA** | Восстановление < 30 мин |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose (`/opt/pilingtrack`). НЕ Kubernetes.
> Все команды ниже — для этого окружения.

Чтобы не повторять длинный префикс, в начале сессии задайте алиас:

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
```

(Алиас живёт только в текущей SSH-сессии. Если отвалитесь — задайте снова.)

---

## Как это устроено (контекст)

Запись отчёта пишет **событие** в таблицу `OutboxEvent` той же транзакцией
(transactional outbox — событие не теряется при падении). Контейнер
`pilingtrack-workers` каждые ~10 сек забирает необработанные события и
выполняет их.

Две **независимые** колонки-consumer'а на одной строке:
- `published` — write-side (event bus, уведомления)
- `projected` — read-side (CQRS-проекции: OperatorPerformance и т.п.)

Они продвигаются отдельно, поэтому backlog может быть на одной стороне,
а не на другой.

Логика повторов на одно событие:
```
attempts < 5  → повтор с экспоненциальной задержкой (nextRetryAt)
attempts >= 5 → переезд в DeadLetterQueue, строка outbox помечается consumed
```

**Воркеры выбирают лидера (leader election).** Outbox и projection
обрабатывает РОВНО ОДИН процесс. Наращивание реплик `workers` НЕ ускоряет
обработку — лишние реплики простаивают. (Это не относится к `workers-pdf`,
где BullMQ допускает конкурентных потребителей.)

---

## Симптомы

- `/api/health/deep` → `200`, но в `/api/system/status` (админский)
  `metrics.outboxPending` большой и растёт
- Проекции (OperatorPerformance, аналитика) не обновляются
- Realtime-уведомления не приходят
- В Grafana — рост `outbox_lag`

---

## Диагностика

```bash
# 1. Размер backlog по обеим сторонам consumer'а
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT
     count(*) FILTER (WHERE published = false)  AS unpublished,
     count(*) FILTER (WHERE projected = false)  AS unprojected
   FROM "OutboxEvent";'

# 2. Самые старые необработанные события (что застряло первым)
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT id, type, attempts, left("lastError", 80) AS error, "createdAt"
   FROM "OutboxEvent"
   WHERE published = false OR projected = false
   ORDER BY "createdAt" ASC LIMIT 10;'

# 3. Жив ли worker, что в логах
dc ps workers
dc logs workers --tail 80

# 4. Размер DLQ
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT status, count(*) FROM "DeadLetterQueue" GROUP BY status;'

# 5. Что именно упало в DLQ (тексты ошибок)
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT "eventType", attempts, left("errorMessage", 100) AS error, "createdAt"
   FROM "DeadLetterQueue"
   WHERE status = '"'"'pending'"'"'
   ORDER BY "createdAt" DESC LIMIT 10;'
```

**Здоровое состояние:** `unpublished` и `unprojected` близки к нулю и не
растут; DLQ `pending = 0`.

---

## Восстановление

### Вариант 1 — worker завис: перезапуск (первое что пробуем)

```bash
dc restart workers
dc logs workers --tail 100 -f
# Ctrl-C когда увидите что события обрабатываются (processedCount растёт)
```

Через минуту повторите диагностику №1 — backlog должен падать.

### Вариант 2 — «ядовитое» событие блокирует очередь

Если в логах один и тот же `id` падает снова и снова и backlog за ним не
двигается — это событие отравляет очередь. Оно само уедет в DLQ после 5
попыток, но если ждать некогда — отправьте его туда вручную (пометить
consumed, чтобы перестало retry'иться):

```bash
# Сначала ПОСМОТРИТЕ что именно пометите (dry-run)
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT id, type, attempts, left("lastError",100) AS error
   FROM "OutboxEvent"
   WHERE (published = false OR projected = false) AND attempts >= 5
   ORDER BY "createdAt" ASC LIMIT 20;'

# Если согласны — пометить consumed на ОБЕИХ сторонах
dc exec postgres psql -U piling -d pilingtrack -c \
  'UPDATE "OutboxEvent"
   SET published = true, projected = true,
       "lastError" = '"'"'Skipped — manual intervention'"'"'
   WHERE (published = false OR projected = false) AND attempts >= 5;'

dc restart workers
```

> ⚠️ Это пропускает события **безвозвратно для основной очереди**. Они НЕ
> попадут в DLQ автоматически (DLQ заполняет только сам worker при
> attempts>=5). Перед таким шагом убедитесь что понимаете что теряете —
> например пропущенная проекция = неверная аналитика, пока не сделаете
> rebuild через `/api/admin/projections/rebuild`.

### Вариант 3 — разобрать накопившийся DLQ

DLQ-записями управляют через админский API (нужно право `dlq.manage`):

```bash
# Посмотреть pending (через приложение, не БД — нужен admin-токен)
curl -s -H "Cookie: <admin-session>" \
  https://orionpiling.ru/api/admin/dlq?status=pending | jq

# Переотправить запись обратно в очередь (после фикса причины)
curl -s -X POST -H "Cookie: <admin-session>" -H "Content-Type: application/json" \
  -d '{"id":"<dlq-id>","action":"retry"}' \
  https://orionpiling.ru/api/admin/dlq

# Выкинуть запись насовсем
curl -s -X POST -H "Cookie: <admin-session>" -H "Content-Type: application/json" \
  -d '{"id":"<dlq-id>","action":"discard"}' \
  https://orionpiling.ru/api/admin/dlq
```

Проще — из админ-панели в UI, если там есть раздел DLQ (дёргает тот же
endpoint). `retry` пере-вставляет событие в `OutboxEvent` с attempts=0;
`discard` помечает запись `discarded` и забывает.

---

## Проверка восстановления

```bash
# Backlog должен уменьшаться при повторных запусках
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT
     count(*) FILTER (WHERE published = false) AS unpublished,
     count(*) FILTER (WHERE projected = false) AS unprojected
   FROM "OutboxEvent";'

# DLQ pending не растёт
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT status, count(*) FROM "DeadLetterQueue" GROUP BY status;'
```

Если проекции пропускались (Вариант 2) — пересоберите их:
`POST /api/admin/projections/rebuild` (см. бэкфилл-скрипты).

---

## Post-Incident

- [ ] Почему backlog вырос? (worker падал? событие отравляло? медленный handler?)
- [ ] Если в DLQ осели события одного типа — баг в его handler'е, чинить код
- [ ] Проверить что после фикса DLQ-записи либо retry'нуты, либо discard'нуты

---

## Prevention

- **Early alerting:** алерт при `outboxPending > 1000` (а не 10K)
- **DLQ-алерт:** уведомление при `DeadLetterQueue.pending > 0` — даже одно
  застрявшее событие = что-то стабильно падает
- **Leader election** уже защищает от дублей; масштабировать `workers`
  репликами для скорости БЕСПОЛЕЗНО (лишние простаивают) — вместо этого
  оптимизировать медленный handler или увеличить частоту polling'а
