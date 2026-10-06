# TEST_RESULTS — выполненные команды и результаты

**Ревизия:** `feat/safety-module` @ `054ee768` · **Дата:** 21.09.2026
**Окружение:** Windows, Node v22.22.0, npm 10.9.4. Локальные контейнеры: PostgreSQL:5435 (`pilingtrack_test`), Redis:6380. Сырые логи: `.cluster/release-audit/evidence/`.

## 1. Сборка и статические проверки

| Команда | Код возврата | Результат |
|---|---|---|
| `npm run check:layers` | 0 | `Layer boundaries: 8 grandfathered, 0 new.` |
| `npm run db:check-migrations` | 0 | `Migration guard: no un-reviewed destructive migrations` |
| `npm run lint` | 0 | `7 problems (0 errors, 7 warnings)`; `Text integrity check passed.` |
| `npx tsc --noEmit` | 0 | ошибок нет |
| `npm run build` | 0 | Next.js 16.3.5 (webpack); `Compiled successfully in 4.0min`; TypeScript `Finished ... in 66s`; 96 статических страниц; `ELAPSED_S=454` |

## 2. Тесты

| Набор | Команда | Результат | Время |
|---|---|---|---|
| Юнит | `npm run test:unit` | **2014 passed / 44 skipped** (239 файлов, 3 skipped) | 102.7 c |
| Контрактные | `npm run test:contract` | **64 passed / 13 skipped** (9 файлов) | 4.7 c |
| Интеграционные (живая БД) | `npm run test:integration` | **121 passed / 11 skipped** (11 файлов) | 8.3 c |
| E2E (базовый) | `npx playwright test e2e/app.spec.ts --project=chromium` | **4 passed / 2 failed** (нет бинарника Playwright) | 3.3 c |

**Итог автотестов:** 2199 пройдено / 68 пропущено. **С правками 22.09.2026 — 2201** (+2 теста на изоляцию отчёта по организации).

### Примеры прошедших интеграционных проверок (гонки/атомарность)
- `tech-readiness-shifts.spec.ts`: «allows exactly one of 20 parallel starts and commits one atomic evidence set» ✅
- `tech-readiness-work-permits.spec.ts`: «keeps one valid approval and no stale approval across an approval/edit race» ✅
- `tenant-transaction-pool.spec.ts` ✅

### Упавшие E2E-тесты (причина — среда)
- `login page loads and shows form` — нет исполняемого файла браузера.
- `mobile viewport renders correctly` — нет исполняемого файла браузера.
- Требуется `npx playwright install` и сид-учётки для полного прогона.

## 3. Безопасность зависимостей

| Команда | Результат |
|---|---|
| `npm audit --json` | 7 уязвимостей: 0 critical, 4 high, 3 moderate (total 7); prod-деп 553, dev 463 |

## 4. База данных

| Команда | Результат |
|---|---|
| `npx prisma migrate status` | `101 migrations found`; `Database schema is up to date!` (PostgreSQL `pilingtrack_test` @ localhost:5435) |
| `npm run db:check-migrations` | ✅ нет неразобранных разрушительных миграций |

## 5. Рантайм-пробы (локальный инстанс :3000)

| Запрос | Результат |
|---|---|
| `GET /api/health` | 200 `{"status":"ok","version":"2.8.0","uptime":57831.87}` |
| `GET /api/health/deep` | **503 Service Unavailable** (требует проверки в целевом окружении) |

## 6. Команды для повторной проверки

```bash
cd D:\PillingR\my-project
npm run check:layers && npm run db:check-migrations && npm run lint && npx tsc --noEmit
npm run test:unit && npm run test:contract && npm run test:integration
npm run build
npx playwright install && npx playwright test            # полный E2E (нужны сид-учётки)
npm audit --omit=dev
npx prisma migrate status
curl -s http://127.0.0.1:3000/api/health/deep            # ожидается 200
```

## 7. Не выполнено (и почему)
- Полный E2E по 7 ролям/техготовности — нет бинарника Playwright и сид-учёток.
- Нагрузочное тестирование (k6) — нет выделенной среды; избегаем разрушительных тестов.
- Применение миграций на пустой БД и rollback — тестовая БД уже накатана.
- Живые проверки Sentry/Telegram/S3 — внешние сервисы.
