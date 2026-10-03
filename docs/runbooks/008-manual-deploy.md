# Runbook 008 — Manual deploy to prod (controlled generation replacement)

## Текущий порядок G2: два HTTP-слота и отдельный барьер workers

Этот раздел заменяет прежние инструкции STOP app перед START app и старый rollback ниже. Production здесь не выполнялся. Команды выполняет оператор только по явному решению владельца, по одному шагу с чтением результата.

1. Принять код/проверки CODEX-REPORT-T7.md в main; проверить main=origin/main и чистое дерево. OLD_SHA взять из фактически обслуживающего /api/health, RELEASE_SHA из принятого коммита. Сохранить реальные imageIDs app и всех workers и rollback tags. deploy-prod.sh снимает эти IDs, не считает :latest доказательством обслуживающей версии.
2. Проверить резервную копию, свободный диск, здоровье PG/state Redis/cache Redis/S3. Внешние standalone/systemd/pm2/другие хосты и их автозапуск остановить до WORKER_GENERATION_EXTERNAL_STOPPED=1. Redis lease с уникальным owner не является DB fencing и не заменяет завершения операций.
3. Однократная подготовка Caddy владельцем (репозиторные шаблоны deploy/Caddyfile.prod и deploy/app-upstream.caddy): внутри существующего site/handle, проксирующего app, заменить только его reverse_proxy на отдельную строку import app-upstream.caddy. Файл /etc/caddy/app-upstream.caddy должен содержать единственную строку reverse_proxy 127.0.0.1:3000 для исходного legacy app. Сохранить Caddyfile, выполнить caddy validate и caddy reload, проверить прежний SHA через домен. TLS/другие handle оставить как были. Helper отказывается от неизвестного snippet, symlink или отсутствующего import; не правит произвольный host config. Порт3001 должен быть свободен и loopback-only.
4. Проверить existing network pilingtrack_pilingtrack; при другом имени задать BLUEGREEN_APP_NETWORK. HTTP-слоты используют base + prod + bluegreen compose; depends_on сброшен только для slot app. Workers используют base + prod, без bluegreen overlay. BLUEGREEN_WORKER_COMPOSE_FILES задаёт реальные worker compose-файлы при нестандартном запуске.
5. Перевести существующий app-guard на стабильный https://orionpiling.ru/api/health через APP_GUARD_HEALTH_URL в его конфигурации запуска. Старый default 127.0.0.1:3000 после green проверяет пустой порт. Проверить другие мониторы, привязанные к старому порту/container_name; не запускать второй guard.
6. Решить миграции G1 по012: SQL prechecks отдельно, репетиция на копии, совместимость со СТАРЫМ app. При новых миграциях отдельно подтвердить BLUEGREEN_MIGRATIONS_COMPATIBLE=1; без него default deploy откажет до удалённых tag/git изменений. Migrate до candidate; схема не откатывается заменой образов.
7. Проверить память всего VPS перед overlap. App cap1GiB/heap512MiB, два app временно; workers512MiB, PG1GiB, state Redis256MiB, MinIO512MiB, дополнительно cache Redis/monitoring/PgBouncer/Caddy/ОС. Сумма caps превышает3.8GB уже без части сервисов. Swap4GB не гарантирует задержки или отсутствие OOM. Стендовый пикT7 не включает весь VPS. Без подтверждённого запаса overlap не выполнять, решение владельца.

Основная команда на машине сборки после подтверждений:

    WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh app workers

Только для диапазона с новыми совместимыми миграциями:

    BLUEGREEN_MIGRATIONS_COMPATIBLE=1 WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh app workers

Локальные build/workers smoke до передачи. Candidate в pilingtrack-blue/pilingtrack-green, 127.0.0.1:3000/3001, у обоих EMBEDDED_WORKERS=disabled. Gates: container health, readiness, SHA, / и /login, отказ неавторизованным API. Затем snippet → caddy validate → caddy reload → proxy SHA → drain → F1 STOP/VERIFY/START workers → остановка/exit0/143 без OOM старого HTTP app. При первом переходе legacy embedded app завершает F1; новый HTTP обслуживает.

До reload отказ candidate сохраняет прежний upstream. До завершения F1 отказ возвращает прежний snippet с проверкой прежнего SHA; F1 восстанавливает workers/legacy app. Exit1/RECOVERED не успех. При неподтверждённом восстановлении OUTAGE, оба app сохранены для ручной проверки. После успешного F1 ошибка уборки сохраняет новый app. Не запускать прежнее поколение обычным compose up.

После переключения отдельно:

    node scripts/prod-smoke.mjs --url https://orionpiling.ru --sha "$SHA"
    curl --fail --silent --show-error https://orionpiling.ru/api/health/deep
    docker compose ps workers
    docker ps --filter label=com.docker.compose.project=pilingtrack-blue --filter label=com.docker.compose.service=app
    docker ps --filter label=com.docker.compose.project=pilingtrack-green --filter label=com.docker.compose.service=app

Проверить active SHA/health, зависимости/storage/schedulers, отсутствие embedded leaders в HTTP, unique owner dedicated workers в одном state Redis и отсутствие старых RUNNING исполнителей, outbox/проекции/Telegram. Gates helper не заменяют эти проверки. Не выводить секреты/полное environment. Миграции: expected migration_name+finished_at без rolled_back_at, политики по012.

Откат принятого HTTP-релиза тем же helper после проверки schema/compose и остановки внешних новых исполнителей; OLD_SHA — версия сохранённого app:

    cd /opt/pilingtrack
    docker tag "pilingtrack-workers:$ROLLBACK" pilingtrack-workers:latest
    WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-app-bluegreen.sh "pilingtrack-app:$ROLLBACK" "$OLD_SHA"

Не применять replace-worker-generation.sh app workers после blue-green: он стартует base app с embedded workers рядом со слотами. Флаг deploy-prod.sh --replace-worker-generation только ДО blue-green; read-only preflight отказывает при любом RUNNING blue/green app.

### Storage, старые вкладки и границы переключения

Перед candidate проверяются /app/storage старого HTTP app и всех старых dedicated workers. Файлы/links или недоступная проверка блокируют переключение. Для deployment-проектов все проверяемые процессы обязаны иметь полный S3 backend (endpoint+access+secret, проверяются только booleans, значения не печатаются); одного S3_BUCKET недостаточно. Это исключает новые локальные PDF во время drain. Общий filesystem backend этим helper не принят: сначала отдельное решение владельца по переносу/сохранности, не автоматический docker cp business files. Только одноразовый codex-* HTTP-стенд без business writes может работать без S3.

До START candidate получает старые .next/static, затем новые файлы поверх совпадающих путей. Next индексирует объединённые assets при старте: открытая старая вкладка продолжает получать chunks после удаления old app. Передача только static, без storage/source/secrets. Так как old runtime мог уже содержать assets прежних переключений, каталог на writable layer и временная копия растут с числом выкладок. Автоматического удаления старых chunks нет; перед выкладкой проверить диск для образов, merged static и временной копии. Политику хранения/очистки сначала принимает владелец.

Стоп старого HTTP/legacy default30s, стендовый90s fixture использует WORKER_GENERATION_STOP_TIMEOUT_SECONDS=120. Выбрать deadline по реальным uploads/requests и подтвердить его в целевом запуске helper; локальная переменная CLI автоматически не означает её передачу через SSH.

Контролируемый тест длинного конечного HTTP-ответа не доказывает сохранение WebSocket/SSE любого срока. Caddy по умолчанию закрывает WebSocket при reload; текущий bare snippet не добавляет stream_close_delay. Если такой протокол используется, сначала отдельная проверка и согласование managed config. Источник поведения: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy

Выкладку выполняет один оператор; CI/другие deploy на это время отключить. Helper lock защищает переключение, но не предварительные remote tags/git/migrate. Concurrent release может поменять mutable workers:latest до F1. Не запускать два deploy одновременно; полноценный общий release-lock потребует отдельной реализации/репетиции.

## Исторический порядок до G2

Ниже сохранены прежняя диагностика и история I02/F1. STOP app, legacy deploy/rollback и аварийный compose up app workers не применять после HTTP-слотов. Актуальный порядок выше.

For automated deploy via GitHub Actions, see `007-github-actions-deploy.md`.
This runbook is for the case when you SSH in and deploy by hand —
hotfixes, CI outages, or just verifying a deploy lands cleanly.

## Principle: build first, swap when ready

The old runbook stopped the running container, removed the image, then
built. If `npm run build` failed (typo in code, broken barrel-export,
missing env var) the prod app stayed dead for the duration of the
fix-rebuild loop — observed at ≥15 min on 2026-05-21.

The new sequence keeps the old container running until the new image is
built and tested. The generation barrier then stops/verifies all old app/workers before START; plan a short outage window. It restores old images/restart policies on failure.

## Pre-flight

```bash
ssh -i ~/.ssh/orionpiling user1@87.242.102.125
cd /opt/pilingtrack

# 1. Disk check — a single image export needs ~5-6 GB transient headroom.
# Start the build at <=75% (≈7 GB free); even then it can dip toward 100%
# mid-export. Free space first if tight:
df -h /
# Если места недостаточно — остановиться и разобрать безопасную очистку; не удалять rollback images/volumes вслепую.

# Перед git pull/build сохранить текущие app/workers images:
OLD_SHA=$(git rev-parse --short HEAD)
ROLLBACK="$OLD_SHA-$(date +%Y%m%d)"
for svc in app workers; do docker tag "pilingtrack-$svc:latest" "pilingtrack-$svc:$ROLLBACK"; done
# При новых миграциях сохранить migrate тоже. Проверить, что теги разрешаются в прежние imageIDs.
# 2. Pull
git pull origin main
git log -1 --oneline       # confirm expected HEAD

# 3. Export the commit so /api/health reports it (see Dockerfile ARG
# APP_VERSION) instead of the static package.json version.
export APP_VERSION=$(git rev-parse --short HEAD)
```

## Deploy

```bash
# Build first — old containers keep serving traffic during this step.
# BUILD SEQUENTIALLY on this 30 GB VPS — do NOT use `build app workers`.
# BuildKit builds the two targets in parallel, and exporting both images at
# once roughly doubles peak transient disk use; observed live 2026-05-28 the
# parallel build filled the disk to 100% ("no space left on device") at the
# workers export. Sequential + a prune between keeps the peak survivable.
docker compose build app
docker builder prune -af          # reclaim this build's cache before the next
docker compose build workers
# NOTE: if the diff adds a new prisma/migrations/* folder, build `migrate`
# too (separately, same pattern) — see the "Migrations" section below.
```

## Smoke образа workers перед выкладкой

**Зачем.** 01.10.2026 выкладка уронила воркеров на старте: в образе
`Dockerfile.workers` нет `node_modules/next` (строка `rm -rf node_modules/next`),
а `@sentry/nextjs` при загрузке тянет `next/constants` — `Cannot find module`.
Все юнит-тесты и `tsc` при этом были зелёные: они проверяют код, а не собранный
образ, который никто ни разу не запускал. Smoke ниже запускает **тот же образ**,
что уедет на бой, поэтому ловит именно эту поломку до переключения контейнеров.

**Когда обязателен** — если в диапазоне выкладки есть хотя бы одно:

- изменения в `src/workers/**`;
- изменения в `Dockerfile.workers`;
- изменения в `package.json` / `package-lock.json`;
- новые импорты в модулях, которые подключает воркер (что-то из `src/`, попавшее
  в статический граф `unified-worker`).

**Команды** (локально, на машине сборки; адреса фиктивные — база и Redis тут не
нужны):

```bash
docker build -f Dockerfile.workers --target runner -t pilingtrack-workers:smoke .

docker run --rm --name wsmoke \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://u:p@127.0.0.1:1/x \
  -e DATABASE_URL_POSTGRES=postgresql://u:p@127.0.0.1:1/x \
  -e REDIS_URL=redis://127.0.0.1:1 \
  pilingtrack-workers:smoke
# через ~45 с остановить (Ctrl+C или из другого терминала):
docker rm -f wsmoke
```

**Как читать вывод.**

- Строк `Cannot find module …` / `MODULE_NOT_FOUND` быть **не должно** — это та
  самая поломка.
- Должны появиться `Unified Worker Service starting` и хотя бы одна
  `Arming … worker` (outbox, projection и т.д.).
- Ошибки подключения к базе и Redis — **ожидаемы**: адреса фиктивные, до сети
  дело не доходит.

**Сторож кода — не замена smoke.** `src/workers/__tests__/no-next-in-workers.test.ts`
обходит статический граф воркеров и валит сборку на импорте `next`/`@sentry/nextjs`
(и на пакете с `next` в `dependencies`). Но он видит только исходники: ни `npm prune
--omit=dev`, ни `rm -rf node_modules/next`, ни реальный `node_modules` образа он не
проверяет. Поэтому оба нужны: сторож ловит импорт в коде на каждом прогоне тестов,
smoke выше подтверждает, что собранный образ действительно стартует.

```bash
# Внешние standalone/systemd/pm2/другие хосты заранее остановлены оператором.
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers
```

`ws` сервиса нет; app и workers заменяются вместе, включая app-only запрос.

## Workers image smoke

`WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers` автоматически проверяет образ workers после локальной сборки, до первого SSH; ошибка smoke останавливает выкладку.
Аварийный обход — только `SKIP_WORKERS_SMOKE=1`, с предупреждением о непроверенном образе.

## Post-deploy check (mandatory — the deploy is not done until this passes)

Run from the workstation (read-only GETs, no secrets, safe to repeat):

```bash
node scripts/prod-smoke.mjs --url https://orionpiling.ru --sha $(git rev-parse --short HEAD)
```

The decisive assertion is the **version**: `/api/health` reports the
`APP_VERSION` baked into the image at build time, so a mismatch means the
image did not rebuild and every other green check describes the *previous*
release. Exit code is 1 on any failure, so this works as the final deploy
step in a script or CI job.

It also asserts that dependencies are up and that protected APIs still answer
401/403 without a cookie — a deploy that accidentally opens data is caught
here rather than by a user.

`websocket: down` is a known, tolerated state on this stand and does not fail
the run (it does make `/api/health/deep` answer 503 — see the note in that
route). Everything else failing means: treat the deploy as unsuccessful and
investigate before walking away.

## Migrations (if the diff adds a `prisma/migrations/*` folder)

**The `migrate` service bakes `prisma/migrations` into its image at build
time** (it builds from `target: builder`, which `COPY`s the source — it
does NOT volume-mount the host dir). `app` depends on `migrate`
(`service_completed_successfully`), so `up -d app` *runs* migrate — but if
migrate's image predates the `git pull`, it runs with **stale baked-in
migrations**, logs `"N migrations found … No pending migrations to apply"`,
and **exits 0**. The deploy looks green while the schema never changed,
leaving new app code pointed at a missing table.

Observed live 2026-05-27 deploying `20260526202204_equipment_maintenance`:
migrate said "no pending", `MaintenanceRecord` was absent, app was already
serving code that needed it.

So when the diff includes a new migration, **rebuild `migrate` too**:

```bash
# detect: does the diff add a migration?
git diff --name-only --diff-filter=A HEAD@{1}..HEAD -- 'prisma/migrations/**'

# if yes, add `migrate` to the build line:
docker compose build migrate
docker compose build app
docker compose build workers
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers # fresh migrate via depends_on
```

Then **verify the migration actually applied — don't trust exit 0**:

```bash
docker compose logs --tail 15 migrate     # must show "Applying migration ..."
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;"
# must be the migration you just shipped, not the previous one.
```

### Rehearse the migration on a copy of prod data first (R57)

Before shipping a deploy whose diff adds a `prisma/migrations/*` folder,
apply it once against a **copy of the prod database** on the local stand.
CI only ever runs `migrate deploy` on an empty `postgres:18-alpine`
(`.github/workflows/ci.yml`), and prod runs it straight on live data — so
everything that depends on real rows (a unique index over existing rows,
`SET NOT NULL`, backfill, fail-closed RLS) is invisible until prod. That
gap is finding **R57** (`docs/audits/hermes-night/R57-migration-upgrade.md`,
F-13, top-1: «migrate deploy ни разу не репетируется на копии боевой базы»).
The rehearsal is cheap; a bad migration on prod is not.

The stand does the whole thing: `--refresh-db` takes a read-only `pg_dump`
from prod, restores it, recreates the cluster roles and re-applies the
grants (`scripts/app-role-grants.sql`, `scripts/identity-role-grants.sql`),
then brings the stand up — and its `migrate` service applies the new
migrations to the copy, which is exactly what will happen on deploy.

```bash
# from the workstation, on the branch/commit you are about to ship.
# Prerequisite: the working tree is clean (the script refuses otherwise —
# the image must be the commit) and Docker is running.
bash scripts/staging-local.sh --refresh-db

# without --refresh-db it reuses the stand's existing database copy;
# use the plain form only when you know that copy is already recent.

# watch the migrate step (same image and command as prod):
docker compose -p pilingtrack-staging logs migrate | grep -E 'Applying|applied|No pending|Error'
```

The stand prints its own check at the end; **success is all of:**

- `последние миграции:` — the first line is **your** `migration_name`
  (the script runs `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;`
  against the stand's postgres itself);
- `health: {...}` healthy, `deep: 200`, `/login: 200`;
- `ошибок в журналах app/workers после подъёма: 0`.

If the top row of `_prisma_migrations` is still the *previous* migration
(or `Applying` never appears in the log), the migration did not run —
the same stale-image trap as the section above, not a passing rehearsal.
Stop the stand with `bash scripts/staging-local.sh --down` (the database is
kept; `--destroy` wipes it).

**If the rehearsal fails — do not deploy.** A migration that fails inside
`prisma migrate deploy` leaves **P3009**, and Prisma then refuses to apply
*any* migration until someone runs `prisma migrate resolve --rolled-back
<migration_name>` by hand on prod. On prod that is an outage of the whole
deploy path, not just this release. So:

1. Read the failing statement in the `migrate` log on the stand.
2. Inspect the data on the copy — the failure is nearly always data, not
   SQL (duplicate rows under a new unique index, `NULL`s under
   `SET NOT NULL`, a constraint or index name that diverged). R57 lists the
   known candidates with the exact queries to run.
3. Resolve the data dependency (dedupe / backfill) or rework the migration:
   add a `DO $$ … RAISE EXCEPTION` pre-check with the query from step 2, and
   `NOT VALID` + `VALIDATE CONSTRAINT` for constraints. Never ship the
   failing migration with a plan to `resolve --rolled-back` on prod.
4. Re-run the rehearsal with `--refresh-db` on the fixed commit.

**Time estimate.** A rehearsal on a warm stand (images already built for
this SHA) is the prod dump + restore of a ~130 MB database plus the stand's
health checks — minutes, **≈2–5 min (estimate, not measured; the stand was
never run for this task)**. The first run on a cold machine also builds the
`app` / `workers` / `migrate` images, which is the slow part (tens of
minutes on this hardware); it is skipped for the same SHA afterwards.

If the migration is **destructive** (Prisma prints a `Warnings:` /
`DROP COLUMN` / `DROP TABLE` block in the `.sql`), check the target on prod
*before* swapping — e.g. `SELECT count("col") FROM "Table";` — and confirm
the data is expendable. Prod data is not in your local DB.

## Verify

```bash
# 1. Containers healthy
docker compose ps app workers
# Expect: Up X seconds (healthy) for both. If "(unhealthy)" persists
# past 30s, dump logs:
docker compose logs --tail 100 app
docker compose logs --tail 100 workers

# 2. Outbox pipeline healthy (no silent breakage)
docker compose exec -T postgres psql -U piling -d pilingtrack <<'SQL'
SELECT 'outbox_unpublished' m, count(*)::text v FROM "OutboxEvent" WHERE published = false
UNION ALL SELECT 'outbox_unprojected', count(*)::text FROM "OutboxEvent" WHERE projected = false
UNION ALL SELECT 'outbox_failed_3plus', count(*)::text FROM "OutboxEvent" WHERE attempts >= 3
UNION ALL SELECT 'dlq_pending', count(*)::text FROM "DeadLetterQueue" WHERE status = 'pending';
SQL
# All four counters should be 0 (or close to 0 and shrinking).
```

## Confirm fix in real traffic (for projection / event-bus fixes)

After a fix that touches handlers, projections, or the outbox, wait
~1 hour and re-check `ReportAnalytics` freshness:

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT count(*) FROM \"ReportAnalytics\" WHERE \"lastEventAt\" > now()-interval '1 hour';"
```

If there were operator submissions in the last hour, this should match.
If it's 0 but `SELECT count(*) FROM \"Report\" WHERE \"createdAt\" > now()-interval '1 hour'`
shows submissions came in, the realtime handler isn't running — go to
runbook 004 (outbox backlog).

## Backfill if needed (after delayed fix)

```bash
npm run backfill:analytics             # last 7 days, idempotent
npm run backfill:analytics -- --days=2 # narrower window
```

## Rollback

Сначала сохранить диагностику, проверить оба ранее сохранённых rollback tags и совместимость schema/compose. Остановить все внешние новые исполнители и их автозапуск. На сервере по команде владельца:

```bash
docker tag "pilingtrack-app:$ROLLBACK" pilingtrack-app:latest
docker tag "pilingtrack-workers:$ROLLBACK" pilingtrack-workers:latest
WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers
```

Не пересобирать случайный предыдущий SHA и не удалять контейнеры/образы до снимка: это уничтожает возможность автоматического возврата. При OOM локальной сборки разбирать причину; не освобождать RAM сервера удалением работающего поколения. Полная ручная процедура —016, схема БД не откатывается заменой images.
## Смена поколения workers (I02)

У app по умолчанию встроены outbox/projection workers. Для этого релиза используйте
`WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers`.
До подтверждения вручную остановите все standalone/systemd/pm2/другие хосты; отключите их автоматический рестарт.
Режим заменяет app и workers вместе: stop всех реплик → проверка фактического завершения (workers: exit 0; app: exit 0 или 143, без OOM) и отсутствия RUNNING → up нового поколения.
One-off реплики учитываются и отклоняются до STOP: оператор должен остановить/удалить их заранее. Все preflight проверки выполняются до restart=no; при отказе после STOP — автоматический возврат старого поколения, см. ниже.
При откате после переключения тегов применяйте тот же `scripts/replace-worker-generation.sh app workers` с подтверждением внешних остановок.
Compose ждёт 30 секунд; внутренний WORKER_SHUTDOWN_TIMEOUT_MS старого worker по умолчанию 8000.
Больший compose timeout не продлевает внутренний дедлайн: exit 1 после 8 секунд блокирует старт и требует проверки drain/незавершённых задач.
Перед новым запуском подтвердите, что внешние старые процессы действительно завершены.

## Уточнение барьера после релиза 03.10 (E0a/F1)

Next standalone app штатно завершается по SIGTERM с exit 143; helper принимает его только для service=app при exited и OOM=false. Для workers по-прежнему требуется exit 0; killed/OOM/ошибки drain запрещают новое поколение. Встроенные workers app также проверяются по журналам shutdown.

При отказе после STOP helper автоматически возвращает прежние контейнеры и restart-политики; если force-recreate удалил ID — запускает сохранённые immutable imageIDs с прежним числом реплик и restart, используя текущий compose. Перед возвратом частично поднятое новое поколение останавливается и проверяется отсутствие RUNNING. Exit остаётся1: RECOVERED означает восстановление старой версии, не успешную выкладку. Если Docker/остановка/возврат недоступны — OUTAGE и ручная проверка; только после проверки безопасна аварийная команда `cd /opt/pilingtrack && docker compose up -d app workers`. Автовозврат не откатывает миграции/env/volumes/topology. Обычным up барьер не обходить.
