# AU136-S3-FORM-VALIDATION-MESSAGES — сообщения валидации форм (zod)

Аудит только для чтения. Код приложения не менялся; создан единственный файл — этот отчёт.

- Репозиторий: D:\PillingR\wt-night (git worktree), ветка `hermes/q4-0926`
- Версия (git rev-parse HEAD): `73c72f15ba6cf6160d886b57417ab6bb1d02fae6`
- zod в проекте: `package.json:117` → `"zod": "^4.3.6"`; фактически установлено `node_modules/zod` версии `4.6.5`
- Замороженные зоны (operator screen, ORION) не анализировались на изменения. Файл `src/components/piling/operator-mobile/api.ts` попадает под шаблон `src/components/piling/operator*/**` (заморожен) — он прочитан только как справка о существующем приёме, менять его нельзя.

## Итог

Всего находок: 26. Критично — 0, важно — 9, мелочь — 17.
Критичных нет: тексты валидации не приводят к потере данных и не влияют на доступ. Это качество сообщений, которые человек читает при отказе формы.

Топ-5:
1. (важно) Таблица переводов `src/lib/api-error-message.ts:50-56` написана под тексты zod **v3**, а проект работает на zod **v4**. Четыре из пяти записей («Expected number», «Number must be greater than or equal to 0», «String must contain at least 1 character(s)», «Required») не совпадают ни с одним реальным текстом zod v4 → английский текст уходит пользователю.
2. (важно) Собственные англоязычные сообщения схем: `src/lib/validation-schemas.ts:43` «Password must contain at least 8 characters», `:247` «Invalid date format (YYYY-MM-DD)», `:260` «Count must be at least 1».
3. (важно) Технические сообщения с именами полей и значений в справочнике: `src/app/api/dictionary/manage/route.ts:123` «lengthMm, sectionOrDiameter и notes применимы только для типа сваи pileGrade» и `:65` «Укажите хотя бы одно поле: name, isActive, lengthMm, sectionOrDiameter или notes».
4. (важно) Поля вне отчёта подписываются машинным именем: `src/lib/api-error-message.ts:85` печатает «Поле <техническое_имя>»; читаемые русские подписи есть только для 6 полей отчёта (`:29-37`). Так на экране установки появляется «Поле weightTons: …».
5. (важно) Схемы без сообщений (техпаспорт установки `src/lib/validation-schemas.ts:151-184`, план ТО `src/app/api/maintenance-plans/route.ts:16-26`, виды документов `src/app/api/user-document-types/schema.ts:11-19`) отдают наружу английские тексты zod v4 — формат установки и ТО показывает их пользователю.

Резюме для владельца (коротко):
1. Русский перевод ошибок полей есть, но он устарел: писался под старую версию zod, а стоит новая — часть английских строк доходит до экрана.
2. Три английские строки заданы вручную прямо в схемах (пароль, формат даты, количество свай).
3. В справочнике (марки, виды бурения, причины простоя) отказы называют поля кодовыми именами — непонятно без программиста.
4. Ошибки полей вне сменного отчёта подписываются английскими именами полей («Поле weightTons»).
5. Часть экранов (осмотры, ТО, справочники, виды документов) показывает только общую фразу сервера и не разворачивает построчные ошибки — там английский не виден, но и поле не названо.

## Методика

Что и как искалось (повторяемо):

1. Точка входа — `src/lib/validation-schemas.ts` (469 строк) прочитан целиком.
2. Все файлы с zod: `search_files pattern="from ['\"]zod['\"]"` → 45 файлов (в т.ч. тесты). Из них прочитаны схемы маршрутов, модулей и контрактов.
3. Собственные сообщения: `grep -n "message: *['\"]..."`, `grep -nE "\.refine\(.*,\s*['\"]"`, `grep -n "issues.map"`, `grep -n "error.flatten()"` по `src/app/api`, `src/modules`, `src/lib`.
4. Английские тексты: `grep -n "message: *['\"][A-Za-z]"` и `grep -nE "'(Invalid|Required|Expected|Number must|String must|Too (small|big))'"`.
5. Путь сообщения к пользователю: `src/lib/api-error-message.ts` (перевод + подписи полей), потребители — `grep -rln "apiErrorMessage|extractApiError"` → 7 файлов с `apiErrorMessage`, 12 с `extractApiError`; прочитаны `crew-messages.ts`, `inspection-api-error.ts`, `use-site-mutations.ts`, `use-equipment-list.ts`, `use-users-list.ts`, `report-form/use-report-form.ts`, `admin-reports/report-form-dialog.tsx`, `admin-telegram.tsx`, `to/readiness/api/client.ts`.
6. Проверка реальных текстов zod v4 (не по памяти): скрипт `node` (создан в scratch-каталоге Hermes, вне репозитория) печатал `safeParse`-сообщения для `min/max/email/uuid/enum/regex/number`. Вывод:
   - `string().min(1)` → `Too small: expected string to have >=1 characters`
   - `number().min(0)` → `Too small: expected number to be >=0`
   - `number().max(9999)` → `Too big: expected number to be <=9999`
   - `number()` на строке → `Invalid input: expected number, received string`
   - `string().email()` → `Invalid email address`; `string().uuid()` → `Invalid UUID`
   - `enum(['DAY','NIGHT'])` → `Invalid option: expected one of "DAY"|"NIGHT"`
   - обязательное поле объекта → `Invalid input: expected string, received undefined`
7. Тест `src/lib/__tests__/api-error-message.test.ts` запущен: `node node_modules/vitest/vitest.mjs run src/lib/__tests__/api-error-message.test.ts` → **Test Files 1 passed (1), Tests 11 passed (11), exit 0**. Он подтверждает поведение и сам содержит английский текст в ожидаемом результате (`:14`, `:20`).

Числа из команд (не оценки):
- Маршрутов API, отдающих построчные ошибки массивом `{field,message}` (`grep -rln "issues.map" src/app/api` без тестов): 25.
- Маршрутов API, отдающих `error.flatten()` (без тестов): 26.
- Файлов, импортирующих `@/lib/api-error-message`: 7.
- Файлов, использующих `extractApiError`: 12.
- Строк с русскими собственными сообщениями в `src/lib/validation-schemas.ts`: 15.
- Записей в таблице переводов `MESSAGE_TRANSLATIONS`: 5; из них совпадает с реальным текстом zod v4 — 1 («Invalid input» как префикс), не совпадает — 4.

Статусы в таблицах ниже: ПРОЙДЕНО — проверено чтением кода и/или командой; ГИПОТЕЗА — вывод из кода без запуска сценария; НЕ ПРОВЕРЕНО — не подтверждено.

## Находки

| # | severity | путь:строка | проблема | сценарий / почему важно | как исправить | статус |
|---|----------|-------------|----------|-------------------------|----------------|--------|
| 1 | важно | src/lib/api-error-message.ts:50-56 | Таблица переводов `MESSAGE_TRANSLATIONS` содержит тексты zod **v3**; в проекте zod **v4.6.5** (`package.json:117`). Не совпадают: «Expected number» (`:51`), «Number must be greater than or equal to 0» (`:52`), «String must contain at least 1 character(s)» (`:53`), «Required» (`:54`). Живой остаётся только префикс «Invalid input» (`:55`). | Оператор/администратор сохраняет отчёт, установку или объект со значением вне диапазона — под русской строкой поля показывается английский текст, например «Сваи, строка 3: количество: Too small: expected number to be >=1». Пользователь не понимает, что править. Подтверждено тестом `src/lib/__tests__/api-error-message.test.ts:14,20` — английская строка ожидается в выводе как есть. | Обновить префиксы под zod v4 («Too small:», «Too big:», «Invalid input:», «Invalid option:», «Invalid email address», «Invalid UUID»), либо задать в схемах русские `error`-функции zod. | ПРОЙДЕНО |
| 2 | важно | src/lib/validation-schemas.ts:43 | Собственное английское сообщение «Password must contain at least 8 characters» у поля `password` (`userBaseSchema`). Русский текст есть у соседей (`:31`, `:40`). | При создании/правке пользователя (маршрут `src/app/api/users/route.ts`) отказ по длине пароля приходит по-английски. Клиентская форма проверяет длину сама (`src/components/piling/admin-users/user-dialogs.tsx:108`), но через API и при обходе формы текст виден. | Заменить на «Пароль должен содержать минимум 8 символов». | ПРОЙДЕНО |
| 3 | важно | src/lib/validation-schemas.ts:247 | Сообщение «Invalid date format (YYYY-MM-DD)» у `reportUpsertSchema.date`. | Форма отчёта показывает «Дата: Invalid date format (YYYY-MM-DD)» (подпись поля `date` есть в `api-error-message.ts:31`, а текст не переводится). Клиент формирует дату сам, поэтому путь латентный, но при любом рассинхроне формата пользователь читает английский шаблон. | Заменить на «Дата в формате ГГГГ-ММ-ДД». | ПРОЙДЕНО (текст), ГИПОТЕЗА (частота показа) |
| 4 | важно | src/lib/validation-schemas.ts:260 | Сообщение «Count must be at least 1» у `piles[].count`. То же наследует `reportAdminUpsertSchema` (`:412-415`). | При отказе по количеству свай админский экран (`src/components/piling/admin-reports/report-form-dialog.tsx:216`) покажет «Сваи, строка N: количество: Count must be at least 1». | Заменить на «Количество должно быть не меньше 1». | ПРОЙДЕНО (текст), ГИПОТЕЗА (частота показа) |
| 5 | важно | src/app/api/dictionary/manage/route.ts:123 | Текст «lengthMm, sectionOrDiameter и notes применимы только для типа сваи pileGrade» — машинные имена полей и значение enum. | Справочник (марки/виды бурения/причины простоя) показывает этот текст в тосте через `extractApiError` (`src/components/piling/admin-dictionaries.tsx`). Администратор не знает, что такое `lengthMm`. | Переписать по-русски («Длину, сечение и примечание можно задать только для марки сваи»). | ПРОЙДЕНО |
| 6 | важно | src/app/api/dictionary/manage/route.ts:65 | Текст «Укажите хотя бы одно поле: name, isActive, lengthMm, sectionOrDiameter или notes» — список технических полей. | Отказ при пустом PATCH справочника; показывается в тосте. | Заменить на понятное «Нет изменений для сохранения». | ПРОЙДЕНО |
| 7 | важно | src/lib/api-error-message.ts:85 | Для полей без подписи печатается `Поле <техническое_имя>`; читаемые подписи заведены только для 6 полей отчёта (`:29-37`) и трёх разделов (`:40-47`). | Форма установки/объекта/бригады при отказе поля показывает «Поле weightTons: …», «Поле latitude: …», «Поле operatorId: …» — латиница и camelCase на русском экране. Потребители: `use-equipment-list.ts:71,95`, `use-site-mutations.ts:111,171`, `crew-messages.ts:35`. | Добавить словари подписей для полей установки, объекта, бригады и справочника либо скрывать `field`, если подписи нет. | ПРОЙДЕНО |
| 8 | важно | src/lib/validation-schemas.ts:249-250 | `shiftStart`/`shiftEnd` — `regex(/^\d{2}:\d{2}$/)` без сообщения. | В zod v4 это `Invalid string: must match pattern /^\d{2}:\d{2}$/` (не переводится) → «Начало смены: Invalid string: must match pattern …». | Добавить русское сообщение «Время в формате ЧЧ:ММ». | ГИПОТЕЗА |
| 9 | важно | src/lib/validation-schemas.ts:151-184 | `equipmentMetadataSchema` (26 полей техпаспорта) не содержит ни одного сообщения — все отказы английские (zod v4). | Диалог установки шлёт эти поля, отказ читается через `extractApiError` (`src/components/piling/admin-equipment/use-equipment-list.ts:71,95`): «Поле manufactureYear: Too small: expected number to be >=1950», «Поле maxPileLength: Too big: expected number to be <=200». | Задать русские сообщения через `optNum`/обёртки и подписи полей в `api-error-message.ts`. | ПРОЙДЕНО (схема), ГИПОТЕЗА (какой текст первым) |
| 10 | мелочь | src/app/api/telegram/configs/route.ts:19 | Сообщение «Invalid ID» у `deleteIdSchema.id`. | Удаление канала Telegram: отказ приходит «Поле id: Invalid ID». Клиент шлёт id из списка, поэтому путь латентный. | Заменить на «Не указан идентификатор канала». | ПРОЙДЕНО |
| 11 | мелочь | src/modules/readiness/application/shifts/schemas.ts:18 | Английское «A substantive field is required» в `updateShiftSchema.refine`. | **Пользователю не показывается**: клиент контура готовности берёт только поле `error` и только кириллицу (`src/components/piling/to/readiness/api/client.ts:64-66`), а маршрут подменяет текст на «Некорректные изменения смены» (`src/app/api/readiness/shifts/[id]/route.ts`). Английский текст остаётся мёртвым в коде. | Перевести, чтобы не вводить в заблуждение при будущем показе. | ПРОЙДЕНО |
| 12 | мелочь | src/modules/readiness/application/permits/schemas.ts:58 | Английское «At least one permit field is required». | Не показывается пользователю (см. #11): маршрут отдаёт «Некорректные данные наряда», клиент читает только русское `error`. | Перевести. | ПРОЙДЕНО |
| 13 | мелочь | src/modules/readiness/application/command-pipeline/etag.ts:13-45 | Шесть английских сообщений («Weak ETags are not accepted», «Expected version must be a non-negative integer» и др.). | Не показываются: клиент заменяет не-русский текст на «Запрос завершился с кодом N.» (`client.ts:64-66,86-91`). | Оставить как внутреннюю диагностику; при желании перевести. | ПРОЙДЕНО |
| 14 | мелочь | src/app/api/user-document-types/schema.ts:11-19 | Схема без сообщений → английские тексты zod v4. | **Пользователю не показывается**: диалог видов документов читает только `body.error` (`src/components/piling/admin-users/user-document-types-dialog.tsx:111,126,156`). | Добавить русские сообщения, если решите показывать детали. | ПРОЙДЕНО |
| 15 | мелочь | src/app/api/maintenance-plans/route.ts:16-26 | Схема плана ТО без сообщений (`intervalHours`, `leadTimeDays` через `coerce.number()`). | Не показывается: `src/components/piling/maintenance/work-order-form-dialog.tsx:254` берёт только `err.error` через `maintenanceErrorText` (`maintenance-helpers.ts:46-53`). | При переходе на построчный показ — задать сообщения. | ПРОЙДЕНО |
| 16 | мелочь | src/lib/api-error-message.ts:21 | `.slice(0, 3)` — показываются максимум 3 построчные ошибки, остальные молча отбрасываются. | Форма с 5 неверными полями назовёт три; пользователь исправит три и получит новый отказ. | Добавить «и ещё N полей» либо поднять лимит. | ПРОЙДЕНО |
| 17 | мелочь | src/lib/api-error-message.ts:51-53 | Три записи таблицы переводов не срабатывают ни разу (см. #1) — мёртвый код с ложным ощущением перевода. При этом запись «Required» (`:54`) тоже не совпадает ни с одним текстом zod v4. | Тест `src/lib/__tests__/api-error-message.test.ts:68-70` «проходит» только потому, что проверяет выдуманные строки, а не реальные тексты схем. | Переписать таблицу под реальные тексты и подкрепить тестом на реальном `safeParse` схемы. | ПРОЙДЕНО |
| 18 | мелочь | src/lib/validation-schemas.ts:338-341 и :437-440 | `recognizeImageSchema` и `recognizeImageDataSchema` полностью дублируются (одно и то же сообщение). | При правке одной схемы вторая незаметно разойдётся — сообщение начнёт отличаться. | Оставить одну схему, вторую сделать ссылкой. | ПРОЙДЕНО |
| 19 | мелочь | src/app/api/dictionary/manage/route.ts:30 и src/components/piling/admin-dictionaries.tsx:268 | Единицы противоречат: сервер требует «положительную длину в **миллиметрах**», экран — «положительную длину в **метрах**». | Администратор вводит метры, а в тексте сервера — миллиметры; путаница в единицах при правке марки. | Согласовать формулировку (показывать метры, мм оставить внутренним). | ПРОЙДЕНО |
| 20 | мелочь | src/app/api/reports/pdf/route.ts:42-43,58-59 | `dateFrom`/`dateTo` — `regex(DATE_RE)` без сообщения (сообщение есть только у `refine` «Дата начала позже даты окончания», `:49,65`). | При неверном формате даты в выгрузке отказ будет английским (zod v4), хотя рядом русский текст. | Добавить сообщение к `regex`. | ГИПОТЕЗА |
| 21 | мелочь | src/lib/validation-schemas.ts:361 | `equipmentUpdateSchema.expectedUpdatedAt: z.string().datetime()` без сообщения. | При конкурентной правке карточки (оптимистическая блокировка) отказ по этому полю будет английским. | Задать русское сообщение. | ГИПОТЕЗА |
| 22 | мелочь | src/lib/validation-schemas.ts:207 и :218 | Асимметрия: `createCrewSchema.name` без сообщения, `updateCrewSchema.name` — «Укажите название бригады». | Форма создания бригады проверяет имя сама (`crew-form-dialog.tsx:188`), поэтому отказ сервера не виден; при обходе формы текст будет английским. | Дать одно сообщение обеим схемам. | ПРОЙДЕНО |
| 23 | мелочь | src/app/api/reports/upsert/route.ts:33 | Текст обратной связи «Проверка данных отчёта завершилась ошибкой валидации.» (audience OPERATIONS). | Это не тост формы, а запись в ленте обратной связи; формулировка техническая («валидация»). | Заменить на «Отчёт не сохранён: данные не прошли проверку». | ГИПОТЕЗА |
| 24 | мелочь | src/components/piling/login-page.tsx:53-61 и src/app/api/auth/login/route.ts:36-44 | Экран входа читает только `err.error`, построчные `details` отбрасываются; сообщения схемы входа русские (`validation-schemas.ts:30-31`). | Поведение отличается от остальных форм (там `details` разворачиваются), но пользователь ничего не теряет. | Для единообразия — использовать `apiErrorMessage`. | ПРОЙДЕНО |
| 25 | мелочь | src/lib/validation-schemas.ts:329 (`uuidSchema` → `analyticsQuerySchema`) | `z.string().uuid()` без сообщения → «Invalid UUID». | Аналитика/отчёты при неверном `siteId` могут показать английское «Invalid UUID». | Задать русское сообщение. | ГИПОТЕЗА |
| 26 | мелочь | src/lib/validation-schemas.ts:15-18 | Общие схемы (`uuidSchema`, `internalIdSchema`, `dateSchema`, `timeSchema`) без сообщений → английские тексты zod v4 в любом маршруте, где поле окажется неверным. | Базовый слой: все 25+ маршрутов с `issues.map` наследуют английские тексты для этих полей. | Дать этим схемам русские сообщения — один правый край исправит много мест. | ПРОЙДЕНО |

## Английские и технические сообщения (сводно)

Английские сообщения, заданные вручную в коде:

| путь:строка | текст | видно ли пользователю |
|---|---|---|
| src/lib/validation-schemas.ts:43 | Password must contain at least 8 characters | да (маршрут users); на экране прикрыто клиентской проверкой |
| src/lib/validation-schemas.ts:247 | Invalid date format (YYYY-MM-DD) | да (форма отчёта) |
| src/lib/validation-schemas.ts:260 | Count must be at least 1 | да (формы отчёта, операторская и админская) |
| src/app/api/telegram/configs/route.ts:19 | Invalid ID | да (удаление канала Telegram) |
| src/modules/readiness/application/shifts/schemas.ts:18 | A substantive field is required | нет (клиент отбрасывает не-русский текст) |
| src/modules/readiness/application/permits/schemas.ts:58 | At least one permit field is required | нет (то же) |
| src/modules/readiness/application/command-pipeline/etag.ts:13,14,17,20,22,37,45 | Weak ETags…, If-Match…, Expected version must be a non-negative integer | нет (то же) |

Технические (русские по языку, но с машинными именами) сообщения:

| путь:строка | текст | почему проблема |
|---|---|---|
| src/app/api/dictionary/manage/route.ts:65 | Укажите хотя бы одно поле: name, isActive, lengthMm, sectionOrDiameter или notes | латинские имена полей |
| src/app/api/dictionary/manage/route.ts:123 | lengthMm, sectionOrDiameter и notes применимы только для типа сваи pileGrade | латинские имена полей + значение enum |
| src/lib/api-error-message.ts:85 | Поле <field> | машинное имя поля, если нет русской подписи |

Английские тексты, приходящие из zod v4 (не заданы в коде, но показываются, где нет русского перевода): «Too small: expected number to be >=N», «Too big: expected number to be <=N», «Too small: expected string to have >=N characters», «Invalid input: expected number, received string», «Invalid input: expected string, received undefined», «Invalid option: expected one of "…"», «Invalid email address», «Invalid UUID», «Invalid string: must match pattern …». Источник — прогон `safeParse` на установленном zod 4.6.5 (см. «Методика», п.6).

## Не проверено

- Не проверено в браузере, какие именно тексты форм видит пользователь при отказе: выводы о показе сделаны по коду потребителей (`extractApiError` → `apiErrorMessage` → `toast.error`). Прогон Playwright не запускался.
- Не проверено фактическое появление английских текстов в проде (нет доступа к продакшену — запрещено AGENTS.md).
- Не проверялось, все ли из 25 маршрутов с `issues.map` действительно возвращают `message` (у части маршрутов формат может отличаться), — проверены выборочно: `reports/upsert`, `sites/create`, `telegram/configs`, `inspections`, `dictionary/manage`, `equipment/[id]`.
- Частота показа помечена ГИПОТЕЗА там, где клиентская форма заранее проверяет то же поле (отчёт, установка, пользователи) — путь к серверному отказу не воспроизводился.
- Не проверено, есть ли у поля `details` другие потребители, кроме найденных 7 файлов с `apiErrorMessage` и 12 с `extractApiError` (поиск по строке; динамический импорт не исключён).
- Замороженные зоны (экран оператора, ORION, `src/modules/operator-mobile/**`) в находки не включались; файл `src/components/piling/operator-mobile/api.ts` прочитан только как справка о приёме «кириллица = можно показывать» (`:95-97`).
- Не проверялось, покрыты ли затронутые сообщения юнит-тестами, кроме `src/lib/__tests__/api-error-message.test.ts` (11/11 passed). Полный прогон `npm run test:unit`, `npm run lint`, `npx tsc --noEmit` в рамках этой задачи не выполнялся.
