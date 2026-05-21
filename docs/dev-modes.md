# Режимы разработки

PilingTrack умеет жить в трёх конфигурациях. `start.bat` без аргументов
выбирает рекомендованный `dev`-режим, остальные — для конкретных задач.

## 1. `dev` — локальный Next.js + Docker для БД (рекомендуется)

```bash
start.bat                # или start.bat dev
# = npm run dev + docker compose up -d postgres redis minio
```

Что работает:
- **Hot reload** Next.js — изменения видны мгновенно.
- **БД, Redis, MinIO** — в Docker, конфиги в `.env.docker`.
- **Outbox + projection воркеры** — embedded-режим внутри Next.js процесса (не отдельный контейнер). Управляются leader-election через Redis.

Когда использовать:
- **По умолчанию.** 99% времени.
- Любые правки `src/` без изменений в Docker-сети, healthcheck'ах, или Caddy-конфигурации.

Подводные камни:
- Если перед этим был `start.bat docker`, выйди из того режима первым (Ctrl+C + `docker compose down workers app ws`). Иначе Docker-`workers` держит outbox leader-lease, embedded-воркеры в `npm run dev` молчат, и события не обрабатываются.

## 2. `docker` — полный Docker-стек

```bash
start.bat docker
# = docker compose up -d (всё: app, workers, ws, postgres, redis, minio, …)
```

Когда использовать:
- Тестирование изменений в `Dockerfile`, `docker-compose.yml`, инфраструктуре.
- Тестирование как ведёт себя контейнер при cold-start (например, healthcheck'и).
- Reproducing prod-only багов на локальной машине.

Подводные камни:
- Сборка контейнера занимает ~1–3 минуты.
- Hot reload **не работает** — каждое изменение требует ре-билда.
- Доступ к БД через `docker compose exec postgres psql -U postgres -d pilingtrack_test` (имена контейнеров — `pilingtrack-postgres`, etc.).

## 3. `prod` — local `npm run build` + `npm run start` против Docker-БД

```bash
start.bat prod
# = npm run build && npm run start
```

Когда использовать:
- Локально проверить production-сборку Next.js перед деплоем.
- Воспроизвести баг, который виден только в standalone-build (не в dev).
- Замерить bundle size, performance.

Подводные камни:
- Полный build занимает ~1 минуту даже на быстрой машине.
- Только БД из Docker; воркеры (outbox/projection/pdf) — embedded в process.

## Один контур одновременно

Все три режима хотят занять порт 3000. `predev` / `prestart` хуки в
`package.json` автоматически освобождают порт через
`scripts/kill-port.js`, но это работает только для node-процессов. Если
`docker compose up app` уже держит порт, останови его руками:

```bash
docker compose stop app
```

## Outbox leader — почему этот выбор важен

Outbox-воркер использует Redis leader-election. **Только один процесс**
может быть лидером. Если параллельно работают два:

- **Случай A (опасный):** Docker `workers` + локальный `npm run dev` с
  embedded-режимом → одновременно претендуют на lease. Один выиграет,
  второй встанет в standby. Если выиграет неправильный (старый код в
  Docker, новый в локальном dev) — будешь отлаживать «почему мой fix
  не сработал».
- **Случай B (нормальный):** Docker `workers` + локальный `npm run dev`
  без embedded → embedded отключен (`ENABLED_EMBEDDED_WORKERS=false` или
  не задан), все события обрабатываются Docker'ом. Это и есть рабочая
  схема для `start.bat dev`.

Поэтому **не запускай `docker compose up workers` одновременно с
`npm run dev`** — выбирай одно. `start.bat` это делает автоматически.
