# W110 — Compose: сервисы без проверки здоровья и без перезапуска

## Итог

Боевой стек — это `docker-compose.yml` (база) поверх `docker-compose.prod.yml` (оверлей),
что подтверждают `docs/deployment.md:72-74` и `scripts/staging-local.sh:53`.
Все длительно живущие сервисы (`app`, `workers`, `postgres`, `redis`, `redis-cache`,
`pgbouncer`, `minio`, `pgadmin`) имеют `restart: unless-stopped` — то есть перезагрузку
сервера они переживут. `restart: "no"` стоит только у одноразовых `migrate` и (неявно)
`minio-init`, и это правильно.

Настоящие дыры — не в `restart`, а в двух местах: (1) `pgbouncer` — единственный путь к
базе для `app`/`workers` — вообще без `healthcheck` и без лимита памяти; (2) в репозитории
нет ни одного механизма, который перезапускает *зависший, но живой* контейнер — докеровский
`restart:` реагирует только на выход процесса, а хостовый сторож (`scripts/app-guard.sh:14-15`)
лишь шлёт сообщение в Telegram и «никогда не перезапускает контейнеры».

Счёт по важности: критично — 2, важно — 6, мелочь — 3 (всего 11).

Топ-5:
1. `pgbouncer` без `healthcheck` — зависание пула невидимо, база «пропадает» для всех.
2. `pgbouncer` без лимита памяти — на одном VPS неограниченный рост памяти пула.
3. Никакого авто-перезапуска нездоровых контейнеров (нет autoheal, сторож не перезапускает).
4. `redis-cache` отсутствует в прод-оверлее — без ротации логов и без лимита памяти на бою.
5. `migrate` без лимита памяти, хотя он гоняет `prisma migrate deploy` + seed.

## Методика

- Прочитаны целиком все шесть файлов Compose в корне репозитория:
  `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`,
  `docker-compose.observability.yml`, `docker-compose.monitoring-standalone.yml`,
  `docker-compose.monitoring-prod.yml` (поиск `docker-compose*.yml`).
- По каждому сервису проверено наличие ключей `restart`, `healthcheck`, `depends_on`
  c условием `service_healthy` / `service_completed_successfully`, `deploy.resources.limits`
  (или `mem_limit`), `logging` с `max-size`/`max-file`.
- Какой стек реально на проде: `docs/deployment.md:70-78` (`-f docker-compose.yml -f docker-compose.prod.yml`),
  `scripts/staging-local.sh:53`, `scripts/prod-audit-readonly.sh:45-53` (скрипт аудита прямо
  предупреждает, что без `COMPOSE_FILE` оверлей не применяется).
- Наличие инструментов healthcheck внутри образов проверено по `Dockerfile` (строка 106-111:
  `apk add wget`, `HEALTHCHECK ... wget ... /api/health`) и `Dockerfile.workers` (строка 63:
  `apk add curl`, строки 93-94: `HEALTHCHECK ... curl ... :3002/health`).
- Наличие самих эндпоинтов: `src/app/api/health/route.ts`, `src/workers/unified-worker/health-server.ts:9,62`
  (`/health`, порт из `WORKER_HEALTH_PORT`, `config.ts:6`).
- Поиск механизма авто-перезапуска нездоровых контейнеров по всему репозиторию:
  `autoheal|auto-heal|willfarrell` — совпадение только в комментарии кода воркера
  (`src/workers/unified-worker/projection-rebuild-scheduler.ts:8`), сервиса `autoheal` нет.
- Роль Caddy: поиск `caddy|Caddy` — файлы `Caddyfile`, `deploy/Caddyfile.prod`,
  упоминания в документации; сервиса Caddy ни в одном compose нет.
- Docker не запускался (правило задачи). Живое состояние сервера не читалось.

## Находки

| # | важность | path:line | проблема | чем грозит | что делать |
|---|----------|-----------|----------|------------|------------|
| 1 | критично | `docker-compose.yml:237-271` | У сервиса `pgbouncer` нет блока `healthcheck`. | `app` и `workers` ходят в базу ТОЛЬКО через `pgbouncer:5432` (`docker-compose.yml:78`, `168`). Зависший пул неотличим от рабочего: контейнер жив, `docker ps` показывает «Up», а все запросы к БД висят/падают. Ни `docker compose ps`, ни сторож не увидят поломку. | Добавить `healthcheck` (например `pg_isready -h localhost -p 6432` или `nc -z`), затем гейтить `app`/`workers` условием `service_healthy`. |
| 2 | критично | `docker-compose.yml:237-271` + `docker-compose.prod.yml:124-128` | У `pgbouncer` нет ни `mem_limit`, ни `deploy.resources.limits` (оверлей добавляет только `logging`). | На проде один VPS (см. контекст задачи). Неограниченный рост памяти пула выест RAM, и ядро убьёт соседние контейнеры (postgres/app) — «сайт лёг» без явной причины. | Задать `deploy.resources.limits.memory` пулу (например 256-512m), как у остальных. |
| 3 | важно | `scripts/app-guard.sh:14-15, 17-19`; поиск `autoheal` по репо | Нет автоматического перезапуска *нездорового* контейнера. `restart: unless-stopped` перезапускает только при выходе процесса; зависший (alive, но не отвечающий) контейнер докер не трогает. Хостовый сторож прямо документирует «only watches: it never restarts containers» (стр. 14-15) и лишь шлёт одно сообщение в Telegram за серию из 3 неудачных проверок. | Зависший `app`/`workers`/`pgbouncer` остаётся в этом состоянии до ручного вмешательства — простой без самовосстановления, особенно ночью. | Добавить сервис-«лекарь» (`autoheal` с `--restart` на контейнеры в статусе unhealthy) ЛИБО научить хостовый сторож перезапускать unhealthy-сервисы. |
| 4 | важно | `docker-compose.prod.yml:22-147` (нет блока `redis-cache`) + `docker-compose.yml:316-339` | `redis-cache` не упомянут в прод-оверлее: ни `logging` (ротации логов нет), ни лимита памяти. Аналогично вне прод-оверлея остаётся и `minio-init`. | На бою json-file логи `redis-cache` растут без ограничения и копятся в `/var/lib/docker` (оверлей для остальных задаёт `max-size`/`max-file` — значит риск осознавали). Ограничение памяти у сервиса есть только внутри процесса (`--maxmemory 256mb`), сам контейнер не ограничен. | Добавить в `docker-compose.prod.yml` блок `redis-cache` с тем же `logging` и `deploy.resources.limits`. |
| 5 | важно | `docker-compose.prod.yml:142-147` | Сервис `migrate` без лимита памяти (оверлей задаёт только `logging`). | `migrate` выполняет `prisma migrate deploy` и, если `SKIP_SEED!=1`, `tsx prisma/seed.ts` (`docker-compose.yml:29-40`). Тяжёлая миграция/сид без ограничения может выесть RAM VPS в момент выката. `restart: "no"` при этом корректен (сервис одноразовый). | Задать лимит памяти, например 512m-1g. |
| 6 | важно | `docker-compose.monitoring-prod.yml:13-172` | В боевом мониторинге (Prometheus, Grafana, Alertmanager, node/postgres/redis-экспортёры) нет ни одного `healthcheck`. | Эти контейнеры — источник сигналов тревоги. Зависший prometheus/alertmanager/экспортёр означает, что алерты перестают приходить, и никто об этом не узнает (тихий отказ мониторинга). | Добавить `healthcheck` (HTTP `/-/healthy` у prometheus/alertmanager, `/metrics` у экспортёров), при желании завязать на «лекаря» из п.3. |
| 7 | важно | `docker-compose.monitoring-prod.yml:73-74` | `grafana` зависит от `prometheus` через простой список `depends_on`, без `condition: service_healthy`. | Запуск в произвольном порядке: grafana может подняться до готовности prometheus — первые запросы к datasource падают с ошибкой. Тип `depends_on: [список]` (не map) вообще не ждёт готовности. Укажите `condition`. | Заменить на `depends_on: { prometheus: { condition: service_healthy } }` — но сначала дать prometheus `healthcheck` (п.6). |
| 8 | мелочь | `docker-compose.yml:383-397` | `pgadmin`: нет `healthcheck`, нет лимита памяти, `depends_on: [postgres]` — списком, без условия. | На прод не влияет: сервис за `profiles: [dev]` (`docker-compose.yml:392-393`), в оверлее прямо отмечено, что он не поднимается (комментарий `docker-compose.prod.yml:149-150`). | Ничего не менять на бою; при желании — привести к общему виду для локальной разработки. |
| 9 | мелочь | `docker-compose.yml:425-438` | `minio-init`: нет `logging`, нет `healthcheck`, нет `restart` (аналогично `migrate`). | Одноразовый контейнер (создаёт бакет и выходит), на прод-логи и память влияния практически нет. Отсутствие `restart`/`healthcheck` здесь корректно. | Не трогать; при желании добавить `logging` для единообразия. |
| 10 | мелочь | `docker-compose.observability.yml:16-170`, `docker-compose.monitoring-standalone.yml:18-136` | В этих двух стеках нет ни `healthcheck`, ни лимитов памяти, ни ротации логов; присутствует устаревший `version: '3.8'` (`observability.yml:16`) и зашитый `GF_SECURITY_ADMIN_PASSWORD=admin`. | Это локальные/standalone-стеки, не боевые (`docker-compose.monitoring-prod.yml:1-12` — это то, что стоит на проде). Влияние на прод отсутствует. | Оставить; держать в уме, что бою соответствует именно `monitoring-prod.yml`. |

### Критичные для работы сервисы (пункт 4 задачи)

- `app` — есть (`docker-compose.yml:60`), `restart` ✓, `healthcheck` ✓.
- `workers` — есть (`docker-compose.yml:155`), `restart` ✓, `healthcheck` ✓.
- `postgres` — есть (`docker-compose.yml:344`), `restart` ✓, `healthcheck` ✓ (и `app`/`workers` ждут его по `service_healthy`).
- `redis` (state) — есть (`docker-compose.yml:280`), `restart` ✓, `healthcheck` ✓.
- `pgbouncer` — есть (`docker-compose.yml:237`), `restart` ✓, но `healthcheck` ✗ (см. находку 1).
- `caddy` — В КОМПОЗЕ ОТСУТСТВУЕТ. Присутствуют только конфиги `Caddyfile`, `deploy/Caddyfile.prod`. Reverse-proxy стоит на хосте, вне Docker, поэтому его `restart`/`healthcheck` compose не описывает и в этой описи не проверялся. Отдельного юнита `caddy.service` в репозитории нет (в `deploy/systemd/` только `pilingtrack-app-guard`, `-backup`, `-disk-guard`, `-pitr-basebackup`).

### Положительное (чтобы не читалось как «всё плохо»)

- Ни один длительно живущий сервис не остался без `restart` — перезагрузку сервера стек переживёт.
- `app` и `workers` правильно ждут `postgres`/`redis`/`redis-cache` по `service_healthy` и `migrate` по `service_completed_successfully` (`docker-compose.yml:130-138, 207-215`).
- Цели healthcheck реально существуют: `/api/health` (`src/app/api/health/route.ts`) и `/health` воркера на `WORKER_HEALTH_PORT=3002` (`src/workers/unified-worker/health-server.ts:9`, `config.ts:6`); нужные утилиты (`wget` в runner `Dockerfile:106-111`, `curl` в `Dockerfile.workers:63`) в образы установлены.
- Все прочие боевые сервисы (кроме `pgbouncer`) получили в `docker-compose.prod.yml` ротацию логов `max-size`/`max-file`.

## Не проверено

- Живое состояние боевого сервера: `docker ps`, фактические статусы `health`, `RestartCount`, применён ли реально `COMPOSE_FILE` в `/opt/pilingtrack/.env`. Docker не запускался по правилу задачи; проверить можно скриптом `scripts/prod-audit-readonly.sh`:45-53 (секция 4) и секцией 9 (health/restarts).
- Управление Caddy на хосте (systemd-юнит, `restart`, наличие health-проверки домена) — в репозитории файлов хостового юнита нет; вне этого аудита.
- Реальная достаточность лимитов памяти (подобраны ли значения под фактическое потребление и размер VPS) — требует `docker stats` на бою, здесь не запускалось.
- Поведение `deploy.resources.limits` в режиме не-swarm/compose: гарантирует ли установленная версия Docker их применение без `--compatibility` — не проверено (нет доступа к версии докера на хосте).
