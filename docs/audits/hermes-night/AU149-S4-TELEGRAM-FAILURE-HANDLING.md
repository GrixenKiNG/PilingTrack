# AU149-S4-TELEGRAM-FAILURE-HANDLING — Telegram: сбои доставки

Версия: `279a54e47a71249a9c7684c34273a2c6c8418cc5` (`git rev-parse HEAD`).
Только чтение; код приложения не менялся.

## Итог

Аудит пути доставки Telegram: `src/core/notifications/telegram.ts` (отправка, классификация отказов, прокси
`TELEGRAM_API_BASE`), `durable-alert-delivery.ts` и `event-handlers.ts` (доставка через outbox),
`outbox-publisher.ts` + `dead-letter-queue.ts` (повтор и DLQ), `lag-monitor.ts`/`/api/metrics` (метрики),
`/api/admin/dlq` + экран DLQ (что видит админ).

Всего находок: 18 — критично 1, важно 7, мелочь 10.

Главное: **сигнала «доставка сломалась» у админа нет ни в одном независимом канале.** Алерт о попадении
события в DLQ отправляется тем же Telegram-ботом, что и упавшее сообщение
(`src/core/outbox/dead-letter-queue.ts:94-106`). Если канал авто-отключён при постоянной ошибке
(`src/core/notifications/telegram.ts:212`) или Telegram/прокси недоступен, у админа остаётся только ручной
обход `/admin/dlq`; письма/иного канала в коде нет. Плюс три пути (простой, ТО-просрочка, webhook-хвост)
не имеют ни повтора, ни DLQ, либо глушат результат отправки.

Ещё три системных вывода:
1. При сбое через прокси дольше 5 с (единый `AbortSignal.timeout(5000)`, `telegram.ts:230`) любая отправка
   считается «временной», а окно повторов outbox — всего ~30 с (2+4+8+16 с), после чего всё уходит в DLQ.
2. Запись в DLQ по этому событию несёт обобщённый текст (`durable-alert-delivery.ts:58`,
   `event-handlers.ts:671`), а не реальную причину Telegram — админ видит «Причина не опознана».
3. Отправка до 100 алертов Alertmanager идёт `await`-ом внутри одного HTTP-запроса
   (`src/app/api/alerts/webhook/route.ts:160-163`) — суммарно до сотен секунд.

## Методика

Ручные точечные чтения (не автоматический сканер). Что и как искал:

- Файлы ядра: `src/core/notifications/{telegram.ts,durable-alert.ts,telegram-delivery-progress.ts,index.ts}`.
- Обработчики и outbox: `src/services/notifications/durable-alert-delivery.ts`,
  `src/services/reports/{event-handlers.ts,domain-events.ts,outbox-publisher.ts}`,
  `src/workers/unified-worker/outbox.ts`, `src/core/outbox/dead-letter-queue.ts`.
- Точки входа: `src/app/api/alerts/webhook/route.ts`,
  `src/app/api/notifications/telegram/test/route.ts`, `src/app/api/telegram/configs/route.ts`,
  `src/workers/unified-worker/pm-scheduler.ts`.
- Метрики/наблюдаемость: `src/core/observability/lag-monitor.ts`,
  `src/core/observability/health-tracker/checkers/outbox.ts`, `src/app/api/metrics/route.ts`.
- Экран админа: `src/app/(app)/admin/dlq/page.tsx`, `src/app/api/admin/dlq/route.ts`,
  `src/components/piling/admin-dlq.tsx`, `src/components/piling/admin-telegram.tsx`,
  `src/services/telegram/telegram-config-service.ts`.
- Поиск прокси: `grep -rn "TELEGRAM_API_BASE"` по `src scripts docs *.yml` — только `telegram.ts:227,265,397`,
  `scripts/validate-env.ts:130`, `docker-compose.yml:91,184`, runbook.
- Арифметику backoff и бюджета транзакции считал `node -e` (числа в находках — из этого вывода):
  delays 2000/4000/8000/16000, сумма 30000 мс; `60000/5000 = 12`.

Повторить можно теми же `read_file`/`grep` по перечисленным путям.

## Таблица сценариев доставки (сценарий | повтор | DLQ | что видит админ | метрика)

Термины: «outbox» — фоновый воркер `consumeOutboxEvents('published', …)`
(`src/services/reports/outbox-publisher.ts:87-237`).

| Сценарий | Повтор | DLQ | Что видит админ | Метрика |
|---|---|---|---|---|
| Критический дефект / происшествие (`NotificationDeliveryRequested`) | outbox, 5 попыток, backoff 2/4/8/16 с (~30 с) — `outbox-publisher.ts:26,35-41,210-232` | да, `moveToDlq` — `outbox-publisher.ts:177-193` | экран `/admin/dlq` (`src/app/api/admin/dlq/route.ts:51-99`, `admin-dlq.tsx`); best-effort Telegram-алерт из DLQ — `dead-letter-queue.ts:94-106` | `dlq_pending_count` (`lag-monitor.ts:364-366`), `outbox_pending_count` (`lag-monitor.ts:348-350`) |
| PDF отчёта (`ReportPdfDeliveryRequested`) | тот же outbox — `event-handlers.ts:598-671` | да | тот же экран DLQ (метка типа — `admin-dlq.tsx:76`) | те же |
| Простой (`DowntimeAdded`) | **нет** — прямой `sendAlert`, ошибка глушится `try/catch` — `event-handlers.ts:405-442` | **нет** | только строка в логе (`logger.error`, `event-handlers.ts:438-441`) | нет отдельной |
| Alertmanager webhook | синхронно в HTTP-запросе + хвост через outbox — `webhook/route.ts:160-163` | да, по outbox | 503 от вебхука (`webhook/route.ts:170-176`) + `/admin/dlq` | HTTP-метрики `withApi`; DLQ-метрика |
| ТО просрочено (планировщик) | **нет**; результат `sendAlert` **не проверяется** — `pm-scheduler.ts:53-58` | **нет** | ничего (ни лога, ни Sentry при `false`) | нет |
| Кнопка «Тест» канала | нет (один `getChat`) — `telegram.ts:392-415` | нет | русский текст из `describeTelegramError` — `telegram.ts:320-327` | нет |
| Прокси `TELEGRAM_API_BASE` дал >5 с | `fetch` обрывается, `return false` (временная) — `telegram.ts:230,249-252` | да, после 5 попыток | generic-текст в DLQ | та же |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать |
|---|---|---|---|---|---|
| 1 | критично | `src/core/outbox/dead-letter-queue.ts:94-106` | Алерт «событие в DLQ» шлётся тем же Telegram-ботом, что и упавшее сообщение, и его результат гасится (`void … .catch(() => {})`) | Если канал авто-отключён (`telegram.ts:212`) или Telegram/прокси лежит — уведомление о сбое не уходит никуда; внешнего канала (почта/SMS/webhook) в коде нет. Владелец узнаёт о сбое только открыв `/admin/dlq` вручную. Статус: ПРОЙДЕНО (код прочитан) | Продублировать сигнал о непустом DLQ независимым каналом (почта/метрика-Prometheus алертом в Alertmanager); не считать запись в логе доставкой |
| 2 | важно | `src/workers/unified-worker/pm-scheduler.ts:53-58` | `await telegramNotifier.sendAlert(...)` — возвращаемый `boolean` не проверяется; `sendAlert` не бросает, а возвращает `false` при полном отказе (`telegram.ts:337-357`) | Просроченное ТО: при недоставке нет ни `logger`, ни `Sentry`, ни повтора, ни DLQ. Молчаливая потеря — `catch` ловит только исключения, которых тут не будет. Статус: ПРОЙДЕНО | Проверить результат и логировать/эскалировать при `false`; провести доставку через outbox, как критический дефект |
| 3 | важно | `src/services/reports/event-handlers.ts:405-442` | Алерт о простое отправляется прямым `sendAlert` внутри обработчика, сбой гасится `try/catch` (стр. 434-442) | В отличие от дефекта (`durable-alert-delivery.ts`) и PDF, у простоя нет повтора и нет DLQ — недоставленное сообщение исчезает бесследно. Статус: ПРОЙДЕНО | Проводить через `enqueueAlert`/outbox, как `NotificationDeliveryRequested` |
| 4 | важно | `src/core/notifications/telegram.ts:230` | Единый жёсткий таймаут `AbortSignal.timeout(5000)` на `sendMessage`; не настраивается | На бою `TELEGRAM_API_BASE` — прокси-воркер (runbook `docs/runbooks/014-post-deploy-2026-10.md:153`, `docker-compose.yml:91`). Ответ прокси дольше 5 с = обрыв; ошибка классифицируется как временная (`telegram.ts:249-252`) и уходит в 5 повторов. Статус: ГИПОТЕЗА (реальной задержки прокси не измерял) | Сделать таймаут настраиваемым (env), учесть задержку прокси |
| 5 | важно | `src/services/reports/outbox-publisher.ts:26-41` | Окно повторов ~30 с (2+4+8+16 с; посчитано `node -e`), затем DLQ | Сетевой сбой/обслуживание прокси длиннее ~минуты переводит все уведомления в DLQ, требующий ручного «Повтор» (`admin-dlq.tsx:386-395`). Для алертов о безопасности восстановление не автоматическое. Статус: ГИПОТЕЗА (числа из кода, поведение в проде не наблюдал) | Увеличить число попыток/базу backoff или ввести периодический авто-повтор DLQ |
| 6 | важно | `src/services/notifications/durable-alert-delivery.ts:58`; `src/services/reports/event-handlers.ts:671` | При исчерпании попыток бросается обобщённая ошибка («Telegram delivery failed; retained for retry» / «Telegram не принял PDF…»); реальная причина/код Telegram остаются только в логе | В DLQ (`dead-letter-queue.ts:55,64`) уходит именно текст исключения, поэтому `hintForError` (`admin-dlq.tsx:100-132`) не распознаёт причину и показывает «Причина не опознана». Админ не понимает, поможет ли «Повтор». Статус: ПРОЙДЕНО | Пробрасывать в исключение код/краткую причину, чтобы DLQ-запись была осмысленной |
| 7 | важно | `src/app/api/alerts/webhook/route.ts:60,160-163` | До 100 алертов шлются `await`-ом последовательно внутри одного HTTP-запроса (+ `db.$transaction` c таймаутом 60 с в `durable-alert-delivery.ts:57`) | Худший случай — минуты на запрос; Alertmanager по таймауту получит ошибку и повторит (дедуп по `dedupeKey` защищает от дублей, `webhook/route.ts:143-158`). Запрос висит, воркер занят. Статус: ГИПОТЕЗА (оценка сверху, не измерял) | Постановка в outbox без синхронной отправки либо ограничить синхронный батч единицами |
| 8 | важно | `src/core/observability/lag-monitor.ts:274-283,364-366`; `src/core/observability/health-tracker/checkers/outbox.ts:34-45` | Нет метрики, специфичной для доставки Telegram (число отказов, число отключённых каналов). Есть только `dlq_pending_count` и `outbox_pending_count` | Отключение всех каналов (`enabled:false`, `telegram.ts:214`) не видно в метриках и на дашбордах — только в настройках и в логе `logger.warn` (`telegram.ts:218`). Статус: ПРОЙДЕНО (проверил `grep telegram` по `src/core/observability` — совпадений нет) | Добавить счётчик отказов доставки и gauge числа активных каналов |
| 9 | важно | `src/core/notifications/telegram.ts:106,340` | При отсутствии включённых каналов `deliverToAll` возвращает `false`, а `sendAlert` пишет один `logger.warn` «Telegram not configured — skipping alert» | После авто-отключения единственного канала (постоянная ошибка) каждый следующий алерт: `false` → outbox-повтор → DLQ. Алерт о DLQ снова не уходит (#1). Функционально «тихий» режим. Статус: ПРОЙДЕНО | Различать «не настроено» и «все каналы отключены сбоем»; второй случай эскалировать внешним каналом |
| 10 | мелочь | `src/core/notifications/telegram.ts:9` | Докстрока обещает «Rate limiting (max 30 msg/sec to Telegram API)» — в коде никакого троттлинга нет | Вводит в заблуждение при разборе сбоев; при всплеске (catch-up outbox) отправки идут подряд без пауз. Статус: ПРОЙДЕНО | Убрать обещание из докстроки либо реализовать ограничение |
| 11 | мелочь | `src/core/notifications/telegram.ts:205-206` | Ответ `429 Too Many Requests` считается временным (нет в списке `permanent`) и `retry_after` из тела не учитывается | Повтор без учёта `retry_after` может продлевать flood-control Telegram. Статус: ГИПОТЕЗА | Разбирать `parameters.retry_after` и выдерживать паузу |
| 12 | мелочь | `src/core/notifications/telegram.ts:214` | При постоянной ошибке в поле пользователя `label` дописывается `« — <причина>»` и `enabled=false` | `label` — пользовательское поле; после «Включить» и повторного сбоя суффикс накапливается, оригинальная подпись теряется. Значение видно на экране (`admin-telegram.tsx:340,361`). Статус: ПРОЙДЕНО | Хранить причину в отдельном поле/логе, не портить `label` |
| 13 | мелочь | `src/app/api/notifications/telegram/test/route.ts:29` | Кнопка «Тест» требует `reports.read_all` (ADMIN/DISPATCHER/FOREMAN/SAFETY_ENGINEER — `authorization-service.ts:64`), тогда как сама настройка требует `telegram.manage` = только ADMIN (`authorization-service.ts:130`) | Несогласованность прав: диспетчер может дёргать тест канала, хотя управлять каналом не вправе. Эффект — только чтение `getChat`, низкий. Статус: ПРОЙДЕНО | Использовать `telegram.manage` и на тесте |
| 14 | мелочь | `src/services/reports/outbox-publisher.ts:320-329` | `getOutboxStats().failed` считает `published:false AND attempts>=MAX_RETRIES`, но при исчерпании попыток строка помечается `published=true` (`outbox-publisher.ts:200-209`) | Метрика `failed` структурно всегда 0 — счётчик «упавших» не работает как задумано (реальный сигнал идёт через `dlq_pending_count`). Статус: ПРОЙДЕНО | Считать по DLQ/`lastError`, а не по `published` |
| 15 | мелочь | `scripts/validate-env.ts:129-132` | `TELEGRAM_API_BASE` проверяется только на «не задана» в проде; формат URL не валидируется | Опечатка/неверная схема → `fetch` бросает → возвращается `false` → повторы → DLQ без внятной причины админу. Статус: ПРОЙДЕНО (валидации формата нет) | Проверять URL при старте (как у других base-url) |
| 16 | мелочь | `src/core/notifications/telegram.ts:262` | Дедлайн `sendDocument` считается один раз в `sendDocument` (45 с, стр. 379) и делится между всеми каналами; поздним каналам остаётся меньше времени, `timeout<=0` → `false` без попытки | При нескольких каналах и медленном прокси последний чат может не получить PDF вовсе (событие уйдёт в повтор). Статус: ГИПОТЕЗА | Считать бюджет на канал или ограничить общий дедлайн иначе |
| 17 | мелочь | `src/core/notifications/telegram.ts:80-91` | Дедупликация по `chatId` берёт первую запись по `createdAt asc`; второй бот того же чата молча отбрасывается | Если «первый» бот сломан, в рамках одной попытки второй (рабочий) не пробуется — восстановление только следующим повтором. Статус: ПРОЙДЕНО (логика прочитана) | При отказе первого пробовать остальные записи с тем же `chatId` |
| 18 | мелочь | `src/core/notifications/telegram.ts:229-248` | Telegram не поддерживает ключи идемпотентности: таймаут после фактической доставки даёт дубль при повторе (задокументировано в `durable-alert-delivery.ts:41-42`) | Смягчено: в текст добавляется id события (`durable-alert-delivery.ts:51`) и ведутся квитанции по чатам (`telegram-delivery-progress.ts:14-22`). Полностью дубль не исключён. Статус: ПРОЙДЕНО (осознанное ограничение) | Оставить как есть; при необходимости — собственный дедуп-журнал |

## Не проверено

- **Поведение в рантайме не запускалось.** Все выводы — из чтения кода; сервер/воркеры/БД не поднимал,
  фактических отправок и реальных DLQ-записей не наблюдал (read-only аудит).
- **Задержка прокси `TELEGRAM_API_BASE`** (находки #4, #7, #16) — не измерял; вывод о превышении 5 с —
  ГИПОТЕЗА, требующая замера на боевом прокси-воркере.
- **Числа backoff и бюджета транзакции** (#5, #7) — расчёт `node -e` по константам кода, не наблюдение
  продакшена; фактическое поведение зависит от интервалов воркера (`OUTBOX_INTERVAL`) и задержки сети.
- **`retry_after` от Telegram** (#11) — не подтверждал, что в этой версии Bot API flood-control реально
  наступает на этих объёмах.
- **Роли «Мастер»/«Инженер ОТ»** — в `authorization-service.ts:64` значатся держателями `reports.read_all`,
  но, по AGENTS.md, пользователей у них нет; влияние #13 на практике не проверял.
- **Замороженные зоны** не изучал (по правилу): `src/app/api/orion/lead/route.ts:128` использует
  `telegramNotifier.sendMessage` (тот же фоновый путь сбоев), но ORION-сайт вне рамок задачи.
- Существующие отчёты в `docs/audits/` (в т.ч. по уведомлениям/DLQ) намеренно не открывал — требование задачи.
