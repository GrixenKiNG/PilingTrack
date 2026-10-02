# CODEX — поток 3, пробное слияние и решения владельца

Дата начала: 02.10.2026 (МСК). Рабочая папка: `D:\PillingR\wt-codex3`.
Ветка: `codex/merge-trial-1003`, исходный HEAD `6b37416aac034b125eeab4ba1254748b0c108810`.
Никакой выкладки, SSH/SCP, push, смены ветки, правок .env, пакетов, схемы или миграций вручную не выполнялось.

Завершено 03.10.2026 (МСК): M1–M8 реализованы и проверены в назначенной ветке. Последний полный Vitest: 2923 passed/0 failed/81 skipped. TypeScript/lint/Docker smoke passed; Next build остановлен до компиляции из-за отсутствующих DATABASE_PROVIDER и SESSION_SECRET. Очистка PDF выключена по умолчанию. Все локальные изменения закоммичены; публикации и выкладки нет.

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

Удалён только локальный помощник `refreshVersion` и связанный state из формы: поиск всего worktree (src/e2e/tests/scripts/prisma/config/docs, исключены секреты/сгенерированные файлы) показал единственный вызов в той же форме. Экспорт/файл не удалялся, существующий тест заменён безопасным контрактом. Diff коммита M4: форма +4/-27; тест +8/-10 (git show --numstat e2b64326).

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

Предвыкладочные блокеры: build env не готов, графовый анализ недоступен, live DB/browser QA не выполнены. Первоначальный красный Vitest сохраняется как исторический результат; последний полный прогон прошёл, см. финальную таблицу. M6–M8 завершены. Production готовым не объявляется.

## M6 / I05 — только отправленные в показателях

Коммит 276d777b. Общее правило `src/lib/report-status.ts`: строго `status === 'submitted'`; неизвестный/пустой статус также не считается. Исправлены KPI мониторинга, окно 30 дней техники, period summary, raw daily SQL, overview (вместо «не draft»). Дневная событийная проекция, rebuild, list/dashboard sums и SQL аналитики объектов/техники используют ту же константу. Weekly читает уже отфильтрованный daily.

Построчная история и ReportAnalytics сохраняют черновики со статусом: исходные данные для журнала, а не сумма KPI. В XLSX «Итоги» только submitted, несданные — отдельный лист «Черновики» и колонка статуса; CSV сохраняет явную пометку. PDF рассчитывает верхние показатели по submitted, черновики — отдельный раздел и статус в детализации. Экран машиниста вручную не менялся.

Тесты draft→submitted: period KPI (также null/unknown), fleet, карточка техники с сохранённой историей, live daily, rebuild (сохранение черновика ReportAnalytics), XLSX, PDF; raw SQL проверяет bound submitted. Старые ожидания включения draft в Excel обновлены под решение владельца, проверки данных сохранены. Новый rebuild.test.ts прямо требуется M6 и защищает destructive wipe/rebuild.

Scoped Vitest: exit 0, 15 файлов /157 passed/0 failed/0 skipped (output/codex-t3/m6-final-green.log). tsc exit 0 (m6-tsc-final.log). lint exit 0, прежние 7 warnings/0 errors (m6-lint.log). Промежуточные красные прогоны сохранены: устаревшие ожидания SQL/XLSX и формат PDF-теста исправлены. Браузерные сценарии не выполнялись. GitNexus недоступен как в M1: подтверждены вызовы rg, проверены diff --stat/--check; графовый риск не объявляется низким.
## M7 / I08 — повтор только недоставленной части Telegram

`deliverToAll` теперь возвращает true только при подтверждении всех включённых чатов. В существующем payload OutboxEvent хранится белый список подтверждённых chatId (`telegramDeliveredChatIds`), без токенов. Alert/PDF читают его под прежней блокировкой строки; частичный результат возвращает false из транзакции, квитанции коммитятся, затем исключение запускает обычный retry/backoff. Опубликованное событие пропускается. При DLQ берётся текущий payload из БД, а не устаревший снимок пачки: ручной retry сохраняет квитанции.

HTTP 2xx без `ok: true` Telegram не считается подтверждением; таймаут/неясный ответ повторяется. PDF получил такой же timeout 5 секунд, как текст. Если Telegram принял запрос, но ответ/commit потерялся, допускается редкий дубль согласно решению владельца. Без сохранённого подтверждения сообщение не теряется. Прямые sendMessage/sendAlert без event identity — отдельная отправка; постоянные квитанции подключены к обоим существующим durable путям (alert и PDF), схема/tenant-условия не менялись.

Тесты: реальные mocked fetch в частичной A-success/B-timeout пачке и новый progress из сохранённого JSON отправляют второй раз только B; HTTP ok без Telegram ok не подтверждается. Отдельно alert и PDF сохраняют частичные квитанции до повторного вызова; DLQ получает свежие квитанции. Scoped Vitest exit 0, 5 файлов /74 passed/0 failed/0 skipped (output/codex-t3/m7-tests.log); tsc exit 0 (m7-tsc.log). GitNexus fallback rg+diff, diff --check exit 0. Живые сообщения Telegram не отправлялись.
## M8 / I11 — хранение временных PDF

Очистка сканирует только `storage/pdf-results/` либо S3 `pdf-results/`, без рекурсии и без запроса Media. Белый список: точный префикс + имя UUID v4 задания + расширение .pdf; локально дополнительно `%PDF-`, обычный файл без symlink/junction/hard link, проверенная canonical root; S3 — HeadObject `ContentType=application/pdf` и LastModified. Удаляется строго старше 30×24 часов; ровно 30 дней сохраняется. Возраст/тип перепроверяются перед удалением; обновлённый файл сохраняется. save/read/delete temporary PDF также отвергают traversal и чужие имена.

Media строит ключи `media/<tenant>/<entityType>/<entityId>/...` (`src/core/media/media-content.ts:165`), которые белому списку не соответствуют даже для PDF-вложения. Права/TTL/удаление Media не менялись. PDF, формируемый для Telegram прямо в Buffer, не создаёт временный объект. Неизвестные/исторические имена, не соответствующие текущему UUID v4, пропускаются: удаление их без подтверждения типа не расширялось.

Планировщик в unified-worker: через 60 секунд после старта и раз в сутки; stop выключает таймеры и ждёт активный проход; перекрывающиеся проходы не запускаются. По умолчанию отключён, включая production. Владелец отдельно передаст в окружение сервиса workers:

1. Для первой read-only проверки `PDF_TEMP_CLEANUP_ENABLED=true` и `PDF_TEMP_CLEANUP_DRY_RUN=true` (последнее и так значение по умолчанию).
2. После просмотра логов `Temporary PDF cleanup plan` с count/keys/backend — явно `PDF_TEMP_CLEANUP_DRY_RUN=false`, оставив enabled=true.
3. Выключение: убрать enabled или выставить false. Одной переменной dry-run=false недостаточно для запуска.

.env/docker-compose/deploy scripts не менялись и на бою флаги не включались. Это надо включить владельцу/Claude именно в контейнер workers; планировщик встроенного app это не запускает.

Тесты с настоящими локальными файлами: dry-run сохраняет кандидата; apply удаляет только старый временный UUID PDF после лога; свежий/ровно 30-дневный, JPEG (включая переименованный .pdf), PDF-вложение Media, неизвестное имя, подкаталог, hard link и junction сохраняются/отклоняются. Mocked S3: pagination, чужие ключи, неверный MIME, обновлённый объект, отсутствие delete в dry-run, log до delete. Планировщик: production без opt-in, dry-run по умолчанию, ежедневный запуск, stop и повтор после ошибки. Scoped Vitest exit 0, 6 файлов /55 passed/0 failed/0 skipped (m8-green.log). tsc exit 0; lint exit 0, 7 прежних warnings (m8-tsc.log/m8-lint.log). Предварительный красный прогон из-за неочищенного logger mock исправлен в тесте. MaxListeners warnings исходных unified-worker тестов оставлены, production listeners не менялись.
### M7, дополнение — входная пачка Alertmanager (исходная I08 / R69)

Финальный обход выявил, что исправление по чатам ещё не закрывало HTTP-пачку `src/app/api/alerts/webhook/route.ts`: она отвечала 200 при 0<forwarded<firing. Закрыто дополнительно: каждый firing-алерт сохраняется в существующем outbox; compound dedupe `(tenantId, dedupeKey)` использует хеш отсортированных labels + startsAt, поэтому порядок пачки не влияет. Уже опубликованные доставки пропускаются, pending повторяется через тот же durable handler с квитанциями чатов; при неполной доставке HTTP503. `forwarded` включает подтверждённые ранее сообщения. Вся пачка сохраняется; за запрос до 100 новых попыток, хвост не обрезается и доставляется очередью/следующим повтором. Это устраняет также потерю сообщения №101.

Для алерта без корректного startsAt идентичность сомнительна: новый id и возможный повтор согласно решению владельца, без вечной ошибочной дедупликации следующей аварии. Settings systemAlerts проверяются и у queued доставки по отдельному validated notificationKey; они не подменяются совпавшим именем доменного правила. При DLQ маршрут не выдаёт её за доставку, нужна обычная ручная проверка/повтор DLQ. Shared-secret auth/validation не ослаблялись; DB-запись/доставка идут в контексте DEFAULT_TENANT_ID, при его отсутствии 503 без записи.

Тесты: реальный durable handler с mocked DB/Telegram; A failed/B delivered →503; повтор перевёрнутой пачки → только A, 200. Пачка 101 →503/100 delivered/101 queued; повтор → одна отправка и 200/101. Scoped exit0: 3 файла/44 passed/0 skipped (m7-webhook-tests.log). Последние tsc/lint exit0 (final2-tsc.log/final2-lint.log), 7 прежних warnings. После дополнения повторён весь Vitest; результат в финальной таблице ниже. Живая БД/Alertmanager/Telegram не проверялись.
### M3, финальный smoke после всех правок

Исходное и оба итоговых повторения workers build/smoke завершились exit0. Последний повтор с runtime-кодом `a7edca31`:

- `docker build -f Dockerfile.workers --target runner -t codex-workers:smoke .` — exit0; output/codex-t3/final2-workers-build.log.
- Git Bash `bash scripts/smoke-workers-image.sh codex-workers:smoke` — exit0; фактический старт и Arming подтверждены, output/codex-t3/final2-workers-smoke.log. Скрипт принимает ровно один аргумент, создаёт codex-workers-smoke-* с network none и убирает контейнер по trap.
- `docker image rm codex-workers:smoke` — exit0, tag удалён. Cache Docker не чистился. pilingtrack-* контейнеры не затрагивались.
- App smoke в deploy-prod.sh отсутствует, поэтому условная часть M3 не применима; app build через Next остаётся заблокирован окружением.

Это проверка загрузки worker runtime без Next, а не живого Redis/БД, Telegram или выполнения opt-in cleanup на S3. Последний build имел image manifest sha256:4c349721fa9baf59977c4e68a008479e500d3e2ba5d22b1547d9f6ccbc3fd32e до удаления codex-tag.

## Финальная проверка после последнего runtime-коммита a7edca31

| Команда | Exit | Ключевой результат |
|---|---:|---|
| проверенное удаление .next/dev/types внутри worktree | 0 | перед финальным tsc; reparse points запрещены |
| npx.cmd --no-install tsc --noEmit | 0 | final2-tsc.log; типы всего проекта |
| npm.cmd run lint | 0 | final2-lint.log; 0 errors/7 прежних warnings; text integrity passed |
| npm.cmd run test:unit -- --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=output/codex-t3/final2-vitest.json | 0 | 328 файлов passed/9 skipped (337); 2923 tests passed/0 failed/81 skipped (3004), 262.85 с |
| npx.cmd --no-install playwright test --list | 0 | final2-playwright-list.log; 99 tests/11 files, как до правок; E2E не запускались |
| npm.cmd run build, процессный DATABASE_URL_POSTGRES=postgresql://x:x@localhost:5432/x | 1 | final2-build.log; validate-env требует DATABASE_PROVIDER и SESSION_SECRET; Next-компиляция не началась |
| docker build -f Dockerfile.workers --target runner -t codex-workers:smoke . | 0 | final2-workers-build.log; реальный финальный runner |
| Git Bash: bash scripts/smoke-workers-image.sh codex-workers:smoke | 0 | final2-workers-smoke.log; старт/Arming, network none |
| docker image rm codex-workers:smoke | 0 | codex-tag удалён; фильтр codex-workers-smoke-* и codex-workers:smoke пуст |
| git diff --check | 0 | whitespace/conflict markers нет |
| GitNexus impact/detect_changes | 1 / не запускался повторно | runtime runner отказал, разрешённый fallback rg+diff; graph risk неизвестен |

Разрешённая фиктивная DB-переменная использовалась только процессно для build. Иные build env не подставлялись, env-файлы не открывались/не менялись. 81 skipped не названы passed; в частности живые integration/RLS/tenant pipeline требуют реальной disposable DB и не проверены. JSON/логи лежат в output/codex-t3 (ignored), фактические результаты и команды закреплены этим отчётом. Сначала полный прогон с default workers был красным из-за двух 30-секундных таймаутов; оба отдельные набора и два полных последних прогона с maxWorkers=2 прошли без увеличения таймаутов.

## Ограничения и что оставлено владельцу

- Никаких ручных правок auth/core/security, tenancy/RLS реализации, schema/migrations, package*.json, Dockerfile/compose/deploy scripts, экранов машиниста/ORION. Слияния безопасности и Hermes содержат исходные правки этих веток, прямо запрошенные M1; отдельно эти области не перерабатывались. Metadata diff .env* пуст, содержимое не читалось.
- Миграции от a803e61c по-прежнему отсутствуют. План M5 остаётся stop-all старых app/workers/standalone с остановкой автоперезапуска, проверкой отсутствия всех старых реплик и только затем одновременным стартом новых. STOP_ALL относится также к откату.
- У unified-worker внутренний shutdown deadline по умолчанию 8000 мс (WORKER_SHUTDOWN_TIMEOUT_MS). Compose --timeout 120 не отменяет его: нельзя объявить in-flight drain доказанным только по этой команде. Владелец должен проверить завершение/rollback и возврат незавершённых jobs в очередь; все старые процессы должны прекратить выполнение до старта новых. Скрипт deploy-prod.sh сам пока не реализует барьер — в отчёте дан план правки, выкладка/правка deploy-скрипта не выполнялись.
- Next build/route-type compilation, live DB/RLS, настоящий Telegram/Alertmanager, S3 и браузерный PDF/UI просмотр не проверены. Docker smoke проверяет старт worker runtime, не выполнение всех задач на инфраструктуре.
- I08: при потере ответа Telegram/commit или отсутствии надёжного startsAt возможен редкий дубль; подтверждённые сохранённые доставки пропускаются. DLQ не скрывается как успешная доставка, повтор там ручной по существующей процедуре.
- I11: по умолчанию off; первый opt-in — dry-run. Белый список пропускает неизвестные/старые имена не UUID v4. Перед apply владелец проверяет count/keys в логах и включение флагов в workers; автоматического удаления Media нет.
- 7 исходных lint warnings и мелкие замечания M4 не исправлялись как несвязанные. Графовая проверка не подтверждена; риск не обозначен low. RPO/RTO и внешний мониторинг не реализовывались, согласно заданию.

## Коммиты потока

| Hash | Действие |
|---|---|
| c354a155 | (CODEX-M1) Пробно слить ветку исправлений безопасности |
| b6f602b5 | (CODEX-M1) Пробно слить Hermes с сохранением плана I02 |
| e2b64326 | (CODEX-M4) Сохранить защиту отчёта от потери чужих правок при 409 |
| c99d87b1 | (CODEX-M5) Записать проверки, ревью и план согласованной выкладки I02 |
| 276d777b | (CODEX-M6) Исключить черновики из выработки и сохранить отдельную историю |
| e6982cc1 | (CODEX-M6) Записать доказательства правила submitted в отчёт |
| 65a0d051 | (CODEX-M7) Повторять только неподтверждённые доставки Telegram |
| 46501848 | (CODEX-M8) Добавить отключённую очистку временных PDF с dry-run и защитой вложений |
| a7edca31 | (CODEX-M7) Сохранить частичную пачку Alertmanager и повторять только её остаток |
| b18347f6 | (CODEX-M3) Записать успешный Docker smoke окончательного worker runtime |

Последний отчётный commit M2 содержит эту финальную таблицу и инвентарь; его hash виден в git log и итоговом ответе (самоссылка на свой hash в файле не записывается).

## Удаления и доказательства

Ручных удалений файлов/экспортов после слияний нет. В M4 удалён приватный refreshVersion: его единственный caller был локальным обработчиком 409, теперь удалённым; отдельного экспорта и теста функции не было, regression-тест поведения усилен.

В запрошенной ветке безопасности пришли ровно два удаления: prisma/rls-setup.sql и src/core/security/index.ts. Поиск whole worktree (src/e2e/tests/scripts/prisma/config/docs, исключены .env, .git, node_modules, generated/output) для rls-setup.sql, core/security/index и импорта @/core/security дал только исторические docs/audits/proposals, без live imports/SQL invocation/CSS/route-string usage. Barrel реэкспортировал оставшиеся tenant-enforcement/idempotency реализации; они сохранены. SQL был устаревшим образцом RLS, текущие миграции сохранены. Полный tsc/unit и Playwright collection не обнаружили потерянных импортов. Graph zero не использовался как доказательство; Next build не проверен.

## Ручные изменения M4–M8 после слияний

Добавлено/удалено строк, git diff --numstat b6f602b5..HEAD. Binary отмечены «-». Это diff, а не размер файла.

| Путь | + | − |
|---|---:|---:|
| CODEX-REPORT-T3.md | 433 | 0 |
| src/app/api/admin/analytics/overview/route.ts | 2 | 1 |
| src/app/api/alerts/webhook/__tests__/route.test.ts | 46 | 11 |
| src/app/api/alerts/webhook/route.ts | 40 | 21 |
| src/app/api/reports/period/__tests__/period-summary.test.ts | 17 | 4 |
| src/app/api/reports/period/__tests__/route.test.ts | 1 | 1 |
| src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx | 8 | 10 |
| src/components/piling/admin-reports/report-form-dialog.tsx | 4 | 27 |
| src/core/infrastructure/__tests__/raw-queries.test.ts | 9 | 0 |
| src/core/infrastructure/raw-queries.ts | 2 | 0 |
| src/core/notifications/__tests__/telegram.test.ts | 36 | 8 |
| src/core/notifications/durable-alert.ts | 2 | 1 |
| src/core/notifications/telegram-delivery-progress.ts | 24 | 0 |
| src/core/notifications/telegram.ts | 19 | 17 |
| src/lib/__tests__/pdf-generator.test.ts | 19 | 0 |
| src/lib/__tests__/pile-meters-invariant.test.ts | 1 | 1 |
| src/lib/pdf-data.ts | 2 | 1 |
| src/lib/pdf-generator/__tests__/cleanup.test.ts | 108 | 0 |
| src/lib/pdf-generator/cleanup.ts | 90 | 0 |
| src/lib/pdf-generator/components.ts | 2 | 2 |
| src/lib/pdf-generator/period-pdf.ts | 19 | 10 |
| src/lib/pdf-generator/storage.ts | 15 | 8 |
| src/lib/report-status.ts | 6 | 0 |
| src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts | 20 | 6 |
| src/modules/equipment/application/queries/equipment-query.service.ts | 2 | 1 |
| src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts | 16 | 0 |
| src/modules/monitoring/application/queries/fleet-monitoring.service.ts | 2 | 0 |
| src/modules/reports/application/projections/__tests__/rebuild.test.ts | 28 | 0 |
| src/modules/reports/application/projections/rebuild.ts | 2 | 1 |
| src/modules/reports/application/queries/__tests__/export-reports-csv.test.ts | 19 | 0 |
| src/modules/reports/application/queries/__tests__/report-query.service.test.ts | 4 | 2 |
| src/modules/reports/application/queries/report-export.service.ts | 6 | 11 |
| src/modules/reports/application/queries/report-query.service.ts | 2 | 1 |
| src/modules/reports/domain/period-summary.ts | 5 | 2 |
| src/services/analytics/__tests__/site-analytics-service.test.ts | 4 | 2 |
| src/services/analytics/equipment-analytics-service.ts | 3 | 2 |
| src/services/analytics/site-analytics-service.ts | 8 | 7 |
| src/services/notifications/__tests__/durable-alert-delivery.test.ts | 25 | 1 |
| src/services/notifications/durable-alert-delivery.ts | 13 | 6 |
| src/services/reports/__tests__/daily-summary.test.ts | 28 | 0 |
| src/services/reports/event-handlers.ts | 14 | 6 |
| src/services/reports/outbox-publisher.ts | 3 | 1 |
| src/workers/__tests__/outbox-worker.test.ts | 12 | 0 |
| src/workers/unified-worker.ts | 9 | 0 |
| src/workers/unified-worker/__tests__/pdf-cleanup-scheduler.test.ts | 27 | 0 |
| src/workers/unified-worker/pdf-cleanup-scheduler.ts | 18 | 0 |

## Полный состав изменений с двумя merge

Добавлено/удалено строк, git diff --numstat 6b37416a..HEAD. Binary отмечены «-». Это diff, а не размер файла.

| Путь | + | − |
|---|---:|---:|
| CODEX-REPORT-T3.md | 433 | 0 |
| README.md | 6 | 0 |
| docs/DATA-SOURCES.md | 14 | 10 |
| docs/audits/hermes-night/02-silent-failures.md | 49 | 1 |
| docs/audits/hermes-night/R100-inspections-messages.md | 148 | 0 |
| docs/audits/hermes-night/R101-monitoring-messages.md | 131 | 0 |
| docs/audits/hermes-night/R102-admin-crews-messages.md | 123 | 0 |
| docs/audits/hermes-night/R103-admin-dictionaries-messages.md | 160 | 0 |
| docs/audits/hermes-night/R104-admin-incidents-messages.md | 131 | 0 |
| docs/audits/hermes-night/R105-briefings-messages.md | 130 | 0 |
| docs/audits/hermes-night/R106-analytics-dashboard-messages.md | 123 | 0 |
| docs/audits/hermes-night/R107-pile-journal-messages.md | 70 | 0 |
| docs/audits/hermes-night/R108-layout-editor-messages.md | 112 | 0 |
| docs/audits/hermes-night/R69-alerts-delivery.md | 70 | 0 |
| docs/audits/hermes-night/R85-global-db-inside-tx.md | 54 | 0 |
| docs/audits/hermes-night/R87-audit-log-stopped.md | 88 | 0 |
| docs/audits/hermes-night/R89-v1-messages-consistency.md | 134 | 0 |
| docs/audits/hermes-night/R90-night-leftovers.md | 68 | 0 |
| docs/audits/hermes-night/R91-changes-since-deploy.md | 81 | 0 |
| docs/audits/hermes-night/R92-env-passthrough.md | 231 | 0 |
| docs/audits/hermes-night/R93-admin-reports-messages.md | 163 | 0 |
| docs/audits/hermes-night/R94-maintenance-messages.md | 67 | 0 |
| docs/audits/hermes-night/R95-admin-dlq.md | 79 | 0 |
| docs/audits/hermes-night/R96-readiness-idempotency.md | 97 | 0 |
| docs/audits/hermes-night/R97-admin-equipment-messages.md | 191 | 0 |
| docs/audits/hermes-night/R98-admin-users-messages.md | 142 | 0 |
| docs/audits/hermes-night/R99-admin-sites-messages.md | 177 | 0 |
| docs/runbooks/008-manual-deploy.md | 51 | 0 |
| docs/runbooks/013-prod-timers.md | 35 | 1 |
| docs/runbooks/014-post-deploy-2026-10.md | 180 | 1 |
| docs/runbooks/015-encryption-key-rotation.md | 244 | 0 |
| docs/strategy/quality-inventory.md | 192 | 0 |
| prisma/rls-setup.sql | 0 | 91 |
| src/app/api/__tests__/api-routes.test.ts | 0 | 1 |
| src/app/api/admin/analytics/overview/route.ts | 2 | 1 |
| src/app/api/alerts/webhook/__tests__/route.test.ts | 46 | 11 |
| src/app/api/alerts/webhook/route.ts | 40 | 21 |
| src/app/api/auth/login/__tests__/route.test.ts | 14 | 2 |
| src/app/api/auth/login/route.ts | 10 | 0 |
| src/app/api/reports/period/__tests__/period-summary.test.ts | 17 | 4 |
| src/app/api/reports/period/__tests__/route.test.ts | 1 | 1 |
| src/components/piling/__tests__/admin-dlq.test.tsx | 175 | 0 |
| src/components/piling/admin-crews/__tests__/admin-crews.test.tsx | 151 | 0 |
| src/components/piling/admin-crews/__tests__/crew-messages.test.ts | 60 | 0 |
| src/components/piling/admin-crews/__tests__/use-crews-data.test.ts | 118 | 0 |
| src/components/piling/admin-crews/admin-crews.tsx | 16 | 9 |
| src/components/piling/admin-crews/crew-form-dialog.tsx | 22 | 3 |
| src/components/piling/admin-crews/crew-messages.ts | 46 | 0 |
| src/components/piling/admin-crews/use-crews-data.ts | 11 | 9 |
| src/components/piling/admin-dictionaries/__tests__/admin-dictionaries.test.tsx | 21 | 0 |
| src/components/piling/admin-dictionaries/dictionary-form.tsx | 13 | 3 |
| src/components/piling/admin-dlq.tsx | 78 | 17 |
| src/components/piling/admin-incidents/__tests__/admin-incidents.test.tsx | 150 | 0 |
| src/components/piling/admin-incidents/admin-incidents.tsx | 91 | 24 |
| src/components/piling/admin-reports/__tests__/admin-reports.test.tsx | 142 | 0 |
| src/components/piling/admin-reports/__tests__/report-evidence-preview.test.tsx | 100 | 0 |
| src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx | 131 | 0 |
| src/components/piling/admin-reports/__tests__/use-reports-data.test.ts | 74 | 0 |
| src/components/piling/admin-reports/admin-reports.tsx | 34 | 5 |
| src/components/piling/admin-reports/report-evidence-preview.tsx | 31 | 3 |
| src/components/piling/admin-reports/report-form-dialog.tsx | 22 | 2 |
| src/components/piling/admin-reports/use-reports-data.ts | 28 | 5 |
| src/components/piling/admin-sites/__tests__/admin-sites-hierarchy.test.tsx | 67 | 0 |
| src/components/piling/admin-sites/__tests__/use-site-mutations.test.ts | 110 | 4 |
| src/components/piling/admin-sites/__tests__/use-sites-overview.test.ts | 56 | 0 |
| src/components/piling/admin-sites/__tests__/user-assignment.test.tsx | 62 | 0 |
| src/components/piling/admin-sites/index.tsx | 31 | 11 |
| src/components/piling/admin-sites/site-editor/__tests__/add-hierarchy-dialog.test.tsx | 33 | 0 |
| src/components/piling/admin-sites/site-editor/add-hierarchy-dialog.tsx | 5 | 3 |
| src/components/piling/admin-sites/use-site-mutations.ts | 53 | 19 |
| src/components/piling/admin-sites/use-sites-overview.ts | 25 | 2 |
| src/components/piling/admin-sites/user-assignment.tsx | 27 | 8 |
| src/components/piling/analytics-dashboard/__tests__/kpi-widgets.test.tsx | 85 | 0 |
| src/components/piling/analytics-dashboard/kpi-widgets.tsx | 41 | 8 |
| src/components/piling/briefings/__tests__/briefing-journal-print.test.tsx | 68 | 0 |
| src/components/piling/briefings/briefing-journal-print.tsx | 12 | 2 |
| src/components/piling/inspections/__tests__/inspection-messages.test.tsx | 355 | 0 |
| src/components/piling/inspections/inspection-api-error.ts | 72 | 0 |
| src/components/piling/inspections/inspection-item-photos.tsx | 32 | 3 |
| src/components/piling/inspections/inspections-list.tsx | 25 | 3 |
| src/components/piling/inspections/run-inspection.tsx | 49 | 15 |
| src/components/piling/inspections/template-editor.tsx | 45 | 3 |
| src/components/piling/inspections/template-list.tsx | 24 | 2 |
| src/components/piling/maintenance/__tests__/maintenance-helpers.test.ts | 39 | 1 |
| src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx | 209 | 0 |
| src/components/piling/maintenance/__tests__/maintenance-mobile-targets.test.tsx | 4 | 1 |
| src/components/piling/maintenance/maintenance-board.tsx | 45 | 15 |
| src/components/piling/maintenance/maintenance-helpers.ts | 27 | 0 |
| src/components/piling/maintenance/maintenance-request-form.tsx | 3 | 2 |
| src/components/piling/maintenance/work-order-detail.tsx | 39 | 7 |
| src/components/piling/maintenance/work-order-form-dialog.tsx | 3 | 2 |
| src/components/piling/monitoring/__tests__/equipment-tile-block.test.tsx | 110 | 0 |
| src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx | 57 | 0 |
| src/components/piling/monitoring/equipment-tile-block.tsx | 29 | 16 |
| src/components/piling/monitoring/fleet-dashboard.tsx | 26 | 4 |
| src/components/piling/operator-mobile/__tests__/api.test.ts | 187 | 11 |
| src/components/piling/operator-mobile/__tests__/fixtures.ts | 45 | 0 |
| src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx | 21 | 20 |
| src/components/piling/operator-mobile/__tests__/queue-flow.test.tsx | 371 | 0 |
| src/components/piling/operator-mobile/api.ts | 146 | 36 |
| src/components/piling/operator-mobile/offline-queue-banner.test.tsx | 77 | 0 |
| src/components/piling/operator-mobile/offline-queue-banner.tsx | 39 | 10 |
| src/components/piling/operator-mobile/offline-queue.ts | 10 | 0 |
| src/components/piling/operator-mobile/operator-mobile-app.tsx | 94 | 18 |
| src/components/piling/operator-mobile/operator-status-strip.tsx | 3 | 1 |
| src/components/piling/operator-mobile/screens/__tests__/knowledge-screen.test.tsx | 1 | 1 |
| src/components/piling/operator-mobile/ui.test.tsx | 5 | 0 |
| src/components/piling/to/readiness/settings/dictionaries-section.tsx | 2 | 2 |
| src/components/piling/to/readiness/settings/integrations-section.tsx | 2 | 2 |
| src/components/piling/to/readiness/settings/roles-section.tsx | 4 | 4 |
| src/core/infrastructure/__tests__/raw-queries.test.ts | 9 | 0 |
| src/core/infrastructure/raw-queries.ts | 2 | 0 |
| src/core/notifications/__tests__/telegram.test.ts | 36 | 8 |
| src/core/notifications/durable-alert.ts | 2 | 1 |
| src/core/notifications/telegram-delivery-progress.ts | 24 | 0 |
| src/core/notifications/telegram.ts | 19 | 17 |
| src/core/observability/health-tracker/checkers/backup.ts | 5 | 3 |
| src/core/security/idempotency.ts | 9 | 175 |
| src/core/security/index.ts | 0 | 36 |
| src/core/security/tenant-enforcement.ts | 13 | 254 |
| src/lib/__tests__/csrf-protection.test.ts | 42 | 1 |
| src/lib/__tests__/no-global-db-in-tx.test.ts | 58 | 41 |
| src/lib/__tests__/pdf-generator.test.ts | 19 | 0 |
| src/lib/__tests__/pile-meters-invariant.test.ts | 1 | 1 |
| src/lib/csrf-protection.ts | 12 | 2 |
| src/lib/db.ts | 1 | 1 |
| src/lib/pdf-data.ts | 2 | 1 |
| src/lib/pdf-generator/__tests__/cleanup.test.ts | 108 | 0 |
| src/lib/pdf-generator/cleanup.ts | 90 | 0 |
| src/lib/pdf-generator/components.ts | 2 | 2 |
| src/lib/pdf-generator/period-pdf.ts | 19 | 10 |
| src/lib/pdf-generator/storage.ts | 17 | 4 |
| src/lib/report-status.ts | 6 | 0 |
| src/modules/crews/infrastructure/__tests__/crew.repository.test.ts | 59 | 0 |
| src/modules/crews/infrastructure/crew.prisma.mapper.ts | 7 | 1 |
| src/modules/crews/infrastructure/crew.repository.ts | 8 | 1 |
| src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts | 20 | 6 |
| src/modules/equipment/application/queries/equipment-query.service.ts | 2 | 1 |
| src/modules/equipment/infrastructure/__tests__/equipment.repository.test.ts | 10 | 0 |
| src/modules/equipment/infrastructure/equipment.prisma.mapper.ts | 6 | 2 |
| src/modules/equipment/infrastructure/equipment.repository.ts | 1 | 1 |
| src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts | 5 | 5 |
| src/modules/inspections/application/commands/inspection-commands.ts | 0 | 11 |
| src/modules/inspections/index.ts | 1 | 1 |
| src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts | 16 | 0 |
| src/modules/monitoring/application/queries/fleet-monitoring.service.ts | 2 | 0 |
| src/modules/readiness/application/csv-export.ts | 1 | 1 |
| src/modules/reports/application/projections/__tests__/projection-handlers.test.ts | 22 | 5 |
| src/modules/reports/application/projections/__tests__/rebuild.test.ts | 28 | 0 |
| src/modules/reports/application/projections/projection-handlers.ts | 23 | 7 |
| src/modules/reports/application/projections/projection-worker.ts | 1 | 1 |
| src/modules/reports/application/projections/rebuild.ts | 2 | 1 |
| src/modules/reports/application/queries/__tests__/export-reports-csv.test.ts | 19 | 0 |
| src/modules/reports/application/queries/__tests__/report-query.service.test.ts | 4 | 2 |
| src/modules/reports/application/queries/report-export.service.ts | 6 | 11 |
| src/modules/reports/application/queries/report-query.service.ts | 2 | 1 |
| src/modules/reports/domain/period-summary.ts | 5 | 2 |
| src/modules/sites/infrastructure/__tests__/site.repository.test.ts | 50 | 0 |
| src/modules/sites/infrastructure/site.prisma.mapper.ts | 8 | 1 |
| src/modules/sites/infrastructure/site.repository.ts | 1 | 1 |
| src/services/analytics/__tests__/site-analytics-service.test.ts | 4 | 2 |
| src/services/analytics/equipment-analytics-service.ts | 3 | 2 |
| src/services/analytics/site-analytics-service.ts | 8 | 7 |
| src/services/auth/__tests__/auth-service-credentials.test.ts | 15 | 5 |
| src/services/auth/__tests__/session-service.test.ts | 18 | 0 |
| src/services/auth/auth-service.ts | 15 | 47 |
| src/services/auth/session-service.ts | 11 | 6 |
| src/services/notifications/__tests__/durable-alert-delivery.test.ts | 25 | 1 |
| src/services/notifications/durable-alert-delivery.ts | 13 | 6 |
| src/services/reports/__tests__/daily-summary.test.ts | 66 | 23 |
| src/services/reports/event-handlers.ts | 14 | 6 |
| src/services/reports/outbox-publisher.ts | 3 | 1 |
| src/workers/__tests__/no-next-in-workers.test.ts | 131 | 5 |
| src/workers/__tests__/outbox-worker.test.ts | 12 | 0 |
| src/workers/unified-worker.ts | 9 | 0 |
| src/workers/unified-worker/__tests__/pdf-cleanup-scheduler.test.ts | 27 | 0 |
| src/workers/unified-worker/pdf-cleanup-scheduler.ts | 18 | 0 |
| tests/integration/tenant-isolation.spec.ts | 8 | 90 |
