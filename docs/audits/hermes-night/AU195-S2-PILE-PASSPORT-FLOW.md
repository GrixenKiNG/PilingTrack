# AU195-S2-PILE-PASSPORT-FLOW: Паспорт сваи — решение и выгрузка

Версия: `git rev-parse HEAD` → `bfa85eb26325851410ddbf7a3bb8ecfd05b02623`
(ветка `hermes/q4-0926`, рабочее дерево `D:\PillingR\wt-night`). Только чтение, код приложения не менялся.

## Итог

Поток паспорта сваи в коде целостен по чтению и выгрузке, но имеет два разрыва на границах.
Создаёт паспорт единственный путь — команда `log-production` с `entry.kind='PILE_PASSPORT'`, и она жёстко ограничена ролью `OPERATOR` (`command/route.ts:192`), поэтому описанный в схеме сценарий «мастер заводит паспорт за машиниста» недостижим, а поле `recordedByForeman` не пишется нигде.
Решает сваю `piles.manage` = ADMIN/DISPATCHER/FOREMAN (`authorization-service.ts:71`); повторное решение разрешено, снимок «before» и запись `pile.passport.decided` сохраняют прежнее решение.
Выгрузка `.xlsx` и экран считают одну выборку (`listPilePassports`), решение и замеры попадают в файл; лимит выгрузки 6/мин.
Самый тяжёлый риск: удаление отчёта (`DELETE /api/reports/delete`) каскадно уничтожает `PileWork` → `PilePassport` вместе с решениями, а снимок удаления их не фиксирует.
Найдено 15 позиций: критично — 0, важно — 5, мелочь — 7, гипотеза — 3.

Топ-5:
1. `recordedByForeman` не присваивается ни в одном месте — бейдж «Записал мастер» мёртв, сценарий «мастер за машиниста» не работает (важно).
2. Создание паспорта жёстко за ролью `OPERATOR` — окна для мастера нет (важно).
3. Путь создания паспорта (`production.ts:277-385`, `validatePassport`) не покрыт юнит-тестом (важно).
4. Удаление отчёта каскадно удаляет паспорта и решения; снимок удаления их не содержит (важно).
5. Поправку паспорта внести негде, хотя сообщение сервера отправляет «в журнал забивки» (важно).

## Методика

Search (rg через `search_files`/`grep`), чтение диапазонов (`sed -n`, `read_file`):
- `rg 'pilePassport\.(create|upsert|updateMany|delete)|PilePassport\b' src` — все точки записи и чтения паспорта (итог: `create` ровно один — `production.ts:344`; `updateMany` ровно один — `pile-passport.service.ts:65`).
- `rg 'pile-passports|pile\.passport|PilePassport|pilePassport' .` — маршруты, UI, тесты, e2e-fixtures (закрытые отчёты `docs/audits/**` и `CODEX-REPORT*` исключены из чтения по условию задачи).
- `rg 'recordedByForeman' --include=*.ts --include=*.tsx --include=*.mjs --include=*.js --include=*.sql .` — итог: только `pile-journal-list.ts:151` (чтение), `pile-journal-types.ts:79` (тип), тест-фикстура; запись — 0.
- `rg 'passport|PilePassport|Залог|validatePassport' src/modules/operator-mobile/application/commands/__tests__/production.test.ts` — 0 совпадений.
- `sed -n` по `prisma/schema.prisma` (2201-2349) — модель `PilePassport`, `PileDrivingSet`, enum `PileAcceptance`, каскады.
Проверки (tsc/lint/vitest) не запускались: задача read-only, изменений кода нет.

## Карта потока: шаг | файл:строка | право | тест

| Шаг | Файл:строка (ПОЛНЫЙ путь от корня) | Право | Тест | Статус |
|---|---|---|---|---|
| Команда создания (схема + разбор) | src/app/api/operator/mobile/command/route.ts:65-110, 186-262 | роль `OPERATOR` (жёстко, :192) | НЕТ кейса `PILE_PASSPORT` в production.test.ts | НЕ ПРОВЕРЕНО |
| Запись паспорта и залогов | src/modules/operator-mobile/application/commands/production.ts:277-389 | внутри команды | ни одного юнит-теста | НЕ ПРОВЕРЕНО |
| Правила паспорта/отказа | src/modules/operator-mobile/domain/pile-passport.ts:36-166, 228-270 | — | НЕ ПРОВЕРЕНО (нет прямого spec) | НЕ ПРОВЕРЕНО |
| Схема БД | prisma/schema.prisma:2236-2349 | — | — | ПРОЙДЕНО (прочитано) |
| Список журнала (экран) | src/app/api/pile-passports/route.ts:28-71 | `piles.manage` | src/app/api/pile-passports/__tests__/route.test.ts | ПРОЙДЕНО |
| Решение мастера (API) | src/app/api/pile-passports/[id]/decide/route.ts:13-96 | `piles.manage` | .../[id]/decide/__tests__/route.test.ts | ПРОЙДЕНО |
| Запись решения | src/modules/reports/application/queries/pile-passport.service.ts:50-76 | — | pile-passport.service.test.ts:464-477 | ПРОЙДЕНО |
| Повторное решение (before-снимок) | src/app/api/pile-passports/[id]/decide/route.ts:43-56, 76-91 | `piles.manage` | decide/__tests__/route.test.ts:65-109 | ПРОЙДЕНО |
| След решения (лента) | src/services/audit/audit-service.ts:459-480 | — | src/services/audit/__tests__/audit-service.test.ts:487-525 | ПРОЙДЕНО |
| Выгрузка .xlsx (API) | src/app/api/pile-passports/export/route.ts:28-96 | `piles.manage` + лимит 6/мин | src/app/api/pile-passports/export/__tests__/route.test.ts | ПРОЙДЕНО |
| Сборка листов .xlsx | src/modules/reports/application/queries/pile-journal-export.ts:59-197 | — | pile-passport.service.test.ts:298-462 | ПРОЙДЕНО |
| Кнопки решения (экран) | src/components/piling/pile-journal/index.tsx:194-213; pile-detail.tsx:127-145 | клиентски `can(piles.manage)` — reports-module.tsx:36 | src/components/piling/pile-journal/__tests__/pile-journal.test.tsx:121 | ПРОЙДЕНО |
| Выгрузка из UI | src/components/piling/pile-journal/index.tsx:215-251 | то же | pile-journal.test.tsx:157-205 | ПРОЙДЕНО |

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемое исправление | статус |
|---|---|---|---|---|---|---|
| 1 | важно | src/modules/operator-mobile/application/commands/production.ts:344-385; prisma/schema.prisma:2299 | `recordedByForeman` не присваивается нигде: `create` его не задаёт, default `false`. `rg 'recordedByForeman'` находит только чтение (`pile-journal-list.ts:151`), тип (`pile-journal-types.ts:79`) и фикстуру | Бейдж «Записал мастер» (src/components/piling/pile-journal/pile-detail.tsx:40-44) не покажется никогда; разница «паспорт с места» против «со слов мастера», объявленная в схеме (schema.prisma:2296-2299), в данных отсутствует | Либо заполнять поле на пути создания (нужна роль, см. №2), либо убрать поле, бейдж и колонку из типов | ПРОЙДЕНО (grep) |
| 2 | важно | src/app/api/operator/mobile/command/route.ts:192 | Создать паспорт может только `user.role === 'OPERATOR'`; иначе 403 «Команды смены подаёт машинист». Форма паспорта живёт в operator-mobile (замороженная зона) | Сценарий из схемы и матрицы прав «Мастер заводит паспорт за машиниста» недостижим: у мастера нет ни маршрута, ни формы. Сваи, забитые в смену, за которую мастер не успел, вносятся только задним числом от лица машиниста | Разрешить `FOREMAN`/`ADMIN` подавать `log-production` (с записью `recordedByForeman=true`), либо явно задокументировать, что паспорт заводит только машинист | ПРОЙДЕНО (код) |
| 3 | важно | src/modules/operator-mobile/application/commands/__tests__/production.test.ts | В файле нет ни одного кейса `PILE_PASSPORT` (rg: 0). Ветка production.ts:277-389 и `validatePassport` не покрыты юнит-тестом | Ошибка в записи залогов/паспорта (граница глубины, парная проверка refusal, пикет чужого объекта) не будет поймана до e2e; e2e проверяет отображение журнала, а не запись | Добавить юнит-тест `logProduction` для кейса `PILE_PASSPORT` (валидный, неполный паспорт, залог с мусором, чужой пикет) | ПРОЙДЕНО (grep) |
| 4 | важно | src/app/api/reports/delete/route.ts:109; prisma/schema.prisma:2198 (PileWork.report onDelete: Cascade), 2303 (PilePassport.pileWork onDelete: Cascade) | `tx.report.delete` удаляет отчёт; каскадом удаляются его `PileWork`, а по ним — `PilePassport` вместе с решением и залогами. Снимок `DeletedReportSnapshot` (route.ts:24-39) содержит только итоги, не паспорта/решения | Право `reports.manage_all` есть у ADMIN и DISPATCHER (authorization-service.ts:67). Удаление отчёта молча уничтожает исполнительный документ по сваям (журнал забивки) и уже принятое решение; в ленте остаётся `pile.passport.decided` со ссылкой на несуществующий target | Либо запретить удаление отчёта с паспортами, либо расширить снимок удаления паспортами и решениями, либо сделать удаление паспорта невозможным (Restrict) | ПРОЙДЕНО (код) |
| 5 | важно | src/modules/operator-mobile/application/commands/production-corrections.ts:85-89, 93-131 | `correctProduction` принимает только `PILES`/`DRILLING`/`DOWNTIME`; при сданном отчёте отказ 409 гласит «Исправление вносит мастер в журнале забивки». Но журнал (pile-journal/index.tsx) умеет только решение, правки нет | Машинист по подсказке идёт в журнал и не находит там исправления; ошибочный замер паспорта правят только перезаписью на телефоне или не правят вовсе | Либо реализовать правку паспорта в журнале, либо заменить текст отказа на существующий путь | ПРОЙДЕНО (код) |
| 6 | мелочь | src/modules/reports/application/queries/pile-journal-types.ts:33-35; src/components/piling/pile-journal/index.tsx:28-31 | Комментарии утверждают «Диспетчер про сваи не решает», а матрица даёт `DISPATCHER` право `piles.manage` (src/services/auth/authorization-service.ts:71) и маршрут проверяет только его | Комментарий вводит читателя в заблуждение о правах; диспетчер фактически может принимать сваи (что, судя по комментарию в authorization-service.ts:68-70, сделано намеренно) | Привести комментарии журнала в соответствие с матрицей | ПРОЙДЕНО (код) |
| 7 | мелочь | src/components/piling/pile-journal/index.tsx:236; src/lib/timezone.ts:21 | Имя файла на клиенте — `getTodayInTimezone()` без аргумента, дефолт `'Europe/Moscow'`; сервер датирует по поясу тенанта (export/route.ts:86-91) | У тенанта вне Москвы клиент переименовывает файл в «вчерашний/завтрашний» день относительно титула, где «Журнал выгружен» по поясу тенанта (F-R37-1) | Передавать пояс тенанта или не переопределять имя на клиенте | ГИПОТЕЗА (кода клиента не исполнял) |
| 8 | мелочь | src/app/api/pile-passports/export/route.ts:91 против src/components/piling/pile-journal/index.tsx:236 | Сервер предлагает `pile-driving-journal-<день>.xlsx`, клиент перекрывает на `zhurnal-zabivki-svay-<день>.xlsx` | Два разных имени для одного документа; при разборе выгрузок источник имени непредсказуем | Оставить один источник имени | ПРОЙДЕНО (код) |
| 9 | мелочь | src/app/api/pile-passports/[id]/decide/route.ts:14 + service:65 | Схема решения допускает только `ACCEPTED`/`NEEDS_REDRIVE`. Возврат в `PENDING` невозможен | Ошибочно нажатое решение нельзя «снять» — только заменить другим. Для аудита замена сохраняется, но состояния «не разобрана» больше не вернуть | Осознанное ограничение — зафиксировать в комментарии либо добавить сброс | ПРОЙДЕНО (код) |
| 10 | мелочь | src/modules/reports/application/queries/pile-journal-export.ts:109-119, 164-167 | В выгрузке нет графы о том, кем записан паспорт (машинист/мастер). Связано с №1 | Даже если бы `recordedByForeman` заполнялся, в подшитом журнале этот признак не печатается — доказательство «со слов» теряется в документе | Добавить графу либо признать признак необязательным | ПРОЙДЕНО (код) |
| 11 | мелочь | src/modules/reports/application/queries/pile-journal-totals.ts:71 | Фильтр `siteId` уходит в raw-SQL как есть (`r."siteId" = siteId`), без проверки, что объект принадлежит тенанту — защищает только `pw."tenantId" = tenantId` (строка 70) | Утечки нет (организация ограничена строго), но чужой/несуществующий siteId молча даёт пустую выборку вместо 400 — тихая ошибка фильтра | Валидировать siteId на принадлежность тенанту в маршруте | ПРОЙДЕНО (код) |
| 12 | мелочь | src/modules/reports/application/queries/pile-journal-list.ts:36-42, 67 | Строки журнала включают сваи из отчётов-черновиков (`isDraft`), и по ним разрешено решение (кнопки в pile-detail показываются для любой строки с паспортом) | Решение по свае черновика — «неокончательное» (по комментарию типа), но ничем не отличается от окончательного; при удалении черновика решение исчезнет каскадом (№4) | Либо запретить решение по черновикам, либо явно пометить его как предварительное | ПРОЙДЕНО (код) |
| 13 | гипотеза | src/app/api/pile-passports/[id]/decide/route.ts:47, 58, 67 | Чтение «before», обновление (`service:65` `updateMany`) и запись аудита — три отдельные операции вне транзакции. `updateMany` атомарен, но снимок «before» читается заранее | При двух одновременных решениях по одной свае второй снимок «before» может описать состояние до первого решения, а не фактическое; при исключении в `recordAuditEvent` решение останется без следа | Завернуть решение+аудит в `db.$transaction` либо принять риск и отметить | ГИПОТЕЗА (гонку не воспроизводил) |
| 14 | гипотеза | src/modules/reports/application/queries/pile-journal-list.ts:60; pile-journal-totals.ts:23-25 | Экранирование LIKE в `contains` (Prisma) опирается на дефолтный escape-символ Postgres; в raw-запросе стоит явный `ESCAPE '\'`, а в списке — нет | Тест ручного запроса проверяет только строку и итоги (`pile-passport.service.test.ts:484-496`), но не поведение реального `contains` в БД. Если Prisma формирует ILIKE без `ESCAPE`, поиск «C_1%» в списке и в титуле разойдётся | Проверить на живой БД (или явно задать escape) | НЕ ПРОВЕРЕНО (БД не запускал) |
| 15 | гипотеза | src/modules/reports/application/queries/pile-passport.service.ts:65 | `updateMany` не проверяет текущее состояние паспорта: решение можно наложить дважды и на любую сваю, включая уже принятую | Это заявлено как намеренное (service.ts:43-45). Гипотеза: нет защиты от повторного нажатия (двойной клик) — два одинаковых аудита с одинаковыми before/after | Проверить идемпотентность кнопок/дебаунс на экране | ГИПОТЕЗА |

## Не проверено

1. Живая БД и живой сервер: `contains`/`ILIKE` в реальном Postgres не исполнялся — вывод №14 только по тексту кода и по тесту, который проверяет строку запроса (src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts:481-503), а не результат выборки.
2. Приложение не запускалось, тесты/tsc/lint не запускались: задача read-only, изменения кода отсутствуют. Число «сколько тестов проходят» не приводится, потому что команд проверки я не выполнял.
3. Маршрут `/admin/reports?view=piles` и клиентские экраны не открывались в браузере — вывод о правах кнопок решения сделан по `reports-module.tsx:36` и `pile-detail.tsx:127-145`.
4. Гонка одновременных решений (№13, №15) не воспроизводилась: вывод — по структуре вызовов, без эксперимента.
5. Замороженные зоны (варианты экрана оператора `src/components/piling/operator-*/**`, `src/modules/operator-mobile/**` как продуктовый контур) читались только как источник факта создания паспорта; их качество/UX не оценивалось и не менялось.
6. Влияние удаления отчёта на уже выгруженный ранее .xlsx-файл (внешняя копия у подрядчика) не оценивалось — это вне кода.
7. Существующие отчёты в docs/audits/** и CODEX-REPORT* не читались (условие задачи); пересечения с ними не сверялись, поэтому возможно дублирование уже известных находок.
