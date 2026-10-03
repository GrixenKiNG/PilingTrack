---
name: deploy
description: Generate owner-reviewed deploy commands for orionpiling.ru with migrations, blue-green HTTP and the worker generation barrier.
---

# Deploy to orionpiling.ru

Выкладку выполняет оператор только по явной команде владельца, по одному шагу с чтением результата. Этот навык готовит команды, не разрешает автономную выкладку. Ответ по-русски.

## Предпроверки

1. Принятый main=origin/main, чистое дерево. OLD_SHA взять из фактически обслуживающего /api/health; git HEAD сервера и :latest не доказывают serving version. Сверить диапазон миграций, без OLD_SHA не утверждать их отсутствие.
2. Проверить реальные exits/ограничения отчётаT7, репетицию на копии данных, SQL integrity prechecks отдельно по012, expected migration_name. Две RLS-миграцииG1 — отдельное решение владельца. Для blue-green проверить совместимость со старым app; лишь после этого BLUEGREEN_MIGRATIONS_COMPATIBLE=1.
3. Проверить backup/диск/здоровье DB/state Redis/cache Redis/S3, сохранить фактические rollback imageIDs app/workers. Не удалять volumes/rollback ради места. Сборка локально последовательно, workers smoke до первого SSH.
4. Внешние standalone/systemd/pm2/другие хосты и их автозапуск остановить, подтвердить завершение in-flight. Лишь после этого WORKER_GENERATION_EXTERNAL_STOPPED=1. Unique lease owner не является DB fencing.
5. До первого перехода владелец готовит managed Caddy import/snippet по008, свободный loopback3001, сеть. Неизвестный config helper отклоняет. App-guard и другие мониторы перевести на стабильный proxy URL.
6. Проверить текущую суммарную память VPS + второй app до1GiB. Caps сервисов превышают3.8GB, swap4GB не гарантирует отсутствие OOM; стендT7 не включает всех сервисов/ОС. Без запаса overlap не принят.

7. Blue-green требует полного S3 backend app/workers и отсутствия файлов/links в их /app/storage; helper отказывает, а не удаляет локальные PDF. Проверить диск для merged .next/static и временной копии: старые chunks сохраняются без автоматического удаления. Выполняет один оператор, concurrent CI/deploy отключить. WebSocket/SSE не считать доказанными длинным HTTP-тестом; подробности008.

## Основной блок на машине сборки

    git status --short
    git branch --show-current
    git fetch origin main
    git rev-parse HEAD
    git rev-parse origin/main

После ручных подтверждений:

    WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh app workers

Для новых совместимых миграций после prechecks/репетиции/решения владельца:

    BLUEGREEN_MIGRATIONS_COMPATIBLE=1 WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh app workers

Новые миграции добавляют migrate автоматически, свежий образ выполняется до cutover. Candidate health/readiness/SHA/страницы/отказ неавторизованным API → Caddy validate/reload → drain → F1 dedicated workers → подтверждённая остановка old app. Оба HTTP-слота EMBEDDED_WORKERS=disabled; первоначальный legacy embedded app завершает F1. Worker compose base+prod, без bluegreen overlay.

Отказ candidate до reload сохраняет old. Отказ до успешного F1 возвращает proxy/прежние workers; RECOVERED/exit1 не успех. OUTAGE требует ручной проверки, не обычного compose up. После успешного F1 ошибка уборки сохраняет новый app.

## После переключения

    node scripts/prod-smoke.mjs --url https://orionpiling.ru --sha "$SHA"
    curl --fail --silent --show-error https://orionpiling.ru/api/health/deep
    docker compose ps workers
    docker ps --filter label=com.docker.compose.project=pilingtrack-blue --filter label=com.docker.compose.service=app
    docker ps --filter label=com.docker.compose.project=pilingtrack-green --filter label=com.docker.compose.service=app

Проверить SHA/active slot, DB/Redis/storage/schedulers, одного фактического лидера каждого ресурса в одном state Redis, отсутствие embedded workers/старых RUNNING, outbox/Telegram. Redis GET не доказывает отсутствие старого процесса. Проверить migration_name+finished_at без rolled_back_at и политики012. Не выводить секреты/полное environment.

## Откат принятого blue-green релиза

После schema/compose, наличия rollback tags, фактического OLD_SHA и остановки внешних новых исполнителей:

    cd /opt/pilingtrack
    docker tag "pilingtrack-workers:$ROLLBACK" pilingtrack-workers:latest
    WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-app-bluegreen.sh "pilingtrack-app:$ROLLBACK" "$OLD_SHA"

Те же candidate gates и F1; схема/миграции/env/volumes не откатываются образами. Отказ восстановления — ручная проверка владельца.

## Legacy и ручной запасной путь

--replace-worker-generation сохранён только ДО blue-green; read-only preflight отказывает при любом RUNNING blue/green app. Не использовать replace-worker-generation.sh app workers или compose up app workers после нового режима: они стартуют base app с embedded workers рядом с HTTP-слотами.

Ручная сборка только по решению владельца с отдельной проверкой диска/rollback. Образы/Caddy/worker compose должны соответствовать принятому коду; HTTP менять через replace-app-bluegreen.sh, не обходить gates. Полная процедура008/016 и фактические проверкиT7.
