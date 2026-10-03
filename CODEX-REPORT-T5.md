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
