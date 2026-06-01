# Модуль ТО — P1b: Интерфейс нарядов (Work Orders UI)

**Дата:** 2026-06-01
**Статус:** дизайн утверждён, готов к плану реализации
**Предшественник:** P1a (бэкенд нарядов) — в `main`, не задеплоен.
**Родительский спек Фазы 1:** `docs/superpowers/specs/2026-05-31-maintenance-module-phase1-design.md` (§7).

---

## 1. Цель

P1a дал бэкенд нарядов (поля, статусы, приоритет, `listAllMaintenance`, `GET /api/maintenance`).
P1b даёт **видимый интерфейс**, закрывающий боли «непонятно кто и что делает» и «техники в поле
неорганизованы»: глобальная доска нарядов, полноэкранная страница наряда (сценарий «техник в поле»),
загрузка фото, и приведение существующей вкладки ТО к новым полям/статусам.

Попутно P1b **закрывает находку ревью P1a**: существующий `equipment-maintenance.tsx` имеет
локальную карту из 4 статусов — записи в `ASSIGNED`/`ON_HOLD` рендерят пустой бейдж. Переводим его
на общий источник лейблов.

### Решения брейншторма
- Доска — **список с фильтрами** (не kanban): совпадает со стилем приложения, mobile-friendly, проще.
- Наряд — **отдельная страница** `/admin/maintenance/[id]` (не диалог/drawer): полноэкранный сценарий
  для телефона в поле, прямая ссылка.
- Исполнитель — **структурированный выбор пользователя** (не свободный текст): нужен для будущих
  уведомлений «назначено на вас» (§5 родительского спека, P3).

### Вне P1b (дорожная карта)
Чек-листы (P4), PM-планировщик и блоки «приближается/просрочено» (P3), KPI-дашборд (P5).
Удаление `VIBRO_HAMMER` — отдельная отложенная задача.

---

## 2. Маршруты и навигация

- `/admin/maintenance` — доска нарядов. Страница: `src/app/(app)/admin/maintenance/page.tsx`.
- `/admin/maintenance/[id]` — страница наряда. Страница: `src/app/(app)/admin/maintenance/[id]/page.tsx`.
- Навигация: пункт **«Обслуживание»** (`href: '/admin/maintenance'`) добавляется в массивы `ADMIN` и
  `DISPATCHER` в `src/app/(app)/layout.tsx` (роли с `maintenance.manage`). Размещение — после «Установки».

Серверная защита уже обеспечена: все maintenance-эндпоинты гейтятся `maintenance.manage`.

---

## 3. Бэкенд-добавки (небольшие, в составе P1b)

### 3.1 `getMaintenanceById` + `GET /api/maintenance/[id]`
Для страницы наряда (прямая ссылка / обновление).
- Query `getMaintenanceById(id: string, tenantId: string)` в `equipment-query.service.ts`: fail-closed
  на пустой `tenantId` (как `listAllMaintenance`); `findUnique` строго по `{ id }`, затем проверка
  `record.tenantId === tenantId` (иначе `ServiceError('Maintenance record not found', 404)`); `include`
  equipment `{ id, name, model }`. Экспорт из `src/modules/equipment/index.ts`.
- Роут `GET /api/maintenance/[id]` через `withApi`, `assertCan('maintenance.manage')`, `{ domain: 'equipment.maintenance' }`. Возвращает `{ record }`.
- Юнит-тест: tenant-scoping (свой → ок, чужой → 404, пустой tenantId → throw).

### 3.2 `GET /api/maintenance/assignees`
**Зачем отдельный эндпоинт:** `GET /api/users` гейтится `users.manage` = только ADMIN; DISPATCHER
(имеет `maintenance.manage`) получил бы 403 при подборе исполнителя. Поэтому — минимальный список под
`maintenance.manage`.
- Query `listAssignableUsers(tenantId: string)` в `src/modules/users` (рядом с `listUsers`): возвращает
  активных пользователей тенанта `{ id, name, role }`, отсортированных по имени. Tenant-scoped строгим
  равенством, fail-closed на пустой `tenantId`.
- Роут `GET /api/maintenance/assignees` через `withApi`, `assertCan('maintenance.manage')`,
  `{ domain: 'equipment.maintenance' }`. Возвращает `{ users }`.
- Юнит-тест: tenant-scoping + только активные.

### 3.3 Существующие эндпоинты (без изменений)
- `GET /api/maintenance` — список для доски.
- `GET /api/equipment/[id]/maintenance` — список для вкладки машины.
- `POST /api/equipment/[id]/maintenance`, `PUT/DELETE …/[recordId]` — создание/правка/закрытие наряда
  (наряд принадлежит машине; equipmentId известен из записи). Новый mutation-эндпоинт не нужен.
- `/api/media` (presign→PUT→confirm) — фото.

---

## 4. Компоненты (`src/components/piling/maintenance/`)

### 4.1 `maintenance-labels.ts` — единый источник правды
Лейблы и стили: `TYPE_LABEL`, `STATUS_LABEL`, `STATUS_STYLE` (все 6 статусов
PLANNED/ASSIGNED/IN_PROGRESS/ON_HOLD/DONE/CANCELLED), `PRIORITY_LABEL`, `PRIORITY_STYLE`
(LOW/NORMAL/HIGH/CRITICAL). Реэкспортирует типы `MaintenanceStatus`/`MaintenancePriority`/`MaintenanceType`
из `@/modules/equipment` (никаких локальных дублей). Чистый модуль без JSX — пригоден для юнит-теста на полноту карт.

### 4.2 `maintenance-board.tsx`
- Self-fetch `GET /api/maintenance` (+ query-параметры фильтров).
- Фильтры: статус, приоритет, исполнитель, тип (shadcn Select). Построение query-строки — извлекаемая
  чистая функция `buildMaintenanceQuery(filter)` (юнит-тест).
- Имена исполнителей: один fetch `GET /api/maintenance/assignees`, map `id→name` (у `assigneeId` нет FK,
  Prisma-join невозможен). Извлекаемая чистая функция `resolveAssigneeName(id, map)` (юнит-тест).
- Каждая строка: индикатор приоритета, название, машина, статус-бейдж, исполнитель, дата → `Link` на
  `/admin/maintenance/[id]`.
- Кнопка «Новый наряд» → `work-order-form-dialog` (создание, с выбором машины).
- Состояния loading/empty/error в стиле приложения (`toast.error` на ошибке fetch).

### 4.3 `work-order-detail.tsx`
- Принимает `recordId`; self-fetch `GET /api/maintenance/[id]`.
- Шапка: название, машина (ссылка на карточку машины), тип, бейдж приоритета.
- Быстрые действия «в поле»: смена статуса по жизненному циклу (видимость кнопок — извлекаемая чистая
  функция `nextStatusActions(status)`, юнит-тест), ввод `startedAt`/`laborHours`/`cost`/`faultCause`/
  `partsUsedText`/`assigneeId` — все через `PUT /api/equipment/[id]/maintenance/[recordId]`.
- Фото: `work-order-photos`.
- «Полное редактирование» → `work-order-form-dialog` (правка).
- BackLink на `/admin/maintenance`.

### 4.4 `work-order-form-dialog.tsx`
Переиспользуемый диалог создания/правки. Поля: тип, статус, приоритет (select), название*, исполнитель
(select из `/api/maintenance/assignees`, опция «— не назначен —»), плановая/фактическая дата, моточасы,
трудозатраты, стоимость, причина отказа, запчасти (текст), описание. При создании **с глобальной доски** —
дополнительно select машины (`GET /api/equipment` каталог); на вкладке машины и при правке `equipmentId`
фиксирован. Payload-mapping (пустая строка → null) — как в текущей форме. Реюзается доской, страницей наряда
и вкладкой машины.

### 4.5 `work-order-photos.tsx`
Зеркало `EquipmentPhotos`: presign→PUT→confirm на `/api/media`, `entityType='maintenance'`,
`entityId=recordId`; галерея thumbnail + загрузка + удаление. До 10 МБ, image/*.

---

## 5. Рефактор `equipment-maintenance.tsx`

- Перейти на `maintenance-labels.ts` (удалить локальные `MaintenanceType/Status` + карты) → чинит пустой
  бейдж для ASSIGNED/ON_HOLD.
- Добавить бейдж приоритета и отображение исполнителя (резолв имени через `/api/maintenance/assignees`).
- Строки списка → `Link` на `/admin/maintenance/[id]`.
- Заменить локальный диалог на общий `work-order-form-dialog` (equipmentId фиксирован) — убрать дублирование.
- Существующие быстрые статус-кнопки сохранить (или делегировать общей логике `nextStatusActions`).

---

## 6. Тестирование

- **Бэкенд:** юнит-тесты на `getMaintenanceById` и `listAssignableUsers` (tenant-scoping, fail-closed) —
  по образцу тестов P1a (`vi.hoisted` + мок `@/lib/db`).
- **Чистая UI-логика (извлечь и протестировать):** `buildMaintenanceQuery`, `resolveAssigneeName`,
  `nextStatusActions`, полнота карт в `maintenance-labels.ts`.
- **Интерактивный UI:** проверка в живом приложении (навык `run`/playwright) ключевых сценариев: открыть
  доску → фильтр → создать наряд → открыть страницу → сменить статус → загрузить фото → правка. Полноценной
  интеграционной UI-инфраструктуры в проекте нет (по памяти) — отмечаем как ограничение.
- **Регресс:** `npx tsc --noEmit` и `npx eslint` по затронутым областям; полный `npx vitest run` зелёный.

---

## 7. Файловая структура (итог)

Новые:
- `src/app/(app)/admin/maintenance/page.tsx`
- `src/app/(app)/admin/maintenance/[id]/page.tsx`
- `src/app/api/maintenance/[id]/route.ts`
- `src/app/api/maintenance/assignees/route.ts`
- `src/components/piling/maintenance/maintenance-labels.ts`
- `src/components/piling/maintenance/maintenance-board.tsx`
- `src/components/piling/maintenance/work-order-detail.tsx`
- `src/components/piling/maintenance/work-order-form-dialog.tsx`
- `src/components/piling/maintenance/work-order-photos.tsx`
- тесты под `__tests__/` для бэкенд-функций и извлечённой UI-логики

Изменяемые:
- `src/modules/equipment/application/queries/equipment-query.service.ts` (+ `getMaintenanceById`)
- `src/modules/equipment/index.ts` (экспорт)
- `src/modules/users/*` (+ `listAssignableUsers`, экспорт)
- `src/app/(app)/layout.tsx` (пункт меню «Обслуживание» в ADMIN и DISPATCHER)
- `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx` (рефактор на общие компоненты/лейблы)

---

## 8. Открытые риски / заметки
- `assigneeId`/`closedById` — без FK (по решению P1a). Имена резолвим клиентски через assignees-эндпоинт;
  «битый» id просто отрендерит пустого исполнителя — приемлемо. Валидацию `assigneeId` против списка
  пользователей тенанта при сохранении можно добавить позже (когда придут уведомления, P3).
- Точные сигнатуры `src/modules/users` (`listUsers`) и каталога `GET /api/equipment` уточняются при
  написании плана чтением этих файлов.
