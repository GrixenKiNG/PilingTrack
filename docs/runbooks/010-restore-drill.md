# Runbook 010 — Restore-drill (репетиция восстановления из ночного дампа)

**Зачем:** бэкап, из которого никто не пробовал восстановиться, — это не бэкап.
Аудит-пункт A-1 (снимок 2026-07-17): WAL-архив на проде выключен
(`archive_mode=off`), точка восстановления = ночной logical dump. Значит сам
дамп обязан проверяться восстановлением — по этому ранбуку, **раз в квартал**
или после изменений в схеме бэкапа.

## Источники бэкапов

| Что | Где | Когда |
|---|---|---|
| Ночной дамп (pg_dump custom format, gzip) | прод `/var/backups/pilingtrack/pilingtrack-YYYYMMDD-*.sql.gz` | systemd `pilingtrack-backup.timer`, 03:33 MSK |
| Off-site копия того же дампа | Cloudflare R2, бакет `pilingtrack` | тем же таймером (проверено 2026-07-01) |
| Pre-deploy дампы | прод `/opt/pilingtrack/backups/` | вручную перед деплоями |

⚠️ Файл называется `.sql.gz`, но внутри **custom format** → восстанавливать
`pg_restore`, не `psql`.

## Процедура (локальная машина, ~5 минут)

```bash
# 1. Забрать свежий дамп с прода
scp -i $HOME/.ssh/orionpiling user1@87.242.102.125:/var/backups/pilingtrack/pilingtrack-$(date +%Y%m%d)-*.sql.gz .

# 2. Чистая БД (НЕ трогаем pilingtrack_test!)
docker exec pilingtrack-postgres psql -U postgres \
  -c 'DROP DATABASE IF EXISTS pilingtrack_drill;' \
  -c 'CREATE DATABASE pilingtrack_drill;'

# 3. Восстановить (Git Bash: MSYS_NO_PATHCONV=1)
gunzip -c pilingtrack-*.sql.gz | MSYS_NO_PATHCONV=1 docker exec -i \
  pilingtrack-postgres pg_restore -U postgres -d pilingtrack_drill \
  --no-owner --no-privileges

# 4. Проверки (сверить с известными прод-числами)
docker exec pilingtrack-postgres psql -U postgres -d pilingtrack_drill \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
  -c 'SELECT count(*) FROM "Report";' \
  -c 'SELECT count(*) FROM "Equipment";' \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;"

# 5. Убрать за собой
docker exec pilingtrack-postgres psql -U postgres -c 'DROP DATABASE pilingtrack_drill;'
```

**Критерии успеха:** pg_restore без ошибок; число таблиц соответствует схеме;
`Report`/`Equipment`/`Crew` совпадают с прод-значениями на утро дампа;
последняя запись `_prisma_migrations` = последняя задеплоенная миграция.

## Журнал драйвов

| Дата | Дамп | Результат | Время restore | Проверил |
|---|---|---|---|---|
| **2026-07-17** | `pilingtrack-20260717-033347.sql.gz` (221 KB) | ✅ Без ошибок. 58 таблиц; Report=131, Crew=8, Equipment=8, User=13, Media(equipment)=19, ModuleLayoutTemplate=7, SiteWeeklyTrend=17; last migration `20260712090000_tenant_settings` (= v2.7.0). Дамп захватил данные, загруженные накануне (фото техники, раскладки) — цикл «изменение → ночной бэкап → восстановление» подтверждён. | ~1 с (БД 16 МБ) | Claude + владелец |
| **2026-08-13** — **источник: off-site копия из R2**, а не файл с VPS | `pilingtrack-20260813-033928.sql.gz` (253 KB) | ✅ Без ошибок. Копия скачана из `R2:pilingtrack/db-backups/`, sha256 совпал с ночным дампом на VPS (`2b48de3f…`), `pg_restore --list` показал 481 объект. Восстановлено в чистую `pilingtrack_r2drill`: 58 таблиц; Report=153, Crew=8, Equipment=8, User=13, Inspection=1, MaintenanceRecord=1; last migration `20260712090000_tenant_settings`, применено 35 из 54 миграций репозитория (прод на v2.8.0). Всего в R2 44 копии, 9.85 МБ. | ~1 с | Claude |

## Ограничения (честно)

- Это **logical restore на момент 03:33** — не PITR. Всё, что записано между
  ночным дампом и аварией, теряется (RPO до ~24 ч). Включение WAL-архива —
  отдельное решение (см. docs/audit.md A-1).
- Драйв на локальном Docker-Postgres той же мажорной версии; на чужом хосте
  восстановление не репетировалось.
- ~~Off-site копию из R2 стоит проверить тем же способом~~ — сделано
  13.08.2026, см. журнал выше. Off-site копия побайтово равна ночному дампу и
  восстанавливается. Процедура проверки:

  ```bash
  # на VPS: скачать копию из R2 теми же ключами, что использует backup-postgres.sh
  ENV_FILE=/opt/pilingtrack/.env
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
         RCLONE_CONFIG_R2_REGION=auto RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(grep -E '^S3_ACCESS_KEY_ID=' $ENV_FILE | tail -1 | cut -d= -f2-)"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(grep -E '^S3_SECRET_ACCESS_KEY=' $ENV_FILE | tail -1 | cut -d= -f2-)"
  export RCLONE_CONFIG_R2_ENDPOINT="$(grep -E '^S3_ENDPOINT=' $ENV_FILE | tail -1 | cut -d= -f2-)"
  rclone lsl R2:pilingtrack/db-backups/ | tail -5
  rclone copy R2:pilingtrack/db-backups/<файл> /tmp/r2pull/
  sha256sum /tmp/r2pull/<файл> /var/backups/pilingtrack/<файл>   # должны совпасть
  ```

  Дальше — обычная процедура выше, но `scp` берёт файл из `/tmp/r2pull/`, а
  не из `/var/backups/`. Не забыть `rm -rf /tmp/r2pull` в конце.
