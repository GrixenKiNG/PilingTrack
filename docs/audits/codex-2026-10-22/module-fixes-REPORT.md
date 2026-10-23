# Исправления связей модулей PilingTrack — 22 октября 2026

Рабочее дерево: `D:/PillingR/wt-module-fixes-1022`. Ветка: `codex/module-fixes-1022`. База: `0fc414d1a362e7093b11100539c8e2f0fded8314`. Пять локальных коммитов; push, merge, deploy не выполнялись. Рабочее дерево после коммитов чистое. Исходное дерево и его посторонние изменения сохранены.

## Что исправлено

| Коммит | Результат |
|---|---|
| b68a0110 | Веб-сохранение отчёта сохраняет встречные мобильные поправки, их идентификаторы и историю. Поправки входят в итоги, но не передаются как новые отрицательные строки. Исходную запись с поправками нельзя изменить или удалить. Проверка суммы простоя учитывает сохранённые поправки. |
| 1660c559 | Поправка простоя проверяет конечность числа, диапазон 0–24 часа, шаг четверть часа и общий простой в пределах смены с учётом предыдущих поправок. Ноль разрешён для отмены простоя. |
| db2d303f | Завершение осмотра, закрывающего открытое ТО, продвигает существующий регламент в той же транзакции. Повтор команды и уже закрытое/отменённое ТО не переносят срок повторно. Формула регламента не изменена. |
| cbefbc1b | Ознакомление, проводимое инструктором, учитывается в статусе сотрудника и сводке после подписи сотрудника. Старые самостоятельные ознакомления без инструктора остаются действующими. Это исправление статуса, не новый механизм авторизации. |
| 551e9f4c | Заголовок журнала свай получает описательные значения из всей отфильтрованной выборки через SQL-агрегат, включая записи за пределами страницы. Неограниченная загрузка строк не добавлена. |

## Проверки

| Команда / проверка | Exit | Результат |
|---|---:|---|
| Удаление `.next/dev/types` | не запускалось | Автоматическая политика отклонила команду удаления; отдельная проверка `Test-Path` показала False, устаревшего каталога нет. |
| `npx tsc --noEmit` | 0 | Финальный журнал `tsc-final.log`. |
| `npm run lint` | 0 | Финальный журнал `lint-final.log`, без предупреждений. |
| `npm run test:unit` | 0 | 5365 passed, 265 skipped, 5630 всего; 488 файлов passed, 15 skipped. `unit.log`. |
| `npx playwright test --list` | 0 | 315 тестов в 28 файлах, сбор не потерян. |
| `npm run build` | 0 | Production-сборка на собственном одноразовом стенде, 95 страниц. `build.log`. |
| `npm run check:layers` | 0 | 4 прежних исключения, 0 новых. |
| `npm run db:check-migrations` | 0 | Migration guard пройден. Схема и миграции не менялись. |
| Целевые unit-проверки | 0 | 124 passed суммарно по трём запускам. |
| Vitest `run tests/integration --maxWorkers=1 --testTimeout=15000 --hookTimeout=30000` | 0 | 378 passed, 0 skipped, 22 файла. Свежая одноразовая Postgres, реальные Redis/S3 и локальное HTTP-приложение. `../codex-t5/integration-final.log`, `integration-results.json`. |
| Playwright: 12 корневых spec, 3 проекта, `--workers=1` | 0 | 111 passed, 9 skipped, 0 failed, 0 flaky; 120 выбранных случаев. `e2e-results.json`. |
| GitNexus index / detect_changes | 0 | Перед изменениями выполнен impact; перед каждым коммитом detect_changes без partial/truncated. Итоговое сравнение с базой: 60 символов, 24 файла, 4 затронутых потока, risk medium. `detect-changes-compare.json`. |
| `git diff 0fc414d1 --check` | 0 | Ошибок пробелов нет. |

265 пропусков в общем unit-запуске: прежние 262 плюс три добавленных регрессионных сценария с БД. Они пропускаются без параметров одноразового стенда, а затем запускаются в отдельном интеграционном прогоне. В прежних 262: 260 сценариев, требующих стенд, и два явных S3-пропуска. Пропуск не считается успешным выполнением.

9 пропусков E2E: редактор мониторинга исключает Mobile Safari (1); тест rate limit запускается только в Chromium, чтобы избежать коллизий IP (2); три изменяющих данные сценария critical path выполняются один раз и исключают два мобильных проекта (6). Оставшиеся 195 случаев из общего сбора 315 относятся к другим наборам QA/QA-AC с отдельными предпосылками; в данный E2E-прогон они не включены. Полного покрытия всех 315 не заявляю.

## Неудачные запуски и ограничения

- Первый полный unit-прогон: exit 1, 5364 passed, 1 failed, 262 skipped. В существующий mock добавлена новая зависимость validateDowntimeWithinShift; финальный полный прогон выше успешен.
- Первый build обнаружил неполную DTO-фикстуру нового теста; исправлено. Следующий остановился на сообщении Next SecurityFatalError о безопасности установленного Next 16.4.0. Повторный обычный запуск завершился exit 0. Зависимости не обновлялись; предупреждение требует отдельной проверки обновления. Сборка также предупреждает о необязательном `@valkey/valkey-glide`.
- Первый интеграционный прогон: exit 1, 377 passed и 1 failed из-за недостающего OPEN_MAINTENANCE в частичном mock; дополнительно упал afterAll IDOR при очистке цепочки аудита. Второй запуск на той же БД не является чистой проверкой: 371 passed, 1 failed, 6 skipped; сценарий orphan cleanup отказался работать с уже существующим tenant, а M7 превысил стандартные 5 секунд. Итоговый запуск выполнен заново на свежей БД, без конкурирующего общего worker; лимиты теста/хука 15/30 секунд заданы в игнорируемом runner. Все 378 пройдены, включая очистку. Исходные журналы сохранены как `integration-first*`, `integration-recheck*`.
- Первоначальный `npm run db:generate` без окружения завершился ошибкой отсутствующего DATABASE_URL_POSTGRES. На собственном стенде генерация и сборка прошли с его реальными параметрами в памяти; `.env` не читались и не создавались.
- GitNexus сообщил HIGH для существующего advanceMaintenanceRegulation: предупреждение было передано до правок. Его формула не менялась, добавлен вызов из завершения осмотра. Для upsertReport граф дал UNKNOWN, поэтому вызовы дополнительно проверены по исходникам; нулевое число не трактовалось как отсутствие влияния. При построении индекса есть ограничения покрытия execution flows; отсутствие partial/truncated в detect_changes не означает полного покрытия всех динамических вызовов.
- Локальный стенд и принадлежащий E2E worker остановлены. В журнале `stand-fresh.log`: CLEANUP done; exit стенда 0. Собственных одноразовых контейнеров и процессов больше нет. Чужие контейнеры не останавливались.

## Что оставлено без изменений

Миграция services→modules, новая архитектура, схема БД, auth/security/tenancy, зависимости, production и ORION не затрагивались. В operator-mobile исправлена только подтверждённая в аудите команда поправки простоя; варианты операторских экранов не изменены. Новый интерфейс исправления уже закрытого отчёта не создавался: история поправок в существующей веб-форме остаётся неизменяемой. Физические устройства, production и полное покрытие всех модулей не проверены.

## Изменённые файлы

Всего 24 файла: +276 / −40 строк. Файлы и экспорты не удалялись, новых отслеживаемых test-файлов нет. Точный список строк приведён в `changed-files.tsv`; ниже значения + / −.

| Файл | + | − |
|---|---:|---:|
| src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx | 14 | 0 |
| src/components/piling/admin-reports/report-form-dialog.tsx | 16 | 12 |
| src/lib/types.ts | 3 | 0 |
| src/modules/equipment/index.ts | 1 | 0 |
| src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts | 11 | 1 |
| src/modules/inspections/application/commands/inspection-commands.ts | 11 | 2 |
| src/modules/operator-mobile/application/commands/__tests__/production-corrections.test.ts | 25 | 0 |
| src/modules/operator-mobile/application/commands/production-corrections.ts | 19 | 6 |
| src/modules/reports/application/commands/__tests__/report-command-service.test.ts | 19 | 0 |
| src/modules/reports/application/commands/__tests__/report-command.post-audit.test.ts | 1 | 0 |
| src/modules/reports/application/commands/report-command.service.ts | 9 | 5 |
| src/modules/reports/application/queries/__tests__/pile-journal-totals.test.ts | 8 | 0 |
| src/modules/reports/application/queries/pile-journal-totals.ts | 19 | 8 |
| src/modules/reports/application/queries/pile-journal-types.ts | 3 | 0 |
| src/modules/reports/domain/report.aggregate.ts | 3 | 0 |
| src/modules/reports/infrastructure/__tests__/reconcile-report-entries.test.ts | 10 | 0 |
| src/modules/reports/infrastructure/reconcile-report-entries.ts | 10 | 2 |
| src/modules/safety/__tests__/clearance-overview.test.ts | 5 | 0 |
| src/modules/safety/application/__tests__/self-clearance-query.test.ts | 2 | 0 |
| src/modules/safety/application/clearance-overview-query.ts | 4 | 1 |
| src/modules/safety/application/self-clearance-query.ts | 4 | 1 |
| tests/integration/disposable-m6-m8.spec.ts | 22 | 0 |
| tests/integration/disposable-report-race.spec.ts | 22 | 0 |
| tests/integration/tech-readiness-write-pipeline.spec.ts | 35 | 2 |

Автоматическое продолжение этого чата настроено на 01:20 по Москве. Условие: продолжать только незавершённую остановившуюся работу; после завершения ничего не делать.
