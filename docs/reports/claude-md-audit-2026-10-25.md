# Ревизия *.md файлов Claude Code — 25.10.2026

Режим: только чтение (git, поиск по коду). Сборки и тесты не запускались. Исправления в проекте не применялись. В памяти (вне репозитория) исправлены только битые ссылки `[[...]]` — список в разделе 4.

Проверено: `CLAUDE.md`, `AGENTS.md`, `docs/karpathy-principles/CLAUDE.md`, 134 файла памяти (`MEMORY.md` + 133), `.claude/agents`, `.claude/skills/**` (проектные), `.claude/settings.json`, ранбуки 008/012 и ADR-0053 (только по ссылкам). Файлов `debugging.md`, `api-conventions.md`, `.claude/rules/`, `.claude/commands/` **нет** ни в репозитории, ни в `~/.claude` — в роли отладки выступает навык `pilingtrack-debugging-playbook`, правил API — раздел «Маршруты API» в CLAUDE.md.

## 1. Что в порядке

- Индекс `MEMORY.md`: 133 строки = 133 файла, битых ссылок на файлы нет, сирот нет, дублей строк нет, размер 18,5 КБ (лимит загрузки 200 строк / 25 КБ — запас есть, но 3 строки длиннее 200 символов: 1, 115, 128).
- Все пути из CLAUDE.md существуют: `modules/{audit,users,analytics,system,notifications,reports,telemetry}`, `services/{telemetry,tenancy,auth}`, `core/security/{resource-access,authorization}.ts`, `raw-queries.ts`, `cache-strategies.ts`, `rate-limiter.ts`, `csrf-protection.ts`, `scripts/deploy-prod.sh`, `docs/runbooks/008`, `modules/reports/{server,client}.ts`. `services/{audit,users,analytics,system,reports,notifications}` действительно удалены.
- Команда выкладки одинакова в CLAUDE.md, навыке `deploy`, ранбуке 008 и журнале выкладок.
- Telegram-в-транзакции и межканальная запись выработки есть в журнале статусов (строки 69, 71) с причиной отмены.

## 2. (а) Исправить немедленно, безопасно (ждёт вашего «да» — это не опечатки)

| № | Файл | Проблема | Доказательство | Предлагаемое действие |
|---|------|----------|----------------|-----------------------|
| А1 | `AGENTS.md` §3 | Устарел: «`users`, `analytics`, `telemetry`, `system` still live in services behind facades». На деле в `services/` остались только `auth, dictionaries, feedback, telegram, telemetry, tenancy, weather`; users/analytics/system перенесены 16–20.10, а `reports`, `audit`, `notifications` тоже уже в `modules/`. Codex получает неверную карту. | `ls src/services`; CLAUDE.md стр. 11; журнал статусов, строки 40–41 | Привести абзац в соответствие с CLAUDE.md (одно предложение) |
| А2 | `AGENTS.md` §6 | «Python is not installed — use node» | память `reference_python_path`: Python 3.14.7 работает (проверено 02.09, подтверждено 18.10) | Заменить на «python работает, но для правок файлов удобнее node» |
| А3 | `AGENTS.md` (блок GitNexus) | Блок `gitnexus:start` без «поправки проекта» из CLAUDE.md: Codex видит «NEVER edit a function before impact analysis / never grep instead of graph», а в CLAUDE.md для точечных правок достаточно поиска. Правило противоречит себе между файлами. | сравнение CLAUDE.md «GitNexus — поправка проекта» и AGENTS.md | Добавить ту же поправку над блоком (вне маркеров `gitnexus:start/end`, иначе `analyze` её сотрёт — в CLAUDE.md поправка так и лежит) |
| А4 | `CLAUDE.md` стр. 10 | Внутреннее противоречие: «`src/services/` — старые общие сервисы (auth, notifications; audit перенесён…)», а стр. 11 говорит, что `notifications` стал `modules/notifications` | `ls src/services` — notifications нет | Заменить «(auth, notifications; …)» на «(auth, tenancy, telemetry, dictionaries, telegram…)» |
| А5 | `MEMORY.md` стр. 8 | «прод = ca7f8226» — устарело; файл журнала говорит 78fee880 (деплой 24.10, откат ca7f8226-20261024) | журнал статусов строка 65; `project_prod_deploy_log.md` стр. 6. Описание в самом файле — «30.06–21.10», а таблица доходит до 24.10 | Исправить строку индекса и `description` файла |
| А6 | `MEMORY.md` стр. 128 | «Решения владельца 18.10 … ожидают реализации» — реализованы: влиты 20.10, выкачены 21.10 (деплой fe033994) | журнал статусов строки 39, 52. В самом файле раздел «Статус на 20.10» тоже ещё говорит «не в main» | Строка индекса: «реализовано, на проде с 21.10»; дописать статус в файл. Пункты 3–4 файла (Telegram-заглушка, фото «навсегда») остаются в силе |
| А7 | `MEMORY.md` стр. 78 | «Журнал забивки в «Отчётах» — локально, не выкачено» | журнал статусов строки 27, 59: журнал свай выкачен (19.10, 22–23.10) | Изменить пометку на «выкачено» |
| А8 | Навыки `.claude/skills/*` | Ссылки на несуществующие `src/services/reports/*` (domain-events, outbox-publisher, audit-service, report-history*, event-handlers) и `@/services/audit/audit-service`. Файлы теперь в `src/modules/reports/application/*` и `modules/audit`. Затронуты: `piling-domain-reference` (стр. 125), `pilingtrack-architecture-contract` (83, 85, 102), `pilingtrack-failure-archaeology` (838), `pilingtrack-proof-and-analysis-toolkit` (265, 478 — команда `grep` по несуществующему файлу), `report-evidence-model` (SKILL.md + references/data-model.md) | `find src/modules/reports -name 'outbox-publisher*'` → `application/outbox-publisher.ts` | Заменить пути; номера строк (`:131`) перепроверить |
| А9 | `MEMORY.md` | Дыра: нет записи о решении **отложить микросервисы** (один VPS и один арендатор, 25.10) и о **разделении больших файлов Codex-ом** | поиск «микросервис» и «split-1024» по памяти — 0 совпадений; в журнале статусов тоже нет. Каталога `docs/plans/tasks/split-1024` нет ни в этой ветке, ни в основной папке (инструменты лежат в `D:\PillingR\split-1024-tools`; коммиты «Вынести …» оператора v2/v5/v10 есть в `git log --all`) | Завести 2 файла памяти: `project_microservices_deferred_2026_10_25` (причина, условие пересмотра) и `project_split_1024_codex`; строки в журнал. Адрес заданий уточнить у соседней сессии |
| А10 | Ссылки `[[...]]` в памяти | Часть ссылок вела в никуда | исправлено — см. раздел 4. Остались 2 висящих: `reference-skills-directory` (в `project_skills_library`), `reference-vitest-transform-cost-under-load` (в `reference_worktree_needs_prisma_generate`) — таких файлов нет, и ни в индексе, ни где-либо ещё их содержимого нет | Убрать эти две ссылки или создать файлы (решит автор) |

## 3. (б) Требует решения владельца

| № | Файлы | Проблема | Доказательство | Варианты |
|---|-------|----------|----------------|----------|
| Б1 | `AGENTS.md` §1 ↔ память | AGENTS.md запрещает **всем** внешним агентам трогать экраны оператора (`operator*`, `operator-mobile`). Память: 03.10 владелец разрешил Codex править их «с тестами» (Hermes — нельзя); 23.10 — все версии (operator, v2, v3, v5, v7, v10) остаются. Сегодняшнее разделение файлов Codex-ом как раз правит v2/v5/v10 (`git log --all`: «Вынести экраны … оператора v5/v10»). | `project_operator_unfrozen_for_codex`, `project_operator_screens_keep_month_2026_10_23`, AGENTS.md §1 | (1) оставить запрет, разрешение давать в тексте задания (так и сейчас; AGENTS допускает «unless the task text says otherwise»); (2) прописать в AGENTS.md: «Codex — можно с тестами и без смены текстов; Hermes — нельзя». Рекомендую (2), чтобы правило не зависело от формулировки задания |
| Б2 | Журнал статусов, строки 22, 23, 68–73 | Журнал начал «ломаться»: строки 22–23 без колонки, 68 без закрывающей `|`, 72 — не строка таблицы, между 68 и 69 пустая строка → таблица рендерится как две. 32 КБ, 74 строки — это самый длинный файл памяти, читать его целиком при каждом исправлении дорого | `project_fix_status_journal.md` | Починить разметку (безопасно) и перенести закрытые строки старше месяца в архивный файл, оставив в основном открытые и последние 14 дней |
| Б3 | Память, «хвосты» | Исторические записи, которые в индексе занимают место и почти не нужны: Hermes 24→25.09 (2 файла), Hermes на OpenCode 16–17.10 (2), `branch_merge_2026_06_27`, `stray_worktrees_2026_06_30`, `local_db_from_prod` (копия от 26.05), `project_equipment_monitoring_wip` (имя «wip», но выкачено 27.05), `project_offsite_backup_r2_pending` (имя «pending», но LIVE) | индекс стр. 18–24, 41, 46, 90–91 | Объединить в 2–3 файла «История» или оставить как есть. **Ничего не удалять без проверки ссылок**: на `project_local_db_from_prod`, `project_equipment_monitoring_wip`, `reference_prod_infra` ссылаются 5–10 других файлов (обратные ссылки проверены) |
| Б4 | Frontmatter памяти | Три формата: `metadata.type` (≈125 файлов), верхний `type:` (5 старых: `user_role`, `project_karpathy_guidelines`, `feedback_dev_workflow`, `reference_postgres_design_rules`, `reference_prod_infra`), `name` ≠ имени файла почти везде (дефисы вместо подчёркиваний, у 15 — человекочитаемая фраза с пробелами) | скрипт проверки frontmatter | Ссылки `[[x]]` сейчас работают и по имени файла, и по `name`, поэтому вреда нет. Привести в единый вид — необязательно; решайте, нужна ли косметика |
| Б5 | `CLAUDE.md` ↔ память | «Неясно — назови предположения и спроси» (CLAUDE.md) против «не задавать открытых вопросов, когда следующий шаг очевиден» (там же ниже и в памяти). Не противоречие, но легко прочитать как «спрашивай всегда» | CLAUDE.md «Как работать» / «Владелец» | Добавить: «вопрос — только закрытый (да/нет или выбор из двух), и только когда ответ меняет действие» |
| Б6 | `CLAUDE.md` | Нет указателя на `AGENTS.md` и на то, что Codex работает по нему; нет правила «правишь CLAUDE.md — сверь AGENTS.md». Из-за этого и накопилось расхождение А1–А3 | `grep AGENTS CLAUDE.md` — пусто | Добавить одну строку в раздел «Как работать» |
| Б7 | `.claude/skills/*` | Не относятся к PilingTrack, но лежат в проекте: `notebooklm`, `cti-search-plugin`, `opengrep-rule-generator` (+`-research`), `project-documenter`, `research-pipeline`, `prd-generator`, `product-bible`, `feature-descriptor/*` (11 подскиллов). Каждое описание попадает в список навыков каждой сессии | `git ls-files .claude/skills` | Вынести в пользовательский каталог/архив (в `~/.claude/skills-archive` он уже есть) — **только после проверки**, что нигде не вызываются по имени |
| Б8 | `docs/karpathy-principles/CLAUDE.md` | Вложенный `CLAUDE.md` в `docs/` — дубль четырёх принципов из корневого CLAUDE.md; подтягивается, когда работаешь внутри этой папки | файл 65 строк | Оставить как источник (память `project_karpathy_guidelines` на него ссылается) или переименовать в `README.md`, чтобы не читался как инструкция |
| Б9 | Ранбук 008 и навык `deploy` | В обоих остались ручные команды `scripts/replace-worker-generation.sh app workers` (стр. 110, 168, 303 и 56, 67). Скрипт существует, но основной путь — `deploy-prod.sh --replace-worker-generation`. Это «запасной путь», как и сказано в CLAUDE.md | `ls scripts/replace-worker-generation.sh` — есть | Противоречия нет; только если захотите убрать запасной путь из навыка — решение владельца |

## 4. Что исправлено сразу (память, вне репозитория)

Только битые ссылки `[[...]]`; смысл текста не менялся.

| Файл памяти | Было → стало |
|---|---|
| `project_acting_roles.md`, `project_dark_theme_broken_to_module.md` | `[[project-to-module-wip]]` → `[[project_to_module_wip]]` |
| `project_pile_journal_in_reports.md` | `[[reference-prod-deploy-migrate-gotcha]]` → `[[reference_prod_deploy_migrate_gotcha]]` |
| `project_prod_deploy_log.md` | `[[reference-prod-deploy-disk]]` → `[[reference_prod_deploy_disk]]`; `[[reference-image-prune-kills-rollback-tags]]` → `[[image-prune-kills-rollback-tags]]` |
| `reference_deploy_builds_from_worktree.md`, `reference_local_staging.md` | `[[reference-prod-ssh]]` → `[[prod-ssh-access]]` |
| `reference_python_path.md` | `[[python3-windows-stub-gotcha]]` → `[[reference-python3-windows-stub-gotcha]]` |
| `reference_vitest_ignores_dotenv.md` | `[[project-prod-rls-not-enforced]]` → `[[prod-rls-not-enforced]]` |
| `reference_playwright_discovery_failfast.md` | `[[reference-tsc-next-types-false-clean]]` → `[[tsc-next-types-false-clean]]` |
| `user_role.md` | поле `name`: «User role and expertise» → `user-role` (на него ссылались `feedback_ste100_style` и `reference_chatgpt_dpi_block_byedpi`) |

Не трогал и не удалял ничего из репозитория. В репозиторий добавлен только этот отчёт.

## 5. Порядок, который я предлагаю

1. Одобрить А1–А9 одним словом — применю правки AGENTS.md, CLAUDE.md стр. 10, индекса, файлов памяти и путей в навыках одним коммитом (отдельно от кода).
2. Б1 и Б5–Б6 — три коротких решения (рекомендации указаны).
3. Б2, Б3, Б7 — уборка; можно отложить, срочности нет.

## 6. Статус

А1–А9 применены 25.10.2026 одним коммитом (репозиторий: AGENTS.md, CLAUDE.md, 6 навыков; память: индекс, `project_prod_deploy_log`, `project_owner_decisions_2026_10_18`, журнал статусов, два новых файла). А10 (2 висящие ссылки) не трогал.

## 7. Дополнение 25.10.2026: Б1–Б9 и А10 (по слову владельца «поправь все»)

| № | Что сделано |
|---|---|
| Б1 | AGENTS.md §1: экраны оператора разрешены Codex (с тестами, без смены текстов, версии не удалять и не сливать); заморожен только сайт ORION. Hermes — по-прежнему нельзя. Запись в памяти `project_operator_unfrozen_for_codex` |
| Б2 | Журнал статусов: чинены строки 22, 23, 68, 72 и разрыв таблицы. Часть строк по-прежнему с 5 ячейками вместо 6 (рендерится нормально). Архивирование не делал: все строки моложе месяца |
| Б3 | Файлы не объединялись (ссылки на них есть). В индексе 7 закрытых эпизодов вынесены в раздел «История» |
| Б4 | В 5 старых файлах `type:` перенесён в `metadata.type`. Поля `name` не менял — на них держатся ссылки |
| Б5, Б6 | CLAUDE.md: «вопрос — только закрытый…»; строка про `AGENTS.md` и обратную сверку (она же в AGENTS.md) |
| Б7 | В `~/.claude/skills-archive/pilingtrack-moved-2026-10-25/` скопированы (число файлов сверено) и убраны из репозитория: notebooklm, cti-search-plugin, opengrep-rule-generator(+research), project-documenter, research-pipeline, prd-generator, feature-descriptor. Остались `product-bible` (на него ссылаются 7 навыков проекта) и остальные. Восстановление: `git revert` коммита или копия из архива |
| Б8 | `docs/karpathy-principles/CLAUDE.md` → `GUIDELINES.md` (README.md там уже был) |
| Б9 | Противоречия нет (запасной путь по замыслу CLAUDE.md) — без изменений |
| А10 | Две висящие ссылки заменены пометкой «(файла нет)» |
| Адрес заданий split-1024 | Нашёлся: исходники в `.claude/worktrees/microservices-implementation-plan-9cb73e/docs/plans/tasks/split-1024`, копии с отчётами — в семи ветках `codex/split-*`; записано в `project_split_1024_codex` |
