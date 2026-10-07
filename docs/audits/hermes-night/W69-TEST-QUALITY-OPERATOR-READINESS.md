# Слабые тесты оператора и готовности — W69

Аудит «какие тесты машинного/readiness-контура проходят вхолостую». Искалось
четыре брака: (а) пустая фикстура, а проверяется «нет X»; (б) утверждение
допускает и успех, и любую ошибку; (в) `toBeDefined`/`toBeTruthy` вместо
значения; (г) мок возвращает ровно то, что проверяется. Только чтение; ни один
файл не изменён.

## Итог

Прочитано 48 тест-файлов (446 тестов) в четырёх названных областях; локальный
прогон `vitest run` по ним — **48 файлов / 446 тестов passed, 0 skipped**. В
целом качество тестов высокое: подавляющее большинство проверок — по значению
(точные строки, `toHaveLength`, `toEqual`), негативные проверки почти всегда
парные с позитивными. Найдено **14 слабых мест: критично — 0, важно — 3,
мелочь — 11**.

Топ-5:
1. `knowledge-attempt.test.ts:12,15,16,18` — проверки подписанного токена
   попытки принимают `rejects.toThrow()` **без аргумента**: сойдёт любая ошибка,
   включая `TypeError` от сломавшегося кода. Не проверено, что отказ именно про
   чужого пользователя/тенант/роль/подменённый токен.
2. `to/readiness/api/__tests__/contracts.test.ts:83,85` — `toThrow()` без
   аргумента: контракт «отвергает испорченные факты» проходит при любой ошибке.
3. `modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143`
   — два `describe.skip` (машины состояний смены/передачи/наряда и оценка
   готовности, PRD §5/§6) **не выполняются никогда**, хотя файл выглядит как
   покрытие. (Формально вне названных путей, но та же область «готовность».)
4. `screens/__tests__/incidents-tab.test.tsx:6` — всё состояние экрана задано
   как `{incidents: []}`; список происшествий не проверяется ни разу, и пустая
   фикстура этого не покажет (брак «а»).
5. `screens/fleet-screen.test.tsx:359-363` — негативная проверка «нет счётчика
   причин» на пустой `currentReadiness: []` без парной проверки, что строка
   парка вообще отрисовалась (брак «а»).

## Методика

1. Границы: `src/modules/operator-mobile/**/__tests__`,
   `src/components/piling/operator-mobile/**`, `src/components/piling/operator-v2/**`,
   `src/components/piling/operator-v5/**`, `src/components/piling/to/readiness/**`.
   Замороженные варианты операторского экрана и ORION не трогал (только явно
   названные в задаче пути).
2. Перечень файлов: `search_files target=files` по `*.test.ts*` в этих каталогах →
   48 файлов; прочитан каждый целиком через `read_file`.
3. Поиск брака по срезам регулярками: `toBeDefined|toBeTruthy|toBeFalsy`,
   `toThrow\(\)|rejects\.toThrow\(\)`, `not\.toThrow`, `expect\.any\(`,
   `\.every\(`, `toHaveLength\(0\)`, `it\.skip|describe\.skip|it\.todo|it\.only`,
   `catch\(`, `.resolves`/`rejects`.
4. Пустые/заглушечные фикстуры искал по `as unknown as <Тип>` и по массивам
   `[]` в литералах состояния.
5. Прогон для факта «зелёные и без скрытых пропусков»:
   `node node_modules/vitest/vitest.mjs run src/modules/operator-mobile src/components/piling/operator-mobile src/components/piling/operator-v2 src/components/piling/operator-v5 src/components/piling/to/readiness`
   (`exit_code 0`, 48 файлов / 446 тестов passed, 0 skipped).
6. Проверку «пройдёт ли тест вхолостую» делал чтением кода теста и production-
   функции; мутации кода не запускал (правило 1 запрещает правки).

## Находки

| # | severity | файл:строка | проблема | сценарий / почему важно | как исправить |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/knowledge-attempt.test.ts:12,15,16,18` | `await expect(verifyKnowledgeAttempt(...)).rejects.toThrow()` — без аргумента (4 места). | Проверка подписанной попытки проверки знаний: отказ по чужому пользователю, тенанту, роли, подменённому токену и просрочке (30 мин). Утверждение пройдёт при ЛЮБОЙ ошибке, в т.ч. `TypeError` от регресса в разборе токена — «несоответствие попытки» окажется непроверенным. | Заменить на `rejects.toThrow(/<точный текст из функции>/i)` (или `toThrowErrorMatchingSnapshot`) по одному ожиданию на каждую ветку. |
| 2 | важно | `src/components/piling/to/readiness/api/__tests__/contracts.test.ts:83,85` | `expect(() => parseCurrentReadinessResponse(...)).toThrow()` — без аргумента. | Контракт «отвергает испорченные/неполные авторитетные факты». Любой `throw` (опечатка, `TypeError` в самом парсере) считается успехом — можно сломать парсер и остаться зелёным. | Проверять класс/сообщение ошибки схемы: `toThrow(ZodError)` или `toThrow(/facts|inspectionProgress/i)`. |
| 3 | важно | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` | Два `describe.skip`: машины состояний Shift/Handover/Permit (PRD §6, ADR-0041) и оценка готовности (PRD §5). | Тесты никогда не выполняются, но файл с именем `*.todo.test.ts` и рабочей `describe('Audit canonicalization…')` создаёт видимость покрытия контура готовности; правила переходов и `evaluate` не проверены нигде. | Либо реализовать адаптер и снять `skip`, либо перенести в трекер и убрать из сюиты, чтобы не читалось как покрытие. |
| 4 | мелочь | `src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx:6` | Ложная фикстура: всё состояние — `{incidents: []} as unknown as OperatorMobileState`. | Проверяется только форма (активность кнопки и подсказка). Отрисовка списка происшествий не проверена; если её сломать, тест останется зелёным — пустой `incidents` этого не покажет. | Добавить кейс с непустым `incidents` (проверка отрисовки) либо явно назвать фикстуру «только для формы» и не считать это покрытием списка. |
| 5 | мелочь | `src/components/piling/to/readiness/screens/fleet-screen.test.tsx:359-363` | «Неизвестный снимок не показывает счётчик причин»: `currentReadiness: []` + `queryByRole('button', /Открыть основания оценки/)).not.toBeInTheDocument()`. | Негативное утверждение на пустых данных: если строка парка вообще не отрендерится (ошибка монтирования), тест всё равно зелёный. Нет парного позитивного утверждения. | Добавить `expect(screen.getByRole('button', {name: 'Выбрать Установка 1'})).toBeInTheDocument()` — строка парка на месте, а счётчика причин при этом нет. |
| 6 | мелочь | `src/components/piling/operator-mobile/offline-queue-banner.test.tsx:92,151,152,166,175` | `expect(screen.getByText(reason)).toBeTruthy()` и `getByRole(...).toBeTruthy()` (5 мест). | `getBy*` уже бросает, если узел не найден, поэтому `.toBeTruthy()` не добавляет проверки и не фиксирует, что узел именно в документе. | Заменить на `.toBeInTheDocument()`. |
| 7 | мелочь | `src/components/piling/operator-mobile/screens/__tests__/knowledge-screen.test.tsx:104` | `expect(onDone).toHaveBeenCalledWith(expect.any(Array), 'token-1')`. | Содержимое отправленных ответов не проверено: пустой массив пройдёт. Не подтверждается, что на сервер уходят именно выбранные варианты. | Указать точный ожидаемый массив ответов (по `itemId`/`picked`) вместо `expect.any(Array)`. |
| 8 | мелочь | `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:290-294` | «Два набора подряд не совпадают»: `new Set([first, second, third]).size toBeGreaterThan(1)`. | Имя обещает «два подряд не совпадают», а проверка проходит, даже если совпали два из трёх; сама формулировка вероятностная (возможен флейк при неудачном старте ГПСЧ). | Утверждать `expect(first).not.toBe(second)` (или несколько независимых пар) либо сравнить число уникальных тем/порядок. |
| 9 | мелочь | `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:310` | `expect(question.options[question.correct]).toBeTruthy()`. | «У каждого вопроса верный вариант существует»: `toBeTruthy` пройдёт и для пустой строки, и не проверяет, что индекс в границах. | Проверить явно: `correct` — целое в `0..options.length-1`, а `options[correct]` — непустая строка. |
| 10 | мелочь | `src/components/piling/to/readiness/screens/__tests__/shared.test.tsx:5,15-34,71-90` | `vi.useFakeTimers()` вызван на уровне модуля (строка 5) и нигде не откатывается; тесты 15-34 и 71-90 — один и тот же сценарий дебаунса, продублированный. | Фейковые таймеры без `afterEach(vi.useRealTimers())` протекают на весь файл; дубль не даёт нового покрытия, но увеличивает число «зелёных» тестов. | Перенести включение/выключение таймеров в `beforeEach`/`afterEach`; убрать дубликат. |
| 11 | мелочь | `src/components/piling/to/readiness/module-tab-list.test.tsx:25`; `tech-readiness-module.test.tsx:36,62` | `expect(tabs).toHaveLength(MODULE_TABS.length)` — сверка с той же константой, что рендерит компонент. | «Утверждённый порядок/число вкладок» проверить нельзя: правка `MODULE_TABS` пройдёт молча — тест тавтологичен по числу. | Зафиксировать ожидание константой в тесте (список меток/длину), а не импортом `MODULE_TABS`. |
| 12 | мелочь | `src/components/piling/operator-mobile/offline-queue.test.ts:167` | `await expect(sendCommand(wrong)).rejects.toBeTruthy()`. | Любой reject считается успехом, включая ошибку не того класса. Рядом проверяется `readQueue()[0].state`, но не причина. | `rejects.toBeInstanceOf(ApiError)` + проверка `.status === 409`. |
| 13 | мелочь | `src/components/piling/operator-mobile/__tests__/use-offline-queue.test.tsx:21,27-28` | Заглушечная фикстура `{state:'PENDING'} as QueuedCommand` и `flushQueue.mockResolvedValue({sent: 0})`. | Тест проверяет только число вызовов `flushQueue`; содержимое очереди и результат слива не влияют на утверждения, поэтому «пустая» заглушка маскирует любые ошибки в данных очереди. | Наполнить `readQueue` реальным `QueuedCommand` и проверить, что `flush` вызывается с ним / результат слива используется. |
| 14 | мелочь | `src/components/piling/to/readiness/tech-readiness-module.test.tsx:49` | `expect(root.innerHTML).not.toMatch(/100vh-\|min-w-\[(?:1280\|1440)px\]/)`. | Регресс-страж на конкретные «тяжёлые» размеры: сработает только на два заданных значения, любая другая фиксированная ширина не будет поймана. | Проверять по признаку (наличие любого `min-w-[NNNpx]`/`h-screen`), а не по двум зашитым числам. |

Дополнительно (только `path:line`, вне таблицы): `offline-queue.test.ts:193,252`
— `.every(...)` на очереди (вакуумно-истинно при пустом массиве, здесь непустой);
`fleet-screen.test.tsx:138` — `expect.any(AbortSignal)`;
`authoritative-presentation.test.ts:57` — `.every(...)` на непустом списке.

По браку «г» (мок возвращает то, что проверяется) прямых совпадений не найдено:
там, где мок задаёт входные данные, проверяется результат их обработки
(фильтрация/форматирование/рендер), а не эхо самого мока. Ближайшее к тавтологии
— п. 11 (сверка с импортированной константой).

## Не проверено

- Мутации кода не запускал: правило 1 запрещает любые правки, поэтому вывод
  «тест пройдёт вхолостую» сделан чтением, а не экспериментом «сломать и
  увидеть красное». Для п. 1 не подтверждено запуском, что `verifyKnowledgeAttempt`
  действительно бросает разные ошибки на разные ветки — судил по тексту теста и
  `toThrow` без аргумента.
- Не читал production-код под каждой проверкой подряд: открывал только те
  строки теста, которых достаточно для суждения о слабости утверждения.
- Замороженные зоны (варианты операторского экрана, ORION) не анализировал,
  кроме явно названных в задаче путей; `src/modules/readiness/**` целиком не
  просматривал — п. 3 возник попутно по имени файла `*.todo.test.ts`.
- `e2e`/Playwright и `npm run build` не запускал (read-only аудит тестов).
- Существующие отчёты `docs/audits/hermes-night/06-test-gaps.md` и
  `13-readiness-e2e-skip.md` не сверял с этой находкой — возможны пересечения.
- Строковые UI-тесты (`field-readability.test.tsx` и подобные), проверяющие CSS-
  классы, не оценивал как слабые: это задокументированные стражи откатов, а не
  проверки поведения; вреда не нашёл, но и не проверял их актуальность.
