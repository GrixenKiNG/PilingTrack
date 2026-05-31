# Модуль ТО (Техническое обслуживание) — Фаза 1: ядро CMMS

**Дата:** 2026-05-31
**Статус:** дизайн утверждён, готов к плану реализации
**Тенант:** Orion (single-tenant), телеметрия спит до подключения железа

---

## 1. Контекст и цель

PilingTrack уже имеет «скелет» CMMS: карточку техники (`Equipment` с моточасами и
полями `nextMaintenanceAtHours`/`nextMaintenanceDate`), журнал `MaintenanceRecord`,
документы `EquipmentDocument`, аналитику парка. Но это **реактивный журнал** — записи
постфактум. Система не напоминает о ТО, не отслеживает наряды от заявки до закрытия,
не структурирует работу техников и не даёт KPI руководству.

**Цель Фазы 1** — превратить журнал в **проактивную систему ТО уровня MaintainX/Limble**,
работающую на ручных данных уже сегодня и готовую принять телеметрию в Фазе 2 без
переделки. Закрывает 4 подтверждённые боли:
1. Забываем про ТО вовремя → PM-планировщик + уведомления.
2. Непонятно кто и что делает → Work Orders с исполнителем и статусами.
3. Техники в поле неорганизованы → чек-листы/регламенты + фото из поля.
4. Нет цифр для руководства → KPI-дашборд.

### Решения, зафиксированные на брейншторме
- **Без иерархии узлов** в Фазе 1. Наряды/ТО привязаны к машине целиком (MTBF по машине,
  не по агрегатам). Узлы — Фаза 2.
- **Источник моточасов — журнал показаний** (`MeterReading`), не одно поле. Даёт историю,
  скорость наработки/день и прогноз даты ТО. В Фазе 2 туда же пишет телеметрия.
- **Без новой роли «механик».** Исполнитель наряда — любой `User` (роли: ADMIN, DISPATCHER,
  OPERATOR, ASSISTANT). Назначают DISPATCHER/ADMIN, выполняет обычно OPERATOR.
- **Уведомления — через существующий `src/core/notifications/`** (Telegram-прокси). Новых
  каналов нет.
- **Без destructive-миграций.** Расширяем `MaintenanceRecord` добавлением полей; новые
  сущности — отдельными логическими миграциями (одна миграция = одно изменение).

### Явно ВНЕ Фазы 1 (дорожная карта Фаз 2–3)
Иерархия узлов · телеметрия/предиктив/цифровой двойник · склад запчастей ·
контракты/SLA/биллинг · offline-PWA · AI-аналитика.

---

## 2. Модель данных

### 2.1 `MaintenanceRecord` → Work Order (расширение, не пересоздание)
Добавляемые поля:

| Поле | Тип | Назначение |
|------|-----|-----------|
| `assigneeId` | String? (User) | кто исполняет наряд |
| `priority` | enum `MaintenancePriority` LOW/NORMAL/HIGH/CRITICAL (default NORMAL) | приоритет |
| `startedAt` | DateTime? | начало работ (для MTTR) |
| `laborHours` | Float? | трудозатраты |
| `faultCause` | String? | причина отказа (текст) |
| `partsUsedText` | String (default "") | израсходованные запчасти текстом — «крючок» под будущий склад |
| `closedById` | String? (User) | кто проверил/закрыл |
| `pmRuleId` | String? (MaintenancePlan) | каким PM-правилом сгенерирован наряд (null = ручной) |

**Статусы** (`MaintenanceStatus`) расширяем прагматично:
`PLANNED → ASSIGNED → IN_PROGRESS → ON_HOLD → DONE → CANCELLED`.
(VERIFIED/WAITING_PARTS не вводим — добавим при подтверждённой потребности.)

**Фото до/после** — через существующий `Media` (`entityType="maintenance"`,
`entityId = maintenanceRecord.id`), по аналогии с `EquipmentDocument`. Новой таблицы фото нет.

Индексы: существующие + `@@index([assigneeId])`, `@@index([priority])`, `@@index([pmRuleId])`.

### 2.2 `MeterReading` (новая) — журнал показаний наработки
```
id, tenantId, equipmentId, recordedAt (Timestamptz), engineHours (Int),
source (enum MeterSource: MANUAL | TELEMETRY, default MANUAL),
recordedById (String?), note (String default ""),
createdAt
@@index([tenantId]) @@index([equipmentId, recordedAt])
```
- Монотонность не форсируем жёстко, но команда предупреждает, если новое показание < предыдущего.
- Фаза 2: телеметрия пишет сюда с `source=TELEMETRY` — модель не меняется.

### 2.3 `MaintenancePlan` (новая) — PM-правило
```
id, tenantId, equipmentId, title,
triggerType (enum PmTriggerType: HOURS | CALENDAR),
intervalHours (Int?)        // для HOURS
intervalDays (Int?)         // для CALENDAR
leadTimeDays (Int default 7) // за сколько предупреждать/создавать наряд
lastDoneHours (Int?)        // моточасы последнего выполнения
lastDoneAt (DateTime?)      // дата последнего выполнения
checklistTemplateId (String?) // регламент, копируемый в наряд
isActive (Boolean default true)
createdAt, updatedAt
@@index([tenantId]) @@index([equipmentId]) @@index([isActive])
```
Валидация: `HOURS ⇒ intervalHours задан`; `CALENDAR ⇒ intervalDays задан` (на уровне Zod-схемы и команды).

### 2.4 Регламенты / чек-листы
**`ChecklistTemplate` (новая):** `id, tenantId, title, description, isActive, createdAt, updatedAt`.
**`ChecklistTemplateItem` (новая):** `id, templateId, order (Int), text, isRequired (Boolean), requiresPhoto (Boolean)`.

При создании наряда из правила пункты **копируются** (снимок) в:
**`WorkOrderChecklistResult` (новая):**
`id, maintenanceRecordId, order, itemText, isChecked (Boolean default false), note (String default ""), photoMediaId (String?)`.
Снимок гарантирует: изменение шаблона позже не искажает историю закрытых нарядов.

> Все новые сущности несут `tenantId` и проверяются строгим равенством по `tenantId`
> (железное правило проекта против IDOR — никаких `IS NULL OR tenantId`).

---

## 3. Код (архитектура `src/modules/equipment/`)

**Команды** (`application/commands/`):
- `work-order.ts` — расширяет текущий `equipment-maintenance.ts` (назначение, статусы, закрытие, фото-привязка).
- `meter-reading.ts` — добавление/правка показаний.
- `maintenance-plan.ts` — CRUD PM-правил.
- `checklist-template.ts` — CRUD шаблонов регламентов.

**Запросы** (`application/queries/`): дополняем `equipment-query.service.ts`:
- список нарядов с фильтрами (статус/приоритет/исполнитель/тип/период);
- «приближается ТО» и «просрочено» (вычисляется из активных `MaintenancePlan` + последнего `MeterReading`);
- история показаний + прогноз даты следующего ТО;
- данные для KPI-дашборда (см. §6).

**Роуты** (`src/app/api/`), все через `withApi` (GET) / `withMutation` (мутации):
- `api/equipment/[id]/maintenance/*` — расширяем (наряды по машине).
- `api/maintenance/*` — глобальный список нарядов (доска).
- `api/equipment/[id]/meter-readings` — показания.
- `api/maintenance-plans/*` — PM-правила.
- `api/checklist-templates/*` — регламенты.

---

## 4. PM-планировщик (ядро проактивности)

Периодический воркер в существующем контейнере `pilingtrack-workers`. **Простой ежедневный
тик** (cron-подобный планировщик внутри воркера), без Kafka/NATS — на одном VPS это избыточно.

Алгоритм одного прогона:
1. Для каждого активного `MaintenancePlan` вычислить «срок»:
   - **HOURS:** взять последний `MeterReading`; среднюю наработку/день за последние 30 дней;
     спрогнозировать дату достижения `lastDoneHours + intervalHours`. Если истории мало —
     fallback на текущие показания без прогноза даты (только факт «порог достигнут/нет»).
   - **CALENDAR:** `lastDoneAt + intervalDays`.
2. Если срок попадает в окно `leadTimeDays` **и** по этому правилу нет уже открытого наряда
   (дедупликация по `pmRuleId` + статус не DONE/CANCELLED) → **создать наряд**
   (`type=SCHEDULED`, `status=PLANNED`, чек-лист скопирован из `checklistTemplateId`),
   затем отправить уведомление (§5).
3. Пометить просроченные (срок прошёл, наряд не закрыт).
4. **Замыкание цикла:** при переводе наряда `type=SCHEDULED` в `DONE` обновить у правила
   `lastDoneHours` (из `engineHoursAtService`) и `lastDoneAt` (`completedAt`).

Идемпотентность: повторный прогон в тот же день не плодит дубли (дедуп шага 2).

---

## 5. Уведомления (Telegram, через `src/core/notifications/`)

Триггеры:
- «ТО приближается» — при создании планового наряда планировщиком.
- «ТО просрочено» — при переходе наряда в просроченное состояние.
- «Наряд назначен на вас» — при установке/смене `assigneeId`.
- «Создан критический наряд» — при `priority=CRITICAL`.

Канал и инфраструктура — существующие. Новых каналов (WhatsApp/SMS/Push) в Фазе 1 нет.

---

## 6. KPI-дашборд (расширяем `equipment-analytics-service`)

Метрики (период выбирается пользователем):
- **Готовность парка** (uptime) — доля времени без открытых FAULT/REPAIR-нарядов.
- **MTBF** — суммарная наработка / число отказов (FAULT + REPAIR).
- **MTTR** — среднее `completedAt − startedAt` по ремонтным нарядам.
- **Выполнение ППР** — план/факт по `SCHEDULED` (создано vs закрыто в срок).
- **Затраты** — сумма `cost` по машине / периоду; стоимость моточаса (затраты / наработку).
- **Топ проблемных машин** — по числу отказов и затратам.

Графики — Recharts (уже в стеке, см. `equipment-analytics.tsx`).

---

## 7. Интерфейс

- **Карточка техники** (`equipment-detail.tsx`): вкладки *Наряды/ТО* · *Регламенты* ·
  *Показания наработки* · *Документы* (существует).
- **Глобальный экран `/maintenance`:** доска нарядов (фильтры статус/приоритет/техник),
  блоки «Приближается ТО» и «Просрочено».
- **Экран наряда** — адаптивный/мобильный (техник в поле): чек-лист с галочками,
  загрузка фото, ввод времени/причины, закрытие.
- **Вкладка KPI** в аналитике парка.

---

## 8. Тестирование (test-first для security-critical)

Юнит-тесты:
- **Tenant-scoping** всех новых сущностей: строгое равенство по `tenantId`, отказ при
  отсутствии `tenantId` (fail-closed), проверка IDOR на чужой `equipmentId`.
- **PM-планировщик:** HOURS-прогноз (норм. история / мало истории), CALENDAR, окно `leadTime`,
  дедупликация нарядов, замыкание цикла при закрытии.
- **KPI-расчёты:** MTBF/MTTR/готовность/план-факт на фикстурах.
- **Чек-лист:** копирование шаблона в наряд (снимок неизменен при правке шаблона).

Интеграционные тесты — по наличию инфраструктуры; при нехватке — пометить.

---

## 9. Миграции (по правилам проекта)

Отдельные логические миграции (через `/create-migration`), порядок:
1. Поля Work Order на `MaintenanceRecord` + новые enum-значения статусов + `MaintenancePriority`.
2. `MeterReading` + enum `MeterSource`.
3. `MaintenancePlan` + enum `PmTriggerType`.
4. `ChecklistTemplate` + `ChecklistTemplateItem` + `WorkOrderChecklistResult`.

Все аддитивные (нет DROP). На прод — не забыть пересобрать сервис `migrate` (известный gotcha проекта).

---

## 10. Открытый вопрос вне дизайна (по ходу запроса пользователя)

Запрошено удаление `VIBRO_HAMMER` из enum `EquipmentKind`. Это **отдельное** изменение,
не часть данного спека, и требует проверки данных (нет ли строк с этим kind в проде/локали)
перед миграцией. Обрабатывается отдельно через `/create-migration`.
