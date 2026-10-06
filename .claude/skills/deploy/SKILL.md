---
name: deploy
description: Generate a ready-to-paste deploy command block for orionpiling.ru, auto-detecting whether a new Prisma migration needs to be included in the build.
---

# Deploy to orionpiling.ru

Выкладку выполняет оператор только по явной команде владельца, по одному шагу с чтением результата. Этот навык готовит команды, не разрешает автономную выкладку.

Основной путь с локальной сборкой, передачей готовых образов и барьером:

```bash
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers
```

`--replace-worker-generation` обязателен и только первым аргументом. `ws` сервиса нет. Скрипт требует main=origin/main и чистое дерево; app-only/workers-only заменяет оба сервиса (app содержит embedded workers), новые миграции добавляют migrate автоматически. Smoke workers выполняется до первого SSH. VPS 30GB не используется для сборки по основному пути; подробности — ранбуки008/016.

## Перед подготовкой команд

1. Сравнить фактический OLD_SHA на сервере с RELEASE_SHA, не HEAD~1. Найти новые prisma/migrations/**. Если OLD_SHA неизвестен, не утверждать отсутствие миграций.
2. Проверить отчёт, финальные checks и репетицию миграций на копии данных; каждый integrity precheck выполнять отдельно. Проверить диск и оба сохранённых rollback tags/imageIDs. Не удалять тома/откатные образы ради места.
3. Оператор останавливает все внешние standalone/systemd/pm2/другие хосты и их автозапуск, проверяет завершение операций. Лишь после этого допустимо WORKER_GENERATION_EXTERNAL_STOPPED=1. Живые one-off и неоднородные/не RUNNING старые реплики helper отклоняет до STOP: разобраться вручную.
4. Согласовать окно недоступности: STOP → VERIFY → START, без rolling-up.

## Основной блок (на машине сборки)

Отвечать по-русски. Если диапазон содержит миграции, отметить необходимость migrate; deploy-prod.sh добавляет его сам.

```bash
git status --short
git branch --show-current
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
# После ручного подтверждения внешней остановки и всех предпроверок:
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers
```

После выкладки сверить SHA, app/workers healthy, deep-health и зависимости, один лидер каждого ресурса, outbox/Telegram. При миграциях проверить именно ожидаемую запись _prisma_migrations (finished_at, без rolled_back_at), не доверять одному exit0.

## Ручной запасной путь (сервер, только по команде владельца)

Сначала убедиться в достаточном свободном месте (≥8GB), сохранить прежние imageIDs/теги ДО build. Собирать последовательно; при новых миграциях сначала migrate. Пример ниже выполняется по одной команде, не unattended block.

```bash
cd /opt/pilingtrack
df -h /
# Сохранить оба app/workers rollback tags; при миграциях также migrate.
git pull origin main
# Только при новых миграциях:
docker compose build migrate
docker compose build app
docker compose build workers
bash scripts/smoke-workers-image.sh pilingtrack-workers:latest
# После ручного подтверждения внешней остановки:
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers
```

## Откат

После проверки наличия двух сохранённых тегов и совместимости схемы/compose, внешние новые исполнители остановлены:

```bash
cd /opt/pilingtrack
docker tag "pilingtrack-app:$ROLLBACK" pilingtrack-app:latest
docker tag "pilingtrack-workers:$ROLLBACK" pilingtrack-workers:latest
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers
```

Барьер сохраняет imageIDs/restart policies/число реплик, принимает app0/143, workers только0, проверяет OOM/drain/RUNNING. При отказе после STOP автоматически возвращает старое поколение (при удалённых IDs — прежние образы с текущим compose); exit остаётся1 и печатается RECOVERED. При невозможности возврата — OUTAGE: не запускать параллельных лидеров. Только после ручной проверки безопасен аварийный `cd /opt/pilingtrack && docker compose up -d app workers`.

Автовозврат образов не откатывает миграции или env/volumes/topology. Проблема схемы требует отдельного решения владельца. Полная процедура и evidence — ранбуки008/016 и CODEX-REPORT-T6.md.
