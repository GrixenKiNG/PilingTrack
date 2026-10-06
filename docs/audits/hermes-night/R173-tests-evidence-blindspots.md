# R173 — Что реально доказывают новые тесты F-N1004 и F-R140/R141

READ-ONLY аудит существующих тестов. Ни один тест-файл не создавался, не удалялся и не изменялся;
единственная запись — этот отчёт. Код, схема Prisma, `.env`, auth/security, tenancy, замороженные
операторские варианты и ORION не трогались. Сервер не поднимался, браузер не запускался,
production/учётные записи владельца не использовались.

## Итог

- Находок **14**: **критично — 0**, **важно — 5**, **мелочь — 9**. Все девять тест-файлов F-N1004 и
  F-R140/R141 проверены фактическим прогоном: `Test Files 9 passed (9)`, `Tests 141 passed (141)`,
  **0 skipped, 0 failed, 0 expected fail** (команда — в «Методике»). Тесты не «зелёные на бумаге», но
  часть из них доказывает меньше, чем читается по названию.
- Топ-5:
  1. **важно** — тест F-R141-SHIFT-WEEK **зависит от календарного дня**: `today` вычисляется реальными
     часами ДО включения фейковых (`to-module-shell.test.tsx:592`), а компонент считает окно по
     фиксированному `NOW = 2026-10-05`. Сегодня совпадает и тест зелёный; завтра он упадёт (№1).
  2. **важно** — mock модуля `@/lib/api` в `use-reports-data.test.ts:13` неполон: отдаёт только
     `authFetch`, а хук импортирует ещё `loadJson` и `isAbort` (`use-reports-data.ts:3`). В каждом
     тесте файла эффект чтения списков для отбора падает в `catch`; ветки mock'а для `/api/sites|users|
     equipment` мертвы, а `filterError` не проверяется ни разу (№2).
  3. **важно** — mock `@/modules/readiness` в `to-module-shell.test.tsx:30-35` неполон, а ветка
     `to-module.tsx:681-715` «снимок есть» (маппинг `presentation.outcome` → `EquipmentReadiness`)
     не исполняется ни одним тестом: все кейсы подают пустой `currentReadiness` или отказ (№3).
  4. **важно** — устойчивость пагинации (F-R140-PAGING) доказана против **самодельной модели** Prisma-
     курсора (`report-query.service.test.ts:192-217`), а не против БД; реальная keyset-семантика,
     коллация и `NULL`-даты не покрыты. DB-mock (там же `:23-31`) не содержит `db.pileGrade`, который
     реальный сервис вызывает (`report-query.service.ts:100`) (№4).
  5. **важно** — **реального браузера нет**: все девять файлов — jsdom/RTL; ни один e2e-спек не
     проверяет подсветку блокеров, фильтр статуса/сортировку списка отчётов и догрузку при пустом
     отборе (№5).

## Методика

Воспроизводимо без Python (только `git`/`node`/`read_file`/`search_files`), рабочая копия
`D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `e0c1a3df`, дерево чистое.

1. Прочитан `AGENTS.md` (модель доверия, заморозка оператора/ORION, «выглядит мёртвым, но живёт»).
   Рабочая копия зафиксирована `git status`/`git branch --show-current`.
2. Отбор тестов: `git log` и `git show --stat` по коммитам партии —
   F-N1004: `0bbd1ee0, 8a913c5e, e3f77f5f, 468f3a2e, 99b06fe3, 36fa7e87, 8a535724, b8d45058,
   9c4b9c27, 07853c60`; F-R140/R141: `67664a62, 8080f369, 89bbf5b4, a345dcda, ba5387ff, 9eb0fc34,
   43bd6031, f0e9c031, 2dd864fa, 394246a1, a92d9752, 4b4af9bc`.
   `git show --stat --format="" <sha> | grep -Ei 'test|spec'` дал девять затронутых тест-файлов; все
   они **существующие** (`git log --diff-filter=A -- <file>` — добавлены задолго до партии), новые
   кейсы дописаны внутрь. Именно они разобраны:
   `to-module-shell.test.tsx`, `readiness-centre.test.tsx`, `fleet-screen.test.tsx`,
   `authoritative-presentation.test.ts`, `readiness-reference-authority.test.ts`,
   `admin-reports.test.tsx`, `use-reports-data.test.ts`, `pdf-generator.test.ts`,
   `report-query.service.test.ts`.
3. Прочитан каждый тест-файл целиком и источник под ним целиком или в нужном месте:
   `use-reports-data.ts`, `admin-reports.tsx`, `report-query.service.ts`, `src/lib/pagination.ts`,
   `src/lib/api.ts`, `src/lib/pdf-generator/format.ts`, `components.ts`, `single-pdf.ts`,
   `to-module.tsx`, `authoritative-presentation.ts`, `settings-workspace.tsx`, `readiness-centre.tsx`,
   `src/lib/timezone.ts`, `playwright.config.ts`.
4. Проверки-доказательства по каждому сомнению: `search_files` по `filterError|loadJson|isAbort`,
   `safeText(`, `from '@/modules/readiness'`, `setSystemTime|useFakeTimers`, по `it/describe.skip|
   fails|todo|only`, по e2e-маршрутам `admin/to|admin/reports|readiness`.
5. Реальный прогон (не `--list`, а исполнение), один раз, без `tail`/`head` вокруг exit-кода:
   `node node_modules/vitest/vitest.mjs run <9 файлов>` → **exit 0**, `Test Files 9 passed (9)`,
   `Tests 141 passed (141)`.
6. `node -e` для проверки реальной даты хоста: `MSK 2026-10-05 | VLAD 2026-10-05 |
   UTC 2026-10-04T23:45:59Z` — этим подтверждено, почему дата-зависимый тест №1 сейчас проходит.
7. Сверены прошлые отчёты `R140`, `R141`, `MR-CHECK-1004` и коммиты партии — закрытые пункты
   (it.fails → passing, отбор по статусу, сортировка, тай-брейкер `id`) не переоткрываю.

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить |
|---|----------|-----------|----------|--------------------------|-----------------|
| 1 | важно | `src/components/piling/to/__tests__/to-module-shell.test.tsx:592,604` | Тест F-R141-SHIFT-WEEK **зависит от дня календаря**: `getTodayInTimezone()` вызывается до `renderShifts`, а `vi.useFakeTimers({now: NOW})` включается внутри (`:547`), где `NOW=2026-10-05` (`:539`). Смены строятся от **реальной** даты, окно компонента — от фиксированного `NOW` | `getTodayInTimezone` берёт реальные часы (`src/lib/timezone.ts:22`, `new Date()`), компонент под фейком — `2026-10-05`. Сегодня дата совпадает → «2» проходит. На другой день окно не совпадёт: 06.10 даст «3», 04.10 — «1» → тест **упадёт**. Ложная уверенность, зелёный только по счастливому совпадению | Считать `today` от `NOW` (или вызывать `getTodayInTimezone` уже после `vi.useFakeTimers`), тогда границы окна детерминированы; либо явно задать `vi.setSystemTime(NOW)` в `beforeEach` |
| 2 | важно | `src/components/piling/admin-reports/__tests__/use-reports-data.test.ts:13` | Mock `@/lib/api` отдаёт **только** `authFetch`, но хук импортирует ещё `loadJson` и `isAbort` (`use-reports-data.ts:3`). Обращение к отсутствующему экспорту mock'а бросает исключение внутри эффекта `loadSitesAndOperators` (`use-reports-data.ts:116-146`) | В каждом тесте файла чтение списков для отбора (объекты/операторы/установки) падает в `catch` → выставляется `filterError`; ветки `authFetchMock` для `/api/sites|users|equipment` (`:32-33,47-48,…`) **мёртвы**. Ни один тест не проверяет `filterError` → регрессия «отбор загрузился неполно» пройдёт незамеченной. Комментарий «sites + operators load fine» (`:32`) вводит в заблуждение | Собирать mock из `importActual('@/lib/api')` и подменять только `authFetch` (как уже сделано в `fleet-screen.test.tsx:12`); добавить кейс с отказом одного из списков и ассерт `filterError` |
| 3 | важно | `src/components/piling/to/__tests__/to-module-shell.test.tsx:30-35`; `src/components/piling/to/to-module.tsx:681-715` | Mock `@/modules/readiness` содержит 4 экспорта, а реальный `authoritative-presentation.ts` использует `resolveReadinessOutcome` (`:298`) и `OUTCOME_LABELS` (`:322`). Одновременно ветка «авторитетный снимок есть» в маппинге вердикта (`to-module.tsx:684 → 701-715`, `OUTCOME_STATUS[presentation.outcome]`, `canOperate`) не исполняется: во всех кейсах `currentReadiness=[]`/отказ | F-N1004-UNKNOWN-READINESS менял именно этот маппинг. Его положительная ветка (снимок со `verdict`) и перевод `outcome` в статус парка/центра не покрыты. Хуже: если добавить такой кейс, вызов `resolveReadinessOutcome` бросит — mock неполон и создаёт ловушку для расширения | Дополнить mock через `importActual`; добавить кейс с `currentReadiness` содержащим снимок с `verdict` и проверить `data-readiness` (READY/BLOCKED/решение) |
| 4 | важно | `src/modules/reports/application/queries/__tests__/report-query.service.test.ts:192-217` | `fakeFindMany` — **самодельная модель** Prisma: сортирует `orderBy`, ставит позицию по `cursor.id` + `skip`, режет `take`, а ничьи разводит синтетическим «сдвигом по номеру вызова» (`:210`). Реальная БД не задействована | Устойчивость страниц (F-R140-PAGING) доказана только против модели. Настоящая keyset-семантика Prisma/Postgres (коллация `cuid`/uuid, `cursor` по неуникальному ключу, `NULL`-даты в `orderBy`) может расходиться с моделью — тест этого не поймает. Это та самая граница, где mock повторяет ожидаемое поведение | Прогнать пагинацию на тестовой (не production) БД либо явно задокументировать, что модель — приближение; отдельно проверить крайние случаи (`NULL`-дата, одинаковый `id`-курсор) |
| 5 | важно | `report-query.service.test.ts:23-31` (mock `@/lib/db`) | Mock БД не содержит `db.pileGrade`, а сервис вызывает `db.pileGrade.findMany` в `sumSubmittedReports` (`report-query.service.ts:100`) | Сейчас латентно: путь `pilesByGrade.length > 0` не запускается (все тесты дают `pileWorkGroupBy → []`). Как только кейс заведёт непустой groupBy, `db.pileGrade` окажется `undefined` → падение/ложное покрытие; mock «уже не повторяет реализацию» | Добавить `pileGrade: { findMany: … }` в mock (или собирать mock из реального shape), чтобы путь итогов с непустыми марками свай был исполним |
| 6 | важно | девять тест-файлов + `e2e/` (10 `.spec.ts` + `role-audit.spec.js`) | **Реального браузера нет.** Все разобранные тесты — jsdom/RTL. `search_files` по `admin/to|admin/reports|readiness|Техническая готовность` в `e2e/` находит только проверку домашних маршрутов ролей (`role-audit.spec.js:6`) и счётчик строк в несобираемом `comprehensive-test.ts:120` | Ни один e2e не проверяет ни подсветку блокеров по действию, ни фильтр «Черновики/Сданные», ни сортировку, ни догрузку при пустом отборе. jsdom не даёт ни раскладки (375px/desktop), ни печати (`print-area`), ни реальных CSS-классов тона | Расширить существующий e2e-спек сценарием `?view=…` и списка отчётов на 1440 и 375px; до этого считать UI-поведение неподтверждённым |
| 7 | мелочь | `src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx:294-296,319-320` | Проверка тона через токены Tailwind-классов (`toContain('text-warning-strong')`, `not.toContain('text-destructive-strong')`) — это деталь оформления, а не поведение | Рестайл (смена класса) «сломает» верный по смыслу тест, а реальный доступный признак (что именно значит цвет) не проверяется вовсе | Дать плитке/плашке семантический признак (например `data-tone="attention|critical"`) и проверять его |
| 8 | мелочь | `src/components/piling/to/readiness/screens/fleet-screen.test.tsx:229-230,237` | То же: `toHaveClass('bg-warning/10')` / `bg-destructive/10` — проверка цвета запрета пуска по CSS-классу | Смена палитры/токена — ложное падение; поведение «возврат оператору не красный» при этом не отделено от оформления | Проверять `data-tone`/роль вместо имени класса |
| 9 | мелочь | `src/components/piling/to/__tests__/to-module-shell.test.tsx:522-526` | `kpiValue()` читает значение плитки как `.closest('div').querySelector('.text-2xl')` — хрупкая привязка к вёрстке/классу | Любое изменение разметки плитки (обёртка, другой размер класса) даст пустой/чужой текст; тест начнёт «доказывать» не то | Пометить значение плитки `data-testid` и читать его |
| 10 | мелочь | `src/lib/__tests__/pdf-generator.test.ts:366` | Новый кейс `expect(safeText(12.5)).toBe('12.5')` фиксирует **точку** в PDF, тогда как соседние правила (`formatMeters(12.5) → '12,5'`, `:272,295`) и шапка `format.ts:1-4` говорят о десятичной **запятой** | `safeText` для числа делает `String(value)` (`format.ts:11`) → точка. Сейчас недостижимо: `safeText` вызывается только с уже готовыми строками (`components.ts:170`, ячейки формируют `formatNumber/formatMeters`). Но тест закрепляет англ. формат как «правильный» и узаконит точку, если появится прямой вызов с числом | Убрать кейс или привести `safeText` к общему правилу (конечные числа — через `formatNumber`), согласовав с F-R51-FORMAT |
| 11 | мелочь | `src/components/piling/admin-reports/__tests__/use-reports-data.test.ts:277-289,344-354` | Mock `authFetch` **игнорирует `signal`** и маршрутизирует по подстроке URL (`cursor=`, `/api/reports`). Пути реального `AbortController` (`use-reports-data.ts:226,318-319,359-363`) и обработка `AbortError` (`:282`) не исполняются | Отмена устаревшей догрузки при смене отбора проверена только логикой поколения (`isCurrent`), но не фактом обрыва запроса. Плюс mock дублирует форму запроса: переименование `cursor` в URL не сломает тест, а «поедет» тихо | Мок-ответ, отклоняющийся по `signal.abort()`; один тест на реальную отмену + проверка, что `loadMoreError` не появляется при Abort |
| 12 | мелочь | `src/components/piling/admin-reports/__tests__/admin-reports.test.tsx:449-454`; `admin-reports.tsx:52-77` | Тест сортировки проверяет только порядок строк; доступное состояние сортировки (`aria-sort`/`aria-pressed`) не проверяется (в `SortHeader` их и нет) | Регрессия доступности (диспетчер со скринридером не слышит ключ/направление) останется незамеченной — это повтор `MR-CHECK-1004 №5` | Добавить `aria-sort` на активный заголовок и утверждать его в тесте |
| 13 | мелочь | `admin-reports.test.tsx:27,76-90`; `:512-526` | Набор тестов отбора/сортировки/пустой страницы **подменяет весь хук** `useReportsData` заранее собранным состоянием; `hasMore/totalReports/loadMoreReports` инъектируются | Клиентская логика фильтра/сортировки проверена изолированно (это нормально), но связка «реальный хук ↔ компонент» и поведение догрузки при пустом отборе end-to-end не доказаны: кнопка просто вызывает `vi.fn()`. Кейсы F-N1004-EMPTY-PAGE проверяют разметку веток, а не достижимость остальных страниц | Один компонентный тест с реальным `useReportsData` под mock `authFetch`: пустой клиентский отбор + `hasMore` → клик по «Загрузить ещё» доходит до сети |
| 14 | мелочь | `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` | Вне партии, но по теме «skipped»: в наборе сохранены два `describe.skip` (домен техготовности не реализован, `pendingImplementation`) | Это осознанно отложенные контракты, а не маскировка. Важно, что **в разобранной партии** никаких `skip`/`todo`/`it.fails` нет: три прежних `it.fails` (T-PDF-FORMAT) переведены коммитом `8a535724` в проходящие `it`, и правки `format.ts` реальны (`:6-13,24-40`) | Не считать пробелом; держать в уме как отдельный «отложенный домен» |

## Проверено фактическим прогоном

- `node node_modules/vitest/vitest.mjs run <девять файлов>` — **exit 0**;
  `Test Files 9 passed (9)`, `Tests 141 passed (141)`, **0 skipped / 0 failed / 0 expected fail**.
- Отдельно подтверждено, что среди разобранных файлов нет `it.skip/describe.skip/it.fails/it.only`
  (`search_files` по всему `src/` — единственные совпадения в `production-contracts.todo.test.ts`,
  вне партии).
- `safeText` вызывается только из `components.ts:170` (`search_files` по `src/`), аргументы ячеек —
  заранее форматированные строки (`single-pdf.ts:70-88`, `components.ts:207-236`).

## Не проверено

- **Реальный браузер / Playwright НЕ запускался** (только чтение конфигурации и `search_files` по
  `e2e/`). Утверждения «на 375px/desktop всё так» не делаю — нет ни сервера, ни прогона. Находка №6
  очерчивает именно этот пробел.
- **Реальная БД и Prisma не поднимались.** Вывод №4 (расхождение модели курсора и настоящего Prisma)
  — по коду модели и `src/lib/pagination.ts:36-68`, не по фактическому поведению БД. Тестовой БД в
  сессии нет, production не касался.
- **Находка №2 (падает ли реально эффект в `catch`) проверена чтением кода, а не рантайм-наблюдением
  `filterError`** — чтобы это увидеть, пришлось бы менять тест, что запрещено. Механизм: mock
  `vi.mock('@/lib/api', () => ({ authFetch }))` не отдаёт `loadJson`/`isAbort`, а вызов
  отсутствующего экспорта mock'а бросает (Vitest) — оба варианта уводят в `catch`.
- **Ветка to-module «снимок есть» (№3)** не проверялась прогоном: чтобы её достичь, нужно дополнить
  mock, а это правка теста. Вывод — по чтению `to-module.tsx:669-718` и отсутствию кейсов с
  `currentReadiness`, содержащим снимок с `verdict`.
- **Рабочие данные/снимки в БД** не читал: какие именно `verdict/outcome` приходят в проде —
  неизвестно; тон блокера на экране зависит от `action` в снимке.
- **Интеграционные спеки** (`tests/integration/tech-readiness-*.spec.ts` и др.) не запускались: без
  `.env` они молча пропускаются (AGENTS §5/§6), это вне scope партии.
- **GitNexus impact/detect_changes не запускались**: изменений кода нет (только новый `.md`), задача
  read-only.
