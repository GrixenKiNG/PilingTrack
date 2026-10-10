# AU119-S5 — маршруты API без теста

Версия: `git rev-parse HEAD` = `fdf65f1a3350d1c5dc4bca2240b0c803d9d4b558` (ветка `hermes/q4-0926`).
Только чтение: код приложения не менялся, создан один файл — этот отчёт.
Отчёты в `docs/audits/` не читались.

## Итог

Резюме для владельца:

1. Из 141 маршрута в `src/app/api/**` собственный тест есть у 58, ещё 19 покрыты общим тестом побочных эффектов, 19 упомянуты только в `tests/` или `e2e/`, а 45 не упомянуты нигде.
2. Из 86 маршрутов, изменяющих данные, собственный тест есть у 37; у 27 изменяющих маршрутов нет вообще никакого теста.
3. Самый тревожный кусок — 15 изменяющих маршрутов контура технической готовности (TO): запуск/передача/отмена смены, допуск и отзыв наряда, разбор дефектов, матрица доступа. Это допуск техники к работе, и его никто не проверяет автоматически.
4. Часть «зелёных» тестов не запускается: `tests/contract/tech-readiness-api.spec.ts` целиком под `describe.skip`, 13 интеграционных спеков гейтятся переменными окружения, каталог `tests/chaos/**` исключён из vitest, а `tests/manual-test-runner*.js` не подключён ни к одному npm-скрипту.
5. Защита (сессии, CSRF, лимиты) — наоборот, закрыта лучше, чем тесты: 134 из 141 маршрута идут через общую обёртку, остальные 7 объявлены публичными/ручными исключениями с причиной и это сторожит статический тест `src/app/api/__tests__/route-guards.test.ts` (14 тестов, exit 0). Дыра не в защите, а в проверке поведения.

Числа (получены скриптом по репозиторию, см. «Методика»):

- всего `route.ts` в `src/app/api/**`: **141**;
- «свой» тест в каталоге маршрута (`__tests__/*.test.ts`): **58**, из них ровно `__tests__/route.test.ts` — 56;
- только функциональный тест чужого файла: **19**;
- только упоминание в `tests/**`: **14**; только в `e2e/**`: **5**;
- без единого упоминания в тестах: **45**;
- изменяющих данные маршрутов (POST/PUT/PATCH/DELETE): **86**; из них с собственным тестом **37**, без теста **49**, без теста и без функционального теста **34**;
- из 45 маршрутов без упоминания в тестах изменяющих данные — **27**;
- защита: 81 маршрут использует `withMutation`/`withReadinessCommand`, 88 — `withApi`; без обёртки 7 маршрутов (`alerts/webhook`, `health`, `health/deep`, `liveness`, `ready`, `readiness`, `orion/lead`) — все объявлены исключениями с причиной в `src/app/api/__tests__/route-guards.test.ts:142-180`.

Топ-5 находок:

1. 15 изменяющих маршрутов TO (`readiness/shifts/*`, `readiness/handovers/*`, `readiness/work-permits/*`, `readiness/defects/*`, `readiness/access-matrix`) — ни одного запускаемого теста (критично).
2. `tests/contract/tech-readiness-api.spec.ts:49` — `describe.skip` без условия: контракт публичных ручек TO не выполняется никогда (критично).
3. `tests/manual-test-runner.js` / `tests/manual-test-runner-v2.js` — единственное «покрытие» для `/reports/admin-upsert`, `/analytics/sites`, `/crews/all`; не подключены ни к одному скрипту и не входят в `include` vitest (важно).
4. `tests/chaos/**` исключён из vitest (`vitest.config.ts:47`), то есть упоминания `/crews`, `/system`, `/metrics` там — не покрытие (важно).
5. `src/app/api/sites/[id]/route.ts:108` — жёсткое удаление участка (`hardDeleteSite`) без собственного теста (важно).

## Методика

Всё воспроизводимо; скрипты лежали вне репозитория (каталог scratch), в репозитории создан только этот файл.

1. Инвентаризация: рекурсивный обход `src/app/api` в поисках файлов с именем `route.ts` — 141 файл.
2. Методы: регулярное выражение по `export const|export async function|export function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)`.
3. Обёртка на метод: окно 300 символов после объявления, поиск `withMutation` / `withReadinessCommand` / `withOperatorV3Command` / `withApi`; иначе `MANUAL`.
4. «Свой тест»: наличие каталога `__tests__` рядом с `route.ts` и файлов `*.test.*`/`*.spec.*` в нём.
5. «Функциональный тест»: по всем файлам `*.test.*`/`*.spec.*` в `src/`, `tests/`, `e2e/` разобраны статические и динамические импорты, спецификатор разрешён в абсолютный путь (`./`, `../`, `@/`) и сопоставлен с модулем маршрута.
6. «Упоминание»: поиск строки URL маршрута (например `/api/readiness/current`) по файлам `tests/**` и `e2e/**` построчно.
7. Проверка защиты как факта: `node node_modules/vitest/vitest.mjs run src/app/api/__tests__/route-guards.test.ts` — 14 passed, exit 0; этот тест статически (AST) требует для каждого GET вызов `requireAuth`/контекста, а для каждой мутации — обёртку либо запись в списке исключений с причиной.
8. Прогон тестов API: `node node_modules/vitest/vitest.mjs run src/app/api` — 64 файла, 512 тестов, 0 пропущено, exit 0.

Команды (только чтение):

```
git rev-parse HEAD
find src/app/api -name route.ts | wc -l
find src/app/api -name "route.test.ts" | wc -l
node node_modules/vitest/vitest.mjs run src/app/api/__tests__/route-guards.test.ts
node node_modules/vitest/vitest.mjs run src/app/api
```

## Находки

Статусы: ПРОЙДЕНО — проверено командой/чтением файла; ГИПОТЕЗА — вывод из разбора кода без запуска сценария.

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое лечение |
|---|---|---|---|---|---|
| 1 | критично | `src/app/api/readiness/shifts/[id]/start/route.ts:12` | запуск смены (допуск техники к работе) изменяется POST-ом без единого теста | ошибка в правилах допуска или в переходе состояния пройдёт все проверки: маршрут не покрыт нигде (НИ тестов рядом, ни `tests/`, ни `e2e/`). ГИПОТЕЗА | один тест `__tests__/route.test.ts` на ветки: допустимая смена, отказ по правилу, повторный запуск (идемпотентность) |
| 2 | критично | `src/app/api/readiness/shifts/[id]/handover/route.ts:11` | передача смены изменяется без теста | передача фиксирует, кто отвечает за технику; сбой в ней = спор «чья смена». ГИПОТЕЗА | тест на передачу между сменами + запрет передачи от не-своего оператора |
| 3 | критично | `src/app/api/readiness/handovers/[id]/accept/route.ts:10` | приёмка передачи смены без теста | приёмка — вторая половина критичного перехода; тест отсутствует полностью. ГИПОТЕЗА | тест на приёмку и на попытку принять уже принятое |
| 4 | критично | `src/app/api/readiness/handovers/[id]/rework/route.ts:9` | возврат передачи на доработку без теста | цикл accept/rework — место, где теряются смены; не проверяется. ГИПОТЕЗА | тест цикла accept → rework → accept |
| 5 | критично | `src/app/api/readiness/shifts/[id]/waiver/route.ts:15` | отказ от требования готовности без теста | waiver снимает блокировку допуска по решению человека; отсутствие теста = не проверено, кто и на что имеет право его выдать. ГИПОТЕЗА | тест: какая роль может выдать waiver, что он попадает в аудит |
| 6 | критично | `src/app/api/readiness/work-permits/[id]/approve/route.ts:11` | допуск наряда без теста | разрешение на работы — прямой допуск людей и техники. ГИПОТЕЗА | тест на approve + тест запрета approve без прав |
| 7 | критично | `src/app/api/readiness/work-permits/[id]/revoke/route.ts:11` | отзыв наряда без теста | отзыв должен останавливать работы; сбой оставляет людей работать по отозванному наряду. ГИПОТЕЗА | тест на revoke и на состояние наряда после него |
| 8 | критично | `src/app/api/readiness/work-permits/[id]/submit/route.ts:11` | отправка наряда на согласование без теста | первый шаг цепочки; сбой = наряд не дошёл до согласующего. ГИПОТЕЗА | тест жизненного цикла наряда (submit → approve → revoke) |
| 9 | критично | `src/app/api/readiness/shifts/[id]/cancel/route.ts:11` | отмена смены без теста | отмена после старта влияет на учёт выработки и на проекцию готовности. ГИПОТЕЗА | тест: отмена до старта / после старта |
| 10 | критично | `src/app/api/readiness/shifts/[id]/decline/route.ts:12` | отклонение смены без теста | отказ от приёма смены — штатная ветка, ни разу не проверенная. ГИПОТЕЗА | тест decline + проверка, что состояние не осталось «в ожидании» |
| 11 | критично | `src/app/api/readiness/defects/[id]/triage/route.ts:11` | разбор дефекта без теста | разбор определяет, блокирует дефект допуск или нет. ГИПОТЕЗА | тест на все исходы разбора |
| 12 | критично | `src/app/api/readiness/defects/[id]/resolve/route.ts:11` | закрытие дефекта без теста | закрытый дефект перестаёт блокировать допуск; ошибка снимает блокировку молча. ГИПОТЕЗА | тест: закрытие снимает блокировку, повторное закрытие отвергается |
| 13 | критично | `src/app/api/readiness/defects/[id]/reject/route.ts:11` | отклонение дефекта без теста | отклонение «убирает» замечание из контура. ГИПОТЕЗА | тест на права и на аудит отклонения |
| 14 | критично | `src/app/api/readiness/access-matrix/route.ts:31,45` | правка матрицы доступа (PUT/POST) без теста | это настройка «кому что можно» внутри контура TO; не проверено, что правка недоступна без прав. ГИПОТЕЗА | тест на запрет правки без прав и на применение матрицы |
| 15 | критично | `src/app/api/readiness/place-presets/route.ts:32,91` | справочник мест (POST/DELETE) без теста | шаблоны мест пишутся в БД и влияют на создание смен. ГИПОТЕЗА | тест на создание/удаление и на запрет чужого тенанта |
| 16 | важно | `tests/contract/tech-readiness-api.spec.ts:49` | `describe.skip` без условия — весь контракт публичных ручек TO не выполняется | зелёный прогон создаёт ощущение, что контракт `/api/audit`, `/api/readiness/work-permits` и др. проверен. Read-only разбор файла: ПРОЙДЕНО | либо снять skip и включить в CI, либо удалить файл, чтобы он не выдавал себя за покрытие |
| 17 | важно | `tests/manual-test-runner-v2.js` (нет в `include` `vitest.config.ts:35-39`) | единственное «покрытие» для `/analytics/sites`, `/crews/all`, `/dictionary/all`, `/reports/admin-upsert`; по `grep` по репозиторию не подключён ни к одному npm-скрипту | файл никто не запускает ни в CI, ни локально по инструкции; покрытием он не является. Read-only: ПРОЙДЕНО | либо оформить как `*.spec.ts` и включить в vitest, либо перестать ссылаться на него как на тест |
| 18 | важно | `vitest.config.ts:47` | каталог `tests/chaos/**` исключён из vitest | упоминания `/crews`, `/system`, `/system/status`, `/metrics` в `tests/chaos/circuit-breaker.test.js` не выполняются в `npm run test:unit`. ПРОЙДЕНО | если стресс-тест нужен — отдельный npm-скрипт и явная запись в отчёте о покрытии |
| 19 | важно | `tests/integration/disposable-idor.spec.ts:7,64` | HTTP-проверки IDOR гейтятся `INTEGRATION_DATABASE_URL_OWNER` + `CODEX_STAND_URL`; локально набор пропускается | именно этот файл — единственное упоминание для `/media` POST, `/reports/upsert`, `/readiness/defects`, `/crews/my`, `/sites`. Локально это 0 проверок. ПРОЙДЕНО (чтение условия гейта) | держать в CI обязательным и печатать число пропущенных |
| 20 | важно | `src/app/api/sites/[id]/route.ts:108` | жёсткое удаление участка (`hardDeleteSite`) и правка (PUT:31) без теста | у соседних `sites/[id]/assign` и `sites/[id]/hierarchy` тесты есть, у самого участка — нет. В коде прямо написано, что удаление окончательное. ГИПОТЕЗА | тест: удаление проходит только при 0 бригад и 0 отчётов |
| 21 | важно | `src/app/api/safety/equipment-permits/[id]/route.ts:13` | удаление допуска на оборудование без теста | документ по ОТ, удаляется необратимо. ГИПОТЕЗА | тест на удаление и на отказ без прав |
| 22 | важно | `src/app/api/safety/equipment-permits/route.ts:64` | создание допуска на оборудование (POST:64) без теста | весь модуль разрешений по ОТ (3 маршрута) не покрыт ничем. ГИПОТЕЗА | минимальный тест на создание с валидацией и на 400 |
| 23 | важно | `src/app/api/media/[id]/confirm/route.ts:8` | подтверждение загрузки вложения без теста | после confirm файл считается принятым; сбой = потерянное фотоотчётное вложение. ГИПОТЕЗА | тест на confirm и на повторный confirm |
| 24 | важно | `src/app/api/reports/admin-upsert/route.ts:17` | административная правка отчёта без собственного теста | это запись в производственные данные «от имени администратора»; покрытие — только ручные раннеры (см. п.17). ГИПОТЕЗА | тест на права и на аудит правки |
| 25 | важно | `src/app/api/users/[id]/documents/route.ts:55` и `src/app/api/users/[id]/documents/[docId]/route.ts:27,56` | выдача/правка/удаление документов сотрудника без теста | документы влияют на допуск (сроки действия) — связь с контуром готовности. ГИПОТЕЗА | тест на привязку документа и на удаление |
| 26 | важно | `src/app/api/user-document-types/route.ts:41` и `src/app/api/user-document-types/[id]/route.ts:14,37` | справочник типов документов (POST/PATCH/DELETE) без теста | тип документа задаёт правила срока действия; правка меняет смысл уже загруженных документов. ГИПОТЕЗА | тест на создание/переименование/удаление типа |
| 27 | важно | `src/app/api/layout/[surfaceId]/route.ts:50,76` | сохранение и сброс пользовательской раскладки без теста | у `layout` есть контрактные тесты шаблонов (`tests/contract/page-layout.spec.ts`), но не самой ручки сохранения. ГИПОТЕЗА | тест на PUT и на запрет чужого surfaceId |
| 28 | важно | `src/app/api/monitoring/template/route.ts:25` | шаблон плитки мониторинга (PUT) без теста | `tests/contract/monitoring-template.spec.ts` проверяет дефолтный шаблон-константу, а не сохранение через API. ГИПОТЕЗА | тест на сохранение и на валидацию схемы |
| 29 | важно | `src/app/api/maintenance-plans/run/route.ts:13` | ручной запуск планировщика ТО без теста | запускает фоновую работу по всему тенанту; ошибка = дубли или пропуск плановых работ. ГИПОТЕЗА | тест на 403 без `maintenance.manage` и на идемпотентность повторного запуска |
| 30 | важно | `src/app/api/crews/route.ts:36` | создание бригады без собственного теста | единственные упоминания — `tests/chaos` (исключён, п.18) и `tests/integration` (гейт, п.19). Соседний `/crews/[id]` тест имеет. ГИПОТЕЗА | тест на создание с валидацией |
| 31 | важно | `src/app/api/media/route.ts:19` | загрузка вложения (POST) без собственного теста | покрытие — только гейтнутый `disposable-idor.spec.ts`. ГИПОТЕЗА | тест на отказ без сессии и на лимит размера |
| 32 | важно | `src/app/api/readiness/defects/route.ts:67` и `src/app/api/readiness/work-permits/route.ts:64` | создание дефекта и наряда TO без собственного теста | упомянуты в `disposable-idor` (гейт) и в `describe.skip`-контракте — то есть фактически не проверяются. ГИПОТЕЗА | тесты на создание с валидацией схемы (`safeParse` → 400) |
| 33 | важно | `src/app/api/audit/route.ts` (упоминание только в `tests/contract/tech-readiness-api.spec.ts:275,294`) | журнал аудита: чтение не покрыто | контракт этой ручки лежит в целиком пропущенном файле (п.16). ГИПОТЕЗА | перенести проверки пагинации/курсора в запускаемый тест |
| 34 | мелочь | `src/app/api/__tests__/route-guards.test.ts:229-231` | защита проверяется статически (разбор AST), а не выполнением | тест доказывает «в коде есть вызов», но не «поведение верное». Это сильный, но не функциональный сторож. ПРОЙДЕНО (14 тестов, exit 0) | сохранить как есть, не выдавать за покрытие поведения |
| 35 | мелочь | `src/app/api/**/__tests__/mutation-audit.test.ts:38-48` | 11 маршрутов «покрыты» проверкой только побочного события (запись в ленту/аудит), а не бизнес-логики | для `checklist-templates`, `briefings`, `media/[id]`, `equipment/[id]/documents` и др. проверяется факт события, а не результат операции. ГИПОТЕЗА | считать эти маршруты «наполовину покрытыми» и не засчитывать как тест бизнес-логики |
| 36 | мелочь | `src/app/api/orion/lead/route.ts` (POST, обёртка `MANUAL`) | публичная форма заявки без теста | маршрут вне контура и в «замороженной» зоне `src/app/api/orion/**` (AGENTS.md §1), поэтому только фиксирую факт, не разбираю. ГИПОТЕЗА | по решению владельца: тест на лимит по IP |
| 37 | мелочь | 45 маршрутов без упоминания в тестах, из них 18 — только чтение | нет даже smoke-проверки | чтение реже ломается, но именно так незаметно ломаются 403/фильтры (например `/assistant/state`, `/reports/recent`, `/safety/my-clearance`, `/readiness/history`) | отдельный дешёвый smoke-набор «все GET отвечают 200/403, не 500» |

### Таблица: все 141 маршрут `src/app/api/**/route.ts`

Столбец «Тест»: `свой` — тест в каталоге маршрута; `функц.` — модуль маршрута импортируется другим тестом; `tests/` — строка URL встречается в `tests/**`; `e2e` — только в `e2e/**`; `НЕТ` — нигде.

| # | Маршрут | Методы | Тест | Защита (метод:обёртка) |
|---|---|---|---|---|
| 1 | `/admin/analytics/overview` | GET | НЕТ | GET:withApi |
| 2 | `/admin/analytics/site-weekly-trend` | GET | свой — admin/analytics/site-weekly-trend/__tests__/route.test.ts | GET:withApi |
| 3 | `/admin/dlq` | GET/POST | свой — admin/dlq/__tests__/route.test.ts | GET:withApi POST:withMutation |
| 4 | `/admin/equipment-analytics` | GET | e2e — e2e/role-audit.spec.js:77,e2e/role-audit.spec.js:81 | GET:withApi |
| 5 | `/admin/incidents` | GET/POST | функц. — __tests__/mutation-audit.test.ts | GET:withApi POST:withMutation |
| 6 | `/admin/projections/rebuild` | POST | свой — admin/projections/rebuild/__tests__/route.test.ts | POST:withMutation |
| 7 | `/alerts/webhook` | POST | свой — alerts/webhook/__tests__/route.test.ts | POST:MANUAL |
| 8 | `/analytics/sites` | GET | tests/ — tests/manual-test-runner-v2.js | GET:withApi |
| 9 | `/assistant/command` | POST | e2e — e2e/role-audit.spec.js:51 | POST:withMutation |
| 10 | `/assistant/state` | GET | НЕТ | GET:withApi |
| 11 | `/audit` | GET | tests/ — tests/contract/tech-readiness-api.spec.ts | GET:withApi |
| 12 | `/auth/login` | POST | свой — auth/login/__tests__/route.test.ts | POST:withMutation |
| 13 | `/auth/logout` | POST | свой — auth/logout/__tests__/route.test.ts | POST:withMutation |
| 14 | `/auth/me` | GET | свой — auth/me/__tests__/route.test.ts | GET:withApi |
| 15 | `/briefings/[id]/sign` | POST | функц. — __tests__/mutation-audit.test.ts | POST:withMutation |
| 16 | `/briefings/journal` | GET | НЕТ | GET:withApi |
| 17 | `/briefings` | POST | функц. — __tests__/mutation-audit.test.ts | POST:withMutation |
| 18 | `/checklist-templates/[id]` | GET/PUT/DELETE | функц. — __tests__/mutation-audit.test.ts | GET:withApi PUT:withMutation DELETE:withMutation |
| 19 | `/checklist-templates` | GET/POST | функц. — __tests__/mutation-audit.test.ts | GET:withApi POST:withMutation |
| 20 | `/crews/[id]` | GET/PUT/DELETE | свой — crews/[id]/__tests__/route.test.ts | GET:withApi PUT:withMutation DELETE:withMutation |
| 21 | `/crews/all` | GET | свой — crews/all/__tests__/route.test.ts | GET:withApi |
| 22 | `/crews/my` | GET | tests/ — tests/integration/disposable-idor.spec.ts,tests/manual-test-runner-v2.js | GET:withApi |
| 23 | `/crews` | GET/POST | tests/ — tests/chaos/circuit-breaker.test.js,tests/integration/disposable-idor.spec.ts,tests/manual-test-runner-v2.js,tests/manual-test-runner.js | GET:withApi POST:withMutation |
| 24 | `/dictionary/all` | GET | свой — dictionary/all/__tests__/route.test.ts | GET:withApi |
| 25 | `/dictionary/manage` | GET/POST/PATCH/DELETE | свой — dictionary/manage/__tests__/route.test.ts | GET:withApi POST:withMutation PATCH:withMutation DELETE:withMutation |
| 26 | `/equipment/[id]/details` | GET | НЕТ | GET:withApi |
| 27 | `/equipment/[id]/device-keys` | POST/GET/DELETE | свой — equipment/[id]/device-keys/__tests__/route.test.ts | POST:withMutation GET:withApi DELETE:withMutation |
| 28 | `/equipment/[id]/documents/[docId]` | PUT/DELETE | свой — equipment/[id]/documents/[docId]/__tests__/route.test.ts | PUT:withMutation DELETE:withMutation |
| 29 | `/equipment/[id]/documents` | POST | функц. — __tests__/mutation-audit.test.ts | POST:withMutation |
| 30 | `/equipment/[id]/fuel/[entryId]` | DELETE | свой — equipment/[id]/fuel/[entryId]/__tests__/route.test.ts | DELETE:withMutation |
| 31 | `/equipment/[id]/fuel` | GET/POST | функц. — __tests__/mutation-audit.test.ts | GET:withApi POST:withMutation |
| 32 | `/equipment/[id]/maintenance/[recordId]` | PUT/DELETE | свой — equipment/[id]/maintenance/[recordId]/__tests__/route.test.ts | PUT:withMutation DELETE:withMutation |
| 33 | `/equipment/[id]/maintenance` | GET/POST | свой — equipment/[id]/maintenance/__tests__/route.test.ts | GET:withApi POST:withMutation |
| 34 | `/equipment/[id]/meter-readings/[readingId]` | DELETE | свой — equipment/[id]/meter-readings/[readingId]/__tests__/route.test.ts | DELETE:withMutation |
| 35 | `/equipment/[id]/meter-readings` | GET/POST | свой — equipment/[id]/meter-readings/__tests__/route.test.ts | GET:withApi POST:withMutation |
| 36 | `/equipment/[id]` | GET/PUT/DELETE | свой — equipment/[id]/__tests__/route.test.ts | GET:withApi PUT:withMutation DELETE:withMutation |
| 37 | `/equipment` | GET/POST | свой — equipment/__tests__/route.test.ts | GET:withApi POST:withMutation |
| 38 | `/feedback/events` | GET/POST/PATCH | свой — feedback/events/__tests__/route.test.ts | GET:withApi POST:withMutation PATCH:MANUAL |
| 39 | `/feedback/stream` | GET | e2e — e2e/app.spec.ts:17,e2e/role-audit.spec.js:16 | GET:withApi |
| 40 | `/health/deep` | GET | свой — health/deep/__tests__/route.test.ts | GET:MANUAL |
| 41 | `/health` | GET | свой — health/__tests__/route.test.ts | GET:MANUAL |
| 42 | `/inspections/[id]/complete` | POST | свой — inspections/[id]/complete/__tests__/route.test.ts | POST:withMutation |
| 43 | `/inspections/[id]` | GET/PUT | функц. — __tests__/mutation-audit.test.ts | GET:withApi PUT:withMutation |
| 44 | `/inspections` | GET/POST | свой — inspections/__tests__/route.test.ts | GET:withApi POST:withMutation |
| 45 | `/layout/[surfaceId]` | GET/PUT/DELETE | НЕТ | GET:withApi PUT:withMutation DELETE:withMutation |
| 46 | `/liveness` | GET | e2e — e2e/smoke-e2e.spec.ts:32 | GET:MANUAL |
| 47 | `/maintenance-plans/[id]` | PATCH/DELETE | свой — maintenance-plans/[id]/__tests__/route.test.ts | PATCH:withMutation DELETE:withMutation |
| 48 | `/maintenance-plans` | GET/POST | функц. — __tests__/mutation-audit.test.ts | GET:withApi POST:withMutation |
| 49 | `/maintenance-plans/run` | POST | НЕТ | POST:withMutation |
| 50 | `/maintenance/[id]/accept` | POST | свой — maintenance/[id]/accept/__tests__/route.test.ts | POST:withMutation |
| 51 | `/maintenance/[id]` | GET | НЕТ | GET:withApi |
| 52 | `/maintenance/assignees` | GET | НЕТ | GET:withApi |
| 53 | `/maintenance/kpi` | GET | свой — maintenance/kpi/__tests__/route.test.ts | GET:withApi |
| 54 | `/maintenance` | GET | tests/ — tests/integration/disposable-idor.spec.ts | GET:withApi |
| 55 | `/media/[id]/confirm` | POST | НЕТ | POST:withMutation |
| 56 | `/media/[id]/download` | GET | НЕТ | GET:withApi |
| 57 | `/media/[id]` | DELETE | функц. — __tests__/mutation-audit.test.ts | DELETE:withMutation |
| 58 | `/media/download-batch` | GET | НЕТ | GET:withApi |
| 59 | `/media` | POST/GET | tests/ — tests/integration/disposable-idor.spec.ts | POST:withMutation GET:withApi |
| 60 | `/metrics` | GET | свой — metrics/__tests__/route.test.ts | GET:withApi |
| 61 | `/monitoring/fleet` | GET | НЕТ | GET:withApi |
| 62 | `/monitoring/template` | GET/PUT | НЕТ | GET:withApi PUT:withMutation |
| 63 | `/notifications/telegram/test` | POST | свой — notifications/telegram/test/__tests__/route.test.ts | POST:withMutation |
| 64 | `/operator/knowledge-attempt` | GET | e2e — e2e/role-audit.spec.js:41 | GET:withApi |
| 65 | `/operator/mobile/command` | POST | свой — operator/mobile/command/__tests__/downtime-hours.test.ts | POST:withMutation |
| 66 | `/operator/mobile/state` | GET | НЕТ | GET:withApi |
| 67 | `/operator/shift` | GET | НЕТ | GET:withApi |
| 68 | `/orion/lead` | POST | НЕТ | POST:MANUAL |
| 69 | `/pile-passports/[id]/decide` | POST | свой — pile-passports/[id]/decide/__tests__/route.test.ts | POST:withMutation |
| 70 | `/pile-passports/export` | GET | свой — pile-passports/export/__tests__/route.test.ts | GET:withApi |
| 71 | `/pile-passports` | GET | свой — pile-passports/__tests__/route.test.ts | GET:withApi |
| 72 | `/readiness-rules/publish` | POST | функц. — readiness-rules/__tests__/route.test.ts | POST:withMutation |
| 73 | `/readiness-rules` | GET/PUT | свой — readiness-rules/__tests__/route.test.ts | GET:withApi PUT:withMutation |
| 74 | `/readiness/access-matrix` | PUT/POST/GET | НЕТ | PUT:withReadinessCommand POST:withReadinessCommand GET:withApi |
| 75 | `/readiness/audit` | GET | НЕТ | GET:withApi |
| 76 | `/readiness/bootstrap` | GET | свой — readiness/bootstrap/__tests__/route.test.ts | GET:withApi |
| 77 | `/readiness/current` | GET | функц. — readiness/_shared/__tests__/routes-read-capability.test.ts | GET:withApi |
| 78 | `/readiness/defects/[id]/reject` | POST | НЕТ | POST:withReadinessCommand |
| 79 | `/readiness/defects/[id]/resolve` | POST | НЕТ | POST:withReadinessCommand |
| 80 | `/readiness/defects/[id]/triage` | POST | НЕТ | POST:withReadinessCommand |
| 81 | `/readiness/defects` | POST/GET | tests/ — tests/integration/disposable-idor.spec.ts | POST:withReadinessCommand GET:withApi |
| 82 | `/readiness/export` | GET | функц. — readiness/_shared/__tests__/routes-read-capability.test.ts | GET:withApi |
| 83 | `/readiness/handovers/[id]/accept` | POST | НЕТ | POST:withReadinessCommand |
| 84 | `/readiness/handovers/[id]/rework` | POST | НЕТ | POST:withReadinessCommand |
| 85 | `/readiness/handovers/[id]` | GET | функц. — readiness/_shared/__tests__/routes-read-capability.test.ts | GET:withApi |
| 86 | `/readiness/history` | GET | НЕТ | GET:withApi |
| 87 | `/readiness/permit-form-options` | GET | НЕТ | GET:withApi |
| 88 | `/readiness/place-presets` | POST/DELETE | НЕТ | POST:withReadinessCommand DELETE:withMutation |
| 89 | `/readiness` | GET | функц. — ready/__tests__/route.test.ts | GET:MANUAL |
| 90 | `/readiness/shifts/[id]/cancel` | POST | НЕТ | POST:withReadinessCommand |
| 91 | `/readiness/shifts/[id]/decline` | POST | НЕТ | POST:withReadinessCommand |
| 92 | `/readiness/shifts/[id]/handover` | POST | НЕТ | POST:withReadinessCommand |
| 93 | `/readiness/shifts/[id]/request-acceptance` | POST | свой — readiness/shifts/[id]/request-acceptance/__tests__/route.test.ts | POST:withReadinessCommand |
| 94 | `/readiness/shifts/[id]` | PATCH/GET | функц. — readiness/_shared/__tests__/routes-read-capability.test.ts | PATCH:withReadinessCommand GET:withApi |
| 95 | `/readiness/shifts/[id]/start` | POST | НЕТ | POST:withReadinessCommand |
| 96 | `/readiness/shifts/[id]/waiver` | POST | НЕТ | POST:withReadinessCommand |
| 97 | `/readiness/shifts` | POST/GET | свой — readiness/shifts/__tests__/route.test.ts | POST:withReadinessCommand GET:withApi |
| 98 | `/readiness/work-permits/[id]/approve` | POST | НЕТ | POST:withReadinessCommand |
| 99 | `/readiness/work-permits/[id]/revoke` | POST | НЕТ | POST:withReadinessCommand |
| 100 | `/readiness/work-permits/[id]` | PATCH/GET | функц. — readiness/_shared/__tests__/routes-read-capability.test.ts | PATCH:withReadinessCommand GET:withApi |
| 101 | `/readiness/work-permits/[id]/submit` | POST | НЕТ | POST:withReadinessCommand |
| 102 | `/readiness/work-permits` | POST/GET | tests/ — tests/contract/tech-readiness-api.spec.ts,tests/integration/disposable-idor.spec.ts | POST:withReadinessCommand GET:withApi |
| 103 | `/ready` | GET | свой — ready/__tests__/route.test.ts | GET:MANUAL |
| 104 | `/reports/[id]/history` | GET | свой — reports/[id]/history/__tests__/route.test.ts | GET:withApi |
| 105 | `/reports/admin-upsert` | POST | tests/ — tests/manual-test-runner-v2.js,tests/manual-test-runner.js | POST:withMutation |
| 106 | `/reports/all` | GET | свой — reports/all/__tests__/route.test.ts | GET:withApi |
| 107 | `/reports/delete` | DELETE | свой — reports/delete/__tests__/route.test.ts | DELETE:withMutation |
| 108 | `/reports/edit` | GET | свой — reports/edit/__tests__/route.test.ts | GET:withApi |
| 109 | `/reports/export` | GET | свой — reports/export/__tests__/route.test.ts | GET:withApi |
| 110 | `/reports/my` | GET | свой — reports/my/__tests__/route.test.ts | GET:withApi |
| 111 | `/reports/pdf` | POST/GET | свой — reports/pdf/__tests__/route.test.ts | POST:withMutation GET:withApi |
| 112 | `/reports/period` | GET | свой — reports/period/__tests__/period-summary.test.ts,reports/period/__tests__/route.test.ts | GET:withApi |
| 113 | `/reports/recent` | GET | НЕТ | GET:withApi |
| 114 | `/reports/single-pdf` | POST/GET | свой — reports/single-pdf/__tests__/route.test.ts | POST:withMutation GET:withApi |
| 115 | `/reports/upsert` | POST | tests/ — tests/integration/disposable-idor.spec.ts,tests/integration/disposable-report-race.spec.ts,tests/manual-test-runner-v2.js | POST:withMutation |
| 116 | корневой /api | GET | tests/ — tests/chaos/circuit-breaker.test.js,tests/contract/auth-api.spec.ts,tests/contract/layout-template.spec.ts,tests/contract/monitoring-template.spec.ts,tests/cont | GET:withApi |
| 117 | `/safety/clearance` | GET | НЕТ | GET:withApi |
| 118 | `/safety/equipment-permits/[id]` | DELETE | НЕТ | DELETE:withMutation |
| 119 | `/safety/equipment-permits` | GET/POST | НЕТ | GET:withApi POST:withMutation |
| 120 | `/safety/my-clearance` | GET | НЕТ | GET:withApi |
| 121 | `/settings` | GET/PUT | свой — settings/__tests__/route.test.ts | GET:withApi PUT:withMutation |
| 122 | `/sites/[id]/assign` | POST/DELETE | свой — sites/[id]/assign/__tests__/route.test.ts | POST:withMutation DELETE:withMutation |
| 123 | `/sites/[id]/hierarchy` | POST/DELETE | свой — sites/[id]/hierarchy/__tests__/route.test.ts | POST:withMutation DELETE:withMutation |
| 124 | `/sites/[id]` | GET/PUT/DELETE | НЕТ | GET:withApi PUT:withMutation DELETE:withMutation |
| 125 | `/sites/all` | GET | свой — sites/all/__tests__/route.test.ts | GET:withApi |
| 126 | `/sites/create` | POST | свой — sites/create/__tests__/route.test.ts | POST:withMutation |
| 127 | `/sites` | GET | tests/ — tests/integration/disposable-idor.spec.ts,tests/manual-test-runner-v2.js,tests/manual-test-runner.js | GET:withApi |
| 128 | `/system` | GET | tests/ — tests/chaos/circuit-breaker.test.js | GET:withApi |
| 129 | `/system/status` | GET | tests/ — tests/chaos/circuit-breaker.test.js | GET:withApi |
| 130 | `/telegram/configs` | GET/POST/PUT/DELETE | свой — telegram/configs/__tests__/route.test.ts | GET:withApi POST:withMutation PUT:withMutation DELETE:withMutation |
| 131 | `/telemetry/batch` | POST | функц. — telemetry/__tests__/rate-limit-key.test.ts | POST:withApi |
| 132 | `/telemetry/ingest` | POST/PATCH/GET | функц. — telemetry/__tests__/rate-limit-key.test.ts | POST:withApi PATCH:withApi GET:withApi |
| 133 | `/telemetry` | POST/GET | свой — telemetry/__tests__/rate-limit-key.test.ts | POST:withApi GET:withApi |
| 134 | `/to/journal` | GET | свой — to/journal/__tests__/route.test.ts | GET:withApi |
| 135 | `/user-document-types/[id]` | PATCH/DELETE | НЕТ | PATCH:withMutation DELETE:withMutation |
| 136 | `/user-document-types` | GET/POST | НЕТ | GET:withApi POST:withMutation |
| 137 | `/user-documents/control` | GET | НЕТ | GET:withApi |
| 138 | `/users/[id]/documents/[docId]` | PUT/DELETE | НЕТ | PUT:withMutation DELETE:withMutation |
| 139 | `/users/[id]/documents` | GET/POST | НЕТ | GET:withApi POST:withMutation |
| 140 | `/users` | GET/POST/PUT/DELETE | свой — users/__tests__/route.test.ts | GET:withApi POST:withMutation PUT:withMutation DELETE:withMutation |
| 141 | `/weather` | GET | свой — weather/__tests__/route.test.ts | GET:withApi |

Примечание к таблице: у `/feedback/events` метод PATCH — псевдоним POST (`src/app/api/feedback/events/route.ts:196`), скрипт помечает его как MANUAL, фактически защита та же (`withMutation`).

### Топ-20 изменяющих маршрутов без теста

Отбор: методы POST/PUT/PATCH/DELETE, нет собственного теста рядом и нет функционального теста чужого файла (то есть `НЕТ`, `tests/` или `e2e`). Ранжирование — по последствиям ошибки (допуск людей и техники → необратимое удаление → запись производственных данных → настройки).

| # | Маршрут | Метод | Что именно не проверено |
|---|---|---|---|
| 1 | `/readiness/shifts/[id]/start` | POST | запуск смены — допуск техники к работе |
| 2 | `/readiness/work-permits/[id]/approve` | POST | согласование наряда |
| 3 | `/readiness/work-permits/[id]/revoke` | POST | отзыв наряда |
| 4 | `/readiness/shifts/[id]/handover` | POST | передача смены |
| 5 | `/readiness/handovers/[id]/accept` | POST | приёмка передачи смены |
| 6 | `/readiness/handovers/[id]/rework` | POST | возврат передачи на доработку |
| 7 | `/readiness/shifts/[id]/waiver` | POST | отказ от требования готовности |
| 8 | `/readiness/defects/[id]/triage` | POST | разбор дефекта (блокирует допуск или нет) |
| 9 | `/readiness/defects/[id]/resolve` | POST | закрытие дефекта (снятие блокировки) |
| 10 | `/readiness/defects/[id]/reject` | POST | отклонение дефекта |
| 11 | `/readiness/access-matrix` | PUT/POST | правка матрицы доступа контура TO |
| 12 | `/readiness/shifts/[id]/cancel` | POST | отмена смены |
| 13 | `/readiness/shifts/[id]/decline` | POST | отклонение смены |
| 14 | `/readiness/work-permits/[id]/submit` | POST | отправка наряда на согласование |
| 15 | `/readiness/place-presets` | POST/DELETE | справочник мест |
| 16 | `/sites/[id]` | PUT/DELETE | правка и необратимое удаление участка |
| 17 | `/safety/equipment-permits/[id]` | DELETE | удаление допуска на оборудование |
| 18 | `/safety/equipment-permits` | POST | создание допуска на оборудование |
| 19 | `/users/[id]/documents/[docId]` | PUT/DELETE | правка и удаление документа сотрудника |
| 20 | `/layout/[surfaceId]` | PUT/DELETE | сохранение и сброс раскладки |

Полный перечень остальных изменяющих маршрутов без теста (после топ-20):

| # | path | Методы | Тип покрытия |
|---|---|---|---|
| 1 | `src/app/api/admin/analytics/overview/route.ts` | GET | НЕТ |
| 2 | `src/app/api/assistant/state/route.ts` | GET | НЕТ |
| 3 | `src/app/api/briefings/journal/route.ts` | GET | НЕТ |
| 4 | `src/app/api/equipment/[id]/details/route.ts` | GET | НЕТ |
| 5 | `src/app/api/maintenance/[id]/route.ts` | GET | НЕТ |
| 6 | `src/app/api/maintenance/assignees/route.ts` | GET | НЕТ |
| 7 | `src/app/api/media/[id]/download/route.ts` | GET | НЕТ |
| 8 | `src/app/api/media/download-batch/route.ts` | GET | НЕТ |
| 9 | `src/app/api/monitoring/fleet/route.ts` | GET | НЕТ |
| 10 | `src/app/api/operator/mobile/state/route.ts` | GET | НЕТ |
| 11 | `src/app/api/operator/shift/route.ts` | GET | НЕТ |
| 12 | `src/app/api/readiness/audit/route.ts` | GET | НЕТ |
| 13 | `src/app/api/readiness/history/route.ts` | GET | НЕТ |
| 14 | `src/app/api/readiness/permit-form-options/route.ts` | GET | НЕТ |
| 15 | `src/app/api/reports/recent/route.ts` | GET | НЕТ |
| 16 | `src/app/api/safety/clearance/route.ts` | GET | НЕТ |
| 17 | `src/app/api/safety/my-clearance/route.ts` | GET | НЕТ |
| 18 | `src/app/api/user-documents/control/route.ts` | GET | НЕТ |
| 19 | `src/app/api/user-document-types/route.ts` | GET/POST | НЕТ |
| 20 | `src/app/api/users/[id]/documents/route.ts` | GET/POST | НЕТ |
| 21 | `src/app/api/media/[id]/confirm/route.ts` | POST | НЕТ |
| 22 | `src/app/api/maintenance-plans/run/route.ts` | POST | НЕТ |
| 23 | `src/app/api/monitoring/template/route.ts` | GET/PUT | НЕТ |
| 24 | `src/app/api/orion/lead/route.ts` | POST | НЕТ (заморожено) |
| 25 | `src/app/api/reports/admin-upsert/route.ts` | POST | tests/ — только ручные раннеры |
| 26 | `src/app/api/crews/route.ts` | GET/POST | tests/chaos (не запускается) + tests/integration (гейт) |
| 27 | `src/app/api/media/route.ts` | POST/GET | tests/integration (гейт) |
| 28 | `src/app/api/reports/upsert/route.ts` | POST | tests/integration (гейт) + ручные раннеры |
| 29 | `src/app/api/readiness/defects/route.ts` | POST/GET | tests/integration (гейт) |
| 30 | `src/app/api/readiness/work-permits/route.ts` | POST/GET | tests/contract (describe.skip) + tests/integration (гейт) |
| 31 | `src/app/api/assistant/command/route.ts` | POST | e2e (мок ответа) |

## Не проверено

- Не запускался сценарий ни по одному маршруту: аудит отвечает на вопрос «есть ли тест», а не «верно ли работает код». Все выводы о смысле маршрутов помечены ГИПОТЕЗА.
- Не проверено поведение под живой БД: `tests/integration/**` гейтятся переменными окружения (`INTEGRATION_DATABASE_URL_OWNER`, `CODEX_STAND_URL`), локально пропускаются; я их не поднимал.
- `npm run test:unit` целиком не запускался (только `src/app/api`, 512 тестов, exit 0). Общее число пропущенных по репозиторию не измерено.
- Не проверялось, покрывают ли e2e-спеки серверный код или только подменяют ответы: в `e2e/role-audit.spec.js:77` видно `page.route(...)` — это мок, а не проход по маршруту. Массово я это не разбирал, поэтому колонка `e2e` — самое слабое из «покрытий».
- Не измерена фактическая строка-покрытие (`vitest run --coverage` не запускался) — «нет теста рядом» не равно «код не исполнялся в чужом тесте через сервисный слой».
- Замороженные зоны (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*`, `src/modules/operator-mobile/**`, ORION и `src/app/api/orion/**`) разбирались только на предмет факта наличия теста, без оценки логики.
- Не проверено, срабатывает ли `describe.skipIf` в CI: конфигурация CI не читалась (вне задачи).

## Приложение: 45 маршрутов без единого упоминания в тестах (`path:line` — объявление обработчика)

| # | path:line | Методы |
|---|---|---|
| 1 | `src/app/api/admin/analytics/overview/route.ts` | GET | 152:GET |
| 2 | `src/app/api/assistant/state/route.ts` | GET | 16:GET |
| 3 | `src/app/api/briefings/journal/route.ts` | GET | 27:GET |
| 4 | `src/app/api/equipment/[id]/details/route.ts` | GET | 20:GET |
| 5 | `src/app/api/layout/[surfaceId]/route.ts` | GET/PUT/DELETE | 31:GET, 50:PUT, 76:DELETE |
| 6 | `src/app/api/maintenance-plans/run/route.ts` | POST | 13:POST |
| 7 | `src/app/api/maintenance/[id]/route.ts` | GET | 11:GET |
| 8 | `src/app/api/maintenance/assignees/route.ts` | GET | 10:GET |
| 9 | `src/app/api/media/[id]/confirm/route.ts` | POST | 8:POST |
| 10 | `src/app/api/media/[id]/download/route.ts` | GET | 9:GET |
| 11 | `src/app/api/media/download-batch/route.ts` | GET | 31:GET |
| 12 | `src/app/api/monitoring/fleet/route.ts` | GET | 21:GET |
| 13 | `src/app/api/monitoring/template/route.ts` | GET/PUT | 17:GET, 25:PUT |
| 14 | `src/app/api/operator/mobile/state/route.ts` | GET | 16:GET |
| 15 | `src/app/api/operator/shift/route.ts` | GET | 15:GET |
| 16 | `src/app/api/orion/lead/route.ts` | POST | 55:POST |
| 17 | `src/app/api/readiness/access-matrix/route.ts` | PUT/POST/GET | 31:PUT, 45:POST, 55:GET |
| 18 | `src/app/api/readiness/audit/route.ts` | GET | 54:GET |
| 19 | `src/app/api/readiness/defects/[id]/reject/route.ts` | POST | 11:POST |
| 20 | `src/app/api/readiness/defects/[id]/resolve/route.ts` | POST | 11:POST |
| 21 | `src/app/api/readiness/defects/[id]/triage/route.ts` | POST | 11:POST |
| 22 | `src/app/api/readiness/handovers/[id]/accept/route.ts` | POST | 10:POST |
| 23 | `src/app/api/readiness/handovers/[id]/rework/route.ts` | POST | 9:POST |
| 24 | `src/app/api/readiness/history/route.ts` | GET | 74:GET |
| 25 | `src/app/api/readiness/permit-form-options/route.ts` | GET | 83:GET |
| 26 | `src/app/api/readiness/place-presets/route.ts` | POST/DELETE | 32:POST, 91:DELETE |
| 27 | `src/app/api/readiness/shifts/[id]/cancel/route.ts` | POST | 11:POST |
| 28 | `src/app/api/readiness/shifts/[id]/decline/route.ts` | POST | 12:POST |
| 29 | `src/app/api/readiness/shifts/[id]/handover/route.ts` | POST | 11:POST |
| 30 | `src/app/api/readiness/shifts/[id]/start/route.ts` | POST | 12:POST |
| 31 | `src/app/api/readiness/shifts/[id]/waiver/route.ts` | POST | 15:POST |
| 32 | `src/app/api/readiness/work-permits/[id]/approve/route.ts` | POST | 11:POST |
| 33 | `src/app/api/readiness/work-permits/[id]/revoke/route.ts` | POST | 11:POST |
| 34 | `src/app/api/readiness/work-permits/[id]/submit/route.ts` | POST | 11:POST |
| 35 | `src/app/api/reports/recent/route.ts` | GET | 16:GET |
| 36 | `src/app/api/safety/clearance/route.ts` | GET | 19:GET |
| 37 | `src/app/api/safety/equipment-permits/[id]/route.ts` | DELETE | 13:DELETE |
| 38 | `src/app/api/safety/equipment-permits/route.ts` | GET/POST | 31:GET, 64:POST |
| 39 | `src/app/api/safety/my-clearance/route.ts` | GET | 18:GET |
| 40 | `src/app/api/sites/[id]/route.ts` | GET/PUT/DELETE | 15:GET, 31:PUT, 108:DELETE |
| 41 | `src/app/api/user-document-types/[id]/route.ts` | PATCH/DELETE | 14:PATCH, 37:DELETE |
| 42 | `src/app/api/user-document-types/route.ts` | GET/POST | 16:GET, 41:POST |
| 43 | `src/app/api/user-documents/control/route.ts` | GET | 15:GET |
| 44 | `src/app/api/users/[id]/documents/[docId]/route.ts` | PUT/DELETE | 27:PUT, 56:DELETE |
| 45 | `src/app/api/users/[id]/documents/route.ts` | GET/POST | 34:GET, 55:POST |
