# Production Readiness Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сформировать из `main` и принятых после 30.10.2026 веток единый локальный кандидат и получить воспроизводимые результаты статических проверок, автотестов и сборки.

**Architecture:** сначала фиксируется карта веток и базовые показатели `main`, затем кандидат собирается в отдельном worktree и ветке без push и изменения `main`. Все результаты и ограничения сохраняются в отдельном каталоге аудита; последующие браузерные и инфраструктурные этапы используют только зафиксированный commit кандидата.

**Tech Stack:** Git, Next.js 16, TypeScript, Prisma, Vitest, Playwright, npm, Windows + Git Bash.

**Spec:** `docs/superpowers/specs/2026-11-04-production-readiness-audit-design.md`

## Global Constraints

- Правки после 30.10.2026 правильны по содержанию; проверяются только их интеграция и регрессии.
- Не выполнять push, merge в `main`, deploy или production-изменения.
- Не менять `prisma/schema.prisma` и `prisma/migrations/**`; разрешён только `npm run db:generate`.
- Не добавлять зависимости и не изменять видимый интерфейс.
- Не читать `.env*` и не подставлять выдуманные env для успешной сборки.
- Каждую проверку запускать отдельно и записывать настоящий exit code без конвейеров с `head`/`tail`.
- Перед изменением/переносом/удалением символов применять правила GitNexus; этот план не предусматривает таких правок.
- Перед каждым commit, включая merge commit, запускать `node .gitnexus/run.cjs detect-changes --scope all --repo .`; неполный результат не считать чистым.

## Review Focus

- Пропущенный принятый commit: Task 1 сверяет точный набор из восьми вершин/коммитов со спецификацией.
- Конфликт независимых исправлений ПТО: Task 4 запускает общие и специализированные ПТО-тесты после объединения.
- Потерянные тесты при разделении компонентов: Task 3 сравнивает Playwright discovery до и после, Task 4 фиксирует unit pass/fail/skip.
- Ложно чистый TypeScript из-за `.next/dev/types`: Task 4 удаляет только этот generated-каталог перед `tsc`.
- Молча пропущенная интеграция без env/DB: Task 4 отдельно записывает skipped и не признаёт такой сценарий проверенным.

---

### Task 1: Карта принятых веток и границы кандидата

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/branch-map.md`

**Interfaces:**
- Consumes: refs и commits из раздела «Исходное состояние» спецификации.
- Produces: таблицу `ref -> tip -> merge-base -> changed files`, порядок `mergeOrder` и список исключённых untracked-файлов для Task 2.

- [ ] **Step 1: Зафиксировать refs и родительские связи**

Run: `git show -s --format="%H %P %ad %s" --date=iso-local main origin/main claude/pto-order-1030b claude/pto-acts-accepted-1030b claude/pto-small-1030b codex/split-deep-1030c`
Expected: все шесть refs существуют; вершины совпадают со спецификацией.

- [ ] **Step 2: Найти базы и пересечения файлов**

Run для каждой принятой ветки отдельно: `git merge-base main <ref>`, `git diff --name-only main...<ref>`, `git log --oneline main..<ref>`.
Expected: три линии ПТО и цепочка split имеют явные базы; пересекающиеся файлы перечислены, а не скрыты.

- [ ] **Step 3: Проверить полноту принятых изменений**

Сверить `git log --all --since="2026-10-30T23:59:59+03:00"` с восемью commits из спецификации. Записать любые дополнительные commits как требующие решения владельца, не включая их самовольно.

- [ ] **Step 4: Записать карту и зафиксировать её**

В `branch-map.md` записать refs, commits, bases, changed files, пересечения и порядок: `pto-order`, `pto-acts-accepted`, `pto-small`, затем `split-deep`. Указать, что untracked-скрипты корня не входят.

Run: `git add docs/audits/production-readiness-2026-11-04/branch-map.md && git commit -m "docs(audit): зафиксировать состав production-кандидата"`
Expected: создан один commit только с картой аудита.

### Task 2: Изолированный кандидат без изменения основной рабочей папки

**Files:**
- Create outside source tree: `.worktrees/production-readiness-2026-11-04/`

**Interfaces:**
- Consumes: `mergeOrder` из Task 1.
- Produces: worktree и ветку `codex/production-readiness-candidate`, доступные для Task 3 и Task 4.

- [ ] **Step 1: Подготовить изоляцию по правилам проекта**

Invoke `superpowers:using-git-worktrees`. Проверить, что выбранный путь не существует и текущие untracked-файлы основной папки останутся нетронутыми.

- [ ] **Step 2: Создать worktree и candidate branch**

Run: `git worktree add .worktrees/production-readiness-2026-11-04 -b codex/production-readiness-candidate main`
Expected: worktree создан от `3b2c2e7f`; `main` и `origin/main` не изменены.

- [ ] **Step 3: Подготовить generated Prisma client**

В worktree запустить `npm run db:generate` без чтения или создания `.env*`.
Expected: exit 0 и существует generated client; при env/DB-ошибке записать её и остановить зависимые проверки, не подделывая окружение.

### Task 3: Объединить принятые изменения и доказать discovery baseline

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/merge-report.md`

**Interfaces:**
- Consumes: candidate worktree из Task 2 и `mergeOrder` из Task 1.
- Produces: один candidate commit для всех последующих проверок; baseline и candidate Playwright counts.

- [ ] **Step 1: Получить baseline на `main` до объединения**

В основной папке отдельно запустить `npx playwright test --list`; записать полный exit code и число тестов. Не запускать сценарии на этом шаге.

- [ ] **Step 2: Объединить ветки в candidate branch**

В worktree для каждой ветки из `mergeOrder` выполнить `git merge --no-ff --no-commit <ref>`, затем обязательный `detect-changes --scope all`, затем `git commit -m "merge: включить <ref> в production-кандидат"`.
Expected: четыре merge commits, перед каждым получен полный результат GitNexus. При конфликте остановиться, записать файлы и сохранить обе принятые формы поведения минимальным разрешением; если это невозможно без продуктового выбора — не продолжать и запросить решение.

- [ ] **Step 3: Проверить состав и discovery после объединения**

Run: `git diff --stat main...HEAD`, `git status --short` и `npx playwright test --list` отдельными командами.
Expected: в diff только принятые изменения и разрешённые конфликты; дерево чистое; количество Playwright-тестов не снизилось без объяснения.

- [ ] **Step 4: Записать merge report**

Зафиксировать candidate `HEAD`, merges, конфликты, их разрешение, changed files, baseline/candidate Playwright counts и untracked/generated-исключения. Сам отчёт сохранить в основной ветке аудита отдельным commit, не загрязняя candidate.

### Task 4: Стандартные и специализированные проверки кандидата

**Files:**
- Create: `docs/audits/production-readiness-2026-11-04/static-verification.md`

**Interfaces:**
- Consumes: candidate commit из Task 3.
- Produces: матрицу `command -> exit code -> passed/failed/skipped -> evidence` и список блокеров следующего этапа.

- [ ] **Step 1: Удалить устаревшие generated route types и проверить TypeScript**

В candidate worktree: `rm -rf .next/dev/types`, затем отдельно `npx tsc --noEmit`.
Expected: exit 0; иначе сохранить первые полные ошибки в отчёте без исправления приложения.

- [ ] **Step 2: Запустить стандартные проверки отдельно**

Run последовательно: `npm run lint`, `npm run test:unit`, `npx playwright test --list`, `npm run build`.
Expected: записаны настоящие exit codes. Для unit обязательны passed/failed/skipped; для Playwright — число найденных тестов; build при env/DB-ошибке помечается «не проверено из-за окружения», а не «зелёный».

- [ ] **Step 3: Запустить специализированные ПТО integration-тесты**

Run: `npx vitest run src/modules/reports/application/queries/__tests__/pile-journal-pto.integration.test.ts src/modules/reports/application/queries/__tests__/pile-journal-order.integration.test.ts src/modules/reports/application/queries/__tests__/pile-journal-acts-accepted.integration.test.ts`
Expected: exit 0 и ноль необъяснённых skips. При отсутствии DB записать сценарии как непроверенные и подготовить отдельный безопасный integration-стенд, не меняя основную базу.

- [ ] **Step 4: Запустить анализ изменений графа**

Run: `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .` из candidate worktree.
Expected: полный, не `partial`/`truncated`, результат сохранён; при неполном результате повторить после обновления индекса и не называть его чистым.

- [ ] **Step 5: Записать вердикт этапа**

В `static-verification.md` перечислить candidate commit, все команды и exit codes, тестовые числа, skips, отличия Playwright discovery, graph status и каждый блокер. Вердикт: `PASS` только если tsc/lint/unit/discovery/build и специализированные тесты действительно пройдены; иначе `BLOCKED` или `FAIL` с причиной.

### Task 5: Закрыть этап и подготовить следующий план

**Files:**
- Modify: `docs/audits/production-readiness-2026-11-04/static-verification.md`
- Create: `docs/superpowers/plans/2026-11-04-production-readiness-browser.md`

**Interfaces:**
- Consumes: зафиксированный candidate commit и результаты Task 4.
- Produces: решение о переходе к реальным Playwright-сценариям и план следующего этапа без повторения уже выполненных проверок.

- [ ] **Step 1: Сверить отчёт с фактическими журналами**

Проверить, что каждый заявленный PASS имеет команду, exit code и числа; отсутствие env, DB или физических ресурсов записано как ограничение.

- [ ] **Step 2: Сохранить результаты в ветке аудита**

Run: `git add docs/audits/production-readiness-2026-11-04 docs/superpowers/plans/2026-11-04-production-readiness-browser.md && git commit -m "docs(audit): зафиксировать проверку production-кандидата"`
Expected: commit содержит только документы аудита и следующий план; candidate source commits остаются в candidate branch.

- [ ] **Step 3: Остановиться на контрольной точке**

Не переходить к browser-этапу при `FAIL`/`BLOCKED`. При `PASS` представить владельцу candidate commit, результаты и следующий план; не выполнять push, merge в `main` или deploy.
