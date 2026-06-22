# Полный релизный аудит PilingTrack

Дата: 21.06.2026  
Режим: QA Council Level 3, 25 экспертных ролей  
Объект: текущая рабочая копия `C:\PillingR\my-project`  
Вердикт: **NO-GO до закрытия P1**

> **Поправка (2026-06-21, по итогам проверки кода):** в проде `MULTI_TENANT_MODE=single` (`.env:7`), поэтому P1 «tenant isolation» и P1 «RLS permissive» в текущей single-tenant установке **не эксплуатируемы** и понижаются до «долг до подключения второго тенанта» (см. §8) — это не блокеры сегодняшнего релиза. Реальные блокеры single-tenant прода: целостность KPI (метры свай), `npm audit` high, off-site backup. С учётом этого Security 61/100 и общий 66/100 пессимистичны.

## 1. Область проверки

- Архитектура Next.js 16, API, Prisma/PostgreSQL, Redis, workers, WebSocket.
- Авторизация, роли, CSRF, tenant isolation, RLS, загрузка файлов.
- Дашборд, мониторинг, установки, ТО, отчёты и доказательная база.
- Достоверность производственных показателей: сваи, м.п., бурение, простой.
- CI/CD, миграции, контейнеры, резервное копирование и откат.
- Unit, contract, integration, browser smoke, coverage, dependency audit.
- GitNexus: 8893 символа, 19804 связи, 300 процессов; индекс отстаёт на 18 коммитов, FTS недоступен.
- Obsidian: vault существует, но продуктовая база практически пуста; достоверным источником остаются код и `docs/`.

Продакшен-сервер и фактическое состояние его БД не проверялись. Выводы о production основаны на репозитории и локальном приложении.

## 2. Executive Verdict

PilingTrack уже имеет серьёзную инженерную основу: production build проходит, 1142 теста зелёные, CSRF централизован, cookie защищён, CSP и security headers настроены, основные сущности tenant-aware, есть audit/outbox/workers, runbooks и резервное копирование.

Главная проблема перед релизом не в интерфейсе. Сейчас нельзя доказать изоляцию арендаторов на реальной БД, автоматический deploy способен пропустить новую миграцию, а часть производственных KPI вычисляется из текста справочника. Одновременно dependency audit содержит high vulnerability, а критические runtime-слои имеют низкое покрытие.

## 3. Critical Findings

### P1. Tenant isolation допускает межtenant-доступ привилегированных рабочих ролей

**Доказательство:**

- `src/services/auth/resource-access-service.ts:65-95`: `ADMIN` и `DISPATCHER` обходят tenant-проверку полностью.
- `src/app/api/crews/all/route.ts:25-29`: список бригад фильтруется по tenant только для ролей, отличных от `ADMIN`/`DISPATCHER`.
- `tests/integration/tenant-isolation.spec.ts:39-45`: тест закрепляет право admin переключиться с `t-acme` на `t-other` по переданному header override.
- GitNexus: изменение `ensureTenantAccess` имеет HIGH blast radius, 5 затронутых символов и процессы PDF/бригад.

**Риск:** администратор или диспетчер одной организации может получить ресурсы другой организации. Если эти роли задуманы глобальными, продукту не хватает отдельной роли `SUPER_ADMIN` и явной модели доверия.

**До релиза:** отделить tenant-admin от platform-admin; запретить header/query override обычным ролям; добавить реальные cross-tenant API-тесты.

### P1. PostgreSQL RLS работает в permissive audit mode, а не fail-closed

**Доказательство:**

- `prisma/migrations/20260425000000_enable_rls_foundation/migration.sql:1-14`: политика прямо объявлена audit mode.
- Политики разрешают строки, если `app.current_tenant` не установлен или пуст.
- `src/lib/tenant-middleware.ts:44-50`: ошибка установки tenant-контекста только логируется, запрос продолжается.
- `tests/integration/tenant-isolation.spec.ts:9-11`: PostgreSQL мокируется, реальная RLS не проверяется.

**Риск:** любой пропущенный application-level фильтр становится утечкой данных, потому что БД не блокирует запрос.

**До релиза:** реальный Postgres test matrix для двух tenant; fail-closed RLS; транзакционный `SET LOCAL`; отдельный сервисный контекст для системных workers.

### P1. Автоматический production deploy может запустить код без новой схемы

**Доказательство:**

- `.github/workflows/deploy.yml:41-49`: выполняются `git pull`, `docker compose build` и `up`, но не гарантируется rebuild сервиса `migrate`.
- `docs/runbooks/008-manual-deploy.md:59-72`: документирован уже случившийся инцидент, когда stale migrate image завершился успешно без применения миграции.
- Workflow разворачивает mutable `main`, а не проверенный commit/image digest; rollback требует повторной сборки.

**Риск:** приложение начинает обслуживать запросы с несовместимой схемой; откат медленный и недетерминированный.

**До релиза:** deploy по SHA; обязательный fresh migrate image; verify последней `_prisma_migrations`; immutable image registry; автоматический rollback по failed readiness.

### P1. Метры свай в Fleet Snapshot вычисляются из названия марки

**Доказательство:**

- `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:214-217`: берутся первые три цифры regex `\d{3}` и делятся на 10.
- `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:251-253`: результат участвует в `pileMeters` карточки установки.

**Риск:** переименование марки, иной формат (`С120-30`, `12 м`, артикул с цифрами) незаметно меняет KPI дашборда и установок. Доказательная база отчёта и управленческая аналитика могут расходиться.

**До релиза:** единое нормализованное поле длины сваи или сохранение фактических м.п. в отчёте; backfill; invariant-тесты между отчётом, аналитикой, dashboard и FleetCard.

### P1. Production dependency audit содержит уязвимости

`npm audit --omit=dev`: 29 уязвимостей, включая 1 high в `protobufjs`, 27 moderate в цепочке OpenTelemetry/Sentry и advisory для Babel. Исправление observability-цепочки требует обновления с проверкой совместимости.

**До релиза:** обновить lockfile контролируемым PR; повторить build/unit/e2e; проверить ingestion telemetry и Sentry source maps.

### P1. Критические runtime-слои не имеют достаточного доказательного покрытия

Coverage: statements 24,92%, branches 20,87%, functions 21,09%, lines 25,7%.

Особенно слабо покрыты:

- `src/core/media`: около 5%;
- `src/core/storage`: 0%;
- workers: около 10%;
- observability: около 18%;
- многие API routes отчётов: 0%;
- реальные Postgres/Redis integration flows отсутствуют.

**До релиза:** не гнаться за общей цифрой; закрыть сценарии upload/confirm/download/delete, PDF queue, outbox retry/DLQ, migration/RLS и report evidence end-to-end.

### P1. Резервные копии не защищают от потери VPS

`docs/runbooks/006-postgres-backup-restore.md:30-34` и `docs/runbooks/009-pitr-restore.md:210-211` фиксируют, что dump, WAL и basebackup находятся на том же VPS. При потере диска исчезают БД и обе линии backup.

**До релиза:** шифрованная off-site копия; ежедневная проверка свежести; ежемесячный restore drill с протоколом RPO/RTO.

### P2. Offline-first тесты устарели и исключены из релизного gate

`tests/e2e/offline-sync.spec.ts` содержит битую кириллицу и ожидает IndexedDB/PWA-поток, тогда как текущий PWA retired. CI запускает только три golden-path spec. Для полевого оператора потеря сети остаётся отдельным продуктовым решением, которое нужно либо реализовать и тестировать, либо явно убрать из обещаний продукта.

### P2. Email-уведомления являются заглушкой

`src/core/realtime/alerts/engine.ts:159-169`: канал `email` отмечен в правилах, но вместо отправки только пишет warning. UI/настройки не должны создавать впечатление работающего канала.

### P2. CI и production используют разные версии Node

CI собирает на Node 20, production Dockerfile на Node 22. Нужна одна зафиксированная версия через `engines`, `.nvmrc`/Volta и оба pipeline.

### P2. Автоматический deploy доверяет host key, полученному в момент запуска

`.github/workflows/deploy.yml:39` использует `ssh-keyscan` без заранее закреплённого fingerprint. Для production host key должен храниться как проверенный secret/known_hosts entry.

### P2. PostgreSQL quality gate падает

`npm run postgres:check-rules`: 22/25, два maximum fail. У ряда моделей нет пары `createdAt/updatedAt`; checker также не признаёт существующий migration process. Перед релизом нужно либо исправить схему, либо пересмотреть правила и сделать gate обязательным в CI, чтобы он отражал реальные требования, а не постоянно красный шум.

### P3. Граф знаний и продуктовая память требуют обслуживания

- GitNexus индекс отстаёт на 18 коммитов, FTS extension недоступен; query/consumer mapping неполны.
- Obsidian vault содержит только пустые/стартовые заметки.
- Product Bible, glossary, расчёты KPI и release decisions следует хранить как versioned Markdown и синхронизировать в Obsidian.

## 4. Мнение совета: 25 ролей

1. Product: ядро продукта сформировано, но offline и модель multi-tenant должны стать явными решениями.
2. Domain: единицы `шт./м.п.` и `шт./м` должны иметь один источник расчёта.
3. UX operations: плотные рабочие экраны подходят предметной области; нужны сквозные действия и понятные пустые состояния.
4. Frontend: production build стабилен; административные модули почти не представлены в browser gate.
5. Accessibility: точечных aria-атрибутов мало; нужен keyboard/focus/contrast audit ключевых экранов.
6. Mobile: проверяется только meta viewport, а не рабочая вёрстка форм и панелей.
7. Backend: service/module слои развиваются правильно, но legacy routes обходят часть правил.
8. API: централизованные wrappers хороши; контрактное отображение GitNexus неполно и требует актуального индекса.
9. Auth: JWT cookie, active-user check и CSRF реализованы хорошо.
10. Authorization: tenant privilege model небезопасна для SaaS без `SUPER_ADMIN`.
11. Security: CSP/headers сильные; dependency и SSH host-key риски открыты.
12. Data: RLS permissive и реальные DB integration tests отсутствуют.
13. Analytics: KPI нельзя строить на парсинге отображаемого имени.
14. Reports: архитектура доказательной базы есть; нужен E2E на фото, историю и PDF.
15. Equipment: Fleet Snapshot имеет единый источник, но метры свай требуют нормализации.
16. Maintenance: доменные статусы и tenant-aware commands покрыты лучше среднего; нужен полный browser flow закрытия ТО.
17. Realtime: retry/backpressure тестируются; publisher/server runtime почти не покрыты.
18. Notifications: Telegram реализован, email нет.
19. Storage: presigned media workflow существует, но его security/integration evidence недостаточно.
20. DevOps: контейнер non-root и healthcheck хороши; deploy недетерминирован.
21. Database operations: миграции проверяются в CI, но не гарантируются в deploy.
22. SRE: health/readiness/runbooks сильные; rollback и off-site backup слабые.
23. QA: unit suite большая, критические пользовательские цепочки покрыты узко.
24. Performance: кэш/observability предусмотрены; release load baseline не запускался.
25. Release director: выпуск блокируют tenant/RLS, migration deploy, KPI integrity, dependencies и critical-flow evidence.

## 5. Выполненные проверки

| Проверка | Результат |
|---|---|
| `npm run lint` + text integrity | PASS |
| `npm run db:check-migrations` | PASS |
| `npm run postgres:check-rules` | FAIL, 22/25 |
| `npm run test:unit` | PASS, 112 файлов / 1142 теста |
| `npm run test:contract` | PASS, 35 тестов |
| `npm run test:integration` | PASS, 102 теста, но БД мокируется |
| `npm run build` | PASS, 67 маршрутов/страниц |
| Playwright smoke | PASS, 5/5 |
| Coverage | PASS command, 25,7% lines |
| `npm audit --omit=dev` | FAIL, 29 vulnerabilities |
| GitNexus `detect_changes` | LOW для текущих незакоммиченных UI-изменений |

## 6. Production Readiness Score

| Область | Оценка |
|---|---:|
| Product/domain completeness | 76/100 |
| Frontend/UX | 78/100 |
| Backend/API | 74/100 |
| Data integrity | 56/100 |
| Security | 61/100 |
| Automated QA | 66/100 |
| DevOps/release | 52/100 |
| Observability/operations | 70/100 |
| Documentation/knowledge | 62/100 |
| **Итог** | **66/100** |

## 7. План до релиза

### Sprint 0: блокеры

1. Зафиксировать tenant role model и закрыть cross-tenant bypass.
2. Добавить real-Postgres tenant/RLS tests и перевести политики в fail-closed.
3. Сделать миграции обязательной атомарной стадией deploy по SHA.
4. Нормализовать длину сваи и унифицировать KPI во всех модулях.
5. Обновить уязвимые production dependencies.
6. Настроить off-site backup и выполнить restore drill.

### Sprint 1: доказательство качества

1. E2E: отчёт -> фото -> история -> PDF -> редактирование.
2. E2E: установка -> ТО -> назначение -> закрытие -> печать.
3. Integration: S3/MinIO upload-confirm-download-delete.
4. Integration: outbox/workers/Redis retry и DLQ.
5. Responsive/a11y audit для dashboard, reports, equipment, maintenance и operator form.

### Sprint 2: эксплуатационная зрелость

1. Immutable images и быстрый rollback.
2. Production load baseline и SLO thresholds.
3. Решить судьбу offline-first и email notifications.
4. Обновить GitNexus и заполнить Obsidian: Product Bible, KPI rules, role model, ADR и release checklist.

## 8. Условие GO

Релиз допустим после закрытия всех P1, зелёного повторного `build + unit + contract + real integration + browser E2E + npm audit`, подтверждённого применения миграций на staging и успешного off-site restore drill. Для строго single-tenant установки tenant/RLS пункты можно временно принять как осознанный риск только при выключенном публичном multi-tenant режиме и документированном ограничении продукта.
