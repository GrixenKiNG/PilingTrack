# N17-01 — закрытие наряда-допуска: READ-ONLY аудит (PERMIT-CLOSE-REVIEW)

## Итог

Проверено закрытие наряда-допуска (состояние `CLOSED`, причины `WORK_DONE` / `VALIDITY_ELAPSED`)
в шести коммитах `1b6f14c1 … cb8fc697` (HEAD `6d0deea5`, база `1d24e24f`). Ничего не менялось —
только это отчёт.

- **Гонки закрыты.** Ручное закрытие — единственный `updateMany` с CAS
  (`tenantId + id + version + state='APPROVED' + validFrom<=closedAt`), версия проверяется
  ещё и по `If-Match`/телу, ключ идемпотентности обязателен. Одновременные close/approve/revoke
  безопасны: проигравший CAS получает 409, ложного аудита не пишется.
- **Планировщик идемпотентен.** Отбирает только `APPROVED`/`PENDING_APPROVAL`; уже `CLOSED`/`EXPIRED`
  не переотбирает. Сравнение по абсолютной метке `validTo` (timestamptz) — часовой пояс и границы суток
  на закрытие по сроку не влияют; после суток простоя воркера наряд закрывается на ближайшем тике.
- **Перечисления состояний полны** в коде и UI (тип, переходы, подписи, контракт, фильтры, счётчики,
  лента аудита, роль-шаги, дашборд). Единственный пробел — CSV-выгрузка нарядов не отдаёт
  дату/автора/причину закрытия.
- **RLS.** Политика `WorkPermit` — табличная `FOR ALL USING ("tenantId" = current_setting(...))`,
  поэтому новые столбцы `closedAt/closedById/closeReason` закрыты fail-closed автоматически;
  ветки `tenantId IS NULL OR ...` нет.
- **Права и журнал.** Закрыть может носитель `readiness.permit.edit` (по умолчанию ADMIN, MECHANIC,
  SAFETY_ENGINEER); диспетчер согласует, но не закрывает — совпадает с замыслом и полосой ролей.
  Пишется актор (id/имя/роль/actingAs), причина — в `metadata.comment`, `after` — сериализованный наряд.
- **Находки:** критично — 0, важно — 1, мелочь — 5.
- **Главная:** ручное закрытие просроченного, но ещё не сметённого планировщиком наряда
  (`validTo<=now`, `state='APPROVED'`) записывает причину `WORK_DONE`, а не `VALIDITY_ELAPSED`.

## Методика

Аудит READ-ONLY: только чтение, поиск и `git show`/`git log`. Репозиторий — `D:\PillingR\wt-night-code`,
ветка `hermes/code-1011`. Рабочая директория из задания (`wt-night-code-code`) не существует; работа шла
в текущей (`wt-night-code`).

GitNexus `impact` для перечислений состояний не применялся: состояния перебираются строковыми литералами
и property-access (`row.state`), которые графу не разрешить. Полнота проверялась текстовым поиском `rg`
по `src/`, `prisma/`, `scripts/`, `e2e/`, `tests/` (исключая `node_modules` и `src/generated/**`) по образцам:
`WorkPermitState`, `PENDING_APPROVAL`, `APPROVED`, `EXPIRED`, `REVOKED`, `CLOSED`, `closeReason`,
`WORK_DONE`, `VALIDITY_ELAPSED`, `closedAt`, `closedById`, `work-permit.`, `work-permits`, `закрыт`.

Прочитаны (полностью или в указанных пределах) шесть коммитов и файлы:
`prisma/migrations/20261015090000_work_permit_close/migration.sql`,
`prisma/migrations/20260813030000_readiness_rls_fail_closed/migration.sql`,
`prisma/schema.prisma` (WorkPermit),
`src/modules/readiness/domain/permits/{types,transitions}.ts`,
`src/modules/readiness/domain/capability-defaults.ts`,
`src/modules/readiness/domain/evaluation/{evaluator,facts}.ts`,
`src/modules/readiness/domain/readiness-score.ts`,
`src/modules/readiness/application/permits/{commands,queries,schemas}.ts`,
`src/modules/readiness/application/scheduler.ts`,
`src/modules/readiness/application/readiness-score.ts`,
`src/modules/readiness/application/export/{../csv-export}.ts` (`application/csv-export.ts`),
`src/modules/readiness/infrastructure/permits/work-permit-repository.ts`,
`src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts`,
`src/modules/readiness/infrastructure/audit/{record-audit,append-audit}.ts`,
`src/modules/readiness/infrastructure/tenant-transaction.ts` (косвенно),
`src/workers/unified-worker/readiness-scheduler.ts`,
`src/app/api/readiness/work-permits/[id]/{close,revoke}/route.ts` (+ `close/route.test.ts`),
`src/app/api/readiness/_shared/route-adapter.ts`,
`src/app/api/readiness/export/route.ts`,
`src/components/piling/to/readiness/authoritative-presentation.ts`,
`src/components/piling/to/readiness/readiness-labels.ts`,
`src/components/piling/to/readiness/api/contracts.ts`,
`src/components/piling/to/readiness/screens/{permits-screen,permit-role-steps}.tsx`,
`src/components/piling/to/readiness/settings/audit-labels.ts`,
`src/components/piling/dashboard-attention-items.ts`.
Тесты читались для понимания замысла: `application/__tests__/scheduler.test.ts`,
`application/permits/commands.test.ts`, `commands-lifecycle.test.ts`, `readiness-score.test.ts`.

## Находки

| # | severity | статус | path:line | проблема | сценарий | исправление |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО | `src/modules/readiness/application/permits/commands.ts:241` + `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:268` | Ручное закрытие не смотрит на `validTo`: ветка close проверяет только `validFrom<=closedAt` и `state='APPROVED'`, а `repository.close` жёстко пишет `closeReason:'WORK_DONE'` (:270). | Воркер не тикал (остановлен/деплой) → согласованный наряд уже просрочен (`validTo<=now`), но ещё `APPROVED`. Пользователь открывает фильтр «Просроченные» и жмёт «Закрыть наряд» (кнопка есть: `permits-screen.tsx:303,324`). В документе и в расчёте готовности причина будет «закрыт после работ», а не «срок вышел». | Если `beforeRow.validTo <= closedAt` — писать `VALIDITY_ELAPSED` (или отказывать 422 «срок истёк, оформите новый» и не показывать кнопку закрытия для просроченных). |
| 2 | мелочь | ПРОЙДЕНО | `src/app/api/readiness/export/route.ts:74-78` | CSV-выгрузка нарядов отдаёт только `state`; `closedAt`, `closedById`, `closeReason` и комментарий в файл не попадают. | Инженер ОТ выгружает реестр нарядов для разбора/отчётности и не может из файла понять, кто, когда и почему закрыл наряд. | Добавить в заголовок и строки столбцы «Закрыт», «Кто закрыл», «Причина закрытия». |
| 3 | мелочь | ПРОЙДЕНО | `src/components/piling/to/readiness/screens/permits-screen.tsx:303,320` | Карточка/реестр показывают состояние (`Закрыт`; для `VALIDITY_ELAPSED` — «Закрыт по сроку»), но не `closedAt`/`closedById` и не текст комментария; API (`serializePermit`) комментарий тоже не отдаёт (`commands.ts:43-44`). | Пользователь видит «Закрыт», но не видит, кто закрыл и когда, и не видит причину из диалога — это доступно только в ленте аудита. | Добавить в журнал наряда строку «Закрыт · кто · когда · комментарий» (комментарий придётся вернуть из аудита или хранить в столбце). |
| 4 | мелочь | ПРОЙДЕНО | `prisma/schema.prisma:1505` vs `:1518` и комментарий `:1483` | `closedById` — просто `String?` без relation/FK, тогда как соседний `revokedById` имеет FK (`revoker User? @relation("WorkPermitRevokedBy", ...)`). Комментарий утверждает, что FK «намеренно нет — как у authorId и revokedById рядом», но у обоих FK есть. | Замысел «actor-id без FK» задокументирован неверно; `authorId` и `revokedById` уже с FK. Изоляции это не грозит: значение `closedById` берётся из контекста (`context.actorId`) и других тенантов достать не может. | Либо привести `closedById` к тому же виду (relation), либо поправить комментарий, чтобы он не расходился с фактическими связями. |
| 5 | мелочь | ПРОЙДЕНО | `src/modules/readiness/domain/capability-defaults.ts:32,64,65-74,107-118,128-135` + `src/modules/readiness/application/permits/commands.ts:219` | `readiness.permit.edit` (нужен для close) есть у ADMIN, MECHANIC, SAFETY_ENGINEER, но не у DISPATCHER, который ведёт согласование (`approve_dispatcher` есть только у него). | Диспетчер согласует наряд, но закрыть его не может; закрывает механик/инженер ОТ. Соответствует подписи на экране, но неочевидно и может читаться как дефект прав. | Подтвердить у владельца, что это замысел; при желании — вынести отдельное право `readiness.permit.close`. |
| 6 | мелочь | ГИПОТЕЗА | `src/components/piling/to/readiness/authoritative-presentation.ts:361-379` | `readinessFactsFromSnapshot` перечисляет поля вручную и не копирует `permitCloseReason`, хотя у `AuthoritativeReadinessFacts` поле есть (`domain/evaluation/facts.ts:6`). | Сейчас не проявляется: предпросмотр правил (`authoritativeFactsForEquipment`) считает балл, а `computeReadinessScore` это поле не читает. Но при добавлении поля в сам `ReadinessFacts` расхождение станет молчаливым — ровно тот класс ошибок, о котором предупреждает комментарий функции. | Добавить `permitCloseReason: facts.permitCloseReason ?? null` в возвращаемый объект либо явно зафиксировать тестом, что поле намеренно не переносится. |

**Проверено без замечаний (свидетельства):**

- **Гонки (вопрос 1).** `close` — `updateMany` с CAS по `tenantId+id+version+state='APPROVED'+validFrom<=closedAt`
  (`work-permit-repository.ts:265-274`); при `count!==1` бросается 409. `revoke`/`approve` меняют строку
  под теми же условиями, поэтому одновременные close+approve и close+revoke разрешают ровно одного. Версия
  проверяется и до CAS по `If-Match`/`expectedVersion` (`commands.ts:220-221,234`). Идемпотентность — обязательный
  ключ (`runCommand`→`requireIdempotencyKey`, `commands.ts:105,225`), повтор отдаёт сохранённый ответ.
  Отдельный `lockForApproval` у close не нужен — CAS защищает строку сам.
- **Планировщик и воркер (вопрос 2).** `scheduler.ts:130-166` отбирает `state in ('APPROVED','PENDING_APPROVAL')`
  и `validTo<=now`, пишет `CLOSED`/`VALIDITY_ELAPSED` или `EXPIRED`, каждый переход — CAS с проверкой версии;
  при проигрыше CAS (`count!==1`) `continue` без аудита. Уже закрытые/истёкшие не переотбираются (тест
  `scheduler.test.ts:153`). Сравнение по `validTo` (timestamptz) — не зависит от пояса и суток; после простоя
  воркера ближайший тик закрывает всё накопившееся. Воркер (`workers/unified-worker/readiness-scheduler.ts:34-45`)
  идёт `forEachTenant`, лидера не выбирает — идемпотентность обеспечена CAS, не блокировкой.
- **Полнота перечислений (вопрос 3).** Найдены и согласованы: `types.ts:2`, `transitions.ts:4-12,14-21`, `schemas.ts:75-78`,
  `queries.ts:8`, `serializePermit` (`commands.ts:43-44`), `readiness-labels.ts:24-31`, `contracts.ts:139-142`,
  `readiness-score.ts:75,80,197-200`, `evaluator.ts:80-85`, `permit-role-steps.ts:18-35`,
  `dashboard-attention-items.ts:40-55`, `permits-screen.tsx:59,100-102,144-154,303,320,431-439`,
  `audit-labels.ts:51,139`. Уведомления состояния наряда не перечисляют вовсе; вне контура готовности ссылок
  на `WorkPermit`/`PENDING_APPROVAL` нет (поиск дал пусто). Пробел — только выгрузка (находка №2).
- **Права и журнал (вопрос 4).** Право на close — `readiness.permit.edit` (`commands.ts:219`), в UI та же гайка
  `entities.permit.edit` (`bootstrap-query.ts:268`). Аудит пишет действие `work-permit.closed`
  (`commands.ts:248` → `audit-labels.ts:51`), актора `{id,name,role,actingAs}` (`append-audit.ts:34-39`) и
  `metadata.comment` (`commands.ts:307`; `comment` не маскируется — `mask.ts:7-11`). Планировщик пишет
  `work-permit.closed`/`work-permit.expired` с системным актором `{id:null,...}` (`scheduler.ts:39,148-165`).
- **RLS (вопрос 5).** Политика `WorkPermit` создаётся как `FOR ALL USING ("tenantId" = current_setting('app.current_tenant', true))`
  (`20260813030000_readiness_rls_fail_closed/migration.sql:48`), `ENABLE`+`FORCE RLS` (:53-54). Политика табличная,
  поэтому новые столбцы наследуют её без отдельной миграции; `closedById` без FK не создаёт пути утечки через join.
  Все чтения/записи наряда идут с `tenantId` строгим равенством (`work-permit-repository.ts:134,176,268`),
  планировщик — внутри `withReadinessTenantTransaction`. Ветки `tenantId IS NULL OR` нет.
- **Ловушка вложенного `Prisma.sql`.** Путь закрытия сырой SQL не пишет (`close` — Prisma `updateMany`),
  поэтому известный дефект Turbopack 22P02 этими коммитами не затронут. `$queryRaw` встречается рядом лишь в
  `lockForApproval` (:222) — тегированный, с параметрами.

## Не проверено

- **Не запускал код и тесты.** Изменение этого задания — только markdown-файл, поэтому `tsc`/`lint`/`test`/`build`
  и `playwright --list` не запускались; поведение разобрано статически по коду и тестам.
- **Миграция на живой БД.** Не применял `20261015090000_work_permit_close` и не проверял фактическую
  видимость новых столбцов под чужим тенантом: доступа к БД нет (AGENTS.md запрещает `.env*` и прод).
  Вывод о RLS — из текста политики, а не из эксперимента.
- **Поведение при нескольких репликах воркера.** Не измерял, пересекаются ли тики на реальном развёртывании;
  вывод «двойной прогон безопасен» опирается на CAS, а не на нагрузочный прогон.
- **Достижимость находки №1 на проде.** Окно, в котором просроченный, но не сметённый `APPROVED`-наряд
  показывается под фильтром «Просроченные», зависит от аптайма воркера и часового интервала
  (`READINESS_SCHEDULER_INTERVAL_MS`); на живых данных не замерял.
- **`SAFETY_ENGINEER` как актор закрытия.** По коду право есть, но пользователей этой роли нет по замыслу
  (админ действует «как»), поэтому реальное закрытие идёт от ADMIN/MECHANIC — на стенде не проверял.
- **Сгенерированный клиент.** `src/generated/**` не открывал: он перезаписывается `npm run db:generate`.
  Наличие полей `closedAt/closedById/closeReason` в типах клиента следует из `schema.prisma`.
- **Прочие экраны и документы.** Полноту отображения причины закрытия в справке/README и в печатных формах
  наряда не проверял — в этой теме их не искал.
