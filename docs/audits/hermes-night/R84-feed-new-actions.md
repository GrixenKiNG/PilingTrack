# R84 — путь новых действий ленты до экрана: `meter.reading.added`, `maintenance.record.deleted`, `inspection.completed`

Задача: проверить, что три действия, добавленные в словарь `AUDIT_DESCRIPTIONS`
(`src/services/audit/audit-service.ts:737`, `:860`, `:886`), корректно проходят весь
путь: запись → фильтры ленты по области/уровню → история аудита по объекту →
экран ленты в `/admin` → уведомления Telegram по уровню `warn` → метрики.

## Итог

- Найдено **10** находок: **критично — 0**, **важно — 4**, **мелочь — 6**.
- До экрана ленты (колокольчик `FeedbackCenter`) доходят **все три действия**:
  лента рисует `title`/`message` как есть из ответа сервера и **белого списка действий
  не имеет** (только чёрный — `auth.login.succeeded`), поэтому новые записи видны
  без правок в UI.
- В Telegram **не уйдёт ни одно** из трёх: маршрута «уровень события → Telegram»
  в коде нет вообще (лента пишется только в БД). Каждое удаление наряда ТО в Telegram
  не попадёт; при этом уровень `warn` кладёт запись в очередь «Ожидают подтверждения»
  у ADMIN/DISPATCHER — как и любое другое удаление.
- Главное: **фильтров ленты по области/уровню не существует** (API принимает только
  `limit`, UI фильтров не имеет), а **словарь истории по объекту не знает новых действий
  и всё равно их не покажет** — `targetId` у всех трёх равен id показания/наряда/осмотра,
  а не установки.
- Топ-5: (1) `audit-history-service.ts:14-46` — нет подписей действий;
  (2) `targetId` не указывает на установку (`…meter-readings/route.ts:118`,
  `…maintenance/[recordId]/route.ts:165`, `…inspections/[id]/complete/route.ts:69`);
  (3) отсутствие фильтра по области/уровню — окно ленты 25/30 строк
  (`use-feedback-feed.ts:83`, `feedback-center.tsx:162`) легко вытесняется частым
  `info`-событием «Показание моточасов внесено»;
  (4) `scope` рисуется сырым кодом (`equipment`, `inspections`) — `feedback-center.tsx:279`;
  (5) повтор завершения осмотра пишет второе событие (команда идемпотентна,
  событие — нет: `inspection-commands.ts:394-398` → `complete/route.ts:64`).

## Методика

Прочитаны файлы (только чтение, ничего не менял):

- писатели: `src/app/api/equipment/[id]/meter-readings/route.ts`,
  `src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts`,
  `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts`,
  `src/app/api/inspections/[id]/complete/route.ts`;
- словарь и запись: `src/services/audit/audit-service.ts` (весь файл);
- чтение по объекту: `src/services/audit/audit-history-service.ts`, `src/app/api/audit/route.ts`,
  `src/components/piling/ops-shell/use-entity-history.ts`, `…/permitted-entity-history.tsx`;
- лента: `src/services/feedback/feedback-event-service.ts`,
  `src/app/api/feedback/events/route.ts`, `src/components/piling/feedback-center.tsx`,
  `src/components/piling/use-feedback-feed.ts`, `src/app/(app)/layout.tsx`;
- уведомления: `src/core/notifications/durable-alert.ts`, `src/services/notifications/**`,
  `docs/audits/hermes-night/12-notifications-map.md` (проверка списка отправителей);
- метрики: `src/app/api/metrics/route.ts`, `src/core/observability/*`;
- история цепочки: `src/components/piling/to/readiness/settings/{audit-section,audit-labels}.tsx`;
- схема: `prisma/schema.prisma` (только чтение) — `FeedbackEvent` (`:2520-2546`).

Команды (git-bash, из корня worktree):
`rg -n "meter\.reading\.added|maintenance\.record\.deleted|inspection\.completed"`,
`rg -n "useEntityHistory\(|PermittedEntityHistory scope=|/api/audit"`,
`rg -n "recordFeedbackEvent\(|feedbackEvent|FeedbackEvent"`,
`rg -n "enqueueAlert|enqueueCriticalDefects|sendAlert"`,
`rg -n "SCOPE_LABELS|scopeLabel|levelFilter|'equipment': |'inspections': "`,
`node -e "…"` (извлечение ключей `AUDIT_DESCRIPTIONS` — 62 ключа).

## Матрица «действие × место показа»

| Место показа | Путь | `meter.reading.added` | `maintenance.record.deleted` | `inspection.completed` | Что нужно добавить |
|---|---|---|---|---|---|
| Лента-колокольчик (все экраны `(app)`, в т.ч. `/admin`) | `src/components/piling/feedback-center.tsx:67`, `src/app/(app)/layout.tsx:96,200,242`; `GET /api/feedback/events` → `feedback-event-service.ts:133-160` | **видно** (title `audit-service.ts:739`, message `:740-747`) | **видно** (`:862`, `:863-875`) | **видно** (`:892`, `:893-902`) | ничего |
| Фильтр по области (scope) | — | **нет такого места** | **нет** | **нет** | см. находку 4 |
| Фильтр по уровню | — (только счётчики `summary`, `feedback-event-service.ts:164-188`) | `info` — в счётчики не попадает | `warn` → `summary.warn`, `ackPending` (`:178,181-187`) | `info`/`warn` — по итогу (`audit-service.ts:887-891`) | см. находку 4 |
| Чёрный/белый список действий | `feedback-event-service.ts:103-110` | не скрыто | не скрыто | не скрыто | ничего (белого списка нет — см. находку 3) |
| История по объекту установки | `GET /api/audit` (`api/audit/route.ts:19-31`) → `getEntityHistory` (`audit-history-service.ts:90-159`) | **не видно** — панели нет; и `targetId` = id показания | **не видно** — панели нет; `targetId` = id наряда | **не видно** — панели нет; `targetId` = id осмотра | находки 1, 2 |
| История по объекту (существующие панели: users/sites/crews/dictionaries) | `user-detail.tsx:58`, `admin-sites/index.tsx:455`, `admin-crews.tsx:292`, `admin-dictionaries.tsx:184` | неприменимо | неприменимо | неприменимо | — |
| Экран «Аудит» техготовности (цепочка `AuditLog`) | `to/readiness/settings/audit-section.tsx`, `audit-labels.ts` | **не показывается** (другой журнал) | **не показывается** | **не показывается** | ничего (по замыслу: новые действия не в цепочке) |
| Telegram | `feedback-event-service.ts:112-131` (только БД); отправители — `core/notifications/**`, `services/notifications/**` | не уходит | не уходит | не уходит | ничего |
| Метрики `/api/metrics` | `src/app/api/metrics/route.ts:56-132` | не считается | не считается | не считается | находка 9 |

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что делать |
|---|---|---|---|---|---|
| 1 | важно | `src/services/audit/audit-history-service.ts:14-46` | Словарь `ACTION_LABELS` не содержит ни одного из трёх новых действий (и вообще ничего из `equipment.*`, `maintenance.*`, `meter.*`, `inspections.*`, `telegram.*`, `settings.updated`); `title: ACTION_LABELS[e.action] ?? e.action` (`:149,153`) | Как только у установки/осмотра появится панель истории (`getEntityHistory`), строки лягут машинным кодом: «meter.reading.added» вместо «Показание моточасов внесено». Сейчас панелей с `scope='equipment'/'inspections'` нет (поиск: `useEntityHistory('` даёт одну панель `users`, `PermittedEntityHistory scope=` — `crews`/`sites`, плюс `scope=dictionaries`), поэтому дефект пока латентен | Добавить в `ACTION_LABELS` подписи для новых действий (тексты взять те же, что `title` в `AUDIT_DESCRIPTIONS`, чтобы лента и история не расходились) |
| 2 | важно | `…/meter-readings/route.ts:118`, `…/maintenance/[recordId]/route.ts:165`, `…/inspections/[id]/complete/route.ts:69` | `targetId` = id показания / id наряда ТО / id осмотра, тогда как у событий карточки установки `targetId` = id установки (`api/equipment/route.ts:89`, `api/equipment/[id]/route.ts:160`) | Даже если добавить панель истории установки (`scope='equipment'`, `targetId=equipmentId`), ни одно из трёх новых событий в неё не попадёт: фильтр `where: {scope, targetId}` (`audit-history-service.ts:101-105`) их не найдёт. Владелец откроет установку и не увидит ни внесённых моточасов, ни удалённого наряда | Решить заранее: либо писать `targetId = equipmentId` (+ `inspectionId`/`recordId` в metadata), либо ввести фильтр по `metadata.equipmentId`; без этого панель по установке будет неполной |
| 3 | важно | `src/services/feedback/feedback-event-service.ts:103-110`; `use-feedback-feed.ts:83`; `feedback-center.tsx:158-163` | Белого списка действий нет — только чёрный (`auth.login.succeeded`); окно ленты жёсткое: `limit=25` от API и `slice(0,30)` в UI | `meter.reading.added` имеет уровень `info` (`audit-service.ts:738`) и пишется на каждое показание (в т.ч. на каждый осмотр, где сняты моточасы). На парке из 6 машин поток `info`-строк сравним с потоком входов, ради которого чёрный список и делали: рабочие записи (`warn`/`audit`) начнут уходить за окно 25. Это тот же риск, что уже зафиксирован в R75 (находка 15) | Либо чёрный список по образцу `FEED_HIDDEN_ACTIONS` для рутинного `meter.reading.added`, либо (предпочтительнее, как предлагал R75) фильтр по области в ленте |
| 4 | важно | `src/app/api/feedback/events/route.ts:64-71`; `src/components/piling/feedback-center.tsx` (весь файл — ни одного фильтра) | Фильтров ленты по области/уровню не существует: GET принимает только `limit`, UI показывает смешанный список; по области вообще нет словаря подписей | Задача предполагала проверку фильтров `scope 'equipment'/'inspections'` — проверять нечего. Практический эффект: ни диспетчер, ни администратор не могут отделить «техника» от «осмотры», а новые действия добавляют ещё две области в общий поток | Либо реализовать фильтр (scope+level) в API и в `FeedbackCenter`, либо зафиксировать в документации, что фильтра нет и он не планируется |
| 5 | мелочь | `src/components/piling/feedback-center.tsx:279` | Бейдж области рисует сырое значение: `{event.source === 'client' ? 'локально' : event.scope}` → «equipment», «inspections» | В русскоязычной карточке рядом с «Показание моточасов внесено» стоит английский код области; владельцу он ничего не говорит. Единого словаря подписей области в репозитории нет (поиск по `'equipment': |'inspections': |scopeLabel` — 0 совпадений) | Завести словарь подписей области (ХТО техники/осмотры) и брать подпись в бейдже |
| 6 | мелочь | `src/services/audit/audit-service.ts:860-861`; `feedback-event-service.ts:178,181-187`; `feedback-center.tsx:258-262` | `maintenance.record.deleted` — уровень `warn` → `priority: HIGH` (`audit-service.ts:960-965`) → попадает в `summary.warn` и `ackPending`, у ADMIN/DISPATCHER появляется кнопка «Подтвердить обработку» | Каждое удаление наряда ТО создаёт задачу подтверждения. Это согласовано с остальными удалениями (`equipment.deleted`, `equipment.fuel.deleted`, `meter.reading.deleted` — все `warn`), т.е. скорее «желательно», чем баг; но если удаление наряда — рутинная правка, очередь подтверждений будет расти | Решение владельца: оставить `warn` (как у прочих удалений) или понизить до `audit`, если подтверждать нечего |
| 7 | мелочь | `src/modules/inspections/application/commands/inspection-commands.ts:390-398`; `…/inspections/[id]/complete/route.ts:64-79` | Команда идемпотентна (повтор не меняет строку), а событие пишется безусловно после её успеха | Двойное нажатие/ретрай телефона даёт второе «Осмотр завершён» в ленте, а при найденных дефектах — второй `warn` и вторую задачу подтверждения | Писать событие только когда переход реально произошёл (например, вернуть из команды признак «уже завершён» и не логировать повтор) |
| 8 | мелочь | `src/modules/inspections/application/commands/inspection-commands.ts:416-423`; `…/meter-readings/route.ts:113-123` | Моточасы, снятые при осмотре, пишутся в журнал наработки внутри транзакции осмотра (`recordMeterReadingInTx`), но `meter.reading.added` при этом не пишется | В ленте «внёс показание» и «завершил осмотр» — не одно и то же: ручной ввод даёт обе строки, осмотр — только вторую. По паре «внёс/стёр» из `audit-service.ts:733-736` удаление такого показания (`meter.reading.deleted`) в ленте останется без парной строки | Либо писать `meter.reading.added` и из осмотра, либо явно задокументировать, что строка осмотра его заменяет |
| 9 | мелочь | `src/app/api/metrics/route.ts:56-132`; `src/services/feedback/feedback-event-service.ts:164-188` | Метрик по действиям аудита нет: `/api/metrics` отдаёт только cache/http/process/lag/backup; единственный «счётчик» — `summary` в ответе ленты, причём уровень `info` не считается нигде | `meter.reading.added` (info) и `inspection.completed` без замечаний (info) не видны ни в одном числителе; `maintenance.record.deleted` (warn) виден только в счётчике карточки-колокольчика. Наблюдать частоту новых действий на проде нечем | Если нужна наблюдаемость — добавить Prometheus-счётчик по `action`/`scope` (с ограниченной кардинальностью), иначе считать вопрос закрытым |
| 10 | мелочь | `src/services/feedback/feedback-event-service.ts:101-105,112-131`; `prisma/schema.prisma:2520-2546` | `getEntityHistory` фильтрует события только по `scope`+`targetId`; у `FeedbackEvent` нет колонки `tenantId`, поэтому история сущности не изолирована по организации (карты имён сужены по тенанту, а сами события — нет) | Уже зафиксировано в R65 (находка 3) и R72; повторяю здесь, потому что это прямо касается «истории аудита по объекту» для новых действий: при второй организации история установки покажет чужие события | Ввести `tenantId` в `FeedbackEvent` и добавить его в `where` (перед появлением tenant #2) |

## Список правок (что нужно добавить)

1. `src/services/audit/audit-history-service.ts:14-46` — добавить в `ACTION_LABELS`
   подписи для `meter.reading.added`, `maintenance.record.deleted`, `inspection.completed`
   (и заодно для остальных действий контура `equipment`, которых там нет, если
   планируется панель истории установки).
2. `src/components/piling/feedback-center.tsx:279` — подпись области из нового словаря
   вместо сырого `event.scope`.
3. `src/services/feedback/feedback-event-service.ts:103-110` — решить судьбу рутинного
   `meter.reading.added` в окне 25/30 (чёрный список или фильтр), см. находку 3.
4. `src/app/api/feedback/events/route.ts` + `feedback-center.tsx` — фильтр по области/уровню,
   если он нужен (находка 4).
5. `src/app/api/equipment/[id]/meter-readings/route.ts:118`,
   `…/maintenance/[recordId]/route.ts:165`, `…/inspections/[id]/complete/route.ts:69` —
   решить вопрос `targetId` для будущей истории по установке (находка 2).
6. `src/app/api/inspections/[id]/complete/route.ts:64` — не писать событие на повтор
   завершения (находка 7).
7. Владельцу: решить, оставлять ли `maintenance.record.deleted` уровнем `warn`
   (очередь «Ожидают подтверждения») — находка 6.

## Не проверено

- **Фактическое поведение в рантайме** (отрисовка карточки, объём потока `meter.reading.added`
  за сутки, реальное число строк в окне 25) не проверялось: задача read-only, браузер и БД
  не запускались. Оценка «поток сравним с входами» — из чтения кода, не из замеров.
- **Telegram по уровню `warn`** — вывод «уведомления не уходит» сделан по тексту кода
  (лента пишется только в БД, `recordFeedbackEvent` не вызывает отправителей) и по карте
  `12-notifications-map.md`; живой отправки не наблюдал и настройки бота не проверял.
  Отдельно: завершение осмотра с дефектами HIGH/CRITICAL вызывает Telegram **через
  команду осмотра** (`readiness/application/defects/commands.ts:139-141` →
  `enqueueCriticalDefects`), а не через уровень записи ленты — эти два канала не связаны.
- **Наличие дефектов в конкретном осмотре** для ветки `inspection.completed` → `warn`:
  логика уровня прочитана (`audit-service.ts:887-891`), но `defectCount` в роуте считается
  запросом `db.equipmentDefect.count({where:{tenantId, inspectionId: id}})` — что в этот
  счётчик может попасть чужой по времени дефект той же установки, не проверял (счёт идёт
  именно по `inspectionId`, так что — только дефекты этого осмотра; подтверждено чтением).
- **Влияние на готовность/аналитику**: у всех трёх команд есть пересчёт снимка
  (`inspection-commands.ts:477-488`, `meter-reading.ts:228-236`), но какие именно KPI
  меняются после `maintenance.record.deleted`, не проверял.
- **`GET /api/metrics` в проде** (какие серии реально скрейпятся, есть ли внешние дашборды)
  не проверял.
- **Права**: `/api/feedback/events` доступен любому аутентифицированному
  (`route.ts:57-75`), `/api/audit` требует `system.read` (`api/audit/route.ts:17`) —
  кто именно из ролей им обладает, не проверял (authorization-service вне скоупа).
