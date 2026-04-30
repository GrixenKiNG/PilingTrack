# Локальная разработка PilingTrack

Два режима, оба валидные. Выбор зависит от того, что вы правите.

## A. `npm run dev` + Docker DB-only — рекомендуемый

Для повседневной работы над UI / API / CQRS-логикой.

```bash
# Поднять DB-сервисы
docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init

# В соседнем окне — PDF-воркер (BullMQ-консьюмер)
npm run worker:pdf

# В третьем — Next.js dev-сервер с hot reload
npm run dev
```

Или одной командой через `start.bat` (Windows) — он сам поднимет DB-стек, остановит конфликтующие Docker-контейнеры и запустит worker + dev в отдельных окнах.

**Плюсы:**
- Hot reload Next.js < 1 секунды.
- Прямое подключение к Postgres / Redis / MinIO с хоста (`localhost:5435/6380/9000`).
- Дебаггер цепляется к Node-процессу без Docker overhead.

**Минусы:**
- Нужно держать DB-контейнеры запущенными.
- Прод-конфигурация (Nginx, healthchecks, restart policies) не проверяется локально.

## B. Полный Docker-стек

Для проверки прод-сборки, миграций, multi-process сценариев (несколько воркеров).

```bash
docker compose --env-file .env.docker up -d
docker compose logs -f app
```

**Плюсы:**
- Идентично проду (с `docker-compose.prod.yml` overlay — почти 1-в-1).
- Видно как ведут себя несколько воркеров одновременно.

**Минусы:**
- Каждое изменение TS-кода требует rebuild контейнера (`up -d --build app`).
- Healthcheck'и + ожидание migrate-сервиса — медленный старт (≈1 минута).

---

## ⚠ Гра́бли: конфликт outbox-leader

Outbox-publisher и projection-worker используют **leader-election через Redis-leases**: только один процесс держит лид-запись (`pilingtrack:leader:outbox-worker`) и публикует события. Остальные процессы спят.

**Проблема возникает, когда оба режима активны одновременно:**

1. Запустили full Docker-стек (`docker compose up -d`) → контейнер `workers` стал лидером, держит lease.
2. Перешли на режим A (`npm run dev`), но `workers`-контейнер остался запущен.
3. Локальный embedded-worker не может стать лидером → события застревают в outbox-таблице.
4. Симптомы: «отчёт отправил, но в Telegram ничего не пришло», `processed=true` появляется только через час, projection-таблицы не растут.

Усугубляющий фактор: `.env.docker` и `.env` могут иметь **разные `ENCRYPTION_KEY`**. Тогда лидер из Docker-контейнера читает события и пытается расшифровать Telegram-токен ключом из `.env.docker` — расшифровка даёт мусор → API Telegram отвергает запрос → событие выглядит «опубликованным» без эффекта.

### Что делает `start.bat`

В `dev` и `prod` режимах он:
1. Останавливает Docker-контейнеры `app`, `ws`, `workers` (`docker compose stop app ws workers`).
2. Поднимает только DB-сервисы.
3. Запускает локальный воркер + `npm run dev`.

Это явное обходное решение, чтобы lease не был занят Docker-контейнером.

### Если ты на Linux/macOS

Аналог `start.bat`:

```bash
docker compose stop app ws workers >/dev/null 2>&1
docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init
npm run worker:pdf &
npm run dev
```

### Если что-то всё равно не работает

**Проверка 1 — кто лидер:**
```bash
docker exec pilingtrack-redis redis-cli GET pilingtrack:leader:outbox-worker
docker exec pilingtrack-redis redis-cli GET pilingtrack:leader:projection-worker
```
Если значение указывает на инстанс, который вы не запускали (например, hostname Docker-контейнера) — значит конфликт. Сбросить:
```bash
docker exec pilingtrack-redis redis-cli DEL pilingtrack:leader:outbox-worker
docker exec pilingtrack-redis redis-cli DEL pilingtrack:leader:projection-worker
```
Лидер переизберётся за ≤ 1 секунду.

**Проверка 2 — ENCRYPTION_KEY консистентность:**
```bash
grep ENCRYPTION_KEY .env .env.docker
# Должны совпадать!
```
Если различаются — приведите к одному значению, иначе зашифрованные строки прочитаются только одним из процессов. См. `docs/encryption-key-rotation.md` если действительно нужно ротировать.

**Проверка 3 — версия Redis:**
BullMQ требует Redis ≥ 5.0. Native Windows Redis 3.0.504 (если установлен через MSOpenTech-сборку) **не подойдёт**. Поэтому в `.env` указано `REDIS_URL=redis://localhost:6380` — это пробрасывается на Docker-контейнер с Redis 7.

```bash
docker exec pilingtrack-redis redis-cli INFO server | grep redis_version
# должно быть 7.x
```

---

## Когда какой режим выбирать

| Задача | Режим |
|---|---|
| UI-правки, новый компонент | A |
| Изменение API-route | A |
| Правка Prisma-схемы + миграция | A (миграция через `npm run db:migrate`) |
| Тестирование Docker-сборки перед коммитом | B |
| Многоинстансный сценарий (2 воркера, конкурентность) | B + `--scale workers=2` |
| Деплой-тестирование с reverse-proxy | B + `docker-compose.prod.yml` |
