# AU152-S3-DICTIONARY-ADMIN-UX — Справочники: администрирование

Версия кода: `git rev-parse HEAD` = `033a577dbe5399ee5a0a19d3e3b2766bd5caa1ec` (ветка `hermes/q4-0926`).
Режим: только чтение, код приложения не менялся. Создан один файл — этот отчёт.

## Итог

- Найдено 12 замечаний: **0 критично, 5 важно, 7 мелочь**. Отчётных уязвимостей уровня «данные теряются по одному клику» не найдено.
- Защита от удаления используемого значения работает и на клиенте, и на сервере: 409 при `reportCount > 0 || planCount > 0` (`src/services/dictionaries/dictionary-service.ts:415`), кнопки «Удалить»/«Переименовать» заблокированы для используемых (`src/components/piling/admin-dictionaries/dictionary-table.tsx:139,163,277`). Проверка покрывает **все** внешние ключи трёх справочников (см. таблицу ниже).
- Топ-5 по важности:
  1. Архивация **последнего активного** значения не предупреждает, что у операторов опустеет список (в отличие от массовой архивации, где подтверждение есть). `src/components/piling/admin-dictionaries.tsx:346`
  2. Проверка использования и `delete` не в транзакции: гонка + FK `SitePilePlan.onDelete: Cascade` (`prisma/schema.prisma:1785`) — при гонке план удаляется молча; а FK `PileWork.onDelete: Restrict` (`prisma/schema.prisma:2200`) даёт P2003, который **не** маппится и превращается в 500 «Внутренняя ошибка сервера» (`src/core/api-wrapper.ts:26`).
  3. `PATCH` не атомарен: до 6 последовательных записей в БД на один запрос, отказ на середине оставляет частично применённые изменения (`src/app/api/dictionary/manage/route.ts:125`).
  4. Текст отказа zod-схемы PATCH содержит английские имена полей и показывается пользователю (`src/app/api/dictionary/manage/route.ts:65`).
  5. Массовая смена статуса шлёт N параллельных PATCH при лимите 100/мин на маршрут+сессию (`src/components/piling/admin-dictionaries.tsx:371`, `src/core/api-wrapper.ts:170`).

## Методика

- `git rev-parse HEAD`, `git status --short`, `git branch --show-current` — версия и состояние дерева.
- Поиск по репозиторию: `grep -rn` по `src`, `prisma/schema.prisma`, `e2e` (`dictionar`, `pileGradeId`, `typeId`, `reasonId`, `dictionary.manage`, `userDocumentType`).
- Прочитаны целиком (не фрагментами):
  - `src/app/(app)/admin/dictionaries/page.tsx`, `layout.tsx`
  - `src/app/api/dictionary/manage/route.ts` (147 строк), `src/app/api/dictionary/all/route.ts`
  - `src/services/dictionaries/dictionary-service.ts` (425), `system-templates.ts` (41), `tenant-dictionary-initializer.ts` (59)
  - `src/components/piling/admin-dictionaries.tsx` (694), `admin-dictionaries/dictionary-table.tsx` (305), `admin-dictionaries/dictionary-form.tsx` (119)
  - `src/core/api-wrapper.ts`, `src/lib/service-error.ts`, `src/lib/api-error-message.ts`, `src/lib/require-page-ability.ts`, `src/components/piling/admin-crews/crew-messages.ts`, `src/services/service-error.ts`
  - тесты: `.../dictionary-service.test.ts`, `.../manage/__tests__/route.test.ts`, `.../admin-dictionaries.test.tsx`, `e2e/admin-dictionaries.spec.ts`
- Схема БД: `grep -n "/^model Site/"`, разбор тел `SitePilePlan` (1780), `SiteDrillingPlan` (1797), `PileWork` (2179+), `LeaderDrilling`, `ReportDowntime`, моделей `PileGrade` (2439), `DrillingType` (2468), `DowntimeReason` (2485).
- Тесты (команда из AGENTS.md, полный вывод, без `| tail`):
  `node node_modules/vitest/vitest.mjs run src/services/dictionaries src/app/api/dictionary src/components/piling/admin-dictionaries`
  → `Test Files 5 passed (5)`, `Tests 67 passed (67)`, `EXIT=0`. Пропущенных нет.

## Операции и защита по справочникам

Общий код маршрута: `src/app/api/dictionary/manage/route.ts`; общий сервис: `src/services/dictionaries/dictionary-service.ts`.

| Справочник | Операция (код) | Защита | файл:строка |
|---|---|---|---|
| Сваи (pileGrade) | Создать | схема: имя 1..100, `lengthMm` обязательна и >0 | `src/app/api/dictionary/manage/route.ts:26-32`; `src/services/dictionaries/dictionary-service.ts:63-67,94` |
| Сваи | Дубликат имени | P2002 → 409 «Элемент с таким названием уже существует» | `src/services/dictionaries/dictionary-service.ts:69-82` |
| Сваи | Переименовать | запрещено, если есть отчёты/планы → 409; на клиенте кнопка disabled | `dictionary-service.ts:388-391`; `dictionary-table.tsx:139,252-256`; `admin-dictionaries.tsx:251,564` |
| Сваи | Архивировать / восстановить | защиты нет (архивация разрешена всегда); `archivedAt` ставится только при переходе из активной | `dictionary-service.ts:254-289` |
| Сваи | Изменить длину | 0 → 400; `null` у используемой → 422; смена у используемой без `confirmRecalculate` → 409 | `dictionary-service.ts:63-67,312-318` |
| Сваи | Сечение / примечание | только для pileGrade (иначе 400); лимиты 100/500 символов; проверки использования нет | `route.ts:122-124`; `dictionary-service.ts:327-371` |
| Сваи | **Удалить** | 409, если `reportCount>0` **или** `planCount>0`; кнопка disabled для используемых | `dictionary-service.ts:414-417`; `dictionary-table.tsx:163,277` |
| Бурение (drillingType) | создать / переименовать / архивировать / удалить | те же правила; `planCount` всегда 0 (плана по типу бурения в схеме нет — `SiteDrillingPlan` хранит `diameter`, FK нет) | `dictionary-service.ts:165-172,388-391,414-417`; `prisma/schema.prisma:1797-1809` |
| Простои (downtimeReason) | создать / переименовать / архивировать / удалить | те же правила; `planCount` всегда 0 | `dictionary-service.ts:173-178,388-391,414-417` |

Покрытие внешних ключей (почему защита удаления полна):

| Справочник | FK в БД | onDelete | Учитывается в `getItemUsage` |
|---|---|---|---|
| PileGrade | `PileWork.pileGradeId` | Restrict (`prisma/schema.prisma:2200`) | да — `report.groupBy(piles: some)`, `dictionary-service.ts:156-163` |
| PileGrade | `SitePilePlan.pileGradeId` | **Cascade** (`prisma/schema.prisma:1785`) | да — `sitePilePlan.count`, `dictionary-service.ts:161` |
| DrillingType | `LeaderDrilling.typeId` | Restrict (`prisma/schema.prisma:2378`) | да — `report.groupBy(drillings: some)`, `dictionary-service.ts:166-170` |
| DowntimeReason | `ReportDowntime.reasonId` | Restrict (`prisma/schema.prisma:2423`) | да — `report.groupBy(downtimes: some)`, `dictionary-service.ts:173-177` |

Авторизация: `dictionary.manage` = только `ADMIN` (`src/services/auth/authorization-service.ts:129`); защита страницы — `requirePageAbility` (`src/app/(app)/admin/dictionaries/layout.tsx:4`), всех четырёх обработчиков — `assertCan` (`route.ts:76,100,115,139`); учёт режима «Действую как» — `can()` считает по исполняемой роли (`authorization-service.ts:158`). ПРОЙДЕНО.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление | статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-dictionaries.tsx:346-361` | Одиночная архивация не предупреждает, что архивируется последнее активное значение | Админ архивирует единственную активную «причину простоя» → в форме оператора пустой список; откат только вручную через фильтр «Архив». Массовая архивация предупреждение имеет (`dictionary-table.tsx:295`), одиночная — только тост и «Отменить» на 10 с | Перед архивацией считать число активных того же вида и, если остаётся 0, показывать подтверждение как при массовой | ПРОЙДЕНО (код) |
| 2 | важно | `src/services/dictionaries/dictionary-service.ts:414-419`; `prisma/schema.prisma:1785,2200`; `src/core/api-wrapper.ts:26-29` | Проверка использования и `delete` не в одной транзакции | Между `getItemUsage` и `model.delete` оператор может создать отчёт/план. Если создан план — FK `SitePilePlan` с `onDelete: Cascade` удалит его **молча**; если создана свая — FK `Restrict` даст Prisma P2003, который не в списке `PRISMA_STATUS` и превращается в 500 «Внутренняя ошибка сервера» вместо 409 | Обернуть проверку и удаление в одну транзакцию; добавить P2003 в маппинг `api-wrapper` с понятным текстом | ПРОЙДЕНО (код), ГИПОТЕЗА (гонка не воспроизведена — нет БД) |
| 3 | важно | `src/app/api/dictionary/manage/route.ts:125-131` | `PATCH` выполняет до 6 независимых записей в БД без транзакции | Запрос с `name` + `sectionOrDiameter` + `notes` + `lengthMm`: `rename` уже применён, а `setPileGradeLength` отвечает 409/422 → в базе частично новые данные, клиент видит одну ошибку и не перечитывает список | Выполнять все изменения одного запроса в `db.$transaction` | ПРОЙДЕНО (код) |
| 4 | важно | `src/app/api/dictionary/manage/route.ts:65`; `src/lib/api-error-message.ts:20-24` | Текст отказа схемы PATCH — с английскими именами полей: «Укажите хотя бы одно поле: name, isActive, lengthMm, sectionOrDiameter или notes» | Любой PATCH без известных полей (в т.ч. только `confirmRecalculate`) отдаёт эту строку как **заголовок** тоста. В русском UI это техническая строка | Переписать сообщение по-русски без имён полей | ПРОЙДЕНО (код) |
| 5 | важно | `src/components/piling/admin-dictionaries.tsx:371-389`; `src/core/api-wrapper.ts:170,212-219` | Массовая смена статуса — N параллельных `PATCH`, лимит 100/мин на маршрут+сессию | «Выбрать все» на справочнике >100 записей: часть запросов получает 429 и не применяется; тост сообщает только число неудач (`:386`), без причины и без списка записей | Серверный batch-эндпоинт (один запрос) либо последовательная отправка с ограничением параллелизма | ПРОЙДЕНО (код), ГИПОТЕЗА (размер справочника у тенанта не проверен) |
| 6 | мелочь | `src/lib/api-error-message.ts:29-47,85`; `src/app/api/dictionary/manage/route.ts:104` | Ошибки полей показывают технические пути: «Поле lengthMm: …» | Карта подписей знает только поля отчёта (`REPORT_FIELD_LABELS`, `REPORT_LINE_SECTIONS`); поля справочников туда не добавлены, путь печатается как есть | Добавить подписи полей справочника (`lengthMm` → «Длина, мм», `type` → «Тип») | ПРОЙДЕНО (код) |
| 7 | мелочь | `src/components/piling/admin-dictionaries/dictionary-form.tsx:85,101,105` vs `src/app/api/dictionary/manage/route.ts:21,23,24` | Форма создания не ограничивает длину `code` (≤100), `sectionOrDiameter` (≤100), `notes` (≤500), схема — ограничивает | `maxLength` только у «Название» (`:78`); длинное «Примечание» даст 400 «Некорректные данные» вместо подсказки (в панели сведений `maxLength={500}` есть — `admin-dictionaries.tsx:581`) | Поставить `maxLength` на три поля формы | ПРОЙДЕНО (код) |
| 8 | мелочь | `src/app/api/dictionary/manage/route.ts:118-131` | Нет оптимистичной блокировки | Два админа правят одну марку: побеждает последняя запись, первый не узнаёт, что его правку перезаписали | Передавать `updatedAt` и отклонять устаревшую правку (409) | ПРОЙДЕНО (код) |
| 9 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:229`; `src/services/dictionaries/dictionary-service.ts:60-61`; `prisma/schema.prisma:2449-2452` | Марка без длины (`lengthMm = null`) считается как 0 м молча | Активная марка без длины даёт нулевой метраж во всех потребителях (аналитика, журнал, PDF); подсветка есть только в колонке таблицы, в отчётах это неотличимо от нуля | Предупреждать в сводке о марках без длины (счётчик), а не только цветом ячейки | ПРОЙДЕНО (код) |
| 10 | мелочь | `src/app/api/dictionary/all/route.ts:9-19`; `src/lib/cached-queries.ts:68-73` | `GET /api/dictionary/all` не проверяет право: любой аутентифицированный получает активные и архивные значения своей организации | Читать справочники может и `OPERATOR` — для форм это, видимо, задумано, но граница «кто читает» нигде не зафиксирована и отличается от `dictionary.manage` вкладки | Зафиксировать решение в комментарии или ввести отдельное право `dictionary.read` | ПРОЙДЕНО (код), ГИПОТЕЗА (намерение) |
| 11 | мелочь | `src/components/piling/admin-dictionaries.tsx:384-386` | При массовой смене статуса не видно, какие записи не изменились | Пользователь видит «Не удалось изменить статус: 3» и не знает, какие три, — повторяет операцию вслепую | Показывать имена неудачных записей или обновлять фильтр по ним | ПРОЙДЕНО (код) |
| 12 | мелочь | `src/services/dictionaries/dictionary-service.ts:275-279` | Массовая архивация пишет по одной записи аудита на элемент | Массовое действие неотличимо в журнале от серии одиночных; в истории элемента это нормально, но нет общей записи «архивировано N» | Писать одну сводную запись аудита на массовое действие | ПРОЙДЕНО (код) |

## Что не проверено

- **Не запускал E2E Playwright** (`e2e/admin-dictionaries.spec.ts` прочитан, но не выполнен): нужен сервер и БД (AGENTS.md §6 требует env/БД). Число собираемых тестов Playwright не считал.
- **Не воспроизводил гонки** (находки 2, 5, 8): нет доступа к живой БД; выводы сделаны по коду схемы и маршрутов, помечены как ГИПОТЕЗА там, где важен рантайм.
- **Не смотрел реальные данные тенанта `orion`** — есть ли в справочниках больше 100 записей (актуальность лимита 100/мин для находки 5).
- **Не проверял визуально** экран в браузере: только чтение кода и юнит-тесты (5 файлов, 67 тестов).
- **Не проверял RLS/политики уровня БД** для трёх справочников; оценивал только приложение.
- **Не проверял пути создания отчётов** (фильтруют ли они архивные значения) — вне рамок вкладки.
- **Не проверял** полный `invalidateDictionaries` по цепочке кэшей.
- **Не читал** `.env*` (запрещено AGENTS.md §1) и существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` (запрещено заданием).
- **Вне вкладки, для сведения:** справочник видов документов (`userDocumentType`) управляется отдельным сервисом `src/services/users/user-document-types.ts` (удаление с проверкой использования и с тенантным отбором, `:137-150`) и в вкладку `admin-dictionaries` не входит.
