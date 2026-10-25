# Задание 5 — чистое разделение operator-v5-app.tsx

Ветка codex/split-operator-v5. Рабочая папка D:/PillingR/wt-split-operator-v5-1024.
База — вершина main на старте: 7c5aed427732992fbec905281cd07440cccb1e94. Владелец разрешил №3–7 последовательно без ожидания промежуточной приёмки; ветки не вливать.

## Коммиты

1. 55123bda994ab8fdf2d964023c5e7b68161bd43e
2. 418446c23fbe59982a2d4e3ce3eb8cc240368e88
3. 23c544e79bd764c60d9c9cdd3c6f1018dbc4ed37
4. Финальный перенос и этот отчёт — HEAD завершённой ветки; точный хеш в итоговом сообщении (git log -4).

## Файлы

Основной файл: 1583 → 619 строк.

| Файл | Строк после |
|---|---:|
| src/components/piling/operator-v5/operator-v5-app.tsx | 619 |
| src/components/piling/operator-v5/v5-shared.tsx | 119 |
| src/components/piling/operator-v5/v5-screens-admission.tsx | 207 |
| src/components/piling/operator-v5/v5-screens-shift.tsx | 339 |
| src/components/piling/operator-v5/v5-screens-work.tsx | 321 |

Diff от базы (добавлено / удалено):

~~~text
16	980	src/components/piling/operator-v5/operator-v5-app.tsx
207	0	src/components/piling/operator-v5/v5-screens-admission.tsx
339	0	src/components/piling/operator-v5/v5-screens-shift.tsx
321	0	src/components/piling/operator-v5/v5-screens-work.tsx
119	0	src/components/piling/operator-v5/v5-shared.tsx
~~~

Удалённых файлов нет. Тесты, страницы, внешние импортёры, остальные версии и замороженные файлы не изменены. Старые публичные пути/имена сохранены. Материалы владельца 00-common.md, файл задания и check-pure-move.cjs скопированы без правок; добавлен этот отчёт. Новых тестов в репозитории нет.

## Доказательство переноса

После каждого шага pure-move: код 0. Финальная команда:

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 7c5aed427732992fbec905281cd07440cccb1e94 src/components/piling/operator-v5/operator-v5-app.tsx src/components/piling/operator-v5/operator-v5-app.tsx src/components/piling/operator-v5/v5-shared.tsx src/components/piling/operator-v5/v5-screens-admission.tsx src/components/piling/operator-v5/v5-screens-shift.tsx src/components/piling/operator-v5/v5-screens-work.tsx
~~~

Полный вывод:

~~~text
строк кода до: 1472, после: 1472
OK: чистый перенос, отличаются только import/export
~~~

Дополнительная проверка всех объявлений через TypeScript AST (удаляется только начальный export, нормализуется CRLF), код 0:

~~~text
Identical declarations: 17/17
OperatorV5App SHA256: 4284e262399733e8b74d459ee0107882b86f0a535615b7a6ffe32368e200a70c
Non-moved added lines: 53
~~~

Non-moved added lines — число обычных добавленных строк в git diff --color-moved=dimmed-zebra по перечисленным файлам кода от базы, без документации. Эвристика может не распознать дословные комментарии/фрагменты; фактическое совпадение кода и комментариев подтверждено pure-move и всех объявлений — AST. Полные локальные артефакты split5-color-moved.log и split5-non-moved.log.

## Проверки

Все команды отдельно и последовательно, с настоящими exit codes дочерних процессов. npm/npx на Windows запускаются через npm-cli.js/npx-cli.js установленного Node. До базового tsc .next/dev/types отсутствовал; dev/build не запускались.

| Команда | До: код и результат | После: код и результат |
|---|---|---|
| npx tsc --noEmit | 0 | 0 |
| npm run lint | 0; 0 предупреждений ESLint | 0; 0 предупреждений ESLint |
| npm run test:unit | 0; 5480 passed / 265 skipped / 0 failed | 0; 5480 passed / 265 skipped / 0 failed |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; 318 / 28 |
| npx vitest run src/components/piling/operator-v5 | 0; 37 passed / 0 skipped / 0 failed | 0; 37 / 0 / 0 |
| Внешний innerHTML harness | 0; 77 passed | 0; 77 passed |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

| Шаг | tsc | lint | Целевой Vitest | pure-move |
|---|---:|---:|---|---:|
| 1 | 0 | 0 | 0; 37 passed | 0 |
| 2 | 0 | 0 | 0; 37 passed | 0 |
| 3 | 0 | 0 | 0; 37 passed | 0 |
| 4 | 0 | 0 | 0; 37 passed | 0 |

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

Временный harness D:/PillingR/split-operator-v5-1024-tools/layout.config.mts и копии сценариев со штатными заглушками находятся вне репозитория. Обёртки render/expect сохраняют raw container.innerHTML при успешных проверках; оригинальные тесты не изменены. Дата фиксируется только в harness для воспроизводимости, DOM не нормализуется. Проверка стабильности до правок и сравнение после — побайтно по полным файлам снимков. Всего 77 сценариев, 77 с DOM, 147 вариантов HTML в пределах сценария. Итог: 77 файлов, changed=[], added=[]. Артефакты layout-before/, layout-before-repeat/, layout-after/ в D:/PillingR/split-operator-v5-1024-tools. Это happy-dom, не живой браузер.

## GitNexus

Runner D:/PillingR/split-operator-v5-1024-tools/gitnexus-run.cjs скопирован из штатного runner; repo явно задан абсолютным путём. До правок выполнены свежий analyze --index-only, list, query/context OperatorV5App и file-qualified upstream impact каждого переносимого символа. Все impact завершились с кодом 0, partial=false, truncated=false. UNKNOWN подтверждался поиском rg по репозиторию, а не считался отсутствием использования.

| Символ | Риск | Прямых / всего | Процессов |
|---|---|---|---:|
| Tab | LOW | 2 / 3 | 0 |
| DASH | UNKNOWN | 0 / 0 | 0 |
| timeRu | LOW | 3 / 5 | 0 |
| dateRu | MEDIUM | 7 / 8 | 0 |
| Bar | LOW | 1 / 2 | 0 |
| Top | LOW | 1 / 2 | 0 |
| Dock | LOW | 1 / 2 | 0 |
| Rowline | MEDIUM | 6 / 8 | 0 |
| PpeScreenV5 | LOW | 1 / 3 | 0 |
| BriefingScreenV5 | LOW | 1 / 3 | 0 |
| AdmissionScreen | LOW | 1 / 3 | 0 |
| AcceptScreen | LOW | 1 / 3 | 0 |
| ChecklistScreen | LOW | 1 / 3 | 0 |
| IncidentScreen | LOW | 1 / 3 | 0 |
| WorkScreen | LOW | 1 / 3 | 0 |
| CloseScreen | LOW | 1 / 3 | 0 |

Общее покрытие flows ограничено бюджетами GitNexus: отсутствие flow не означает отсутствие пути. Полные impact, импортёры и результаты detect сохранены в split5-*.log. Перед каждым коммитом индекс полностью обновляется (--index-only --force), CLI detect_changes и полный LocalBackend ответ проверяются на partial/truncated. Сокращённая печать CLI не заменяет полный ответ.

## Что оставлено и ограничения

OperatorV5App оставлен целиком: вынос его состояний/обработчиков потребовал бы новых параметров и отдельного задания. Ожидаемый остаток около 600 строк; фактический 619, к 500 его не сокращали. Bar/Top/Dock/Rowline не объединялись с v10/v2/основным mobile — дубли сохранены намеренно. WorkScreen и CloseScreen переэкспортированы из старого файла; OperatorV5App остаётся там. Новых дефектов в переносимых блоках не установлено.

Матрица эталона: 8 фаз (IDENTITY, ADMISSION, PRESHIFT_INSPECTION, SITE_READY, STARTUP, WORK, CLOSING, CLOSED) × 5 вкладок (Смена, Работа, Дефекты, ЧП, Ещё), 40 дополнительных случаев плюс 37 штатных. Все 77 файлов/147 вариантов HTML совпали побайтно.

На первом шаге первая analyze --index-only --force завершилась нативным Windows-кодом 3221226505 без диагностического текста после баннера. Этот результат не засчитан зелёным. Повтор той же команды (split5-step1-index-retry.log) — код 0; detect_changes после успешного обновления — код 0 с полным ответом без усечения. Причина нативного сбоя не установлена. Остальные обязательные проверки первого шага прошли до коммита.

Живой браузер, E2E, физическое устройство, production и реальная БД не проверялись. Playwright только --list; skipped не считаются проверенной интеграцией. Build/Next route types проверяет Claude при приёмке. Без push/merge/deploy/SSH, правок схемы/миграций, auth/security, .env и зависимостей.

## Окружение и артефакты

npm ci завершился кодом 1 (postinstall без DATABASE_URL_POSTGRES); отдельная генерация клиента: 0. Пакеты установлены по lockfile. Разрешённое фиктивное значение передано только дочерней команде npm run db:generate в RAM, нигде не сохранено; .env не читались/создавались. Новых пакетов для harness не ставили: node_modules junction ссылается на рабочую папку. Все реальные коды и полные журналы split5-*.log / *-exit.log в рабочей папке; игнорируются Git.

## Граф перед коммитами

Шаг 1: {"partial":false,"truncated":false,"summary":{"changed_count":8,"affected_count":0,"changed_files":2,"risk_level":"low"},"changedSymbols":8}

Шаг 2: {"partial":false,"truncated":false,"summary":{"changed_count":4,"affected_count":0,"changed_files":2,"risk_level":"low"},"changedSymbols":4}

Шаг 3: {"partial":false,"truncated":false,"summary":{"changed_count":6,"affected_count":0,"changed_files":2,"risk_level":"low"},"changedSymbols":6}

Шаг 4: {"partial":false,"truncated":false,"summary":{"changed_count":37,"affected_count":0,"changed_files":6,"risk_level":"low"},"changedSymbols":37}

Compare от базы (код 0): {"partial":false,"truncated":false,"summary":{"changed_count":55,"affected_count":0,"changed_files":9,"risk_level":"low"},"changedSymbols":55}

Все перечисленные detect CLI/LocalBackend завершились с кодом 0, partial=false, truncated=false.
