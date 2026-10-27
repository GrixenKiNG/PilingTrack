# Проход приложения по ролям

Статус задачи 6: **частично**. Посещение страниц, вкладок и проверки отдельных запретов не равны проверке каждого действия и полному циклу шести экранов оператора.

## Стенд и границы доказательств

Исходная база origin/main: efd95008. Runtime — host production build1b0a2663 (exit0,260с), собственные PostgreSQL 18, Redis state/cache и MinIO. Реальные синтетические аккаунты всех семи ролей, без «Действую как». Рабочий стенд :3100 и production не использовались.

Role union и SQL CHECK содержат ADMIN, DISPATCHER, OPERATOR, ASSISTANT, MECHANIC, FOREMAN, SAFETY_ENGINEER. В Prisma поле роли — String; проверка списка есть в CHECK. Мастер и инженер ОТ остаются поддерживаемыми ролями независимо от наличия людей в production.

PERMISSIONS-CODE.json — извлечение AST: 30 общих прав, 17 прав готовности по умолчанию, 45 пунктов меню с учётом повторов по ролям. Это описание кода, не доказательство всех 329 сочетаний «роль × право»: маршруты дополнительно проверяют ресурс, tenant и опубликованную матрицу.

## Фактический обход

Вход; меню (на телефоне открывается панель); каждая страница меню и доступные начальные вкладки; проверка API-ошибок и браузерных исключений; uncaught pageerror наблюдается весь сценарий, console.error — в обычной навигации после загрузки сессии, намеренные отказы/выход проверяются по HTTP, их console-сообщения не объявляются отсутствующими; прямой URL /admin/users; GET /api/users по users.read; запрещённый POST /api/users; выход с 401 на /api/auth/me и вход под другой ролью. OPERATOR/ASSISTANT проверяют общую навигацию на /history: их домашние экраны намеренно имеют собственную.

Последний результат roles-v3-final на1b0a2663: **21 passed/0failed/0skipped**, exit0,661с wrapper. Предыдущий roles-ui-final на7e также21/0/0,726с; исходные красные прогоны сохранены. Все исходные красные прогоны сохранены.

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

| Экран | Что доказано сейчас | Чего ещё нет |
|---|---|---|
|/operator|Открытие и общая навигация роли; существующая UI-форма отчёта отдельно|Полный современный цикл смены|
|/operator/v2|Сохранён, команды и общий NextStep присутствуют в коде|Полный живой цикл и сценарий нескольких установок|
|/operator/v3|Сохранённый legacy dashboard; добавлен в синтетическую QA-матрицу|Живой проход и сопоставление его процесса с современными фазами|
|/operator/v5|Сохранён, команды есть в коде|Полный живой цикл|
|/operator/v7|Полный живой UI-цикл: СИЗ/инструктаж/знания, приём, 5 осмотров/ТБ, сваи офлайн/replay, бурение/простой/инцидент, закрытие и диспетчерский отчёт; 6/0/0 exit0,292с, все три браузера и одна/две установки. OPERATOR-CYCLE.md/json|Полные циклы остальных пяти версий этим не закрываются|
|/operator/v10|Полный цикл, офлайн/replay, отчёт диспетчеру: 6/0/0, три браузера × одна/две установки, exit0/274с, приложение1b0a2663|Выбор второй установки: отдельного chooser в форме нет; прочие CRUD и все цепочки не доказаны|

Прежний вывод Codex «v7 только для чтения» был ошибкой: комментарий маршрута устарел, фактический компонент выполняет команды. В DOCS-VS-CODE.md это строка 41. Комментарий не является основанием снять экран с проверки.

## Не проверено

Физическое оборудование, датчики, MQTT, реальный Telegram и доставка конкретному человеку, все действия всех ролей, полный цикл всех шести экранов, каждый прямой чужой URL. Синтетические осмотры не подтверждают состояние реальной машины.

Логи и скриншоты: D:/PillingR/night-logs/night-evidence-1026/roles-v3-final* и night-broad-final*. JSON наблюдений и статическая матрица сохраняются в репозитории.
