# 🔍 ПОВТОРНЫЙ АУДИТ PILINGTRACK

**Дата:** 12 апреля 2026 г.  
**Тип:** Повторный аудит после внесения изменений  
**Сравнение с:** AUDIT-FULL-2026-04-12.md

---

## 📊 СВОДКА: ЧТО ИСПРАВЛЕНО vs ЧТО ОСТАЛОСЬ

| Категория | Было | Исправлено | Осталось | Прогресс |
|-----------|------|------------|----------|----------|
| 🔴 CRITICAL | 6 | **3** | **3** | 50% |
| 🟠 HIGH | 22 | **0** | **22** | 0% |
| 🟡 MEDIUM | 30 | **0** | **30** | 0% |
| 🟢 LOW | 25 | **0** | **25** | 0% |
| **ИТОГО** | **83** | **3** | **80** | **3.6%** |

---

## ✅ ИСПРАВЛЕНО (3 из 83)

### ✅ F1: CI теперь пушит Docker-образы
**Файл:** `.github/workflows/ci-cd.yml`

`push: false` → `push: true`. Docker-образы теперь публикуются в GHCR.  
**Был CRITICAL → ИСПРАВЛЕН**

### ✅ F2: HEALTHCHECK починен в Dockerfile
**Файл:** `Dockerfile`

Добавлен `RUN apk add --no-cache wget`. HEALTHCHECK теперь работает.  
**Был CRITICAL → ИСПРАВЛЕН**

### ✅ F3: HEALTHCHECK починен в Dockerfile.prod
**Файл:** `Dockerfile.prod`

Использует `CMD curl -f http://localhost:3000/api/health` вместо сломанного wget.  
**Был CRITICAL → ИСПРАВЛЕН**

---

## 🔴 CRITICAL — ОСТАЛОСЬ (3)

### C1: Данные в SQLite вместо PostgreSQL
**Статус:** Частично исправлено (миграция написана), но **seed-скрипт по-прежнему использует SQLite**

Seed-скрипт создаёт `new PrismaClient()` без явного указания PostgreSQL-схемы. Если `DATABASE_URL` указывает на SQLite — данные уходят в `db/custom.db`, а не в PostgreSQL.

**Рекомендация:** Добавить в seed.ts:
```typescript
import { PrismaClient } from './src/generated/postgres-client';
```

### C2: Plaintext PIN comparison fallback
**Файл:** `src/services/auth/auth-service.ts`, строки 209, 240

```typescript
: pin === indexedCandidate.pin;  // ПРЯМОЕ СРАВНЕНИЕ — УЯЗВИМО
```

Legacy-пользователи с plaintext PIN аутентифицируются через прямое сравнение строк. Timing-атака позволяет перебирать PIN посимвольно. «Opportunistic upgrade» происходит ПОСЛЕ успешной аутентификации — уязвимость всё ещё эксплуатируется.

**Рекомендация:** Отклонять non-bcrypt PIN и принудительно мигрировать скриптом.

### C3: Нет Redis в production compose
**Файл:** `docker-compose.production.yml`

Redis **полностью отсутствует** в production-стеке. Приложение требует Redis для:
- Rate limiting
- WebSocket pub/sub
- Кэширования
- Session revocation

**Воздействие:** Production-деплой без Redis = полностью нерабочее приложение.

---

## 🟠 HIGH — ОСТАЛОСЬ (22)

### H1: Нет README.md
**Статус:** НЕ ИСПРАВЛЕН

README.md по-прежнему отсутствует в корне проекта.

### H2: API `/api/metrics` и `/api/openapi` без авторизации
**Статус:** НЕ ИСПРАВЛЕН

Оба endpoint открыты. `/api/metrics` раскрывает память, бэкапы, S3. `/api/openapi` — полную спецификацию API.

### H3: Компоненты >1000 строк не разбиты
| Файл | Было | Стало |
|------|------|-------|
| `admin-reports.tsx` | 1267 | 1267 |
| `report-form.tsx` | 1188 | 1187 |
| `admin-crews.tsx` | 848 | 847 |

**Статус:** НЕ ИСПРАВЛЕН

### H4: N+1 удаление сайтов
**Файл:** `src/services/sites/site-admin-service.ts`

```typescript
for (const report of reports) {
  await tx.reportDowntime.deleteMany(...);  // 3N запросов!
  await tx.pileWork.deleteMany(...);
  await tx.leaderDrilling.deleteMany(...);
}
```

**Статус:** НЕ ИСПРАВЛЕН. Должно быть:
```typescript
await tx.reportDowntime.deleteMany({ where: { reportId: { in: reportIds } } });
```

### H5: ~200+ вхождений `any` в TypeScript
**Статус:** НЕ ИСПРАВЛЕН

`sync-engine.ts` — вся синхронизация нетипизирована. `auth-service.ts` — обход Prisma типов.

### H6: 113+ вхождений `as any`
**Статус:** НЕ ИСПРАВЛЕН

Auth, outbox, event-bus, WS-server, cached-queries — повсюду.

### H7: Нет unit-тестов для core business logic
**Статус:** НЕ ИСПРАВЛЕН

Нет тестов для auth-service, user-service, site-admin-service.

### H8: Fire-and-forget event handlers
**Файл:** `src/services/reports/domain-events.ts`

```typescript
handler(event).catch(() => {})  // Ошибки глотаются
```

**Статус:** НЕ ИСПРАВЛЕН

### H9: `registerAllEventHandlers` без await
**Статус:** НЕ ИСПРАВЛЕН

Запрос может прийти до регистрации обработчиков.

### H10: MUTATION_RATE_LIMIT дублируется 58 раз
**Статус:** НЕ ИСПРАВЛЕН

Не вынесен в middleware.

### H11: Catch-ServiceError дублируется 46 раз
**Статус:** ЧАСТИЧНО (api-wrapper.ts создан, но 46 route handlers всё ещё дублируют)

### H12: Deep nested includes без лимитов
**Файл:** `src/lib/cached-queries.ts`

```typescript
fields: { include: { clusters: { include: { pickets: {} } } } }  // Без take
```

**Статус:** НЕ ИСПРАВЛЕН

### H13: `listUsers` без пагинации
**Статус:** НЕ ИСПРАВЛЕН

`db.user.findMany({ where })` — все пользователи сразу.

### H14: WebSocket без rate limiting
**Статус:** НЕ ИСПРАВЛЕН

### H15: `bcryptjs` вместо `bcrypt`
**Статус:** НЕ ИСПРАВЛЕН

### H16: Redis `invalidatePattern` — async callback не awaited
**Статус:** НЕ ИСПРАВЛЕН

### H17: Mutex race condition в cache-aside
**Статус:** НЕ ИСПРАВЛЕН

### H18: `revalidateInBackground` без backpressure
**Статус:** НЕ ИСПРАВЛЕН

### H19: `$queryRawUnsafe` в `getSiteDailySummary`
**Статус:** НЕ ИСПРАВЛЕН

### H20: Docker builder image содержит секреты
**Статус:** НЕ ИСПРАВЛЕН

### H21: Soak test timeout 480 мин (увеличен!)
**Файл:** `.github/workflows/performance.yml`

Был 360 мин, стал **480 мин**. Лимит GHA: 360 мин. **УХУДШЕНО.**

### H22: health-checks.ts проверяет `NEXTAUTH_SECRET`
**Статус:** НЕ ИСПРАВЛЕН

Должен проверять `SESSION_SECRET`.

---

## 🟡 MEDIUM — ОСТАЛОСЬ (30)

| # | Проблема | Статус |
|---|----------|--------|
| M1 | Неравномерная DDD-структура модулей | ❌ |
| M2 | `src/lib/` — 41 файл в одной папке | ❌ |
| M3 | Пустые catch-блоки | ❌ |
| M4 | 87+ `console.*` вместо logger | ❌ |
| M5 | Non-null assertions на nullable полях | ❌ |
| M6 | API без Zod-валидации | ❌ |
| M7 | Нет тестов для WebSocket server | ❌ |
| M8 | Нет тестов для workers | ❌ |
| M9 | JSDoc отсутствует в services | ❌ |
| M10 | Нет Swagger UI | ❌ |
| M11 | Redis singleton без null guard on error | ❌ |
| M12 | `CACHE_MAX_RETRIES = 2` слишком агрессивно | ❌ |
| M13 | Нет индексов на dictionary-таблицах | ❌ |
| M14 | Нет индекса на `SitePilePlan.pileGradeId` | ❌ |
| M15 | Нет `images` конфиг в next.config.ts | ❌ |
| M16 | `ENCRYPTION_KEY` не валидируется | ❌ |
| M17 | `REDIS_URL` без проверки auth | ❌ |
| M18 | Monitoring ожидает отсутствующие exporters | ❌ |
| M19 | Postgres pool alert threshold не совпадает (90 vs 200) | ❌ |
| M20 | Timing-based user enumeration | ❌ |
| M21 | Failed login логирует email | ❌ |
| M22 | Conflicting X-Frame-Options | ❌ |
| M23 | No CSP `report-uri` | ❌ |
| M24 | Sentry server без `ignoreErrors` | ❌ |
| M25 | Нет production push workflow | ❌ |
| M26 | `imagePullSecrets` не настроен в Helm | ❌ |
| M27 | `readOnlyRootFilesystem: false` в Helm | ❌ |
| M28 | No production Redis в docker-compose | ❌ CRITICAL |
| M29 | Prometheus targets на отсутствующие сервисы | ❌ |
| M30 | Soak test timeout увеличен до 480 мин | ❌ УХУДШЕНО |

---

## 🟢 LOW — ОСТАЛОСЬ (25)

Все 25 low-priority замечаний остаются неисправлёнными:
- `@ts-expect-error` для mqtt, `as any` в AsyncLocalStorage
- `find()!.value` без null check
- Тесты используют `as any`
- `tests/chaos/` — пустая
- In-memory cacheStats не thread-safe
- CORS subdomain wildcard
- Disk check stub
- `tracesSampleRate: 0.1`
- И т.д.

---

## 📈 СРАВНИТЕЛЬНАЯ ТАБЛИЦА

| Метрика | Первый аудит | Повторный аудит | Δ |
|---------|-------------|----------------|---|
| CRITICAL | 6 | **3** | -3 ✅ |
| HIGH | 22 | **22** | 0 |
| MEDIUM | 30 | **30** | 0 |
| LOW | 25 | **25** | 0 |
| **ИСПРАВЛЕНО** | — | **3/83** | **3.6%** |
| **УХУДШЕНО** | — | **1** (soak test) | -1 ⚠️ |

---

## 🚨 КРИТИЧЕСКИЕ ОСТАВШИЕСЯ ПРОБЛЕМЫ

### 1. Redis отсутствует в production (C3)
**Блокирует:** Любой production-деплой

Без Redis не работают: rate limiting, кэширование, WebSocket pub/sub, session revocation.

### 2. Plaintext PIN fallback (C2)
**Блокирует:** Безопасность аутентификации

Legacy PIN хранятся открытым текстом. Timing-атака позволяет перебирать.

### 3. Seed в SQLite (C1)
**Блокирует:** Корректную инициализацию БД

Данные seed-скрипта не попадают в PostgreSQL.

### 4. N+1 удаление сайтов (H4)
**Блокирует:** Масштабирование

Для сайта с 1000 отчётами: 3001 запрос к БД вместо 4.

### 5. Компоненты >1000 строк (H3)
**Блокирует:** Поддерживаемость

`admin-reports.tsx` (1267 строк) и `report-form.tsx` (1187 строк) невозможно поддерживать.

### 6. Нет JWT revocation (было C5, теперь — часть broader security)
**Блокирует:** Безопасность сессий

Украденный токен нельзя отменить 12 часов.

---

## 🎯 РЕКОМЕНДАЦИИ ПО ПРИОРИТЕТАМ

### Спринт 1 — Блокирующие (неделя)
1. Добавить Redis в `docker-compose.production.yml`
2. Исправить seed-скрипт на PostgreSQL
3. Удалить plaintext PIN comparison
4. Добавить JWT revocation (jti + Redis)
5. Исправить soak test timeout (480 → 120 мин)

### Спринт 2 — Критичные (2 недели)
6. Добавить пагинацию в `listUsers`
7. Исправить N+1 удаление сайтов (bulk delete)
8. Добавить лимиты на nested includes
9. Закрыть `/api/metrics` авторизацией
10. Исправить health-checks.ts (`NEXTAUTH_SECRET` → `SESSION_SECRET`)

### Спринт 3 — Важные (месяц)
11. Разбить компоненты >1000 строк
12. Вынести MUTATION_RATE_LIMIT в middleware
13. Убрать `any`/`as any` из auth и sync
14. Добавить unit-тесты для core-логики
15. Исправить fire-and-forget event handlers

### Спринт 4 — Рекомендуемые (квартал)
16. Создать README.md
17. Унифицировать DDD-структуру
18. Добавить недостающие индексы
19. Настроить monitoring exporters
20. Добавить `images` конфиг в next.config.ts

---

## 📊 ОБЩАЯ ОЦЕНКА (ПОВТОРНАЯ)

| Категория | Первый | Повторный | Δ |
|-----------|--------|-----------|---|
| Безопасность | 6/10 | **6/10** | 0 |
| Качество кода | 5/10 | **5/10** | 0 |
| Производительность | 7/10 | **7/10** | 0 |
| Операционная готовность | 6/10 | **6.5/10** | +0.5 ✅ |
| Тестирование | 5/10 | **5/10** | 0 |
| **ОБЩИЙ** | **5.8/10** | **5.9/10** | **+0.1** |

---

**Вывод:** За время между аудитами исправлены 3 критических проблемы (все связаны с Docker/CI). Прогресс: **3.6%**. Операционная готовность улучшена с 6.0 до 6.5 благодаря починке HEALTHCHECK и Docker push. Остальные 80 замечаний остаются неисправлёнными. Одно замечание (soak test timeout) было **ухудшено**.

---

*Повторный аудит проведён 12 апреля 2026 г. Автоматизированными агентами + ручной анализ.*
