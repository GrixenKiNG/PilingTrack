# AU200-S7-BACKUP-VERIFICATION — Резервные копии: проверка восстановления

Версия: `git rev-parse HEAD` = **1142e72d12cccaf79b26842182e98a08542307c8** (ветка `hermes/q4-0926`).
Режим: только чтение, код приложения не менялся. Существующие отчёты в `docs/audits/`
не открывались. Числа — только из команд/файлов, которые названы рядом.

## Резюме для владельца

1. Ночной дамп БД копируется на сервере **и** в Cloudflare R2, но проверяется только
   на «файл не пустой» (`scripts/backup-postgres.sh:51`): ни `pg_restore -l`, ни sha256 —
   обрезанный дамп того же размера пройдёт как успешный.
2. Реальное учение восстановления (`scripts/restore-drill.sh`) существует, но рассчитано
   на синтетический дамп из теста и **не запускается по расписанию** — боевой дамп
   восстанавливают руками и раз в квартал (`docs/runbooks/010-restore-drill.md:6`).
3. Файловый фолбэк мониторинга бэкапа физически не может найти боевой дамп: он ищет
   `…/daily/*.dump` (`src/core/observability/health-tracker/checkers/backup.ts:29-31`),
   а прод пишет `…/*.sql.gz` (`scripts/backup-postgres.sh:41`).
4. **Фотографии/сканы (бакет `media/`) не входят ни в одну копию**: `rclone` уносит только
   `db-backups/` (`scripts/backup-postgres.sh:122`); копирования `media/` нет ни в скрипте,
   ни таймере. В дампе БД только строки-ссылки, не сами файлы.
5. Секреты (`.env`, `ENCRYPTION_KEY`) и роли кластера (`pilingtrack_app`,
   `pilingtrack_identity`) **в дамп не попадают** (`docs/runbooks/010-restore-drill.md:187-190`);
   без `ENCRYPTION_KEY` зашифрованные поля базы не прочитать.

Итог по серьёзности: **критично — 5**, **важно — 8**, **мелочь — 5**.

## Методика

- `git rev-parse HEAD`, `git status --short`, `git branch --show-current`.
- Файловый поиск: `search_files target=files pattern='backup|restore|pg_dump|pg_restore|minio|S3|snapshot'`.
- Текстовый поиск по репозиторию: `backup|restore|pg_dump|pg_restore`, `backup_monitoring_enabled|backup_last_success_available|backup_s3_synced|backup_age_hours`,
  `rclone.*media|media.*rclone|s3 sync|mc mirror|minio.*backup|backup.*media`, `refresh-prod-snapshot`, `app-role-grants`.
- Прочитаны целиком/фрагментами (с полным путём):
  `scripts/backup-postgres.sh`, `scripts/backup.sh`, `scripts/restore.sh`,
  `scripts/restore-drill.sh`, `scripts/restore-drill-verify.cjs`, `scripts/db-drill-manifest.cjs`,
  `scripts/test-db-dump.cjs`, `scripts/pitr-basebackup.sh`, `scripts/refresh-prod-snapshot.sh`,
  `scripts/backup-local-db.ps1`, `scripts/Dockerfile.backup`, `scripts/app-role-grants.sql`,
  `src/core/observability/health-tracker/checkers/backup.ts`, `.../thresholds.ts`,
  `observability/prometheus/alerts.yml` (секция backup), `docker-compose.yml`,
  `docker-compose.prod.yml`, `deploy/systemd/pilingtrack-backup.{service,timer}`,
  `deploy/systemd/pilingtrack-pitr-basebackup.{service,timer}`,
  `docs/runbooks/006-postgres-backup-restore.md`, `009-pitr-restore.md`,
  `010-restore-drill.md`, `013-prod-timers.md`, `015-disposable-integration-restore.md`,
  `docs/deployment.md`, `tests/integration/disposable-restore.spec.ts`,
  `src/core/observability/__tests__/backup-redis-keys.test.ts`.
- Как перезапустить: `rg -n "backup|restore" scripts/ src/core/observability/ deploy/ docs/runbooks/`.

## Контуры резервного копирования и их проверка

Таблица «объект | файл:строка | проверка | риск».

| Объект | Файл:строка | Проверка | Риск |
|---|---|---|---|
| Ночной логический дамп БД (прод) | `scripts/backup-postgres.sh:47-56` | только `[ ! -s "$OUT" ]` (непустой файл) | Критично: обрезанный/мусорный дамп ненулевого размера признаётся успешным; узнаем при аварии |
| Off-site копия дампа в R2 | `scripts/backup-postgres.sh:107-128` | успех/неуспех `rclone copy`; сбой = warning, код возврата не меняется (`:126`) | Важно: сбой off-site не валит задание; состояние видно только через Redis-ключ `s3_synced` |
| Проверка восстановимости ночного дампа | `scripts/backup-postgres.sh:47-56` (нет шага restore) | НЕ выполняется | Критично: восстановление не проверяется автоматически на боевом дампе |
| Недельный `pg_basebackup` (PITR-снимок) | `scripts/pitr-basebackup.sh:64-73` | только `[ ! -s "$OUT" ]`; `pg_verifybackup` отсутствует | Важно: битый архив считается успехом; хранится на том же сервере |
| Чистка WAL после base-бэкапа | `scripts/pitr-basebackup.sh:88-104` | `pg_archivecleanup` | Мелочь: при `archive_mode=off` архив пуст — шаг фактически no-op (`docker-compose.prod.yml:101`) |
| Health-метка бэкапа | `src/core/observability/health-tracker/checkers/backup.ts:89-99` | читает `system:backup:last_timestamp` | Возраст дампа отражает **только** ночной дамп, не basebackup |
| Алерты о бэкапе | `observability/prometheus/alerts.yml:374-416` | `BackupMissing/Stale/Critical/OffsiteBackupNotSynced` | Все гейтятся `backup_monitoring_enabled == 1`; при пустом `BACKUP_ENABLED` молчат |
| Медиа (фото, сканы) `media/` | `scripts/backup-postgres.sh:122` (копируется только `db-backups/`) | НЕТ никакой копии | Критично: потеря бакета/тома = необратимая потеря доказательной базы |
| Винчестер MinIO (том `minio_data`) | `docker-compose.yml:403-417`, `:443-448` | НЕТ копии тома | Важно (локально/стенд): том не резервируется |
| Локальный dev-дамп | `scripts/backup-local-db.ps1:1-47` | непустой файл, ротация 10 | Мелочь: dev-контур, не прод |

## Как/с какой частотой проверяется восстановление

| Контур | Файл:строка | Частота | Кем/чем |
|---|---|---|---|
| Ручное учение из прод-дампа | `docs/runbooks/010-restore-drill.md:6-7` | **раз в квартал** или после правки схемы бэкапа | вручную, владелец/Claude |
| Ручной smoke (не трогая прод) | `docs/runbooks/006-postgres-backup-restore.md:123-154` | «рекомендуется ежеквартально» (`:153`) | вручную |
| Автоматический контур | `scripts/restore-drill.sh:1-40` | **по расписанию не запускается** | только тест `tests/integration/disposable-restore.spec.ts:48` |
| PITR smoke | `docs/runbooks/009-pitr-restore.md:104-166` | «MUST do at setup» | вручную; сейчас неприменим (`:12`) |

## Находки

| # | severity | path:line | Проблема | Сценарий / чем важно | Как чинить |
|---|---|---|---|---|---|
| 1 | критично | `scripts/backup-postgres.sh:51-56` | Дамп проверяется только `[ ! -s "$OUT" ]` — нет `pg_restore -l`, нет sha256 | gzip дописал мусор или дамп оборван при копировании/остановке при ненулевом размере → задание «✓», а восстановление упадёт в момент аварии | после записи: `docker … pg_restore -l "$OUT" >/dev/null` и sha256 в Redis-метаданные; при провале — ненулевой код |
| 2 | критично | `scripts/backup-postgres.sh:122`; `src/core/media/media-content.ts:161-175` | `rclone copy` уносит только `db-backups/`; префикс `media/` не копирует ни один скрипт/таймер | Сбой/порча/человеческая ошибка в бакете → фотографии и сканы исчезают необратимо; строки `Media` остаются, указывая на несуществующие файлы | завести ночную `rclone copy media/` в отдельный бакет + метрика/алерт свежести |
| 3 | критично | `src/core/observability/health-tracker/checkers/backup.ts:29-31`, `:85-86`, `:94-98`; `scripts/backup-postgres.sh:23,41` | Файловый фолбэк ищет `$BACKUP_DIR/daily/*.dump`; прод пишет `/var/backups/pilingtrack/*.sql.gz` (без `daily`, другое расширение) | При отсутствии Redis-метки фолбэк всегда пуст → статус `missing` вместо реального возраста; «зелёный» health ничего не подтверждает | выровнять каталог/маску фолбэка под прод (`*.sql.gz` в `BACKUP_DIR`) или убрать фолбэк |
| 4 | критично | `scripts/restore.sh:195-203`, `:212-235`; `docs/runbooks/006-postgres-backup-restore.md:107-109` | Восстановление идёт `--no-owner --no-privileges` (выбрасывает все `GRANT`), а `verify_restore` печатает «Verification OK», считая только таблицы/строки | В аварии база «восстановлена», `count(*)` сходятся, приложение получает `permission denied`; отладка грантов под нагрузкой. Замер: `docs/runbooks/010-restore-drill.md:92-99` (грантов 320→0) | обязательный шаг `psql … < scripts/app-role-grants.sql` (+ при необходимости `identity-role-grants.sql`) после restore, плюс проверка `role_table_grants > 0` |
| 5 | критично | `scripts/backup-postgres.sh:98-103` | Fallback: если `BACKUP_S3_*` не заданы, off-site-копия идёт ключами приложения (`S3_*`) — тот же бакет/токен, что `media/` | Утёкший/отозванный/ротированный ключ приложения уносит и дампы: копия off-site, но не off-credential — отказ коррелирован | в проде выставить отдельные `BACKUP_S3_*` (свой бакет/токен) — задокументировано в шапке скрипта (`:68-74`) |
| 6 | важно | `scripts/pitr-basebackup.sh:9-14` vs `docker-compose.prod.yml:101`; `docs/runbooks/009-pitr-restore.md:12-26` | Шапка скрипта обещает «point-in-time recovery to any second», а `archive_mode=off` — посeкундного восстановления нет | Читающий рассчитывает на PITR, которого нет; недельный снимок не является «точкой на любую секунду» | исправить формулировку; либо включить `archive_mode=on` + рабочий `archive_command` |
| 7 | важно | `scripts/pitr-basebackup.sh:64-73` | Base backup проверяется только `[ ! -s ]`; `pg_verifybackup` нет; хранится на том же сервере | Гибель/арест VPS теряет и базовый снимок, и ночные дампы (`docs/runbooks/009-pitr-restore.md:236-239`); битый архив числится успехом | `pg_verifybackup` + off-site копия тем же `rclone` |
| 8 | важно | `scripts/backup.sh:127-140`; `:233` | `verify_backup` = `pg_restore -l -d pilingtrack_verify` (list-режим, БД не нужна), при неудаче только `WARNING`, `main` код не проверяет | «Проверка бэкапа» как шаг есть де-юре, нет де-факто | либо реальное восстановление в temp-БД, либо честно назвать шаг «listing» |
| 9 | важно | `src/core/observability/health-tracker/checkers/backup.ts:17-21`, `:78-80`; `docker-compose.yml:129`; `observability/prometheus/alerts.yml:375,386,397,409` | Пустой `BACKUP_ENABLED` → `{status:'up', source:'disabled'}` без возраста; все алерты бэкапа требуют `backup_monitoring_enabled==1` | Одна невыставленная переменная в `.env` полностью выключает и метрики, и алерты: панель «зелёная», копий может не быть | сделать `BACKUP_ENABLED` обязательным в проде/дефолт `on` (+ `scripts/validate-env.ts` уже предупреждает) |
| 10 | важно | `scripts/restore-drill.sh:5-15`; `scripts/test-db-dump.cjs:12-14` | Автоматическое учение требует дамп+manifest, создаваемый только на `codex_test`-контейнере; боевой дамп такой контур не проходит и по расписанию `restore-drill.sh` не запускается | Самый ценный контур (sha256+manifest+RLS-сверка) не применяется к реальному прод-дампу; восстановление боевой копии проверяют только вручную | таймер/шаг в CI, восстанавливающий свежий прод-дамп; либо явно признать ручной квартал достаточным |
| 11 | важно | `docs/runbooks/010-restore-drill.md:187-190` | Дамп НЕ содержит роли кластера и секреты `.env` (`ENCRYPTION_KEY`, `SESSION_SECRET`, ключи R2/S3, Telegram) | После потери сервера без копии `.env` зашифрованные поля базы не прочитать, роли не поднять — база восстановлена, приложение нет | хранить копию `.env` вне сервера (менеджер паролей) + скрипт создания ролей кластера |
| 12 | важно | `scripts/refresh-prod-snapshot.sh:11,13,20` | Боевой IP `87.242.102.125` и ключ `~/.ssh/orionpiling` зашиты константами; `StrictHostKeyChecking=no`; полный дамп прода кладётся в локальную БД `pilingtrack_prod_copy` | Смена адреса сервера ломает скрипт молча; снятие защиты проверки хоста упрощает MITM при скачивании боевых данных | брать хост из env/аргумента, не отключать проверку хоста, ограничить доступ к локальной копии боевых данных |
| 13 | важно | `docs/deployment.md:53-60`, `:160`; `docker-compose.yml:403-417` | Доки описывают MinIO как хранилище фото/PDF; том `minio_data` не резервируется; при этом runbook 006/010 говорят, что прод пишет в R2 | Оценка риска зависит от того, где реально лежит прод; для MinIO-развёртывания том — единственная копия | определить фактическое хранилище прода; для MinIO — отдельная копия тома/бакета |
| 14 | мелочь | `scripts/restore-drill.sh:25-26` | `docker run` без `--network none`; образ `postgres:16`, тогда как прод `postgres:18-alpine` (`docker-compose.yml:345`) | Одноразовый контейнер на общей сети; проверка RLS/restore на мажорно другой версии PG | `--network none`; выровнять версию на `postgres:18-alpine` |
| 15 | мелочь | `scripts/backup.sh:94-97` vs `scripts/backup-postgres.sh:161` | Два «писателя» ключа `last_size`: legacy пишет человекочитаемый размер (`du -h`), прод — байты (`stat -c %s`) | Один и тот же Redis-ключ в двух форматах — метрика/дашборд непредсказуемы, если legacy запустят на хосте | оставить один формат либо не запускать legacy на хосте (таймер указывает на `backup-postgres.sh`, `docs/runbooks/013-prod-timers.md:98-105`) |
| 16 | мелочь | `docs/runbooks/006-postgres-backup-restore.md:5-6` | SLA «Restore < 30 min» заявлен как факт; для боевой базы RTO не измерен (`:141-160`) | Ложное обещание вводит в заблуждение при аварии | пометить как цель, а не факт; сослаться на `docs/runbooks/010-restore-drill.md:136-160` |
| 17 | мелочь | `scripts/restore.sh:205` | Опирается на `${PIPESTATUS[0]}` при `set -euo pipefail`: сам `pg_restore`, завершившийся с ошибкой, не прерывает скрипт (warning) | Восстановление с ошибками продолжает шаги и печатает «SUCCESSFULLY» (`:241`) | проверять код `pg_restore` и падать при ошибке, либо явно помечать «с предупреждениями» |
| 18 | мелочь | `scripts/backup-local-db.ps1:32-34` | Dev-дамп без проверки результата `pg_dump`/`docker cp` (нет `$LASTEXITCODE`) | Пустой/битый локальный дамп запишется как успешный и вытеснит рабочую копию ротацией | проверять `$LASTEXITCODE` и размер перед записью/ротацией |

## Что не входит в резервную копию (важно держать отдельно)

| Объект | Где живёт | Файл:строка | Статус |
|---|---|---|---|
| Фото/сканы/PDF | бакет `media/` (R2 или MinIO) | `src/core/media/media-content.ts:161-175`; `scripts/backup-postgres.sh:122` | НЕ ПРОВЕРЕНО (копии нет — по коду) |
| Секреты `.env` (`ENCRYPTION_KEY`, `SESSION_SECRET`, ключи R2/S3, Telegram) | сервер | `docs/runbooks/010-restore-drill.md:189` | ПРОЙДЕНО (задокументировано, что не в дампе) |
| Роли кластера `pilingtrack_app`/`pilingtrack_identity` | кластер PG | `docs/runbooks/010-restore-drill.md:188`; `scripts/app-role-grants.sql:64-74` | ПРОЙДЕНО (создаются скриптом, но не дампом) |
| WAL-архив (PITR) | `/opt/pilingtrack/wal-archive` | `docker-compose.prod.yml:101`; `docs/runbooks/009-pitr-restore.md:12` | ПРОЙДЕНО (`archive_mode=off`, архив пуст) |
| Том MinIO `minio_data` | сервер | `docker-compose.yml:443-448` | НЕ ПРОВЕРЕНО (копии тома нет) |

## Что не проверено

- Реальное состояние боевого сервера (какие таймеры включены, что в `.env`): по AGENTS.md
  чтение `.env` и доступ к проду запрещены. Всё о проде — по репозиторию/ранбукам, статус ГИПОТЕЗА.
- Существует ли на сервере копирование медиа вне репозитория (например, вручную/панелью R2):
  по репозиторию копии `media/` нет (поиск `rclone.*media|mc mirror|s3 sync|backup.*media`
  совпал только с дампами БД, комментариями и чужими отчётами). На сервере не проверялось.
- Где фактически хранится прод — MinIO (`docs/deployment.md:53-60`) или R2
  (`docs/runbooks/006-postgres-backup-restore.md:41-47`): доки расходятся, живой прод не читался.
- Реальные цифры RPO/RTO для боевой базы: в `docs/runbooks/010-restore-drill.md:136-160`
  RTO ≈ 11 с получен на стенде 22 МБ; на боевой базе не измерялся.
- Срабатывание алертов на живом Prometheus (`backup_*`) — по коду зависит от `BACKUP_ENABLED`;
  фактическое значение переменной в проде не проверялось.
- Идемпотентность/успешность `scripts/app-role-grants.sql` на боевой БД после restore —
  скрипт читался, но не выполнялся (только чтение, прод запрещён).
