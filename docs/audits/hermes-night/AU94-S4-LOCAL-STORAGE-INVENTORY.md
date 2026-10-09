# AU94-S4-LOCAL-STORAGE-INVENTORY: что приложение хранит на устройстве и очищается ли при выходе

Версия (git rev-parse HEAD): `952971d7ab54bbc68926fff919bbfb98ed2de45c`
Ветка: `hermes/q4-0926`. Режим: только чтение, код приложения не изменялся. Создан единственный файл — этот отчёт.

Резюме для владельца (5 строк):

1. Приложение пишет в localStorage четыре группы данных: сессию пользователя (`piling-track-storage`), черновики сменных отчётов (`report-draft-...`), очередь неотправленных записей машиниста (`pilingtrack.operator.queue.v1`) и косметику интерфейса (`equipment-view-mode`, шаблон плиток). IndexedDB хранит только фотографии установок. Единственная кука — `pt-session` (сессия, httpOnly, недоступна скриптам).
2. Кнопка «Выход» очищает только сессию (`pt-session` + текущий пользователь в `piling-track-storage`). Черновики отчётов и очередь команд выхода не обнуляют — они остаются на телефоне.
3. На общем планшете следующего машиниста это касается напрямую: неотправленные записи предыдущего хранятся в localStorage целиком (цифры выработки, текст происшествия) и сверху экран намеренно показывает новому пользователю имена и число чужих записей.
4. Черновики отчётов привязаны к id пользователя, поэтому в интерфейсе чужому не видны, но физически лежат на устройстве; удаляются только после успешной отправки отчёта или при повторном открытии той же формы тем же человеком позже 24 часов.
5. Если сервер выхода не смог отозвать сессию (Redis недоступен → ответ 503), кука `pt-session` не стирается и человек остаётся в системе до 12 часов — на общем устройстве это и есть «предыдущий пользователь».

## Итог

- Всего находок: 8. По важности: критично — 0, важно — 3, мелочь — 5.
- Топ-5:
  1. Выход не очищает `report-draft-<userId>-...` — производственные данные и комментарии к простоям остаются на устройстве (важно).
  2. Выход не очищает очередь `pilingtrack.operator.queue.v1`; полные записи предыдущего машиниста лежат в открытом виде, а баннер показывает сменщику имена и число чужих записей (важно).
  3. При отказе отзыва сессии (503) кука `pt-session` не стирается — сессия остаётся активной до 12 ч (важно).
  4. `currentUser` (email, имя, роль) хранится в localStorage и остаётся там, если браузер закрыли без выхода (мелочь).
  5. Косметика и шаблон плиток (`equipment-view-mode`, `monitoring-equipment-tile-template-v1`) не очищаются никогда; персональных данных не содержат (мелочь).

## Методика

Что искал и как (повторяемо):

- `git rev-parse HEAD` → версия выше.
- `search_files` (ripgrep) по `src/` по шаблонам: `localStorage|sessionStorage|indexedDB|IndexedDB|IDBDatabase`, `\.setItem\(|\.getItem\(|\.removeItem\(|window\.name|sessionStorage`, `document\.cookie|Cookies\.|setCookie|getCookie|js-cookie`, `cookie` (регистронезависимо), `cookies\.set|\.cookie\(|setHeader\(['"]Set-Cookie`, `serviceWorker|service-worker|caches\.|CacheStorage|navigator\.serviceWorker`, `caches\.open|CacheStorage|BroadcastChannel|SharedWorker|navigator\.storage`, `persist|createJSONStorage|zustand|localStorage` (в `src/lib`), `clearSessionCookie|logout|removeItem|persist\.clear|localStorage\.clear`, `foreignQueueSummary|ownerName|Войти другим`, `usePilingStore|\.login\(|setCurrentUser`.
- Полностью прочитаны (сверял каждую цитируемую строку): `src/lib/store.ts`, `src/components/piling/operator-mobile/offline-queue.ts`, `src/components/piling/operator-mobile/offline-queue-banner.tsx`, `src/components/piling/operator-mobile/use-offline-queue.ts`, `src/components/piling/report-form/use-report-form.ts`, `src/components/piling/admin-equipment/admin-equipment.tsx`, `src/components/piling/monitoring/equipment-tile-storage.ts`, `src/components/piling/monitoring/equipment-tile-asset-storage.ts`, `src/components/piling/monitoring/design-tuning-panel.tsx`, `src/components/piling/monitoring/use-equipment-tile-template.ts`, `src/components/piling/layout-editor/use-layout-template.ts`, `src/components/piling/login-page.tsx`, `src/services/auth/session-service.ts`, `src/services/auth/auth-service.ts`, `src/app/api/auth/logout/route.ts`, `src/app/(app)/layout.tsx`, `src/lib/api.ts`, `src/lib/csrf-protection.ts`, `src/lib/client-feedback.ts`.
- Проверка отсутствия PWA/сервис-воркера: `ls public/`, `find public -iname "*sw*" -o -iname "*manifest*"` (нашёл только `public/orion/specs/manifest.json` — каталог спецификаций техники в морозильной зоне ORION, не web-manifest), `next.config.ts:114` (комментарий «PWA cache headers ... removed»), `search_files` по `src` дал 0 регистраций `serviceWorker`.
- Версии окружения: `node -e` → `zustand ^5.0.12`, `next 16.3.6`.

Морозильные зоны (operator screen variants, ORION) я не изменял. Часть находак лежит в `src/components/piling/operator-mobile/**` — это морозильная зона, но задание прямо требует инвентарь localStorage, поэтому файлы только прочитаны и приведены как источник.

Статусы: ПРОЙДЕНО — вывод подтверждён чтением кода/командой; ГИПОТЕЗА — вывод логически следует из кода, но в рантайме не наблюдался; НЕ ПРОВЕРЕНО — данные недоступны без запуска браузера.

## Находки

| # | важность | path:line | что именно | сценарий / почему важно | как чинить |
|---|----------|-----------|------------|--------------------------|------------|
| 1 | важно | `src/components/piling/report-form/use-report-form.ts:285`, `:295`, `:320`, `:461` | localStorage-ключ `report-draft-<userId>-<siteId>-<date>`: сваи, бурение, простои с комментариями, моточасы, время смены, черновые поля. Персональные данные: нет прямых, но это производственные данные и свободный текст (комментарии к простоям). Статус: ПРОЙДЕНО. | Выход (logout) ключ не удаляет. Удаление только: после успешной отправки (`:461`); при повторном открытии той же формы тем же пользователем, если черновик старше 24 ч (`:320`); при повреждённом JSON (`:341`). Машинист, не отправивший отчёт, оставляет свои цифры и текст на общем планшете навсегда (если тот же ключ больше не откроют). | Чистить `report-draft-*` текущего пользователя при выходе или по TTL-таймеру независимо от повторного открытия. |
| 2 | важно | `src/components/piling/operator-mobile/offline-queue.ts:29`, `:41`–`43`, `:306`–`310`, `:347`–`348`; `src/components/piling/operator-mobile/offline-queue-banner.tsx:75`–`85` | localStorage-ключ `pilingtrack.operator.queue.v1`: массив команд, у каждой `ownerId`, `ownerName`, `label` и полный `command` (цифры выработки, текст происшествия `description`, `actual`/`reason` поправки). Персональные данные: да (имя владельца, текст происшествия). Статус: ПРОЙДЕНО (код). | Выход очередь не очищает (сделано намеренно). `readQueue()` фильтрует чужие записи (`isMine`, `:290`–`292`), поэтому состав чужой записи в интерфейсе не показывается, НО `foreignQueueSummary()` (`:306`–`310`) намеренно отдаёт сменщику `count` и `owners`, а баннер их печатает (`offline-queue-banner.tsx:82`–`84`): «На телефоне лежат неотправленные записи другого сотрудника (Иванов И.): 2». Полные тела команд при этом лежат в localStorage в открытом виде. | Если раскрытие имён/числа чужих записей нежелательно — убрать `owners` из баннера или перенести очередь в хранилище с очисткой при выходе; иначе оставить как осознанный компромисс и задокументировать. |
| 3 | важно | `src/app/api/auth/logout/route.ts:19`–`21`; `src/services/auth/auth-service.ts:151`–`154`; `src/services/auth/session-service.ts:293`–`304` | Кука `pt-session`: при успешном выходе очищается (`clearSessionCookie`, `maxAge: 0`). Но при неудачном отзыве токена роут возвращает 503 и до `createLogoutResponse()` не доходит → кука НЕ стирается. Статус: ПРОЙДЕНО (код; закреплено тестом `src/app/api/auth/logout/__tests__/route.test.ts:48`). | Redis недоступен → пользователь жмёт «Выход», получает «Не удалось завершить сеанс...», `logoutClient` возвращает false и локальное состояние не сбрасывается (`src/lib/api.ts:142`–`148`). Сессия живёт до истечения куки (12 ч, `session-service.ts:8`). На общем устройстве следующий человек входит в чужую активную сессию. | Это осознанный fail-open (не отзывать — не значит продолжать). Для общего планшета стоит рассмотреть: при 503 всё равно чистить куку локально и требовать повторного входа. |
| 4 | мелочь | `src/lib/store.ts:11`–`16`, `:105`–`113`, `:173`–`183` | localStorage-ключ `piling-track-storage` (zustand persist, `partialize`): `currentUser` (`id`, `email`, `name`, `role`), `actingAs`, `selectedSiteId`. Персональные данные: да (email, имя). Статус: ПРОЙДЕНО (код). | при `logout()` состояние сбрасывается в `null`, middleware persist перезаписывает хранилище — после явного выхода email/имя там стираются. НО если браузер закрыли без выхода, `currentUser` остаётся в localStorage до следующего визита (тогда `src/app/(app)/layout.tsx:317`–`328` перезапишет его данными из `/api/auth/me` или разлогинит). Статус: ГИПОТЕЗА в части рантайм-перезаписи (в браузере не наблюдал). | Достаточно держать выход единственным путём очистки; либо не персистить `currentUser` вовсе (он всё равно перечитывается с сервера при старте). |
| 5 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:33`, `:38` | localStorage-ключ `equipment-view-mode` (`tiles`/`table`/`layout`). Персональных данных нет. Статус: ПРОЙДЕНО. | Не очищается никогда (ни при выходе, ни при смене пользователя). Влияние: следующий админ видит выбранный предшественником режим вида. Не персонально. | При желании сбрасывать при выходе; некритично. |
| 6 | мелочь | `src/components/piling/monitoring/equipment-tile-storage.ts:8`; `src/components/piling/monitoring/use-equipment-tile-template.ts:66`, `:75`–`76` | localStorage-ключ `monitoring-equipment-tile-template-v1` (раскладка плиток мониторинга). Персональных данных нет. Статус: ПРОЙДЕНО. | Не очищается при выходе. Влияние: общий на тенант дизайн, признан общей настройкой. | Не требует правки. |
| 7 | мелочь | `src/components/piling/monitoring/design-tuning-panel.tsx:11`–`12`, `:33`–`42`, `:68` | localStorage-ключи `monitoring-equipment-tile-template-v1-migrated` и легаси `monitoring-card-design-v1` (флаги миграции старых настроек). Персональных данных нет. Статус: ПРОЙДЕНО. | Остаются навсегда как одноразовые флаги. Влияние: незначительный мусор в хранилище. | Не требует правки. |
| 8 | мелочь | `src/components/piling/monitoring/equipment-tile-asset-storage.ts:2`–`3`, `:111`–`121`, `:137`–`141`, `:147`–`152` | IndexedDB `monitoring-equipment-tile-assets-v1`, store `assets`: загруженные фото установок (`Blob`, `name`, `type`). Персональные данные: возможны косвенно (на фото может быть техника/люди). Статус: ПРОЙДЕНО (код). | При выходе не очищается; очистка — только при сбросе шаблона (`onAfterReset` → `storage.clear()`, `use-equipment-tile-template.ts:80`–`82`) и удалении конкретных ассетов. | Не критично (это фото техники, не оператора). Оставить. |

Отдельные проверки (не находки):

- Куки: единственная — `pt-session` (`src/services/auth/session-service.ts:7`), `httpOnly: true`, `sameSite: 'lax'`, `secure` только в проде (`:280`–`288`). Клиентских куки (`document.cookie`) в коде нет — search дал 0. Статус: ПРОЙДЕНО.
- sessionStorage: не используется (search по всему репозиторию — 0 обращений в коде приложения). Статус: ПРОЙДЕНО.
- Кэш сервис-воркера / Cache Storage: сервис-воркера и PWA нет (PWA снят, `next.config.ts:114`; регистраций `serviceWorker` в `src` — 0; `public/sw*.js` отсутствует; web-manifest отсутствует). Инвентаризировать нечего. Статус: ПРОЙДЕНО.
- `src/core/cache/response-cache.ts:341` использует переменную с именем `caches`, но это серверный `Map` в процессе Node, а не браузерный Cache Storage — к устройству не относится. Статус: ПРОЙДЕНО.

## Что не проверено

- Не запускал браузер/Playwright и не снимал реальное содержимое localStorage, IndexedDB и Cookies на живом устройстве. Все выводы — из чтения кода; фактическое содержимое хранилищ после реального входа/выхода не наблюдалось.
- Рантайм-поведение zustand v5 `persist` при `logout()` (что хранилище реально перезаписывается `null`) — НЕ ПРОВЕРЕНО в браузере; вывод сделан из кода (`src/lib/store.ts:174`–`183`) и логики middleware. Статус: ГИПОТЕЗА.
- Может ли сменщик прочитать полные тела чужих команд очереди через DevTools, не проверял на устройстве; по коду значение лежит в localStorage открытым текстом. Статус: ГИПОТЕЗА (ожидаемо верна).
- TTL черновиков (>24 ч) срабатывает только при повторном открытии той же формы тем же `userId`/`siteId`/`date`; фактическое время жизни «забытого» черновика на устройстве не замерялось.
- Флаги куки `pt-session` на реальном проде (что `secure` действительно выставлен) не проверял — только по коду (`process.env.NODE_ENV === 'production'`).
- Не инспектировал содержимое IndexedDB (какие именно фото и есть ли на них люди).
- В `e2e/monitoring-tile-editor.spec.ts:25` встречается ключ `monitoring-design-unlocked`, которого в `src` нет (search — 0). Это остаток e2e; осознанно ли удалён ключ из кода и что именно он хранил раньше — НЕ ПРОВЕРЕНО (морозильные зоны/историю не читал).
- Морозильные зоны operator-screen variants и ORION на предмет прочей записи в хранилище отдельно не разбирал сверх общего поиска по `src`.
