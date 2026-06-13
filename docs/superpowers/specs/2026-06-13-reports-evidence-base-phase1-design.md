# Отчёты как доказательная база (Фаза 1) — дизайн

**Дата:** 2026-06-13
**Статус:** утверждён к реализации
**Скоуп:** Фаза 1 — сделать «Историю изменений» настоящей (реальный провенанс из БД) + завершить шелл (статус, счётчик фото). Приёмка, доп.фильтры, восстановление версий — Фаза 2.

## Проблема

Экран отчётов уже визуально пересобран в «журнал смен» с правым evidence-pane (несохранённые изменения в `admin-reports.tsx`, +841 строка). Но ключевой для доверия блок — **«История изменений» — нарисован, а не настоящий**: массив `auditItems` в `ReportEvidencePreview` захардкожен из `createdAt`/`updatedAt`/`lastEditedByName`. Реальный неизменяемый след `ReportAudit` (кто/что/diff/время/хэши) не читается. Отчёт ещё не является «документом с происхождением».

## Что уже есть (не трогаем, переиспользуем)

- **UI журнала** (`src/components/piling/admin-reports/admin-reports.tsx`): верхний блок статов `EvidenceSummary`, быстрые фильтры, плотная таблица `EvidenceReportRow`, правый `ReportEvidencePreview`, курсорная пагинация, период, фильтры объект/установка/оператор.
- **Данные в БД**: `ReportAudit` (`reportId, actorId, actorName, actorRole, action, diff {added,removed,changed}, beforeHash, afterHash, ipAddress, requestId, createdAt`) — пишется через `writeReportAuditRow`/`computeDiff` (`src/services/reports/audit-service.ts`). `ReportVersion` (`reportId, version, data, actorId, createdAt`) — снимки версий. `Report.status` (draft/submitted/pending), `journalPhotoMediaId`.
- **Медиа API**: `GET /api/media?entityType=report&entityId=<reportId>` — уже используется в `admin-reports.tsx` для `photoReportIds`.

## Цель Фазы 1

Заменить фейковую историю реальным провенансом и завершить шелл: бейдж статуса, настоящий счётчик фото. Текущая логика отчётов остаётся; меняется только источник истории + два мелких отображения.

## Рабочий процесс (контекст, не требует нового кода)

Оператор отправляет отчёт (`submitted`). Админ при необходимости сверяет и корректирует его — правка уже работает (admin-upsert) и уже пишет след в `ReportAudit` (кто правил и что именно). Отдельного действия «приёмки» и состояния «На проверке» в процессе нет: доверие обеспечивается не статусом-печатью, а **видимым следом корректировок** — то есть ровно той историей, которую делает настоящей Фаза 1. Поэтому статусы сведены к `draft`/`submitted`, а приёмка не нужна.

## Бэкенд

### Эндпоинт `GET /api/reports/[id]/history`

- Файл: `src/app/api/reports/[id]/history/route.ts` (новый), `withApi`, `requireAuth` + `assertCan(user, 'reports.read_all')` (ADMIN/DISPATCHER).
- `[id]` — это бизнес-`reportId` отчёта. Подтверждено по коду: `ReportAudit.reportId` пишется как `input.reportId`, `ReportVersion.reportId` — как `state.reportId` (оба — бизнес-`reportId`, не cuid `id`). У фронта `report.reportId` уже есть (тот же ключ используют media- и PDF-вызовы).
- Логика в новом сервисе `src/services/reports/report-history-service.ts`:
  - `getReportHistory(reportId)` →
    - `events`: `db.reportAudit.findMany({ where: { reportId }, orderBy: { createdAt: 'desc' } })` → `{ id, action, actorName, actorRole, diff, createdAt }`
    - `versions`: `db.reportVersion.findMany({ where: { reportId }, orderBy: { version: 'desc' }, select: { version, actorId, createdAt } })`
  - Возврат: `{ events, versions }`.
- Ответ роута: `NextResponse.json({ events, versions })`. Ошибки `ServiceError` маппит `withApi`.

### Маппинг action → русская метка (чистая функция, тестируемая)

`actionLabel(action: string): string` в `report-history-service.ts`:
- `created` → «Создан», `updated` → «Изменён», `submitted` → «Отправлен», `deleted` → «Удалён», иначе — само значение.

## Фронтенд

### Хук истории `useReportHistory(reportId)`

- Новый файл `src/components/piling/admin-reports/use-report-history.ts`.
- При смене `reportId` грузит `/api/reports/<reportId>/history`; состояния `{ events, versions, loading, error }`; отменяет предыдущий запрос (AbortController).
- Тип `ReportHistoryEvent = { id, action, actorName?, actorRole?, diff?, createdAt }`.

### `ReportEvidencePreview` — реальная история

- Убрать захардкоженный `auditItems`.
- Хук вызывается в `AdminReports` для `previewReport?.reportId`; `events/loading/error` передаются в `ReportEvidencePreview` пропсами (pane остаётся презентационным, без собственного фетча).
- Рендер блока «История изменений»:
  - состояние загрузки (скелетон строки), пусто («Событий пока нет»), ошибка («Не удалось загрузить историю» — не молчком).
  - каждое событие: иконка по `action`, метка (`actionLabel`), кто (`actorName` + русская роль через существующий маппинг ролей), когда (`formatIsoDateTime(createdAt)`).
  - у событий с непустым `diff` — кнопка-раскрытие; в раскрытии список «поле: было → стало», собранный из `diff.changed`/`added`/`removed`. Имена полей — через небольшой словарь меток (status, piles, drillings, downtimes, shiftStart, shiftEnd…); неизвестные поля показываются как есть.

### Бейдж статуса

- Маппер `statusLabel(status)`: draft→«Черновик», submitted→«Отправлен»; иначе — само значение. Цвет бейджа по статусу. Отдельного состояния «На проверке»/приёмки нет (см. «Рабочий процесс»).
- Колонка «Статус» в `EvidenceReportRow` (между оператором и метриками или в действиях — по месту) и строка статуса в шапке `ReportEvidencePreview`. Только показ.

### Настоящий счётчик фото

- `photoReportIds` (есть) даёт булево «есть фото» по каждому отчёту. Для верхнего блока «Фото» считать число отчётов с фото среди `filteredReports` (или сумму, если media API отдаёт count — использовать count, если доступен, иначе «N со фото»).
- Заменить заглушку `value: '-'` / `photoCount: 0` на реальное число; убрать текст «счётчик нужен из API».

## Тесты

- **report-history-service** (unit, мок `db`): `getReportHistory` возвращает events (desc) + versions; `actionLabel`/`statusLabel` мапят значения, включая неизвестное.
- **Роут** `reports/[id]/history` (unit): `403` для OPERATOR; `200` с `{ events, versions }` для ADMIN; делегирование в сервис с правильным `reportId`.
- **Фронт diff-рендер** (если по силам в текущей инфре) — иначе ручная проверка: событие `updated` с `diff.changed` показывает «поле: было → стало».

## Вне скоупа (Фаза 2)

- Приёмка как отдельное действие/статус — не нужна (см. «Рабочий процесс»).
- Фильтр «Без PDF» (PDF нигде не хранится — нужен учёт генераций) и «Исправленные» (`version>1`). Фильтр «На проверке» **не делаем вовсе** — состояния проверки в процессе нет.
- Восстановление/сравнение версий из `ReportVersion.data`.

## Затрагиваемые файлы

- Новые: `src/app/api/reports/[id]/history/route.ts`, `src/services/reports/report-history-service.ts`, `src/components/piling/admin-reports/use-report-history.ts`, тесты к ним.
- Изменяемые: `src/components/piling/admin-reports/admin-reports.tsx` (реальная история в `ReportEvidencePreview`, бейдж статуса, счётчик фото).
