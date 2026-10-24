# Задание №2: разделение to-module.tsx

Дата: 24.10.2026. Ветка: codex/split-to-module.
База main: 89f31203a8f2ac0e55381fdf18c10741fc4b3455.
Рабочая папка: D:/PillingR/wt-split-to-module-1024.
Задание №1 принято владельцем. Задание №3 не начато.

## Что сделано

1. f15eecc0 — «Вынести конфигурацию оболочки технической готовности».
2. Коммит, содержащий этот отчёт (HEAD ветки после завершения), — перенос функций чтения и материалы проверки. Точный хеш указан в итоговом сообщении владельцу; git log -2 показывает оба коммита.

| Файл | До | После | Содержимое |
|---|---:|---:|---|
| src/components/piling/to/to-module.tsx | 923 | 716 | Полный ToModule и импорты/переэкспорты |
| src/components/piling/to/to-module-config.ts | — | 119 | Константы, ModuleSurface, парсеры представлений |
| src/components/piling/to/to-module-data.ts | — | 94 | WorkspaceIssue, функции чтения, EMPTY_PERMITS_PAGE |

Удалённых файлов нет. Тесты и внешние импортёры не изменены. Две страницы admin/to и admin/safety продолжают импортировать ToModule по старому пути. ModuleSurface и TECH_READINESS_PRODUCTION_SHELL_ENABLED переэкспортированы из старого файла. Документы 00-common.md, 02-to-module.md и check-pure-move.cjs скопированы из папки владельца без правок; добавлен этот отчёт.

## Доказательство переноса

Команда (код 0 после первого переноса и после обоих переносов; после первого в списке только основной файл и config):

~~~sh
node docs/plans/tasks/split-1024/check-pure-move.cjs 89f31203a8f2ac0e55381fdf18c10741fc4b3455 src/components/piling/to/to-module.tsx src/components/piling/to/to-module.tsx src/components/piling/to/to-module-config.ts src/components/piling/to/to-module-data.ts
~~~

Полный вывод:

~~~text
строк кода до: 811, после: 811
OK: чистый перенос, отличаются только import/export
~~~

Дополнительная AST-проверка всех объявлений исходного файла: 23/23 совпадают дословно с базой после удаления только начального export и нормализации CRLF. Совпадает весь ToModule; SHA256 его текста: 5767be9017c2f8ef2738b4fdb18a8549cc172b6737a1d9139f40a627bed51cec.

При git diff --color-moved=dimmed-zebra от базы по трём исходным файлам: 38 добавленных строк не отмечены как перенесённые (после первого шага — 25). В число входят строки import/export, пустые строки и фрагменты, которые эвристика Git не сопоставила; например неизменённый комментарий SURFACE_HOME и значения SURFACE_LABEL. Это не 38 правок логики: проверка строк и всех объявлений подтверждает совпадение. Полные локальные артефакты: split2-color-moved.log и split2-non-moved.log в корне рабочей папки; они игнорируются Git.

Feature flag скопирован дословно в верхний уровень config:

~~~ts
export const TECH_READINESS_PRODUCTION_SHELL_ENABLED =
  process.env.NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL !== 'false';
~~~

Выражение осталось статическим доступом к той же NEXT_PUBLIC-переменной, без динамического имени и без переноса вычисления внутрь функции. Config импортируется статически при загрузке клиентского модуля. Проверена локальная документация установленного Next о NEXT_PUBLIC-inlining. Сам production build не запускался.

## Проверки

Все команды запущены отдельно, последовательно, без параллельного запуска проверок. npm/npx на Windows вызывались через соответствующие npm-cli.js/npx-cli.js установленного Node; коды взяты из завершения дочерних процессов. Перед базовым tsc каталог .next/dev/types проверен: отсутствовал; ни dev, ни build затем не запускались.

| Команда | До: код и результат | После: код и результат |
|---|---|---|
| npx tsc --noEmit | 0, без диагностик | 0, без диагностик |
| npm run lint | 0, 0 ошибок/предупреждений ESLint; text integrity passed | 0, тот же результат |
| npm run test:unit | 1; 5478 passed / 265 skipped / 2 failed; 492 passed / 15 skipped / 2 failed файлов, всего 509 | 0; 5480 passed / 265 skipped / 0 failed; 494 passed / 15 skipped / 0 failed файлов, всего 509 |
| npx playwright test --list | 0; 318 тестов / 28 файлов | 0; 318 тестов / 28 файлов |
| npx vitest run src/components/piling/to/__tests__/to-module-shell.test.tsx src/components/piling/to/__tests__/to-panels-mobile-targets.test.tsx | 0; 67 passed (52 + 15), 0 skipped/failed, 2 файла | 0; те же 67 passed, 0 skipped/failed, 2 файла |
| npm run build | не запускался | build не проверен, проверит Claude при приёмке |

После первого переноса отдельно выполнены tsc (0), lint (0), те же целевые тесты (0; 67 passed), pure-move (0) и GitNexus detect_changes (0) до первого коммита. Полный unit-прогон после переноса был один: зелёный; исходный красный прогон не скрыт и не заменён узким повтором.

В исходном полном unit-прогоне на неизменённом tracked-коде базы упали:

- src/lib/__tests__/tenant-scope.test.ts:83:30 — тест «запрещено: фильтр ставится только при истинном тен…»: превышен таймаут 5000 ms при обходе исходных файлов.
- src/workers/__tests__/unified-worker.test.ts:230:5 — «returns health status with worker information»: превышен таймаут 30000 ms на импорте unified-worker.

Оба файла вне задания; их код и таймауты оставлены прежними. Продолжение основано на разрешённом владельцем исключении для исходных несвязанных падений. После переноса оба прошли, новых падений нет, passed вырос на 2, skipped не изменился. Общий объём остался 5745 тестов. Причину исходных таймаутов глубже не диагностировали; итоговый зелёный запуск не доказывает отсутствие нестабильности. Vitest до/после также выводит предупреждение Vite о configLoader native/ESM; оно не является предупреждением ESLint и не подавлялось.

Локальные полные логи и реальные коды: split2-baseline-*.log, split2-step1-*.log, split2-final-*.log и соответствующие *-exit.log в рабочей папке. Это локальные игнорируемые файлы, в коммит не включены.

## Окружение

Изначально новая рабочая папка создана приложением на C. Установку npm ci остановили из-за критического недостатка места. Проверив абсолютные пути, перенесли только эту новую рабочую папку на D и выполнили git worktree repair (0); Git подтверждает нужную ветку и базу. Приложение отказалось привязать D как managed worktree, поэтому все команды запускались с явно заданной рабочей папкой D. Main и предыдущая рабочая папка задания №1 не изменялись.

Повторный npm ci на D завершился кодом 1 на postinstall: отсутствовала DATABASE_URL_POSTGRES. Пакеты установлены по lockfile; package.json и package-lock.json не изменены. Затем npm run db:generate с разрешённой владельцем фиктивной DATABASE_URL_POSTGRES только в окружении этой команды завершился кодом 0 (Prisma 7.10.0, patch-postgres-client). Фиктивное значение не сохранялось, окружение родителя восстановлено; .env-файлы не читались, не создавались и не изменялись. Подключений к БД, миграций и сборки не было.

## Что оставлено и ограничения

ToModule (647 строк) не разрезан: loadWorkspace замыкает состояния и AbortController, поэтому его вынос потребовал бы новых параметров/хуков и отдельной оценки гонок загрузки. Вынос loadWorkspace — отдельная будущая задача, не часть чистого переноса. Состояния, зависимости эффектов, порядок вызовов, JSX, тексты, комментарии и обработка ошибок сохранены. Существующие дубли/неиспользуемый код не чистились. Новых дефектов в переносимых блоках не установлено.

Живой браузер, innerHTML-снимки и E2E не запускались: Playwright проверял только сбор списка. Целевые тесты подтверждают только покрытые ими состояния. 265 skipped не означают проверенную интеграцию с БД. Next route types и сборку обеих страниц должен подтвердить Claude при приёмке. Никакого push, merge или deploy не было.

## GitNexus

Перед правками создан свежий индекс через внешний runner D:/PillingR/split-to-module-1024-tools/gitnexus-run.cjs (копия штатного .gitnexus/run.cjs). analyze --index-only: код 0; 33142 узла, 72180 связей, 559 кластеров, 1225 flows. Для каждого из 22 переносимых символов выполнен file-qualified impact upstream, все команды завершились кодом 0, partial=false, truncated=false.

LOW: ModuleSurface (4 прямых / 9 всего), surfaceOfView (2/4), parseView (1/3), parseSettingsSection (1/3), WorkspaceIssue (2/2), readOptionalCollectionWithIssue (1/4), readOptionalJsonWithIssue (3/5), readAuthoritativeCollection (1/4), readReadinessPartial (1/4).

UNKNOWN: VIEW_IDS, OUTCOME_STATUS, STAGE_EVIDENCE_KEY, STAGE_EVIDENCE_STATE, SETTINGS_IDS, TECH_READINESS_PRODUCTION_SHELL_ENABLED, DEFECTS_UNAVAILABLE_MESSAGE, PERMITS_UNAVAILABLE_MESSAGE, SURFACE_TABS, SURFACE_ROUTE, SURFACE_LABEL, SURFACE_HOME, EMPTY_PERMITS_PAGE (0/0 по графу). UNKNOWN не принят за отсутствие использования: поиск по тексту по src/e2e/tests/scripts/prisma и конфигурации подтвердил использования, две страницы и динамические импорты тестов. Сводка в split2-impact-summary.log, текстовый поиск в split2-importers-before.log. HIGH/CRITICAL нет.

Для impact получено 0 процессов. Сам индекс предупреждает об ограниченном покрытии flows (в том числе 2566 unranked); query ToModule не находит процессов, context показывает ToPage/SafetyPage и loadWorkspace. Поэтому 0 processes не используется как доказательство отсутствия влияния.

Перед первым коммитом индекс полностью перестроен (--force, код 0), detect_changes scope all: код 0, 2 файла / 37 символов, risk low, 0 affected processes; полный ответ backend подтверждает partial=false, truncated=false.

Перед вторым коммитом analyze --index-only --force: код 0; 33154 узла / 72196 связей / 561 кластер / 1225 flows. CLI detect_changes scope all: код 0; 6 файлов / 57 символов, risk low, 0 affected processes. Полный backend-ответ: partial=false, truncated=false. Проверка compare от базы 89f31203: код 0; 7 файлов / 94 символа, risk low, partial=false, truncated=false. Числа включают документацию; ограничение покрытия flows, указанное выше, сохраняется. Флагов усечения самого detect_changes нет. Логи split2-final-detect*.log и split2-final-compare-raw*.log. CLI сокращает печать списка символов; проверен именно полный ответ backend.
