# AU187-S4-QUERY-CACHE-INVALIDATION: кэш запросов — сброс после изменений

Версия (git rev-parse HEAD): `8e1efda4c90075939cad2baf707a4d4a613e4b79`
Ветка: `hermes/q4-0926`. Только чтение: код приложения не менялся, единственный созданный файл — этот отчёт.
Область: клиентский кэш данных (react-состояние, ref-кэш, zustand), серверный кэш ответов маршрутов (`withApi({cache:true})`) и redis-кэш данных (`cacheAside`), и то, какие мутации их сбрасывают. Замороженные экраны (operator / operator-mobile / ORION) пропущены по AGENTS.md §1.

## Итог

- Критичных находок нет. Важных — 3, мелочей — 4, гипотез (требуют доп. проверки) — 3. Проверено-исправно (ПРОЙДЕНО) — 4 блока.
- SWR / react-query / tanstack в проекте НЕТ (см. `package.json`). Клиентский кэш — это: (а) zustand-persist стор `src/lib/store.ts`, (б) ручной ref-кэш «загружено один раз за сессию экрана» в хуках `use-sites-data` / `use-reports-data`, (в) серверный кэш ответов маршрутов с TTL.
- Топ-1 (важное): список пользователей `/api/users` кэшируется на 30 с (`src/app/api/users/route.ts:37`), но ни POST/PUT/DELETE его не сбрасывают. `useUsersList` после создания/правки/блокировки делает повторный GET и получает из кэша старый список — новый сотрудник не появляется, переключатель «блокировка» визуально откатывается (`src/components/piling/admin-users/use-users-list.ts:102,126,158`).
- Топ-2 (важное): парк техники `/api/equipment` кэшируется на 60 с (`src/app/api/equipment/route.ts:28`), мутации POST/PUT/DELETE кэш не сбрасывают — форма бригады и фильтр отчётов до минуты видят старый состав парка.
- Топ-3 (важное): правка плана объекта не сбрасывает кэш сводки аналитики (`src/lib/cached-queries.ts:107-113` против `:149-152`) — плитки дашборда до 5 минут показывают старые плановые числа.
- Топ-4 (мелочь): ручной ref-кэш справочников/сотрудников на экранах «Отчёты» и «Объекты» живёт весь сеанс экрана и не перечитывается после правок в других разделах.
- Топ-5 (гипотеза): кэш ответов маршрутов — процессно-локальная `Map` (`src/core/cache/response-cache.ts:107,338`); на нескольких инстансах сброс на одном не чистит остальные. Не проверено, сколько инстансов на проде.

## Методика

Поиск по коду (git-bash, rg через `search_files`), без запуска приложения:

- Наличие клиентских библиотек кэша: `rg 'useSWR|react-query|useQuery|useMutation|QueryClient|tanstack|zustand'` по репозиторию и `package.json`.
- Где кэш ответов включается: `rg 'cache: true|cacheTTL|domain:' src/app/api` и чтение `src/core/api-wrapper.ts` (`withApi`/`withMutation`, ключ кэша, `getSessionCacheScope`).
- Кто сбрасывает: `rg 'invalidateSites|invalidateReports|invalidateCrews|invalidateDictionaries|invalidateSiteAnalytics|cacheAsideInvalidate|\.invalidate\(' src`.
- Обратная проверка «нет сброса»: `rg 'invalidateEquipment|invalidateUsers|getResponseCache..equipment.|GET:/api/equipment'` (пусто) и то же для users.
- Ручной клиентский кэш: `rg 'LoadedRef|PromiseRef|attempt|reloadKey' src/components/piling`.
- Redis-слой: чтение `src/lib/redis-cache.ts`, `src/lib/cache-strategies.ts`, `src/lib/cached-queries.ts`, `src/core/cache/response-cache.ts`.
- Точки мутаций читались файлами: `src/app/api/{users,equipment,crews,sites,reports,dictionary,telegram,feedback,monitoring}/**`.

Карта кэшируемых GET-маршрутов и их сброса (только `cache:true`):

| Данные | Файл:строка (кэш) | Чем сбрасывается | Риск |
|---|---|---|---|
| Пользователи `/api/users` | `src/app/api/users/route.ts:37` (30 с) | ничем | ВАЖНО: устаревший список после create/update/block |
| Парк техники `/api/equipment` | `src/app/api/equipment/route.ts:28` (60 с) | ничем | ВАЖНО: устаревший парк до 60 с на всех экранах |
| Бригады `/api/crews`, `/all` | `src/app/api/crews/route.ts:33`, `src/app/api/crews/all/route.ts:30` (15 с) | `invalidateCrewsCache` `src/app/api/crews/cache.ts:9`; redis `invalidateCrews` `src/modules/crews/application/commands/crew-command.service.ts:207,336,371` | ПРОЙДЕНО |
| Объекты `/api/sites`, `/all`, `/[id]` | `src/app/api/sites/route.ts:25`, `src/app/api/sites/all/route.ts:23`, `src/app/api/sites/[id]/route.ts:28` (30 с) | `invalidateSites` — `src/app/api/sites/[id]/route.ts:102,122`, `src/app/api/sites/create/route.ts:40`, `.../hierarchy/route.ts:74,122`, `.../assign/route.ts:30,49` | ПРОЙДЕНО |
| Отчёты `/api/reports/all`, `/my` | `src/app/api/reports/all/route.ts:36`, `src/app/api/reports/my/route.ts:26` (10 с) | `invalidateReports` — `src/app/api/reports/upsert/route.ts:150`, `admin-upsert/route.ts:67`, `delete/route.ts:174` | ПРОЙДЕНО |
| Сводка аналитики (redis) `analytics:sites:v3:*` | `src/app/api/analytics/sites/route.ts:28-33` (300 с) | `invalidateSiteAnalytics` из событий отчёта `src/services/reports/event-handlers.ts:190`; НЕ из правки объекта | ВАЖНО (см. №3) |
| Справочники (redis) `dictionary:{tenant}:all` | `src/lib/cached-queries.ts:64-77`, маршрут `src/app/api/dictionary/all/route.ts:17` (15 мин) | `invalidateDictionaries` — `src/app/api/dictionary/manage/route.ts:107,131,145` | ПРОЙДЕНО |
| Telegram-каналы `/api/telegram/configs` | `src/app/api/telegram/configs/route.ts:52` (60 с) | `getResponseCache('telegram').invalidateAll()` — `:75,114,159` | ПРОЙДЕНО |
| Лента обратной связи `/api/feedback/events` | `src/app/api/feedback/events/route.ts:74` (10 с) | `invalidateFeedbackCache` — `:44,50,54` | ПРОЙДЕНО |
| Парк мониторинга `/api/monitoring/fleet` | `src/app/api/monitoring/fleet/route.ts:35` (30 с) | ничем (данные живые, окно ограничено; правка шаблона их не меняет) | МЕЛОЧЬ |

## Находки

| # | severity | статус | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО | `src/app/api/users/route.ts:37` (кэш) против `:86,:120,:154` (POST/PUT/DELETE) | GET `/api/users` кэшируется 30 с (`withApi({cache:true})`), но ни одна мутация пользователя не сбрасывает кэш | `src/components/piling/admin-users/use-users-list.ts:102,126,158` после create/update/toggleActive делает повторный `GET /api/users` — попадает в кэш и рисует старый список: новый сотрудник не появляется, а переключение блокировки (например, снять/поставить «Заблокирован») визуально откатывается, пока не истечёт 30 с. Удаление (`:140`) правит локальный стейт, но серверный кэш остаётся — следующий листинг в пределах 30 с вернёт удалённого | Сбросить кэш после мутаций: `getResponseCache('users').invalidate('GET:/api/users')` в POST/PUT/DELETE (или завести `invalidateUsers()` рядом с остальными в `src/lib/cached-queries.ts`) |
| 2 | важно | ПРОЙДЕНО | `src/app/api/equipment/route.ts:28` (кэш), `:101` (POST), `src/app/api/equipment/[id]/route.ts:122,170` (PUT/DELETE) | GET `/api/equipment` кэшируется 60 с, мутации его не сбрасывают (`rg 'invalidateEquipment|GET:/api/equipment'` — пусто) | Экран техники правит список из ответа мутации (локально ок, `src/components/piling/admin-equipment/use-equipment-list.ts:74,98,106`), но форма бригады (`src/components/piling/admin-crews/use-crews-data.ts:83`) и фильтр отчётов (`src/components/piling/admin-reports/use-reports-data.ts:121`) читают `/api/equipment` заново и до 60 с видят старый парк; перезагрузка `/admin/equipment` в окне 60 с отдаёт список без только что созданной установки | Добавить сброс `getResponseCache('equipment').invalidate('GET:/api/equipment')` в POST/PUT/DELETE техники |
| 3 | важно | ПРОЙДЕНО | `src/lib/cached-queries.ts:107-113` (`invalidateSites`) против `:149-152` (`invalidateSiteAnalytics`) | Сброс кэша объекта не вызывает сброс кэша сводки аналитики | Правка плана объекта идёт через PUT `/api/sites/[id]` (`src/app/api/sites/[id]/route.ts:63-71,102` → `invalidateSites`), а сводка (`src/app/api/analytics/sites/route.ts:28-33`, ключ `analytics:sites:v3:*`, TTL 300 с) содержит плановые поля из `SitePilePlan`/`Site` (`src/services/analytics/site-analytics-service.ts:83-107,177-179`). Итог: после правки плана плитки дашборда до 5 минут показывают старый план и старый процент выполнения. Фактическая выработка (из отчётов) сбрасывается событиями отчёта и не страдает | В `invalidateSites` дополнительно звать `invalidateSiteAnalytics(tenantId)` |
| 4 | мелочь | ПРОЙДЕНО | `src/components/piling/admin-reports/use-reports-data.ts:94-95,155-207` | Справочники формы отчёта (марки свай, типы скважин, причины простоя) кэшируются на сеанс экрана через `referenceDataLoadedRef` | Список читается один раз за жизнь экрана; если справочник поправили в другой вкладке (или на другом устройстве), форма отчёта до перезагрузки страницы предлагает старые значения. Списки фильтра (объекты/операторы/техника, `:112-152`) тоже читаются один раз при монтировании и не перечитываются после правок | По необходимости: инвалидация при фокусе окна или событийный триггер; либо снять защёлку при повторном открытии формы |
| 5 | мелочь | ПРОЙДЕНО | `src/components/piling/admin-sites/use-sites-data.ts:31-34,73,98` | На экране «Объекты» списки сотрудников (`loadUsers`) и марок свай (`loadPileGrades`) кэшируются ref-защёлкой на сеанс экрана | Открытие диалога назначения/создания объекта не перечитывает список, если он уже читался: только что заведённый сотрудник не появится в выборе, пока экран не перемонтируется | Перечитывать при каждом открытии диалога (как это сделано для бригад, `src/components/piling/admin-crews/use-crews-data.ts:60-65`) |
| 6 | мелочь | ПРОЙДЕНО | `src/app/api/monitoring/fleet/route.ts:35` | Снимок парка мониторинга кэшируется 30 с без инвалидации | Данные формируются из живых телеметрии/отчётов и подтягиваются по WebSocket, поэтому окно ограничено; правка шаблона (`src/app/api/monitoring/template/route.ts`) содержимое снимка не меняет | Оставить; при появлении мутаций, влияющих на снимок, добавить сброс |
| 7 | мелочь | ГИПОТЕЗА | `src/core/cache/response-cache.ts:107,338` | Кэш ответов маршрутов — процессно-локальная `Map` (`getResponseCache` кэширует инстансы в модульной `Map`), а redis-кэш данных, наоборот, общий | На нескольких инстансах приложения сброс (`invalidate`) на одном процессе не очищает ячейки других → разночтение между репликами до истечения TTL. Не проверено, запущено ли приложение в несколько инстансов на проде | Если прод многопоточный по инстансам — для критичных доменов перейти на общий бэкенд кэша (как сделано для аналитики, `src/app/api/analytics/sites/route.ts:37-39`) |
| 8 | мелочь | ГИПОТЕЗА | `src/services/reports/event-handlers.ts:173-201` | Сброс кэша сводки аналитики после отчёта выполняется через обработчик события (outbox), а не синхронно в маршруте | Возможен короткий интервал между «отчёт сохранён» и «сводка сброшена» (пока воркер не обработает outbox). Величина лага не измерялась | Не проверено; при необходимости — измерить лаг outbox-воркера |
| 9 | мелочь | ГИПОТЕЗА | `src/lib/api.ts:29-36` | `authFetch` не задаёт `cache:'no-store'`, а ответы `/api/*` не выставляют `Cache-Control` | Возможен эвристический кэш браузера для GET-запросов к API (не проверено на реальных заголовках ответа). Проявлялось бы как редко воспроизводимая устарелость между вкладками | Прокинуть `cache:'no-store'` в клиентские чтения либо явный `Cache-Control: no-store` на стороне маршрутов |
| 10 | — | ПРОЙДЕНО | `src/app/api/reports/upsert/route.ts:150`, `admin-upsert/route.ts:67`, `delete/route.ts:174` | Мутации отчётов сбрасывают кэш списка | `invalidateReports()` чистит `GET:/api/reports` (покрывает `/all` и `/my`); сводка аналитики сбрасывается событием. Журнал после создания/удаления отчёта свежий | — |
| 11 | — | ПРОЙДЕНО | `src/app/api/crews/cache.ts:9`; `src/modules/crews/application/commands/crew-command.service.ts:207,336,371` | Мутации бригад сбрасывают оба слоя | Маршрут сбрасывает кэш ответов, команда — redis-ключ `crews:all` (`getCachedCrewsAll`, `src/lib/cached-queries.ts:37-52`). Локальный список бригад тоже правится (`src/components/piling/admin-crews/admin-crews.tsx:153,165,179`) | — |
| 12 | — | ПРОЙДЕНО | `src/app/api/sites/create/route.ts:40`; `src/app/api/sites/[id]/route.ts:102,122`; `src/app/api/sites/[id]/hierarchy/route.ts:74,122`; `src/app/api/sites/[id]/assign/route.ts:30,49` | Все мутации объектов зовут `invalidateSites` | `invalidateSites` чистит и redis-ключ `sites:{tenant}:all`, и префикс ответов `GET:/api/sites` (список, карточка, `/all`) — `src/lib/cached-queries.ts:107-113` | — |
| 13 | — | ПРОЙДЕНО | `src/app/api/dictionary/manage/route.ts:107,131,145`; `src/app/api/telegram/configs/route.ts:75,114,159`; `src/app/api/feedback/events/route.ts:44,50,54` | Справочники, telegram и лента сбрасывают свой кэш на мутациях | Также `getSessionCacheScope` разводит ячейки по сессии и роли «действую как» (`src/core/api-wrapper.ts:44-50`) — иначе ответ в полных правах отдавался бы в урезанной роли | — |
| 14 | — | ПРОЙДЕНО | `src/lib/store.ts:73-185` (persist, `:173-183`) | zustand-persist хранит `currentUser`/`actingAs`/`selectedSiteId` в `localStorage['piling-track-storage']` | Сбрасывается на `login`/`logout` (`:82-88,105-113`), поэтому после смены пользователя режим «действую как» не переживает вход. Лента обратной связи на клиенте (`src/components/piling/use-feedback-feed.ts:52-57`) — в памяти, с опросом | — |

## Не проверено

- Многопоточность/число инстансов на проде (находка №7): неизвестно, один ли процесс обслуживает прод; от этого зависит реальность расхождения кэша между репликами.
- Реальные HTTP-заголовки ответов `/api/*` (`Cache-Control`) — находка №9 остаётся гипотезой, проверялось только отсутствие `cache:'no-store'` в `authFetch`.
- Величина задержки outbox-воркера между сохранением отчёта и сбросом сводки аналитики (находка №8).
- `src/app/api/admin/analytics/overview`, `src/components/piling/admin-analytics.tsx`, `src/components/piling/admin-dashboard.tsx` — как эти экраны перечитывают данные и не кэшируют ли их на клиенте сверх прочитанного; цепочка не прослежена целиком.
- TTL/поведение живого Redis и node-кэша не измерялись вживую (нет запуска приложения); все выводы — из чтения кода.
- Замороженные экраны (operator / operator-mobile / ORION) не аудировались по AGENTS.md §1.
