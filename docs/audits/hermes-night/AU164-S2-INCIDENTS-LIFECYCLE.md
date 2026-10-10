# AU164-S2-INCIDENTS-LIFECYCLE: Происшествия — цикл от записи до закрытия

Версия кода: `git rev-parse HEAD` = `a4b0eb57404d2a3449e950daab08b379785deab0`
Ветка: `hermes/q4-0926`. Только чтение; существующие отчёты `docs/audits/` не открывались.

## Резюме для владельца (5 строк)

1. Записать происшествие может только роль «Машинист» с телефона: у конторы
   (диспетчер, админ, инженер ОТ, мастер) нет ни экрана, ни API для создания —
   только для просмотра и разбора.
2. Оператор видит, что происшествие «разобрали», но НЕ видит вывод разбора:
   в мобильный запрос не берётся `reviewNote`, а на экране стоит одна надпись.
3. Фотографии при происшествии собираются, но посмотреть их при разборе нельзя:
   список отдаёт только число снимков, доказательство не открывается.
4. У происшествия нет работающей связи с дефектом: поле `relatedDefectId` есть в
   схеме и имеет индекс, но ни одна строка кода его не пишет и не читает.
5. Пересчёт готовности по происшествию заказывается, но формула оценки
   происшествия не учитывает — событие создаётся «вхолостую».

## Итог

- Всего находок: **21**. По тяжести: **критично — 0**, **важно — 8**,
  **мелочь — 13**.
- Цикл проходит в целом правильно: запись с идемпотентностью по
  `clientCommandId`, отдельный признак «разобрано» (`reviewedAt`), разбор с
  обязательным выводом, права `incidents.read` / `incidents.review`, повторный
  разбор отклоняется (409), блокировка выработки при `stopRequired` снимается
  только разбором.
- Пять самых важных пунктов: №1 (создание только машинистом), №2 (оператор не
  видит вывод разбора), №3 (снимки не открыть при разборе), №4 (связь с дефектом
  не реализована), №5 (пересчёт готовности по происшествию не влияет на оценку).

## Методика

- `git rev-parse HEAD`, `git status`, `ls docs/audits/` — версия и запретные пути.
- Чтение AGENTS.md (модель доверия, «выглядит мёртвым, но нужно»).
- `search_files` (files/content) по `src/`: `Incident`, `Происшеств`, `incident`,
  `relatedDefectId`, `emergencyStopApplied`, `SAFETY_INCIDENT_REPORTED`,
  `STOP_REQUIRED`, `incidentsRead`, `productionBlocks`, `STOP_INCIDENT`.
- Полностью прочитаны (полные пути от корня):
  - `src/modules/operator-mobile/domain/incidents.ts`
  - `src/modules/operator-mobile/domain/hazard-classification.ts`
  - `src/modules/operator-mobile/domain/production-permit.ts`
  - `src/modules/operator-mobile/domain/view-contracts.ts` (начало)
  - `src/modules/operator-mobile/application/commands/incidents.ts`
  - `src/modules/operator-mobile/application/commands/shared.ts`
  - `src/modules/operator-mobile/application/mobile-shift-query.ts:455-509`
  - `src/app/api/admin/incidents/route.ts`
  - `src/app/api/operator/mobile/command/route.ts:145-259`
  - `src/components/piling/admin-incidents/admin-incidents.tsx`
  - `src/components/piling/operator-mobile/screens/incidents-tab.tsx`
  - `src/components/piling/operator-mobile/offline-queue.ts:40-99`
  - `src/modules/safety/application/clearance-overview-query.ts:198-312` (выборки счётчиков)
  - `src/components/piling/to/readiness/screens/safety-overview-screen.tsx`
  - `src/components/piling/to/readiness/module-tab-list.tsx`,
    `src/components/piling/to/to-module.tsx`
  - `src/services/notifications/durable-alert-delivery.ts`,
    `src/core/notifications/durable-alert.ts`, `src/core/notifications/telegram.ts:331-343`
  - `src/services/auth/authorization-service.ts:110-160`
  - `src/modules/readiness/application/bootstrap-query.ts:58-66,230-241`,
    `src/app/api/readiness/bootstrap/route.ts:47-53`,
    `src/modules/readiness/application/projection/request-snapshot.ts`,
    `src/modules/readiness/application/projection/project-event.ts`,
    `src/modules/readiness/application/readiness-score.ts:18-69`
  - `prisma/schema.prisma:1296-1339`
  - тесты: `admin-incidents.test.tsx`, `incidents-tab.test.tsx`,
    `mutation-audit.test.ts`, `operator-mobile-rules.test.ts`,
    `downtime-hours.test.ts`, `hazard-classification.test.ts`
- Перепроверка «нет ссылок в коде» через `grep -rln` по `--include=*.test.*`.
- Динамика не запускалась: сервер не поднимался, браузер/Playwright недоступны,
  тесты не прогонялись (правок нет, задача read-only). Все выводы — из чтения
  кода и разметки.

## Карта цикла: шаг | роль | файл:строка | тест

| # | Шаг | Роль | Файл:строка | Тест |
|---|---|---|---|---|
| 1 | Запись происшествия (создание) | OPERATOR (только) | `src/app/api/operator/mobile/command/route.ts:192-194`, `src/modules/operator-mobile/application/commands/incidents.ts:30-135` | НЕТ прямого теста команды; форма — `src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx` |
| 2 | Валидация черновика (10–4000 знаков, ≥1 признак) | — | `src/modules/operator-mobile/domain/incidents.ts:106-123`, `:95-96` | `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:411-423` |
| 3 | Классификация опасности (уровень, stopRequired) | — | `src/modules/operator-mobile/domain/hazard-classification.ts:76-98` | `src/modules/operator-mobile/domain/__tests__/hazard-classification.test.ts` |
| 4 | Создание записи в БД + состояние | система | `src/modules/operator-mobile/application/commands/incidents.ts:79-104` | НЕТ |
| 5 | Уведомление в Telegram | получатели — чаты организации | `src/modules/operator-mobile/application/commands/incidents.ts:119-128`, `src/services/notifications/durable-alert-delivery.ts:16-19,29-34` | `src/services/notifications/__tests__/durable-alert-delivery.test.ts` |
| 6 | Заказ пересчёта готовности | система | `src/modules/operator-mobile/application/commands/incidents.ts:108-117` | НЕТ |
| 7 | Просмотр списка (по умолчанию — неразобранные) | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | `src/app/api/admin/incidents/route.ts:26-94`; права — `src/services/auth/authorization-service.ts:112` | сервер — НЕТ; клиент — `src/components/piling/admin-incidents/__tests__/admin-incidents.test.tsx` |
| 8 | Разбор (закрытие выводом) | ADMIN, DISPATCHER, SAFETY_ENGINEER | `src/app/api/admin/incidents/route.ts:103-138`; права — `src/services/auth/authorization-service.ts:113` | `src/app/api/__tests__/mutation-audit.test.ts:79,144-148` |
| 9 | Отображение у оператора (журнал смены) | OPERATOR | `src/modules/operator-mobile/application/mobile-shift-query.ts:467-498`, `src/components/piling/operator-mobile/screens/incidents-tab.tsx` | `src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx` |
| 10 | Блокировка выработки при `stopRequired` (снятие — только разбором) | OPERATOR | `src/modules/operator-mobile/application/commands/shared.ts:271-277`, `src/modules/operator-mobile/domain/production-permit.ts:115-123` | НЕТ (см. №8 важно) |
| 11 | Старый адрес `/admin/incidents` | все с `incidents.read` | `src/app/(app)/admin/incidents/page.tsx:12` (редирект), `src/app/(app)/admin/incidents/layout.tsx:4` (гейт) | `src/lib/__tests__/page-ability-layouts.test.ts:69` |

## Находки

| # | Severity | path:line | Проблема | Сценарий / чем важно | Как чинить |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/operator/mobile/command/route.ts:192-194` | Создать происшествие может только `user.role === 'OPERATOR'`; проверка идёт по «сырой» роли, без `resolveEffectiveRole`, а экрана создания в конторе нет. | Событие зафиксировал мастер/инженер ОТ/диспетчер или админ в режиме «Действую как машинист» — запись завести некому: мобильный путь даёт 403, консольного пути нет вовсе. | Либо добавить создание происшествия в консольный экран (`AdminIncidents`) и API, либо пускать в мобильную команду по исполняемой роли (`resolveEffectiveRole(user.role, user.actingAs) === 'OPERATOR'`). |
| 2 | важно | `src/modules/operator-mobile/application/mobile-shift-query.ts:470-474`, `src/components/piling/operator-mobile/screens/incidents-tab.tsx:140-142` | Оператору не отдаётся вывод разбора: в `select` нет `reviewNote`/`reviewedById`, на экране — фиксированное «Разобрано диспетчером». | Машинист, который завёл происшествие, узнаёт только факт «разобрано», но не то, к чему пришли и что поменяли. Комментарий в `incidents-tab.tsx:110-112` обещает «машинист должен видеть… по ней ответили», фактически ответа нет. | Добавить `reviewNote` в `select` мобильного запроса и показать вывод в карточке. |
| 3 | важно | `src/app/api/admin/incidents/route.ts:43-48,85`, `src/components/piling/admin-incidents/admin-incidents.tsx:275-277` | Снимки не открываются при разборе: `evidenceMediaIds` выбирается, но наружу отдаётся только их число (`photos: length`). | Разбор происшествия без возможности посмотреть фотографию доказательства — «разбор на словах»; снимок собирался ради этого. | Отдавать идентификаторы снимков (или ссылки) и показывать их в карточке разбора. |
| 4 | важно | `src/services/notifications/durable-alert-delivery.ts:16-19,32-33`, `src/modules/settings/domain/settings.ts:58` | Тумблер «Мелкие происшествия на площадке» глушит не только мелкое: у `HIGH` (утечка, запах) и `NORMAL` один `ruleId: 'incident'` → ключ `incidents`; без выключателя только `stopRequired` (критично). | Админ выключает «мелкие происшествия» — перестают приходить сообщения об утечке/запахе (`HIGH`), хотя в подписи обещано «мелкие». Слово расходится с делом. | Разделить ключи: серьёзные (`HIGH`) не глушить, либо переименовать выключатель в соответствии с фактическим охватом. |
| 5 | важно | `prisma/schema.prisma:1304,1337` | Связь с дефектом не реализована: поле `relatedDefectId` и индекс `[tenantId, relatedDefectId]` существуют, но ни одна строка `src/` их не пишет и не читает (поиск по `src` — 0 совпадений вне схемы/миграции). | Происшествие категории `EQUIPMENT_DEFECT` («Дефект установки») — только метка: реальный `EquipmentDefect` не создаётся и не связан. Нельзя увидеть, чем происшествие обернулось в журнале ремонтов. | Либо заполнять `relatedDefectId` при записи/связывании, либо удалить поле и индекс (после доказательства неиспользования). |
| 6 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:42,99` | `occurredAt` = время приёма на сервере (`now = new Date()`), а не время события; команда `report-incident` — отложенная (`offline-queue.ts:67-69`). | Происшествие, записанное без связи, получает время доставки — иногда на часы позже. Сбивается порядок списка (`occurredAt desc`), суточная привязка и счётчик «за месяц». | Принимать клиентское время события (с разумной границей) либо хранить отдельно «произошло» и «получено» (поле `receivedAt` уже есть). |
| 7 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:108-117` | Пересчёт готовности по происшествию заказывается, но формула оценки происшествия не читает: `evaluateAuthoritativeReadiness` берёт оборудование, осмотр, наряд ТО, наряд-допуск (`src/modules/readiness/application/readiness-score.ts:34-69`) — `SafetyIncident` не участвует. | Комментарий `incidents.ts:106-107` обещает «центр готовности должен узнать о нём без ручного обновления», фактически на каждое происшествие создаётся лишнее неизменяемое событие и снимок без изменения оценки (dedupe-ключ содержит уникальный `incident.id`, поэтому строки добавляются). | Либо учесть происшествия в формуле, либо не заказывать пересчёт с несуществующим входом. |
| 8 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:30-135`; `src/modules/operator-mobile/domain/production-permit.ts:115-123` | Нет ни одного теста на серверную команду `reportIncident` (в `src/modules/operator-mobile/application/commands/__tests__/` файла нет; `downtime-hours.test.ts:22` мокает её заглушкой) и на блокировку `STOP_INCIDENT` (`grep` по `--include=*.test.*` — 0 совпадений). | Непокрытыми остаются: идемпотентность по `clientCommandId`, установка `stopRequired`, постановка алерта, заказ снимка, снятие запрета разбором. Регрессия в этих местах не будет поймана. | Добавить серверный тест команды и тест `productionBlocks` для кода `STOP_INCIDENT`. |
| 9 | мелочь | `src/app/api/admin/incidents/route.ts:24,42` | `take: 100` без курсора/признака обрыва. | Больше 100 происшествий в тенанте — список молча усечён, пользователь не узнает, что есть ещё. | Курсор/`hasMore`, либо явное «показаны последние 100». |
| 10 | мелочь | `src/app/api/admin/incidents/route.ts:34` | Параметр `scope` не валидируется: любое значение, отличное от `'open'`, означает «все». | Не ошибка данных, но `?scope=мусор` ведёт себя как `all` — неочевидно. | `z.enum(['open','all'])` со значением по умолчанию. |
| 11 | мелочь | `prisma/schema.prisma:1311,1313,1317-1319` | Мёртвые легаси-поля: `emergencyStopApplied`, `safeStateDescription`, `stoppedAt`, `stoppedById`, `resumeSnapshotId` — не пишутся ни одной строкой `src/`. | Схема описывает состояния, которых продукт не создаёт; читатель кода принимает их за рабочие. | Удалить после доказательства неиспользования (вне рамок read-only аудита). |
| 12 | мелочь | `src/modules/operator-mobile/domain/hazard-classification.ts:30,52-53`, `src/modules/operator-mobile/application/commands/incidents.ts:90` | Состояние `STOPPED` недостижимо: пишутся только `REPORTED`/`STOP_REQUIRED`. | Тип `SafetyIncidentState` заявляет три состояния, фактически два — расхождение типа и поведения. | Сузить тип или реализовать переход, если он задуман. |
| 13 | мелочь | `src/components/piling/operator-mobile/screens/incidents-tab.tsx:141` | «Разобрано диспетчером» — жёсткая строка, хотя разбор разрешён ещё администратору и инженеру ОТ (`authorization-service.ts:113`). | Оператор получает неверное представление о том, кто разобрал. | Показывать автора разбора или нейтральное «Разобрано». |
| 14 | мелочь | `src/services/notifications/durable-alert-delivery.ts:32` | Ветка обратной совместимости `alert.ruleId === 'incident' && severity === 'critical'` недостижима: критично теперь всегда уходит с `ruleId: 'incidentStopWork'` (`incidents.ts:126`). | Мёртвый код, читается как действующее правило. | Удалить ветку (после проверки старых записей в очереди). |
| 15 | мелочь | `src/components/piling/admin-incidents/__tests__/admin-incidents.test.tsx:26`, `src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx:52` | Фикстуры не соответствуют словарям: категория `NEAR_MISS` отсутствует в `INCIDENT_CATEGORIES`, состояние `'OPEN'` — не из `SafetyIncidentState`. | Тесты «зеленеют» на данных, которых сервер не отдаёт; они не сторожат реальные словари. | Заменить на `PEOPLE`/`REPORTED` (или взятые из словаря значения). |
| 16 | мелочь | `src/modules/operator-mobile/application/commands/incidents.ts:123,127` | Алерт несёт полное описание (до 4000 знаков) без объекта, установки и категории. | В Telegram приходит длинный текст без ориентира «где и на какой машине»; по описанию не всегда понятно место. | Добавить объект/установку/категорию в сообщение, ограничить длину. |
| 17 | мелочь | `src/app/api/admin/incidents/route.ts:131-135` | После разбора нет уведомления автору записи — только audit-событие. | Машинист узнаёт о разборе, лишь открыв экран смены; при закрытой смене — может не узнать. | Уведомлять автора (в пределах действующих каналов). |
| 18 | мелочь | `src/core/notifications/telegram.ts:337-343` | Уведомление идёт во все настроенные чаты организации, а не персонально диспетчеру, хотя комментарии (`incidents.ts:22`, `incidents-tab.tsx:25-26`) обещают «предупреждение диспетчеру». | Адресат в тексте кода и в реальности расходятся. | Уточнить формулировку или реализовать адресную доставку. (ГИПОТЕЗА о замысле.) |
| 19 | мелочь | `src/modules/operator-mobile/application/commands/incidents.ts:90`, `src/app/api/admin/incidents/route.ts:119-126` | `state` при разборе не меняется: остаётся `STOP_REQUIRED`/`REPORTED`, закрытие фиксируется только `reviewedAt`. | Не баг (разбор — отдельная ось, обосновано в `incidents.ts:81-90`), но `state` в БД и в API-ответе читается как «состояние работы» и после разбора вводит в заблуждение. | Документировать или не отдавать `state` наружу как статус происшествия. |
| 20 | мелочь | `src/components/piling/to/to-module.tsx:380-387`, `src/components/piling/to/readiness/module-tab-list.tsx:45-62` | Мастер (`incidents.read` есть, `users.documents.read_all` нет) без `?view=` попадает не на «Происшествия», а на первую разрешённую вкладку — «Мой допуск». | Право на происшествия есть, но «дорога» по умолчанию ведёт в другое место; пункт вкладки доступен. Поведение обосновано, но неочевидно. | Оставить как есть либо уточнить порядок вкладок/подстановку. |
| 21 | мелочь | `src/modules/readiness/application/projection/request-snapshot.ts:40-56`, `src/modules/readiness/application/projection/project-event.ts:55-64` | На каждое происшествие создаётся отдельное событие и (через воркер) неизменяемый снимок готовности, поскольку dedupe-ключ содержит уникальный `incident.id`. | Следствие №7: мусорные неизменяемые строки `ReadinessScoreSnapshot` без информационной ценности. | Не заказывать снимок, если вход в формулу не меняется. |

## Не проверено

- **Динамика.** Сервер не поднимался, БД не читалась, тесты и Playwright не
  запускались (правок нет, задача read-only). Числа «сколько строк» — только из
  кода, не из прогона.
- **Уведомления о разборе в канале.** Не проверено, приходит ли что-либо автору
  происшествия от системы уведомлений (кроме audit-события); №17 — вывод из
  отсутствия вызова в маршруте разбора, не из наблюдения.
- **Права на уровне БД/RLS.** Не проверялось, что политика RLS для
  `SafetyIncident` соответствует фильтру `tenantId` в запросах.
- **Кросс-тенантность.** По модели доверия (AGENTS.md) `ADMIN`/`DISPATCHER`
  видят все тенанты по решению владельца; отдельно не проверялось, есть ли утечка
  внутри одного тенанта.
- **«Действую как» на мобильном экране.** Не устанавливал, пользуется ли
  администратор в режиме «Действую как машинист» тем же мобильным приложением;
  №1 утверждает только буквальную проверку `user.role` в маршруте.
- **Существующие отчёты.** `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не
  открывались; совпадение выводов с прежними аудитами не сверялось.
- **Внешние каналы и prod.** Не проверялись Telegram-доставка в живом канале,
  настройки тенанта и прод-данные.

## Приложение: пути, просмотренные и признанные достаточными

- Заморозка (`AGENTS.md`): варианты экрана оператора (`src/components/piling/operator*/**`),
  ORION (`src/app/orion/**`) — не открывались, не проверялись.
- Роут `/admin/incidents` (страница-редирект + layout-гейт) — оставлен намеренно
  (комментарий `page.tsx:3-9`), не находка.
