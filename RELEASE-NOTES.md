# 🚀 PilingTrack v1.0.0 — Release Notes

**Дата релиза:** 10 апреля 2026 г.  
**Тип:** Первый официальный релиз  

---

## 📋 Описание

PilingTrack — система управления свайными работами для строительной отрасли.

### Основные возможности:
- 👤 **Аутентификация** — вход по PIN-коду, JWT-сессии
- 🏗️ **Управление участками** — Sites, иерархия, назначение бригад
- 👷 **Бригады и техника** — Crews, Equipment, словари
- 📝 **Отчёты** — создание, редактирование, экспорт в PDF
- 📊 **Аналитика** — CQRS проекции, дашборды
- 📱 **Синхронизация** — офлайн-режим, разрешение конфликтов
- 🔔 **Telegram-бот** — уведомления, управление
- 📡 **IIoT телеметрия** — приём данных с устройств
- 🏢 **Мультитенантность** — изоляция данных по арендаторам
- 📝 **Обратная связь** — промышленный цикл feedback

---

## 📊 Данные (при первом запуске)

| Сущность | Количество |
|----------|------------|
| 👤 Users | 12 |
| 🏗️ Sites | 4 |
| 🚜 Equipment | 6 |
| 👷 Crews | 5 |
| 📝 Reports | 5 |
| 🔶 PileGrades | 5 |
| 🔩 DrillingTypes | 4 |
| ⏸️ DowntimeReasons | 6 |

---

## 🛠 Технологический стек

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui
- **Backend:** Next.js App Router, Server Actions
- **База данных:** PostgreSQL 16 + Prisma ORM
- **Кэш:** Redis
- **Хранилище файлов:** S3-compatible (AWS SDK)
- **Мониторинг:** Grafana + Prometheus + Loki + Alertmanager
- **Очереди:** BullMQ (Redis-based)
- **Открытый API:** OpenAPI-совместимый

---

## 📦 Установка и запуск

### Требования:
- Node.js 20+
- PostgreSQL 16
- Redis 7+

### Запуск:
```bash
# Установка зависимостей
npm install

# Настройка переменных окружения
cp .env.example .env
# Отредактируйте DATABASE_URL_POSTGRES и SESSION_SECRET

# Запуск в разработке
npm run dev

# Production-билд и запуск
npm run build
npm run start
```

---

## 🐳 Docker

```bash
# Запуск PostgreSQL
docker compose -f docker-compose.production.yml up -d postgres

# Сборка и запуск приложения
npm run docker:build:prod
```

---

## 🔧 Конфигурация

Основные переменные окружения (`.env`):

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL_POSTGRES` | Строка подключения к PostgreSQL |
| `SESSION_SECRET` | Секрет для JWT-сессий |
| `DATABASE_PROVIDER` | Провайдер БД (`postgres` или `sqlite`) |
| `REDIS_URL` | Строка подключения к Redis |
| `MULTI_TENANT_MODE` | Режим мультитенантности (`single` или `multi`) |

---

## 📄 Лицензия

© 2026 PilingTrack. Все права защищены.
