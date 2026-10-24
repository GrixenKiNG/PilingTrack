# Задание 1 — чистое разделение readiness-centre.tsx

24.10.2026. Ветка: `codex/split-readiness-centre`.
База: `15a065129c2688860cab7b645cd0991dc7b6e658`.
Рабочая папка: `C:\Users\PC\.codex\worktrees\split-readiness-centre\my-project`.

Перенос выполнен. Применено уточнение владельца: унаследованные падения unit допустимы при подтверждении на исходном коде; build не запускать. Итоговый unit-результат совпадает с первоначальной базой после генерации клиента. Приёмка Claude и владельцем ещё не выполнена. Задания 2–4 не начинались.

## Коммиты

1. `fcde61c2` — ролевые данные и функции → readiness-centre-role-flow.ts.
2. `4fd593b5` — панели ролей и ссылки этапов → readiness-centre-role-panels.tsx.
3. `5e5609f0` — метрики и подписи доказательств → readiness-centre-metrics.ts.
4. Четвёртый коммит — вершина этой ветки при передаче: «Вынести событие передачи центра готовности и оформить проверку». Содержит HandoverEvent и материалы задания с этим отчётом. Его хеш приведён в итоговом сообщении; получить локально: `git log -4 --oneline`.

Push, merge, deploy и изменения main не выполнялись.

## Файлы

Все файлы кода находятся в `src/components/piling/to/readiness/screens/`.

| Файл | Содержимое | Строк после | Добавлено / удалено относительно базы |
|---|---|---:|---:|
| readiness-centre.tsx | ReadinessCentre целиком, импорты, переэкспорт типов | 776 (было 1386) | +18 / -628 |
| readiness-centre-role-flow.ts | RoleStepHint, ROLE_FLOW, RoleFlowStep, RoleFlowProgress, buildRoleFlowProgress, stepOwner | 193 | +193 / -0 |
| readiness-centre-role-panels.tsx | RoleStepsPanel, RoleFlowFooter, StageLink | 178 | +178 / -0 |
| readiness-centre-metrics.ts | Константы, подсчёты, ReadinessMetricTile, buildReadinessMetricTiles, EVIDENCE_STAGE, evidenceMetric | 254 | +254 / -0 |
| readiness-centre-handover.tsx | HandoverEvent | 62 | +62 / -0 |

Удалённых путей нет. Экспорты RoleFlowStep и RoleFlowProgress доступны по прежнему пути. Внешние импортёры, включая readiness-reference-ui.tsx, тест центра и тест чтения исходника readiness-reference-authority.test.ts, не изменены. Тесты не переписывались; новых тестовых файлов нет.

Также добавлены точные копии предоставленных владельцем 00-common.md (78 строк), 01-readiness-centre.md (37 строк), check-pure-move.cjs (44 строки) и этот отчёт. Исходные материалы найдены в рабочей папке Claude `D:\PillingR\my-project\.claude\worktrees\microservices-implementation-plan-9cb73e\docs\plans\tasks\split-1024`.

## Доказательство чистого переноса

После каждого из четырёх переносов check-pure-move.cjs завершился с кодом 0. Финальная команда:

```bash
node docs/plans/tasks/split-1024/check-pure-move.cjs 15a065129c2688860cab7b645cd0991dc7b6e658 src/components/piling/to/readiness/screens/readiness-centre.tsx src/components/piling/to/readiness/screens/readiness-centre.tsx src/components/piling/to/readiness/screens/readiness-centre-role-flow.ts src/components/piling/to/readiness/screens/readiness-centre-role-panels.tsx src/components/piling/to/readiness/screens/readiness-centre-metrics.ts src/components/piling/to/readiness/screens/readiness-centre-handover.tsx
```

Полный вывод (код 0):

```text
строк кода до: 1329, после: 1329
OK: чистый перенос, отличаются только import/export
```

Дополнительно сравнивались полные тексты всех 24 объявлений верхнего уровня через TypeScript AST: совпадают 24/24, если убрать только export и нормализовать CRLF. SHA256 нормализованного объявления ReadinessCentre: `d89928533f9b319a8cae759e1ed892d82385b910a1def913823e170f2bca9511`. После временной проверки исходной базы это сравнение повторено с тем же результатом. Локальный инструмент: `../verify-structure.cjs`; журнал: `split-final-structural-proof-restored.log`.

В `git diff --color=always --color-moved=dimmed-zebra <база> -- <пять файлов кода>` (цвет обычных добавлений задан green) — 108 добавленных строк без отметки переноса: 42 строки import/export, 54 пустые строки, 12 дословно перенесённых строк комментариев. Других отличий кода нет. Полный цветной diff — split-final-color-moved.log; перечень 108 строк — split-final-non-moved.log. Документация в этот подсчёт не включена.

## Команды проверки

После разрешённой разовой настройки окружения `npm run db:generate` завершилась с кодом 0: Prisma Client 7.10.0 создан, патч клиента выполнен. Фиктивная строка передавалась только этой команде, затем прежнее окружение процесса восстановлено; .env-файлы не читались, не создавались и не копировались. Значение строки в файлы задания не записывалось.

Предшествующий npm ci имел код 1 из-за postinstall → db:generate без DATABASE_URL_POSTGRES; отдельная успешная генерация устранила отсутствие клиента. Lockfile и зависимости проекта не менялись.

Базовая линия после генерации и все дальнейшие проверки запускались отдельными командами последовательно, без параллельного запуска проверок. .next/dev/types отсутствовал до новой базовой линии и при финальной проверке; удалять было нечего.

| Команда | База до переноса | Финальное состояние |
|---|---|---|
| `npx tsc --noEmit` | 0, ошибок нет | 0, ошибок нет |
| `npm run lint` | 0, предупреждений нет, Text integrity check passed | 0, предупреждений нет, Text integrity check passed |
| `npx vitest run src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx src/components/piling/to/__tests__` | 0; 8 файлов, 167 passed, 0 failed/skipped | 0; те же 8 файлов и 167 passed (из них 42 теста центра) |
| `npm run test:unit` | 1; 5469 passed / 265 skipped / 1 failed | 1; 5469 passed / 265 skipped / 1 failed |
| `npx playwright test --list` | 0; 318 тестов в 28 файлах | 0; 318 тестов в 28 файлах |
| `npm run build` | В этой итерации не запускался | **build не проверен, проверит Claude при приёмке** |
| `git diff --cached --check` | — | 0 |

На каждом шаге отдельно выполнены tsc, lint и объединённый целевой Vitest-прогон:

| Шаг | tsc | lint | Целевой Vitest | check-pure-move |
|---|---:|---:|---|---:|
| 1: роли | 0 | 0 | 0; 167 passed | 0 |
| 2: панели | 0 | 0 | 0; 167 passed | 0 |
| 3: метрики | 0 | 0 | 0; 167 passed | 0 |
| 4: событие | 0 | 0 | 0; 167 passed | 0 |

После сбоя основного инструмента запуска использовался node_repl + child_process с прямым запуском Node и npm-cli.js/npx-cli.js. Первые резервные попытки через PowerShell не запустили npm/npx: ошибка переменной LASTEXITCODE, несмотря на код оболочки 0. Эти три результата НЕ засчитаны. Реальные повторные команды через CLI дали результаты четвёртого шага из таблицы. Неуспешные журналы: split-step-4-{tsc,lint,targeted}.log; подтверждённые: split-step-4-{tsc,lint,targeted}-retry.log.

## Все полные unit-прогоны после генерации

Ни один красный полный прогон не заменялся узким зелёным.

| Прогон | Код | Passed | Skipped | Failed | Файлы passed / skipped / failed |
|---|---:|---:|---:|---:|---|
| Первоначальная база, до правок — split-baseline-2-unit.log | 1 | 5469 | 265 | 1 | 493 / 15 / 1 |
| Финальный вариант, попытка 1 — split-final-unit.log | 1 | 5467 | 265 | 3 | 492 / 15 / 2 |
| Дополнительный контроль исходной базы — split-repeat-base-unit.log | 1 | 5466 | 265 | 4 | 491 / 15 / 3 |
| Финальный вариант, повтор — split-final-unit-repeat.log | 1 | 5469 | 265 | 1 | 493 / 15 / 1 |

Дополнительный контроль базы выполнен позднее первоначальных правок: все пять файлов сохранены отдельно, затем восстановлен исходный readiness-centre.tsx, а четыре новых файла временно убраны. `git diff --exit-code 15a065129c2688860cab7b645cd0991dc7b6e658 -- src e2e tests scripts prisma` дал 0. После завершения процесса финальные файлы восстановлены автоматически; сравнение 24/24 объявлений и проверка чистого переноса повторены. История и коммиты не переписывались. Это отдельное доказательство воспроизведения на исходных текстах, а не подмена первоначальной базовой линии.

Все падавшие файлы и причины:

- `src/core/observability/__tests__/health-checks.test.ts:76`: ожидается ok, получено degraded. Тест не подменяет реальную проверку диска; statfs('/') показал 97% заполнения, порог warn в коде — 85%. Падает на исходном и на финальном коде, включая оба сравниваемых итоговых прогона.
- `src/workers/__tests__/projection-worker.test.ts:100`: W121, skips overlapping weekly passes — таймаут 5000 мс; `:138`: W121, stop prevents pending weekly pass — ожидался 1 вызов mockSiteFindMany, получено 2. Оба падения воспроизведены в дополнительном полном прогоне исходной базы. В последнем полном прогоне финального варианта все 11 тестов файла прошли.
- `src/workers/__tests__/no-next-in-workers.test.ts:319`: таймаут 5000 мс обхода статического графа; произошёл в дополнительном полном прогоне исходной базы. В последнем полном прогоне финального варианта все 16 тестов файла прошли.

Точная причина нестабильности worker-тестов не установлена. Они не относятся к переносимому UI-коду, воспроизведены без разделения и не исправлялись. Последний полный результат совпадает с первоначальной базой: passed не уменьшился, skipped не вырос, новых failing-файлов нет. Это выполнение уточнённого владельцем критерия, а не полностью зелёный unit-прогон.

## GitNexus

Impact выполнен до переноса для всех переносимых символов с привязкой к файлу и к этой рабочей папке. Поиск исходников и импортёров сохранён в split-importers-before.log; UNKNOWN подтверждался текстовыми использованиями.

- HIGH: buildRoleFlowProgress, RoleFlowFooter, StageLink, buildReadinessMetricTiles, evidenceMetric, HandoverEvent — по 1 прямому / 3 всего зависимым символам; countBlockersByTone — 2 прямых / 4 всего. Владелец предупреждён перед редактированием.
- Цепочка влияния: ReadinessCentre → ReadinessReferenceUi → ToModule. Для countBlockersByTone также учитывается buildReadinessMetricTiles.
- LOW: RoleStepHint (2 прямых / 10 всего), RoleFlowStep и RoleFlowProgress (1 / 7), stepOwner и RoleStepsPanel (1 / 3), ReadinessMetricTile (1 / 7).
- UNKNOWN: ROLE_FLOW, STAGE_PILL, STAGE_OWNER, ENGINE_HOURS_NOTE, HANDOVER_ICON, HANDOVER_PREVIEW, HANDOVER_PILL, BLOCKER_COUNT_LABEL, BLOCKER_COUNT_CLASS, EVIDENCE_STAGE. Нулевое число найденных рёбер не принималось за отсутствие использования.
- Во всех impact найдено 0 процессов; это только наблюдение ограниченного графа. Построитель индекса предупреждает об ограничении полноты процессов (1225 найденных flows). Отсутствие flow не считается доказательством отсутствия влияния.

Фактический CLI: `node ../gitnexus-run.cjs ... --repo C:/Users/PC/.codex/worktrees/split-readiness-centre/my-project`. Аргумент --repo . не разрешился в этой версии реестра, поэтому использован абсолютный путь. Runner перенесён в родительскую папку: его первоначальное размещение в ещё не созданном индексе вызвало ошибку ownership; после исправления индексация завершилась.

Перед коммитами выполнялся detect-changes --scope all:

| Шаг | Код | Изменённые файлы / символы | Риск |
|---|---:|---:|---|
| 1 | 0 | 2 / 5 | LOW |
| 2 | 0 | 2 / 3 | LOW |
| 3 | 0 | 3 / 48 | LOW |
| 4, код до включения материалов задания | 0 | 2 / 1 | LOW |

Первичные результаты «Diff touched ... but no indexed symbols overlap» не принимались за чистую проверку. Шаг 1 потребовал обновления индекса; шаг 2 — полной переиндексации --force после неудачного инкрементального обновления. Шаги 3–4 проверялись после --index-only --force. На шаге 3 инструмент исполнения не доставил завершение команды индексации; журнал содержит success, но её exit code не заявляется. Последняя полная индексация подтверждена реальным кодом 0 (65.8 с), последующий detect-changes также 0.

Дополнительное сравнение всего переноса исходников с базой (до staging материалов задания): detect-changes --scope compare --base-ref 15a065129c2688860cab7b645cd0991dc7b6e658 — код 0, 5 файлов / 75 символов, LOW. Полный структурированный результат проверен через тот же LocalBackend: partial=false, truncated=false, 75 changed_symbols. Для последнего отдельного шага также partial=false, truncated=false, 1 changed_symbol. Журналы: split-step-4-detect-raw.log и split-final-compare-raw.log. Краткий CLI показывает только первые 15 символов; полные списки сохранены в raw-журналах.

## Что оставлено и ограничения

ReadinessCentre не разрезан: его тело, сигнатура, JSX, хуки, комментарии, обработчики, классы и тексты сохранены. Размер 776 строк допустим заданием. Для отдельного будущего задания можно рассмотреть блок выбранной установки (3 динамических входа: selected, fleetCard, detail) и секцию журнала передач (2 входа: handoverJournal и timezone; константы и компоненты импортируются). Сейчас новые параметры не вводились.

Повторяющиеся фрагменты и классы не унифицировались; дополнительных дефектов переносимых блоков не установлено. Схема, миграции, auth/security, tenancy, frozen-зоны, зависимости и внешние импортёры не изменены.

Playwright выполнялся только в режиме --list; браузерные E2E и физические устройства не проверялись. Пропущенные интеграционные тесты не являются проверенными сценариями. Нестабильность worker-тестов остаётся отдельным риском проверки. Build не проверен, проверит Claude при приёмке.

Логи *.log игнорируются git и находятся в корне этой рабочей папки. Вспомогательные инструменты и сохранённые финальные тексты для проверки базы находятся в родительской папке; в приложение они не добавлялись.
