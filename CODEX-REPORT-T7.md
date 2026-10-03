# CODEX-REPORT-T7 — поток 7, 03–04.10.2026

Worktree D:\PillingR\wt-codex7; ветка codex/long-1004; начальная версия
2c1c34cf. Порядок G1→G6. Production, SSH/SCP/push, .env и реальные учётки
не используются. Учётные данные генерирует supervisor в памяти.
Все изменяемые контейнеры собственные codex-* с метками владения.

GitNexus query и impact createFixture/BriefingRecord: exit 1, CLI отсутствует.
GITNEXUS_INVOCATION=gitnexus исключает автозагрузку. Применён разрешённый
правилами потока 5 резервный анализ rg+diff. Риск UNKNOWN, не низкий.

## G1 — изоляция оставшихся таблиц (в работе)

codex-pg-bdf0dfc194ca после 107 исходных миграций: 84 таблицы, 76 строгих
политик, 0 audit-mode, 8 таблиц без RLS. Число «46 + около19» устарело.
Отсутствие изоляции BriefingRecord подтверждено: RED RLS suite exit 1,
20 passed / 4 failed / 0 skipped. После расширения проверок RED exit 1,
38 passed / 7 failed и ошибка cleanup: мой тест сохранял INSERT.
Тест INSERT теперь всегда выполняется в rollback-транзакции.

Миграция 20261004000000_briefing_record_rls применена только на своей
базе: migrate deploy exit 0. Первая проверка exit 1, 44 passed / 1 failed:
мой тест повторно создавал отчёт с тем же user/site/date и нарушал
существующий уникальный ключ. Исправлен только тест: UPDATE своей строки
и отдельный INSERT BriefingRecord. Первый полный integration на старой
версии теста exit 1, 227 passed / 1 failed / 0 skipped, 10 files.
Финальные числа добавлю после FeedbackEventRead и повторного прогона.

Перед выкладкой требуется решение владельца для каждой из двух новых
RLS-миграций. SQL, порядок и узкий откат — runbook012/G1. Схема Prisma
и бизнес-данные миграциями не изменяются.

### Проверки G1 и ограничения

Фактический PostgreSQL после двух политик: 78 / audit-mode 0 / RLS без
FORCE 0. Четыре SQL prechecks инструктажей/читателей — все ноль.
Feedback RED exit1 5 failed / 2 passed; миграция exit0; GREEN exit0
7 passed / 0 skipped. Полный integration после исправления фикстуры:
exit0, 235 passed / 0 skipped, 11 files, 51.57s.

TypeScript (node node_modules/typescript/bin/tsc --noEmit): exit0.
Перед запуском удалён только проверенный .next/dev/types этого worktree.
npm run lint: exit0, 0 errors / 0 warnings, Text integrity passed.
Build собственного supervisor: exit0, production Next start + unified
workers; этот build выполнен до последних тестовых правок G1.
Playwright list: exit0, 117 tests / 12 files, число не уменьшено.
Первый полный Playwright: exit1, 105 passed / 11 skipped / 1 failed,
9.0m. Отказ SAFETY_ENGINEER Mobile Safari — timeout60000ms.
Отдельный повтор того же сценария без изменения кода/таймаутов:
exit0, 1 passed, 25.3s. Общий прогон не объявляется зелёным.
S3 не включён: два дополнительных пропуска фото относительно F8;
остальные девять — прежние условные пропуски.
OPERATOR/ASSISTANT прошли настоящие ознакомление/тест знаний/досылку
документов, F7 — настоящий bootstrap/журнал и печать; это подтверждает
прикладные пути BriefingRecord после строгой политики.

Первый полный Vitest: exit1, 3125 passed / 2 failed / 281 skipped,
3408 tests / 355 files. Два прежних теста health worker и auth module
exports упали по timeout30000ms. Отдельный повтор: exit0, 19 passed /
0 skipped, 2 files. Полный повтор выполняется; результат добавляется ниже.
Warnings process listeners, Vite config, Node FORCE_COLOR и Next
compression/httpxy не скрывались; причина исходных таймаутов не доказана.

GitNexus detect-changes --scope all --repo .: exit1, CLI недоступен,
UNKNOWN. Fallback rg+diff --check применён. Один первоначальный вызов
субагента ошибочно начал bootstrap в общий кеш; прерван, повтор без
bootstrap отказал по отсутствию CLI. Package/lock diff пуст. Полное
описание ошибки и текстовый разбор в docs/audits/codex-t7-rls.md.

Оставлены шесть таблиц без RLS: OutboxEvent, DeadLetterQueue,
IdempotencyKey, Tenant, FeedbackEvent, _prisma_migrations. Обоснования
и background/write paths для каждого — в аудите. Переключение только
двух честно изолируемых таблиц; старые миграции и schema.prisma не менялись.
Удалений файлов/экспортов нет; исходники frozen operator/ORION не менялись.

Полный повтор npm run test:unit: exit0, 3127 passed / 281 skipped /
0 failed, 355 files (340 passed / 15 skipped), 113.57s. Первые таймауты
не повторились; причинную связь с G1 или параллельной нагрузкой не утверждаю.

Коммит BriefingRecord: 4a4ec346. Второй логический коммит G1 включает
FeedbackEventRead, аудит, адресный rollout и этот отчёт. Изменения первого
коммита: миграция9+, RLS spec23+, fixture4+/3-. Изменения второго —
точные numstat в коммите. G1 реализован с указанным ограничением полного
Playwright; все 235 реальные интеграционные тесты passed без skips.
G2–G6 ещё не завершены, финальный merge Hermes ещё не выполнялся.

## G2 — blue-green HTTP и прежний worker barrier (04.10)

Выкладка/SSH/SCP/push/production не выполнялись. Работа в codex/long-1004.
HTTP-слоты blue/green на loopback3000/3001 используют существующую сеть;
EMBEDDED_WORKERS=disabled проверяется в CREATED candidate до START.
Порядок: CREATE → перенос только .next/static (candidate имеет приоритет) →
START → container health/readiness/SHA/pages/unauthorized API smoke →
Caddy validate/reload → proxy SHA → drain → прежний F1 workers →
подтверждённая остановка/exited0/143 без OOM и удаление old HTTP.
Первый legacy app завершает F1 вместе с dedicated workers; HTTP candidate
продолжает обслуживать. Leader-election исходники не менялись; F1 selected-scale fix описан ниже.

Default deploy теперь app workers без --replace-worker-generation;
legacy флаг отклоняет RUNNING blue/green slots. Migrate-only отвергается
до git/build/SSH: прежде пустой список up мог поднять всё поколение.
Managed Caddy read-only preflight выполняется до remote tags/git/migration.
При новых миграциях нужен осознанный BLUEGREEN_MIGRATIONS_COMPATIBLE=1
после репетиции со старым кодом. Сохраняются фактические serving app и
worker imageIDs, не предполагается совпадение :latest/серверного git SHA.
Кандидат до cutover и старые app/workers проверяются на local storage;
deployment-проекты требуют полного S3 triple. Файлы не переносятся и
не удаляются автоматически, отказ требует решения владельца.

RED → исправления:
- Первоначальный orchestration RED: отсутствующий helper (exit1/127).
- candidate-unsafe RED exit1: old retained, но candidate успевал START;
  CREATE/inspect disabled до START исправляет порядок.
- Реальный static RED exit1: old-only Next URL после old retirement404.
  Перенос old+candidate static до Next startup даёт200, новые файлы
  имеют приоритет. Никакие business files/secrets не копируются.
- local-storage offline RED exit1 (local-storage accepted); fail-closed
  preflight теперь проходит. Реальный preflight также обнаружил PDF,
  созданный G1 Playwright и попавший в own standalone image: отказ
  произошёл до candidate. Сам PDF сохранён output/codex-t7/g1-evidence.pdf,
  source storage стал пустым; immutable own images не переписывались.
- Default Caddy preflight missing RED exit1; migrate-only early refusal
  missing RED exit1; исправлены до удалённых мутаций.
- Final node scripts/test-app-bluegreen.cjs: exit0, 23 checks:
  10 helper, 2 legacy read-only, 6 service-selection, 5 Caddy read-only.
  SSH заменён локальным bash/mock только в извлечённых preflight blocks;
  полный deploy-prod.sh не запускался.

Реальный ordinary Docker GREEN exit0:
output/codex-t7/bluegreen-real-green-empty-storage.log и
output/codex-t7/bluegreen-3a6a802d375a/result.json.
8304 HTTP requests, 0 5xx, 0 request exceptions, 0 body errors.
18 actual leader-health/Redis owner samples, 0 observed double leaders;
worker containerID и обе ownerUUID изменились. Оба HTTP embedded disabled.
Old actual HTML chunks и отдельный old-only asset200 после retirement.
Длинный HTTP fixture7372800bytes получен целиком: start1791066410041 <
SWITCH1791066452134 < end1791066500263 (90.22с,626 transport chunks).
Fixture оборачивает настоящий Next только на стенде; не является новым
production endpoint или доказательством произвольного WebSocket/SSE.

Максимальная наблюдаемая сумма Docker samples693.143MiB. Limits:
app1GiB×2/heap512MiB, PG1GiB, Redis256MiB×2, workers512MiB, Caddy128MiB.
PG pilingtrack_app rolsuper=false/rolbypassrls=false, применены обе G1
миграции. App/workers HTTP-only stand имеют отдельный empty tmpfs64MiB
для маскировки собственного image fixture PDF; business writes не было.
Контролируемый тест без MinIO/monitoring/PgBouncer/ОС VPS и не с общей
cgroup cap3.8GB. Это не доказательство памяти/производительности всего VPS.
Оригинальная база/devDB/pilingtrack-* не трогались, own stand cleanup done.

Промежуточные прогоны не скрыты и не засчитываются GREEN:
- Windows MSYS_NO_PATHCONV мешал native curl /dev/null (exit1).
- Слишком короткий fixture worker start_period2s/retries2 дал unhealthy;
  после40s/retries3 actual F1 healthy. Production deadline не ослаблялся.
- Синхронные Docker samples блокировали Node load/event callbacks:
  один прогон дал81 exceptions и неверное время stream overlap; заменены
  async spawn. Эти exceptions не объявляются Caddy defect без доказательств.
- Один async прогон прерван ошибкой root: helper был изменён in-place
  во время Bash исполнения (syntax error при текущем bash-n0).
  Тест повторён на замороженном файле; этот run не считается успешным.
- Реальный storage guard отказ (792requests/0errors) отражает own G1
  image fixture PDF, а не crash нового app; новый empty-stand отдельно
  проверил crashing candidate exit7 и сохранение old SHA.

Проверки G2:
- node node_modules/typescript/bin/tsc --noEmit: exit0.
- npm run lint: exit0, 0 errors/0 warnings, Text integrity passed;
  финальный повтор после docs/Caddy такжеexit0.
- npm run test:unit: exit0, 3127 passed/281 skipped/0 failed;
  355 files (340 passed/15 skipped),3408 tests,122.35с.
- playwright test --list: exit0,117 tests/12files, count не уменьшился.
- npm run build в существующем own disposable supervisor: exit0,
  output/codex-t5/g2-build-result.json. Env values только в памяти,
  .env файлы не читались/не создавались; Next route types проверены.
- Собственные app SHA41fe41dc/2c1c34cf и workers images: docker build
  exit0. App functional source одинаков (G1 менял SQL/tests/docs);
  два отдельно скомпилированных markers не доказывают любой будущий
  cross-version compatibility. Dockerfile/version/package не менялись.
- Git Bash scripts/test-worker-generation.sh: exit0,6 PASS.
- Git Bash scripts/smoke-workers-image.sh codex-workers-t7:g2: exit0.
  Первые попытки через системный bash(WSL) exit1: там нет Docker;
  WSL/Docker Desktop настройки не менялись.
- Repo Caddyfile.prod с managed snippet: own network-none Caddy
  validate exit0. Template не применялся на сервере.
- Bash syntax/helper/deploy и node --check stand/scripts: exit0.
- GitNexus impact/detect-changes: exit1, CLI недоступен, UNKNOWN.
  Без bootstrap; fallback whole callers rg + scoped diff --check exit0.

Перед выкладкой владельцу:
1. Миграции G1: решение + SQL prechecks/репетиция/проверки по012.
2. Managed import/snippet по008; initial template deploy/app-upstream.caddy
   только ДО первого перехода, не перезаписывать active green из шаблона.
3. Стабильный proxy URL app-guard; проверить старые port/container monitors.
4. Полный S3 app/workers, отсутствие local business files; при local backend
   отдельное решение по общему хранению до blue-green.
5. Подтверждённый запас всего VPS: сумма caps уже больше3.8GB; swap4GB
   не гарантирует отсутствие OOM. Стендовый sample не заменяет host замер.
6. Диск для merged old static + временной копии. Старые chunks сохраняются
   транзитивно, автоматического expiry/delete нет; retention решение владельца.
7. Один оператор/CI deploy остановлен. Helper lock защищает только switch,
   не предварительные tags/git/migrate; общей release transaction lock нет.
8. Конечный HTTP drain доказан на fixture; WebSocket reload по умолчанию
   закрывает соединения, stream_close_delay не добавлен. При необходимости
   такого протокола отдельная проверка/изменение managed snippet.
9. Post-deploy prod-smoke/deep-health/S3/jobs/outbox/Telegram и expected
   migrations отдельно; controlled smoke не объявляется production evidence.

G2 legacy real-run завершён exit0; точные числа приведены ниже.
G3–G6 ещё не выполнены. Merge Hermes и финальные G6 checks не выполнены.

Дополнение G2 F1:
Первый real legacy run4766c146afb8: exit1,6960 requests/0HTTPerrors,
30 embeddedLeaderSamples/30 logOwnerSamples. F1 STOP обоих старых
процессов → VERIFY0RUNNING → STARTworkers отказал с app: disabled →
RECOVERED реальное старое поколение и прежний proxy. Причина не fixture
profile: app не имел profiles. Compose отвергает --scale app=1, если
запускаемый список содержит только workers.
В существующий scripts/test-worker-generation.sh добавлен такой же RED:
exit1, g2-f1-workers-only-red.log. Fix7+/1- в worker helper: START scales
только выбранных services; ALL old snapshot/scales для rollback сохранены.
Полный real barrier GREEN после fix: exit0,7 PASS, включая workers-only
с2workerreplicas и legacyappSTOPPED,143 безOOM; прежние recovery/refusal
кейсы сохранены. g2-f1-workers-only-green.log.
GitNexus impact/detect после fix сноваexit1/UNKNOWN; fallback callers
F1/helper/deploy/tests + diff --check0. До изменений старый RED и
автоматический own cleanup закончились, файл во время исполнения не менялся.

Длинный HTTP fixture использует STOP_TIMEOUT120s/DRAIN5s. Default helper
STOP_TIMEOUT30s сам по себе не доказывает сохранение90s response.
Deadline для реальных long requests/Next drain и способ передачи флага
целевому helper требуют проверки владельца; пример command выше по
умолчанию остаётся30s. Контролируемый тест не обещает отсутствие потерь
при произвольной длительности requests/uploads/WebSocket.

Окончательный legacy GREEN29e2d797455b: exit0,10968 requests,
0 5xx/0exceptions/0bodyErrors,0doubleLeaders;30 embeddedLeaderSamples,
36 logOwnerSamples,3 post-F1 health samples. STOP2→VERIFY0→STARTworkers,
legacyAppsRunningAfterF1=0; оба Redis owners и Docker workerID сменились.
Peak observed sum668.696MiB; old static200. Поток7372800bytes/584chunks
полностью получен за90.225s через SWITCH, STOP_TIMEOUT120s/DRAIN5s.
Result output/codex-t7/bluegreen-29e2d797455b/result.json;
log output/codex-t7/bluegreen-real-legacy-green-final.log.
Own containers, PG и network после cleanup отсутствуют; node --check
stand и bash -n wrapper exit0. Удалений исходников G2 нет.
Коммит реализации G2: bccac339,12files,+905/-14. Numstat:
deploy/Caddyfile.prod +5/-2; deploy/app-upstream.caddy +1;
docker-compose.bluegreen.yml +12; docker-compose.prod.yml +1/-1;
docker-compose.yml +4/-2; scripts/deploy-prod.sh +81/-8;
scripts/replace-app-bluegreen.sh +191; replace-worker-generation.sh +7/-1;
test-app-bluegreen-stand.cjs +482; test-app-bluegreen-stand.sh +9;
test-app-bluegreen.cjs +105; test-worker-generation.sh +7.
Все строки относятся к G2, удалённых paths нет; runtime Leader код,
Prisma/Auth/UI/ORION и зависимости в G2 не менялись.