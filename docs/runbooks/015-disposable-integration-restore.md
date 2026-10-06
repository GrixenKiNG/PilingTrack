# 015 — Одноразовые интеграции и учение восстановления

Стенд работает только в новой локальной базе `codex_test`, Postgres 16,
контейнер `codex-pg-<12 hex>` с меткой `pilingtrack.codex.test-db=1`.
`test-db-up.sh` применяет все миграции через отдельную Prisma-конфигурацию,
создаёт штатные роли `pilingtrack_app` и `pilingtrack_identity` из runbook 011/012.
Пароли случайные, существуют только в окружении текущего shell. `.env` не читается.
Существующие контейнеры и базы не используются.

Из корня worktree в Bash (на Windows — Git Bash):

```bash
exports=$(bash scripts/test-db-up.sh) || exit $?
eval "$exports"
unset exports
trap 'bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER"' EXIT

# Если generated-клиента нет — генерация без стандартного prisma.config.ts/.env:
npx --no-install prisma generate --config prisma.integration.config.ts

npx --no-install vitest run --config vitest.integration.config.ts --reporter=verbose
```

Без двух переменных `INTEGRATION_DATABASE_URL_OWNER` и
`INTEGRATION_DATABASE_URL_APP` DB-наборы явно пропускаются с объяснением.
Если URL задан, но база не работает или роль неправильная, прогон падает.
Адреса принимаются только для localhost/127.0.0.1, `codex_test`, ролей
`piling` и `pilingtrack_app`. Учение также требует `INTEGRATION_DB_CONTAINER`.
Обычный `vitest.config.ts` не используется: он загружает `.env`.

## Что действительно проверяется

- Report, Site, Equipment, Inspection, Shift, AuditLog: две организации,
  доступ к своей строке, запрет чужой записи (42501), ноль строк без организации.
- Две транзакции с `set_config('app.current_tenant', ..., true)` на одном backend,
  между ними организация не сохраняется. Это контракт transaction pooling,
  а не проверка отдельного процесса PgBouncer.
- Настоящие команды `completeInspectionWithOutcome` и `projectReadinessEvent`:
  source/outbox атомарны; повтор не дублирует событие; отказ outbox и read model
  через временные DB triggers откатывает изменения. Snapshot неизменяем.
  Подменяется только подключение DB и широкие фасады на реальные узкие функции;
  записи и запросы выполняются Prisma под app-ролью.
- Proxy-заглушка старого write-pipeline удалена. Старые ожидания о наличии
  audit/idempotency в этой команде не выдаются за контракт: текущая команда
  пишет source/outbox. HTTP-авторизация, аудит маршрута и запуск смены этим
  набором не проверяются; другие отключённые наборы пока остаются.

## Дамп и восстановление вручную

Формат `backup-postgres.sh`: `pg_dump -F c | gzip`; расширение `.sql.gz`
не означает SQL-текст. Восстанавливает `gzip -dc | pg_restore`.

```bash
# С уже поднятым своим стендом. Каталог должен существовать, файл — ещё нет.
node scripts/test-db-dump.cjs "$INTEGRATION_DB_CONTAINER" /tmp/codex-drill.sql.gz
bash scripts/restore-drill.sh /tmp/codex-drill.sql.gz
```

Первый скрипт создаёт рядом `*.manifest.json`. Количества строк всех public
таблиц, журнал миграций и `pg_dump --snapshot` относятся к одному exported
repeatable-read snapshot. Manifest привязан к сжатому дампу SHA-256.
Ввод не перезаписывается; при слишком большом тестовом дампе (>64 MiB до gzip)
скрипт прекращает работу. Это ограничение синтетического генератора, не restore.

Restore всегда создаёт новый контейнер без опубликованных портов. Использует
`--no-owner --no-acl --exit-on-error --single-transaction`, затем накатывает
штатные гранты: роли в дамп одной базы не входят. Сверяет counts всех таблиц,
имена/checksum/состояния миграций, ENABLE/FORCE RLS, определения политик и роли;
app без организации должен видеть ноль строк в шести ключевых таблицах.
Контейнер и его анонимный volume удаляются через EXIT trap и проверку метки.
Нельзя передать свой target URL или имя существующей базы.

`disposable-restore.spec.ts` сеет две организации, проверяет исходные/восстановленные
counts=2 на всех шести таблицах, затем подменяет один count в manifest и требует
падения проверки. После успеха и ошибки список наших помеченных контейнеров
должен совпасть с исходным. Дамп/manifest удаляются из временной папки.

Для внешнего дампа нужен доверенный manifest исходного snapshot в том же формате.
Без него скрипт отказывается объявлять равенство исходных данных. Сбор manifest
на production этим инструментом не предусмотрен и этой задачей не разрешён.
Синтетический успех не доказывает свежесть production backup, скачивание offsite,
целостность медиа, наличие эксплуатационных секретов или полный RTO сервиса.
Учение 27.09.2026 в runbook 010 остаётся отдельным историческим доказательством.
