# AU40-S7 — Ресурсы и ограничения контейнеров в production-compose

Версия: `git rev-parse HEAD` = `648bf92d28324b49a8677d115784036c1f7a73b7` (кратко `648bf92d`).
Дата: 2026-10-09. Только чтение — код приложения не менялся.
Сервер (по условию задачи): 3.8 ГБ ОЗУ, диск 30 ГБ.

## Резюме для владельца (5 строк)

1. Сумма лимитов памяти всех контейнеров (без MinIO) = 2 816 + 1 216 = 4 032 МБ, это больше 3,8 ГБ (3 891 МБ); с MinIO — 4 544 МБ. Лимиты не резервируются, но при пиковой нагрузке ОЗУ сервера не хватит всем.
2. У Redis (state) лимит контейнера 256m равен `maxmemory 256mb`; реальный RSS будет выше (база + буферы AOF + fork при перезаписи), значит Redis убьёт OOM-киллер, а не его собственная политика — это КРИТИЧНО для счётчиков rate-limit и очередей.
3. У `redis-cache` и `pgbouncer` нет НИ лимитов, НИ ротации логов в prod-overlay; у `pgbouncer` ещё и нет healthcheck, и его нет в `depends_on` у app/workers, хотя оба ходят в базу именно через пул.
4. Нет ни одной тревоги на лимит памяти/CPU контейнера и нет скрейпа контейнерных ресурсов (cAdvisor) — приближение к лимиту не видно.
5. Диск: Prometheus в `monitoring-prod` ограничен 14д/2ГБ, но `grafana-data`, `minio_data`, `postgres_data`, `redis_data` растут без политики очистки; в альтернативном `docker-compose.observability.yml` retention 30д без лимита размера.

Во всех таблицах ниже «prod» = результат наложения `docker-compose.prod.yml` на базовый `docker-compose.yml` (так и запускается: `-f docker-compose.yml -f docker-compose.prod.yml`, `docs/deployment.md:72-74`).

## Методика

Что и как искал (чтобы можно было перепроверить):

- `git rev-parse HEAD` — версия.
- Читал полностью: `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.monitoring-prod.yml`, `Dockerfile`, `Dockerfile.workers`, `deploy/Dockerfile.prod`, `Dockerfile.quick`, `scripts/Dockerfile.backup`, `docker-compose.staging.yml`, `docker-compose.observability.yml`, `docker-compose.monitoring-standalone.yml`, `deploy/Caddyfile.prod`, `Caddyfile`, `observability/prometheus/prometheus-prod.yml`, `observability/prometheus/prometheus.yml`, `observability/prometheus/alerts.yml`, `deploy/systemd/*`, `scripts/backup-postgres.sh`, `scripts/backup.sh`, `scripts/disk-guard.sh`, `scripts/deploy-prod.sh`, `docs/deployment.md`, `.dockerignore`.
- Границы сервисов/лимитов — `grep -nE "^  [a-z-]+:|healthcheck:|restart:|logging:|memory:|cpus:"` по трём compose-файлам (вывод приведён ниже, файлы:строки сверены).
- Сложение — командами `node -e` (числа только оттуда):

```
$ node -e '<сложение памяти>'
core (с minio): 3328 МБ = 3.250 ГиБ
core (без minio): 2816 МБ = 2.750 ГиБ
monitoring: 1216 МБ = 1.188 ГиБ
core+mon (с minio): 4544 МБ = 4.438 ГиБ
core+mon (без minio): 4032 МБ = 3.938 ГиБ
сервер 3.8 ГБ = 3891.2 МБ
превышение (без minio): 140.8 МБ

$ node -e '<сложение CPU>'
CPU core: app=1 + workers=0.75 + postgres=1 + redis=0.5 + minio=0.5 = 3.75 ядер
```

- Состав лимитов (файл:строка): `docker-compose.prod.yml:34` (app 1g), `:50` (workers 512m), `:107` (postgres 1g), `:118` (redis 256m), `:136` (minio 512m); `docker-compose.monitoring-prod.yml:49` (prometheus 512m), `:78` (grafana 384m), `:96` (node-exporter 64m), `:113` (postgres-exporter 64m), `:146` (alertmanager 128m), `:169` (redis-exporter 64m).
- Состав `healthcheck`/`restart`/`logging` — из того же grep (см. таблицы).
- Развёртывание в prod и выбор compose-файлов — `scripts/deploy-prod.sh:113` (`docker compose up -d --no-build`), `docs/deployment.md:72-74`, `scripts/staging-local.sh:52-53`.

Статусы: **ПРОЙДЕНО** — проверено по файлу; **ГИПОТЕЗА** — вывод из прочитанного, на сервере не измерялось; **НЕ ПРОВЕРЕНО** — нет данных (например, реальный RSS при нагрузке, число ядер CPU).

## Таблица сервисов (prod = base + overlay)

Колонки: сервис | образ | лимит памяти / CPU | restart | healthcheck | тома | порты наружу | зависимости | что при падении.

| сервис | образ | память / CPU | restart | healthcheck | тома | порты | depends_on | что при падении |
|---|---|---|---|---|---|---|---|---|
| migrate | Dockerfile target `migrate` | нет | `"no"` (`docker-compose.yml:55`) | нет | нет | нет | postgres(healthy) | если упал — app/workers не стартуют (`service_completed_successfully`, `docker-compose.yml:137-138`) |
| app | Dockerfile target `runner` | 1g / 1.0 (`prod:34-35`) | unless-stopped (`docker-compose.yml:68`) | CMD wget /api/health (`:139-144`) | нет | 127.0.0.1:3000 (`prod:24-25`) | postgres, redis, redis-cache, migrate (`:130-138`) | авто-restart; сайт недоступен до healthy |
| workers | Dockerfile.workers `runner` | 512m / 0.75 (`prod:50-51`) | unless-stopped | CMD curl :3002/health (`:216-221`) | нет | 127.0.0.1:3002 (`prod:45-46`) | postgres, redis, redis-cache, migrate (`:207-215`) | outbox/projection/PDF/планировщики стоят; алерт WorkersDown (alerts.yml:272-283) |
| pgbouncer | edoburu/pgbouncer:latest | **нет** (`prod:124-128` только logging) | unless-stopped | **нет** | нет | нет (`prod:125` !reset) | postgres(healthy) | app/workers теряют БД; авто-restart, но без health-сигнала |
| redis (state) | redis:7-alpine | 256m / 0.5 (`prod:118-119`) | unless-stopped | redis-cli ping (`:300-304`) | redis_data:/data, AOF (`:288-299`) | нет (`prod:114`) | нет | теряются счётчики rate-limit и очереди; авто-restart |
| redis-cache | redis:7-alpine | **нет** | unless-stopped | redis-cli ping (`:331-335`) | нет (без AOF) | нет | нет | только промах кэша; но нет cgroup-лимита и нет ротации логов |
| postgres | postgres:18-alpine | 1g / 1.0 (`prod:107-108`) | unless-stopped | pg_isready (`:372-376`) | postgres_data + /opt/pilingtrack/wal-archive (`prod:73-75`) | нет (`prod:69`) | нет | БД недоступна = весь сайт лежит; авто-restart |
| minio | minio/minio:RELEASE.2024-09-13 | 512m / 0.5 (`prod:136-137`) | unless-stopped | curl :9000/minio/health/live (`:416-420`) | minio_data:/data (`:415`) | 127.0.0.1:9001 (`prod:131-132`) | нет | PDF/фото недоступны |
| minio-init | minio/mc:RELEASE.2024-09-16 | нет | по умолчанию `no` | нет | нет | нет | minio(healthy) | создаёт бакет один раз и выходит |
| pgadmin | dpage/pgadmin4:latest | нет | unless-stopped | нет | нет | 5050:80 (`:387-388`) | postgres | профиль `dev`, в prod не стартует (`:392-393`) |
| prometheus | prom/prometheus:latest | 512m / **CPU нет** (`mon:49`) | unless-stopped | **нет** | prometheus-data + конфиги (`mon:35`) | 127.0.0.1:9090 (`mon:18`) | нет | мониторинг слепнет |
| grafana | grafana/grafana:latest | 384m / **CPU нет** (`mon:78`) | unless-stopped | **нет** | grafana-data + конфиги (`mon:66`) | 127.0.0.1:3010 (`mon:58`) | prometheus (`mon:73-74`) | дашборды недоступны |
| node-exporter | prom/node-exporter:latest | 64m / **CPU нет** (`mon:96`) | unless-stopped | **нет** | `/:/host:ro,rslave` (`mon:89`) | нет | нет | метрики хоста пропадают |
| postgres-exporter | prometheuscommunity/postgres-exporter | 64m / **CPU нет** (`mon:113`) | unless-stopped | **нет** | нет | нет | нет | метрики PG пропадают |
| alertmanager | prom/alertmanager:latest | 128m / **CPU нет** (`mon:146`) | unless-stopped | **нет** | alertmanager-data + конфиг (`mon:125`) | 127.0.0.1:9093 (`mon:122`) | нет | тревоги не доставляются |
| redis-exporter | oliver006/redis_exporter:latest | 64m / **CPU нет** (`mon:169`) | unless-stopped | **нет** | нет | нет | нет | метрики Redis пропадают |

Вне compose: Caddy работает на хосте (`deploy/Caddyfile.prod`), это единственная внешняя точка входа; лимитов/healthcheck в compose у него нет по построению.

Сложение памяти (см. «Методика»): core без MinIO 1 024+512+1 024+256 = **2 816 МБ**; monitoring 512+384+64+64+128+64 = **1 216 МБ**; итого **4 032 МБ = 3.94 ГиБ > 3.8 ГБ (3 891 МБ)**. С MinIO (+512 МБ) → **4 544 МБ = 4.44 ГиБ**. Без лимита вовсе: pgbouncer, redis-cache, migrate, плюс сам хост, Docker daemon и Caddy.

## Находки

Формат: № | severity | файл:строка | проблема | сценарий / почему важно | предлагаемое исправление.

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | docker-compose.prod.yml:34,50,107,118,136 + docker-compose.monitoring-prod.yml:49,78,96,113,146,169 | Сумма лимитов памяти 4 032 МБ (без MinIO) / 4 544 МБ (с MinIO) превышает 3.8 ГБ сервера. Numbers: core 2 816 + monitoring 1 216 = 4 032 МБ; 3.8 ГБ = 3 891 МБ. | При одновременном пике (app+PG+redis+MinIO и мониторинг) лимиты нерезервируемы, ОЗУ кончается → ядро/OOM-киллер выбирает жертву без приоритета, может убить postgres или app. Статус: ГИПОТЕЗА (теоретический максимум, не замер на сервере). | Снизить сумму лимитов (например, prometheus 512→256, grafana 384→256), либо поднять ОЗУ, либо разнести мониторинг на другой хост; явно задать `deploy.resources.reservations` для postgres/app. |
| 2 | критично | docker-compose.prod.yml:118 (лимит 256m) vs docker-compose.yml:296-299 (`--maxmemory 256mb`, `--appendonly yes`) | Лимит контейнера Redis равен его `maxmemory`; RSS = база + клиентские буферы + AOF-буферы + fork при `BGREWRITEAOF` — это больше 256 МБ. | Redis убивается cgroup-OOM вместо мягкого `noeviction`-отказа: теряются счётчики rate-limit (окно брутфорса) и очереди outbox/BullMQ. Статус: ГИПОТЕЗА (нужен замер `docker stats`). | Дать контейнеру запас: лимит 384–512m при `maxmemory 256mb`, либо снизить `maxmemory` (~200mb). |
| 3 | важно | docker-compose.prod.yml:22-151 (нет блока `redis-cache`) + docker-compose.yml:316-339 | У `redis-cache` нет ни лимита памяти/CPU, ни переопределения `logging` в prod-overlay, хотя базовый драйвер json-file без ротации. | Память: dataset держит только `--maxmemory 256mb`, cgroup-кап отсутствует. Логи: `docker logs` растёт без ограничения и заполняет /var/lib/docker на 30-ГБ диске. Статус: ПРОЙДЕНО (отсутствие подтверждено grep). | Добавить `redis-cache` блок в prod-overlay: `deploy.resources.limits` (например 256m/0.25) и `logging` (10m×3). |
| 4 | важно | docker-compose.yml:237-271 (pgbouncer, нет `healthcheck`), :130-138 (app depends_on), :207-215 (workers depends_on) | `pgbouncer` не имеет healthcheck и не указан в `depends_on` у app/workers, хотя `DATABASE_URL` обоих идёт на `pgbouncer:5432` (`:78`, `:168`). | app/workers стартуют, как только healthy postgres/redis/migrate — раньше, чем pgbouncer примет соединения. Ошибки подключения на старте, мигающие healthy, возможный crash-loop. Статус: ПРОЙДЕНО. | Добавить pgbouncer healthcheck (например `pg_isready -h 127.0.0.1 -p 6432`) и `depends_on: pgbouncer: condition: service_healthy` в app и workers. |
| 5 | важно | docker-compose.prod.yml:124-128 | У `pgbouncer` нет лимитов памяти/CPU (только `logging`). | Единственная служба пула соединений не ограничена; при утечке/всплеске может съесть незанятую ОЗУ и подтолкнуть хост к OOM. Статус: ПРОЙДЕНО. | Добавить `deploy.resources.limits` (например 128m / 0.25). |
| 6 | важно | docker-compose.prod.yml:107 (postgres 1g) + docker-compose.yml:363-371 (`max_connections=200`, `shared_buffers=256MB`) | Лимит 1 ГБ при 200 соединениях и `work_mem` по умолчанию 4 МБ: worst-case ~800 МБ work_mem + 256 МБ shared_buffers = >1 ГБ. | Под нагрузкой (сортировки/хеши на 200 бэкендах) postgres выходит за лимит и убивается OOM — весь сайт лежит. Статус: ГИПОТЕЗА (реальный work_mem в схеме не задан). | Поднять лимит postgres до 1.5g, либо снизить `max_connections`/задать явный `work_mem`, либо ограничить пул pgbouncer. |
| 7 | важно | docker-compose.prod.yml:50-51 vs docker-compose.yml:222-230, :176-178 | prod-overlay срезает лимит workers с 2G/2.0 (база) до 512m/0.75; воркер запускается через `tsx` (транспиляция в рантайме) и ведёт PDF (`PDF_WORKER_CONCURRENCY=2`), outbox и projection. | 512 МБ на tsx + PDF-генерация может не хватить, воркер падает OOM → смены не закрываются, наряды не истекают, PDF стоят в очереди (алерт WorkersDown). Статус: ГИПОТЕЗА (нужен замер RSS воркера). | Поднять лимит workers до 768m–1g либо снизить `PDF_WORKER_CONCURRENCY`. |
| 8 | важно | observability/prometheus/alerts.yml:112-121, :344-352; observability/prometheus/prometheus-prod.yml:28-92 | Нет ни одной тревоги на лимит памяти/CPU контейнера и на OOM; есть только `process_heap_used_bytes/process_heap_bytes` (heap Node) и `redis_memory_used_bytes/redis_memory_max_bytes`. | Heap-метрика не видит RSS вне heap (Prisma, буферы) и не видит postgres/redis/MinIO. Приближение к cgroup-лимиту и OOM-kill проходят молча — «сайт просто упал». Статус: ПРОЙДЕНО. | Добавить правила на `container_memory_working_set_bytes / container_spec_memory_limit_bytes` и `container_oom_events_total` (нужен cAdvisor). |
| 9 | важно | observability/prometheus/prometheus-prod.yml:23-92 | В scrape_configs нет cAdvisor (контейнерных ресурсов); скрейпятся только app, workers, node, postgres, redis, prometheus, alertmanager. | Без контейнерных метрик нет данных ни для тревог (п.8), ни для дашборда по приближению к лимитам — ресурсные проблемы не диагностируются проактивно. Статус: ПРОЙДЕНО. | Добавить сервис cadvisor и job в prometheus-prod.yml. |
| 10 | важно | docker-compose.monitoring-prod.yml:39-40 vs docker-compose.observability.yml:34 | Два параллельных стека мониторинга: `monitoring-prod` (retention 14д + 2ГБ, порты только 127.0.0.1) и `observability` (retention 30д без лимита размера, порты на 0.0.0.0). `docs/deployment.md:162-170` отправляет ставить именно `docker-compose.observability.yml`. | Если на сервере поднят observability, Prometheus растёт 30 дней без капа размера, а порты 9090/3010/9093/3100/3200 открыты на все интерфейсы — риск и по диску (30 ГБ), и по безопасности. Статус: ГИПОТЕЗА (какой стек реально запущен — надо проверить на сервере). | Определить один prod-стек; в observability либо добавить `--storage.tsdb.retention.size`, либо удалить файл; привести docs/deployment.md в соответствие. |
| 11 | важно | docker-compose.observability.yml:19-160 | Ни у одного сервиса нет `deploy.resources.limits` и `logging` (ротации логов); плюс `version: '3.8'` (устаревшее в Compose v2). | Простаивающий/использованный альтернативный стек не ограничен по памяти и не крутит логи — на 3.8 ГБ/30 ГБ это лишний риск. Статус: ПРОЙДЕНО. | Добавить лимиты и `logging` (или удалить файл, если он не используется на prod). |
| 12 | важно | docker-compose.yml:414-415 (`minio_data:/data`), нет политики очистки | `minio_data` (PDF-отчёты, фото) растёт без retention — политики очистки/версионирования в compose нет. | На 30-ГБ диске медиа со временем заполнят том; отдельного алерта на рост именно этого тома нет. Статус: ГИПОТЕЗА (объём медиа не измерен). | Задать lifecycle-политику в MinIO / вынести на внешний S3 (`S3_ENDPOINT`), следить за `node_filesystem_avail_bytes`. |
| 13 | важно | docker-compose.monitoring-prod.yml:182-183 (`pilingtrack_pilingtrack: external: true`) | Мониторинг подключается к сети с именем проекта `pilingtrack` жёстко; если проект запущен под другим именем, сеть не найдётся и мониторинг не увидит app/workers. | Monit-стек поднимается отдельной командой (`docker compose -f docker-compose.monitoring-prod.yml up -d`); имя сети зависит от `-p`. При несовпадении Prometheus не скрейпит app → TargetDown. Статус: ГИПОТЕЗА (нужно проверить имя сети на сервере). | Зафиксировать имя проекта (`-p pilingtrack`) или объявить сеть через `name:` в базовом compose. |
| 14 | мелочь | docker-compose.monitoring-prod.yml:14-172 (весь файл) | Ни у одного сервиса мониторинга нет `healthcheck`. | `restart: unless-stopped` перезапускает только упавший процесс; зависший (не отвечает, но жив) prometheus/grafana/alertmanager формально «работает». Статус: ПРОЙДЕНО. | Добавить healthcheck (HTTP-пробу `/-/healthy` у Prometheus, `/api/health` у Grafana и т.п.). |
| 15 | мелочь | docker-compose.monitoring-prod.yml:105 vs docker-compose.yml:355 | Дефолт `POSTGRES_DB` расходится: у postgres-exporter `pilingtrack`, у основного postgres `pilingtrack_test`. | Если `POSTGRES_DB` не задан в окружении при запуске мониторинга, экспортёр лезет в несуществующую базу → метрики PG пустые. Статус: ПРОЙДЕНО. | Привести дефолты к одному значению (`pilingtrack`). |
| 16 | мелочь | docker-compose.yml:284-287, :351, :241-242, :411-413 | В базовом compose порты БД/Redis/PgBouncer/MinIO отданы на `0.0.0.0` (postgres 5435, redis 6380, pgbouncer 6432, minio 9000/9001). | В prod-overlay они снимаются, но базовая команда `docker compose up` (dev/ручной запуск) открывает БД наружу. Статус: ПРОЙДЕНО. | Для не-public окружений биндить на `127.0.0.1`. |
| 17 | мелочь | docker-compose.prod.yml:28-30 (NODE_OPTIONS=--max-old-space-size=512) | Комментарий объясняет кап через memory-check приложения, но 512 МБ — это heap; RSS включает вне-heap (Prisma/буферы), суммарно может приближаться к лимиту 1g. | Само по себе не проблема, но запас до лимита меньше, чем кажется по числу 512. Статус: ГИПОТЕЗА. | Учесть при пересмотре лимита app (п.1). |

Итого: критично — 2, важно — 11, мелочь — 4. Всего 17 находок.

## Не проверено

- **Число ядер CPU сервера** — неизвестно; сумма лимитов CPU ядер core = 3.75 (`app 1.0 + workers 0.75 + postgres 1.0 + redis 0.5 + minio 0.5`), но сравнить с реальным числом ядер нельзя. Метрику не снимал (read-only, сервер не читал).
- **Реальный RSS/OOM на сервере** — ни `docker stats`, ни `dmesg | grep -i oom`, ни `docker events` не запускались (нет доступа к prod, AGENTS.md запрещает). Все выводы про OOM (пп.1,2,6,7) — ГИПОТЕЗА из конфигов.
- **Размеры образов и занятое место на диске** — точных чисел нет (образы не собирал). В комментариях репозитория есть оценки: `Dockerfile.workers:17` («образ 0.76 ГБ у app»), `Dockerfile.workers:16` (прежний workers 2.46 ГБ), `Dockerfile:49-53` (migrate раньше тянул ~2.46 ГБ).
- **Фактический стек мониторинга на prod** — `monitoring-prod` или `observability` (п.10) — по коду не определить; нужна проверка на сервере.
- **Имя docker-сети проекта на prod** (п.13) — не подтверждено.
- **Наличие cAdvisor / container-метрик в проде** — предполагаю, что нет (в `prometheus-prod.yml` job'а нет), но на сервере не проверял.
- **Наличие swap** на сервере — не проверено; при его отсутствии риск OOM выше.
- **`alertmanager.yml` и реальные секреты** — не читал значения (только упоминания в compose); необходимость в этом для задачи отсутствует.
- **Dockerfile.quick / deploy/Dockerfile.prod / scripts/Dockerfile.backup** — прочитаны, но ни один из них не используется в боевых compose-файлах (`build.dockerfile` только `Dockerfile` и `Dockerfile.workers`), поэтому в таблицу сервисов не включены; отдельного вреда не зафиксировано.
