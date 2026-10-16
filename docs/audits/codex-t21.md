# Поток 21 — исправления аудита и проверка чистки

Дата отчёта: 15.10.2026. Рабочее дерево: `D:/PillingR/wt-codex21`, ветка `codex/fixes-1014`, база `f10064948c69564990a8c7d9eaff67c37f059f80`.

**Итог потока.** Изменения 1–3 и 5–9 закоммичены отдельно; пункт 4 уже исправлен владельцем, по пункту 10 условие удаления не выполнено. Финальные TSC, lint, unit, Playwright list и build завершились exit0 на HEAD `3dba4ef0`; пропуски, ожидаемые падения и предупреждения перечислены ниже. Это не браузерная или серверная runtime-приёмка. Push, merge, deploy, SSH и производственная БД не использовались. Содержимое `.env*` не читалось, секреты не создавались и не менялись; схема и миграции не менялись. Аудит потока 22 на main не подменяет проверку runtime этой ветки.

## Результат по порядку задания

| № | Статус | Результат и коммит |
|---|---|---|
| 1 | Исправлено | `7f5961d7` — локальные черновики выработки, паспортов и осмотров во всех перечисленных живых вариантах; защита от потери новых ответов во время сохранения |
| 2 | Исправлено | `99a9bc8a` — «Поправить» в v2/v5/v7, причина отказа внутри формы; закрытые смены без правки |
| 3 | Исправлено | `1bd0a140` — текстовая «Повторить» в v10; добавлены недостающие проверки восстановления v1/v5/v7, существующая v2 сохранена |
| 4 | Повторная правка не нужна | Исправление владельца `f2c0bfbf` уже в базе; текст/условия вкладки ТБ сверены, нового коммита нет |
| 5 | Поведение уже реализовано; расширены тесты | `bb5f8195` — Backend/UI оставлены; существующий Retry проверен для JSON500 → 200. |
| 6 | Исправлено | `1af5db6c` — проверка сессии ограничена 15 с; «Нет связи»/«Повторить» вместо бесконечного ожидания. |
| 7 | Исправлено по подтверждённой CSS-причине | `3369b3c3` — ограничена минимальная ширина label/select объекта; геометрия runtime wt-codex21 ещё не проверена. |
| 8 | Исправлено после контролируемого сравнения | `ca5fe048` — удалены неиспользуемые import/plugin и пакет через package-lock-only; 9 CSS-assets и 65 записей анимации совпадают |
| 9 | Исправлено | `3dba4ef0` — 5 внешних route-файлов используют фасады; недостающие реэкспорты добавлены без переноса implementations |
| 10 | Не удалял: условие задания не выполнено | Среди 25 определений есть непокрытые и устаревшие. `prisma/indexes.sql` и `db:indexes` сохранены; решение за владельцем, миграций нет |

## 1. Сохранность ввода

Один небольшой `useLocalFormDraft` хранит локальный ввод с пользователем, сменой/осмотром и видом формы в ключе, версией данных и сроком 24 часа. Пустой первоначальный лист не сохраняется; чужой scope, просроченные и повреждённые данные не восстанавливаются. Отказ localStorage не мешает форме работать. После принятой сервером или поставленной в локальную очередь записи ввод очищается; отказ по существу его сохраняет.

Подключены формы свай, бурения, простоя и паспорта в base/v2/v5/v7/v10; общий ChecklistScreen, собственный checklist v5 и RunInspection. У общего чек-листа сохраняются mediaIds и исходный clientCommandId: уже загруженные вложения остаются связанными с исходной командой. Незавершённая загрузка фото не объявляется сохранённой. Само сохранение фото в отправленном отчёте и v3 находятся вне этого задания.

При успешном PUT серверного черновика RunInspection подтверждаются только отправленные неизменённые ответы: ввод, сделанный во время запроса, остаётся и переживает remount. На завершении controls заблокированы; параллельный переход с autosave не запускает второй PUT. В v2 принятая команда чек-листа не становится отклонённой из-за следующего сбоя чтения; busy держится до обновления, QueuedOffline считается принятием устройством.

Красные тесты подтвердили отсутствие восстановления, повреждённый storage, пустую групповую отметку и потерю нового ввода во время PUT. Независимое review выявило гонку RunInspection и раннее снятие busy v2; они исправлены до коммита. Финальный прогон: **31 файл, 383 passed, 0 skipped, exit 0**; TSC и lint exit 0. Свидетельства: `.gitnexus/t21-task1-directories-final.log`, `t21-task1-tsc-final.log`, `t21-task1-lint-final.log`.

## 2. Поправка записи

Текущий список «Последние записи» уже существовал и в v7; второй список на главной не добавлен. Кнопка появилась в текущем общем обзоре v2/v5/v7. Журнал v7 во вкладке «Ещё» и при сдаче переиспользует EntriesList. Сама форма вынесена из существующего EntriesList; тексты и контракт команды сохранены. V10 остаётся со своим V10Entries — дублирования нет.

Команда `correct-production` передаёт shiftId, entryId, kind, итог actual, причину и стабильный clientCommandId. При 409 причина видна внутри формы, значения остаются, повтор использует прежний ключ. Новый ключ выдаётся после принятия/очереди. В CLOSED правка скрыта. В v5 ошибка отделена от положительного notice. В v7 busy удерживается до конца перечитывания, чтобы принятая форма не разрешала новый ввод перед закрытием.

RED: **3 failed / 7 passed, exit 1** — отсутствовала кнопка; отдельный deferred-reload RED: **1 failed / 3 skipped, exit 1**. После исправлений: **29 файлов / 339 passed / 0 skipped, exit 0**; последние дополнения отдельно: **2 файла / 23 passed / 0 skipped, exit 0**. Эти прогоны перекрываются, числа не суммируются. TSC, lint 10 файлов и diff-check: exit 0. Логи: `.gitnexus/t21/task2-*.log`.

## 3. Повтор загрузки

В v10 общий блок loadError показывает причину и текстовую «Повторить», включая пустое состояние и вкладку ТБ. Успешный существующий reload уже сбрасывал loadError; менять его не понадобилось. В v1/v5/v7 исходники не менялись: добавлены отсутствовавшие проверки «503 → Повторить → успешное состояние». V2 уже имел такую проверку, новая не добавлена.

RED v10: **2 failed / 24 skipped, exit 1** — при 503 и обрыве сети не было текстового повтора. GREEN пяти app-testfiles, включая v2: **105 passed / 0 skipped, exit 0**. После добавления последней проверки вкладки ТБ финальный v10: **27 passed / 0 skipped, exit 0**. Не суммировать перекрывающиеся прогоны. TSC и lint 5 файлов: exit 0. Логи: `.gitnexus/t21/task3-*.log`.

После второго успешного API-ответа экран возвращается во всех проверенных вариантах. Прежняя жалоба на невосстановление после БД в этих тестах не воспроизвелась; живой отказ БД здесь не выполнялся.

## 4. Формулировки допуска v10 — без новой правки

На вкладке ТБ ScreenSafety строит список через admissionSteps/admissionBlockers. «Все шаги допуска пройдены» показывается только при наличии state и отсутствии незавершённых шагов; иначе написано «по документам препятствий нет; завершите шаги допуска выше». Название — «Допуск по документам». Старых формулировок «Допуск в порядке» и «Осталось СИЗ» в файле нет.

Граница проверки: карточка ScreenToday отдельно доверяет серверной фазе (`phase !== IDENTITY`), как предусмотрено существующей моделью допуска. Это не независимая проверка СИЗ на клиенте. Противоречивый ответ сервера с поздней фазой и неподтверждёнными СИЗ в runtime этой ветки не воспроизводился. Правила допуска, тип смены и двухподписное согласование не менялись.

## 5. Справочники наряда — не дублировать готовое

GET permit-form-options уже обёрнут withApi. Неожиданная ошибка БД/RLS, включая ошибку контекста до локального try, попадает в wrapper и даёт JSON500 с русским error; CircuitOpenError — 503 и Retry-After; ReadinessCommandError сохраняет свой статус и сообщение. Пустой500 по этому пути не подтверждён.

PermitForm уже проверяет response.ok, читает строковый/структурированный error, хранит optionsError/optionsAttempt и показывает Retry. В существующий тест добавлен JSON500; сетевой сценарий сохранён. Итог permits-screen + api-wrapper: **2 файла / 38 passed / 0 skipped, exit 0**. RED нет: требуемое поведение уже работало на исходном коде. Source Backend/UI не менялся. Живой outage/RLS и браузер этой ветки не проверены. Подробности: `.gitnexus/t21-permit-options-checks.md`.

## 6. Проверка сессии и Redis

Клиентский таймаут `/api/auth/me` был **20 с**, что превышает заданные 15 с. Теперь только probeSession использует **15 с на запрос и чтение JSON**; обычные запросы остаются 20 с, загрузки — 120 с. При неизвестной сессии layout показывает «Нет связи» и «Повторить», сохраняет текущего пользователя и не перенаправляет на вход без явного anonymous. Повтор восстанавливает оболочку либо обрабатывает подтверждённое завершение сессии.

Сервер исследован только чтением. Auth-user cache в `src/lib/auth.ts` — Map в процессе, TTL 5 с, а не Redis; этот TTL не ограничивает время запроса. `requireAuth` проверяет JWT, при наличии jti ожидает Redis denylist, затем читает пользователя из БД; `/api/auth/me` дополнительно читает пользователя и отключает wrapper cache (`cache: false`). Redis отзыва — отдельный клиент: connectTimeout 3000 мс, maxRetriesPerRequest 2, enableOfflineQueue false. Пока status не ready, GET отзыва пропускается; отклонённый GET обрабатывается по существующей fail-open политике. Это не доказывает фиксированный срок ответа всего HTTP-запроса.

**Серверного deadline для молча зависшего ready-соединения нет.** commandTimeout/socketTimeout у этого клиента не заданы. Если TCP ещё считается ready, но Redis не отвечает, `await client.get(...)` может ждать обнаружения сбоя/восстановления. 3000 мс относятся к попытке подключения; maxRetriesPerRequest не прекращает фоновые переподключения. Запрос с тем же токеном может присоединиться к старому ожиданию через authUserInFlight. Клиентские 15 с освобождают интерфейс, **но не отменяют серверный Redis GET**. Обычный уже обнаруженный отказ может обходиться быстро; реальная latency и восстановление при blackhole не измерены. Защищённые auth/security-файлы и политика отзыва в этом потоке не менялись. Свидетельства чтения кода: `.gitnexus/t21-session-server-analysis.md`.

RED: **2 файла / 16 passed / 5 failed из 21, exit 1**. GREEN: **21 passed / 0 skipped, exit 0**; проверены зависшие fetch/JSON, повтор, anonymous, обычные 20 с, upload120 с и внешний abort. Lint четырёх файлов и diff-check exit 0. Подробности: `.gitnexus/t21-session-checks.md`.

## 7. Журнал свай на телефоне

На текущем main в отдельном разрешённом браузере при viewport390 измерен scrollWidth401. Причина — label «Объект» и native select с длинным option (right401); таблица1878 находилась внутри overflow-x-auto и body не расширяла. Обратимый DOM-эксперимент min-w-0/max-w-full уменьшил scrollWidth до375; возврат старых классов снова дал401. Это подтверждение причины на main, не runtime-приёмка wt-codex21.

Два className label/select получили min-w-0/max-w-full. Тест с длинным названием объекта проверяет эти ограничения; DOM-тест не измеряет реальную геометрию390. RED: **17 passed / 1 failed, exit 1**; GREEN: **18 passed / 0 skipped, exit 0**. Lint exit 0. Скриншот baseline: `D:/PillingR/qa/runs/audit-1011/evidence-1014/pile-journal-390-before.png`. **В браузере на wt-codex21 не проверено.**

## 8. Анимации — доказательство до удаления пакета

Контролируемое сравнение выполнено до правок форм, на базе f1006494: сначала build с plugin, затем только удаление импорта tailwindcssAnimate и plugins из config, затем build с теми же разрешёнными CI-тестовыми переменными. Обе сборки: **exit 0**. `.env` не читались. Сохранены все 9 CSS-файлов до/после.

AST-проверка: **65 канонических записей → 65, удалено0, добавлено0, equal=true, exit0**. Во всех CSS присутствуют одинаковые enter/exit keyframes и **18 из 18** используемых utilities: animate-in/out, fade-in/out-0, zoom-in/out-95, четыре slide-in-from-*-2, четыре slide-in-from-*, четыре slide-out-to-*. Дополнительно совпадают SHA-256 содержимого всех девяти CSS-assets. Свидетельства: `.gitnexus/t21/build-before.log/.exit`, `build-after.log/.exit`, `animation-before-after.json/.log/.exit`, `css-before/`, `css-after/`.

Использования обнаружены в 4 UI-файлах: alert-dialog, dialog, select, sheet. Accordion-down/up и компонента accordion в текущих исходниках нет — исчезновение несуществующих utilities не заявляется. components.json содержит пустой tailwind.config; сам tailwind.config.ts сохраняется, его удаление не нужно для задачи. Браузерную анимацию на этой ветке не проверяли.

Node24 npm-cli выполнил `uninstall tailwindcss-animate --package-lock-only --ignore-scripts --no-audit --no-fund`, exit0; коммит `ca5fe048`. Изменены только package.json, package-lock.json и два config-подключения. Общий junction node_modules не изменён. В lockfile у tailwindcss появился `dev: true`: это ожидаемая переклассификация после удаления production peer-потребителя tailwindcss-animate, а не смена версии. Повторный реальный запуск сравнения `.gitnexus/t21/task8-animation-comparison.json/.log/.exit` дал exit0: equal=true, 9/9 CSS-assets, 65/65 записей, added0/removed0, все 18 utilities на месте. Утилиты и keyframes не пропали.

## 9. Фасады модулей

Перенаправлены импорты пяти route-файлов: admin/equipment-analytics, telemetry, telemetry/batch, telemetry/ingest и equipment/[id]/device-keys. Две динамические загрузки telemetry также используют фасад. Добавлены существующий getEquipmentAnalytics и шесть telemetry-реэкспортов: findForeignEquipmentIds, getTelemetryAnalysis, getTelemetryByRange, authenticateDeviceByKey, provisionDeviceKey, revokeDeviceKey. Изменены два существующих test-mock-файла.

Реализации `src/services/**` не переносились и не менялись; MQTT-ингест не реэкспортирован. Whole-repo поиск после изменения не нашёл внешних прямых runtime/test импортов services/analytics|telemetry: остались реэкспорты фасадов и внутренние telemetry-ссылки. Два динамических символа имели impact UNKNOWN — это ограничение графа, а не отсутствие вызовов; runtime-вызовы подтверждены текстом.

ДО и ПОСЛЕ: **2 файла / 9 passed / 0 skipped, exit 0**. Поведение намеренно неизменно, искусственный RED не создавался. Lint 9 файлов и diff-check exit0. Подробности: `.gitnexus/t21-cleanup-analysis.md`.

## 10. Сверка всех 25 индексов — файл сохранён

Точность сравнения включает таблицу, порядок колонок, ASC/DESC, UNIQUE и WHERE. Отличие не доказывает необходимость индекса для реального запроса; измерение производительности не проводилось. Наличие CREATE в старой миграции не считается текущим покрытием, если позже таблица удалена.

Обозначения: **S** — `prisma/schema.prisma`; **I** — `prisma/migrations/20260419190903_init/migration.sql`; **DP** — `prisma/migrations/20260817220000_drop_unread_projections/migration.sql`; **DR** — `prisma/migrations/20260924120000_drop_refresh_token/migration.sql`. Номера строк относятся к проверенному исходному состоянию этой ветки.
| № | indexes.sql строка / индекс | Определение из файла | Источник / точное покрытие |
|---|---|---|---|
| 1 | 14 idx_report_site_date | Report(siteId ASC,date DESC) | S:1979 / I:805 — (siteId,date) оба ASC; DESC отличается |
| 2 | 18 idx_report_user_date | Report(userId ASC,date DESC) | S:1978 / I:802 — оба ASC; DESC отличается |
| 3 | 22 idx_report_status | Report(status) | **точный дубль**, S:1980 / I:808 |
| 4 | 26 idx_report_updated | Report(updatedAt DESC) | **нет набора колонок**; S:1976 / I:799 только (tenantId,updatedAt) |
| 5 | 30 idx_report_crew | Report(crewId) WHERE crewId IS NOT NULL | S:1981 / I:811 — полный, WHERE отсутствует |
| 6 | 33 idx_report_equipment | Report(equipmentId) WHERE equipmentId IS NOT NULL | S:1982 / I:814 — полный, WHERE отсутствует |
| 7 | 40 idx_pilework_report | PileWork(reportId) | **точный дубль**, S:2206 / I:931 |
| 8 | 43 idx_drilling_report | LeaderDrilling(reportId) | **точный дубль**, S:2383 / I:940 |
| 9 | 46 idx_downtime_report | ReportDowntime(reportId) | **точный дубль**, S:2428 / I:949 |
| 10 | 55 idx_usersite_user | UserSiteAssignment(userId) | **точный дубль**, S:1922 / I:784 |
| 11 | 62 idx_telemetry_equip_ts | TelemetryRecord(equipmentId ASC,timestamp DESC) | S:2051 / I:838 — оба ASC; DESC отличается |
| 12 | 65 idx_telemetry_site_ts | TelemetryRecord(siteId ASC,timestamp DESC) | S:2052 / I:841 — оба ASC; DESC отличается |
| 13 | 68 idx_telemetry_type_ts | TelemetryRecord(type ASC,timestamp DESC) | S:2053 / I:844 — оба ASC; DESC отличается |
| 14 | 75 idx_auditlog_entity_ts | AuditLog(entity ASC,timestamp DESC) | **нет набора колонок**; S:2612 / I:982 — (entity,entityId), не timestamp; другие современные индексы с tenantId/entityType также отличаются |
| 15 | 78 idx_auditlog_user_ts | AuditLog(userId ASC,timestamp DESC) | S:2613 / I:985 — оба ASC; DESC отличается |
| 16 | 81 idx_auditlog_action_ts | AuditLog(action ASC,timestamp DESC) | S:2615 / I:991 — оба ASC; DESC отличается |
| 17 | 88 idx_outbox_published | OutboxEvent(published,createdAt) WHERE published=false | S:2087 / I:850 — полный, WHERE отсутствует |
| 18 | 96 idx_refreshtoken_user_active | RefreshToken(userId) WHERE revoked=false | I:1057 полный userId без WHERE; **таблица удалена DR:6**, модели в S нет |
| 19 | 104 idx_feedback_scope_ts | FeedbackEvent(scope ASC,createdAt DESC) | S:2547 / I:958 — оба ASC; DESC отличается |
| 20 | 107 idx_feedback_audience_ts | FeedbackEvent(audience ASC,createdAt DESC) | S:2550 / I:964 — оба ASC; DESC отличается |
| 21 | 114 idx_report_analytics_site | ReportAnalytics(siteId,status) | **нет набора колонок**; S:2110,2113 / I:862,871 отдельные siteId и status, не составной |
| 22 | 117 idx_site_daily_date | SiteDailySummary(siteId,date), NONUNIQUE | S:2127 / I:880 — **UNIQUE**, физический набор колонок совпадает, строгое условие UNIQUE отличается |
| 23 | 120 idx_report_stats_site_date | ReportStats(siteId,date) | I:886 ранее точное определение; **таблица удалена DP:18**, модели в S нет |
| 24 | 123 idx_operator_perf_user_date | OperatorPerformance(userId,date) | I:898 ранее точное определение; **таблица удалена DP:19**, модели в S нет |
| 25 | 126 idx_downtime_summary_site_date | DowntimeSummary(siteId,date) | I:910 ранее точное определение; **таблица удалена DP:20**, модели в S нет |

Итог: **5** точных действующих дублей; **9** различий направления DESC; **3** отсутствующих наборов колонок; **3** действующих partial-WHERE различия; **1** UNIQUE вместо NONUNIQUE; **4** записи ссылаются на удалённые таблицы. Всего 25. Даже если ASC/DESC или UNIQUE признать допустимым покрытием для определённых запросов, отсутствующие наборы колонок и partial definitions остаются. Условие «все покрыты» не выполнено: **не удалять indexes.sql / db:indexes и не создавать миграции**. Скрипт целиком нельзя объявить пригодным к запуску: он обращается к удалённым таблицам.

Whole-repo поиск `indexes.sql|db:indexes` с исключением docs/audits, .gitnexus, node_modules, .git, generated и .env: только `package.json:64` (рабочий db:indexes) и самокомментарий `prisma/indexes.sql:4`. Ссылок в src/e2e/tests/scripts/CI или других неисторических документах не найдено. Поиск с --hidden также проверил скрытые рабочие конфиги.


## GitNexus и независимая проверка

CLI 1.6.12 запускался на Node24.19.0 с alias PilingTrack-t21. Impact выполнялся до правок; HIGH/CRITICAL предупреждения владелец получал через root до изменения кода. Для passport и общего checklist: CRITICAL15/12; для общего обзора: CRITICAL15/direct5/processes4. fetchWithTimeout: CRITICAL488/direct3/processes28/modules20; первый усечённый ответ limit100 повторён с limit1000 и не принят как полный.

UNKNOWN не переименован в LOW: probeSession/AppLayout (вход через Next route convention), config и две динамические telemetry-функции дополнительно сверены текстовым поиском. Влияние config проверено также контролируемой сборкой; недостоверный ноль графа не служил доказательством удаления. До/после полного переиндексирования сохранялись глобальные ограничения enumeration budgets; они не дают заявления «весь граф чистый».

Перед коммитами root выполнил detect_changes(scope=all), включая текущие ещё не закоммиченные изменения других пунктов: перед #1 — 39 файлов/52 символа/71 flow, перед #2 — 27/26/54, перед #3 — 22/10/49; все exit0, CRITICAL. Это оценка влияния, а не доказательство отсутствия дефектов. Признаки partial/truncated не приняты за успешную полную проверку. #1–#3 прошли отдельное read-only review; найденные существенные гонки исправлены до коммитов. Перед #5 — 17 файлов/9 символов/39 flows, CRITICAL; #6 — 16/9/39, CRITICAL; #7 — 12/4/4, MEDIUM; #8 — 12/3/4, MEDIUM; #9 — 9/1/4, MEDIUM. Все эти precommit detect_changes завершились exit0. Отдельная финальная compare-проверка против main в этом отчёте не заявляется; перечислены фактически сохранённые проверки scope=all.

## Общие проверки по AGENTS.md

Проверены все интегрированные изменения на HEAD `3dba4ef0f314e2aa990fe9487653c5c4fa8990ff`, Node24.19.0, отдельно и последовательно. Первичные логи и индивидуальные exit-файлы: `.gitnexus/t21/final-checks.md`, `final-*.log/.exit`.

| Команда / эквивалент запуска через Node24 | Реальный результат |
|---|---|
| Проверка/удаление `.next/dev/types` | Исходная команда удаления отклонена политикой исполнения до запуска. Отдельный Test-Path=False: каталога нет, удаление не требуется и не выполнялось; `NOT_NEEDED`, не выдуманный exit0 удаления |
| `npx tsc --noEmit` → Node24 `node_modules/typescript/bin/tsc --noEmit` | **exit0**, диагностик нет |
| `npm run lint` → Node24 npm-cli `run lint` | **exit0**, ESLint0 ошибок/предупреждений; Text integrity check passed |
| `npm run test:unit -- --maxWorkers=1 --testTimeout=30000` | **exit0**; 399 passed / 14 skipped файлов (413); **4428 passed, 2 expected fail, 256 skipped** тестов (4686), 654.27 с |
| `npx playwright test --list` → Node24 `node_modules/@playwright/test/cli.js test --list` | **exit0**, **291 тест в 27 файлах**; список собран, браузерные E2E не исполнялись |
| `npm run build` → Node24 npm-cli `run build` с открытыми тестовыми значениями CI | **exit0**; Prisma7.10.0 generated, Next16.4.0 webpack compiled, встроенный TypeScript завершён; **95/95** статических страниц |
| `git diff --check` | **exit0** после отчёта; исходники уже чистые, незакоммичен только сам отчёт |

256 skipped не объявляются проверенной интеграцией: DB/Redis env перед unit не задавались, и не утверждается, что у каждого skip одна причина. 2 expected fail отдельно сохранены в результате и не названы passed. Промежуточные красные и неуспешные проверки выше не скрыты финальным exit0.

В unit сохранены предупреждение Vite о будущем configLoader:native и четыре MaxListenersExceededWarning (uncaughtException, unhandledRejection, SIGTERM, SIGINT). Это не предупреждения ESLint и не прерывание прогона.

Сборка выполнена с открытыми тестовыми значениями из `.github/workflows/ci.yml`, без чтения/создания `.env` и без подстановки секретов. Перед build проверены только имена `.env*`: имелись три `.example`, рабочей `.env` не было. Script build импортирует dotenv, но рабочей `.env` для загрузки нет. Собственный src/generated перед разрешённым db:generate проверен на отсутствие junction; generated/build-артефакты не коммитились.

Предупреждения build сохранены, не исправлялись вне задачи:

- SENTRY_AUTH_TOKEN не задан, sourcemaps не загружаются.
- npm предупредил об игнорировании `.npmrc allow-scripts` при явном `--allow-scripts`.
- Optional `@valkey/valkey-glide` из BullMQ не разрешён webpack; сборка завершилась exit0.
- RateLimiter вывел Redis error и in-memory fallback на CI localhost stub. Это build output, не отдельный живой outage-тест.
- **27 traced files** из общего `../my-project/node_modules` вышли за outputFileTracingRoot и не включены в standalone. Успешная сборка в worktree с junction **не доказывает standalone runtime**; его не запускали.

Node24 взят из `C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`. Системный Node26 давал EINVAL/OOM и для итоговых проверок не использовался. После всех команд HEAD остался `3dba4ef0`, исходники и общий node_modules не изменились; status содержал только отчёт.
## Изменённые файлы и объём

Diff `f1006494..3dba4ef0`: **47 файлов, +1129/−254 строк**, включая package/lock. Сам `docs/audits/codex-t21.md` — отдельный новый документ (+231/−0 строк) и в эту численность кода/тестов/config не входит. `+`/`−` — git numstat, а не размер файла.

Ни один файл приложения не удалён. Новые файлы #1 — общий хук и его тест, покрывающий прямо запрошенный механизм; остальные tests расширены в существующих файлах. В #8 удалены только запись пакета/peer и два подключения plugin; используемые UI-файлы и tw-animate-css сохранены. Доказательства отсутствия использования и контролируемое сравнение CSS приведены в разделе8.

| Файл от корня дерева | + | − |
|---|---:|---:|
| `package-lock.json` | 1 | 10 |
| `package.json` | 0 | 1 |
| `src/app/(app)/__tests__/layout.test.tsx` | 45 | 2 |
| `src/app/(app)/layout.tsx` | 26 | 4 |
| `src/app/api/admin/equipment-analytics/route.ts` | 1 | 1 |
| `src/app/api/auth/logout/__tests__/route.test.ts` | 6 | 4 |
| `src/app/api/equipment/[id]/device-keys/__tests__/route.test.ts` | 1 | 1 |
| `src/app/api/equipment/[id]/device-keys/route.ts` | 1 | 1 |
| `src/app/api/telemetry/__tests__/rate-limit-key.test.ts` | 2 | 4 |
| `src/app/api/telemetry/batch/route.ts` | 1 | 1 |
| `src/app/api/telemetry/ingest/route.ts` | 1 | 1 |
| `src/app/api/telemetry/route.ts` | 3 | 3 |
| `src/components/piling/inspections/__tests__/inspection-mobile-targets.test.tsx` | 57 | 2 |
| `src/components/piling/inspections/run-inspection.tsx` | 22 | 5 |
| `src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx` | 10 | 0 |
| `src/components/piling/operator-mobile/operator-mobile-app.tsx` | 6 | 4 |
| `src/components/piling/operator-mobile/operator-work-overview.test.tsx` | 43 | 1 |
| `src/components/piling/operator-mobile/operator-work-overview.tsx` | 15 | 2 |
| `src/components/piling/operator-mobile/screens/__tests__/pile-passport-form.test.tsx` | 19 | 2 |
| `src/components/piling/operator-mobile/screens/__tests__/work-screen.test.tsx` | 29 | 1 |
| `src/components/piling/operator-mobile/screens/checklist-screen.test.tsx` | 40 | 2 |
| `src/components/piling/operator-mobile/screens/checklist-screen.tsx` | 29 | 7 |
| `src/components/piling/operator-mobile/screens/entries-list.tsx` | 50 | 56 |
| `src/components/piling/operator-mobile/screens/pile-passport-form.tsx` | 28 | 18 |
| `src/components/piling/operator-mobile/screens/work-screen.tsx` | 16 | 8 |
| `src/components/piling/operator-mobile/use-local-form-draft.test.tsx` | 86 | 0 |
| `src/components/piling/operator-mobile/use-local-form-draft.ts` | 81 | 0 |
| `src/components/piling/operator-mobile/v10/__tests__/operator-v10-flow.test.tsx` | 15 | 0 |
| `src/components/piling/operator-mobile/v10/__tests__/operator-v10-port.test.tsx` | 24 | 0 |
| `src/components/piling/operator-mobile/v10/operator-v10-app.tsx` | 31 | 16 |
| `src/components/piling/operator-mobile/v7/__tests__/operator-v7-app.test.tsx` | 65 | 1 |
| `src/components/piling/operator-mobile/v7/__tests__/v7-shift.test.tsx` | 12 | 2 |
| `src/components/piling/operator-mobile/v7/operator-v7-app.tsx` | 21 | 9 |
| `src/components/piling/operator-mobile/v7/v7-screens.tsx` | 19 | 4 |
| `src/components/piling/operator-mobile/v7/v7-shift.tsx` | 22 | 13 |
| `src/components/piling/operator-v2/__tests__/operator-shift-v2.test.tsx` | 50 | 1 |
| `src/components/piling/operator-v2/operator-shift-v2.tsx` | 72 | 16 |
| `src/components/piling/operator-v2/sheets.tsx` | 28 | 18 |
| `src/components/piling/operator-v5/__tests__/operator-v5-app.test.tsx` | 66 | 2 |
| `src/components/piling/operator-v5/operator-v5-app.tsx` | 49 | 20 |
| `src/components/piling/pile-journal/__tests__/pile-journal.test.tsx` | 11 | 0 |
| `src/components/piling/pile-journal/index.tsx` | 2 | 2 |
| `src/components/piling/to/readiness/screens/__tests__/permits-screen.test.tsx` | 9 | 4 |
| `src/lib/api.ts` | 3 | 3 |
| `src/modules/analytics/index.ts` | 2 | 0 |
| `src/modules/telemetry/index.ts` | 9 | 0 |
| `tailwind.config.ts` | 0 | 2 |

## Что оставлено и открытые ограничения

- `prisma/indexes.sql` и `db:indexes` сохранены по условию #10. Нельзя считать скрипт пригодным к запуску: четыре определения относятся к удалённым таблицам. Нужен отдельный выбор владельца по дальнейшей судьбе файла/скрипта и отличающихся определений; в этом потоке ни миграций, ни выполнения SQL не было. Пункт завершён решением сохранить файл; отдельный пустой кодовый коммит не создавался.
- Варианты оператора и общий UI менялись только в рамках #1–#3. V3, тип смены, правила старта/СИЗ, security/auth-server, схема, миграции, ORION, происшествия, уведомления и исключённые владельцем сценарии не менялись.
- Фасады сохранены; services→modules не мигрировались. tailwind.config.ts сохранён. Используемый tw-animate-css остаётся.
- Runtime wt-codex21 в боковом браузере не пройден; живой отказ Redis/БД этой ветки не проверен. Геометрический DOM-эксперимент #7 на main и flow22 не выдаются за браузерную приёмку ветки. Разные сохранённые builds не являются развёртыванием.
- Клиентский таймаут #6 не устраняет серверное ожидание молча зависшего ready Redis. Серверный deadline/security-политика не менялись; live-outage latency и standalone runtime не проверены. Финальные проверки сборки/типов/lint/unit/list завершены с указанными ограничениями.
