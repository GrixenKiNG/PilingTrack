# AU122-S2 — Кто узнаёт о критическом дефекте техники и когда

Версия кода: `git rev-parse HEAD` → `105a3819b61d09ae504f847e8757b085d38eb7d3`
(branch `hermes/q4-0926`, worktree `D:\PillingR\wt-night`). Только чтение, изменений
в коде нет. Существующие отчёты в `docs/audits/` не читались.

Статусы выводов: **ПРОЙДЕНО** — прочитан код и известно поведение;
**НЕ ПРОВЕРЕНО** — код есть, поведение вживую не запускалось;
**ГИПОТЕЗА** — вывод по коду без выполнения.

---

## Итог

1. **Телеграм-уведомление о критическом дефекте существует ровно для двух из
   трёх путей создания дефекта.** Дефекты из осмотра
   (`src/modules/inspections/application/commands/inspection-commands.ts:472`) не
   оповещают никого — там нет вызова `enqueueCriticalDefects`.
2. Найдено **3 критично, 9 важно, 6 мелочь** (18 находок).
3. **Адресат один на всех** — все включённые Telegram-чаты организации. Ни роли,
   ни конкретного человека, ни персонального уведомления внутри приложения у
   дефекта нет. «Внутри приложения» — только пассивный журнал аудита контура
   готовности; в общую ленту `/admin` (колокольчик) дефекты не попадают.
4. **Если получателя нет (Telegram не настроен/все каналы выключены) — тишина.**
   Отправка возвращает `false`, событие проходит 5 попыток с паузами и уходит в
   DLQ; алерт о DLQ идёт в тот же Telegram и тоже молчит.
5. Самая дорогая находка: **осмотр машины (главный источник дефектов) не
   уведомляет вообще** — критичный дефект, найденный при ЕО, виден только тому,
   кто откроет журнал.

---

## Методика

Что искал и как (повторяется командами из корня worktree):

- `grep -rn "enqueueCriticalDefects(" src --include=*.ts` — точки постановки
  уведомления. Найдено 3 записи: объявление (`src/core/notifications/durable-alert.ts:19`)
  и **два** вызова — `src/modules/operator-mobile/application/commands/checklist.ts:294`,
  `src/modules/readiness/application/defects/commands.ts:139`.
- `grep -rn "equipmentDefect.create(" src --include=*.ts` — все пути создания
  дефекта. Найдено **три** (без сгенерированного клиента):
  `src/modules/inspections/application/commands/inspection-commands.ts:472`,
  `src/modules/operator-mobile/application/commands/checklist.ts:214`,
  `src/modules/readiness/infrastructure/defects/defect-repository.ts:57`.
- `find src/app/api/readiness/defects -name "*.test.*" | wc -l` → `0` — тестов у
  маршрутов дефектов нет.
- Прослежена цепочка чтением: маршрут → команда → outbox → воркер →
  `deliverQueuedAlert` → `telegramNotifier` → DLQ.
- `rg` по `defect.` в `src/components/piling/to/readiness/settings/audit-labels.ts`
  — где дефект вообще показывается внутри приложения.

Файлы цепочки (прочитаны целиком):
`src/core/notifications/durable-alert.ts`,
`src/services/notifications/durable-alert-delivery.ts`,
`src/core/notifications/telegram.ts`,
`src/services/reports/domain-events.ts`, `src/services/reports/outbox-publisher.ts`,
`src/core/outbox/dead-letter-queue.ts`, `src/workers/embedded-workers.ts`,
`src/modules/readiness/application/defects/commands.ts`,
`src/modules/operator-mobile/application/commands/checklist.ts`,
`src/app/api/operator/mobile/command/route.ts`,
`src/app/api/readiness/defects/route.ts`, `src/app/api/readiness/audit/route.ts`,
`src/services/audit/audit-service.ts`, `src/services/feedback/feedback-event-service.ts`.

---

## Цепочка А — дефект через API (`POST /api/readiness/defects`)

| шаг | файл:строка | получатель | гарантия доставки | тест |
|---|---|---|---|---|
| 1. Приём запроса, права `readiness.defect.report` | `src/app/api/readiness/defects/route.ts:67` | — | идемпотентность обязательна (`idempotency-key`) | нет |
| 2. Команда создания | `src/modules/readiness/application/defects/commands.ts:116` | — | сериализуемая транзакция | нет |
| 3. Запись дефекта | `src/modules/readiness/infrastructure/defects/defect-repository.ts:57` | — | в транзакции | нет |
| 4. Постановка алерта | `src/modules/readiness/application/defects/commands.ts:139` | — | **в той же транзакции** (атомарно) | нет |
| 5. Фильтр HIGH/CRITICAL + сборка текста | `src/core/notifications/durable-alert.ts:23` | — | LOW/NORMAL → выхода нет вообще | косвенно: `src/services/notifications/__tests__/durable-alert-delivery.test.ts:50` |
| 6. Запись `OutboxEvent` (`projected: true`) | `src/core/notifications/durable-alert.ts:13` | — | гарантия «не потеряется при падении процесса» | тот же тест |
| 7. Подхват воркером (`published: false`) | `src/services/reports/outbox-publisher.ts:94` | — | опрос: embedded — 2 с (`src/workers/embedded-workers.ts:142`), отдельный воркер — 10 с (`src/workers/unified-worker/config.ts:7`) | нет |
| 8. Разбор типа события | `src/services/reports/domain-events.ts:98` | — | тенант ставится из колонки outbox (`outbox-publisher.ts:147`) | нет |
| 9. Выключатель `criticalDefect` | `src/services/notifications/durable-alert-delivery.ts:39` | — | умолчание — включено (`src/modules/settings/domain/settings.ts:74`) | да: `durable-alert-delivery.test.ts:14` |
| 10. Отправка | `src/services/notifications/durable-alert-delivery.ts:51` | **все включённые Telegram-чаты тенанта** (`src/core/notifications/telegram.ts:75`, `:337`) | Telegram ключей идемпотентности не знает | да (моки) |
| 11. Отметка `published` | `src/services/notifications/durable-alert-delivery.ts:55` | — | только после успешной отправки | да |
| 12. Повтор/отказ | `src/services/reports/outbox-publisher.ts:173` → `src/core/outbox/dead-letter-queue.ts:46` | при сбое — снова Telegram (`dead-letter-queue.ts:101`) | 5 попыток, backoff ~1/2/4/8/16 с | да: `src/workers/__tests__/outbox-worker.test.ts:388` |

## Цепочка Б — дефект из чек-листа машиниста (мобильное место)

| шаг | файл:строка | получатель | гарантия | тест |
|---|---|---|---|---|
| 1. Маршрут | `src/app/api/operator/mobile/command/route.ts:222` | — | одна точка записи | нет |
| 2. Создание дефектов (с дедупом по `sourceKey`) | `src/modules/operator-mobile/application/commands/checklist.ts:214` | — | advisory-замок на ключ | да: `.../commands/__tests__/checklist.test.ts:139` |
| 3. Постановка алерта | `src/modules/operator-mobile/application/commands/checklist.ts:294` | — | в той же транзакции | да (мок) |
| 4. Дальше — как в цепочке А (шаги 6–12) | — | все чаты тенанта | как выше | — |

## Цепочка В — дефект из завершённого осмотра

| шаг | файл:строка | получатель | гарантия | тест |
|---|---|---|---|---|
| 1. Завершение осмотра | `src/app/api/inspections/[id]/complete/route.ts:75` | — | пишет только `recordAuditEvent` в ленту | нет |
| 2. Создание дефектов | `src/modules/inspections/application/commands/inspection-commands.ts:472` | — | только `ReadinessSnapshotRequested` в outbox | нет |
| 3. **Уведомление** | — | **никто** | **вызова нет** | — |

---

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как чинить |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/inspections/application/commands/inspection-commands.ts:472` | Дефекты, заведённые завершением осмотра, не ставят ни одного уведомления: `enqueueCriticalDefects` в модуле осмотров не встречается ни разу (`grep -rn "enqueue" src/modules/inspections` → 0 совпадений). | Машинист/мастер сдаёт ЕО/ТО, отмечает «износ каната — критично», дефект создан, готовность пересчитана, а в чат не ушло ничего. О находке узнают, только открыв журнал. | В `inspection-commands.ts` после создания дефектов вызвать `enqueueCriticalDefects(tx, …)` с фильтром по severity, как в `commands.ts:139`. |
| 2 | критично | `src/services/notifications/durable-alert-delivery.ts:33` | Получатель не адресован: ни в алерте, ни в подписке нет роли/человека — `telegramNotifier.sendAlert` рассылает по всем включённым чатам тенанта (`src/core/notifications/telegram.ts:75`). Внутри приложения персонального уведомления нет вовсе. | Механик (кто чинит) и диспетчер (кто разбирает) не отличаются от остальных подписчиков. Если чат один и его читает не тот, критический дефект ждёт. | Либо явный адресный чат для `criticalDefect` (поле у `TelegramConfig`), либо in-app уведомление с ролью-адресатом. |
| 3 | критично | `src/core/notifications/telegram.ts:339` + `src/services/notifications/durable-alert-delivery.ts:58` + `src/core/outbox/dead-letter-queue.ts:94` | Нет получателя → нет уведомления и нет следа для человека. При `configs.length === 0` `sendAlert` возвращает `false`, `deliverQueuedAlert` бросает «retained for retry», событие уходит в DLQ, а алерт о DLQ шлётся **тем же** Telegram (`dead-letter-queue.ts:101`) и тоже молчит. | Организация без настроенного бота: критичный дефект не уведомляет никого. Единственный способ узнать — открыть панель DLQ в админке. | Фолбэк на in-app (FeedbackEvent) при отсутствии Telegram-каналов; в DLQ-записи хранить причину «канал не настроен», а не только текст ошибки. |
| 4 | важно | `src/core/notifications/durable-alert.ts:28` | В тексте алерта — сырой `equipmentId` (cuid): `'Опасный дефект установки ' + input.equipmentId`. Название установки не подгружается, объект (`siteId`) не передаётся. | Диспетчер читает в чате «Опасный дефект установки clx9f2…» — непонятно, какая машина и на каком объекте. Сравни: алерт о простое подтягивает и объект, и номер отчёта (`src/services/reports/event-handlers.ts:374`). | Читать `Equipment.name`/`Site.name` и передавать в `AlertPayload` (`siteName`, как в `telegram.ts:166`). |
| 5 | важно | `src/core/notifications/durable-alert.ts:25` | Алерт о дефекте не передаёт `timeZone`, поэтому время в сообщении всегда московское (`src/core/notifications/telegram.ts:180`). | Организация в другом часовом поясе получает неверное время события. У алерта о простое это уже исправлено (`event-handlers.ts:395`). | Передавать `getSettings(tenantId).timezone`, как в обработчике простоя. |
| 6 | важно | `src/modules/operator-mobile/application/commands/checklist.ts:295` | `reportedBy: input.operatorId` — в сообщение уходит cuid оператора, а не имя. | В чате: «Зафиксировал: ckp3f…». В цепочке А передаётся имя (`src/modules/readiness/application/defects/commands.ts:140`), здесь — нет. | Подтянуть `User.name` по `operatorId` перед `enqueueCriticalDefects`. |
| 7 | важно | `src/modules/operator-mobile/application/commands/checklist.ts:298` + `src/app/api/operator/mobile/command/route.ts:224` | Комментарий обещает: `createdDefects` отдаётся «маршруту, чтобы оповестить после фиксации и вне транзакции». Маршрут возвращает результат как есть и ничего не оповещает; значение не читает ни один файл (`grep -rn "createdDefects" src` → 2 совпадения, оба в самом `checklist.ts`). | Либо мёртвый контракт, либо недоделанный второй сигнал. Вводит в заблуждение при сопровождении: кажется, что оповещение уже есть. | Либо реализовать оповещение в маршруте, либо убрать поле и ложный комментарий. |
| 8 | важно | `src/modules/readiness/application/defects/commands.ts:176` (triage) и `:198` (resolve) | Разбор и закрытие дефекта не уведомляют никого. Разбор может **повысить** серьёзность до `CRITICAL` (`triageDefectSchema` позволяет `severity`). | Диспетчер разбирает дефект и ставит «Критичный» — чат молчит. Оператор, сообщивший о дефекте, не узнаёт, что его взяли в работу или отклонили. | Уведомлять при повышении severity до HIGH/CRITICAL и при закрытии/отклонении (адресно — автору). |
| 9 | важно | `src/modules/readiness/infrastructure/audit/record-audit.ts:24` | Дефекты пишутся только в цепочку `AuditLog` контура готовности. В общую ленту `/admin` (`src/services/feedback/feedback-event-service.ts:112`) они не попадают: `recordFeedbackEvent` для дефектов не вызывается нигде. | Владелец смотрит `/admin` и не видит ни одного дефекта. Внутри приложения дефект виден только в журнале аудита модуля ТО (`src/app/api/readiness/audit/route.ts:18`, подписи — `src/components/piling/to/readiness/settings/audit-labels.ts:50-53`), и только с правом `readiness.audit.read` (из ролей по умолчанию: ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER — `src/modules/readiness/domain/capability-defaults.ts:73,124,134`). | Дублировать ключевые дефекты в `FeedbackEvent` с `audience: 'OPERATIONS'`. |
| 10 | важно | `src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:60` + `src/modules/readiness/infrastructure/defects/defect-repository.ts:57` | Форма помощника генерирует **новый** `crypto.randomUUID()` на каждое нажатие; на пути `/api/readiness/defects` нет дедупликации по `sourceKey` (в отличие от чек-листа, `checklist.ts:204`). | Обрыв связи/двойное нажатие → второй дефект и второй алерт в чат. Помощник стоит у машины и, скорее всего, нажмёт ещё раз. | Дедуп по `(equipmentId, title)`/`sourceKey` на уровне репозитория, либо ключ идемпотентности, стабильный до успешного ответа. |
| 11 | важно | `src/services/notifications/durable-alert-delivery.ts:40` | Telegram не поддерживает ключи идемпотентности; код сам это признаёт. При неоднозначном сетевом сбое сообщение может уйти дважды. | Дубль в чате о критическом дефекте создаёт ложное впечатление второй неисправности. | Дедуп на стороне получателя по `event.id` (он уже добавляется в текст, строка `:51`) — задокументировать как приём для оператора. |
| 12 | важно | `src/app/api/readiness/defects/**` (тестов нет: `find … -name "*.test.*"` даёт 0 файлов), `src/modules/readiness/application/defects/commands.ts` (тест отсутствует) | Ни маршруты дефектов, ни команда создания дефекта тестами не покрыты. `enqueueCriticalDefects` проверяется только в изоляции (`src/services/notifications/__tests__/durable-alert-delivery.test.ts:50`). | Разрыв «дефект → алерт» не поймает ни один тест: например, находка №1 (осмотр) не проявится. | Один тест на `createDefectCommand`: при CRITICAL в транзакции появляется `OutboxEvent` типа `NotificationDeliveryRequested`; при NORMAL — нет. |
| 13 | важно | `e2e/fixtures/role-audit.mjs:11`, `e2e/fixtures/disposable-seed.mjs:6` | E2E-фикстуры создают организацию с `notifications: {criticalDefect: false}`. | Прогон e2e в принципе не может подтвердить доставку уведомления о дефекте: выключатель выключен на уровне фикстуры. | Отдельный сценарий с включённым `criticalDefect` и подменённым Telegram API (`TELEGRAM_API_BASE`). |
| 14 | мелочь | `src/core/notifications/durable-alert.ts:13` | `OutboxEvent` алерта создаётся без `dedupeKey` (у `ReadinessSnapshotRequested` он есть — `commands.ts:85`). | Повторная постановка того же события в outbox (например, из DLQ-ретрая) даст второе сообщение. | Добавить детерминированный `dedupeKey` вида `alert:criticalDefect:<tenantId>:<defectId>`. |
| 15 | мелочь | `src/workers/unified-worker/config.ts:7` | Задержка доставки: 2 с у встроенного воркера, 10 с у отдельного (`OUTBOX_INTERVAL_MS`), плюс 5-секундный таймаут Telegram на чат (`src/core/notifications/telegram.ts:230`). | При нескольких чатах и медленном Telegram дефект может доехать до чата за десятки секунд. | Задокументировать ожидаемое окно (или понизить интервал для алертов). |
| 16 | мелочь | `src/services/reports/outbox-publisher.ts:26` | Отказ доставки: 5 попыток (~31 с по backoff), затем DLQ. Пасс идёт с защитой «один прогон за раз» (`outbox-publisher.ts:276`), а обработчик может держать транзакцию до 60 с (`durable-alert-delivery.ts:57`). Фактический хвост заметно длиннее 31 с. | При «зависшем» Telegram дефект дойдёт или уйдёт в DLQ через минуты, а не секунды. | Вынести доставку уведомлений в отдельную очередь с меньшим таймаутом. |
| 17 | мелочь | `src/core/notifications/durable-alert.ts:27` | В `payload` нет номера/читаемого идентификатора дефекта: `ruleId: 'criticalDefect'`, `message`, `severity`. `aggregateId` в текст не попадает. | В чате нет ссылки на дефект — разбирать приходится поиском. | Добавить короткий номер дефекта в текст (в `deliverQueuedAlert` `event.id` уже дописывается, но это id события, а не дефекта). |
| 18 | мелочь | `src/app/api/inspections/[id]/complete/route.ts:32` | `performerId` передаётся только для роли `OPERATOR`, иначе `null`; `inspection-commands.ts:481` пишет его в `reportedById`. | Дефект, заведённый осмотром, выполненным не оператором, остаётся без автора. | Для этого пути передавать фактического исполнителя. |

---

## Не проверено

- **Живая отправка в Telegram** не запускалась: `TELEGRAM_API_BASE`/токен не
  трогались (правила проекта запрещают читать `.env`). Все выводы о доставке —
  по коду (ГИПОТЕЗА для п.3, ПРОЙДЕНО для структуры вызовов).
- **Фактическая задержка** (п.15–16) не измерялась: числа взяты из констант
  (`MAX_RETRIES = 5`, `RETRY_BASE_DELAY_MS = 1000`, таймауты fetch), а не из
  прогона.
- **Настройки организации в проде** (`notifications.criticalDefect` в базе
  `orion`) не читались — база прода не доступна по правилам. Умолчание
  «включено» взято из `src/modules/settings/domain/settings.ts:74`.
- **Виджет/колокольчик в интерфейсе** `/admin` проверялся по коду
  (`src/components/piling/feedback-center.tsx` читает `/api/feedback/events`), но
  сами UI-экраны ТО и `operator-mobile` (замороженные области) построчно не
  разбирались — по AGENTS.md их не трогаем.
- **Маршрут вебхука** `src/app/api/alerts/webhook/route.ts` (внешний Alertmanager)
  не относится к дефектам и не анализировался.
- Тесты/сборка (`npx tsc --noEmit`, `npm run test:unit`, `npm run build`) **не
  запускались**: задача только на чтение, изменений в коде нет.
- Модуль `src/modules/operator-mobile/**` и `src/components/piling/operator-mobile/**`
  — замороженная область (AGENTS.md), находки по ним (#6, #7, #10) приведены как
  описание, исправление требует решения владельца.
