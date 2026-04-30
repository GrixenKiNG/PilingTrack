# Развёртывание PilingTrack в продакшен

## Минимальные требования

- Linux-сервер с **Docker** ≥ 24 и **Docker Compose v2**.
- 2 vCPU, 4 GB RAM, 20 GB SSD — старт. Масштабируется горизонтально (см. ниже).
- Открытые порты на reverse-proxy: **80** (HTTP → редирект) и **443** (HTTPS).
- Доменное имя с DNS A-записью на сервер.

Используется PostgreSQL 18 в контейнере. Если есть managed-Postgres (RDS / Yandex Cloud), лучше указать его — пропусти запуск `postgres` сервиса и пропиши его endpoint в `DATABASE_URL`.

## 1. Подготовка сервера

```bash
# Создать директорию приложения
sudo mkdir -p /opt/pilingtrack
sudo chown $USER:$USER /opt/pilingtrack
cd /opt/pilingtrack

# Склонировать репозиторий
git clone <repo> .
git checkout main
```

## 2. Секреты

Сгенерируй сильные ключи и сохрани в `.env.production` (никогда не коммитить):

```bash
# Сгенерировать 32-байтные секреты
openssl rand -hex 32   # для SESSION_SECRET
openssl rand -hex 32   # для PIN_LOOKUP_SECRET
openssl rand -hex 32   # для DEVICE_KEY_LOOKUP_SECRET
openssl rand -hex 32   # для ENCRYPTION_KEY
openssl rand -hex 16   # для POSTGRES_PASSWORD
```

Минимальный `.env.production`:

```ini
# Postgres
POSTGRES_USER=piling
POSTGRES_PASSWORD=<32 hex>
POSTGRES_DB=pilingtrack

# Application secrets — все обязательны, иначе compose упадёт
SESSION_SECRET=<32 bytes hex, 64 chars>
PIN_LOOKUP_SECRET=<32 bytes hex>
DEVICE_KEY_LOOKUP_SECRET=<32 bytes hex>
ENCRYPTION_KEY=<32 bytes hex>

# Public WebSocket URL — обязательно с прод-доменом
NEXT_PUBLIC_WS_URL=wss://piling.example.com/ws

# S3 / MinIO для PDF-хранилища (можно вынести на S3 / Yandex Object Storage)
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=pilingtrack-reports
S3_ACCESS_KEY_ID=<minio user>
S3_SECRET_ACCESS_KEY=<minio password>
MINIO_ROOT_USER=<minio user>
MINIO_ROOT_PASSWORD=<minio password>

# Не запускать seed при перезапуске prod-контейнеров
SKIP_SEED=1
```

После генерации **запиши секреты в безопасный менеджер** (1Password / Vaultwarden / KMS) — они нужны для последующих миграций / восстановления. Особенно `ENCRYPTION_KEY` — без него данные в Telegram-токенах и других зашифрованных полях нельзя расшифровать. См. `docs/encryption-key-rotation.md` про ротацию.

## 3. Первый запуск

```bash
# Подгружает .env.production вместо .env
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d

# Логи приложения
docker compose --env-file .env.production logs -f app
```

Что произойдёт:
- `migrate` контейнер прогонит `prisma migrate deploy` и завершится.
- `app`, `workers`, `ws` стартуют и пройдут healthcheck.
- БД, Redis, MinIO будут доступны **только во внутренней сети** (порты не выставлены наружу).

## 4. Reverse-proxy (TLS + домен)

Прод-overlay связывает `app` с `127.0.0.1:3000` и `ws` с `127.0.0.1:3001`. Снаружи доступа нет — нужен HTTPS-фронт. Пример **Caddy** (один конфиг + Let's Encrypt):

```caddyfile
piling.example.com {
    reverse_proxy /ws/* 127.0.0.1:3001
    reverse_proxy 127.0.0.1:3000
}
```

Или **nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name piling.example.com;
    ssl_certificate /etc/letsencrypt/live/piling/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/piling/privkey.pem;

    location /ws/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

После настройки HTTPS — поправь `NEXT_PUBLIC_WS_URL=wss://...` в `.env.production` и перезапусти `app`.

## 5. Создание первого админа

После первого запуска БД пустая. Создание админа — через seed (`prisma/seed.ts`) или через psql:

```bash
docker compose exec postgres psql -U piling -d pilingtrack -c \
  "INSERT INTO \"User\" (id, email, name, role, \"passwordHash\", \"createdAt\", \"updatedAt\") \
   VALUES ('admin-seed', 'admin@piling.example.com', 'Admin', 'ADMIN', \
   '<bcrypt-hash>', NOW(), NOW());"
```

Сгенерировать bcrypt-хэш можно через `npx tsx scripts/hash-password.ts <password>` (если такого скрипта нет, используй любой bcrypt-инструмент с cost=10).

## 6. Backup'ы

Ежедневный pg_dump через cron на хосте (компонент **L-3 из аудита** — отдельный фикс):

```bash
# /etc/cron.daily/pilingtrack-backup
docker compose --env-file /opt/pilingtrack/.env.production \
  exec -T postgres pg_dump -U piling -d pilingtrack -F c \
  | gzip > /var/backups/pilingtrack/$(date +%Y%m%d).sql.gz

find /var/backups/pilingtrack -mtime +30 -delete
```

Восстановление: `gunzip -c <file>.sql.gz | docker compose exec -T postgres pg_restore -U piling -d pilingtrack`.

## 7. Обновление до новой версии

```bash
cd /opt/pilingtrack
git fetch && git checkout v2.3.0
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build
```

`migrate` контейнер автоматически прокатит новые Prisma-миграции до того, как `app` стартует.

## 8. Масштабирование

| Узкое место | Что делать |
|---|---|
| CPU/RAM на app | `docker compose ... up -d --scale app=3` + LB на reverse-proxy. App stateless. |
| PDF-генерация копится в очереди | `--scale workers=2`. BullMQ корректно обрабатывает concurrent consumers. |
| Postgres I/O | Управляемый Postgres + pgbouncer (уже в стеке). |
| MinIO дисковая | Перейти на внешний S3 (изменить env var `S3_ENDPOINT`). |

## 9. Мониторинг (опционально)

Положить рядом `docker-compose.observability.yml` (он уже в репо) и поднять:

```bash
docker compose -f docker-compose.observability.yml up -d
```

Получишь Grafana + Prometheus на `127.0.0.1:3030`. Дашборды для HTTP-latency, очереди BullMQ, outbox-lag — TODO в M-10 аудита.

## 10. Откат / disaster recovery

См. отдельный документ `docs/DISASTER-RECOVERY-PLAN.md`. Резюме:

1. Сохранить дамп Postgres (см. п.6).
2. Сохранить `.env.production` (с **тем же `ENCRYPTION_KEY`**).
3. На новом сервере: `git clone` → `cp .env.production` → `pg_restore` → `docker compose up`.

Без `ENCRYPTION_KEY` зашифрованные значения (Telegram-токены) не расшифруются. См. `docs/encryption-key-rotation.md`.
