# CODEX — поток 3, пробное слияние и решения владельца

Дата начала: 02.10.2026 (МСК). Рабочая папка: `D:\PillingR\wt-codex3`.
Ветка: `codex/merge-trial-1003`, исходный HEAD `6b37416aac034b125eeab4ba1254748b0c108810`.
Никакой выкладки, SSH/SCP, push, смены ветки, правок .env, пакетов, схемы или миграций вручную не выполнялось.

## M1 — слияния

- `c354a155` — `(CODEX-M1) Пробно слить ветку исправлений безопасности`, `fix/security-codex55`; конфликтов нет.
- `b6f602b5` — `(CODEX-M1) Пробно слить Hermes с сохранением плана I02`, `hermes/q4-0926` (проверенная вершина `3c550d02`).
- Единственный конфликт: `docs/runbooks/014-post-deploy-2026-10.md`, конец файла. Сохранены обе стороны: две ссылки Hermes в «См. также», затем раздел интеграции «Переход leader election на Redis состояния (I02)». Код конфликтов не имел.
- Frozen-экраны машиниста вошли только как часть прямо запрошенного слияния Hermes. Отдельных правок там нет. ORION вручную не менялся.

## Анализ влияния и окружение

Песочница Windows не запускается (`CryptUnprotectData failed: 2148073483`); команды выполнялись через разрешённый запуск вне песочницы, с cwd только назначенного worktree.

`node D:\PillingR\my-project\.gitnexus\run.cjs impact revokeRefreshToken --direction upstream --repo .` — exit 1. Runner неожиданно попытался автоматически подготовить пакет из кеша pnpm; нативный `@ladybugdb/core` упал на `spawnSync ...cmd.exe ENOENT`. Неожиданная попытка установки — ограничение runner; повторных запусков/установки GitNexus не делал. Зависимости проекта и package*.json вручную не менялись. В соответствии с исключением файла задания далее использован fallback `rg` + `git diff --stat`/`--check`, перед правками и коммитами. Callers/processes/risk графом НЕ подтверждены, `detect_changes` недоступен; это не нулевой риск.

## M2 — проверка слитого состояния до M4/M6–M8

Команды запускаются раздельно; число — реальный exit, не статус пайпа. `--no-install` у npx запрещает установку отсутствующего пакета.

| Команда | Exit | Результат |
|---|---:|---|
| удаление `.next/dev/types` | 0 | абсолютный путь проверен внутри worktree; reparse points запрещены; устаревших типов нет |
| `npx.cmd --no-install tsc --noEmit` | 0 | TypeScript прошёл |
| `npm.cmd run lint` | 0 | 0 ошибок, 7 предупреждений; text integrity passed |
| `npm.cmd run build` с процессным `DATABASE_URL_POSTGRES=postgresql://x:x@localhost:5432/x` | 1 | validate-env: отсутствуют DATABASE_PROVIDER и SESSION_SECRET; Next build не начался. Дополнительные env не выдуманы |
| `npx.cmd --no-install vitest run` (+ JSON reporter) | 1 | 323 файла passed, 2 failed, 9 skipped; 2900 тестов passed, 2 failed, 81 skipped (2983) |
| повтор `tests/contract/auth-api.spec.ts` + `src/workers/__tests__/unified-worker.test.ts`, `--maxWorkers=2` | 0 | 19/19, 2 файла; без увеличения таймаутов |
| отдельный daily-summary + api-routes + health route, `--maxWorkers=2` | 0 | 60/60, 3 файла |
| `npx.cmd --no-install playwright test --list` | 0 | 99 тестов в 11 файлах; это сбор списка, НЕ browser QA |

Два падения полного прогона: таймаут 30000 мс импорта auth route и health endpoint unified-worker. Изолированно оба набора прошли за 3.86 с, что указывает на массовую нагрузку окружения; исходный красный результат не скрывается. Известные семь падений daily-summary не воспроизведены: Hermes `74082959` (CX-H15) уже входит в ветку; отдельный прогон подтверждает работоспособность.

Предупреждения lint: `src/app/api/crews/all/route.ts:26`, `tests/integration/rls-tenant-enforcement.spec.ts:52`, `tech-readiness-projection.spec.ts:36`, `tech-readiness-shifts.spec.ts:60,249`, `tech-readiness-work-permits.spec.ts:49,105`. Вне текущих правок; не исправлялись.
Логи: `output/codex-t3/m2-{build,vitest,targeted,timeouts,playwright-list}.log`, JSON `m2-vitest.json`.

## M3 — Docker smoke

- `docker build -f Dockerfile.workers --target runner -t codex-workers:smoke .` — exit 0; реальный runner-образ собран.
- `bash scripts/smoke-workers-image.sh codex-workers:smoke` через системный Bash — exit 1: это WSL без команды docker.
- Тот же скрипт через `C:\Program Files\Git\bin\bash.exe` — exit 0, старт и `Arming` подтверждены. `--network none`, только фиктивные значения из smoke-скрипта, контейнер с префиксом codex- и trap cleanup.
- `docker image rm codex-workers:smoke` — exit 0. Удалён только созданный тег; чужие контейнеры/образы и общий Docker build cache не чистились.
- В `scripts/deploy-prod.sh` есть только workers smoke. Условие задания для app smoke не выполнено; app smoke не запускался.
Логи: `output/codex-t3/m3-workers-{build,smoke,smoke-gitbash}.log`.

## M4 — независимое ревью Hermes

База ровно `git diff a803e61c..hermes/q4-0926 -- src/`. Изменения не сводятся к текстам: outbox tenantId, защита видимости weekly trend, удаление обёртки completeInspection, смена Sentry SDK, обработка 409 формы, подтверждение закрытия ТО и offline retry UX. Просмотрены diff логики, callers и целевые тесты; полной браузерной проверки не было.

Серьёзная регрессия исправлена `e2b64326` — `(CODEX-M4) Сохранить защиту отчёта от потери чужих правок при 409`. Hermes перечитывал только версию (7), оставляя данные старой формы (3): второй POST мог затереть чужие изменения. Теперь token остаётся от показанной формы, повтор остаётся конфликтом; ввод не стирается, предлагается скопировать правки и заново открыть актуальный отчёт. Автоматического слияния данных нет.

Тест сначала красный: expected version 3, received 7 (exit 1, 7 passed/1 failed). После исправления форма + серверный repository: exit 0, 14/14 в 2 файлах. Логи `m4-red-version.log`, `m4-green.log`. Первый вариант красного теста истекал по waitFor; затем ожидание отделено от синхронной проверки версии, получен точный AssertionError.

Удалён только локальный помощник `refreshVersion` и связанный state из формы: поиск всего worktree (src/e2e/tests/scripts/prisma/config/docs, исключены секреты/сгенерированные файлы) показал единственный вызов в той же форме. Экспорт/файл не удалялся, существующий тест заменён безопасным контрактом. Diff M4: форма +3/-28; тест +9/-9.

Остальные замечания для владельца:

| Файл:строка | Что | Важность |
|---|---|---|
| `src/modules/crews/infrastructure/crew.repository.ts:34` | outbox tenantId берётся из контекста пользователя, не из Site. Это исправляет текущую односоставную организацию, но для platform ADMIN и объекта другой организации контекст не доказывает tenantId объекта. Нужен разбор перед tenant #2; null по-прежнему может создать непроецируемое событие | P2, до tenant #2, не новая утечка |
| `src/components/piling/admin-sites/use-site-mutations.ts:93` | общий catch классифицирует и не-JSON успешный ответ/ошибку JS как отсутствие сети | P3, диагностика |
| `src/components/piling/maintenance/maintenance-board.ts:224` | текст «данные обновлены» на 409 показывается до успешного load; при отказе повторного GET это обещание не подтверждено | P3 |
| `src/components/piling/monitoring/equipment-tile-block.tsx:72` | pending URL отображается как «фото не загружено», а ошибка самого img после presigned URL не перехватывается | P3 |
| `src/workers/__tests__/no-next-in-workers.test.ts` | охватывает статический граф и прямые dynamic package imports, но не транзитивный локальный dynamic import. Ограничение не выдаётся за полный runtime-proof; M3 закрывает запуск образа | ограничение проверки |

Guard `no-global-db-in-tx` исключает только TypeScript type nodes, добавляет проверку runtime db — ослабления runtime-контракта не найдено. `projectWeeklyTrend` требует совпадения expected tenant при невидимом Site, ошибок не проглатывает; события повторяются/DLQ. completeInspection был тонкой обёрткой, действующий маршрут вызывает completeInspectionWithOutcome.

## M5 — план выкладки (НЕ выполнялся)

`git diff a803e61c..HEAD -- prisma/migrations` пуст: новых миграций в диапазоне нет, отдельный пересбор migrate из-за новых SQL не требуется. При изменении итогового диапазона владелец повторяет diff; если появится migration.sql, ОБЯЗАТЕЛЬНО build migrate и проверка _prisma_migrations после запуска. App и workers пересобрать и перезапустить вместе, app после успешного migrate; Redis/Postgres ради этих правок не перезапускать. Ранбук 014 отдельно описывает Prometheus/app-guard и прочие ручные операции.

I02 переносит `leader:outbox-worker`/`leader:projection-worker` из cache Redis в state Redis. TTL 30 с, renewal 10 с; одинаковый префикс НЕ делает два Redis общим lock. Все старые unified, standalone, embedded workers должны закончить работу до старта хотя бы одного нового. App запускает embedded outbox/projection по умолчанию вне test (`src/workers/embedded-workers.ts:43–60`), поэтому остановки одного workers-контейнера недостаточно. Lease не является DB fencing.

Текущий `scripts/deploy-prod.sh:102–108` делает только `compose up`; режима согласованного stop/drain в нём НЕТ. Для перехода I02 владельцу/Claude нужно добавить барьер в блок «Переключение», после доставки образов/проверки SHA и ДО `compose up`. Минимальная последовательность для обычного compose (образцы команд, здесь не запускались):

```bash
# Сначала инвентаризация и отключение автоперезапуска ВСЕХ старых standalone
# и сторонних реплик (systemd/pm2/другой compose/хост) владельцем.
# Затем в удалённом блоке deploy-prod.sh:
docker compose stop --timeout 120 app workers
# Проверка не только health: ни одной RUNNING старой app/workers реплики.
[ -z "$(docker compose ps --status running -q app workers)" ] || exit 1
# Все внешние standalone подтверждены остановленными, операции drain завершены.
# Только после этого:
docker compose up -d --no-build app workers
```

Не переходить через короткое окно «новый app + старый workers» или наоборот. После остановки проверять завершение операций; истечения TTL недостаточно при paused/in-flight процессе. При невозможности доказать отсутствие отдельного старого исполнителя переход остановить. Для отката нужен тот же общий барьер stop-all, иначе новые state-lease и старые cache-lease снова работают одновременно. Скрипт только изучен, не изменялся и не запускался.

Предвыкладочные блокеры: build env не готов; первый полный тестовый прогон красный; графовый анализ недоступен; финальные решения M6–M8 и проверки ниже ещё выполняются. Production готовым не объявляется.

## M6 / I05 — только отправленные в показателях

Коммит 276d777b. Общее правило `src/lib/report-status.ts`: строго `status === 'submitted'`; неизвестный/пустой статус также не считается. Исправлены KPI мониторинга, окно 30 дней техники, period summary, raw daily SQL, overview (вместо «не draft»). Дневная событийная проекция, rebuild, list/dashboard sums и SQL аналитики объектов/техники используют ту же константу. Weekly читает уже отфильтрованный daily.

Построчная история и ReportAnalytics сохраняют черновики со статусом: исходные данные для журнала, а не сумма KPI. В XLSX «Итоги» только submitted, несданные — отдельный лист «Черновики» и колонка статуса; CSV сохраняет явную пометку. PDF рассчитывает верхние показатели по submitted, черновики — отдельный раздел и статус в детализации. Экран машиниста вручную не менялся.

Тесты draft→submitted: period KPI (также null/unknown), fleet, карточка техники с сохранённой историей, live daily, rebuild (сохранение черновика ReportAnalytics), XLSX, PDF; raw SQL проверяет bound submitted. Старые ожидания включения draft в Excel обновлены под решение владельца, проверки данных сохранены. Новый rebuild.test.ts прямо требуется M6 и защищает destructive wipe/rebuild.

Scoped Vitest: exit 0, 15 файлов /157 passed/0 failed/0 skipped (output/codex-t3/m6-final-green.log). tsc exit 0 (m6-tsc-final.log). lint exit 0, прежние 7 warnings/0 errors (m6-lint.log). Промежуточные красные прогоны сохранены: устаревшие ожидания SQL/XLSX и формат PDF-теста исправлены. Браузерные сценарии не выполнялись. GitNexus недоступен как в M1: подтверждены вызовы rg, проверены diff --stat/--check; графовый риск не объявляется низким.