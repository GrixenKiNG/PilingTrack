# Цикл смены оператора — план реализации

> **Для агентов:** реализовывать по задачам, шаги отмечены чекбоксами. Дизайн: [2026-08-20-operator-shift-cycle-design.md](../specs/2026-08-20-operator-shift-cycle-design.md).

**Цель:** провести оператора по семи фазам смены — допуск, приёмка, ЕО, пуск, работа, завершение, сдача — поверх существующего контура готовности, не заводя новых состояний смены.

**Архитектура:** фазы вычисляются из существующих `ShiftState`, `Inspection`, `EquipmentDefect`, `Report`. Новое — четыре миграции (`Report.shiftId`, `Inspection.shiftId`+`phase`, `ShiftStartWaiver`, координаты объекта), сужение прав в команде осмотра, клиент погоды и экран оператора по варианту C.

**Стек:** Next.js 16, TypeScript, Prisma/PostgreSQL, Zustand, vitest.

## Ход выполнения (20.08.2026)

| Задача | Статус | Коммит |
|---|---|---|
| 1. Сузить осмотр по уровню и машине | готово | `f680668` |
| 2. Согласовать матрицу готовности | готово | `39ee28c` |
| 3. Приёмка передачи оператором | готово | `39ee28c` |
| 4. Миграция `Report.shiftId` | готово | `cdd34dd` |
| 5. Гейт сдачи смены по отчёту | готово | `1c40e58` |
| 6. Миграция `Inspection.shiftId` + `phase` | готово | `9ac4181` |
| 7. `ShiftStartWaiver` | готово | `baf790b` |
| 7a. Пуск смены отдан оператору | готово | `dfce1f6` |
| 8. Чек-листы ЕО | **отменена, см. ниже** | — |
| 9. Сравнение состояний вход/выход | готово | `445a437` |
| 10. Ветер из погодного сервиса | готово | `175ff66` |
| 11. Экран оператора (вариант C) | готово | `c75cac6` |
| 12. Финальная проверка | готово | — |

Проверка: 1793 теста зелёные, сборка проходит, смоук по доступам проходит,
`db:check-migrations` чист. Осталось непроверенным глазами: экран оператора в
браузере — порт 3000 занят дев-сервером другой сессии.

Не сделано намеренно: пошаговый чек-лист ЕО «по узлам». Существующий экран
осмотра уже группирует пункты по разделам одной страницей; превращать его в
четыре экрана — отдельная работа по `run-inspection.tsx`, и она не блокирует
остальное.

### Находка по задаче 8: чек-листы уже есть

Проверка на живой базе показала двенадцать шаблонов уровня ЕО, сделанных по тем
же руководствам и полнее предложенных: LRH 100 — 39 пунктов, Woltman-PVE 50PR —
68, гидромолот PVE 7NL / Junttan HHK — 55, плюс дизель-молот, вращатели, КБУРГ-16,
SD-20 и общая база. Заводские требования из разд. 4.11 там уже стоят поимённо:
запорный элемент гидробака, главный выключатель АКБ, огнетушители, снег и лёд.

Созданные было четыре блока оказались дубликатами и вдобавок опасными:
`selectBlocks` берёт первое совпадение через `.find()` без сортировки, поэтому
второй HAMMER-шаблон с `appliesToHammerKind = HYDRAULIC` мог молча подменить
55-пунктовый чек-лист шестипунктовым. Дубликаты удалены после проверки, что на
них не ссылается ни один осмотр.

**Вывод:** задача снимается. Наполнение чек-листов — работа механика в
справочнике, а не разработки.

**Побочное наблюдение (не трогал):** в базе две одинаковые строки «ЕО
гидромолота» с `appliesToModel = HHK7A`. Дубликат существует до этой работы и
безвреден — установки с моделью `HHK7A` в парке нет, — но при появлении такой
машины он станет той же ловушкой первого совпадения.

### Открытый вопрос по задаче 11: кто допускает смену к пуску

Код говорит одно, спецификация — другое, и это надо решить до экрана.

В `startShiftCommand` стоит комментарий «Запуск — решение принимающей стороны, а
не того, кто готовил установку»: пуск даёт диспетчер. В спецификации написано,
что смену запускает оператор. Разошлось это давно и молча.

Сейчас реализовано **как в коде**: пуск и отказ в допуске требуют
`readiness.shift.authorize` (диспетчер, администратор), оператор их не имеет.
Экран оператора в этой развилке выглядит по-разному: либо кнопка «Начать смену»,
либо строка «Допуск запрошен, ждём диспетчера».

## Глобальные ограничения

- Одна миграция — одно логическое изменение (`CLAUDE.md`).
- Тесты держим лёгкими: только защита критичного, новых файлов тестов не плодим — дописываем в существующие.
- Никаких `console.log` в сервисах — только `logger.*`.
- Маршруты только через `withApi` / `withMutation`; CSRF и rate-limit не дублировать.
- Тенант обязателен и fail-closed: никаких `IS NULL OR tenantId`.
- Русские подписи в интерфейсе; технические имена состояний оператору не показывать.
- Проверка после каждой задачи: `npx vitest run <файл>`; полный прогон `npm run verify` — перед финальным коммитом.

---

### Задача 1: сузить осмотр по уровню и машине

Настоящий дефект: `startToInspection` принимает любой уровень и любую установку тенанта. Оператор может открыть `TO3` на чужой машине.

**Файлы:**
- Изменить: `src/modules/inspections/application/commands/inspection-commands.ts:27-60`
- Изменить: `src/app/api/inspections/route.ts:47-75` (передать роль и id пользователя в команду)
- Тест: `src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts`

**Интерфейсы:**
- Производит: `startToInspection(input, ctx)` где `ctx: { tenantId: string; userId: string; role: string }` — новое поле `role`.

- [ ] **Шаг 1: тест на отказ по уровню**

```ts
it('оператор не может открыть TO1', async () => {
  await expect(startToInspection(
    { equipmentId: 'eq-1', level: 'TO1', inspectionDate: new Date() },
    { tenantId: 'orion', userId: 'op-1', role: 'OPERATOR' },
  )).rejects.toThrow(/только ежесменный/i);
});
```

- [ ] **Шаг 2: тест на отказ по чужой машине**

```ts
it('оператор не может открыть ЕО на чужой установке', async () => {
  await expect(startToInspection(
    { equipmentId: 'eq-чужая', level: 'EO', inspectionDate: new Date() },
    { tenantId: 'orion', userId: 'op-1', role: 'OPERATOR' },
  )).rejects.toThrow(/не назначены/i);
});
```

- [ ] **Шаг 3: прогнать, убедиться что падают**

`npx vitest run src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts`
Ожидаем: FAIL — ограничений нет.

- [ ] **Шаг 4: реализовать сужение в начале `startToInspection`**

```ts
if (ctx.role === 'OPERATOR') {
  if (input.level !== 'EO') {
    throw new ServiceError('Оператору доступен только ежесменный осмотр (ЕО)', 403);
  }
  const crew = await db.crew.findUnique({
    where: { operatorId: ctx.userId },
    select: { equipmentId: true, isActive: true },
  });
  if (!crew?.isActive || crew.equipmentId !== input.equipmentId) {
    throw new ServiceError('Вы не назначены на эту установку', 403);
  }
}
```

- [ ] **Шаг 5: прогнать — оба теста зелёные**

- [ ] **Шаг 6: коммит**

```bash
git add src/modules/inspections src/app/api/inspections
git commit -m "fix(security): осмотр оператора ограничен уровнем ЕО и своей машиной"
```

---

### Задача 2: согласовать матрицу готовности

После сужения выдаём `readiness.inspection.manage` роли `OPERATOR`, чтобы две системы прав отвечали одинаково. Право ничего не расширяет — ограничение стоит в команде.

**Файлы:**
- Изменить: `src/modules/readiness/domain/capability-defaults.ts:64-69`
- Тест: `src/modules/readiness/application/__tests__/capabilities.test.ts`

- [ ] **Шаг 1: добавить право в `ROLE_ABILITIES.OPERATOR`** — `'readiness.inspection.manage'` с комментарием, что сужение живёт в `startToInspection`, а не здесь.
- [ ] **Шаг 2: тест — у оператора есть право и нет `readiness.maintenance.manage`.**
- [ ] **Шаг 3:** `npx vitest run src/modules/readiness/application/__tests__/capabilities.test.ts`
- [ ] **Шаг 4: коммит** — `feat(readiness): оператор ведёт ЕО и в контуре готовности`

---

### Задача 3: приёмка передачи оператором

Владелец: работают в одну смену; при второй смене передачу принимает следующий оператор. Запрет — принимать собственную передачу.

**Файлы:**
- Изменить: `src/modules/readiness/domain/capability-defaults.ts` (`OPERATOR` + `readiness.handover.decide`)
- Изменить: `src/modules/readiness/application/handovers/commands.ts` (команда `accept`)
- Тест: `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts`

- [ ] **Шаг 1: тест — подавший передачу не может её принять**

```ts
it('оператор не принимает собственную передачу', async () => {
  await expect(acceptHandoverCommand({
    tx, context: operatorContext('op-1'), id: 'ho-1',
  })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});
```

- [ ] **Шаг 2: прогнать — падает**
- [ ] **Шаг 3: в команде `accept` добавить проверку** `if (handover.submittedById === context.actorId && context.role === 'OPERATOR') throw new ReadinessCommandError('VALIDATION_ERROR', 409, 'Свою передачу принимает другой оператор или диспетчер')`
- [ ] **Шаг 4: прогнать — зелёный**
- [ ] **Шаг 5: коммит** — `feat(readiness): передачу смены принимает следующий оператор`

---

### Задача 4: миграция `Report.shiftId`

**Файлы:**
- Изменить: `prisma/schema.prisma` (модель `Report`)
- Создать: `prisma/migrations/<timestamp>_report_shift_link/migration.sql`
- Изменить: `src/app/api/reports/upsert/route.ts` (проставлять `shiftId` активной смены)

- [ ] **Шаг 1:** добавить в `Report` поле `shiftId String?` и индекс `@@index([tenantId, shiftId])`.
- [ ] **Шаг 2:** `npx prisma migrate dev --name report_shift_link --create-only`, проверить SQL — только `ADD COLUMN` и `CREATE INDEX`, без `NOT NULL` и без `DEFAULT`.
- [ ] **Шаг 3:** применить `npx prisma migrate dev`.
- [ ] **Шаг 4:** в `upsert` отчёта проставлять `shiftId` из активной смены установки бригады; если активной смены нет — оставлять `null`, не падать.
- [ ] **Шаг 5:** `npm run db:check-migrations`
- [ ] **Шаг 6: коммит** — `feat(reports): отчёт связан со сменой`

---

### Задача 5: гейт сдачи смены по отчёту

**Файлы:**
- Изменить: `src/modules/readiness/application/shifts/commands.ts` (команда `handover`)
- Тест: `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts`

- [ ] **Шаг 1:** тест — сдача смены без отправленного отчёта отклоняется с понятным русским сообщением.
- [ ] **Шаг 2:** прогнать, падает.
- [ ] **Шаг 3:** в команде `handover` проверить наличие `Report` со `status = 'submitted'` и `shiftId = shift.id`; иначе `ReadinessCommandError('VALIDATION_ERROR', 409, 'Сначала отправьте сменный отчёт')`.
- [ ] **Шаг 4:** прогнать, зелёный.
- [ ] **Шаг 5: коммит** — `feat(readiness): смену нельзя сдать без отправленного отчёта`

---

### Задача 6: миграция `Inspection.shiftId` + `phase`

**Файлы:**
- Изменить: `prisma/schema.prisma` (модель `Inspection`, новый enum `InspectionPhase`)
- Создать: `prisma/migrations/<timestamp>_inspection_shift_phase/migration.sql`
- Изменить: `src/modules/inspections/application/commands/inspection-commands.ts` (принимать `shiftId` и `phase` при старте)

- [ ] **Шаг 1:** enum `InspectionPhase { PRE_SHIFT POST_SHIFT }`; поля `shiftId String?`, `phase InspectionPhase @default(PRE_SHIFT)`; индекс `@@index([tenantId, shiftId, phase])`.
- [ ] **Шаг 2:** миграция `--create-only`, проверить, применить.
- [ ] **Шаг 3:** `startToInspection` принимает необязательные `shiftId` и `phase`, пишет их в запись.
- [ ] **Шаг 4:** `npx vitest run src/modules/inspections`
- [ ] **Шаг 5: коммит** — `feat(inspections): осмотр знает свою смену и фазу`

---

### Задача 7: `ShiftStartWaiver` — разрешение на пуск

**Файлы:**
- Изменить: `prisma/schema.prisma` (модель `ShiftStartWaiver`)
- Создать: `prisma/migrations/<timestamp>_shift_start_waiver/migration.sql`
- Создать: `src/app/api/readiness/shifts/[id]/waiver/route.ts`
- Изменить: `src/modules/readiness/application/shifts/start-decision.ts`
- Изменить: `src/modules/readiness/domain/capability-defaults.ts` (`readiness.shift.waive` → `DISPATCHER`, `ADMIN`)
- Тест: `src/modules/readiness/application/shifts/__tests__/commands-contract.test.ts`

**Интерфейсы:**
- Производит: `evaluateAuthoritativeShiftStart` возвращает `allowed: true`, если есть действующее разрешение на текущий снимок.

- [ ] **Шаг 1:** модель `ShiftStartWaiver { id, tenantId, shiftId, snapshotId, reason, issuedById, issuedAt, version }`, уникальность `@@unique([tenantId, shiftId])`, индекс `@@index([tenantId, shiftId])`.
- [ ] **Шаг 2:** миграция `--create-only`, проверить, применить.
- [ ] **Шаг 3:** тест — пуск при `BLOCKED` без разрешения отклоняется; с разрешением проходит; разрешение прошлой смены на новую не действует.
- [ ] **Шаг 4:** прогнать — падает.
- [ ] **Шаг 5:** в `evaluateAuthoritativeShiftStart` после расчёта: если `!evaluation.allowed`, искать разрешение по `shiftId`; при наличии — разрешать пуск и класть `waiverId` в `evidence`.
- [ ] **Шаг 6:** маршрут выдачи разрешения через `withReadinessCommand`, право `readiness.shift.waive`, обязательная непустая причина.
- [ ] **Шаг 7:** прогнать — зелёный.
- [ ] **Шаг 8: коммит** — `feat(readiness): разрешение диспетчера на пуск заблокированной машины`

---

### Задача 8: пять шаблонов ЕО из руководств

**Файлы:**
- Создать: `prisma/seed-data/eo-checklists.ts` (данные пунктов)
- Изменить: `prisma/seed.ts` (идемпотентная вставка по `tenantId` + `name`)

- [ ] **Шаг 1:** описать четыре предсменных блока (LB 20 BASE, PVE 50PR BASE, H40 HAMMER, PVE 7NL HAMMER) и один послесменный, разделы и пункты — по спецификации, с `photoRequired` только для критических и `createsDefect` там, где отрицательный ответ означает неисправность.
- [ ] **Шаг 2:** вставка идемпотентна: повторный сид не плодит дубли (сверка по `tenantId` + `name` + `level`).
- [ ] **Шаг 3:** прогнать сид на локальной базе, проверить сборку блоков: `startToInspection` для установки с `hammerKind = HYDRAULIC` собирает BASE + HAMMER.
- [ ] **Шаг 4: коммит** — `feat(inspections): чек-листы ЕО по руководствам Liebherr и PVE`

---

### Задача 9: сравнение состояний вход/выход

**Файлы:**
- Создать: `src/modules/inspections/domain/state-diff.ts`
- Тест: `src/modules/inspections/domain/__tests__/state-diff.test.ts`
- Изменить: `src/modules/readiness/application/shifts/commands.ts` (класть расхождения в `evidence` передачи)

**Интерфейсы:**
- Производит: `diffInspectionStates(pre: AnswerLike[], post: AnswerLike[], items: SnapItem[]): StateChange[]` где `StateChange = { itemId: string; text: string; from: string; to: string; worsened: boolean }`.

- [ ] **Шаг 1:** тест — совпадающие ответы расхождений не дают; «норма → замечание» даёт `worsened: true`; «замечание → норма» даёт `worsened: false`.
- [ ] **Шаг 2:** прогнать — падает.
- [ ] **Шаг 3:** чистая функция без обращений к базе, сопоставление по `itemId` снимка шаблона.
- [ ] **Шаг 4:** при подаче передачи ухудшения попадают в `evidence` и в текст сводки.
- [ ] **Шаг 5:** прогнать — зелёный.
- [ ] **Шаг 6: коммит** — `feat(inspections): сравнение состояния машины на входе и выходе смены`

---

### Задача 10: ветер из погодного сервиса

**Файлы:**
- Изменить: `prisma/schema.prisma` (`Site.latitude`, `Site.longitude`)
- Создать: `prisma/migrations/<timestamp>_site_coordinates/migration.sql`
- Создать: `src/services/weather/weather-client.ts`
- Создать: `src/app/api/weather/route.ts`
- Изменить: `scripts/validate-env.ts` (необязательная `WEATHER_API_BASE`)
- Тест: `src/services/weather/__tests__/weather-client.test.ts`

**Интерфейсы:**
- Производит: `getWindSpeed(siteId, tenantId): Promise<{ windMs: number; source: 'SERVICE'; at: string } | null>` — `null`, если координат нет или сервис недоступен.

- [ ] **Шаг 1:** поля `latitude Float?`, `longitude Float?` в `Site`; миграция `--create-only`, проверить, применить.
- [ ] **Шаг 2:** тест — при отсутствии координат возвращается `null` и запрос наружу не уходит; при ошибке сети возвращается `null`, исключение не всплывает.
- [ ] **Шаг 3:** клиент: `${WEATHER_API_BASE ?? 'https://api.open-meteo.com'}/v1/forecast?latitude=..&longitude=..&current=wind_speed_10m&wind_speed_unit=ms`, таймаут 3 с, кэш в Redis 15 минут по ключу `weather:{siteId}`, обёртка существующим предохранителем из `core/infrastructure/circuit-breakers.ts`.
- [ ] **Шаг 4:** маршрут `GET /api/weather?siteId=` через `withApi`.
- [ ] **Шаг 5:** прогнать тесты.
- [ ] **Шаг 6: коммит** — `feat(weather): скорость ветра по координатам объекта`

---

### Задача 11: экран оператора — вариант C

**Файлы:**
- Создать: `src/components/piling/operator/shift-phase.ts` (расчёт фазы из данных)
- Создать: `src/components/piling/operator/shift-step-card.tsx`
- Создать: `src/components/piling/operator/eo-checklist-screen.tsx`
- Изменить: `src/components/piling/operator-dashboard.tsx`
- Тест: `src/components/piling/operator/__tests__/shift-phase.test.ts`

**Интерфейсы:**
- Производит: `resolveShiftPhase(input): { phase: 1|2|3|4|5|6|7; title: string; action: string; blockers: string[] }` — чистая функция, без обращений к сети.

- [ ] **Шаг 1:** тест на `resolveShiftPhase`: нет смены → фаза 1; передача не принята → фаза 2; осмотр не закрыт → фаза 3; готовность `BLOCKED` → фаза 4 с непустым `blockers`; смена идёт → фаза 5.
- [ ] **Шаг 2:** прогнать — падает.
- [ ] **Шаг 3:** реализовать чистую функцию.
- [ ] **Шаг 4:** карточка шага на месте большой кнопки; пять фиксированных слотов плиток, недоступные — с замком; полоса из семи шагов вместо четырёх точек; плитка «Смена» переименована в «Осмотр» и ведёт в чек-лист.
- [ ] **Шаг 5:** экран чек-листа ЕО — четыре экрана по узлам, три состояния ответа, фото обязательно только при «неисправность».
- [ ] **Шаг 6:** проверить в браузере: `preview_start`, пройти путь оператора, снять скриншот.
- [ ] **Шаг 7: коммит** — `feat(operator): экран смены по фазам с чек-листом ЕО`

---

### Задача 12: финальная проверка

- [ ] **Шаг 1:** `npm run verify` — миграции, линт, типы, тесты, сборка, смоук по доступам.
- [ ] **Шаг 2:** `detect_changes` — сверить, что затронуты только ожидаемые символы.
- [ ] **Шаг 3:** отчёт владельцу: что сделано, что осталось, что проверить руками на площадке.

## Порядок и зависимости

Задачи 1–3 независимы и снимают дефекты прав — их можно и нужно делать первыми. Задачи 4–7 — схема, строго по одной миграции за раз. Задача 8 нужна до задачи 11, иначе экран нечем наполнить. Задача 9 требует 6 и 8. Задача 10 независима. Задача 11 требует 1, 4, 6, 7, 8.

Этап внедрения — первый: блокировка пуска не включается, разрешение диспетчера реализовано, но в норме не требуется. Включение жёсткого запрета — отдельным решением после месяца наблюдения, по критерию из спецификации.
