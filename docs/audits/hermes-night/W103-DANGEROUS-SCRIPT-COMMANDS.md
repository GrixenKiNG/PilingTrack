# W103 — Разрушительные команды в скриптах, Dockerfile и ранбуках

Дата: 08.10.2026. Задача только на чтение; изменён лишь этот файл.

## Итог

- Просмотрены `scripts/**` (`*.sh`, `*.ps1`, `*.js`, `*.ts`, `*.cjs`, `*.sql`), `docs/runbooks/**`,
  `Dockerfile*` (5 шт.), `docker-compose*.yml` (6 шт.), а также смежные `package.json`,
  `deploy/Dockerfile.prod`, `deploy/systemd/**`, `.github/workflows/**`, корневые `DOCKER-SETUP.md`,
  `setup.sh`, `docker-setup.sh`, `docker-setup.ps1`, `SETUP-GUIDE.sh`.
- Всего находок: **27** — **критично: 1**, **важно: 10**, **мелочь: 16**.
- В `docker-compose*.yml` и во всех пяти `Dockerfile*` разрушительных команд, срабатывающих против
  данных, **не найдено** (только build-временные `rm -rf node_modules/next`, `npm prune`, `docker rm`
  своего проб-контейнера — см. раздел «Проверено, безопасно»).
- Единственная **критичная** находка — `scripts/apply-full-ddl.ts:51` (npm-скрипт `db:apply-ddl`):
  он запускает `npx prisma db push --schema prisma/schema.prisma --accept-data-loss` без единой
  проверки «это не прод» и без подтверждения. Это ровно та команда, которую AGENTS.md §1 прямо
  запрещает («может стереть локальную БД»), и она доступна как npm-скрипт в самом репозитории.
- Top-5 по важности:
  1. `scripts/apply-full-ddl.ts:51` — `prisma db push --accept-data-loss` без защиты.
  2. `package.json:54,57,58,59,65` — `db:push` / `db:migrate` (`migrate dev`) / `db:reset`
     (`migrate reset`) / `db:apply-ddl` — набор запрещённых AGENTS.md команд без гейта «только dev».
  3. `docs/runbooks/012-rls-fail-closed.md:277` — `redis-cli -a "$REDIS_PASSWORD" FLUSHALL`
     на боевом state-Redis (очищает счётчики лимитов, lease лидеров, очереди) в шаге отката.
  4. `docs/runbooks/001-postgresql-down.md:67-68` — `docker image prune -af` в разгар инцидента
     «диск полон»; `-a` удаляет и откатный образ.
  5. `docs/runbooks/009-pitr-restore.md:194` — `sudo rm -rf "$PGDATA"` стирает каталог данных боевого
     Postgres-тома; единственная страховка — `cp -a` строкой выше (`:189`).

## Методика

1. Инвентаризация файлов: `search_files` по `scripts/**` (103 файла), `docs/runbooks/**` (17 файлов),
   `Dockerfile*` (5), `docker-compose*.yml` (6), `deploy/**` (12).
2. Поиск шаблонов задачи (`rm -rf`, `Remove-Item -Recurse`, `docker system prune`, `docker volume rm`,
   `docker image prune`, `DROP `/`TRUNCATE`, `migrate reset`/`migrate dev`, `--force-reset`) как
   контент-поиск с контекстом: `search_files` (target=content, context=1..3) отдельно по каждому
   каталогу, чтобы не потерять совпадения на усечении вывода.
3. Дополнительно искались `docker rm|docker rmi|down -v|FLUSHALL|db push|docker builder prune|
   docker container prune|-delete|find … -delete` (по `scripts/`, `docs/runbooks/`, `.github/`).
4. Каждый найденный файл читался целиком (`read_file`) — защита рядом фиксировалась по факту строк,
   а не по догадке. Для скриптов отмечалось: есть ли запрос подтверждения (интерактивный `read -p`),
   проверка переменной окружения, проверка «это не прод», ограничение на имя цели.
5. Разделил находки по признаку «срабатывает ли на проде без подтверждения»:
   сначала без защиты, затем защищённые/локальные только цели, затем сводка по файлам.
6. Ничего не выполнял: команды не запускались, файлы не менялись.

---

## Находки БЕЗ защиты (могут сработать на проде без подтверждения)

| # | severity | path:line | команда | сценарий / почему важно |
|---|---|---|---|---|
| 1 | критично | `scripts/apply-full-ddl.ts:51` | `execSync('npx prisma db push --schema prisma/schema.prisma --accept-data-loss')` | Запускается npm-скриптом `db:apply-ddl` (`package.json:65`). Ни запроса подтверждения, ни проверки `DATABASE_PROVIDER`/«не прод», ни сверки хоста. Работает по `DATABASE_URL_POSTGRES` (`apply-full-ddl.ts:27`), а на боевом хосте эта переменная указала бы на реальную БД (`docker-compose.yml:47` — владелец `POSTGRES_USER`). Флаг `--accept-data-loss` явно разрешает Prisma удалять колонки/данные при расхождении схемы. Это буквально запрещённая AGENTS.md §1 команда, оформленная как штатный npm-скрипт. |
| 2 | важно | `package.json:54,57,58,59,65` | `db:push` = `prisma db push`; `db:migrate` = `prisma migrate dev`; `db:reset` = `prisma migrate reset`; `db:apply-ddl` = `npx tsx scripts/apply-full-ddl.ts` | Четыре npm-скрипта один-в-один повторяют набор, который AGENTS.md §1 запрещает запускать. У `db:reset`/`db:migrate` нет ни префикса «dev», ни проверки, что `DATABASE_URL` ведёт на локальную базу, ни `NODE_ENV`-гейта. Копипаст из README/подсказки shell может дёрнуть их против боевой БД. |
| 3 | важно | `docs/runbooks/012-rls-fail-closed.md:277` | `docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" FLUSHALL` | Шаг «откат» боевой процедуры. `FLUSHALL` стирает **весь** state-Redis: счётчики rate-limit (сбрасывает окно брутфорса), lease лидеров outbox/projection (два лидера), очереди — то есть все три «ключевых» факта состояния сразу. Пароль передан через `-a` и потому виден в `ps` (прямое нарушение правила «секрет не в argv», §Lessons памяти). Защиты/подтверждения нет. |
| 4 | важно | `docs/runbooks/001-postgresql-down.md:67-68` | `docker builder prune -af` + `docker image prune -af` | Шаг «диск полон» в P0-ранбуке, выполняется под инцидентом. У `docker image prune -af` флаг `-a` удаляет **все** образы, не занятые контейнером, — включая откатный тег предыдущей выкладки (см. находку 7). Предупреждения или проверки перед этим шагом нет; есть только общая ремарка «НЕ трогать каталог данных postgres». |
| 5 | важно | `docs/runbooks/009-pitr-restore.md:189,194` | `sudo cp -a /var/lib/docker/volumes/pilingtrack_postgres_data ...` затем `sudo rm -rf "$PGDATA"` | Раздел «Real restore» боевого Postgres: `rm -rf` стирает каталог данных боевого тома. Единственная страховка — `cp -a` строкой выше; проверки, что копия удалась перед `rm` (размер/путь), нет. Интерактивного подтверждения нет — защита только в том, что это ручной ранбук. |
| 6 | важно | `docs/runbooks/006-postgres-backup-restore.md:99-104` | `psql -c "DROP DATABASE IF EXISTS $POSTGRES_DB WITH (FORCE);"` + `CREATE DATABASE $POSTGRES_DB` | Полная замена боевой БД: `WITH (FORCE)` принудительно рвёт соединения. Помечено «DESTRUCTIVE», но запроса подтверждения нет и проверки «свежий ли дамп» перед drop — тоже (комментарий требует остановить app/workers вручную). |
| 7 | важно | `docs/runbooks/013-prod-timers.md:37,65-85` | `docker image prune -af --filter until=168h` (плюс `docker builder prune -af`, `docker container prune -f`) | Боевой systemd-таймер `pilingtrack-docker-prune.timer` (воскресенье ~04:10). `image prune -af` удаляет откатный образ после того, как прошло >7 суток с простоя в выкладках — ранбук сам разбирает этот риск (`:65-85`). Ни юнита, ни скрипта в репозитории нет (`:101`), то есть команду нельзя даже отревьюить в PR. Проверено по тексту ранбука, не на сервере. |
| 8 | важно | `DOCKER-SETUP.md:133-134,168,219,222-223` | `docker compose down -v`, `docker volume rm postgres_data`, `docker system prune -a`, `rm -rf docker_volumes/` | Корневой гайд для локальной разработки: `down -v`/`volume rm postgres_data` удаляют том с БД, `docker system prune -a` помечен «опасно!», но стоит в обычном списке команд рядом с безопасными. Явной проверки «это локально, не прод» нет — гайд можно скопировать на сервер. |
| 9 | важно | `scripts/deploy-prod.sh:100-102` | цикл `docker rmi` по серверу: удаляет все теги образа, кроме `:latest` и одного откатного | Выполняется автоматически при каждой выкладке (SSH). Оставляет ровно один откатный набор, но молча сносит любой другой (например, вручную закреплённый известный-рабочий) тег. Перед удалением нет вывода списка того, что будет удалено, и нет подтверждения; защита — только то, что `:latest` и один `$ROLLBACK` не трогаются. |
| 10 | важно | `scripts/setup-partitioning.ts:47,69,72` | генерирует `ALTER TABLE ... RENAME TO "..._old"`, `INSERT ... SELECT`, `DROP TABLE "$table_old" CASCADE` для `TelemetryRecord`, `OutboxEvent`, `AuditLog` | Скрипт пишет SQL в `scripts/partitioning.sql` для ручного `psql`. Предупреждение есть (`:86` «Ensure you have a backup»), но нет проверки, что данные из `_old` доехали до партиционированной таблицы, нет dry-run и нет подтверждения: если `INSERT` упадёт и `DROP TABLE ..._old` всё равно выполнится вручную — данные трёх таблиц потеряны. `CASCADE` добьёт зависимые объекты. |
| 11 | важно | `scripts/backup.sh:214` (в паре с `:195-198`) | печатает готовые команды `psql -c 'DROP DATABASE ${DB_NAME};'` для «переключения» на восстановленную БД; сам делает `DROP DATABASE IF EXISTS ${DB_NAME}_restore` | `backup.sh` — legacy-скрипт (ранбук 013:103: на бою запускается `backup-postgres.sh`, не он). Но его подсказка выводит **боевой** `DROP DATABASE` без предупреждения; оператор под инцидентом скопирует её как есть. Защиты/подтверждения нет. |
| 12 | мелочь | `scripts/switch-db.js:62` | `fs.writeFileSync(ENV_FILE, swapDb(text, target))` | Переписывает `.env`, переводя `DATABASE_URL*` на базу `pilingtrack_prod_copy`. Подтверждения нет; риск не в удалении, а в том, что dev-процесс/скрипт незаметно ходит в снапшот прода (в т.ч. `db:reset`/`db:push` против него). |

## Находки С защитой / локальные цели (проверено по файлу)

| # | severity | path:line | команда | защита рядом |
|---|---|---|---|---|
| 13 | мелочь | `scripts/staging-local.sh:56` | `"${DC[@]}" down -v` | Только по явному флагу `--destroy`; проект изолирован (`-p pilingtrack-staging`, свои секреты, `:34-35`). Явного «стирается только стенд» предупреждения нет, но команда — за флагом. |
| 14 | мелочь | `scripts/staging-local.sh:124` | `DROP DATABASE IF EXISTS pilingtrack WITH (FORCE)` | Внутри контейнера стенда (`psql_owner`, `-p pilingtrack-staging`), не боевая БД. |
| 15 | мелочь | `scripts/cleanup-local-artifacts.ps1:31,43` | `Remove-Item -LiteralPath $path -Recurse -Force` | Список путей задан статически (`.next`, `coverage`, `playwright-report`, `test-*`, `tmp-*`, `*.log`, `*.zip`, `:3-26`); `-LiteralPath`; ошибка ловится (`-ErrorAction Stop` + `catch`). Промпта нет, но цели ограничены артефактами. |
| 16 | мелочь | `scripts/refresh-prod-snapshot.sh:30-31` | `DROP DATABASE IF EXISTS pilingtrack_prod_copy` + `CREATE` | Локальный контейнер `pilingtrack-postgres`, БД-снапшот с явным именем (`:16`), а не прод. |
| 17 | мелочь | `scripts/restore.sh:186-187` | `DROP DATABASE IF EXISTS ${RESTORE_DB}` | `RESTORE_DB="pilingtrack_restore_<timestamp>"` (`:40`) — отдельная БД, боевая не трогается; интерактивное подтверждение `read -p "Continue? [y/N]"` при TTY (`:289-301`). В подсказках (`:254,263`) есть боевой `DROP DATABASE` — только как текст для ручного шага. |
| 18 | мелочь | `scripts/backup.sh:109,116,123` | `find … -delete` (ретеншн) | Удаляет дампы старше `RETENTION_DAYS`/`WEEKS`/`MONTHS` в каталогах бэкапов. Ограничено по маске и возрасту; legacy-скрипт. |
| 19 | мелочь | `scripts/backup-postgres.sh:54,59` | `rm -f "$OUT"` (пустой дамп) + `find … -mtime +30 -delete` | `rm` только для невалидного (нулевого) дампа; ретеншн ограничен возрастом и маской `${POSTGRES_DB}-*.sql.gz`. |
| 20 | мелочь | `scripts/pitr-basebackup.sh:71,84` | `rm -f "$OUT"` (пустой base backup) + `rm -f "$f"` (старые base-*.tar.gz) | Ретеншн выполняется **после** успешной новой копии; удаляется только то, что вне `$KEEP` (`:80-86`). |
| 21 | мелочь | `scripts/backup-local-db.ps1:45` | `Remove-Item $_.FullName -Force` (ротация) | Оставляет 10 свежих дампов (`$keep=10`, `:14`), удаляет по `Select-Object -Skip $keep`; область — `backups\*.sql.gz`. |
| 22 | мелочь | `scripts/test-db-down.sh:8-13` | `docker rm -fv "$name"` | Жёсткая валидация: имя по regex `^codex-pg-[a-f0-9]{12}$` (`:4`) **и** проверка label `pilingtrack.codex.test-db=1` (`:8-11`); иначе `exit 64`. Образцовая защита. |
| 23 | мелочь | `scripts/smoke-workers-image.sh:10,15` | `docker rm -f "$container"`, `rm -f "$log"` | Удаляется только свой проб-контейнер (`codex-workers-smoke-…`, `:6`) и свой временный лог. |
| 24 | мелочь | `scripts/app-role-smoke.ts:110,119` | `$executeRawUnsafe('DROP TABLE "app_role_smoke_probe"')`, `DELETE FROM "_prisma_migrations" WHERE false` | Проба создаётся самим скриптом строкой выше (`:109`); `WHERE false` не удаляет строк. Тестовый контур. |
| 25 | мелочь | `scripts/apply-full-ddl.sql:333,352` | `DELETE FROM "IdempotencyKey" …`, `DELETE FROM "OutboxEvent" …` | Это тела функций `cleanup_expired_…` — удаление ограничено по `expiresAt`/`published` и возрасту (ретеншн), не безусловное. |
| 26 | мелочь | `docs/runbooks/010-restore-drill.md:28,44,84` | `DROP DATABASE … pilingtrack_drill`, `rm -rf /tmp/r2pull` | Дрилл-БД с явным именем, локальный Postgres-контейнер; `rm -rf` — по временному каталогу `/tmp`. |
| 27 | мелочь | `docs/runbooks/011-app-db-role.md:60,92` и `006:150` | `DROP DATABASE pilingtrack_roledrill` / `restore_test` | Дрилл/смоук-БД, локально, с явными именами. |

## Проверено — безопасно (деструктива против данных нет)

- `Dockerfile.workers:54` — `rm -rf node_modules/next node_modules/@next …` из **сборочного слоя** образа
  (не хоста и не данных); `deploy/Dockerfile.prod:43` — `npm prune --production` (тоже build-слой).
  `Dockerfile`, `Dockerfile.quick`, `scripts/Dockerfile.backup` — команд удаления данных нет.
- `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`,
  `docker-compose.monitoring-prod.yml`, `docker-compose.observability.yml`,
  `docker-compose.monitoring-standalone.yml` — разрушительных команд нет. Единственный опасный на вид
  узел — сервис `migrate` (`docker-compose.yml:29-40`) — выполняет `npx prisma migrate deploy`
  (аддитивная накатка) + идемпотентный seed; на проде `SKIP_SEED=1` (`docker-compose.prod.yml:144`).
  `migrate reset`/`dev`/`db push` в compose **не встречаются** (поиск по `*.yml` → 0, кроме
  `migrate deploy`).
- `deploy/systemd/*` (6 юнитов) — команд удаления нет; юнита `pilingtrack-docker-prune.*` в репозитории
  нет вовсе (описан только в ранбуке 013).
- `docs/runbooks/016-release-2026-10.md:31` — явный запрет: «Не использовать migrate reset/dev/db push».
  Это готовый guard, зафиксированный в тексте релиза.
- `.github/workflows/deploy.yml:84` — `docker builder prune -f` между сборками (кэш, безопасно).
- `scripts/prod-audit-readonly.sh` — по шапке (`:1-13`) только `ps/df/ss/logs/SELECT/INFO`, заявлен
  read-only (полный текст не читал построчно — см. «Не проверено»).
- `scripts/replace-worker-generation.sh` — stop/start контейнеров с полным preflight и авто-возвратом
  (`recover`, `:8-46`), команд удаления образов/томов/данных нет.

## Сводка по файлам (где встречаются разрушительные команды)

| Файл | Что найдено | Защита |
|---|---|---|
| `scripts/apply-full-ddl.ts` | `prisma db push --accept-data-loss` | **нет** |
| `package.json` | `db:push`/`db:migrate`/`db:reset`/`db:apply-ddl` | **нет** |
| `scripts/setup-partitioning.ts` | `DROP TABLE ..._old CASCADE` (генерация) | предупреждение, без preflight |
| `scripts/deploy-prod.sh` | `docker rmi` (на сервере) | оставляет 1 откатный набор |
| `scripts/backup.sh` | `DROP DATABASE` (печать) + ретеншн `-delete` | legacy, локальная цель |
| `scripts/restore.sh` | `DROP DATABASE…_restore` | отдельная БД + `read -p` |
| `scripts/refresh-prod-snapshot.sh` | `DROP DATABASE pilingtrack_prod_copy` | локальная БД |
| `scripts/staging-local.sh` | `down -v`, `DROP DATABASE` | флаг `--destroy`, изолированный проект |
| `scripts/backup-postgres.sh`, `pitr-basebackup.sh`, `backup-local-db.ps1` | `rm -f`, `find -delete` | ретеншн после успеха |
| `scripts/cleanup-local-artifacts.ps1` | `Remove-Item -Recurse -Force` | статический список путей |
| `scripts/test-db-down.sh`, `smoke-workers-image.sh` | `docker rm -f` | label/regex/свой контейнер |
| `scripts/switch-db.js` | перезапись `.env` | **нет** |
| `docs/runbooks/001` | `image prune -af` | **нет** |
| `docs/runbooks/006` | `DROP DATABASE … WITH (FORCE)` | «DESTRUCTIVE», без промпта |
| `docs/runbooks/009` | `rm -rf "$PGDATA"` | копия `cp -a` выше |
| `docs/runbooks/010/011` | `DROP DATABASE <дрилл>` | явные имена, локально |
| `docs/runbooks/012` | `FLUSHALL`, `DROP POLICY` | **нет** (в `-a` ещё и пароль) |
| `docs/runbooks/013` | `image prune -af --filter until=168h` | **нет**, юнита в репо нет |
| `DOCKER-SETUP.md` | `down -v`, `volume rm`, `system prune -a`, `rm -rf` | **нет** |
| `Dockerfile*`, `docker-compose*.yml`, `deploy/systemd/**` | против данных — нет | — |

## Не проверено

- **Скрипты не выполнялись** (правило задачи). Все выводы — по тексту файлов.
- **`.env` не читались** (запрет AGENTS.md §3). Поэтому «на проде `db:apply-ddl` ударит по боевой БД» —
  вывод из `apply-full-ddl.ts:27` + `docker-compose.yml:47` (владелец ходит ролью `POSTGRES_USER`),
  а не из фактического значения `DATABASE_URL_POSTGRES` на сервере. Проверить фактическое значение
  я не мог.
- **Файлы, существующие только на сервере** (`pilingtrack-docker-prune.service/.timer`) в репозитории
  отсутствуют — их содержание известно только по описанию в ранбуке 013; включать/выключать таймер на
  живом хосте не проверялось (SSH запрещён).
- **`scripts/prod-audit-readonly.sh`, `scripts/audit-remote.sh`, `scripts/check-postgres-rules.js`,
  `scripts/apply-postgres-hardening.ts`** просмотрены частично (по шапке и по поиску шаблонов);
  построчного чтения всего файла не делал.
- **`.github/workflows/deploy.yml`** проверен только контент-поиском по шаблонам задачи, целиком не
  читался; секреты workflows не смотрел.
- **`deploy/cloudflare-worker/**`, `deploy/Caddyfile.prod`, `docs/archive/**`, корневые
  `deploy-2026-05-17.md` и `CHANGELOG.md`** (содержат `docker system prune -af --volumes`) — вне
  заявленного охвата задачи и не разбирались построчно; `CHANGELOG.md:62` и `deploy-2026-05-17.md:53`
  содержат `docker system prune -af --volumes` (удаляет и тома) — отметил по поиску, но не проверял
  контекст.
- **Порт `ws` (3001)** в ранбуках 005/007 уже устарел (сервис снят 26.09.2026) — команды `dc restart ws`
  разрушительными не являются, но и актуальность их не проверял.
