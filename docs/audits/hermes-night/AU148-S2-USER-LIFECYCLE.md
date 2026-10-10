# AU148-S2-USER-LIFECYCLE: жизненный цикл пользователя (создание, роль, блокировка, удаление)

Версия: `git rev-parse HEAD` = `a77f6f600be7d53b279cf4fc00d830568808e3b0` (ветка `hermes/q4-0926`).
Только чтение: код приложения не менялся. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.
Числа по тестам: `node node_modules/vitest/vitest.mjs run src/services/users src/app/api/users src/components/piling/admin-users` → `Test Files 8 passed (8)`, `Tests 139 passed (139)`.

## Итог

- Найдено 13 позиций: **критично — 0, важно — 7, мелочь — 6**.
- Блокировка и смена роли сделаны правильно: обе увеличивают `sessionVersion`, `requireAuth` отвергает старый токен (проверено в коде и тестами), вход заблокированного запрещён. Смены/отчёты при этом не теряются.
- Удаление пользователя — самое слабое место: жёсткое удаление **молча стирает документы работника** (медосмотр, аттестация, ОТ) через `onDelete: Cascade` — в предпроверке и в флаге `canHardDelete` документы не учтены. Это находка №1.
- Удаление пользователя со «строгими» связями (СИЗ, инструктаж, допуски, смены, наряды) отдаёт **500 вместо 409**: код ловит `'FOREIGN KEY'`, а Prisma присылает «Foreign key constraint violated…» — регистр не совпадает, и P2003 не заведён в `PRISMA_STATUS`. Находка №2.
- Флаг `canHardDelete` (для кнопки «Удалить») считается по другому набору условий, чем серверная проверка → кнопка есть там, где сервер откажет или каскадно удалит. Находка №3.
- Top-5: №1 документы под каскад; №2 500 вместо 409; №3 расхождение `canHardDelete`; №4 смена роли оставляет бригады/закрепления; №5 блокировка не выводит из активной бригады.

## Жизненный цикл: операция → последствие → аудит → тест

| Операция | Файл:строка | Последствие | Аудит | Тест |
|---|---|---|---|---|
| Создание | `src/services/users/user-service.ts:145` (`createUser`) | `User` создаётся с `tenantId` актора, `role` из enum (default `OPERATOR`), `isActive=true`, `sessionVersion=0`; email нормализуется к нижнему регистру; `phone` не обрезается | `user.created` (`user-service.ts:177`) | `src/services/users/__tests__/user-service.test.ts:176-233` (5 тестов); `src/app/api/users/__tests__/route.test.ts:83-91` |
| Создание (API) | `src/app/api/users/route.ts:40` (`POST`) | права `users.manage` (только ADMIN), zod + требование пароля | — | `route.test.ts:83`, `:91` |
| Смена роли | `src/services/users/user-service.ts:233` (`data.role`) | поле `role` меняется; `sessionVersion++` **только если роль реально изменилась** (`:249-251`); бригады/закрепления/документы **не трогаются** | `user.updated` c `before/after` (`:306`) | `user-service.test.ts:359` (sessionVersion при смене роли), `:285`, `:328` |
| Смена роли — защита «последнего админа» | `src/services/users/user-service.ts:265-289` | если снимают ADMIN с последнего активного администратора — 409; подсчёт под `pg_advisory_xact_lock` (`:272`) | — | `user-service.test.ts:285`, `:300`, `:318`, `:328` |
| Блокировка (`isActive:false`) | `src/services/users/user-service.ts:234-238` | `isActive=false` + `sessionVersion++`; старый JWT отвергается `requireAuth` (`src/lib/auth.ts:105`), вход запрещён (`src/services/auth/auth-service.ts:125`); бригада/закрепления остаются | `user.updated` | `user-service.test.ts:339` |
| Разблокировка (`isActive:true`) | `src/services/users/user-service.ts:234` | `isActive=true`; `sessionVersion` **не** инкрементится (правильно: старый токен уже мёртв) | `user.updated` | нет отдельного теста |
| Смена пароля | `src/services/users/user-service.ts:235-238` | `password=bcrypt`, `sessionVersion++` | `user.updated` | `user-service.test.ts:349` |
| Удаление | `src/services/users/user-service.ts:330` (`deleteUser`) | запрет удаления себя (`:336`); отказ, если есть `reports>0`, `sites>0` или `crews.length>0` (`:351`); документы/допуски/СИЗ/инструктажи/смены/наряды **не проверяются** | `user.deleted` c email+role (`:368`) | `user-service.test.ts:381-428` |
| Удаление (API) | `src/app/api/users/route.ts:123` (`DELETE`) | права `users.manage` | — | `route.test.ts:119` |

### Что происходит с сущностями пользователя при ЖЁСТКОМ удалении (по схеме)

| Сущность | FK | `onDelete` | Последствие | Проверка в `deleteUser` |
|---|---|---|---|---|
| Отчёты `Report` | `prisma/schema.prisma:1963` | Cascade | отчёты удаляются каскадом | **есть** (`_count.reports`, `user-service.ts:351`) |
| Закрепления `UserSiteAssignment` | `prisma/schema.prisma:1912` | Cascade | закрепления удаляются | **есть** (`_count.sites`) |
| Бригада `Crew.operator` | `prisma/schema.prisma:1873` | Cascade | бригада удаляется | **есть** (`user.crews.length`) |
| **Документы `UserDocument`** | `prisma/schema.prisma:208` | **Cascade** | **медосмотр/аттестация/ОТ исчезают молча** | **нет** ← находка №1 |
| Пресеты мест `UserPlacePreset` | `prisma/schema.prisma:1383` | Cascade | пресеты удаляются (данные не ценные) | нет (допустимо) |
| Прочитанное в ленте `FeedbackEventRead` | `prisma/schema.prisma:2562` | Cascade | метки «прочитано» удаляются | нет (допустимо) |
| Помощник `CrewAssistant.userId` | `prisma/schema.prisma:1894` | SetNull | ссылка обнуляется, имя сохраняется | нет (корректно) |
| СИЗ `PpeCheck` | `prisma/schema.prisma:250` | Restrict | удаление блокируется → 500 | **нет** ← находка №2 |
| Допуск `UserEquipmentPermit` | `prisma/schema.prisma:347` | Restrict | блокируется → 500 | нет |
| Инструктаж `BriefingRecord` | `prisma/schema.prisma:426` | Restrict | блокируется → 500 | нет |
| Смены `Shift.*By` | `prisma/schema.prisma:1121-1126` | Restrict | блокируется → 500 | нет |
| Передача смены `ShiftHandover.*By` | `prisma/schema.prisma:1179-1181` | Restrict | блокируется → 500 | нет |
| Наряд `WorkPermit.*` / `WorkPermitApproval` | `prisma/schema.prisma:1504-1506,1530` | Restrict | блокируется → 500 | нет |
| Чек-листы/доказательства оператора | `prisma/schema.prisma:1213,1239,1265,1288` | Restrict | блокируется → 500 | нет |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/services/users/user-service.ts:351` + `prisma/schema.prisma:208` | Жёсткое удаление каскадно стирает `UserDocument` (медосмотр, аттестация, права на управление установкой, ОТ). В предпроверке `deleteUser` документы не считаются, в `canHardDelete` — тоже (`user-service.ts:136`). | Оператор подшил медосмотр, но отчётов ещё нет (новый сотрудник). Админ видит кнопку «Удалить», нажимает — документы исчезают без предупреждения; в журнале только `user.deleted`, факта потери документов нет. Каскадное уничтожение официальных записей — необратимо. | Добавить `_count.documents` в проверку `deleteUser` и в `canHardDelete`; либо запретить жёсткое удаление при наличии документов, либо менять `UserDocument.user` на `Restrict`. |
| 2 | важно | `src/services/users/user-service.ts:362` + `src/core/api-wrapper.ts:26-29` | Удаление пользователя со «строгими» FK (СИЗ, инструктаж, допуски, смены, наряды) даёт `P2003`, но код ловит `message.includes('FOREIGN KEY')`, а драйвер/Prisma отдаёт «Foreign key constraint violated on the …» (иной регистр). `PRISMA_STATUS` знает только `P2025`/`P2002`, поэтому ветка `else` → 500. | Кнопка «Удалить» показана, но по клику — «Внутренняя ошибка сервера» и событие в Sentry вместо понятного «нельзя удалить, есть связанные записи». Админ не понимает, что делать; шум в Sentry. | Проверять `error.code === 'P2003'` (надёжнее строки) и/или добавить `P2003: 409` в `PRISMA_STATUS`; расширить предпроверку набором Restrict-связей. |
| 3 | важно | `src/services/users/user-service.ts:136` vs `:351` | `canHardDelete` (флаг для кнопки «Удалить») считается по `reports===0 && sites===0 && crews===0 && crewAssistantOf` — без документов и без Restrict-связей, а серверная проверка/БД ведут себя иначе. | UI и бэкенд расходятся: там, где сервер откажет (500, находка №2) или каскадно удалит документы (находка №1), кнопка всё равно доступна. Пользователь получает отказ или необратимую потерю, которых интерфейс не предвещал. | Свести `canHardDelete` и условия `deleteUser` к одному источнику правды (одна функция/один набор счётчиков). |
| 4 | важно | `src/services/users/user-service.ts:233` + `src/modules/crews/application/commands/crew-command.service.ts:148,235` | Смена роли меняет только `User.role`. Существующие `Crew` (operator) и `UserSiteAssignment` не проверяются и не пересобираются. `createCrew`/`updateCrew` требуют `role==='OPERATOR'`, но уже созданные бригады не перепроверяют. | Понижают `OPERATOR` → `ASSISTANT`/`DISPATCHER`: он остаётся оператором «активной» бригады, установка остаётся занятой (правило «одна установка = одна активная бригада»), а создать/поправить бригаду с ним уже нельзя — переназначение только вручную. | При смене роли с `OPERATOR` проверять открытые бригады/закрепления и требовать их закрытия либо автодеактивации. |
| 5 | важно | `src/services/users/user-service.ts:234-238` + `prisma/schema.prisma:1873` | Блокировка (`isActive=false`) не выводит пользователя из активной бригады: `Crew.operator` остаётся, бригада считается активной. `requireOperatorAssignment` проверяет активность бригады, но не оператора (`shift-repository.ts:36`). | Оператора заблокировали, но бригада и «занятая» установка остаются за ним. Смену он открыть не сможет (нет входа), но и назначить другого нельзя без ручной правки бригады; экран показывает активную бригаду с недоступным человеком. | При блокировке предупреждать и/или деактивировать его активные бригады (или требовать переназначения). |
| 6 | важно | `src/modules/crews/application/commands/crew-command.service.ts:147-148,233-235,88` | Приём в бригаду не проверяет `isActive`: `createCrew`/`updateCrew` проверяют только существование и `role==='OPERATOR'`; `buildAssistantRows` — только `role==='ASSISTANT'`. | Заблокированного (или заблокированного позже) оператора/помощника можно назначить в бригаду; бригада «собирается» вокруг недоступного человека. | Добавить `isActive: true` в выборку оператора и помощников при сборке бригады. |
| 7 | важно | `src/app/api/users/route.ts:37` + `src/core/api-wrapper.ts:174-226` | GET `/api/users` кэшируется на 30 с (`cache:true, cacheTTL:30_000`), но ни POST, ни PUT, ни DELETE не сбрасывают кэш домена `users`: `withMutation` инвалидацию не делает, вызова `invalidate('users'…)` в коде нет (есть только для `sites`, `reports`, `feedback`, `crews`). | Админ создал/переименовал/заблокировал пользователя — список перечитывается тем же админом и отдаётся из кэша: правка не видна до 30 с (плюс окно stale-while-revalidate +60 с). Выглядит как «не сохранилось». | Сбрасывать кэш домена `users` после мутаций (как в `src/lib/cached-queries.ts:111,123` и `src/app/api/feedback/events/route.ts:44`). |
| 8 | мелочь | `src/lib/auth.ts:41,105,135` | Кэш авторизации по токену на 5 с (`AUTH_USER_CACHE_TTL_MS=5_000`) очищается только при logout (`clearAuthUserCacheEntry` вызывается из logout); при блокировке/смене роли/пароля запись не сбрасывается. | До 5 с после блокировки запросы с прежним токеном могут обслуживаться из кэша как «активный пользователь». Окно короткое и ограничено, но заявленное «сразу потеряет доступ» (`user-detail.tsx:176`) — неточное. | Сбрасывать кэш по `userId` при изменении `sessionVersion`, либо не кэшировать долгоживущие атрибуты. |
| 9 | мелочь | `src/services/users/user-documents.ts:330` | `deleteUserDocument` удаляет строку `UserDocument`, но не связанный `Media` (связь мягкая, без FK). | При удалении документа скан остаётся в хранилище навсегда (мусор/утечка хранилища). Удаление пользователя (каскад, находка №1) усугубляет: строки уходят, файлы — нет. | Чистить `Media` (или помечать на удаление) при удалении документа/каскаде. |
| 10 | мелочь | `src/services/users/user-service.ts:216` (нет `assertNotSelfAction`) vs `:336` | `updateUser` не запрещает действие над собой: админ может сменить себе роль или заблокировать себя (последний админ защищён — `:281`), тогда как `deleteUser` себя запрещает. UI кнопки для себя скрывает (`src/components/piling/admin-users/user-detail.tsx:149`). | Расхождение API и UI: то, что интерфейс считает запретным, доступно прямым запросом. По комментарию (`user-service.ts:253-264`) — вероятно by-design; зафиксировать явно или выровнять с UI. | Либо добавить self-guard в `updateUser`, либо подтвердить как осознанное и выровнять UI. |
| 11 | мелочь | `src/services/users/user-service.ts:306-315` | Блокировка/разблокировка пишутся как `user.updated` (с `before/after`), отдельного действия «блокировка» нет. | Разбор по журналу возможен только сравнением `before/after`; «сколько раз блокировали» простым фильтром не сосчитать. | Рассмотреть отдельные действия `user.blocked`/`user.unblocked` (или явный флаг в metadata). |
| 12 | мелочь | `src/services/users/user-service.ts:29-31` | Параметр `role` фильтра списка не валидируется по enum (произвольная строка). | Не опасно (только фильтр), но неизвестное значение молча даёт пустой список. | Небольшая валидация `role` по тому же enum, что и в zod-схеме. |
| 13 | мелочь | `prisma/schema.prisma` (User.email, `@@unique`/`@unique`) | Email глобально уникален, а не в пределах тенанта. | Сегодня тенант один — незаметно; при втором тенанте один и тот же email в двух организациях создать нельзя. | Для мультитенанта — `@@unique([tenantId, email])` (отмечено как известное ограничение, менять не сейчас). |

## Методика

Работа — только чтение; ни один существующий файл не изменён. Поиск и разбор:

1. Карта модуля: `find src/modules/users src/services/users src/app/api/users` + `ls src/components/piling/admin-users`.
2. Ядро жизненного цикла: `read_file` для `src/services/users/user-service.ts` (380 строк) и `src/app/api/users/route.ts` (155) — целиком.
3. Права и защита: `src/services/auth/authorization-service.ts` (матрица `abilityRoles`, `users.read`/`users.manage`, `assertNotSelfAction`).
4. Сессии/блокировка: `src/lib/auth.ts` (resolveSessionUser, проверка `isActive`+`sessionVersion`, 5-с кэш), `src/services/auth/auth-service.ts` (`authenticateUserByEmailPassword`, проверка `isActive`), `src/app/api/auth/login/route.ts`.
5. Схема БД: `awk`/`grep -n` по `prisma/schema.prisma` — модель `User` (стр. 93) и все её отношения (`UserDocument`, `UserEquipmentPermit`, `PpeCheck`, `BriefingRecord`, `Shift*`, `ShiftHandover`, `WorkPermit*`, `OperatorChecklist*`, `OperatorShiftEvidence`, `Report`, `UserSiteAssignment`, `Crew`, `CrewAssistant`, `UserPlacePreset`, `FeedbackEventRead`) с их `onDelete`.
6. Ошибки и кэш: `src/core/api-wrapper.ts` (`PRISMA_STATUS`, `withMutation`), `src/core/cache/response-cache.ts`, `grep -rn "\.invalidate("` (кто сбрасывает кэш).
7. Бригады/смены: `src/modules/crews/application/commands/crew-command.service.ts`, `src/modules/readiness/infrastructure/shifts/shift-repository.ts`.
8. Документы: `src/services/users/user-documents.ts` (332), `src/app/api/users/[id]/documents/route.ts`.
9. UI-поток: `src/components/piling/admin-users/use-users-list.ts`, `user-detail.tsx`.
10. Тесты: перечень в `src/services/users/__tests__/user-service.test.ts`, `src/app/api/users/__tests__/route.test.ts`, `e2e/admin-users.spec.ts`; прогон `node node_modules/vitest/vitest.mjs run src/services/users src/app/api/users src/components/piling/admin-users`.

Перепроверить можно командами: `grep -n "onDelete" prisma/schema.prisma`; `grep -n "sessionVersion" src/services/users/user-service.ts src/lib/auth.ts`; `grep -rn "\.invalidate(" src | grep -i users` (пусто — доказательство находки №7); `grep -n "FOREIGN KEY" src/services/users/user-service.ts`.

## Не проверено

- **500 vs 409 (находка №2) — ГИПОТЕЗА по точной строке ошибки.** Точный текст `P2003` из Prisma со сгенерированным клиентом на этом рантайме не воспроизводился (запросы к БД не выполнялись). Основание: `PRISMA_STATUS` содержит только `P2025`/`P2002` (`src/core/api-wrapper.ts:26-29`), а `deleteUser` сопоставляет строку `'FOREIGN KEY'` в верхнем регистре (`user-service.ts:362`), тогда как драйвер сообщает «Foreign key constraint violated on the …» (близкий шаблон в `node_modules/@prisma/client/runtime/client.js`). Требуется воспроизведение на локальной БД.
- **WebSocket/принудительный разрыв сокетов при блокировке** — непроверяемо в этой ветке: каталог `src/core/realtime/**` и любой WS-сервер в рабочем дереве отсутствуют (`find src -iname "*realtime*" -o -iname "*socket*"` — пусто; единственное упоминание WebSocket — комментарий в `src/app/api/monitoring/fleet/route.ts:8`). Скилл утверждает обратное для версии 2026-07-07 — расхождение.
- **Фактическое содержимое кэша и реальная задержка UI (находка №7)** — по коду; поведение Redis/памяти в рантайме и наличие записей кэша в момент правки не воспроизводились.
- **`UserEquipmentPermit`/`PpeCheck` как реальные блокираторы удаления** — выведено из `onDelete: Restrict` в схеме; что в проде у кого-то такие строки есть — не проверялось (нет доступа к БД).
- **Counts по данным** (сколько пользователей задеты находками) не снимались — нет доступа к БД.
- Прогон интеграционных/e2e тестов (`npx playwright test`) не делался: по AGENTS.md/памяти интеграционные спеки молча скипаются без `.env`. Приведён только прогон юнит-тестов (139 passed), скипов в нём нет.
- Проверка полноты набора Restrict-связей по другим моделям, не перечисленным в таблице (например, любые новые связи, добавленные после даты схемы), не исчерпывающая — разобраны только отношения, объявленные в модели `User` (`prisma/schema.prisma:93`).
