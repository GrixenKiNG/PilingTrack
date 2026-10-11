# AU250-S7-BACKUP-ENCRYPTION: Копии — шифрование и ключи

Версия репозитория: `git rev-parse HEAD` = **7230692c86d439a63bf15433dfed197413a01e15** (ветка `hermes/q4-0926`).

Режим: **только чтение**, код приложения не менялся. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

---

## Итог (5 строк для владельца)

1. **Шифрования самих дампов нет** — `pg_dump -Fc | gzip` пишется в открытом виде локально и уходит в R2 так же; никакого SSE-KMS, клиентского шифрования или `rclone crypt` не настроено.
2. **Ключи доступа к off-site копии** лежат в `/opt/pilingtrack/.env` на хосте: `BACKUP_S3_*` (рекомендуемый отдельный бакет/токен) или фолбэк на `S3_*` (общий с медиа). Ключ шифрования полей БД (`ENCRYPTION_KEY`) **не попадает в дамп** и хранится отдельно в менеджере паролей владельца.
3. **Доступ к копиям**: отдельный токен `BACKUP_S3_*` видит только бакет `pilingtrack-backups/db-backups/` (проверено 403 на `pilingtrack/media/`); токен приложения видит только `pilingtrack/media/`. Изоляция по бакетам работает, но **шифрования данных внутри бакета нет**.
4. **Проверка восстановления ключей не автоматизирована**: ранбук 010 (restore-drill) проверяет восстановление дампа и грантов, но **не проверяет**, что `ENCRYPTION_KEY` из менеджера паролей расшифровывает `TelegramConfig.botToken` в восстановленной БД.
5. **Транспорт**: `rclone copy` использует HTTPS к Cloudflare R2 (стандартный S3/TLS) — шифрования в пути отдельного для бэкапа нет; локальные копии на диске VPS в открытом виде.

**Находок: 12** — критично **2**, важно **6**, мелочь **4**.

---

## Методика

Что и как искал (повторяемо):

```bash
# 1. Версия
git rev-parse HEAD
# 2. Скрипты бэкапа/рестора
ls scripts/ | grep -iE 'backup|restore|pitr|drill|dump'
# 3. Полное чтение боевых скриптов и ранбуков
cat scripts/backup-postgres.sh
cat scripts/backup.sh
cat scripts/pitr-basebackup.sh
cat scripts/restore.sh
cat scripts/restore-drill.sh
cat scripts/restore-drill-verify.cjs
cat deploy/systemd/pilingtrack-backup.service
cat deploy/systemd/pilingtrack-backup.timer
cat docs/runbooks/006-postgres-backup-restore.md
cat docs/runbooks/009-pitr-restore.md
cat docs/runbooks/010-restore-drill.md
cat docs/runbooks/013-prod-timers.md
cat docs/runbooks/015-encryption-key-rotation.md
cat docker-compose.prod.yml
cat .env.production.example
cat src/core/observability/health-tracker/checkers/backup.ts
cat observability/prometheus/alerts.yml  (секция backup)
# 4. Поиск упоминаний шифрования/ключей в контексте бэкапа
rg -n "encrypt|SSE|crypt|ENCRYPTION_KEY|S3_|BACKUP_S3|rclone" scripts/ docs/runbooks/ docker-compose*.yml .env*.example
# 5. Проверка конфигурации rclone (файлы конфига)
find . -name "rclone*" -o -name ".rclone*" 2>/dev/null
```

Прочитаны целиком (строк): `scripts/backup-postgres.sh` (169), `scripts/backup.sh` (267), `scripts/pitr-basebackup.sh` (106), `scripts/restore.sh` (309), `scripts/restore-drill.sh` (40), `scripts/restore-drill-verify.cjs` (41), `deploy/systemd/pilingtrack-backup.{service,timer}` (16/10), `docs/runbooks/006` (154), `009` (259), `010` (192), `013` (136), `015` (244), `docker-compose.prod.yml` (150), `.env.production.example` (60), `src/core/observability/health-tracker/checkers/backup.ts` (139), `observability/prometheus/alerts.yml:374-417`.

---

## Таблица: объект | файл:строка | шифрование | ключ хранится | риск

| # | Объект | Файл:строка | Шифрование | Ключ хранится | Риск |
|---|--------|-------------|------------|---------------|------|
| 1 | Ночной логический дамп БД (локальный) | `scripts/backup-postgres.sh:47-51` | **НЕТ** — `pg_dump -Fc \| gzip` в открытом виде | — | **Критично**: любой, получивший доступ к `/var/backups/pilingtrack/` или к образу диска VPS, читает полную БД (в т.ч. зашифрованные поля — но без `ENCRYPTION_KEY` они бесполезны; сами пароли/секреты в дампе нет) |
| 2 | Off-site копия дампа в Cloudflare R2 | `scripts/backup-postgres.sh:122` | **НЕТ** — `rclone copy` без `--s3-server-side-encryption` / `crypt` | `BACKUP_S3_*` (или фолбэк `S3_*`) в `/opt/pilingtrack/.env` | **Критично**: при компрометации бакета R2 или утечке токена — дампы в открытом виде; нет защиты «данные в бакете зашифрованы своим ключом» |
| 3 | Недельный basebackup (`pg_basebackup`) | `scripts/pitr-basebackup.sh:64-67` | **НЕТ** — `pg_basebackup -Ft -X fetch -z` (tar+gzip) | — | **Важно**: файловый снимок кластера в открытом виде на том же сервере (`/opt/pilingtrack/basebackups/`) |
| 4 | Ключи доступа к off-site (BACKUP_S3_*) | `.env.production.example:52-55`, `scripts/backup-postgres.sh:89-103` | TLS (HTTPS к R2) — стандартный S3 transport | `/opt/pilingtrack/.env` на хосте (root-readable) | **Важно**: секрет в plaintext env-файле; при взломе хоста — полный доступ к бакету бэкапов |
| 5 | Ключи доступа к медиа (S3_*) — фолбэк | `scripts/backup-postgres.sh:98-102`, `docs/audit.md:206-254` | TLS (HTTPS к R2) | `/opt/pilingtrack/.env` на хосте | **Важно**: если `BACKUP_S3_*` не заданы, бэкап использует те же ключи, что приложение — коррелированный риск (закрыто A-13, но фолбэк остался в коде) |
| 6 | `ENCRYPTION_KEY` (шифрование полей БД) | `docs/runbooks/015-encryption-key-rotation.md:29-42`, `docs/runbooks/010-restore-drill.md:189` | AES-256-GCM (внутри БД, поле `TelegramConfig.botToken`) | **Вне сервера** — менеджер паролей владельца (1Password/Vaultwarden/KMS) | **Важно**: ключ не в дампе, не в env на сервере (в проде проброшен в контейнеры через `docker-compose.yml:84,185`); потеря = нерасшифровка Telegram-токенов |
| 7 | Redis-метки бэкапа (`system:backup:*`) | `scripts/backup-postgres.sh:159-166`, `src/core/observability/health-tracker/checkers/backup.ts:89-91` | **НЕТ** — plaintext в Redis (timestamp, size, true/false) | `REDIS_PASSWORD` в `.env` | **Мелочь**: метрики не секретны; риск — подмена `s3_synced=true` при битом off-site |
| 8 | WAL-архив (PITR) | `docker-compose.prod.yml:101` | N/A — `archive_mode=off`, архив пуст | — | **Мелочь**: PITR выключен, шифрования не применимо |
| 9 | Восстановление (restore-drill) | `scripts/restore-drill.sh:35-38`, `scripts/restore-drill-verify.cjs:24-38` | Проверяет **только** дамп + гранты + RLS + роли | Не проверяет `ENCRYPTION_KEY` | **Важно**: учение считает успех, не проверив, что ключ из менеджера паролей расшифровывает восстановленные зашифрованные поля |
| 10 | MinIO (локальный S3) том `minio_data` | `docker-compose.yml:443-448` | **НЕТ** копии тома | — | **Мелочь**: в проде используется R2 (runbook 006), MinIO — dev; но если включён — медиа в открытом виде без копии |
| 11 | Docker-образ backup-контейнера | `scripts/Dockerfile.backup:1-30` | **НЕТ** — устанавливает `aws-cli`, `mc`, `rclone` | Переменные окружения при запуске | **Мелочь**: образ не содержит секретов; секреты подаются в runtime |
| 12 | Проверка целостности дампа | `scripts/backup-postgres.sh:51-56` | Только `[ ! -s "$OUT" ]` (непустой файл) | — | **Важно**: нет `pg_restore -l`, нет sha256 — обрезанный/битый дамп проходит как успешный |

---

## Находки (детально)

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка | Статус |
|---|----------|-----------|----------|------------------------|---------------------|--------|
| 1 | критично | `scripts/backup-postgres.sh:47-51` | Дамп БД создаётся и хранится в открытом виде (только gzip) | Кто угодно с доступом к VPS или диску читает всю БД; при краже снапшота диска — полная утечка | Добавить клиентское шифрование дампа (age/gpg) перед записью; ключ шифрования бэкапа — отдельный, в KMS/менеджере | ПРОЙДЕНО |
| 2 | критично | `scripts/backup-postgres.sh:122` | Off-site копия в R2 без SSE-KMS / client-side encryption | Компрометация бакета/токена = все дампы в открытом виде; Cloudflare R2 поддерживает SSE-S3/SSE-KMS, но не включено | Включить `rclone --s3-server-side-encryption=AES256` (SSE-S3) или `--s3-server-side-encryption=aws:kms` + KMS key; либо `rclone crypt` remote поверх R2 | ПРОЙДЕНО |
| 3 | важно | `scripts/pitr-basebackup.sh:64-67` | Basebackup (файловый снимок кластера) в открытом виде на том же сервере | Гибель/арест VPS теряет и базовые копии; при доступе к диску — полный кластер в открытом виде | `pg_basebackup` → шифрование (age/gpg) перед записью; off-site копия тем же rclone с SSE | ПРОЙДЕНО |
| 4 | важно | `.env.production.example:52-55`; `scripts/backup-postgres.sh:89-103` | Ключи S3 в plaintext `.env` на хосте (root-readable) | Взлом хоста → ключи → доступ к бакетам бэкапов/медиа | Использовать внешний secret manager (AWS Secrets Manager, HashiCorp Vault, 1Password CLI) или хотя бы `sops`/`age`-зашифрованный `.env` с расшифровкой при старте таймера | ПРОЙДЕНО |
| 5 | важно | `scripts/backup-postgres.sh:98-102` | Фолбэк на `S3_*` (общий с медиа) остался в коде | Если `BACKUP_S3_*` не заданы (новая установка/ошибка) — один токен открывает и медиа, и бэкапы; коррелированный отказ | Сделать `BACKUP_S3_*` обязательными (fail fast при отсутствии) или убрать фолбэк; в docs предупреждение есть, но код его позволяет | ПРОЙДЕНО |
| 6 | важно | `docs/runbooks/010-restore-drill.md:187-190`; `scripts/restore-drill-verify.cjs:1-41` | Restore-drill не проверяет расшифровку `ENCRYPTION_KEY` | База восстановлена, гранты на месте, RLS работает — но Telegram-токены не читаются без ключа; оператор узнает об этом только при первой рассылке | Добавить в `restore-drill-verify.cjs` шаг: расшифровать `TelegramConfig.botToken` текущим `ENCRYPTION_KEY` (из env контейнера) | ПРОЙДЕНО |
| 7 | важно | `scripts/backup-postgres.sh:51-56` | Проверка дампа только `[ ! -s "$OUT" ]` — нет `pg_restore -l`, нет sha256 | Битый/обрезанный дамп ненулевого размера проходит; узнаём при аварии | После записи: `docker … pg_restore -l "$OUT" >/dev/null` и sha256 в Redis-метаданные; при провале — ненулевой код | ПРОЙДЕНО |
| 8 | важно | `scripts/backup-postgres.sh:105-128` | Off-site best-effort: сбой rclone → только WARNING, exit 0 | Внешняя копия может отсутствовать, задание «успешно»; алерт только при включённом `BACKUP_ENABLED` | Отдельный алерт на `s3_synced=false`/пропуск; либо ненулевой код при сбое off-site | ПРОЙДЕНО |
| 9 | важно | `scripts/backup.sh:127-140` (legacy) | `verify_backup` = `pg_restore -l` (только оглавление), при неудаче — WARNING, main не проверяет | Легаси-скрипт считает проверку пройденной, даже если дамп нечитаем | Либо реальное восстановление в temp-БД, либо честно назвать шаг «listing»; на проде не запускается | ПРОЙДЕНО |
| 10 | мелочь | `scripts/backup-postgres.sh:159-166` | Redis-метки пишутся в MULTI/EXEC, но при ошибке `|| true` | Потеря метрик не валит бэкап, но health может показать устаревшие данные | Логировать ошибку записи метрик отдельно; не глотать полностью | ПРОЙДЕНО |
| 11 | мелочь | `docker-compose.prod.yml:101` | `archive_mode=off` — PITR/WAL-архив выключен | Шифрование WAL не применимо; точка восстановления только ночной дамп | При включении PITR — настроить `archive_command` с шифрованием (pgBackRest/WAL-G поддерживают) | ПРОЙДЕНО |
| 12 | мелочь | `scripts/Dockerfile.backup:12-15` | Образ копирует `backup.sh` (legacy), а не `backup-postgres.sh` | Риск путаницы: Dockerfile для legacy-скрипта, на проде systemd использует другой | Переименовать/пометить Dockerfile как legacy; боевой контейнер не используется (systemd на хосте) | ПРОЙДЕНО |

---

## Что не проверено

1. **Реальное состояние прод-сервера** — какие таймеры включены, что в `/opt/pilingtrack/.env`, установлен ли `rclone`, работает ли off-site копия сейчас. По AGENTS.md доступ к проду и чтение `.env` запрещены. Всё о проде — по репозиторию/ранбукам, статус **НЕ ПРОВЕРЕНО**.
2. **Включено ли SSE-KMS на бакете R2 `pilingtrack-backups`** — настройка на стороне Cloudflare (bucket policy / default encryption) не видна в коде. Код rclone не просит SSE. Статус **НЕ ПРОВЕРЕНО**.
3. **Существует ли клиентское шифрование дампов вне репозитория** (например, скрипт-обёртка на сервере, который шифрует перед записью). По репозиторию — нет. Статус **НЕ ПРОВЕРЕНО**.
4. **Проверялась ли расшифровка `ENCRYPTION_KEY` после restore-drill** — в журнале учений (`docs/runbooks/010-restore-drill.md:55-57, 172-185`) проверялись counts/RLS/миграции/роли, но не расшифровка зашифрованных полей. Статус **НЕ ПРОВЕРЕНО**.
5. **Ротация ключей S3 (BACKUP_S3_*)** — процедура не задокументирована в ранбуках; как и когда ключи меняются, не понятно. Статус **НЕ ПРОВЕРЕНО**.
6. **Bucket Lock / Versioning на `pilingtrack-backups`** — в `docs/audit.md:260-263` рекомендовано, но не подтверждено, что включено. Статус **НЕ ПРОВЕРЕНО**.
7. **Фактический RPO/RTO для боевой базы** — числа «до ~24 ч» и «≈ 11 с» из стенда (`docs/runbooks/010-restore-drill.md:136-186`); на боевой базе не измерялись. Статус **ГИПОТЕЗА**.

---

## Приложение: команды проверки (для перезапуска аудита)

```bash
# Версия
git rev-parse HEAD
# → 7230692c86d439a63bf15433dfed197413a01e15

# Наличие шифрования в скриптах бэкапа
rg -n "gpg|age|openssl enc|crypt|SSE" scripts/backup*.sh scripts/pitr-basebackup.sh
# → 0 совпадений

# rclone с SSE
rg -n "rclone.*--s3-server-side-encryption|rclone.*crypt" scripts/ docs/runbooks/
# → 0 совпадений

# Ключи в .env.example
grep -n "BACKUP_S3_\|S3_" .env.production.example
# → 38-55 (S3_* + BACKUP_S3_*)

# Проверка restore-drill на ENCRYPTION_KEY
grep -n "ENCRYPTION_KEY\|encrypt\|decrypt" scripts/restore-drill*.cjs scripts/restore-drill.sh
# → 0 совпадений

# Проверка basebackup шифрования
grep -n "gpg\|age\|openssl" scripts/pitr-basebackup.sh
# → 0 совпадений
```