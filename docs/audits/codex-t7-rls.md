# G1 — оставшиеся таблицы RLS, 03.10.2026

## Фактическое состояние

В выделенном `codex-pg-bdf0dfc194ca` после всех исходных миграций обнаружены
76 строгих политик, **ноль политик в режиме аудита** и восемь таблиц без RLS.
Числа 46 и «около 19 audit» из задания относятся к прежнему состоянию.
Два новых кандидата имеют проверяемый путь принадлежности организации:
`BriefingRecord` и `FeedbackEventRead`. После обеих миграций ожидаются
78 строгих политик, ноль audit и шесть осознанно оставленных таблиц без RLS.
Живое состояние и полный прогон фиксируются в `CODEX-REPORT-T7.md`.

## Все восемь исходных исключений

| Таблица | Организация и реальные пути | Решение G1 |
|---|---|---|
| BriefingRecord | Обязательный tenantId; составной FK `(tenantId,userId)` к User. Проводит инструктаж `safety/application/briefing-commands.ts:83`; история ознакомления и проверки знаний — `operator-mobile/application/commands/admission.ts:105`. | Строгая прямая политика, ENABLE + FORCE. |
| FeedbackEventRead | Обязательный userId с FK к User; организация получателя определяется через User.tenantId. Маркеры чтения/подтверждения создаются только авторизованным получателем. | Строгая EXISTS-политика через User, ENABLE + FORCE. Глобальный FeedbackEvent не сужается. |
| DeadLetterQueue | tenantId появился позже и допускает NULL для старых/инфраструктурных записей. `core/outbox/dead-letter-queue.ts`: moveToDlq пишет после ошибки обработчика, retry работает с глобальной записью и восстанавливает tenantId события; getStats/getPending/discard работают по всей очереди. `/api/admin/dlq` проверяет dlq.manage. | Не переключать: ошибка ловится уже после выхода из tenant-контекста обработчика; strict молча обнулит глобальную диагностику и остановит DLQ-запись. Нужна отдельная организация доступа инфраструктуры и совместимая обработка NULL. |
| OutboxEvent | tenantId допускает NULL. Атомарные записи из repositories reports/equipment/sites/crews, inspection/readiness commands, durable-alert, webhook alerts; чтение всей очереди и claim/retry — `services/reports/outbox-publisher.ts`. | Не переключать: обе очереди потребителей и метрики должны видеть события всех организаций до установки контекста конкретного события. Нельзя выдавать runtime полный BYPASSRLS ради одной очереди. |
| IdempotencyKey | tenantId nullable; новая живая command-pipeline repository использует tenantId/scope/key; `core/security/idempotency.ts:22` удаляет просроченные ключи глобально. Схема сохраняет legacy global scope/key и nullable поля. | Не переключать одной политикой: глобальная очистка перестанет работать, нужен анализ старых NULL и отдельное ограниченное решение для housekeeping. Старый комментарий про проверку до auth уже не описывает текущие удалённые helpers. |
| Tenant | Собственный id, tenantId отсутствует. `lib/tenant-iteration.ts:23` перечисляет действующие организации перед открытием отдельного контекста каждой; `scripts/backfill-tech-readiness.ts` использует такой же реестр. | Не переключать на id=GUC: все фоновые задачи потеряют список организаций до установки GUC. Отдельно решить разрешённое чтение реестра и биллинг. |
| FeedbackEvent | Нет tenantId; actorId/targetId — снимки/универсальные идентификаторы без единого FK. `services/feedback/feedback-event-service.ts:112` пишет события, `services/audit/audit-service.ts:959` пишет аудит; в том числе фоновые/неуспешные auth-события без пользователя. ALL — платформенная аудитория; ADMIN/DISPATCHER читают общую ленту by design. | Не назначать организацию по actorId: безличные и платформенные события потеряются, а audience ALL изменит смысл. Нужна явная классификация tenant/platform событий. |
| _prisma_migrations | Служебный журнал Prisma, бизнес-организации нет. | Без RLS; приложение уже не имеет SELECT и DDL-доступа, это проверяет disposable-rls.spec.ts. |

## BriefingRecord: все живые пути

- `conductBriefing`: обязательный tenantId, выбор работника по tenantId/id,
  снимок имени/роли и tenantId в create. Маршрут `/api/briefings` использует
  withMutation и requireAuth. Глобальный `db` доставляет GUC на одиночную
  операцию через `applyTenantGuc` (`src/core/security/tenant-rls.ts`).
- `signBriefingRecord`: findFirst по id/tenantId, проверка работника или
  инструктора; update по найденному id. Строгая политика закрывает UPDATE,
  если контекст организации отсутствует или изменился.
- `acknowledgeBriefing` и `submitKnowledgeTest` вызывают
  `recordBriefingHistory` с tenantId. Они выполняются в
  `withReadinessTenantTransaction`: set_config(..., true) и проверка GUC
  до callback (`modules/readiness/infrastructure/tenant-transaction.ts`).
  Создание истории не зависит от ambient HTTP-контекста.
- Чтения: `safety/application/self-clearance-query.ts` (история и требования),
  `clearance-overview-query.ts` (сводка/счётчики),
  `operator-mobile/application/briefing-journal-query.ts` (журнал/печать).
  Все фильтруют tenantId; HTTP-контекст ставится requireAuth.
- Поиск `briefingRecord`/`BriefingRecord` по src, prisma, scripts, tests, e2e
  не выявил бизнес-записей из воркеров, outbox/projection, seed или scheduler.
  Прямые записи есть в одноразовых owner-fixtures интеграции и Playwright;
  они предназначены для подготовки собственного стенда и обходят RLS
  ролью владельца, а сценарии проверяются ролью приложения.

## FeedbackEventRead: принадлежность получателю

Единственные живые записи — `markFeedbackEventState` (upsert:220) и
`markAllFeedbackEventsRead` (upsert:261) в
`src/services/feedback/feedback-event-service.ts`.
Обе устанавливают userId из переданного авторизованного user.id.
Чтения вложенного `reads` находятся в `listFeedbackEventsForUser`:152 и
повторном чтении после mark:238, оба с where userId=user.id.
Прямых чтений/агрегатов FeedbackEventRead из workers, scheduler или
административной общей статистики поиск не обнаружил.

Маршрут `/api/feedback/events` вызывает requireAuth. Он всегда ставит
GUC-контекст фактической организации пользователя (`src/lib/auth.ts:199`);
actingAs меняет роль, но не организацию. applyTenantGuc доставляет GUC
к каждому Prisma-запросу. Политика ограничивает read-state получателя,
поэтому платформенный ADMIN по-прежнему видит все FeedbackEvent,
а его отметки чтения остаются в собственной организации.
Фоновые recordAuditEvent пишут FeedbackEvent, а не FeedbackEventRead.

Строгая политика с EXISTS по User также проверяет User RLS. Поддельный
userId другой организации не пройдёт WITH CHECK (неявно тот же USING).
Пустой или отсутствующий GUC закрывает чтение и вставку.

## Новые миграции и воспроизводимые тесты

- `20261004000000_briefing_record_rls`: политика по обязательному tenantId.
  Тесты расширяют существующий disposable-rls.spec.ts; результаты в отчёте.
- `20261004001000_feedback_event_read_rls`: политика через FK получателя,
  без изменения schema.prisma и бизнес-данных.
  Новый `tests/integration/disposable-feedback-rls.spec.ts` сначала показал
  **5 failed / 2 passed**, exit 1, на реальном PostgreSQL: чужие read-state
  были видны/изменяемы, INSERT проходил без GUC/для чужого получателя.
  Миграция на собственной базе: exit 0. GREEN: **7 passed / 0 skipped**,
  exit 0. Полный прогон — в отчёте.

Новый spec проверяет NOBYPASSRLS, общий ALL-event с изолированными отметками,
UPDATE/DELETE чужой строки (0), INSERT чужой строки (42501), отсутствие и
пустой GUC, INSERT/ack собственного получателя. Новых пользователей/событий
в рабочих базах не создаётся; fixture чистит данные собственной базы.

## GitNexus и ограничения доказательств

Impact FeedbackEventRead через shared launcher сначала неожиданно начал
bootstrap (`Packages: +249`, к прерыванию downloaded 3 / added 4).
Это ошибка вызова: процесс остановлен Ctrl+C (exit 1); shared cache не
удалялся, установка не продолжалась. Вызов повторён с
`GITNEXUS_INVOCATION=gitnexus`, исключающим bootstrap: установленный CLI
недоступен (`'gitnexus' is not recognized...`). Graph impact не получен.
`git diff --numstat -- package.json package-lock.json` пуст.
Использован разрешённый наследуемыми правилами THREAD5 fallback:
поиск всех callers в src/tests/e2e/scripts/prisma и чтение FK/GUC-путей.
Это текстовое доказательство, не успешный graph-check.

Миграции требуют решения владельца перед выкладкой. SQL prechecks,
порядок и адресный rollback описываются в runbook 012. Миграции G1
не выполнялись на production; prod/секреты/.env не читались.
