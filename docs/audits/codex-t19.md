# Поток 19 — наряды-допуски

14.10.2026. Дерево `D:/PillingR/wt-codex19`, ветка `codex/permits-1013`, стартовый main `4692dfd9`. Реализованы пункты 1–8 и дополнительно одобренное владельцем редактирование отказанного черновика. Полный Vitest, TypeScript, линтер и проверка миграции прошли. **Сборка Next.js не проверена: штатный build останавливается на отсутствующем окружении. P1 запуска смены без СИЗ оставлен для решения владельца.**

## По пунктам задания

| № | Результат | Коммит |
|---|---|---|
| 1 | Исправлено: выбор по id наряда в реестре/карточке/очереди; открытие команды выбирает тот же документ. До выбора — пустое состояние. Журнал больше не подставляет первый наряд установки. | `7f4cc8e5` |
| 2 | Исправлено: перед согласованием видны название, описание, объект, место, опасности, ответственные, срок в timezone наряда, вид работ, требуемые и текущие подписи. Для отправки/отзыва — название, объект и срок. Требования и название вида работ добавлены в ответ сервера. | `338611d0` |
| 3 | Исправлено: POST reject, обязательная причина 3–1000 символов, политика согласования и отдельный 403 автору. Только PENDING_APPROVAL → DRAFT, version+1; текущие действующие подписи аннулируются. В той же транзакции — доказательный аудит и outbox пересчёта. Причина/кто/когда видны в реестре, окне и журнале. Добавлены ровно три разрешённых nullable-поля. | `c8039236` |
| 4 | Исправлено: объект документа в desktop/mobile/очереди/окне берётся из objectName. Бригада — запасной источник только при пустом снимке старого наряда. | `57348b38` |
| 5 | Исправлено: фильтр закрытых REVOKED/EXPIRED, счётчик и переход из «Заблокированы». Переход очищает поиск, чтобы счётчик плитки совпадал со списком. | `17733fa3` |
| 6 | Исправлен текст. **Нужно решение владельца по P1:** v10 через карточку объекта позволяет принять установку без СИЗ, acceptEquipment создаёт STARTED без проверки СИЗ. Правило не меняли. | `f2c0bfbf` |
| 7 | Исправлено: «Повторить» повторно загружает справочники после ошибки, новое открытие формы делает новый запрос. Исходная причина сбоя не установлена. | `2bbf4f55` |
| 8 | Исправлено: настоящий Radix-диалог после Escape возвращает фокус на «Добавить бригаду». | `1d56f10a` |

Дополнительное решение владельца в этом чате: **«Да, добавить редактирование отказанного наряда»**. Коммит `6fff097a`: кнопка «Исправить наряд» у отказанного DRAFT, существующая форма с исходным содержанием и причиной отказа, PATCH того же id и последующий submit с версией ответа PATCH. Привязка shiftId не стирается. Даты подставляются в timezone самого наряда, даже если timezone организации другой. Для старого длинного описания при редактировании действует серверный предел 4000; создание сохраняет прежний предел 300. В этом же коммите журнал читает requiredApprovals вместо предположения по риску; старый тест независимости снимка использует действительно действующий наряд вместо уже истёкшей фикстуры.

## Проверки и воспроизведение

Каждый основной пункт сначала воспроизведён красным тестом, затем проверен после правки. Новые тестовые файлы созданы только для прямо требуемых заданием команды/маршрута отказа и реального возврата фокуса; остальные тесты добавлены в существующие файлы.

| Команда / проверка | Код | Результат |
|---|---:|---|
| Удаление `.next/dev/types` | — | Каталог `.next` в этом дереве отсутствовал; удалять было нечего. |
| `npx tsc --noEmit` | 0 | После добавочной формы повторено на Node 24: `node node_modules/typescript/bin/tsc --noEmit`, также 0. |
| `npm run lint` | 0 | Полный ESLint без ошибок/предупреждений, text integrity passed. Повторено после всех изменений на Node 24 через npm-cli. |
| Целевые Vitest: permits UI/domain/command/route | 0 | 46 passed / 4 файла до последнего теста требований ролей; финальный файл экрана 9 passed. Все они включены в финальный полный прогон. |
| Vitest v10 + operator-mobile-rules | 0 | 92 passed / 3 файла, `--maxWorkers=2 --testTimeout=30000`. Включает два диагностических теста P1. |
| Vitest admin-crews | 0 | 31 passed / 4 файла, настоящий Radix в новом тесте фокуса. |
| Vitest to-module-shell | 0 | 51 passed после исправления датированной фикстуры. |
| `npm run test:unit -- --maxWorkers=2 --testTimeout=30000` (Node 26) | 1 | Первая полная попытка дала OOM, процесс прерван CtrlC. Успехом не считается. Найденное старое ожидание журнала/истёкшая фикстура исправлены. |
| `node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=30000` (Node 24) | **0** | **396 файлов прошли, 13 пропущены (409). 4333 теста прошли, 2 expected fail, 257 пропущены (4592). 812.34 s.** Пропуски и ожидаемые падения не объявляются выполненной проверкой. |
| `npx playwright test --list` | 0 | **291 тест / 27 файлов**; столько же на базе потока 20. e2e-файлы не менялись. Это сбор тестов, не браузерный запуск. |
| `npm run build` | **1** | Сначала Node 26/tsx: worker init EINVAL. Повтор с `ESBUILD_WORKER_THREADS=0` дошёл до validate-env: нет **DATABASE_PROVIDER, SESSION_SECRET**. Значения не подставлялись, Next build не запускался. Одного tsc недостаточно для подтверждения Next route types. |
| `npm run db:generate` | 1 | Стандартный prisma.config требует отсутствующий DATABASE_URL_POSTGRES. |
| `npx prisma generate --config .gitnexus/qa-prisma.config.ts`, затем `node scripts/patch-postgres-client.js` | 0 / 0 | Временный config содержит только schema, без datasource и dotenv. Генерация клиента без подключения к БД. |
| `node scripts/check-migrations.js` | 0 | Нет неразрешённых разрушительных или зависимых от данных операций. |
| `npx prisma migrate diff --config .gitnexus/qa-prisma-shadow.config.ts --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` | **0** | **No difference detected.** На собственной disposable БД, не pilingtrack_test и не продакшене. |
| `git diff --check` | 0 | Нет ошибок пробелов. |

Использованный Node 24.19.0: `C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`; для повторения проверок эта папка ставится первой в PATH. npm-cli: `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`. Ни runtime, ни зависимости проекта не обновлялись. Обычный npx.cmd из Program Files выбирает системный Node 26.7.0, поэтому финальный Vitest запускался напрямую. Логи полной неудачной и успешной попыток сохранены в `.gitnexus/t19-full-unit.log` и `.gitnexus/t19-full-unit-node24.log` рабочего дерева. В успешном полном прогоне остаются предупреждения Vite configLoader и MaxListenersExceededWarning — нулём предупреждений линтера они не являются.

Проверка миграции: использован уже имеющийся образ postgres:18-alpine, собственный контейнер `pilingtrack-t19-shadow`, localhost:54339, без томов рабочей БД. Временный Prisma config указывает только на его отдельную shadowDatabaseUrl; diff воспроизвёл всю историю миграций. `docker stop pilingtrack-t19-shadow` завершился 0, контейнер удалён (`--rm`). Схема и миграции рабочей pilingtrack_test не менялись; migrate dev/reset/db push не выполнялись. Для повторения diff требуется новый собственный disposable PostgreSQL и соответствующий временный config; остаточный config указывает на уже удалённую БД, не на рабочую.

## Изменённые файлы

От стартовой базы: **21 файл, +581/−79** строк, плюс этот отчёт. Удалённых файлов/экспортов нет. Полный список `git diff 4692dfd9 --numstat`:

| Файл в D:/PillingR/wt-codex19 | + | − |
|---|---:|---:|
| [prisma/migrations/20261013200000_add_work_permit_rejection/migration.sql](D:/PillingR/wt-codex19/prisma/migrations/20261013200000_add_work_permit_rejection/migration.sql) | 4 | 0 |
| [prisma/schema.prisma](D:/PillingR/wt-codex19/prisma/schema.prisma) | 3 | 0 |
| [src/app/api/readiness/work-permits/\[id\]/reject/route.test.ts](D:/PillingR/wt-codex19/src/app/api/readiness/work-permits/[id]/reject/route.test.ts) | 38 | 0 |
| [src/app/api/readiness/work-permits/\[id\]/reject/route.ts](D:/PillingR/wt-codex19/src/app/api/readiness/work-permits/[id]/reject/route.ts) | 23 | 0 |
| [src/components/piling/admin-crews/__tests__/crew-focus.test.tsx](D:/PillingR/wt-codex19/src/components/piling/admin-crews/__tests__/crew-focus.test.tsx) | 23 | 0 |
| [src/components/piling/admin-crews/admin-crews.tsx](D:/PillingR/wt-codex19/src/components/piling/admin-crews/admin-crews.tsx) | 4 | 2 |
| [src/components/piling/admin-crews/crew-form-dialog.tsx](D:/PillingR/wt-codex19/src/components/piling/admin-crews/crew-form-dialog.tsx) | 5 | 1 |
| [src/components/piling/operator-mobile/v10/__tests__/operator-v10-port.test.tsx](D:/PillingR/wt-codex19/src/components/piling/operator-mobile/v10/__tests__/operator-v10-port.test.tsx) | 25 | 0 |
| [src/components/piling/operator-mobile/v10/operator-v10-app.tsx](D:/PillingR/wt-codex19/src/components/piling/operator-mobile/v10/operator-v10-app.tsx) | 2 | 2 |
| [src/components/piling/to/__tests__/to-module-shell.test.tsx](D:/PillingR/wt-codex19/src/components/piling/to/__tests__/to-module-shell.test.tsx) | 1 | 1 |
| [src/components/piling/to/readiness/api/contracts.ts](D:/PillingR/wt-codex19/src/components/piling/to/readiness/api/contracts.ts) | 5 | 0 |
| [src/components/piling/to/readiness/forms/permit-form.tsx](D:/PillingR/wt-codex19/src/components/piling/to/readiness/forms/permit-form.tsx) | 49 | 31 |
| [src/components/piling/to/readiness/screens/__tests__/permits-screen.test.tsx](D:/PillingR/wt-codex19/src/components/piling/to/readiness/screens/__tests__/permits-screen.test.tsx) | 155 | 1 |
| [src/components/piling/to/readiness/screens/permits-screen.tsx](D:/PillingR/wt-codex19/src/components/piling/to/readiness/screens/permits-screen.tsx) | 67 | 36 |
| [src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts](D:/PillingR/wt-codex19/src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts) | 8 | 0 |
| [src/modules/readiness/application/permits/commands.test.ts](D:/PillingR/wt-codex19/src/modules/readiness/application/permits/commands.test.ts) | 117 | 0 |
| [src/modules/readiness/application/permits/commands.ts](D:/PillingR/wt-codex19/src/modules/readiness/application/permits/commands.ts) | 21 | 4 |
| [src/modules/readiness/application/permits/schemas.ts](D:/PillingR/wt-codex19/src/modules/readiness/application/permits/schemas.ts) | 5 | 0 |
| [src/modules/readiness/domain/permits/__tests__/work-permit.test.ts](D:/PillingR/wt-codex19/src/modules/readiness/domain/permits/__tests__/work-permit.test.ts) | 7 | 0 |
| [src/modules/readiness/domain/permits/transitions.ts](D:/PillingR/wt-codex19/src/modules/readiness/domain/permits/transitions.ts) | 3 | 0 |
| [src/modules/readiness/infrastructure/permits/work-permit-repository.ts](D:/PillingR/wt-codex19/src/modules/readiness/infrastructure/permits/work-permit-repository.ts) | 16 | 1 |

## GitNexus и ограничения

Рабочее дерево индексировано как PilingTrack-t19. До правок выполнены impact: PermitsScreen LOW/4, serializePermit MEDIUM/6, WorkPermitRepository HIGH/15, versionedAction HIGH/6 (с указанием файла после неоднозначного имени), ScreenSafety LOW/3, PermitForm LOW/3, CrewFormDialog LOW/2, AdminCrews LOW/1. HIGH сообщён владельцу до соответствующих правок. transitionPermit дал UNKNOWN/0: поиск по всему репозиторию подтвердил тестовые вызовы; это не считалось доказательством неиспользования и удаления не было.

Перед каждым кодовым коммитом запускался detect-changes all. После новых маршрута и команды выполнена свежая полная переиндексация на Node 24: exit0, **30949 nodes / 64334 edges / 520 clusters / 844 flows**. Финальный detect-changes compare от 4692dfd9: exit0, **21 файл / 106 символов / 10 процессов, HIGH**. Сам граф процессов **TRUNCATED** (в частности, 2482 кандидата входных точек не вошли), 393 межъязыковые ссылки не разрешены. Повторная индексация сохраняет эти ограничения; это не полная гарантия всех путей исполнения и не all-clear по отсутствующим связям. `.gitnexus/t19-analyze-final.log` хранит предупреждения.

За время работы main продвинулся до 7bc318d9. Отдельный compare main показывает 30 файлов / 116 символов / 11 процессов, HIGH, включая чужие изменения RLS/скриптов/документации. Они не принадлежат этому потоку и не менялись; история ветки не переписывалась. Перед приёмкой требуется обычная проверка совместимости с актуальным main владельцем/ревьюером.

## Что оставлено и что требует решения

- **P1 СИЗ:** в v10 принятие установки через объект доступно до подтверждения СИЗ; реальная команда acceptEquipment записывает STARTED. Тесты вызывают настоящий код на mock-транзакции и UI, не рабочую БД. Не утверждается, что это автоматически разрешает запись выработки: у неё другой gate. Правило запуска не ужесточалось по прямому запрету задания; решение владельца необходимо.
- Причина исходного сбоя справочников неизвестна: проверен обработчик permit-form-options (последовательные запросы внутри tenant-транзакции), аудит фиксирует восстановление после reload, но не точный серверный ответ/стек. Причинная связь с отказом Redis не установлена.
- Отказ использует существующую политику согласования, включая уже принятое решение роли и разделение подписей; она не изменена. Поля последнего отказа сохраняются после редактирования/повторной отправки, исторические отказы также сохраняются в цепочке аудита. При недоступном имени в selectors UI показывает rejectedById; это не выдуманное ФИО.
- Не менялись вход/безопасность/RLS, правило двух подписей, данные рабочих смен, зависимости, деплой, ORION, readiness-centre, остальные варианты оператора и все исключённые владельцем сценарии браузерного аудита. Текст v10 и его диагностические тесты — разрешённое исключение задания 6.
- Не выполнялся браузерный прогон исправленного дерева: открытый localhost:3000 работает из другого дерева. Полный Vitest с mock-инфраструктурой не заменяет проверку нового маршрута на живой БД/CSRF.

Push, merge, deploy и подключения к продакшену не выполнялись. Кодовые изменения закоммичены; после коммита отчёта проверяется чистота дерева.
