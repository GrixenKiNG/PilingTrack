# Доказательная ночь 26–28 октября 2026

Ветка codex/night-evidence-1026, база origin/main **efd95008eac3bc846c89003c4b7766f2eb5c1c9b**. Прикладная сборка **44126b98**, последующие изменения — E2E и отчёты. Ничего не отправлялось и не вливалось.

| Задача | Статус | Что доказано |
|---|---|---|
|1. Повтор241пропуска|Готово|Все241 прошли в полном5776/0/0,512файлов|
|2. Отказы outbox|Готово|Пять PG-сценариев, crash/replay, точечный canonical tenant guard; retry/DLQ сохранены|
|3. Матрица допуска|Готово|10случаев×5путей, решения совпали; разные предупреждения оставлены|
|4. Образы и smoke|Готово|Точный main efd95008:app0/360с,workers0/43с,workerssmoke0/9с,prod:smoke13/13exit0. Это образы main, не ночной ветки|
|5. Длинные файлы|Готово|15файлов:7прикладных/8тестовых; только чтение|
|6. Роли и сквозные цепочки|**Частично**|Пять версий оператора:30полных циклов;V3:9legacy/selector. Цепочки диспетчера, ОТ и ремонта подтверждены. КаждыйCRUD и каждый чужойURL ещё не исчерпаны|
|7. Документы против кода|Готово в заявленном объёме|43утверждения обязательных категорий,9вопросов владельцу. Архивы целиком не объявлены проверенными|

## ДЕФЕКТЫ

| Приоритет | Дефект | Исправление |
|---|---|---|
|P2|ASSISTANT403 в «ТБ и допуски»|0e3e2c9a: личный экран без расширения прав|
|P2|Outbox без tenantId доходил доhandler|48aa4689: разрешённый guard;старые записи требуют разбора|
|P2|Гонка20approval:23505legacy UNIQUE(scope,key),воспроизведена наmain|f51b0f30:ровно разрешённое ON CONFLICT DO NOTHING.37проверок+10гонок+полный5776/0/0|
|P3|FOREMAN делал закрытый запрос документов|befa99f9:существующее право чтения|
|P3|Два S3helpers с пустымtenant возвращалиdefaultprefix|7ad5d3bd:2функции+2существующихтеста;живых callers нет,утечка не заявлена|
|P3|V5 длинное имя расширялоviewport и мешало нажатиям|46315b0f:локальныйoverflow-wrap,RED→GREEN|
|P3|V2 нижняя панель перекрывала завершение осмотра;имя расширялоviewport|21dc26ce+7a9dc8a7+95f7c6b8:локальныеCSSклассы;6полныхциклов зелёные|
|P3|V3 нижняя навигация перекрывала selector объекта|1b0a2663:CSS,3selector зелёные;версия сохранена|

## Проверки

Build44126:exit0/143с;tsc0/19с;lint0/65с/zero warnings. Свежий полный unit: **5776passed/0failed/0skipped**,512файлов,831,50с Vitest/873с wrapper. Все241 исторических найдены и прошли. Playwright collection:384/30 против BASE318/28,обаexit0. Последующие E2E-only проверки и новые сквозные цепочки — CROSS-ROLE.md;точные команды,exits,время и последняя коллекция — VERIFICATION.md.

Пять канонических версий /operator,v2,v5,v7,v10 × три браузера × одна/две установки: **30passed/0failed/0skipped**,30CLOSED/30уникальных отчётов. Проверены СИЗ/инструктаж/знания,осмотры/ТБ,offline/replay,сваи/бурение/простой,инцидент/ЕО,закрытие,SQL/audit/outbox/analytics и UI диспетчера. V10 при двух назначениях принимает показанное по умолчанию; другой chooser не выдуман.

V3: **9passed/0failed/0skipped** (6legacy+3selector). Отчёт сохраняется, но shiftId=null и mobilephaseIDENTITY до/после. Это отдельная legacy-модель; канонический цикл V3 отсутствует. Вопрос№9 — решение владельца, процесс самовольно не переписан. Начальный SafariRED оказался гонкой фокуса нового теста после RadixSelect;86358ae3 ждёт реальный возврат фокуса, не ослабляя assertions.

Существующие critical paths на совершенно свежем стенде: **6passed/0failed/0skipped**,exit0/58с:report→dailyprojection→analytics→реальныеPDFbytes, ADMIN наряд/приёмка, подтверждённое удаление куста,503recovery,UI второго канала(ответmock),printpopup. ПрочиеCRUD этим не объявляются проверенными.

Свежий C1–C3: **3passed/0failed/0skipped**,exit0/67с,cleanup=true. Это действия со справочником,объектом и отчётом диспетчера;подробности QA-RUN.md. Новые сквозные цепочки:Chromium2/0/0;ремонт3/0/0;обход семи ролей21/0/0. Последние tsc0/19с,lint0/124с;Playwright387/30 против BASE318/28,обаexit0.

Полный EO механика и прежние регрессии осмотров: **12/0/0**,exit0/246с,три браузера. Подтверждены реальная фотография MinIO,подпись,моточасы/история,аудит и readiness snapshot;replay без повторного показания. Последние tsc0/15с,lint0/62с без предупреждений,list390/30 против BASE318/28,обаexit0/37с. MECHANIC-INSPECTION.md/json.

Прямые15разделов×7ролей×3браузера:3passed/0failed/0skipped,315наблюдений с точным конечнымURL и родительскимadmin guard. DIRECT-URL-MATRIX.md/json. Последние tsc0/18с,lint0/81с без предупреждений;list393/30 против BASE318/28,обаexit0. Все detailURLs/CRUD этим не покрыты.


Бригада через формы во всех3браузерах:3passed/0failed/0skipped. Создание, смена установки/объекта/названия, снятие помощника, отмена/подтверждение softdelete и активация; SQL/аудит/сохранность draftReport, чтение MECHANIC и403 на изменение, options OPERATOR. CREW-LIFECYCLE.md/json. Последние tsc0/17с,lint0/70с без предупреждений;коллекция396/30 против BASE318/28,обаexit0.


## Что осталось

КаждыйCRUD, каждый чужойURL, паспорт сваи и вся матрица ресурсов не исчерпаны. Первоначальный QA68 остаётся53passed/14skipped/1failed,exit1;устаревший email-контракт C3 исправлен и focused зелёный,весь68 не повторялся. Причины14skip — QA-RUN.md. Исторические REDunit/UI не удалены и не заменены выборочными GREEN.

Очередь уведомлений и6delivery-сценариев на своём HTTP подтверждены; реальный Telegram, датчики, MQTT и железо не проверены. Ненастроенный Telegram даёт retry/DLQ: политика — вопрос№8. Закрытие ремонта не переписывает старый осмотр и само по себе не обещает полностью READY.

Рабочие3100/данные/production не трогались. .env/schema/migrations/dependencies/auth/security/ORION не менялись. Узкие исключения S3/outbox/однаSQLстрока не расширены. Один независимый review выполнен ранее; новый не дублировался, поздние фиксы ему не приписаны. Автоматизации03-15/08-20/13-25/18-30 удалены.

## Файлы и повтор

Подробности: VERIFICATION.md, ROLES-WALKTHROUGH.md, CROSS-ROLE.md, OPERATOR-CYCLE.md, V2-FOOTER.md, V5-VIEWPORT.md, V3-LEGACY.md. Файлы и строки — CHANGED-FILES.md. Сырые логи/JSON/screenshots и RESUME — D:/PillingR/night-logs/night-evidence-1026/. Команды в *-result.json; пароли fixtures не писать в.env/отчёт. Полные detectall/compare перед финальным коммитом приложены отдельно; ограничения графа не трактуются как безопасность.

## Коммиты ветки

До текущего тестового снимка; его хеш приведён в итоговом сообщении и внешнем RESUME. Полный список включая него: git log --reverse --format="%H %s" efd95008..HEAD.

- 17fd1277d3ee97b49b1f4736fd77aa8318a5097a test(storage): expose tenantless S3 key regression
- 7ad5d3bd7192b8976ce11113b68b54c93dbfe655 fix(storage): reject tenantless report and CSV keys
- 9b9cce5f08e1e5f2bd25d6b62e4aa0db3c65706a test(safety): reproduce blocked personal clearance for assistant
- 0e3e2c9ad87ad85f2948c98ea56cfae21a88021c fix(safety): render personal clearance for assistant without park bootstrap
- d7c2af5b6df4e7247dc3d9e67719d119c9ea1f16 test(dashboard): reject forbidden document control prefetch
- befa99f93b878199af8d23eae777e62fe78706fa fix(dashboard): respect document reading permission before fetch
- 05bc33fc147e58e3f3d36fd9cd3c75f04cb7f74c test(outbox): prove retries crash replay and tenantless processing on PostgreSQL
- 48aa4689b50e745325decf7ecab0f1b45e5a2d79 fix(outbox): require canonical tenant before invoking handlers
- 86b5101f5c45f13d03c3a26adb8bb5ae1e2ff7a3 test(safety): verify document clearance matrix across all consumers
- ac8dc9e58649f843c37458ead687d8e25a037396 test: align real Prisma fixtures with the runtime RLS adapter types
- 7e3aa7e15833f33a57ce2fa87c8acdd5bd3e318a test(e2e): walk role pages tabs API denials and session replacement
- 4e77e3667dba5db3ca1816f6e146c6109a3a0018 docs: correct notification source path and disposable browser commands
- 0653c6e5fea4728f2e3f000da405227458b3eba8 test(e2e): wait for hydrated readiness and include retained v3 fixture
- ff582e7e2d2e6c4c68144ce56d8d677bfffe45a6 docs(audit): record real integration outbox clearance and code evidence
- fa0f8c3dd2dc3c841452765adf3e15014dfe765d test(outbox): supply canonical tenants in normal projection fixtures
- 3f671dae5fd63f5d5329fe838f6945c0865e647a test(outbox): select platform shell for disposable PostgreSQL helpers
- ea22fd18dea34df804cdc14df60a1780d761000d test(e2e): select dispatcher report fixture by public user id
- f87c2b5000a2273a5efa56e9cf44b61febd48ffc test(e2e): verify role sessions, full v7 shifts and blocked v3 selector
- 1b0a2663d19c5d9f77e22f64882ba59c306bbf8c fix(operator-v3): retain bottom spacing above desktop navigation
- f154f8b400eaa04c789f4096c8da7bab45fe8f62 test: verify complete v10 operator shift on disposable stand
- 535485522b10c35bdfd49323ade47149bf219b9a docs: preserve night evidence, baseline race and verification limits
- 58a2b64f7a9437e6badbc1474bfb279ee95c5a18 test: exercise full primary operator shift and offline replay
- a61aa205bd55817ca342f98b0310889f6f5aaff9 docs: record primary operator evidence and final isolated cleanup
- f51b0f30465c0273905853d0e1e8bc333a9ee0e5 fix(readiness): handle both idempotency unique constraints
- a17c07e7132b772118d9b3b780a1c9f3c5781c03 docs: record verified idempotency fix and full green baseline
- e4b438783fef8e4c36fa685b8e553cf8e7022315 test: reproduce v5 long equipment name overflow
- 46315b0fa1233b27075c4edb79d604c6c451026c fix(operator-v5): wrap long equipment names within viewport
- 1d0ff6e99da391207450ffc546f6051875883cda test: reproduce blocked completion in v2 inspection
- 21dc26ce6046a139e54d0ce8fc19c55e94682b65 fix(operator-v2): keep nested screen footer clear of step dock
- 7a9dc8a7d7e8064d3af48549592315468e045cf2 fix(operator-v2): reserve space for fixed step navigation
- 95f7c6b85de1baff9cf2188ce7fc6b449714622b fix(operator-v2): wrap long rig names within the viewport
- 44126b987c9dd02b0bbefe28e8094f282b94aaf0 test(operator-v3): prove legacy report persistence and dispatcher visibility
- 86358ae362686ec2655bf525267059a41908a57b test(operator-v3): await select focus restoration before numeric input
- fa2de8ec394b86dba29eb2861d0252a1416c647c test(e2e): prove dispatcher safety repair and readiness chains
- fcc5b0d6cda4b55490076016708edfb338fc1187 docs: record final operator and cross-role evidence with coverage limits
- 34227a48b77e79a262d1b4d5e480c6249e2ba351 test(inspections): prove complete mechanic workflow across browsers
- f938298c9fcdab0611ff0c1361176be01e1756b8 test(e2e): verify inherited page guards across seven real roles
