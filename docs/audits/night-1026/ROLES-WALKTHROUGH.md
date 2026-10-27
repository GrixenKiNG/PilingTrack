# Проход приложения по ролям

Статус задачи 6: **частично**. На сборке44126b98 повторены все21 обхода ролей и новые сквозные цепочки. КаждыйCRUD/каждый чужойURL и канонический цикл V3 не объявляются проверенными.

## Текущий повтор на сборке44126b98

21passed/0failed/0skipped,exit0,749с. Сырьё roles-current-21-raw/, данные в CROSS-ROLE.json. Ниже прежние таблицы1b0 — исторический снимок, не текущий прогон.

|Роль|Браузер|Страниц|Вкладок|Ошибок|
|---|---|---:|---:|---:|
|ADMIN|chromium|12|18|0|
|DISPATCHER|chromium|10|15|0|
|OPERATOR|chromium|3|2|0|
|ASSISTANT|chromium|3|0|0|
|MECHANIC|chromium|5|6|0|
|FOREMAN|chromium|8|9|0|
|SAFETY_ENGINEER|chromium|4|15|0|
|ADMIN|Mobile Safari|12|18|0|
|DISPATCHER|Mobile Safari|10|15|0|
|OPERATOR|Mobile Safari|3|2|0|
|ASSISTANT|Mobile Safari|3|0|0|
|MECHANIC|Mobile Safari|5|6|0|
|FOREMAN|Mobile Safari|8|9|0|
|SAFETY_ENGINEER|Mobile Safari|4|15|0|
|ADMIN|Mobile Chrome|12|18|0|
|DISPATCHER|Mobile Chrome|10|15|0|
|OPERATOR|Mobile Chrome|3|2|0|
|ASSISTANT|Mobile Chrome|3|0|0|
|MECHANIC|Mobile Chrome|5|6|0|
|FOREMAN|Mobile Chrome|8|9|0|
|SAFETY_ENGINEER|Mobile Chrome|4|15|0|

## Стенд и границы доказательств (история1b0)

Исходная база origin/main: efd95008. Runtime — host production build1b0a2663 (exit0,260с), собственные PostgreSQL 18, Redis state/cache и MinIO. Реальные синтетические аккаунты всех семи ролей, без «Действую как». Рабочий стенд :3100 и production не использовались.

Role union и SQL CHECK содержат ADMIN, DISPATCHER, OPERATOR, ASSISTANT, MECHANIC, FOREMAN, SAFETY_ENGINEER. В Prisma поле роли — String; проверка списка есть в CHECK. Мастер и инженер ОТ остаются поддерживаемыми ролями независимо от наличия людей в production.

PERMISSIONS-CODE.json — извлечение AST: 30 общих прав, 17 прав готовности по умолчанию, 45 пунктов меню с учётом повторов по ролям. Это описание кода, не доказательство всех 329 сочетаний «роль × право»: маршруты дополнительно проверяют ресурс, tenant и опубликованную матрицу.

## Фактический обход

Вход; меню (на телефоне открывается панель); каждая страница меню и доступные начальные вкладки; проверка API-ошибок и браузерных исключений; uncaught pageerror наблюдается весь сценарий, console.error — в обычной навигации после загрузки сессии, намеренные отказы/выход проверяются по HTTP, их console-сообщения не объявляются отсутствующими; прямой URL /admin/users; GET /api/users по users.read; запрещённый POST /api/users; выход с 401 на /api/auth/me и вход под другой ролью. OPERATOR/ASSISTANT проверяют общую навигацию на /history: их домашние экраны намеренно имеют собственную.

Исторический результат roles-v3-final на1b0a2663: **21 passed/0failed/0skipped**, exit0,661с wrapper. Предыдущий roles-ui-final на7e также21/0/0,726с; исходные красные прогоны сохранены. Все исходные красные прогоны сохранены.

| Роль | Браузер | Страниц меню | Вкладок открыто | Ошибок JS/console | Итог сценария |
|---|---|---:|---:|---:|---|
|ADMIN|chromium|12|18|0|OK|
|DISPATCHER|chromium|10|15|0|OK|
|OPERATOR|chromium|3|2|0|OK|
|ASSISTANT|chromium|3|0|0|OK|
|MECHANIC|chromium|5|6|0|OK|
|FOREMAN|chromium|8|9|0|OK|
|SAFETY_ENGINEER|chromium|4|15|0|OK|
|ADMIN|Mobile Safari|12|18|0|OK|
|DISPATCHER|Mobile Safari|10|15|0|OK|
|OPERATOR|Mobile Safari|3|2|0|OK|
|ASSISTANT|Mobile Safari|3|0|0|OK|
|MECHANIC|Mobile Safari|5|6|0|OK|
|FOREMAN|Mobile Safari|8|9|0|OK|
|SAFETY_ENGINEER|Mobile Safari|4|15|0|OK|
|ADMIN|Mobile Chrome|12|18|0|OK|
|DISPATCHER|Mobile Chrome|10|15|0|OK|
|OPERATOR|Mobile Chrome|3|2|0|OK|
|ASSISTANT|Mobile Chrome|3|0|0|OK|
|MECHANIC|Mobile Chrome|5|6|0|OK|
|FOREMAN|Mobile Chrome|8|9|0|OK|
|SAFETY_ENGINEER|Mobile Chrome|4|15|0|OK|

## Роль × страница

Каждая строка ниже реально открыта в Chromium в исходном общем прогоне. Состояния других проектов и точные наблюдения — в ROLES-OBSERVATIONS.json. Кнопки записаны как инвентаризация, их присутствие не считается выполнением действия.

| Роль | Адрес из меню | API-ошибки при обходе |
|---|---|---|
|ADMIN|/admin|Нет|
|ADMIN|/monitoring|Нет|
|ADMIN|/admin/sites|Нет|
|ADMIN|/admin/reports|Нет|
|ADMIN|/admin/equipment|Нет|
|ADMIN|/admin/to|Нет|
|ADMIN|/admin/crews|Нет|
|ADMIN|/admin/safety|Нет|
|ADMIN|/admin/analytics|Нет|
|ADMIN|/admin/dictionaries|Нет|
|ADMIN|/admin/users|Нет|
|ADMIN|/admin/settings|Нет|
|DISPATCHER|/admin|Нет|
|DISPATCHER|/monitoring|Нет|
|DISPATCHER|/admin/sites|Нет|
|DISPATCHER|/admin/reports|Нет|
|DISPATCHER|/admin/equipment|Нет|
|DISPATCHER|/admin/to|Нет|
|DISPATCHER|/admin/crews|Нет|
|DISPATCHER|/admin/safety|Нет|
|DISPATCHER|/admin/analytics|Нет|
|DISPATCHER|/admin/settings|Нет|
|OPERATOR|/operator|Нет|
|OPERATOR|/admin/safety|Нет|
|OPERATOR|/history|Нет|
|ASSISTANT|/assistant|Нет|
|ASSISTANT|/admin/safety|Нет|
|ASSISTANT|/history|Нет|
|MECHANIC|/admin/to|Нет|
|MECHANIC|/admin/equipment|Нет|
|MECHANIC|/admin/maintenance|Нет|
|MECHANIC|/admin/crews|Нет|
|MECHANIC|/admin/safety|Нет|
|FOREMAN|/admin|Нет|
|FOREMAN|/monitoring|Нет|
|FOREMAN|/admin/sites|Нет|
|FOREMAN|/admin/to|Нет|
|FOREMAN|/admin/crews|Нет|
|FOREMAN|/admin/safety|Нет|
|FOREMAN|/admin/reports|Нет|
|FOREMAN|/admin/analytics|Нет|
|SAFETY_ENGINEER|/admin/safety|Нет|
|SAFETY_ENGINEER|/admin/to|Нет|
|SAFETY_ENGINEER|/admin/sites|Нет|
|SAFETY_ENGINEER|/admin/reports|Нет|

## Проверки запретов и сеанса

| Роль | GET /api/users: ожидание | POST /api/users | Прямой /admin/users | Выход и смена роли |
|---|---:|---|---|---|
|ADMIN|200|Создание в этом сценарии не проверяется|Открывается|200 logout → 401 me → другая роль|
|DISPATCHER|200|403|/no-access|200 logout → 401 me → другая роль|
|OPERATOR|403|403|/no-access|200 logout → 401 me → другая роль|
|ASSISTANT|403|403|/no-access|200 logout → 401 me → другая роль|
|MECHANIC|403|403|/no-access|200 logout → 401 me → другая роль|
|FOREMAN|200|403|/no-access|200 logout → 401 me → другая роль|
|SAFETY_ENGINEER|200|403|/no-access|200 logout → 401 me → другая роль|

Отдельные реальные HTTP-интеграции: 159 IDOR-сценариев и 3 гонки отчёта на собственной БД ранее прошли без пропусков; построчный реестр — INTEGRATION-RUN.md. Их нельзя выдавать за браузерный обход каждого чужого URL. Полный повтор unit/integration по ветке рассматривается отдельно в SUMMARY.md.

## Найденные дефекты

- ASSISTANT: /admin/safety открывал общий workspace парка и получал 403 readiness/bootstrap. Исправлено личным MyClearanceScreen, без расширения прав; отдельные red/green unit и настоящий browser green сохранены.
- FOREMAN: DashboardAttention вызывал /api/user-documents/control без права чтения документов, получал 403. Исправлен выбор источника по useAbility; права не изменены. В последующих ролевых обходах API-отказ исчез.

## Красные прогоны и проблемы тестового обхода

- night-broad-final: exit 1; 106 passed / 14 failed / 9 skipped, 1293 с. Все 14 падений нового теста — требование видимости имени пользователя, которое оболочка намеренно скрывает на телефонах. Условия доступа не ослаблялись: теперь имя подтверждает загрузку store через attached, а меню действительно раскрывается и проверяется на visible.
- roles-responsive-final: exit 1; 16 passed / 5 failed / 0 skipped, 1054 с. Все страницы/вкладки/запреты пройдены, но пять офисных ролей Mobile Safari дали pageerror при RSC-prefetch: «due to access control checks». Нельзя считать весь набор зелёным. Сырые сообщения не отфильтрованы. Последующий roles-ui-final подтвердил реальную Link-навигацию, сброс вкладок без hard reload и штатный выход через UI: 21/0/0, exit0. Ошибки не фильтровались. API-only logout оставлял живой shell с незавершённым запросом сессии; исправлен только порядок действий проверочного harness.
- Девять пропусков общего набора существовали до работы: два rate-limit запуска только в Chromium; шесть повторов трёх пишущих critical-path в mobile-проектах; один monitoring tile editor в WebKit. Это не успешные проверки.

## Действия и сквозные цепочки

Общий набор реально проверил: UI-форму отчёта; диспетчерскую отправку → SiteDailySummary → analytics API → PDF от worker; создание/приёмку наряда; удаление куста с подтверждением; начало ТО и сохранение черновика; справочники и чтения других ролей. Отдельные случаи с подменой ответа (например Telegram Test) доказывают UI-контракт, не внешнюю доставку.

Полный набор CRUD для каждого права и каждой роли ещё не доказан. Реестр кнопок содержит и неисполненные действия. Цепочки «дефект осмотра → ремонт механика → готовность» и «инцидент → инженер ОТ → доставка» нельзя объявлять браузерно проверенными из посещения вкладок; реальные транзакционные тесты source→outbox→snapshot перечислены отдельно в INTEGRATION-RUN.md.

## Все шесть экранов оператора

Новый canonical-thirty-final на приложении44126b987c9dd02b0bbefe28e8094f282b94aaf0:30passed/0failed/0skipped,exit0/1178с.30закрытых смен и30уникальных отчётов. Все пять канонических экранов проверены заново на одномSHA; старые1b0/f51доказательства не приписываются новой сборке.

| Экран | Факт на44126b98 | Граница |
|---|---|---|
|/operator|6/0/0,три браузера×одна/две установки,полный цикл/offline/replay/SQL/диспетчер|ПрочиеCRUD и все цепочки отдельно|
|/operator/v2|6/0/0,тот же полный цикл; строгая ширина≤375; наложение footer и переполнение имени исправлены послеRED|V2-FOOTER.md; отдельные первые неудачные исправления сохранены|
|/operator/v3|Отдельная legacy-форма:9/0/0на44126b98,шестьотчётов+триselector|Reportsubmitted безShift,phaseIDENTITYдо/после. Canonicalциклнеподтверждён;V3-LEGACY.md,вопрос№9|
|/operator/v5|6/0/0,тот же полный цикл; имя переносится внутри375px|V5-VIEWPORT.md; первая6/0/0на463тоже сохранена|
|/operator/v7|6/0/0,тот же полный цикл|Паспорт сваи и остальныеCRUD отдельно|
|/operator/v10|6/0/0,тот же полный цикл|Приmulti принимается показанная установкапоумолчанию; другогоchooserнет|

Прежний вывод Codex «v7 только для чтения» был ошибкой: комментарий маршрута устарел, фактический компонент выполняет команды. В DOCS-VS-CODE.md это строка 41. Комментарий не является основанием снять экран с проверки.

## Не проверено

Физическое оборудование, датчики, MQTT, реальный Telegram и доставка конкретному человеку, все действия всех ролей, canonical-циклV3, каждый прямой чужой URL. Синтетические осмотры не подтверждают состояние реальной машины.

Логи и скриншоты: D:/PillingR/night-logs/night-evidence-1026/roles-v3-final* и night-broad-final*. JSON наблюдений и статическая матрица сохраняются в репозитории.


## Новые цепочки между ролями

Полный v2 → диспетчер видит точные данные в отчёте/мониторинге/аналитике → инженер ОТ записывает разбор → проверена очередь уведомления:Chromium2/0/0вместе с ремонтом. Осмотр оператора → дефект/автоматический ремонт → механик/DONE → ADMIN/accept → механик/CLOSED → новый readiness snapshot:три браузера3/0/0. Авторство/версии аудита/ссылка на осмотр подтвержденыSQL. CROSS-ROLE.md/json. Прежние пункты «цепочки не проверены» выше относятся к истории.
