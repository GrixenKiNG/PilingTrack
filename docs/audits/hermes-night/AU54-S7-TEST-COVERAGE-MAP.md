# AU54-S7-TEST-COVERAGE-MAP — карта тестового покрытия по модулям

HEAD рабочей папки: `4d1091b275405cfc04fb69eee3326b1d0af9f97b` (ветка `hermes/q4-0926`).
Аудит только на чтение; код приложения не менялся. Существующие отчёты в `docs/audits/` (кроме этого файла), `CODEX-REPORT*`, `docs/strategy` не читались — это независимый первый проход.

## Итог

- Всего в `src/modules/*` и `src/services/*`: 250 файлов-исходников (217 + 33), 104 тестовых файла (81 + 23), 1165 блоков `it(`/`test(` (816 + 349).
- Найдено 30 находок: 5 критично, 19 важно, 6 мелочь.
- Крупнейшая незакрытая область по объёму — `pile-journal-*` (~801 строка, 0 упоминаний в тестах) и `report-export.service.ts` (376 строк, нет прямого теста).
- Ни один тест не подгружает путь команд дефектов допуска (`src/modules/readiness/application/defects/commands.ts`, 232 строки) и его репозиторий (154 строки): роут `/api/readiness/defects` вообще без route-теста.
- Порог покрытия в конфиге — 24/23/19/19 % (`vitest.config.ts:69-74`), это «храповик» (floor), а не цель: глобальное покрытие по факту около четверти кода.
- Топ-5 важнейшего: (1) команды дефектов допуска без тестов; (2) сквозная запись отчёта покрыта только гейтнутым спецом; (3) глобальный порог покрытия ~24 %; (4) `report.aggregate.ts` без прямого теста; (5) у дефектов нулевой route-тест.

## Методика

Все числа получены командами, тесты НЕ запускались.

1. Версия:
   `git rev-parse HEAD` → `4d1091b275405cfc04fb69eee3326b1d0af9f97b`.
2. Таблица «каталог / исходники / тесты / it+test / LOC»: node-скрипт обходит `src/modules/*` и `src/services/*` (файлы `*.ts`/`*.tsx`, кроме `*.test.ts(x)` и `*.d.ts` — это «исходники»; тестовые — `*.test.ts(x)`), LOC = число строк по `\n`, `it/test` = совпадения `\b(it|test)\s*\(`.
3. «Парный тест» определялся по графу импортов, а не по имени: тест «покрывает» файл, если импортирует его напрямую (`@/...` или относительный путь). Отдельно считалась транзитивная достижимость: BFS по графу импортов от файлов, импортируемых тестами (это учитывает реэкспорт через `index.ts`/баррели).
4. Итог достижимости: из 251 файла модулей/сервисов (250 в подкаталогах + `src/services/service-error.ts`) 236 достижимы из тестов (напрямую или через цепочку импортов), 15 — нет. Прямой импорт из теста есть у 165 файлов, нет — у 86 (разница — реэкспорт через баррели).
5. Критичные области и заглушки: по каждому целевому файлу собран список тестов, которые его импортируют, и помечено наличие `vi.mock(` и `describe/it.skipIf` в этих тестах.
6. Конфигурация и CI прочитаны: `vitest.config.ts`, `vitest.integration.config.ts`, `package.json` (скрипты), `.github/workflows/ci.yml`, `.github/workflows/integration.yml`.

Команды для повторного прогона (из корня репозитория):

```
git rev-parse HEAD
node <скрипт подсчёта по src/modules и src/services>      # таблица
node <скрипт графа импортов>                              # парные/непарные
wc -l <файл>                                              # LOC конкретного файла
grep -rIl "<имя>" src tests | grep -E 'test|spec'         # есть ли упоминание в тестах
```

Проверка «нет тестов» дополнительно подтверждалась текстовым поиском по `src/`, `tests/`, `e2e/` (grep), а не только графом — см. находки.

## Находки

Критично / важно / мелочь. Столбец «Статус»: ПРОЙДЕНО — утверждение проверено на прочитанном коде/файлах; ГИПОТЕЗА — вывод из косвенных признаков.

| # | severity | path:line | Проблема | Сценарий / почему важно | Статус | Что сделать |
|---|----------|-----------|----------|--------------------------|--------|-------------|
| 1 | критично | `src/modules/readiness/application/defects/commands.ts:1` | 232 строки команд дефектов (create/triage/resolve/reject) не импортирует ни один тест (ни `.test`, ни `.spec`) | Дефекты — часть допуска: создание/закрытие дефекта пишет аудит-цепочку (`:4` `recordChainedReadinessAudit`), меняет статус и уведомляет (`:1` `enqueueCriticalDefects`). Ошибку в переходе состояний поймает только прод | ПРОЙДЕНО (grep не нашёл тестовых ссылок; импортёры — только route-файлы) | Добавить unit-тесты на `transitionDefect`-путь или DB-интеграционный спец на команды дефектов |
| 2 | критично | `src/app/api/readiness/defects/route.ts:3` | У роутов дефектов (`route.ts` + `[id]/triage|resolve|reject`) нет route-тестов | `find src/app/api/readiness/defects -name '*.test.*'` → 0. Валидация тела, 400/403 нигде не проверяются | ПРОЙДЕНО | Добавить route-тесты по образцу `src/app/api/readiness/shifts/__tests__/route.test.ts` |
| 3 | критично | `tests/integration/disposable-report-race.spec.ts:7` | Сквозная запись отчёта (единственный реальный тест гонки) гейтнут на `CODEX_STAND_URL && INTEGRATION_DATABASE_URL_OWNER`; без env набор молча пропускается | Запись отчёта — ключевая сумма компании; реального DB-теста, который всегда идёт, нет. Юнит `report-command-service.test.ts` работает на моках | ПРОЙДЕНО | Запускать этот спец в CI с явным объявлением пропуска падением (как для RLS, `ci.yml:202`) |
| 4 | критично | `vitest.config.ts:69-74` | Порог покрытия: `lines:24, statements:23, functions:19, branches:19` — «floor». Это ~¼ кода | Любой код без тестов проходит гейт: правка ядра (права, отчёт, допуск) может уронить поведение и остаться зелёной | ПРОЙДЕНО | Повышать порог по мере роста; добавить точечные пороги на критичные пути |
| 5 | критично | `src/modules/reports/domain/report.aggregate.ts:1` | 386 строк доменной логики отчёта (сваи/бурение/простои, валидация, события) — нет прямого теста | Единственное упоминание в тестах — `src/test/module-boundaries.test.ts` (строковая проверка границ), не проверка поведения. Файл достижим лишь через баррель `domain/index.ts` | ПРОЙДЕНО | Написать unit-тесты агрегата (чистая логика, без БД) |
| 6 | важно | `src/modules/reports/application/queries/report-export.service.ts:1` | 376 строк выгрузок CSV/Excel (включая защиту от формул, `:18-25`) — нет прямого теста | Ошибка в экранировании/защите от инъекции формул в Excel не поймается; путь реэкспортируется через `report-query.service` | ПРОЙДЕНО | Тесты на экранирование CSV-ячеек и фильтры выгрузки |
| 7 | важно | `src/modules/reports/application/queries/pile-journal-types.ts:1` | Семейство `pile-journal-*` (~801 строка: types 248, list 200, export 198, totals 155) — ноль упоминаний в тестах | `grep -rIl "pile-journal" src tests` → нет тестовых файлов. Сводки/итоги журнала свай не проверяются арифметически | ПРОЙДЕНО | Тесты на расчёты итогов и формат журнала |
| 8 | важно | `src/modules/operator-mobile/application/commands/admission.ts:1` | 354 строки допуска машиниста (СИЗ, инструктажи, знания, документы) покрыты только моком | `__tests__/admission.test.ts:15` мокает `withReadinessTenantTransaction` целиком — реальные запросы и правила дня/версии не проверяются | ПРОЙДЕНО | DB-интеграционный тест допуска (или расширить существующие мок-тесты на ветки) |
| 9 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:1` | 207 строк недостижимы из тестов; файл исключён из покрытия | `vitest.config.ts:63` исключает его из coverage; достижим только через `src/modules/telemetry/index.ts:22` | ПРОЙДЕНО | Тест на разбор входящего сообщения (спящий код, но при включении железа — без страховки) |
| 10 | важно | `src/modules/readiness/application/backfill/backfill-service.ts:1` | 95 строк недостижимы; единственный импортёр — `scripts/backfill-tech-readiness.ts` | `grep -rIn "backfill-service" src tests` → пусто. Ошибку бэкфилла готовности поймать нечем | ПРОЙДЕНО | Покрыть хотя бы unit-тестом на идемпотентность бэкфилла |
| 11 | важно | `src/workers/__tests__/unified-worker.test.ts:88-129` | Все тесты фоновых воркеров построены на `vi.mock` (outbox, domain-events, projection-worker, event-handlers, db, redis) | Уникальная логика планировщика/ретраев проверяется против моков, а не против БД/Redis | ПРОЙДЕНО | Хотя бы один прогон воркера на живой БД/Redis (сейчас только `disposable-m6-m8.spec.ts`, гейтнут) |
| 12 | важно | `src/workers/__tests__/projection-worker.test.ts:26` | Тест мокает `@/lib/db` и `@/core/outbox/dead-letter-queue` | Реальное поведение проекций (в т.ч. при ошибке БД) не воспроизводится | ПРОЙДЕНО | DB-тест проекций (есть частично в `outbox-projection.spec.ts`, но без БД) |
| 13 | важно | `src/modules/operator-mobile/domain/view-contracts.ts:1` | 293 строки контрактов представления — нет прямого теста | Контракты связывают UI и данные мобильного места; рассинхрон не ловится | ПРОЙДЕНО | Тесты сериализации/парсинга контрактов |
| 14 | важно | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:1` | 264 строки репозитория наряда — прямого теста нет (достижим через команды) | Команды наряда покрыты (`tech-readiness-work-permits.spec.ts:40`), но сам репозиторий — через них; отдельного теста запросов нет | ПРОЙДЕНО | Точечный тест запросов репозитория |
| 15 | важно | `src/modules/readiness/domain/readiness-score.ts:1` | 239 строк расчёта готовности — прямого теста нет; рядом `src/modules/readiness/application/readiness-score.ts:1` (222) — тоже | Два одноимённых файла расчёта готовности; один из них может «разойтись» с другим незаметно | ГИПОТЕЗА (дубликат имён не проверял на идентичность) | Тесты на оба расчёта + проверить, не дублируют ли логику |
| 16 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:1` | 165 строк команд происшествий — прямого теста нет | Происшествия — регулируемая область; путь меняет статусы и уведомляет | ПРОЙДЕНО | Unit/DB-тесты на жизненный цикл происшествия |
| 17 | важно | `src/modules/operator-mobile/application/assistant-query.ts:1` | 160 строк запроса ассистента — прямого теста нет | Отдаёт данные в UI, ошибки выборки не покрыты | ПРОЙДЕНО | Тест выборки/ограничений |
| 18 | важно | `src/modules/safety/application/equipment-permits.ts:1` | 183 строки допуска техники — прямого теста нет; рядом `briefing-commands.ts` (147), `self-clearance-query.ts` (112) | Допуск/само-допуск ОТ — регулируемая область; покрыты только общие `clearance-overview.test.ts`/`instructions.test.ts` (моки) | ПРОЙДЕНО | Тесты на выдачу/отзыв допуска техники |
| 19 | важно | `src/modules/readiness/infrastructure/shifts/shift-repository.ts:1` | 161 строка репозитория смен — прямого теста нет; рядом `defects/defect-repository.ts:1` (154), `handover-repository.ts:1` (83) | Репозитории смен/передач/дефектов — только за счёт гейтнутых интеграционных спеков | ПРОЙДЕНО | Точечные тесты репозиториев |
| 20 | важно | `src/services/users/user-document-access.ts:1` | 87 строк — ноль тестов (нет импорта ни из одного теста) | Доступ к документам пользователя — рядом с допуском; в списке недостижимых файлов | ПРОЙДЕНО | Тест правил доступа к документам |
| 21 | важно | `vitest.config.ts:8-11` | Интеграционные спеки гейтятся `describe.skipIf` и без БД молча пропускаются | Комментарий в конфиге прямо это фиксирует; `npm run test:unit` включает `tests/integration/**` (`:35-38`), т.е. локально «зелёно» при нуле проверок | ПРОЙДЕНО | Показывать число пропусков как отдельную метрику; локально подставлять env |
| 22 | важно | `src/services/reports/event-handlers.ts:1` | 684 строки обработчиков событий отчёта — единственный реальный прогон в `disposable-m6-m8.spec.ts` (гейтнут) | Основной объём — юнит `daily-summary.test.ts` на моках | ПРОЙДЕНО | DB-тест обработчиков без гейта (или в CI-гейте) |
| 23 | важно | `src/modules/readiness/application/capabilities.ts:1` | Проверки прав (canManageDefects/canReportDefects) — только юнит + контракт | Матрица доступов организации (`access-matrix-service.ts`) — только мок-тест `access-matrix-service.test.ts` | ПРОЙДЕНО | Интеграционный тест матрицы доступов |
| 24 | важно | `src/services/auth/auth-service.ts:1` | Логин/креды — тесты на моках (`auth-service-credentials.test.ts`, `auth-service-login-rate-limit.test.ts`) | Реальные запросы/блокировки не покрыты; сквозной логин есть только в гейтнутом `disposable-report-race.spec.ts:19-22` | ПРОЙДЕНО | Интеграционный тест входа (по возможности не гейтнутый) |
| 25 | мелочь | `tests/integration/authorization-boundaries.spec.ts:39` | Тест матрицы прав лежит в `tests/integration`, но БД не использует (чистый юнит) | Запускается всегда (нет `skipIf`) — это плюс, но имя каталога вводит в заблуждение | ПРОЙДЕНО | Перенести в `src/services/auth/__tests__` либо отметить как unit |
| 26 | мелочь | `tests/integration/tenant-isolation.spec.ts:9-10` | Файл «tenant isolation» мокает Prisma-транзакцию, реальной БД нет | Ожидание «здесь проверяется RLS» неверно; настоящая проверка — в `rls-tenant-enforcement.spec.ts` | ПРОЙДЕНО | Уточнить имя/комментарий |
| 27 | мелочь | `tests/integration/outbox-projection.spec.ts:4-6` | «Outbox → projection» без Postgres, только in-process шина | Покрыт контракт шины, а не запись в outbox/БД | ПРОЙДЕНО | Дополнить DB-частью |
| 28 | мелочь | `src/modules/telemetry/index.ts:22` | Фасады `Telemetry`/`Monitoring`/`System` (`monitoring/index.ts:1`, `system/index.ts:1`) недостижимы из тестов | Низкий риск — тонкие реэкспорты | ПРОЙДЕНО | Не требуется (фасады) |
| 29 | мелочь | `vitest.config.ts:17` | Переносятся только `DATABASE_URL_POSTGRES`, `DATABASE_URL_APP_ROLE` | Остальные DB-спеки (`INTEGRATION_DATABASE_URL_*`, `CODEX_STAND_URL`) требуют env, который конфиг не подставляет → пропуск | ПРОЙДЕНО | Расширить список ключей либо задокументировать |
| 30 | мелочь | `tests/integration/helpers/disposable-db.ts:19-23` | Фикстура требует ровно localhost + базу `/codex_test` и роли `piling`/`pilingtrack_app` | На машине без такой базы все `disposable-*` пропускаются целиком | ПРОЙДЕНО | Документировать требование/подъём базы скриптом |

### Критичные области: чем реально покрыты

| Область | Файл(ы) | Чем покрыто | Вердикт |
|---------|---------|-------------|---------|
| Права/способности (роли) | `src/services/auth/authorization-service.ts` | `tests/integration/authorization-boundaries.spec.ts` (реальные утверждения, без БД) + `src/services/auth/__tests__/authorization-service.test.ts` | ПРОЙДЕНО (без БД) |
| Матрица доступов организации | `src/modules/readiness/application/access-matrix-service.ts` | `application/__tests__/access-matrix-service.test.ts` (`vi.mock`) | только заглушка |
| Допуск машиниста | `src/modules/operator-mobile/application/commands/admission.ts` | `commands/__tests__/admission.test.ts` (`vi.mock` `@/modules/readiness/server`) | только заглушка |
| Наряды-допуски | `src/modules/readiness/application/permits/commands.ts` | `tests/integration/tech-readiness-work-permits.spec.ts:40` (`describe.runIf(...)`, живой Postgres) | ПРОЙДЕНО (реальная БД) |
| Дефекты допуска | `src/modules/readiness/application/defects/commands.ts` | ничего (только HTTP-IDOR в гейтнутом `disposable-idor.spec.ts`) | НЕ ПРОВЕРЕНО тестами |
| Запись отчёта | `src/modules/reports/application/commands/report-command.service.ts`, `infrastructure/report.repository.ts` | мок-юнит (`report-command-service.test.ts`, `report.repository.test.ts:10` — фейковая транзакция) | заглушка |
| Запись отчёта (сквозная) | путь `/api/reports/upsert` | `tests/integration/disposable-report-race.spec.ts:7` (живой стенд+БД, гейт) | ПРОЙДЕНО только при env |
| RLS (политики) | `src/core/security/tenant-rls.ts` | `tests/integration/rls-tenant-enforcement.spec.ts:44` (реальная БД, роль `pilingtrack_app`) | ПРОЙДЕНО (реальная БД) |
| RLS-проводка (GUC) | `src/core/security/tenant-context.ts` | `core/security/__tests__/tenant-context.test.ts` + `tenant-isolation.spec.ts` (мок) | ПРОЙДЕНО (без БД) + заглушка |
| Фоновые задачи (воркеры) | `src/workers/**`, `unified-worker.ts` | `src/workers/__tests__/*` (`vi.mock`), проекции — `disposable-m6-m8.spec.ts` (гейт) | только заглушки (кроме гейтнутого) |
| Outbox → события | `src/services/reports/domain-events.ts` | `tests/integration/outbox-projection.spec.ts` (in-process, без БД) | ПРОЙДЕНО (без БД) |

## Приложение: 15 крупнейших исходников модулей/сервисов без прямого теста

«Прямой тест» = тест импортирует файл напрямую. Строки — из `wc -l`.

| LOC | Файл |
|-----|------|
| 386 | `src/modules/reports/domain/report.aggregate.ts` |
| 376 | `src/modules/reports/application/queries/report-export.service.ts` |
| 293 | `src/modules/operator-mobile/domain/view-contracts.ts` |
| 264 | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts` |
| 248 | `src/modules/reports/application/queries/pile-journal-types.ts` |
| 239 | `src/modules/readiness/domain/readiness-score.ts` |
| 232 | `src/modules/readiness/application/defects/commands.ts` |
| 222 | `src/modules/readiness/application/readiness-score.ts` |
| 207 | `src/services/telemetry/mqtt-ingestion-service.ts` |
| 200 | `src/modules/reports/application/queries/pile-journal-list.ts` |
| 198 | `src/modules/reports/application/queries/pile-journal-export.ts` |
| 183 | `src/modules/safety/application/equipment-permits.ts` |
| 165 | `src/modules/operator-mobile/application/commands/incidents.ts` |
| 161 | `src/modules/readiness/infrastructure/shifts/shift-repository.ts` |
| 160 | `src/modules/operator-mobile/application/assistant-query.ts` |

Сводка достижимости: 165 из 251 файлов модулей/сервисов импортируются тестом напрямую; 236 достижимы по графу импортов; 15 — недостижимы совсем (`defects/commands.ts`, `defect-repository.ts`, `defects/queries.ts`, `defects/schemas.ts`, `mqtt-ingestion-service.ts`, `backfill-service.ts`, `services/reports/index.ts`, `system-service.ts` и фасады `index.ts` telemetry/monitoring/system/crews/equipment).

## Что не проверено

- Тесты не запускались (по заданию): фактическое число passed/skipped и реальное покрытие строк/ветвей НЕ измерены — порог 24 % взят из конфига, а не из прогона с отчётом.
- Достижимость считалась по литеральным импортам; динамические импорты со сконструированной строкой и обращения по строковым путям не учитывались — 15 «недостижимых» могут частично исполняться.
- Не проверял, что интеграционные спеки действительно проходят на этой машине (нет поднятой одноразовой БД, env не читал).
- Дублирование `readiness-score.ts` (domain vs application) — ГИПОТЕЗА, содержимое обоих не сравнивал.
- Файлы вне `src/modules` и `src/services` (`src/app/**`, `src/core/**`, `src/lib/**`, `src/components/**`, `src/workers/**`) в таблицу по каталогам не входили — по ним даны только точечные находки.
- `e2e/**` (26 Playwright-спек) детально не разбирал; в пороги `test:coverage` они не входят.
- Существующие отчёты в `docs/audits/` не читал (условие независимости) — возможны пересечения с ранее найденным.
