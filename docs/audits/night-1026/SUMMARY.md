# Доказательная ночь 26–29 октября 2026

Ветка codex/night-evidence-1026, база origin/main **efd95008eac3bc846c89003c4b7766f2eb5c1c9b**. Последний проверенный прикладной SHA **12167551**: новый Equipment lifecycle3/0/0 и полный unit5783/0/0,build0/156с. Отдельный известный multiple-assignment RED0/1/0 сохранён. Предыдущие48браузерных случаев относятсяк451. Исторические осмотры механика,бригады,матрицаURL и общий обход ролей относятся к44126; старые users/fullunit00ac сохранены отдельно. Границы каждого SHA указаны в разделах. Ничего не отправлялось и не вливалось.

| Задача | Статус | Что доказано |
|---|---|---|
|1. Повтор241пропуска|Готово|Все 241 повторены в свежем полном5783/0/0 на121,512файлов|
|2. Отказы outbox|Готово|Пять PG-сценариев, crash/replay, точечный canonical tenant guard; retry/DLQ сохранены|
|3. Матрица допуска|Готово|10случаев×5путей, решения совпали; разные предупреждения оставлены|
|4. Образы и smoke|Готово|Точный main efd95008:app0/360с,workers0/43с,workerssmoke0/9с,prod:smoke13/13exit0. Это образы main, не ночной ветки|
|5. Длинные файлы|Готово|15файлов:7прикладных/8тестовых; только чтение|
|6. Роли и сквозные цепочки|**Частично**|На451: пять версий оператора,30полных циклов и9V3;на121:3Equipmentlifecycle. Цепочки диспетчера/ОТ/ремонта имеют отдельныеSHA. КаждыйCRUD и каждый чужойURL ещё не исчерпаны|
|7. Документы против кода|Готово в заявленном объёме|43утверждения обязательных категорий,9вопросов владельцу. Архивы целиком не объявлены проверенными|

## ДЕФЕКТЫ

| Приоритет | Дефект | Исправление |
|---|---|---|
|P3|После создания установки201/SQL парк и поиск остаются со старым снимком, обычный fleet1 противfresh2|RED40525a06 → fix12167551: ровно2строки; новые3lifecycle/полный5783unit/build156с прошли. EQUIPMENT-CACHE-FIX.md|
|P3|Вторая из двух активных назначенных установок: fuel и meter-readings GET/POST возвращают403|**Открыт**, подтверждён HTTP/SQL на451и заново121; E2E0/1/0. EQUIPMENT-MULTIPLE-RED.md; нужна точечная отмена запрета на общий query|
|P2|OPERATOR получает паспорт неназначенной установки по прямому id, хотя список её скрывает, а details запрещён|RED1daa696a → fix451acce2: согласованные девять строк;3случая доступа+30циклов+9V3+6users и полный unit5783/0/0. EQUIPMENT-ACCESS-FIX.md|
|P2|ASSISTANT403 в «ТБ и допуски»|0e3e2c9a: личный экран без расширения прав|
|P2|Outbox без tenantId доходил доhandler|48aa4689: разрешённый guard;старые записи требуют разбора|
|P2|Гонка20approval:23505legacy UNIQUE(scope,key),воспроизведена наmain|f51b0f30:ровно разрешённое ON CONFLICT DO NOTHING.37проверок+10гонок+полный5776/0/0|
|P3|FOREMAN делал закрытый запрос документов|befa99f9:существующее право чтения|
|P3|Два S3helpers с пустымtenant возвращалиdefaultprefix|7ad5d3bd:2функции+2существующихтеста;живых callers нет,утечка не заявлена|
|P3|V5 длинное имя расширялоviewport и мешало нажатиям|46315b0f:локальныйoverflow-wrap,RED→GREEN|
|P3|V2 нижняя панель перекрывала завершение осмотра;имя расширялоviewport|21dc26ce+7a9dc8a7+95f7c6b8:локальныеCSSклассы;6полныхциклов зелёные|
|P3|V3 нижняя навигация перекрывала selector объекта|1b0a2663:CSS,3selector зелёные;версия сохранена|
|P3|После create пользователя SQL содержит запись, обычный GET и UI остаются со старым списком|30634acf (RED) → 00ac751f: четыре строки инвалидации; шесть UI-тестов и свежий полный unit прошли. USERS-LIFECYCLE.md|

## Проверки

На SHA 451acce2 новый прогон завершён: доступ к установкам 3/0/0,полные операторские циклы 30/0/0 (30CLOSED/30 уникальных отчётов), V39/0/0,пользователи 6/0/0;всего 48 passed/0 failed/0 skipped/0 flaky. Build exit 0/151 с;свежий полный unit 5783/0/0,512 файлов,все 241 исторических случая заново найдены и прошли. Коллекция 402/30 противBASE318/28,обаexit 0. EQUIPMENT-ACCESS-FIX.md/json.

Следующие ранние результаты сохраняются как история с собственными SHA.

Build44126:exit0/143с;tsc0/19с;lint0/65с/zero warnings. Свежий полный unit: **5776passed/0failed/0skipped**,512файлов,831,50с Vitest/873с wrapper. Все241 исторических найдены и прошли. Playwright collection:384/30 против BASE318/28,обаexit0. Последующие E2E-only проверки и новые сквозные цепочки — CROSS-ROLE.md;точные команды,exits,время и последняя коллекция — VERIFICATION.md.

Пять канонических версий /operator,v2,v5,v7,v10 × три браузера × одна/две установки: **30passed/0failed/0skipped**,30CLOSED/30уникальных отчётов. Проверены СИЗ/инструктаж/знания,осмотры/ТБ,offline/replay,сваи/бурение/простой,инцидент/ЕО,закрытие,SQL/audit/outbox/analytics и UI диспетчера. V10 при двух назначениях принимает показанное по умолчанию; другой chooser не выдуман.

V3: **9passed/0failed/0skipped** (6legacy+3selector). Отчёт сохраняется, но shiftId=null и mobilephaseIDENTITY до/после. Это отдельная legacy-модель; канонический цикл V3 отсутствует. Вопрос№9 — решение владельца, процесс самовольно не переписан. Начальный SafariRED оказался гонкой фокуса нового теста после RadixSelect;86358ae3 ждёт реальный возврат фокуса, не ослабляя assertions.

Существующие critical paths на совершенно свежем стенде: **6passed/0failed/0skipped**,exit0/58с:report→dailyprojection→analytics→реальныеPDFbytes, ADMIN наряд/приёмка, подтверждённое удаление куста,503recovery,UI второго канала(ответmock),printpopup. ПрочиеCRUD этим не объявляются проверенными.

Свежий C1–C3: **3passed/0failed/0skipped**,exit0/67с,cleanup=true. Это действия со справочником,объектом и отчётом диспетчера;подробности QA-RUN.md. Новые сквозные цепочки:Chromium2/0/0;ремонт3/0/0;обход семи ролей21/0/0. Последние tsc0/19с,lint0/124с;Playwright387/30 против BASE318/28,обаexit0.

Полный EO механика и прежние регрессии осмотров: **12/0/0**,exit0/246с,три браузера. Подтверждены реальная фотография MinIO,подпись,моточасы/история,аудит и readiness snapshot;replay без повторного показания. Последние tsc0/15с,lint0/62с без предупреждений,list390/30 против BASE318/28,обаexit0/37с. MECHANIC-INSPECTION.md/json.

Прямые15разделов×7ролей×3браузера:3passed/0failed/0skipped,315наблюдений с точным конечнымURL и родительскимadmin guard. DIRECT-URL-MATRIX.md/json. Последние tsc0/18с,lint0/81с без предупреждений;list393/30 против BASE318/28,обаexit0. Все detailURLs/CRUD этим не покрыты.


Бригада через формы во всех3браузерах:3passed/0failed/0skipped. Создание, смена установки/объекта/названия, снятие помощника, отмена/подтверждение softdelete и активация; SQL/аудит/сохранность draftReport, чтение MECHANIC и403 на изменение, options OPERATOR. CREW-LIFECYCLE.md/json. Последние tsc0/17с,lint0/70с без предупреждений;коллекция396/30 против BASE318/28,обаexit0.


На сборке 00ac751f пользователи и документы: 6 passed / 0 failed / 0 skipped / 0 flaky, exit 0, 279 с; Chromium, Mobile Safari и Mobile Chrome. Создание и правка пользователя, сроки и удаление удостоверения, чтение инженером ОТ, отказы другому оператору, блокировка с отзывом сессии, разблокировка и удаление подтверждены UI/SQL и 24 точными событиями аудита. Build: exit 0, 168 с. Свежий полный unit: 5776 / 0 / 0; все 241 исторических случая повторены. Коллекция 399/30 против BASE 318/28, оба exit 0. Подробности: USERS-LIFECYCLE.md/json. Предыдущие RED сохранены.

Новый E2E отказа по чужой установке: **0 passed / 1 failed / 0 skipped**, exit1; это подтверждённый дефект доступа в текущем00ac, не сбой окружения. Перед фиксацией RED: tsc exit0/15с; lint exit0/63с без предупреждений; Playwright collection 402/30 против BASE 318/28, оба exit0/40с. Свежий полный unit5776/0/0 и build0/168с относятся к неизменившемуся прикладному SHA00ac; новый E2E намеренно красный, он не скрыт общим зелёным итогом. Владелец разрешил только предложенный GET и существующие тесты; разрешение записано в PERMIT-EQUIPMENT-ACCESS.md. Приложение до этого RED-коммита не меняется.

## Что осталось

КаждыйCRUD, каждый чужойURL, паспорт сваи и вся матрица ресурсов не исчерпаны. Первоначальный QA68 остаётся53passed/14skipped/1failed,exit1;устаревший email-контракт C3 исправлен и focused зелёный,весь68 не повторялся. Причины14skip — QA-RUN.md. Исторические REDunit/UI не удалены и не заменены выборочными GREEN.

Очередь уведомлений и6delivery-сценариев на своём HTTP подтверждены; реальный Telegram, датчики, MQTT и железо не проверены. Ненастроенный Telegram даёт retry/DLQ: политика — вопрос№8. Закрытие ремонта не переписывает старый осмотр и само по себе не обещает полностью READY.

Рабочие3100/данные/production не трогались. .env/schema/migrations/dependencies/auth/security/ORION не менялись. Узкие исключения S3/outbox/одна SQL-строка и девять строк GET паспорта установки не расширены. Общая getCrewForOperator и два её guard остаются без правки; отдельное исключение запрошено. Один независимый review выполнен ранее; новый не дублировался, поздние фиксы ему не приписаны. Автоматизации03-15/08-20/13-25/18-30 удалены. Одноразовый запуск02:00 удалён после срабатывания; запуск07:00 сохранён.

## Файлы и повтор

Подробности: VERIFICATION.md, ROLES-WALKTHROUGH.md, CROSS-ROLE.md, OPERATOR-CYCLE.md, V2-FOOTER.md, V5-VIEWPORT.md, V3-LEGACY.md. Файлы и строки — CHANGED-FILES.md. Сырые логи/JSON/screenshots и RESUME — D:/PillingR/night-logs/night-evidence-1026/. Команды в *-result.json; пароли fixtures не писать в.env/отчёт. Полные detectall/compare перед финальным коммитом приложены отдельно; ограничения графа не трактуются как безопасность.



## Последние проверки cachefix12167551

Новый build0/156с;focused1/0/0 и3browserlifecycle3/0/0(всеflaky0),fullunit5783/0/0/512files,все241passed;collection408/30vsBASE318/28оба0. Отдельныйдругойmultiple-assignmentP3зановореальноRED0/1/0на121,queryнеправился. ПодробностиEQUIPMENT-CACHE-FIX.md/json. Старые451циклы/44126матрицанеперенесенына121. Task6частична.

## Коммиты ветки

Список до прикладногоSHA12167551; завершающийкоммитотчётабудетследующим.

```text
17fd1277 test(storage): expose tenantless S3 key regression
7ad5d3bd fix(storage): reject tenantless report and CSV keys
9b9cce5f test(safety): reproduce blocked personal clearance for assistant
0e3e2c9a fix(safety): render personal clearance for assistant without park bootstrap
d7c2af5b test(dashboard): reject forbidden document control prefetch
befa99f9 fix(dashboard): respect document reading permission before fetch
05bc33fc test(outbox): prove retries crash replay and tenantless processing on PostgreSQL
48aa4689 fix(outbox): require canonical tenant before invoking handlers
86b5101f test(safety): verify document clearance matrix across all consumers
ac8dc9e5 test: align real Prisma fixtures with the runtime RLS adapter types
7e3aa7e1 test(e2e): walk role pages tabs API denials and session replacement
4e77e366 docs: correct notification source path and disposable browser commands
0653c6e5 test(e2e): wait for hydrated readiness and include retained v3 fixture
ff582e7e docs(audit): record real integration outbox clearance and code evidence
fa0f8c3d test(outbox): supply canonical tenants in normal projection fixtures
3f671dae test(outbox): select platform shell for disposable PostgreSQL helpers
ea22fd18 test(e2e): select dispatcher report fixture by public user id
f87c2b50 test(e2e): verify role sessions, full v7 shifts and blocked v3 selector
1b0a2663 fix(operator-v3): retain bottom spacing above desktop navigation
f154f8b4 test: verify complete v10 operator shift on disposable stand
53548552 docs: preserve night evidence, baseline race and verification limits
58a2b64f test: exercise full primary operator shift and offline replay
a61aa205 docs: record primary operator evidence and final isolated cleanup
f51b0f30 fix(readiness): handle both idempotency unique constraints
a17c07e7 docs: record verified idempotency fix and full green baseline
e4b43878 test: reproduce v5 long equipment name overflow
46315b0f fix(operator-v5): wrap long equipment names within viewport
1d0ff6e9 test: reproduce blocked completion in v2 inspection
21dc26ce fix(operator-v2): keep nested screen footer clear of step dock
7a9dc8a7 fix(operator-v2): reserve space for fixed step navigation
95f7c6b8 fix(operator-v2): wrap long rig names within the viewport
44126b98 test(operator-v3): prove legacy report persistence and dispatcher visibility
86358ae3 test(operator-v3): await select focus restoration before numeric input
fa2de8ec test(e2e): prove dispatcher safety repair and readiness chains
fcc5b0d6 docs: record final operator and cross-role evidence with coverage limits
34227a48 test(inspections): prove complete mechanic workflow across browsers
f938298c test(e2e): verify inherited page guards across seven real roles
b0001fdb test(crews): prove UI lifecycle assignments and actor audit
30634acf test(users): reproduce stale cached list after committed creation
00ac751f fix(users): invalidate catalogue responses after successful writes
81de8087 test(users): verify lifecycle after catalogue cache invalidation
1daa696a test(equipment): reproduce operator access to an unassigned rig
451acce2 fix(equipment): restrict operator cards to active rig assignments
816e388a docs: record verified equipment access fix and source-pinned regression gates
ea9a64f2 test(equipment): reproduce denied journals for a second assigned rig
40525a06 test(equipment): reproduce stale fleet after creating a rig
12167551 fix(equipment): invalidate fleet snapshot after rig creation
```
