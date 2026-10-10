# AU137-S7-BACKUP-RESTORE-SCRIPTS — скрипты резервного копирования и восстановления

Версия репозитория: `git rev-parse HEAD` = `ad69815a690c46959cb9cc23a5d4dac8c978121f`
(ветка `hermes/q4-0926`). Скрипты **не запускались** — только чтение кода и ранбуков.
Frozen-зоны (operator/ORION) не затрагивались.

## Итог

Аудит читал: `scripts/backup.sh`, `scripts/backup-postgres.sh`, `scripts/pitr-basebackup.sh`,
`scripts/restore.sh`, `scripts/restore-drill.sh`, `scripts/restore-drill-verify.cjs`,
`scripts/backup-local-db.ps1`, `scripts/test-db-dump.cjs`, `scripts/db-drill-manifest.cjs`,
`scripts/test-db-down.sh`, `scripts/Dockerfile.backup`, `deploy/systemd/pilingtrack-{backup,pitr-basebackup}.{service,timer}`,
`docs/runbooks/006`, `009`, `010`, `011`, `013`, `015`, `docs/deployment.md`, `docker-compose.prod.yml`,
`src/core/observability/health-tracker/checkers/backup.ts`.

Находок: **26** — критично **2**, важно **11**, мелочь **13**.

Резюме для владельца (5 строк):
1. Боевой ночной дамп (`scripts/backup-postgres.sh:47-56`) проверяется только на «файл не пустой» — ни `pg_restore -l`, ни sha256; обрезанная копия пройдёт как успешная, узнаем в аварии.
2. Официальная процедура восстановления (`docs/runbooks/006:107-109`, `scripts/restore.sh:195-209`) стирает все GRANT'ы роли `pilingtrack_app`, а `verify_restore` (`scripts/restore.sh:212-236`) печатает «Verification OK», посчитав только таблицы и строки → база «восстановлена», приложение не подключается.
3. Легаси `scripts/backup.sh` и `scripts/restore.sh` проверяют результат не той команды в конвейере (`$?` после `| tee`/`| tail`, строки `:85`, `:209`, `:173`).
4. Ни один скрипт и ни один systemd-юнит бэкапа не уведомляет о сбое: нет `OnFailure=`, Telegram/почты; максимум — warning в journalctl и best-effort метки в Redis.
5. Недельный `pg_basebackup` (`scripts/pitr-basebackup.sh`) не проверяется (`pg_verifybackup` нет), лежит на том же сервере, а шаг чистки WAL — no-op при `archive_mode=off`.

## Методика

Что искали и как (можно повторить):

```
rg -n "pg_restore|pg_dump|pg_basebackup|restore-drill" --glob '*.{sh,ps1,cjs,ts,md,yml}'
rg -n "telegram|TELEGRAM|curl |mail|notify|OnFailure|webhook" scripts/
rg -n "backup-postgres|pitr-basebackup|restore-drill\.sh|backup\.sh|restore\.sh|backup-local-db" .
ls -1 scripts/ ; ls -1 deploy/systemd/ ; ls -1 docs/runbooks/
grep -rn "archive_mode|archive_command|wal-archive" docker-compose*.yml
```

Читалось полностью (число строк): `scripts/backup.sh` (267), `scripts/backup-postgres.sh` (169),
`scripts/pitr-basebackup.sh` (106), `scripts/restore.sh` (309), `scripts/restore-drill.sh` (40),
`scripts/restore-drill-verify.cjs` (41), `scripts/backup-local-db.ps1` (47), `scripts/Dockerfile.backup` (30),
`scripts/db-drill-manifest.cjs` (16), `scripts/test-db-dump.cjs` (31), `scripts/test-db-down.sh` (13),
`deploy/systemd/pilingtrack-backup.{service,timer}` (16/10), `deploy/systemd/pilingtrack-pitr-basebackup.{service,timer}` (16/12),
`docs/runbooks/006` (154), `009` (259), `010` (192), `011` (306), `013` (136), `015` (83).

Существующие отчёты в `docs/audits/` и `CODEX-REPORT*`, `docs/strategy` **не читались** (запрет задачи);
всё в таблице «Находки» подтверждено строками перечисленных выше файлов.

Статусы в таблице: **ПРОЙДЕНО** — подтверждено чтением файла (есть `path:line`);
**ГИПОТЕЗА** — вывод о поведении, требующий запуска или доступа на прод; **НЕ ПРОВЕРЕНО** — не открывал.

---

## Таблица шагов: команда / проверка успеха / что при сбое / уведомление

### `scripts/backup-postgres.sh` (боевой, таймер `deploy/systemd/pilingtrack-backup.timer:5` 03:30 МСК)

| шаг | команда | проверка успеха | что при сбое | уведомление |
|---|---|---|---|---|
| проверка env | `[ -f "$ENV_FILE" ]` (`scripts/backup-postgres.sh:28`) | «есть/нет», иначе `exit 1` (`:29-31`) | явный отказ | нет |
| чтение имени БД/юзера | `grep … cut` (`:34-35`) | **нет** (пустое → дефолт `pilingtrack_test`, `:37`) | дамп не той/отсутствующей БД | нет |
| сам дамп | `docker compose exec -T postgres pg_dump -F c … \| gzip > "$OUT"` (`:47-49`) | `[ ! -s "$OUT" ]` — «не пустой» (`:52`) | **обрезанный/битый дамп проходит**; `-` пустой → `rm -f`, `exit 1` (`:53-56`) | нет |
| ретенция | `find … -mtime +30 -delete` (`:59`) | **нет** | удаление истории без проверки свежей копии | нет |
| off-site | `rclone copy "$OUT" R2:…/db-backups/` (`:122`) | код возврата rclone (`if`) | только `WARNING` (`:126`), exit 0 | нет (флаг `s3_synced=false` в Redis, если задан пароль) |
| метки Redis | `MULTI/SET×3/EXEC` (`:159-166`) | **нет** (`\|\| true`, `:166`) | метрики свежести молча пропадают | гейт `BACKUP_ENABLED` (`checkers/backup.ts:17-21`); при выключенном — `source:'disabled'` |

### `scripts/backup.sh` (legacy; образ `scripts/Dockerfile.backup:12`, на бою не запускается — `docs/runbooks/013:103-105`)

| шаг | команда | проверка успеха | что при сбое | уведомление |
|---|---|---|---|---|
| связь с БД | `pg_isready` (`:63`) | ненулевой код → `exit 1` (`:64-66`) | явный отказ | нет |
| дамп | `pg_dump … \| tee log` (`:73-83`) | `if [ $? -eq 0 ]` (`:85`) — **`$?` от `tee`, не от pg_dump** | с `set -euo pipefail` (`:13`) выход по коду pg_dump; ветка `else` (`:99-102`) недостижима | нет |
| проверка дампа | `pg_restore -l -d pilingtrack_verify` (`:130-135`) | только чтение оглавления, БД не нужна | `WARNING` (`:138`), код возврата скрипта не меняется | нет |
| off-site | `aws s3 cp` / `mc cp` (`:163/:173`) | код возврата CLI | `WARNING` (`:170/:179`), exit 0 | нет |
| метки Redis | 3 отдельных `redis-cli SET` (`:95-97`) | **нет** | пишет в `$REDIS_URL` (переменная не задана в скрипте), не атомарно | по гейту health |
| ретенция | `find … -delete`, `cp` в weekly/monthly (`:109-124`) | **нет** | удаление старых копий | нет |

### `scripts/pitr-basebackup.sh` (таймер воскресенье 04:00 — `deploy/systemd/pilingtrack-pitr-basebackup.timer:7`)

| шаг | команда | проверка успеха | что при сбое | уведомление |
|---|---|---|---|---|
| связь/env | `[ -f "$ENV_FILE" ]` (`:39`) | `exit 1` (`:40-42`) | явный отказ | нет |
| base backup | `pg_basebackup … -D - \| > "$OUT"` (`:64-67`) | `[ ! -s "$OUT" ]` (`:69`) — только «не пустой» | пустой → `rm -f`, `exit 1` (`:70-72`) | нет |
| ретенция | `ls \| sort \| tail`, `rm -f` (`:80-86`) | **нет** | удаление старых base-архивов | нет |
| чистка WAL | `pg_archivecleanup /var/lib/postgresql/wal-archive` (`:101-102`) | **нет** (`\|\| true`) | при `archive_mode=off` — no-op; каталог пуст | нет |

### `scripts/restore.sh` (восстановление в НОВУЮ БД `${DB_NAME}_restore_<ts>`, боевая не трогается)

| шаг | команда | проверка успеха | что при сбое | уведомление |
|---|---|---|---|---|
| связь | `pg_isready` (`:87`) | `error` → `exit 1` (`:88`) | явный отказ | нет |
| скачать из S3 | `aws s3 cp`/`mc cp` (`:104-114`) | код возврата | `error` → `exit 1` | нет |
| валидация | `pg_restore -l` (`:131`) | непустое оглавление | `error`, но `table_count` — только лог (`:137-139`) | нет |
| pre-restore дамп | `pg_dump … \| tail -5` (`:162-171`) | `if [ $? -eq 0 ]` (`:173`) — **`$?` от `tail`** | ошибки pg_dump скрыты `tail` | нет |
| восстановление | `pg_restore … --no-owner --no-privileges \| tail -20` (`:195-203`) | `${PIPESTATUS[0]}` (`:205`) — **корректно** | `WARNING … with warnings` (`:206`), exit 0 | нет |
| проверка | «таблица есть + count ключевых таблиц» (`:217-233`), «Verification OK» (`:235`) | count>0 | **GRANT'ы не проверяются** → «OK» на базе без прав | нет |

### `scripts/restore-drill.sh` + `scripts/restore-drill-verify.cjs` (единственный контур с настоящей проверкой)

| шаг | команда | проверка успеха | что при сбое | уведомление |
|---|---|---|---|---|
| вход | `[[ -s dump && -s manifest ]]`, `gzip -t` (`restore-drill.sh:7-14`) | коды 64/65 | отказ до создания контейнера | нет |
| sha/manifest | `node restore-drill-verify.cjs dump manifest` (`:15`) | sha256 дампа = manifest (`verify.cjs:10-14`) | throw, exit≠0 | нет |
| подъём | `docker run … postgres:16` (`:25`) | `pg_isready` 60 попыток (`:30-34`) | `exit 1` | нет |
| восстановление | `gzip -dc \| pg_restore --exit-on-error --single-transaction` (`:35-36`) | код pg_restore | отказ | нет |
| гранты | `app-role-grants.sql`, `identity-role-grants.sql` (`:37-38`) | `ON_ERROR_STOP=1` | отказ | нет |
| сверка | counts/миграции/RLS/роли + fail-closed (`verify.cjs:24-38`) | сравнение с manifest | throw | нет |
| уборка | trap → `test-db-down.sh` по метке (`:20-23`) | метка `pilingtrack.codex.test-db=1` (`test-db-down.sh:9-12`) | — | нет |

---

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка | статус |
|---|---|---|---|---|---|---|
| 1 | критично | `scripts/backup-postgres.sh:47-56` | Дамп проверяется только `[ ! -s "$OUT" ]` — нет `pg_restore -l`, нет sha256 | gzip/GNU-часть пайплайна дописала мусор или дамп оборван при ненулевом размере → задание «успешно», алерты смотрят только на возраст (`checkers/backup.ts:105-124`) → узнаём в момент аварии | после записи: `docker … pg_restore -l "$OUT" >/dev/null` и sha256 в Redis-метаданные; при неудаче — ненулевой код | ПРОЙДЕНО |
| 2 | критично | `scripts/restore.sh:195-203,212-236`; `docs/runbooks/006-postgres-backup-restore.md:107-109` | `--no-owner --no-privileges` выбрасывает все GRANT'ы роли `pilingtrack_app`; `verify_restore` печатает «Verification OK», считая таблицы/строки | В аварии база «восстановлена», `count(*)` сходятся, приложение получает `permission denied`; отладка грантов идёт под нагрузкой. Замер в `docs/runbooks/010-restore-drill.md:92-99`: 320→0 грантов | обязательный шаг `scripts/app-role-grants.sql` + `scripts/identity-role-grants.sql` и негативный тест (пункт из `docs/runbooks/010:104-130`) в саму процедуру | ПРОЙДЕНО |
| 3 | важно | `scripts/backup.sh:85` и `scripts/backup.sh:209` | `if [ $? -eq 0 ]` после `… \| tee` проверяет код `tee`, а не `pg_dump`/`pg_restore` | Ложный «Backup/Restore completed successfully» там, где ошибку не поймал `set -e`; при `set -euo pipefail` (`:13`) ветка `else` (`:99-102`, `:217-220`) недостижима → мёртвый код | `${PIPESTATUS[0]}` (как в `scripts/restore.sh:205`) | ПРОЙДЕНО |
| 4 | важно | `scripts/restore.sh:162-173` | `pg_dump … \| tail -5` + `if [ $? -eq 0 ]` — `$?` от `tail`, вывод ошибок срезан | Сбой pre-restore бэкапа может остаться незамеченным; `error "Pre-restore backup failed"` (`:176`) не сработает | `${PIPESTATUS[0]}` + писать полный лог в файл | ПРОЙДЕНО |
| 5 | важно | `scripts/backup.sh:127-140` | `verify_backup` = `pg_restore -l … -d pilingtrack_verify`: читает оглавление (БД не нужна, `-d` бессмыслен), восстановимость не проверяет; при неудаче — только `WARNING`, `main` её не проверяет (`:233`) | «Проверка бэкапа» выглядит как шаг, которого фактически нет | реальное восстановление в temp-БД, иначе честно назвать шаг «listing» | ПРОЙДЕНО |
| 6 | важно | `scripts/backup.sh:94-98` | Метки Redis пишутся тремя отдельными `redis-cli SET` в `$REDIS_URL` (переменная в скрипте не задана/не экспортирована) | Не атомарно: свежий `last_timestamp` рядом со старым `s3_synced=true` (`docs/…` память: половина записи = ложный «успех»); возможен не тот инстанс Redis (health читает `getStateRedisClient`, `checkers/backup.ts:83`) | `MULTI/EXEC` и та же схема, что в `scripts/backup-postgres.sh:159-166` | ПРОЙДЕНО |
| 7 | важно | `scripts/backup-postgres.sh:105-128` | Off-site best-effort: сбой `rclone` → только `WARNING` (`:126`), exit 0; при отсутствии 4 ключей копия молча пропускается (`:106`) | Внешняя копия может отсутствовать, а задание числится успешным; Redis-флаг ловится алертом только при включённом гейте | отдельный алерт на `s3_synced=false`/пропуск либо ненулевой код | ПРОЙДЕНО |
| 8 | важно | `scripts/pitr-basebackup.sh:39-76` | Base backup проверяется только `[ ! -s ]`; `pg_verifybackup` нет; хранится на том же сервере | Гибель/арест VPS теряет и недельные снимки, и ночные дампы (`docs/runbooks/009:236-239`); битый архив числится успехом | `pg_verifybackup` + off-site копия (тот же rclone) | ПРОЙДЕНО |
| 9 | важно | `scripts/pitr-basebackup.sh:53-60,88-104` | Шапка утверждает «our archive_command also keeps every WAL on disk», но WAL-архивирование выключено (`docker-compose.prod.yml:101` — `archive_mode=off`); чистка WAL в этом режиме — no-op | Ложная страховка «WAL всё равно на диске»: при восстановлении после сбоя `-X fetch` станет единственным источником WAL | согласовать комментарий с фактической конфигурацией; чистку WAL пометить неприменимой при `archive_mode=off` | ПРОЙДЕНО |
| 10 | важно | `deploy/systemd/pilingtrack-backup.service:1-16`; `deploy/systemd/pilingtrack-pitr-basebackup.service:1-16` | Нет `OnFailure=`/`ExecStopPost`, нет уведомления (Telegram/почта) | Сбой задания виден только в `journalctl`, который никто не читает (`docs/runbooks/013:4-8` это признаёт); таймер не «падает громко» | `OnFailure=` на unit-уведомитель (в репо уже есть `scripts/tg-send.ts`) | ПРОЙДЕНО |
| 11 | важно | `scripts/backup-local-db.ps1:32-34` | Код возврата `docker exec … pg_dump \| gzip` не проверяется (`$ErrorActionPreference='Stop'` не ловит exit-код нативных команд в PS 5.1) | После «успеха» идёт ротация (`:39-46`), которая удалит годные старые дампы, оставив битый | проверять `$LASTEXITCODE` и не ротировать при сбое | ПРОЙДЕНО |
| 12 | важно | `scripts/backup-postgres.sh:59` | Ретенция `-mtime +30 -delete` не убеждается, что более свежая копия годна | В сочетании с №1 затяжной сбой → удаление последнего восстановимого дампа | не удалять последний/единственный дамп | ПРОЙДЕНО |
| 13 | важно | `docs/runbooks/006-postgres-backup-restore.md:86-119` | «Официальная» процедура восстановления использует `pg_restore --no-owner --no-privileges` без `--exit-on-error` и **без** наката грантов | Оператор под инцидентом по runbook 006 получит неработающее приложение; ранбук 010 (`:104-130`) знает про гранты, а 006 — нет | перенести шаг грантов в 006 и добавить `--exit-on-error` | ПРОЙДЕНО |
| 14 | важно | `docs/deployment.md:130-139` | Раздел «Backup'ы» описывает cron с другим именем (`$(date +%Y%m%d).sql.gz`), без off-site и метрик; восстановление — `pg_restore -d pilingtrack` без грантов | Документация расходится с боевым `scripts/backup-postgres.sh`, воспроизведение «по инструкции» даёт другой контур | сослаться на `scripts/backup-postgres.sh` и systemd-юнит вместо дублирующего cron | ПРОЙДЕНО |
| 15 | мелочь | `scripts/backup.sh:213-216` (и `:194-198`) | Печатает готовые `kubectl scale deployment pilingtrack-prod-api …` (Kubernetes в проекте нет) и `DROP DATABASE ${DB_NAME}` без предупреждения | Оператор под инцидентом скопирует невыполнимые/разрушительные команды вместо `docker compose` (`docs/runbooks/006:86-119`) | заменить на проектные `docker compose stop/up` | ПРОЙДЕНО |
| 16 | мелочь | `scripts/restore.sh:48-68` | `shift` внутри `for arg in "$@"` не действует: ключ `--from-s3 <key>` попадает ещё и в `RESTORE_FILE` (`:65`) | Спасает только то, что `download_from_s3` перезаписывает `RESTORE_FILE` позже (`:116`); форма `--from-s3=` работает | явный `while [ $# -gt 0 ]` с `shift` | ПРОЙДЕНО |
| 17 | мелочь | `scripts/restore.sh:205-209` | «Restore completed with warnings» трактуется как успех (exit 0) | Восстановление с ошибками проходит дальше в `verify_restore` и может доехать до «Verification OK» | при `PIPESTATUS[0]≠0` — ошибка/остановка, а не warning | ПРОЙДЕНО |
| 18 | мелочь | `scripts/backup.sh:24,36` | `export PGPASSWORD="$DB_PASSWORD"` по умолчанию пусто | На trust-конфигурации «сработает», с паролем упадёт неочевидно; `pg_isready` (`:63`) при этом может пройти | явная проверка непустого пароля/URL | ПРОЙДЕНО |
| 19 | мелочь | `scripts/backup-postgres.sh:37`; `scripts/backup-local-db.ps1:13` | При отсутствии `POSTGRES_DB` в env дефолт — `pilingtrack_test` (тестовая БД) | Опечатка/потеря строки в `.env` → дамп не той базы либо сбой | дефолт `pilingtrack` или явный отказ | ПРОЙДЕНО |
| 20 | мелочь | `scripts/backup-local-db.ps1:5` | Комментарий ссылается на `scripts\register-backup-task.ps1`, которого в репозитории нет (`ls -1 scripts/` его не содержит) | Расписание Task Scheduler не воспроизводится из репо | добавить скрипт регистрации или убрать ссылку | ПРОЙДЕНО |
| 21 | мелочь | `docs/runbooks/006-postgres-backup-restore.md:115` | Критерий «Should print 43» таблиц | Учения фиксируют 58 (`docs/runbooks/010:55`) и 84 таблицы (`docs/runbooks/010:181`) → критерий устарел и проверку не подтверждает | обновить ожидаемое число/сверять с текущей схемой | ПРОЙДЕНО |
| 22 | мелочь | `scripts/backup-postgres.sh:34-35` | `POSTGRES_USER`/`POSTGRES_DB` берутся `grep … cut` без обрезки кавычек/пробелов | Значение в кавычках в `.env` даст неверное имя БД | `tr -d '\"'`/аккуратный парсер | ПРОЙДЕНО |
| 23 | мелочь | `scripts/backup.sh:62-68`; `scripts/restore.sh:86-91` | `pg_isready` без пароля: «БД доступна» ≠ «дамп/восстановление пройдут под нужной ролью» | Ложноположительная пре-проверка | проверять конкретной ролью/можно `SELECT 1` | ПРОЙДЕНО |
| 24 | мелочь | `scripts/pitr-basebackup.sh:80-86` | Ретенция KEEP по имени (`ls\|sort\|tail`) без проверки валидности оставляемых архивов; при отсутствии файлов glob остаётся литералом | Нет `nullglob` → лог «Pruning old base: base-*.tar.gz» вводит в заблуждение (удаления нет) | `shopt -s nullglob` и проверка валидности | ПРОЙДЕНО |
| 25 | мелочь | `scripts/restore-drill.sh:25-26` | `docker run` без `--network none`; образ `postgres:16` тянется, если не закэширован | Одноразовый контейнер на общей сети хоста (хоть портов и не публикует) | `--network none` + `--pull missing` осознанно | ПРОЙДЕНО |
| 26 | мелочь | `docs/runbooks/010-restore-drill.md:20-45` | Ручная процедура драйва не фиксирует sha256 дампа (в отличие от `scripts/restore-drill.sh`+`restore-drill-verify.cjs:10`), хотя в журнале sha сверяется вручную | Драйв рукой не воспроизводит автоматический контур; sha можно пропустить | добавить шаг сверки sha256 в ручную процедуру | ПРОЙДЕНО |

Итого по категориям: проверка результата дампа — 6 находок (#1,#5,#8,#12,#24 + №3/#4 про не ту команду);
права/восстановление — 3 (#2,#13,#14); уведомления — 2 (#7,#10); легаси/доки — 15.

## Не проверено

- **Реальное поведение на проде**: что именно выполняет боевой сервер (какая версия `backup-postgres.sh`
  задеплоена, включён ли `BACKUP_ENABLED`, заданы ли `BACKUP_S3_*`, есть ли `rclone`, настроен ли `OnFailure`).
  Доступа на прод нет (запрет AGENTS.md). Всё это — **НЕ ПРОВЕРЕНО**.
- **Что `$?`-баг в `scripts/backup.sh`/`restore.sh` действительно даёт ложный успех** — ГИПОТЕЗА:
  при `set -euo pipefail` (строки `:13`/`:18`) конвейер с `pipefail` обычно валит скрипт раньше, поэтому
  фактический исход может совпасть с корректным. Чтобы утверждать ложный успех, нужен прогон со сбоем
  `pg_dump` при `set +e`. Скрипты не запускались (условие задачи).
- **Что Redis в `scripts/backup.sh:95` — не тот инстанс**: имя переменной `$REDIS_URL` в скрипте не задано;
  совпадает ли она с инстансом `getStateRedisClient()` (`checkers/backup.ts:83`) на хосте — НЕ ПРОВЕРЕНО.
- **`scripts/refresh-prod-snapshot.sh:21`** (`pg_dump … --clean --if-exists | gzip`) — родственный скрипт
  вне заявленного набора (`backup*`/`restore*`); в глубину не разбирал — НЕ ПРОВЕРЕНО.
- **`scripts/staging-local.sh`** (упомянут в `docs/runbooks/010:192` как шаг учения восстановления) —
  не читал, в таблицу шагов не включал.
- **`observability/prometheus/alerts.yml:384-416`** (пороги алертов бэкапа) — читал только по ссылкам из
  ранбуков, сам файл не открывал; число/условия алертов — НЕ ПРОВЕРЕНО.
- **Медиа/фото** (S3/R2): в дамп не входят (зафиксировано `docs/runbooks/010:190`); скриптами бэкапа
  не покрываются и не проверялись.
- **Гейт `BACKUP_ENABLED`** (`checkers/backup.ts:17-21`) — задан ли он на проде, из репозитория не следует;
  НЕ ПРОВЕРЕНО.
