# AU18-S2 — Просроченные документы и допуски: что блокирует работу

Коммит, на котором сделан аудит: `7c45635ebf8a143c3021e8583e28ade2399396b3`
(`git rev-parse HEAD`, ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`).

Режим: только чтение. Ни один существующий файл не изменён; создан только этот отчёт.

## Итог

- Всего находок: **13** — критично **2**, важно **7**, мелочь **4**.
- **Критично №1.** Мобильный пуск смены `acceptEquipment` переводит смену в `STARTED`
  без `getOperatorClearance` и без расчёта готовности — оператор с просроченным
  обязательным документом открывает смену беспрепятственно
  (`src/modules/operator-mobile/application/commands/equipment.ts:76-107`).
- **Критично №2.** Веб-форма отчёта (`/api/reports/upsert` → `upsertReport`) пишет
  сваи/бурение без `requireProductionPermit` — просроченный документ не мешает
  вводу выработки через форму (`src/modules/reports/application/commands/report-command.service.ts:229-284`).
- **Важно.** Машинные документы `EquipmentDocument.expiresAt` (паспорт, ОСАГО,
  техосмотр) не проверяются нигде в контуре готовности; `UserEquipmentPermit.validUntil`
  тоже не участвует в пуске (по замыслу, но следствие — просрочка молчит).
- **Важно.** Срок считается двумя разными формулами: `documentExpiry` округляет
  **вверх** (`ceil`), а `checkOperatorDocuments` — **вниз** (`floor`). Один и тот же
  документ может быть «просрочен» для мобильной блокировки выработки и «истекает/допущен»
  для серверной команды пуска.
- **Важно.** Срок хранится как абсолютный момент, а вводится датой `YYYY-MM-DD` →
  UTC-полночь. В Москве документ «до 09.10» фактически истекает в 03:00 МСК 09.10.

## Методика

Поиск вёл по репозиторию (`search_files`, ripgrep) и читал файлы целиком там, где это
нужно для вывода. Ключевые запросы:

- `expiryDate|expiresAt|validUntil|validTo` — где вообще хранятся сроки;
- `getOperatorClearance|evaluateOperatorClearance|checkOperatorDocuments|isIdentityValid`
  — кто и где считает допуск;
- `equipmentDocument|EquipmentDocument` — проверяется ли срок документов техники;
- `ЛЭП|электро` — как оформлен допуск к работам вблизи ЛЭП;
- `requireProductionPermit` — единственный ли путь записи выработки его вызывает;
- `users.documents.read_all|safety.permits.manage` — кто видит просрочку.

Прочитанные файлы (полный список выводов ниже): `src/lib/document-expiry.ts`,
`src/services/users/user-documents.ts`, `user-document-access.ts`, `user-document-types.ts`,
`operator-clearance.ts`, `src/modules/operator-mobile/domain/{operator-admission,
operator-credentials,production-permit,safety-checklist-period,work-warnings,shift-phases}.ts`,
`src/modules/operator-mobile/application/{mobile-shift-query,assistant-query}.ts`,
`src/modules/operator-mobile/application/commands/{equipment,admission,production,shared}.ts`,
`src/modules/readiness/{application/shifts/commands.ts, application/readiness-score.ts,
application/scheduler.ts, domain/readiness-rules.ts, domain/readiness-score.ts,
domain/evaluation/*}`, `src/modules/equipment/application/commands/equipment-document.ts`,
`src/modules/safety/{application/*,domain/briefing-requirements.ts,instructions.ts}`,
`prisma/schema.prisma`, `scripts/seed-user-document-types.ts`,
`src/services/dictionaries/{system-templates.ts,tenant-dictionary-initializer.ts}`,
`src/app/api/{user-documents/control,users/[id]/documents,reports/upsert,operator/mobile/command}/route.ts`.

Команды (числа только оттуда, сами команды):

```bash
git rev-parse HEAD            # 7c45635ebf8a143c3021e8583e28ade2399396b3
git status --short            # (чисто до создания отчёта)
npx tsc --noEmit              # не запускался: правок кода нет, см. «Не проверено»
```

Замечание о «замороженных» зонах. Мобильный контур оператора
(`src/modules/operator-mobile/**`) в AGENTS.md отнесён к замороженным — правок там не
делалось. Читать его пришлось: это и есть вторая «дверь» допуска к смене, без которой
ответ на вопрос «где проверяются документы при пуске» был бы неполным.

## Как система обращается с документами и допусками

### Где хранится срок

| Сущность (что это) | Модель / поле | Файл:строка |
|---|---|---|
| Документ работника (удостоверение, медосмотр, ОТ, аттестация, ЛЭП) | `UserDocument.expiresAt` (`null` = бессрочный) | `prisma/schema.prisma:200` |
| Вид документа: обязателен ли, окно предупреждения | `UserDocumentType.requiredForOperator`, `.leadTimeDays`, `.requiresExpiry` | `prisma/schema.prisma:169-179` |
| Допуск к технике (человек × вид техники × вид работ) | `UserEquipmentPermit.validUntil` | `prisma/schema.prisma:415` |
| Документ установки (паспорт, ОСАГО, техосмотр, сертификат) | `EquipmentDocument.expiresAt` | `prisma/schema.prisma:550` |
| Наряд-допуск (опасные работы в смену) | `WorkPermit.validFrom/validTo`, `state=EXPIRED` | `prisma/schema.prisma:1485-1486,1495` |
| Проверка знаний / инструктаж (журнал ОТ) | `BriefingRecord.validUntil` | `prisma/schema.prisma:316` |
| Плановое ТО установки | `Equipment.nextMaintenanceAtHours`, `.nextMaintenanceDate` | `prisma/schema.prisma:491-492` |

Каталог видов документов задаётся справочником (не enum): `seed-user-document-types.ts`
(7 видов, включая «Допуск к работам вблизи ЛЭП» и «Электробезопасность») и
`system-templates.ts:36-40` (4 вида). Оба заводят виды с `requiredForOperator = false` —
по умолчанию **ни один документ не блокирует**.

### Где проверяется при допуске к смене и что происходит при просрочке

| Документ | Срок хранится | Где проверяется | Результат при просрочке | файл:строка |
|---|---|---|---|---|
| Обязательный документ работника (медосмотр, удостоверение, ОТ, аттестация) | `UserDocument.expiresAt` | **Серверная команда пуска** `startShiftCommand` → `getOperatorClearance` | Блокирует: `422 OPERATOR_NOT_CLEARED`, смена не стартует | `src/modules/readiness/application/shifts/commands.ts:179-191`; `src/services/users/user-documents.ts:158-178` |
| То же | `UserDocument.expiresAt` | **Мобильный пуск** `acceptEquipment` (экран оператора) | **Не блокирует** — проверки нет вовсе | `src/modules/operator-mobile/application/commands/equipment.ts:22-108` |
| То же | `UserDocument.expiresAt` | **Запись выработки в мобильном** `logProduction` → `requireProductionPermit` | Блокирует запись свай/бурения: `409 «Работа запрещена»`; простой, дефект, происшествие проходят всегда | `src/modules/operator-mobile/application/commands/production.ts:245-254`; `shared.ts:247-306` |
| То же | `UserDocument.expiresAt` | **Веб-форма отчёта** `upsertReport` | **Не блокирует** — `requireProductionPermit` не вызывается | `src/app/api/reports/upsert/route.ts:69-88`; `report-command.service.ts:229-284` |
| Проверка знаний по ОТ | `UserDocument` типа «Проверка знаний…» (`expiresAt`) + `BriefingRecord.validUntil` | Только фаза мобильного экрана (`knowledgeValid`); в `getOperatorClearance` и в `requireProductionPermit` не входит | Фаза «Допуск» не закрывается на экране; серверный пуск и запись выработки **не блокируются** | `operator-mobile/domain/operator-credentials.ts:73-75`; `shift-phases.ts:151`; фильтр `shared.ts:287-289` |
| Ознакомление с инструкцией | `UserDocument` типа «Ознакомление…» (`number` = версия) | Фаза мобильного экрана (`briefingUpToDate`) | То же: экран держит, сервер — нет | `operator-credentials.ts:65-70`; `shift-phases.ts:151` |
| Допуск к технике (матрица) | `UserEquipmentPermit.validUntil` | Нигде в пуске (помечено как решение владельца) | **Не блокирует** — только показывается «просрочен» | `src/modules/safety/application/equipment-permits.ts:10-14,82` |
| Документ установки (паспорт, ОСАГО, техосмотр) | `EquipmentDocument.expiresAt` | Нигде | **Не проверяется ни в одном контуре** | `src/modules/equipment/application/commands/equipment-document.ts:15-53` (только CRUD); в `readiness/**` ссылок нет |
| Наряд-допуск (в т.ч. работы вблизи ЛЭП) | `WorkPermit.validTo` | Контур готовности + суточный планировщик (перевод в `EXPIRED`) | По умолчанию **не блокирует** и не предупреждает: правило `PERMIT_EXPIRED` выключено, вес критерия `PERMIT` = 0 | `src/modules/readiness/domain/readiness-rules.ts:168,188`; `applications/readiness/application/readiness-score.ts:67-74,187-188` |
| Плановое ТО (по дате/наработке) | `Equipment.nextMaintenance*` | Расчёт готовности | Предупреждение (`WARN_ONLY`), балл снижается, но не блокирует | `readiness-rules.ts:192`; `readiness-score.ts:147-163` |
| Осмотр за сегодня | `Inspection.inspectionDate` / `OperatorChecklistExecution` | Расчёт готовности | `RETURN_TO_OPERATOR` (не запрет) | `readiness-rules.ts:200` |

### Как считается срок (граница дня, часовой пояс)

Срок хранится как абсолютный момент (`Timestamptz`), дневного выравнивания нет.
`documentExpiry` (`src/lib/document-expiry.ts:26-41`) считает
`daysLeft = Math.ceil((expiresAt − now) / 86400000)` — округление **вверх**. Отсюда:
документ, истёкший час назад, даёт `daysLeft = 0` и статус `expiring`, а не `expired`;
`expired` наступает только примерно через сутки после момента истечения.

Параллельно `checkOperatorDocuments` (`operator-admission.ts:47-49,94-99`) считает
`daysLeft = Math.floor((expiresAt − now) / 86400000)` — округление **вниз**, и документ
становится `EXPIRED` сразу после момента истечения. Это две разные формулы для одного и
того же вопроса (см. находку 3).

Часовой пояс в расчёте срока не участвует: сравнение идёт по моментам. При этом дата
вводится как `YYYY-MM-DD` (`src/components/piling/admin-users/user-documents.tsx:314`,
отправка `:182`), а сервер разбирает её через `z.coerce.date()` (`route.ts:16-17`), то
есть как полночь UTC. Для Москвы это 03:00 МСК — сдвиг суток (находка 8).

### Кто видит уведомление

Автоматических уведомлений (пуш, Telegram, e-mail) о сроках документов не найдено:
выборок по документам в `src/services/telegram/**` нет (поиск по `document|expir|допуск|медосмотр`
— 0 совпадений). Просрочку видно только на экранах:

- диспетчер / инженер ОТ / админ: `GET /api/user-documents/control`
  (`listDocumentsNeedingAttention`) — `src/services/users/user-documents.ts:114-145`;
- то же: сводка `GET /api/safety/clearance` (`querySafetyClearanceOverview`) —
  `src/modules/safety/application/clearance-overview-query.ts:133-323`;
- сам работник: «Мой допуск» `GET /api/safety/my-clearance` (`querySelfSafetyView`) —
  `src/modules/safety/application/self-clearance-query.ts:53-68`.

Право видеть чужие документы — `users.documents.read_all` (`ADMIN`, `DISPATCHER`,
`SAFETY_ENGINEER`) — `src/services/auth/authorization-service.ts:90`.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/operator-mobile/application/commands/equipment.ts:76-107`; маршрут `src/app/api/operator/mobile/command/route.ts:192-194,218-221` | `acceptEquipment` = фактический пуск смены, но не вызывает ни `getOperatorClearance`, ни `evaluateAuthoritativeShiftStart`; проверяется только закрепление бригады (`requireCrew`) | Оператор с просроченным удостоверением/медосмотром открывает смену на телефоне без запрета. Все проверки «контура А» (`shifts/commands.ts:179-200`), включая `ShiftStartWaiver`, на этом пути недостижимы. Запись выработки позже упрётся в 409 — но смена и осмотр уже начаты | В `acceptEquipment` перед переводом в `STARTED` вызывать `getOperatorClearance` (как в `startShiftCommand`) и возвращать 422 со списком `blockers` |
| 2 | критично | `src/app/api/reports/upsert/route.ts:69-88`; `src/modules/reports/application/commands/report-command.service.ts:229-284` | Новый отчёт пишется без `requireProductionPermit` и без проверки состояния смены (проверка смены есть только для существующего отчёта, `:190-204`) | Сваи/бурение можно внести через веб-форму при просроченном обязательном документе и вообще без начатой смены; мобильный путь такое запрещает (`production.ts:245-254`) | Перед записью выработки в `upsertReport` вызывать ту же проверку допуска; либо закрыть форму для незапущенных смен |
| 3 | важно | `src/lib/document-expiry.ts:37-39` vs `src/modules/operator-mobile/domain/operator-admission.ts:47-49,94-99` | Один и тот же срок считается двумя формулами: `ceil` (статус для допуска/списков) и `floor` (вердикт мобильного экрана и `requireProductionPermit`) | При истечении, скажем, в 12:00, в 13:00: `getOperatorClearance` даёт «истекает» (не блокер) и серверная команда пуска пускает, а мобильный экран и запись выработки дают `EXPIRED` и блокируют. Два «единственных источника правды» расходятся на сутки | Свести к одному расчёту (общий помощник с явной политикой границы дня) |
| 4 | важно | `src/modules/equipment/application/commands/equipment-document.ts:15-53`; `prisma/schema.prisma:550` | `EquipmentDocument.expiresAt` (паспорт, ОСАГО/КАСКО, техосмотр, сертификат) хранится, но не читается ни в одном расчётном контуре (`grep equipmentDocument` в `src/modules/readiness/**` — нет) | Документ установки может истечь, а машина остаётся «готовой»: в пуске участвуют только осмотр, моточасы, ТО, наряд, приёмка | Добавить критерий/блокер «документ установки просрочен» либо хотя бы замечание в расчёт готовности |
| 5 | важно | `src/modules/safety/application/equipment-permits.ts:10-14,82`; `prisma/schema.prisma:415` | `UserEquipmentPermit.validUntil` не участвует в пуске — по документированному решению владельца; но тогда просроченный допуск к технике нигде не блокирует и не предупреждает в момент допуска | Машинист с истёкшим допуском «копёр × управление» формально остаётся допущенным к смене | Либо явно предупреждать на допуске при `validUntil < now`, либо зафиксировать это в рисках продукта |
| 6 | важно | `src/modules/operator-mobile/application/commands/shared.ts:287-289,260-263`; `src/modules/operator-mobile/domain/operator-credentials.ts:73-75` | Проверка знаний и инструктаж исключены из `requireProductionPermit` (фильтр служебных видов) и не входят в `getOperatorClearance` (нет `requiredForOperator`). Дополнительно: при отсутствии строки `PpeCheck` `missing=[]` → блока нет | Просроченная проверка знаний и непройденный инструктаж держат только фазу экрана; серверный пуск и запись выработки не блокируются. Прямой запрос к API обходит экранную проверку | Включить инструктаж/знания в серверный допуск (или явно зафиксировать, что это только UX-шаг) |
| 7 | важно | `src/modules/operator-mobile/application/commands/shared.ts:247-306`; `src/modules/operator-mobile/application/assistant-query.ts:112` | Допуск по документам ассистента (стропальщик) нигде не блокирует: `requireProductionPermit` считает только `operatorId`, экран помощника лишь показывает список | Помощник с просроченным «Ознакомление/Проверка знаний стропальщика» работает без препятствий | Если стропальщик — часть допуска к смене, проверять и его документы (или документировать, что нет) |
| 8 | важно | `src/app/api/users/[id]/documents/route.ts:16-17`; `src/components/piling/admin-users/user-documents.tsx:182,314`; `src/lib/document-expiry.ts:37` | Дата документа вводится как `YYYY-MM-DD`, сервер разбирает её как полночь UTC (`z.coerce.date`), а расчёт сравнивает абсолютные моменты без пояса тенанта | В Москве документ «до 09.10» истекает в 03:00 МСК 09.10: часть рабочего дня 09.10 он уже «просрочен» (в мобильном расчёте `floor`), либо наоборот сутки «льготы» (`ceil`). Суждение о допуске зависит от часа суток, а не от даты | Нормализовать дату к концу производственных суток в поясе тенанта (или хранить дату, а не момент) |
| 9 | важно | `src/modules/readiness/domain/readiness-rules.ts:168,182,188` | Наряд-допуск выведен из расчёта (вес `PERMIT` = 0) и оба правила наряда (`VALID_WORK_PERMIT_REQUIRED`, `PERMIT_EXPIRED`) выключены по умолчанию | Просроченный наряд не блокирует и не предупреждает. Для работ, которым наряд обязателен (в т.ч. вблизи ЛЭП), система не требует его наличия | Для видов работ повышенного риска (`WorkPermitRisk.ELEVATED`) включать правило обязательно — по типу работ, а не по тенанту в целом |
| 10 | мелочь | `src/lib/document-expiry.ts:33` | Невалидная дата (`new Date(...)` → `NaN`) трактуется как «бессрочный» | Опечатка в дате/мусор в поле молча делает документ бессрочным — контроль срока по нему не сработает | Возвращать отдельный статус «дата некорректна», а не `perpetual` |
| 11 | мелочь | `src/modules/operator-mobile/application/commands/admission.ts:48-76` | Автоматический `upsertOperatorDocument` (инструктаж/знания) пишет `issuedAt`/`expiresAt` без проверки `дата окончания ≥ дата выдачи` (проверка есть только у ручного пути, `user-documents.ts:270-277`) | Через мобильный путь в документ может лечь неверная пара дат | Вызывать общий валидатор дат и здесь |
| 12 | мелочь | `src/services/users/user-documents.ts:114-145` | `listDocumentsNeedingAttention` берёт в SQL все документы с `expiresAt ≤ now + maxLeadTime` и фильтрует остаток в JS; `take` нет | Выборка диспетчера растёт с каждым переоформлением за годы (сканы/строки всех работников) | Довести фильтр по сроку вида документа до SQL (уже подмечено в других отчётах; здесь — независимое подтверждение по коду) |
| 13 | мелочь | `src/modules/safety/application/clearance-overview-query.ts:164-166` | «Сегодня» в сводке допусков жёстко считается по `Europe/Moscow` (`toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })`), тогда как срок документов в том же ответе считается по абсолютным моментам без пояса | Сводка ТБ/допусков смешивает два представления суток: границы «за сегодня» — московские, сроки — всемирные. Для тенанта с другим поясом инструктажи «за сегодня» и просрочка документов читаются по разным календарям | Взять пояс тенанта из настроек, как это уже делает контур готовности (`tenantProductionDate`), и не хардкодить MSK |

### Отдельно: где просрочка не блокирует, хотя по логике допуска должна

1. **Мобильный пуск смены** — `acceptEquipment` (находка 1). Самая тяжёлая брешь:
   просроченный обязательный документ не мешает открыть смену.
2. **Веб-форма отчёта** — `upsertReport` (находка 2): выработка пишется без проверки допуска.
3. **Проверка знаний / инструктаж** — не входят ни в серверный пуск, ни в запись
   выработки (находка 6).
4. **Документы ассистента** — не проверяются нигде (находка 7).
5. **Документы установки** (паспорт, ОСАГО, техосмотр) — не проверяются нигде (находка 4).
6. **Допуск к технике** (матрица) — просрочка не блокирует (находка 5, помечено как
   осознанное решение).
7. **Наряд-допуск**, в т.ч. к работам вблизи ЛЭП, — по умолчанию не требуется и не
   предупреждает о просрочке (находка 9).

## Не проверено

- **Запуск кода и тестов не выполнялся.** Задача — только чтение; правок нет, поэтому
  `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` не гонялись.
  Все выводы — из чтения исходников, без исполнения.
- **Поведение в рантайме** (фактические ответы API, что видит пользователь) не
  воспроизводилось: среда/БД не поднимались.
- Экран контроля сроков `documents-screen.tsx` отдельно проверял по коду на ложное
  «просрочено 0» при сбое: он **корректен** — при незагруженном списке выводит «—»
  (`documents-screen.tsx:73,89-93`), ложной находки нет. Утверждение НЕ ПРОЙДЕНО
  запуском (экран не открывался).
- **Телеграм/почтовые уведомления** о сроках: искал по `src/services/telegram/**` и по
  репозиторию — совпадений нет, но полноту каналов уведомлений (вебхуки, алерты
  мониторинга) сквозным прогоном не проверял.
- **`getOperatorClearance` на пустом справочнике** возвращает `cleared: true` для всех
  (`user-documents.ts:170`) — код прочитан; подразумеваю, что на текущем тенанте
  `requiredForOperator` где-то включён, но фактическое состояние боевого справочника
  мне недоступно (БД не читал).
- Возможные дубли с уже существующими отчётами в `docs/audits/` не сверялись намеренно:
  этот аудит — независимый первый проход (существующие отчёты не читал).
