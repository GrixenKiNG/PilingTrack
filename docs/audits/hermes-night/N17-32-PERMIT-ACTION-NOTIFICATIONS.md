# N17-32-PERMIT-ACTION-NOTIFICATIONS — Наряды: кто получает уведомление о действии

Версия: `git rev-parse HEAD` = **c3bd5a839c35b8914f32dd7adb8fc2e982840b76** (ветка `hermes/code-1011`).
Только чтение. Код приложения не менялся. Замороженные зоны (варианты операторских экранов, ORION) читались как контекст, не правились.

## Итог

1. Ни одно действие наряда-допуска (создание, отправка на согласование, согласование, **отказ**, **отзыв**, закрытие вручную и закрытие планировщиком) не порождает ни одного уведомления: нет ни Telegram, ни алерта, ни события доставки. Единственный побочный эффект каждой команды — две записи: цепочечный аудит и outbox-событие `ReadinessSnapshotRequested` (пересчёт готовности).
2. Планировщик техготовности закрывает наряд по сроку и помечает несогласованный истёкшим тоже **только записью аудита** — уведомления нет. (Планировщик тикает раз в час, а не «ночью»; см. находку F2.)
3. Текста уведомления о закрытии не существует вовсе, поэтому сравнивать «текст с причиной `VALIDITY_ELAPSED`» нечего. В самом журнале подпись `work-permit.closed` одинакова для ручного закрытия и для закрытия планировщиком.
4. Чужой тенант или чужой объект через уведомление утечь не может — утечки нет, потому что нет уведомлений; единственное событие наряда строго ограничено тенантом и установкой.
5. Счётчики (из открытых файлов и поиска по коду): находок **12**, из них **критично 0, важно 4, мелочь 7, риск-негативный (нет) 1**; статусы **ПРОЙДЕНО 12, НЕ ПРОВЕРЕНО 1, ГИПОТЕЗА 0**.

Топ-5:
1. **важно.** Уведомлений о действиях с нарядом нет ни одного (F1). Диспетчер, инженер ОТ и исполнитель узнают о согласовании/отказе/отзыве/закрытии, только открыв экран.
2. **важно.** Планировщик закрывает наряд по сроку и помечает истёкшим молча, только аудитом (F2). Никто не получает сообщения «наряд истёк».
3. **важно.** Часть уведомлений проекта уходит мимо outbox и теряется при сбоеканала (F9); для наряда этот риск пока неприменим — канала нет вообще.
4. **важно.** Адресатов у наряда в данных хватает (автор, производитель, наблюдающий, инженер ОТ), но они нигде не используются для доставки (F3); Telegram-алерты всё равно уходят во все чаты сразу (F8).
5. **мелочь.** Причины закрытия и комментарий человека не доходят до журнала и выгрузки (F5), а отказ показывается сырым кодом (F6).

## Методика

Поиск и чтение (все пути от корня репозитория):
- `src/modules/readiness/application/permits/commands.ts` — прочитан целиком (создание, правка, submit/approve/reject/revoke/close, `emitEffects`).
- `src/modules/readiness/application/scheduler.ts:120-179` — закрытие/истечение наряда планировщиком.
- `src/workers/unified-worker/readiness-scheduler.ts` — тик планировщика (интервал, включение).
- `src/workers/unified-worker.ts:184-189` — запуск планировщика.
- `src/core/notifications/durable-alert.ts`, `src/core/notifications/telegram.ts:345-394`, `src/services/notifications/durable-alert-delivery.ts`.
- `src/services/reports/outbox-publisher.ts:27,88-234`, `src/core/outbox/dead-letter-queue.ts:40-109`.
- `src/workers/unified-worker/pm-scheduler.ts:28-65`, `src/services/reports/event-handlers.ts:405-434` — смежные прямые отправки.
- `src/modules/settings/domain/settings.ts:52-61` — каталог ключей уведомлений.
- `src/components/piling/to/readiness/settings/audit-labels.ts`, `.../settings/audit-section.tsx:169-204`, `.../api/contracts.ts:134-154,318-339`, `.../screens/permits-screen.tsx:303,320`, `src/app/api/readiness/audit/route.ts`, `src/app/api/readiness/export/route.ts:73-99`.
- Маршруты `src/app/api/readiness/work-permits/**` (6 `route.ts`).
- Тесты: `permits/commands.test.ts`, `permits/commands-lifecycle.test.ts`, `__tests__/scheduler.test.ts`, `settings/__tests__/audit-labels.test.ts`.
- Поиски: `notification|Notification|telegram|notify|enqueueAlert|sendAlert|feedback` по `src/modules/readiness` → **1 совпадение** (`defects/commands.ts:1`); `ReadinessSnapshotRequested` по `src` → **11 совпадений**; `enqueueAlert|NotificationDeliveryRequested` по `src` → **11 совпадений**; `work-permit` по `src` → **81 совпадение**; `work-permit.reject` по `src` → **1 совпадение** (`permits/commands.test.ts:56`); `notification|notify|alert|telegram` по `src/app/api/readiness/work-permits` → **0 совпадений**.

Статусы ниже: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА.

## Ответы на вопросы

### (1) Уходит ли уведомление при закрытии и отзыве, и кому
Нет. Ни при закрытии, ни при отзыве (и ни при согласовании, отказе, создании, отправке) уведомление не формируется и никому не адресуется.
- `emitEffects` (`commands.ts:74-98`) на каждое действие пишет ровно две вещи: `recordChainedReadinessAudit` (строка 80) и `outboxEvent.create` с типом `ReadinessSnapshotRequested` (строки 90-97). Вызовов уведомлений нет.
- В модуле техготовности единственный импорт уведомлений — `src/modules/readiness/application/defects/commands.ts:1` (`enqueueCriticalDefects`). Команды наряда его не используют.
- В маршрутах `work-permits` нет ни `notification`, ни `alert`, ни `telegram` (поиск → 0).
- Адресаты-кандидаты в данных есть: `authorId`, `producerUserId`, `observerUserId`, `safetyUserId` (`commands.ts:60-66`, `work-permit-repository.ts:93-99`), но нигде не используются для доставки.
- Даже если бы уведомление было, персональной адресации нет: `telegramNotifier.sendAlert` шлёт во все настроенные чаты (`telegram.ts:349-369`).

Статус: ПРОЙДЕНО.

### (2) Есть ли уведомление при закрытии по сроку планировщиком, и совпадает ли текст с `VALIDITY_ELAPSED`
Уведомления нет. Планировщик закрывает согласованный наряд по сроку (`state: 'CLOSED'`, `closeReason: 'VALIDITY_ELAPSED'`) и помечает несогласованный истёкшим (`state: 'EXPIRED'`), записывая только аудит (`scheduler.ts:136-165`, `action` — `work-permit.closed`/`work-permit.expired`, `metadata.reason` — `VALIDITY_ELAPSED`/`UNAPPROVED_WINDOW_ELAPSED`). Никакого уведомления, а значит и текста, который можно было бы сверить с причиной, не существует. Планировщик ведёт лог только уровня `logger.info` (`readiness-scheduler.ts:36-43`), это не уведомление пользователю. Тик — раз в час (`readiness-scheduler.ts:21`), включён в проде по умолчанию (`unified-worker.ts:187-189`).

Статус: ПРОЙДЕНО.

### (3) Что будет, если канал недоступен — повтор, DLQ или потеря
Для наряда терять нечего: канала нет. Общий механизм outbox-алертов надёжен: ошибка доставки возвращается из обработчика, outbox-строка повторяется с backoff, после `MAX_RETRIES = 5` уходит в DLQ, а DLQ шлёт свой Telegram-алерт (`outbox-publisher.ts:27,167-230`; `dead-letter-queue.ts:50-109`). Но часть уведомлений проекта идёт мимо этого механизма — просрочка ТО (`pm-scheduler.ts:53-64`) и «простой в отчёте дольше порога» (`event-handlers.ts:405-434`) вызывают `sendAlert` напрямую и на ошибку только логируют: при недоступности Telegram сообщение теряется без повторов и без DLQ.

Статус: ПРОЙДЕНО (общий механизм); ГИПОТЕЗА не нужна — поведение читается напрямую.

### (4) Не уходят ли уведомления о наряде другого объекта или другого тенанта
Нет — уведомлений о наряде нет вовсе, значит утечки быть не может. Единственное событие наряда (`ReadinessSnapshotRequested`) ограничено тенантом (`tenantId`) и установкой (`equipmentId`), `dedupeKey` содержит `tenantId` (`commands.ts:90-97`). Чтение наряда тоже строго тенантное (`work-permit-repository.ts:221-227`).

Статус: ПРОЙДЕНО (риск отсутствует).

### (5) Тесты
Тесты фиксируют отсутствие уведомлений: в них проверяется ровно один `outboxEvent.create` и запись аудита, уведомления не ожидаются и не мокаются. `permits/commands.test.ts:58` (`toHaveBeenCalledOnce` для outbox) и `:156` (то же при закрытии), `commands-lifecycle.test.ts:111` (создание), `scheduler.test.ts:110-120` (закрытие планировщиком: только аудит). Ни одного теста на уведомление о наряде нет (поиск `notification`/`notify` по тестам техготовности — совпадений нет).

Статус: ПРОЙДЕНО.

## Находки

| № | Статус | Серьёзность | Вывод | Файл:строка |
|---|--------|-------------|-------|-------------|
| F1 | ПРОЙДЕНО | важно | Действия наряда (согласование, отказ, отзыв, закрытие) не порождают ни одного уведомления. `emitEffects` пишет только аудит и `ReadinessSnapshotRequested`. | `src/modules/readiness/application/permits/commands.ts:74-98` |
| F2 | ПРОЙДЕНО | важно | Планировщик закрывает наряд по сроку и помечает истёкшим только аудитом, без уведомления. | `src/modules/readiness/application/scheduler.ts:136-166`; `src/workers/unified-worker/readiness-scheduler.ts:36-43` |
| F3 | ПРОЙДЕНО | важно | Адресаты наряда (автор, производитель, наблюдающий, инженер ОТ) хранятся, но нигде не используются для доставки. | `src/modules/readiness/application/permits/commands.ts:60-66`; `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:93-99` |
| F4 | ПРОЙДЕНО | мелочь | Текста уведомления о закрытии не существует; в журнале подпись `work-permit.closed` не различает ручное закрытие и закрытие планировщиком. | `src/components/piling/to/readiness/settings/audit-labels.ts:51`; `src/modules/readiness/application/scheduler.ts:142` |
| F5 | ПРОЙДЕНО | мелочь | Причина и комментарий закрытия не доходят до журнала и выгрузки: DTO события аудита без `metadata`, CSV её не выгружает. | `src/components/piling/to/readiness/api/contracts.ts:318-328`; `src/app/api/readiness/export/route.ts:92-98`; `commands.ts:305-307` |
| F6 | ПРОЙДЕНО | мелочь | Действие отказа `work-permit.reject` не имеет подписи и значка → в журнале диспетчера сырой код; тест-страж `CONTOUR_ACTIONS` его тоже не перечисляет. | `src/components/piling/to/readiness/settings/audit-labels.ts:39-51,112-147`; `src/components/piling/to/readiness/settings/__tests__/audit-labels.test.ts:20-50` |
| F7 | ПРОЙДЕНО | мелочь | Каталог ключей уведомлений не содержит ключа для наряда-допуска — включить/выключить такое уведомление нельзя. | `src/modules/settings/domain/settings.ts:52-61` |
| F8 | ПРОЙДЕНО | важно | Telegram-алерты уходят во все настроенные чаты; персональной адресации автору/инженеру ОТ нет. | `src/core/notifications/telegram.ts:349-369` |
| F9 | ПРОЙДЕНО | важно | Часть уведомлений отправляется мимо outbox (просрочка ТО, простой в отчёте): при сбое Telegram — потеря без повторов и DLQ. | `src/workers/unified-worker/pm-scheduler.ts:53-64`; `src/services/reports/event-handlers.ts:405-434` |
| F10 | ПРОЙДЕНО | мелочь | Общий механизм outbox-алертов надёжен: retry `MAX_RETRIES=5` с backoff, затем DLQ + Telegram-алерт DLQ. | `src/services/reports/outbox-publisher.ts:27,167-230`; `src/core/outbox/dead-letter-queue.ts:50-109` |
| F11 | ПРОЙДЕНО | нет | Утечки чужого тенанта/объекта через уведомления нет; единственное событие наряда тенант- и установка-скоуплено. | `src/modules/readiness/application/permits/commands.ts:90-97` |
| F12 | ПРОЙДЕНО | мелочь | Тесты фиксируют отсутствие уведомлений: ровно один `outboxEvent.create` и аудит, уведомления не мокаются. | `permits/commands.test.ts:58,156`; `commands-lifecycle.test.ts:111`; `__tests__/scheduler.test.ts:110-120` |
| F13 | НЕ ПРОВЕРЕНО | — | Получает ли feedback-центр (Bell, `/api/feedback/*`) события готовности, включая действия с нарядом. | `src/app/api/feedback/**` (не прослежено до конца) |

## Таблица действий

| Действие | Получатели | Канал | Что записано | Файл:строка | Риск |
|----------|-----------|-------|--------------|-------------|------|
| Создание (create) | уведомление не отправляется | — | аудит `work-permit.created` + outbox `ReadinessSnapshotRequested` | `permits/commands.ts:151,74-98` | Уведомлений нет |
| Отправка на согласование (submit) | уведомление не отправляется | — | аудит `work-permit.submit` + snapshot | `permits/commands.ts:237-239,305-307` | Уведомлений нет |
| Согласование (approve) | уведомление не отправляется | — | аудит `work-permit.approved-<роль>` + snapshot | `permits/commands.ts:292-303,305-307` | Уведомлений нет |
| Отказ (reject) | уведомление не отправляется | — | аудит `work-permit.reject` + snapshot | `permits/commands.ts:261-271,305-307` | Уведомлений нет; в журнале сырой код (F6) |
| Отзыв (revoke) | уведомление не отправляется | — | аудит `work-permit.revoke` + snapshot | `permits/commands.ts:249-260,305-307` | Уведомлений нет |
| Закрытие вручную (close) | уведомление не отправляется | — | аудит `work-permit.closed`, `metadata.comment` + snapshot | `permits/commands.ts:240-248,305-307` | Уведомлений нет; комментарий не виден в журнале (F5) |
| Закрытие по сроку (APPROVED, планировщик) | уведомление не отправляется | лог `logger.info` | аудит `work-permit.closed`, `reason=VALIDITY_ELAPSED` | `scheduler.ts:137-165` | Уведомлений нет |
| Истечение несогласованного (PENDING_APPROVAL, планировщик) | уведомление не отправляется | лог `logger.info` | аудит `work-permit.expired`, `reason=UNAPPROVED_WINDOW_ELAPSED` | `scheduler.ts:136-165` | Уведомлений нет |

## Что не проверено

- **Feedback-центр (Bell, `/api/feedback/*`).** Не прослежено до конца, подписывается ли он на события готовности и на действия с нарядом (F13, статус НЕ ПРОВЕРЕНО). В модуле техготовности импортов feedback не найдено, но общий контур не проверялся.
- **Сборка, линт и тесты не запускались.** Аудит только читающий; числа в отчёте взяты из чтения файлов и поиска по коду, а не из прогона `npm run build`/`test`.
- **Поведение в проде.** Планировщик включён по умолчанию (`READINESS_SCHEDULER_ENABLED !== 'false'`), но фактические env-значения прода не читались.
- **Тексты уведомлений.** Проверить «совпадает ли текст с `VALIDITY_ELAPSED`» нельзя: текста нет вовсе (см. Q2).
- **Мобильные/операторские экраны** (замороженные) читались лишь частично — только в части, где показывается статус наряда (`permits-screen.tsx:303,320`).
- **Другие каналы** (email/push) не проверялись как отдельные транспорты; в прочитанном коде уведомления идут через Telegram.
