# AU138-S2-NOTIFICATION-PREFERENCES — Настройки уведомлений: кому что приходит

Версия: `git rev-parse HEAD` = `a192c450e9f653dd53e5eaa1e9f10b10b3620286`.
Ревью: только чтение, файлы приложения не менялись. Замороженные зоны
(варианты экрана оператора, сайт ОРИОН) не разбирались, кроме одного упоминания
(№11), потому что задание прямо спрашивает про неотключаемые события.

## Итог

1. Каталог уведомлений — 8 правил; отправитель есть у 7, только у
   `planDeviation` его нет вовсе (`implemented: false`, тумблер заблокирован).
   Значения по умолчанию: включены `downtime30`, `maintenanceOverdue`,
   `criticalDefect`, `incidents`, `systemAlerts`, `deliveryFailures`;
   выключены `planDeviation` и `newReports` (`settings.ts:52-83`).
2. Канал доставки ровно один — Telegram. Почта/SMS/Push в коде не реализованы
   (совпадений `nodemailer|sendMail|SMTP|webpush` в `src/` нет ни одного, кроме
   подписи экрана). Экран честно пишет «не подключено».
3. Менять может только `ADMIN`: и клиент (тумблеры `disabled`), и сервер
   (`user.role !== 'ADMIN' → 403`, `api/settings/route.ts:27`). Читать (GET)
   может любой аутентифицированный; страница `/admin/settings` открыта ролям с
   `system.read` (ADMIN/DISPATCHER), но у диспетчера тумблеры недоступны.
4. Настроек на получателя нет: всё уходит во **все** включённые Telegram-чаты
   тенанта. Маршрутизации «дефекты — мастеру, отчёты — диспетчеру» не
   существует, хотя экран техготовности рисует колонки «Отправители/Канал».
5. Отключить нельзя два события: `incidentStopWork` («есть пострадавший»/
   «прекратить работы», `durable-alert-delivery.ts:13-19,32-33`) и заявки с
   сайта ОРИОН (`api/orion/lead/route.ts:128`, замороженная зона).
6. Найдено: критично — 0, важно — 4, мелочь — 10. Ни одно не является явным
   дефектом-поломкой; главное — отключение может молча не сработать
   (fail-open при ошибке чтения настроек, №1) и получателя выбрать нельзя (№3).

## Методика

Искал в `src/`, `prisma/`, `tests/` (без `docs/audits/`), командами `rg` через
инструмент поиска и чтением файлов с диапазонами:
`telegramNotifier\.(sendAlert|sendMessage|sendDocument|testConnection)`,
`isNotificationEnabled`, `NOTIFICATION_KEYS|DEFAULT_NOTIFICATIONS|planDeviation`,
`RULE_NOTIFICATION_KEYS|notificationKey|incidentStopWork|stopRequired`,
`nodemailer|sendMail|SMTP|webpush|SendSMS`, `\$transaction|runWithGucApplied`,
`reports.read_all|telegram.manage|system.read`.

Ключевые прочитанные файлы (полные пути от корня репозитория):
- `src/modules/settings/domain/settings.ts` (каталог, умолчания, sanitize)
- `src/modules/settings/application/settings-service.ts` (чтение/запись, чек)
- `src/app/api/settings/route.ts` (GET/PUT, права, аудит)
- `src/services/reports/event-handlers.ts`, `src/services/reports/outbox-publisher.ts`
- `src/workers/unified-worker/pm-scheduler.ts`
- `src/services/notifications/durable-alert-delivery.ts`,
  `src/core/notifications/durable-alert.ts`, `src/core/notifications/telegram.ts`
- `src/core/outbox/dead-letter-queue.ts`
- `src/app/api/alerts/webhook/route.ts`
- `src/app/api/notifications/telegram/test/route.ts`
- `src/components/piling/workspace-settings.tsx`,
  `src/components/piling/to/readiness/settings/notifications-section.tsx`,
  `src/components/piling/to/readiness/screens/settings-workspace.tsx`
- `src/services/auth/authorization-service.ts`, `prisma/schema.prisma:914-931`

Перепроверяемость: `rg -n "isNotificationEnabled" src`, затем чтение каждого
вызова; `rg -n "telegramNotifier\." src` — полный список отправителей.

## Карта: событие → ключ → отправитель → что при отключении

| Ключ настройки | Событие (когда срабатывает) | Отправитель (файл:строка вызова) | Проверка флага | Умолчание | Что при отключении |
|---|---|---|---|---|---|
| `downtime30` | Простой в отчёте > 2 ч (`event-handlers.ts:318-320`) | `event-handlers.ts:326` → `:407` | `event-handlers.ts:326` | вкл | alert не уходит, запись в лог `Downtime alert suppressed` |
| `planDeviation` | нет отправителя | — | — | выкл | ничего (тумблер выключен) |
| `maintenanceOverdue` | Просроченные ТО, суточный прогон | `pm-scheduler.ts:37` → `:54` | `pm-scheduler.ts:37` | вкл | сводное сообщение не уходит |
| `criticalDefect` | Опасный дефект HIGH/CRITICAL осмотра (`durable-alert.ts:19-31`, ruleId `criticalDefect`) | `durable-alert-delivery.ts:39` → `:51` | `:33` через `RULE_NOTIFICATION_KEYS:17` | вкл | durable-алерт не отправлен, событие помечается published |
| `newReports` | Новый/скорректированный сменный отчёт → PDF в чат | `event-handlers.ts:543` (постановка) → `:665` (отправка) | `:543` (при постановке), при отправке НЕ проверяется | выкл | PDF не ставится в очередь |
| `incidents` | Мелкое происшествие на площадке (ruleId `incident`) | `durable-alert-delivery.ts:39` → `:51` | `:33` через `RULE_NOTIFICATION_KEYS:18` | вкл | не отправляется |
| `systemAlerts` | Сбои сервера (Alertmanager) | `api/alerts/webhook/route.ts:112` → `durable-alert-delivery.ts:51` | `route.ts:112` и повторно `:33` через `notificationKey` | вкл | вебхук возвращает `{ok:true, reason:'disabled'}` |
| `deliveryFailures` | Событие исчерпало попытки → DLQ | `outbox-publisher.ts:188-191` → `dead-letter-queue.ts:96,101` | `dead-letter-queue.ts:96` | вкл | алерт о DLQ не уходит, запись в DLQ остаётся |
| — (нет ключа) | «Прекратить работы»/пострадавший (`incidentStopWork`) | `durable-alert-delivery.ts:51` | не проверяется | всегда | отправить нельзя — так решено владельцем |
| — (нет ключа) | Заявка с сайта ОРИОН | `api/orion/lead/route.ts:128` | не проверяется | всегда | отправить нельзя (замороженная зона) |

## Находки

| # | важность | файл:строка | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/settings/application/settings-service.ts:62-64,82-84` | `isNotificationEnabled` работает **fail-open**: при отсутствии `tenantId` и при любой ошибке чтения настроек возвращает `true` (отправить). Замысел задокументирован, но отключение владельца при этом молча игнорируется | Админ выключил «Опасный дефект»; в момент сбоя БД/RLS/сети чтение настроек бросает — алерт всё равно уходит. Заметно только по логу, на экране «выключено» | Оставить fail-open, но: (а) отделить «ошибку чтения» от «явного отсутствия», (б) писать метрику/баннер, что правило не удалось прочитать (сейчас только `logger.warn` на строке 63) |
| 2 | важно | `src/modules/settings/application/settings-service.ts:58-81` vs `src/core/notifications/telegram.ts:44-49` | Флаг читается по тенанту **события**, а получатели берутся из тенанта развёртывания (`DEFAULT_TENANT_ID`) | Перед вторым тенантом: событие тенанта B проверяется по настройкам B, но уходит в чаты A (и наоборот). Сейчас один тенант (`orion`) — не проявляется | Ключ получателя и тенант проверки брать из одного источника; при расхождении не отправлять |
| 3 | важно | `src/core/notifications/telegram.ts:71-78`; `src/components/piling/to/readiness/settings/notifications-section.tsx:20-27,172-197` | Маршрутизации нет: `getConfigs` отдаёт **все** включённые чаты, правило не выбирает получателя. Экран рисует колонки «Отправитель», «Канал», но они описательные | Нельзя отправить дефекты мастеру, а отчёты — диспетчеру: всё дублируется во все чаты тенанта. Экран создаёт ложное ожидание | Либо явно подписать «все чаты тенанта», либо добавить привязку правило→чаяты |
| 4 | важно | `src/app/api/notifications/telegram/test/route.ts:29` vs `src/services/auth/authorization-service.ts:64,130` | POST-проверка бота закрыта **читательским** правом `reports.read_all` (ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER), тогда как сам канал Telegram требует `telegram.manage` (только ADMIN) | Диспетчер/мастер могут перебирать `configId` и зондировать бота (`getChat`) по чужим настройкам в пределах тенанта. Отправки сообщения нет — вред ограничен | Закрыть `telegram.manage` (или отдельным `telegram.test`) |
| 5 | мелочь | `src/core/notifications/durable-alert.ts:5-7`; `src/services/notifications/durable-alert-delivery.ts:28` | `alertSchema.notificationKey` — жёсткий `z.literal('systemAlerts')`. Любой будущий отправитель с другим значением упадёт на `parse` | Новый алерт с `notificationKey:'safetyAlerts'` → `deliverQueuedAlert` бросает на `alertSchema.parse`, событие уходит в retry→DLQ | Расширить литерал/`z.enum` до перечня ключей каталога |
| 6 | мелочь | `src/app/api/alerts/webhook/route.ts:112-115,124-128,170-176` | Если `systemAlerts` включён, а `DEFAULT_TENANT_ID` не задан, `isNotificationEnabled` вернёт `true` (fail-open по null), но в цикле `if (!tenantId) continue` — резервируем как ошибку доставки | Развёртывание без `DEFAULT_TENANT_ID`: вебхук отвечает 503 «Не удалось доставить алерты в Telegram», хотя попытки не было. Alertmanager зациклит ретраи | Отдельный код/сообщение «тенант доставки не настроен» (500/503 с ясным текстом), а не смешивать с отказом Telegram |
| 7 | мелочь | `src/modules/settings/domain/settings.ts:124-126` | `sanitizeSettings` собирает `notifications` только по ключам `NOTIFICATION_KEYS`; сохранённый «чужой» ключ молча исчезает при следующем сохранении | Если из каталога уберут ключ (или тенант хранит старое имя), значение пропадёт без следа в аудите | Логировать отброшенные ключи или сохранять их «как есть» рядом с известными |
| 8 | мелочь | `src/components/piling/to/readiness/settings/notifications-section.tsx:124,150` | KPI «признак включён у N» считает **все** булевы из `settings.notifications`, включая нереализованный `planDeviation` | N может быть на 1 больше числа работающих правил (например «7», хотя работающих 6) | Считать только по `implemented` |
| 9 | мелочь | `src/core/outbox/dead-letter-queue.ts:95-96` | Алерт о DLQ для события без тенанта проверяет `isNotificationEnabled(null,'deliveryFailures')` → всегда `true`; выключатель не действует для таких строк | В однотенантном режиме строк без `tenantId` практически нет — влияние нулевое | Для строк без тенанта использовать тенант развёртывания, как в `telegram.ts:getConfigs` |
| 10 | мелочь | `src/services/reports/event-handlers.ts:543` vs `:599-671` | `newReports` проверяется только при **постановке** PDF в очередь; `deliverReportPdf` (`:665`) флаг не перечитывает (в отличие от durable-алерта, который проверяется в момент отправки) | Админ выключил «Новые отчёты», пока событие ждало отправки (retry/backlog) — PDF всё равно уйдёт | Перепроверить `isNotificationEnabled(event.tenantId,'newReports')` в `deliverReportPdf` до отправки |
| 11 | мелочь | `src/modules/settings/domain/settings.ts:54`; `src/components/piling/to/readiness/settings/notifications-section.tsx:39` | Подпись «Отклонения по плану (±10%)» обещает порог ±10%, а `RULE_THRESHOLDS` честно пишет «порог не задан», отправителя нет | Единственное правило-заглушка, но его название обещает логику, которой нет | Убрать «(±10%)» до появления отправителя |
| 12 | мелочь | `src/app/(app)/admin/settings/layout.tsx:4` vs `src/app/api/settings/route.ts:27` | Страница настроек открыта по `system.read` (ADMIN+DISPATCHER), а PUT — только ADMIN. Диспетчер видит экран, но тумблеры неактивны | Ожидаемо (просмотр), но диспетчер не может понять, почему «не щёлкается», кроме мелкой подписи внизу вкладки (`workspace-settings.tsx:356`) | Подпись о правах поднять к заголовку вкладки |
| 13 | мелочь | `src/components/piling/workspace-settings.tsx:296,353` | Тумблер `disabled` при `!implemented`, но сервер (`sanitizeSettings`) сохранит `true` для такого ключа, если пришёл в теле напрямую | Теоретически можно записать «включено» для нереализованного правила в обход UI; вреда нет, но состояние лживое | Игнорировать на сервере ключи с `implemented:false` |
| 14 | мелочь | `src/services/notifications/durable-alert-delivery.ts:39,47-56` | При подавлении (`suppressed`) событие всё равно помечается `published: true` | Если позже правило включат, уже подавленный алерт не переотправится. Для алертов это, скорее, желаемо (нет «отложенного» спама), но стоит зафиксировать как решение | Если нужна переотправка — оставлять событие непубликованным |

## События, которые нельзя отключить

| Событие | Почему нельзя | файл:строка | Статус |
|---|---|---|---|
| «Прекратить работы» / «есть пострадавший» (`incidentStopWork`) | Правило нет в `RULE_NOTIFICATION_KEYS`; ключ становится `undefined`, и `isNotificationEnabled` не вызывается → шлём всегда. Решение владельца 26.09.2026 | `src/services/notifications/durable-alert-delivery.ts:13-19,32-33`; постановка `src/modules/operator-mobile/application/commands/incidents.ts:126` | ПРОЙДЕНО (тест `durable-alert-delivery.test.ts:30-36`) |
| Заявка с сайта ОРИОН | Отправитель `telegramNotifier.sendMessage` без проверки настроек; выключателя нет по решению владельца, у приложения нет экрана заявок | `src/app/api/orion/lead/route.ts:128` | ПРОЙДЕНО (замороженная зона, чтение только для контекста) |
| Durable-алерт с неизвестным `ruleId` и без `notificationKey` | `key` = `undefined` → отправляем (fail-open: «новый отправитель не должен молчать») | `src/services/notifications/durable-alert-delivery.ts:33`; тест `durable-alert-delivery.test.ts:44-49` | ПРОЙДЕНО |

## Проверено по коду (положительное)

- Все 6 отправителей в области аудита читают выключатель: `event-handlers.ts:326` (downtime30),
  `event-handlers.ts:543` (newReports), `pm-scheduler.ts:37` (maintenanceOverdue),
  `durable-alert-delivery.ts:39` (criticalDefect/incidents/systemAlerts),
  `dead-letter-queue.ts:96` (deliveryFailures), `api/alerts/webhook/route.ts:112` (systemAlerts).
  Полный список вызовов `telegramNotifier.*` — 7 точек, из них 2 без флага
  (`api/orion/lead/route.ts:128`, тест-роут) и 5 с флагом. — ПРОЙДЕНО.
- Чтение настроек вынесено из транзакции доставки (`durable-alert-delivery.ts:34-39`),
  RLS-контекст выставляется внутри `isNotificationEnabled` (`settings-service.ts:77-80`). — ПРОЙДЕНО.
- Запись настроек — одна транзакция под `pg_advisory_xact_lock` + upsert
  (`settings-service.ts:98-108`); аудит пишется только при реальном изменении
  (`api/settings/route.ts:47-55,60-79`). — ПРОЙДЕНО.
- Каталог и умолчания защищены контрактным тестом
  (`tests/contract/tenant-settings.spec.ts:21-57`) и `settings-service.test.ts:96-141`. — ПРОЙДЕНО.

## Не проверено

- Не запускал тесты (`npm run test:unit`, `playwright`) — задание read-only, файлы не менялись;
  выводы о поведении беру из чтения кода и существующих тестов, не из прогонов.
- Экраны техготовности `src/components/piling/to/**` не запускал в браузере — выводы по разметке
  тумблеров только из кода (`workspace-settings.tsx`, `notifications-section.tsx`).
- Фактическое содержимое `TenantSettings.notifications` в БД и значение `DEFAULT_TENANT_ID`
  на развёртывании не проверял (нет доступа к БД/окружению).
- Значения `DEFAULT_NOTIFICATIONS` в проде могли отличаться от кода, если строку меняли
  вручную — не проверял.
- ORION-заявка: смотрел только одну точку отправки (`lead/route.ts:128`); полный обзор
  замороженной зоны ОРИОН не делал по условию задания.
