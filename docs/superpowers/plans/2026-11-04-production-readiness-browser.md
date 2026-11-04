# Production Readiness Browser And Runtime Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Не начинать выполнение, пока Task 4 предыдущего плана имеет вердикт `BLOCKED` и полный build не получит настоящий PASS.

**Goal:** проверить зафиксированный production-кандидат в реальных браузерных, мобильных, performance, нагрузочных и эксплуатационных сценариях, не выдавая эти проверки за официальную сертификацию.

**Architecture:** сначала на том же candidate commit получают полный build PASS в предоставленном локальном/CI-окружении, затем поднимают изолированный runtime с одноразовой БД. Браузерные и performance-проверки выполняются до нагрузки; production и активный security-контур требуют отдельных разрешений и не смешиваются с локальным стендом. Каждый этап сохраняет команды, exit codes, counts и артефакты; любой P0/P1 останавливает движение к положительному вердикту.

**Tech Stack:** Next.js 16, Playwright (Chromium и Mobile Chrome), Vitest/PostgreSQL, существующие Lighthouse/CWV-инструменты проекта или внешний CLI без изменения зависимостей, Git, Windows + Git Bash.

**Spec:** `docs/superpowers/specs/2026-11-04-production-readiness-audit-design.md`

## Global Constraints

- Кандидат для первого прогона: `d11822b1413fd6f3d6538c0e55ec956606cb8700`; если commit меняется, повторить build и discovery для нового HEAD и явно обозначить новую матрицу.
- Не выполнять push, merge в `main`, deploy, SSH или production-изменения без отдельной явной команды владельца.
- Не читать/создавать `.env*` самостоятельно и не выдумывать env. Владелец/CI должен предоставить корректное окружение процесса; в отчёт попадают только имена и факт доступности, не значения.
- Не менять схему Prisma и миграции; runtime-БД только одноразовая, созданная штатным `scripts/test-db-up.sh`, с последующим удалением собственного контейнера.
- Не добавлять зависимости. Сначала подтвердить наличие инструмента в manifest/lockfile/системе; недоступные физические устройства и внешние сервисы записать как ограничение.
- Не исправлять продуктовые дефекты внутри аудита. Дефекты получают воспроизведение, severity и отдельную рекомендацию.
- Не запускать нагрузочный или активный security-тест на production без отдельного явного разрешения с указанием целей, времени, RPS и критериев остановки.
- Каждую проверку запускать отдельно, без `| head`/`| tail`; сохранять полный вывод и настоящий exit code. Skipped не считать passed.
- Перед каждым commit запускать `node .gitnexus/run.cjs detect-changes --scope all --repo .`; неполный результат не считать чистым.

## Review Focus

- Валидация окружения прошла, но Next route types или production standalone assets не собраны: Task 1 требует полного exit 0 всей `npm run build`, а не только env validation.
- Реальный браузерный сценарий завершился раньше асинхронной записи или показал старые данные: Task 2 проверяет итог через UI/API и повторное открытие, без фиксированных sleep как доказательства.
- Mobile Chrome эмуляция скрывает ограничения физического телефона: Task 3 отдельно маркирует эмуляцию и фактически доступные устройства.
- Лабораторный Lighthouse не равен полевым Core Web Vitals: Task 4 не подменяет LCP/INP/CLS реальных пользователей одним локальным прогоном.
- Нагрузка или отказ Redis/БД приводит к потере данных либо cross-tenant доступу: Tasks 5–6 требуют критериев целостности и изоляции, а не только среднего latency.

---

### Task 1: Снять build-блокер и зафиксировать runtime-стенд

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/build-runtime.md`
- Create: `docs/audits/production-readiness-2026-11-04/artifacts/build.txt`

**Interfaces:**
- Consumes: candidate HEAD `d11822b1413fd6f3d6538c0e55ec956606cb8700`, корректное env-окружение от владельца/CI.
- Produces: `buildStatus: PASS|FAIL`, точный проверенный HEAD и команда/параметры запуска изолированного runtime; последующие задачи не выполняются при FAIL.

- [ ] **Step 1: Проверить идентичность и чистоту candidate**

Run в candidate worktree: `git rev-parse HEAD && git status --short`.
Expected: HEAD равен зафиксированному SHA; source tree чист. При другом HEAD создать новую матрицу, не смешивать результаты.

- [ ] **Step 2: Выполнить полный build**

Run: `npm run build` с перенаправлением полного вывода в `artifacts/build.txt`, отдельно записать exit code.
Expected: exit 0, включая `validate-env.ts`, Prisma generate, `next build --webpack` и `copy-standalone-assets.js`. Любой промежуточный PASS без общего exit 0 не открывает следующий этап.

- [ ] **Step 3: Подготовить одноразовую БД и health-check**

Run штатный `scripts/test-db-up.sh`, применить только существующие миграции integration-конфигом, запустить собранное приложение на выделенном localhost-порту; запросить существующие health endpoints и сохранить HTTP status/body без секретов.
Expected: runtime и БД принадлежат только этому прогону; health отвечает успешно; trap удаляет собственный контейнер при завершении.

- [ ] **Step 4: Записать gate-отчёт**

Указать exit codes, адрес стенда без credentials, выданные warnings и границы проверки. Закоммитить только документы/текстовые журналы после полного GitNexus check; бинарные traces/videos в git не добавлять без необходимости.

### Task 2: Выполнить реальные Playwright-сценарии

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/playwright-runtime.md`
- Create: `docs/audits/production-readiness-2026-11-04/artifacts/playwright-chromium.txt`
- Create: `docs/audits/production-readiness-2026-11-04/artifacts/playwright-mobile-chrome.txt`

**Interfaces:**
- Consumes: `buildStatus: PASS` и работающий runtime из Task 1; существующие `playwright.config.*` и `e2e/**`.
- Produces: отдельные матрицы Chromium и Mobile Chrome `passed/failed/skipped`, список реальных дефектов и путей к Playwright report.

- [ ] **Step 1: Подтвердить конфигурацию и доступность браузеров**

Run: `npx playwright test --list` и проверить установленные Playwright browsers штатной командой текущей версии.
Expected: discovery остаётся 429 tests in 31 files либо изменение объяснено; отсутствие browser binary является BLOCKED, а не пропуском всего этапа молча.

- [ ] **Step 2: Запустить Chromium против изолированного runtime**

Run: `npx playwright test --project=chromium` с существующей конфигурацией baseURL/webServer; полный вывод сохранить отдельно.
Expected: записаны реальные passed/failed/skipped и exit code. Не ограничиваться smoke, если configured suite шире.

- [ ] **Step 3: Запустить Mobile Chrome**

Run: `npx playwright test --project="Mobile Chrome"` отдельной командой.
Expected: отдельные counts и exit code; ошибки viewport/touch/overflow не переносить в категорию «проверено на физическом телефоне».

- [ ] **Step 4: Проверить критические бизнес-последствия неуспешных тестов**

Для каждого failure сохранить тест, роль, trace/screenshot, первую ошибку и воспроизводимость на повторном одиночном запуске. Для ключевых записей сверить результат после перезагрузки и отсутствие чужих tenant/site данных.
Expected: flaky, дефект приложения и дефект стенда разделены; нет скрытых retries/skips; тесты не редактируются ради зелёного результата.

- [ ] **Step 5: Зафиксировать отчёт**

Сохранить команды, exit codes, counts, retry/flaky numbers, ссылки на стандартный Playwright output и вердикт. Перед commit выполнить GitNexus scope all.

### Task 3: Интерактивный UX, доступность и мобильные устройства

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/ux-mobile.md`

**Interfaces:**
- Consumes: работающий runtime и результаты Task 2.
- Produces: сценарную UX-матрицу, подтверждённые дефекты и честный статус физических устройств.

- [ ] **Step 1: Пройти ключевые ручные сценарии во встроенном браузере**

Использовать `mcp__desktop_browser__run` после загрузки инструмента. Проверить login/logout, роли ADMIN/DISPATCHER/OPERATOR, журнал и выгрузки ПТО, справочники, технику и ошибки соединения. Сохранить viewport, шаги, ожидаемый/фактический результат и screenshots.
Expected: проверены реальные клики, ввод, навигация, состояния loading/empty/error и повторное открытие сохранённых данных; не только чтение DOM.

- [ ] **Step 2: Проверить адаптивность и базовую доступность**

На desktop, Mobile Chrome и доступных touch-viewport проверить клавиатурную навигацию, focus, dialog/menu, labels, контраст по фактическому rendering, горизонтальный overflow и целевые размеры управления.
Expected: каждый дефект привязан к маршруту/роли/viewport; автоматический Playwright PASS не засчитывается как полный accessibility audit.

- [ ] **Step 3: Определить доступность физических устройств**

Запросить у владельца доступные устройства только если локально нет заранее предоставленного стенда. На доступных устройствах повторить критические OPERATOR-сценарии, сеть offline/reconnect и выгрузку/открытие файла.
Expected: модель, ОС, браузер и результаты перечислены. При отсутствии устройств статус `NOT CHECKED`, эмуляция не закрывает этот пункт.

- [ ] **Step 4: Зафиксировать UX-вердикт**

Сохранить severity и доказательства, не меняя видимый UI. Перед commit выполнить GitNexus scope all.

### Task 4: Lighthouse и Core Web Vitals

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/performance.md`
- Create: `docs/audits/production-readiness-2026-11-04/artifacts/lighthouse/`

**Interfaces:**
- Consumes: production build и runtime Task 1, стабильные маршруты Tasks 2–3.
- Produces: лабораторные метрики по выбранным маршрутам, ограничения полевых CWV и performance-дефекты.

- [ ] **Step 1: Подтвердить инструмент и условия измерения**

Проверить существующие Lighthouse/performance-скрипты и installed browser. Зафиксировать HEAD, build mode, browser version, viewport, throttling и число прогонов; не добавлять npm-зависимости.
Expected: используется production build, не dev-server; инструмент либо доступен, либо этап явно BLOCKED.

- [ ] **Step 2: Измерить публичный login и ключевые authenticated routes**

Выполнить минимум три холодных прогона для login и согласованных критических маршрутов; сохранить JSON/HTML, медиану и разброс Performance, LCP, CLS, TBT и доступного INP-proxy.
Expected: нет выдачи TBT за INP; failures навигации/auth не заменяются нулевыми метриками; секреты не попадают в reports.

- [ ] **Step 3: Отделить полевые Core Web Vitals**

Проверить наличие реального RUM/CWV-источника без раскрытия персональных данных. При его отсутствии записать field LCP/INP/CLS как `NOT CHECKED` и предложить отдельную задачу наблюдения.
Expected: лабораторный и полевой статусы разделены.

- [ ] **Step 4: Зафиксировать performance-отчёт**

Привести budgets/фактические значения, узкие места по evidence и ограничения. Перед commit выполнить GitNexus scope all.

### Task 5: Нагрузка и отказоустойчивость на изолированном стенде

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/load-resilience.md`
- Create: `docs/audits/production-readiness-2026-11-04/artifacts/load/`

**Interfaces:**
- Consumes: стабильный runtime, существующие `chaos/chaos-scenarios.yaml`, реальные параметры использования от владельца и доступный load tool.
- Produces: согласованный профиль нагрузки, результаты capacity/recovery и критерии остановки.

- [ ] **Step 1: Согласовать профиль и доказать изоляцию**

До запуска записать целевые endpoint/роли, read/write mix, RPS/concurrency, duration, dataset, лимиты p95/p99/error rate и критерии остановки. Проверить, что host/DB/R2 не production.
Expected: отдельное разрешение владельца на нагрузку, даже для стенда с write-сценариями; production target запрещён без отдельного плана.

- [ ] **Step 2: Выполнить baseline, ступенчатую нагрузку и soak**

Использовать уже доступный k6/аналог без добавления зависимостей; сохранить полный summary, системные ресурсы, server errors, p50/p95/p99, throughput и saturation.
Expected: warmup не смешан с измерением; нет выборочного удаления ошибок; при недоступности инструмента статус BLOCKED.

- [ ] **Step 3: Проверить отказы и целостность**

По существующим chaos-сценариям отдельно проверить согласованные отказы Redis/DB/внешнего хранилища и восстановление. После каждого сценария проверить отсутствие дублей/потерь, tenant isolation и корректный health.
Expected: recovery time, ручные действия и остаточные ошибки зафиксированы; destructive/production failover не выполняется.

- [ ] **Step 4: Зафиксировать capacity/resilience-вердикт**

Сохранить команды, параметры, exit codes и ограничения переносимости локальных результатов на production. Перед commit выполнить GitNexus scope all.

### Task 6: Production configuration и security — только по отдельным разрешениям

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/production-security.md`

**Interfaces:**
- Consumes: локальные отчёты Tasks 1–5 и отдельные явные разрешения владельца на каждый read-only production/security контур.
- Produces: фактические статусы конфигурации и независимого security assessment без утверждения официальной сертификации.

- [ ] **Step 1: Получить отдельные разрешения и безопасный доступ**

Зафиксировать scope: read-only конфигурация/метрики, timers/cron, R2 versioning/replication/lifecycle, backups/restore, security headers, внешний pentest. SSH/deploy/production DB/active attacks не выполнять без прямого разрешения именно на это действие.
Expected: есть владелец, окно, цели, allowed methods, stop conditions и контакт для инцидента; иначе пункт `NOT CHECKED`.

- [ ] **Step 2: Проверить фактические production-флаги и эксплуатацию**

Только разрешённым read-only способом сопоставить фактические flags с задокументированными, проверить timer/cron последних выполнений, Redis/rate-limit режим, Sentry/monitoring, R2 versioning/replication/lifecycle и наличие свежих backup.
Expected: сохранены timestamps, источник и HTTP/CLI status без секретов/токенов; документация не засчитана как фактическое состояние.

- [ ] **Step 3: Доказать восстановление на отдельном стенде**

Восстановить выбранную согласованную копию в новую изолированную БД/хранилище, проверить schema/data counts, критический запрос и RPO/RTO. Не перезаписывать production.
Expected: фактический restore PASS с доказательствами либо release-blocking ограничение; наличие backup-файла само по себе не PASS.

- [ ] **Step 4: Разграничить security-проверки**

Локально/на разрешённом staging выполнить существующие неразрушающие auth/tenant/security suites; внешний penetration test поручить независимому исполнителю с Rules of Engagement. Не называть внутренний аудит внешним pentest или аккредитованной сертификацией.
Expected: findings содержат severity, scope, evidence и retest status; активные атаки на production без отдельного разрешения не выполнялись.

### Task 7: Итоговая оценка и решение о готовности

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/final-assessment.md`

**Interfaces:**
- Consumes: все предыдущие отчёты, точный HEAD, артефакты и явные `NOT CHECKED`.
- Produces: оценка 100 баллов, blocking findings, условия выпуска и план повторной проверки.

- [ ] **Step 1: Собрать доказательную матрицу**

Для каждой команды/проверки указать HEAD, окружение, exit/status, counts/skips, evidence и ограничения. Свести реальные Playwright, UX/devices, Lighthouse/CWV, load, production/R2/backup и security без скрытых пробелов.
Expected: невозможно принять NOT CHECKED за PASS; повторные запуски разных HEAD не смешаны.

- [ ] **Step 2: Выставить оценку и вердикт**

Оценить функциональность 20, безопасность 20, надёжность 20, production/backup 15, UX/mobile/accessibility 15, performance 10. Применить блокеры спецификации: P0/P1, риск потери/раскрытия данных, неработающий критический сценарий, недоказанный restore или откат означают «не готов» независимо от суммы.
Expected: вердикт `готов / готов с условиями / не готов`; техническая оценка отделена от официальной сертификации.

- [ ] **Step 3: Зафиксировать итог без изменения production**

Перед commit выполнить полный GitNexus scope all; закоммитить только отчёты. Не выполнять push/merge/deploy. Передать владельцу блокеры, владельцев remediation, порядок retest и необходимость независимой сертификации, если она требуется юридически.
