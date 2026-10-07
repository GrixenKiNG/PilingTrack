# W81-OPERATOR-ERROR-TEXTS — тексты ошибок API операторского модуля

## Итог

- Просмотрено 4 маршрута `src/app/api/operator/**` и 47 файлов `src/modules/operator-mobile/**` (чтение, без правок).
- Английских строк ошибок найдено 4, из них реально доходящих до человека — 1 (журнал инструктажей), остальные 3 перекрываются общим русским текстом обёртки или клиента.
- Русских, но тяжёлых/жаргонных формулировок для машиниста — 8.
- Мелочей (внутренние, недостижимые, разговорные) — 5.
- Критичных находок нет.

Топ-5:
1. `briefing-journal-query.ts:99` — английская строка `tenantId is required` уходит в тело ответа как есть (`briefings/journal/route.ts:73`), если когда-нибудь сработает.
2. `knowledge-attempt.ts:9` — английская `SESSION_SECRET is required...` при неверно заданном секрете.
3. `equipment.ts:57` — машинист видит дату в формате `2026-10-08` и «сдайте её» без указания чей глагол.
4. `shared.ts:199` — «Моточасы меньше известной наработки»: терминология, не речь человека.
5. `operator-mobile/api.ts:235` — на путях команды и состояния защиты от английского текста нет (есть только на пути медиа): латентный риск, что английская строка сервера дойдёт до машиниста.

## Методика

Читал (не грепом единым) — открывал файл целиком или нужный участок:

- `search_files` по `src/app/api/operator` и `src/modules/operator-mobile` по образцам: `error|message|throw new|NextResponse.json`; затем `throw ` (все виды), затем англоязычные шаблоны `(required|not found|invalid|must be|cannot|failed|is required|does not|Unknown|unknown|missing)`.
- Прочитаны полностью: `api/operator/mobile/command/route.ts`, `api/operator/mobile/state/route.ts`, `api/operator/knowledge-attempt/route.ts`, `api/operator/shift/route.ts`, `application/commands/shared.ts`, `application/knowledge-attempt.ts`, `application/briefing-journal-query.ts`, `application/commands/equipment.ts`, `application/commands/checklist.ts`, `domain/checklist-run.ts`, `domain/production-permit.ts`.
- Прочитаны нужными участками: `application/commands/production.ts` (140–320, 380–551), `production-corrections.ts` (60–105), `admission.ts` (300–339), `incidents.ts` (30–90), `shift-close.ts` (грепом по `OperatorCommandError`), `domain/incidents.ts`, `domain/pile-passport.ts`.
- Чтобы понять, что реально видит машинист, прочитан клиентский разбор отказов: `src/components/piling/operator-mobile/api.ts` (88–265, 670–730) и обёртки `src/core/api-wrapper.ts`.
- Кто вызывает спорные функции: грепом `listBriefingJournal`, `ServiceError`.

## Находки

Сначала английские тексты, затем русские с непонятными машинисту терминами/формулировками, затем мелочи.

| # | severity | файл:строка | текст сейчас | что видит машинист | предложение |
|---|----------|-------------|--------------|--------------------|-------------|
| 1 | важно | src/modules/operator-mobile/application/briefing-journal-query.ts:99 | `throw new ServiceError('tenantId is required', 400)` | Маршрут отдаёт `{error: err.message}` без правки (src/app/api/briefings/journal/route.ts:73). Английское «tenantId is required». Сейчас недостижимо (`requireTenantId` в route.ts:2 бросает раньше), но текст англоязычный. | Организация не определена — обновите страницу и войдите заново. |
| 2 | важно | src/modules/operator-mobile/application/knowledge-attempt.ts:9 | `throw new Error('SESSION_SECRET is required for knowledge attempts')` | При секрете короче 32 знаков: GET `/api/operator/knowledge-attempt` → 500, текст клиенту подменяется общим русским (`api-wrapper.ts:130-131`), но английская строка уходит в лог. | Проверка знаний временно недоступна. Сообщите администратору. |
| 3 | мелочь | src/modules/operator-mobile/application/knowledge-attempt.ts:28 | `throw new Error('Attempt does not match the assigned questions')` | Ловится в `admission.ts:313-314` try/catch и заменяется русским «Набор вопросов неполный или попытка истекла…» — машинист не видит. | Набор вопросов устарел — начните проверку заново. |
| 4 | мелочь | src/app/api/operator/mobile/command/route.ts:196 | `{error: 'Некорректная команда', details: parsed.error.issues}` | Основной текст русский (и клиент меняет его на совет), но `details` — это zod-issues с английскими сообщениями («Invalid input», «Required», «Invalid enum value»). Сырой API и логи отдают английское; клиент отсекает по кириллице (`api.ts:110-131`). | Оставить `details` только для логов; машинисту — общий совет (уже так). |
| 5 | важно | src/modules/operator-mobile/application/commands/shared.ts:199 | `` `Моточасы меньше известной наработки (${floor}). Проверьте цифру.` `` | «наработка», «известной» — термины учёта, не речь человека. | Моточасы меньше, чем было раньше (${floor}). Проверьте значение счётчика. |
| 6 | важно | src/modules/operator-mobile/application/commands/equipment.ts:57 | `` `По этой установке не закрыта смена за ${...toISOString().slice(0,10)}. Сдайте её, прежде чем открывать новую.` `` | Дата в формате `2026-10-08` (непривычна), «сдайте её» — чей глагол, непонятно. | По этой машине смена за 08.10.2026 ещё не сдана. Сдайте её, потом открывайте новую. |
| 7 | важно | src/modules/operator-mobile/application/commands/production.ts:151 | `'Смена ещё не начата: примите установку на экране приёма, и запись выработки откроется.'` | «выработка», «экран приёма» — внутренний жаргон. | Смена ещё не открыта — сначала примите машину. После этого сможете записывать сваи. |
| 8 | важно | src/modules/operator-mobile/application/commands/production.ts:297-298 | `` `Залог № ${index+1} заполнен неверно` `` + `'В залоге нужны число ударов больше нуля и погружение от нуля'` | «залог», «погружение от нуля» — тяжёлая формулировка на слух. | Залог № N: укажите число ударов больше нуля и погружение (0 или больше). |
| 9 | мелочь | src/modules/operator-mobile/application/commands/shift-close.ts:68 | `'Сначала выполните ЕО после работы'` | «ЕО» и «ТО» — сокращения; профи знает, но в тексте ошибки лучше развернуть. | Сначала пройдите ежедневный осмотр после работы. |
| 10 | мелочь | src/modules/operator-mobile/application/commands/production.ts:406 | `'Не разобрать время простоя'` | Разговорное «не разобрать». | Не удалось понять время простоя — проверьте начало и конец. |
| 11 | мелочь | src/modules/operator-mobile/application/commands/production.ts:461 | `` `Простой пересекается с уже записанным (${...}–${...}). ` + 'Если записанный неверен — поправьте его, а не добавляйте второй.' `` | «с уже записанным» без существительного (простоем?). | Этот простой заходит на уже записанный (HH:MM–HH:MM). Если прежний неверен — поправьте его. |
| 12 | мелочь | src/modules/operator-mobile/application/commands/production.ts:311 | `'Пикет не относится к объекту смены — выберите пикет этого объекта'` | «объект смены» — внутренний термин; машинисту важнее «этого объекта». | Выбранный пикет с другого объекта. Выберите пикет вашего объекта. |
| 13 | мелочь | src/modules/operator-mobile/application/commands/shared.ts:128,131,142,152 | `'Марка сваи не найдена в справочнике вашей организации — обновите экран…'` (и аналоги для типа бурения, причины простоя) | «справочник» понятен, но фраза длинная и одинаковая трижды. | Устарело — обновите экран и выберите заново. |
| 14 | мелочь | src/modules/operator-mobile/domain/checklist-catalog.ts:556 | `` throw new Error(`Неизвестный чек-лист: ${stage}`) `` | Значение `stage` — внутренний код (`PRESHIFT_INSPECTION`) в тексте ошибки. Достижимо только при программной ошибке, машинисту не показывается. | Неизвестный чек-лист (${stage}). |
| 15 | риск (не текст) | src/components/piling/operator-mobile/api.ts:235 | `if (serverText !== null && (!options.russianOnly \|\| isHumanRussianText(serverText)))` | На путях команды/состояния `russianOnly` не выставлен (он задан только для медиа, строка 685). Значит ЛЮБАЯ английская строка `error` от сервера попадёт в тост машинисту. Сейчас сервер на этих путях отвечает по-русски — защита держится на этом совпадении. | Всегда пропускать текст сервера только при `isHumanRussianText(serverText)`. |

## Не проверено

- Не запускал приложение и тесты: правил это правило (только чтение кода), а «что видит машинист» выведено из чтения клиента `operator-mobile/api.ts` и обёртки, не из наблюдения на экране.
- Не проверял, действительно ли `SESSION_SECRET` задан в рабочем окружении: файлы `.env*` не открывал (запрет AGENTS.md). Поэтому строка #2 — по коду, а не по факту срабатывания.
- Формат даты `toISOString().slice(0,10)` в кадре #6: не проверял локализованную дату на клиенте — возможно, тост показывает её иначе.
- Файлы маршрутов `src/app/api/briefings/journal/route.ts` вне заявленной области (`operator`/`operator-mobile`) просмотрены только как вызывающий; систематический поиск английских текстов по всем прочим API не делал.
- `src/modules/operator-mobile/**` и операторские экраны — замороженная зона (AGENTS.md §1): только читал, ничего не менял.
