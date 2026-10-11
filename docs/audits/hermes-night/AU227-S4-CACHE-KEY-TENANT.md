# AU227-S4-CACHE-KEY-TENANT: ключи кэша и tenant

Версия кода: `git rev-parse HEAD` = `51f26088db4a028db3a103bee1e5d4f66ce46803`
(ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`). Только чтение, код не менялся.

## Итог

- Просмотрены все слои кэша: Redis-слой (`src/lib/redis-cache.ts`, `src/lib/cache-strategies.ts`),
  слой данных (`src/lib/cached-queries.ts`), keyed-запросы (`src/app/api/analytics/sites/route.ts`,
  `src/services/weather/weather-client.ts`, `src/services/reports/event-handlers.ts`),
  внутрипроцессный кэш ответов (`src/core/cache/response-cache.ts` + `src/core/api-wrapper.ts`).
- Ключей с tenantId в теле: 3 реальных Redis-ключа (`dictionary:{tenant}:all`,
  `analytics:sites:v3:{tenant}:...`, `alert:downtime:{tenant}:...`) + 1 вариант `weather:...:site:{tenant}:{site}`.
- Общих (без tenant) ключей с данными, зависящими от организации: **1** — `crews:all`.
- Остальные «общие» ячейки (ответы API через `api-wrapper`) tenant в ключе **не содержат**,
  но разведены по сессии (`userId` = sha256 от токена), поэтому между организациями не пересекаются.
- Счёт по важности: **критично — 0, важно — 2, мелочь — 6** (всего 8 находок).
- Топ-5: (1) `crews:all` — глобальный ключ, в нём лежат бригады всех организаций;
  (2) кэш ответов API не содержит tenantId вовсе, изоляция держится только на хеше сессии,
  при том что сам модуль объявляет «per-tenant cache isolation»;
  (3) `sites:{tenant}:all` сбрасывается, но никем не пишется — мёртвый сброс;
  (4) сбросы кэша ответов идут без области (`invalidateAll`/префикс) — чистят ячейки всех организаций;
  (5) список техники (/api/equipment) и пользователей (/api/users) кэшируются, но мутации их не сбрасывают.
- Немедленных утечек внутри одной организации не найдено: единственный сегодняшний потребитель
  `crews:all` фильтрует по `site.tenantId`. Риск `crews:all` — латентный (до второго тенанта).

## Методика

Что и как искал (можно повторить):

- Инвентарь файлов кэша:
  `search_files *cache* в src` → `src/lib/redis-cache.ts`, `src/lib/cached-queries.ts`,
  `src/lib/cache-strategies.ts`, `src/lib/cache-metrics.ts`, `src/core/cache/response-cache.ts`,
  `src/app/api/crews/cache.ts`.
- Точки входа в кэш (полные пути):
  `grep -rn "getOrFetch\(|getResponseCache\(|cacheAside\(|getOrSet\(|cache\.set\(|cache\.get\("` по `src`.
- Литералы ключей и вставка tenant:
  `grep -rn -E "crews:all|dictionary:|sites:.*all|analytics:sites|weather:conditions|alert:downtime|revoked-jti"` по `src scripts workers`.
- Маршруты, включившие кэш ответов: `grep -rn "cache: true" src/app` → **12** маршрутов (число из команды).
- Слой ответов: чтение `src/core/api-wrapper.ts` (весь) и `src/core/cache/response-cache.ts` (весь).
- Модель тенантности `Crew`: `prisma/schema.prisma:1858-1883` (у `Crew` нет колонки `tenantId`).
- Проверка, кто вызывает `getCachedCrewsAll` и сбросы: `grep -rn "getCachedCrewsAll|invalidateCrews|invalidateSites|invalidateReports|invalidateDictionaries|invalidateSiteAnalytics"`.
- Числа командой: `cache: true` — 12 маршрутов; `cacheAside(` вне библиотеки — 2 вызова;
  `cache.getOrSet(` — 3 вызова; литералов-билдеров ключей с tenant — 3 строки.

### Таблица ключей

Ключ (шаблон) — полный путь от корня — tenant в ключе — риск.

| Ключ | файл:строка | tenant в ключе | риск |
| --- | --- | --- | --- |
| `dictionary:{tenantId}:all` | `src/lib/cached-queries.ts:66` | ДА | нет (запрос тоже фильтрует tenant: `:69-71`) |
| `analytics:sites:v3:{tenantId}:{from}:{to}:{siteId}` | `src/app/api/analytics/sites/route.ts:28` | ДА | нет |
| `alert:downtime:{tenantId}:{reportId}:{reason}:{duration}` | `src/services/reports/event-handlers.ts:311` | ДА (без tenant ключ не строится, `:307-308`) | нет |
| `weather:conditions:site:{tenantId}:{siteId}` | `src/services/weather/weather-client.ts:142,163` | ДА | нет |
| `weather:conditions:point:{lat}:{lon}` | `src/services/weather/weather-client.ts:160,163` | НЕТ | низкий (погода — не тенантные данные) |
| `crews:all` | `src/lib/cached-queries.ts:39` (запрос `:40-49`) | НЕТ | **высокий (латентный)**: в значении бригады всех организаций |
| `sites:{tenantId}:all` | `src/lib/cached-queries.ts:108` | ДА | нет ключа: только сброс, записи нет (мёртвый код) |
| `GET:{path}|u:{hash(токен+acting-as)}|p:{params}` | `src/core/api-wrapper.ts:95-100` | НЕТ (сессия) | средний: изоляция только по сессии, не по tenant |
| `revoked-jti:{jti}` | `src/services/auth/session-service.ts:148,163` | НЕТ | нет (состояние по дизайну) |
| `pilingtrack:` (prefix) | `src/lib/redis-cache.ts:64` | НЕТ | нет (namespace, tenant внутри ключа там, где надо) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/lib/cached-queries.ts:37-52` (ключ `:39`, `where` `:41`) | `getCachedCrewsAll()` кладёт в Redis под общим ключом `crews:all` выборку `db.crew.findMany({ where: { isActive: true } })` без фильтра организации. У модели `Crew` нет `tenantId` (`prisma/schema.prisma:1858-1883`) — тенант наследуется от `site`. В значении кэша оказываются бригады всех организаций с именами операторов, техникой и объектами. | Пока единственный потребитель — `src/app/api/crews/all/route.ts:25`, и он фильтрует в JS по `crew.site?.tenantId === tenantId` (`:28`), поэтому утечки внутри одного тенанта нет. Но это ровно тот класс, который уже закрывали: `equipment:all` удалён с таким же диагнозом (`src/lib/cached-queries.ts:83-88`), а словари переведены на тенантный ключ. Любой новый потребитель `getCachedCrewsAll()` без фильтра (или ошибка в фильтре) сдаст бригады чужих организаций. Актуально «до тенанта №2». | Либо добавить `tenantId` в ключ (`crews:{tenantId}:all`) и в запрос (`where: { isActive: true, site: { tenantId } }`) с параметром функции, либо оставить как есть, но закрепить комментарием «ключ общий осознанно; каждый потребитель обязан фильтровать». |
| 2 | важно | `src/core/api-wrapper.ts:95-100` (scope `:44-50`) | Кэш ответов API строится без `tenantId` в ключе: только `endpoint`, `params` и `userId` (=sha256(токен + `x-acting-as`)). При этом сам модуль объявляет «5. Per-tenant cache isolation» (`src/core/cache/response-cache.ts:9`) и умеет класть `t:{tenantId}` в ключ (`:82`) и фильтровать сбросы по tenant (`:246-255`), но `api-wrapper` этот параметр не передаёт ни разу. | Сегодня корректно: `readSessionToken` (`src/services/auth/session-service.ts:265-274`, cookie или Bearer) вызывается и в `getSessionCacheScope`, и в `requireAuth` (`src/lib/auth.ts:162`), а токен уникален на пользователя → ячейки двух организаций не пересекаются. Риск латентный: если появится общий/сервисный токен или анонимная ячейка (`userId` пуст при `readSessionToken(request) === null`, `src/core/api-wrapper.ts:89`), данные тенантов схлопнутся в одну ячейку. 12 маршрутов с `cache: true` (число из команды) зависят от этого неявного инварианта. | Прокинуть `tenantId` в ключ `getOrFetch({ ..., tenantId })` (значение брать из уже проверенной сессии) — тогда изоляция перестанет зависеть от уникальности токена, а точечные сбросы станут возможны. |
| 3 | мелочь | `src/lib/cached-queries.ts:107-113` (строка `:108`) | `invalidateSites()` сбрасывает Redis-ключ `sites:{tenantId}:all`, который нигде не записывается: `cacheAside` вне библиотеки вызывается лишь 2 раза (команда: `grep cacheAside(`), и «sites:all» среди них нет. Комментарий `:94-106` описывает «слоя два», но слой данных по объектам не существует. | Сброс — no-op (`del` по несуществующему ключу). На корректность не влияет (реально чистится только кэш ответов `getResponseCache('sites').invalidate('GET:/api/sites')`), но мёртвый вызов вводит в заблуждение при чтении. | Убрать строку `:108` и поправить комментарий, либо вернуть запись слоя данных, если он задуман. |
| 4 | мелочь | `src/app/api/crews/cache.ts:9-14`; `src/lib/cached-queries.ts:111,123`; `src/app/api/telegram/configs/route.ts:75,114,159` | Сброс кэша ответов идёт без области: `invalidateCrewsCache()` вызывает `cache.invalidate(prefix)` без `{ tenantId }`, `invalidateReports()` — префикс `GET:/api/reports`, Telegram — `invalidateAll()`. Сносятся ячейки всех организаций. | Не утечка, а перепроизводительность: каждая мутация одной организации сбрасывает кэш ответов всем. Следствие находки №2 (tenant в ключе нет). При 12 кэшируемых маршрутах и втором тенанте — лишние промахи к БД. | После добавления `tenantId` в ключ передавать область в `invalidate(prefix, { tenantId })`; `invalidateAll()` в Telegram заменить на точечный сброс своей организации. |
| 5 | мелочь | `src/app/api/equipment/route.ts:28,31-101`; `src/app/api/users/route.ts:37,40-155` | Маршруты списков кэшируются (`domain: 'equipment'`, TTL 60 с; `domain: 'users'`, TTL 30 с), но ни одна мутация (POST/PUT/DELETE техники и пользователей) не сбрасывает соответствующий кэш ответов — нет вызова `invalidate`/`invalidateAll` в файлах. | После заведения/правки техники или пользователя список отдаётся устаревшим до истечения TTL (до 60 с / 30 с). Со стороны экрана выглядит как «сохранение не применилось». К тенанту не относится, но это тот же класс, что уже чинили для объектов и отчётов. | Добавить сброс домена (`getResponseCache('equipment').invalidateAll()` / `...('users')...`) в обработчики мутаций. |
| 6 | мелочь | `src/services/weather/weather-client.ts:142,160,163` | Ключ погоды по координатам `weather:conditions:point:{lat}:{lon}` не содержит организацию, тогда как вариант по объекту — `weather:conditions:site:{tenantId}:{siteId}` (`:142`). | Данные — прогноз в точке, не тенантные, поэтому утечки нет. Несогласованность: при одном и том же месте два разных способа ключа, что затрудняет аудит «в каждом ключе есть tenant». | Задокументировать намеренность или добавить префикс организации для единообразия. |
| 7 | мелочь | `src/lib/cached-queries.ts:149-150` | `invalidateSiteAnalytics()` строит glob из шаблона `analytics:sites:v3:${tenantId}:*` и передаёт его в `cache.invalidatePattern` (SCAN по шаблону, `src/lib/redis-cache.ts:267-274`). `tenantId` в шаблон подставляется без экранирования glob-метасимволов. | `tenantId` — cuid (`[a-z0-9]`), метасимволов не содержит, поэтому сейчас безопасно. ГИПОТЕЗА: если формат идентификатора когда-нибудь изменится и включит `*`, `?` или `[`, сброс затронет ключи чужих организаций. | Экранировать tenantId перед подстановкой в шаблон (или сбрасывать по точному ключу с tenant-областью). |
| 8 | мелочь | `src/lib/cached-queries.ts:126-129` (ключ `crews:all` `:127`) | `invalidateCrews()` удаляет единый ключ `crews:all` — сброс не может быть точечным по организации (ключ общий). Парная проблема к находке №1. | Корректности не ломает (сброс общий, как и ключ), но подтверждает, что слой бригад не разделён по организациям. | Решается вместе с №1: тенантный ключ → тенантный сброс. |

### Что прошло проверку (ПРОЙДЕНО)

| # | path:line | вывод |
| --- | --- | --- |
| P1 | `src/lib/cached-queries.ts:64-77` (ключ `:66`, фильтры `:69-71`) | `dictionary:{tenantId}:all` — tenant в ключе, запрос фильтрует `where: { tenantId }`; изоляция закреплена тестом `src/lib/__tests__/cached-queries-dictionaries.test.ts:71-72,90`. |
| P2 | `src/app/api/analytics/sites/route.ts:28-32` | `analytics:sites:v3:{tenantId}:...` — tenant в ключе, запрос `getSiteAnalytics({ tenantId, ... })`. |
| P3 | `src/services/reports/event-handlers.ts:307-311` | `alert:downtime:{tenantId}:...` — без tenant ключ не строится (`:307-308`), «один на все тенанты столкнул бы алерты». |
| P4 | `src/core/api-wrapper.ts:86-89,44-50` | Кэширование ответа отключено для отозванной/истёкшей сессии и при `?_ts`; scope ответа = хеш токена + `x-acting-as`, что разводит ячейки пользователей и ролей. |
| P5 | `src/lib/redis-cache.ts:177-179` | `buildKey` только приводит регистр и заменяет пробелы; `tenantId` (cuid) от этого не искажается и не склеивается с чужим. |

## Не проверено

- **Гипотеза №7 (glob-метасимволы в tenantId)** не подтверждена экспериментом: проверено только чтение схемы (`cuid()`), поведение `scanStream` при метасимволе не воспроизводилось.
- **Реальные ключи в живом Redis** не читались: подключения к Redis/БД не делалось (правила — только чтение кода). Числа ключей и их содержимое — по коду, не по `KEYS`/`SCAN`.
- **`x-acting-as` и `canActAs`** как фактор ключа разобраны поверхностно (`src/lib/auth.ts` прочитан фрагментами); полноценный разбор подмены ролей в эту задачу не входил.
- **Накопитель ссылок на миниатюры** (`src/lib/media-thumbnails.ts:42,81,93`) — это клиентская `Map` в браузере (ключ — `mediaId`), серверного кэша и tenant-ключа там нет; помечен как не относящийся к серверной изоляции, в находки не включён.
- **Рабочие процессы (workers/scripts)** на предмет собственных кэш-ключей просмотрены только grep-ом по литералам ключей; отдельного чтения их исходников не было.
- **Функциональная давность** кэша ответов у `/api/equipment` и `/api/users` (находка №5) выведена из отсутствия вызова сброса в файлах маршрутов; сквозной прогон (создание → чтение списка) не выполнялся.
