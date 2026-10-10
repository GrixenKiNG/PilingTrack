# AU171-S2-OPERATOR-ASSISTANT-ROLE: Помощник машиниста — возможности и границы

Версия кода: `git rev-parse HEAD` = `ce563c1142c31a51c0312ccdb7e5ade51013bf7a`
Ветка: `hermes/q4-0926`. Аудит только чтением; код приложения не менялся.

## Итог

- Всего находок: 6. Критично — 0, важно — 1, мелочь — 5.
- Помощник машиниста — это роль со своим рабочим местом `/assistant`, а не урезанная смена.
  Смену он не ведёт: серверные маршруты смены пускают строго `role === 'OPERATOR'`.
- Что может помощник: видеть свой допуск (инструктаж, проверка знаний, свои документы, открытые
  неисправности бригад), пройти инструктаж по стропальным работам, пройти проверку знаний,
  записать неисправность по машине своей бригады.
- Топ-5 по значимости:
  1. (важно) Список «Мои документы» помощника = ВСЕ активные виды документов организации, а не
     только его. Виды с флагом `requiredForOperator` (например, «Управление грузоподъёмными
     механизмами») дают ложное «Допуск неполный» у стропальщика. `assistant-query.ts:60` +
     `operator-admission.ts:64`.
  2. (мелочь) Комментарий в `capability-defaults.ts:95-105` устарел: утверждает, что помощнику
     неоткуда заводить дефект, — экран и рабочий POST уже есть.
  3. (мелочь) Нет ни одного модульного теста на `queryAssistantState` и ни одного на маршруты
     `/api/assistant/*`; покрытие — только e2e.
  4. (мелочь) `GET /api/operator/shift` не проверяет роль вовсе (любая аутентифицированная роль).
     Утечки нет (данные по `user.id`), но правило «смену ведёт машинист» здесь не enforced.
  5. (мелочь) Страница `/assistant` без серверного гварда роли: посторонний видит оболочку, отказ
     приходит от API (403). Данные не утекают.

## Методика

Что искал и как (чтобы можно было повторить):

1. `rg -l -i "assistant" src/` — карта всех файлов, упоминающих помощника.
2. `rg -l "assistant-query|assistantQuery|assistant_query" src/ e2e/ tests/` — нашёл
   `src/modules/operator-mobile/application/assistant-query.ts` (единственная «assistant-query»).
3. Читал целиком: `assistant-query.ts`, `app/api/assistant/state/route.ts`,
   `app/api/assistant/command/route.ts`, `app/(app)/assistant/page.tsx`,
   `components/piling/operator-mobile/assistant-app.tsx`,
   `components/piling/operator-mobile/screens/assistant-defect-form.tsx`,
   `screens/briefing-screen.tsx`, `screens/knowledge-screen.tsx`,
   `modules/operator-mobile/application/commands/admission.ts`,
   `application/knowledge-attempt.ts`,
   `app/api/operator/knowledge-attempt/route.ts`,
   `app/api/operator/mobile/{state,command}/route.ts` (граница смены),
   `modules/readiness/domain/capability-defaults.ts`,
   `modules/readiness/application/capabilities.ts`,
   `app/api/readiness/_shared/{request-context,route-adapter}.ts`,
   `modules/readiness/application/defects/{commands,schemas}.ts`,
   `domain/operator-mobile/{operator-admission,operator-credentials,slinger-briefing}.ts`,
   `components/piling/icons/role-navigation.ts`, `app/(app)/layout.tsx`, `app/(app)/admin/layout.tsx`,
   `app/(app)/(safety)/layout.tsx`.
4. Тесты: `rg -l -i "assistant" src --glob '*.test.ts*'` и
   `rg -n "/assistant|ASSISTANT" e2e` — какие проверки реально покрывают роль.
5. Числа только из команд (`git rev-parse`, `find`, `rg`). База не поднималась, приложение не
   запускалось — это указано в разделе «Не проверено».

## Что видит и может помощник — таблица действий

Легенда статуса: ПРОЙДЕНО — подтверждено чтением кода (и/или ассертами существующего теста);
ГИПОТЕЗА — вывод, не подтверждённый прогоном.

| # | Действие | Файл:строка | Право / гвард | Тест |
|---|----------|-------------|---------------|------|
| 1 | Открыть своё рабочее место `/assistant` | `src/app/(app)/assistant/page.tsx:12` | серверного гварда нет; клиентский `AssistantApp` | e2e `e2e/qa-ac/roles-map.spec.ts:105`, `e2e/role-audit.spec.js:6` (ПРОЙДЕНО по коду) |
| 2 | Получить состояние допуска | `src/modules/operator-mobile/application/assistant-query.ts:45`; маршрут `src/app/api/assistant/state/route.ts:22` | `user.role === 'ASSISTANT'` (иначе 403) | модульных тестов нет (ГИПОТЕЗА) |
| 3 | Прочитать инструкцию по стропальным работам | `src/components/piling/operator-mobile/assistant-app.tsx:144`; текст `src/modules/operator-mobile/domain/slinger-briefing.ts:23` | клиент, без отдельного права | e2e `e2e/role-audit.spec.js:39` (ПРОЙДЕНО по коду) |
| 4 | Подтвердить ознакомление (инструктаж) | `src/app/api/assistant/command/route.ts:59`; `admission.ts:254` (`acknowledgeBriefing`, audience `ASSISTANT`) | `role === 'ASSISTANT'` + `withMutation` (CSRF/лимит) | e2e `e2e/role-audit.spec.js:51`; модульных нет (ГИПОТЕЗА) |
| 5 | Взять вопросы проверки знаний | `src/app/api/operator/knowledge-attempt/route.ts:9` | `role` in (`OPERATOR`,`ASSISTANT`); audience = роль | e2e `e2e/role-audit.spec.js:41` (ПРОЙДЕНО по коду) |
| 6 | Сдать проверку знаний | `src/app/api/assistant/command/route.ts:62`; `admission.ts:304` (`submitKnowledgeTest`, audience `ASSISTANT`) | `role === 'ASSISTANT'`; проверка токена `knowledge-attempt.ts:20` | e2e `e2e/role-audit.spec.js:51`; модульных нет (ГИПОТЕЗА) |
| 7 | Записать неисправность по своей машине | `src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:58`; `src/app/api/readiness/defects/route.ts:67`; `commands.ts:120` | `readiness.defect.report` (`capability-defaults.ts:106`) | модульных нет; контур дефектов покрыт `capabilities.test.ts` (ГИПОТЕЗА) |
| 8 | Видеть открытые неисправности бригад | `assistant-query.ts:90` | тенант по `equipment.tenantId`, строгое равенство | модульных нет (ГИПОТЕЗА) |
| 9 | Видеть свои бригады (объект, установка, машинист) | `assistant-query.ts:68` | `CrewAssistant.userId` + `crew.isActive` + `equipment.tenantId` | модульных нет (ГИПОТЕЗА) |
| 10 | Открыть раздел «Мои документы» | `assistant-app.tsx:244` | список из `checkOperatorDocuments` | — |

## Чего помощник НЕ может (и чем это закрыто)

| # | Действие | Где отказ | Право/причина |
|---|----------|-----------|----------------|
| 11 | Открыть состояние смены `GET /api/operator/mobile/state` | `src/app/api/operator/mobile/state/route.ts:22` | `role !== 'OPERATOR'` → 403 «Экран доступен только машинисту» |
| 12 | Подать любую команду смены `POST /api/operator/mobile/command` (приёмка, чек-лист, выработка, простой, происшествие, закрытие) | `src/app/api/operator/mobile/command/route.ts:192` | `role !== 'OPERATOR'` → 403 «Команды смены подаёт машинист» |
| 13 | Открыть админские разделы (`/admin/*`) | `src/app/(app)/admin/layout.tsx:15` | роль не в списке → `redirect('/no-access')` |
| 14 | Открыть `/admin/to` (центр готовности) | `src/app/(app)/(readiness-admin)/layout.tsx:4-17` | роль не во множестве `ALLOWED` → `redirect('/no-access')`; e2e `e2e/qa-ac/no-access.spec.ts:55` |
| 15 | Читать список дефектов `GET /api/readiness/defects` | `src/app/api/readiness/defects/route.ts:30` | требует `readiness.read`, у помощника его нет |
| 16 | Видеть и закрывать чужие допуски (модуль «ТБ и допуски») | `src/app/(app)/(safety)/layout.tsx` + bootstrap контура | роль без прав видит только «Мой допуск» |

## Связь с машинистом и сменой

- Бригада — источник связи. Помощник привязан к бригаде через `CrewAssistant.userId`
  (`prisma/schema.prisma:1893`); установка и объект берутся из бригады (`assistant-query.ts:68-82`).
  Машинист бригады подписан в состоянии (`assistant-query.ts:78`, поле `operatorName`) и показан
  на экране помощника (`assistant-app.tsx:338`).
- Смену ведёт машинист, помощник в бригаде числится, но команд не подаёт — это закреплено и в
  тексте (`assistant-query.ts:20-28`), и серверной проверкой роли (строки 11-12 таблицы выше).
- Проверка знаний у помощника — свой банк вопросов (`buildSlingerAttempt`, `knowledge-attempt.ts:13`)
  и свой вид документа (`SLINGER_KNOWLEDGE_DOCUMENT_TYPE`, `operator-credentials.ts:30`), чтобы
  отметка «ознакомлен» не переносилась с чужой инструкции машиниста.
- Инструктаж помощника — отдельный текст и отдельный вид документа
  (`SLINGER_BRIEFING`, `slinger-briefing.ts:23`; вид — `operator-credentials.ts:29`).

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|----------|-----------|----------|--------------------------|--------------------------|
| F1 | важно | `src/modules/operator-mobile/application/assistant-query.ts:60` (запрос видов) + `src/modules/operator-mobile/domain/operator-admission.ts:64` | Список документов помощника = ВСЕ активные виды документов организации за вычетом четырёх служебных (фильтр `SERVICE_DOCUMENT_TYPES`, `assistant-query.ts:132`). `checkOperatorDocuments` строит проверку по КАЖДОМУ виду, включая те, что помечены `requiredForOperator` (удостоверение машиниста и пр.). | Если администратор включит `requiredForOperator` у операторского вида (например, «Управление грузоподъёмными механизмами»), помощник-стропальщик увидит «Допуск неполный → Нет действующих документов: Управление грузоподъёмными механизмами», хотя проходить его не должен. Ложное красное подрывает доверие к экрану допуска. По умолчанию все виды `requiredForOperator:false` (`scripts/seed-user-document-types.ts:141`), поэтому триггер — решение владельца по справочнику. | Отфильтровать виды, не относящиеся к помощнику: не показывать в «Мои документы» и не учитывать в `admitted` виды, которые помощник не проходит. Нужен явный признак «для кого вид» (или хотя бы сужение по `requiredForOperator`/маркеру стропальщика), а не переиспользование списка оператора как есть. |
| F2 | мелочь | `src/modules/readiness/domain/capability-defaults.ts:95-105` | Комментарий устарел и противоречит коду: «Право есть, применить его негде… без `readiness.read` все экраны контура для него закрыты… Заводить дефект помощнику не из чего». | Фактически экран `/assistant` и `assistant-defect-form.tsx:58` отправляют `POST /api/readiness/defects`, а `canReportDefects` (`capabilities.ts:87`) пропускает помощника по `readiness.defect.report` — право реализовано, а не «повисло». Комментарий вводит в заблуждение следующего правящего: он решит, что право мёртвое. | Обновить комментарий: право применяется на экране `/assistant`; границы — «любая машина своей бригады, разбор за диспетчером». |
| F3 | мелочь | `src/modules/operator-mobile/application/assistant-query.ts:45`; `src/app/api/assistant/state/route.ts`; `src/app/api/assistant/command/route.ts` | Нет ни одного модульного теста: в каталоге `application/` только `knowledge-attempt.test.ts` и `mobile-shift-query.test.ts`; тестов под `src/app/api/assistant/**` нет (`find` вернул пусто). | Логика допуска помощника (фильтр служебных документов, привязка бригад, сборка дефектов) не защищена от регресса; покрытие только e2e (`e2e/role-audit.spec.js`), который требует поднятой базы и легко «скипается». | Добавить модульный тест `queryAssistantState` на моках `db`: служебные виды скрыты, тенант-фенс бригад, пустой список бригад → нет запроса дефектов. |
| F4 | мелочь | `src/app/api/operator/shift/route.ts:15-24` | `GET /api/operator/shift` не проверяет роль: `requireAuth` есть, `role === 'OPERATOR'` — нет. | Утечки нет: `getOperatorShiftFacts(tenantId, user.id)` берёт данные по `user.id` (`route.ts:22`), чужого не отдаст. Но правило «смену ведёт машинист» здесь не enforced; ассистент/механик получит пустые факты вместо явного отказа — расхождение с соседними маршрутами `operator/mobile/*` (`state/route.ts:22`, `command/route.ts:192`). | Либо добавить гвард `role === 'OPERATOR'`, либо (если маршрут задуман шире) прокомментировать, почему роль не проверяется. |
| F5 | мелочь | `src/app/(app)/assistant/page.tsx:12` | У страницы `/assistant` нет серверного гварда роли (в каталоге только `page.tsx`, нет `layout.tsx`). | Посторонний (например, оператор) открывает `/assistant`, видит оболочку `Screen`, затем `AssistantApp` ловит 403 от `/api/assistant/state` и рисует панель отказа (`assistant-app.tsx:114`). Данные не утекают, но проверка живёт только на клиенте+API, а не у маршрута — в отличие от админских раскладок. | Гипотеза-риск низкий. При желании — серверный гвард в `layout.tsx` эмиссии `/assistant` по образцу `(safety)`/`admin`. |
| F6 | мелочь | `src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:58` → `src/app/api/readiness/defects/route.ts:67` + `commands.ts:120` | Форма ограничивает выбор установки бригадами помощника (UI, `assistant-defect-form.tsx:126`), но сервер проверяет только тенант (`requireEquipment(tenantId, equipmentId)`), не «свою ли бригаду». | Ручной запрос с чужим `equipmentId` внутри своего тенанта создаст дефект на любой машине. Для права «зафиксировать замечание может любой, кто работает со сменой» это, вероятно, допустимо; отмечаю как границу UI, а не как дыру. | Если нужно ограничить — валидировать, что `equipmentId` входит в бригады помощника. Решение владельца. |

## Не проверено

- Рантайм не запускался: база не поднималась, приложение/сборка не выполнялись. Все выводы — из
  чтения кода (`path:line` выше). Статусы тестов — по факту наличия/отсутствия файлов и чтения
  ассертов, а не по прогону.
- Результаты e2e `e2e/role-audit.spec.js`, `e2e/qa-ac/*` не воспроизводились (нужны поднятая БД и
  входы из `D:/PillingR/qa`). Их содержание прочитано как заявление о покрытии.
- Не проверено, какие именно виды документов и флаги `requiredForOperator` реально стоят в
  организации `orion` — от этого зависит, срабатывает ли F1 сейчас (в проде) или ждёт решения
  владельца. `scripts/seed-user-document-types.ts` только наполняет справочник и не включает
  обязательность.
- Не проверено фактическое поведение `/history` для помощника (страница `src/app/(app)/history/page.tsx`
  и `report-history.tsx` тянут `/api/reports/my?userId=<assistantId>`); у помощника своих отчётов
  нет, экран, вероятно, пуст — это ГИПОТЕЗА, рантаймом не подтверждено.
- Не проверено, как экран помощника ведёт себя при обрыве сети на каждом шаге (частично видно по
  комментариям `assistant-app.tsx:95-97`, `knowledge-screen.tsx:20-22`), — это отдельный аудит.
