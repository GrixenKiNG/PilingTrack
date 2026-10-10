# AU165-S4-CLOCK-SKEW-OFFLINE: Часы устройства и офлайн-записи

Версия репозитория (git rev-parse HEAD): `0d72ca8a233864fcfbe614a2fb69e74a7f8a49cd`
Ветка: `hermes/q4-0926`. Аудит только на чтение, код приложения не менялся.

## Итог

- Все метки времени на записях выработки, происшествий и поправок ставит СЕРВЕР
  в момент прихода запроса (`now = input.now ?? new Date()`), а маршрут
  `/api/operator/mobile/command` поле `now` из тела не принимает — значит
  офлайн-запись получает время СИНХРОНИЗАЦИИ, а не время работы.
- Дату смены и отчёта часы телефона сдвинуть не могут: и `productionDate`
  смены, и дата отчёта выводятся из серверного времени на приёмке установки.
  Это главный положительный вывод (ПРОЙДЕНО).
- Единственная ветка, где время и интервал пишутся из часов ТЕЛЕФОНА, —
  прежний формат простоя «начало–конец» (живёт для старой очереди офлайна):
  там `startedAt`/`endedAt`/`occurredAt` клиентские. Защита есть только от
  будущего (>5 мин), прошлое не ограничено вовсе.
- Видимое следствие серверного времени: запись, сделанная офлайн в 10:00 и
  ушедшая в 18:00, показывается машинисту и в журналах как 18:00
  (`operator-work-overview.tsx:62`, `operator-v5-app.tsx:1349`).
- Подтверждение СИЗ (`confirm-ppe`) несёт `productionDate`, пришедший с
  клиента (round-trip серверной даты). Устаревшая открытая вкладка кладёт
  отметку не за те сутки, а проверка допуска за сутки смены такую отметку не
  находит и молча считает нехватку пустой.
- Найдено 6 позиций: 0 критично, 3 важно, 3 мелочь. Блокеров нет.

## Методика

Поиск и чтение (Git Bash, только чтение):

- `find src -iname "*offline*" -o -iname "*sync*"` — нашлась очередь офлайна
  `src/components/piling/operator-mobile/offline-queue.ts`.
- `rg -n "new Date\(" src` и `rg -n "datetime\(|z\.coerce\.date|recordedAt|
  occurredAt|productionDate" src/app/api` — все места, где дата/время берутся из
  тела запроса или из серверных часов.
- Прочитаны целиком: маршрут `src/app/api/operator/mobile/command/route.ts`;
  команды `src/modules/operator-mobile/application/commands/*.ts` (production,
  shift-close, incidents, production-corrections, equipment, admission,
  shared); очередь `offline-queue.ts`, `use-offline-queue.ts`, `api.ts`;
  `src/lib/timezone.ts`, `src/lib/downtime-hours.ts`,
  `src/modules/operator-mobile/domain/shift-window.ts`,
  `src/modules/operator-mobile/application/mobile-shift-query.ts`;
  `src/services/reports/event-handlers.ts` (проекция по дате отчёта).
- Проверка, доходит ли `now` из тела: `commandSchema` (route.ts:30-177) и
  вызовы `logProduction({...actor, ...body, ...})` (route.ts:226-250).
- Тесты (реальный запуск, не «на глаз»):
  `node node_modules/vitest/vitest.mjs run
  src/app/api/operator/mobile/command/__tests__/downtime-hours.test.ts
  src/components/piling/operator-mobile/offline-queue.test.ts`
  → Test Files 2 passed (2), Tests 27 passed (27), exit 0.

Как перезапустить: скопировать команды выше из корня репозитория.

## Таблица «источник времени по записям»

| Запись | Файл:строка (от корня) | Источник времени | Риск |
|---|---|---|---|
| Смена: `productionDate`, `startedAt` | `src/modules/operator-mobile/application/commands/equipment.ts:31,39,96,100` | Сервер (`new Date()` + пояс работника) | Низкий. Часы телефона не влияют. |
| Отчёт: дата `date`, деловой номер | `src/modules/operator-mobile/application/commands/shared.ts:398-422` | Из `shift.productionDate` (серверная) | Низкий. Дата отчёта = сутки смены. |
| Отчёт: `submittedAt`, `shiftEnd` | `src/modules/operator-mobile/application/commands/shift-close.ts:48,176-179` | Сервер | Низкий. |
| Отчёт: `shiftStart` | `shift-close.ts:166-170,177` | Сервер (из `shift.startedAt`) | Низкий. |
| Выработка PILES/DRILLING, паспорт сваи: `occurredAt` | `src/modules/operator-mobile/application/commands/production.ts:105,273,339,404` | Сервер в момент синхронизации | Важно: офлайн-запись получает время синка. |
| Простой (часы, текущий экран): `occurredAt` | `production.ts:408-440` | Сервер | Мелочь: часы вводит человек, время не важно. |
| Простой (интервал, старая очередь): `startedAt`/`endedAt`/`occurredAt` | `production.ts:443-528` | ТЕЛЕФОН (`entry.startedAt`/`endedAt`) | Важно: клиентское время в БД. |
| Происшествие: `occurredAt` | `src/modules/operator-mobile/application/commands/incidents.ts:42,99` | Сервер | Низкий. |
| Поправка выработки: `occurredAt` | `src/modules/operator-mobile/application/commands/production-corrections.ts:63,122,163,205` | Сервер | Низкий. |
| СИЗ: `productionDate` | `src/app/api/operator/mobile/command/route.ts:37` + `admission.ts:229` | КЛИЕНТ (round-trip серверной даты) | Важно: устаревшая вкладка → неверные сутки. |
| Моточасы: `recordedAt` | `src/modules/equipment/application/commands/meter-reading.ts:186` + route `equipment/[id]/meter-readings/route.ts:37` | КЛИЕНТ, если передал; иначе сервер | Мелочь (админ-формы). |
| Долив топлива: `recordedAt` | `src/modules/equipment/application/commands/fuel-log.ts:121` + route `equipment/[id]/fuel/route.ts:36` | КЛИЕНТ, если передал; иначе сервер | Мелочь (админ-формы). |
| `queuedAt` в очереди офлайна | `src/components/piling/operator-mobile/offline-queue.ts:342,352` | ТЕЛЕФОН | Мелочь: служит только для версии состава. |

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/commands/production.ts:105,273` | `occurredAt` у выработки = серверное время прихода запроса, а не время работы. Офлайн-запись получает время СИНХРОНИЗАЦИИ. | Свая забита в 10:00 без связи, очередь ушла в 18:00 → в журнале забивки и на экране «Мои записи» свая помечена 18:00 (`src/components/piling/operator-mobile/operator-work-overview.tsx:62`, `src/components/piling/operator-v5/operator-v5-app.tsx:1349`). Дата отчёта при этом НЕ съезжает (проекция по `report.date`, см. `src/services/reports/event-handlers.ts:212-242`), но время события искажено на длину очереди. | Если время события важно — брать `occurredAt` из `queuedAt` зажатого в разумные границы, либо отдельным полем «время работы» в команде; иначе честно писать в интерфейсе, что это время отправки. |
| 2 | важно | `src/modules/operator-mobile/application/commands/production.ts:446-476,519-527` | Прежний формат простоя принимает `startedAt`/`endedAt` с телефона и пишет их в БД как `occurredAt`, `startedAt`, `endedAt`. От будущего защищает только допуск 5 минут (`production.ts:474`), прошлое не ограничено (`:471`). | Телефон с отставшими часами (или сбитой датой) записывает интервал, который сервер не может перепроверить по своим суткам: `occurredAt = startedAt` уезжает в отчёт клиентским. Телефон со спешащими часами получает 400 → `classifyFailure` = permanent (`offline-queue.ts:139-144`) → запись навсегда красная. | На сервере перепроверять начало простоя по серверному времени (или запретить интервал для новых клиентов и оставить только часы), не доверять будущему/прошлому без границ. |
| 3 | важно | `src/app/api/operator/mobile/command/route.ts:37` + `src/modules/operator-mobile/application/commands/admission.ts:209-243` + `src/modules/operator-mobile/application/commands/shared.ts:260-293` | `confirm-ppe` принимает `productionDate` с клиента (это round-trip серверной даты из состояния) и пишет `PpeCheck` за эти сутки. Проверка допуска читает `PpeCheck` по `productionDate` СМЕНЫ, а отсутствие строки трактует как «нехватки нет» (`shared.ts:293`: `ppeCheck?.missing ?? []`). | Вкладка экрана, открытая вчера и не обновившаяся, отправит СИЗ за вчерашние сутки; у сегодняшней смены строки нет → допуск считает, что СИЗ не проверялись и нехватки нет → работа идёт без фактически применённой отметки. Также телефон со сбитой датой (страница долго в фоне) даёт тот же эффект. | Считать `productionDate` для СИЗ на СЕРВЕРЕ из сессии/смены, а не принимать с клиента; при отсутствии строки ППЕ по суткам смены — считать допуск незакрытым, а не пустым. |
| 4 | мелочь | `src/components/piling/operator-mobile/offline-queue.ts:342,352` | `queuedAt` берётся из часов устройства и служит предохранителем версии состава (`F-V1-QUEUE-VERSION`, см. `resolve`/`markAttempt`). | Часы телефона, идущие назад или замороженные, могут дать одинаковый `queuedAt` для двух разных составов одной команды — поздний ответ снимет не тот состав. Также `queuedAt` показывается машинисту через `clock()` (`offline-queue.ts:92-97`). | Не полагаться на `queuedAt` из часов устройства: версию состава брать из счётчика/`crypto.randomUUID`. |
| 5 | мелочь | `src/modules/equipment/application/commands/fuel-log.ts:121` и `src/modules/equipment/application/commands/meter-reading.ts:186` (+ route `equipment/[id]/fuel/route.ts:36`, `equipment/[id]/meter-readings/route.ts:37`) | `recordedAt` принимается из тела и пишется как есть (`toDate(input.recordedAt) ?? new Date()`); серверной границы (не будущее, не старше суток) нет. | Админ/диспетчер с неверными часами задним числом ставит показание или долив в будущее/прошлое; наработка и планы ТО считаются от `recordedAt`. | Валидировать `recordedAt` на сервере (не будущее, разумный «пол»), либо не давать его выбирать вручную. |
| 6 | мелочь | `src/app/api/briefings/route.ts:20,56` и `src/modules/reports/application/commands/report-command.service.ts:249` | `recordedAt` (журнал инструктажей) и `date` (форма отчёта) — клиентские значения без серверной сверки. | Формы админа/ОТ с неверными часами создают записи не за те сутки; для отчёта `date` задаёт `productionDate` (`report-command.service.ts:249`) и ключ уникальности. | Для отчёта сверять выбранную дату с серверными сутками смены; для журнала инструктажей — не позволять произвольную дату без прав. |

## Не проверено

- Не запускался браузер/Playwright и не эмулировался офлайн: выводы об офлайне
  получены чтением кода (`offline-queue.ts`, `use-offline-queue.ts`,
  `operator-mobile-app.tsx`), а не прогоном. Прогонялись только два юнит-теста
  (27 тестов, см. Методику).
- Не проверялось содержимое боевой БД: фактических строк с `occurredAt`,
  разошедшимся со временем работы, не смотрел — эффект находки 1 описан по коду
  и подтверждён местом вывода (`operator-work-overview.tsx:62`).
- Не проверялось, существуют ли ещё в поле устройства со старым клиентом,
  который шлёт интервал простоя (находка 2): код-путь жив, фактическое наличие
  таких клиентов не подтверждено.
- Не проверялась цепочка токена проверки знаний `attemptToken`
  (`knowledge-attempt`) на предмет зависимости от часов клиента — вне рамок
  задачи про офлайн-записи.
- Не проверялись воркеры/outbox на предмет простановки времени события при
  переигрывании назадлога (в отчёте ограничился датой проекции по `report.date`).
