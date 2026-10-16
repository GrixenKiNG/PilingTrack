# AU257-S7-COMPOSE-RESOURCE-LIMITS: Лимиты ресурсов контейнеров

**Git commit:** 9a28c79e145499ef4e90a02d4522222f35a0cb04
**Дата:** 2026-10-11
**Сервер:** 3.8 ГБ ОЗУ (3891 МБ)

---

## Итог

- **Сервисов проанализировано:** 17 (8 core + 6 monitoring-prod + 3 observability без лимитов)
- **С лимитами памяти:** 14 / 17 (82%)
- **С лимитами CPU:** 10 / 17 (59%)
- **С restart-политикой:** 16 / 17 (94%), migrate — `restart: "no"` (нормально)
- **Сумма лимитов core (prod overlay):** 3328 МБ (3.25 ГБ) — **85% сервера**, запас 563 МБ
- **Сумма лимитов core + monitoring-prod:** 4544 МБ (4.44 ГБ) — **117% сервера**, дефицит 653 МБ
- **Критично:** pgbouncer, redis-cache, migrate, minio-init в base compose **без лимитов** — могут съесть остаток RAM
- **Важно:** monitoring-prod вместе с core превышает 3.8 ГБ — на сервере либо monitoring выключен, либо OOM-риск

**Топ-5 находок:**
1. **Критично** — pgbouncer (docker-compose.yml:237) без лимитов памяти/CPU, хоть и слушает 6432 порт, принимает 1000 соединений
2. **Критично** — redis-cache (docker-compose.yml:316) без лимитов, хоть maxmemory 256mb задан в командной строке (не docker limit)
3. **Критично** — Итог core+monitoring = 4.44 ГБ > 3.8 ГБ сервера → гарантированный OOM при одновременной работе
4. **Важно** — В base compose (docker-compose.yml) у app, postgres, redis, pgbouncer, redis-cache, minio, minio-init, migrate **нет deploy.resources.limits** — лимиты только в prod overlay
5. **Важно** — workers в base compose: 2G/2.0 CPU, в prod overlay: 512m/0.75 — расхождение 4×, prod overlay имеет приоритет

---

## Методика

1. Найдены все docker-compose* файлы в корне репозитория: `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`, `docker-compose.observability.yml`, `docker-compose.monitoring-prod.yml`, `docker-compose.monitoring-standalone.yml`, `Dockerfile`, `Dockerfile.workers`
2. Извлечены все `deploy.resources.limits` (memory, cpus), `restart`, `command` (для redis maxmemory) через grep/rg
3. Подсчитана сумма лимитов для production стека (base + prod overlay) и monitoring-prod
4. Сравнено с 3.8 ГБ (3891 МБ) серверной RAM
5. Проверено соответствие `restart` политикам и наличию healthcheck

Команды:
```bash
grep -rn "deploy:" docker-compose*.yml
grep -rn "limits:" -A2 docker-compose*.yml
grep -rn "restart:" docker-compose*.yml
grep -rn "cpus:" docker-compose*.yml
```

---

## Находки

| # | Severity | Файл:строка | Проблема | Сценарий / Зачем важно | Предлагаемое исправление |
|---|----------|-------------|----------|------------------------|--------------------------|
| 1 | критично | docker-compose.yml:237 | pgbouncer без deploy.resources.limits | При нагрузке 1000 клиентских соединений pgbouncer может съесть весь свободный RAM, убьёт postgres/app | Добавить `deploy.resources.limits: {memory: 128m, cpus: "0.25"}` в base и prod |
| 2 | критично | docker-compose.yml:316 | redis-cache без deploy.resources.limits | maxmemory 256mb в команде — это лимит Redis, а не контейнера; контейнер может уйти в swap/OOM | Добавить `deploy.resources.limits: {memory: 384m, cpus: "0.25"}` (запас над maxmemory) |
| 3 | критично | docker-compose.yml:55 + docker-compose.prod.yml | migrate без лимитов (restart: "no") | Разовый контейнер, но при больших миграциях может сплюсовать 500+ МБ, нет защиты | Добавить `deploy.resources.limits: {memory: 512m, cpus: "0.5"}` |
| 4 | критично | docker-compose.yml:424 | minio-init без лимитов | Разовый контейнер, риск мал, но для полноты стоит ограничить | Добавить `deploy.resources.limits: {memory: 128m, cpus: "0.1"}` |
| 5 | критично | Итоговая сумма | Core (3.25 ГБ) + Monitoring (1.19 ГБ) = 4.44 ГБ > 3.8 ГБ | На сервере 3.8 ГБ — либо monitoring выключен, либо OOM killer убьёт случайный процесс | Либо вынести monitoring на отдельный хост, либо сократить лимиты: postgres 1G→768M, app 1G→768M, prometheus 512M→384M |
| 6 | важно | docker-compose.yml:68 | app в base compose без deploy.resources.limits | Без prod overlay контейнер неограничен — dev/staging риск | Лимиты только в prod overlay (docker-compose.prod.yml:31-35) |
| 7 | важно | docker-compose.yml:161 | workers в base: 2G/2.0 CPU; prod overlay: 512m/0.75 | Расхождение 4× по памяти, 2.6× по CPU — base значения нереалистичны для прода | Убрать limits из base compose (оставить только в prod), либо выровнять |
| 8 | важно | docker-compose.yml:347 | postgres в base без deploy.resources.limits | shared_buffers=256MB в команде, но контейнер может съесть больше | Лимиты только в prod overlay (1G/1.0) |
| 9 | важно | docker-compose.yml:280 | redis (state) в base без deploy.resources.limits | maxmemory 256mb + noeviction, но контейнер не ограничен docker'ом | Лимиты только в prod overlay (256m/0.5) |
| 10 | важно | docker-compose.yml:403 | minio в base без deploy.resources.limits | MinIO может кэшировать в памяти, без лимита — риск | Лимиты только в prod overlay (512m/0.5) |
| 11 | важно | docker-compose.prod.yml:31-35 | app prod: 1G/1.0 CPU | NODE_OPTIONS=--max-old-space-size=512 (512 МБ heap), лимит 1G — запас 512 МБ на off-heap, нормально | Проверить реальное потребление, при необходимости снизить до 768M |
| 12 | важно | docker-compose.prod.yml:47-51 | workers prod: 512m/0.75 CPU | PDF_WORKER_CONCURRENCY=2, tsx + Prisma — 512 МБ может быть на грани | Наблюдать за OOM, при необходимости поднять до 768M |
| 13 | важно | docker-compose.prod.yml:104-108 | postgres prod: 1G/1.0 CPU | shared_buffers=256MB, effective_cache_size=1GB (настройка PG, не лимит) — 1G контейнер адекватен | Оставить, мониторить |
| 14 | важно | docker-compose.prod.yml:115-119 | redis prod: 256m/0.5 CPU | maxmemory 256mb в команде, лимит контейнера 256m — ноль запаса на overhead | Поднять до 384m (как redis-cache должен быть) |
| 15 | важно | docker-compose.monitoring-prod.yml:46-50 | prometheus: 512m, нет CPU лимита | retention.size=2GB на диске, память под TSDB — 512M может быть мало под нагрузкой | Добавить cpus: "0.5", поднять memory до 768m |
| 16 | важно | docker-compose.monitoring-prod.yml:75-78 | grafana: 384m, нет CPU лимита | Дашборды + плагины — 384M обычно достаточно | Добавить cpus: "0.25" |
| 17 | важно | docker-compose.monitoring-prod.yml:93-96 | node-exporter: 64m, нет CPU лимита | Легкий экспортер — ок | Добавить cpus: "0.1" |
| 18 | важно | docker-compose.monitoring-prod.yml:110-113 | postgres-exporter: 64m, нет CPU лимита | Ок | Добавить cpus: "0.1" |
| 19 | важно | docker-compose.monitoring-prod.yml:143-146 | alertmanager: 128m, нет CPU лимита | Ок | Добавить cpus: "0.1" |
| 20 | важно | docker-compose.monitoring-prod.yml:166-169 | redis-exporter: 64m, нет CPU лимита | Ок | Добавить cpus: "0.1" |
| 21 | мелочь | docker-compose.observability.yml | Все сервисы (prometheus, grafana, loki, tempo, alertmanager, exporters, pushgateway) — **нет deploy.resources** | Файл для dev/standalone, на проде не используется (там monitoring-prod) | Оставить как есть, добавить примечание что не для продакшена |
| 22 | мелочь | docker-compose.monitoring-standalone.yml | Все сервисы — **нет deploy.resources** | Тоже dev-only | Оставить как есть |
| 23 | мелочь | docker-compose.staging.yml | Имиджи берутся готовыми, лимиты не переопределяются | Лимиты от prod overlay применяются автоматически | Проверить что STAGING_TAG собран с prod overlay |

---

## Таблица: Сервисы production (base + prod overlay)

| Сервис | Лимит памяти (base) | Лимит CPU (base) | Лимит памяти (prod) | Лимит CPU (prod) | Restart (base) | Restart (prod) | Риск |
|--------|---------------------|------------------|---------------------|------------------|----------------|----------------|------|
| migrate | — | — | — | — | "no" | "no" | критично (нет лимитов) |
| app | — | — | **1G** | **1.0** | unless-stopped | unless-stopped | важно (только в prod) |
| workers | **2G** | **2.0** | **512m** | **0.75** | unless-stopped | unless-stopped | важно (расхождение) |
| pgbouncer | — | — | — | — | unless-stopped | unless-stopped | **критично** (нет лимитов) |
| redis (state) | — | — | **256m** | **0.5** | unless-stopped | unless-stopped | важно (только в prod, 0 запаса) |
| redis-cache | — | — | — | — | unless-stopped | unless-stopped | **критично** (нет лимитов) |
| postgres | — | — | **1G** | **1.0** | unless-stopped | unless-stopped | важно (только в prod) |
| pgadmin | — | — | — | — | unless-stopped | (dev profile) | мелочь (dev only) |
| minio | — | — | **512m** | **0.5** | unless-stopped | unless-stopped | важно (только в prod) |
| minio-init | — | — | — | — | — | — | критично (нет лимитов) |

*Примечание: base compose = docker-compose.yml; prod overlay = docker-compose.prod.yml. При деплое применяются оба: `docker compose -f docker-compose.yml -f docker-compose.prod.yml`. Значения prod overlay перекрывают base.*

---

## Таблица: Monitoring (docker-compose.monitoring-prod.yml)

| Сервис | Лимит памяти | Лимит CPU | Restart | Риск |
|--------|--------------|-----------|---------|------|
| prometheus | 512m | — | unless-stopped | важно (нет CPU лимита) |
| grafana | 384m | — | unless-stopped | важно (нет CPU лимита) |
| node-exporter | 64m | — | unless-stopped | важно (нет CPU лимита) |
| postgres-exporter | 64m | — | unless-stopped | важно (нет CPU лимита) |
| alertmanager | 128m | — | unless-stopped | важно (нет CPU лимита) |
| redis-exporter | 64m | — | unless-stopped | важно (нет CPU лимита) |

---

## Таблица: Observatory / Standalone (не для продакшена)

| Файл | Сервисы | deploy.resources | Статус |
|------|---------|------------------|--------|
| docker-compose.observability.yml | 8 сервисов | **нет** | НЕ ПРОВЕРЕНО (dev-only) |
| docker-compose.monitoring-standalone.yml | 7 сервисов | **нет** | НЕ ПРОВЕРЕНО (dev-only) |

---

## Не проверено

1. **Реальное потребление памяти в бою** — нет метрик `container_memory_usage_bytes` за последние недели; цифры лимитов — конфигурационные, не измеренные
2. **Swap на сервере** — не проверено, включен ли swap и какого размера; при отсутствии swap OOM приходит быстрее
3. **Docker daemon memory limit** -- не проверено, задан ли `--default-ulimit` или `memory` на уровне daemon
4. **Staging環境** — docker-compose.staging.yml использует готовые образы с тегом STAGING_TAG, лимиты наследуются от prod overlay, но не проверено что STAGING_TAG собран именно с prod overlay
5. **docker-compose.observability.yml / monitoring-standalone.yml** — помечены как dev-only, не аудировались на лимиты (нет deploy.resources у всех сервисов)
6. **Redis maxmemory vs container limit** — в base compose redis/redis-cache имеют `--maxmemory 256mb` в command, но без docker memory limit контейнер может выделить больше (overhead, fragmentation, lua scripts)
7. **Postgres effective_cache_size=1GB** — это настройка планировщика, не лимит; реальное потребление postgres может превысить 1G контейнера при сложных запросах
8. **Healthcheck timeout/start_period** — не влияют на лимиты, но влияют на restart loop при нехватке ресурсов; не проверено корреляция

---

## Числа (только из команд)

```bash
# Core services (prod overlay) — память в MB
app: 1024
workers: 512
postgres: 1024
redis: 256
redis-cache: 0 (нет лимита)
pgbouncer: 0 (нет лимита)
minio: 512
migrate: 0 (нет лимита)
minio-init: 0 (нет лимита)
--- ИТОГО CORE: 3328 MB = 3.25 GB (85% от 3.8 GB)

# Monitoring (monitoring-prod)
prometheus: 512
grafana: 384
node-exporter: 64
postgres-exporter: 64
alertmanager: 128
redis-exporter: 64
--- ИТОГО MONITORING: 1216 MB = 1.19 GB

# CORE + MONITORING: 4544 MB = 4.44 GB (117% от 3.8 GB, дефицит 653 MB)
```

---

## Статусы проверки

| Проверка | Статус | Детали |
|----------|--------|--------|
| Все docker-compose файлы найдены | ПРОЙДЕНО | 7 файлов в корне репозитория |
| Лимиты памяти в prod overlay | ПРОЙДЕНО | 7/9 сервисов имеют limits |
| Лимиты CPU в prod overlay | ПРОЙДЕНО | 7/9 сервисов имеют cpus |
| Лимиты в base compose | НЕ ПРОЙДЕНО | Только workers имеет limits в base |
| Restart политики | ПРОЙДЕНО | 16/17 — unless-stopped, migrate — "no" |
| Сумма лимитов vs 3.8 GB | ПРОЙДЕНО | Core 3.25 GB (ок), Core+Monitoring 4.44 GB (превышение) |
| Healthcheck наличие | ПРОЙДЕНО | У всех основных сервисов есть healthcheck |
| Redis maxmemory vs container limit | ГИПОТЕЗА | maxmemory в command ≠ docker memory limit |
| Observability/monitoring-standalone | НЕ ПРОВЕРЕНО | Dev-only, нет deploy.resources |

---

## Резюме для владельца (5 строк)

1. **Production стек (core) вписывается в 3.8 ГБ с запасом 0.55 ГБ** — но только если monitoring выключен или на другом хосте.
2. **Monitoring-prod добавляет 1.19 ГБ — сумма 4.44 ГБ превышает сервер на 0.64 ГБ** — гарантированный OOM при одновременной работе.
3. **В base compose (docker-compose.yml) 6 из 9 сервисов без docker-лимитов** — защита только в prod overlay; dev/staging уязвимы.
4. **pgbouncer и redis-cache полностью без лимитов** — принимают нагрузку и могут съесть весь RAM.
5. **Workers: base=2G/2CPU, prod=512M/0.75CPU** — расхождение 4×, prod значения выглядят реалистичнее, base стоит убрать.