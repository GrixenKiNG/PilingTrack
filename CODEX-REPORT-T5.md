# CODEX-REPORT-T5 — поток 5, 03.10.2026

Рабочая папка D:\PillingR\wt-codex5, ветка codex/day-1003, исходный HEAD b67fefb6. Production/SSH/SCP/push/.env/реальные учётки не используются. Пакеты не устанавливаются. E0a–E0c расследованы; E1 выполнен с открытыми S3/WebKit ограничениями, E2–E7 впереди.

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

## E1 — disposable production stand и браузерный ключевой путь

Создан воспроизводимый scripts/test-day-stand.sh/.cjs: только свой codex-pg (107 миграций, app non-BYPASS и pilingtrack_identity), два codex-redis (state noeviction/cache allkeys-lru), own users/roles, объект→поле→куст→пикеты, две организации/бригады/техника, BASE/HAMMER EO/TO1/TO3. Пароли и session/device secrets генерируются в памяти. next start и unified workers запущены после build exit 0; HOSTNAME одинаковый, реальные owner различаются. HTTPS proxy с ключом/cert только в памяти обеспечивает Secure cookies; TRUST_PROXY только на этом loopback стенде, IP/email buckets тестов изолированы, 429 внутри теста сохранён. Пакеты не добавлены; инструкция воспроизведения — e2e/README.md.

Новые три key-path браузерных теста прошли в Chromium: диспетчер создаёт локальный отчёт (3×6м), до отправки KPI=0; seeded persisted draft также исключён. POST upsert 200 → submitted → SiteDailySummary=3 → analytics KPI=3. POST single-pdf 202 → job completed → download 200/%PDF-. stand-workers.log подтверждает именно unified PDF worker processing/completed (0.23с), не sync fallback. ADMIN через UI создаёт DONE наряд (201), принимает (200), reload и DB acceptedById подтверждены. Отмена удаления куста не посылает DELETE; подтверждение посылает ровно один DELETE 200, DB/DOM удалены. Эти новые изменяющие сценарии запускаются один раз на свежем стенде в Chromium, шесть mobile копий явно skipped; существующие мобильные сценарии сохранены.

Найден реальный stale KPI. Красный key-path: exit 1, 1 failed/2 passed — DB summary уже 3, analytics ещё 0. Причины: дублирующий process response cache и неверный namespace SCAN/DEL ioredis keyPrefix. Снят только process cache этого маршрута, Redis остаётся; SCAN теперь ищет физический prefixed ключ, DEL получает ключ без prefix, считает реальный результат. Real Redis regression: red exit 1 (0 != 1), green exit 0; соседний namespace не удалён. Real lease test E0b: exit 0, разные owner, follower не снимает leader lease, takeover после release. Existing focused Vitest: exit 0, 57 passed/0 skipped, 3 файла. tsc exit 0. lint: исходный новых fixtures exit 1 (9 errors/2 warnings); после ESM/удаления своего unused/rename callback exit 0, 0 errors/0 warnings, text integrity passed.

Браузерные прогоны (реальные числа): первый diagnostic 99: exit 1, 37 passed/38 failed/3 skipped/21 not run, 13.5м; часть fixtures менялась во время этого диагностического запуска, это не чистая baseline. Второй 108: exit 1, 72 passed/10 failed/9 skipped/17 not run, 5.8м. Последний полный 108: exit 1, 90 passed/9 failed/9 skipped/0 not run, 8.5м. List exit 0: 108 тестов/12 файлов (до T5 — 99/11, ничего не удалено). Полный E1 НЕ объявляется зелёным.

Ошибки тестов исправлены: реальные адреса заменены собственными env accounts; role-audit не читает dotenv и разрешает только owned codex DB; rate-limit не блокирует соседние проекты; старые monitoring selectors приведены к Settings/server editor; ORION тестировал отсутствующий старый concept passport, теперь проверяет реальные fleet tabs текущего /orion, четыре теста сохранены; OPERATOR test учитывает обязательный PPE до инструктажа; desktop table assertions запускаются при desktop width с отдельной mobile проверкой; roles больше не serial-skipped вслед за первым падением. Frozen UI ORION/operator не изменён.

Остатки последнего прогона: два photo tests не прошли — редактор теперь использует server S3, собственного S3 на PG/Redis стенде нет (browser alert Failed to fetch default S3 host). Не засчитываются как успешные. Перед дальнейшим запуском добавлен явный skip E2E_S3_READY !== true, внешние browser mutations на disposable стенде блокируются; флаг здесь не задаётся. Нужен настоящий собственный S3 fixture для подтверждения фото, mock не использован. Mobile Safari: desktop/table selectors исправлены после снимка результатов; пять ролей ловят TypeError Load failed / RSC access-control checks на HTTPS (источник ещё не установлен), refresh table hidden исправлен desktop width. Эти ошибки не подавлены фильтром pageerror, полный повтор предусмотрен E7.

GitNexus impact GET/invalidatePattern и detect-changes: exit 1 (CLI отсутствует, без установки). Разрешённый fallback rg выявил dashboard/sites callers и invalidateSiteAnalytics; diff --check exit 0. Graph risk неизвестен. Изменение касается только cache и тестового стенда; auth/security/RLS/schema/frozen product не менялись. Generated PDF лежит только в собственном storage/pdf-results, не добавляется в Git и будет удалён при cleanup.

Коммит E1 runtime/cache: 28a45fa8. Второй E1 коммит сохраняет browser harness/fixtures/specs и инструкцию воспроизведения; окончательные проверки ветки — E7.

## E2 — проверка IDOR

Инвентаризация: docs/audits/codex-t5-idor.md — 81 маршрут/130 методов с ID в пути/теле/query, ссылки на guards. Static строки не объявляются runtime проверенными; покрытие дочерних существующих документов/briefing и всех readiness сущностей остаётся неполным. Native HTTP к production приложению стенда + настоящий PG: exit 0, 119 passed/0 skipped (e2-idor-green.log), две собственные роли B OPERATOR/ASSISTANT, существующие Equipment/Site/Inspection/Template/Report/User/Shift/Crew/Maintenance/Media A. Отказы 403/404; после запросов A не изменены. /crews/my безопасно игнорирует чужой operatorId и для обеих ролей возвращает только seeded B crew (200), это специально проверено, продукт не менялся. Некоторые child IDs отсутствующие, поэтому тест не доказывает запрет доступа к существующему child. Платформенные роли не изменены. Подтверждённой уязвимости не найдено; SECURITY правок нет.

Диагностика теста: 96 passed/9 failed — неверные поля и несуществующие HTTP методы; исправлены контракты теста. Следующий 117 passed/2 failed — неверное ожидание 403 для безопасного crews/my. BASE_URL Vitest заменяет на /; run-day-check.cjs сохраняет реальный loopback URL в CODEX_STAND_URL, credentials остаются в памяти. E1 harness commit f32edbbf.

## E3 — конфликт отчёта

use-report-form.ts больше не вызывает loadData на 409, возвращает false (UI не стирает pending inputs), сохраняет исходные локальные arrays без дублирования pending строки. Понятное сообщение предлагает копирование перед обновлением; старая baseVersion остаётся, повтор не перезаписывает чужую версию. Узкий существующий тест: red exit 1, 8 passed/1 failed; green exit 0, 9 passed. Интеграционная HTTP гонка на настоящем codex-pg: exit 0, 1 passed/0 skipped; одновременно version=1 с count5/7 → один 200, другой 409, version=2 и count победителя. Серверная блокировка уже работала, server/schema не менялись. Impact useReportForm exit1 (нет CLI), fallback rg: shared ReportForm caller, frozen оператор не изменён. E2 commit 788f30eb.
