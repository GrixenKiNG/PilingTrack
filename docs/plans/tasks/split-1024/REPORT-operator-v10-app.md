# Задание №4 — чистое разделение operator-v10-app.tsx

24.10.2026. Ветка codex/split-operator-v10. Рабочая папка D:/PillingR/wt-split-operator-v10-1024.
База — вершина main на старте: 89f31203a8f2ac0e55381fdf18c10741fc4b3455. Владелец принял №1–2 и разрешил выполнить №3–7 последовательно без ожидания промежуточной приёмки. №3 завершён отдельно; ветки не вливались.

## Коммиты

1. c8e38d8c — общие определения → v10-shared.tsx.
2. 34432dc8 — экраны смены → v10-screens-shift.tsx.
3. 121fcdbb — закрытие и безопасность → v10-screens-closing.tsx.
4. 48469f6b — происшествия и меню → v10-screens-incidents.tsx.
5. Коммит, содержащий этот отчёт (HEAD завершённой ветки), — допуск → v10-screens-admission.tsx и материалы проверки. Точный хеш указан в итоговом сообщении; git log -5 показывает все пять коммитов.

## Файлы

Все файлы кода в src/components/piling/operator-mobile/v10/.

| Файл | Что внутри | Строк после | Добавлено / удалено от базы |
|---|---|---:|---:|
| operator-v10-app.tsx | OperatorV10App целиком, импорты, переэкспорт ppeOutcome | 413 (было 1771) | +19 / -1377 |
| v10-shared.tsx | Константы, типы, даты, переходы, ppeOutcome, подсказки ТБ | 219 | +219 / -0 |
| v10-screens-shift.tsx | NotYet, ScreenToday, StepLadder, ScreenDocs, ScreenAccept, ProductionForm, ScreenWork, ScreenMaint | 464 | +464 / -0 |
| v10-screens-closing.tsx | ScreenSafetyChecklists, ScreenClosing, ScreenReport, ScreenSafety | 352 | +352 / -0 |
| v10-screens-incidents.tsx | ScreenIncidents, ScreenMore | 143 | +143 / -0 |
| v10-screens-admission.tsx | ScreenPpe, ScreenBriefing, Attempt, ScreenKnowledge | 216 | +216 / -0 |

Удалённых путей нет. OperatorV10App и ppeOutcome доступны по прежнему пути. Страница, оба теста v10, v10-ui.tsx, v10-entries.tsx и остальные варианты/замороженные файлы не изменены. Тестов репозитория не добавляли и не переписывали. Скопированы без правок документы владельца 00-common.md, 04-operator-v10-app.md и check-pure-move.cjs; добавлен этот отчёт.

Фактический граф импортов шести изменённых файлов проверен: циклов нет. Screens зависят от shared, closing дополнительно от shift через NotYet. Обратных импортов из новых файлов в главный файл нет. Никакого общего кода между версиями операторских экранов не извлекалось.

## Доказательство чистого переноса

После каждого из пяти шагов pure-move: код 0. Финальная команда:

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 89f31203a8f2ac0e55381fdf18c10741fc4b3455 src/components/piling/operator-mobile/v10/operator-v10-app.tsx src/components/piling/operator-mobile/v10/operator-v10-app.tsx src/components/piling/operator-mobile/v10/v10-shared.tsx src/components/piling/operator-mobile/v10/v10-screens-shift.tsx src/components/piling/operator-mobile/v10/v10-screens-closing.tsx src/components/piling/operator-mobile/v10/v10-screens-incidents.tsx src/components/piling/operator-mobile/v10/v10-screens-admission.tsx
~~~

Полный вывод каждого шага:

~~~text
строк кода до: 1635, после: 1635
OK: чистый перенос, отличаются только import/export
~~~

Дополнительно все 40 объявлений верхнего уровня сравнивались с базой через TypeScript AST: 40/40 совпали дословно после удаления только начального export и нормализации CRLF. OperatorV10App сохранён целиком; SHA256: f7bfb2f99d2d8375bcbe55997a9852352e69bf207ad2c160c1188331219fc47b. JSX, хуки, комментарии, классы, aria/data-testid, ключи, тексты, commandId, очередь и порядок эффектов не менялись.

В git diff --color-moved=dimmed-zebra от базы по шести файлам кода: 164 добавленных строки без отметки переноса — 64 import/export, 20 пустых и 80 дословно перенесённых строк комментариев. Других строк логики среди них нет; это эвристика распознавания Git. Документы в подсчёт не включены. Локальные артефакты split4-color-moved.log и split4-non-moved.log.

## Проверки до и после

Все команды отдельно, последовательно, с реальными exit codes дочерних процессов. На Windows npm/npx вызваны через npm-cli.js/npx-cli.js установленного Node. Перед базовым tsc проверен .next/dev/types: отсутствовал; dev/build не запускались.

| Команда | Исходная база | Итог |
|---|---|---|
| npx tsc --noEmit | 0, без диагностик | 0, без диагностик |
| npm run lint | 0, 0 ошибок/предупреждений ESLint, text integrity passed | 0, то же |
| npm run test:unit | 1; 5475 passed / 265 skipped / 5 failed; 491 passed / 15 skipped / 3 failed файлов | 0; 5480 passed / 265 skipped / 0 failed; 494 passed / 15 skipped / 0 failed файлов |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; те же 318 / 28 |
| npx vitest run src/components/piling/operator-mobile | 0; 330 passed / 0 skipped / 0 failed, 28 файлов | 0; те же 330 / 0 / 0, 28 файлов |
| Оба теста v10 отдельно (команда ниже) | В каталоге: flow 13 + port 27 = 40 passed | 0; те же 40 passed, 0 skipped/failed, 2 файла |
| Внешний harness innerHTML | 0; 48 passed, 2 файла, до правок | 0; те же 48 passed, 0 skipped/failed |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

~~~sh
npx vitest run src/components/piling/operator-mobile/v10/__tests__/operator-v10-flow.test.tsx src/components/piling/operator-mobile/v10/__tests__/operator-v10-port.test.tsx
~~~

| Шаг | tsc | lint | Оба теста v10 | pure-move |
|---|---:|---:|---|---:|
| 1: общее | 0 | 0 | 0; 40 passed | 0 |
| 2: смена | 0 | 0 | 0; 40 passed | 0 |
| 3: закрытие/безопасность | 0 | 0 | 0; 40 passed | 0 |
| 4: происшествия/меню | 0 | 0 | 0; 40 passed | 0 |
| 5: допуск | 0 | 0 | 0; 40 passed | 0 |

Полных unit-прогонов ровно два: исходный красный и итоговый зелёный; в каждом 5745 тестов / 509 файлов. Passed вырос на 5, skipped не вырос, новых падающих файлов нет. Красный полный запуск не скрыт и не заменён узким зелёным.

Исходные падения на tracked-коде чистой базы до правок (git diff --exit-code: 0):

- src/lib/__tests__/no-global-db-in-tx.test.ts:332 — «найденные вхождения совпадают с KNOWN»: таймаут 20000 ms, scanSources.
- src/lib/__tests__/tenant-scope.test.ts:83 — три таймаута по 5000 ms: «фильтр ставится только при истинном тен…», «без тенанта условие пустое, то есть выб…», «сырой SQL с IS NULL OR — ровно тот шабл…».
- src/workers/__tests__/no-next-in-workers.test.ts:319 — «ни один файл статического графа unified-worker не импортирует next»: таймаут 5000 ms, walkWorkerGraph.

Все вне переносимого v10. Продолжение разрешено владельцем для исходных несвязанных падений; тесты/таймауты не менялись. В итоговом полном прогоне все прошли. Причина нестабильности времени глубже не диагностировалась. Предупреждения Vite configLoader native/ESM и диагностические сообщения React не подавлялись; они не являются предупреждениями ESLint.

## Эталон innerHTML

Внешний harness: D:/PillingR/split-operator-v10-1024-tools/layout.config.mts; копии двух сценарных файлов со штатными заглушками лежат рядом, вне репозитория. Внешние обёртки render/expect сохраняют container.innerHTML при успешных проверках; тела тестов репозитория не изменены. Дата зафиксирована только в harness (28.09.2026), чтобы не менялся вывод времени; DOM не нормализуется. Дополнительно отрендерены все семь фаз STEPS и CLOSED: IDENTITY, ADMISSION, PRESHIFT_INSPECTION, SITE_READY, STARTUP, WORK, CLOSING, CLOSED.

Всего 48 тестовых случаев: 40 штатных v10 + 8 дополнительных фаз. У 44 случаев есть DOM, сохранён 71 уникальный в пределах сценария вариант raw innerHTML; 4 случая проверяют чистые функции без DOM. Для каждой из 8 фаз сохранён отдельный вариант. До правок harness повторён для проверки воспроизводимости: все 48 файлов снимков совпали побайтно. После всех переносов те же 48 файлов совпали побайтно с исходным эталоном, changed=[], added=[]. Это сравнение всех сохранённых HTML-строк и имён сценариев, без удаления атрибутов/текстов.

Артефакты вне репозитория: layout-before/, layout-before-repeat/, layout-after/. Локальные журналы split4-baseline-layout.log, split4-layout-stability.log, split4-layout-stability-summary.log, split4-step5-layout.log, split4-final-layout-summary.log. Harness работает в happy-dom, это не проверка живого браузера/физического телефона.

## GitNexus

Runner D:/PillingR/split-operator-v10-1024-tools/gitnexus-run.cjs — копия штатного runner. Во всех запросах repo задан абсолютным путём этой рабочей папки. До правок fresh analyze --index-only: код 0; 33144 узла / 72182 связи / 559 кластеров / 1225 flows. Выполнены list, query/context OperatorV10App и file-qualified impact upstream для всех 39 переносимых объявлений. Все команды impact: код 0, partial=false, truncated=false.

| Символ | Риск | Прямых / всего затронуто | Процессов |
|---|---|---|---:|
| DOC_LABEL | UNKNOWN | 0 / 0 | 0 |
| DOC_TONE | UNKNOWN | 0 / 0 | 0 |
| DASH | UNKNOWN | 0 / 0 | 0 |
| dateRu | MEDIUM | 9 / 11 | 1 |
| timeRu | LOW | 1 / 3 | 1 |
| shiftType | LOW | 1 / 1 | 0 |
| ScreenDef | LOW | 1 / 1 | 0 |
| SCREENS | UNKNOWN | 0 / 0 | 0 |
| TABS | UNKNOWN | 0 / 0 | 0 |
| Phase | LOW | 2 / 11 | 1 |
| STEPS | UNKNOWN | 0 / 0 | 0 |
| PHASE_STAGE | UNKNOWN | 0 / 0 | 0 |
| stepIndex | MEDIUM | 5 / 8 | 1 |
| NotYet | LOW | 2 / 5 | 1 |
| Go | MEDIUM | 12 / 14 | 1 |
| ScreenToday | LOW | 1 / 2 | 1 |
| StepLadder | LOW | 1 / 3 | 1 |
| ScreenDocs | LOW | 1 / 2 | 1 |
| ScreenAccept | LOW | 2 / 3 | 1 |
| ProductionForm | LOW | 1 / 4 | 1 |
| ScreenWork | LOW | 2 / 3 | 1 |
| ScreenMaint | LOW | 1 / 2 | 1 |
| tbTone | LOW | 1 / 4 | 1 |
| tbNote | LOW | 1 / 4 | 1 |
| ScreenSafetyChecklists | LOW | 1 / 2 | 1 |
| ScreenClosing | LOW | 2 / 3 | 1 |
| ScreenReport | LOW | 1 / 2 | 1 |
| ScreenSafety | LOW | 2 / 3 | 1 |
| ScreenIncidents | LOW | 1 / 2 | 1 |
| ScreenMore | LOW | 1 / 2 | 1 |
| nextScreen | LOW | 1 / 3 | 1 |
| ppeOutcome | LOW | 1 / 3 | 1 |
| ScreenPpe | LOW | 1 / 2 | 1 |
| ScreenBriefing | LOW | 1 / 2 | 1 |
| Attempt | LOW | 2 / 4 | 1 |
| ScreenKnowledge | LOW | 1 / 2 | 1 |
| documentsTone | LOW | 1 / 4 | 1 |
| STEP_ICON | UNKNOWN | 0 / 0 | 0 |
| STEP_SCREEN | UNKNOWN | 0 / 0 | 0 |

HIGH/CRITICAL нет. MEDIUM dateRu/stepIndex/Go сообщены владельцу до правок. UNKNOWN не принят за отсутствие использования: подтверждён поиском rg по исходникам, тестам, e2e, scripts, prisma и конфигурации. Подтверждены страница OperatorV10Page и импорты обоих тестов из старого файла; в impact отмечен один процесс OperatorV10App; страница OperatorV10Page подтверждена как входящий caller. Логи split4-impact-summary.log, split4-impact-*.log, split4-importers-before.log.

Индекс отдельно предупреждает об ограниченном общем покрытии flows (2566 кандидатов не ранжированы и ограничения глубины/ветвления). Отсутствие flow не доказывает отсутствие влияния. Перед каждым из первых четырёх коммитов индекс полностью перестроен (--index-only --force, код 0), CLI detect_changes и полный backend ответ проверены:

| Шаг | Код | Файлы / символы | Риск | partial / truncated |
|---|---:|---:|---|---|
| 1 | 0 | 2 / 55 | LOW | false / false |
| 2 | 0 | 2 / 11 | LOW | false / false |
| 3 | 0 | 2 / 4 | LOW | false / false |
| 4 | 0 | 2 / 3 | LOW | false / false |

Краткий CLI сокращает печать списка, поэтому флаги проверяются по полному ответу LocalBackend; ограничения покрытия flows не смешиваются с полнотой ответа detect_changes.

## Что оставлено и ограничения

OperatorV10App (379 строк тела с сигнатурой) оставлен целиком. Достигнута цель основного файла меньше 500 строк. Новых параметров не вводилось, экранов с изменённой логикой нет. Дубли с v5/v2/основным operator-mobile не объединялись; новых дефектов в переносимых блоках не установлено.

Реальные E2E, браузер, физическое устройство, production и интеграция с настоящей БД не проверялись. Playwright выполнялся только --list; 265 skipped не считаются проверенными интеграциями. Next route types и production build проверяет Claude при приёмке. Никаких push/merge/deploy/SSH, правок схемы/миграций, .env или зависимостей не было.

## Окружение и локальные артефакты

npm ci: код 1 только на postinstall из-за отсутствующего DATABASE_URL_POSTGRES. Пакеты установлены по lockfile; package.json и package-lock.json не изменены. Отдельный npm run db:generate: код 0, Prisma 7.10.0 + patch-postgres-client. Фиктивное значение передано только в RAM дочерней команды генерации, нигде не сохранено; .env не читались/создавались. Прямых подключений к БД не выполнялось.

Полные логи и реальные коды в split4-*.log / *-exit.log в корне рабочей папки (игнорируются Git). Внешние инструменты, эталон и временные сценарии — в D:/PillingR/split-operator-v10-1024-tools; junction node_modules ведёт к зависимостям этой рабочей папки, новых пакетов для harness не ставили.

## Итоговый граф перед пятым коммитом

Финальная analyze --index-only --force: код 0, 33159 узлов / 72217 связей / 559 кластеров / 1225 flows. CLI detect_changes scope all и полный backend: код 0; 6 файлов / 41 символ, LOW, affected=0, partial=false, truncated=false. Compare от базы: код 0; 10 файлов / 114 символов, LOW, partial=false, truncated=false. Числа включают документацию. Общие ограничения покрытия flows сохраняются.
