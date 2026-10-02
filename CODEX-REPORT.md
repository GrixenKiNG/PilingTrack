# CODEX — поток 1, 02.10.2026

Папка D:\PillingR\wt-codex, ветка codex/night-1001, исходный HEAD 0ea0c6be.
Отчёт первого запуска полностью заменён. Порядок N1 → N2 → N3 → N8 → N5 соблюдён.
Этап 2 выполняется S1 → S2 → S3+; статус и итоговые проверки дополняются ниже.

## Коммиты и результат N-задач

| Задача | Коммит | Результат |
|---|---|---|
| N1 | 8eee7031 | Smoke workers: startup+Arming, fatal imports/syntax/reference/early exit →1, deadline60с, last40logs при отказе, trap cleanup. Deploy build+smoke до первого SSH; SKIP_WORKERS_SMOKE=1 с предупреждением. Runbook008 и тест |
| N2 | 265a9c79 | AST-сторож защиты каждого экспортируемого метода: function/const/aliases/local callbacks/import aliases. 7 проверяемых mutation исключений и7публичных GET; новых дыр в текущем наборе не найдено |
| N3 | fdc0c678 | Guard читает реальный keyPrefix,3client.get checker,SET всех scripts/*.sh. Исправлены5непрефиксованных записей backup.sh; stdin backup-postgres и исторические команды проверяются отдельно |
| N8 | 7307f269 | Worker enabled/status,health status/freshness,backup enabled/available/stale/missing; Redis maxmemory0 исключён из ratio; диск root label /; Postgres sum всех labels,160/190 от max200, configurable DB name; offsite join job/instance |
| N5 | 29417525,eada5e1f | CI runner build/load/smoke с Docker GHA cache,отдельный no-next после Prisma generate; npm cache и падающие gates сохранены. Manual deploy smoke до compose up. CLI-проверка выявила dependency images: выбирается штатная build-label workers, отсутствие образа →1 |

## Проверки перед каждым коммитом

Команды выполнялись отдельно, реальные exit-коды сохранены; fake env для прохождения проверок нет.

| Задача | RED | GREEN и дополнительно |
|---|---|---|
| N1 | shell guard8failed,exit1 | smoke+no-next16passed/0skipped0;tsc0;bash-n двух скриптов0; Docker runner build0,реальный smoke0 |
| N2 | ограниченный parser11passed/3failed1 | 14passed/0skipped0;tsc0;ESLint файла0/0warnings |
| N3 | прежний backup.sh5passed/1failed1 | guard+healthtracker26passed/0skipped0;tsc0;bash-n backup.sh0;fixture старых stdin SET отвергнут |
| N8 | основной16failed/16passed1;PG1failed/22passed1 | 67passed/0skipped0 в4файлах;tsc0;ESLint4файлов0/0warnings;YAML js-yaml0,27active rules;ручная PromQL сверка |
| N5 | CI/deploy8passed/2failed1;Compose selector10passed/2failed1 | smoke+no-next18/0,после selector20/0,exit0;tsc0;YAML2workflows0;bash-n remote block0;local runner build0/smoke0 |

N5 GitHub Actions не запускался: push запрещён. Оценка дополнительного job4–10мин холодного
кеша/1–3мин тёплого — оценка, не измерение GitHub runner. Job параллелен unit, поэтому
критический путь CI может не вырасти. Локальная повторная сборка использовала кеш
dependency layers и Prisma generate внутри образа; production не затрагивался.

## Scope и строки N-задач

Суммарно от исходного HEAD, до документов этапа2:14файлов,+910/-25.
Удалённых путей, функций/экспортов приложения нет. Строки ниже — по логическим коммитам.

- N1: scripts/smoke-workers-image.sh+46;deploy-prod.sh+13/-1;runbook008+5;workers-image-smoke.test.ts+75.
- N2: route-guards.test.ts+323.
- N3: backup-redis-keys.test.ts+88;scripts/backup.sh+5/-5.
- N8: alerts.yml+81/-13;metrics route test+122/-2;metrics route+20/-3;unified-worker test+27;health-server+2/-1.
- N5: ci.yml+27;deploy.yml+8,затем+8/-1;workers-image-smoke test+36,затем+25.

N2 проверяет структурную достижимость вызовов и текущий inventory; статический AST
не доказывает runtime доминирование auth во всех ветвях. Runtime RBAC/browser не проверялся.
Явные mutation исключения: auth/login POST,orion/lead POST,alerts/webhook POST,
telemetry/ingest POST/PATCH,telemetry POST,telemetry/batch POST. Их собственные
auth/token/CSRF/лимиты проверяются по достижимым вызовам; blanket allowlist нет.

Других app-backup SET писателей scripts/*.sh не найдено: backup-postgres пишет
префиксованные stdin-команды,backup.sh теперь пишет те же3метки.
scripts/Dockerfile.backup копирует backup.sh, поэтому он не удалялся как legacy.
prod-audit-readonly читает Redis; stress-test JS пишет свои failover ключи;
BullMQ управляет namespace и намеренно работает без ioredis keyPrefix. Эти места не менялись.

## Общие проверки после N-задач (до дополнительных selector tests/S3)

| Команда | Exit | Результат |
|---|---:|---|
| Проверка .next/dev/types | 0 | каталога нет, stale types не оставлены; удаление не требовалось |
| npx tsc --noEmit | 0 | в том числе после selector followup |
| npm run lint | 0 | 0errors,7исходных warnings;check-text-integrity passed |
| npm run test:unit | 1 | 2683passed/7failed/60skipped;files301passed/1failed/8skipped,310total |
| npx playwright test --list | 0 | исходный контроль99tests/11files;итоговый после S3 ниже |
| npm run build | 1 | исходный validate-env: нет DATABASE_PROVIDER/SESSION_SECRET;итоговый после S3 ниже |

Семь failures — прежний src/services/reports/__tests__/daily-summary.test.ts:
неизолированные обработчики обращаются к lazy Prisma без DATABASE_URL.
Код приложения/окружение ради них не менялись; отдельная задача Hermes.
Vitest core не загружает env автоматически, но существующий vitest.config.ts читает
2DB URL из .env, если он есть. В worktree .env отсутствовал (metadata-only проверка),
поэтому конфиг не прочитал его, DB-backed suites пропустились.60skipped не проверенные интеграции.

## GitNexus и границы

Разрешённый общий launcher один раз попытался analyze --index-only;impact тоже не заработал:
bootstrap native @ladybugdb/core под Node26,spawnSync cmd.exe ENOENT,exit1.
Project package.json/package-lock/node_modules не менялись. Глобальный pnpm tool bootstrap
не ремонтировался. Применён разрешённый владельцем fallback rg по src/tests/e2e/scripts
и git diff --stat до редактирования/коммита;caller summary есть в каждом commit body.
Текстовый поиск подтверждает источники/callers, но не равноценен полному call graph.

Пакеты не устанавливались в проект. Prod/SSH/SCP/push/merge не выполнялись, ветки не переключались.
promtool отсутствует: YAML parse и ручная PromQL проверка не заменяют
promtool check rules observability/prometheus/alerts.yml.
Нет TLS metric/exporter: не добавлено правило на выдуманное имя.
Production series/reload,доставка тревог,внешний app-guard и browser/role workflows не проверялись:
это приёмка владельца и Claude.

Диск подтверждён [node-exporter source](https://github.com/prometheus/node_exporter/blob/master/collector/paths.go#L43-L51).
PG labels — [postgres-exporter source](https://github.com/prometheus-community/postgres_exporter/blob/master/collector/pg_stat_activity.go#L31-L44).
Compose label — [build source](https://github.com/docker/compose/blob/v2/pkg/compose/build.go#L284-L294).
При image build npm сообщил4high vulnerabilities;reachability не исследовалась, зависимости не обновлялись.

## Поток 2

codex/integration-1002 в D:\PillingR\wt-codex2 завершён независимо.
Коммиты2f3ef53b,6c84ff00,a82f6b26,96a904c5;отчёт53d30263.
35passed/0failed/0skipped на PostgreSQL16,107миграций;
restore84таблицы/107миграций/76RLS,successful13с,данные только синтетического стенда.
Свои контейнеры удалены. Это не production backup/offsite/media/liveRTO.
Учение27.09 уже было документировано runbook010; автоматизация дополняет его.
Подробные команды/scope/границы — CODEX-REPORT.md второго worktree.
После остановки daemon тот поток один раз запустил Desktop hidden;
явных start/stop/inspect/exec owner-container не было. Факт указан в его отчёте.

## Что намеренно оставлено

Auth/security/CSRF/rate-limiter/RLS/tenancy runtime,schema/migrations,compose/Dockerfiles,
зависимости,operator варианты,ORION не изменены потоком1. Многоарендность,2Redis,PgBouncer,
outbox/projections сохранены. Исходные lint warnings/daily-summary failures не маскировались.
Проверки UI не подменяются API/unit/build.

## Этап 2

S1 — 30650eec: стратегия 2026Q4, 6 измерений, 10 рисков, 12 инициатив. Source-reference check: 33 существующих пути, 0 missing; tsc exit 0; четыре существующих guard-файла: 40 passed / 0 skipped, exit 0. Подсчёт Node: 1230 файлов TS/TSX без generated, 41 крупный, 32 production / 9 test. S2 — da6b7077: 15 документов H01–H15, каждый +41/-0, общий +615/-0; точные whitelist, критерии, тесты, зависимости и стоп-условия. tsc exit 0; guards первый 39 passed / 1 failed (smoke timeout 5000ms), повтор 40 passed / 0 skipped exit 0; таймауты/assertions не изменены. Codex инициативы дополняются после отдельных коммитов.

### I01 — настоящая очередь проекций

Коммит 1df899d5 (CODEX-S3-projection-lag), 5 файлов +219/-26.
projected:false независимо от published и retry; один агрегат count+oldest.
Ошибочный сбор отклоняется и сохраняет предыдущий snapshot, freshness timestamp не обновляется.
Null/invalid snapshot экспортирует timestamp=0; добавлены три правила projection warn/high и stale sample.
Новый lag-monitor.test.ts +136; прочие пути: lag-monitor +41/-21, alerts +31,
metrics route +1/-3, его существующий тест +10/-2.
RED: 23 passed / 10 failed, exit 1, после устранения test dynamic-import race
локальной загрузкой одного DB-client на snapshot. GREEN: 67 passed / 0 skipped
в четырёх файлах, exit 0; актуальный общий tsc exit 0; ESLint exit 0/0 warnings;
YAML js-yaml exit 0 (30 rules); scoped diff-check exit 0.
Callers fallback: tracker/aggregate/metrics route; consumer flags сверены с outbox-publisher.
Schema/DB runtime не менялись. Promtool и real production series не проверены;
стоимость нового агрегата на production dataset не измерялась. Владелец проверяет scrape/reload.
### I02 — lease в Redis состояния

Коммит d1f38b5a (CODEX-S3-worker-lease), 3 файла +356/-139.
leader-election +129/-87, существующий тест +200/-52, runbook014 +27.
Atomic owner-checked renew/release; single-flight/generation/stop-start barrier,
снятие лидерства при Redis error/null, deadline и synchronous expiry check.
RED: 10 failed / 2 passed, exit 1; TTL callback gap отдельно: 1 failed / 12 passed.
GREEN root: 44 passed / 0 skipped в lease+health+workers, exit 0; tsc exit 0,
ESLint exit 0/0 warnings, diff-check exit 0. В промежуточном combined прогоне
43 passed / 1 failed был параллельный I04 RED, после wiring повтор прошёл.
Fallback callers: standalone, unified и embedded outbox/projection; lag monitor.
Risk пользователю сообщён до правок. Перед применением владелец останавливает
ВСЕ старые standalone/unified/embedded workers; old-cache/new-state rolling mix опасен.
Ключи/префикс/nodeId/TTL/renew interval сохранены. Нет DB fencing уже начатых операций;
stop может ждать зависший Redis request, локальное лидерство снимается сразу.
Docker daemon сейчас недоступен: настоящий Lua smoke и новый image build не выполнены.
Независимое review потребовало monotonic deadline вместо Date.now; follow-up ниже.
### I03 — неперекрывающиеся scheduler

Коммит 1a2d340f (CODEX-S3-scheduler-overlap), 4 файла +118/-0:
PM/readiness/projection-rebuild scheduler по +6, существующий sentry.test +100.
Один активный проход на модуль/процесс; finally снимает guard после успеха,
ошибки команды или heartbeat. Stop очищает timers, но не сбрасывает guard
незавершённого прохода. Tenant loops, domain commands и интервалы сохранены.
RED: 9 failed / 6 passed, exit 1 — пока первый pass/heartbeat заблокирован,
startup+interval запускали команду четыре раза. GREEN: 37 passed / 0 skipped
в sentry/heartbeat/unified/no-next, exit 0; tsc exit 0; scoped ESLint exit 0.
Fallback: unified-worker вызывает три start-функции, существующий Sentry тест.
Межпроцессная исключительность и отмена уже начатого прохода не реализуются.
В прогоне видны Vite config и MaxListeners warnings; они не подавлялись.