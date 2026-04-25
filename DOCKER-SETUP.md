# Docker Desktop для PilingTrack

## 📋 Предварительные требования

1. **Docker Desktop** установлен  
   → Скачать: https://www.docker.com/products/docker-desktop

2. **Минимальные ресурсы** (Docker Desktop Settings → Resources)
   ```
   Memory:  4GB (рекомендуется 6-8GB)
   CPU:     4 cores
   Swap:    1GB
   Storage: 50GB свободного места
   ```

---

## 🚀 Быстрый старт

### Вариант 1: Автоматический (PowerShell)

```powershell
.\docker-setup.ps1
docker compose up -d
```

### Вариант 2: Ручной

```bash
# 1. Создать .env файл с параметрами
copy .env.docker.example .env

# Отредактировать .env:
# - POSTGRES_PASSWORD = postgres123
# - SESSION_SECRET = любая строка 32+ символа

# 2. Запустить все сервисы
docker compose up -d

# 3. Проверить статус
docker compose ps

# 4. Просмотреть логи
docker compose logs -f app
```

---

## 🌐 После запуска

| Сервис | URL | Данные |
|--------|-----|--------|
| **App** | http://localhost:3000 | |
| **pgAdmin** | http://localhost:5050 | admin@pilingtrack.local / password |
| **Postgres** | localhost:5432 | piling / postgres123 |
| **Redis** | localhost:6379 | - |

---

## 📊 Основные команды

```bash
# Запустить (в фоне)
docker compose up -d

# Запустить с логами (в терминале)
docker compose up

# Остановить
docker compose down

# Перестроить образ
docker compose up -d --build

# Удалить все данные (ВНИМАНИЕ!)
docker compose down -v

# Просмотреть логи приложения
docker compose logs -f app

# Просмотреть логи конкретного сервиса
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f workers

# Войти в контейнер
docker compose exec app sh
docker compose exec postgres psql -U piling -d pilingtrack

# Перезагрузить определенный сервис
docker compose restart app
```

---

## 🔧 Настройка памяти

Docker Desktop жрет много памяти. Оптимизируем:

**Docker Desktop Settings → Resources:**

```
Memory:         4GB  (вместо 8GB)
CPU:            4    (вместо 8)
Swap:           1GB
Disk Image:     50GB
```

---

## 🐛 Отладка

### Приложение не стартует

```bash
# 1. Проверить статус контейнеров
docker compose ps

# 2. Проверить логи
docker compose logs app

# 3. Перестроить с нуля
docker compose down
docker compose up -d --build

# 4. Проверить переменные окружения в .env
```

### Postgres не стартует

```bash
# Удалить старые данные и начать заново
docker compose down -v
docker volume rm postgres_data
docker compose up -d postgres
```

### Нет интернета в контейнере

```bash
# Windows: откройте Docker Desktop Settings
# → General → Use WSL 2 based engine (включить)
# → рестартните Docker
```

### Порт 3000 уже занят

```bash
# Найти процесс
netstat -ano | findstr :3000

# Либо в docker-compose.yml измените:
# ports:
#   - "3001:3000"  (вместо 3000:3000)
```

---

## 📦 Структура данных

Всё хранится в Docker volumes:

```
postgres_data/     ← База данных (отчеты, пользователи, объекты)
redis_data/        ← Кэш, очередь, Pub/Sub
```

**Удаляется при:** `docker compose down -v`

---

## 🔐 Безопасность (для продакшена)

❌ **НЕ ИСПОЛЬЗУЙТЕ:**
- `POSTGRES_PASSWORD=postgres123`
- `SESSION_SECRET=simple-secret`

✅ **ИСПОЛЬЗУЙТЕ:**
```bash
# Генерировать безопасные пароли
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 16   # POSTGRES_PASSWORD
```

Либо используйте секреты:
```bash
docker secret create db_password password.txt
docker service update --secret-add db_password pilingtrack-app
```

---

## 📈 Мониторинг с Prometheus + Grafana + Loki + Tempo

```bash
# Полный стек observability (метрики, логи, трейсы, алерты).
# Подробности — observability/README.md.
docker compose -f docker-compose.observability.yml up -d

# Только observability без приложения (например, если app запущен нативно)
docker compose -f docker-compose.monitoring-standalone.yml up -d

# Grafana доступна на http://localhost:3010
# Login: admin / admin
```

---

## 🧹 Очистка

```bash
# Удалить остановленные контейнеры
docker container prune

# Удалить неиспользуемые образы
docker image prune

# Удалить ВСЕ (опасно!)
docker system prune -a

# Полная переустановка
docker compose down -v
rm -rf docker_volumes/
docker compose up -d --build
```

---

## 💾 Бэкап базы данных

```bash
# Экспортировать БД
docker compose exec postgres pg_dump -U piling pilingtrack > backup.sql

# Импортировать БД
docker compose exec -T postgres psql -U piling pilingtrack < backup.sql
```

---

## 📚 Дополнительно

- **Docker Docs**: https://docs.docker.com/
- **Docker Compose Docs**: https://docs.docker.com/compose/
- **PostgreSQL в Docker**: https://hub.docker.com/_/postgres
