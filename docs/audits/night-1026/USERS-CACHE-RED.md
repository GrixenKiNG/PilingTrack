# ДЕФЕКТ P3: список пользователей устаревает после записи

Исторический RED на44126 сохранён. Текущее исправление00ac751f и повтор6UI/fullunit — USERS-LIFECYCLE.md/json; нижеследующие данные относятся к моменту воспроизведения.

На прикладной сборке44126b98 реальный ADMIN создал пользователя через форму. POST201 и SQL подтвердили активную запись нужного tenant. Следующие обычные GET /api/users и повторное открытие таблицы показывают прежние7пользователей; вновь созданный не находится. Диагностический GET с штатным параметром _ts возвращает8, включая точный созданный id. В обоих случаях HTTP200. Это расхождение БД и кешированного ответа, не отсутствие записанной строки.

Первый UIпрогон:0passed/1failed/0skipped,exit1/59с wrapper;строка отсутствовала в UI. Уточнённый RED:0passed/1failed/0skipped,exit1/45с wrapper;точный assert «normal users GET must reflect the committed creation» получилfalse при freshHasCreatedUser=true. Browser pageerror=[],ресурсы обоих стендов удалены(cleanup=true/errors[]). Новых skip и ослаблений проверок нет. _ts используется только для диагностики; основной тест продолжает требовать свежий обычный GET и штатную UIтаблицу.

GET в src/app/api/users/route.ts включает response cache с TTL30000. Успешные POST/PUT/DELETE его не сбрасывают. withMutation не делает автоматической инвалидации. useUsersList после каждой записи перечитывает тот же GET и получает старый ответ.

Эти пять связанных файлов побайтно совпадают с исходной базойefd95008:users route,user-service,api-wrapper,response-cache,use-users-list. Таблица Git blob — USERS-CACHE-RED.json и users-cache-baseline-source.json. Это проверка исходников; отдельный HTTP-прогон сборки BASE ещё не выполнялся и не заявляется. Изменений приложения в ночной ветке, породивших эту ошибку, в указанных файлах нет.

Минимальная правка: использовать существующий getResponseCache и сбрасывать только префикс GET:/api/users после успешных create/update/delete, до возврата ответа. Сохранить TTL,контракты API,авторизацию,tenant/RLS-фильтры,CSRF и rate limit. Общий api-wrapper и auth/security-файлы не менять. Это отдельный коммит после данного RED; правка приложения пока не применена. Новые зависимости и изменения схемы не нужны.

Источник: D:/PillingR/night-logs/night-evidence-1026/users-create-first-red-raw/ и users-cache-confirmed-red-raw/; users-cache-probe-fresh-tests.log/result.json. Регрессия добавлена в существующий e2e/admin-users.spec.ts; прежний read-only сценарий сохранён. Последующие документы/блокировка/удаление нового большого сценария пока НЕ пройдены: выполнение останавливает этот RED.

Проверки нового RED-сценария отдельно: npx tsc --noEmit — exit0/21с; npm run lint — exit0/136с,без предупреждений; Playwright --list —399тестов/30файлов против BASE318/28,обаexit0/93с wrapper,cleanup=true. Прикладной код пока44126безизменений; полныйunit5776/0/0 остаётся прежним проверенным результатом этой сборки, а не новым прогоном.

В существующем users route unit helper все GET имеют _ts, поэтому проверяют tenant/role-контракт, обходя response cache. Их assertions не переписываются. Новая регрессия проверяет обычный путь чтения на реальной БД. Документация установленного Next16 (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md) прочитана: здесь устаревает пользовательский withApi response cache, не неявный кеш Next.

Перед точечной правкой выполнены context/impact трёх точных UID POST/PUT/DELETE этого route в D:/PillingR/wt-night-evidence-1026. Все impactUNKNOWN/0:HTTP-вызовы не являются импортёрами, это не отсутствие влияния. Текст подтвердил28файлов,включая useUsersList,бригады,объекты,редактор отчётов,напоминания документов и настройки. Полные users-route-*-impact.json/context.json,users-endpoint-text-callers.log сохранены. План меняет только инвалидацию этого endpoint после успешной записи; инфраструктурный ключ сессии и авторизацию не меняет.
