# N17-04-DLQ-TELEGRAM-PATH — Telegram и DLQ: путь недоставленного сообщения

Аудит только для чтения. Код приложения не менялся; закоммичен только этот отчёт.

- Ревизия на момент аудита (из команды `git rev-parse HEAD`): **2d3eeacbd62f6f8ba04f54ea5aa46f146559be07**, ветка `hermes/code-1011`.
  В задании указана версия `main 1d24e24f` — она **не совпадает** с фактическим HEAD рабочей папки D:/PillingR/wt-night-code. Отчёт описывает фактически прочитанный код.
- Замороженные зоны (экраны оператора, сайт ORION) читались только на предмет тракта заявки; правок и предложений «удалить как мёртвое» нет.

## Итог

Прослежен полный путь: доменное событие → outbox → воркер → `emitDomainEvent` → `telegramNotifier` (sendMessage/sendDocument/sendAlert) → Bot API через `TELEGRAM_API_BASE`; при исчерпании 5 попыток событие уходит в DLQ, откуда кнопкой «Повтор» создаётся новое outbox-событие.

- Находок: **критично — 0, важно — 2, мелочь — 12** (14 всего). Плюс 5 наблюдений «это работает правильно — подтверждено» и 1 в «не проверено».
- Смена `ENCRYPTION_KEY` без сохранения старого ключа **молча** гасит все Telegram-уведомления: `decrypt` бросает, `getConfigs` ловит и возвращает `[]`, отправка возвращает `false` («не настроено»), в DLQ копятся события, и **сам алерт о DLQ тоже не уходит** — он идёт через тот же Telegram (важно, #2).
- Заявка ОРИОН доставляется **синхронно и вне outbox** — автоповтора нет, при сбое остаётся только `deliveryError` и ручной экран `/admin/orion-leads` (#4, #5).
- Токен бота стоит в пути URL `.../bot<token>/...`; фильтр логгера маскирует только по **имени** ключа, а URL — значение, поэтому утечка возможна через логи прокси/Sentry (важно, #1, статус ГИПОТЕЗА).
- Защита от двойного нажатия «Повтор» есть и на клиенте, и на сервере (транзакционный захват строки) — двойной доставки из-за двух кликов нет; остаточный риск — один и тот же текст при неоднозначном сетевом сбое (Bot API не знает идемпотентности) — #13.

## Методика

Прогонялись `rg`/просмотр файлов с диапазонами строк. Прочитаны (полные пути от корня):

- `src/core/notifications/telegram.ts` (весь), `telegram-delivery-progress.ts`, `durable-alert.ts`, `index.ts`.
- `src/core/outbox/dead-letter-queue.ts` (весь) и его тест.
- `src/services/reports/outbox-publisher.ts` (весь) — ретраи/бэкофф/DLQ; `outbox-worker.ts`; `src/workers/unified-worker/outbox.ts`.
- `src/services/notifications/durable-alert-delivery.ts`; `src/services/reports/domain-events.ts`; `src/services/reports/event-handlers.ts` (350–683).
- `src/app/api/admin/dlq/route.ts`, `src/app/api/orion/lead/route.ts`, `src/app/api/admin/orion-leads/route.ts`, `src/app/api/alerts/webhook/route.ts` (80–180).
- `src/components/piling/admin-dlq.tsx`; `src/app/(app)/admin/dlq/page.tsx`; тесты `telegram.test.ts`, `dead-letter-queue.test.ts`, `admin-dlq.test.tsx`, `admin/dlq/__tests__/route.test.ts`.
- `src/core/security/encryption.ts`; `src/services/telegram/telegram-config-service.ts`; `src/lib/logger.ts`; `src/lib/tenant.ts`.
- `src/services/auth/authorization-service.ts:133`; `src/modules/settings/**`; `src/modules/reports/application/projections/projection-worker.ts`.
- `prisma/schema.prisma` (OrionLead/TelegramConfig/OutboxEvent/DeadLetterQueue); `scripts/validate-env.ts:100-153`.

Поиски: `TELEGRAM_API_BASE`, `MAX_RETRIES|maxAttempts`, `NotificationDeliveryRequested|ReportPdfDeliveryRequested`, `telegramConfig.(create|update)`, `encrypt(`, `dlq.manage`, `isNotificationEnabled|deliveryFailures`, `PROJECTABLE_EVENT_TYPES`.

Команды и числа (вывод команд):

- `git rev-parse HEAD` → `2d3eeacbd62f6f8ba04f54ea5aa46f146559be07`.
- `git branch --show-current` → `hermes/code-1011`.
- `npx vitest run src/core/notifications/__tests__/telegram.test.ts src/core/outbox/__tests__/dead-letter-queue.test.ts src/components/piling/__tests__/admin-dlq.test.tsx` → **Test Files 3 passed (3), Tests 71 passed (71)**, 0 skipped, 7.54s.

## Схема пути сообщения (словами)

1. **Тревога/отчёт.** Бизнес-транзакция кладёт в `OutboxEvent` событие `NotificationDeliveryRequested` (алерты, `projected:true`, `durable-alert.ts:13`) или `ReportPdfDeliveryRequested` (PDF отчёта, `event-handlers.ts:573`). У PDF есть `dedupeKey: report-pdf:<id>` (`event-handlers.ts:579`).
2. **Воркер.** `publishOutboxEvents` (потребитель `published`) читает необработанные строки с истёкшим `nextRetryAt` и по одной шлёт в `emitDomainEvent` (`outbox-publisher.ts:95-150`). Оба потребителя (`published` — доставка, `projected` — проекции) независимы.
3. **Диспетчер.** `emitDomainEvent` для `NotificationDeliveryRequested` → `deliverQueuedAlert`; для `ReportPdfDeliveryRequested` → `deliverReportPdf` (`domain-events.ts:97-107`).
4. **Отправка.** Обработчик открывает `db.$transaction`, берёт строку outbox `FOR UPDATE`, вызывает `telegramNotifier.*`; при успехе ставит `published:true`, при неудаче бросает → outbox ретраит (`durable-alert-delivery.ts:43-58`, `event-handlers.ts:658-672`).
5. **Notifier.** `getConfigs` берёт включённые `TelegramConfig` (дедуп по `chatId`, расшифровка `botToken`), `deliverToAll` шлёт **в каждый чат по очереди**; `sendMessage`/`sendDocument`/`getChat` идут POST на `${TELEGRAM_API_BASE||'https://api.telegram.org'}/bot<token>/<method>` (`telegram.ts:239,277,409`).
6. **Классификация.** HTTP `4xx`/`5xx` и тело `{"ok":false}` — ошибка; `401/403` и часть `400` (`chat not found`, `bot was blocked`, …) — **постоянная** → конфиг выключается (`enabled:false`) и помечается; остальное (429, 500, сеть) — временная → `false` (`telegram.ts:217-264`).
7. **Повтор.** `consumeOutboxEvents` при `attempts ≥ 5` кладёт строку в `DeadLetterQueue` (`moveToDlq`) и в той же ветке помечает outbox-строку потреблённой; иначе пишет `nextRetryAt` по бэкоффу `min(1000·2^attempts, 60000)·(1+0..30%)` (`outbox-publisher.ts:27,36-42,168-206`).
8. **DLQ-алерт.** `moveToDlq` best-effort шлёт сообщение через тот же `telegramNotifier.sendMessage`, если включён тумблер `deliveryFailures` (`dead-letter-queue.ts:93-110`, ключ `settings.ts:60`).
9. **Ручной повтор.** Экран `/admin/dlq` → `POST /api/admin/dlq` → `retryDlqEntry` транзакционно захватывает строку (`status='pending'`), переводит в `resolved` и создаёт **новое** `OutboxEvent` без `dedupeKey`, разбудив только упавшего потребителя (`dead-letter-queue.ts:117-155`).
10. **ОРИОН.** Публичная форма пишет `OrionLead` **до** отправки, затем синхронно `await sendMessage(...)`, пишет `deliveredAt`/`deliveryError` и всегда отвечает `{ok:true}` (`orion/lead/route.ts:87-150`). В outbox и DLQ заявка **не попадает**.

## Находки

| # | Серьёзность | Путь:строка | Проблема | Сценарий / почему важно | Предлагаемая правка | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/core/notifications/telegram.ts:239,277,409` | Токен бота стоит в пути URL (`.../bot<token>/sendMessage`), а не в заголовке/теле. Логгер маскирует по **имени** ключа (`src/lib/logger.ts:57-62`), а полный URL — это значение. | Прокси `TELEGRAM_API_BASE` (nginx/access-log) и Sentry (breadcrumb исходящего `fetch`) могут записать полный URL. Любой, кто читает эти логи, получает полный контроль над ботом. Убрать токен из URL нельзя — это формат Bot API; риск в том, *где* URL логируется. | Проверить/выключить логирование URL на прокси; добавить `beforeBreadcrumb` для `fetch` в Sentry; в `logger` маскировать `*url*` значения. | ГИПОТЕЗА (конфиг прокси/Sentry не открывал) |
| 2 | важно | `src/core/security/encryption.ts:111-121` → `src/core/notifications/telegram.ts:87-89,65-68` | Смена/потеря `ENCRYPTION_KEY` (без сохранения старого `ENCRYPTION_KEY_V<n>`) → `decrypt` бросает → `getConfigs` целиком ловит и возвращает `[]`. | Все уведомления молча перестают уходить: `sendAlert`/`sendMessage` пишут warn «Telegram not configured» и возвращают `false`; события копятся в DLQ. Хуже: алерт о DLQ (`dead-letter-queue.ts:104-109`) тоже идёт через Telegram → о сбое никто не узнаёт. Восстановление — только ручным вводом токена заново (`telegram-config-service.ts:46-57` помечает такие записи `hasBotToken:false`). | Держать старые ключи при ротации (как описано в шапке `encryption.ts:16-23`); добавить health-check/алерт «ни один TelegramConfig не расшифровался» вне Telegram. | ПРОЙДЕНО (код прочитан) |
| 3 | мелочь | `src/app/api/orion/lead/route.ts:128` | Заявка ОРИОН шлётся напрямую (`await telegramNotifier.sendMessage`), минуя outbox. Автоповтора нет. | При сбое Telegram остаётся только колонка `deliveryError` и ручной список `/admin/orion-leads` (`admin/orion-leads/route.ts:36`). Никто не опрашивает его автоматически → потенциальный клиент может остаться незамеченным. | При желании — заводить `OrionLead`-событие в outbox, либо периодический алерт о непустом списке недоставленных заявок. | ПРОЙДЕНО (замысел подтверждён комментарием `route.ts:10-22`) |
| 4 | мелочь | `src/app/api/orion/lead/route.ts:128` + `telegram.ts:101-119` | Публичный POST ждёт доставку **во все** чаты последовательно, каждый — до 5 с таймаута. | При недоступном прокси (Telegram с сервера заблокирован) посетитель ждёт до `5s × число_чатов` до ответа `{ok:true}`. | Шлёгнуть/Skip: ограничить суммарный бюджет отправки; либо отвечать сразу, а доставку вынести в фон. | ПРОЙДЕНО (код прочитан) |
| 5 | мелочь | `src/app/api/orion/lead/route.ts:83,100` | В лог пишутся `name`, `contact`, `message` заявки; ключ `contact` не матчится фильтром логгера (`logger.ts:57-62` ищет `phone|email|token…`). | При отсутствии `DEFAULT_TENANT_ID` (:83) или сбое записи в БД (:100) телефон/почта клиента попадут в логи в открытом виде (ПДн). | Не логировать `contact`/`name` (достаточно `leadId`) или маскировать значения. | ПРОЙДЕНО |
| 6 | мелочь | `src/core/notifications/telegram.ts:217-219` | `429` классифицируется как временная ошибка, но `parameters.retry_after` из ответа Telegram не читается. | Telegram вправе держать `429` дольше, чем бэкофф outbox (1с…60с): 5 попыток могут уйти в DLQ раньше, чем лимит снят. | Учитывать `retry_after` в `nextRetryAt` для статуса 429. | ПРОЙДЕНО |
| 7 | мелочь | `src/core/notifications/telegram.ts:417-423` | `testConnection` (кнопка «Тест») проверяет только `response.ok`, но не `data.ok`. | Асимметрия с `sendMessage`, где тело `{"ok":false}` считается провалом (`:259-260`). Прокси, отдающий HTTP 200 с `ok:false`, покажет «Тест пройден» ложно. | Проверять `data.ok !== true` и возвращать ошибку через `describeTelegramError`. | ГИПОТЕЗА (Bot API штатно отдаёт 4xx; не проверял ответы конкретного прокси) |
| 8 | мелочь | `src/core/outbox/dead-letter-queue.ts:157-162` | `discardDlqEntry` делает `update` без `where status='pending'` (в отличие от `retryDlqEntry:123-127`). | Можно перевести уже `resolved` запись в `discarded` (потеря статуса); в UI кнопки есть только у `pending`, но API открыт. | Добавить условие `status:'pending'` (или возвращать `false` при отсутствии захвата). | ПРОЙДЕНО |
| 9 | мелочь | `src/core/outbox/dead-letter-queue.ts:164-197`; `src/app/api/admin/dlq/route.ts:65-78` | `getDlqStats`/`getPendingDlqEntries` и выборка `resolved/discarded` не фильтруются по `tenantId` (в `attachReportInfo` организации указывается строго). | **Сегодня дефектом не является:** право `dlq.manage` выдано только роли `ADMIN` (`authorization-service.ts:133`), а ADMIN по решению владельца видит все организации. Станет утечкой между организациями, если право получит не-платформенная роль. | При появлении второй организации/не-ADMIN роли — добавить `tenantId` в эти запросы. | ПРОЙДЕНО (в рамках доверительной модели) |
| 10 | мелочь | `src/core/outbox/dead-letter-queue.ts:117-155` + `telegram.ts:233-265,101-119` | Повтор PDF/сообщения в Telegram не идемпотентен. Частичная доставка смягчена (`telegramDeliveredChatIds`), но «неоднозначный» сбой (сообщение дошло, подтверждение — нет) при «Повторе» отправит его второй раз. | Пользователь может получить дубль PDF/сообщения. Смягчено: подтверждённые чаты пропускаются, UI предупреждает (`admin-dlq.tsx:143-154`). | Осознанно принято (комментарий `durable-alert-delivery.ts:40-42`); при желании — писать в текст события `id` и просить пользователей сверять. | ПРОЙДЕНО (риск задокументирован в коде) |
| 11 | мелочь | `src/services/reports/outbox-publisher.ts:27,171` + `telegram.ts:217-232` | Единственный чат с **постоянной** ошибкой (напр. `chat not found`) выключается, но текущее событие всё равно возвращает `false` → 5 бесполезных повторов и DLQ. | На следующих попытках `getConfigs` вернёт `[]` (конфиг выключен), и повторы будут снова падать. Шум в DLQ, но без потери данных. | Если `deliverToAll` не осталось рабочих чатов и есть только `permanent` — считать доставку исчерпанной без ретраев. | ПРОЙДЕНО |
| 12 | мелочь | `src/core/notifications/telegram.ts:239,277,409`; `scripts/validate-env.ts:129-143` | При отсутствии `TELEGRAM_API_BASE` по умолчанию берётся `https://api.telegram.org`. Проверка окружения только **предупреждает**, не роняет сборку. | На боевом сервере (провайдер блокирует api.telegram.org) все отправки будут падать в таймаут → DLQ. Предупреждение легко пропустить в логах сборки. | Считать `TELEGRAM_API_BASE` обязательной в `NODE_ENV=production` (ошибка, не warning) либо мониторить долю неуспешных отправок. | ПРОЙДЕНО |
| 13 | мелочь | `src/core/outbox/dead-letter-queue.ts:145-146` | Для записей DLQ с `consumer = NULL` (до 25.09.2026) повтор ставит `published:false` и `projected:false` — событие поднимают **оба** потребителя. | Проекции отфильтруют не свои типы (`projection-worker.ts:26-53`), поэтому вред маловероятен; риск ограничен устаревшими строками. | Для строк без `consumer` выбирать потребителя по типу события либо ставить `projected:true` как у доставок. | ПРОЙДЕНО (код), вероятность низкая |

Приложение к находке #9: остальные места отбора без `tenantId` — `src/app/api/admin/dlq/route.ts:74` (статусы `resolved/discarded/all`).

## Ответы на вопросы задания

**(1) Таймауты и повторы; что ошибка, что успех.**
`sendMessage`/`getChat` — `AbortSignal.timeout(5000)` (`telegram.ts:242,411`); `sendDocument` — `Math.min(30_000, deadline - now)`, общий бюджет 45 с (`telegram.ts:274,287,391`). Успех — только HTTP `ok` **и** тело `{"ok":true}` (`telegram.ts:259-260,293-294`). Ошибка: сеть/таймаут → `false` (временная); `429`, `5xx` → `false` (временная); `401`, `403` → **постоянная**; `400` с `chat not found|bot was blocked|user is deactivated|not a member|chat_write_forbidden` → **постоянная**, иначе временная (`telegram.ts:217-232`). Постоянная ошибка выключает конфиг и пишет причину в `label`. Ответы `ok:false` с корректным `error_code` обрабатываются так же (через `recordTelegramFailure`). — ПРОЙДЕНО.

**(2) Куда попадает недоставленное и через сколько попыток.**
Отчёты/тревоги: `MAX_RETRIES = 5` (`outbox-publisher.ts:27`); при `attempts ≥ 5` — `moveToDlq` (`outbox-publisher.ts:171-191`) в таблицу `DeadLetterQueue` (`prisma/schema.prisma:2835`), с best-effort алертом в Telegram (если включён `deliveryFailures`). Заявки ОРИОН: **никуда** — только `OrionLead.deliveryError` (`prisma/schema.prisma:2888`, `orion/lead/route.ts:139-148`), повторов нет. — ПРОЙДЕНО.

**(3) Кнопка «Повтор»: права, двойное нажатие, двойная доставка.**
Права: `assertCan(user,'dlq.manage')` (`dlq/route.ts:111`), право только у `ADMIN` (`authorization-service.ts:133`). Двойное нажатие: клиентский guard `if (actingId) return` (`admin-dlq.tsx:198`) + `disabled` на текущей кнопке (`:390,400`); серверный — транзакционный захват `updateMany({where:{id,status:'pending'}})` с `count===0 → false` (`dead-letter-queue.ts:123-127`), поэтому повторный/параллельный запрос вернёт 400 и второй раз в очередь **не** поставит. Двойная доставка: два клика её не создают; остаточный случай — неоднозначный сетевой сбой (см. #10). — ПРОЙДЕНО.

**(4) Токены ботов: шифрование и смена ключа.**
Токен пишется только через `encrypt` (`telegram-config-service.ts:83,122`, `encryption.ts:132`), AES-256-GCM, формат `enc:`/`enc:vN:`. Наружу никогда не отдаётся — только `botTokenHint` (хвост) и `hasBotToken` (`telegram-config-service.ts:30-70`). При смене ключа без старого: `keyForVersion` бросает (`encryption.ts:111-121`); `listTelegramConfigs` деградирует мягко («без токена», `:46-57`), а `telegram.ts:getConfigs` глушит целиком → см. #2. — ПРОЙДЕНО.

**(5) Утечки токена в логи и ответы.**
В логи/ответы токен как значение не пишется: логируются `configId/tenantId/chatId/reason` (`telegram.ts:230,255`), ответы настройкам — без токена. Риск — полный URL с токеном (#1, ГИПОТЕЗА). `logger` маскирует `botToken` (ключ `token$`, `logger.ts:60`), но не содержимое `error`/`url`. — ПРОЙДЕНО, кроме #1 (не проверено).

**(6) Как проверить без реального Telegram.**
`TELEGRAM_API_BASE` читают ровно три места: `telegram.ts:239,277,409` (плюс предупреждение `validate-env.ts:130` и тестовый стаб `tests/integration/disposable-m6-m8.spec.ts:86`). Значение берётся из `process.env` в момент запроса, поэтому заглушку можно подставлять и `vi.stubEnv`, и переменной окружения на сервере. Чтобы заглушка отвечала «как Bot API», она должна принимать (без лишнего слэша на конце базы — URL строится как `${base}/bot<token>/<method>`):
1. `POST {base}/bot<token>/sendMessage`, JSON `{chat_id,text,parse_mode,disable_web_page_preview}` → `200 {"ok":true,"result":{"message_id":1,"date":...,"chat":{...},"text":"..."}}`;
2. `POST {base}/bot<token>/sendDocument`, `multipart/form-data` с полями `chat_id`, `caption` (опц.), `parse_mode` (опц.), `document` (файл) → `200 {"ok":true,"result":{...}}`;
3. `POST {base}/bot<token>/getChat`, JSON `{chat_id}` → `200 {"ok":true,"result":{"id":...,"title":"...","type":"..."}}` (для личного чата — `first_name`).

Ошибки можно отдавать либо HTTP `4xx` с телом `{"ok":false,"error_code":400,"description":"..."}`, либо HTTP `200` с `ok:false` (код обрабатывает оба на `sendMessage`/`sendDocument`; для `getChat` — только HTTP-статус, см. #7). Заглушка должна отвечать быстрее 5 с для `sendMessage`/`getChat` и быстрее 30 с для `sendDocument`. Готовый пример стаба `fetch` + `TELEGRAM_API_BASE` есть в `tests/integration/disposable-m6-m8.spec.ts:79-108`. — ПРОЙДЕНО.

## Подтверждено (работает правильно)

1. Single-flight outbox-воркера защищает от дублей PDF при медленной отправке (`outbox-publisher.ts:261-307`).
2. Построчный `FOR UPDATE` + проверка `published` внутри транзакции делают повтор доставки no-op (`durable-alert-delivery.ts:43-56`, `event-handlers.ts:658-670`).
3. Частичная доставка сохраняется в `payload.telegramDeliveredChatIds` и переживает рестарт (`telegram-delivery-progress.ts:9-23`, тест M7 `disposable-m6-m8.spec.ts:79-108`).
4. Двойное нажатие «Повтор» даёт ровно один POST (`admin-dlq.test.tsx:195-215`).
5. События-доставки не попадают в проекции (`projection-worker.ts:26-53`), поэтому повтор DLQ не портит проекции.

## Не проверено

- Не открывал конфигурацию прокси `TELEGRAM_API_BASE` и настройки Sentry — поэтому #1 (логирование полного URL с токеном) и #7 (поведение прокси на `getChat`) имеют статус ГИПОТЕЗА. Причина: значения лежат в `.env*`/внешней инфраструктуре, а Правила запрещают читать `.env*` и ходить на прод.
- Не запускал `npx tsc --noEmit`, `npm run lint`, полный `npm run test:unit`, `npx playwright test --list`, `npm run build`: аудит только для чтения, код приложения не менялся. Прогнаны только три профильных юнит-теста (71 passed). Возможные скрытые эффекты сборки/типов не проверялись.
- Не проверял фактические данные в боевой БД (`DeadLetterQueue`, `OrionLead`, `TelegramConfig`) — правило «не подключаться к прод-базе».
- Наблюдение к «доверительной модели»: `dlq.manage` выдан только `ADMIN`, поэтому #9 сегодня не дефект; при выдаче права другой роли отборы DLQ нужно ограничить `tenantId`.
