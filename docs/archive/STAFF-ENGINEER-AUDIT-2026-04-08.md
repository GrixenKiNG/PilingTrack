# 🔍 Staff/Principal Engineer Audit — PilingTrack

**Дата аудита:** 08 апреля 2026 г.  
**Версия приложения:** 1.0.0  
**Аудитор:** Staff/Principal Engineer Audit (Multi-Agent Deep Analysis)  
**Стек:** Next.js 16 + React 19 + Prisma 6 + TypeScript + SQLite/PostgreSQL + Redis + WebSocket  

---

## 📊 Итоговая оценка: 7.8/10

| Категория | Оценка | Статус | 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low |
|-----------|--------|--------|-------------|---------|-----------|--------|
| **Архитектура** | 7.0/10 | ⚠️ | 0 | 3 | 4 | 2 |
| **Безопасность** | 7.5/10 | ⚠️ | 2 | 2 | 3 | 1 |
| **Качество кода** | 7.5/10 | ⚠️ | 0 | 2 | 5 | 3 |
| **Производительность** | 7.0/10 | ⚠️ | 0 | 2 | 4 | 2 |
| **Тестирование** | 6.5/10 | ⚠️ | 0 | 2 | 4 | 1 |
| **DevOps/Infrastructure** | 8.2/10 | ✅ | 1 | 0 | 3 | 3 |
| **Data Integrity** | 7.0/10 | ⚠️ | 1 | 3 | 2 | 1 |
| **Industrial UX** | 8.0/10 | ✅ | 0 | 0 | 2 | 1 |

**Динамика:** Предыдущий анализ (07.04.2026) — 8.2/10 → Текущий Staff Audit — **7.8/10**

> **Почему оценка снизилась?** Предыдущие анализы фокусировались на отдельных участках. Этот аудит провёл *глубокий системный анализ* всей кодовой базы, выявив скрытые архитектурные и системные проблемы, невидимые при поверхностном рассмотрении.

---

## ✅ Сильные стороны (что действительно впечатляет)

### Архитектура
1. ✅ **DDD/CQRS реализация** — reports модуль с Aggregate Root, Domain Events, Repository Interface
2. ✅ **Transactional Outbox Pattern** — правильная реализация с polling worker
3. ✅ **Event-Driven Architecture** — event bus с schema registry, projection workers
4. ✅ **Multi-database** — SQLite dev → PostgreSQL prod с миграцией данных
5. ✅ **WebSocket сервер** — отдельный порт, channel routing, Redis Pub/Sub, ACL
6. ✅ **CQRS Read Projections** — ReportStats, SiteDailySummary, OperatorPerformance, DowntimeSummary, SiteWeeklyTrend

### Безопасность
7. ✅ **bcrypt migration** — переход с SHA-256 на bcrypt (12 rounds)
8. ✅ **Rate limiting** — Redis-based с Lua scripts
9. ✅ **Security Headers** — CSP, HSTS, X-Frame-Options, Permissions-Policy
10. ✅ **RBAC** — 4 роли, 15 abilities, resource-level access control
11. ✅ **Session management** — HttpOnly cookies, token rotation
12. ✅ **Idempotency keys** — защита от дублирования запросов

### DevOps
13. ✅ **Docker multi-stage** — Alpine, non-root user, healthcheck
14. ✅ **Helm charts** — HPA, PDB, anti-affinity, ServiceMonitor
15. ✅ **GitHub Actions** — 6 workflows: CI, deploy, security, release, CodeQL, PR-labeler
16. ✅ **Observability** — OpenTelemetry, Sentry, Prometheus, Grafana, Loki, Jaeger
17. ✅ **Backup & DR** — scripts, runbooks, disaster recovery plan
18. ✅ **PWA/Offline** — Service Worker, IndexedDB, background sync

### Тестирование
19. ✅ **27 unit test файлов** — domain aggregates, event bus, rate limiter, circuit breaker
20. ✅ **k6 load tests** — realistic profiles, thresholds
21. ✅ **Redis stress tests** — 7 сценариев включая cache stampede, failover
22. ✅ **Smoke tests** — auth flow, RBAC, access control

---

## 🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ (6)

### ARCH-1: Dual Service Layer — архитектурный разрыв
**Файлы:** `src/modules/*/application/` vs `src/services/*/`  
**Влияние:** Путаница, дублирование, невозможность поддержки

**Проблема:** Система имеет **два параллельных service layer**:
```
src/modules/reports/application/  — DDD commands/queries (новый)
src/services/reports/             — Procedural services (legacy)
```

Legacy сервисы **не делегируют** модулям. Projection worker вызывает legacy `publishOutboxEvents`. Два независимых event bus (модульный и core) не интегрированы.

**Риск:** При изменении бизнес-логики разработчик не знает, какой слой использовать. Баги из-за вызова старого кода.

**Рекомендация:**
```
1. Создать facade: src/services/reports/index.ts → делегирует modules/reports/application/
2. Задокументировать: "Все новые фичи — только в modules/"
3. План миграции: постепенно удалять legacy services
4. Timeline: 2-3 недели
```

---

### ARCH-2: Async Outbox не transactional — потеря событий
**Файл:** `src/core/outbox/async-outbox.ts`  
**CVSS:** 7.5 (High)

**Проблема:**
```typescript
// asyncOutbox.enqueue() пишет в memory queue
await asyncOutbox.enqueue(event);
// ← Если процесс упадёт здесь, события ПОТЕРЯНЫ
```

Классический Transactional Outbox требует записи в БД **в той же транзакции** что и бизнес-данные. AsyncOutbox — in-memory queue с periodic flush, что нарушает guarantee паттерна.

**Рекомендация:**
```typescript
// В той же транзакции что и save report:
await db.$transaction([
  db.report.create({ data: reportData }),
  db.outboxEvent.create({ data: event }),  // ←Transactional
]);
```

---

### SEC-1: Секреты в репозитории
**Файлы:** `.env`, `docker-compose.production.yml`  
**CVSS:** 9.1 (Critical)

**Проблема:**
- `.env` файл с реальными паролями находится в проекте
- `POSTGRES_PASSWORD=PilingTrack2024!Secure` захардкожен в docker-compose
- Helm values содержат `postgresql.auth.password: "changeme"`

**Эксплойт:**
```bash
# Любой с доступом к repo получает все пароли
cat .env | grep PASSWORD
cat docker-compose.production.yml | grep POSTGRES_PASSWORD
```

**Рекомендация:**
```bash
# НЕМЕДЛЕННО:
git rm --cached .env
echo ".env" >> .gitignore

# Вынести в GitHub Secrets / Vault:
# docker-compose:
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

# Helm: использовать ExternalSecrets или sealed-secrets
```

---

### SEC-2: Нет CSRF защиты
**Файлы:** API mutation routes  
**CVSS:** 6.5 (Medium)

**Проблема:** Cookie-based auth без CSRF tokens. Злоумышленник может создать CSRF attack:
```html
<!-- На вредоносном сайте -->
<form action="https://pilingtrack.ru/api/reports/upsert" method="POST">
  <input type="hidden" name="userId" value="victim">
  <input type="hidden" name="data" value='{"malicious": true}'>
</form>
<script>document.forms[0].submit()</script>
```

**Рекомендация:**
```typescript
// Middleware для CSRF
import { withCsrf } from '@/lib/csrf-middleware';

export async function POST(req: NextRequest) {
  return withCsrf(req, async () => {
    // handler
  });
}
```

---

### DATA-1: Race condition в upsert отчётов
**Файл:** `src/modules/reports/application/commands/report-command.service.ts`  
**Влияние:** Потеря данных при параллельных запросах

**Проблема:** Паттерн find-then-update не атомарный:
```typescript
const existing = await tx.report.findUnique({ where: { reportId } });
if (existing) {
  await tx.pileWork.deleteMany({ where: { reportId: existing.id } });
  // ← Здесь ДРУГОЙ запрос может тоже удалить pileWork
}
```

Два параллельных запроса с одинаковым `reportId`:
1. Оба находят `existing = null`
2. Оба создают дубликаты

Или при edit:
1. Запрос A удаляет pileWork
2. Запрос B тоже удаляет pileWork (уже пустой)
3. Запрос A создаёт новые pileWork
4. Запрос B создаёт новые pileWork (дубликаты A)

**Рекомендация:**
```prisma
// В schema.prisma:
model Report {
  @@unique([userId, siteId, date], name: "unique_user_site_date")
}
```

```typescript
// Использовать Prisma upsert:
const report = await tx.report.upsert({
  where: { unique_user_site_date: { userId, siteId, date } },
  create: { ... },
  update: { ... },
});
```

---

### DATA-2: Нет валидации факта vs плана
**Файлы:** `SitePilePlan`, `SiteDrillingPlan` существуют, но не используются  
**Влияние:** Финансовые потери, некорректная отчётность

**Проблема:** Оператор может забить 150 свай при плане 100 — система не проверяет.

**Рекомендация:**
```typescript
// Перед сохранением отчёта:
const sitePlans = await tx.sitePilePlan.findMany({ where: { siteId } });
const actualTotals = await tx.pileWork.groupBy({
  by: ['pileGradeId'],
  _sum: { count: true },
  where: { report: { siteId } },
});

for (const plan of sitePlans) {
  const actual = actualTotals.find(p => p.pileGradeId === plan.pileGradeId);
  const newTotal = (actual?._sum.count || 0) + newPileCount;
  
  if (newTotal > plan.count) {
    throw new ServiceError(
      `Превышение плана: ${plan.pileGradeId} — план ${plan.count}, будет ${newTotal}`,
      400
    );
  }
}
```

---

## 🟠 ВЫСОКИЙ ПРИОРИТЕТ (14)

### ARCH-3: Два независимых Event Bus
**Файлы:** `src/modules/reports/application/event-bus.ts` vs `src/core/event-bus/event-bus.ts`

**Проблема:** Модульный event-bus НЕ использует core EventBus. Handlers, зарегистрированные в одном, не получают событий из другого.

**Риск:** Domain events не доходят до projection workers, алертов, WS broadcast.

---

### ARCH-4: Projection handlers не идемпотентны
**Файл:** `src/modules/reports/application/projections/`

**Проблема:** При retry события (из-за error) `increment` применяется дважды — double counting.

---

### ARCH-5: Workers без distributed locking
**Файлы:** `src/workers/outbox-worker.ts`, `src/workers/projection-worker.ts`

**Проблема:** При запуске нескольких инстансов workers обрабатывают одни и те же outbox events (double processing).

---

### SEC-3: Нет rate limiting на reports/sites endpoints
**Файлы:** `/api/reports/upsert`, `/api/sites/create`  
**CVSS:** 6.5

**Проблема:** Rate limiter есть, но применяется ТОЛЬКО к auth/pin. Оператор может создать 1000 отчётов за минуту.

---

### SEC-4: WebSocket аутентификация не интегрирована с JWT
**Файлы:** `src/realtime/server/auth.ts`

**Проблема:** WS парсит cookie напрямую. Если Next.js session rotated, WS server не узнает.

---

### PERF-1: N+1 query problem в проекциях
**Файлы:** `src/modules/reports/application/projections/projection-worker.ts`

**Проблема:** `projectReportStats()` делает `db.report.findUnique({ include: {...} })` для КАЖДОГО события. 100 events = 100 queries.

---

### PERF-2: Гигантские компоненты
**Файлы:**
- `admin-sites.tsx` — 1443 строки
- `admin-reports.tsx` — 1266 строк
- `report-form.tsx` — 1032 строки

**Риск:** Сложность поддержки, тестирования, высокий bus factor.

---

### PERF-3: Framer-motion на больших списках
**Файлы:** `admin-reports.tsx`

**Проблема:**
```tsx
{reports.map((report, index) => (
  <motion.div transition={{ delay: index * 0.03 }}>
```
При 50+ элементах — заметные задержки рендеринга.

---

### DATA-3: Overnight shift — отрицательные часы
**Файлы:** `validateDowntimeWithinShift`

**Проблема:** Смена 20:00 → 08:00 = -12 часов. Все проверки downtime пройдут некорректно.

---

### DATA-4: Edit window проверяется по `createdAt`, не `updatedAt`

**Проблема:** Отчёт создан 30 часов назад, но обновлялся 1 час назад → пользователю откажут.

---

### DATA-5: Raw SQL injection risk
**Файлы:** `src/modules/reports/infrastructure/report.repository.ts`

**Проблема:**
```typescript
`INSERT INTO "LeaderDrilling" ... VALUES ${drillingValues}`  // $executeRawUnsafe
```

---

### DATA-6: Нет оффлайн E2E тестов
**Влияние:** Offline mode заявлен, но не тестирован в Playwright.

---

### TEST-1: 7 failing unit tests
**Результат:** 243 passed, 7 failed (2.8% failure rate)

**Падающие тесты:**
- `retry-with-backoff.test.ts` — FetchError 5xx
- `crew-command-service.test.ts` — force delete
- `report-command-service.test.ts` — 5 тестов (db.reportAudit mock)

---

### TEST-2: API Routes — 0 unit тестов
**Влияние:** 40+ route файлов без единого теста.

---

### TEST-3: React Components — 1 из 50+
**Влияние:** Только `login-page.test.tsx` протестирован.

---

## 🟡 СРЕДНИЙ ПРИОРИТЕТ (15)

| # | Проблема | Влияние | Оценка |
|---|----------|---------|--------|
| MID-1 | Нет Redis caching | Performance | 4ч |
| MID-2 | CSV экспорт без reportId | Tracing | 1ч |
| MID-3 | Нет пагинации (cursor-based) | Performance | 4ч |
| MID-4 | Нет timezone handling | Data correctness | 2ч |
| MID-5 | Монолитный Zustand store | Maintainability | 4ч |
| MID-6 | Нет CSRF tokens | Security | 2ч |
| MID-7 | Schema validation не blocking | Data integrity | 2ч |
| MID-8 | Нет alerting routing (PagerDuty) | Observability | 4ч |
| MID-9 | Нет SLO/SLI definitions | SRE | 4ч |
| MID-10 | Нет off-site backup | Disaster recovery | 4ч |
| MID-11 | Нет staging environment | CI/CD | 8ч |
| MID-12 | Нет e2e в CI pipeline | Quality gate | 4ч |
| MID-13 | Helm: нет NetworkPolicy | K8s security | 2ч |
| MID-14 | Helm: нет Pod Security Standards | K8s security | 2ч |
| MID-15 | GitHub Actions: нет pin версий | Supply chain | 2ч |

---

## 📊 Метрики кодовой базы

| Метрика | Значение | Статус |
|---------|----------|--------|
| **API endpoints** | ~50 | ✅ |
| **React компонентов** | 61 (13 piling + 48 ui) | ⚠️ 3 гигантских |
| **Prisma моделей** | 30+ | ✅ |
| **Сервисов** | 15 | ✅ |
| **Модулей (DDD)** | 4 (reports, crews, sites, equipment) | ⚠️ Мало |
| **Строк кода (прибл.)** | ~18,000 | — |
| **TypeScript strict mode** | ✅ Включён | ✅ |
| **Unit tests** | 27 файлов | ✅ |
| **Test pass rate** | 97.2% (243/250) | ⚠️ 7 failing |
| **E2E tests** | 6 spec-файлов | ⚠️ |
| **Zod validation coverage** | ~30% API | ⚠️ |
| **Try-catch coverage** | 100% | ✅ |
| **Зависимостей** | 67 | ✅ |

---

## 🚀 ROADMAP ПО ПРИОРИТЕТАМ

### 🔴 КРИТИЧНО — Неделя 1-2 (обязательно до production)

| # | Задача | Оценка | Влияние |
|---|--------|--------|---------|
| 1 | **Удалить `.env` из репозитория** | 0.5ч | Security |
| 2 | **Вынести пароли в secrets manager** | 2ч | Security |
| 3 | **Исправить 7 failing tests** | 2ч | CI/CD |
| 4 | **Добавить `@@unique([userId, siteId, date])`** | 1ч | Data integrity |
| 5 | **Валидация плана vs факт** | 4ч | Business logic |
| 6 | **AsyncOutbox → transactional** | 4ч | Reliability |
| 7 | **Fix overnight shift** | 1ч | Data correctness |
| 8 | **Edit window по updatedAt** | 0.5ч | UX |

**Время:** ~15 часов | **Риск:** Без этого — data loss, security breach

---

### 🟠 ВАЖНО — Неделя 3-4

| # | Задача | Оценка | Влияние |
|---|--------|--------|---------|
| 9 | **Интеграция двух event bus** | 4ч | Architecture |
| 10 | **Rate limiting на reports/sites** | 2ч | Security |
| 11 | **CSRF protection** | 2ч | Security |
| 12 | **Projection idempotency** | 4ч | Data integrity |
| 13 | **Distributed locking для workers** | 4ч | Scalability |
| 14 | **Zod во всех POST/PUT endpoints** | 8ч | Validation |
| 15 | **E2E тесты (5 критичных flows)** | 8ч | Quality |
| 16 | **API Routes unit tests (10 key)** | 8ч | Test coverage |

**Время:** ~40 часов | **Риск:** Без этого — не production-ready

---

### 🟡 СРЕДНЕ — Месяц 2

| # | Задача | Оценка | Влияние |
|---|--------|--------|---------|
| 17 | **Рефакторинг гигантских компонентов** | 16ч | Maintainability |
| 18 | **Виртуализация списков** | 4ч | Performance |
| 19 | **Redis caching** | 4ч | Performance |
| 20 | **Cursor-based pagination** | 4ч | Performance |
| 21 | **Timezone handling** | 2ч | Correctness |
| 22 | **Accessibility (aria-labels)** | 4ч | a11y |
| 23 | **Component tests (5 key)** | 4ч | Test coverage |
| 24 | **Off-site backup (S3)** | 4ч | DR |
| 25 | **Staging environment** | 8ч | CI/CD |
| 26 | **Alerting (Slack/PagerDuty)** | 4ч | Observability |

**Время:** ~54 часа | **Риск:** Без этого — operational risk

---

### 🔵 ДОЛГОСРОЧНО — Месяц 3+

| # | Задача | Оценка | Влияние |
|---|--------|--------|---------|
| 27 | **Миграция всех сервисов на DDD** | 40ч | Architecture |
| 28 | **IoT интеграция (MQTT)** | 40ч | Industry 4.0 |
| 29 | **Многопользовательский tenant mode** | 20ч | Multi-tenancy |
| 30 | **BI аналитика (Metabase)** | 20ч | Analytics |
| 31 | **Canary deployments** | 16ч | CD |
| 32 | **Feature flags** | 8ч | Gradual rollout |
| 33 | **Penetration testing** | 16ч | Security |
| 34 | **Chaos engineering** | 16ч | Resilience |

**Время:** ~176 часов | **Риск:** Без этого — ограничения масштабируемости

---

## 📈 Сравнение с предыдущими анализами

| Метрика | 04.04 (Первый) | 04.04 (Глубокий) | 07.04 (Анализ) | **08.04 (Staff Audit)** |
|---------|----------------|------------------|----------------|-------------------------|
| **Общая оценка** | 7.5/10 | 7.8/10 | 8.2/10 | **7.8/10** |
| **Архитектура** | 7/10 | 7.5/10 | 8.5/10 | **7.0/10** |
| **Безопасность** | 7/10 | 6.5/10 | 8.5/10 | **7.5/10** |
| **Качество кода** | 7/10 | 7/10 | 7.5/10 | **7.5/10** |
| **Тестирование** | N/A | N/A | 7.0/10 | **6.5/10** |
| **DevOps** | 6/10 | 8.5/10 | 9.0/10 | **8.2/10** |
| **Критических** | 3 | 5 | 1 | **6** |
| **Высоких** | N/A | 9 | 6 | **14** |

> **Примечание:** Staff Audit выявил *системные архитектурные проблемы* (dual service layer, non-transactional outbox, dual event bus), которые не были видны при функциональном анализе. Это снижает общую оценку, но повышает реалистичность.

---

## 🏆 VERDICT: Production-Ready с оговорками

### Что делает это приложение standout:
- ✅ Domain-driven design с CQRS (reports module)
- ✅ Event-driven архитектура (outbox, projections)
- ✅ Production-ready infrastructure (Docker, Helm, CI/CD)
- ✅ Security-first подход (bcrypt, rate limiting, CSP)
- ✅ Offline mode для полевых операторов
- ✅ Audit + compliance tracking
- ✅ Full observability stack (OTel, Sentry, Prometheus)
- ✅ Comprehensive backup & DR plan

### Что отделяет от 10/10:
- 🔴 Секреты в репозитории (MUST FIX NOW)
- 🔴 Dual service layer architectural debt
- 🔴 Non-transactional outbox (data loss risk)
- 🔴 Нет валидации факта vs плана
- 🟠 14 high-priority issues
- 🟠 7 failing unit tests
- 🟡 API routes без тестов

---

## ⚡ TOP 10 действий прямо сейчас

1. **`git rm --cached .env`** и вынести в secrets manager
2. **Исправить 7 failing tests** → CI/CD разблокирован
3. **Добавить `@@unique([userId, siteId, date])`** → предотвращение дубликатов
4. **Валидация плана** в `upsertReport` → целостность бизнеса
5. **AsyncOutbox → transactional** → reliability guarantee
6. **Fix overnight shift** → data correctness
7. **Rate limiting на reports** → DoS protection
8. **CSRF protection** → security baseline
9. **Интеграция event bus** → architectural consistency
10. **E2E тесты (5 flows)** → quality gate

**Время:** ~30 часов (2 недели full-time)  
**Влияние:** Устранение всех critical + части high проблем

---

## 📁 Артефакты аудита

Этот аудит основан на анализе:
- 5,765+ файлов проекта
- 30+ Prisma моделей
- 50+ API endpoints
- 27 unit test файлов
- 6 E2E spec файлов
- 6 GitHub Actions workflows
- Helm charts, Docker, Docker Compose
- OpenTelemetry, Sentry, Prometheus конфигурации
- Backup/DR документация
- 4 runbooks

---

*Аудит выполнен: 08.04.2026, Staff/Principal Engineer Multi-Agent Audit*  
*Следующий аудит рекомендуется через 4-6 недель после исправления критических проблем*
