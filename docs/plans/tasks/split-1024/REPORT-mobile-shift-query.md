# Задание №3: mobile-shift-query.ts

Дата: 24.10.2026. Ветка codex/split-mobile-shift-query. Рабочая папка D:/PillingR/wt-split-mobile-shift-query-1024.
База — вершина main на старте: 89f31203a8f2ac0e55381fdf18c10741fc4b3455. Задания №1–2 приняты владельцем. Владелец отдельно разрешил выполнить №3–7 последовательно без ожидания промежуточной приёмки; ветки не вливать.

## Сделано и коммиты

1. a44e8330 — «Вынести подготовку записей мобильной смены».
2. Коммит, содержащий этот отчёт (HEAD завершённой ветки), — перенос загрузчиков и материалы проверки. Точный хеш указан в итоговом сообщении; git log -2 показывает оба коммита.

| Файл | До | После | Содержимое |
|---|---:|---:|---|
| src/modules/operator-mobile/application/mobile-shift-query.ts | 780 | 617 | Основной запрос целиком, импорты и комментарий модуля |
| src/modules/operator-mobile/application/mobile-shift-entries.ts | — | 103 | DAY_MS, todayInTimezone, DOWNTIME_ONLY, ReportRows, buildEntries |
| src/modules/operator-mobile/application/mobile-shift-loaders.ts | — | 64 | round1, sitePileVolume, loadDictionaries |

queryOperatorMobileState остаётся экспортируемой под прежним именем из прежнего пути. index.ts, тесты, команды, API-потребители, другие версии операторского экрана и остальные замороженные файлы не изменены. Удалённых файлов нет. Из документов без правок скопированы 00-common.md, 03-mobile-shift-query.md и check-pure-move.cjs владельца; добавлен этот отчёт.

## Чистый перенос

Команда после обоих переносов (код 0; после первого использованы только основной файл и entries):

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 89f31203a8f2ac0e55381fdf18c10741fc4b3455 src/modules/operator-mobile/application/mobile-shift-query.ts src/modules/operator-mobile/application/mobile-shift-query.ts src/modules/operator-mobile/application/mobile-shift-entries.ts src/modules/operator-mobile/application/mobile-shift-loaders.ts
~~~

Полный вывод после каждого шага:

~~~text
строк кода до: 706, после: 706
OK: чистый перенос, отличаются только import/export
~~~

Дополнительная AST-проверка: все 9 объявлений совпали дословно с базой после удаления только начального export и нормализации CRLF. Весь текст queryOperatorMobileState сохранён; SHA256: 47318769da8a11d043ffa17ade96eb61dfb507454c174de7bea8f95abec20957. В частности сохранены все Promise.all, select/where, tenantId, порядок запросов, комментарии и обработка результатов.

В diff --color-moved=dimmed-zebra от базы по трём исходным файлам 18 не отмеченных как перемещённые добавленных строк (после первого шага — 10): импорты, добавления export и пустые строки. Это эвристика Git; фактическую неизменность остальных строк подтверждает pure-move и сравнение объявлений. Локальные артефакты split3-color-moved.log и split3-non-moved.log в корне рабочей папки.

round1 объявлен ровно один раз в loaders и импортируется основным файлом. buildEntries его не использовал, поэтому entries не импортирует loaders. Оба новых файла не импортируют query; циклических импортов между тремя файлами нет. Тип ReportRows остался внутренним для entries.

## Проверки до и после

Команды запущены отдельно и последовательно, без параллельных проверок; npm/npx вызываются через npm-cli.js/npx-cli.js установленного Node на Windows. Реальные коды завершения дочерних процессов сохранены отдельно. До tsc проверен .next/dev/types: отсутствовал; dev/build не запускались.

| Команда | Исходная база: код и результат | После: код и результат |
|---|---|---|
| npx tsc --noEmit | 0, без диагностик | 0, без диагностик |
| npm run lint | 0, 0 ошибок/предупреждений ESLint, text integrity passed | 0, тот же результат |
| npm run test:unit | 1; 5478 passed / 265 skipped / 2 failed, 493 passed / 15 skipped / 1 failed файлов | 0; 5480 passed / 265 skipped / 0 failed, 494 passed / 15 skipped / 0 failed файлов |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; 318 тестов / 28 файлов |
| npx vitest run src/modules/operator-mobile | 0; 211 passed / 0 skipped / 0 failed, 15 файлов | 0; те же 211 passed / 0 skipped / 0 failed, 15 файлов |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

После первого переноса до коммита также отдельно выполнены tsc (0), lint (0), все 211 тестов каталога (0), pure-move (0), обновление индекса (0) и detect_changes (0). Полных unit-прогонов ровно два: исходный красный и итоговый зелёный. Всего в каждом 5745 тестов / 509 файлов. Число skipped не выросло; новых падений нет. Тесты и таймауты не переписаны.

Исходные падения воспроизведены на tracked-коде чистой базы до любых переносов (git diff --exit-code: 0):

- src/lib/__tests__/tenant-scope.test.ts:83:30, тест «запрещено: фильтр ставится только при истинном тен…» — таймаут 5000 ms при обходе исходников.
- Тот же файл/строка, тест «запрещено: сырой SQL с IS NULL OR — ровно тот шабл…» — таймаут 5000 ms.

Оба вне задания. Продолжение основано на разрешённом владельцем исключении для исходных несвязанных падений. В итоговом полном прогоне оба прошли. Первопричина нестабильного времени не исследовалась; зелёный итог не отменяет исходный красный запуск. Предупреждение Vite configLoader native/ESM и диагностические сообщения React в тестах не подавлялись и не являются предупреждениями ESLint. Полные локальные журналы и коды: split3-baseline-*.log, split3-step1-*.log, split3-final-*.log и *-exit.log. Они игнорируются Git и в коммит не включены.

## GitNexus

Инструменты вынесены в D:/PillingR/split-mobile-shift-query-1024-tools, runner скопирован из штатного .gitnexus/run.cjs. Во всех запросах явно указан путь этой рабочей папки. До правок свежий analyze --index-only: код 0, 33143 узла / 72181 связь / 559 кластеров / 1225 flows. Выполнены list, query и context queryOperatorMobileState; входящие связи дополнены поиском rg по репозиторию (включая тесты, scripts, e2e, prisma и конфигурацию; без generated). Фасад index.ts и тест по старому пути подтверждены; API использует фасад.

Все восемь file-qualified impact upstream завершились с кодом 0, partial=false, truncated=false:

| Символ | Риск | Прямых / всего затронуто | Процессов |
|---|---|---|---:|
| DAY_MS | UNKNOWN | 0 / 0 | 0 |
| todayInTimezone | LOW | 1 / 2 | 1 |
| DOWNTIME_ONLY | UNKNOWN | 0 / 0 | 0 |
| ReportRows | HIGH | 1 / 3 | 1 |
| buildEntries | LOW | 1 / 2 | 1 |
| round1 | LOW | 2 / 3 | 1 |
| sitePileVolume | LOW | 1 / 2 | 1 |
| loadDictionaries | LOW | 1 / 2 | 1 |

HIGH для ReportRows сообщён владельцу ДО правок: цепочка buildEntries → queryOperatorMobileState → GET API состояния. Тип перемещён вместе с потребителем без изменения структуры. UNKNOWN для констант подтверждён текстовым поиском, а не принят за отсутствие использования. Индекс предупреждает об ограничении общего покрытия flows (2566 кандидатов не ранжированы, срезы глубины/ветвления); отсутствие процесса не доказывает отсутствие влияния. Эти ограничения указаны отдельно от флагов полного ответа detect_changes.

Перед первым коммитом analyze --index-only --force: 0; detect_changes scope all: 0, 2 файла / 15 символов, risk low, 0 affected processes; полный ответ backend partial=false, truncated=false. Логи split3-impact-*.log и split3-step1-detect*.log.

## Что оставлено и риски

queryOperatorMobileState занимает 582 строки и не разрезана: стадии чтения используют результаты предыдущих запросов и десятки локальных значений. Дальнейший вынос требует новых параметров и отдельной оценки порядка/нагрузки запросов, а это выходит за чистый перенос. Поэтому фактический остаток 617 строк немного выше ориентира 520–600; к 500 его не сокращали.

Существующие дубли константы DAY_MS и округления в других модулях не объединялись. Новых дефектов в переносимых блоках не установлено. Условия tenancy сохранены, аудит/исправление правил доступа не выполнялись.

Живой браузер, E2E, production и реальная БД не проверялись. Playwright только собирал список, 265 skipped не доказывают интеграцию. Next route types и build остаются приёмке Claude. Новых зависимостей, правок схемы/миграций/.env, push/merge/deploy нет.

## Установка

npm ci завершился кодом 1 только на postinstall из-за отсутствующего DATABASE_URL_POSTGRES, пакеты установлены по lockfile; package.json/package-lock.json неизменны. Отдельный npm run db:generate: код 0, Prisma 7.10.0 и patch-postgres-client. Разрешённое фиктивное значение передано только дочерней команде генерации в RAM, не сохранено; .env не читались/создавались. Прямых подключений к БД не выполнялось.

## Итоговый граф перед вторым коммитом

analyze --index-only --force: код 0, 33145 узлов / 72190 связей / 559 кластеров / 1225 flows. detect_changes scope all: CLI и полный backend ответ — код 0; 6 файлов / 33 символа, risk low, 0 affected processes, partial=false, truncated=false. compare от базы: код 0; 7 файлов / 48 символов, risk low, partial=false, truncated=false. В числа включена документация; общие ограничения покрытия flows сохраняются. Сокращённая печать списка CLI не заменяла проверку полного ответа backend.
