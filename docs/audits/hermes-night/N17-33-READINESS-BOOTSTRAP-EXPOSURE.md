# N17-33-READINESS-BOOTSTRAP-EXPOSURE: маршрут `/api/readiness/bootstrap` — что он отдаёт

- Версия кода: `git rev-parse HEAD` = `ba2e0d0d4adb3c37b83b724179710c12c59de1cf`, ветка `hermes/code-1011`.
- Режим: только чтение. Код приложения не менялся; создан один файл — этот отчёт.
- Рабочая папка: `D:/PillingR/wt-night-code` (папки `wt-night-code-code` не существует; работал в текущей).

## Итог

Найдено 8 пунктов: критично — 0, важно — 2, мелочь — 6. Плюс 5 проверок, которые прошли (перечислены ниже).

1. **Роль замещения берётся из строки запроса, а не из сессии.** Маршрут (route.ts:30,37,42-53) передаёт в запрос `?actingAs=`, тогда как все прочие маршруты контура берут исполняемую роль из `user.actingAs` (заголовок `x-acting-as`). Экран может рисоваться по одной роли, а команды выполняться по другой; в журнал попадёт `acting_as_mechanic` от роли из строки запроса. Штатный клиент гасит расхождение двойным запросом (to-module.tsx:403-406) — поэтому «важно», не «критично».
2. **Нет теста состава ответа по ролям и нет теста «нет `readiness.read` → 403» для bootstrap.** `bootstrap/__tests__/route.test.ts` мокает только `requireAuth`, а список «read endpoints reject without readiness.read» (routes-read-capability.test.ts:96-124) bootstrap не включает. Права внутри bootstrap держатся только кодом (bootstrap-query.ts:140), тестом не закреплены.
3. **Ответ не минимизируется по роли.** Любой, у кого есть `readiness.read`, получает полный ответ: список всех активных работников организации с id и ролями (`selectors.actors`, bootstrap-query.ts:163-167), счётчики черновых/опубликованных правил и флаги фич. Оператор при выключенном экране настроек (`screens.settings=false`) всё равно получает `counts.publishedRuleSets`/`draftRuleSets`.
4. **Email/телефоны/ключи НЕ утекают:** select полей ограничен (bootstrap-query.ts:166, `select:{id,name,role}`), хотя сессия несёт `email` и `phone` (auth.ts:120-131) — они наружу не отдаются.
5. **Кеша нет и межпользовательской утечки через кеш нет:** `withApi(handleGet,{domain:'readiness-bootstrap'})` без `cache` (route.ts:64), а кеш включается только при `_opts.cache` (api-wrapper.ts:86-104). HTTP-кеш Next по умолчанию выключен для Route Handlers.

## Кто что видит: поле | кто видит | нужно ли | файл:строка | риск

Роли с `readiness.read` по умолчанию: ADMIN, DISPATCHER, OPERATOR, MECHANIC, FOREMAN, SAFETY_ENGINEER (capability-defaults.ts:52-136). ASSISTANT — без `readiness.read`, получает 403.

| Поле | Кто видит | Нужно ли | Файл:строка | Риск |
|---|---|---|---|---|
| `tenant.timezone` | все читатели | да (производственные сутки, окно смены) | bootstrap-query.ts:193 | нет |
| `tenant.name` (companyName) | все читатели | да (заголовок раздела) | bootstrap-query.ts:194 | нет |
| `actor.id` | сам пользователь | да (подпись действий) | bootstrap-query.ts:197 | нет |
| `actor.role` | сам | да | bootstrap-query.ts:198 | нет |
| `actor.actingAs` | сам, только ADMIN | да | bootstrap-query.ts:199; route.ts:42-53 | роль из строки запроса, не из сессии |
| `featureFlags.*` | все читатели | для оператора — нет (только UI скрывает экран) | bootstrap-query.ts:31-45, 201 | служебное состояние окружения всем |
| `selectors.equipment` (id,name,model) | все читатели | да (формы, карточка) | bootstrap-query.ts:150-154, 203 | нет |
| `selectors.sites` (id,name) | все читатели | да (формы) | bootstrap-query.ts:155-159, 204 | нет |
| `selectors.actors` (id,name,role) — ВСЕ активные пользователи | все читатели, включая OPERATOR | частично (нужно для подстановки имени автора в журналах/нарядах) | bootstrap-query.ts:163-167, 205 | перечень всех работников с ролями и id отдаётся оператору |
| `counts.equipment/sites/activeCrews` | все читатели | да (сводка) | bootstrap-query.ts:168-176, 207-210 | нет |
| `counts.publishedRuleSets` / `draftRuleSets` | все читатели | оператору — нет | bootstrap-query.ts:177-182, 211-212 | видно, сколько правил (в т.ч. черновиков) настроено |
| `capabilities.abilities` | сам | да | bootstrap-query.ts:215 | нет |
| `capabilities.screens.*` | сам | да | bootstrap-query.ts:216-241 | при `false` данные всё равно уходят (см. находку 3) |
| `capabilities.entities.*` | сам | да | bootstrap-query.ts:242-279 | нет |
| `capabilities.canActAsMechanic` | ADMIN | нет (UI не использует) | bootstrap-query.ts:280 | имя устарело: роли замещения теперь включают DISPATCHER/OPERATOR |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/readiness/bootstrap/route.ts:30,37,42-53` | Исполняемая роль берётся из `?actingAs=`, а не из сессии `user.actingAs` | Остальные маршруты контура считают права по `user.actingAs` из `x-acting-as` (`_shared/request-context.ts:78,90`; `lib/auth.ts:192-201`). Если строка запроса и заголовок разошлись, bootstrap отдаёт права одной роли, команды исполняются по другой, а в журнал пишется `acting_as_mechanic` по роли из запроса. Сценарий отказа: клиент (или ручной запрос) без `?actingAs`, но с заголовком `x-acting-as=OPERATOR`, получает права ADMIN — экран обещает одни действия, сервер их запрещает (или наоборот). Штатный `to-module.tsx:403-406` расхождение гасит двойным запросом. | Брать `actingAs` из `requireAuth` (`user.actingAs`), как `resolveReadinessRequestContext`; строку запроса не использовать |
| 2 | важно | `src/app/api/readiness/bootstrap/__tests__/route.test.ts:24-96`; `src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts:39-44,96-124` | Нет теста состава ответа по ролям и нет теста отказа без `readiness.read` | Route-тест bootstrap мокает только `requireAuth` и всегда ждёт 200; список «rejects without readiness.read» в routes-read-capability.test.ts bootstrap не включает (там только shifts/handovers/permits/current/export). Единственные проверки ролей — MECHANIC и ADMIN+actingAs (bootstrap-query.test.ts:77-146). Регрессия «оператору уехал чужой флаг/фрагмент ответа» тестом не ловится. | Добавить в routes-read-capability тест bootstrap без `readiness.read` → 403 и по одному тесту состава `screens` для OPERATOR и FOREMAN/AUDIT |
| 3 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:163-167,205` | `selectors.actors` — все активные пользователи тенанта (id, name, role) любому читателю, включая OPERATOR | Оператор видит полный список работников с ролями и внутренними id. Для подстановки имён достаточно участников видимых ему журналов/нарядов; сужается до его бригады/смены. Значит, перечень шире, чем нужно экрану. Утечки за пределы тенанта нет (запросы scoped по `tenantId`). | Отдавать только тех, кто встречается в видимых оператору документах, либо не отдавать `role` и id лишних |
| 4 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:177-182,211-212` | `counts.publishedRuleSets` и `counts.draftRuleSets` отдаются всем читателям | Оператор получает число настроенных правил и наличие черновиков, хотя экран настроек ему закрыт (`screens.settings=false`, :240). Это раскрытие объёма внутренней конфигурации, не содержимого. | Не отдавать счётчики правил ролям без `readiness.rules.manage`/`readiness.audit.read` |
| 5 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:31-45,201` | `featureFlags` (состояние окружения) отдаются всем читателям | Оператору флаги нужны только чтобы скрыть недоступный экран; сами значения — служебная конфигурация сервера. | Отдавать флаги, только если соответствующий экран доступен роли |
| 6 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:85,114,140` | Аудит замещения пишется ДО проверки `readiness.read` | Строка `acting_as_mechanic` записывается в `resolveAuditedReadinessCapabilities` (:114), а отказ по `readiness.read` — позже (:140). Достижимо только если организация опубликовала матрицу, где у ADMIN нет `readiness.read` (матрица редактируема и её значения не «защищают» ADMIN). Тогда в журнале появится подпись о замещении для запроса, которому тут же отказано. | Проверять `readiness.read` собственной роли до записи аудита |
| 7 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:280`; `src/components/piling/to/readiness/api/contracts.ts:90,414` | Поле `canActAsMechanic` названо по старой модели «только механик» | Роли замещения теперь MECHANIC/FOREMAN/SAFETY_ENGINEER/DISPATCHER/OPERATOR (lib/types.ts:40-49), а поле проверяется лишь как boolean в контракте; экран его не использует (grep: только фикстуры и контракт). Имя вводит в заблуждение. | Переименовать в `canActAs` либо удалить, если не нужно |
| 8 | мелочь | `src/app/api/readiness/bootstrap/route.ts:13-15`; `src/app/api/readiness/_shared/response.ts:4-19` | Нет заголовка `Cache-Control: no-store` на персональном JSON | Кеш Next для Route Handlers выключен по умолчанию (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51) и `withApi` кеш не включает (api-wrapper.ts:86), но промежуточный общий кеш (reverse-proxy) теоретически может сохранить ответ без явного запрета. ГИПОТЕЗА: проверяется наличием прокси, доступа к нему нет. | Добавить `Cache-Control: no-store` в ответ bootstrap |

### Что проверено и прошло (ПРОЙДЕНО)

1. Роль проверяется ДО сборки ответа: тезис «сначала собираем, потом фильтруем» неверен — отказ по `readiness.read` стоит раньше всех выборок (bootstrap-query.ts:140), транзакции/данных на запрещённом пути нет.
2. При отсутствии прав отдаётся только ошибка: маршрут возвращает `{error: 'Readiness access denied'}` 403 без данных (route.ts:56-61; bootstrap-query.ts:141). При отсутствии тенанта — 403 (route.ts:23-25).
3. Ни email, ни телефона, ни ключей в ответе нет: select ограничен (bootstrap-query.ts:166), `AuthenticatedUser` с `email`/`phone` наружу не пересылается (auth.ts:120-131).
4. Кеш не включён, утечки между пользователями через кеш нет (route.ts:64; api-wrapper.ts:86-104). Если бы кеш включали, он был бы разведён по сессии и роли — `getSessionCacheScope` хеширует токен и `x-acting-as` (api-wrapper.ts:44-50).
5. Все выборки привязаны к тенанту одним `tenantId` из сессии (bootstrap-query.ts:146-182); `tenantId` не берётся из запроса; параметры, кроме `actingAs`, отвергаются 400 (`searchParams.size`, route.ts:31-36). Проверил `node`: дубликаты ключа дают `size=2`, т.е. `?actingAs=A&actingAs=B` → 400.

## Не проверено

- Не запускал приложение/БД/env (задача read-only; `withApi`/Prisma работают только в runtime). Все выводы — из чтения кода; живого запроса к `/api/readiness/bootstrap` не делал.
- Гипотеза о промежуточном кеше (находка 8) не проверена: доступа к reverse-proxy/прод-конфигу нет.
- Гипотеза о расхождении `?actingAs` и `x-acting-as` (находка 1) проверена по коду клиента (`lib/api.ts:69-72`, `to-module.tsx:403-406`), но не воспроизведена запуском: реальный сценарий с расхождением в штатном UI не найден — только вручную сформированный запрос.
- Не проверял опубликованные в БД матрицы доступа (нет БД): частота случая «ADMIN без readiness.read» (находка 6) неизвестна.
- Не проверял, какие поля реально использует каждый экран оператора (только по grep в `src/components/piling/to/readiness/**`: `featuresFlags`, `screens`, `selectors.actors`).
- Замороженные зоны (операторские экраны, ORION) только читал; правок и предложений об удалении нет.
