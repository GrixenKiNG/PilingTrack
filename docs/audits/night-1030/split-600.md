# Чистое деление файлов — задача 6

Ветка codex/split-600-1030, база c204d90e23588177a875cb9449269b89275db671. Выполнены семь переносов верхнего уровня. Исключения по размеру указаны ниже: требование не менять тела и параметры функций важнее механического достижения 600 строк. Финальные общие gates привязаны к d3a0209d332da0df74a51bf813ea98dcc6de82ea, src tree 005846dcd902d328f94299f15d042590614f7585. Коммит отчёта меняет только документы и станет HEAD завершённой ветки.

| Коммит | Исходный файл | Строк до → после | Новый файл | Строк | Объявлений дословно |
|---|---|---:|---|---:|---:|
| 1214b85b40fa3a4010b65a7caa671148c3bd8340 | src/components/piling/to/readiness/screens/settings-workspace.tsx | 668 → 583 | src/components/piling/to/readiness/screens/settings-workspace-config.ts | 93 | 11 |
| c1b471145743f33249bf09f2ee9bc73ffd13f3ed | src/components/piling/to/readiness/screens/reports-screen.tsx | 630 → 570 | src/components/piling/to/readiness/screens/reports-screen-period.ts | 63 | 11 |
| 6d3ddb16b6ea12d152482cb1c20290ff190627dd | src/components/piling/to/readiness/screens/briefings-screen.tsx | 609 → 531 | src/components/piling/to/readiness/screens/briefings-screen-format.tsx | 77 | 12 |
| d19a826a8a1960c4442708690ed6287b33915748 | src/components/piling/admin-dictionaries.tsx | 694 → 647 | src/components/piling/admin-dictionaries-support.ts | 54 | 9 |
| e9d817baff268c3c8d32e735fe7f8369a2fb1951 | src/components/piling/admin-reports/admin-reports.tsx | 630 → 576 | src/components/piling/admin-reports/report-list-controls.tsx | 59 | 6 |
| 4aca38e2a5cd8e01e738f37244babadef1940c02 | src/components/piling/admin-sites/index.tsx | 604 → 397 | src/components/piling/admin-sites/site-detail.tsx | 201 | 11 |
| d3a0209d332da0df74a51bf813ea98dcc6de82ea | src/modules/reports/application/event-handlers.ts | 684 → 383 | src/modules/reports/application/event-handlers-analytics.ts | 307 | 19 |

Удалённых файлов нет. Каждое тело функции, JSX, сигнатура, значение, текст, класс, aria/testid, запрос и комментарий сохранены. Менялись import/export и размещение существующих объявлений. AST сравнивает все объявления исходного файла, включая оставшиеся на месте, игнорируя только начальное export и CRLF. Множество публичных экспортов старого пути проверено отдельно и совпало; внешние импортёры не изменены. Новые модули лежат рядом, относительные импорты сохраняют адресатов. Старые client entrypoints сохранили use client; локальная Next-документация use-client.md подтверждает транзитивный client boundary без директивы в каждом дочернем модуле.

## Проверки по шагам

| Шаг | Pure | tsc | Каталог Vitest: exit; passed/skipped/failed | lint | Fresh index / detect CLI / полный detect |
|---|---:|---:|---|---:|---|
| settings | 0 | 0 | 0; 400/0/0 | 0, 0 warnings | 0/0/0 |
| reports-screen | 0 | 0 | 0; 400/0/0 | 0, 0 warnings | 0/0/0 |
| briefings | 0 | 0 | 0; 400/0/0 | 0, 0 warnings | 0/0/0 |
| dictionaries | 0 | 0 | 0; 24/0/0 | 0, 0 warnings | 0/0/0 |
| admin-reports | 0 | 0 | 0; 70/0/0 | 0, 0 warnings | 0/0/0 |
| sites | 0 | 0 | 0; 57/0/0 | 0, 0 warnings | 0/0/0 |
| events | 0 | 0 | 0; 268/5/0 | 0, 0 warnings | 0/0/0 |

Полный вывод check-pure-move.cjs после каждого файла (база и все пути в split-600.json):

```text
settings:
строк кода до: 627, после: 627
OK: чистый перенос, отличаются только import/export

reports-screen:
строк кода до: 591, после: 591
OK: чистый перенос, отличаются только import/export

briefings:
строк кода до: 547, после: 547
OK: чистый перенос, отличаются только import/export

dictionaries:
строк кода до: 626, после: 626
OK: чистый перенос, отличаются только import/export

admin-reports:
строк кода до: 568, после: 568
OK: чистый перенос, отличаются только import/export

sites:
строк кода до: 516, после: 516
OK: чистый перенос, отличаются только import/export

events:
строк кода до: 621, после: 621
OK: чистый перенос, отличаются только import/export
```

Diff от базы, добавлено/удалено по каждому файлу:

```text
54	0	src/components/piling/admin-dictionaries-support.ts
5	52	src/components/piling/admin-dictionaries.tsx
4	58	src/components/piling/admin-reports/admin-reports.tsx
59	0	src/components/piling/admin-reports/report-list-controls.tsx
6	213	src/components/piling/admin-sites/index.tsx
201	0	src/components/piling/admin-sites/site-detail.tsx
77	0	src/components/piling/to/readiness/screens/briefings-screen-format.tsx
4	82	src/components/piling/to/readiness/screens/briefings-screen.tsx
63	0	src/components/piling/to/readiness/screens/reports-screen-period.ts
3	63	src/components/piling/to/readiness/screens/reports-screen.tsx
93	0	src/components/piling/to/readiness/screens/settings-workspace-config.ts
6	91	src/components/piling/to/readiness/screens/settings-workspace.tsx
307	0	src/modules/reports/application/event-handlers-analytics.ts
2	303	src/modules/reports/application/event-handlers.ts
```

Дополнительный git diff --cached --check на шаге sites вернул2: site-detail.tsx:142 содержит19 пробелов. Это дословно исходная строка545 index.tsx из c204d90e; AST/pure совпали. Строку сознательно не подчищали в обход правила неизменности тел. Шаги tsc/lint/57 тестов/graph прошли0; этот дополнительный nonzero не скрыт.

В git diff --color-moved=dimmed-zebra обычных зелёных добавленных строк: 146. Это эвристика, а не число изменённых операторов: import/export и короткие фрагменты могут не распознаться как перенос. Полные color-moved/non-moved журналы сохранены снаружи. Строгое доказательство — pure-move и AST, все объявления совпали.

## Общие gates

Каждая команда отдельно; реальные child exit codes, без pipe, скрывающего ошибку. Fresh worktree: stale .next/dev/types отсутствовал. node_modules — junction на существующие зависимости, без npm install/ci. Prisma generate0 выполнен с ignored schema-only config без datasource/URL/DB/выдуманных env.

| Команда | До | После |
|---|---|---|
| npx tsc --noEmit |0|0|
| npm run lint |0, 0 warnings|0, 0 warnings|
| npx vitest run |0; 5856 passed / 281 skipped / 0 failed|0; 5856 passed / 281 skipped / 0 failed|
| npx playwright test --list |0; 429 / 31 файлов|0; 429 / 31 файлов|
| npm run build |1; нет DATABASE_PROVIDER/SESSION_SECRET|1; нет DATABASE_PROVIDER/SESSION_SECRET, Next не достигнут|
| Все затронутые каталоги Vitest |0; 883/5/0|0; 883/5/0|

Skipped — не проверенные DB-сценарии. В полном итоговом Vitest присутствуют MaxListenersExceededWarning; они сохранены в логах и не являются ESLint warnings. Build не считается зелёным; нет браузерного или production доказательства.

## HTML до и после

Внешние копии существующих сценариев, без изменения тестов репозитория. За основу взяты инструменты D:/PillingR/split-1024-tools: move.cjs, capture-template.txt, extractable.cjs и pure-move; рядом находятся собственные AST/graph/runner helpers. Снимки raw innerHTML, без нормализации DOM, после контролируемых завершённых состояний. Date фиксируется, RAF синхронно исполняется только во внешнем sampler, затем три act/flush прохода по40мс.

До правок: два прогона по108 passed,108 файлов (103 с DOM) совпали побайтно (fixed-stability.json). После: 108 passed; 108 файлов (103 с DOM, остальные5 — проверки экспортного API без render); changed=[], added=[]. Это happy-dom пяти выбранных suites, не живой браузер и не все состояния продукта.

Исходные попытки sampler сохранены: Windows backslash в include дал collection0/exit1; неверное преобразование CSS selectors дало ошибки harness. Первые160-case прогоны показали нестабильные промежуточные Radix animation styles; общий sampler с ожиданием также однажды дал159/1 RED в ToModule. Он исключён из финального sampler, поскольку ToModule не переносился; его исходные тесты остаются в обязательном полном/целевом Vitest без правок. Контроль Date и RAF понадобился для воспроизводимого эталона, не является исправлением продукта. Все эти попытки выполнены до source-правок.

## Граф

До правок свежий индекс, query/context и file-qualified upstream impact55 символов:25LOW,20UNKNOWN,10HIGH; все partial=false/truncated=false, ошибок нет. HIGH предупреждение владельцу выдано до переноса. HIGH: tenantDay/dayToUtc/shiftDay/formatTenantDay/resolveReportPeriod/average/deltaDetail, dayInTimezone, pct, ProgressBar. Полные callers/processes/risk в split-impact-*.json; UNKNOWN и HIGH проверены rg по src/e2e/tests/scripts/prisma. Ничего не удалялось на основании нулевых callers.

Финальное сравнение с c204d90e:88 символов,14 файлов,9 затронутых процессов, риск HIGH, partial=false/truncated=false; предупреждение перед итоговым docs-коммитом выдано. Это охват графа, не доказательство дефекта или отсутствия регрессии.

Перед каждым кодовым коммитом fresh index --index-only --force, detect CLI и полный ответ backend, partial/truncated проверены. Общие execution flows индексатора ограничены бюджетами: отсутствие flow не доказывает отсутствие пути. Извлечения сохранены дословно и проверены каталогами тестов.

## Что оставлено и решение владельца

- to-module.tsx:716 строк, сама ToModule647. Готовых верхнеуровневых блоков уже нет. Единственный крупный JSX-блок (695–714) требует10 замкнутых значений.
- readiness-centre.tsx:776 строк, ReadinessCentre745. Блоки244–273 и745–761 требуют presentation/props; их превращение в компоненты меняет тело исходной функции и выходит за чистый перенос.
- admin-dictionaries.tsx: вспомогательные типы/состояние/данные перенесены, но AdminDictionaries615 строк целиком осталась. Например594–611 зависит от history,528–557 — panelWidth/setPanelWidth/startResize,654–664 — formatMetres/lengthConfirm (номера исходной базы).
- inspection-commands.ts:595 строк уже ниже порога; оставлен без изменения. Его существующие тесты включены в общую базовую/финальную выборку.
- RulesSettings осталась на месте: существующий статический authority-test читает этот файл; переносились только константы и готовый downloadCsv, тест не переписан.

Нужно решение владельца для оставшихся крупных функций: (1) принять исключения при строгом переносе; (2) отдельным заданием разрешить извлечение JSX с параметрами и отдельной проверкой поведения. Новых дефектов приложения не исправлялось.

Не менялись файлы задач1–2, операторские версии, ORION, auth/security/RLS, схема, миграции, Docker/compose/deploy, зависимости, .env, существующие тесты. Никакие рабочие папки/junction не удалены. Стенд/БД/контейнеры не поднимались; долгие процессы — только собственные проверки. Push/merge/deploy/SSH/production не выполнялись. Полные журналы: D:/PillingR/night-logs/codex-1030/split-*; кодовые SHA независимы от остальных задач ночи.
