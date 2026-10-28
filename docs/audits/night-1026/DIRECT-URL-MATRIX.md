# Прямые URL: семь ролей и наследуемые ограничения

Прикладная сборка 44126b987c9dd02b0bbefe28e8094f282b94aaf0. HEAD при проверке 34227a48b77e79a262d1b4d5e480c6249e2ba351 с добавленным тестом SHA256 94f2d56f3ccf1a98d55471a80836207a0df7d29427959b0696a8d18956827c40. Код приложения, схема и зависимости не менялись.

**3 passed / 0 failed / 0 skipped**, flaky0. Три сценария Playwright, внутри каждого 105 наблюдений: семь настоящих сессий ×15 разделов. Всего315 наблюдений; это не315 отдельных тестов.

|Браузер|Наблюдений|Разрешено|Отказ|Наблюдено ошибок API / JS|
|---|---:|---:|---:|---|
|chromium|105|44|61|0 / 0|
|Mobile Safari|105|44|61|0 / 0|
|Mobile Chrome|105|44|61|0 / 0|

## Ожидание и факт

Адреса и права взяты из15 буквальных requirePageAbility в layout/page; JSON содержит файл и строку каждого. Дополнительно прочитан и проверен список пяти ролей родительского /admin/layout.tsx. Решение = родитель разрешает роль И can(role,ability). Поэтому OPERATOR с inspection.perform не получает доступ к административному списку шаблонов. Унаследованное ограничение не считается дефектом.

Для разрешённых адресов проверены точный конечный pathname и query, загруженная сессия нужной роли и отсутствие Application error. Два сохранённых адреса ожидаемо перенаправляют: /admin/incidents→/admin/safety?view=incidents→/admin/to?view=incidents; /admin/piles→/admin/reports?view=piles. Серверное назначение прочитано из page.tsx; второй переход получен через parseView/surfaceOfView/SURFACE_ROUTE, как в ToModule. В module-tab-list.tsx закреплено решение владельца10.10: происшествия относятся к техготовности. Старый комментарий server alias про модуль ОТ устарел; код по нему не переписывался. Для отказов проверены /no-access и видимый текст «Нет доступа». Между ролями logout200 и новый page в том же контексте, роль подтверждена /api/auth/me. Сохранены скриншоты каждой роли.

## Проверки последовательно

|Этап|Exit|Время|
|---|---:|---:|
|Playwright: три браузера, новый сценарий прямых URL|0|891 с|
|npx tsc --noEmit|0|18 с|
|npm run lint|0|81 с|
|npx playwright test --list: default и BASE|0|41 с|

tsc и lint выполнены отдельными процессами; lint без предупреждений. Полная коллекция 393 тестов / 30 файлов против BASE 318 / 28, оба exit0. Свежий стенд матрицы (PG18/дваRedis/app/worker) и отдельные временные ресурсы коллекции удалены, cleanup=true/errors[]. Собственный родительский MinIO использовался совместно и остаётся до завершения очереди. Полные unit5776/0/0 и build44126 сохранены в VERIFICATION.md; ради изменения только E2E не запускались заново.

## Что исправлено в новом сценарии

Первый Chromium завершился exit0, но был недостаточным доказательством: отрицание URL могло выполниться до позднего редиректа, а ожидание не учитывало родительский layout. При повторе трёх браузеров получено2passed/1failed/0skipped,exit1/304с: Safari начал следующий goto до завершения server redirect происшествий. Эти результаты сохранены в direct-guards-first-raw и direct-guards-three-red-raw и заменены для выводов только полным текущим прогоном. Повтор composite имел2passed/1failed/0skipped,exit1/409с: адреса совпали, но Safari зафиксировал ошибки прерванного RSC-prefetch. Сырьё direct-guards-composite-red-raw сохранено. Добавлен тот же счётчик завершения API/RSC-fetch, что в исходном успешном21обходе, и ожидание500мс покоя до следующей навигации. Два диагностических SafariRED сохранены:27с — уничтожение evaluate-context при server redirect (7строк/errors[]),54с — ожидание промежуточного /admin/safety вместо конечного /admin/to. Boundedpoll повторяет только временное Playwright ExecutionContextDestroyed до15с; остальные ошибки вызывают падение. Focused Safari-повтор с полной цепочкой:1passed/0failed/0skipped,exit0/544с,44разрешения/61отказ,0JS и наблюдённыхAPIошибок;direct-guards-chain-safari-raw. Ошибки pageerror не фильтруются и по-прежнему должны отсутствовать. Новый тест усилился точным конечным URL и объединением обоих ограничений; код приложения не исправлялся, skips/assertions не ослаблялись. Прежние21 тела сценариев побайтно сохранены (за исключением добавленных импортов перед ними).

## Границы

Проверены15 разделов с явным requirePageAbility и родительский admin guard. Проверены настоящие роли без «Действую как», со стандартными правами своего синтетического tenant. Пользовательские матрицы/actingAs, динамические detail-URL, прочие страницы без этого вызова, все действия CRUD, все назначения установок/tenant и содержимое каждого запроса этим не доказаны. API ошибки собирались в наблюдения, но этот сценарий проверяет вход в раздел; полноценные действия и данные проверяются отдельно. Реальные Telegram/датчики/MQTT не проверялись.

Сырьё: D:/PillingR/night-logs/night-evidence-1026/direct-guards-settled-three-raw/; direct-guards-settled-pipeline-result.json и отдельные логи tsc/lint/list. Повтор на своём disposable стенде: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/night-role-walkthrough.spec.ts --grep "role guard matrix:". Credentials только из RAM fixtures, .env не использовался.

## GitNexus перед коммитом

Индекс полностью перестроен: node .gitnexus/run.cjs analyze --index-only --force,exit0/138с. Context requirePageAbility имеет правильный UID/путь и15действительных callers;они совпали с текстом. Исходный File-impact нового сценария UNKNOWN/0 не считался отсутствием влияния: динамический запуск подтверждён playwright.night.config.ts и nightly-e2e.yml. Тела исходных21тестов не менялись.

Полные detect(all) и compare(BASE):exit0,partial/truncated не возвращены. До staging двух новых отчётов all={"changed_count":15,"affected_count":0,"changed_files":7,"risk_level":"low"}; compare={"changed_count":172,"affected_count":7,"changed_files":57,"risk_level":"high"}. После последнего изменения отчётов и staging выполняется ещё один полный detect перед коммитом; точные финальные счётчики — detect-direct-staged.json/compare-direct-staged.json. Сравнение всей ветки HIGH:семь ранее известных потоков OperatorDashboardV3 → FetchWithTimeout/Cleanup/GetCurrentResetTimeout/FormatEntry/ShouldLog/IsSensitiveKey/GetMinLevel. Пользователь предупреждён перед последующими правками отчёта. Все9V3 UIсценариев зелёные на44126, но каждый отказной путь ими не объявляется проверенным.

Логи context-direct-final.log,detect-direct-final.log,compare-direct-final.log и direct-final-graph-results.json сохранены полностью во внешней evidence-папке. Глобальный бюджет execution flows индексатора ограничен: это не доказательство отсутствия непройденных связей. Прежние повреждённые инкрементальные снимки остаются историей и не используются для вывода о безопасности.
