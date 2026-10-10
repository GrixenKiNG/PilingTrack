# AU48-S8-ORG-SETTINGS — Настройки организации: что настраивается и где хранится

Версия кода: `git rev-parse HEAD` = `2cd3f8d3770d1e743457d86d447c30c0758f1cf9`
(ветка `hermes/q4-0926`, рабочая папка `D:\PillingR\wt-night`).

Независимый первый проход. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`,
`docs/strategy` не открывались. Код приложения не менялся.

## Итог

Настроек «администратора» в продукте немного, и почти все они живут в БД (таблицы
`TenantSettings`, `TelegramConfig`, справочники, `ReadinessRuleSet`,
`ReadinessAccessMatrix`, `ModuleLayoutTemplate`), а не в переменных окружения.
Реально применяются на ходу только два поля `TenantSettings` — `companyName` и
`timezone`; остальные (`inn`, `dateFormat`, `units`, `currency`) хранятся, но ни на
что не влияют. Самый важный вывод: **пороги погоды (15/36 м/с) не являются
настройкой вообще** — это две константы в двух файлах, которые админ не может
поменять без правки кода и деплоя, и код сам предупреждает о риске их расхождения.

По severity: критично — 0, важно — 4, мелочь — 6.

Топ-5:
1. `PUT /api/settings` проверяет `user.role !== 'ADMIN'` напрямую и игнорирует
   режим «Действую как» (`actingAs`) — единственное место прав, где обход
   общей функции (`api/settings/route.ts:27` против `authorization-service.ts:158-166`).
2. Пороги ветра 15 и 36 м/с — константы в `weather-client.ts:70-71` и
   (для смены) `work-warnings.ts:61`; настраивать их негде.
3. `GET /api/settings` без проверки права — настройки читает любой
   аутентифицированный пользователь (`api/settings/route.ts:15-20`).
4. `POST /api/notifications/telegram/test` требует `reports.read_all`
   (доступнее, чем `telegram.manage`, которым заводят канал).
5. Смена часового пояса меняет границы производственных суток и периоды отчётов
   сразу, без перезапуска и без кэша (`settings-service.ts:26`), но проверяется
   только IANA-именем, а экран предлагает лишь 10 зон (`lib/timezone.ts:89-100`).

## Методика

Что и как искали (чтобы можно повторить):

```bash
git rev-parse HEAD
# поиск по файлам настроек/словарей/телеграма
rg -l -i "settings" src            # → src/modules/settings, api/settings, components/.../workspace-settings.tsx
rg -l "telegram"  src              # → services/telegram, core/notifications/telegram.ts, api/telegram/configs
rg -l -i "dictionary|справочник" src
rg "tenantSettings" src            # кто читает/пишет таблицу настроек
rg "process\.env\.[A-Z_]+" src     # все переменные окружения
rg "isNotificationEnabled" src     # кто реально читает выключатели уведомлений
```

Прочитаны целиком: `src/modules/settings/**`, `src/app/api/settings/route.ts`,
`src/app/api/telegram/configs/route.ts`, `src/app/api/dictionary/manage/route.ts`,
`src/app/api/weather/route.ts`, `src/services/weather/weather-client.ts`,
`src/services/telegram/telegram-config-service.ts`,
`src/services/dictionaries/dictionary-service.ts`, `src/services/auth/authorization-service.ts`,
`src/components/piling/workspace-settings.tsx`, экраны `to/readiness/settings/**`,
раскладки `admin/**` и `(readiness-admin)/layout.tsx`, схемы Prisma и миграции ролей.

Статусы у каждого вывода: **ПРОЙДЕНО** (проверено по коду и строка открыта),
**ГИПОТЕЗА** (следствие, не проверенное запуском), **НЕ ПРОВЕРЕНО**.

## Карта настроек, доступных администратору

| Настройка | Где хранится (таблица, поле) | Кто может менять | Как применяется (кэш/перезапуск) | Что при пустом значении | Файл:строка |
|---|---|---|---|---|---|
| Название компании `companyName` | `TenantSettings.companyName` | ADMIN (`PUT` только роль ADMIN) | читается живьём через `getSettings`, без кэша; используется в шапке контура готовности | дефолт `""`, экран показывает «—» | `prisma/schema.prisma:917`; `modules/settings/application/settings-service.ts:26`; `api/settings/route.ts:27`; `workspace-settings.tsx:249,259` |
| Часовой пояс `timezone` | `TenantSettings.timezone` (дефолт `Europe/Moscow`) | ADMIN | читается живьём из БД каждым запросом (`pile-passports`, экспорт отчётов, KPI ТО, смены готовности); перезапуск не нужен | непустая только настоящая IANA-зона, иначе откат на базовое `Europe/Moscow` | `prisma/schema.prisma:919`; `modules/settings/domain/settings.ts:109-117`; `settings-service.ts:26` |
| Выключатели уведомлений `notifications` | `TenantSettings.notifications` (Json) | ADMIN | читается в момент отправки; отправители спрашивают `isNotificationEnabled` | нет ключа → `DEFAULT_NOTIFICATIONS` | `prisma/schema.prisma:924`; `modules/settings/domain/settings.ts:52-61,65-83`; `settings-service.ts:58-85` |
| ИНН / формат даты / единицы / валюта | `TenantSettings.inn, dateFormat, units, currency` | ADMIN (через PUT) | **не применяется нигде** (даты всегда ru-RU, единицы метрические, валюта «₽» в разметке) | дефолты схемы | `prisma/schema.prisma:918,920-922`; `settings.ts:12-17`; `workspace-settings.tsx:244-247` |
| Telegram-каналы (label, botToken, chatId, enabled) | `TelegramConfig` (tenantId, label, botToken (шифр), chatId, enabled) | ADMIN (`telegram.manage`) | читается живьём в `core/notifications/telegram.ts`; список отдаётся с кэшем ответа 60 с, инвалидируется при записи | пустой label/chatId/токен → ошибка 400 (`normalizeText`) | `prisma/schema.prisma:2506-2518`; `services/telegram/telegram-config-service.ts:6-12,83,122`; `api/telegram/configs/route.ts:46,52,75` |
| Справочники: марки свай, типы бурения, причины простоев, виды документов | `PileGrade`, `DrillingType`, `DowntimeReason`, `UserDocumentType` | ADMIN (`dictionary.manage`) | кэш данных `dictionary:<tenant>:all` TTL 900 с, инвалидируется при записи | пустое имя → 400; нулевая/пустая длина марки сваи → 400/422 | `prisma/schema.prisma:2439,2468,2485`; `services/dictionaries/dictionary-service.ts:92,313`; `lib/cached-queries.ts:27,131`; `api/dictionary/manage/route.ts:76` |
| Роли пользователей | `User.role` + CHECK `chk_user_role_valid` в БД | ADMIN (`users.manage`) | сразу, следующая сессия/запрос считает права по роли | дефолт `OPERATOR` | `prisma/schema.prisma:106`; `prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql:23`; `authorization-service.ts:83` |
| Матрица доступов контура готовности | `ReadinessAccessMatrix` (черновик → публикация) | `readiness.rules.manage` (по умолчанию только ADMIN) | применяется сразу после «Опубликовать» | нет опубликованной строки → значения из кода (`capability-defaults.ts`) | `prisma/schema.prisma:953`; `api/readiness/access-matrix/route.ts:25,32,46`; `modules/readiness/domain/capability-defaults.ts:64` |
| Правила готовности (веса критериев, блокеры) | `ReadinessRuleSet` (черновик → публикация) | ADMIN (`assertRole(user,'ADMIN')`) | публикация применяется к **новым** сменам; уже открытые досчитываются по прежней версии | нет опубликованной строки → «Правила ещё не приняты» | `prisma/schema.prisma:933`; `api/readiness-rules/route.ts:25`; `api/readiness-rules/publish/route.ts:14`; `settings-workspace.tsx:551` |
| Раскладки дашбордов / плиток | `ModuleLayoutTemplate` (tenantId, surfaceId, entityId, template Json) | ADMIN (роль ADMIN напрямую) | читается живьём из БД | нет строки → базовая раскладка из кода | `prisma/schema.prisma:1537-1552`; `api/layout/[surfaceId]/route.ts:54,67,80` |
| Объекты и техника (тоже «справочники») | `Site`, `Equipment` и т.п. | `sites.manage` = ADMIN+DISPATCHER; `equipment.manage` = ADMIN | живьём, кэш `sites:*` 30 с | — | `authorization-service.ts:73,74,104` |

Как раскладки и справочники читаются всеми ролями: страница `/admin/settings`
открывается по `system.read` = ADMIN+DISPATCHER (`admin/settings/layout.tsx:4`;
`authorization-service.ts:131`), но правки шлёт только админ (кнопка «Сохранить»
и тумблеры скрыты для не-админа — `workspace-settings.tsx:237,296`). **ПРОЙДЕНО.**

## Настройки, которые правятся только переменной окружения или SQL

Только переменной окружения (в UI/БД поля нет вообще):

| Что | Переменная | Где читается | Последствие пустого значения |
|---|---|---|---|
| Адрес погодного сервиса | `WEATHER_API_BASE` | `services/weather/weather-client.ts:82` | дефолт `https://api.open-meteo.com` |
| Адрес Telegram API (прокси у провайдера) | `TELEGRAM_API_BASE` | `core/notifications/telegram.ts:227,265,397` | дефолт `https://api.telegram.org` |
| Ключ шифрования токенов ботов | `ENCRYPTION_KEY` / `ENCRYPTION_KEY_Vn`, `ENCRYPTION_KEY_VERSION` | `core/security/encryption.ts:74,79` | в production — исключение на старте (`encryption.ts:94-98`), токены Telegram не шифруются/не читаются |
| Тенант по умолчанию и режим мультитенантности | `DEFAULT_TENANT_ID`, `MULTI_TENANT_MODE` | `core/notifications/telegram.ts:49`; `services/tenancy/tenant-context-service.ts` (см. тест `tenant-context-service.test.ts:55-72`) | — |
| Обязательная конфигурация приложения | `DATABASE_URL_POSTGRES`, `SESSION_SECRET` | `core/observability/health-checks.ts:122-123` | health-check сообщает о некомплекте |
| Хранилище S3/CDN и лимиты медиа | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `CDN_BASE_URL`, `MEDIA_MAX_FILE_SIZE` | `core/storage/s3-service.ts:24-45`; `core/media/media-service.ts:502-508` | дефолты в коде |
| Резервное копирование | `BACKUP_ENABLED`, `BACKUP_DIR` | `core/observability/health-tracker/checkers/backup.ts:18,24` | бэкап выключен |
| Планировщики фонового воркера | `PM_SCHEDULER_ENABLED`, `PROJECTION_REBUILD_ENABLED`, `READINESS_SCHEDULER_ENABLED`, `PDF_TEMP_CLEANUP_ENABLED` | `workers/unified-worker.ts:174-187` | включаются по умолчанию (`!== 'false'`) |
| Публичный адрес сайта | `NEXT_PUBLIC_SITE_URL` | `app/sitemap.ts:10` | дефолт `https://orionpiling.ru` |

Только SQL (правка кода/БД, UI не пишет):

- Список из 7 ролей держит CHECK-констрейнт `chk_user_role_valid` в базе; при
  добавлении роли правят и миграцию, и `scripts/apply-postgres-hardening.ts`
  (комментарий в `prisma/schema.prisma:89-90`, миграция
  `20260906090000_user_role_check_all_roles/migration.sql:21-24`).
- Стартовый набор справочников (марки свай, типы бурения, причины простоев, виды
  документов) — код `services/dictionaries/system-templates.ts`, заливается
  `initializeTenantDictionaries` (`tenant-dictionary-initializer.ts:19-58`), не
  настройка.

## Находки

| # | severity | path:line | Проблема | Зачем это важно | Как чинить |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/settings/route.ts:27` | `PUT` проверяет `user.role !== 'ADMIN'` строкой, а не через `assertCan`/`can` | В режиме «Действую как» (actingAs) админ сохраняет настройки своей собственной ролью, тогда как всё остальное приложение считает права по исполняемой роли (`authorization-service.ts:141-157`). Правило проекта нарушено в одном месте | Заменить на `assertCan(user, 'system.read')` (или отдельное право) до записи |
| 2 | важно | `src/services/weather/weather-client.ts:70-71` и `src/modules/operator-mobile/domain/work-warnings.ts:61` | Порог прекращения работ (15 м/с) и перевода стрелы (36 м/с) — константы в двух файлах; настройки нет | Админ не может поменять порог; при изменении легко поправить одно место из двух, и экран оператора разойдётся с карточкой погоды — ровно этот баг описан в комментарии `weather-client.ts:56-68` | Вынести пороги в `TenantSettings` (или одну общую константу через `core/`), чтобы был один владелец |
| 3 | важно | `src/app/api/settings/route.ts:15-20` | `GET /api/settings` требует только `requireAuth`, без проверки права | Настройки организации (название, часовой пояс, выключатели) читает любой аутентифицированный, включая OPERATOR/ASSISTANT | Добавить `assertCan(user, 'system.read')` или явно задокументировать, что чтение разрешено всем |
| 4 | важно | `src/app/api/notifications/telegram/test/route.ts:29` | Проверка соединения с ботом требует `reports.read_all`, а не `telegram.manage` | Право слабее того, которым заводят канал (`configs/route.ts:46`); роль, которой каналы не видны, может инициировать отправку тестового сообщения | Сверять с `telegram.manage` |
| 5 | мелочь | `src/app/api/settings/route.ts:60-69` | `hasSettingsChanges` считает значимыми `inn`, `dateFormat`, `units`, `currency`, которые ни на что не влияют | В журнал аудита попадают «изменения» мёртвых полей; сохранение «как было» по ним оставит ложный след | Исключить мёртвые поля из сравнения (или из PUT-схемы) |
| 6 | мелочь | `src/components/piling/to/readiness/settings/notifications-section.tsx:132-134` | Каналы «Электронная почта», «Push в браузере», «SMS» ведут на `/admin/settings`, хотя таких настроек там нет | Пользователь переходит по ссылке на страницу, где обещанного пункта не существует | Убрать ссылку или пометить «не реализовано» без навигации |
| 7 | мелочь | `prisma/schema.prisma:2506-2518` | У `TelegramConfig` нет уникальности по `(tenantId, chatId)` | Один и тот же чат можно завести дважды — дублирующая доставка | Уникальный индекс `@@unique([tenantId, chatId])` (миграция) |
| 8 | мелочь | `src/lib/timezone.ts:89-100` | Экран предлагает 10 IANA-зон; `sanitizeSettings` принимает **любую** валидную IANA-зону | Значение, записанное в обход UI через API, может быть вне списка и всё равно применится (сохранится как есть — `settings.ts:109-117`) | Либо валидировать по списку на сервере, либо признать список лишь подсказкой |
| 9 | мелочь | `src/modules/settings/application/settings-service.ts:26` | `readSettings` читает БД при каждом обращении; `isNotificationEnabled` вызывается в путях доставки уведомлений | На каждую отправку уведомления — отдельный SELECT настроек (кэша нет) | При необходимости — короткий кэш с инвалидацией при записи |
| 10 | ГИПОТЕЗА | `src/services/telegram/telegram-config-service.ts:56` | `listTelegramConfigs` не фильтрует `enabled` в выборке | Выключенный канал всё равно показывается (это ожидаемо для UI), вопрос — фильтрует ли `enabled` отправитель при рассылке; в этой сессии не проверялось | Проверить в `core/notifications/telegram.ts` фильтр по `enabled` |

## Что не проверено

- **НЕ ПРОВЕРЕНО:** фильтрация `enabled` в рассылке Telegram — читал только
  `listTelegramConfigs`/`update`, самого отправителя (`core/notifications/telegram.ts`)
  целиком не разбирал (см. находку 10).
- **НЕ ПРОВЕРЕНО:** фактическое содержимое `.env`/`.env.example` (AGENTS.md
  запрещает читать `.env*`); список переменных окружения собран **из кода**
  (`rg "process.env"`), а не из файла конфигурации, поэтому возможны переменные,
  читаемые вне `src/` (Dockerfile, скрипты) — их я не открывал.
- **НЕ ПРОВЕРЕНО:** значения настроек в реальной БД (production/локальная база не
  подключались) — отчёт описывает код, а не текущее состояние организации.
- **НЕ ПРОВЕРЕНО:** запуск проверок (`npx tsc --noEmit`, `npm run lint`, тесты) —
  задача read-only аудита кода, команды не запускались; все выводы статические.
- **ГИПОТЕЗА:** влияние мёртвых полей (`inn`/`dateFormat`/`units`/`currency`)
  «когда-нибудь на печатные формы» — это комментарий в коде (`settings.ts:12-17`),
  не проверенное поведение.
