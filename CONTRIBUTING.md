# Contributing to PilingTrack

Привет! Спасибо, что интересуешься PilingTrack. Это руководство поможет тебе начать работу.

---

## 🚀 Быстрый старт (5 минут)

### 1. Требования

- **Node.js 22+** — [скачать](https://nodejs.org/)
- **Docker Desktop** — для PostgreSQL и Redis
- **npm 10+** — идёт с Node.js

### 2. Клонирование

```bash
git clone <repo-url>
cd pilingtrack
```

### 3. Установка зависимостей

```bash
npm ci
```

### 4. Запуск инфраструктуры

```bash
docker compose up -d postgres redis
```

### 5. Настройка окружения

```bash
cp .env.example .env
# Отредактируй .env при необходимости
```

### 6. Миграция БД

```bash
npm run db:generate:postgres
npm run db:push:postgres
```

### 7. Запуск

```bash
npm run dev
```

Открой http://localhost:3000 — готово!

---

## 📁 Структура проекта

```
src/
├── app/              # Next.js App Router (API routes + pages)
│   ├── api/          # 22 API domain endpoints
│   └── (app)/        # Authenticated pages
├── components/       # React компоненты
│   ├── piling/       # Domain-specific UI
│   └── ui/           # shadcn primitives
├── core/             # Cross-cutting concerns
│   ├── event-bus/    # Event publishing
│   ├── observability/ # Health, metrics, logging
│   ├── outbox/       # Transactional outbox
│   ├── security/     # Encryption, circuit breakers
│   └── infrastructure/ # Raw queries, staleness detection
├── modules/          # DDD bounded contexts
│   ├── reports/      # Full DDD (domain/application/infrastructure)
│   ├── crews/        # Partial DDD
│   ├── sites/        # Partial DDD
│   └── equipment/    # Partial DDD
├── services/         # Legacy service layer (в процессе миграции)
├── lib/              # Shared utilities
├── mobile/           # Offline-first (Dexie, sync engine)
├── workers/          # Background processing
└── shared/           # Shared types (sync contracts)

prisma/               # Database schema
infra/                # Kubernetes (Helm chart)
docs/                 # Documentation
  └── adr/            # Architectural Decision Records
scripts/              # Operational scripts
tests/                # Test suites (e2e, integration, contract)
```

---

## 🧪 Тестирование

### Запустить все тесты

```bash
npm test
```

### Запустить unit тесты

```bash
npm run test:unit
```

### Запустить E2E тесты

```bash
npm run test:e2e
```

### Запустить конкретный тест

```bash
npx vitest run src/core/infrastructure/__tests__/circuit-breakers.test.ts
```

### Добавить новый тест

1. Найди файл, который тестируешь
2. Создай `__tests__/<filename>.test.ts` рядом
3. Следуй паттерну существующих тестов
4. Запусти — убедись, что проходит

---

## 🔄 Pull Request процесс

### Перед отправкой

- [ ] Код проходит `npm run lint`
- [ ] Все тесты проходят `npm test`
- [ ] TypeScript компилируется без ошибок
- [ ] Добавлены тесты для новых функций
- [ ] Обновлена документация при необходимости

### Создание PR

1. Создай ветку от `main`: `git checkout -b feature/my-feature`
2. Закоммить изменения: `git commit -m "feat: add my feature"`
3. Запушь: `git push origin feature/my-feature`
4. Создай Pull Request на GitHub
5. Назначь ревьюеров из CODEOWNERS

### Ревью

- Минимум 1 approval от code owner модуля
- CI должен пройти (tests, lint, typecheck)
- Address review comments
- После approval — merge

---

## 📝 Architectural Decision Records (ADR)

Каждое значимое архитектурное решение документируется через ADR.

### Когда создавать ADR

- Выбор технологии/библиотеки
- Изменение архитектуры
- Trade-off между подходами
- Изменение operational процесса

### Как создать ADR

1. Скопируй `docs/adr/template.md`
2. Заполни по шаблону
3. Сохрани как `docs/adr/NNNN-short-title.md`
4. Приложи к PR

---

## 🏗 Архитектурные принципы

### 1. Data Safety > UI Correctness

Если UI сломался — плохо. Если данные потерялись — критично.

**Как применять:**
- Всегда сначала запись в БД/IndexedDB, потом UI обновление
- Idempotency keys для всех write операций
- DLQ для failed events — никогда не терять

### 2. Sync Engine = сердце системы

Offline-first — не фича, а baseline.

**Как применять:**
- Все CRUD операции работают offline
- Sync queue с retry/backoff
- Conflict detection и resolution

### 3. Failure-First Design

Проектируй через failure scenarios, не happy path.

**Как применять:**
- Для каждой фичи — FDD секция
- Тесты для failure scenarios
- Circuit breakers для внешних зависимостей

### 4. Tenant Isolation

Данные тенантов не должны пересекаться.

**Как применять:**
- RLS на уровне БД
- Middleware tenant context
- Assert tenant в API handlers

---

## 🛠 Полезные команды

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск dev сервера |
| `npm run build` | Production build |
| `npm run lint` | ESLint проверка |
| `npm run test:unit` | Unit тесты |
| `npm run test:e2e` | E2E тесты |
| `npm run validate:env` | Валидация переменных окружения |
| `npm run db:generate:postgres` | Генерация Prisma клиента |
| `npm run db:push:postgres` | Применение миграций |
| `helm lint infra/helm/pilingtrack` | Проверка Helm chart |
| `docker compose up -d` | Запуск локальной инфраструктуры |

---

## 📚 Дополнительная документация

- [TEST-ARCHITECTURE.md](docs/archive/TEST-ARCHITECTURE.md) — Тестовая архитектура (архив, апрель 2026)
- [FAILURE-DESIGN-DOCUMENT.md](docs/archive/FAILURE-DESIGN-DOCUMENT.md) — 15 failure scenarios (архив, апрель 2026)
- [DEVICE-MATRIX.md](docs/archive/DEVICE-MATRIX.md) — Device testing strategy (архив, апрель 2026)
- [ADR Index](docs/adr/) — Архитектурные решения

---

## 🆘 Как получить помощь

- **GitHub Issues** — для багов и feature requests
- **GitHub Discussions** — для вопросов и обсуждений
- **CODEOWNERS** — назначь ревьюеров из файла CODEOWNERS

---

## 🎯 Code Style

- **TypeScript strict mode** — никаких `any` без обоснования
- **ESLint** — все правила должны проходить
- **Именование** — camelCase для переменных, PascalCase для компонентов
- **Комментарии** — на русском (для единообразия с документацией)
- **Форматирование** — Prettier (настроен автоматически)

---

Спасибо за вклад! 🎉
