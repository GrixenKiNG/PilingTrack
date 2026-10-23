# E2E и разбор 262 пропусков — 22 октября 2026

**E2E: exit 0, 111 passed / 9 skipped / 0 failed, 10,8 минуты.**

**Интеграционные проверки с реальной одноразовой БД: exit 1, 374 passed / 0 skipped / 1 failed.** Падение заголовка журнала воспроизведено отдельно на свежем PostgreSQL: 5 passed / 0 skipped / 1 failed. Общий результат проверок не полностью зелёный.

Проверенный commit прежний: `0fc414d1a362e7093b11100539c8e2f0fded8314`, worktree `D:\PillingR\wt-app-review-1022`, ветка `codex/app-review-1022`. Исходники/тесты/схема/зависимости не изменялись, коммитов нет. Добавлены только диагностические файлы в игнорируемый output. Основная рабочая копия не переключалась.

## Почему были пропущены 262 теста

1. **260 интеграционных тестов** закрыты условиями наличия PostgreSQL, роли приложения, а для HTTP-сценариев — тестового приложения. В предыдущем изолированном unit-прогоне эти подключения отсутствовали намеренно; адреса рабочей БД и `.env` туда не переносились. Поэтому skip не означает, что эти проверки прошли.
2. **2 теста S3** явно отключены в исходниках через `it.skip`: [s3-service.test.ts:81](D:/PillingR/wt-app-review-1022/src/core/storage/__tests__/s3-service.test.ts:81) и [строка 88](D:/PillingR/wt-app-review-1022/src/core/storage/__tests__/s3-service.test.ts:88). Они проверяют отказ при пустом tenantId в `reportPdfKey`/`exportCsvKey`. Текущие функции используют префикс `default`; комментарии помечают это как известное несоответствие. Эти два теста останутся отключёнными даже с работающим S3. Вызовы функций в рабочем коде текстовым поиском не обнаружены; действующий обход изоляции этим не доказан.

Повтор полного unit-прогона без БД: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=output/app-review-1022/unit-complete-detail.json`, **exit 0: 5353 passed / 262 skipped / 0 failed**. [Машиночитаемый результат](D:/PillingR/wt-app-review-1022/output/app-review-1022/unit-complete-detail.json).

Точная разбивка 260 интеграционных пропусков по `tests/integration`:

| Файл | Пропуски |
|---|---:|
| disposable-analytics-performance.spec.ts | 2 |
| disposable-equipment-race.spec.ts | 3 |
| disposable-feedback-rls.spec.ts | 7 |
| disposable-idor.spec.ts | 159 |
| disposable-m6-m8.spec.ts | 6 |
| disposable-report-race.spec.ts | 2 |
| disposable-restore.spec.ts | 1 |
| disposable-rls.spec.ts | 45 |
| disposable-scripts.spec.ts | 6 |
| idempotency-lock-timeout.spec.ts | 3 |
| rls-tenant-enforcement.spec.ts | 5 |
| tech-readiness-projection.spec.ts | 4 |
| tech-readiness-shifts.spec.ts | 3 |
| tech-readiness-work-permits.spec.ts | 4 |
| tech-readiness-write-pipeline.spec.ts | 5 |
| tenant-dictionary-migration.spec.ts | 1 |
| tenant-transaction-pool.spec.ts | 4 |
| **Всего** | **260** |

## Как выполнен E2E

Использован существующий `scripts/test-day-stand.sh`: отдельные PostgreSQL, два Redis, S3, синтетические tenants и пользователи, production-сборка проверенного кода, приложение и unified workers. Тестовые пароли/секреты генерируются штатным стендом в памяти; `.env` не создавался и не читался. Применены существующие миграции только к новой одноразовой БД через интеграционную конфигурацию. Схема и миграционные файлы не изменены.

Сборка этого стенда: **exit 0**. Предупреждение об отсутствующем необязательном `@valkey/valkey-glide` сохранилось. Это дополняет прошлую неудачную сборку без окружения, не отменяя её фактический exit 1. S3 до E2E проверен реальными signed PUT/GET/DELETE. HTTPS-прокси обеспечивает работу Secure cookies в мобильных браузерах. Внешний Telegram в UI-сценарии подменяется перехватом тестового запроса; фактическая отправка сообщения этим не проверена.

Запуск через супервизор: `node output/app-review-1022/run-e2e.cjs`; внутри — `e2e/fixtures/disposable-https.mjs`, существующий Playwright CLI, 12 перечисленных spec-файлов, `--workers=1 --reporter=line,json,html`. [Полный список выбранных файлов](D:/PillingR/wt-app-review-1022/output/app-review-1022/e2e-selected-specs.json).

| Профиль | Passed | Skipped | Failed |
|---|---:|---:|---:|
| chromium | 40 | 0 | 0 |
| Mobile Safari | 35 | 5 | 0 |
| Mobile Chrome | 36 | 4 | 0 |
| **Всего** | **111** | **9** | **0** |

Причины девяти E2E-пропусков отличаются от 262 unit-пропусков:

- 6: три сценария с сохраняемым состоянием выполняются один раз в Chromium и пропускаются в двух мобильных профилях: отчёт → проекция/KPI/PDF, создание/приёмка наряда, подтверждённое удаление куста.
- 2: отдельный тест лимита входа запускается только в Chromium, чтобы браузерные проекты не мешали друг другу лимитами IP.
- 1: редактор плиток/фото явно ограничен Chromium и Mobile Chrome; Safari не поддержан этим тестом.

Проверены вход, страницы и API, ограничения входа, роли, административные справочники и пользователи, осмотры, создание/сдача отчёта, проекции/KPI и worker PDF, наряд, удаление тестового куста, восстановление UI после ошибки обновления, печать инструктажа, редактор фото с реальным S3, ORION на мобильной ширине и reduced motion. Это только существующие утверждения выбранных тестов, не проверка каждой кнопки приложения.

**Остальные 195 из ранее собранных 315 сценариев не запускались.** Они находятся в `e2e/qa` и `e2e/qa-ac`, зависят от внешней исторической QA-матрицы, файла паролей, сохранённых сессий и конкретных записей/дат, которых нет в синтетическом стенде. Среди них имеются жёстко заданные docker-команды. Они исключены из выполнения, а не засчитаны прошедшими или обычными skip. Для полного 315/315 требуется перенести эту матрицу и данные в воспроизводимые одноразовые фикстуры.

Результаты: [JSON E2E](D:/PillingR/wt-app-review-1022/output/app-review-1022/e2e-results.json), [HTML](D:/PillingR/wt-app-review-1022/playwright-report/index.html), [лог](D:/PillingR/wt-app-review-1022/output/codex-t5/app-review-e2e.log), [exit супервизора](D:/PillingR/wt-app-review-1022/output/codex-t5/app-review-e2e-result.json).

## Интеграционные тесты: пропуски сняты, обнаружено падение

Запуск `node output/app-review-1022/run-integration.cjs` через тот же супервизор. Vitest: `run tests/integration --maxWorkers=1 --reporter=json`, с адресами исключительно созданного codex_test и HTTP-адресом собственного приложения. Получено **374 passed / 1 failed / 0 skipped, exit 1**. Общее число включает также проверки, которые не требовали БД и раньше выполнялись.

Все 260 ранее закрытых условий стали доступны; один из этих тестов упал. [Полный результат](D:/PillingR/wt-app-review-1022/output/app-review-1022/integration-results.json), [лог](D:/PillingR/wt-app-review-1022/output/codex-t5/app-review-integration.log).

### R5 · P2 · Заголовок журнала теряет объект за пределами первой страницы

Тест создаёт 501 строку выработки за период: 500 на одном объекте и последнюю на другом. API-список ограничен 500 строками. Числовые итоги считаются по всей выборке, но `pileJournalHeader` собирает `siteNames` из урезанного массива строк. Поэтому заголовок содержит только первый объект.

Источник: [pile-journal-totals.ts:145](D:/PillingR/wt-app-review-1022/src/modules/reports/application/queries/pile-journal-totals.ts:145); [API формирует заголовок](D:/PillingR/wt-app-review-1022/src/app/api/pile-passports/route.ts:66). [Падающее утверждение](D:/PillingR/wt-app-review-1022/tests/integration/disposable-m6-m8.spec.ts:92): ожидается `['Disposable site', 'Other scope site']`, получено `['Disposable site']`. Страница действительно имеет 500 строк и `truncated: true` — соответствующие утверждения перед падением прошли.

Такая же зависимость от среза есть у описательных полей оборудования/молота; реальное воспроизведение в этом прогоне проверило только названия объектов. У XLSX свой предел 20000, поэтому случай с 501 строкой сам по себе не доказывает дефект XLSX: для него нужен отдельный тест превышения этого предела.

Первый повтор не дошёл до утверждений: PostgreSQL стал недоступен (`ECONNREFUSED`), suite завершился exit 1, шесть тестов отмечены skipped из-за ошибки beforeAll. Это инфраструктурная неудача, не шесть новых пропусков по конфигурации и не подтверждение исправления.

Затем выполнен `bash output/app-review-1022/recheck-fresh.sh`: новый PostgreSQL, существующие миграции и весь файл `disposable-m6-m8.spec.ts`. **5 passed / 1 failed / 0 skipped, exit 1**, то же утверждение. [Лог свежего повтора](D:/PillingR/wt-app-review-1022/output/app-review-1022/recheck-fresh.log), [JSON](D:/PillingR/wt-app-review-1022/output/app-review-1022/integration-recheck.json). Таким образом, падение независимо воспроизводится на свежей БД.

## Дополнительные попытки и завершение

- Первый диагностический запуск для разбивки пропусков пересёкся с генерацией Prisma-клиента при сборке: один файл не смог разрешить импорт. Exit 1 сохранён в `skips-detail.exit`; этот частичный результат не использован как окончательный. Полный повтор unit-прогона после генерации прошёл и подтвердил точные 262 пропуска.
- В integration-логе есть предупреждение pg об одновременных запросах через один Client; это предупреждение, не причина описанного assertion failure.
- Супервизору отправлен штатный stop; получено `CLEANUP done`, exit 0. Свежая проверочная БД удалена своим trap. Финальная проверка `docker ps -a --filter name=codex` не показала контейнеров. Чужие контейнеры не запускались/не останавливались этой задачей.
- Worktree исходников чистый; HEAD сохранён. Отчёт и логи остаются в output. Сводные данные: [followup-summary.json](D:/PillingR/wt-app-review-1022/output/app-review-1022/followup-summary.json).

Итог ревью теперь включает R1–R4 из первоначального отчёта и R5 из реального интеграционного прогона. Исправления не выполнялись.
