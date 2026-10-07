# W49-DLQ-OPERATIONS. Что увидит и что сможет сделать владелец, когда события пойдут в dead-letter

READ-ONLY. Создан только этот файл; код, схема, `.env`, тесты и база не изменялись.
Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `10bf83d5` (`git status` — чисто).
Смежные отчёты: `docs/audits/hermes-night/R95-admin-dlq.md` (написан на более старом HEAD `0f46601b`),
`R69-alerts-delivery.md`, `W4-AUDITLOG-STOPPED.md`. Здесь — состояние очереди dead-letter **на текущем HEAD**:
куда падает событие, что показывает экран, как работает повтор, какие есть тревоги, — с ответом на 5 вопросов задания.

## Итог

- Находок 19: **критично — 0**, **важно — 11**, **мелочь — 8**. Дыр в правах и потери данных нет: в DLQ пишет
  только воркер, экран и API доступны лишь роли `ADMIN` (`dlq.manage`), запись захватывается атомарно.
  Проблема операционная — владельцу **непонятно, что сломалось и о каком отчёте речь**, а «Повтор» для части
  событий заведомо не может сработать и лишь зацикливается.
- Топ-5:
  1. **Причину понять нельзя, номера отчёта нет.** Тип события теперь переводится на русский (словарь
     `EVENT_TYPE_LABELS`), но в карточке — сырой `aggregateId` (cuid) без номера/объекта отчёта, а текст ошибки —
     как есть (часто английский: `No handlers for domain event …`, `Invalid prisma.report.findUnique()`). Владелец
     видит «Доставка PDF отчёта», но не знает, в каком отчёте и что чинить
     (`src/components/piling/admin-dlq.tsx:58-77,258-266,288-292`; `src/services/reports/domain-events.ts:134-139`).
  2. **Петля повтора.** «Повтор» возвращает событие в outbox с `attempts=0`; если причина не исчезла, после тех же
     5 попыток появляется **новая** pending-запись DLQ, без ссылки на исходную, и новый Telegram-алерт. Цепочку
     «повтор → снова упало» по экрану не проследить (`src/core/outbox/dead-letter-queue.ts:113-146`;
     `src/services/reports/outbox-publisher.ts:170-209`).
  3. **События «без данных»/«без подписчика» после J1/J2 теперь уходят в DLQ и не могут быть починены повтором.**
     `handleReportForAnalytics` бросает, если не смог определить `siteId/userId/tenantId` (`event-handlers.ts:105-114`),
     `emitDomainEvent` бросает для отчётного события без подписчика (`domain-events.ts:134-139`). Повтор такого
     события снова упадёт: лечится только «Отбросить».
  4. **Два канала алертов с разными выключателями.** Мгновенный Telegram на каждую запись гасится тумблером
     «Недоставленные события» (`deliveryFailures`), а правило Prometheus `dlq_pending_count > 0` идёт через
     Alertmanager→вебхук и гасится тумблером «Сбои сервера» (`systemAlerts`). Отключив один, владелец молча теряет
     один канал, считая, что выключил всю тревогу (`dead-letter-queue.ts:94-106`, `observability/prometheus/alerts.yml:245-253`,
     `src/app/api/alerts/webhook/route.ts:111-118`).
  5. **Очередь растёт вечно.** Ретеншена нет: `resolved`/`discarded` не удаляются, «Всего» раздувается; а фильтр
     «Ожидают» сортирует `createdAt: 'asc'` и режет на 200 — при переполнении **свежие сбои не видны**, тогда как
     плитка показывает реальное число (`src/core/outbox/dead-letter-queue.ts:160-193`; `admin-dlq.tsx:110`).

## Методика

Правок нет; Python не установлен, использованы `read_file`/`search_files`/`terminal`(git,grep,ls). Строки — по факту
открытия файла на HEAD `10bf83d5`. Заморозка (варианты оператора, ORION) не затрагивалась.

1. `AGENTS.md` прочитан (модель доверия, «выглядит мёртвым, но живёт», заморозка). `docs/audits/hermes-night/R95-admin-dlq.md`
   прочитан целиком — как база; учтено, что R95 писан на HEAD `0f46601b` и часть его находок уже закрыта на текущем HEAD
   (см. «Что изменилось с R95»).
2. Ядро DLQ: `src/core/outbox/dead-letter-queue.ts` — целиком (`moveToDlq`, `retryDlqEntry`, `discardDlqEntry`,
   `getDlqStats`, `getPendingDlqEntries`); `src/services/reports/outbox-publisher.ts` — целиком (`MAX_RETRIES=5`,
   ветка `attempts >= MAX_RETRIES`).
3. Экран и маршруты: `src/components/piling/admin-dlq.tsx` — целиком; `src/app/(app)/admin/dlq/page.tsx`,
   `.../layout.tsx`; встраивание вкладкой — `src/components/piling/workspace-settings.tsx:20,222,307,367-369`;
   `src/app/api/admin/dlq/route.ts` — целиком (GET `withApi`, POST `withMutation`).
4. Куда и почему падает: `src/services/reports/domain-events.ts` (J2 — пустой реестр — ошибка),
   `src/services/reports/event-handlers.ts` (J1 — `throw` о недостающих `siteId/userId/tenantId`; путь
   `ReportPdfDeliveryRequested`), `src/modules/reports/application/projections/projection-worker.ts`.
5. Схема (только чтение): модель `DeadLetterQueue` — `prisma/schema.prisma:2819-2842`.
6. Тревоги и метрики: `src/core/observability/lag-monitor.ts` (`dlq_pending_count`, `evaluateAlerts`),
   `src/core/observability/health-tracker/aggregate.ts`, `src/app/api/metrics/route.ts`,
   `src/app/api/system/status/route.ts`, `observability/prometheus/alerts.yml` (правило `DeadLetterQueueNotEmpty`),
   `observability/prometheus/prometheus-prod.yml` (rule_files), `observability/alertmanager/alertmanager.yml`,
   `src/app/api/alerts/webhook/route.ts`, `docker-compose.monitoring-prod.yml` (что подключено к Prometheus/Alertmanager).
7. Права и аудит: `src/services/auth/authorization-service.ts` (`dlq.manage → ['ADMIN']`, `actingAs`);
   поиск `recordAuditEvent` по `src/` — в DLQ-маршруте **нет** (образец — `src/app/api/admin/projections/rebuild/route.ts`).
8. Поиски: `dlq|dead-letter|DeadLetterQueue` по `src/`, `e2e/`, `prisma/`, `observability/`, `docker*.yml`;
   на ретеншен/чистку — `deadLetterQueue.delete*`, `retention`, `purge`, `cleanup` (чистки DLQ нет);
   `recordAuditEvent` (нет вызова из DLQ).
9. GitNexus-граф не запрашивался (MCP в сессии нет); выводы о вызовах — текстовым поиском.
10. Динамика не запускалась: сервер/БД/браузер/Playwright недоступны (read-only). Все «что увидит владелец» — из кода
    отрисовки и ветвлений, не из прогона.

## Ответы на вопросы задания

**1) Куда именно попадает событие и сколько живёт.** В таблицу `DeadLetterQueue` (Prisma-модель без `@@map`, значит
таблица БД называется так же), строка создаётся в `moveToDlq` (`src/core/outbox/dead-letter-queue.ts:46-71`).
Значимые поля: `eventType`, `payload` (JSON), `errorMessage`, `attempts`, `sourceOutboxId`, `tenantId`,
`aggregateType`, `consumer` (`published`|`projected`|NULL для старых), `status` (`pending` по умолчанию),
`createdAt`/`updatedAt` (`prisma/schema.prisma:2819-2842`). Перенос происходит в `outbox-publisher.ts:173-209`, когда
`attempts >= MAX_RETRIES` (`MAX_RETRIES = 5`, строка 26). **Живёт вечно**: ни `deleteMany`, ни TTL, ни задачи очистки
нет — статус можно сменить на `resolved`/`discarded`, но строка не удаляется (поиск `deadLetterQueue.delete*`/`retention` пуст).

**2) Какой экран/API показывает и понятен ли он владельцу.** Экран — `src/components/piling/admin-dlq.tsx`, доступен
по маршруту `/admin/dlq` (`src/app/(app)/admin/dlq/page.tsx` + `layout.tsx` с `requirePageAbility('dlq.manage')`) и
вкладкой «Очередь (DLQ)» в Настройках (`workspace-settings.tsx:222,367-369`). API — `GET /api/admin/dlq`
(`src/app/api/admin/dlq/route.ts:16-59`) и `POST` (действия). Что видно по событию: **тип события теперь
переводится на русский** (`EVENT_TYPE_LABELS`, строки 58-77; незнакомый тип — как есть), статус-бейдж,
`попыток: N`, **сырой `aggregateId` (cuid) как «Объект события»** без номера/названия отчёта, `sourceOutboxId`,
даты, **текст ошибки** (раскрывается полностью кнопкой, строки 264-275) и payload JSON. Итог владельцу:
**наполовину понятно** — «что это за событие» да, «в каком отчёте и почему сломалось» нет (номера отчёта нет,
текст ошибки — технический/английский).

**3) Можно ли повторить, кто это может, что будет при неустранённой причине.** Да: кнопка «Повтор» и endpoint
`POST /api/admin/dlq` с `action:'retry'` → `retryDlqEntry` (`route.ts:84-89`, `dead-letter-queue.ts:113-151`).
Права: `assertCan(user!, 'dlq.manage')`, а `dlq.manage` = только `ADMIN` (`authorization-service.ts:133`), с учётом
режима «действую как». Повтор удаляет запись из «Ожидают» (статус `resolved`) и создаёт **новое** событие в outbox
с `attempts=0` и будит только того потребителя, который упал (`published`/`projected`). **Если причина не исчезла:**
обработка снова падает, проходит ещё 5 попыток — и в DLQ появляется **новая** pending-запись, **без ссылки** на
исходную (`schema.prisma:2819-2842` — поля `retriedFromId` нет). Каждый круг даёт новый Telegram-алерт. Для событий
по удалённому отчёту/без данных (ответ 1 в «Итоге», п.3) повтор **не может** завершиться успехом — помогает только
«Отбросить».

**4) Есть ли оповещение при росте очереди; какие правила в monitoring.** Да, два независимых канала:
(а) **мгновенный Telegram** из `moveToDlq` на **каждую** новую запись (`dead-letter-queue.ts:94-106`), гасится
тумблером «Недоставленные события» (`deliveryFailures`, `src/modules/settings/domain/settings.ts:58-84`;
передаётся из `outbox-publisher.ts:188-191`); (б) **правило Prometheus** `DeadLetterQueueNotEmpty`:
`dlq_pending_count > 0` в течение 5m, severity `warning`, сервис `pilingtrack-app`
(`observability/prometheus/alerts.yml:245-253`); метрика `dlq_pending_count` — из `/api/metrics`
(`lag-monitor.ts:364-366`, сбор — `:141-149,292-301`; маршрут `src/app/api/metrics/route.ts`). Правило забирается
Prometheus (rule_files: `prometheus-prod.yml:20-21`), уходит в Alertmanager (`alertmanager.yml:4-27`), тот POST-ит
в `http://app:3000/api/alerts/webhook`, а вебхук шлёт в Telegram — но **только если включён тумблер «Сбои сервера»
(`systemAlerts`)**, иначе молча `reason:'disabled'` (`src/app/api/alerts/webhook/route.ts:108-118`). Родственные
правила outbox (для контекста): `OutboxBacklog`, `OutboxLagHigh`, `OutboxLagWarn`, `ProjectionLagHigh`
(`alerts.yml:171-213`). DLQ **не** входит в overall health: `dlqPending` собирается в метрики `collectMetrics`, но
`computeOverallStatus` его игнорирует (`health-tracker/aggregate.ts:19-48,50-83`) — очередь может расти, оставаясь
`healthy`.

**5) SELECT для локальной базы.** Таблица — `"DeadLetterQueue"` (Prisma default, схема `public`). Сколько сейчас и
каких типов:

```sql
-- всего и по статусам
SELECT status, count(*) AS n
FROM "DeadLetterQueue"
GROUP BY status
ORDER BY n DESC;

-- «Ожидают» по типам событий
SELECT "eventType", count(*) AS n
FROM "DeadLetterQueue"
WHERE status = 'pending'
GROUP BY "eventType"
ORDER BY n DESC;

-- разбивка по потребителю (кто упал: публикация или проекция)
SELECT consumer, "eventType", count(*) AS n
FROM "DeadLetterQueue"
WHERE status = 'pending'
GROUP BY consumer, "eventType"
ORDER BY n DESC;
```

Запуск (нужен доступ к БД, здесь его нет): `psql "$DATABASE_URL" -c '<запрос выше>'` либо
`npx prisma db execute --stdin`. Фактические числа **не сняты** — см. «Не проверено».

## Что изменилось с R95 (на этом HEAD)

- R95 писался на HEAD `0f46601b`; `admin-dlq.tsx` тогда был 280 строк, сейчас 357. Уже **закрыто**:
  русский словарь типов событий (`EVENT_TYPE_LABELS`, R95 №4, часть), кнопка раскрытия полного текста ошибки
  (R95 №4, часть), подтверждение у «Повтор» через `retryConfirmMessage` с предупреждением про PDF (R95 №1,
  часть), подпись статуса переименована в «Повтор поставлен в очередь» (R95 №3, часть). **Осталось/актуально**:
  нет номера отчёта, нет аудита действий, нет ретеншена, сортировка «старые сверху» с лимитом 200, петля повтора,
  дубль PDF, два выключателя тревог.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|----------|-----------|----------|--------------------------|--------------------------|
| 1 | важно | `src/components/piling/admin-dlq.tsx:258-266,288-292` | Нет номера/названия отчёта: «Объект события» — сырой `aggregateId` (cuid); имя объекта ищется только глазами по payload JSON | Владелец видит «Доставка PDF отчёта» и cuid, но не знает, **в каком отчёте** сбой и что переделывать | Резолвить `aggregateId → report.reportId/номер/объект` тенантным запросом и показывать человекочитаемую подпись рядом с кодом |
| 2 | важно | `src/components/piling/admin-dlq.tsx:264-266`; `src/services/reports/event-handlers.ts:111-113`; `src/services/reports/domain-events.ts:135-137` | Текст ошибки — сырое сообщение исключения, часто английское/техническое (`No handlers for domain event …`, Prisma-ошибки); русского объяснения нет. Часть ошибок всё же русские (J1), поэтому язык смешанный | Владелец не понимает причину и не может решить, «Повтор» или «Отбросить» | Показывать русскую расшифровку по классу ошибки (нет подписчика / нет данных для проекции / Telegram недоступен / отчёт удалён) + технический текст под спойлером |
| 3 | важно | `src/services/reports/event-handlers.ts:105-114`; `src/services/reports/domain-events.ts:134-139`; `src/core/outbox/dead-letter-queue.ts:113-146` | После J1/J2 события «без нужных данных» и «без подписчика» **бросают** и после 5 попыток уходят в DLQ; повтор такого события снова упадёт (данных/подписчика по-прежнему нет) | Владелец жмёт «Повтор», тот «успешен» (`resolved`), через 5 кругов — снова DLQ и Telegram; причина неустранима, лечится только «Отбросить», но это не подсказано | Помечать такие события как «повтор не поможет» (по классу ошибки) и предлагать «Разобрано» вместо «Повтор» |
| 4 | важно | `src/core/outbox/dead-letter-queue.ts:113-146`; `src/services/reports/outbox-publisher.ts:170-209`; `prisma/schema.prisma:2819-2842` | «Повтор» = событие назад в outbox с `attempts=0`; новый провал создаёт **новую** pending-запись без ссылки на исходную (поля-связи нет) | Цепочку «повтор X → снова упало» по экрану не проследить: каждая итерация выглядит как новое независимое событие | Добавить `retriedFromId` и показывать «это повтор записи #…»; либо группировать цепочку |
| 5 | важно | `src/core/outbox/dead-letter-queue.ts:119-122`; `src/components/piling/admin-dlq.tsx:48` | Статус `resolved` ставится в момент **постановки** в очередь, а не по факту успешной обработки; подпись — «Повтор поставлен в очередь» (уже честнее R95) | Владелец может счесть инцидент закрытым, хотя обработка ещё не прошла и может снова упасть | Различать «поставлено в очередь на повтор» и «успешно обработано» (обновлять статус по факту) |
| 6 | важно | `src/core/outbox/dead-letter-queue.ts:128-144`; `src/services/reports/event-handlers.ts:570-584` | Повтор события доставки не переносит `dedupeKey` (`report-pdf:<event.id>`), а сам повтор `ReportPdfDeliveryRequested` вызывает `deliverReportPdf` | Если отчёт ещё существует, в рабочий чат Telegram уходит **второй** PDF того же отчёта; предупреждение-подтверждение теперь есть, но поведение осталось | Переносить исходный `dedupeKey` при повторе либо явно не переотправлять уже доставленный PDF |
| 7 | важно | `src/app/api/admin/dlq/route.ts:66-95` (ср. `src/app/api/admin/projections/rebuild/route.ts:72-80`) | Ни `retry`, ни `discard` не пишут в аудит | «Кто и когда разобрал очередь / что отброшено» восстановить нельзя; для необратимого «Отбросить» это особенно важно | `recordAuditEvent('dlq.retried'/'dlq.discarded', …)`, best-effort, как в rebuild |
| 8 | важно | `src/core/outbox/dead-letter-queue.ts:153-193`; `prisma/schema.prisma:2836-2837` | Ретеншена нет: `resolved`/`discarded` не удаляются, таблица и счётчик «Всего» растут неограниченно | Со временем статистика теряет смысл; чистки нет ни в коде, ни в скриптах; на диске — вечный рост | Периодически архивировать/удалять `resolved`/`discarded` старше N дней |
| 9 | важно | `src/core/outbox/dead-letter-queue.ts:175-180`; `src/components/piling/admin-dlq.tsx:110` | Список берётся `limit=200` и сортируется `createdAt: 'asc'` — отдаются **самые старые** 200; постраничности нет | При >200 записях плитка «Ожидают» показывает реальное число, а на экране — старые: **свежие сбои не видны**, кнопки «показать ещё» нет | Сортировать свежие сверху и/или добавить постраничность/«Показать ещё» |
| 10 | важно | `src/core/outbox/dead-letter-queue.ts:94-106`; `observability/prometheus/alerts.yml:245-253`; `src/app/api/alerts/webhook/route.ts:111-118` | Два канала тревог с **разными** выключателями: мгновенный Telegram — «Недоставленные события» (`deliveryFailures`); правило Prometheus — «Сбои сервера» (`systemAlerts`) | Отключив один тумблер, владелец считает, что выключил всю тревогу, а второй канал продолжает (или наоборот — тишина кажется «всё хорошо») | Явно связать оба пути с одним понятным переключателем либо пояснить в настройках, что это два разных канала |
| 11 | важно | `observability/prometheus/alerts.yml:245-253`; `observability/alertmanager/alertmanager.yml:4-27` | Правило `DeadLetterQueueNotEmpty` — `severity: warning`, `for: 5m`, `repeat_interval 4h` (для warning), доставка в Telegram через вебхук приложения | Владелец узнаёт о непустой очереди с задержкой и повторно не чаще раза в 4 часа; при выключенном `systemAlerts` — не узнаёт вовсе | Согласовать с владельцем частоту/канал (или пометить critical, если требует реакции) |
| 12 | мелочь | `src/core/observability/health-tracker/aggregate.ts:19-48,50-83` | `dlqPending` собирается в метрики `/api/system/status`, но `computeOverallStatus` его не учитывает | Растущая DLQ не переводит систему в `degraded` — на дашборде «всё healthy», пока очередь копится | Ввести порог, при котором непустая DLQ даёт `degraded` (или отдельная плитка) |
| 13 | мелочь | `src/core/outbox/dead-letter-queue.ts:94-106`; `src/core/notifications/telegram.ts` (`getConfigs`) | Мгновенный алерт пишет сырой код события/`aggregateId`/фрагмент ошибки; тенант — `getRequestTenantId() ?? DEFAULT_TENANT_ID` (тенант развёртывания, а не организации события) | Мультитенант: уведомление уедет не тому адресату (сейчас один тенант — мелочь, before tenant #2); текст не сразу читаем | Слать по тенанту события и перевести текст на русский с номером отчёта |
| 14 | мелочь | `src/components/piling/admin-dlq.tsx:227-327`; `src/app/api/admin/dlq/route.ts:61-64` | Действий только «Повтор»/«Отбросить»; отметки «Разобрано (повтор не нужен)» нет, «Отбросить» необратим и пугает формулировкой | Для неустранимого события (см. п.3) админ вынужден «отбрасывать», хотя правильнее «признать и закрыть» | Третье действие `acknowledge` отдельно от `discard`, с понятным подтверждением |
| 15 | мелочь | `src/app/api/admin/dlq/route.ts:35-41` | Комментарий «use raw query», на деле `db.deadLetterQueue.findMany`; у pending сортировка `asc`, у resolved/discarded — `desc` | Разный порядок по фильтрам путает (старейшие сверху vs новейшие) | Убрать неверный комментарий, привести сортировку к одному виду |
| 16 | мелочь | `src/app/api/admin/dlq/route.ts:84-90` | Провал `retryDlqEntry` отдаётся общим 400 «Не удалось переотправить»; настоящая причина — только в логе (`dead-letter-queue.ts:147-150`) | Админ не знает, повторять или звать поддержку | Различать «запись уже обработана/не найдена» и «сервер не смог поставить повтор» |
| 17 | мелочь | `src/core/outbox/dead-letter-queue.ts:139-144` | Legacy-строки (`consumer = NULL`, до 25.09.2026) при повторе будят **оба** потребителя (`published=false` и `projected=false`) | Повтор старой записи повторно пишет аудит и заново ставит PDF — дубль следа и доставки | Для `consumer = NULL` определить реально упавшего по `lastError`/типу либо явно проставлять потребителя при переносе |
| 18 | мелочь | `src/components/piling/admin-dlq.tsx:256`; `src/core/outbox/dead-letter-queue.ts:65,138` | «попыток: N» — счётчик на момент переноса в DLQ (для новых записей) или сброшенный (`attempts: 0` в новой строке outbox) | Владелец не видит суммарной истории попыток по цепочке | Хранить/показывать суммарное число попыток по цепочке |
| 19 | мелочь | `src/core/outbox/dead-letter-queue.ts:119,154,176`; `src/app/api/admin/dlq/route.ts:36-41` | Ни один запрос не ограничен `tenantId` | Сегодня не дефект (`dlq.manage` = только `ADMIN`, платформенная роль). Но с появлением «тенант-админа» `retry/discard` по чужому id станет кросс-тенантным (before tenant #2) | Зафиксировать намерение комментарием либо проверять тенант события, когда появится «тенант-админ» |

## Не проверено

- **Числа по базе не сняты.** Доступа к БД/`.env` в сессии нет (read-only, `.env` не читаю по правилам), поэтому
  «сколько сейчас в DLQ и каких типов» (вопрос 5) — только команда SELECT, не результат. Реальные значения и состав
  записей (какой потребитель падал, какой `errorMessage`) не осмотрены.
- **Динамика не воспроизводилась.** Сервер/браузер/Playwright недоступны — ни экран, ни `GET/POST /api/admin/dlq`,
  ни поведение повтора в рантайме не прогонялись. Все «что увидит владелец» — из кода отрисовки и ветвлений.
- **Утверждение «повтор такого события всегда упадёт» (п.3 Итога)** — вывод из кода (J1 бросает при неразрешённых
  `siteId/userId/tenantId`; J2 бросает при пустом реестре). Зависит от того, дойдут ли в payload эти поля; в рантайме
  на реальном событии не подтверждено.
- **Тесты DLQ не запускались** (правок нет). Существующие `src/core/outbox/__tests__/dead-letter-queue.test.ts`,
  `src/workers/__tests__/outbox-worker.test.ts`, `src/components/piling/__tests__/admin-dlq.test.tsx` читались
  косвенно; какие именно сценарии они закрывают (аудит действий, петля повтора, дубль PDF) — не перепроверял прогоном.
- **Мониторинг не поднимался**: не проверено, реально ли запущены `docker-compose.monitoring-prod.yml` (Prometheus +
  Alertmanager) в проде и доходят ли алерты до Telegram; вывод о двух каналах — из конфигов Prometheus/Alertmanager
  и кода вебхука, не из работающего стека.
- **Роль «действую как»**: `assertCan` учитывает `actingAs` (`authorization-service.ts:158-160`), но фактический 403
  админа в режиме другой роли на экране DLQ в рантайме не проверялся.
- **GitNexus-граф не запрашивался** (MCP нет); выводы о вызовах — текстовым поиском. Возможен динамический импорт по
  строке — не нашёл, но не исключаю.
- **Заморозка**: варианты экрана оператора (`operator*/**`, `operator-mobile/**`) и сайт ORION не аудировались (AGENTS.md §1).
