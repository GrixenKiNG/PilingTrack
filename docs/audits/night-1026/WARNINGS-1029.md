# Предупреждения Next/Vitest — 29.10.2026

Ветка codex/warnings-1029. База 17f235e54d4bb25bbde047929005a8fd612e685f. RED c924500d6b7b8ff5f7cbee03fb9ca0c62d6d06b6; правка 42a2c9346f804b31c7b4ef86931c83a05df9434f. Ничего не слито и не отправлено.

## Итог

Предупреждение конфигурации Vitest устранено: конфиг стал явным ES-модулем .mts, __dirname заменён вычислением каталога через import.meta.url. Для сохранения поведения обновлены три исполняемые ссылки на файл: исключение TypeScript, исключение Next tracing и путь чтения конфига в существующем worker smoke-тесте. thresholds/include/exclude тестов, роли, схема, зависимости, auth/RLS, Dockerfile и compose не менялись.

ServerResponse MaxListeners — **не объявлен безвредным**: за 30 минут текущего собственного стенда не воспроизвёлся, накопление слушателей процесса/сервера в этом замере не обнаружено. Ранее сохранённый стек показывает место превышения порога на конкретном HTTP-ответе, а не доказанную утечку глобального процесса. Приложение ради подавления предупреждения не менялось; setMaxListeners/ignore-warning не применялись.

## RED → исправление → полный набор

Нативный loader до правки: node node_modules/vitest/vitest.mjs list --configLoader native --filesOnly, exit1: ReferenceError __dirname is not defined in ES module scope. В существующий workers-image-smoke.test.ts добавлен настоящий запуск этого loader, без проверки текста реализации. Target RED:12 passed/1 failed/0 skipped (exit1); все прежние12 прошли. RED закоммичен отдельно. После минимальной правки target13/0/0 (exit0).

Полная базовая линия до правки6029/0/0,529файлов; после6030/0/0,529файлов. По именам/файлам сверены все исходные6029 сценариев: ни один не исчез, добавился ровно native-loader regression. Предупреждение Vite configLoader больше не выводится. Затем для уже закоммиченного 42a2c9346f804b31c7b4ef86931c83a05df9434f выполнены НОВАЯ сборка и все последовательные финальные проверки, без переноса результата со старого SHA.

## Замер сервера

Next16.4.3/Vite8.3.5/Vitest5.0.5, Windows, Node26.7.0; собственные PG18.6/Redis/MinIO. 4 клиента, keep-alive, gzip, запрос каждые200мс на клиента, сессии ADMIN/OPERATOR, страницы /admin/users, /admin/equipment, /operator/v10, /login и API users/equipment/operator state/health. Сессии и пароли только в RAM. 5% намеренных обрывов через5мс. Замер 2026-10-29T12:53:58.494Z—2026-10-29T13:23:58.749Z: **1800с,31327запросов**,1564намеренных abort;30568наблюдённых HTTP200,538ECONNRESET. Это пересекающиеся счётчики, складывать их нельзя. Отдельного контроля без abort не было; причина каждого reset не установлена, успешность всех31327 не заявляется.

Внешний preload не меняет app-файлы/лимиты: WeakRef-учёт emitter, sample раз в60с, process warning stack. Объекты до GC могут оставаться видимыми; принудительного GC нет. Сэмплы — не непрерывный максимум.

| Минут от начала | Запросов сервера | Незаконченных close | Response объектов до GC | Всего close handlers | Max close на response (sample) | Heap MiB |
|---:|---:|---:|---:|---:|---:|---:|
|0|481|0|480|670|2|218.9|
|5|5689|0|379|536|2|199.5|
|10|10903|0|414|580|2|212.5|
|15|16122|1|971|1367|9|322.9|
|20|21357|1|1233|1737|8|369.0|
|25|26590|0|416|585|2|195.1|
|30|31331|0|83|119|2|129.3|
|40|31331|0|9|11|2|114.3|
|60|31331|0|9|11|2|122.4|

Process listeners неизменны во всех точках нагрузки: SIGTERM1/SIGINT1/unhandledRejection1/uncaughtException3; один HTTP Server, request1/connection1/listening2/upgrade1/error1. Максимум close на response в сэмплах9, MaxListeners-warning за интервал0. Response objects росли до1233, затем снизились до9 после естественного GC; heap достиг386875296B, после нагрузки снизился примерно до120MB. Это не монотонное удержание объектов на данном workload. Контрольные точки включают остывание40/60мин, не дополнительную нагрузку.

### Откуда прежнее предупреждение

Сохранённый собственный лог D:/PillingR/night-logs/equipment-multiple-1029/prod/stand/stand-app.log:11close handlers на ServerResponse; стек compression/index.js:22:894 → Readable.pipe → httpxy.handleResponse index.js:1:9943. В установленном httpxy handleResponse добавляет response close→upstream.destroy, затем pipe добавляет свои обработчики; compression оборачивает on и делегирует не-drain исходному emitter. Это объясняет точку регистрации, **не устанавливает**, сколько слоёв попало в конкретный старый ответ и были ли они позже освобождены. Старое доказательство не выдано за воспроизведение на новом SHA.

В unit есть ДРУГОЙ MaxListeners: process SIGTERM/SIGINT/uncaughtException/unhandledRejection, стек main src/workers/unified-worker.ts:211–228. Existing unified-worker.test.ts делает resetModules и повторный import/main без удаления process handlers в afterEach. Это накопление в тестовом процессе, не тот ServerResponse/httpxy warning. Runtime worker-код и прежние тесты ради скрытия предупреждения не менялись.

## Изменённые файлы

| Файл | Строк до | После |
|---|---:|---:|
|vitest.config.ts → vitest.config.mts|95|97|
|next.config.ts|184|184|
|tsconfig.json|63|63|
|.dockerignore|110|110|
|src/workers/__tests__/workers-image-smoke.test.ts|130|140|

Исходный .ts переименован, его конфигурация сохранена. Все исполняемые references проверены поиском src/e2e/tests/scripts/prisma/config/.github; старые исторические упоминания/комментарии оставлены. package.json type не менялся: перевод всего проекта в ESM был бы шире задачи. Актуальные Next16 docs outputFileTracingExcludes прочитаны из node_modules/next/dist/docs/.../output.md перед заменой имени в tracing-исключении.

## Финальные проверки 42a2c9346f804b31c7b4ef86931c83a05df9434f

| Команда | Exit | Результат |
|---|---:|---|
| npm run build |0|151с; health.version совпал с SHA|
| npx tsc --noEmit |0|16с; stale .next/dev/types удалены перед запуском|
| npm run lint |0|70с|
| npm run test:unit -- --maxWorkers=1 --no-file-parallelism |0|6030passed/0failed/0skipped;529файлов;840с wrapper|
| npx playwright test --list |0|411тестов/30файлов|

Каждая команда запускалась отдельно и последовательно, собственный fresh PG для полного unit, без конкурирующего worker. Базовый full866с и после864с сохранены отдельно; финальный повтор сделан для точного SHA после отдельного fix-коммита. .env не читался/не создавался; фиктивный URL использован только в отдельном db:generate, настоящие адреса своих disposable DB — в RAM/environment.

GitNexus impact dbEnvFromDotenv LOW (1прямой caller,0processes); file nodes UNKNOWN/тест not-found подтверждены поиском действующих config references и выполнением12исходных smoke-tests. Перед RED и FIX выполнены fresh force-index/context и полные detect_changes all/compare без partial/truncated. Не считать0affected доказательством отсутствия влияния конфигов. Финальный docs graph сохраняется отдельно перед отчётным коммитом.

## Ограничения и артефакты

Нельзя назвать исходный server warning разовой настройкой либо доказанно безвредным: он не повторился в этом workload. Долгий production/другие паттерны proxy/stream/cancellation не проверялись. Изменения Next/httpxy или dependencies не вносились. Node22 CI и контейнеры приложения заново здесь не проверялись; локальная проверка Node26, CI использует Node22.

Внешние доказательства: D:/PillingR/night-logs/warnings-1029/{baseline-full-unit-run.json,red-target.json,fixed-target.json,before-after-proof.json,native-baseline-result.json,load-30m-result.json,listener-summary.json,listeners-6388.jsonl,final-run-result.json,final-gates-results.json,full-unit-final.json}. Файлы source/JSON отчёта не содержат credentials/cookies. Own resources cleanup имеет отдельный before/after proof; рабочий3100 и production не затрагивались.

## Исправленное нарушение условия генерации

В начале Task4 я временно записал фиктивный URL Prisma литералом во внешний prepare-warnings.cjs. Это нарушило требование не сохранять его нигде. Строка удалена; generation-literal-correction.json подтверждает отсутствие копии в setup, логе генерации и generated client. .env не читался и не создавался; URL не попал в изменения репозитория. Саму генерацию выполнил только отдельной разрешённой командой. Отклонение сообщено владельцу, не скрыто за утверждением о безупречном соблюдении условия.

Основная ESM-правка: dba76f2c3fdd6bda27d5f43e61a307658578bfa1. При окончательном поиске найдена ещё одна ссылка в .dockerignore; она обновлена отдельным коммитом, чтобы сохранить исключение тестового конфига из Docker context. После этой строки заново выполнены build/tsc/lint/fullunit/collection на указанном финальном SHA. Dockerfile/compose и образы не менялись; сборка Docker-образов не заявляется.

Привязка нагрузочного замера: sourceSha измерения — 17f235e54d4bb25bbde047929005a8fd612e685f (до правок конфига). В JSON сохранён именно этот SHA. На окончательном SHA заново выполнены build/tsc/lint/fullunit/collection; отдельные30мин нагрузки на нём не повторялись. Runtime-функции приложения в этой задаче не менялись, но отсутствие server warning на базовой сборке не объявляется отдельным пройденным нагрузочным критерием финальной сборки.

Учёт запросов preload добавлял по одному собственному finish/close observer на ответ и warning/exit observer на процесс. Числа в таблице включают их; это инструментированный стенд, а не измерение абсолютно неизменённого listener-набора. Лимит10 не повышался. Отрицательный результат не исключает другие proxy/stream паттерны.
