# CLAUDE.md

## Как работать
- Неясно или есть несколько толкований — назови предположения и спроси; есть путь проще — скажи.
- Минимум кода под задачу: без спекулятивных абстракций, настроек «на будущее» и обработки невозможных случаев.
- Правки точечные: не «улучшай» соседний код и форматирование; убирай только то, что осиротила твоя правка; чужой мёртвый код — назови, не удаляй.
- Задачу превращай в проверяемую цель (тест воспроизводит → правка → тест зелёный) и проверяй до «готово».

## Архитектура (PilingTrack)
- `src/modules/` — доменная логика (DDD/CQRS); `src/services/` — старые общие сервисы (auth, audit, notifications); `src/core/` — только настоящая инфраструктура; `src/app/api/` — маршруты.
- Миграция `services/ → modules/` остановлена на полпути: не доделывать отдельным рефакторингом. `reports/` — эталон полного переноса. Для `users`, `analytics`, `telemetry`, `system` `modules/<x>/index.ts` — только фасад, код живёт в `services/<x>/`. Импортировать всегда из `@/modules/<x>`.
- Модуль или справочник: таблица `{id, name, isActive}` только под FK `onDelete: Restrict` → справочник (вкладка `admin-dictionaries`); есть состояние/жизненный цикл/история/дочерние строки → операционный модуль; `enum` в коде остаётся в коде (подробно — навык `module-vs-dictionary`).

## Маршруты API
- Всегда `withApi` (GET) или `withMutation` (POST/PUT/DELETE: CSRF + лимит). Не дублировать CSRF/лимит в маршруте.
- Тело — `schema.safeParse`, при ошибке 400, дальше только `validated.data`.

## Безопасность
- Особо осторожно (сначала тест, потом правка): `src/services/auth/`, `src/core/security/`, `src/lib/rate-limiter.ts`, `src/lib/csrf-protection.ts`.
- Сравнение секретов — `crypto.timingSafeEqual`; без `as any` в auth.
- Организация: нет `tenantId` → отказ (fail closed), строгое равенство; никогда `IS NULL OR tenantId` (IDOR 31.05). Политика — `resource-access-service.ts`.

## Ловушки
- Файлы > 500 строк — делить по ответственности. `console.log` в сервисах — нет, `logger` из `@/lib/logger`.
- Одна миграция Prisma = одно логическое изменение.
- Сырой SQL — `$queryRaw` (не `Unsafe`), образец — `src/core/infrastructure/raw-queries.ts` (tenantId обязателен). Кэш — `src/lib/cache-strategies.ts`. Redis — кэш и лимиты, не база.
- Юнит-тесты — `src/**/__tests__/`; интеграционных мало — если нужна их инфраструктура, скажи.

## Прод (orionpiling.ru)
- Один VPS, Docker Compose в `/opt/pilingtrack`, диск 30 ГБ (часто почти полный), 3.8 ГБ ОЗУ + 4 ГБ swap. Один арендатор `orion` (`DEFAULT_TENANT_ID=orion`).
- Контейнеры: `pilingtrack-app` (Next.js :3000 за Caddy), `-workers` (outbox/projection/PDF), `-postgres` (user `piling`, db `pilingtrack`), `-redis`, `-redis-cache`, `-minio`, `-pgbouncer`, `-grafana`, `-prometheus`. База: `docker compose exec postgres psql -U piling -d pilingtrack`.
- Выкладка — ТОЛЬКО по команде владельца, через `bash scripts/deploy-prod.sh [сервисы]` (сборка образов на этом ПК, передача на сервер; требует main = origin/main и чистое дерево). Подробности и ручной запасной путь — `docs/runbooks/008-manual-deploy.md`. Перед выкладкой workers — smoke образа (раздел в ранбуке 008).
- Новая миграция в диапазоне → собрать и `migrate` (иначе тихо «No pending migrations»), проверить `_prisma_migrations`. Деструктивные миграции — сначала проверить данные.
- У `app`/`workers` нет `env_file`: переменная из `.env` попадает в контейнер, только если перечислена в `environment:` docker-compose.yml. Хостовые скрипты пишут ключи Redis с приставкой `pilingtrack:`.
- Telegram с VPS заблокирован — идёт через прокси `TELEGRAM_API_BASE` (Cloudflare Worker).

## Владелец
Не программист, отвечать по-русски, давать готовые команды для вставки, не задавать открытых вопросов, когда следующий шаг очевиден. Подробности — в памяти.

## GitNexus — поправка проекта к блоку ниже
Блок ниже генерирует `gitnexus analyze`. Обязательный `impact` — перед переименованием, переносом, удалением символа и рефакторингом общих функций; для точечной правки внутри функции достаточно поиска по тексту. `UNKNOWN` — не «безопасно»: подтверждать поиском. Индекс часто устаревает — при сомнении `node .gitnexus/run.cjs analyze --index-only`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **PilingTrack** (23154 symbols, 45336 relationships, 1131 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/PilingTrack/context` | Codebase overview, check index freshness |
| `gitnexus://repo/PilingTrack/clusters` | All functional areas |
| `gitnexus://repo/PilingTrack/processes` | All execution flows |
| `gitnexus://repo/PilingTrack/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
