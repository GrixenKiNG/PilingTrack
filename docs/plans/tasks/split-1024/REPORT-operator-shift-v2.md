# Задание 6 — чистое разделение operator-shift-v2.tsx

Ветка codex/split-operator-v2. Рабочая папка D:/PillingR/wt-split-operator-v2-1024.
База — вершина main на старте: 7c5aed427732992fbec905281cd07440cccb1e94. Владелец разрешил №3–7 последовательно без ожидания промежуточной приёмки; ветки не вливать.

## Коммиты


1. Финальный перенос и этот отчёт — HEAD завершённой ветки; точный хеш в итоговом сообщении (git log -1).

## Файлы

Основной файл: 1575 → 1395 строк.

| Файл | Строк после |
|---|---:|
| src/components/piling/operator-v2/operator-shift-v2.tsx | 1395 |
| src/components/piling/operator-v2/shift-v2-parts.tsx | 185 |

Diff от базы (добавлено / удалено):

~~~text
3	183	src/components/piling/operator-v2/operator-shift-v2.tsx
185	0	src/components/piling/operator-v2/shift-v2-parts.tsx
~~~

Удалённых файлов нет. Тесты, страницы, внешние импортёры, остальные версии и замороженные файлы не изменены. Старые публичные пути/имена сохранены. Материалы владельца 00-common.md, файл задания и check-pure-move.cjs скопированы без правок; добавлен этот отчёт. Новых тестов в репозитории нет.

## Доказательство переноса

После каждого шага pure-move: код 0. Финальная команда:

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 7c5aed427732992fbec905281cd07440cccb1e94 src/components/piling/operator-v2/operator-shift-v2.tsx src/components/piling/operator-v2/operator-shift-v2.tsx src/components/piling/operator-v2/shift-v2-parts.tsx
~~~

Полный вывод:

~~~text
строк кода до: 1473, после: 1473
OK: чистый перенос, отличаются только import/export
~~~

Дополнительная проверка всех объявлений через TypeScript AST (удаляется только начальный export, нормализуется CRLF), код 0:

~~~text
Identical declarations: 8/8
OperatorShiftV2 SHA256: 5c7a387c0b37fd234f507d9d7a5136a9fb8f8dea9510c391179ed7b709536fde
Non-moved added lines: 11
~~~

Non-moved added lines — число обычных добавленных строк в git diff --color-moved=dimmed-zebra по перечисленным файлам кода от базы, без документации. Эвристика может не распознать дословные комментарии/фрагменты; фактическое совпадение кода и комментариев подтверждено pure-move и всех объявлений — AST. Полные локальные артефакты split6-color-moved.log и split6-non-moved.log.

## Проверки

Все команды отдельно и последовательно, с настоящими exit codes дочерних процессов. npm/npx на Windows запускаются через npm-cli.js/npx-cli.js установленного Node. До базового tsc .next/dev/types отсутствовал; dev/build не запускались.

| Команда | До: код и результат | После: код и результат |
|---|---|---|
| npx tsc --noEmit | 0 | 0 |
| npm run lint | 0; 0 предупреждений ESLint | 0; 0 предупреждений ESLint |
| npm run test:unit | 0; 5480 passed / 265 skipped / 0 failed | 0; 5480 passed / 265 skipped / 0 failed |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; 318 / 28 |
| npx vitest run src/components/piling/operator-v2 "src/app/(app)/operator/v2" | 0; 50 passed / 0 skipped / 0 failed | 0; 50 / 0 / 0 |
| Внешний innerHTML harness | 0; 34 passed | 0; 34 passed |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

| Шаг | tsc | lint | Целевой Vitest | pure-move |
|---|---:|---:|---|---:|
| 1 | 0 | 0 | 0; 50 passed | 0 |

Исходная база проверена до правок: git diff --exit-code = 0. Полных unit-прогонов два (исходный и итоговый); новые падающие файлы не добавились, passed не упал, skipped не вырос. Тесты и таймауты не переписывались. Предупреждения Vite configLoader/ESM и диагностические сообщения React не подавлялись; они не являются предупреждениями ESLint.

Исходные падения и причины:

~~~text
Падающих тестов нет.
~~~

Итоговые падения и причины:

~~~text
Падающих тестов нет.
~~~

## Эталон innerHTML

Временный harness D:/PillingR/split-operator-v2-1024-tools/layout.config.mts и копии сценариев со штатными заглушками находятся вне репозитория. Обёртки render/expect сохраняют raw container.innerHTML при успешных проверках; оригинальные тесты не изменены. Дата фиксируется только в harness для воспроизводимости, DOM не нормализуется. Проверка стабильности до правок и сравнение после — побайтно по полным файлам снимков. Всего 34 сценариев, 34 с DOM, 52 вариантов HTML в пределах сценария. Итог: 34 файлов, changed=[], added=[]. Артефакты layout-before/, layout-before-repeat/, layout-after/ в D:/PillingR/split-operator-v2-1024-tools. Это happy-dom, не живой браузер.

## GitNexus

Runner D:/PillingR/split-operator-v2-1024-tools/gitnexus-run.cjs скопирован из штатного runner; repo явно задан абсолютным путём. До правок выполнены свежий analyze --index-only, list, query/context OperatorShiftV2 и file-qualified upstream impact каждого переносимого символа. Все impact завершились с кодом 0, partial=false, truncated=false. UNKNOWN подтверждался поиском rg по репозиторию, а не считался отсутствием использования.

| Символ | Риск | Прямых / всего | Процессов |
|---|---|---|---:|
| documentStatusText | LOW | 1 / 3 | 1 |
| shiftTypeByClock | LOW | 1 / 2 | 1 |
| SHIFT_TYPE_CHOICES | UNKNOWN | 0 / 0 | 0 |
| ShiftTypePicker | LOW | 1 / 2 | 1 |
| ClearanceRow | LOW | 1 / 2 | 1 |
| Blockers | LOW | 1 / 2 | 1 |
| useElapsed | LOW | 1 / 2 | 1 |

Общее покрытие flows ограничено бюджетами GitNexus: отсутствие flow не означает отсутствие пути. Полные impact, импортёры и результаты detect сохранены в split6-*.log. Перед каждым коммитом индекс полностью обновляется (--index-only --force), CLI detect_changes и полный LocalBackend ответ проверяются на partial/truncated. Сокращённая печать CLI не заменяет полный ответ.

## Что оставлено и ограничения

OperatorShiftV2 оставлен целиком (1317 строк объявления). Задание указывает 1502 строки исходного файла, фактическая вершина main 7c5aed427732992fbec905281cd07440cccb1e94 содержит 1575; размер совпадал и в 89f31203 (diff этого файла между базами пуст). После чистого переноса осталось 1395 строк, не около 1330 из устаревшего ориентира. К 500 не сокращали. useElapsed скопирован дословно: startedAt/endedAt, frozen, timeout 0, interval 1000, зависимости эффекта и очистка сохранены.

### Потенциальные блоки — только для решения владельца

Подсчитаны существующие динамические привязки за пределами JSX-фрагмента, которые пришлось бы передать при его выносе. Импортируемые компоненты/функции/константы и локальные переменные внутри map не считаются параметрами. Ничего из списка не выделено. Номера строк относятся к итоговому operator-shift-v2.tsx.

| Блок | Строки | Динамических параметров | Какие |
|---|---|---:|---|
| Карточка установки и сведений передачи на допуске | 867–903 | 4 | equipment, facts, photo, state |
| Выбор установки | 921–937 | 3 | acceptTargetId, facts, setAcceptTargetId |
| Факты техники во вкладке | 1106–1122 | 1 | facts |
| Журнал выработки со следом поправок | 1134–1152 | 1 | entries |
| Предупреждение о неотправленных записях | 1286–1297 | 2 | flushQueued, unsent |

Проверено TypeScript checker по ссылкам на объявления внутри компонента; полный локальный список кандидатов split6-extractable-blocks.log. Эти небольшие блоки дают ограниченный выигрыш; новый интерфейс с параметрами выходит за чистый перенос. Существующие дубли не объединялись, новых дефектов переносимого кода не установлено.

### Ограничения и исправление внешнего harness

До любых правок приложения первые повторные снимки различались из-за асинхронной карточки погоды (working/nowhere) и первого нулевого таймера секундомера. Не принимались за регрессию/успех; исходные артефакты сохранены в layout-unstable-*, layout-clock-unstable-*, layout-flush-unstable-*. Во внешнем mock authFetch ответы sites/weather удерживаются pending; spy сохраняет вызовы, другая загрузка остаётся штатной тестовой. Погода при этом проверяется только в рабочем состоянии, её разрешение не проверено этим эталоном. Дата фиксирована, нулевые таймеры и ожидающие обновления React завершаются через act/flushSync перед снимком. Это выбор точки наблюдения, raw innerHTML не переписывается и не нормализуется; useElapsed/WeatherCard приложения не менялись.

Одна версия контроллера таймеров дала ошибку рекурсии clearTimeout (RangeError, внешний прогон: 30 failed / 4 passed, код 1); это ошибка моего вспомогательного инструмента, не проекта. Исправлена сохранением исходных функций таймеров. Журнал split6-baseline-layout-harness-error.log сохранён. После фиксации контроллера оба исходных прогона по 34 случая дали код 0 и побайтное совпадение 34 файлов; итоговый прогон после переноса тоже 34 passed и те же файлы. Проектные тесты и их таймауты не изменены, штатные 50 целевых и оба полных unit-прогона зелёные.


Живой браузер, E2E, физическое устройство, production и реальная БД не проверялись. Playwright только --list; skipped не считаются проверенной интеграцией. Build/Next route types проверяет Claude при приёмке. Без push/merge/deploy/SSH, правок схемы/миграций, auth/security, .env и зависимостей.

## Окружение и артефакты

npm ci завершился кодом 1 (postinstall без DATABASE_URL_POSTGRES); отдельная генерация клиента: 0. Пакеты установлены по lockfile. Разрешённое фиктивное значение передано только дочерней команде npm run db:generate в RAM, нигде не сохранено; .env не читались/создавались. Новых пакетов для harness не ставили: node_modules junction ссылается на рабочую папку. Все реальные коды и полные журналы split6-*.log / *-exit.log в рабочей папке; игнорируются Git.

## Итоговый граф

Перед единственным коммитом analyze --index-only --force: код 0. Detect scope all: CLI и полный backend код 0, {"partial":false,"truncated":false,"summary":{"changed_count":45,"affected_count":0,"changed_files":6,"risk_level":"low"},"changedSymbols":45}.
Compare от базы (код 0): {"partial":false,"truncated":false,"summary":{"changed_count":45,"affected_count":0,"changed_files":6,"risk_level":"low"},"changedSymbols":45}. Все partial/truncated=false.
