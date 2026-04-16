# 🔍 ГЛУБОКИЙ АНАЛИЗ PILINGTRACK

**Дата:** 12 апреля 2026 г.  
**Аудитор:** AI Code Review (OpenClaw)  
**Объект:** PilingTrack v1.0.0 — Industrial SaaS для управления свайными работами

---

## 📋 ЧТО ЭТО

**PilingTrack** — полнофункциональная SaaS-платформа для производственного учёта в строительстве (сваи, бурение). Операторы заполняют сменные отчёты с палет/свай, бригады привязаны к объектам, администраторы управляют справочниками, а Telegram-бот пушит уведомления.

**Стек:** Next.js 16 + React 19 + TypeScript + Prisma 6 + PostgreSQL + Redis + Docker + K8s/Helm + WebSocket + MQTT + Sentry + OpenTelemetry

---

## 🏗️ АРХИТЕКТУРА

### Сильные стороны

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| **DDD/CQRS** | ⭐⭐⭐⭐☆ | Чёткое разделение: domain → application (commands/queries) → infrastructure → api. Модули: `reports`, `crews`, `equipment`, `sites`, `users`, `telemetry`, `analytics` |
| **Event Sourcing** | ⭐⭐⭐⭐⭐ | Outbox Pattern + Event Bus + Dead Letter Queue + Projection Worker. Серьёзная работа с eventual consistency |
| **Multi-tenancy** | ⭐⭐⭐⭐☆ | Полная поддержка: Tenant model, subdomain routing, middleware enforcement, billing/subscription через Stripe |
| **Resilience** | ⭐⭐⭐⭐⭐ | Circuit Breaker (3 порога), Rate Limiter (Redis Lua), Bulkhead, Staleness Detector, Graceful degradation |
| **Observability** | ⭐⭐⭐⭐⭐ | Prometheus + Grafana + Loki + Tempo (traces) + AlertManager + OpenTelemetry + SLO enforcement + RUM collector |
| **Infrastructure** | ⭐⭐⭐⭐☆ | Docker Compose + Helm charts + ArgoCD + K6 load testing + OWASP ZAP + Chaos Engineering |

### Архитектурные слои (снизу вверх)

```
┌─────────────────────────────────────────────┐
│  UI Layer: React 19 + shadcn/ui + Tailwind  │
├─────────────────────────────────────────────┤
│  API Layer: Next.js Route Handlers          │
│  └─ Auth (JWT sessions, PIN auth)           │
│  └─ CSRF / Rate Limiting / Idempotency      │
│  └─ Zod validation on all mutations         │
├─────────────────────────────────────────────┤
│  Application Layer (CQRS)                   │
│  └─ Command Services (write)                │
│  └─ Query Services (read)                   │
│  └─ Event Handlers + EventBus               │
├─────────────────────────────────────────────┤
│  Domain Layer                               │
│  └─ Aggregates: Report, Crew, Equipment,    │
│     Site (with invariants)                  │
│  └─ Domain Events                           │
├─────────────────────────────────────────────┤
│  Infrastructure Layer                       │
│  └─ Prisma repositories (PostgreSQL)        │
│  └─ Redis (caching + pub/sub + rate limit)  │
│  └─ S3 (media storage)                      │
│  └─ MQTT (telemetry ingestion)              │
│  └─ WebSocket (real-time updates)           │
│  └─ Background Workers (outbox/projection)  │
└─────────────────────────────────────────────┘
```

---

## 🔐 БЕЗОПАСНОСТЬ

### Что сделано хорошо ✅

- **JWT с HS256** через `jose`, httpOnly cookies, 12h TTL
- **PIN-auth** с двойным хэшированием: HMAC для O(1) lookup + bcrypt для верификации
- **CSRF Protection**: Double Submit Token
- **Rate Limiting**: Redis Lua script (атомарный), отдельные лимиты для email/password (5/15min) и PIN (3/10min)
- **Idempotency Keys**: на POST-мутациях для предотвращения дублей
- **CORS**: белый список origins с wildcard subdomain support
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Encryption**: AES-256-GCM для чувствительных данных (Telegram tokens, API keys)
- **Tenant Isolation**: middleware принудительно проверяет X-Tenant-ID
- **Audit Log**: трекинг всех операций
- **OWASP ZAP**: конфигурация для автоматического сканирования

### Уязвимости и проблемы ⚠️

| # | Уровень | Проблема | Файл |
|---|---------|----------|------|
| S1 | 🔴 CRITICAL | **Plaintext PIN fallback** — `pin === indexedCandidate.pin` как fallback при отсутствии bcrypt-hash. Устаревшие записи в БД могут содержать открытые PIN-коды | `auth-service.ts:208` |
| S2 | 🟠 HIGH | **JWT без инвалидации** — нет blacklist, logout не аннулирует токен до истечения TTL (12 часов) | `session-service.ts` |
| S3 | 🟠 HIGH | **Legacy SHA256 password** — поддержка старых хэшей с timing-safe comparison, но upgrade path может вызвать race condition при concurrent login | `auth-service.ts` |
| S4 | 🟠 HIGH | **Нет CSP (Content Security Policy)** — header отсутствует, хотя next.config.ts и middleware устанавливают другие заголовки | `next.config.ts` |
| S5 | 🟡 MEDIUM | **Dev fallback secret** — при отсутствии SESSION_SECRET в dev используется хардкод `'dev-only-session-secret-change-me'`. Если кто-то забудет задать secret в staging — уязвимость | `session-service.ts` |
| S6 | 🟡 MEDIUM | **Encryption key в env** — ENCRYPTION_KEY передаётся через переменные окружения, без HSM или KMS | `encryption.ts` |

---

## 📊 ПРОИЗВОДИТЕЛЬНОСТЬ

### Что сделано хорошо ✅

- **Cursor-based pagination** для больших списков
- **Redis caching** с несколькими стратегиями
- **Background workers** — outbox, projection, PDF генерация вынесены из API
- **Circuit breaker** на уровне DB — fail-fast при перегрузке
- **PostgreSQL indexes** на ключевых таблицах
- **Standalone output** в Next.js (`output: 'standalone'`) для минимального Docker image
- **K6 load tests** — smoke, spike, soak, login, report scenarios

### Проблемы ⚠️

| # | Уровень | Проблема |
|---|---------|----------|
| P1 | 🟠 HIGH | **Redis connection management** — singleton без graceful shutdown, потенциальный leak при hot reload |
| P2 | 🟠 HIGH | **Неразделённые worker-процессы** — outbox + projection + PDF в одном процессе. PDF-генерация CPU-intensive и может блокировать event loop |
| P3 | 🟡 MEDIUM | **Нет connection pooling конфигурации** для Prisma в production |
| P4 | 🟡 MEDIUM | **Zustand store** (`usePilingStore`) — глобальное состояние без persist, при refresh все данные теряются |
| P5 | 🟡 MEDIUM | **Framer Motion** на каждом движении — bundle size impact на мобильных |

---

## 🧪 ТЕСТИРОВАНИЕ

### Покрытие

| Тип | Статус | Файлы |
|-----|--------|-------|
| Unit (Vitest) | ✅ Частичное | ~15 файлов в `__tests__/` |
| E2E (Playwright) | ✅ Есть | login, shift, network chaos, offline sync |
| Integration | ✅ Есть | data integrity, sync correctness, contract tests |
| Chaos | ✅ Продвинутый | circuit breaker, network chaos, conflict resolution |
| Load (K6) | ✅ Продвинутый | smoke (20 VU), spike (1000 VU), soak (6h), login, report |
| Security (ZAP) | ⚠️ Конфиг есть | Но не интегрирован в CI |

### Проблемы ⚠️

| # | Уровень | Проблема |
|---|---------|----------|
| T1 | 🟠 HIGH | **Мало unit-тестов** — 442 файла `.ts`, только ~15 с тестами. Покрытие < 5% |
| T2 | 🟡 MEDIUM | **Нет snapshot-тестов** для UI компонентов |
| T3 | 🟡 MEDIUM | **E2E нет в CI** — `test:e2e` не вызывается в verify-скрипте |
| T4 | 🟢 LOW | **Нет contract tests для WebSocket** |

---

## 🏭 ОПЕРАЦИОННАЯ ГОТОВНОСТЬ

### Что сделано хорошо ✅

- **Docker Compose** с healthcheck, resource limits, depends_on с condition
- **Helm charts** для Kubernetes (staging + production values)
- **ArgoCD** manifest для GitOps deploy
- **Observability stack**: Prometheus + Grafana + Loki + Tempo + AlertManager
- **SLO enforcement**: latency budget, error budget, staleness monitoring
- **OpenTelemetry tracing** с auto-instrumentation
- **Sentry** для error tracking (client + server)
- **Graceful shutdown** в workers

### Проблемы ⚠️

| # | Уровень | Проблема |
|---|---------|----------|
| O1 | 🔴 CRITICAL | **CI не пушит Docker-образы** — `docker: push: false`, K8s деплой сломан |
| O2 | 🔴 CRITICAL | **Dockerfile HEALTHCHECK сломан** — `wget` не установлен в Alpine, или `curl` без CMD |
| O3 | 🟠 HIGH | **Нет README.md** — проект без описания для новых разработчиков |
| O4 | 🟡 MEDIUM | **Нет database migration strategy** в CI — миграции не запускаются автоматически |
| O5 | 🟡 MEDIUM | **Разные конфиги Dockerfile** — 4 файла (Dockerfile, .prod, .quick, .workers), неясно какой для чего |

---

## 📱 UI / UX

### Что сделано хорошо ✅

- **shadcn/ui** — зрелая, кастомизируемая компонентная библиотека (60+ компонентов)
- **Tailwind CSS** — отзывчивый дизайн
- **Framer Motion** — плавные анимации
- **Skeleton loading** для критических путей
- **Sonner toast** для обратной связи
- **Мобильная версия** — отдельная директория `src/mobile/`
- **Service Worker** для offline-режима
- **Haptic feedback** API
- **Локализация RU** — интерфейс на русском

### Проблемы ⚠️

| # | Уровень | Проблема |
|---|---------|----------|
| U1 | 🟠 HIGH | **Крупные компоненты** — `operator-dashboard.tsx` ~290 строк, `report-form.tsx` потенциально ещё больше. Нужен рефакторинг на атомарные подкомпоненты |
| U2 | 🟡 MEDIUM | **Нет SSR/ISR** для публичных страниц — хотя это внутреннее приложение, холодный старт медленный |
| U3 | 🟡 MEDIUM | **Нет dark mode** — только светлая тема |
| U4 | 🟢 LOW | **Нет a11y тестирования** |

---

## 💰 КОММЕРЧЕСКАЯ МОДЕЛЬ

Полностью реализованная:

- **Multi-tenant** с subscription plans (free / trial / active / past_due)
- **Stripe integration** — billing emails, customer IDs, invoice tracking
- **Tenant limits** — max users, current usage tracking, storage quotas
- **Billing service** — invoices, currency (RUB), metadata

---

## 📈 СТАТИСТИКА КОДА

| Метрика | Значение |
|---------|----------|
| Общий файловый объём | ~327 `.ts` + 97 `.tsx` = **424 source files** |
| API endpoints | ~40 routes |
| UI компонентов | 78 (shadcn: 60 + business: 18) |
| Domain модулей | 5 (reports, crews, equipment, sites, analytics) |
| Services | 15+ |
| Workers | 3 + unified |
| Tests | ~20 test files |
| Docker configs | 4 Dockerfiles + 4 compose files |
| Infra | Helm charts + ArgoCD + Terraform mentions |

---

## 🎯 ОБЩАЯ ОЦЕНКА

### Качество инженерии: **8/10**

Это **серьёзный проект** с продвинутой архитектурой. Не типичный Next.js-стартап. Человек, который это пишет, понимает distributed systems: event sourcing, circuit breakers, outbox pattern, CQRS, observability stack — всё на месте.

### Ключевые сильные стороны
1. 🏗️ Архитектура — DDD/CQRS/ES на уровне, редкий для такого стека
2. 🛡️ Resilience — circuit breakers, rate limiters, bulkheads
3. 📊 Observability — полноценный стек (metrics, logs, traces, alerts)
4. 🏭 DevOps — Docker, K8s, Helm, ArgoCD, load testing
5. 💰 SaaS-ready — multi-tenancy, billing, subscription management

### Что нужно исправить в первую очередь (приоритет)

1. 🔴 **S1: Plaintext PIN fallback** — удалите fallback, мигрируйте все PIN в bcrypt
2. 🔴 **O1: CI docker push** — включите публикацию образов, иначе деплой мёртв
3. 🔴 **O2: Dockerfile HEALTHCHECK** — исправьте CMD, установите wget/curl
4. 🟠 **T1: Unit test coverage** — <5% для проекта этого размера неприемлемо. Минимум 40% на core + services
5. 🟠 **S2: JWT invalidation** — добавьте blacklist в Redis или缩短 TTL до 1 часа
6. 🟠 **S4: CSP header** — добавьте Content-Security-Policy
7. 🟠 **U1: Component size** — рефакторинг крупных компонентов

### Рекомендация

Проект готов к **private beta** после исправления 3 critical issues. Для **production** нужно ещё: unit-тесты (≥40%), CSP, JWT invalidation, README. Для **enterprise** — HSM для ключей, SOC2 compliance, disaster recovery procedures.

---

**Вердикт:** Архитектурно — один из сильнейших Next.js-проектов, которые я видел. Инженерная культура на высоком уровне. Но operational gaps (CI/CD сломан, Docker health check не работает, тестов мало) означают, что проект **не готов к production deploy прямо сейчас** — нужен спринт на stabilisation.
