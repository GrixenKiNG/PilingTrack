# CODEX-REPORT-T5 — поток 5, 03.10.2026

Рабочая папка D:\PillingR\wt-codex5, ветка codex/day-1003, исходный HEAD b67fefb6. Production/SSH/SCP/push/.env/реальные учётки не используются. Пакеты не устанавливаются. Проверки E1–E7 ещё не выполнены.

GitNexus impact gracefulShutdown: exit 1, глобальный gitnexus CLI отсутствует; GITNEXUS_INVOCATION=gitnexus исключает автоустановку. Используется разрешённый заданием rg + git diff --stat/--check; графовый риск неизвестен, нулевым/низким не объявляется.

## E0a — штатный SIGTERM app и восстановление после отказа

Барьер теперь проверяет compose service из labels: app принимает exited 0 false и exited 143 false, workers по-прежнему только exited 0 false (created 0 false допускается для ещё не запущенных контейнеров). OOM/ошибки drain/живые старые реплики блокируют START. Проверка shutdown-журналов app с embedded workers сохранена.

Отказ после начала stop явно сообщает по-русски о возможной недоступности сайта и выводит готовую команду повторного безопасного запуска с project, timeout, COMPOSE_FILE и services. Для rollback сначала переключаются оба образа на сохранённые теги по ранбуку 016. Автоматический запуск при неизвестных откатных тегах или ошибке drain не выполняется; исходная проверка не обходится.

Красный Docker-тест старого helper: exit 1, фактический app SIGTERM exit 143 отвергнут. Зелёный bash scripts/test-worker-generation.sh: exit 0, четыре проверки — app 143 с STOP→VERIFY→START; живой старый контейнер блокирует START; ошибка drain с exit 0 блокирует START; workers 143 блокирует START и выводит команду восстановления. Реальный codex-deploytest app + две старые реплики workers, после тестов контейнеры/сеть удалены trap. workers 143 и drain имитированы shim поверх реального Docker; app 143 настоящий trap shell. Журналы output/codex-t5/e0a-red.log и e0a-green.log; поджурналы output/codex-t4 сохраняют прежние имена теста.

bash -n helper и тест отдельно: exit 0 / 0. Ранбуки 008/016 дополнены. Сервер/скрипт deploy-prod не запускались. Минимальные правки только helper, существующий Docker-тест и документы. Сохранены ограничения внешнего барьера и неатомарного compose up.

Коммит E0a: 81bff6b8.

## E0b — уникальный владелец lease

defaultNodeId теперь os.hostname() + PID + crypto.randomUUID() для экземпляра election. HOSTNAME, использованный Next для bind, не влияет на идентичность. Проверены все владельцы/сравнения: Lua renew/release сравнивают полный config.nodeId, SET NX пишет тот же owner, outbox/projection/embedded callers используют getStats().nodeId. Явный nodeId тестов остаётся совместимым; production callers его не задают. Ранбук 016 теперь требует сопоставления полного nodeId из health/логов, не одного hostname/PID.

Красный существующий lease test на старом коде: exit 1, 1 failed/14 passed/0 skipped; две elections с одинаковым HOSTNAME/PID обе ошибочно стали лидерами. После правки зелёный lease + outbox/projection/unified worker tests: exit 0, 48 passed/0 failed/0 skipped, 4 файла. Новый сценарий дополнительно доказывает, что stop follower не удаляет lease лидера и takeover возможен после освобождения. Журналы output/codex-t5/e0b-red.log / e0b-green.log. Реальный Redis takeover будет дополнительно проверен на E1; этот тест использует state Redis stub существующего suite. DB fencing не добавлялся.

Коммит E0b: 8afb638b.

## E0c — источник close-warning и проверка удержания ответов

Production npm run build одноразового стенда — exit 0. Настоящий Chromium: вход своей ADMIN-учёткой, три обхода /admin, /monitoring, /reports, /admin/sites, /admin/to и 45 GET /api/sites через browser fetch — exit 0, pageerror 0. /reports в этом релизе не существует (404), это ошибка адреса диагностического probe, не пройденный сценарий отчётов. Первый probe был exit 1 из-за page.request: API cookie-jar по HTTP не отправляет Secure cookie, тогда как Chromium на loopback отправляет. Без изменения безопасности приложения заменён только диагностический GET на browser fetch; для E1 предусмотрен HTTPS.

MaxListenersExceededWarning подтверждён на новом собранном приложении. --trace-warnings указывает ServerResponse.on в next/dist/compiled/compression -> next/dist/compiled/httpxy handleResponse. Собственные withApi/withMutation не подписываются на ServerResponse.close; feedback SSE подписывается на AbortSignal, не ServerResponse.

Дополнительный изолированный next start с preload-инструментированием ServerResponse.emit, WeakSet/FinalizationRegistry и --expose-gc (не добавляющим close listeners): HTTP health — exit 0, закрыто 41, GC собрал 40, максимум 9 close listeners; HTML fetch — exit 0, закрыто 41, собраны 38, max 8. Реальный Chromium по тому же набору страниц — exit 0, 35 warnings; закрыто 621 ответов, собраны 606, max 11. Во время нагрузки число собранных растёт (377→492→579→606), а max остаётся 11. Эти данные не доказывают отсутствие всех утечек, но предупреждение не является доказательством неограниченного накопления: завершённые ответы GC освобождает. Журналы output/codex-t5/e0c-gc[-html/-browser].log, e0c-browser-retry.log.

Подтверждённой утечки в собственном коде не найдено, прикладная правка не вносилась; warning framework остаётся открытым. Поднимать maxListeners/выключать компрессию ради скрытия предупреждения не стал: это не исправление удержания. node_modules/версии менять запрещено заданием. Дополнительный диагностический app остановлен; основной codex-стенд остаётся только для E1–E7. Результаты диагностики не объявляются полным E1 workflow.
