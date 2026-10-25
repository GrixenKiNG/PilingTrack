# Задание 7 — чистое разделение operator-mobile-app.tsx

Ветка codex/split-operator-mobile-app. Рабочая папка D:/PillingR/wt-split-operator-mobile-app-1024.
База — вершина main на старте: 7c5aed427732992fbec905281cd07440cccb1e94. Владелец разрешил №3–7 последовательно без ожидания промежуточной приёмки; ветки не вливать.

## Коммиты

1. 4c3d2ca3576b95f3ee97bb43ecaf4be5df5198f0
2. Финальный перенос и этот отчёт — HEAD завершённой ветки; точный хеш в итоговом сообщении (git log -2).

## Файлы

Основной файл: 1118 → 982 строк.

| Файл | Строк после |
|---|---:|
| src/components/piling/operator-mobile/operator-mobile-app.tsx | 982 |
| src/components/piling/operator-mobile/operator-mobile-config.ts | 72 |
| src/components/piling/operator-mobile/operator-mobile-frame.tsx | 73 |

Diff от базы (добавлено / удалено):

~~~text
7	143	src/components/piling/operator-mobile/operator-mobile-app.tsx
72	0	src/components/piling/operator-mobile/operator-mobile-config.ts
73	0	src/components/piling/operator-mobile/operator-mobile-frame.tsx
~~~

Удалённых файлов нет. Тесты, страницы, внешние импортёры, остальные версии и замороженные файлы не изменены. Старые публичные пути/имена сохранены. Материалы владельца 00-common.md, файл задания и check-pure-move.cjs скопированы без правок; добавлен этот отчёт. Новых тестов в репозитории нет.

## Доказательство переноса

После каждого шага pure-move: код 0. Финальная команда:

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 7c5aed427732992fbec905281cd07440cccb1e94 src/components/piling/operator-mobile/operator-mobile-app.tsx src/components/piling/operator-mobile/operator-mobile-app.tsx src/components/piling/operator-mobile/operator-mobile-config.ts src/components/piling/operator-mobile/operator-mobile-frame.tsx
~~~

Полный вывод:

~~~text
строк кода до: 1035, после: 1035
OK: чистый перенос, отличаются только import/export
~~~

Дополнительная проверка всех объявлений через TypeScript AST (удаляется только начальный export, нормализуется CRLF), код 0:

~~~text
Identical declarations: 11/11
OperatorMobileApp SHA256: e17fd3cbe86fa5a2f1162da1b627b9bc44d9b6952d8ecc4b326f722d81aae5e9
Non-moved added lines: 51
~~~

Non-moved added lines — число обычных добавленных строк в git diff --color-moved=dimmed-zebra по перечисленным файлам кода от базы, без документации. Эвристика может не распознать дословные комментарии/фрагменты; фактическое совпадение кода и комментариев подтверждено pure-move и всех объявлений — AST. Полные локальные артефакты split7-color-moved.log и split7-non-moved.log.

## Проверки

Все команды отдельно и последовательно, с настоящими exit codes дочерних процессов. npm/npx на Windows запускаются через npm-cli.js/npx-cli.js установленного Node. До базового tsc .next/dev/types отсутствовал; dev/build не запускались.

| Команда | До: код и результат | После: код и результат |
|---|---|---|
| npx tsc --noEmit | 0 | 0 |
| npm run lint | 0; 0 предупреждений ESLint | 0; 0 предупреждений ESLint |
| npm run test:unit | 0; 5480 passed / 265 skipped / 0 failed | 0; 5480 passed / 265 skipped / 0 failed |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; 318 / 28 |
| npx vitest run src/components/piling/operator-mobile | 0; 330 passed / 0 skipped / 0 failed | 0; 330 / 0 / 0 |
| Внешний innerHTML harness | 0; 54 passed | 0; 54 passed |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

| Шаг | tsc | lint | Целевой Vitest | pure-move |
|---|---:|---:|---|---:|
| 1 | 0 | 0 | 0; 330 passed | 0 |
| 2 | 0 | 0 | 0; 330 passed | 0 |

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

Временный harness D:/PillingR/split-operator-mobile-app-1024-tools/layout.config.mts и копии сценариев со штатными заглушками находятся вне репозитория. Во внешних копиях render собирает контейнеры, expect остаётся исходным, асинхронный afterEach сохраняет raw container.innerHTML после завершения сценария и эффектов до cleanup; оригинальные тесты не изменены. Дата фиксируется только в harness для воспроизводимости, DOM не нормализуется. Проверка стабильности на исходных текстах и сравнение после переноса — побайтно по полным файлам снимков. Всего 54 сценариев, 54 с DOM, 54 вариантов HTML в пределах сценария. Итог: 54 файлов, changed=[], added=[]. Артефакты layout-before/, layout-before-repeat/, layout-after/ в D:/PillingR/split-operator-mobile-app-1024-tools. Это happy-dom, не живой браузер.

## GitNexus

Runner D:/PillingR/split-operator-mobile-app-1024-tools/gitnexus-run.cjs скопирован из штатного runner; repo явно задан абсолютным путём. До правок выполнены свежий analyze --index-only, list, query/context OperatorMobileApp и file-qualified upstream impact каждого переносимого символа. Все impact завершились с кодом 0, partial=false, truncated=false. UNKNOWN подтверждался поиском rg по репозиторию, а не считался отсутствием использования.

| Символ | Риск | Прямых / всего | Процессов |
|---|---|---|---:|
| PHASE_STAGE | UNKNOWN | 0 / 0 | 0 |
| AUTH_REDIRECT_MS | UNKNOWN | 0 / 0 | 0 |
| AUTH_EXPIRED_NOTICE | UNKNOWN | 0 / 0 | 0 |
| STALE_SCREEN_NOTICE | UNKNOWN | 0 / 0 | 0 |
| STALE_AFTER_REJECT_NOTICE | UNKNOWN | 0 / 0 | 0 |
| QUIET_RELOAD_EVERY_MS | UNKNOWN | 0 / 0 | 0 |
| WorkTab | LOW | 1 / 2 | 0 |
| Detour | UNKNOWN | 0 / 0 | 0 |
| OperatorFrame | LOW | 1 / 2 | 0 |
| ShiftMissingScreen | LOW | 1 / 3 | 0 |

Общее покрытие flows ограничено бюджетами GitNexus: отсутствие flow не означает отсутствие пути. Полные impact, импортёры и результаты detect сохранены в split7-*.log. Перед каждым коммитом индекс полностью обновляется (--index-only --force), CLI detect_changes и полный LocalBackend ответ проверяются на partial/truncated. Сокращённая печать CLI не заменяет полный ответ.

## Что оставлено и ограничения

OperatorMobileApp оставлен целиком. Его очередь команд, ключи повторной отправки, последовательность хуков/эффектов, тихое перечитывание раз в 15 секунд и уход на вход через 2500 ms сохранены дословно. Новых параметров не вводили; к 500 строкам не сокращали (фактически 982 вместо 1118). PHASE_STAGE по смыслу дублирует v10: не объединяли. Импорт operator-type.css остался ровно в основном файле; config/frame CSS не импортируют. Новых дефектов переносимого кода не установлено.

### Отделимые блоки — только материал владельцу

Число параметров — существующие динамические привязки вне выбранного JSX. Импорты и локальные переменные внутри фрагмента не считаются; нет искусственного объединения параметров в объект. Ничего из перечисленного не выделено. Строки итогового operator-mobile-app.tsx.

| Блок | Строки | Параметров | Какие |
|---|---|---:|---|
| Карточка отказа по роли с выходом | 444–462 | 1 | forbidden (logoutClient импортируется) |
| Карточка сбоя загрузки и повтора | 482–494 | 3 | loadError, reload, serverFault |
| Происшествия и профиль во вкладке «Ещё» | 734–747 | 6 | actionError, busy, incidentCommandId, reportIncident, setDetour, state |
| Уведомление о несвежем экране с обновлением | 961–976 | 3 | notice, quietReload, staleScreen |

Подсчёт TypeScript checker сохранён в split7-extractable-blocks.log. Это будущие интерфейсы, не выполненные изменения; очередь/тихое перечитывание отдельно не извлекались.

### Точный способ сравнения HTML и его ограничения

Первый sampler при успешных expect дал 41 файл/60 наблюдений. Сравнение после переноса обнаружило один промежуточный кадр OperatorFrame: offset ещё null (min-h-dvh), либо уже 0 (calc(100dvh - 0px)). Такой же разброс воспроизвёлся на исходной базе без переноса; синхронные flushSync/resize внутри assert не сделали точку наблюдения устойчивой. Эти попытки не приняты за доказательство совпадения. Артефакты layout-unsettled-frame-*, layout-first-flush-*, layout-resize-flush-* и соответствующие логи сохранены.

Итоговый sampler снимает устоявшееся состояние после завершения сценария: асинхронный afterEach ожидает React act, выполняет resize и ожидает эффекты до cleanup. Ранний кадр до измерения рамки не сравнивается; DOM/атрибуты/тексты не нормализуются. 41 исходный сценарий (app, step-bar-flow, queue-flow) дополнен 8 фазами, 2 случаями отсутствующей смены и 3 состояниями очереди до повтора (network/409/503): всего 54 непустых снимка. В первой версии дополнительных фаз минимальная рабочая фикстура не содержала полей допуска/осмотра: были React TypeError и 5 пустых снимков при exit 0; этот результат не засчитан. Внешние данные дополнены полями из штатных сценариев, ожидание состояния усилено и пустой снимок теперь приводит к ошибке harness. Артефакты layout-incomplete-fixture-* сохранены. Оригинальные тесты/фикстуры репозитория не менялись.

Для нового эталона основной файл временно восстановлен через git show из точной базы 7c5aed427732992fbec905281cd07440cccb1e94, два собственных новых файла временно сохранены вне дерева. git diff --exit-code <база> -- src e2e tests scripts prisma дал 0 (split7-reference-source-clean.log). На этих исходных текстах выполнены два одинаковых исходных прогона по 54 случая; совпали все файлы. В finally восстановлены точные сохранённые финальные байты и оба файла; pure-move/AST повторены, hash основного компонента тот же. После восстановления все 54 случая прошли и все 54 файла совпали побайтно. Полных unit-прогонов по-прежнему два, оба 5480/265/0; контроль исходной базы дополнительно выполнял только временный HTML-harness.

Внешний Date фиксируется через stubGlobal классом (21.09.2026), без принудительной установки fake timers: штатные сценарии сами управляют fake timers для 15000/2500 ms. Это позволяет сохранить их проверки таймеров. Эталон не заменяет проверку реального браузера, viewport и начального paint.


Живой браузер, E2E, физическое устройство, production и реальная БД не проверялись. Playwright только --list; skipped не считаются проверенной интеграцией. Build/Next route types проверяет Claude при приёмке. Без push/merge/deploy/SSH, правок схемы/миграций, auth/security, .env и зависимостей.

## Окружение и артефакты

npm ci завершился кодом 1 (postinstall без DATABASE_URL_POSTGRES); отдельная генерация клиента: 0. Пакеты установлены по lockfile. Разрешённое фиктивное значение передано только дочерней команде npm run db:generate в RAM, нигде не сохранено; .env не читались/создавались. Новых пакетов для harness не ставили: node_modules junction ссылается на рабочую папку. Все реальные коды и полные журналы split7-*.log / *-exit.log в рабочей папке; игнорируются Git.

## Граф перед коммитами

Шаг 1: {"partial":false,"truncated":false,"summary":{"changed_count":11,"affected_count":0,"changed_files":2,"risk_level":"low"},"changedSymbols":11}

Шаг 2: {"partial":false,"truncated":false,"summary":{"changed_count":39,"affected_count":0,"changed_files":6,"risk_level":"low"},"changedSymbols":39}

Compare от базы (код 0): {"partial":false,"truncated":false,"summary":{"changed_count":50,"affected_count":0,"changed_files":7,"risk_level":"low"},"changedSymbols":50}

Все detect CLI/LocalBackend: код 0, partial=false, truncated=false; общие ограничения покрытия flows не означают отсутствие влияния.
