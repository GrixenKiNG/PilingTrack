# G — типизированные поверхности и защита раскладки от перезаписи

Ветка: `codex/layout-types-1023`. Основа: `fdd67ccf688ec63561f3939fd4b665032cba7525`.
Рабочее дерево: `D:/PillingR/wt-layout-types-1023`. Код и тесты: `5e098d33` (`fix(layout): type surfaces and reject stale layout saves`). Отчёт и ссылка из исторического REPORT.md — отдельный последующий docs-коммит.

## Изменения

- Четыре идентификатора SurfaceId определяют конкретные EquipmentTileTemplate, EquipmentCardTemplate или PageLayoutTemplate. Конфигурация различается по kind; публичные get/save/getSet сохраняют тип выбранной поверхности. Два приведения `as unknown as Promise<EquipmentTileTemplate>` в monitoring удалены.
- JSON и `template.version = 1` не менялись. Версия формата отделена от revision записи: ETag содержит существующие id и updatedAt. Отсутствующей строке соответствует `"none"`.
- GET редактора возвращает JSON с ETag. PUT и DELETE требуют If-Match. Запись использует условный update/delete по id+updatedAt и прежнему scope, создание ловит конкурентный P2002. updatedAt продвигается минимум на 1 мс; удаление и повторное создание меняет id. Запись и её ETag возвращаются без отдельного чтения после записи.
- Оба разрешённых API сохраняют проверки прав/tenant/wrappers; конфликт возвращается как 409, включая legacy /api/monitoring/template. Клиент без If-Match получает 409, старые JSON читаются. Для обновления legacy-клиента необходим цикл GET → ETag → If-Match.
- Оба редактора показывают понятный текст конфликта, сохраняют черновик и режим редактирования, не принимают новую revision автоматически. Повтор устаревшего сохранения не обходит защиту. Удалённые ресурсы очищаются только после успешной записи.
- Обновлены существующие unit/contract mocks: настоящий Response с headers и metadata строки вместо прежнего upsert. Новый integration-файл нужен для настоящего PostgreSQL, а его config явно включает только этот набор без чтения .env.

## Воспроизведение до исправления

- PostgreSQL: два одновременно прочитавших старую JSON-запись клиента успешно сохраняли разные изменения; ожидался один победитель. Сохранение без revision также проходило. RED: exit 1, 2 failed, 0 passed; 1.22 с. Лог: `output/layout-types-1023/integration-before.log`.
- Два client hook: If-Match не отправлялся. RED: exit 1, 2 failed, 14 skipped из-за `-t 'layout revision conflict'`, 30.48 с. Это целевой фильтр, не скрытые пропуски полного набора. Лог: `ui-before.log`.
- Первый scoped GREEN-поиск: exit 1, 72 passed/1 failed; существующий fleet mock не имел Response.headers и чтение стало ошибочным. Исправлен именно mock; падение сохранено в `scoped.log`.
- Первоначальный tsc: exit 2 (неверный scope revision, тип union renderHook, слишком широкий тип monitoring surface); исправлены. Отдельная диагностическая попытка spawnSync tsc остановлена timeout 45 с, status null/SIGTERM, успехом не считается. Финальная проверка приведена ниже.

## Проверки

| Проверка | Exit | Результат |
|---|---:|---|
| npm ci --ignore-scripts | 0 | Собственные зависимости, 750 packages, 0 audit vulnerabilities; junction/symlink не создавались |
| Prisma generate integration config + patch-postgres-client.js | 0 / 0 | Собственный generated client, только одноразовый PostgreSQL |
| npx tsc --noEmit | 0 | Повтор после успешного build, включая Next route types; stale .next/dev/types отсутствовала |
| ESLint . | 0 | Без ошибок и предупреждений |
| npm run lint | 0 | Точная команда выполнена дополнительно; ESLint и text-integrity без ошибок/предупреждений |
| npm run check:layers | 0 | 4 grandfathered, 0 new |
| npm run db:check-migrations | 0 | Проверка существующих миграций, схема не менялась |
| Mock contract layout+monitoring | 0 | 14 passed/0 skipped/0 failed, 836 мс; это mocks, не DB evidence |
| PostgreSQL CAS (tracked integration config) | 0 | 4 passed/0 skipped/0 failed, 2.06 с; update/create race, legacy без revision, stale reset, token+JSON; на настоящем PG |
| Полный unit (vitest run --maxWorkers=2) | 0 | 5369 passed/265 skipped/0 failed; 488 files passed+15 skipped; 476.76 с |
| Финальный scoped, включая contract | 0 | 87 passed/0 skipped/0 failed, 51.37 с; содержит дополнительный assert cleanup после полного run |
| npx playwright test --list | 0 | 315 tests/28 files, число не уменьшилось; runtime не подразумевается |
| npm run build на собственном стенде | 0 | Собственные PG+Redis, синтетические аккаунты; seed exit 0; тот же код приложения, без повторной сборки |
| Chromium: две настоящие вкладки, card-blocks | 0 | Оба направления 200/409; черновик проигравшего 310/330 остаётся, PG содержит ширину победителя 300/320; legacy GET200+ETag, PUT без If-Match409 |
| Chromium: две настоящие вкладки, page-layout | 0 | Оба направления 200/409; размер черновика lg остаётся, PG содержит размер победителя sm/md |
| GitNexus detect_changes(all), перед code commit | 0 | 46 changed/36 affected/17 files, risk CRITICAL; partial/truncated не возвращены. Это анализ влияния, не all-clear |
| GitNexus detect_changes(all), docs-only | 0 | 2 changed/0 affected/2 files, LOW; не заменяет CRITICAL анализа кода |
| Text integrity после нового отчёта | 0 | Проверка нового русского текста прошла |

Для PostgreSQL экспортировать в память вывод `bash scripts/test-db-up.sh`, сгенерировать собственный client через `prisma.integration.config.ts`, задать DATABASE_URL/DATABASE_URL_POSTGRES равными INTEGRATION_DATABASE_URL_APP и выполнить `npx vitest run --config src/modules/layout/vitest.integration.config.ts`. После теста обязательно `bash scripts/test-db-down.sh "$INTEGRATION_DB_CONTAINER"`. Пароли в отчёт/файлы не выводить.

## GitNexus и границы

Индекс собственного worktree привязан к исходному SHA, 32775 nodes/1221 flows. impact exit 0: getSurfaceConfig HIGH/11, useLayoutTemplate HIGH/8, usePageLayoutTemplate HIGH/9 — root предупреждён до изменений; службы LOW/1–3. Route entrypoints UNKNOWN/0: подтверждены текстовым поиском путей и вызовов по src/tests/e2e, ноль не трактуется как отсутствие влияния. Индекс сообщает усечение глобальных flows; impact конкретных символов и итоговый detect рассматриваются отдельно. Итоговый detect CRITICAL охватывает общие AdminAnalytics и API wrapper/log flows: root предупреждён до commit, требуется независимое ревью; security/frozen файлы не менялись.

Frozen operator/ORION, auth/security/tenancy, схема/миграции, зависимости и docker/deploy файлы не менялись. Исходный исторический корневой REPORT.md сохранён; добавляется ссылка на этот отчёт. Файлы не удалялись. Удалён только частный cloneTemplate; вместо него structuredClone. Полный `git grep -n cloneTemplate fdd67ccf --` показал определение и три вызова только в layout-service.ts; экспортов или внешних ссылок не было. Отдельных тестов частного helper не было; проверки deep-clone/fallback сохранены.

## Ограничения и риски

- Конфликт требует обновления страницы; автоматического слияния несовместимых черновиков нет. Пользователь должен сохранить нужные правки перед обновлением.
- Сохранение устаревшим клиентом намеренно отклоняется. Администраторские права и модель tenant не расширялись.
- Проверка идёт на синтетике, не на production/физических устройствах. Общая runtime-проверка всех 195 QA сценариев в задачу G не входит.
- Команды push, merge, deploy и чтение .env/внешних credentials не выполнялись. Raw output/log/JSON не включаются в commit.

## История runtime harness и очистка

Первый supervisor wrapper имел общий timeout 30 минут: exit status null / SIGTERM / ETIMEDOUT. До этого build реально завершился 0 и stand был READY. Таймаут не остановил дочерний supervisor20332 и Next24092. При продолжении проверены owned port53063 (health200) и PID; повторный stand/build не запускался. Работа продолжена через command queue живого собственного supervisor с синтетическими credentials только в его RAM.

Дополнительный page-layout harness дал два exit1: двойной dialog.accept на втором круге; затем попытка выбрать уже сохранённый размер оставляла кнопку неактивной и ожидание PUT истекало. Исходники и оба красных лога сохранены. Финальный harness регистрирует handler один раз и выбирает изменения относительно прочитанной записи: exit0 в обоих направлениях. Код приложения между этими попытками не менялся.

После штатного stop: CLEANUP done, shell EXIT trap удалил owned PG. Повторный адресный test-db-down вернул exit1/no such object, потому что PG уже отсутствовал; это сохранено, не выдано за exit0. Итоговый docker ps -a exit0: собственные codex-pg-b9a5f41e6bbb, codex-redis-state-4ce8181c462f, codex-redis-cache-63ffa39b34b4 отсутствуют. Порты53063/53064/53058/53061/50491 закрыты, own supervisor/Next не найдены. Другие staging/локальные контейнеры не трогались.

Raw evidence: output/layout-types-1023/stand/{stand-build,two-tabs,pg-final,page-tabs,page-tabs-fixed,page-tabs-final}.log, two-tabs-results.json, page-tabs-results.json, cleanup.json. Скриншоты two-tabs-loser-{1,2}.png и page-tabs-loser-{1,2}.png визуально просмотрены. Raw artifacts остаются локальными, в commit не входят.

## Изменённые файлы кода и тестов

16 файлов, +343/-168 строк; удалённых файлов нет. Числа из git show --numstat 5e098d33:

| Файл | + | - |
|---|---:|---:|
| `src/app/api/layout/[surfaceId]/route.ts` | 9 | 5 |
| `src/app/api/monitoring/template/__tests__/route.test.ts` | 7 | 1 |
| `src/app/api/monitoring/template/route.ts` | 7 | 5 |
| `src/components/piling/layout-editor/__tests__/layout-load-failure.test.tsx` | 29 | 1 |
| `src/components/piling/layout-editor/use-layout-template.ts` | 20 | 12 |
| `src/components/piling/layout-editor/use-page-layout-template.ts` | 17 | 11 |
| `src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx` | 2 | 2 |
| `src/modules/layout/__tests__/layout-concurrency.integration.ts` | 68 | 0 |
| `src/modules/layout/__tests__/layout.test.ts` | 17 | 18 |
| `src/modules/layout/application/layout-service.ts` | 84 | 67 |
| `src/modules/layout/domain/surfaces.ts` | 33 | 19 |
| `src/modules/layout/index.ts` | 7 | 0 |
| `src/modules/layout/vitest.integration.config.ts` | 14 | 0 |
| `src/modules/monitoring/application/template-service.ts` | 3 | 2 |
| `tests/contract/layout-template.spec.ts` | 17 | 17 |
| `tests/contract/monitoring-template.spec.ts` | 9 | 8 |

Документы: исторический REPORT.md +5/-0 строк; новый docs/reports/layout-types-1023/REPORT.md — 93 строк.
