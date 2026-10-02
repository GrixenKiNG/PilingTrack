# Runbook 014 — ручные шаги после выкладки ветки на бой (октябрь 2026)

**Зачем.** Очередная выкладка ветки `hermes/q4-0926` приносит правки, которые
**не вступают в силу сами по себе**. Часть из них — конфигурация мониторинга,
которую Prometheus читает при старте контейнера; часть — новый systemd-таймер,
который на боевом сервере ещё не установлен; часть — проверка, которую можно
сделать только руками. Этот ранбук собирает три шага в один список: они были
разбросаны по отдельным коммитам и отчётам (F-APP-GUARD, F-WEBHOOK-RETRY,
F-ALERTMANAGER-WATCH, F-WORKERS-SCRAPE, F-ALERT-NAMES).

**Что важно понимать перед чтением.** Выкладка приложения (runbook 008) и стек
мониторинга — **разные compose-файлы**. Мониторинг живёт в
`docker-compose.monitoring-prod.yml`, и он монтирует `alerts.yml` и
`prometheus-prod.yml` как **отдельные файлы**
(`docker-compose.monitoring-prod.yml:20-21`). `git pull` заменяет файл целиком
(новый inode), а уже запущенный контейнер продолжает видеть **старый** — поэтому
одного `curl -X POST :9090/-/reload` недостаточно, нужен `--force-recreate`
(это прямо записано в комментарии `docker-compose.monitoring-prod.yml:28-33`).
Без этого правка правил «не применится» при полностью зелёном статусе.

Доступ к Prometheus — только через `127.0.0.1:9090` (порт наружу не отдан,
`docker-compose.monitoring-prod.yml:17-18`); все команды проверки ниже —
read-only и безопасны для повторного запуска.

---

## Порядок

1. Перечитать конфигурацию Prometheus (правила + опрос целей).
2. Установить сторож `app-guard` и включить его таймер.
3. Проверить вебхук Alertmanager (200 на тестовую тревогу; 503 при недоступном Telegram).

---

## Шаг 1. Перечитать конфигурацию Prometheus

Что менялось (всё это подхватывается только при пересоздании контейнера):

| Что | Файл | Источник |
|---|---|---|
| Новые правила `AlertmanagerDown` (5 м, critical) и `AlertmanagerNotificationsFailing` (15 м, warning) | `observability/prometheus/alerts.yml:242-264` | F-ALERTMANAGER-WATCH (052031d9) |
| `TargetDown` больше не срабатывает на Alertmanager (`up{job!="alertmanager"} == 0`) | `alerts.yml:217-227` | F-ALERT-TARGETDOWN-DEDUP (5493421d) |
| Новый job `alertmanager` (scrape 30 с) | `prometheus-prod.yml:80-92` | F-ALERTMANAGER-WATCH |
| Job `pilingtrack-workers` (`workers:3002`, `/metrics`) | `prometheus-prod.yml:38-49` | F-WORKERS-SCRAPE (5669c97f) |
| Цель `ws` (3001) удалена — сервис снят 26.09.2026 | `prometheus-prod.yml` | F-WS-TAILS (a8567732, 24307fc5) |
| Прежние правки «алерты ссылаются на реально отдаваемые метрики» | `alerts.yml` | F-ALERT-NAMES (3e025549) |

### Перечитать

```bash
cd /opt/pilingtrack
git log -1 --oneline       # убедиться, что выложена нужная ревизия

# Пересоздать ИМЕННО Prometheus: одного reload после git pull мало
# (см. врезку про inode в начале ранбука). Alertmanager перезапускать не нужно —
# его конфигурация (observability/alertmanager/alertmanager.yml) не менялась.
docker compose -f docker-compose.monitoring-prod.yml up -d --no-deps --force-recreate prometheus
docker compose -f docker-compose.monitoring-prod.yml ps prometheus
docker logs --tail 30 pilingtrack-prometheus    # ищем "Completed loading of configuration file", без ошибок парсинга
```

`--web.enable-lifecycle` в этом стеке **включён**
(`docker-compose.monitoring-prod.yml:41`), поэтому горячий `reload` доступен:

```bash
# Пригодится для правок «на месте» (тот же inode), но НЕ после git pull:
curl -sS -X POST http://127.0.0.1:9090/-/reload
```

### Проверить

```bash
# Все цели разом: у каждой UP-цели value = 1
curl -s -G http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=up'

# Кто вообще скрейпится (список job'ов)
curl -s http://127.0.0.1:9090/api/v1/targets | grep -oE '"job":"[^"]+"'

# Ошибки опроса, если что-то лежит
curl -s http://127.0.0.1:9090/api/v1/targets | grep -o '"lastError":"[^"]*"'

# Загруженные правила (группы и имена правил)
curl -s http://127.0.0.1:9090/api/v1/rules | grep -oE '"name":"[^"]+"'
```

**Должно быть UP — ровно семь job'ов:**

| job | Цель | Что проверяет |
|---|---|---|
| `pilingtrack-app` | `app:3000` | `/api/metrics` (bearer-токен скрейпа) |
| `pilingtrack-workers` | `workers:3002` | `/metrics` воркеров (F-WORKERS-SCRAPE) |
| `node` | `node-exporter:9100` | хост |
| `postgresql` | `postgres-exporter:9187` | PostgreSQL |
| `redis` | `redis-exporter:9121` | Redis |
| `prometheus` | `localhost:9090` | сам Prometheus |
| `alertmanager` | `alertmanager:9093` | **новое**, F-ALERTMANAGER-WATCH |

В списке целей **не должно** остаться ничего с `ws` / портом `3001`:
`curl -s http://127.0.0.1:9090/api/v1/targets | grep -c 'ws:3001'` → `0`.

В `/api/v1/rules` должны присутствовать имена `AlertmanagerDown`,
`AlertmanagerNotificationsFailing`, `WorkersDown`, `TargetDown` (в его выражении
должно стоять `job!=`, т.е. Alertmanager исключён), `OutboxLagWarn`,
`OutboxLagHigh`, `OffsiteBackupNotSynced`. Правило `AlertmanagerDown` подписано
«доставлять тревоги некому», и это нормально: при полном падении Alertmanager
сообщение об этом приходит не через него, а от внешнего сторожа (шаг 2).

---

## Шаг 2. Установить сторожа `app-guard` (независимый dead-man switch)

Сторож — обычный скрипт на **хосте** (не в Docker), который раз в 2 минуты
проверяет `http://127.0.0.1:3000/api/health` и при устойчивом отказе пишет
**напрямую в Telegram**, минуя приложение, Alertmanager, Prometheus и Docker. Он
закрывает слепое пятно R69 (находка 1): при падении приложения тревога о нём
самом идёт через это же приложение. Сторож ничего не перезапускает — он только
наблюдает.

### Что создаётся

| Путь | Что | Права |
|---|---|---|
| `/opt/pilingtrack/scripts/app-guard.sh` | сам сторож | `0755` |
| `/etc/systemd/system/pilingtrack-app-guard.service` | юнит | `0644` |
| `/etc/systemd/system/pilingtrack-app-guard.timer` | таймер (раз в 2 мин) | `0644` |
| `/etc/pilingtrack/` | каталог с кредами сторожа | `0755` |
| `/etc/pilingtrack/app-guard.env` | креды сторожа | `0600`, `root:root` |
| `/var/lib/pilingtrack/` | каталог состояния (счётчик неудач) | `0700` |

### Установка

```bash
cd /opt/pilingtrack

install -m 0755 scripts/app-guard.sh /opt/pilingtrack/scripts/app-guard.sh
install -m 0644 deploy/systemd/pilingtrack-app-guard.service /etc/systemd/system/
install -m 0644 deploy/systemd/pilingtrack-app-guard.timer   /etc/systemd/system/

install -d -m 0755 /etc/pilingtrack
install -m 0600 /dev/null /etc/pilingtrack/app-guard.env
install -d -m 0700 /var/lib/pilingtrack
```

Заполнить `/etc/pilingtrack/app-guard.env` (владелец, `root:root`, `0600`) —
**только имена переменных, значения вписывает владелец, в документе их нет**:

```
APP_GUARD_TELEGRAM_BOT_TOKEN=<токен инфраструктурного бота>
APP_GUARD_TELEGRAM_CHAT_ID=<чат, куда слать>
TELEGRAM_API_BASE=<корень API; на бою — прокси-воркер>
```

Почему отдельный бот: на проде токен основного бота приложения лежит в базе, и в
compose-`.env` его нет — сторож без своего бота вообще не смог бы уведомить
(шапка `scripts/app-guard.sh:21-27`).

Чтобы счётчик неудач пережил перезагрузку, укажите файл состояния вне `/run`
(значение по умолчанию `/run/...` стирается при ребуте, и порог никогда не
достигается) — в юните на сервере:

```
# /etc/systemd/system/pilingtrack-app-guard.service, блок [Service]
Environment=APP_GUARD_STATE_FILE=/var/lib/pilingtrack/app-guard.state
```

⚠️ Правка в юните — **на сервере**, не в репозитории: повторный
`install -m 0644 deploy/systemd/pilingtrack-app-guard.service` её затрёт.

### Проверить доставку ДО включения таймера

```bash
# Ручной запуск не наследует EnvironmentFile юнита — прочитаем его сами
set -a; . /etc/pilingtrack/app-guard.env; set +a
/opt/pilingtrack/scripts/app-guard.sh --test
# ожидаем "app-guard: test message sent" и код возврата 0;
# --test шлёт одно пробное сообщение и не трогает ни health, ни state.

systemctl daemon-reload
systemctl enable --now pilingtrack-app-guard.timer
systemctl list-timers pilingtrack-app-guard.timer
journalctl -u pilingtrack-app-guard.service -n 20 --no-pager
```

В чате должно появиться «PilingTrack: проверка сторожа app-guard». Если
сообщение не пришло — не включать таймер, а проверить `app-guard.env` и
`TELEGRAM_API_BASE` (скрипт в этом случае сам выходит с кодом 1 и пишет причину).

### Отдельно — про порог и выкладку (ожидаемое поведение, не поломка)

- Таймер запускает проверку **каждые 2 минуты** (`OnBootSec=2min` +
  `OnUnitActiveSec=2min`), порог — **3 неудачные проверки подряд**
  (`APP_GUARD_FAIL_THRESHOLD`, по умолчанию `3`). То есть тревога приходит
  **≈4–6 минут** после начала простоя, а не мгновенно. Это сделано, чтобы не
  звонить на каждую короткую перезагрузку.
- **Во время выкладки тревоги быть не должно.** Контейнер `app` при
  `docker compose up -d` пересоздаётся 1–2 минуты, за это время успевает пройти
  0–1 неудачная проверка из трёх. Если сторож звонит на каждой выкладке — дело в
  пороге/таймере, а не в «сломанном стороже».
- Сообщение о падении — **одно на аварию** (файл состояния), и **одно** «снова
  отвечает» при восстановлении.

---

## Шаг 3. Проверить вебхук Alertmanager (200 / 503)

Вебхук `/api/alerts/webhook` теперь отвечает честно (F-WEBHOOK-RETRY,
df0e08ff): **200**, если хотя бы одно сообщение дошло до Telegram, и **503**,
если в непустой пачке были firing-алерты, но **ни один** не доставлен. Второе
заставляет Alertmanager повторить уведомление вместо того, чтобы молча считать
доставку успешной (`src/app/api/alerts/webhook/route.ts:136-145`).

### Безопасная проверка 200 (без спама)

Заводим **одну** тестовую тревогу `severity=info` через `amtool` — она проходит
весь путь Prometheus → Alertmanager → вебхук → Telegram и даёт **ровно одно**
сообщение. Пачками тревог не сыпать.

```bash
docker exec pilingtrack-alertmanager amtool alert add \
  alertname=RunbookSelfTest severity=info \
  --annotation=summary='Проверка вебхука из ранбука 014' \
  --end="$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)"
```

Подождать ≥30 секунд (`group_wait` для не-critical алертов,
`observability/alertmanager/alertmanager.yml:6`), затем:

```bash
# Тестовая тревога видна в Alertmanager
docker exec pilingtrack-alertmanager amtool alert query alertname=RunbookSelfTest

# Отправлено / провалено уведомлений (метрики появились вместе с job'ом alertmanager)
curl -s -G http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=alertmanager_notifications_total'
curl -s -G http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=alertmanager_notifications_failed_total'
```

**Ожидаемо:** в Telegram пришло одно сообщение «Проверка вебхука из ранбука 014»;
`alertmanager_notifications_total` вырос; `alertmanager_notifications_failed_total`
**не растёт**. Если бы вебхук ответил 503, Alertmanager счёл бы это сбоем
доставки и метрика failures пошла бы вверх — именно так теперь и видно проблему
(F-WEBHOOK-RETRY). Заодно это подтверждает, что правило
`AlertmanagerNotificationsFailing` (шаг 1) получит данные.

### Явная проверка кода ответа (необязательно)

Чтобы увидеть сам код 200, можно дёрнуть вебхук напрямую. Токен — **секрет**, и
он не должен попадать в аргументы команды (`ps`): значение передаётся в `curl`
через `--config -` (stdin), как это делает сам `scripts/app-guard.sh`.

```bash
# Значение токена берём из окружения сервера, на экран не печатаем
ALERTMANAGER_WEBHOOK_TOKEN=$(grep -E '^ALERTMANAGER_WEBHOOK_TOKEN=' /opt/pilingtrack/.env | tail -1 | cut -d= -f2- | tr -d '"')

cat > /tmp/runbook014-test-alert.json <<'JSON'
{"alerts":[{"status":"firing","labels":{"alertname":"RunbookSelfTest","severity":"info"},"annotations":{"summary":"Проверка вебхука из ранбука 014"}}]}
JSON

curl -sS -o /dev/null -w '%{http_code}\n' --config - <<CFG
url = "http://127.0.0.1:3000/api/alerts/webhook"
header = "Authorization: Bearer $ALERTMANAGER_WEBHOOK_TOKEN"
data = "@/tmp/runbook014-test-alert.json"
CFG
# ожидаем 200 (и ещё одно сообщение в Telegram)
```

### Про 503 (Telegram недоступен)

503 **вживую не воспроизводим**: для этого пришлось бы ломать доставку в
Telegram (убрать чаты/тенант или положить прокси), что недопустимо на бою. Ветка
закрыта автотестом
`src/app/api/alerts/webhook/__tests__/route.test.ts` („answers 503 when a firing
alert could not be delivered"), а на бою о реальном сбое доставки сигналят
метрика `alertmanager_notifications_failed_total` и правило
`AlertmanagerNotificationsFailing` из шага 1.

---

## См. также

- `docs/audits/hermes-night/R69-alerts-delivery.md` — куда реально доходят
  алерты: находка 1 (нет внешнего сторожа → отсюда `app-guard`), находка 2
  (вебхук всегда 200 → отсюда 503, F-WEBHOOK-RETRY), находка 4 (Alertmanager не
  наблюдался → отсюда job и два правила, F-ALERTMANAGER-WATCH).
- `docs/audits/hermes-night/R70-flaky-tests-under-load.md` — почему тесты падают
  под ночной нагрузкой (к самим шагам не относится, но связано с ночными прогонами).
- `scripts/app-guard.sh` — шапка файла: установка, полный список переменных,
  порог, режим `--test` (F-APP-GUARD `d2aecd13`, F-APP-GUARD-b `8a30bc00`).
- `src/app/api/alerts/webhook/route.ts` и его тест — поведение 200/503
  (F-WEBHOOK-RETRY, `df0e08ff`).
- `observability/prometheus/prometheus-prod.yml` и `alerts.yml` — job
  `alertmanager` и правила `AlertmanagerDown`/`AlertmanagerNotificationsFailing`
  (F-ALERTMANAGER-WATCH, `052031d9`); `TargetDown` без alertmanager
  (F-ALERT-TARGETDOWN-DEDUP, `5493421d`); job `pilingtrack-workers`
  (F-WORKERS-SCRAPE, `5669c97f`); ссылки на реально отдаваемые метрики
  (F-ALERT-NAMES, `3e025549`).
- `docs/runbooks/008-manual-deploy.md` — сама выкладка (сборка, миграции, smoke).
- `docs/runbooks/013-prod-timers.md` — прод-таймеры; `app-guard` добавляется к
  этому набору.

## Переход leader election на Redis состояния (I02, план для владельца)

Lease outbox/projection теперь хранится через getStateRedisClient (REDIS_URL,
инстанс noeviction), а не через клиент кэша, предпочитающий REDIS_URL_CACHE.
Ключи leader:outbox-worker и leader:projection-worker сохраняют существующий
префикс pilingtrack:. TTL по умолчанию остаётся 30 секунд, renewal — 10 секунд.

**Перед будущей выкладкой владелец должен согласованно остановить все старые
исполнители outbox/projection:** standalone workers, unified workers и embedded
workers внутри приложения. Убедиться, что старые процессы завершены и уже
начатые операции закончились, затем запускать новую версию. Rolling-обновление
с одновременной работой старого и нового кода недопустимо: они могут считать
себя лидерами в разных инстансах Redis. Не очищать Redis массово и не удалять
чужие lease вручную. Истечение старых ключей не заменяет остановку процессов.

После перехода проверить одинаковый state Redis у всех исполнителей, один
активный лидер каждого ресурса, takeover standby после остановки лидера и
снятие локального лидерства при недоступном Redis. Атомарные owner-checked Lua
renew/release не продлевают и не удаляют lease другого владельца. Локальный
deadline снимает лидерство даже при зависшем ответе Redis.

Эти действия в рамках I02 не выполнялись. Lease не является DB fencing:
уже начатая операция после паузы процесса может завершиться позже потери lease.
Остановка ждёт незавершённый Redis-запрос перед release, поэтому при зависшем
соединении завершение stop может задержаться; локальное лидерство снимается
сразу и новый start ждёт завершения cleanup.
