# Матрица документального допуска

Исходная политика origin/main efd95008, включая решение90e15d00: requiresExpiry=false делает дату напоминанием. Проверка выполнена на ветке после48aa4689; политику допуска не меняли.

Реальные pure functions users/mobile и реальные SQL-запросы users.getOperatorClearance, safety overview и self на собственной PG18.6. DB-адаптер заменяет только подключение на настоящий application-role client с GUC; ответы запросов не мокались. Значение cleared здесь относится к документам, не заменяет знания, СИЗ, исправность машины и разрешение конкретной операции.

Команда: node node_modules/vitest/vitest.mjs run src/modules/safety/application/__tests__/clearance-matrix.integration.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/PillingR/night-logs/night-evidence-1026/clearance-matrix.json. Exit0,10passed/0skipped/0failed,4секунды.

| Сценарий | Users pure | Users SQL | Safety overview | Safety self | Mobile |
|---|---|---|---|---|---|
|missing required document|не допущен|не допущен|не допущен|не допущен|не допущен|
|perpetual document|допущен|допущен|допущен|допущен|допущен|
|required expiry in future|допущен|допущен|допущен|допущен|допущен|
|required expiry in past|не допущен|не допущен|не допущен|не допущен|не допущен|
|optional expired date is reminder only|допущен|допущен|допущен|допущен|допущен|
|warning boundary at 30.5 days|допущен|допущен|допущен|допущен|допущен|
|expiry is same instant across UTC and Moscow|допущен|допущен|допущен|допущен|допущен|
|one second expired across UTC and Moscow|не допущен|не допущен|не допущен|не допущен|не допущен|
|optional future date remains advisory|допущен|допущен|допущен|допущен|допущен|
|optional expiry does not make the document optional|не допущен|не допущен|не допущен|не допущен|не допущен|

**Расхождений решения в десяти случаях нет.** Требуемый документ без срока остаётся обязательным как документ. Опциональная дата не снимает допуск, в том числе когда просрочена. Контроль UTC/Moscow проверяет одинаковый момент времени и одну секунду после него.

## Предупреждения, намеренно без правки

- На границе30,5суток users округляет31и считает вне окна30, mobile округляет30и помечает EXPIRING. Допуск оба разрешают.
- Для requiresExpiry=false users сохраняет expired/expiring как предупреждение и дни; mobile выдаёт VALID и daysLeft=null. Допуск одинаков.
- Тексты предупреждений не унифицировались: задача прямо запрещает такую правку.

Данные10наблюдений сохранены в CLEARANCE-MATRIX.json. Фикстуры удалены после прогона; production данные, .env и schema не использовались/не менялись.
