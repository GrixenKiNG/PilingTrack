# Движок чек-листов (ТО/ЕО) — Срез 1: ядро + ЕО — ДИЗАЙН-СПЕЦ

> Статус: на ревью. Брейншторм-дизайн утверждён пользователем (подход А, 3 сущности, экраны, срезы 1→2→3).
> Сопутствующий конспект решений: `docs/superpowers/specs/2026-06-03-maintenance-redesign-notes.md` (§18 — дизайн, §12c/§12d/§12e-CANON — реальные чек-листы из руководств).
> Дата: 2026-06-03.

## 1. Цель и контекст

Добавить **структурированные осмотры по чек-листам** (ЕО — ежесменное обслуживание) поверх существующего модуля обслуживания. Сейчас в коде есть только плоский `MaintenanceRecord` (наряд) с типом `INSPECTION` как свободный текст — нет шаблонов, пунктов, норм и оценки состояния.

**Срез 1 даёт:** админ заводит шаблон чек-листа → машинист проводит осмотр закреплённой техники → пункты с разными типами ответа, фото на пункт → Health Score → серверная проверка обязательных пунктов/фото → подпись → история осмотров. Засев: один реальный шаблон «ЕО гидромолота».

## 2. Принцип анти-дублирования (стыковка с существующим)

**Переиспуем (НЕ строим заново):**
- `Equipment` (+ `model`, + связь с операторами через экипажи: `listAllEquipment(operatorUserId)`) — «машинист видит свою технику».
- `MaintenanceRecord` (наряд) — как цель «дефект → ремонтный наряд» (Срез 2). В Срезе 1 не трогаем.
- Медиа-сервис (`/api/media`, `entityType`/`entityId`, presign→PUT→confirm) — фото на пунктах.
- Обёртки `withApi`/`withMutation`, `requireAuth`, `assertCan`, паттерн tenantId + RLS.
- Раздел навигации «Обслуживание» (уже есть).

**Net-new (только это):** шаблоны чек-листов + проведённые осмотры (структура пунктов/ответов/Health Score).

**Размещение в UI:** «Обслуживание» становится зонтиком: *Наряды* (есть) · **Осмотры** (новое) · **Шаблоны** (новое, админ). Осмотры — отдельный список, чтобы ежедневные ЕО не засоряли доску нарядов.

## 3. Объём Среза 1

**В объёме:**
- CRUD шаблонов (админ): шаблон → разделы → пункты; 4 типа ответа; фото-обязательность; обязательность пункта.
- Проведение осмотра машинистом по закреплённой технике; фото на пункт; примечание.
- Health Score; серверная проверка обязательных пунктов и обязательных фото при завершении; подпись.
- Список/история осмотров; осмотры на карточке установки.
- Seed: шаблон «ЕО гидромолота» (§12d-CANON).

**Вне Среза 1 (следующие срезы / §10):**
- Срез 2: дефект → ремонтный наряд; нормы по модели; провенанс (стр. руководства); голос-в-текст на десктопе.
- Срез 3: ТО-1/2/3 как шаблоны; привязка ТО-чек-листа к ТО-наряду; сезонный блок.
- §10-«север»: счётчики наработки, автопланирование next_due, уведомления, KPI, предиктив, динамические условия пунктов.

> Чтобы не плодить пустые поля, в Срез 1 закладываем поля `norm`/`unit`/`provenance` в модель (они дёшевы и нужны движку), но **автоподстановку норм по модели и UI провенанса** включаем в Срезе 2.

## 4. Модель данных (Prisma, новые таблицы)

Все таблицы: `tenantId` + RLS (политики как у `resource-access-service`), индексы по `tenantId`/FK. Миграция аддитивная, одно логическое изменение.

```prisma
enum ChecklistLevel { EO TO1 TO2 TO3 SEASONAL }
enum AnswerType { YES_NO STATUS4 DONE MEASURE }
// STATUS4 = Исправно / Замечание / Неисправно / Не проверено
enum InspectionStatus { DRAFT COMPLETED }

model ChecklistTemplate {
  id            String   @id @default(cuid())
  tenantId      String
  name          String
  level         ChecklistLevel
  appliesToModel String?               // подсказка по equipment.model (null = любая); автоподбор — Срез 2
  isActive      Boolean  @default(true)
  sections      ChecklistSection[]
  createdById   String?
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt      @db.Timestamptz(3)
  @@index([tenantId]) @@index([tenantId, level])
}

model ChecklistSection {
  id         String @id @default(cuid())
  tenantId   String
  templateId String
  title      String
  order      Int
  items      ChecklistItem[]
  template   ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  @@index([tenantId]) @@index([templateId])
}

model ChecklistItem {
  id            String     @id @default(cuid())
  tenantId      String
  sectionId     String
  text          String
  answerType    AnswerType @default(YES_NO)
  unit          String?                 // для MEASURE (бар, мм, л…)
  norm          String?                 // критерий/норма (текст), напр. «131–183 бар»
  provenance    String?                 // ссылка на стр. руководства (UI — Срез 2)
  photoRequired Boolean    @default(false)
  required      Boolean    @default(true)
  order         Int
  section       ChecklistSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  @@index([tenantId]) @@index([sectionId])
}

model Inspection {
  id               String   @id @default(cuid())
  tenantId         String
  equipmentId      String
  templateId       String
  level            ChecklistLevel
  performedById    String
  shift            String?               // DAY/NIGHT (свободно/enum позже)
  inspectionDate   DateTime @db.Timestamptz(3)
  engineHours      Int?                  // ручной ввод наработки
  healthScore      Int?                  // 0–100, считается при завершении
  status           InspectionStatus @default(DRAFT)
  templateSnapshot Json                  // снимок шаблона на момент проведения (доказательная база)
  signedByName     String?
  signedAt         DateTime? @db.Timestamptz(3)
  answers          InspectionAnswer[]
  equipment        Equipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)
  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt      @db.Timestamptz(3)
  @@index([tenantId]) @@index([tenantId, equipmentId]) @@index([tenantId, status])
}

model InspectionAnswer {
  id           String @id @default(cuid())
  tenantId     String
  inspectionId String
  itemId       String                 // ссылка на пункт (для трассировки; текст берётся из snapshot)
  result       String                 // YES/NO | OK/REMARK/FAULT/NA | DONE | (для MEASURE — пусто)
  value        String?                // для MEASURE: введённое значение
  note         String?
  photoCount   Int     @default(0)    // фото висят в media (entityType='inspection_answer', entityId=answer.id)
  inspection   Inspection @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  @@index([tenantId]) @@index([inspectionId])
}
```

**Equipment:** добавить обратную связь `inspections Inspection[]` (без новых полей).

## 5. Типы ответа и Health Score

| Тип (`answerType`) | Варианты `result` | Засчитывается «исправным» |
|---|---|---|
| YES_NO | YES / NO | YES |
| STATUS4 | OK / REMARK / FAULT / NA | OK (NA — исключается из знаменателя) |
| DONE | DONE / NOT_DONE | DONE |
| MEASURE | значение в `value` (+ опц. OK/FAULT) | в Срез 1 — заполнено = ок; авто-сравнение с `norm` — Срез 2 |

**Health Score** = `исправные / (всего применимых − NA) × 100`, округление до целого. Считается на сервере при завершении и сохраняется в `Inspection.healthScore`. Пороги (для отображения цвета): 90–100 исправна · 75–89 внимание · 50–74 повышенный риск · <50 критическое.

## 6. Серверная проверка при завершении (анти-приписки)

`completeInspection(id)` на сервере: по `templateSnapshot` собирает обязательные пункты (`required`) без ответа и пункты с `photoRequired` без фото (`photoCount=0`). Если есть пропуски — `ServiceError(400)` со списком; статус НЕ становится `COMPLETED`. Клиент обойти не может. Только после успеха — проставляется `healthScore`, `status=COMPLETED`, `signedAt`/`signedByName`.

## 7. API (route handlers, withApi/withMutation)

Право: новое `maintenance.manage` достаточно для Среза 1 (отдельное `inspection.*` — позже при необходимости). Машинист — роль с этим правом.

- `GET /api/checklist-templates` — список (фильтр level/model). `withApi`.
- `POST /api/checklist-templates` + `PUT/DELETE /api/checklist-templates/[id]` — CRUD шаблона с разделами/пунктами (вложенно). `withMutation`, `assertCan('maintenance.manage')` (для админа — можно ужесточить до роли ADMIN).
- `GET /api/inspections` — список осмотров (фильтр equipment/date/level; машинист — только своя техника). `withApi`.
- `GET /api/inspections/[id]` — один осмотр. `withApi`.
- `POST /api/inspections` — начать осмотр (фиксирует `templateSnapshot`). `withMutation`.
- `PUT /api/inspections/[id]` — сохранять ответы (DRAFT). `withMutation`.
- `POST /api/inspections/[id]/complete` — завершить (проверка §6 + подпись). `withMutation`.
- Фото пунктов — через существующий `/api/media` (`entityType='inspection_answer'`, `entityId=answer.id`). Привилегированные роли минуют entityType-проверку (как для maintenance).

Доменная логика — в `src/modules/equipment` (рядом с maintenance) или новый `src/modules/inspections`. Решение: **`src/modules/inspections`** (чистая граница, своя сущность — соответствует подходу А).

## 8. Видимость (роли)

- Машинист: «Провести осмотр» и список осмотров — **только закреплённая техника** (через `listAllEquipment(operatorUserId)`); свои осмотры.
- Механик/админ/диспетчер — вся техника, все осмотры.
- Управление шаблонами — админ (минимум `maintenance.manage`; рекомендуется ограничить ролью ADMIN).

## 9. Экраны (Next.js, client-компоненты, паттерны существующих)

- `/(app)/admin/checklists` — библиотека шаблонов (список) + редактор (`/[id]`): разделы→пункты, типы ответа, фото-обязательность.
- `/(app)/inspections` (или в «Обслуживании») — список осмотров + «Провести осмотр».
- Форма осмотра: выбор техники (закреплённой) → шаблон (подсказка по модели, выбор уровня) → разделы/пункты с нужным контролом + фото (камера телефона) + примечание; живой Health Score; кнопка «Завершить» → проверка → подпись.
- На карточке установки — вкладка/блок «Осмотры» (история этой машины).
- Навигация: добавить «Осмотры» (и админ «Шаблоны») в раздел «Обслуживание» (`(app)/layout.tsx`, роли ADMIN/DISPATCHER + роль машиниста).

## 10. Seed

Шаблон «ЕО гидромолота» по §12d-CANON: 11 разделов, типы ответа (Да/Нет, замер для давления/износа), `photoRequired` на ключевых (наголовник, РВД), `norm` из руководства (131–183 бар, азот 65/91/6, ход 80–150 мм). Сид только dev/CI (на проде — вручную через админку; `SKIP_SEED=1` на проде сохраняется).

## 11. Тестирование

- Unit: Health Score (вкл. исключение NA), серверная проверка обязательных/фото (пропуски → ошибка), tenant-изоляция запросов (fail-closed на пустой tenantId), снимок шаблона при старте.
- Контракт: роуты экспортируют нужные методы; `maintenance.manage` обязателен на запись.
- Видимость: машинист не видит чужую технику/осмотры.

## 12. Открытые мелочи (решить на этапе плана)

- Отдельное право `inspection.manage` vs переиспользовать `maintenance.manage` (Срез 1 — переиспуем).
- `shift` enum vs строка (Срез 1 — строка DAY/NIGHT).
- Хранение фото: `entityType='inspection_answer'` по `answer.id` (принято).
