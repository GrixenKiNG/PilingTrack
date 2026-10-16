# CODEX-REPORT-T5 — поток 5, 03.10.2026

Рабочая папка D:\PillingR\wt-codex5, ветка codex/day-1003, исходный HEAD b67fefb6. Production/SSH/SCP/push/.env/реальные учётки не используются. Зависимости проекта не менялись. E0a–E6 выполнены/исследованы по разделам ниже; E7 завершён на настоящем PG/Redis/S3 стенде: итоговые exit/числа и cleanup приведены ниже. Ограничения E0c и static IDOR coverage явно перечислены.

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

## E4 — версия карточки техники

PUT требует ISO expectedUpdatedAt; list DTO передаёт updatedAt, detail уже имел его. updateEquipment с token выполняет FOR UPDATE tenant+id, сравнение, core/metadata/meter/outbox в одной транзакции, timestamp продвигается минимум на 1мс. Клиенты списка/toggle/detail передают исходный token, при 409 перечитывают и показывают сообщение; detail item меняется и форма повторно инициализируется. Старый внутренний service контракт без token сохранён; HTTP без token теперь 400, внешним legacy клиентам нужно обновление. Миграции нет.

Real PG red exit1, 1 failed: stale save разрешён; green exit0, 3 passed/0 skipped: последовательный stale409, одновременные записи дают один успех/один409 с согласованным паспортом, неверное показание422 откатывает всю карточку. Route red exit1, 5 passed/1 failed (после изоляции mock200!=400; первый mock500 не считается доказательством); green exit0, 7 passed. Focused existing command/meter/route 34 passed/0 skip exit0. List token red21 passed/1failed exit1, green22 passed exit0. tsc exit0. lint exit0 с1warning нового E3 non-null; устранено, повтор E7. GitNexus impact updateEquipment/metadata/listAllEquipment exit1, fallback callers проверены; риск графа неизвестен, замороженные/защищённые файлы не правились. E3 commit48ef20cc.

## E5 — производительность

Собственный seed: 10 дополнительных объектов,30 установок,2000 submitted отчётов на 200 датах по году,20000 PileWork count=1 и20000 PilePassport. Существующие E1 fixtures остаются, поэтому total отчётов немного >2000. Общий годовой period штатно422 (лимит2000), измерена выборка одного объекта200 отчётов. Прямой fixture seed заполняет ReportAnalytics, не объявляется проверкой projection/write workflow. Все HTTP GET200,30 последовательных замеров после1 прогрева, тело прочитано целиком; _ts выключает process cache, удаляются только analytics keys собственного cache Redis. Это локальный стенд, не боевая нагрузка/конкурентный stress.

| GET | p50 мс | p95 мс | байт ответа |
|---|---:|---:|---:|
|Главная /api/monitoring/fleet|82.3|93.8|20792|
|Отчёты список /api/reports/all?limit=25|108.4|337.8|199721|
|Отчёты год/объект /api/reports/period?dateFrom=2025-10-04&dateTo=2026-10-03&siteId=codex-perf-68017589ba90-site-0|90.8|234.2|455037|
|Журнал /api/pile-passports|126.6|182.4|443242|
|Парк /api/equipment|23.8|39.2|7537|
|План-факт /api/analytics/sites?dateFrom=2025-10-04&dateTo=2026-10-03|454.2|488.5|4620|
|Аналитика /api/admin/analytics/overview?dateFrom=2025-10-04&dateTo=2026-10-03|269.1|312.2|17567|

SQL query tracing (включая BEGIN/set_config/COMMIT): Fleet30=28, Journal10=14, Journal500=14, Reports200=15. Journal10 и500 оба14 запросов — N+1 по количеству строк не подтверждён; fleet/reports используют bulk includes, абсолютное число само по себе не доказательство N+1.

EXPLAIN ANALYZE BUFFERS: journal использует индекс tenant/drivenAt с501 строкой; aggregate полного года читает20к строк закономерно. Actual analytics SQL под non-BYPASS app + transaction-local tenant: два чтения PileWork и около20к Report index probes на каждом проходе. Объединены периодный FILTER и накопительный SUM в одном aggregate, security/RLS не менялись. На том же PG, чередующийся порядок old/new,30 замеров: before p50=438.7 p95=595.7 EXPLAIN=440.876; after p50=230.5 p95=310.9 EXPLAIN=229.229. Выборки старого/нового SQL равны для года и короткого периода (equal=true). Это SQL измерение, HTTP после новой сборки отдельноE7; не выдаётся за HTTP ускорение. План/BUFs сохранены output/codex-t5/e5-analytics-compare.json и e5-performance.json.

Red узкий8тестов: exit1,7passed/1failed (JOIN PileWork дважды); green exit0,8passed. Real PG semantic test exit0,1passed/0skip: period7/42м,alltime11/66м,draft100 исключён. Новые индексы не нужны по этим данным; миграций нет. GitNexus impact/detect недоступны exit1, fallback rg+diff; graph risk UNKNOWN. E4 commit76122b97.

## E6 — Hermes

Рассмотрен diff b67fefb6..hermes/q4-0926 (123 src-файла). Вершина Hermes28265e0b, общий предок6a2a0cab; новые правки относительно предка —35файлов,676+/73-. Старые различия lease/security/PDF cleanup относительно релиза НЕ новые дневные изменения; трёхстороннее слияние их не откатывает. merge-tree exit0 d3dc36c6, точный diff результата —те же35UI/test files; защищённые auth/security/RLS и frozen ORION/operator не затронуты. Разрешённое локальное no-ff слияние без конфликтов, без push.

| Область | Результат ревью | Ограничение |
|---|---|---|
| Users/document types, reset layout, закрытие ТО | подтверждение до mutation; объяснение последствий | текст ТО обещает показание, хотя без engineHoursAtService его нет: неточный текст, не повреждение данных |
| PDF download, CSV/Excel | disabled pending, раздельная метка формата, общий date helper | не доказывает уникальность запросов между вкладками |
| Journal export | пустая загруженная выборка не экспортируется как успех | сервер остаётся источником фильтров |
| Catch/error helpers | русская ошибка сети; сохраняются business errors | TypeError может быть программной ошибкой; общий текст скрывает её природу, в workflow не подтверждено |
| DLQ dates | явный MSK вместо зоны браузера | перед tenant2 проверить timezone организации |

Новых серьёзных регрессий не подтверждено. Все изменённые Hermes тесты: exit0,13файлов/137passed/0skip. Дополнительной runtime правки нет. GitNexus impact exit1/fallback diff+search, graph riskUNKNOWN; проверка всей объединённой ветки —E7. E5 commit992c9fda.

Пауза: автоматическая проверка разрешений не выполнила следующий focused test из-за usage limit reviewer; это не признание команды небезопасной. После команды пользователя «далее» стандартная проверка снова доступна, focused test реально выполнен с числами выше.

## E7 — финальная проверка и исправления найденных сценариев

Повтор на свежем стенде: собственные codex-pg (107 миграций), state/cache Redis, unified workers, production Next и настоящий MinIO. Режим CODEX_WITH_S3=true добавляет только собственный codex-s3 из уже имевшегося pinned MinIO образа; bucket codex-photos. S3 credentials и private TLS key только в памяти. В файл записывается лишь публичный CA, child Node доверяет ему через NODE_EXTRA_CA_CERTS; TLS verification не отключается. Флаг E2E_S3_READY выставляет supervisor только после реального PUT/GET/DELETE round trip. Инструкция — e2e/README.md. Docker npm ci/apk выполнялись внутри одноразового образа по существующему Dockerfile/lockfile; пакеты/версии/зависимости рабочей папки не менялись.

WebKit investigation: без ожидания быстрый page.goto отменял RSC prefetch; probe после завершения запросов возвращает RSC200 без pageerror. Узкий Safari: exit0,8passed. Ошибки не фильтруются. Перед принудительной сменой документа только WebKit ждёт завершения конечных запросов и500мс тишины; /api/feedback/stream исключён как постоянный SSE. Избыточный повторный goto(home) для уже перенаправленных ролей убран. Диагностическое слишком широкое ожидание ранее ошибочно блокировало Chromium; оно исправлено, а все pageerror assertions сохранены.

Фото: тестовые PNG имели неверный CRC; заменены двумя корректными изображениями (красное/синее), без пакетов. Каждый проект получает свою организацию/ADMIN и две установки; старый localStorage reset не очищал server template, что создавало повторы текста между тестами. Ожидаются фактическое сохранение редактора, появление плиток и загруженные naturalWidth>0 изображения после reload. Screenshot photos-after-reload.png сохраняется в test-results соответствующего проекта. Monitoring fault test сначала ждёт реальный fleet snapshot, затем503 и баннер предыдущего снимка, потом успешное восстановление; analytics table сама по себе не доказывает готовность fleet.

Найден прикладной баг: Media confirm/S3 успешны, но первое /monitoring чтение могло получить30-секундный process-cache снимок без новых photoUrl, уже прогретый страницей настроек. FleetDashboard initial fetch теперь использует существующий bust=true, как refresh и polling. API/cache/security не менялись. Существующий client suite: red exit1,10passed/1failed; green exit0,11passed. Реальный фото-сценарий на старом коде:2failed/16passed в focused Chromium/Mobile Chrome; оба photoUrl отсутствовали в старом снимке. Исправление — одна строка вызова и комментарий. GitNexus impact FleetDashboard exit1; fallback: один product caller src/app/(app)/monitoring/page.tsx, существующий test suite. Graph risk остаётся UNKNOWN.

E2 дополнен:159 HTTP checks вместо119. Существующие EquipmentDocument/UserDocument/BriefingRecord/FuelLog/MeterReading/MaintenancePlan/EquipmentDefect/ShiftHandover/WorkPermit и CurrentReadiness+snapshot A созданы перед попытками B. Все mutation отказы сохраняют исходные документы/подписи/названия. OPERATOR для чужих current/defects collections получает200 data=[], ASSISTANT403; это безопасные фильтры, не обход. Полный PG suite после дополнения: exit0,10files/202passed/0skipped (e7-integration-immutable-green.log). Предыдущий exit1 при202passed был ошибкой afterAll: попытка удалить immutable ReadinessScoreSnapshot. История теперь остаётся до удаления всего собственного codex-pg, защитный trigger не отключается. Таблица docs/audits/codex-t5-idor.md связывает выполненные HTTP методы с тестом; остальные строки static по-прежнему не объявляются runtime проверенными.

Restore regression: первоначально exit1,161passed/1failed — тест ожидал по2строки в пустой базе, но стенд уже имел собственный seed. Проверка теперь сравнивает source/restored с фактическим snapshot manifest каждого dump; wrong-manifest меняет настоящее число на+1. Restore/hash/gzip/RLS/cleanup assertions сохранены. Повтор до расширения E2: exit0,10files/162passed/0skipped.

Диагностические полные браузерные результаты сохранены: e7-playwright exit1,92passed/5failed/11skipped; первый S3 повтор exit1,82passed/17failed/9skipped (ошибки ожиданий/изоляции, включая собственный неудачный SSE wait). Эти запуски не засчитываются зелёными; окончательные числа ниже относятся к отдельной свежей базе и окончательному коду.

### HTTP после E5

На свежей базе с тем же performance fixture2000отчётов/20к свай, production build после SQL-правки,30измерений после прогрева: план-факт p50=257.6/p95=276.7мс против прежних454.2/488.5. Это разные одноразовые базы, не controlled SQL comparison; контролируемый old/new SQL на одной базе приведён в E5. Прочие p50/p95: fleet78.0/102.0, report list116.0/134.2, report period82.1/104.0, journal129.7/157.4, equipment32.0/44.7, overview268.2/351.7мс. Журналы e7-performance-after.log и e7-after-http-performance.json; исходный e5-before-http-performance.json сохранён, seed повторно не удваивался.

### Окончательные checks

Финальные команды выполнены отдельно, без pipeline, с реальным exit; окончательные значения приведены в таблице ниже. Первые tsc/lint/list/unit/build были успешны, но после найденного runtime фото-бага повторены необходимые проверки всей ветки. Docker network=none build первоначально exit1 (нет apk indexes); обычная сборка существующего runner exit0, настоящий network-none smoke exit0. Runner на окончательном source пересобран отдельно: exit0; smoke exit0.

### Решение владельца перед выкладкой

- Миграций, новых production flags и изменений package/schema нет. Disposable CODEX_WITH_S3/E2E_S3_READY не относятся к production configuration.
- PUT equipment теперь требует expectedUpdatedAt: веб-клиенты обновлены, внешним/старым клиентам понадобится передача token. Принятие этого контракта необходимо до выкладки.
- E0c framework close warning остаётся: источник Next compression/httpxy установлен, GC освобождает завершённые ответы, подтверждённой прикладной утечки нет. Исправление/обновление framework не выполнялось при запрете версий.
- E2 static строки и неохваченные существующие ресурсы не считаются live-проверенными; inventory не является полной гарантией отсутствия IDOR, особенно перед tenant2. ADMIN/DISPATCHER platform scope сохранён.
- Замечания ревью Hermes (текст моточасов, MSK/timezone, общий TypeError, pending между вкладками) остаются в таблице E6 как ограничения.
- Initial fleet fetch теперь читает актуальные данные: один свежий запрос при открытии мониторинга. Опрос/ручное обновление уже использовали этот режим. Локальные performance данные не заменяют production capacity измерение.

### Что оставлено без изменения

Auth/security/CSRF/rate-limit/RLS/tenancy implementation, schema/migrations, Dockerfile/compose/deploy, package versions, операторские экраны и ORION product не редактировались. Browser specs этих экранов сохранены и запускались; ORION selectors исправлены только в e2e. Новых зависимостей проекта нет. Полные файлы/exports не удалялись; тестов из collection не удалено. Старые eslint-disable и намеренные варианты оставлены.

### Коммиты до финального E7

| Этап | Hash |
|---|---|
|E0a|81bff6b8|
|E0b|8afb638b|
|E0c diagnostics|33f5493e|
|E1 cache|28a45fa8|
|E1 stand/browser|f32edbbf|
|E2|788f30eb|
|E3|48ef20cc|
|E4|76122b97|
|E5|992c9fda|
|E6 no-ff Hermes|82cec3c2|

Финальный E7 hash приводится в сообщении владельцу после commit; файл отчёта включён в сам этот commit.

E7 дополнительные реальные прогоны: e7-playwright-complete exit1,97passed/2failed/9skipped,5.7м. Оба photo workflow прошли, остатки Safari — OPERATOR timeout60s (застрял на предыдущем вопросе с повторяющимся ответом), ASSISTANT login response window4s пропустил уже успешный вход, повтор ожидал отсутствующий email field. Тест теперь сверяет q.text до ответа и его исчезновение после advance; проверяет enabled следующей кнопки, ожидает finite requests перед reload, для длинного quiz допускает90s. Login response window20s покрывает auto-wait клика, hydration retry budget60s. Все auth response/pageerror/knowledge save assertions сохранены. Для окончательного browser repeat поднята ещё одна свежая база без одновременного Vitest.

Полный Vitest после runtime-правки: первый параллельный с production build exit1 (335passedfiles/13skipped/1failedsuite,3055passed/244skipped): Prisma generation временно удаляла client, и legacy integration suite не смог импортировать его. Это гонка моих команд, не зелёная проверка. После завершения build отдельный npm run test:unit: exit0,335filespassed/14filesskipped,3055passed/248skipped/3303total,128.81s. Рост skipped208→248 соответствует40новым E2 integration assertions, которые unit-run без disposable env пропускает; в реальном PG suite они выполняются (202passed/0skip).

Финальные backend checks на production build с фото-исправлением: npx tsc --noEmit exit0 (e7-complete-tsc.log), npm run lint exit0/0errors/0warnings/text-integrity passed (e7-complete-lint.log), Docker build runner exit0 и bash smoke-workers-image.sh exit0/network none (e7-final-workers-build.log/e7-final-workers-smoke.log). Последний real PG suite e7-pg-complete exit0/10files/202passed/0skip,48.25s. Только browser helper/specs менялись после этих результатов, backend/runtime source не менялся.

### Итог E7 (окончательный код, реальные exit)

| Команда / проверка | Exit | Результат / журнал |
|---|---:|---|
| Remove-Item .next/dev/types (проверенный собственный путь, если существует) | 0 | удалены stale dev types; production route types проверены build |
| npx tsc --noEmit | 0 | e7-last-tsc.log |
| npm run lint | 0 | 0errors/0warnings; text integrity passed; e7-last-lint.log |
| npm run test:unit | 0 | 335files passed/14files skipped;3055passed/248skipped; e7-complete-unit.log |
| npm run build (в scripts/test-day-stand.sh, env только своего стенда) | 0 | e7-clean-manager.log BUILD exit0;stand-build.log;107миграций |
| node scripts/run-day-check.cjs node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts | 0 | 10files/202passed/0skip;43.73s;e7-pg-clean.log |
| npx playwright test --list | 0 | 108tests/12files;e7-last-list.log;baseline99/11 не сокращена |
| node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --workers=2 --reporter=list | 0 | 99passed/0failed/9skipped;5.6м;e7-browser-clean.log |
| docker build --pull=false -f Dockerfile.workers --target runner -t codex-workers-t5:e7 . | 0 | e7-final-workers-build.log |
| bash scripts/smoke-workers-image.sh codex-workers-t5:e7 | 0 | real runner start+Arming;network none;e7-final-workers-smoke.log |
| GitNexus detect-changes --scope all --repo . | 1 | CLI unavailable; разрешённый fallback rg+diff; e7-detect-changes.log;graph UNKNOWN |
| git diff --check | 0 | whitespace/conflict-marker checks |

Полный Vitest и real PG — разные scopes: unit-run пропускает integration assertions без env, real PG config явно включает disposable-*.spec.ts и tech-readiness-write-pipeline.spec.ts. Другие legacy integration suites не выдаются за выполненные на PG этим config. Playwright skips:6новых key-path mobile copies (persisted сценарии выполняются однажды Chromium),2повторных mobile rate-limit cases,1photo Safari (существующий project restriction). S3-dependent Chromium/Mobile Chrome photo теперь прошли, флаг не подделан. Ключевой путь подтверждён настоящим браузером/worker/PG/S3: draft не меняетKPI, submit меняетdaily+KPI, PDFворкер завершает job иdownload содержит%PDF; создание/приёмТО и подтверждение удалениякуста прошли. Все7ролей в3проектах прошли; error/recovery мониторинга/аналитики тоже прошли.

Фото после reload дополнительно просмотрено: на desktop screenshot две разные цветные картинки присутствуют в плитках, naturalWidth>0. Это функциональное доказательство хранения/отрисовки, не одобрение всей вёрстки: на том же screenshot некоторые KPI подписи переносятся по буквам. Разметка KPI в T5 не менялась, отдельный визуальный недостаток оставлен для владельца; DOM no-overflow не заменяет визуальное принятие.

Cleanup: supervisor scripts/test-day-stand.sh завершился exit0, CLEANUP done. Удалены свои PG/Redis/MinIO containers каждого запуска, собственные codex-workers-t5:e7 и codex-s3-t5:e7 tags (оба docker image rm exit0), public CA и два local PDF f5671b4c-5c82-4ad3-98b8-058fdd80bed8 /78af767a-d284-4bc2-ac33-be96a535008b (сопоставлены с completed jobs собственных worker logs). Проверка известных собственных names/IDs/listeners/CA — exit0, всё отсутствует. Generic base images/build cache и pilingtrack-* не трогались. Storage/PDF не попали в Git; журналы/скриншоты — ignored output/test-results.

Один read-only tool call завис при чтении итогов, безопасный повтор вернул результаты. Это не отменяет перечисленные реальные exit. GitNexus impact/detect остаются недоступными; зависимости ради CLI не ставились. IDOR coverage:76из130методов inventory связаны с live HTTP tests,54остаются static. Это явная граница выполненного аудита.

### Изменённые файлы: вся ветка относительно b67fefb6

Статистика включает принятый merge Hermes E6 и новый отчёт; добавленные/удалённые строки по git diff --numstat. Полных удалённых файлов нет (git diff --diff-filter=D --name-only b67fefb6 пуст).

| Файл | Добавлено | Удалено |
|---|---:|---:|
| CODEX-REPORT-T5.md | 295 | 0 |
| docs/audits/codex-t5-idor.md | 138 | 0 |
| docs/runbooks/008-manual-deploy.md | 7 | 1 |
| docs/runbooks/016-release-2026-10.md | 7 | 2 |
| e2e/README.md | 22 | 8 |
| e2e/admin-dictionaries.spec.ts | 4 | 2 |
| e2e/admin-users.spec.ts | 4 | 2 |
| e2e/app.spec.ts | 6 | 4 |
| e2e/fixtures/auth.fixture.ts | 12 | 20 |
| e2e/fixtures/disposable-analytics-compare.mjs | 16 | 0 |
| e2e/fixtures/disposable-cache.ts | 18 | 0 |
| e2e/fixtures/disposable-extra-seed.mjs | 1 | 0 |
| e2e/fixtures/disposable-https.mjs | 8 | 0 |
| e2e/fixtures/disposable-lease.ts | 25 | 0 |
| e2e/fixtures/disposable-performance.mjs | 58 | 0 |
| e2e/fixtures/disposable-query-count.ts | 28 | 0 |
| e2e/fixtures/disposable-query-plan.mjs | 16 | 0 |
| e2e/fixtures/disposable-s3.mjs | 7 | 0 |
| e2e/fixtures/disposable-seed.mjs | 18 | 0 |
| e2e/fixtures/disposable-to-seed.mjs | 4 | 0 |
| e2e/fixtures/disposable.fixture.ts | 22 | 0 |
| e2e/fixtures/role-audit.mjs | 3 | 5 |
| e2e/inspection-to-flow.spec.ts | 4 | 3 |
| e2e/monitoring-tile-editor.spec.ts | 21 | 7 |
| e2e/operator-report-smoke.spec.ts | 3 | 2 |
| e2e/orion-industrial-cinematic.spec.ts | 19 | 55 |
| e2e/page-objects/login.page.ts | 2 | 2 |
| e2e/rate-limit-e2e.spec.ts | 5 | 3 |
| e2e/release-critical-path.spec.ts | 116 | 0 |
| e2e/report-creation-flow.spec.ts | 5 | 4 |
| e2e/role-audit.spec.js | 33 | 7 |
| e2e/smoke-e2e.spec.ts | 4 | 3 |
| scripts/replace-worker-generation.sh | 17 | 2 |
| scripts/run-day-check.cjs | 8 | 0 |
| scripts/test-day-stand.cjs | 45 | 0 |
| scripts/test-day-stand.sh | 9 | 0 |
| scripts/test-worker-generation.sh | 19 | 2 |
| src/app/api/analytics/sites/route.ts | 3 | 1 |
| src/app/api/equipment/[id]/__tests__/route.test.ts | 26 | 1 |
| src/app/api/equipment/[id]/route.ts | 6 | 11 |
| src/components/piling/__tests__/admin-dlq.test.tsx | 21 | 0 |
| src/components/piling/admin-dictionaries.tsx | 16 | 19 |
| src/components/piling/admin-dictionaries/__tests__/admin-dictionaries.test.tsx | 53 | 0 |
| src/components/piling/admin-dlq.tsx | 6 | 4 |
| src/components/piling/admin-equipment/detail/__tests__/equipment-maintenance-sort.test.ts | 45 | 2 |
| src/components/piling/admin-equipment/detail/equipment-detail.tsx | 2 | 1 |
| src/components/piling/admin-equipment/detail/equipment-maintenance.tsx | 12 | 1 |
| src/components/piling/admin-equipment/use-equipment-list.ts | 15 | 2 |
| src/components/piling/admin-reports/__tests__/admin-reports.test.tsx | 55 | 3 |
| src/components/piling/admin-reports/__tests__/report-evidence-preview.test.tsx | 41 | 1 |
| src/components/piling/admin-reports/admin-reports.tsx | 7 | 6 |
| src/components/piling/admin-reports/report-evidence-preview.tsx | 13 | 6 |
| src/components/piling/admin-reports/report-evidence-row.tsx | 6 | 5 |
| src/components/piling/admin-users/__tests__/admin-users.test.tsx | 75 | 1 |
| src/components/piling/admin-users/admin-users.tsx | 1 | 1 |
| src/components/piling/admin-users/user-detail.tsx | 12 | 1 |
| src/components/piling/admin-users/user-document-types-dialog.tsx | 39 | 2 |
| src/components/piling/inspections/__tests__/inspection-messages.test.tsx | 32 | 0 |
| src/components/piling/inspections/inspection-item-photos.tsx | 5 | 3 |
| src/components/piling/inspections/start-inspection-form.tsx | 3 | 1 |
| src/components/piling/inspections/template-editor.tsx | 3 | 2 |
| src/components/piling/layout-editor/__tests__/layout-load-failure.test.tsx | 21 | 0 |
| src/components/piling/layout-editor/layout-editor.tsx | 11 | 1 |
| src/components/piling/layout-editor/page-layout-editor.tsx | 13 | 2 |
| src/components/piling/maintenance/__tests__/maintenance-messages.test.tsx | 20 | 0 |
| src/components/piling/maintenance/work-order-photos.tsx | 5 | 2 |
| src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx | 1 | 0 |
| src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx | 13 | 0 |
| src/components/piling/monitoring/fleet-dashboard.tsx | 2 | 2 |
| src/components/piling/pile-journal/__tests__/pile-journal.test.tsx | 32 | 0 |
| src/components/piling/pile-journal/index.tsx | 6 | 0 |
| src/components/piling/report-form/__tests__/use-report-form.length.test.ts | 27 | 0 |
| src/components/piling/report-form/use-report-form.ts | 6 | 5 |
| src/components/piling/to/__tests__/to-panels-mobile-targets.test.tsx | 58 | 1 |
| src/components/piling/to/fuel-panel.tsx | 3 | 2 |
| src/components/piling/to/load-failure.tsx | 10 | 0 |
| src/components/piling/to/maintenance-plans-panel.tsx | 3 | 2 |
| src/components/piling/to/meter-readings-panel.tsx | 3 | 2 |
| src/components/piling/to/readiness/api/__tests__/client.test.ts | 19 | 0 |
| src/components/piling/to/readiness/api/client.ts | 23 | 2 |
| src/components/piling/to/readiness/shift-create-form.tsx | 3 | 1 |
| src/core/infrastructure/__tests__/leader-election.test.ts | 24 | 0 |
| src/core/infrastructure/leader-election.ts | 4 | 1 |
| src/lib/redis-cache.ts | 4 | 3 |
| src/lib/types.ts | 1 | 0 |
| src/lib/validation-schemas.ts | 4 | 0 |
| src/modules/equipment/application/commands/equipment-command.service.ts | 24 | 0 |
| src/modules/equipment/application/commands/equipment-metadata.ts | 7 | 7 |
| src/modules/equipment/application/commands/equipment.command.ts | 2 | 0 |
| src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts | 1 | 0 |
| src/modules/equipment/application/queries/equipment-query.service.ts | 1 | 1 |
| src/services/analytics/__tests__/site-analytics-service.test.ts | 14 | 4 |
| src/services/analytics/site-analytics-service.ts | 7 | 16 |
| tests/integration/disposable-analytics-performance.spec.ts | 26 | 0 |
| tests/integration/disposable-equipment-race.spec.ts | 43 | 0 |
| tests/integration/disposable-idor.spec.ts | 144 | 0 |
| tests/integration/disposable-report-race.spec.ts | 41 | 0 |
| tests/integration/disposable-restore.spec.ts | 5 | 2 |
