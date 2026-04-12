# PostgreSQL Stage Runbook

## Назначение

Этот runbook нужен для первого контролируемого переноса данных из `SQLite` в `PostgreSQL` на stage-среде перед production rollout.

## Предусловия

- Для docker-compose удобно взять за основу `.env.docker.example`.
- Для запуска приложения вне контейнера удобно взять за основу `.env.production.example`.
- Заполнены `.env.production`, `.env.docker` или переменные окружения:
  - `DATABASE_PROVIDER=postgres`
  - `DATABASE_URL_POSTGRES`
  - `POSTGRES_DB`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `SESSION_SECRET`
- Исходная `SQLite` база доступна по `DATABASE_URL`.
- Целевая `PostgreSQL` база поднята и доступна по сети.

## Быстрый безопасный запуск

Одинарный прогон всего cutover pipeline:

```powershell
npm run stage:postgres:cutover
```

Только подготовка и dry-run без фактического переноса:

```powershell
npm run stage:postgres:cutover -- --dry-run-only
```

Если PostgreSQL уже поднят отдельно:

```powershell
npm run stage:postgres:cutover -- --skip-up
```

## Пошаговый порядок запуска

1. Подготовить окружение и проверить prerequisites:

```powershell
npm run stage:doctor
```

2. Поднять stage PostgreSQL:

```powershell
npm run stage:postgres:up
```

3. Сгенерировать Postgres Prisma client и применить схему:

```powershell
npm run db:generate:postgres
npm run db:push:postgres
```

4. Выполнить dry-run и убедиться, что целевая база пуста или вы осознанно готовы к очистке:

```powershell
npm run db:migrate:data:postgres:dry-run
```

5. Выполнить перенос данных:

```powershell
npm run db:migrate:data:postgres
```

6. Выполнить verify-проход после миграции:

```powershell
npm run db:migrate:data:postgres:verify
```

7. Только после успешной проверки запускать приложение в Postgres runtime:

```powershell
docker compose -f docker-compose.production.yml up -d app
```

## Важное различие по DATABASE_URL_POSTGRES

- Для запуска приложения на host-машине используйте host `localhost`.
- Для запуска приложения внутри docker-compose используйте host `postgres`.
- В `docker-compose.production.yml` дефолт уже настроен на контейнерный host `postgres`, чтобы app-контейнер видел БД без ручной правки.

## Что делает migration script

- Загружает данные из `SQLite`.
- Считывает текущие counts в `PostgreSQL`.
- Считает checksum по каждой таблице и общий dataset checksum.
- В режиме `dry-run` ничего не пишет.
- В обычном режиме отказывается писать в непустую цель без явного `--force-reset-target`.
- После переноса повторно сверяет counts и checksums между `SQLite` и `PostgreSQL`.

## Ограничения текущего этапа

- Скрипт рассчитан на controlled stage cutover, а не на live dual-write.
- Turbopack warning на generated Prisma runtime пока остаётся косметическим и не блокирует сборку.
- Для фактического stage-прогона на этой машине должен быть запущен Docker daemon.
