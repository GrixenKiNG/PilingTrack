# Пользователи, документы и отзыв сессии

Проверенная сборка: **00ac751ffa4c22cb2117a189474ce7bcc73410cc**. В коммите 30634acf сохранён красный тест; 00ac751f исправляет дефект четырьмя добавленными строками в src/app/api/users/route.ts: импорт существующего response cache и сброс ответов GET:/api/users после успешных POST, PUT и DELETE. Ключи кеша, TTL, права, tenant-фильтры, SQL и auth/security не менялись.

Весь admin-users.spec.ts: **6 passed / 0 failed / 0 skipped / 0 flaky**, exit 0, 279 с вместе с подготовкой и очисткой стенда; 245.6 с Playwright. В каждом из трёх браузеров выполнены прежняя проверка таблицы на desktop/mobile и новый сценарий. Точные наблюдения, id, даты и авторы аудита сохранены в USERS-LIFECYCLE.json.

## Что проверено действием

| Действие | Фактический результат |
|---|---|
| ADMIN создаёт OPERATOR | POST 201; SQL подтверждает tenant, роль, телефон и active. Обычный GET и диагностический GET с _ts содержат новый id. Штатный поиск UI находит пользователя. |
| ADMIN меняет имя и телефон | PUT 200; SQL содержит новые значения; последующие операции относятся к тому же id. |
| ADMIN работает с удостоверением | Создание с истёкшим сроком, продление и удаление через форму. Состояние допуска субъекта: MISSING → EXPIRED → VALID → MISSING; даты SQL совпадают с введёнными. |
| Чтение другой ролью | Настоящий вход SAFETY_ENGINEER; GET 200 содержит точные id и номер документа. Это чтение API, редактирование через UI инженера не заявляется. |
| Запрет другому оператору | GET, PUT и DELETE возвращают 403; номер не выдаётся, SQL и бизнес-аудит остаются прежними. Штатное самообслуживание владельца документа этим не запрещается. |
| Удаление удостоверения | Отмена сохраняет запись; подтверждение DELETE 200 удаляет её и возвращает MISSING. |
| Блокировка | Отмена сохраняет active и ответ 200 прежней сессии. Подтверждение PUT 200 даёт inactive; прежняя сессия получает 401, перезагрузка переводит на вход. |
| Разблокировка | PUT 200 возвращает active; новый реальный вход завершается ответом 200. |
| Удаление пользователя без связей | Отмена сохраняет запись; подтверждение DELETE 200 удаляет её из SQL, прежняя сессия получает 401. |
| Бизнес-аудит | В каждом сценарии восемь точных действий с actor ADMIN: создание и правка пользователя, создание/правка/удаление документа, блокировка, разблокировка, удаление пользователя. Всего 24 записи в трёх случаях; даты before/after и documentId проверены. |

У нового оператора отдельный настоящий browser context с настройками соответствующего устройства. Во всех трёх новых случаях pageerror = []. Форма удостоверения редактирует метаданные: загрузка скана через неё не заявляется.

## Как сохранено воспроизведение

На сборке 44126 SQL содержал восьмого пользователя, обычный GET возвращал семь, диагностический GET с _ts — восемь. RED: 0 passed / 1 failed / 0 skipped, exit 1, 45 с со стендом. Пять связанных исходников совпадали с BASE efd95008 по Git blob. Это сравнение кода; HTTP-прогон отдельной сборки BASE не выполнялся.

После исправления проверка кеша прошла сразу. Следующий RED (exit 1, 56 с) оказался ошибкой нового теста: кнопка «Редактировать» находится на вкладке «Доступ», а сценарий оставался в «Обзоре». Добавлены только два настоящих перехода на вкладку; assertions сохранены. Целевой повтор Chromium затем прошёл: 1 passed / 0 failed / 0 skipped, exit 0, 106 с со стендом.

Архивы users-create-first-red-raw, users-cache-confirmed-red-raw, users-fixed-first-access-red-raw и users-access-probe-raw сохранены. Пропуски не добавлялись, проверки результата не ослаблялись. Финальное сырьё: users-fixed-fresh-raw/playwright.json и browser/.

## Проверки на новом SHA

Сборка npm run build: exit 0, 168 с. Ответ HTTP health подтвердил точный SHA 00ac751ffa4c22cb2117a189474ce7bcc73410cc.

Все следующие команды выполнены отдельно и последовательно:

| Шаг | Exit | Секунды |
|---|---:|---:|
|users-final-tsc|0|22|
|users-final-lint|0|79|
|users-final-unit-wrapper|0|966|
|users-final-pw-list-wrapper|0|41|

Перед tsc удалены устаревшие .next/dev/types. lint завершился без предупреждений. Полный unit: **5776 passed / 0 failed / 0 skipped**, 512 файлов. Все 241 исторических пропуска найдены и прошли в том же сыром JSON. Свежесть JSON проверена относительно metadata нового стенда и его SHA.

Сбор Playwright: 399/30 против BASE 318/28, обе команды exit 0. После отдельных UI, unit и list стендов их собственные ресурсы удалены; корневой стенд оставлен для продолжения очереди.

Команды: npx tsc --noEmit; npm run lint; npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json; npx playwright test --list через существующий disposable QA fixture. UI-команда: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/admin-users.spec.ts --trace=off.

Конвейер и полные логи находятся в D:/PillingR/night-logs/night-evidence-1026/: users-final-verification.cjs, users-final-verification-result.json, users-final-gates-results.json, full-unit-users-final.json/log, users-final-validated-summary.json. Fixture env передавался только в памяти собственных стендов; .env не читался и не создавался. SHA256 сценария: 85941e8b4f111cc3849ad24d31336c35d560d92da5788a670fb4472d10ea3207.

## Границы результата

Предыдущие 30 операторских циклов, девять V3 и проверки ремонта, бригад и осмотров остаются доказательствами сборки 44126. Они не выдаются за повтор на 00ac. Свежий полный unit и браузерная проверка пользователей относятся к 00ac.

В server-логах сохраняются предупреждения MaxListenersExceededWarning из Next compression/httpxy; это не browser pageerror и не доказанная утечка памяти. Vitest сообщает о будущем строгом native config и CommonJS/ESM в vitest.config.ts. Предупреждения не подавлялись; ноль предупреждений выше относится к lint.

Сброс пароля, каждый тип удостоверения, все поля, роли, tenant/assignment сочетания и остальные CRUD ещё не исчерпаны. Реальные внешние уведомления и оборудование не проверялись. Ранее выполненный whole-branch review относится к своему раннему SHA; новый review не запускался.


## GitNexus перед фиксацией результата

Полное перестроение --index-only --force: exit 0, 141 с. Context requirePageAbility снова имеет правильный UID Function:src/lib/require-page-ability.ts:requirePageAbility, путь и 15 реальных callers. File-impact изменяемого E2E вернул UNKNOWN/0; динамический запуск подтверждён playwright.night.config.ts и двумя workflow. Это не считалось отсутствием влияния.

До staging новых отчётов: all {"changed_count":12,"affected_count":0,"changed_files":6,"risk_level":"low"}; сравнение с BASE {"changed_count":218,"affected_count":7,"changed_files":65,"risk_level":"high"}. Все команды exit 0, partial/truncated не возвращены. HIGH заранее сообщён пользователю; семь имён потоков V3 совпали с предыдущим снимком. Они перечислены в compare-users-final.json; девять старых V3-сценариев относятся к44126, а не к00ac. Ограничения общего бюджета execution flows остаются и не доказывают отсутствие других связей.

После окончательного редактирования и staging выполняется ещё один полный all/compare. Его реальные финальные ответы сохраняются в detect-users-staged.json и compare-users-staged.json; это последний анализ перед коммитом. Индекс, контекст и полные логи сохранены во внешней evidence-папке. Новый whole-branch review не повторялся.


## Повтор на451acce2

Весь файл снова6passed/0failed/0skipped/0flaky,exit0/249с. Сценарий85941e8b4f111cc3849ad24d31336c35d560d92da5788a670fb4472d10ea3207 не менялся. Все три полных user/document/session пути,24точных события аудита и прежние responsive-чтения повторены. Новый полный unit5783/0/0/all241 относится к451; исходные5776/0/0 выше остаются00ac. Сырьё equipment-users-raw;общие проверки EQUIPMENT-ACCESS-FIX.md/json.
