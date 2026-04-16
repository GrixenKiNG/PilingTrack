# PilingTrack

Краткое описание: приватный репозиторий для проекта PilingTrack.

Цель репозитория — хранение кода и документации приложения.

Установка и запуск:

- См. `package.json` для скриптов проекта.

Лицензия: MIT.
# PilingTrack

Система управления свайными работами для строительных объектов.

## 🏗️ Описание

PilingTrack — это веб-приложение для отслеживания и управления свайными работами на строительных объектах. Поддерживает роли: **Администратор**, **Диспетчер**, **Оператор**, **Помощник**.

### Возможности

- Управление объектами строительства, оборудованием и бригадами
- Формирование сменных отчётов (забитые сваи, лидерное бурение, простои)
- Ролевая модель доступа с multi-tenant поддержкой
- Оффлайн-режим с синхронизацией данных
- WebSocket для real-time обновлений
- Экспорт отчётов в PDF
- Telegram-интеграция для уведомлений

## 🚀 Быстрый старт

### Предварительные требования

- Node.js 22+
- PostgreSQL 16
- Redis 7
- Bun (рекомендуется) или npm

### Установка

```bash
# Клонировать репозиторий
git clone https://github.com/pilingtrack/pilingtrack.git
cd pilingtrack

# Установить зависимости
npm install

# Создать .env файл
cp .env.example .env
# Отредактируйте .env и укажите реальные значения для:
# - DATABASE_URL_POSTGRES
# - SESSION_SECRET
# - REDIS_URL (опционально для dev)

# Подготовить БД
npm run db:generate:postgres
npm run db:push:postgres

# Запустить seed-данные
npx prisma db seed --schema prisma/schema.postgres.prisma

# Запустить dev-сервер
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) в браузере.

### Тестовые учётные данные

| Роль | Email | Пароль |
|------|-------|--------|
| Admin | admin@piling.ru | admin123 |
| Dispatcher | dispatch@piling.ru | dispatch123 |
| Operator | operator@piling.ru | operator123 |
| Assistant | helper@piling.ru | helper123 |

## 📁 Структура проекта

```
my-project/
├── src/
│   ├── app/              # Next.js App Router (pages + API routes)
│   ├── components/       # React components (UI + piling)
│   ├── core/             # Domain core (event-bus, outbox, security)
│   ├── modules/          # DDD modules (reports, crews, sites, equipment)
│   ├── services/         # Business logic services
│   ├── lib/              # Shared utilities (auth, cache, validation)
│   ├── mobile/           # Offline sync & PWA logic
│   ├── realtime/         # WebSocket server
│   └── workers/          # Background workers (outbox, projection, PDF)
├── prisma/               # Prisma schemas
├── scripts/              # Utility scripts
├── monitoring/           # Prometheus + Grafana configs
├── infra/                # Helm charts, ArgoCD
├── e2e/                  # Playwright E2E tests
├── tests/                # Vitest unit tests
└── docs/                 # Architecture decision records
```

## 🧪 Тестирование

```bash
# Unit тесты
npm run test:unit

# E2E тесты
npm run test:e2e

# Все тесты
npm run test

# Smoke-тест
npm run test:smoke:auth-access

# Нагрузочные тесты (требует k6)
npm run test:load
```

## 🐳 Docker

### Development

```bash
docker compose up -d
```

### Production

```bash
docker compose -f docker-compose.production.yml up -d
```

## 📖 Документация

- [Architecture Decision Records](docs/adr/)
- [Disaster Recovery Plan](docs/DISASTER-RECOVERY-PLAN.md)
- [Kubernetes Deployment](docs/KUBERNETES-DEPLOYMENT.md)
- [Test Architecture](docs/TEST-ARCHITECTURE.md)

## 🔧 Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск dev-сервера |
| `npm run build` | Продакшн-билд |
| `npm run start` | Запуск продакшн-сервера |
| `npm run lint` | ESLint |
| `npm run typecheck` | Проверка типов TypeScript |
| `npm run db:generate:postgres` | Генерация Prisma-клиента |
| `npm run db:push:postgres` | Применить схему к БД |
| `npm run db:seed` | Заполнить тестовыми данными |
| `npm run test:unit` | Unit-тесты |
| `npm run test:e2e` | E2E-тесты |

## 🛠️ Технологический стек

| Категория | Технологии |
|-----------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui |
| **Backend** | Next.js API Routes, Prisma 6, PostgreSQL 16 |
| **Кэширование** | Redis 7, ioredis |
| **Реальное время** | WebSocket (ws), SSE |
| **Мониторинг** | OpenTelemetry, Sentry, Prometheus, Grafana |
| **Тестирование** | Vitest, Playwright, k6 |
| **CI/CD** | GitHub Actions, Helm, ArgoCD |
| **Контейнеризация** | Docker, Docker Compose |

## 📝 Лицензия

© 2025-2026 PilingTrack. Все права защищены.
