# AU25-S2-TELEGRAM-EVENTS: Уведомления Telegram — события, получатели, повторы

Версия (HEAD рабочей папки): `d35e20564f8c1506f5455f6f671d3a816875329c`
Ветка: `hermes/q4-0926`. Только чтение; код приложения не менялся.

## Итог

Событий, по которым что-то уходит в Telegram, — восемь (плюс одно «тестовое», которое
шлёт только `getChat`, не сообщение). Транспорт один — `core/notifications/telegram.ts`
(три fetch-вызова: `sendMessage` строка 227, `sendDocument` строка 265, `getChat` строка 397).
Получатель у всех определяется одинаково: `getConfigs()` берёт все включённые
`TelegramConfig` организации (`enabled: true`), дедуплицирует по `chatId`
(`telegram.ts:75-92`); организация — `ожидаемый ?? getRequestTenantId() ?? DEFAULT_TENANT_ID`
(`telegram.ts:49`).

Повтор при недоставке есть только там, где отправка идёт через outbox: durable-алерты
(происшествие, опасный дефект), Alertmanager-webhook и PDF отчёта (backoff 1s→60s, 5 попыток,
далее DLQ — `outbox-publisher.ts:26-41,173-193`). Единственная защита от дублей, которую
понимает сам транспорт, — «чеки» по `chatId` в payload строки outbox
(`telegram-delivery-progress.ts`), блокировка строки `FOR UPDATE` и флаг `published`;
у Telegram нет ключей идемпотентности, поэтому при неоднозначном сетевом сбое повтор возможен
(`durable-alert-delivery.ts:40-42`).

При блокировке бота канал помечается «постоянно недоступным» и ВЫКЛЮЧАЕТСЯ
(`telegram.ts:205-220`); в других чатах отправка продолжается. Транспорт целиком зависит от
`TELEGRAM_API_BASE` (прокси): смена переменной влияет сразу на все события.

По уровням: критично — 0, важно — 6, мелочь — 7 (итого 13 находок). Самые существенные:
уведомление о просроченных ТО и заявка с сайта ОРИОН шлются «выстрелил-и-забыл»
без повтора; ключ дедупа алерта о простое собран из (причина, длительность) и может
подавить второе РАЗНОЕ событие; заявленный в докстринге rate-limit и retry в транспорте
фактически отсутствуют.

## Методика

Поиск по репозиторию (ripgrep через `search_files`) по шаблонам: `telegram`,
`TELEGRAM_API_BASE`, `telegramNotifier\.`, `sendAlert|sendMessage|sendDocument`,
`enqueueAlert|enqueueCriticalDefects`, `deliverQueuedAlert`, `NotificationDeliveryRequested`,
`ReportPdfDeliveryRequested`, `telegramCircuitBreaker`, `notificationKey`. Прочитаны целиком:
`src/core/notifications/**`, `src/services/notifications/**`, `src/workers/outbox-worker.ts`,
`src/workers/unified-worker/outbox.ts`, `src/services/reports/outbox-publisher.ts`,
`src/services/reports/domain-events.ts`, `src/services/reports/event-handlers.ts`,
`src/core/outbox/dead-letter-queue.ts`, `src/app/api/alerts/webhook/route.ts`,
`src/app/api/notifications/telegram/test/route.ts`, `src/app/api/telegram/configs/route.ts`,
`src/services/telegram/telegram-config-service.ts`, `src/modules/settings/**`,
`src/workers/unified-worker/pm-scheduler.ts`, `src/lib/tenant-iteration.ts` и места вызова
`enqueueAlert`/`enqueueCriticalDefects`. Значения токенов не читались. Проверено, что каждая
цитируемая строка существует (файлы открывались через `read_file`).

Команда версии:

```
$ git rev-parse HEAD
d35e20564f8c1506f5455f6f671d3a816875329c
```

## События Telegram

| # | Событие | Источник (эмиттер) | Кто получатель и как определяется | Текст (шаблон) | Повтор при недоставке | Защита от дублей | Блокировка бота | Прокси `TELEGRAM_API_BASE` |
|---|---|---|---|---|---|---|---|---|
| 1 | Alertmanager: тревога (мониторинг) | `src/app/api/alerts/webhook/route.ts:162` → `deliverQueuedAlert` | все `enabled` чаты `DEFAULT_TENANT_ID` (`webhook/route.ts:112-115,124`) | `buildAlertMessage`: эмодзи+`<b>метка</b>`+текст+объект/отчёт+время (`telegram.ts:142-192`) | ДА: outbox, 5 попыток + DLQ (`outbox-publisher.ts:173`) | outbox `dedupeKey` = `alertmanager:<hash(метки+startsAt+окно)>` (`webhook/route.ts:144-147`) | канал выключается (`telegram.ts:205`) | зависит (`telegram.ts:227`) |
| 2 | Происшествие с телефона (мелкое — выключаемо; «прекратить работы» — всегда) | `modules/operator-mobile/application/commands/incidents.ts:119-128` (`enqueueAlert`) | все `enabled` чаты тенанта события | тот же `buildAlertMessage`; текст = `«Происшествие[: требуется прекратить работы.] <описание>»` | ДА: outbox + DLQ | флаг `published` + чеки по `chatId`; `clientCommandId` гасит повтор команды | канал выключается | зависит |
| 3 | Опасный дефект осмотра (criticalDefect) | `modules/operator-mobile/.../checklist.ts:294` и `modules/readiness/application/defects/commands.ts:139` (`enqueueCriticalDefects` → `enqueueAlert`, `durable-alert.ts:19-31`) | все `enabled` чаты тенанта | `buildAlertMessage`; текст = `«Опасный дефект установки <equipmentId>» + заголовки + «Зафиксировал: <reportedBy>»` | ДА: outbox + DLQ | флаг `published` + чеки по `chatId` | канал выключается | зависит |
| 4 | Простой в сменном отчёте (>2 ч) | `services/reports/event-handlers.ts:407` (`on DOWNTIME_ADDED`, строки 287-289) | все `enabled` чаты тенанта события | `buildAlertMessage`; текст = `«Простой <N ч> зафиксирован в отчёте»`, объект/№ отчёта — человеко-читаемые | НЕТ: `try/catch`, только лог+Sentry (`event-handlers.ts:434-442`) | Redis-ключ `alert:downtime:<tenant>:<reportId>:<reasonId>:<duration>`, TTL 48 ч (`event-handlers.ts:291-312,418-421`) | канал выключается | зависит |
| 5 | PDF сданного отчёта (newReports) | эмит `event-handlers.ts:573-584` → `deliverReportPdf:665` | все `enabled` чаты тенанта события | подпись (Объект/Дата/Оператор/…/Свай/Бурение/Простои) + документ (`event-handlers.ts:633-653`) | ДА: outbox + DLQ (`event-handlers.ts:671`) | `dedupeKey=report-pdf:<eventId>` (`:579`), флаг `published` + чеки по `chatId` (`:658-665`) | канал выключается | зависит (`telegram.ts:265`) |
| 6 | Просроченные ТО (maintenanceOverdue) | `workers/unified-worker/pm-scheduler.ts:54` | все `enabled` чаты каждого тенанта (`forEachTenant`, `tenant-iteration.ts:22-38`); выключатель проверяется до отправки (`pm-scheduler.ts:36-37`) | `buildAlertMessage`; текст = `«Просрочено регламентов ТО: N\n• <установка> — …»` (до 10 строк) | НЕТ: `try/catch`, только лог+Sentry (`pm-scheduler.ts:58-64`) | нет ключа; один сводный проход в сутки, guard `passRunning` (`:67-71`) | канал выключается | зависит |
| 7 | Недоставленное событие (DLQ) (deliveryFailures) | `core/outbox/dead-letter-queue.ts:101` (`moveToDlq`) | все `enabled` чаты тенанта события или `DEFAULT_TENANT_ID` (`dead-letter-queue.ts:95`) | сырой HTML: `⚠️ <b>Dead Letter Queue</b> … Событие <code>…</code> …` (`:102-104`) | НЕТ: `void`, `catch{/* ignore */}` (`:94-106`) | нет; но `moveToDlq` вызывается один раз на строку — повторный спам был устранён (`outbox-publisher.ts:194-209`) | канал выключается | зависит |
| 8 | Заявка с сайта ОРИОН (frozen-зона `src/app/api/orion/**`) | `src/app/api/orion/lead/route.ts:128` (`sendMessage`) | все `enabled` чаты `DEFAULT_TENANT_ID` (`getConfigs` без аргумента) | `🏗 <b>Новая заявка с сайта ОРИОН</b> … Имя/Контакт/Сообщение/время` (`:112-117`) | НЕТ: один вызов, исход пишется в `OrionLead.deliveryError` (`:126-148`) | заявка сохраняется до отправки; повторного вызова нет | канал выключается | зависит |
| 9 | Кнопка «Тест» в настройках | `src/app/api/notifications/telegram/test/route.ts:38` (`testConnection`) | один указанный `configId` тенанта | сообщение не шлётся: только `getChat` (`telegram.ts:397-411`) | НЕТ (синхронный ответ 200/500) | n/a | вернёт ошибку в UI | зависит (`telegram.ts:397`) |

Статусы: строки 1–9 — ПРОЙДЕНО (каждая опирается на прочитанные `path:line`). Значения
токенов не читались.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| F-01 | важно | `src/workers/unified-worker/pm-scheduler.ts:54`, `:58-64` | Уведомление о просроченных ТО шлётся напрямую `telegramNotifier.sendAlert`, без outbox. Сбой — только лог+Sentry. | Telegram недоступен (прокси лёг) в момент суточного прогона → оповещение о просроченном ТО потеряно навсегда, повтор через сутки, но и он может совпасть со сбоем. | Отправлять через тот же outbox-путь, что и durable-алерты (эмит `NotificationDeliveryRequested`). |
| F-02 | важно | `src/app/api/orion/lead/route.ts:126-148` | Заявка с сайта ОРИОН отправляется один раз; при сбое только `deliveryError` в строке (frozen-зона ORION). | Клиент оставил заявку, Telegram/прокси недоступен → в приложении нет экрана заявок (см. `settings.ts:42-44`), заявку никто не увидит, пока вручную не полезут в базу. | Фоновый повтор неотправленных заявок (`deliveredAt IS NULL`). |
| F-03 | важно | `src/core/notifications/telegram.ts:205-220`; сценарий ретрая — `src/services/notifications/durable-alert-delivery.ts:43-58` | При «постоянной» ошибке (`403`/`401`/`400` «bot was blocked») канал выключается, но текущее событие всё равно считается недоставленным и уходит на повтор → `configs.length===0` → false → throw → 5 попыток → DLQ. | Заблокировали бота: система шлёт в DLQ алерт «недоставленное событие» о событии, которое физически некуда было отправить, и засоряет DLQ. | Если после выключения не осталось ни одного рабочего чата — считать «постоянным» и не ретраить (не бросать), либо различать «нет получателей» и «сбой отправки». |
| F-04 | важно | `src/services/notifications/durable-alert-delivery.ts:40-42` | У Telegram нет ключей идемпотентности; при неоднозначном сетевом сбое (таймаут после фактической доставки) одно и то же сообщение будет отправлено повторно. | Прокси оборвал ответ после доставки → outbox повторит → в чате дубль алерта о происшествии/дефекте. | Документировано; можно снизить, отправляя `disable_notification`/короткий `message_thread`? Реалистично — принять риск и убедиться, что остальная часть сообщения (текст) содержит id события. |
| F-05 | важно | `src/services/reports/event-handlers.ts:307-312,347-352` | Ключ дедупа алерта о простое собран из `(tenant, reportId, reasonId, duration)`, а не из id строки простоя (в событии его нет). | Два РАЗНЫХ простоя одинаковой причины и длительности в одном отчёте → второй алерт подавлен как «уже отправленный». | Пробросить id строки простоя в `DOWNTIME_ADDED` и ключевать по нему. |
| F-06 | важно | `src/core/notifications/telegram.ts:6-10` | Докстринг обещает «Rate limiting (max 30 msg/sec)» и «Retry with exponential backoff», но в коде ни того, ни другого нет; повтор живёт только в outbox. | Прямые вызывающие (PM-планировщик, DLQ, ОРИОН) не получают ни ограничения скорости, ни повтора, хотя комментарий создаёт обратное впечатление при сопровождении. | Либо реализовать, либо привести докстринг к факту. |
| F-07 | мелочь | `src/core/infrastructure/circuit-breakers.ts:199-201,240` | `telegramCircuitBreaker` объявлен и отдаётся в health, но нигде в путях отправки не используется (проверено `search_files` — только определение и чтение состояния). | При массовых сбоях Telegram нет автоматического «размыкания» — каждый ретрай outbox бьёт в недоступный API. | Использовать брейкер в `sendTelegramMessage`/`sendTelegramDocument` или не показывать его состояние как реальное. |
| F-08 | мелочь | `src/core/notifications/telegram.ts:44-69` | `getConfigs` при любой ошибке чтения настроек (в т.ч. RLS/БД) возвращает `[]`, и `sendAlert` логирует «Telegram not configured — skipping alert» (`:340`) и возвращает false. | Ошибка БД неотличима от «бот не настроен»: для durable-алертов это уход в ретрай/DLQ, а для PM/DLQ-алертов — тихая потеря с неверным сообщением в логе. | Различать «нет настроек» и «ошибка чтения» (последняя — throw/отдельный код). |
| F-09 | мелочь | `src/core/notifications/telegram.ts:214` | При выключении канала к `label` навсегда дописывается « — <причина>» (`label: config.label + ' — ' + reason`). | Админ разблокировал бота и включил канал снова — в списке остаётся старая причина отказа, вводящая в заблуждение. | Хранить причину в отдельном поле/уведомлении, не мутировать `label`. |
| F-10 | мелочь | `src/core/outbox/dead-letter-queue.ts:94-106` | DLQ-алерт шлётся как `void (async …)()` без повтора; при рестарте процесса между записью в DLQ и отправкой алерт теряется. | Падение воркера ровно после записи DLQ → никто не узнаёт о недоставленном событии. | Ставить DLQ-алерт в outbox наравне с прочими. |
| F-11 | мелочь | `src/services/notifications/durable-alert-delivery.ts:33`; `src/modules/operator-mobile/.../incidents.ts:126` | `RULE_NOTIFICATION_KEYS` знает только `criticalDefect` и `incident`; правило `incidentStopWork` в карту не вписано намеренно (комментарий `:12-14`). | Если у `incidentStopWork` когда-нибудь появится выключатель — он молча работать не будет (ключ undefined → отправляем всегда). Сейчас это соответствует решению владельца, но связано на комментарии, а не на типе. | Оставить как есть, но проверять соответствие при добавлении ключа в `NOTIFICATION_KEYS`. |
| F-12 | мелочь | `src/core/notifications/durable-alert.ts:28` | Текст алерта о дефекте содержит сырой `equipmentId` (cuid) — `«Опасный дефект установки <equipmentId>»`. | Диспетчер в чате видит внутренний id, а не название установки (в отличие от алерта о простое, где подставляется `siteName`). | Подставлять `equipment.name`, как это сделано для объекта в `handleDowntimeAlert`. |
| F-13 | мелочь | `src/app/api/alerts/webhook/route.ts:128` | При отсутствии `DEFAULT_TENANT_ID` алерт пропускается (`if (!tenantId) continue`), но `firing` уже инкрементирован → ответ 503 «Не удалось доставить». | Неверно сконфигурированный стенд рапортует о сбое доставки, хотя причина — отсутствие тенанта. | Явный лог/код причины (например `reason: 'no-tenant'`). |

## Что не проверено

- Реальное поведение на проде (прокси/сеть/Telegram) не проверялось: аудит только по коду.
- Тесты не запускались (`npm run test:unit`, `npx tsc --noEmit` и т.п.) — задача только
  на чтение; выводы F-03/F-04/F-05 основаны на чтении кода, а не на воспроизведении.
- Значение `TELEGRAM_API_BASE` (адрес прокси) и `DEFAULT_TENANT_ID` не проверялись —
  секреты/конфигурация окружения не читались.
- Реальный `TenantSettings.notifications` в базе не смотрелся: какие выключатели у
  организации `orion` фактически стоят — неизвестно (умолчания — `settings.ts:65-83`).
- Статус «постоянной» ошибки Telegram определён по списку подстрок
  (`telegram.ts:206,299-306`); полнота этого списка против живых кодов ответов API не
  проверялась.
- Взаимодействие с frozen-зоной `src/app/api/orion/**` описано по коду (F-02), но
  правки там не предлагаются к применению без решения владельца.
