# Поток 18 — проверка и исправление остатка очереди Hermes

Дата: 11.10.2026. Рабочее дерево: `D:/PillingR/wt-codex18`, ветка
`codex/backlog-1011`, исходный main `e6aef7a4`. Выполнено 7 логических
исправлений из разрешённых максимум 12: 5 кодовых и 2 документационных.
Дополнительный коммит исправляет тип тестовой заглушки первой задачи.
Приёмка не полностью зелёная: TypeScript и build ограничены причинами ниже.

## Результат задач по порядку

| № | Задача | Результат |
|---|---|---|
| 1 | F-S3-UPLOAD-SIZE | Устарело для текущего живого пути: живой вызов `generateUploadUrl` не найден; найдены определение и barrel-export, PDF использует `uploadBuffer/deleteFile`. GitNexus UNKNOWN не доказательство ненужности, поэтому экспорт и код сохранены, коммита нет. |
| 2 | F-N1005-EQUIPMENT-DETAIL-RACE | Исправлено `32894dbe`: поколение каждого refresh, защита успеха/ошибки/finally после await, cleanup и старого callback. `e510dad3` исправляет два возвращаемых типа заглушки документов в тестах. |
| 3 | F-N1005-HISTORY-VERDICT | NO-COMMIT в исходном frontend-only scope: producer истории терял verdict. Следующая отдельная задача разрешает нужный сериализатор. |
| 4 | F-N1005-HISTORY-WIRE-VERDICT | Исправлено `f6c4385f`: существующий snapshot.verdict передаётся как verdict/null, журнал различает запрет, возврат, подтверждение и готовность с замечанием; legacy status сохранён. GET-производитель проверен вместе с parser. |
| 5 | F-R28-3 | Исправлено `32608653`: в периодной детализации показаны установка/смена, метры свай и комментарии простоев; PDF корректировки получает существующую version и подпись редакции. Уже имевшиеся поля одиночного PDF не дублировались. |
| 6 | F-OQ-TABS | Нужен расширенный scope/решение владельца: асинхронные Web Locks конфликтуют с синхронными void enqueue/retry/discard и немедленным подтверждением сохранения вызывающим кодом `src/components/piling/operator-mobile/api.ts:568`. Изменение публичного интерфейса и вызывающего `api.ts` запрещено точным заданием. GitNexus CRITICAL: enqueue 35, mutate 46 upstream. Код не менялся. |
| 7 | F-N1005-REPORT-FORM-SOURCE | Исправлено `50d61ff0`: существующий filterError передан в форму отдельным сообщением от dictionaryError; частичные списки, ввод и прежние edit-ID сохранены. |
| 8 | F-N1005-EQUIPMENT-TO-ERROR | Исправлено `20020cf5`: HTTP/сеть/malformed отделены от успешного пустого журнала, работает повтор, смена установки очищает контекст; поздний JSON, ошибка и finally не заменяют новую карточку. |
| 9 | W15-NO-ACCESS-SCREEN-FIX | Уже исправлено `add1b955`: denied-ветка requirePageAbility прерывает render переходом на /no-access; отсутствие пользователя ведёт на login. Принятый вариант не заменён устаревшим предложением inline-экрана. |
| 10 | F4-readiness-load-errors | Уже исправлено `6eced73c`: раздельное чтение readinessPartial и видимое сообщение о неполной загрузке. Повторный коммит не создавался. |
| 11 | CX-H07 | Исправлено `e2c11e63`: runbook описывает существующее восстановление в собственной одноразовой цели, manifest, гранты, очистку и реальные границы проверки. Историческое учение 27.09 сохранено. |
| 12 | CX-H13 | Исправлено `24a19a33`: независимые publication/projection pending и возраст, свежесть метрик, отдельная DLQ и диагностика только чтением. Существующее DLQ=0 при ошибке явно описано как ограничение; код не менялся. |
| 13 | F-LOG-1 | Нужен отдельный scope и runtime-стек: потенциальный источник находится вне whitelist, `node_modules/next/dist/server/web/spec-extension/adapters/next-request.js:45–55`, createAbortController добавляет close-listener. Искусственный probe с 12 контроллерами воспроизводит warning и после close оставляет 0 listeners; он НЕ доказывает источник конкретных 15 production-предупреждений. Лимит listeners не повышался, код не менялся. |

Соседние закрытые F-N1005 и задачи локального Qwen не повторялись. Обнаружение
реальной ошибки не использовалось для выхода за whitelist. Миграций не требуется
для выполненных изменений; отложенные пункты выше требуют другого scope или
дополнительных доказательств.

## Изменённые файлы

Ни одного файла/экспорта не удалено. Новых тестовых файлов нет. Ниже фактический
`git diff --numstat e6aef7a4 HEAD` перед добавлением этого отчёта: 19 путей;
`+/-` означает добавленные/удалённые строки, а не изменение длины файла.

| Путь | + | − |
|---|---:|---:|
| docs/runbooks/004-outbox-backlog.md | 81 | 123 |
| docs/runbooks/010-restore-drill.md | 75 | 76 |
| src/app/api/readiness/history/route.ts | 1 | 0 |
| src/components/piling/admin-equipment/__tests__/equipment-mobile-targets.test.tsx | 109 | 1 |
| src/components/piling/admin-equipment/detail/__tests__/equipment-detail-overview.test.tsx | 142 | 2 |
| src/components/piling/admin-equipment/detail/equipment-detail.tsx | 17 | 4 |
| src/components/piling/admin-equipment/equipment-to-tab.tsx | 41 | 13 |
| src/components/piling/admin-reports/__tests__/admin-reports.test.tsx | 16 | 2 |
| src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx | 30 | 0 |
| src/components/piling/admin-reports/admin-reports.tsx | 1 | 0 |
| src/components/piling/admin-reports/report-form-dialog.tsx | 7 | 1 |
| src/components/piling/to/__tests__/to-module-shell.test.tsx | 25 | 0 |
| src/components/piling/to/readiness/api/__tests__/contracts.test.ts | 35 | 1 |
| src/components/piling/to/readiness/screens/reports-screen.tsx | 29 | 16 |
| src/lib/__tests__/pdf-generator.test.ts | 54 | 0 |
| src/lib/pdf-data.ts | 4 | 2 |
| src/lib/pdf-generator/components.ts | 19 | 4 |
| src/lib/pdf-generator/single-pdf.ts | 3 | 2 |
| src/modules/reports/application/queries/__tests__/export-reports-csv.test.ts | 10 | 0 |

Этот новый отчёт — двадцатый путь. Документация удаляет устаревшие инструкции
восстановления в общей БД, чтения секретов и мутаций очереди; исходники не удалены.

## Воспроизведение и узкие проверки

Каждая кодовая задача сначала воспроизведена существующим тестом. Числа ниже
относятся к конкретным сохранённым запускам, все без skipped/expected fail.

| Задача / лог | До правки, exit 1 | После правки, exit 0 |
|---|---|---|
| Карточка: detail-race-red.log; detail-race-callback-red.log | 7 failed / 28 passed; дополнительный old callback: 1 failed / 35 passed | detail-race-green.log: 54 passed / 6 файлов; независимый прямой spec: 36 passed |
| История: history-red.log | 6 failed / 47 passed | history-green-final.log и history-review-tests.log: 53 passed / 2 файла |
| PDF: pdf-red.log; pdf-comment-red.log | 3 failed / 55 passed; длинный комментарий: 1 failed / 33 passed | pdf-green.log: 80 passed / 4 файла; pdf-quality-comment.log: 34 passed |
| Форма: form-source-red.log | 4 failed / 34 passed | form-source-green.log и form-quality-tests.log: 38 passed / 2 файла |
| Журнал ТО: equipment-to-red.log | 11 failed / 25 passed; malformed дополнительно вызвал необработанные React-ошибки | equipment-to-green-final.log и to-quality-tests.log: 36 passed / 1 файл, без этих ошибок |

ESLint изменённых кодовых файлов с `--max-warnings 0` — exit 0, ноль
предупреждений. Повторная совместная проверка карточки/истории после исправления
типов заглушки: `history-race-quality-tests.log`, exit 0, 107 passed / 8 файлов.
Проверка существующего lag-monitor.test.ts для документации: exit 0,
14 passed (`docs004-lag-test.log`, независимый `runbook004-quality-tests.log`).
Проверки ссылок runbook 010/004 через Test-Path: соответственно 8/8 и 3/3
существуют; `git diff --check` — exit 0. Docker/restore/SSH/scp не запускались.

## Финальные проверки §6

Рабочая директория всех команд — `D:/PillingR/wt-codex18`. Для Node-команд
установлен `NODE_OPTIONS=--require=D:/PillingR/wt-codex18/output/codex-t18/no-secret-files.cjs`:
guard запрещает чтение .env-файлов. Настоящие секреты не читались и значения
приложения ради зелёной проверки не подставлялись. Унаследованные DATABASE_URL,
DATABASE_URL_POSTGRES, DATABASE_URL_APP_ROLE и REDIS_URL для тестов очищены.

| Команда / действие | Exit | Фактический результат |
|---|---:|---|
| Test-Path -LiteralPath .next/dev/types | 0 | False; удаление отсутствующего каталога не потребовалось. |
| npx prisma generate --config output/codex-t18/prisma-generate.config.ts; node scripts/patch-postgres-client.js (отдельно) | 0 / 0 | Генерация клиента без dotenv и изменение только игнорируемого generated-кода; schema и migrations не менялись. |
| npx tsc --noEmit | 1 | Финальный запуск не прошёл: только 4 исходные TS2353 sendDefaultPii. Исходный запуск до правок: exit 2, те же 4 ошибки. Ошибок выполненных исправлений в финальном выводе нет. |
| npm run lint | 0 | ESLint без предупреждений, Text integrity check passed. |
| Полный npx vitest run с безопасным config (команда ниже) | 0 | 4211 passed + 2 expected fail + 257 skipped = 4470; 391 passed файлов + 13 skipped = 404; 405,29 с. |
| npx playwright test --list | 0 | 291 тест / 27 файлов, совпадает с исходным сбором. Это только collection, не запуск браузера. |
| npm run build | 1 | Missing DATABASE_PROVIDER и SESSION_SECRET; остановка на validate-env до компиляции Next. Проверка route types сборкой не выполнена. |

Четыре исходные TypeScript-ошибки: `sentry.edge.config.ts:12`,
`sentry.server.config.ts:17`, `src/instrumentation-client.ts:24`,
`src/workers/unified-worker/sentry.ts:34`. Зависимости связаны junction с main;
их исправление относится к другому потоку, здесь версии/конфиги Sentry не менялись.

Полный unit-run выполнялся вместо стандартного config, который читает .env:

```powershell
npx vitest run --config output/codex-t18/vitest.no-env.config.ts --maxWorkers=2 --testTimeout=30000 --reporter=default --reporter=json --outputFile.json=output/codex-t18/full-vitest.json
```

Логи: `output/codex-t18/tsc-baseline.log`, `tsc-final.log`, `lint-final.log`,
`full-vitest.log/json`, `playwright-baseline.log`, `playwright-final.log`,
`build-baseline.log`, `build-final.log`. Игнорируемые guard/config/log-артефакты
сохранены для воспроизведения; в коммиты не включены. Подготовка клиента не
доказывает подключение к БД. Skipped-интеграции не считаются успешной DB-проверкой.

## GitNexus и оставшиеся ограничения

Использован реальный CLI GitNexus 1.6.12 с индексом именно этого worktree;
имя другого PilingTrack-индекса не использовалось. Выполнены upstream impact
до правок и detect-changes перед коммитами, логи сохранены в output/codex-t18.
UNKNOWN для generateUploadUrl и history.handleGet сохранён явно; текстом
подтверждены barrel-export либо действующий вход GET и клиентский URL, без
вывода «нулевые callers = безопасно удалить». HIGH для PDF предупреждён до
правок. У формы предварительный impact LOW, но detect_changes HIGH / 10
процессов: сообщение и независимый review выполнены. CRITICAL очереди оставлен
без правок. Индексация ограничивала число process-кандидатов/обходов; отсутствие
execution flow в графе не использовано как доказательство отсутствия влияния.
Финальное сравнение `detect-changes --scope compare --base-ref e6aef7a4`
с лимитом 1000 — exit 0: 19 файлов, 59 символов, 15 execution flows, HIGH.
Предупреждение HIGH сообщено; результат не объявлен низкорисковым. Partial/
truncated-флаги отсутствуют; краткий вывод CLI сокращает только перечисление.

Браузерная приёмка изменённых экранов BLOCKED: отсутствуют необходимые настройки
локального приложения; build этого не подменяет. Form Select в unit-тесте —
заглушка, её результат не объявлен проверкой Radix в браузере. PDF проверен
генератором и содержательными spy/assertions, в том числе длинным комментарием;
визуальное расположение всех страниц не проверено, пагинация очень длинного
комментария остаётся риском. Production-стек F-LOG-1 не получен.

Никаких push/merge/deploy/SSH/production-DB действий нет. Не менялись .env,
prisma/schema.prisma, prisma/migrations, package.json, package-lock.json,
защищённые auth/security/tenancy области, ORION и посторонние варианты операторов.
Main за время работы продвинулся до `b427adc1`; новые изменения не интегрировались
в эту ветку. Слияние и выкладка остаются решением владельца.
