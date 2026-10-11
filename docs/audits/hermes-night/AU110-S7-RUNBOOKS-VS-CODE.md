# AU110-S7-RUNBOOKS-VS-CODE: Ранбуки против кода — существуют ли команды, скрипты и пути

**Версия (HEAD):** `12d316fc4c6717adef37f3efcc2ef97fd59c2f82`
**Ветка:** `hermes/q4-0926` (git worktree `D:\PillingR\wt-night`)
**Дата аудита:** 2026-10-11
**Режим:** только чтение; приложение не менялось.
**Область:** все `docs/runbooks/*.md` — 19 файлов (`ls docs/runbooks/*.md | wc -l` = 19).

---

## Итог

Проверено 19 ранбуков и ~68 упомянутых ими артефактов (скрипты, юниты systemd, compose-сервисы, файлы `src/**`, HTTP-маршруты, миграции, переменные окружения). **Все ключевые скрипты, юниты, файлы кода и маршруты существуют** — «мёртвых ссылок на несуществующие файлы» почти нет; ломаются в основном номера строк и упоминания удалённого сервиса `ws`.

Расхождения по важности:

- **критично — 2**
- **важно — 13**
- **мелочь — 7**

Топ-5:

1. `docs/runbooks/006-postgres-backup-restore.md:91` — `docker compose stop app workers ws`: сервиса `ws` нет ни в одном compose (удалён 26.09.2026); команда падает целиком, писатели **не** останавливаются перед `DROP DATABASE` (тот же дефект на `:118` при подъёме).
2. `docs/runbooks/009-pitr-restore.md:182` — `docker compose stop app workers workers-pdf ws`: не существуют **оба** сервиса (`workers-pdf` удалён 2026-05-24, `ws` — 26.09.2026); остановка не выполняется, а дальше по тексту идёт замена PGDATA.
3. `docs/runbooks/014-post-deploy-2026-10.md:44,45,310` — номера строк в `observability/prometheus/alerts.yml` устарели на +43…+110: правила `AlertmanagerDown`/`AlertmanagerNotificationsFailing`/`TargetDown`/`OffsiteBackupNotSynced` лежат на 320/332/260/406, а не на 242-264/217-227/296-307.
4. `docs/runbooks/014-post-deploy-2026-10.md:417` — таблица утверждает, что `scripts/backup.sh` «не исправлено» и пишет ключи без приставки; фактически скрипт уже пишет `pilingtrack:system:backup:*` (проверка ловушки приставки пройдена, но текст ранбука не обновлён).
5. `docs/runbooks/010-restore-drill.md:152-153` — ранбук ссылается на несуществующее обещание в шапке `scripts/pitr-basebackup.sh` («point-in-time recovery to any second»); шапка теперь прямо отрицает PITR.

---

## Методика

Что и как проверялось (каждую проверку можно повторить):

1. **Список артефактов** собран чтением всех 19 файлов `docs/runbooks/*.md` через `read_file` (не grep).
2. **Существование файлов** — пакетная проверка `for f in <список>; do [ -e "$f" ] && echo OK || echo MISS; done`. Результат: **68/68 OK, 0 MISS**.
3. **Сервисы compose** — `grep -nE '^  [a-zA-Z0-9_-]+:' docker-compose.yml docker-compose.prod.yml`; отдельно `grep -rn '^  ws:' docker-compose*.yml | wc -l` → **0**.
4. **Имена контейнеров** — `grep -rn 'container_name' docker-compose*.yml`.
5. **Номера строк в коде** — `grep -n`/`sed -n` по конкретным файлам (`encryption.ts`, `backup.ts`, `metrics/route.ts`, `telegram.ts`, `session-service.ts`, `docker-compose.yml`, `alerts.yml`, `prometheus-prod.yml` и др.).
6. **systemd-юниты** — `cat -n deploy/systemd/*` (сверка `OnCalendar`, `RandomizedDelaySec`, `Environment=`).
7. **Скрипты-флаги** — `grep -n` по `deploy-prod.sh`, `replace-worker-generation.sh`, `staging-local.sh`, `app-guard.sh`, `prod-smoke.mjs`, `cleanup-report-analytics-orphans.cjs`, `staging-local.sh`.
8. **npm-скрипты** — `node -e "require('./package.json').scripts"`.
9. **Маршруты** — `ls -d src/app/api/...` + `grep -n 'export const POST/GET'`.
10. **Миграции** — `[ -d prisma/migrations/<имя> ]` по 7 названным в ранбуках миграциям.
11. **Ветка** `codex/night-1003` (упомянута в 016) — `git branch -a --list '*night-1003*'`.

Ограничение методики: проверялось **соответствие текста ранбука репозиторию**, а не фактическое состояние боевого сервера. Всё, что ранбуки называют «снимком боевого сервера» (таймеры, `docker system df`, содержимое `/opt/pilingtrack`, `.env`), командой на сервере не проверялось — сервер недоступен и трогать его запрещено.

---

## Таблица соответствия (ранбук | пункт | что упомянуто | существует | комментарий)

Статусы: ПРОЙДЕНО — проверено командой; НЕ ПРОВЕРЕНО — вне доступа; ГИПОТЕЗА — вывод без прямого доказательства.

| Ранбук | Пункт | Что упомянуто | Существует | Статус | Комментарий |
|---|---|---|---|---|---|
| 001 | восстановление | контейнеры `pilingtrack-postgres`, `redis`, `redis-cache` | да | ПРОЙДЕНО | `docker-compose.yml:346,282,318` (`container_name`) |
| 001 | проверка | `https://orionpiling.ru/api/health/deep` | да (код) | ПРОЙДЕНО | `src/app/api/health/deep/route.ts:59` — 503 при unhealthy |
| 002 | диагностика | `REDIS_PASSWORD` в `.env` | да | ПРОЙДЕНО | обязательна: `docker-compose.yml:305` `${REDIS_PASSWORD:?...}` |
| 002 | архитектура | `pilingtrack-redis-cache` без persistence (`--save ""`) | да | ПРОЙДЕНО | `docker-compose.yml:325-326` |
| 003 | восстановление | `POST /api/admin/projections/rebuild` | да | ПРОЙДЕНО | `src/app/api/admin/projections/rebuild/route.ts:37` |
| 003 | восстановление | `npm run backfill:analytics` | да | ПРОЙДЕНО | `package.json` → `bash scripts/backfill-report-analytics.sh` |
| 003 | RLS-проверка | `scripts/app-role-verify.sql` | да | ПРОЙДЕНО | файл на месте |
| 004 | API | `GET /api/admin/dlq`, actions `retry`/`discard`, право `dlq.manage` | да | ПРОЙДЕНО | `src/app/api/admin/dlq/route.ts:56,103,111` |
| 004 | API | `metrics.outboxPending` в `/api/system/status` | да | ПРОЙДЕНО | `src/core/observability/health-tracker/types.ts:60-64`, `route.ts:41` |
| 005 | весь ранбук | сервис `ws`, порт 3001 | **нет** | ПРОЙДЕНО (что нет) | помечен «УСТАРЕЛ» ; `grep '^  ws:' → 0` |
| 006 | юниты | `deploy/systemd/pilingtrack-backup.service/.timer` | да | ПРОЙДЕНО | `OnCalendar=*-*-* 03:30:00`, `RETENTION_DAYS=30` |
| 006 | скрипт | `scripts/backup-postgres.sh` | да | ПРОЙДЕНО | пишет `pilingtrack:system:backup:*` в MULTI/EXEC |
| 006 | restore | `docker compose stop/up … ws` | сервиса нет | ПРОЙДЕНО (что нет) | см. находки F-01/F-03 |
| 007 | workflow | `.github/workflows/deploy.yml` | да | ПРОЙДЕНО | есть `workflow_dispatch`, secret `PROD_SSH_KEY`, env `production` |
| 007 | workflow | пункты выбора `app`/`app workers`/`workers` | да | ПРОЙДЕНО | `deploy.yml:18-21` — `ws` в списке **нет** |
| 007 | проверка | `/api/health` до 90 с | да | ПРОЙДЕНО | `deploy.yml:109-124` (30 × 3 с) |
| 008 | скрипты | `scripts/deploy-prod.sh`, `scripts/replace-worker-generation.sh`, `scripts/staging-local.sh`, `scripts/prod-smoke.mjs` | да | ПРОЙДЕНО | флаги `--replace-worker-generation`, `--refresh-db/--down/--destroy`, `--url/--sha` подтверждены |
| 008 | образ | `Dockerfile.workers` c `rm -rf node_modules/next` | да | ПРОЙДЕНО | `Dockerfile.workers:54` |
| 008 | тест-сторож | `src/workers/__tests__/no-next-in-workers.test.ts` | да | ПРОЙДЕНО | файл на месте |
| 009 | скрипт | `scripts/pitr-basebackup.sh` | да | ПРОЙДЕНО | `pg_archivecleanup` в `:102`; шапка `:9-14` отрицает PITR |
| 009 | restore | `docker compose stop app workers workers-pdf ws` | сервисов нет | ПРОЙДЕНО (что нет) | см. F-02 |
| 010 | юниты | `deploy/systemd/pilingtrack-backup.timer` (03:33 факт. с джиттером) | да | ПРОЙДЕНО | `OnCalendar=03:30`, `RandomizedDelaySec=10min` |
| 010 | скрипты | `scripts/app-role-grants.sql`, `scripts/identity-role-grants.sql` | да | ПРОЙДЕНО | `identity-role-grants.sql:58,66` — User+DeviceKey |
| 011 | скрипты | `scripts/app-role-grants.sql`, `app-role-verify.sql`, `app-role-smoke.ts` | да | ПРОЙДЕНО | `app-role-grants.sql:66` идемпотентен |
| 011 | compose | `DB_IDENTITY_ROLE` у app и workers | да | ПРОЙДЕНО | `docker-compose.yml:107,200` (см. F-12) |
| 012 | скрипт | `scripts/rls-state.sql` (4 раздела) | да | ПРОЙДЕНО | `rls-state.sql:4-9` |
| 012 | миграции | `20260819120000_rls_fail_closed_all`, `20260819140000_rls_remaining_tenant_tables` | да | ПРОЙДЕНО | каталоги на месте |
| 012 | ADR | `docs/adr/0044-rls-fail-closed-scope.md:74-77` | да | ПРОЙДЕНО | строка 74 по смыслу совпадает |
| 013 | юниты | `pilingtrack-disk-guard.timer` (`OnBootSec=5min`+`OnUnitActiveSec=15min`) | да | ПРОЙДЕНО | `deploy/systemd/pilingtrack-disk-guard.timer:5-6` |
| 013 | юниты | `pilingtrack-pitr-basebackup.timer` (`Sun 04:00`, +15min) | да | ПРОЙДЕНО | `…pitr-basebackup.timer:7,9` |
| 013 | юниты | `pilingtrack-docker-prune.service/.timer` | **нет** | ПРОЙДЕНО (что нет) | в репозитории отсутствует — ранбук это и утверждает |
| 013 | скрипт | `scripts/disk-guard.sh` (порог 85 %, `HostDiskGuard`) | да | ПРОЙДЕНО | `disk-guard.sh:27,55` |
| 013 | код | `src/lib/redis-cache.ts:64` `keyPrefix:'pilingtrack:'` | да | ПРОЙДЕНО | строка совпадает |
| 014 | compose | `docker-compose.monitoring-prod.yml:20-21,28-33,41` | да | ПРОЙДЕНО | монтирования, комментарий про inode, `--web.enable-lifecycle` |
| 014 | юниты | `deploy/systemd/pilingtrack-app-guard.service/.timer` | да | ПРОЙДЕНО | + `scripts/app-guard.sh --test` (`:197`) |
| 014 | конфиг | `observability/alertmanager/alertmanager.yml:6` `group_wait: 30s` | да | ПРОЙДЕНО | строка совпадает |
| 014 | код | `src/workers/unified-worker/sentry.ts:24,31,13,39-41` | да | ПРОЙДЕНО | строки совпадают |
| 014 | код | `sentry.server.config.ts:8` (зашитый DSN) | да | ПРОЙДЕНО | строка 8 — `dsn:` |
| 014 | переменные | `BACKUP_ENABLED`, `SENTRY_DSN` в compose `environment:` | да | ПРОЙДЕНО | `docker-compose.yml:129,206` |
| 015-disposable | скрипты | `test-db-up.sh`, `test-db-down.sh`, `test-db-dump.cjs`, `restore-drill.sh` | да | ПРОЙДЕНО | аргументы совпадают |
| 015-disposable | конфиг | `prisma.integration.config.ts`, `vitest.integration.config.ts` | да | ПРОЙДЕНО | файлы на месте |
| 015-encryption | код | `src/core/security/encryption.ts` (форматы, версии) | да | ПРОЙДЕНО | `:12-14,67,74-75,79,93-98,115-117,155` совпадают |
| 015-encryption | скрипт | `scripts/rotate-encryption-key.ts`, `scripts/tg-debug.ts:3` | да | ПРОЙДЕНО | decrypt импортируется на строке 3 |
| 015-encryption | шаблон | `.env.production.example` без `ENCRYPTION_KEY_VERSION`/`_V1` | да | ПРОЙДЕНО | `grep 'ENCRYPTION_KEY' .env.production.example` → только строка 24 `ENCRYPTION_KEY=""` |
| 016 | скрипты | `scripts/deploy-prod.sh --replace-worker-generation`, `scripts/smoke-workers-image.sh <image:tag>` | да | ПРОЙДЕНО | флаг и аргумент подтверждены |
| 016 | ветка | `codex/night-1003` | да | ПРОЙДЕНО | `git branch -a` показывает ветку |
| 016 | compose | `workers.environment:` для `PDF_TEMP_CLEANUP_*`, `WORKER_SHUTDOWN_TIMEOUT_MS` | **нет** | ПРОЙДЕНО (что нет) | ранбук и говорит, что их надо добавить |
| 017 | миграции | `20261007130000_pile_work_tenant_occurred_at_index`, `…130100_…fallback_index` | да | ПРОЙДЕНО | каталоги на месте |
| 017 | тест | `tests/integration/disposable-analytics-performance.spec.ts` | да | ПРОЙДЕНО | файл на месте |
| 018 | скрипт | `scripts/cleanup-report-analytics-orphans.cjs --container/--apply/--backup/--restore` | да | ПРОЙДЕНО | аргументы и метка `pilingtrack.codex.test-db` подтверждены |
| 018 | тест | `tests/integration/disposable-scripts.spec.ts` | да | ПРОЙДЕНО | файл на месте |

---

## Находки

Severity: критично / важно / мелочь. Пути — от корня репозитория.

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| F-01 | критично | `docs/runbooks/006-postgres-backup-restore.md:91` | `docker compose stop app workers ws` — сервиса `ws` нет (`grep -rn '^  ws:' docker-compose*.yml` → 0, удалён 26.09.2026) | `docker compose stop` с несуществующим сервисом завершается ошибкой и **не останавливает ничего**; следующий шаг runbook — `DROP DATABASE … WITH FORCE` и `pg_restore`. Если оператор пойдёт дальше, восстановление идёт по живой базе — потеря/порча записей, записанных между шагами | Заменить на `docker compose stop app workers` (в базовом compose `workers` — единственный сервис-исполнитель) |
| F-02 | критично | `docs/runbooks/009-pitr-restore.md:182` | `docker compose stop app workers workers-pdf ws` — не существуют **оба** сервиса (`workers-pdf` удалён 2026-05-24, `ws` — 26.09.2026) | Шаг «остановить приложение» молча не срабатывает, а далее по тексту идут `rm -rf "$PGDATA"` и распаковка базового бэкапа поверх боевого томa. Приложение продолжает писать в заменяемую БД | Оставить `docker compose stop app workers`; строку про `ws`/`workers-pdf` убрать |
| F-03 | важно | `docs/runbooks/006-postgres-backup-restore.md:118` | `docker compose up -d app workers ws` | Финальный «Bring writers back» падает; приложение и воркеры остаются остановленными после восстановления | `docker compose up -d app workers` |
| F-04 | важно | `docs/runbooks/007-github-actions-deploy.md:41` | «`app workers ws` — full refresh after compose / env changes» | В workflow такой опции нет: `deploy.yml:18-21` предлагает только `app`, `app workers`, `workers`. Оператор не найдёт пункт в UI | Убрать `ws` из описания, привести список к трём фактическим опциям |
| F-05 | важно | `docs/runbooks/007-github-actions-deploy.md:42` | «`workers` / `ws` — solo bounce, rare» | То же: `ws` в workflow отсутствует | Убрать `ws` |
| F-06 | важно | `docs/runbooks/010-restore-drill.md:152-153` | Текст «Комментарий в шапке `scripts/pitr-basebackup.sh` («point-in-time recovery to any second») этому противоречит … (находка F-11)» | Шапка скрипта уже переписана и прямо отрицает PITR: `scripts/pitr-basebackup.sh:9-14` («"Point-in-time recovery to any second" is NOT available today»). Ранбук ссылается на несуществующую проблему | Обновить абзац: F-11 закрыта в самом скрипте; оставить только описание RPO |
| F-07 | важно | `docs/runbooks/014-post-deploy-2026-10.md:417` | Таблица: `scripts/backup.sh` пишет `system:backup:*` **без** приставки, статус «**не исправлено**» | Фактически скрипт уже пишет префикс: `scripts/backup.sh:95-97,167,176` → `pilingtrack:system:backup:*`. Предупреждение «мониторинг бэкапов снова ослепнет» устарело | Пометить как исправленное (или уточнить, что проверено на этой ревизии) |
| F-08 | важно | `docs/runbooks/014-post-deploy-2026-10.md:44` | Ссылка на `observability/prometheus/alerts.yml:242-264` для `AlertmanagerDown` и `AlertmanagerNotificationsFailing` | Фактически правила на `alerts.yml:320` и `alerts.yml:332` (файл вырос на ~78 строк) | Заменить на `alerts.yml:320,332` |
| F-09 | важно | `docs/runbooks/014-post-deploy-2026-10.md:45` | Ссылка на `alerts.yml:217-227` для `TargetDown` | Фактически `alerts.yml:260` (выражение `up{job!="alertmanager"} == 0` на `:264`) | Заменить на `alerts.yml:260-270` |
| F-10 | важно | `docs/runbooks/014-post-deploy-2026-10.md:310` | Ссылка на `alerts.yml:296-307` для `OffsiteBackupNotSynced` | Фактически `alerts.yml:406` (+110 строк) | Заменить на `alerts.yml:406` |
| F-11 | важно | `docs/runbooks/014-post-deploy-2026-10.md:310` | «`/api/metrics` печатает жёсткие `backup_age_hours 0` и `backup_s3_synced 0` (`src/app/api/metrics/route.ts:111-112`)» | Значения выводятся на `route.ts:132` и `route.ts:136`; логика изменилась — появились `backup_monitoring_enabled` и `backup_last_success_available` (там же), «жёстких 0» больше нет | Обновить номера строк и формулировку |
| F-12 | важно | `docs/runbooks/012-rls-fail-closed.md:111` | «`docker-compose.yml:107,194`» для строк `DB_IDENTITY_ROLE` | Фактически 107 и **200** (`grep -n 'DB_IDENTITY_ROLE' docker-compose.yml`); общее число совпадает (2) | Заменить `194` → `200` |
| F-13 | важно | `docs/runbooks/015-encryption-key-rotation.md:64` | «`docker-compose.yml:84` у `app`, `:185` у `workers`» для `ENCRYPTION_KEY` | Фактически 84 и **191** | Заменить `185` → `191` |
| F-14 | важно | `docs/runbooks/015-encryption-key-rotation.md:101` | `decrypt(...)` в `src/core/notifications/telegram.ts:69,82-83` | Фактически вызов `decrypt(raw.botToken)` на `telegram.ts:88`; на 69 — начало `loadConfigsForTenant` | Заменить на `telegram.ts:88` |
| F-15 | мелочь | `docs/runbooks/014-post-deploy-2026-10.md:318` и `docs/runbooks/013-prod-timers.md:47-49` | `getStateRedisClient()` в `…/checkers/backup.ts:81` | Фактически `backup.ts:83` | Заменить на `:83` |
| F-16 | мелочь | `docs/runbooks/014-post-deploy-2026-10.md:310` | disabled-ветка `checkBackupStatus()` в `backup.ts:76-78` | Фактически `backup.ts:78-79` | Заменить на `:78-79` |
| F-17 | мелочь | `docs/runbooks/015-encryption-key-rotation.md:58` | «`docker-compose.yml:71-123` для `app`, `:158-194` для `workers`» | Границы уехали: `app` 60-154 (env 71-153), `workers` 155-236 (env 164-236) | Обновить диапазоны служб |
| F-18 | мелочь | `docs/runbooks/015-encryption-key-rotation.md:60-61` | `loadKeyRegistry` в `encryption.ts:60-61` | Фактически функция объявлена на `encryption.ts:59` (тело 59-105) | Заменить на `:59` |
| F-19 | мелочь | `docs/runbooks/014-post-deploy-2026-10.md:392` | `session-service.ts:120` `keyPrefix: 'pilingtrack:'` | Фактически `src/services/auth/session-service.ts:121` | Заменить на `:121` |
| F-20 | мелочь | `docs/runbooks/005-websocket-crash.md` (весь файл) | Ранбук целиком про удалённый сервис `ws` (`dc ps ws`, `dc restart ws`, `dc build ws`, контейнер `pilingtrack-ws`, порт 3001) | Файл помечен «УСТАРЕЛ» в первой строке, но остаётся в `docs/runbooks/` и может быть найден по ключевым словам во время инцидента; все команды в нём нерабочие | Понизить в отдельный `docs/runbooks/_obsolete/` или явно пометить все блоки команд |
| F-21 | мелочь | `docs/runbooks/004-outbox-backlog.md:47` | «Это не относится к `workers-pdf`, где BullMQ допускает конкурентных потребителей» | Сервис `workers-pdf` удалён 2026-05-24 (`docker-compose.prod.yml:58` — комментарий об удалении); упоминание вводит в заблуждение | Заменить на актуальное имя исполнителя или убрать |
| F-22 | мелочь | `docs/runbooks/015-encryption-key-rotation.md` (имя файла) | Номер `015` дублируется: `015-disposable-integration-restore.md` и `015-encryption-key-rotation.md` | Два разных ранбука под одним номером; ссылки «ранбук 015» неоднозначны (`016-release-2026-10.md:20` ссылается на «ранбуки 013/015» — имея в виду какой?) | Перенумеровать один из них |

---

## Не проверено

- **Фактическое состояние боевого сервера.** Всё, что в ранбуках описано как снимок (`/opt/pilingtrack`, таймеры systemd на хосте, `docker system df`, `/var/backups/pilingtrack`, `/opt/pilingtrack/basebackups`, содержимое WAL-архива) командой на сервере **не проверялось**: доступ к бою запрещён правилами AGENTS.md, а сами ранбуки (013) прямо предупреждают, что снимок ≠ текущее состояние.
- **Значения `.env`.** Файлы `.env*` не читались (запрет AGENTS.md). Поэтому не проверено, что на проде `POSTGRES_USER=piling`, `POSTGRES_DB=pilingtrack`, `BACKUP_ENABLED` задан, а `SENTRY_DSN` совпадает с `sentry.server.config.ts:8`. Проверено только наличие **имён** переменных в `.env.production.example` (там нет `ENCRYPTION_KEY_VERSION`/`ENCRYPTION_KEY_V1`) и факт проброса в `docker-compose.yml`.
- **Внешние URL и приватные ресурсы.** `https://orionpiling.ru/...`, `R2:pilingtrack/db-backups/`, `87.242.102.125`, ключ `~/.ssh/orionpiling` — сетевого доступа не было, существование проверено только как строк в тексте.
- **Исторические числа в журналах учений.** Записи вида «58 таблиц», «Report=131», «320 грантов», «≈11 с» (`docs/runbooks/010-restore-drill.md:53-57,145-146,176-185`) — это исторические измерения, воспроизвести их без доступа к дампу/бою нельзя, достоверность не проверялась.
- **Утверждения о поведении, требующие запуска.** «8 проверок» в `scripts/app-role-smoke.ts`, «5 проверок» в `scripts/app-role-verify.sql`, число политик RLS (46/37/6), «63 маршрута чтения» (`docs/runbooks/012-rls-fail-closed.md:35`) — по коду выводятся, но не исполнялись; помечены как ГИПОТЕЗА в таблице соответствия там, где это имеет значение.
- **Ссылки на существующие отчёты аудита** (`docs/audits/hermes-night/R56-*.md`, `R57-*.md`, `R61-*.md`, `R69-*.md`, `R70-*.md`, `R92-*.md`, `docs/audit.md`) — по правилам задания существующие отчёты не читались; проверено только, что на них ссылаются ранбуки 008/010/013/014/015.
- **`docs/runbooks/015-*` дубль номера** — замечено как факт листинга каталога; какой из двух задуман как канонический «015», определить по репозиторию не удалось.
