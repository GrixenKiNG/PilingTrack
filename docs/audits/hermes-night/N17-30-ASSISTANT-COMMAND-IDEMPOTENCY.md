# N17-30-ASSISTANT-COMMAND-IDEMPOTENCY — Помощник оператора: повтор команды без ключа

Версия кода: ветка `hermes/code-1011`, commit `37ef7b03a55e763ea7e0619201a95ec60548c50f`
(`git rev-parse HEAD` в `D:\PillingR\wt-night-code`). Только чтение: код приложения не менялся,
создан только этот файл.

## Резюме для владельца

1. У помощника ключа идемпотентности НЕТ НИ ОДНОЙ команды: ни в клиенте, ни в схеме маршрута.
2. `acknowledge-briefing` (прочитал инструкцию) защищён дедупом «сутки + редакция» — повтор строку не плодит, но только на последовательном повторе (гонка не закрыта).
3. `submit-knowledge` (проверка знаний) НЕ защищён вовсе: каждый повтор пишет вторую строку в журнал ОТ и продлевает срок действия документа.
4. Очереди повторной отправки у помощника нет (у машиниста есть): при 5xx/обрыве связи команда не повторяется и не сохраняется, а ручной повтор даёт дубль в журнале.
5. Тестов на повтор `submit-knowledge` нет; есть только на повтор `acknowledge-briefing` (аудитория OPERATOR, не ASSISTANT).

## Итог

- Находок: 10 (критично — 0, важно — 4, мелочь — 6). Плюс 3 статуса ПРОЙДЕНО для полноты.
- Топ-5:
  1. `submit-knowledge` всегда создаёт новую строку `BriefingRecord` (`admission.ts:346-355`) — нет дедупа и нет ключа; повтор после потерянного ответа добавляет вторую строку в журнал ОТ.
  2. Клиент помощника не шлёт ключ идемпотентности, и схема его не принимает (`command/route.ts:11-21`); zod 4 отбрасывает лишние поля, поэтому даже попытка прислать ключ не помогла бы.
  3. У помощника нет очереди повторной отправки (`assistant-app.tsx:48-59`, `v7/assistant-v7-app.tsx:71-82`) — в отличие от машиниста (`offline-queue.ts:67-69`).
  4. Форма неисправности помощника генерирует `idempotency-key` внутри `submit` (`assistant-defect-form.tsx:60`) — повтор после ошибки создаёт второй дефект.
  5. Дедуп `acknowledge-briefing` — это проверка-перед-вставкой под Read Committed и без уникального индекса (`schema.prisma:350-354`), то есть от гонки не защищён.
- Структура: маршрутов команд два (`/api/assistant/command`, `/api/assistant/state`), команд в маршруте две (`acknowledge-briefing`, `submit-knowledge`).
- ПОЙМАНО ДО МЕНЯ: та же проблема `submit-knowledge` для машиниста уже описана в `docs/audits/hermes-night/AU13-S4-IDEMPOTENCY-KEYS.md:139` (там severity «мелочь»); здесь она подтверждена и отнесена ко всему пути помощника.

## Методика

Только чтение. Изменялся лишь этот файл. Отчёты в `docs/audits/` читались только как контекст (AU13), независимости прохода не нарушали — все выводы ниже подтверждены заново по коду.

Что и как искал:
1. `git rev-parse HEAD` / `git branch --show-current` / `git status --short` — фиксация версии и чистого дерева.
2. Маршруты: открыты `src/app/api/assistant/command/route.ts`, `src/app/api/assistant/state/route.ts`, `src/app/api/operator/knowledge-attempt/route.ts`, `src/app/api/readiness/defects/route.ts`, для сравнения `src/app/api/operator/mobile/command/route.ts`.
3. Команды: открыты `src/modules/operator-mobile/application/commands/admission.ts`, `.../commands/shared.ts`, `.../mobile-shift-commands.ts`, `.../knowledge-attempt.ts`, `.../assistant-query.ts`, `.../briefing-journal-query.ts`.
4. Клиент: открыты `src/components/piling/operator-mobile/assistant-app.tsx`, `.../v7/assistant-v7-app.tsx`, `.../api.ts`, `.../offline-queue.ts`, `.../screens/assistant-defect-form.tsx`, `.../screens/knowledge-screen.tsx`, `.../screens/briefing-screen.tsx`.
5. Обвязка: `src/core/api-wrapper.ts` (CSRF + rate limit), `src/modules/readiness/infrastructure/tenant-transaction.ts` (уровень изоляции).
6. Схема: `prisma/schema.prisma` — модели `BriefingRecord` (строки 293-355), `UserDocument` (192-214), `PpeCheck` (228-254).
7. Поиск: `rg "clientCommandId"` (более 200 совпадений), `rg "assistant/command|assistant/state"` (7), `rg "createKnowledgeAttempt|attemptToken"` (51), `rg "submitKnowledgeTest|submit-knowledge"` (37), `rg "idempotency-key"` (63).
8. Тесты: открыты `src/modules/operator-mobile/application/commands/__tests__/admission.test.ts`, `src/app/api/assistant/__tests__/auth-outage.test.ts`; поиск тестов помощника по `e2e/` (совпадения — `e2e/role-audit.spec.js` и др.).

Числа из команд:
- `git rev-parse HEAD` → `37ef7b03a55e763ea7e0619201a95ec60548c50f`; ветка `hermes/code-1011`; `git status` — дерево чистое.
- `npx vitest run src/modules/operator-mobile/application/commands/__tests__/admission.test.ts src/app/api/assistant/__tests__/auth-outage.test.ts` → `Test Files 2 passed (2)`, `Tests 9 passed (9)`, `Duration 2.96s`.
- `node_modules/zod/package.json` → version `4.6.5` (объекты по умолчанию отбрасывают лишние ключи).
- В `docs/audits/hermes-night/` — 567 файлов (этот — 568-й).

Статусы ниже: **ПРОЙДЕНО** — защита подтверждена кодом; **ГИПОТЕЗА** — механизм выведен из кода, но под одновременностью не воспроизводился; **НЕ ПРОВЕРЕНО** — см. одноимённый раздел.

## Таблица «команда | повтор | результат в базе»

| Команда | Ключ идемпотентности | Как исполняется | Повтор той же команды | Результат в базе | Файл:строка | Риск |
|---|---|---|---|---|---|---|
| `acknowledge-briefing` | нет (схема без ключа) | `command/route.ts:61` → `admission.ts:259-300` | Последовательный повтор тех же суток и редакции: возвращает тот же `{version}`, новую строку журнала НЕ пишет | `UserDocument` — обновляется на месте (`updatedAt`, `issuedAt = now`); `BriefingRecord` — без новой строки | `admission.ts:281-297`; дедуп `admission.ts:147-178` | низкий (журнал не плодится) |
| `acknowledge-briefing` | нет | то же | Два ПАРАЛЛЕЛЬНЫХ запроса (две вкладки, два устройства) | **ГИПОТЕЗА**: обе транзакции читают «записи нет» и обе вставляют → две строки | `admission.ts:161-176`; изоляция `tenant-transaction.ts:38-43`; индексов нет `schema.prisma:350-354` | средний (дубль в журнале ОТ) |
| `submit-knowledge` | нет | `command/route.ts:63` → `admission.ts:309-358` | Повтор с тем же `attemptToken` и теми же `picks` | **Всегда** новая строка `BriefingRecord` (kind `KNOWLEDGE`) + перезапись `UserDocument` со сдвигом `expiresAt = now + 30д` | запись истории `admission.ts:346-355`; документ `admission.ts:336-343`; токен многоразовый `knowledge-attempt.ts:20-30` | высокий (дубль в журнале ОТ) |

Проверки к вопросам задачи:
1. **Передаётся ли ключ и что без него.** Ключ НЕ передаётся: команды клиента помощника — `{command:'acknowledge-briefing'}` и `{command:'submit-knowledge', picks, attemptToken}` (`assistant-app.tsx:147,158`; `v7/assistant-v7-app.tsx:179,185`), а схема маршрута ключа не содержит (`command/route.ts:11-21`). Без ключа: `acknowledge-briefing` держится на дневном дедупе, `submit-knowledge` не держится ничем. Схема объектов zod 4 отбрасывает лишние поля, так что высланный клиентом ключ был бы молча отброшен.
2. **Повтор той же команды.** Двойное нажатие «в полёте» заблокировано (`busy` → `disabled`, `knowledge-screen.tsx:131`, `briefing-screen.tsx:53`). Повтор ПОСЛЕ ошибки — нет: экран остаётся с тем же `attemptToken`/`picks` (`assistant-app.tsx:98-112`), и для `submit-knowledge` это вторая строка журнала.
3. **5xx / сеть.** Очереди у помощника нет (см. находку 3): ни авто-повтора, ни хранения — только текст ошибки и ручное повторное нажатие. У машиниста очередь есть и повторяет команду под тем же `clientCommandId` (`offline-queue.ts:67-69,435-474`; `api.ts:547-621`).
4. **Смена и пользователь.** Смены у помощника нет по устройству (`assistant-query.ts:24-28`); проверка привязки к смене не нужна. Пользователь проверяется: роль `ASSISTANT` (`command/route.ts:40-42`), `operatorId = user.id` из сессии (`command/route.ts:52-56`), а для знаний токен ещё и связан с `subject` (`knowledge-attempt.ts:22`). ПРОЙДЕНО.
5. **Тесты на повтор.** Есть только на `acknowledge-briefing` и только для аудитории OPERATOR (`admission.test.ts:73-110`). Тестов на повтор `submit-knowledge` нет; у маршрутов помощника единственный файл — `auth-outage.test.ts` (только 401/503).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/commands/admission.ts:346-355` | `submitKnowledgeTest` всегда создаёт `BriefingRecord` (kind `KNOWLEDGE`): нет ни ключа, ни дедупа по суткам, в отличие от `acknowledgeBriefing` | Сеть оборвалась после коммита; помощник жмёт «Записать результат» снова — тем же `attemptToken` (он многоразовый, 30 мин) → в журнал ОТ попадает вторая строка «проверка знаний 8 из 8». Журнал ОТ — учётный документ, лишняя строка искажает «что провели сегодня» | Ввести дедуп «сутки + код инструкции + версия + kind», как в `briefingRecordedOnDay` (`admission.ts:147-178`), либо принять `clientCommandId` и хранить как в мобильном контуре машиниста |
| 2 | важно | `src/app/api/assistant/command/route.ts:11-21`; `src/components/piling/operator-mobile/api.ts:461-463` | У команд помощника нет ключа идемпотентности: ни в схеме маршрута, ни в клиенте. Zod 4.6.5 отбрасывает неизвестные поля, поэтому ключ не «не дошёл», а вообще не предусмотрен | Любой повтор (потерянный ответ, вторая вкладка, ручной ретрай) неотличим на сервере от новой команды; `acknowledge-briefing` спасает дневной дедуп, `submit-knowledge` — ничто | Добавить `clientCommandId` в схему и в типы клиента; для мобильного контура — как у машиниста |
| 3 | важно | `src/components/piling/operator-mobile/assistant-app.tsx:48-59,98-112`; `v7/assistant-v7-app.tsx:71-82,128-140` | У помощника нет очереди повторной отправки и авто-ретрая. Команда не сохраняется на устройство, при 5xx/обрыве связи ответ теряется | На площадке сеть рвётся; сервер мог записать команду, а ответ не дойти. Машинист такое переживает очередью (`offline-queue.ts:67-69`), помощник — нет: он либо не допущен, либо повторяет вручную (→ находка 1) | Переиспользовать очередь машиниста либо хотя бы хранить «ожидающий» `submit-knowledge` с ключом до подтверждения |
| 4 | важно | `src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:60` | `idempotency-key` для `/api/readiness/defects` генерируется ВНУТРИ `submit` (`crypto.randomUUID()`), значит повтор после ошибки шлёт НОВЫЙ ключ | Форма закрывается только по ответу сервера (`:70-81`); при 5xx/обрыве помощник жмёт «Записать неисправность» снова — конвейер готовности (`readiness/defects/route.ts:76-81`) видит другой ключ и заводит ВТОРОЙ дефект | Генерировать ключ один раз при открытии формы (или на уровне «попытки»), переиспользовать при ретраях |
| 5 | мелочь | `src/modules/operator-mobile/application/commands/admission.ts:161-176` | Дедуп `acknowledgeBriefing` — это `findFirst`-перед-`create` под Read Committed (`tenant-transaction.ts:38-43`), а уникального индекса у `BriefingRecord` нет (`schema.prisma:350-354`) | Два параллельных повтора (две вкладки/устройства одного работника) могут оба не найти запись и оба вставить → две строки за одно действие. ГИПОТЕЗА, под нагрузкой не воспроизводилось | Либо частичный уникальный индекс на «сутки+kind+код+версия+userId», либо сериализуемая транзакция (`withReadinessSerializableTransaction`, `tenant-transaction.ts:80-119`) |
| 6 | мелочь | `src/modules/operator-mobile/application/commands/admission.ts:336-343` | Повтор `submit-knowledge` переписывает `UserDocument.expiresAt = now + 30 дней` (`:332,342`) | Запоздалый повтор сдвигает срок действия проверки вперёд на время опоздания; «когда действует» перестаёт отражать фактическое время сдачи | При повторе не обновлять `expiresAt`/`issuedAt`; обновлять только при новом токене/новом прохождении |
| 7 | мелочь | `src/modules/operator-mobile/application/knowledge-attempt.ts:20-30` | `attemptToken` не расходуется: проверка только `jwtVerify` + сверка полей, ни записи, ни одноразовости | Токен можно переиграть неограниченно в течение 30 минут, каждый раз получая новую строку журнала (механизм находки 1) | Помечать токен использованным (однократный `jti`) или дедуп на стороне записи |
| 8 | мелочь | `src/components/piling/operator-mobile/assistant-app.tsx:48-59` | Клиент помощника шлёт `fetch` без таймаута/`AbortController` (в отличие от машиниста: `api.ts:397-421` с `timeoutSignal`) | Зависший запрос держит `busy=true` и кнопку «Записываем…» — экран не отвечает, уйти можно только перезагрузкой | Обернуть в тот же `timeoutSignal`, что и у машиниста |
| 9 | мелочь | `src/app/api/assistant/command/route.ts:11-21`; `knowledge-attempt.test.ts:8-22` | Аудитория ASSISTANT не покрыта тестом повтора: `admission.test.ts:36` зовёт `acknowledgeBriefing` без `audience`, то есть проверяет OPERATOR | Правка дедупа помощника разойдётся с тестом, который её не видит | Добавить в `admission.test.ts` кейс с `audience:'ASSISTANT'` и кейс повторного `submit-knowledge` |
| 10 | мелочь | `src/app/api/operator/mobile/command/route.ts:41-48,217-218` | Та же дыра у машиниста: `submit-knowledge` в его маршруте тоже без ключа и без дедупа | Фикс нужно делать в общей команде (`admission.ts`), иначе помощник и машинист разойдутся | Один общий дедуп в `submitKnowledgeTest` для обеих аудиторий |

### ПРОЙДЕНО (подтверждено кодом)

- **ПРИВЯЗКА К ПОЛЬЗОВАТЕЛЮ.** Сессия + роль `ASSISTANT` (`command/route.ts:36-42`), `operatorId = user.id` (`:52-56`); для знаний токен дополнительно связан с `subject` (`knowledge-attempt.ts:22`). Чужой пользователь повтор не применит.
- **СМЕНА.** У помощника смены нет по устройству (`assistant-query.ts:24-28`); проверять «текущую смену» нечего — это не находка.
- **дедуп `acknowledge-briefing` (последовательно).** Повтор тех суток/редакции второй строки не пишет; повтор другим днём или редакцией пишется (это законно) — `admission.ts:259-300`, тест `admission.test.ts:73-110`.

## Не проверено

- Фактические дубли в боевой таблице `BriefingRecord` — к базе и бою доступа нет, выводы только из кода.
- Гонка в находке 5 — выведена из кода (Read Committed + нет индекса), но НЕ воспроизводилась нагрузкой/тестами: локальная БД не поднималась, `.env` не читался.
- Поведение под реальным двойным нажатием с `withMutation` rate-limit (`api-wrapper.ts:170-221`) — считал по коду (100/мин на сессию+маршрут+IP), нагрузкой не проверял.
- Другие варианты экрана помощника/оператора (v2/v5/v10 и прочие замороженные) на наличие той же дыры не разбирались: прочитаны только `/assistant` (базовый) и `/operator/v7/assistant`, они оба шлют одни и те же две команды.
- E2E-повтор не прогонялся: `e2e/role-audit.spec.js:52` кликает «Записать результат» один раз и повтор не проверяет.
- Ветка `hermes/code-1011` на отличие от `main` по этим файлам не сравнивалась (`git log main..HEAD` не смотрел).
- Есть ли у помощника право на `POST /api/readiness/defects` (форма неисправности) — способности контура готовности не разбирались; в находке 4 оценивалась только идемпотентность ключа.
