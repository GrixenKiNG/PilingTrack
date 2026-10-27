# Реальная БД: повтор всех 241 пропуска

База исходников: efd95008eac3bc846c89003c4b7766f2eb5c1c9b (origin/main). Исторический список 241 пропуска взят из полного прогона SHA22f007be, но каждый сценарий сопоставлен по файлу и полному имени с новым запуском.

## Изолированное окружение

PostgreSQL18.6, контейнер codex-pg-cc9926812e04,127.0.0.1:50229,codex_test. Redis7, codex-night-redis-cc9926812e04,:60281. Отдельные роли piling и pilingtrack_app, применены все миграции prisma migrate deploy через prisma.integration.config.ts и штатные grants app/identity. Это не рабочая локальная БД. Никакие .env не читались/создавались; пароли сгенерированы штатным способом и существуют только в памяти supervisor/контейнера.

HTTP-стенд scripts/test-day-stand.cjs использует ту же свою БД, собственные Redis state/cache и MinIO с реальным signed PUT/GET/DELETE. Host production build exit0. Первый прогон использовал http://127.0.0.1:56526, workers56527; этот app позднее остановлен. Финальные проверки ветки используют другой адрес, он указан в SUMMARY.md. scripts/staging-local.sh намеренно не запущен: он читает production dump через SSH. Существующий staging3100 и рабочие сервисы не тронуты.

## Прогоны

| Набор | Exit | Passed | Skipped | Failed | Время |
|---|---:|---:|---:|---:|---:|
| integration-db-base | 0 | 216 | 162 | 0 | 99с |
| integration-http-base | 0 | 162 | 0 | 0 | 11с |
| s3-red | 1 | 13 | 0 | 2 | 2с |
| s3-green (7ad5d3bd) | 0 | 15 | 0 | 0 | 2с |

DB-прогон216passed/162skipped и HTTP-прогон162passed — непересекающиеся исполненные сценарии. Итого378 выполненных интеграционных тестов без падений; из них239 — ранее пропущенные. Не суммировать также skipped первого прогона с результатом второго. Оставшиеся два исторических пропуска относятся к S3 unit helpers и действительно падают; это не отсутствие MinIO.

## Причины исторических пропусков

| Причина | Количество | Итог первого реального повтора |
|---|---:|---|
| Собственная БД/роли/контейнер |77|77 passed|
| БД + CODEX_STAND_URL |162|162 passed|
| Явный it.skip в S3 helpers |2|2 failed, дефект подтверждён|
| Redis gate |0|Не причина этих241|
| MinIO gate |0|Не причина этих241|

## ДЕФЕКТ S3-KEY-001

reportPdfKey/exportCsvKey при null или пустом tenantId возвращают ключ в общем default-префиксе вместо отказа. Сняты только два существующих skip по явному разрешению владельца; s3-red:13passed/2failed/0skipped, exit1. Дополнительный прямой вызов реальных функций дал4/4 несовпадения (null/пустая строка ×2функции), exit1. Поиск src/tests/e2e/scripts не нашёл production callers helpers; поэтому факт генерации неверного ключа доказан, межарендаторная утечка в живом маршруте не заявлена. Разрешена минимальная правка только двух функций и их существующих тестов. Исправлено отдельным коммитом7ad5d3bd после красного17fd1277. s3-green:15passed/0failed/0skipped,exit0. Две функции теперь бросают tenantId is required. GitNexus impact UNKNOWN подтверждён текстом; detect_changes полное перед каждым коммитом. Исторический красный результат ниже намеренно сохранён, после исправления все241 ранее пропущенных сценария прошли.

## Повтор

Команды точны, секреты не включены. npm ci --ignore-scripts (exit0); Prisma generate и migrate deploy --config prisma.integration.config.ts (оба0). Подъём штатным scripts/test-db-up.sh даёт только ephemeral exports; не сохранять их в .env. Supervisor runner.cjs в D:/PillingR/night-logs/night-evidence-1026 сохраняет команды каждого запуска в *.result.json и логи с редактированием credentials.

- node node_modules/vitest/vitest.mjs run tests/integration --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<db-results>
- После READY собственного HTTP-стенда: node node_modules/vitest/vitest.mjs run tests/integration/disposable-idor.spec.ts tests/integration/disposable-report-race.spec.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<http-results>
- node node_modules/vitest/vitest.mjs run src/core/storage/__tests__/s3-service.test.ts --maxWorkers=1 --reporter=json --outputFile=<s3-results>

Не использовать prod:smoke без явного --url localhost: его default — production.

## Построчный реестр241

| № | Файл / сценарий | Причина | Реальный результат | Лог |
|---:|---|---|---|---|
|1|tests/integration/disposable-analytics-performance.spec.ts: E5 combined pile aggregate semantics период не меняет накопительный итог и не включает черновик|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|2|tests/integration/disposable-analytics-performance.spec.ts: J8 pile journal period indexes покрывает occurredAt и NULL fallback без изменения строк и итогов|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|3|tests/integration/disposable-equipment-race.spec.ts: E4 PG equipment optimistic lock отвергает устаревшую карточку целиком, включая паспорт|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|4|tests/integration/disposable-equipment-race.spec.ts: E4 PG equipment optimistic lock два одновременных сохранения одной версии дают ровно одного победителя|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|5|tests/integration/disposable-equipment-race.spec.ts: E4 PG equipment optimistic lock ошибка показания откатывает основные поля и паспорт|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|6|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant uses the actual non-bypass application role|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|7|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant both tenants still see the ALL event, and only their own read state|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|8|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant missing and empty tenant hide all read states|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|9|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant foreign read state cannot be updated or deleted|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|10|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant own recipient can insert and acknowledge read state|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|11|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant foreign recipient insert fails even for an existing global event|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|12|tests/integration/disposable-feedback-rls.spec.ts: Feedback read state belongs to its recipient tenant missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|13|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /auth/me?userId=U|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|14|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /crews/my?operatorId=U|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|15|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /reports/edit?userId=U&siteId=S&date=2026-10-02|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|16|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /reports/single-pdf?reportId=R&sync=1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|17|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /reports/single-pdf|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|18|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /reports/upsert|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|19|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /reports/upsert|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|20|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /media?entityType=equipment&entityId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|21|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /media|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|22|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /inspections|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|23|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|24|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /briefings/B1/sign|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|25|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|26|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|27|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|28|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E/details|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|29|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E/meter-readings|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|30|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /equipment/E/meter-readings|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|31|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E/fuel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|32|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /equipment/E/fuel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|33|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /equipment/E/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|34|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /equipment/E/documents/D1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|35|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /equipment/E/documents/D1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|36|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E/device-keys|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|37|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /equipment/E/device-keys|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|38|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /equipment/E/maintenance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|39|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /equipment/E/maintenance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|40|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /equipment/E/maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|41|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /equipment/E/maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|42|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|43|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|44|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|45|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /sites/S/hierarchy|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|46|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /sites/S/hierarchy|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|47|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /sites/S/assign|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|48|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|49|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|50|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|51|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /inspections/I|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|52|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /inspections/I|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|53|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /inspections/I/complete|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|54|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /checklist-templates/T|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|55|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /checklist-templates/T|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|56|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|57|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /maintenance/M/accept|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|58|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /users/U/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|59|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /users/U/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|60|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PUT /users/U/documents/U1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|61|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /users/U/documents/U1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|62|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /reports/R/history|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|63|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /reports/delete|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|64|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /media/F/download|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|65|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /media/F/confirm|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|66|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /media/F|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|67|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /readiness/shifts/H|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|68|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PATCH /readiness/shifts/H|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|69|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts/H/start|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|70|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts/H/request-acceptance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|71|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts/H/cancel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|72|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /equipment/E/fuel/F1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|73|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /equipment/E/meter-readings/N1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|74|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PATCH /maintenance-plans/PM|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|75|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: DELETE /maintenance-plans/PM|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|76|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /readiness/current?equipmentId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|77|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /readiness/defects?equipmentId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|78|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/defects|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|79|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/defects/DF/triage|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|80|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/defects/DF/resolve|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|81|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/defects/DF/reject|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|82|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /readiness/handovers/HO|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|83|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/handovers/HO/accept|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|84|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/handovers/HO/rework|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|85|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: GET /readiness/work-permits/WP|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|86|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: PATCH /readiness/work-permits/WP|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|87|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/work-permits/WP/submit|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|88|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/work-permits/WP/approve|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|89|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/work-permits/WP/revoke|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|90|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts/H/decline|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|91|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app OPERATOR: POST /readiness/shifts/H/handover|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|92|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /auth/me?userId=U|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|93|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /crews/my?operatorId=U|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|94|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /reports/edit?userId=U&siteId=S&date=2026-10-02|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|95|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /reports/single-pdf?reportId=R&sync=1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|96|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /reports/single-pdf|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|97|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /reports/upsert|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|98|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /reports/upsert|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|99|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /media?entityType=equipment&entityId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|100|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /media|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|101|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /inspections|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|102|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|103|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /briefings/B1/sign|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|104|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|105|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|106|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /equipment/E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|107|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E/details|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|108|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E/meter-readings|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|109|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /equipment/E/meter-readings|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|110|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E/fuel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|111|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /equipment/E/fuel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|112|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /equipment/E/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|113|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /equipment/E/documents/D1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|114|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /equipment/E/documents/D1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|115|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E/device-keys|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|116|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /equipment/E/device-keys|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|117|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /equipment/E/maintenance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|118|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /equipment/E/maintenance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|119|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /equipment/E/maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|120|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /equipment/E/maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|121|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|122|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|123|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /sites/S|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|124|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /sites/S/hierarchy|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|125|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /sites/S/hierarchy|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|126|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /sites/S/assign|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|127|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|128|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|129|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /crews/C|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|130|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /inspections/I|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|131|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /inspections/I|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|132|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /inspections/I/complete|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|133|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /checklist-templates/T|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|134|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /checklist-templates/T|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|135|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /maintenance/M|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|136|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /maintenance/M/accept|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|137|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /users/U/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|138|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /users/U/documents|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|139|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PUT /users/U/documents/U1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|140|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /users/U/documents/U1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|141|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /reports/R/history|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|142|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /reports/delete|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|143|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /media/F/download|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|144|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /media/F/confirm|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|145|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /media/F|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|146|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /readiness/shifts/H|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|147|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PATCH /readiness/shifts/H|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|148|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts/H/start|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|149|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts/H/request-acceptance|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|150|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts/H/cancel|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|151|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /equipment/E/fuel/F1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|152|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /equipment/E/meter-readings/N1|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|153|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PATCH /maintenance-plans/PM|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|154|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: DELETE /maintenance-plans/PM|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|155|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /readiness/current?equipmentId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|156|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /readiness/defects?equipmentId=E|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|157|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/defects|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|158|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/defects/DF/triage|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|159|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/defects/DF/resolve|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|160|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/defects/DF/reject|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|161|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /readiness/handovers/HO|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|162|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/handovers/HO/accept|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|163|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/handovers/HO/rework|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|164|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: GET /readiness/work-permits/WP|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|165|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: PATCH /readiness/work-permits/WP|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|166|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/work-permits/WP/submit|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|167|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/work-permits/WP/approve|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|168|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/work-permits/WP/revoke|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|169|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts/H/decline|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|170|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app ASSISTANT: POST /readiness/shifts/H/handover|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|171|tests/integration/disposable-idor.spec.ts: E2 HTTP IDOR on disposable production app foreign records remain intact after all denied mutations|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|172|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres M6: draft excluded from KPI/live projection/rebuild; submission and rebuild agree|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|173|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres journal header covers all 501 rows and export status filters reach PostgreSQL|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|174|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres не засчитывает инструктаж до подписи работника в личном допуске и общей сводке|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|175|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres M7: partial receipts survive a disconnected client/module restart; retry sends only B|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|176|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres F3: real RLS config marks permanent B disabled while outbox publishes delivery to A|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|177|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres F2: persisted DLQ then recovered webhook creates a fresh published attempt|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|178|tests/integration/disposable-m6-m8.spec.ts: M6–M8 on disposable migrated Postgres M8: real Media rows/files unchanged; dry-run deletes nothing; apply only old temporary UUID PDF|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|179|tests/integration/disposable-report-race.spec.ts: E3 real concurrent report saves один победитель, второй 409; данные победителя сохранены|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|180|tests/integration/disposable-report-race.spec.ts: E3 real concurrent report saves X6: web report snapshots only accepted engine hours, preserving a rejected decrease|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|181|tests/integration/disposable-report-race.spec.ts: E3 real concurrent report saves сохраняет мобильную поправку через веб-форму и защищает её исходную запись|Нет CODEX_STAND_URL + изолированной БД|passed|integration-http-base.json|
|182|tests/integration/disposable-restore.spec.ts: restore synthetic dump from one consistent snapshot restores all tables/migrations/RLS, detects a wrong manifest and removes its target|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|183|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role uses the exact application and identity roles with production privileges|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|184|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|185|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|186|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|187|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|188|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|189|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|190|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|191|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|192|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|193|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|194|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|195|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|196|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|197|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|198|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|199|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|200|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|201|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|202|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: two tenants see only their own seeded row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|203|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: missing and empty tenant fail closed|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|204|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: rejects a write to the other tenant with RLS error 42501|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|205|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|206|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|207|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Report: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|208|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|209|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|210|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Site: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|211|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|212|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|213|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Equipment: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|214|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|215|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|216|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Inspection: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|217|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|218|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|219|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role Shift: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|220|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|221|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|222|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role AuditLog: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|223|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: cannot update or delete another tenant row|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|224|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: missing tenant rejects insertion|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|225|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role BriefingRecord: own tenant can write|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|226|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role does not leak local tenant between transactions on the same backend (transaction-pool contract)|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|227|tests/integration/disposable-rls.spec.ts: RLS on all deployed migrations, real application role app cannot read the migration journal or create schema objects|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|228|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres defaults to dry-run, including zero rows, without changing any row|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|229|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres backs up every column, deletes only five keys and restores exact rows; duplicate restore rolls back|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|230|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres refuses fewer targets, another tenant and an existing backup without deleting rows|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|231|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres globally detects a live Report in another tenant|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|232|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres refuses incoming foreign keys and enabled user triggers|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|233|tests/integration/disposable-scripts.spec.ts: J7 orphan cleanup real own Postgres rejects checksum tampering and schema mismatch before restore|Нет INTEGRATION_DATABASE_URL_* / owned container|passed|integration-db-base.json|
|234|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model rolls back the source when the real database rejects the outbox insert|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|235|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model commits completion and exactly one outbox event, replaying without another event|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|236|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model закрытие ТО осмотром переносит реальный регламент; повтор сохраняет тот же срок|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|237|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model rejects another tenant and leaves its source unchanged|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|238|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model does not commit a snapshot or projected marker when the database rejects the read model|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|239|tests/integration/tech-readiness-write-pipeline.spec.ts: Tech Readiness real source → outbox → snapshot → read model projects the real event once and persists the immutable snapshot and current model|Нет INTEGRATION_DATABASE_URL_OWNER/APP|passed|integration-db-base.json|
|240|src/core/storage/__tests__/s3-service.test.ts: S3-сервис: построение ключей объектов reportPdfKey: пустая организация отказывает (fail closed), а не использует "default"|Явный it.skip, известный fail-closed дефект helpers|failed → passed после исправления|s3-red.json → s3-green.json|
|241|src/core/storage/__tests__/s3-service.test.ts: S3-сервис: построение ключей объектов exportCsvKey: пустая организация отказывает (fail closed), а не использует "default"|Явный it.skip, известный fail-closed дефект helpers|failed → passed после исправления|s3-red.json → s3-green.json|
