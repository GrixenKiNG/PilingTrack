# F — контракт надёжности телеметрии

Дата: 23.10.2026. Ветка: `codex/telemetry-contract-1023`.
Worktree: `D:/PillingR/wt-telemetry-contract-1023`.
База: `064e2402dfddaa1a0b4ce6842fa1f113eec4b65e`.
Проверенный коммит реализации тестов и контракта:
`dab1883135cf551c5e4a6cd1bf565c1b756b1c4e`.

## Итог

Контракт и воспроизводимый набор на настоящем PostgreSQL добавлены. Производственное
поведение не изменялось. Два подтверждённых ограничения **остались**: дедупликации
`(deviceId, ts)` нет, а reset накопительного счётчика не распознаётся как новая
эпоха. Зелёные характеризующие тесты не означают исправления этих ограничений.

Сервис пользовательской телеметрии возвращает ACK до записи; device-маршрут
`/api/telemetry/ingest` устроен иначе — его `createMany` завершается до HTTP 202.
Device HTTP-путь проверен по исходнику, не живым HTTP-тестом.

Полная таблица «случай → ожидание → факт → вывод» и предлагаемые границы целевого
контракта находятся в `src/services/telemetry/RELIABILITY.md`.

## Изменения

Коммит `dab18831` — `test(telemetry): document reliability and verify real process boundaries`.

| Файл | Строки | Назначение |
| --- | --- | --- |
| `src/services/telemetry/RELIABILITY.md` | +105 / −0 | Письменный контракт, текущие и целевые гарантии, таблица восьми случаев |
| `src/services/telemetry/__tests__/run-reliability-disposable.sh` | +12 / −0 | Создание/удаление только своей одноразовой БД, генерация клиента, явный запуск тестов |
| `src/services/telemetry/__tests__/telemetry-process.fixture.ts` | +37 / −0 | Настоящие дочерние процессы со штатным ingestion/buffer и app-ролью PostgreSQL |
| `src/services/telemetry/__tests__/telemetry-reliability.integration.ts` | +179 / −0 | Восемь проверок через IPC, реальные записи и чтение БД |

Удалений нет. Полный файл задания остаётся у координатора, в этот коммит не включён.
Этот отчёт сохраняется отдельным коммитом документации после проверок.

## Доказательства поведения

| Случай | Факт PostgreSQL и процессов |
| --- | --- |
| Подтверждение RAM | `buffered-*`, RAM=1, строк=0; явный flush → строк=1 |
| Авария и перезапуск | SIGKILL первого процесса; строк=0, новый процесс не восстанавливает событие |
| Штатное завершение | Явный `shutdown()` → строк=1 при доступной БД |
| Переполнение | max=4, OPEN → dropped=1; после reset остаются значения [2,3,4] |
| Повтор | Один `metadata.deviceId` и timestamp → 2 строки |
| Обратный счётчик | 1000→5 сохранено без изменения значений |
| Сдвиг часов | 2026, 2036, 2000 сохранены без исправления дат |
| Несколько процессов | Два одновременно живых разных PID, по одной записи в RAM; оба flush → 2 строки |

В переполнении OPEN включён через явно обозначенный fault injection в реальный
circuit breaker. Это **не** испытание реального отказа PostgreSQL. Проверка
сохранения оставшихся данных использует настоящую БД; DB-функции не мокались.

Установлены зависимости из lockfile (`npm ci --ignore-scripts`, exit 0), без новых
пакетов/изменения версий. В обоих успешных прогонах PostgreSQL создавался
`scripts/test-db-up.sh` на случайном loopback-порту; существующие 113 миграций
применены через integration config. Генерация клиента выполнялась через тот же
конфиг, который не загружает dotenv. Запись — app-role через штатный tenant context;
проверка результата — owner-role. Синтетическая организация уникальна для прогона.

## Проверки и настоящие коды возврата

Логи находятся рядом с этим отчётом, не входят в Git. Каждая команда запускалась
отдельно без `tail`/`head` в конвейере проверяемой команды.

| Команда | Exit | Результат |
| --- | --- | --- |
| `npm ci --ignore-scripts` | 0 | Lockfile не изменён; npm сообщил 6 high advisory, исправление зависимостей вне задачи F |
| Первый `bash output/telemetry-contract-1023/run-disposable.sh` через Windows bash | 1 | Ошибка оболочки: `Missing command: node`, до создания БД; исправлен выбором установленного Git Bash |
| Первый `npx tsc --noEmit` до завершения генерации клиента | 1 | Отсутствовал `src/generated/postgres-client`; это ошибка порядка проверки, сохранён `tsc-initial.log` |
| Первый disposable runner через Git Bash | 0 | 8 passed / 0 failed / 0 skipped, 10.07 с, `integration.log` |
| `npx tsc --noEmit` после генерации | 0 | `tsc.log` пуст; stale `.next/dev/types` в новом worktree отсутствовали |
| `npm run lint` | 0 | ESLint и проверка целостности текста, `lint.log` |
| `npm run check:layers` | 0 | 4 grandfathered, 0 новых, `layers.log` |
| `npx vitest run src/services/telemetry src/app/api/telemetry --maxWorkers=2` | 0 | 7 файлов, 50 passed / 0 skipped / 0 failed, `unit-targeted.log` |
| `npm run test:unit -- --maxWorkers=2` | 0 | 488 файлов passed / 15 skipped; 5366 passed / 265 skipped / 0 failed (5631 всего), 440.09 с, `unit.log` |
| `npx playwright test --list` | 0 | 315 тестов в 28 файлах; это только коллекция, браузерные E2E не запускались |
| `npm run build` | 1 | Нет `DATABASE_PROVIDER`, `SESSION_SECRET`; значения не подставлялись; Next build до проверки маршрутов не дошёл |
| `Git Bash src/services/telemetry/__tests__/run-reliability-disposable.sh` | 0 | Финальный tracked runner: 8 passed / 0 failed / 0 skipped, 6.85 с, `integration-final.log` |
| `git diff --cached --check` | 0 | Нет ошибок whitespace |

После каждой одноразовой БД trap `test-db-down.sh` успешно удалил созданный им
контейнер. Все дочерние процессы fixture завершены, чужие контейнеры не трогались.
Полный unit запускался без удержания одноразовой БД; его 265 пропусков не заменяют
отдельный real-PG прогон. Этот прогон не менял unit-численность базы, а восемь
новых интеграционных запускаются явной командой, не входят в glob Vitest.

## GitNexus и ограничения графа

Применены skills GitNexus impact analysis и testing-principles. Индекс явно привязан
к этому worktree, база `064e2402`. Первичная индексация exit 0: 32525 nodes,
71067 edges; после новых файлов — 32532 nodes, 71074 edges. Обе версии показывают
1221 ограниченный flow; отсутствие flow не считается доказательством отсутствия
влияния.

До изменения файлов: `impact TelemetryBuffer --direction upstream --repo .`, exit 0,
LOW, impacted=7, direct=1 (`telemetry-ingestion-service.ts`), моделируемых processes=0.
Реальные вызывающие места в facade, MQTT, API route/batch подтверждены текстовым
поиском. Существующие функции приложения не редактировались.

Начальный detect до staging не видел untracked, а первый staged detect сообщил
`no indexed symbols overlap` — оба **не** приняты за чистую проверку. Индекс
обновлён, после чего перед коммитом вызван backend `detect_changes(scope=all,
repo=<этот worktree>, worktree=<этот worktree>)`: exit 0, changed_files=4,
changed_count=6, affected_count=0, risk=low; `error`, `partial`, `truncated`
отсутствуют. Сводка сохранена в `detect-final.json`; независимый полный compare
от базы с `dab18831` и staged-отчётом — `detect-final-code-raw.json`
(changed_files=5, changed_count=6, affected=0, risk=low, без partial/truncated/error). Шесть символов — секции
Markdown; тестовые callbacks этим индексом не покрыты, поэтому граф не заменяет
живой прогон тестов.
Перед отдельным коммитом отчёта повторён `scope=all`: changed_files=1,
changed_count=0, affected_count=0, risk=low, без partial/truncated/error.
Это ожидаемый предел индекса для `output/REPORT.md`, не доказательство
отсутствия изменений. Единственный staged-файл проверен также через git diff.

## Что осталось и что намеренно не менялось

- Не добавлялись `deviceId`, уникальность или миграции: схема и prisma заморожены.
  Дедупликацию в RAM не выдаём за решение для нескольких процессов/рестартов.
- Не исправлялся reset в аналитике: путь за пределами F. В текущем коде max−min
  для [1000,5] даёт 995; подтверждены формула в исходнике и raw-последовательность
  на БД, полноценный HTTP-вызов аналитики не выполнялся. Координатор уведомлён.
- Нет предложенной жёсткой бизнес-гарантии процента потерь. Документ предлагает
  разделить диагностические сигналы и данные учёта, затем принять бюджет потерь.
- Redis redesign, новый durable transport, квоты между процессами — только
  направления отдельного проекта; реализация здесь отсутствует.
- Не проверены физические датчики, MQTT broker, сигналы оркестратора, авария
  PostgreSQL, доставка на production, полная работа HTTP-маршрутов и браузера.
- Build не прошёл из-за отсутствия окружения; готовность Next-маршрутов этим
  прогоном не доказана. Секреты/`.env`/external credentials не читались и не
  создавались, production и frozen zones не менялись; push/merge/deploy отсутствуют.
