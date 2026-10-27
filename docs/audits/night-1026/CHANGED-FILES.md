# Изменённые файлы ветки

База efd95008eac3bc846c89003c4b7766f2eb5c1c9b. Код/тесты по 58a2b64f7a9437e6badbc1474bfb279ee95c5a18; текущие отчёты включены. Сам перечень исключён. Строки считаются по переводам строки, финальный пустой элемент не учитывается. Удалений нет.

| Файл | Было | Стало |
|---|---:|---:|
|docs/DATA-SOURCES.md|51|51|
|docs/audits/night-1026/CLEARANCE-MATRIX.json|—|166|
|docs/audits/night-1026/CLEARANCE-MATRIX.md|—|30|
|docs/audits/night-1026/DOCS-VS-CODE.md|—|83|
|docs/audits/night-1026/IMAGES.md|—|36|
|docs/audits/night-1026/INTEGRATION-RUN.md|—|305|
|docs/audits/night-1026/LONG-FILES.json|—|197|
|docs/audits/night-1026/LONG-FILES.md|—|28|
|docs/audits/night-1026/OPERATOR-CYCLE.json|—|4238|
|docs/audits/night-1026/OPERATOR-CYCLE.md|—|39|
|docs/audits/night-1026/OUTBOX.md|—|51|
|docs/audits/night-1026/PERMISSIONS-CODE.json|—|484|
|docs/audits/night-1026/PERMIT-IDEMPOTENCY-RACE.md|—|32|
|docs/audits/night-1026/QA-OBSERVATIONS.json|—|1562|
|docs/audits/night-1026/QA-RUN.md|—|44|
|docs/audits/night-1026/REVIEW.md|—|32|
|docs/audits/night-1026/ROLES-OBSERVATIONS.json|—|4452|
|docs/audits/night-1026/ROLES-WALKTHROUGH.md|—|143|
|docs/audits/night-1026/SKIP-REGISTRY.json|—|2657|
|docs/audits/night-1026/SUMMARY.md|—|84|
|docs/audits/night-1026/V3-SELECTOR.md|—|25|
|docs/audits/night-1026/VERIFICATION.md|—|122|
|docs/audits/night-1026/WHOLE-RUN-MATCH.json|—|19|
|e2e/README.md|122|122|
|e2e/fixtures/disposable-qa.mjs|121|122|
|e2e/night-operator-cycle.spec.ts|—|266|
|e2e/night-role-walkthrough.spec.ts|—|201|
|e2e/qa-ac/write-flows.spec.ts|212|216|
|playwright.night.config.ts|—|26|
|src/app/(app)/(safety)/admin/safety/__tests__/page.test.tsx|—|26|
|src/app/(app)/(safety)/admin/safety/page.tsx|14|20|
|src/components/piling/__tests__/dashboard-attention.test.tsx|65|76|
|src/components/piling/dashboard-attention.tsx|96|98|
|src/components/piling/operator-v3/operator-dashboard-v3.tsx|199|199|
|src/core/storage/__tests__/s3-service.test.ts|205|205|
|src/core/storage/s3-service.ts|161|163|
|src/modules/reports/application/__tests__/outbox-failures.integration.test.ts|—|139|
|src/modules/reports/application/__tests__/outbox-process.fixture.ts|—|30|
|src/modules/reports/application/outbox-publisher.ts|353|354|
|src/modules/safety/application/__tests__/clearance-matrix.integration.test.ts|—|87|
|src/workers/__tests__/outbox-worker.test.ts|496|497|
|src/workers/__tests__/projection-worker.test.ts|435|440|

Схема/миграции/зависимости/auth/security/ORION не менялись. Разрешённые точечные tenant-related изменения: два S3 helpers и canonical outbox guard. TryClaim не изменён, предложение ждёт ответа владельца. Все версии экранов сохранены.
