# AU107-S8-ONBOARDING-NEW-ORG-R2: подключение второй организации — что делается вручную

Версия: `git rev-parse HEAD` = `bc22e4b89ae2e3495a5955ce9701782ecf7adf5d`
(ветка `hermes/q4-0926`, рабочее дерево: изменён `AGENTS.md` — потерян блок
`nextjs-agent-rules`, к задаче не относится).
Статус задачи: только чтение, код приложения не менялся.

## Итог

Контекст (решение владельца, не ошибка): второй организации не будет; производство
однотенантное (`orion`). Ниже — что понадобилось бы, если решение изменится.

Найдено 20 пунктов: **критично — 1, важно — 9, мелочь — 10**.

Топ-5:
1. **критично**: фоновые уведомления (отчёты, простои, PDF, DLQ, алерты воркера)
   всегда уходят в чаты тенанта по умолчанию — `src/core/notifications/telegram.ts:49`
   (подстановка `DEFAULT_TENANT_ID`, когда нет контекста запроса). Контекст в
   outbox-пути не открывается вовсе (проверено grep: 0 совпадений
   `runWithTenantContext|setRequestTenantId` в `src/core/outbox`, `src/workers`,
   `src/services/reports/event-handlers.ts`), а `sendAlert`/`sendMessage` не
   передают тенант события — `telegram.ts:338`, `:363`. У клиента №2 оповещения
   уйдут чужим людям.
2. **важно**: организации негде создать, кроме сида, а сид в проде запрещён —
   `prisma/seed.ts:119` (единственный `tenant.upsert`), `prisma/seed.ts:35` и
   `:98` (`assertNotProduction`). В миграциях `INSERT INTO "Tenant"` нет, в `src/`
   — ни одного `tenant.create` (кроме `src/generated`). Значит: только ручной SQL.
3. **важно**: включить многотенантный режим нельзя, не сломав вход —
   `src/proxy.ts:226` вызывает `enforceTenant` на каждом `/api/*`, список
   исключений `/api/auth/login` не содержит (`src/proxy.ts:120`, `:123`), а X-Tenant-ID
   не отправляет ни один клиент (grep по `src/components`, `src/lib`, `src/app` — 0).
   Плюс `MULTI_TENANT_MODE` и `TENANT_DOMAIN` не проброшены в контейнер
   (grep по `docker-compose*.yml` — 0 совпадений).
4. **важно**: `Tenant.maxUsers` и `Tenant.isActive` не читаются нигде —
   `prisma/schema.prisma:19`, `:18`. Приостановить неплатящего клиента и удержать
   лимит пользователей нечем.
5. **важно**: справочники (марки свай, типы бурения, причины простоя, типы
   документов) заводятся автоматически **только сидом** —
   `src/services/dictionaries/tenant-dictionary-initializer.ts:15`, единственный
   боевой вызов `prisma/seed.ts:267`. В проде — вручную через
   `/admin/dictionaries` (`src/app/api/dictionary/manage/route.ts:77-78`).

## Методика

Поиск (ripgrep через `search_files`/`grep -rn`, чтение диапазонов `sed -n`):

1. `grep -rn "DEFAULT_TENANT_ID|DEFAULT_TENANT" src` — все точки подстановки
   организации по умолчанию.
2. `grep -rn "orion" src --include=*.ts --include=*.tsx` (с исключением
   замороженных `src/app/orion`, `src/app/api/orion`, `src/components/orion`,
   `src/app/operator*`) — литеральное имя tenant в боевом коде. Результат:
   один не-тестовый литерал — `src/lib/seed/equipment.seed.ts:61`.
3. `grep -rn "MULTI_TENANT_MODE|TENANT_DOMAIN" src scripts docker-compose*.yml` —
   режим мультиаренды и домен-поддомен.
4. `grep -rn "tenant.create|tenant.upsert|tenant.update" src scripts prisma` и
   `grep -rn "INSERT INTO \"Tenant\"" prisma/migrations` — есть ли способ создать
   организацию.
5. `grep -rn "maxUsers"` по `src/ scripts/ prisma/` — читает ли кто-нибудь лимит.
6. `grep -rn "resolveTenantContext|getRequestTenantId|isMultiTenantMode" src` —
   кто вообще спрашивает организацию контекста.
7. `grep -rn "telegramNotifier\." src` + чтение `src/core/notifications/telegram.ts`
   (диапазоны 25-70, 330-420).
8. `grep -rn "runWithTenantContext|setRequestTenantId" src/core/outbox src/workers
   src/services/reports/event-handlers.ts` — открыт ли контекст в фоновых путях.
9. `grep -rn "X-Tenant-ID|x-tenant-id" src/components src/lib src/app` — шлёт ли
   клиент заголовок организации.
10. Чтение моделей: `prisma/schema.prisma` — `Tenant` (14-62), `TenantSettings`
    (914-930), `TelegramConfig` (2506-2516), `Site` (1746-1766).
11. Скрипты: `scripts/seed-sites.sql`, `scripts/seed-checklist-blocks.ts`,
    `scripts/seed-user-document-types.ts`, `scripts/seed-maintenance-plans.ts`,
    `scripts/reset-one-password.ts`, `scripts/validate-env.ts`,
    `scripts/generate-env-docker.ps1`.
12. `deploy/Caddyfile.prod` — домен и маршрутизация.

Команды ничего не меняли; сборки и тесты не запускались (задача «только чтение»,
проверка утверждений не требует запуска приложения).

## Шаги подключения второй организации

Столбец «готовность»: ПРОЙДЕНО — механизм существует и проверен чтением кода;
НЕ ПРОВЕРЕНО — вывод из чтения кода, на живом стенде не запускался;
ГИПОТЕЗА — предположение, доказательства неполные.

| # | Шаг | Как | файл:строка | Готовность |
|---|-----|-----|-------------|------------|
| 1 | Создать запись `Tenant` | Только SQL вручную. Сид умеет (`tenant.upsert`), но в проде выключен предохранителем; миграций с вставкой нет; API/UI нет | `prisma/seed.ts:119`; предохранитель — `prisma/seed.ts:35`, вызов `:98`; `grep INSERT INTO "Tenant" prisma/migrations` → 0; `grep tenant.create src` → только `src/generated` | НЕ ПРОВЕРЕНО (SQL не выполнялся) |
| 2 | Выставить `slug`, `name`, `isActive`, `maxUsers` | Те же поля модели; `slug` уникален | `prisma/schema.prisma:16` (`slug @unique`), `:17` (`name`), `:18` (`isActive`), `:19` (`maxUsers`) | ПРОЙДЕНО (только чтение схемы) |
| 3 | Создать первого ADMIN | Через UI `/admin/users` → `POST /api/users`; либо сид | `src/app/(app)/admin/users/page.tsx`; `src/app/api/users/route.ts:40-86`; `src/services/users/user-service.ts:157,162` | ПРОЙДЕНО |
| 4 | Задать пароль первому ADMIN | Пароль вводит создающий; сброса по почте нет. Скрипт сброса работает только на локальной тестовой БД | `src/app/api/users/route.ts:69-71`; `scripts/reset-one-password.ts:26-31` | ПРОЙДЕНО (для прода — только UI или SQL) |
| 5 | Настроить организацию (название, ИНН, часовой пояс, форматы, уведомления) | UI `/admin/settings` (PUT только для ADMIN); строка создаётся ленивым upsert | `src/app/api/settings/route.ts:23-42`; `src/modules/settings/application/settings-service.ts:102-106` | ПРОЙДЕНО |
| 6 | Заполнить справочники (марки свай, типы бурения, причины простоя, типы документов) | Автозаполнение есть, но вызывается только из сида. В проде — вручную в `/admin/dictionaries` | `src/services/dictionaries/tenant-dictionary-initializer.ts:15-58`; вызов — `prisma/seed.ts:267`; UI — `src/app/api/dictionary/manage/route.ts:77-78` | ПРОЙДЕНО (ручной путь), НЕ ПРОВЕРЕНО (что шаблоны покрывают все марки клиента) |
| 7 | Завести объекты/участки | UI `/admin/sites` → `sites/create`; `tenantId` берётся из сессии | `src/modules/sites/application/commands/site-admin-command.service.ts:97` | ПРОЙДЕНО |
| 8 | Завести оборудование | UI `/admin/equipment` → `POST /api/equipment` (тенант из сессии) — по одной машине; типовой парк (`PVE 50PR` и пр.) заливает только сид | `src/app/api/equipment/route.ts:31,39,56`; сид — `src/lib/seed/equipment.seed.ts:61` (жёсткая привязка к `DEFAULT_TENANT_ID ?? 'orion'`) | ПРОЙДЕНО (ручной путь), НЕ ПРОВЕРЕНО (сид для второго тенанта без правки переменной) |
| 9 | Настроить Telegram-канал | UI `/admin/telegram` + `POST /api/telegram/configs`; канал свой у каждой организации; токен шифруется ключом развёртывания | `src/app/(app)/admin/telegram/page.tsx:6-11`; `src/app/api/telegram/configs/route.ts:48,74`; `src/services/telegram/telegram-config-service.ts:122` | ПРОЙДЕНО (для ручного просмотра), но см. находку 1 — фоновые отправки тенант не учитывают |
| 10 | Домен | Второй домен/поддомен: правка `deploy/Caddyfile.prod` на сервере + `TENANT_DOMAIN`; в контейнеры переменная не проброшена | `deploy/Caddyfile.prod:23`; `src/proxy.ts:102-103`; `grep TENANT_DOMAIN docker-compose*.yml` → 0 | НЕ ПРОВЕРЕНО |
| 11 | Включить многотенантный режим | `MULTI_TENANT_MODE=multi` в `.env` **и** проброс в `environment:` сервисов; сейчас не проброшен, а при включении вход сломается (нет X-Tenant-ID у клиента) | `src/proxy.ts:87,226`; `src/services/tenancy/tenant-context-service.ts:13-18`; `docker-compose.yml:99` (есть только `DEFAULT_TENANT_ID`) | НЕ ПРОВЕРЕНО |
| 12 | Префиксы S3 | Присваиваются автоматически из `tenantId`; бакет один на развёртывание | `src/core/storage/s3-service.ts:150,158`; `src/core/media/media-service.ts:135`; `docker-compose.yml:88` (`S3_BUCKET`) | ПРОЙДЕНО |
| 13 | База/RLS | Одна БД и одна роль приложения; организация передаётся в `app.current_tenant` из сессии; отдельной роли/схемы на организацию нет | `src/lib/tenant.ts:25` (`requireTenantId` бросает при отсутствии организации); `prisma/seed.ts:25-27` (клиент обёрнут `applyTenantGuc`) | ПРОЙДЕНО (по чтению кода) |

### Что делается через интерфейс, а что только SQL или скриптом

| Действие | Путь | Почему не иначе |
|---|---|---|
| Создать организацию | **только SQL вручную** | ни API, ни UI; сид в проде выключен (`prisma/seed.ts:35,98`) |
| Задать активность/лимит/тариф | **только SQL** | поля есть в схеме (`prisma/schema.prisma:18-20`), кода нет |
| Создать пользователя и задать ему пароль | интерфейс `/admin/users` | `src/app/api/users/route.ts:40-86`; сброса по почте нет |
| Настроить название/ИНН/часовой пояс/уведомления | интерфейс `/admin/settings` | `src/app/api/settings/route.ts:23-42` |
| Заполнить справочники | интерфейс `/admin/dictionaries` (по одной записи) | автозаполнение шаблонами — только сид (`prisma/seed.ts:267`) |
| Завести объект/участок | интерфейс `/admin/sites` | `src/modules/sites/application/commands/site-admin-command.service.ts:97` |
| Завести оборудование | интерфейс `/admin/equipment` (по одной машине) | парк типовых машин — сид (`src/lib/seed/equipment.seed.ts:61`) |
| Настроить Telegram | интерфейс `/admin/telegram` | `src/app/api/telegram/configs/route.ts:48,74` |
| Домен, поддомены, TLS | **только правка файла на сервере** (`deploy/Caddyfile.prod`) + env | `deploy/Caddyfile.prod:23` |
| Префиксы S3 | автоматически из `tenantId`, ручных шагов нет | `src/core/storage/s3-service.ts:150,158` |

## Находки

| # | severity | path:line | проблема | сценарий / почему это важно | что предложить |
|---|----------|-----------|----------|------------------------------|----------------|
| 1 | критично | `src/core/notifications/telegram.ts:49`; `:338`; `:363` | Фоновые уведомления не знают своей организации: `getConfigs()` вызывается без тенанта, внутри — `getRequestTenantId() ?? process.env.DEFAULT_TENANT_ID`. В outbox/воркерах контекст запроса не открыт вообще (grep `runWithTenantContext|setRequestTenantId` по `src/core/outbox`, `src/workers`, `src/services/reports/event-handlers.ts` → 0). | Отчёт, простой, PDF, DLQ и алерты планировщика ТО по объектам клиента №2 уйдут в Telegram-чаты организации по умолчанию — то есть третьим лицам. Обратно: выключение уведомлений у клиента №2 ничего не изменит. | Передавать `event.tenantId` в `sendAlert`/`sendDocument` (в event-handlers он уже есть — `src/services/reports/event-handlers.ts:94`) и открывать контекст организации в outbox-пути. |
| 2 | важно | `prisma/seed.ts:119`; `:35`; `:98` | Организацию создаёт только сид, а сид в проде запрещён; ни API, ни UI для тенантов нет (`grep tenant.create src` → только `src/generated`), в миграциях вставки `Tenant` нет. | Подключение клиента №2 = ручной SQL в боевую БД, без аудита и без повторяемости. | Либо отдельная миграция-заготовка с параметром, либо служебный скрипт с проверкой (по аналогии с `scripts/seed-user-document-types.ts`). |
| 3 | важно | `src/proxy.ts:226`; `:120`; `:123`; `:87` | `enforceTenant` применяется ко всем `/api/*`, но в списке публичных путей нет `/api/auth/login`; клиент X-Tenant-ID не отправляет (grep → 0). | Если однажды выставить `MULTI_TENANT_MODE=multi`, вход вернёт 403 и приложение станет недоступно целиком — авария при «включении мультиаренды». | Добавить `/api/auth/login` (и статику) в исключения и/или проставлять тенанта из сессии, а не из заголовка. |
| 4 | важно | `docker-compose.yml:99`; `scripts/validate-env.ts:95,105` | `DEFAULT_TENANT_ID` в контейнер проброшен, `MULTI_TENANT_MODE` и `TENANT_DOMAIN` — нет (grep по `docker-compose*.yml` → 0 совпадений; единственное упоминание — генератор `.env`, `scripts/generate-env-docker.ps1:70,140`). | Включение мультиаренды через `.env` молча не сработает: переменная не дойдёт до контейнера, выделение тенанта из поддомена (`src/proxy.ts:102`) останется выключенным. | Пробросить переменные вместе с включением режима. |
| 5 | важно | `prisma/schema.prisma:19`; `:18` | `Tenant.maxUsers` и `Tenant.isActive` не читает ни один файл в `src/`, `scripts/`, `prisma/` кроме схемы (grep → 0). | Приостановить неплатящую организацию нечем (её люди продолжат входить), лимит «до N пользователей» не действует. | Проверка `isActive` при входе и `maxUsers` в `createUser` (`src/services/users/user-service.ts:162`). |
| 6 | важно | `src/lib/seed/equipment.seed.ts:61` | Захардкожено: `tenantId: process.env.DEFAULT_TENANT_ID ?? 'orion'`. Это единственный боевой (не тестовый) литерал `'orion'` вне замороженных зон (проверено grep по `src` с исключением `src/app/orion*`, `src/components/orion`, операторских экранов). | Парк машин второй организации, заведённый этим скриптом, попадёт в `orion`. | Принимать `tenantId` параметром, как сделано в `scripts/seed-checklist-blocks.ts:941`. |
| 7 | важно | `scripts/seed-sites.sql:2`; `prisma/schema.prisma:1748`; `src/modules/sites/application/queries/site-query.service.ts:64,76` | Скрипт вставляет `Site` без `tenantId`; колонка nullable (`String?`) — наследие до мультиаренды; все выборки фильтруют строго `where: { tenantId }`. | Объект из этого скрипта не увидит никто (в том числе владелец): строка есть, а в интерфейсе её нет. Отладка «объект пропал» уводит в сторону. | Либо заполнять `tenantId` в скрипте, либо запретить NULL отдельной миграцией. |
| 8 | важно | `src/services/dictionaries/tenant-dictionary-initializer.ts:15`; `prisma/seed.ts:267` | Справочники организации (марки свай, типы бурения, причины простоя, типы документов) заполняются только из сида — единственный боевой вызов. | У клиента №2 в проде справочники будут пустыми: отчёт по простою не выбрать причину, сваю — не выбрать марку. Заполнение вручную через UI возможно, но списка шаблонов в интерфейсе нет. | Дать служебный скрипт инициализации справочников по `tenantId` (как `scripts/seed-user-document-types.ts`, но без жёсткой привязки к одной переменной). |
| 9 | важно | `src/services/telegram/telegram-config-service.ts:122`; `docker-compose.yml:84,191` | Токен бота шифруется одним ключом развёртывания (`ENCRYPTION_KEY`, обязателен в compose). Ключа на организацию нет. | Это не дефект для одного клиента, но при нескольких клиентах один ключ = общий секрет на всех; компрометация ключа раскрывает токены всех ботов. | Зафиксировать как осознанный риск; при росте — ключ на организацию. |
| 10 | мелочь | `src/modules/settings/application/settings-service.ts:27,102` | `TenantSettings` создаётся лениво (upsert при первом сохранении); при отсутствии строки чтение отдаёт умолчания. | Переключатели уведомлений «включены по умолчанию» до первого сохранения настроек владельцем: тишина в настройках не равна «не отправлять». | Создавать строку настроек вместе с организацией. |
| 11 | мелочь | `scripts/reset-one-password.ts:26-31` | Скрипт сброса пароля отказывается работать вне локальной БД `pilingtrack_test`. | В проде сброс пароля возможен только через UI (если вход есть) или SQL. Для «забыл пароль единственный администратор» рецепта в коде нет. | Документировать процедуру или дать защищённый путь через админку. |
| 12 | мелочь | `scripts/seed-user-document-types.ts:102-103` | Скрипт требует `DEFAULT_TENANT_ID` и падает без него. | Для клиента №2 нужно помнить про переменную окружения, иначе заведёт типы документов не туда. | Принять `tenantId` аргументом. |
| 13 | мелочь | `scripts/seed-checklist-blocks.ts:941` | `SEED_TENANT_ID \|\| DEFAULT_TENANT_ID \|\| 'orion'` — третий фолбэк на литерал. | Молчаливая запись чек-листов в `orion` при незаданных переменных. | Убрать литерал, падать при отсутствии аргумента. |
| 14 | мелочь | `deploy/Caddyfile.prod:23,69` | Единственный домен `orionpiling.ru` (+ зеркало `.online`). Маршрутизации по поддомену на уровне прокси нет. | Вторая организация = правка конфигурации прокси на сервере вручную, вне кода приложения. | Описать в runbook. |
| 15 | мелочь | `src/app/api/alerts/webhook/route.ts:113,124` | Вебхук Alertmanager привязан к `process.env.DEFAULT_TENANT_ID` (сессии у него нет) — и для тумблера уведомлений, и для адреса доставки. | Серверные алерты существуют только у организации по умолчанию; у клиента №2 их не будет вовсе. | При нескольких развёртываниях — по одному вебхуку/тенанту или параметр в URL. |
| 16 | мелочь | `src/core/outbox/dead-letter-queue.ts:95` | `origin.tenantId ?? getRequestTenantId() ?? DEFAULT_TENANT_ID`. | Недоставленные события клиента №2, у которых потерялся тенант, «просигналят» в чат `orion`. | Тот же корень, что у находки 1. |
| 17 | мелочь | `src/app/api/users/route.ts:47-48` | Тенант берётся из записи пользователя сессии, а не из заголовка. | Это как раз хорошо (в single-режиме пользователь №2 сможет работать), но означает, что `enforceTenant` к данным отношения не имеет — он только про режим. Стоит зафиксировать, чтобы не ждать от него защиты данных. | Записать в документацию по мультиаренде. |
| 18 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:221`; `src/lib/pdf-data.ts:49` | Название организации берётся только из сессии; `DEFAULT_TENANT_ID` намеренно не подставляется. | Правильное поведение, но означает, что печатные формы без сессии (фоновый PDF) имени организации не получат. | Убедиться, что фоновые PDF всегда получают `tenantId` события. |
| 19 | мелочь | `prisma/schema.prisma:20,23-29,65` | Поля `plan`, `subscriptionStatus`, `monthlyFee`, `stripeCustomerId`, модель `TenantInvoice` не читает ни один файл в `src/` (кроме `src/generated`). | Биллинга/тарифов фактически нет: «тариф» — только колонка. | Либо реализовать, либо не обещать тарифы клиентам. |
| 20 | важно | `prisma/schema.prisma:2524-2550`; `src/services/feedback/feedback-event-service.ts:83-89,112-131`; `src/services/audit/audit-service.ts:13` | У `FeedbackEvent` (лента событий и журнал аудита) нет колонки организации. Интерфейс `AuditEvent.tenantId` объявлен (`audit-service.ts:13`), но `recordAuditEvent` его никуда не передаёт — запись идёт в `recordFeedbackEvent` без тенанта. Права на чтение раздаёт `getAccessWhere`: привилегированные роли получают `{}` (все события), остальные — `{OR:[{actorId},{audience:'ALL'}]}`. | Перед появлением тенанта №2 лента общая по построению: ADMIN/DISPATCHER увидят события всех организаций, оператор чужой фирмы — всё, что помечено `audience:'ALL'`. Например, `user.created` (`src/services/users/user-service.ts:177-187`) пишется вообще без организации. | Добавить `tenantId` в `FeedbackEvent`, писать и фильтровать по нему. |

## Что не проверено

- **Живой стенд.** Приложение не запускалось, сборка/тесты/Playwright не запускались
  (задача — только чтение). Все выводы о поведении — из чтения кода.
- **Реальные данные БД.** Сколько организаций заведено на бою, какой у них `tenantId`,
  заполнены ли `TenantSettings` и `TelegramConfig` — НЕ ПРОВЕРЕНО (правило «No production»;
  локальную БД не поднимал).
- **Фактическое содержимое `docker-compose.yml` сервиса `workers`.** Проверял только
  grep по переменным; полного списка `environment:` не сверял построчно.
- **Порядок инициализации RLS при создании новой организации** (какие политики
  требуют строку в `Tenant` до вставки данных) — НЕ ПРОВЕРЕНО; читал только
  `src/lib/tenant.ts:25` и `src/lib/tenant-scope.ts:23`.
- **`src/core/security/**` — файлы, которые прямо запрещены к правке**, читал только
  через поведение (`src/core/security/tenant-context.ts:95`); собственные политики RLS
  не разбирал.
- **Замороженные зоны** (`src/app/orion/**`, `src/app/api/orion/**`) не читал, кроме
  строки `src/app/api/orion/lead/route.ts:79` в результатах grep — она привязана к
  `DEFAULT_TENANT_ID`, но зона заморожена и в находки не вынесена.
- **Существующие отчёты** `docs/audits/**` не открывал (запрет задания); темы
  пересекаются, но каждая находка выше подтверждена собственной командой.
- Проверка, что строка `path:line` существует — выполнена для всех цитат чтением
  диапазона; «ГИПОТЕЗА» в таблице шагов проставлена там, где механизм описан кодом,
  но на практике не исполнялся.
