# Поток 23 — закрытие нарядов-допусков

Рабочая папка: `D:/PillingR/wt-codex23`; ветка: `codex/permit-close-1015`; база: `cb8fc697`. Пункты 1–6 реализованы. Все семь заключительных команд завершены с exit 0 на HEAD `90b6a5ea`; пропуски и предупреждения перечислены ниже. Это не браузерная приёмка и не разрешение на влитие, применение миграции или выкладку.

## Результат по заданию

| Пункт | Статус и коммит | Изменение |
|---|---|---|
| 1. Состояние и миграция | Сделано — `1b6f14c1` | `CLOSED`, перечисление `WorkPermitCloseReason`, nullable `closedAt`, `closedById`, `closeReason`. Одна добавочная миграция, включена в явный список интеграционного спека. |
| 2. Команда закрытия | Сделано — `1ab06a5b` | Только `APPROVED` с `validFrom <= now`, право `readiness.permit.edit`, обязательная проверка версии/CAS, существующий протокол идемпотентности, аудит `work-permit.closed` и outbox. Необязательный комментарий до 500 символов хранится в metadata аудита. Будущий наряд предлагает отозвать; повторное закрытие даёт понятный отказ. |
| 3. Планировщик | Сделано — `7041eb69` | Просроченный `APPROVED` закрывается с `VALIDITY_ELAPSED`, `closedAt=now`, `closedById=null`; просроченный `PENDING_APPROVAL` по-прежнему становится `EXPIRED`. Аудит и счётчики пишутся только после успешного CAS. Повторный запуск и проигранная гонка не создают ложных событий. |
| 4. Готовность | Сделано — `1ceae01f` | Закрытый по сроку считается истёкшим; закрытый после работ не считается истёкшим даже после `validTo`. Обе причины не дают действующего допуска. Текущий согласованный наряд выбирается раньше закрытой истории; старый длинный наряд не скрывает действующую замену. Тексты различают причины закрытия. |
| 5. Экран и читатели | Сделано — `90b6a5ea` | Закрытие в настольной и мобильной карточках, подтверждение, комментарий, ошибка в окне, повтор после сетевого отказа. Отдельные фильтры закрытых и прежней заблокированной истории, нейтральные подписи, счётчики, шаги ролей, дашборд, общий фильтр/API и русское событие в журнале. Исправлена коллизия общего `status=CLOSED` с локальным фильтром «Все». |
| 6. Права | Сделано в `1ab06a5b` и `90b6a5ea` | Серверные тесты своих/чужих записей, отсутствующего tenant, прав, действования от другой роли и матрицы разрешений; UI проверяет эффективное право правки. Отдельного пустого коммита нет. Глобальные auth/RLS и перечень прав не менялись. |

Старая история `EXPIRED` не преобразуется и не считается задачей на дашборде: решение `cb8fc697` сохранено. По текущим `APPROVED` и `PENDING_APPROVAL` с прошедшим сроком задача остаётся до перехода состояния, даже при наличии замены. Для первого действие — закрыть, для второго — оформить новый; смешанная строка показывает общий счётчик и оба действия.

`CLOSED` не создаётся без `closedAt` и `closeReason` в новых путях записи. Миграция не добавляет `CHECK`, не переписывает данные, не удаляет/переименовывает колонки и не использует новое значение PostgreSQL enum в DML/default той же миграции. Найденный прежний `CHECK` проверяет границы окна, а не перечень состояний. В скриптах и SQL не обнаружен дополнительный список состояний, требующий изменения. Миграция **ни к одной БД не применялась**.

## Воспроизведение и точечные проверки

Все коды взяты из сохранённых `.exit`, а не из кода конвейера. Логи — `.gitnexus/t23/`. Тесты запускались через Node 24.19.0 и локальный Vitest, с `--maxWorkers=1 --testTimeout=30000`, где указано в логах.

| Пункт | До правки | После правки |
|---|---|---|
| 1 | exit 1; 6 failed / 17 passed | exit 0; 23 passed, 0 skipped, 1 файл; Prisma generate, исправление сгенерированного клиента штатным скриптом, migration guard, tsc, точечный lint — exit 0 |
| 2 | exit 1; 26 failed / 39 passed | exit 0; 72 passed, 0 skipped, 3 файла; tsc и точечный lint — exit 0 |
| 3 | exit 1; 6 failed / 26 passed | exit 0; 32 passed, 0 skipped, 2 файла; tsc и точечный lint — exit 0 |
| 4 | exit 1; 11 failed / 31 passed | exit 0; 42 passed, 0 skipped, 4 файла; tsc и точечный lint — exit 0 |
| 5 | exit 1; 14 failed / 41 passed; отдельно журнал: 1 failed / 16 passed; коллизия общего фильтра: 1 failed / 21 skipped при запуске по имени | exit 0; 73 passed, 0 skipped, 6 файлов; точечный lint 15 изменённых TS/test-файлов — exit 0, 0 warnings |

Промежуточный прогон пункта 5 дал 70 passed / 2 failed: тестовый mock запроса закрытия потреблялся параллельным запросом документов либо наследовал незавершаемый mock предыдущего теста. Mock сбрасывается перед каждым тестом; два сценария ошибки выполняются от механика без параллельного запроса документов. Это не выдано за найденный дефект сервера. Финальный прогон 73/73 включает оба сценария. Отдельный повтор tsc перед окончательной тестовой правкой имел exit 0; свежий заключительный tsc указан ниже.

Новые тестовые файлы добавлены только для запрошенных сценариев: новая мутация с проверкой доступа, фильтрация нового состояния API и авторитетный расчёт по обеим причинам закрытия. Остальные проверки расширяют существующие файлы. Браузерный результат не подменяется компонентными тестами.

## Итоговые проверки

Команды выполнены отдельно и последовательно через Node 24, с одним Vitest worker и таймаутом теста 30 с. Коды выхода сохранены сразу после завершения каждого процесса в `.gitnexus/t23/final-*.exit`; подробности — `final-checks.md`. Пропуски и ожидаемые падения не названы успешными тестами.

| Команда | Результат |
|---|---|
| Проверка/очистка `.next/dev/types` | Каталога нет; удаление не требовалось. Проверен абсолютный путь собственного дерева. |
| `npx prisma generate` | Выполнен в пункте 1, exit 0; безопасный отдельный config без dotenv/datasource, вывод только в собственный `src/generated`; затем штатный patch-client exit 0. |
| `npx tsc --noEmit` | Свежий заключительный запуск: exit 0 (`final-tsc.exit`). |
| `npm run lint` | exit 0, ноль предупреждений ESLint, Text integrity check passed. |
| Vitest по `src/modules/readiness src/components/piling/to/readiness src/components/piling/__tests__ --maxWorkers=1 --testTimeout=30000` | exit 0; 57 файлов, 562 passed, 0 skipped/failed; 195.36 с. |
| `npm run test:unit -- --maxWorkers=1 --testTimeout=30000` | exit 0; 402 passed / 14 skipped файлов; 4461 passed, 2 expected fail, 256 skipped тестов; 729.43 с. |
| `npx playwright test --list` | exit 0; 291 тест в 27 файлах, без уменьшения относительно финала потока 21. Только список, не запуск браузерных E2E. |
| `npm run db:check-migrations` | Заключительный повтор exit 0: непросмотренных разрушительных или зависящих от данных миграций не найдено. Статический guard, не применение миграций. |
| `npm run build` | exit 0; собственный Prisma Client сгенерирован; Next 16.4.0 webpack, встроенная проверка TypeScript, 95/95 статических страниц. Только открытые CI-значения из `.github/workflows/ci.yml`, без чтения `.env*`. |
| `tests/integration/tech-readiness-work-permits.spec.ts` | Отдельно не запускался: одноразовая БД не настроена. Рабочая `pilingtrack_test` запрещена и не использовалась. |

Предупреждения сохранены полностью: Vite о будущем `configLoader: native`; четыре Node MaxListenersExceededWarning в полном Vitest. В сборке — необязательный модуль BullMQ `@valkey/valkey-glide` не разрешён, Sentry token не задан, npm сообщает об игнорировании allow-scripts. Redis с CI localhost stub логировал ошибки и переход на in-memory fallback. 27 traced files из общего node_modules вышли за outputFileTracingRoot и не вошли в standalone. Сборка успешна; работоспособность standalone и отказоустойчивость работающего сервера этим не подтверждены. Предупреждения ради результата не подавлялись, исходники и зависимости для них не менялись.

## GitNexus и пределы проверки

Граф использован до изменений, а анализ изменений выполнен перед каждым коммитом. О рисках HIGH владелец предупреждён до соответствующих правок. Точные ранние impacts включали repository HIGH 16 / 7 прямых читателей / 3 потока; авторитетный расчёт HIGH 11 / 4 / 1; presentation HIGH 9 / 5 / 0; evaluator HIGH 9 / 1 / 1; overdue helper HIGH 6 / 3 / 1; DTO HIGH 43 / 23 / 0.

| Коммит | Staged detect-changes: файлов / символов / потоков | Код и риск |
|---|---|---|
| `1b6f14c1` | 6 / 4 / 0 | exit 0, LOW |
| `1ab06a5b` | 8 / 14 / 4 | exit 0, MEDIUM |
| `7041eb69` | 4 / 4 / 0 | exit 0, LOW |
| `1ceae01f` | 9 / 5 / 0 | exit 0, LOW |
| `90b6a5ea` | 15 / 17 / 10 | exit 0, HIGH; известная область UI/DTO/фильтров и журнала, проверена перед коммитом |

Инкрементальный индекс после пункта 1 потерял точные symbols и дал аномальный CRITICAL; несмотря на exit 0 он **не принят**. После согласованного ожидания ресурсов выполнен полный `--force --no-parse-cache --workers 1` — exit 0, 30 911 узлов / 64 221 связь; точные symbols восстановлены. Отменённая промежуточная попытка индексирования также не считается успешной проверкой.

Последний валидный полный индекс соответствует `1b6f14c1`; последующие impacts честно показывали отставание на 1–3 коммита и проверялись по конкретным неизменённым targets. UNKNOWN для enum/констант/типов не трактовался как LOW или отсутствие использования: ссылки подтверждены текстовым поиском по репозиторию. Полная карта процессов имеет собственные ограничения усечения (в частности, 2 488 отброшенных кандидатов входа, 176 budget cuts, 46 depth caps и 393 неразрешённых межъязыковых property references). Поэтому exit 0 конкретного staged detect не означает «весь граф приложения полностью проверен». Новые тестовые файлы включались в staged scope перед окончательным detect.

## Что оставлено без изменений

Не менялись зависимости/lockfile, деплой, безопасность, auth, RLS, привязка наряда к смене, политика допуска к началу смены и замороженные варианты оператора. Не выполнялись push, merge, SSH и production-проверки. `.env*` не читались. Основное дерево и сервер `localhost:3000` не переключались на эту ветку; рабочая `pilingtrack_test` не использовалась.

Поиск `EXPIRED|REVOKED|WorkPermitState` по `src`, `tests`, `e2e` и дополнительные поиски читателей сохранены в `.gitnexus/t23/`. Обязательные дополнительные читатели обновлены: серверный allowlist GET, тип фильтров query, общий select статуса, audit-label/mark. Экспорт нарядов передаёт состояние без собственного закрытого списка; русская подпись события используется в журнале, отчётах и выгрузке журнала. Прямых дополнительных сравнений состояния WorkPermit в печати, мониторинге, бригадах и карточке установки не найдено. Совпадения EXPIRED в операторском допуске относятся к документам, не к состоянию WorkPermit; эти файлы не правились.

Отдельный браузерный проход по ветке 23, применение миграции, проверка PostgreSQL enum на одноразовой БД и запуск standalone не выполнялись. `node_modules` общий, не изменялся. Это остаётся пределом проверки, а не подтверждённым runtime-результатом.

## Изменённые файлы

От `cb8fc697` до `90b6a5ea`: 39 файлов, +760 / −95 строк. Удалённых файлов и экспортов нет; доказательство неиспользования для удаления не требуется. Таблица не включает сам этот новый отчёт и игнорируемые scratch-логи.

| Файл | Строки |
|---|---|
| `prisma/migrations/20261015090000_work_permit_close/migration.sql` | +10 / −0 |
| `prisma/schema.prisma` | +9 / −0 |
| `src/app/api/readiness/work-permits/[id]/close/route.test.ts` | +45 / −0 |
| `src/app/api/readiness/work-permits/[id]/close/route.ts` | +23 / −0 |
| `src/app/api/readiness/work-permits/route.test.ts` | +36 / −0 |
| `src/app/api/readiness/work-permits/route.ts` | +1 / −1 |
| `src/components/piling/__tests__/dashboard-attention-items.test.ts` | +12 / −2 |
| `src/components/piling/dashboard-attention-items.ts` | +7 / −3 |
| `src/components/piling/to/readiness/api/__tests__/contracts.test.ts` | +10 / −0 |
| `src/components/piling/to/readiness/api/contracts.ts` | +5 / −1 |
| `src/components/piling/to/readiness/authoritative-presentation.test.ts` | +11 / −0 |
| `src/components/piling/to/readiness/authoritative-presentation.ts` | +4 / −1 |
| `src/components/piling/to/readiness/readiness-labels.ts` | +1 / −0 |
| `src/components/piling/to/readiness/screens/__tests__/permit-role-steps.test.ts` | +15 / −5 |
| `src/components/piling/to/readiness/screens/__tests__/permits-screen.test.tsx` | +88 / −2 |
| `src/components/piling/to/readiness/screens/__tests__/shared.test.tsx` | +8 / −0 |
| `src/components/piling/to/readiness/screens/permit-role-steps.ts` | +15 / −17 |
| `src/components/piling/to/readiness/screens/permits-screen.tsx` | +29 / −17 |
| `src/components/piling/to/readiness/screens/shared.tsx` | +1 / −1 |
| `src/components/piling/to/readiness/settings/__tests__/audit-labels.test.ts` | +1 / −0 |
| `src/components/piling/to/readiness/settings/audit-labels.ts` | +2 / −0 |
| `src/modules/readiness/application/__tests__/readiness-score.test.ts` | +90 / −0 |
| `src/modules/readiness/application/__tests__/scheduler.test.ts` | +57 / −8 |
| `src/modules/readiness/application/permits/commands.test.ts` | +139 / −3 |
| `src/modules/readiness/application/permits/commands.ts` | +28 / −5 |
| `src/modules/readiness/application/permits/queries.ts` | +1 / −1 |
| `src/modules/readiness/application/permits/schemas.ts` | +5 / −0 |
| `src/modules/readiness/application/readiness-score.ts` | +18 / −6 |
| `src/modules/readiness/application/scheduler.ts` | +25 / −18 |
| `src/modules/readiness/domain/evaluation/__tests__/evaluator.test.ts` | +13 / −0 |
| `src/modules/readiness/domain/evaluation/evaluator.ts` | +3 / −1 |
| `src/modules/readiness/domain/evaluation/facts.ts` | +5 / −1 |
| `src/modules/readiness/domain/permits/__tests__/work-permit.test.ts` | +7 / −0 |
| `src/modules/readiness/domain/permits/transitions.ts` | +4 / −0 |
| `src/modules/readiness/domain/permits/types.ts` | +2 / −1 |
| `src/modules/readiness/infrastructure/permits/work-permit-repository.ts` | +11 / −0 |
| `src/workers/unified-worker/__tests__/sentry.test.ts` | +16 / −0 |
| `src/workers/unified-worker/readiness-scheduler.ts` | +2 / −1 |
| `tests/integration/tech-readiness-work-permits.spec.ts` | +1 / −0 |
