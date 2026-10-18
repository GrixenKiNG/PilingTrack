# N17-37-KNOWLEDGE-ATTEMPT-SCORING — Проверка знаний оператора: подсчёт баллов

Версия кода: `git rev-parse HEAD` → `d8fdba1c3b7b8b3dd1487b23a353e48aaed0e285`,
ветка `hermes/code-1011` (рабочая папка `D:/PillingR/wt-night-code`). Только чтение:
код приложения не менялся, создан только этот файл. Замороженные зоны (экраны оператора,
`src/modules/operator-mobile/**`) читались, правок и предложений «удалить как мёртвое» нет.

## Итог

- Находок: 12 (критично — 0, важно — 5, мелочь — 7). Плюс 3 статуса ПРОЙДЕНО и приложение «уже известно из прошлых аудитов».
- Топ-5:
  1. Повтор `submit-knowledge` тем же токеном пишет вторую строку `BriefingRecord` и сдвигает `expiresAt` — дедупа нет (`admission.ts:346-355`, `:332-342`).
  2. Порог прохождения везде 100 % (все 8 верно), но серверная ветка отказа 409 не покрыта ни одним тестом (`admission.ts:324-330`; тест трогает только чистую `scoreAttempt`).
  3. Экран показывает «Все ответы верные» и «Результат действует 30 дней» до ответа сервера и не снимает их при сбое (`knowledge-screen.tsx:136-141`).
  4. Варианты экрана v7/v10 не получили починку R76: просроченный токен на итоговом экране — тупик без «Начать заново»/«Назад» (`v7-identity.tsx:204-228`, `operator-v10-app.tsx:1310-1326`), и HTML-страница Wi‑Fi даёт английский разбор (`v7-identity.tsx:152-160`, `operator-v10-app.tsx:1290-1305`).
  5. Попытку за другого засчитать нельзя: токен привязан к `sub` и тенанту, роль берётся из БД (`knowledge-attempt.ts:22,24-25`; `lib/auth.ts:192-201`).
- Подсчёт балла: сервер считает по своему банку (`admission.ts:320` → `knowledge-bank.ts:463-477`), в журнал/документ уходит `${correct} из ${total}`. Пустой/неполный ответ до подсчёта не доходит — его режет схема маршрута `.length(8)`.
- Числа из команд: 4 файла тестов → `Test Files 4 passed (4)`, `Tests 80 passed (80)`; `api.test.ts` → `58 passed`.

## Методика

Только чтение. Изменён лишь этот файл. Перед началом прочитаны `AGENTS.md` (доверительная
модель, замороженные зоны, список «выглядит мёртвым, но нужен»).

Что и как искал:
1. Версия и дерево: `git rev-parse HEAD`, `git branch --show-current`, `git status --short`.
2. Подсчёт балла: открыты `src/modules/operator-mobile/domain/knowledge-bank.ts` (банк, `buildAttempt`/`buildSlingerAttempt`, `scoreAttempt`), `.../application/knowledge-attempt.ts` (выдача/проверка токена), `.../application/commands/admission.ts` (`submitKnowledgeTest`).
3. Маршруты: `src/app/api/operator/knowledge-attempt/route.ts`, `src/app/api/operator/mobile/command/route.ts`, `src/app/api/assistant/command/route.ts`; обвязка `src/core/api-wrapper.ts` (CSRF + rate limit).
4. Экраны и клиент: `src/components/piling/operator-mobile/screens/knowledge-screen.tsx`, `.../api.ts`, `.../offline-queue.ts`, `.../operator-mobile-app.tsx`, `.../assistant-app.tsx`, `.../v7/assistant-v7-app.tsx`, `.../v7/v7-identity.tsx`, `.../v10/operator-v10-app.tsx`.
5. Аутентификация/тенант: `src/lib/auth.ts`, `src/app/api/operator/mobile/command/route.ts`.
6. Чтение результата: `src/modules/safety/application/self-clearance-query.ts`.
7. Поиск: `rg "knowledge-attempt|submit-knowledge|createKnowledgeAttempt|scoreAttempt|QUESTIONS_PER_ATTEMPT|isQueueable"`, `rg "findQuestion|scoreAttempt|TOPIC_LABELS"`.
8. Тесты: открыты `src/modules/operator-mobile/application/knowledge-attempt.test.ts`, `.../domain/__tests__/operator-mobile-rules.test.ts` (:300-330), `.../application/commands/__tests__/admission.test.ts`, `src/components/piling/operator-mobile/screens/__tests__/knowledge-screen.test.tsx`, `.../operator-mobile/__tests__/api.test.ts`.
9. Контекст прошлых аудитов (прочитан, независимость не нарушена, всё подтверждено заново по коду): `docs/audits/hermes-night/N17-30-ASSISTANT-COMMAND-IDEMPOTENCY.md`, `AU42-S2-ADMISSION-LOGIC.md`, `R76-v1-error-states.md`, `W69-TEST-QUALITY-OPERATOR-READINESS.md`.

Команды (реальные числа):
- `npx vitest run knowledge-attempt.test.ts operator-mobile-rules.test.ts admission.test.ts knowledge-screen.test.tsx` → по файлам: 4 + 63 + 5 + 8 = `Tests 80 passed (80)`, `Test Files 4 passed (4)`.
- `npx vitest run src/components/piling/operator-mobile/__tests__/api.test.ts` → `Tests 58 passed (58)`.
- `git status --short` → только ` M AGENTS.md` (чужое, мной не тронуто, в коммит невходит).

Статусы: **ПРОЙДЕНО** — подтверждено кодом; **ГИПОТЕЗА** — выведено из кода, но не воспроизводилось; **НЕ ПРОВЕРЕНО** — см. одноимённый раздел.

## Подсчёт балла и порог прохождения

| Где | Значение порога | Файл:строка | Статус |
|---|---|---|---|
| Код (сервер) | 100 %: `if (result.correct !== result.total)` → 409 | `src/modules/operator-mobile/application/commands/admission.ts:324-330` | ПРОЙДЕНО |
| «Балл» | `${result.correct} из ${result.total}` в `UserDocument.number` и в журнале | `admission.ts:340`, `:351-352` | ПРОЙДЕНО |
| Экран (текст) | 100 %: очередь пустеет только на верном ответе; итог «Все ответы верные» | `.../screens/knowledge-screen.tsx:118-141`, `:156-169` | ПРОЙДЕНО |
| Тест | Порог НЕ проверяется; тест трогает чистую `scoreAttempt` (3/3 и один неверный) | `.../domain/__tests__/operator-mobile-rules.test.ts:311-320` | ПРОЙДЕНО |
| Документация | Отдельного «порога прохождения» в `docs/` не нашёл | поиск `не менее|проходн|порог` по `src/`+`docs/` | НЕ ПРОВЕРЕНО (полнота поиска) |

Вывод по вопросу 3: порог **одинаков** (100 % — все 8 верно) в коде и на экране; в тесте
порог как правило отсутствует (проверяется только арифметика функции). Магическое число
`8` продублировано: схема машиниста `route.ts:47`, схема помощника `assistant/command/route.ts:19`,
банк `knowledge-bank.ts:396`, тест `knowledge-attempt.test.ts:8,11`.

## Сценарии (ответы на 6 вопросов задания)

| Сценарий | Результат | Файл:строка | Риск |
|---|---|---|---|
| (1) Пустой ответ `picks=[]` | 400 «Некорректная команда» — режет схема (`z.array(...).length(8)`), до `submitKnowledgeTest` не доходит | `src/app/api/operator/mobile/command/route.ts:44-48`; `assistant/command/route.ts:16-20` | низкий; страж `total===0` (`admission.ts:321-323`) недостижим |
| (1) Ответ не на все вопросы (<8) | 400 тем же путём (схема требует ровно 8) | `route.ts:47`; `assistant/command/route.ts:19` | низкий |
| (1) Все 8, но с ошибками (обход экрана) | 409 + `wrongIds` | `admission.ts:324-330` | средний: ветка без теста |
| (1) Повтор той же отправки тем же токеном | новая строка `BriefingRecord` (kind `KNOWLEDGE`) + сдвиг `expiresAt = now+30д` | `admission.ts:346-355`, `:332-342` | высокий: дубль в журнале ОТ |
| (2) Тот же токен, другой пользователь | 400 (подпись верна, но `sub` ≠ актор) | `knowledge-attempt.ts:22` | нет |
| (2) Тот же токен, другой тенант | 400 (`payload.tenantId !== actor.tenantId`) | `knowledge-attempt.ts:24` | нет |
| (2) Другая роль (ASSISTANT ↔ OPERATOR) | 400 (`payload.audience !== actor.audience`) | `knowledge-attempt.ts:24-25`; маршруты `route.ts:193`, `assistant/command/route.ts:40-42` | нет |
| (3) Порог в коде / на экране / в тесте | 100 % / 100 % / нет теста | `admission.ts:324`; `knowledge-screen.tsx:137`; `operator-mobile-rules.test.ts:311-320` | средний (гэп покрытия) |
| (4) Сбой сети до записи | текст ошибки + кнопка «Записать результат» остаётся; прогресс нигде не хранится | `knowledge-screen.tsx:131,150`; `offline-queue.ts:67-69` (нет `submit-knowledge`) | средний: 8 ответов вводят заново |
| (4) Сбой сети после записи | повтор даёт дубль в журнале; локально «успех» уже показан | `knowledge-screen.tsx:136-141`; `admission.ts:346-355` | средний |
| (4) Просроченный (>30 мин) токен | 400 «попытка истекла»; на `screens/knowledge-screen` есть «Начать заново», на v7/v10 — тупик | `knowledge-attempt.ts:17`; `admission.ts:318-319`; `v7-identity.tsx:204-228` | средний/высокий (v7/v10) |
| (5) Число попыток | не ограничено (кроме HTTP `100/мин` на сессию+маршрут+IP); GET попытки без лимита вовсе | `core/api-wrapper.ts:170,213`; `operator/knowledge-attempt/route.ts:6` (`withApi`) | низкий (по замыслу обучение) |
| (6) Что тесты покрывают | только токен, чистый `scoreAttempt`, UI-загрузка/просрочка; самого `submitKnowledgeTest` — нет | см. раздел «Тесты» | средний |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/commands/admission.ts:346-355` | `submitKnowledgeTest` всегда создаёт `BriefingRecord` (kind `KNOWLEDGE`): ни ключа, ни дедупа по суткам — в отличие от `acknowledgeBriefing` (`:147-178,281-297`) | Сеть оборвалась после коммита, оператор жмёт «Записать результат» ещё раз тем же `attemptToken` (он многоразовый, 30 мин) → в журнале ОТ вторая строка «проверка знаний 8 из 8». Журнал — учётный документ. Уже описано: `N17-30-ASSISTANT-COMMAND-IDEMPOTENCY.md:68`, `AU13-S4-IDEMPOTENCY-KEYS.md:123` | Дедуп «сутки + код + версия + kind» как в `briefingRecordedOnDay`, либо принять `clientCommandId` и хранить |
| 2 | важно | `admission.ts:324-330` | Серверный порог «все верно» не покрыт ни одним тестом: единственный тест балла — чистая `scoreAttempt` (`operator-mobile-rules.test.ts:311-320`), `submitKnowledgeTest` не проверяется вообще | Регресс или «улучшение» порога (например, «7 из 8») пройдёт молча: в журнал уйдёт «проверка сдана» при неверных ответах. Задание это и просит показать | Добавить тест `submitKnowledgeTest`: 8/8 → 200, 7/8 → 409 `wrongIds`, `total=0` → 400 |
| 3 | важно | `src/components/piling/operator-mobile/screens/knowledge-screen.tsx:136-141` | Панель «Все ответы верные» и строка «Результат действует 30 дней» показываются ДО записи на сервер и не снимаются при сбое (`ErrorNote` рисуется ниже, `:150`) | POST упал (нет связи) — оператор читает «действует 30 дней» и может считать допуск оформленным; фактически проверка не записана. То же на v7 (`v7-identity.tsx:207-216`) и v10 (`operator-v10-app.tsx:1313`) | Показывать итог только после успешного ответа сервера; при ошибке заменять панель на «Результат не записан» |
| 4 | важно | `src/components/piling/operator-mobile/v7/v7-identity.tsx:204-228`; `.../v10/operator-v10-app.tsx:1310-1326` | На итоговом экране v7/v10 только «Записать результат»: нет «Начать заново» и нет «Назад». Починка R76 №1 (`R76-v1-error-states.md:56`) сделана только в `screens/knowledge-screen.tsx:123-134` | Оператора отвлекли, токен (30 мин) истёк → повтор даёт 400, выхода по кнопкам нет, только перезагрузка страницы. Смену не начать. Это замороженный вариант, правка — на решение владельца | Портировать `expired`/`onRestart` из `knowledge-screen.tsx` в v7/v10 |
| 5 | важно | `v7-identity.tsx:152-160`; `operator-v10-app.tsx:1290-1305` | `response.json()` вызывается ДО проверки `response.ok`: HTML-страница Wi‑Fi/прокси даёт английское `Unexpected token '<'` (починка R76 №16 сделана только в `knowledge-screen.tsx:56-70`, `api.ts:397-421`) | «Нет интернета» выглядит как сбой приложения; машинисту непонятно, что делать | Использовать общий `fetchKnowledgeAttempt` из `api.ts` либо проверять статус до разбора |
| 6 | мелочь | `admission.ts:321-323` | Страж `result.total === 0` недостижим: обе схемы маршрутов требуют ровно 8 ответов (`route.ts:47`, `assistant/command/route.ts:19`), а `verifyKnowledgeAttempt` отвергает неполный набор (`knowledge-attempt.ts:26`) | Мёртвая ветка создаёт ложное ощущение, что от пустой отправки защищает команда, а не схема. Пустой ответ вернёт другой текст («Некорректная команда») | Либо убрать, либо сделать осмысленным при ослаблении схемы |
| 7 | мелочь | `src/app/api/operator/mobile/command/route.ts:47`; `assistant/command/route.ts:19`; `domain/knowledge-bank.ts:396`; `application/knowledge-attempt.test.ts:8,11` | Число 8 зашито в четырёх местах, хотя есть `QUESTIONS_PER_ATTEMPT` (`knowledge-bank.ts:396`); маршруты константу не используют | Правка «сколько вопросов в попытке» в банке разойдётся со схемой маршрута: валидная попытка начнёт получать 400 | Импортировать `QUESTIONS_PER_ATTEMPT` в схемы (или один общий `z.array(...).length(QUESTIONS_PER_ATTEMPT)`) |
| 8 | мелочь | `admission.ts:318-319` | `catch` ловит ЛЮБУЮ ошибку `verifyKnowledgeAttempt`, включая конфигурационную: `key()` бросает `SESSION_SECRET is required` (`knowledge-attempt.ts:9`) | При неверном/коротком `SESSION_SECRET` оператор видит 400 «попытка истекла» и бесконечно жмёт «Начать заново», а не «сообщите администратору» | Различать ошибки: невалидный токен → 400, сбой подписи/конфигурации → 500 |
| 9 | мелочь | `src/components/piling/operator-mobile/offline-queue.ts:67-69`; `api.ts:547-550` | `submit-knowledge` не входит в `QUEUEABLE`, поэтому уходит напрямую (`postCommand`), без очереди и без сохранения | Обрыв связи на 8-м вопросе: ответы нигде не сохраняются, после перезагрузки тест проходится заново; при обрыве ПОСЛЕ серверной записи ручной повтор даёт дубль (находка 1). По замыслу — команда-переход, но цена — повторный проход | Либо хранить «ожидающий» набор с ключом, либо явно показать «прогресс не сохранён» |
| 10 | мелочь | `core/api-wrapper.ts:170,213`; `src/app/api/operator/knowledge-attempt/route.ts:6` | Ограничения на число попыток нет: только `100/мин` на сессию+маршрут+IP при отправке; выдача попытки (`withApi`, GET) не лимитируется вовсе; токен многоразовый (`knowledge-attempt.ts:20-30`) | Число попыток не ограничено по замыслу (обучение). Для «экзамена» это не годится; сейчас это осознанный выбор. Уже отмечено: `AU42-S2-ADMISSION-LOGIC.md:94` | Оставить как есть или добавить счётчик, если проверка станет обязательной зачётной |
| 11 | мелочь | `assistant-app.tsx:48-59`; `v7/assistant-v7-app.tsx:71-82` | Локальный `sendCommand` помощника: нет таймаута/`AbortController`, нет проверки «ответ не от нашего сервера», нет очереди — в отличие от `api.ts` машиниста (`api.ts:397-421,547-621`) | Зависший запрос держит `busy=true` и кнопку «Записываем…»; HTML-портал Wi‑Fi считался бы успехом. Уже описано: `N17-30-ASSISTANT-COMMAND-IDEMPOTENCY.md:70,75` | Переиспользовать общий клиент `api.ts` |
| 12 | мелочь | `screens/knowledge-screen.tsx`; `v7-identity.tsx:184-292`; `operator-v10-app.tsx:1279-1373` | Логика очереди/подсчёта/итога продублирована в трёх клиентах; только `screens/knowledge-screen.tsx` умеет отличать просрочку и чужой ответ | Починки R76 (просрочка, HTML) расходятся по вариантам (находки 4-5). Один класс ошибок — три места правки | Один общий компонент попытки, варианты — только обёртки |

### ПРОЙДЕНО (подтверждено кодом)

- **Пользователь при отправке (вопрос 2).** Нет: токен подписан с `sub = operatorId` (`knowledge-attempt.ts:14,22`), маршруты берут `operatorId = user.id` из сессии (`operator/mobile/command/route.ts:209`; `assistant/command/route.ts:52-56`); роль — реальная из БД, `actingAs` её не меняет (`lib/auth.ts:192-201`), поэтому ADMIN/DISPATCHER в эти маршруты не пройдут (`route.ts:193`; `assistant/command/route.ts:40-42`). Тест на чужого пользователя/тенант/роль: `knowledge-attempt.test.ts:13-18`.
- **Тенант.** Несовпадение `payload.tenantId` с актором → отказ (`knowledge-attempt.ts:24`). `requireTenantId`/`user.tenantId` из сессии.
- **Неполный/чужой набор.** `verifyKnowledgeAttempt` отвергает не 8 ответов, дубли `questionId` и незаданный вопрос (`knowledge-attempt.ts:26-27`), тест `knowledge-attempt.test.ts:10-12`.

### Тесты: что проверяют и что нет (вопрос 6)

- `src/modules/operator-mobile/application/knowledge-attempt.test.ts` — 4 теста: привязка набора (8), отказ на один ответ/дубли/чужой вопрос, чужой пользователь/тенант/роль/испорченный токен, истечение 30 мин. **Балл не проверяет** (во всех тестах `picked:0`, что для части вопросов неверно, но балл и не считается).
- `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:311-328` — чистая `scoreAttempt` (3 норм., 1 неверный, `wrongIds`) и «у каждого вопроса есть верный вариант». **Порог и сохранение — нет.**
- `src/components/piling/operator-mobile/screens/__tests__/knowledge-screen.test.tsx` — 8 тестов: загрузка (HTML, 502, 401-редирект), просрочка с «Начать заново», прочий отказ, `isKnowledgeAttemptExpired`. **Ложного «действует 30 дней» — нет** (теста на панель успеха до ответа сервера нет).
- `src/modules/operator-mobile/application/commands/__tests__/admission.test.ts` — 5 тестов, только `acknowledgeBriefing`. **`submitKnowledgeTest` — 0 тестов.**
- `src/components/piling/operator-mobile/__tests__/api.test.ts` — 58 тестов, в т.ч. `fetchKnowledgeAttempt` (чужой JSON, 502, успех). **Отправку знаний через `sendCommand` не проверяет.**
- Нет тестов на: `submitKnowledgeTest` (409, дедуп, запись документа/журнала), схему `.length(8)`, v7/v10-потоки знаний, отправку знаний помощником.

### Уже известно из прошлых аудитов (подтверждаю по коду, не считаю новым)

- `submit-knowledge` без идемпотентности — `N17-30-ASSISTANT-COMMAND-IDEMPOTENCY.md:68`; `AU13-S4-IDEMPOTENCY-KEYS.md:123`.
- Повтор сдвигает `expiresAt`, токен не одноразовый, у помощника нет очереди — `N17-30:73,74` (тот же файл).
- `findQuestion` (`knowledge-bank.ts:400`) без потребителя (реэкспорт в `contracts.ts:36`) — `W88-UNUSED-EXPORTS.md:83,101`; зона заморожена.
- Тупик на просроченном токене описан для базового экрана — `R76-v1-error-states.md:56`; здесь подтверждён только для непорченых вариантов v7/v10.

## Не проверено

- Дубли в боевой таблице `BriefingRecord` — к базе/бою доступа нет; выводы только из кода.
- Гонка двух параллельных `submitKnowledgeTest` — выведена из кода (нет уникального индекса, нет дедупа), нагрузкой не воспроизводилась.
- Ни один сценарий не прогонялся в браузере/через API: работал только с кодом и юнит-тестами (`vitest`). Ошибка 409 «на живом» не наблюдалась.
- Замороженные варианты операторского экрана, кроме `screens/knowledge-screen.tsx`, v7 и v10, не разбирались (v2, v5, operator-next и др.) — не знаю, есть ли там та же дыра с просрочкой/HTML.
- E2E проверку знаний не запускал (`e2e/role-audit.spec.js` кликает «Записать результат» один раз, повтора нет).
- `SESSION_SECRET` в окружении не проверял (правила запрещают читать `.env*`); вывод про 400-вместо-500 — из кода `knowledge-attempt.ts:9` + `admission.ts:318-319`.
- Не сверял `BriefingRecord` (знания) с `UserDocument` типа KNOWLEDGE построчно: какое из двух источников «истина» для расчёта допуска — за рамками вопроса (см. `R148-safety-validity-ui.md:108`).
- Полноту поиска «порога прохождения» в `docs/` (в т.ч. PDF/HTML-макеты) не гарантирую — искал по текстовым `.md`/`.ts`.
