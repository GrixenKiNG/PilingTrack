# Карта уведомлений PilingTrack — что, чем, когда и что при сбое

## Итог

Система шлёт сообщения только в Telegram (прямым `fetch` к Bot API) и во внутриприложенную ленту `FeedbackEvent` (запись в БД). E-mail — заглушка в мёртвом realtime-движке. Найдено **10 видов сообщений** (8 Telegram + 1 in-app + 1 e-mail-заглушка). По серьёзности: **1 критично, 4 важно, 4 мелочь**.

Топ-5:
1. **Критично** — PDF отчёта в Telegram уходит «в никуда» при сбое: обработчик глотает ошибку, outbox помечает событие опубликованным, повторной доставки нет (только строка в логе). Это главный канал диспетчеру.
2. **Важно** — realtime-движок алертов (high/critical downtime) шлёт Telegram без проверки настроек тенанта и считает простой в минутах, хотя он в часах. Сейчас это мёртвый код (никто не вызывает `startRealtimePublisher`), но при подключении сработает и не по тем порогам, и вопреки выключателю.
3. **Важно** — переключатель `planDeviation` есть в UI и включён по умолчанию, но отправителя у него нет (честно подписано «Отправитель не реализован»).
4. **Важно** — шапка Telegram-алертов на английском («High Alert / Site / Report / Rule») в русскоязычном продукте.
5. **Важно** — происшествие (incident) из operator-mobile пишет durable-алерт без `ruleId`, поэтому его не гасит ни один переключатель настроек.

Единицы в текстах уведомлений согласованы с решением владельца: «м/ч» и «шт/м.п.» (не найдено «м.ч.»/«шт/м» в путях уведомлений). Несогласованность — только в мёртвом realtime-движке («мин»).

## Методика

Прочитаны все файлы из скоупа задачи: `src/core/notifications/**` (telegram.ts, durable-alert.ts, index.ts), `src/services/notifications/durable-alert-delivery.ts`, `src/services/reports/event-handlers.ts`, `src/services/reports/domain-events.ts`, `src/services/reports/outbox-publisher.ts`, `src/modules/settings/**` (domain/settings.ts, application/settings-service.ts, index.ts), `src/modules/readiness/application/scheduler.ts`, `src/modules/readiness/application/defects/commands.ts`, `src/core/outbox/dead-letter-queue.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/feedback/**`, `src/app/api/settings/route.ts`, `src/app/api/notifications/telegram/test/route.ts`, `src/workers/**` (unified-worker.ts, unified-worker/{outbox,pm-scheduler,readiness-scheduler,pdf,config}.ts, embedded-workers.ts, outbox-worker.ts, projection-worker.ts, register-readiness-projection.ts), `src/core/realtime/alerts/{engine,rules}.ts`, `src/core/realtime/publisher/ws-publisher.ts`, `src/modules/equipment/application/commands/pm-scheduler.ts`, `src/components/piling/workspace-settings.tsx`.

Поиски (rg по `src/`): `telegramNotifier` (33 совпадения — все отправители), `enqueueAlert|enqueueCriticalDefects|deliverQueuedAlert|NotificationDeliveryRequested`, `NOTIFICATION_KEYS|planDeviation|downtime30|maintenanceOverdue|criticalDefect|newReports`, `startRealtimePublisher|ws-publisher|publishPendingEvents`, `from '@/core/realtime'`, `nodemailer|sendMail|SMTP|notifyEmail`, `м\.ч\.|м/ч|шт/м|шт/м\.п\.|м\.п\.`.

Проверка «мёртвости» realtime-движка: текстовый поиск по всему репо показал, что `startRealtimePublisher` объявлен только в `ws-publisher.ts:175` и ре-экспортирован в `realtime/index.ts:19`, а `@/core/realtime` импортируется только собственными тестами. Производственных вызовов нет. Это противоречит утверждению из `docs/audits/hermes-night/05-dead-code-inventory.md:26` о «сотнях потребителей» — там это была оговорка про ненадёжность `findReferences`, но текстовая проверка её не подтверждает.

## Находки

### Таблица сообщений (одна строка на вид)

| # | Вид | Триггер (path:line) | Текст (path:line) | Выключатель | Доставка | При сбое | Дубли |
|---|---|---|---|---|---|---|---|
| 1 | Telegram: PDF отчёта | событие `ReportSubmitted` (event-handlers.ts:277,288); автозакрытие смены тоже шлёт `ReportSubmitted` (readiness/application/scheduler.ts:192-211) | event-handlers.ts:348-365 (русский, «Отчёт отправлен»/«Корректировка»/«Смена закрыта автоматически») | `newReports` (event-handlers.ts:295; по умолчанию **false**, settings.ts:63) | прямой `sendDocument` (event-handlers.ts:370) внутри outbox-воркера | **только лог**: try/catch глотает (event-handlers.ts:371-375), outbox помечает `published` — повторной доставки нет | низкий: есть фильтр «новых pending» (event-handlers.ts:305-320); но outbox-реплей может переслать |
| 2 | Telegram: простой >2ч | событие `DowntimeAdded` (event-handlers.ts:187,190) | event-handlers.ts:220 «Простой N ч зафиксирован в отчёте» | `downtime30` (event-handlers.ts:202; по умолч. true) | прямой `sendAlert` (event-handlers.ts:218) | **только лог**: catch глотает (event-handlers.ts:224-232), outbox помечает published | низкий |
| 3 | Telegram: просроченные ТО | cron, раз в сутки (pm-scheduler.ts:85-93) | pm-scheduler.ts:41-54 «Просрочено регламентов ТО: N…» | `maintenanceOverdue` (pm-scheduler.ts:34; по умолч. true) | прямой `sendAlert` (pm-scheduler.ts:51) | **только лог**: catch глотает (pm-scheduler.ts:55-60) | средний: двойной прогон в сутки перешлёт то же сообщение (нет дедупа по тексту) |
| 4 | Telegram: опасный дефект | дефект HIGH/CRITICAL зафиксирован (readiness/defects/commands.ts:141; operator-mobile/checklist.ts:266) | durable-alert.ts:27-28 «Опасный дефект установки…» | `criticalDefect` (durable-alert-delivery.ts:18; по умолч. true) | **durable**: outbox-событие `NotificationDeliveryRequested` (durable-alert.ts:12-15) → воркер → deliverQueuedAlert (durable-alert-delivery.ts:14-24) | **retry + DLQ**: бросает ошибку (durable-alert-delivery.ts:21), outbox backoff → DLQ после 5 попыток (outbox-publisher.ts:173-198) | средний: у Telegram нет идемпотентности, неоднозначный сетевой сбой может повторить (durable-alert-delivery.ts:12-13) |
| 5 | Telegram: происшествие (incident) | operator-mobile/incidents.ts:119 | incidents.ts:121 «Происшествие: …» | **нет** — `ruleId` не задан, а deliverQueuedAlert гасит только `criticalDefect` (durable-alert-delivery.ts:18) | **durable** (enqueueAlert, incidents.ts:119) | retry + DLQ (как #4) | средний (как #4) |
| 6 | Telegram: DLQ-алерт | outbox-событие исчерпало MAX_RETRIES (dead-letter-queue.ts:72-78) | dead-letter-queue.ts:74-76 «Dead Letter Queue…» | **нет** | прямой `sendMessage`, fire-and-forget (`void`, `.catch` игнор, dead-letter-queue.ts:72-78) | **игнорируется** (`.catch(()=>{})`) | низкий: moveToDlq пишет один раз (комментарий dead-letter-queue.ts:55-61) |
| 7 | Telegram: Alertmanager webhook | POST /api/alerts/webhook (route.ts:84) | route.ts:109-117 (summary/description из Alertmanager) | **нет** | прямой `sendAlert` на каждый firing-алерт, MAX_FORWARDED=100 (route.ts:100,113) | **теряется**: `sendAlert` вернул false — `forwarded` не растёт, но route всегда отвечает 200 (route.ts:122), Alertmanager не перешлёт | низкий: 400 (невалидный payload) заставит Alertmanager повторить пачку (комментарий route.ts:54-57) |
| 8 | Telegram: realtime-движок (high/critical downtime, zero-production) | realtime-события через ws-publisher (ws-publisher.ts:54 → engine.ts:37) | rules.ts:87-89,104-106,127-128 | **нет** — engine.ts:134-157 не зовёт isNotificationEnabled | прямой `sendAlert` (engine.ts:143) | **только лог** (engine.ts:151-156) | средний (cooldown 30/60 мин, rules.ts:91,108) |
| 9 | E-mail (заглушка) | realtime-движок, правило с `notify:['email']` (engine.ts:122-124) | — | — | **не отправляется**: `notifyEmail` только пишет warn «transport not configured» (engine.ts:159-170) | — | — |
| 10 | In-app: FeedbackEvent | POST /api/feedback/events (route.ts:77,147) | title/message из запроса (route.ts:29-30) | **нет** (не уведомление, а лента) | запись в `FeedbackEvent` (feedback-event-service.ts:91-110) | **durable**: строка в БД, читается/подтверждается (route.ts:92-135) | низкий |

### Находки по серьёзности

| # | Серьёзность | path:line | Проблема | Сценарий / почему важно | Предложенный фикс |
|---|---|---|---|---|---|
| 1 | критично | event-handlers.ts:370-375 | PDF отчёта в Telegram не durable: обработчик глотает ошибку, outbox помечает `published` — при сбое Telegram отчёт теряется навсегда, остаётся только лог | Диспетчер не получает главный документ смены; повторной доставки нет, DLQ не задействован. (Задача: PDF-отправку сейчас переделывает Claude — описание как есть, фикс не предлагаю.) | — (переделывается) |
| 2 | важно | engine.ts:134-157; rules.ts:86,89,103,106 | realtime-движок шлёт Telegram без проверки `isNotificationEnabled` и трактует простой в минутах (`duration > 120`, «Простой Nмин»), тогда как реальная длительность в часах (event-handlers.ts:191-193) | Если движок когда-нибудь подключат, алерты пойдут вопреки выключателю `downtime30` и по неверным порогам (2ч = 120 «минут» — сработает только на 120+ часов) | Проверять `isNotificationEnabled` перед отправкой; привести пороги/текст к часам |
| 3 | важно | settings.ts:48,58; workspace-settings.tsx:222,278 | `planDeviation` есть в UI и включён по умолчанию, но отправителя нет (implemented:false) | Администратор видит включённый тумблер «Отклонения по плану (±10%)», который ничего не делает. UI честно подписывает «Отправитель не реализован» (workspace-settings.tsx:228), но тумблер по умолчанию включён | Либо реализовать отправителя, либо выключить по умолчанию |
| 4 | важно | telegram.ts:107-122 | Шапка Telegram-алертов на английском: «High Alert», «Site:», «Report:», «Rule:», severity «Info/Warning/High/CRITICAL» | Касается всех алертов (простой, ТО, дефект, Alertmanager) в русскоязычном продукте | Локализовать шаблон |
| 5 | важно | incidents.ts:119-122; durable-alert-delivery.ts:18 | Происшествие пишет durable-алерт без `ruleId`, поэтому его не гасит ни один переключатель настроек | Нет способа отключить уведомления о происшествиях. (operator-mobile — замороженная зона, не трогаю) | Задать `ruleId` и проверять его в deliverQueuedAlert |
| 6 | мелочь | dead-letter-queue.ts:72-78; route.ts:113 | DLQ-алерт и Alertmanager-webhook шлют Telegram независимо от настроек тенанта | Инфраструктурные алерты, вероятно, намеренно вне настроек, но переключателя нет | Сознательно оставить; задокументировать |
| 7 | мелочь | realtime/index.ts:19; ws-publisher.ts:175 | `startRealtimePublisher` не вызывается нигде в проде — весь realtime-движок (в т.ч. e-mail-заглушка и Telegram-алерты #8, #9) мёртвый код | Противоречит 05-dead-code-inventory.md:26 («сотни потребителей»); текстовая проверка показывает отсутствие импортов `@/core/realtime` вне тестов | Подключить или удалить; не считать «живым» |
| 8 | мелочь | pm-scheduler.ts:70-76 | Сводное сообщение о просроченных ТО не дедуплицируется по тексту: двойной суточный прогон перешлёт то же сообщение | Редкий сценарий (два запуска воркера в сутки), но дубль возможен | Дедуп по (tenantId, дата) |
| 9 | мелочь | settings.ts:63 | `newReports` по умолчанию **false** — главный канал (PDF отчёта) выключен, пока админ не включит | Не баг, но стоит знать: «Новые отчёты и сводки» — opt-in | — |

## Не проверено

- **operator-mobile** (`incidents.ts`, `checklist.ts`) — замороженная зона (AGENTS.md §1). Читал для описания, но не редактировал; полный разбор их уведомлений не делал.
- **ORION lead → Telegram** (`src/app/api/orion/lead/route.ts:128`) — замороженная зона (orion). Это публичная форма, не настройка тенанта; упомянул, но в таблицу не включал.
- **Фактическая отправка в проде** — не проверял (нет доступа к проду/БД). Все выводы о «мёртвости» realtime-движка — по текстовому поиску в репо, не по рантайму.
- **Настройки Telegram-бота** (`TelegramConfig`, `AdminTelegram`) — вне скоупа задачи; не проверял, как именно админ задаёт chatId/токен.
- **`src/modules/maintenance/**`** — такого каталога нет; ТО/наряды живут в `src/modules/equipment` (pm-scheduler) и `src/modules/readiness`. Проверено там.
- **E-mail** — единственная заглушка в realtime-движке (мёртвый код); других SMTP/SES-путей не нашёл. UI-карточка «Электронная почта: SMTP не подключён» (notifications-section.tsx:120) — только индикация, отправителя нет.
