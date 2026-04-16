# 🔍 АУДИТ ПРИЛОЖЕНИЯ PILINGTRACK

**Дата аудита:** 12 апреля 2026 г.  
**Версия:** 1.0.0  
**Технологии:** Next.js 16, React 19, TypeScript 5, Prisma 6, PostgreSQL, Redis  
**Объём аудита:** Полный стек (безопасность, качество кода, производительность, операционная готовность)

---

## 📊 СВОДКА ПО СЕРЬЁЗНОСТИ

| Уровень | Кол-во | Ключевые риски |
|---------|--------|---------------|
| 🔴 **CRITICAL** | **6** | Данные в SQLite вместо PostgreSQL; CI не пушит Docker-образы; HEALTHCHECK сломан; Plaintext PIN fallback |
| 🟠 **HIGH** | **22** | Нет README; JWT без отмены; API без авторизации; Компоненты >1000 строк; N+1 удаление сайтов |
| 🟡 **MEDIUM** | **30** | `as any` повсюду; Нет тестов core-логики; Redis connection leak; Неполная DDD-структура |
| 🟢 **LOW** | **25** | console.* вместо logger; Отсутствуют индексы; Нет CSP reporting |

**Итого: 83 замечания**

---

## 🔴 CRITICAL (6)

### C1: Данные в SQLite вместо PostgreSQL
**Файлы:** `db/custom.db`, `prisma/schema.postgres.prisma`, `src/lib/db.ts`

**Проблема:** Seed-данные загружаются в SQLite (`db/custom.db`), но приложение читает из PostgreSQL. Это было обнаружено и исправлено миграцией (`scripts/migrate-sqlite-to-pg.js`), но корневая причина не устранена — seed-скрипт по-прежнему использует SQLite-клиент.

**Воздействие:** Любой новый разработчик или CI-пайплайн запустит seed в SQLite и получит пустой UI.

**Решение:** Изменить `prisma/seed.ts` на импорт из `src/generated/postgres-client` и запуск с `--schema prisma/schema.postgres.prisma`.

---

### C2: CI не пушит Docker-образы
**Файл:** `.github/workflows/ci-cd.yml`, строка 192

```yaml
docker:
  push: false  # ← ОБРАЗЫ НИКОГДА НЕ ПУБЛИКУЮТСЯ
```

**Проблема:** `deploy-k8s.yml` ожидает образы в `ghcr.io/pilingtrack/pilingtrack:${{ github.sha }}`, но CI собирает образы с `push: false`. Деплой **невозможен**.

**Воздействие:** Полный разрыв CI/CD — образы не попадают в реестр, Kubernetes не может их забрать.

**Решение:** Добавить шаг `docker push` после сборки или использовать `docker/metadata-action` + `docker/build-push-action` с `push: true`.

---

### C3: HEALTHCHECK сломан в Dockerfile
**Файлы:** `Dockerfile` (строка 38), `Dockerfile.prod` (строка 75)

**Проблема:**
- `Dockerfile`: `HEALTHCHECK wget ...` — `wget` не установлен в Alpine-образе
- `Dockerfile.prod`: `HEALTHCHECK wget ...` — установлен только `curl`, а также отсутствует ключевое слово `CMD`

**Воздействие:** Health check всегда возвращает failure → оркестратор считает контейнер unhealthy → перезапускает бесконечно.

**Решение:**
```dockerfile
# Dockerfile
RUN apk add --no-cache wget
HEALTHCHECK --interval=30s --timeout=5s CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health

# Dockerfile.prod
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:3000/api/health
```

---

### C4: Plaintext PIN comparison fallback
**Файл:** `src/services/auth/auth-service.ts`, строки 208-209, 239-240

```typescript
const matches = isBcrypt
  ? await bcryptCompare(pin, indexedCandidate.pin)
  : pin === indexedCandidate.pin;  // ← ПРЯМОЕ СРАВНЕНИЕ СТРОК
```

**Проблема:** Legacy-пользователи с plaintext PIN хранятся в базе открытым текстом. Прямое сравнение строк уязвимо к timing-атакам (посимвольный перебор).

**Воздействие:** При утечке базы — мгновенная компрометация всех legacy PIN. Timing-атака позволяет перебирать PIN удалённо.

**Решение:** Принудительная миграция всех plaintext PIN в bcrypt. Удалить ветку `pin === indexedCandidate.pin`.

---

### C5: Нет отмены JWT session-токенов
**Файл:** `src/services/auth/session-service.ts`

**Проблема:** Session JWT живёт 12 часов без `jti` (JWT ID) и без списка отзыва. Если токен украден — единственный способ отменить — ждать 12 часов.

**Воздействие:** Скомпрометированный токен нельзя отозвать досрочно.

**Решение:** Добавить `jti` claim + Redis-based revocation list (TTL = оставшееся время жизни токена).

---

### C6: Проверка `NEXTAUTH_SECRET` вместо `SESSION_SECRET`
**Файл:** `src/core/observability/health-checks.ts`, строка 78

**Проблема:** Health check проверяет переменную `NEXTAUTH_SECRET`, которой нет в `.env`. Реальная переменная — `SESSION_SECRET`. Health check всегда возвращает `warn`.

**Воздействие:** Health check всегда degraded → мониторинг показывает ложные алерты → alert fatigue.

**Решение:** Заменить проверку на `SESSION_SECRET`.

---

## 🟠 HIGH (22)

### H1: Нет README.md
**Статус:** Отсутствует `README.md` в корне проекта.

Без README невозможно: онбординг новых разработчиков, понимание архитектуры, инструкция по запуску.

### H2: API `/api/metrics` и `/api/openapi` без авторизации
**Файлы:** `src/app/api/metrics/route.ts`, `src/app/api/openapi/route.ts`

`/api/metrics` раскрывает внутреннюю память, статус бэкапов, S3. `/api/openapi` — полную спецификацию API.

### H3: Компоненты >1000 строк
| Файл | Строк |
|------|-------|
| `admin-reports/admin-reports.tsx` | 1267 |
| `report-form.tsx` | 1188 |
| `admin-crews.tsx` | 848 |

### H4: N+1 удаление сайтов
**Файл:** `src/services/sites/site-admin-service.ts`, строка 211

```typescript
const reports = await tx.report.findMany({ where: { siteId: id } });
for (const report of reports) {
  await tx.pileWork.deleteMany({ where: { reportId: report.id } });
  await tx.leaderDrilling.deleteMany({ where: { reportId: report.id } });
  await tx.reportDowntime.deleteMany({ where: { reportId: report.id } });
}
```

Для сайта с 1000 отчётами: 1 SELECT + 3000 DELETE.

### H5: ~200+ вхождений `any` в TypeScript
Критичные зоны:
- `src/mobile/sync/sync-engine.ts` — вся синхронизация нетипизирована (`reports: any[]`)
- `src/services/auth/auth-service.ts` — `(db.user as any).findUnique` — обход Prisma типов
- `src/services/reports/outbox-publisher.ts` — массовое `as any` для динамических запросов

### H6: `as any` — 113+ вхождений
Обход типизации повсеместно: auth, outbox, event-bus, WS-server, cached-queries.

### H7: Нет unit-тестов для core business logic
Отсутствуют тесты для: `auth-service.ts`, `user-service.ts`, `site-admin-service.ts`, `telemetry-ingestion`, `PDF generation`.

### H8: Fire-and-forget event handlers
**Файл:** `src/services/reports/domain-events.ts`

```typescript
this.handlers.get(eventType)!.forEach(handler => handler(event).catch(() => {}));
```

Ошибки в обработчиках событий глотаются → данные могут теряться молча.

### H9: `registerAllEventHandlers` без await
**Файл:** `src/services/reports/domain-events.ts`, строки 108-116

```typescript
import('./handlers/...').then(m => m.register());
```

Handlers регистрируются асинхронно. Запрос может прийти до регистрации обработчиков → события теряются.

### H10: MUTATION_RATE_LIMIT дублируется в 30+ файлах
Одинаковый boilerplate rate-limiting в каждом API-роуте. Должен быть в middleware.

### H11: Catch-ServiceError-500 дублируется в 39+ файлах
Каждый route handler содержит идентичный блок обработки ошибок.

### H12: Глубокие nested includes без лимитов
**Файл:** `src/lib/cached-queries.ts`

```typescript
// Строка 65 — глубокий include без лимита
fields: { include: { clusters: { include: { pickets: {} } } } }

// Строка 134 — все child arrays без лимита
include: { piles: true, drillings: true, downtimes: true }
```

### H13: `listUsers` без пагинации
**Файл:** `src/services/users/user-service.ts`, строка 17

```typescript
return db.user.findMany({ where });  // Все пользователи сразу
```

### H14: Блокировка при удалении сайта
**Файл:** `src/services/sites/site-admin-service.ts`

Удаление сайта загружает ВСЕ отчёты в память, затем удаляет по одному. Для крупного сайта — OOM.

### H15: WebSocket без rate limiting
**Файл:** `package.json` — `ws: 8.20.0`

WebSocket-сервер не имеет rate limiting. Атакующий может открыть тысячи соединений.

### H16: `bcryptjs` вместо `bcrypt`
**Файл:** `package.json`

Pure-JS реализация в 3-5 раз медленнее. При нагрузке 100 login/sec — DoS-вектор.

### H17: Redis `invalidatePattern` — async callback не awaited
**Файл:** `src/lib/redis-cache.ts`, строка 179

```typescript
stream.on('data', async (keys) => { await client.del(keys); });
```

`stream` не ждёт завершения `del` → batches накладываются → Redis overload.

### H18: Mutex race condition в cache-aside
**Файл:** `src/lib/cache-strategies.ts`, строка 109

После acquire mutex, если retry всё ещё miss — compute идёт без lock. Multiple requests race.

### H19: `revalidateInBackground` без backpressure
**Файл:** `src/lib/cache-strategies.ts`, строки 215-228

`setImmediate` + fire-and-forget async → множество фоновых ревалидаций конкурируют за ресурсы.

### H20: `getSiteDailySummary` — `$queryRawUnsafe`
**Файл:** `src/lib/db-optimization.ts`, строка 151

Если `siteId` или `date` не валидированы — SQL injection.

### H21: Docker builder image содержит секреты
**Файл:** `Dockerfile`, строка 22

`SESSION_SECRET` и `DATABASE_URL_POSTGRES` передаются как build args и остаются в промежуточных слоях образа.

### H22: soak test timeout превышает лимит GitHub Actions
**Файл:** `.github/workflows/performance.yml`, строка 107

Timeout: 480 мин. Лимит GHA: 360 мин. Тест всегда убивается.

---

## 🟡 MEDIUM (30)

### M1: Неравномерная DDD-структура модулей
| Модуль | Domain | Application | Infrastructure | API |
|--------|--------|------------|----------------|-----|
| Reports | ✅ | ✅ | ✅ | ✅ |
| Users | ❌ |  | ❌ |  |
| Crews | ✅ | ✅ | ✅ | ❌ |
| Sites | ✅ | ✅ | ✅ | ❌ |
| Equipment | ✅ | ✅ | ✅ | ❌ |

Reports — полная DDD. Users — всё в `src/services/`. Остальные — гибриды.

### M2: `src/lib/` — 41 файл в одной папке
Смешаны: утилиты, кэш, валидация, middleware, pagination, PDF-queue, rate-limiter.

### M3: Пустые catch-блоки
| Файл | Строки |
|------|--------|
| `domain-events.ts` | 127-129 — `.catch(() => {})` |
| `redis-cache.ts` | 62 — `console.error` без проброса |
| `rate-limiter.ts` | 134 — fallback без алерта |

### M4: 87+ вхождений `console.error/warn/log`
Должно использоваться `logger` из `@/lib/logger` (pino).

### M5: Non-null assertions `!` на nullable полях
| Файл | Строка | Поле |
|------|--------|------|
| `auth-service.ts` | 254 | `matchedUser.pin!` — pin может быть null |
| `rate-limiter.ts` | 330 | `this.redis!` — redis может быть null |
| `event-bus.ts` | 108, 209 | `handlers.get(eventType)!` |

### M6: Некоторые API без Zod-валидации
`/api/telemetry/ingest`, `/api/openapi`, `/api/sync` — не используют Zod.

### M7: Нет тестов для WebSocket server
Нет тестов для `src/realtime/server/ws-server.ts`.

### M8: Нет тестов для workers
Нет тестов для `outbox-worker.ts`, `projection-worker.ts`, `pdf-worker.ts`.

### M9: JSDoc отсутствует в services layer
`src/services/` — минимальные или отсутствующие комментарии.

### M10: Нет Swagger UI
OpenAPI endpoint существует, но только как raw JSON.

### M11: `src/lib/redis-cache.ts` — singleton без null guard on error
Если `connect()` падает — `redisClient` остаётся assigned. Последующие вызовы получают broken client.

### M12: `CACHE_MAX_RETRIES = 2` — слишком агрессивно
Redis transient failures быстро пробивают circuit breaker.

### M13: Отсутствуют индексы на dictionary-таблицах
`PileGrade`, `DrillingType`, `DowntimeReason` — нет индексов вообще, включая `isActive`.

### M14: Нет индекса на `SitePilePlan.pileGradeId`
FK без индекса → full scan при join.

### M15: `image` конфиг отсутствует в `next.config.ts`
Нет WebP/AVIF оптимизации, нет `minimumCacheTTL`, нет `deviceSizes`.

### M16: `ENCRYPTION_KEY` не валидируется
В `.env.example` отмечен как required, но `validate-env.ts` не проверяет.

### M17: `REDIS_URL` без проверки auth
Валидатор принимает любой `redis://` URL, не предупреждает об отсутствии пароля.

### M18: Monitoring ожидает exporters, которых нет
`prometheus.yml` — `postgres-exporter:9187` и `redis-exporter:9121` не определены в docker-compose.

### M19: Postgres pool alert threshold не совпадает
`alerts.yml`: порог ≥ 90. `docker-compose.yml`: `max_connections=200`. Должно быть ≥ 180.

### M20: `docker-compose.production.yml` — нет Redis
Приложение требует Redis для production, но Redis не включён в production compose.

### M21: Redundant resource limits в production compose
И `deploy.resources.limits` и `mem_limit`/`cpus` одновременно — путаница.

### M22: `imagePullSecrets` не настроен в Helm
Если образы в ghcr.io (private registry) — деплой упадёт.

### M23: `readOnlyRootFilesystem: false` в Helm
Снижает security posture pod'ов.

### M24: Sentry server config без `ignoreErrors`
Нет фильтрации server-side noise (aborted requests, ECONNRESET).

### M25: No production push workflow
Нет workflow для автоматического промоушна staging → production.

### M26: `dangerouslySetInnerHTML` в chart component
**Файл:** `src/components/ui/chart.tsx`, строка 83

Не эксплуатировано сейчас, но если theme data станет user-controllable — XSS.

### M27: Timing-based user enumeration
Login без dummy bcrypt для несуществующих пользователей → timing difference.

### M28: Failed login логирует email
Создаёт список валидных email в логах.

### M29: Conflicting X-Frame-Options
`next.config.ts`: `SAMEORIGIN`. `middleware.ts`: `DENY`.

### M30: No CSP `report-uri`
CSP violations блокируются silently — security team не получает уведомлений.

---

## 🟢 LOW (25)

### L1: `@ts-expect-error` для mqtt (оправдано)
**Файл:** `src/services/telemetry/mqtt-ingestion-service.ts`

### L2: `as any` в AsyncLocalStorage
**Файл:** `src/lib/request-context.ts`, строка 174

### L3: `find()!.value` без null check
**Файл:** `src/lib/timezone-utils.ts`, строки 53-55

### L4: Тесты используют `as any`
`validation-schemas.test.ts` — 10+ кастов для обхода типизации.

### L5: `tests/chaos/` — пустая директория
Chaos tests заявлены, но не реализованы.

### L6: In-memory cacheStats не thread-safe
В multi-instance Node.js кластере stats будут некорректны.

### L7: `ws` dependency без отдельного rate limiting

### L8: CORS subdomain wildcard
Если `*.example.com` — любой subdomain может делать запросы.

### L9: Disk check stub в health-checks
**Файл:** `src/core/observability/health-checks.ts`, строка 68

### L10: `tracesSampleRate: 0.1` в Sentry
Только 10% трасс — можно пропустить интермиттентные баги.

### L11: `validate-env.ts` — нет проверки длины SESSION_SECRET
Секрет может быть слишком коротким.

### L12: HSTS только в production
Правильно, но стоит закомментировать в dev-инструкции.

### L13: Service Worker cache headers правильные
`no-cache, no-store, must-revalidate` — ✅

### L14: PWA manifest cache правильный
`max-age=3600` — ✅

### L15: `allowedDevOrigins` правильно настроен

### L16: `reactStrictMode: true` — ✅

### L17: `ignoreBuildErrors: false` — ✅

### L18: `output: standalone` — ✅

### L19: `typescript` build strict — ✅

### L20: Health endpoint трёхуровневый (health/ready/live) — ✅

### L21: Refresh token rotation с family tracking — ✅

### L22: Multi-tenant access control — ✅

### L23: Rate limiter с Redis + Lua — ✅

### L24: Zod schemas comprehensive (355 строк) — ✅

### L25: 6 ADR в `docs/adr/` — ✅

---

##  ПРИОРИТЕТЫ ИСПРАВЛЕНИЙ

### Спринт 1 (Немедленно — блокирующие)
1. **C2**: Исправить CI — добавить `push: true` для Docker-образов
2. **C3**: Починить HEALTHCHECK в Dockerfile и Dockerfile.prod
3. **C1**: Перевести seed на PostgreSQL
4. **C5**: Добавить JWT revocation через Redis
5. **C4**: Удалить plaintext PIN comparison

### Спринт 2 (Критично — неделя)
6. **C6**: Исправить проверку `SESSION_SECRET` в health-checks
7. **H1**: Создать README.md
8. **H2**: Закрыть `/api/metrics` и `/api/openapi` авторизацией
9. **H4**: Исправить N+1 удаление сайтов
10. **H12**: Добавить лимиты на nested includes

### Спринт 3 (Важно — 2 недели)
11. **H3**: Разбить компоненты >1000 строк
12. **H5-H6**: Убрать `any` и `as any` из auth и sync
13. **H7**: Добавить unit-тесты для auth-service и user-service
14. **H8-H9**: Исправить fire-and-forget event handlers
15. **H10-H11**: Вынести boilerplate в middleware

### Спринт 4 (Рекомендуемо — месяц)
16. **M1**: Унифицировать DDD-структуру модулей
17. **M3-M4**: Заменить console.* на logger
18. **M6**: Добавить Zod-валидацию на все API
19. **M13-M14**: Добавить недостающие индексы
20. **M18-M20**: Настроить monitoring exporters и production compose

---

## ✅ ЧТО СДЕЛАНО ХОРОШО

| Область | Оценка |
|---------|--------|
| **Безопасность** | Rate limiting (Redis+Lua), refresh token rotation, multi-tenant isolation, CSP headers, HSTS, Zod validation |
| **Архитектура** | DDD в reports module, CQRS (outbox + projections), event-bus, conflict resolution engine |
| **DevOps** | Multi-stage Docker, Helm chart с PDB/HPA/NetworkPolicy, CI/CD pipeline с 7 стадиями |
| **Observability** | OpenTelemetry, Sentry, Pino logging, health/readiness/liveness probes, Prometheus alerts |
| **Testing** | 36 unit тестов, E2E smoke tests, k6 load tests, Lighthouse CI |
| **Documentation** | 6 ADR, disaster recovery plan, runbooks, Kubernetes deployment guide |

---

## 📈 ОБЩАЯ ОЦЕНКА

| Категория | Балл | Комментарий |
|-----------|------|-------------|
| Безопасность | 6/10 | Хорошая база, но критичные пробелы (JWT revocation, plaintext PIN) |
| Качество кода | 5/10 | Много `any`/`as any`, огромные компоненты, дублирование boilerplate |
| Производительность | 7/10 | Caching, индексация, pagination — в целом хорошо, но есть N+1 и unbounded queries |
| Операционная готовность | 6/10 | Helm, CI/CD, monitoring — но CI не пушит образы, healthcheck сломан |
| Тестирование | 5/10 | Инфраструктура протестирована, core business logic — нет |
| **ОБЩИЙ** | **5.8/10** | **Рабочий продукт с серьёзными техническими долгами** |

---

*Аудит проведён 12 апреля 2026 г. Автоматизированными агентами + ручной анализ.*
