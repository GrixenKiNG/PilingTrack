# AU51-S2-INCIDENTS-LIFECYCLE — Происшествия: жизненный цикл, кто видит, уведомления

Версия кода: `git rev-parse HEAD` → `ba32945c0395753c676025909507b159b79182ca` (branch `hermes/q4-0926`).
Тип задачи: независимый аудит, только чтение. Код приложения не менялся.

## Итог

Всего находок: 16 (критично — 0, важно — 5, мелочь — 11). Сущность жива: происшествие
заводит машинист с телефона, оно показывается экипажу и диспетчеру, запрещает выработку
и разбирается отдельным выводом.

1. **важно** — модель `RepairVerification` (таблица + RLS) существует, но на неё нет ни
   одной ссылки в коде приложения — ни читателя, ни писателя.
2. **важно** — лестница состояний происшествия не реализована: `state` пишется один раз
   при создании (`REPORTED`/`STOP_REQUIRED`), а `STOPPED`, `RESUMED`,
   `emergencyStopApplied`, `stoppedAt`, `stoppedById`, `resumeSnapshotId`,
   `safeStateDescription` не записываются нигде.
3. **важно** — разбор происшествия не влияет на готовность: снимок заказывается
   (`incidents.ts:108`), но формула готовности происшествий не читает вообще.
4. **важно** — у команды создания происшествия `reportIncident` нет ни одного теста.
5. **важно** — ветка запрета выработки `STOP_INCIDENT` не покрыта тестами: в тестах
   `safetyIncident.findMany` всегда возвращает пустой список.

Статусы ниже: ПРОЙДЕНО — проверено по коду/командам; НЕ ПРОВЕРЕНО — не удалось
подтвердить; ГИПОТЕЗА — вывод из прочитанного кода без прогона.

## Методика

Что искал и как (повторяемо):

- Термины сущности: `grep -rn "Incident|происшеств|Инцидент"` — выяснил, что сущность
  называется `SafetyIncident` («safety incident»).
- Файлы сущности: поиск по `*incident*` в `src/` (6 файлов) и по
  `SafetyIncident|safetyIncident` по всему репозиторию.
- Схема: `prisma/schema.prisma` (модель `SafetyIncident` — строки 1298–1339;
  `RepairVerification` — 1341–1366). Миграции:
  `20260826110000_operator_v3_safety_incident`, `20260826130000_operator_v3_repair_verification`,
  `20260902000000_safety_incident_review`, `20260903000000_rls_remaining_tables`.
- Создание: `src/modules/operator-mobile/application/commands/incidents.ts`,
  маршрут `src/app/api/operator/mobile/command/route.ts`.
- Разбор: `src/app/api/admin/incidents/route.ts`,
  `src/components/piling/admin-incidents/admin-incidents.tsx`.
- Показ: `src/modules/operator-mobile/application/mobile-shift-query.ts`,
  `src/components/piling/operator-mobile/screens/incidents-tab.tsx`.
- Влияние: `src/modules/operator-mobile/application/commands/shared.ts`
  (`requireProductionPermit`), `src/modules/operator-mobile/domain/production-permit.ts`,
  `src/modules/operator-mobile/domain/work-warnings.ts`.
- Уведомления: `src/core/notifications/durable-alert.ts`,
  `src/services/notifications/durable-alert-delivery.ts`, `src/modules/settings/domain/settings.ts`.
- Кто видит: `src/services/auth/authorization-service.ts`,
  `src/modules/readiness/domain/capability-defaults.ts`,
  `src/modules/readiness/application/bootstrap-query.ts`,
  `src/app/api/readiness/bootstrap/route.ts`.
- Тесты: перечисление `*incident*` в `src/`, `grep "reportIncident|STOP_INCIDENT|
  STOP_REQUIRED|STOPPED"` по тестам, `grep -rln incident e2e tests`.

Замечание о независимости: отчёты в `docs/audits/` (кроме этого файла) и `CODEX-REPORT*`
не открывались; имена файлов известны только из листинга.

## Как устроено происшествие (по коду)

**Определение.** Происшествие — «процесс безопасности», отдельный от дефекта установки:
«Это не дефект установки: событие может относиться к человеку, рабочей зоне или
организации работ» (`prisma/schema.prisma:1296`). Явное разведение с дефектом —
`src/modules/operator-mobile/domain/incidents.ts:10-17`.

**Создание оператором.** Единственный путь записи —
`POST /api/operator/mobile/command` с `command: 'report-incident'`
(`src/app/api/operator/mobile/command/route.ts:148-160`). Маршрут требует роль
`OPERATOR` (`route.ts:192`), схема принимает `category`, `signs` (1–9),
`injured`, `description` (1–4000), `mediaIds` (до 10). Дальше —
`reportIncident` (`src/modules/operator-mobile/application/commands/incidents.ts:30`):

- валидация `validateIncident` (`domain/incidents.ts:106`) — категория, ≥1 признак,
  описание 10–4000 знаков;
- классификация `classifyObservedHazard` (`domain/hazard-classification.ts:76`):
  пострадавший или «критический» признак → `CRITICAL` + `stopRequired`,
  LEAK/ODOR → `HIGH`, иначе `NORMAL`;
- в одной транзакции: `requireOpenShift` + `requireCrew`, дедуп по
  `(tenantId, clientCommandId)`, проверка фото, `safetyIncident.create`,
  заказ снимка готовности и постановка алерта в outbox.

**Поля записи** (заполняются при создании, `incidents.ts:79-104`): `tenantId`,
`shiftId`, `equipmentId`, `siteId`, `category`, `state`, `severity`, `description`,
`observedSigns` (JSON), `stopRequired`, `injured`, `evidenceMediaIds` (JSON),
`classificationRuleId`/`Version`, `occurredAt`, `reportedById`, `clientCommandId`.
Не заполняются: `emergencyStopApplied`, `safeStateDescription`, `stoppedAt`,
`stoppedById`, `resumeSnapshotId`, `reviewedAt`/`reviewedById`/`reviewNote`,
`relatedDefectId`, `deviceId`.

**Фото.** Необязательны (`incidents.ts:26-28`). Телефон грузит снимок с
`entityType: 'safety_incident'` и `entityId = clientCommandId`
(`screens/incidents-tab.tsx:70`); сервер принимает только подтверждённые изображения того
же автора и той же команды (`incidents.ts:141-164`). Если снимок не долетел —
`400` «Снимок не долетел до хранилища» (`incidents.ts:161`).

**Статусы и переходы.**

| Из → В | Действие | Кто | События |
|---|---|---|---|
| — → `state='REPORTED'` | `report-incident`, не критично | OPERATOR | outbox `NotificationDeliveryRequested` (ruleId `incident`), outbox `ReadinessSnapshotRequested` |
| — → `state='STOP_REQUIRED'` | `report-incident`, критично/пострадавший | OPERATOR | outbox `NotificationDeliveryRequested` (ruleId `incidentStopWork`), outbox `ReadinessSnapshotRequested` |
| открыто → открыто (дедуп) | повтор того же `clientCommandId` | OPERATOR | нет (возврат существующего id/severity/stopRequired, `incidents.ts:67-73`) |
| не разобрано → разобрано (`reviewedAt`) | `POST /api/admin/incidents` | ADMIN / DISPATCHER / SAFETY_ENGINEER | audit `incident.reviewed` |
| `STOP_REQUIRED` → запрет выработки | неявно: `requireProductionPermit` читает `reviewedAt:null, stopRequired:true` | сервер | — |
| `STOPPED`, `RESUMED` | **не реализованы** | — | — |

Ключевое различие осей: `state` описывает ход работ, а «открытость» — отдельный признак
«есть ли разбор»: `isIncidentOpen(reviewedAt)` (`domain/incidents.ts:91`). Красное гаснет
по разбору, а не по возобновлению (`mobile-shift-query.ts:496-498`). `state` при этом не
меняется никогда и в интерфейсе не показывается.

**Кто видит и как разбирает.** Разбор — `POST /api/admin/incidents`
(`route.ts:103`), право `incidents.review` у ADMIN, DISPATCHER, SAFETY_ENGINEER
(`authorization-service.ts:113`); чтение `incidents.read` шире — плюс FOREMAN
(`authorization-service.ts:112`). Экран `AdminIncidents` открывается по адресу
`/admin/safety?view=incidents` (старый `/admin/incidents` — редирект,
`src/app/(app)/admin/incidents/page.tsx:12`). Повторный разбор не переписываются
(`updateMany` c `reviewedAt:null`, `route.ts:119-129`; `409` при повторе). Машинист видит
происшествия своей смены, а «разобрано» — зелёной строкой
(`screens/incidents-tab.tsx:140-142`).

**Уведомления.** Алерт кладётся в outbox внутри транзакции
(`core/notifications/durable-alert.ts:9-17`). Доставка — `deliverQueuedAlert`:
правило → ключ настройки `incidents` (`RULE_NOTIFICATION_KEYS`, `durable-alert-delivery.ts:16-19`);
`incidentStopWork` в карте нет намеренно — не выключается
(`durable-alert-delivery.ts:13-14`); старый формат `incident`+`critical` тоже не глушится
(`durable-alert-delivery.ts:32`). Ключ `incidents` есть в каталоге настроек
(`modules/settings/domain/settings.ts:58`).

**Влияние на смену и допуск.** Запрещается только выработка: `productionBlocks` даёт блок
`STOP_INCIDENT` при `stopRequired` (`domain/production-permit.ts:115-123`), проверка —
серверная, перед записью свай/бурения (`shared.ts:247-306`, вызов в
`production.ts:245-246`; простой/дефект/происшествие/отчёт проверку намеренно не проходят,
`production-permit.ts:11-18`). Экипажу показывается предупреждение `OPEN_INCIDENT`
(`domain/work-warnings.ts:167-178`). Приём установки и открытие смены происшествие не
блокирует (`commands/equipment.ts` происшествия не читает). **Ошибка записи:**
некорректные/неполные данные → `400`; чужая смена/роль → `403`; повтор → идемпотентный
возврат. Офлайн команда `report-incident` кладётся в очередь устройства
(`components/piling/operator-mobile/offline-queue.ts:67-69`) и повторяется по
`clientCommandId`.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что делать |
|---|---|---|---|---|---|
| 1 | важно | `prisma/schema.prisma:1341`, `prisma/migrations/20260826130000_operator_v3_repair_verification/migration.sql:1` | Модель `RepairVerification` существует (таблица + RLS), но кода, который её читает или пишет, нет | Поиск `RepairVerification|repairVerification` по всему репо даёт только сам `schema.prisma`, generated-клиент, миграции и docs — ни одного вызова в `src/`. Таблица мёртвая, но участвует в RLS | Решить владельцу: либо будущая сущность «ремонт/верификация после происшествия», либо удалить координированно (не самовольно — см. AGENTS.md §4) |
| 2 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:90` | `state` пишется один раз (`REPORTED`/`STOP_REQUIRED`) и не меняется; `STOPPED`/`RESUMED` и поля `stoppedAt/stoppedById/emergencyStopApplied/resumeSnapshotId/safeStateDescription` не записываются нигде | `grep` по этим именам в `src/` даёт только словарь в `domain/hazard-classification.ts:30,52`. Миграция `20260902000000` в шапке ссылается на `STOPPED`/`RESUMED` — их нет в коде. Пользователь не может «остановить/возобновить» происшествие явно; остановка изображается блоком `STOP_INCIDENT` | Убрать недостижимые значения/поля или реализовать переходы явно — но это решение владельца |
| 3 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:106-117` ↔ `src/modules/readiness/application/readiness-score.ts:88` | Происшествие заказывает пересчёт готовности, но формула готовности происшествия не читает | Комментарий «Готовность пересчитываем: происшествие — такой же факт о машине, как осмотр». В `readiness-score.ts` блокировку даёт только `equipmentDefect.findFirst` — `SafetyIncident` не читается. Снимок пересчитывается в то же значение | Либо убрать заказ снимка, либо учесть происшествие в формуле (продуктовое решение) |
| 4 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:30` | Нет теста на создание происшествия | В `application/commands/__tests__/` нет `incidents.test.ts`; `grep reportIncident` по тестам даёт только stub-мок в `downtime-hours.test.ts:22`. Дедуп, проверка фото, классификация при записи и постановка алерта не проверены тестом | Добавить тест создания (если задача разрешает новый тест-файл) |
| 5 | важно | `src/modules/operator-mobile/application/commands/shared.ts:271-277` | Ветка запрета `STOP_INCIDENT` не покрыта тестами | В `production.test.ts:189` `safetyIncident.findMany` мокается пустым списком; `grep STOP_INCIDENT` по тестам пусто. Запрет выработки из-за происшествия не проверен | Тест на `openIncidents` со `stopRequired:true` → `409` |
| 6 | мелочь | `src/modules/operator-mobile/application/commands/incidents.ts:119-128`, `src/core/notifications/durable-alert.ts:5-7` | Уведомление о происшествии не называет объект/установку | В алерт не кладутся `siteId`/название, а `alertSchema` вообще не имеет `siteName` (хотя `telegram.ts:166-170` её умеет). Диспетчер получает текст происшествия без привязки к площадке | Передать `siteId`/название в алерт, расширить схему |
| 7 | мелочь | `src/app/api/admin/incidents/route.ts:123` | Автор разбора пишется (`reviewedById`), но не читается и не показывается | `SELECT` экрана разбора (`route.ts:43-48`) не включает `reviewedById`; интерфейс `IncidentRow` (`admin-incidents.tsx:27-43`) его не содержит. «Кто разобрал» узнать нельзя | Добавить в select и на экран |
| 8 | мелочь | `src/modules/operator-mobile/domain/view-contracts.ts:125` | Поле `state` не участвует в интерфейсе | `AdminIncidents` и `IncidentsTab` не рисуют `state` (проверил оба файла целиком). Колонка пишется, но пользователю не видна | Либо показывать, либо признать техническим |
| 9 | мелочь | `src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx:52` | Тест-фикстура использует `state:'OPEN'`, которого нет в словаре (`REPORTED/STOP_REQUIRED/STOPPED`) | Тест не поймает расхождение со словарём состояний, т.к. тип `state` в `IncidentView` — просто `string` (`view-contracts.ts:125`) | Сузить тип/поправить фикстуру |
| 10 | мелочь | `e2e/` | Нет e2e-спеки на происшествия | `grep -rln incident e2e tests` пусто. Полный путь «запись → показ → разбор» не проверяется сквозным тестом | Опционально: одна спека сквозного пути |
| 11 | мелочь | `src/app/api/admin/incidents/route.ts:24,42` | Список происшествий не пагинируется, `PAGE_SIZE=100` | При >100 неразобранных старые не попадут на экран разбора вообще (лимит без курсора) | Курсорная или постраничная выдача |
| 12 | ГИПОТЕЗА | `src/modules/operator-mobile/application/commands/shared.ts:271-277` | Запрет выработки смотрит только на происшествия **текущей** смены (`shiftId`) | Происшествие с `stopRequired` прошлой смены не блокирует выработку в новой. Текст рекомендации обещает «запрет снимет тот, кто разберёт», но смена меняет `shiftId` и запрет исчезает сам | Уточнить у владельца: так задумано или нет |
| 13 | мелочь | `prisma/schema.prisma:1298-1339` | У `SafetyIncident` нет связей/FK (`shiftId`, `equipmentId`, `siteId`, `reportedById`, `reviewedById` — «сырые» строки) | Имена людей/техники/объектов API подтягивает вручную (`route.ts:54-69`); при удалении пользователя/техники останется «—». Риск-сообщение, не ошибка | Осознанная дань прежней таблице; зафиксировано |
| 14 | мелочь | `src/modules/operator-mobile/application/mobile-shift-query.ts:475` | Машинист видит максимум 20 происшествий смены | При большем числе старые скрыты (без пометки) | Показать счётчик/пагинацию |
| 15 | мелочь | `src/modules/operator-mobile/application/commands/incidents.ts:160` | Проверка фото `usable.length !== mediaIds.length` | Если в `mediaIds` попадёт дубль, проверка совпадёт, но вернёт меньше уникальных id — вернётся список короче отправленного, без ошибки | Сравнивать уникальные множества |
| 16 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:238` | Вкладка «Происшествия» требует `incidents.read` **и** `readiness.read` | Инженер ОТ и диспетчер имеют `readiness.read` (`capability-defaults.ts:66,129`), мастер тоже (`:122`) — вкладку видят все трое. Ограничение работает, но связь двух систем прав хрупкая (комментарий `:236-238`) | Держать в уме при правке матриц |

Переходы **без теста** (сводка к таблице переходов): создание в любом исходе (нет теста,
находка 4); запрет выработки по `STOP_REQUIRED` (находка 5); сквозной путь
«запись → показ → разбор» (нет e2e, находка 10). Покрыты тестами только:
классификация опасности (`domain/__tests__/hazard-classification.test.ts`), форма/журнал
машиниста (`screens/__tests__/incidents-tab.test.tsx`), экран и запись разбора
(`admin-incidents/__tests__/admin-incidents.test.tsx`), аудит разбора
(`app/api/__tests__/mutation-audit.test.ts:79,144`).

## Не проверено

- **Живая БД/уровень RLS на проде** — не запускались миграции и запросы; RLS-политика
  `tenant_isolation_safety_incident` (`20260903000000_rls_remaining_tables/migration.sql:65`)
  прочитана только как текст. Фактическое состояние политики на сервере — НЕ ПРОВЕРЕНО
  (нет доступа к прод-БД, запрещено).
- **`RepairVerification` в проде** — есть ли в таблице строки, не проверял (нет БД).
- **Доставка Telegram** — реальная отправка алерта о происшествии не прогонялась; вывод
  основан на чтении кода и юнит-тестов доставки.
- **E2E/Playwright** — не запускал; утверждение «нет спеки происшествий» основано на
  `grep -rln incident e2e tests` (пусто).
- **`npm run test:unit` / `tsc` / `build`** — по задаче (только чтение, аудит) прогоны не
  требовались и не выполнялись; числа тестов не снимались.
- **Связь двух систем прав** (`authorization-service` vs матрица готовности) — проверена
  только по коду, не на живом входе под каждой ролью.
