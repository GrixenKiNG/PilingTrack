# Runbook: Outbox backlog / Dead Letter Queue

| Metadata | Value |
|----------|-------|
| **Severity** | 🟡 P1 — High |
| **Impact** | Projections устаревают, realtime не работает, аналитика отстаёт, Telegram-уведомления не уходят |
| **SLA** | Восстановление < 30 мин |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose (`/opt/pilingtrack`). НЕ Kubernetes.
> Команды ниже — примеры диагностики чтением для уполномоченного оператора.
> Они не разрешают агенту подключаться к production или запускать их.

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
а не на другой. Pending projection включает все строки `projected=false`,
независимо от `published`, типа события и срока `nextRetryAt`. Отложенный
retry остаётся pending; возраст считается от `createdAt`, а не времени
следующей попытки. Попадание в DLQ завершает только соответствующего
consumer; состояние другого может оставаться pending. DLQ считается отдельно.

Логика повторов на одно событие:
```
attempts < 5  → повтор с экспоненциальной задержкой (nextRetryAt)
attempts >= 5 → переезд в DeadLetterQueue, флаг текущего consumer становится true
               (published либо projected); другой флаг не меняется
```

Флаги consumer независимы, но `attempts`, `nextRetryAt` и `lastError`
общие для строки события; отдельных счётчиков повторов у них нет.

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
- В Grafana — рост `outbox_lag_seconds` или `projection_lag_seconds`

---

## Метрики и свежесть измерения

Принятый exporter: [lag-monitor.ts](../../src/core/observability/lag-monitor.ts).

| Метрика | Что измеряет |
|---|---|
| `outbox_lag_seconds` | Возраст самой старой строки `published=false`, от `createdAt` |
| `outbox_pending_count` | Количество строк `published=false` |
| `projection_lag_seconds` | Возраст самой старой строки `projected=false`, от `createdAt` |
| `projection_pending_count` | Количество всех строк `projected=false` |
| `dlq_pending_count` | Число записей DeadLetterQueue со статусом `pending` |
| `lag_snapshot_timestamp_seconds` | Unix-время последнего успешного сбора; 0 — измерение недоступно |

При отсутствии ожидающих строк возраст равен 0. Publication и projection
могут иметь разные нули: `published=true/projected=false` уже опубликовано,
но ещё не спроецировано. Нельзя заменять второй сигнал первым.

Ошибка сбора publication/projection не создаёт новый успешный снимок: предыдущие значения и
`timestamp` сохраняются. До первого успешного сбора exporter отдаёт только
`lag_snapshot_timestamp_seconds 0`, без выдуманных нулевых backlog gauges.
Устаревший снимок, нулевая/некорректная отметка времени или отсутствующая
серия — неизвестное состояние, а не здоровая пустая очередь.

Для DLQ есть отдельное ограничение: при отказе чтения `getDlqPendingCount`
возвращает 0, не прерывая общий сбор и обновление timestamp. Поэтому даже
свежий `dlq_pending_count=0` требует подтверждения запросом DLQ из диагностики
ниже; ошибка этого запроса означает неизвестное состояние DLQ.

Принятые [alert rules](../../observability/prometheus/alerts.yml): publication
и projection предупреждают при возрасте >60 с в течение 10 мин, critical
при >300 с в течение 5 мин. `LagSnapshotStale` проверяет возраст успешного
снимка >60 с либо timestamp=0 в течение 2 мин. Отсутствующая серия требует
отдельной проверки scrape/target; это правило само её не обнаруживает.

## Диагностика

Только чтение: оба pending-фильтра независимы, без ограничения по типу
события, публикации другого consumer или eligibility повтора.

```bash
# 1. Количество и возраст publication/projection отдельно
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT
     count(*) FILTER (WHERE published = false) AS unpublished,
     coalesce(greatest(0, extract(epoch FROM (now() - min("createdAt") FILTER (WHERE published = false)))), 0) AS publication_age_seconds,
     count(*) FILTER (WHERE projected = false) AS unprojected,
     coalesce(greatest(0, extract(epoch FROM (now() - min("createdAt") FILTER (WHERE projected = false)))), 0) AS projection_age_seconds
   FROM "OutboxEvent";'

# 2. Старые события: флаги и отложенные повторы видны вместе
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT id, type, published, projected, attempts, "nextRetryAt",
          left("lastError", 80) AS error, "createdAt"
   FROM "OutboxEvent"
   WHERE published = false OR projected = false
   ORDER BY "createdAt" ASC LIMIT 10;'

# 3. Состояние и журнал worker — без перезапуска
dc ps workers
dc logs workers --tail 80

# 4. DLQ отдельно от основной очереди
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT status, count(*) FROM "DeadLetterQueue" GROUP BY status;'
```

**Здоровое состояние** подтверждается свежим успешным измерением: оба
возраста и количества не растут, pending близок к нулю, DLQ pending=0.
При ошибке DB/scrape эти условия не подтверждены даже старым нулевым графиком.

## Действия после диагностики

Зафиксировать, какой consumer отстал, возраст события, время последнего
успешного снимка, ошибку worker и состояние DLQ. Устранение причины и
любые изменения очереди согласуются отдельно с владельцем. Этот runbook
не содержит команд перезапуска, массового пропуска, replay, retry/discard
или пересборки проекций: выставить оба флага вручную означает потерять
обработку, а не восстановить её.

## Проверка восстановления

Повторить диагностику чтением: publication/projection pending и возраст
должны уменьшаться независимо; успешный snapshot обновляется; DLQ pending
не растёт. Не считать отложенный retry исчезнувшим из pending. Проверить
реальное обновление соответствующей проекции или доставки, если оно входило
в инцидент: само уменьшение backlog не доказывает правильность данных.

Принятый [тест I01](../../src/core/observability/__tests__/lag-monitor.test.ts)
покрывает опубликованное, но не спроецированное событие, backoff, пустую
очередь, ошибку сбора с сохранением timestamp и exporter. Это локальная
проверка контракта; запуск/reload правил и scrape на сервере проверяются
отдельно, исходный файл не доказывает их применение.
