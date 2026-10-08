# W106 — Маршруты API без проверки входа и прав

## Итог

- Всего `route.ts` в `src/app/api/`: **141** (найдено `find src/app/api -name 'route.ts'`).
- Маршрутов, которые отдают данные или меняют их **и совсем не проверяют вход**: **0**.
- Без аутентификации вообще — **10 файлов**, и все они публичны по замыслу (health/liveness/ready, статус `/api`, публичный вход, вебхук Alertmanager по секрету, публичная форма ORION, служебный GET телеметрии). Из них действительно спорных — **1** (`GET /api/telemetry/ingest`, мелочь).
- **Главное (системное, важно):** обёртки `withApi`/`withMutation` **не проверяют вход**. Они открывают контекст тенанта, ставят CSRF, лимит запросов и маппят ошибки, но ни `requireAuth`, ни проверку прав не делают — это прямо сказано в комментарии `src/core/api-wrapper.ts:77-89` («Проверки прав живут внутри обработчиков»). Сейчас код в порядке только потому, что **каждый** маршрут зовёт `requireAuth`/`assertCan` сам; проверено, что ни один маршрут не полагается на одну обёртку.
- По правам (вход есть, явной проверки права нет, но данные — справочные/свои): 6 маршрутов, все мелочи, риск низкий (`readiness-rules` GET, `settings` GET, `dictionary/all` GET, `weather` GET, `feedback/stream` GET, `GET /api/telemetry/ingest`).
- Критичных и важных не-системных находок нет. Разбивка: критично — **0**, важно — **1** (системная), мелочь — **6**.

Топ-5:
1. Обёртка не является проверкой входа — любой забывший `requireAuth` маршрут откроется целиком (`src/core/api-wrapper.ts:77-89`).
2. `GET /api/telemetry/ingest` отдаёт служебные метаданные без входа (`src/app/api/telemetry/ingest/route.ts:341`).
3. `GET /api/readiness-rules` доступен любому вошедшему, включая OPERATOR/ASSISTANT, без проверки права (`src/app/api/readiness-rules/route.ts:13`).
4. `GET /api/settings` — любой вошедший читает настройки организации (название, ИНН) без проверки права (`src/app/api/settings/route.ts:15`).
5. `GET /api` (корень API) отдаёт статус и версию без входа (`src/app/api/route.ts:13`).

## Методика

Всё воспроизводится из корня рабочей копии.

1. Список маршрутов: `find src/app/api -name 'route.ts'` → 141 файл.
2. Экспортируемые методы и признаки проверки по каждому файлу:
   `for f in $(find src/app/api -name 'route.ts' | sort); do grep -nE 'export (async )?(function|const) (GET|POST|PUT|PATCH|DELETE)' "$f"; grep -nE 'requireAuth|getSession|assertCan|authorize|hasPermission|ensureTenantAccess|resource-access|resolveReadinessRequestContext' "$f"; done`
3. Кто вообще без обёртки: проверка отсутствия `withApi|withMutation|withReadinessCommand` в файле → 7 файлов (`alerts/webhook`, `health`, `health/deep`, `liveness`, `ready`, `readiness` (устар. проба), `orion/lead`).
4. Определение обёртки — прочитано целиком: `src/core/api-wrapper.ts` (`withApi` — 62-147, `withMutation` — 178-223). Вывод о том, что вход обёртка не проверяет, — из строк 74-106 и комментария 77-89.
5. Адаптер готовности: `src/app/api/readiness/_shared/route-adapter.ts` (`withReadinessCommand` → `withMutation`) и `src/app/api/readiness/_shared/request-context.ts:66-92` — здесь `requireAuth` вызывается для каждого маршрута `readiness/*`.
6. Примитивы проверок: `src/lib/auth.ts:158` (`requireAuth` → 401), `src/services/auth/authorization-service.ts:158/162/171/177` (`can`/`assertCan`/`assertRole`/`assertAnyRole` — бросают `ServiceError(403)`, обёртка превращает их в 403), `src/services/auth/authorization-service.ts:189` (`resolveUserScope` требует право при `requestedUserId !== sessionUser.id`), `src/services/auth/resource-access-service.ts:11`.
7. Проверка «requireAuth без разбора ошибки»: `grep -rnE "await requireAuth\(request\)" src/app/api --include=route.ts | grep -v error` → только `auth/logout`.
8. Для маршрутов с параметром `userId` (возможный IDOR) прочитаны сервисы: `getEditableReport`, `listReportsForUserScope` (`src/modules/reports/application/queries/report-query.service.ts:34-68, 272-283`), `getAccessibleSites` (`src/modules/sites/application/queries/site-query.service.ts:51-83`) — все сужают выборку через `resolveUserScope`/`resolveAccessibleUserId` с правом `reports.read_cross_user`.

Замечания по методике: обёрнутые маршруты ищутся по literal-строке; `withReadinessCommand` учтён отдельно. Проверка «есть ли право» вне маршрута (в модуле/сервисе) отмечается как «проверка в сервисе» — такие места в таблицу находок не попали, но перечислены в разделе «Не проверено».

Классификация по методам (все 141 маршрут-файл):
- с обёрткой `withApi`/`withMutation` напрямую — 120;
- через `withReadinessCommand` (оборачивает `withMutation`) — 14 маршрутов команд + маршруты чтения рядом, все с `resolveReadinessRequestContext`;
- без обёртки вообще — 7 (`alerts/webhook`, `health`, `health/deep`, `liveness`, `ready`, `readiness`, `orion/lead`).

## Находки

Формат: # | severity | path:line | проблема | сценарий / почему важно | как чинить.

| # | severity | path:line | Проблема | Сценарий / почему важно | Как чинить |
|---|---|---|---|---|---|
| 1 | важно (системное) | `src/core/api-wrapper.ts:77-89` (и `62-147`, `178-223`) | `withApi`/`withMutation` не проверяют вход и права — только контекст тенанта, CSRF, лимит, маппинг ошибок. Авторизация целиком на вызывающем коде. | Любой новый (или отредактированный) маршрут, обёрнутый только в `withApi` и забывший `requireAuth`, окажется полностью открытым — обёртка даёт ложное чувство защиты. Сейчас все маршруты зовут проверку сами, но это дисциплина, а не гарантия уровня фреймворка. | Не считать обёртку проверкой доступа; держать это правило в чек-листе. Опционально — обязательный параметр `auth: 'required'` в `ApiWrapperOptions`, который сам отказывает без пользователя. |
| 2 | мелочь | `src/app/api/telemetry/ingest/route.ts:341` | `GET` без входа возвращает служебные метаданные сервиса (`status`, `service: 'iot-telemetry'`, `version`, список endpoint'ов). | Мелкая разведка: подтверждает наличие и версию IoT-шлюза, подсказывает путь приёма телеметрии. Данных не отдаёт. | Убрать публичный `GET` или закрыть через `requireAuth`. |
| 3 | мелочь | `src/app/api/readiness-rules/route.ts:13` | `GET` защищён только `requireAuth` — правила техготовности читает любой вошедший, включая OPERATOR/ASSISTANT; способности/права не проверяются. `PUT` рядом корректно требует `assertRole(user, 'ADMIN')` (строка 25). | Правила контура готовности — конфигурация организации; сотрудник без отношения к готовности видит пороги и состав проверок. Прямой утечки персданных нет. | Если правила не предназначены всем — добавить проверку права (например, `readiness.rules.manage`/чтение через `capabilities`, как в `src/app/api/readiness/*`). |
| 4 | мелочь | `src/app/api/settings/route.ts:15` | `GET` защищён только `requireAuth` — любой вошедший читает настройки организации (название компании, ИНН, часовой пояс, флаги уведомлений). `PUT` требует ADMIN (строка 27). | Реквизиты компании (ИНН, наименование) доступны любому вошедшему пользователю без проверки права. | Если это не всем — добавить проверку права на чтение настроек. |
| 5 | мелочь | `src/app/api/dictionary/all/route.ts:9` | `GET` только `requireAuth` — любой вошедший читает все справочники. | По замыслу так и должно быть (справочники нужны формам), но явного права нет. Риск низкий. | Оставить осознанно; при появлении чувствительных справочников — развести по правам. |
| 6 | мелочь | `src/app/api/weather/route.ts:40` и `src/app/api/feedback/stream/route.ts:9` | Оба защищены только `requireAuth`. `weather` — расчёт по координатам; `feedback/stream` — SSE с 15-секундным `sync`-пингом (полезной нагрузки нет). | Оба безобидны (внешний погодный сервис; поток без данных), но не несут явной проверки права. | На усмотрение; при необходимости — отдельные права или оставить как есть. |

Мелочь, не занесённая в таблицу (не уязвимость, но отступает от «явной проверки входа»):
- `src/app/api/auth/logout/route.ts:15` — `const { user } = await requireAuth(request)` без разбора `error`. Для выхода это корректно (операция идемпотентна, токен гасится по строке, не по пользователю), но формально ошибку входа не обрабатывает.

## Публичные по замыслу (не находки)

Эти маршруты намеренно без сессии; каждый защищён иначе или отдаёт минимум:
- `src/app/api/health/route.ts:24`, `src/app/api/health/deep/route.ts:34`, `src/app/api/liveness/route.ts:13`, `src/app/api/ready/route.ts:27`, `src/app/api/readiness/route.ts:26` — пробы живости/готовности; тело намеренно узкое (комментарии в файлах: `health` — «fingerprinting material», `readiness` — «never expose internal details»).
- `src/app/api/route.ts:13` — корневой `GET`, статус/версия приложения (мелочь, но без входа).
- `src/app/api/auth/login/route.ts:17` — вход, публичен по замыслу; CSRF (`withCsrf`, строка 27) + лимит попыток.
- `src/app/api/alerts/webhook/route.ts:87-90` — вход по общему секрету (`ALERTMANAGER_WEBHOOK_TOKEN`, `timingSafeEqual`, строки 71-85), fail-closed при отсутствии токена.
- `src/app/api/orion/lead/route.ts:1-38` — публичная форма ORION; по AGENTS.md — **замороженная зона**, не трогаем (правило 3). Защищена лимитом, honeypot и экранированием.

## Не проверено

- **Проверки прав внутри сервисов/модулей** (маршрут отдаёт decision внутрь): эти места не читались построчно, считается доверие по комментарию и сигнатуре. Примеры: `users.documents.*` в `src/app/api/users/*`, `src/app/api/user-documents/control/route.ts:24`, `src/app/api/user-document-types/route.ts:53`, `src/app/api/briefings/*`, `src/app/api/safety/*` — здесь маршрут передаёт `actor`/`mayReadAllDocuments` в модуль (`@/modules/users`, `@/modules/safety`), а фактическую проверку выполняет сервис; построчно не подтверждал.
- **readiness-команды** (`src/app/api/readiness/**`): контроль способностей выполняется в командах (`src/modules/readiness/application/permits/commands.ts:63-67` — `assertPermitEditor`), но я прочитал только файл нарядов; остальные команды (смены, дефекты, передачи, waivers) на предмет `capabilities` не открывал — «проверка в сервисе, не проверено».
- **Права на уровне матрицы** (какие именно роли входят в каждое право `Ability`) — не проверялось: это отдельная тема (соответствие «manage» на read-путях и т.п.), не входит в W106.
- **RLS-политики БД** — не проверялись; учитывался только прикладной слой маршрутов.
- **Реальное поведение в рантайме** (что отказы 401/403 действительно отдаются) — не запускалось; вывод из чтения кода. Проверки из AGENTS.md §6 (`tsc`, `lint`, тесты, `build`) в этой read-only задаче не запускались.
- Метод подсчёта: обёртки ищутся по literal-строке (`withApi`/`withMutation`/`withReadinessCommand`); если где-то применяется динамический реэкспорт обёртки под другим именем — такой маршрут не был бы распознан как обёрнутый. При сплошном чтении списка таких не встретилось.
