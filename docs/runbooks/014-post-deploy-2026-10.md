# Runbook 014 — ручные шаги после выкладки ветки на бой (октябрь 2026)

**Зачем.** Очередная выкладка ветки `hermes/q4-0926` приносит правки, которые
**не вступают в силу сами по себе**. Часть из них — конфигурация мониторинга,
которую Prometheus читает при старте контейнера; часть — новый systemd-таймер,
который на боевом сервере ещё не установлен; часть — проверка, которую можно
сделать только руками. Этот ранбук собирает **четыре** шага в один список: они были
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
4. ~~Завести на бою переменные окружения, которых там нет (`BACKUP_ENABLED`,
   `SENTRY_DSN`).~~ **ВЫПОЛНЕНО 01.10.2026** (проброс — `c166f4a8`, ловушка
   приставки Redis — `0ea0c6be`; см. шаг 4).

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

## Шаг 4. Переменные окружения, которых нет на бою (01.10.2026) — ВЫПОЛНЕНО

**Статус: ВЫПОЛНЕНО 01.10.2026 (вечер).** Проброс обеих переменных внесён в
`docker-compose.yml` надзором в ветке `main` — коммит **`c166f4a8`**
(«fix(compose): пробросить BACKUP_ENABLED в app и SENTRY_DSN в workers»): в блок
`environment:` сервиса `app` добавлена строка `- BACKUP_ENABLED=${BACKUP_ENABLED:-}`,
в блок сервиса `workers` — `- SENTRY_DSN=${SENTRY_DSN:-}`. Владелец добавил обе
строки в `/opt/pilingtrack/.env`, затем `docker compose up -d --no-build app workers`;
обе переменные видны внутри своих контейнеров (проверка без печати значений),
воркер стартовал без ошибок. Тогда же вскрылась ловушка с приставкой ключей Redis,
исправленная коммитом **`0ea0c6be`** («fix(backup): метки бэкапа в Redis с
приставкой pilingtrack:») — см. отдельный подпункт ниже.

⚠️ Оба коммита лежат в `main`; в ветку `hermes/q4-0926` на момент этой правки они
ещё **не влиты**. Если проверка результата (ниже) не сходится — сверьте, что
выложена ревизия, содержащая `c166f4a8` и `0ea0c6be`
(`git log --oneline -1 c166f4a8`; `git log --oneline -1 0ea0c6be`).

Дальнейший текст оставлен как разбор: что именно молчало, почему строки в `.env`
**недостаточно** и как убедиться, что мониторинг бэкапов ожил.

Повод — выкладка 01.10.2026 (`a803e61c`/`cc703810`): по **именам** переменных было
проверено, что в работающих контейнерах **не заданы** две — `BACKUP_ENABLED` и
`SENTRY_DSN` (значения не читались и в документе не приводятся). Обе «тихие»:
их отсутствие не роняет сервис и не пишет ошибку в лог — просто пропадал
сигнал. Ниже: что именно молчало, кто читает переменную и почему одного `.env` мало.

| Переменная | Кто читает (файл) | Что молчит без неё | Нужна контейнеру |
|---|---|---|---|
| `BACKUP_ENABLED` | гейт `isBackupMonitoringEnabled()` — `src/core/observability/health-tracker/checkers/backup.ts:15-19`; предупреждение сборки — `scripts/validate-env.ts:140-142` | мониторинг бэкапов выключен: `checkBackupStatus()` отдаёт `{status:'up', source:'disabled'}` без возраста и `s3Synced` (`backup.ts:76-78`), а `/api/metrics` печатает жёсткие `backup_age_hours 0` и `backup_s3_synced 0` (`src/app/api/metrics/route.ts:111-112`); правило `OffsiteBackupNotSynced` (`backup_s3_synced == 0 and on() backup_age_hours > 0`, `observability/prometheus/alerts.yml:296-307`) сработать не может — о том, что облачной копии нет, никто не узнает | `app` |
| `SENTRY_DSN` | воркер — `src/workers/unified-worker/sentry.ts:24,31`; флаг «настроено» — `src/services/system/system-service.ts:63` | ошибки процесса воркера (outbox / projection / pdf) в Sentry **не уходят**: без DSN `initWorkerSentry()` сразу возвращается, и SDK остаётся no-op (`sentry.ts:13`). Приложение этим не задето — его DSN зашит в коде (`sentry.server.config.ts:8`) | `workers` (приложению не нужна) |

Что важно понимать про «что молчит»:

- `BACKUP_ENABLED` включает только **чтение** готовых ключей. Сами ключи
  `system:backup:*` пишет хостовый таймер (`deploy/systemd/pilingtrack-backup.service`
  → `scripts/backup-postgres.sh`) в инстанс состояния Redis, а приложение читает их
  через `getStateRedisClient()` (`backup.ts:81`) — поэтому переменная нужна
  контейнеру `app`. Принимается любое из `1/true/yes/on` (`backup.ts:18`).
  **Имя ключа — с приставкой `pilingtrack:`**: приложение читает его через ioredis,
  который добавляет приставку сам (см. подпункт «Ловушка приставки ключей Redis»
  ниже) — это отдельная ловушка, вскрывшаяся после проброса переменной.
- `SENTRY_DSN` для воркера — **тот же DSN, что зашит в `sentry.server.config.ts:8`**
  (в этом документе значение не приводится). Инициализация идемпотентна и
  происходит на старте процесса, поэтому нужен перезапуск контейнера `workers`.
- `scripts/validate-env.ts` про `BACKUP_ENABLED` **предупреждает**, но сборку не
  валит (это warning, а не error) — вот почему сборка на бою зелёная, а
  переменной там нет.

### Где задаётся на сервере

Значения — в `/opt/pilingtrack/.env`. **Но одного `.env` недостаточно:** в
`docker-compose.yml` ни у `app`, ни у `workers` **не объявлен `env_file`** (в
`docker-compose.prod.yml` его тоже нет, там только блоки `environment:`), поэтому в
контейнер попадает **только то, что перечислено в блоке `environment:`** этого
сервиса. Та же ловушка уже описана в самом compose (`docker-compose.yml:104-107`,
`:118-123`) и в ранбуке 011. **Строка в `.env` без проброса в блок `environment:`
до контейнера не доезжает** — сколько бы раз её туда ни добавили.

История к 01.10.2026: до коммита `c166f4a8` ни `BACKUP_ENABLED`, ни `SENTRY_DSN`
в блоках `environment:` **не было** (`grep -n 'BACKUP_ENABLED\|SENTRY_DSN'
docker-compose*.yml` → пусто) — именно поэтому строки в `.env` «не работали».
Коммит `c166f4a8` добавил в блок `environment:` сервиса `app` строку
`- BACKUP_ENABLED=${BACKUP_ENABLED:-}` и в блок сервиса `workers` строку
`- SENTRY_DSN=${SENTRY_DSN:-}` (значение берётся из `.env`). Это правка файла
**репозитория**, а не только боевой настройки: без неё следующая выкладка
перезапишет `docker-compose.yml` и проброс исчезнет.

### Что было сделано 01.10.2026 (и что делать, если повторить)

```bash
cd /opt/pilingtrack

# 1. ПРОБРОС в блок environment: — правка репозитория, уже есть в c166f4a8.
#    Без неё строка в .env до контейнера НЕ доедет (env_file не объявлен).
grep -n 'BACKUP_ENABLED\|SENTRY_DSN' docker-compose.yml
#    ожидаем строку у сервиса app (BACKUP_ENABLED) и у сервиса workers (SENTRY_DSN)

# 2. Строки в .env (значения вводит владелец; в документе их нет).
grep -q '^BACKUP_ENABLED=' .env || echo 'BACKUP_ENABLED=true' >> .env
# DSN — тот же, что в sentry.server.config.ts (строка 8 файла в репозитории).
grep -q '^SENTRY_DSN='     .env || echo 'SENTRY_DSN=<тот же DSN, что в sentry.server.config.ts>' >> .env
```

⚠️ **Порядок важен.** Строки в `.env` (пункт 2) **сами по себе ничего не дают**,
пока переменная не перечислена в блоке `environment:` (пункт 1): `env_file` у
`app` и `workers` не объявлен, и в контейнер попадает только явно перечисленное.
До `c166f4a8` этих строк в `docker-compose.yml` не было — вот почему добавление
в `.env` тогда не работало. Пункт 1 — правка файла **репозитория**: без неё
следующая выкладка перезапишет `docker-compose.yml`, и проброс исчезнет.

```bash
# 3. Перезапуск, чтобы переменные доехали (--no-build: образ уже собран).
docker compose up -d --no-build app workers
```

```bash
# 4. Проверка изнутри контейнера. Значения НЕ печатаем — только факт «задана».
docker compose exec -T app     sh -c '[ -n "$BACKUP_ENABLED" ] && echo set'
docker compose exec -T workers sh -c '[ -n "$SENTRY_DSN" ] && echo set'
# ожидаем "set" у обеих; пусто и код 1 = переменная не доехала до контейнера
```

01.10.2026 выполнены все четыре пункта: проброс уже в `main` (`c166f4a8`),
строки в `.env` добавлены владельцем, контейнеры `app` и `workers` пересозданы,
обе переменные внутри своих контейнеров показали «set».

### Ловушка приставки ключей Redis (вскрылась 01.10.2026)

**Любой хостовый скрипт, пишущий ключи для приложения, обязан писать их с
приставкой `pilingtrack:`.** Приложение читает Redis через ioredis с
`keyPrefix: 'pilingtrack:'` (`src/lib/redis-cache.ts:52-66`, `getRedisOptions`;
той же приставкой пользуются клиент состояния и список отозванных токенов —
`src/services/auth/session-service.ts:120`). ioredis добавляет приставку к
каждому ключу **сам**, а `redis-cli` из хостового скрипта — **нет**: он пишет
«сырое» имя. Поэтому ключ `system:backup:*` из `redis-cli` и запрос приложения
`get('system:backup:last_timestamp')` — это **разные** ключи: приложение смотрит
`pilingtrack:system:backup:last_timestamp`.

Как это проявилось: пока `BACKUP_ENABLED` не доезжал до контейнера, проверка
бэкапа была выключена (`source:'disabled'`), и расхождение не было видно. После
проброса (`c166f4a8`) `/api/health/deep` стал **degraded**, а `backup_age_hours`
показывал `0`, хотя метки на бою были свежими — приложение их просто не находило.
Исправлено коммитом `0ea0c6be`: `scripts/backup-postgres.sh` теперь пишет
`pilingtrack:system:backup:*` (три ключа — по-прежнему одной транзакцией
`MULTI/EXEC`). Ночной таймер `pilingtrack-backup.timer` (03:30 МСК) подхватит
правку со следующего прогона, поэтому метки с приставкой появятся **после
ближайшего ночного бэкапа**, а не сразу.

Где ещё в `scripts/**` ключи для приложения пишутся **без** приставки (найдено тем
же grep, `grep -rn 'system:backup\|redis-cli' scripts/`; **не правил** — вне
разрешённых путей этой задачи):

| Файл | Строки | Что пишет | Статус на 01.10.2026 |
|---|---|---|---|
| `scripts/backup-postgres.sh` | 155-157 (после `0ea0c6be`: 161-163) | `system:backup:last_timestamp` / `:last_size` / `:s3_synced` | исправлено `0ea0c6be` → с приставкой |
| `scripts/backup.sh` | 95-97, 166-167, 175-176 | те же три ключа `system:backup:*` | **не исправлено** — «legacy»-бэкап, таймером на бою не запускается (ранбук 013:69); если его всё же запустят на хосте, мониторинг бэкапов снова «ослепнет» (health `degraded`, `backup_age_hours 0`) |

Прочие скрипты в `scripts/**`, трогающие Redis, проверены: `scripts/prod-audit-readonly.sh`
только читает (`INFO memory`), `scripts/redis-stress-test.js` и
`scripts/test-redis-cache.js` пишут свои тестовые ключи (`stress:*`, `test:*`,
`spike:*`), которые приложение не читает, — приставка им не нужна.

### Что проверить после (после ближайшего ночного бэкапа)

```bash
# Полный статус: должно быть "status":"ok" (до 0ea0c6be было degraded с backup_age_hours 0)
curl -s http://127.0.0.1:3000/api/health/deep

# Метрики бэкапа (источник — /api/metrics приложения, job pilingtrack-app)
curl -s -G http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=backup_age_hours'
curl -s -G http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=backup_s3_synced'
```

- `/api/health/deep` → `"status":"ok"`. Пока метки с приставкой не появились (до
  ближайшего бэкапа) health может оставаться `degraded` с `backup_age_hours 0` —
  это ожидаемо между исправлением и ночным прогоном, а не поломка.
- `backup_age_hours` должен стать **больше 0** (сколько часов прошло с последнего
  дампа), а не жёстким `0`. Если по-прежнему `0` — либо переменная не доехала
  (пункты 2–4), либо на хосте не запущен таймер `pilingtrack-backup.timer` и ключи
  `system:backup:*` не пишутся вовсе (см. ранбук 013).
- `backup_s3_synced` = `1`, если ночная копия ушла в R2. `0` при
  `backup_age_hours > 0` дольше 26 ч — это уже настоящий сигнал (сработка
  `OffsiteBackupNotSynced`), а не «выключенный мониторинг».
- Sentry: отдельного лога при успешной инициализации воркера нет, поэтому признак —
  сама переменная внутри контейнера `workers` (пункт 4). Если `set` вывелось, а
  событий от воркеров в Sentry всё равно нет — смотреть `docker compose logs workers`
  на строку «Sentry init failed in worker process» (`sentry.ts:39-41`).

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
- `scripts/validate-env.ts:129-143,235` — предупреждения сборки о переменных,
  без которых функция молча выключается (в т.ч. `BACKUP_ENABLED`); они **не валят**
  сборку, поэтому шаг 4 нельзя пропустить.
- `docs/audits/hermes-night/R61-env-vars.md` — инвентарь переменных окружения
  (находки 1 и 28: `BACKUP_ENABLED`/`BACKUP_DIR` и зашитый DSN Sentry).

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
