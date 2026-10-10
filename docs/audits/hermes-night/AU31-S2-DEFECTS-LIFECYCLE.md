# AU31-S2-DEFECTS-LIFECYCLE — Дефекты: жизненный цикл, права, связь с допуском

Версия рабочей папки (проверено командой, см. «Методика»):

```
git rev-parse HEAD
a19990f2d88f6b17c08129ee43f297e4c4c2604b
```

Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Аудит независимый: существующие
отчёты в `docs/audits/` не читались (кроме этого нового файла). Код приложения не изменялся.

## Итог

Резюме для владельца (5 строк):

1. Дефект техники в коде описан полностью: журнал `EquipmentDefect`, четыре команды
   (`создать / разобрать / устранить / отклонить`), четыре маршрута, панель на экране
   «Обслуживание ТО» и карточка в парке. Незакрытый **критический** дефект достоверно
   запрещает пуск смены — это единственное правило, которое тенант не может отключить.
2. Механика работы исправна, но **разбор дефекта в интерфейсе — почти пустое действие**:
   из формы уходит только комментарий, а сервер его **молча не сохраняет**; уточнить
   серьёзность и связать наряд-ремонт из UI нельзя, хотя сервер это умеет.
3. Оповещение о дефекте уходит **только при создании**; при разборе, устранении и отклонении
   уведомления нет — оператор, сообщивший о неисправности, узнаёт решение только зайдя в журнал.
4. Связка «критический дефект → запрет пуска → закрытие → возврат допуска» в интеграционных
   тестах не проверяется: единственный сценарий блокировки пуска покрывает наряд-допуск и явно
   утверждает `criticalDefect: false`. Покрыт лишь доменный переход и оценщик.
5. Итог по находкам: **критично — 0, важно — 5, мелочь — 6, гипотеза — 1**. Отдельно:
   переходы без теста — 4.

Топ-5 (по важности):

| # | важность | суть |
|---|----------|------|
| 1 | важно | Комментарий разбора дефекта принимается схемой и UI, но нигде не сохраняется (нет колонки в БД) — решение диспетчера теряется. |
| 2 | важно | Разбор из UI не может уточнить серьёзность и не может связать наряд-ремонт, хотя сервер это поддерживает; ссылка «Связанная запись ТО» недостижима. |
| 3 | важно | Путь «открытый CRITICAL → запрет пуска» не покрыт тестом (ни интеграционным, ни командным). |
| 4 | важно | Нет ни одного теста на команды и маршруты дефектов (`create/triage/resolve/reject`); протестирован только доменный переход. |
| 5 | важно | Оповещение о дефекте — только на создании; при разборе/устранении/отклонении уведомления нет. |

## Методика

Что искал и как (повторяется на любой машине из корня репозитория):

- Файлы модуля: `search_files pattern='**/*' path=src/modules/readiness` — 93 файла.
- Все упоминания «defect»: `search_files pattern='defect' path=src` — 121 файл.
- Маршруты: `find src/app/api/readiness/defects -name route.ts` → 4 файла:
  `route.ts`, `[id]/triage/route.ts`, `[id]/resolve/route.ts`, `[id]/reject/route.ts`
  (маршрута `[id]/route.ts` нет — см. находку 7).
- Прочитаны целиком: `domain/defects/{defect,types}.ts`, `application/defects/{commands,schemas,queries}.ts`,
  `infrastructure/defects/defect-repository.ts`, `application/capabilities.ts`,
  `domain/{access-matrix,capability-defaults,readiness-rules,readiness-score}.ts`,
  `domain/evaluation/{evaluator,rules,facts,inspection-source}.ts`,
  `domain/shifts/waiver.ts`, `application/{readiness-score,readiness-facts}.ts`,
  `application/shifts/{commands,start-decision}.ts`, маршруты дефектов и `_shared/{request-context,route-adapter}.ts`,
  `components/piling/to/readiness/screens/defects-panel.tsx`, `…/maintenance-screen.tsx`,
  `components/piling/to/to-module.tsx`, `components/piling/to/readiness/api/{client,contracts}.ts`,
  `core/notifications/durable-alert.ts`, `services/notifications/durable-alert-delivery.ts`,
  `modules/operator-mobile/{domain/{work-warnings,production-permit,defect-labels},application/{mobile-shift-query,assistant-query,defect-views}}.*`,
  `components/piling/operator-mobile/screens/assistant-defect-form.tsx`.
- Схема данных (только чтение): `prisma/schema.prisma:658-708` (модель `EquipmentDefect`),
  типы `DefectSeverity`/`DefectStatus`.
- Тесты: `find src/modules/readiness -name '*.test.ts*'` → 21 файл; из них про дефекты —
  4 (см. таблицу переходов). Поиск по интеграционным/e2e: `grep -rl defect e2e tests` → 4 файла.
- Числа из команд:

```
grep -rl "efect" src/modules/readiness --include=*.ts        → 16
find src/modules/readiness -name "*.test.ts*" | wc -l        → 21
grep -rl "defect\|Defect" src/modules/readiness --include=*.test.ts*  → 4
find src/app/api/readiness/defects -name route.ts            → 4
grep -rl "Defect\|efect" e2e tests --include=*.ts            → 4
```

Ограничение по правилам задачи: файлы `src/services/auth/**`, `src/core/security/**`,
`.env*`, `prisma/schema.prisma` (правил), `docker-compose*` не трогал. `prisma/schema.prisma`
только читал. Замороженные области (варианты экранов оператора `operator*/**`, сайт ORION)
не аудировались как источник находок; код `src/modules/operator-mobile/**` и
`src/components/piling/operator-mobile/**` — замороженная зона, читался лишь для ответа
на вопрос «что видит оператор на телефоне» и правки туда не предлагаются.

## Что такое дефект в коде (создание)

Дефект — это НАБЛЮДЕНИЕ («что не так»), а наряд (`MaintenanceRecord`) — РАБОТА («что делаем»);
в схеме это прямо записано как смысл разделения (`prisma/schema.prisma:650-657`). Сущность —
`model EquipmentDefect` (`prisma/schema.prisma:658-708`).

Создаётся дефект тремя путями:

1. `POST /api/readiness/defects` → `createDefectCommand`
   (`src/app/api/readiness/defects/route.ts:67-81`, `src/modules/readiness/application/defects/commands.ts:116-146`).
   Право — `readiness.defect.report` (`commands.ts:54-58`, `application/capabilities.ts:87-90`);
   по умолчанию его имеют все роли, включая OPERATOR, ASSISTANT, FOREMAN (`domain/capability-defaults.ts:52-136`).
2. Форма помощника машиниста в мобильном модуле — тот же endpoint
   (`src/components/piling/operator-mobile/screens/assistant-defect-form.tsx:58`).
3. Автоматически из предсменного чек-листа оператора при ответах о неисправности —
   `modules/operator-mobile/application/commands/checklist.ts:175-229` (дедупликация по `sourceKey`).

Статус при создании — `OPEN` (по умолчанию в схеме и в репозитории, `defect-repository.ts:52-71`).

## Статусы и переходы

Статусы (`domain/defects/types.ts:4-8`): `OPEN`, `IN_WORK`, `CLOSED`, `REJECTED`.
Открытыми считаются `OPEN` и `IN_WORK` (`domain/defects/defect.ts:10-13`).
Автомат переходов (`domain/defects/defect.ts:59-69`):

```
OPEN      : TRIAGE → IN_WORK   | REJECT → REJECTED
IN_WORK   : RESOLVE → CLOSED
CLOSED    : {}                 ← конечное
REJECTED  : {}                 ← конечное
```

Таблица переходов (из → в | действие | кто | условия | события):

| из | в | действие | кто (право) | условия | события |
|----|---|----------|-------------|---------|---------|
| — | OPEN | создать | `readiness.defect.report`: все роли смены + DISPATCHER/MECHANIC/SAFETY/ADMIN (`capability-defaults.ts:52-136`) | актор активен (`commands.ts:125`); установка активна и в своём тенанте (`commands.ts:126`, `defect-repository.ts:27-32`); `Idempotency-Key` (`route.ts:78`); **состояние смены не проверяется** | аудит `defect.reported` (`commands.ts:138`, `commands.ts:67-90`); outbox `ReadinessSnapshotRequested`/`DEFECT_CHANGED` (`commands.ts:81-89`); оповещение, если HIGH/CRITICAL (`commands.ts:139-141`, `durable-alert.ts:19-31`) |
| OPEN | IN_WORK | TRIAGE (`Взять в работу`) | `readiness.defect.manage`: DISPATCHER/MECHANIC/SAFETY/ADMIN (`commands.ts:61-65`, `capability-defaults.ts`) | совпадение версии: `If-Match` или `expectedVersion` (`versionedAction`, `commands.ts:149-174`, `command-pipeline/etag.ts:26-58`); переход разрешён (`commands.ts:183-186`) | аудит `defect.triage`; outbox `DEFECT_CHANGED` |
| OPEN | REJECTED | REJECT (`Отклонить`) | `readiness.defect.manage` | версия + переход допустим из OPEN (`commands.ts:223-227`) | аудит `defect.reject`; outbox `DEFECT_CHANGED` |
| IN_WORK | CLOSED | RESOLVE (`Устранён`) | `readiness.defect.manage` | версия + переход только из IN_WORK (`commands.ts:205-209`); текст `resolution` обязателен (`schemas.ts:28-31`) | аудит `defect.resolve`; outbox `DEFECT_CHANGED` |
| CLOSED | — | любой | — | запрещено, 409 «Дефект уже закрыт» (`commands.ts:184-186`) | — |
| REJECTED | — | любой | — | запрещено (`defect.ts:62-63`) | — |

Подписи действий в журнале аудита: `defect.reported/triage/resolve/reject`
(`components/piling/to/readiness/settings/audit-labels.ts:50-53`).

### Переходы и пути БЕЗ теста

| # | Что не покрыто | Evidence |
|---|----------------|----------|
| T1 | Ни одной команды дефекта: `createDefectCommand`, `triageDefectCommand`, `resolveDefectCommand`, `rejectDefectCommand` и репозиторий не импортируются ни одним тестом (0 совпадений `grep triageDefectCommand\|resolveDefectCommand\|rejectDefectCommand\|createDefectCommand` в `*.test.*`). | `commands.ts:116,176,198,216`; поиск по `src` и `tests` — только определения |
| T2 | Маршруты `POST /api/readiness/defects[/:id/(triage\|resolve\|reject)]` не имеют route-тестов (в отличие от `bootstrap`/`shifts`, где `__tests__/route.test.ts` есть). | `find src/app/api/readiness/defects -name route.ts` → 4 файла, ни одного `__tests__` |
| T3 | Путь «открытый CRITICAL запрещает пуск смены» не проверяется: интеграционный тест блокировки пуска строится на `VALID_WORK_PERMIT_REQUIRED` и явно ожидает `criticalDefect: false`. | `tests/integration/tech-readiness-shifts.spec.ts:205-228` (в т.ч. `:227`) |
| T4 | Возврат допуска после закрытия дефекта (закрытие → пересчёт снимка → снова можно пускать) не проверяется нигде. | `commands.ts:198-214` + `projection/project-event.ts`; теста на цикл нет |

Что покрыто тестами дефектов: доменная таблица переходов (`domain/defects/__tests__/defect.test.ts:69-94`),
сводка/блокировка (`defect.test.ts:34-67`), права (`application/__tests__/capabilities.test.ts:143-163`),
неотключаемость системного блокера в оценщике (`domain/evaluation/__tests__/evaluator.test.ts:161-170`),
совместимость отпечатка разрешения (`domain/shifts/__tests__/shifts.test.ts:67-71`),
оповещение (юнит) (`services/notifications/__tests__/durable-alert-delivery.test.ts:50`).

## Влияние открытого критического дефекта на допуск к смене

- Правило `CRITICAL_DEFECT` — системное, тенант его не может ни отключить, ни смягчить
  (`domain/readiness-rules.ts:96-104`, `:172-173` для значений по умолчанию; в
  `sanitizeRuleSet` значения системного правила игнорируются из входных данных,
  `readiness-rules.ts:267-283`).
- При расчёте готовности открытый критический дефект ищется напрямую:
  `severity: 'CRITICAL', status: {in: ['OPEN','IN_WORK']}` —
  `application/readiness-score.ts:88-94`; результат кладётся в факт `criticalDefect`
  (`readiness-score.ts:193-194`, объединяется со старым признаком «открытый CRITICAL-наряд ремонта»).
- Действие правила `DENY_START` → вердикт `DENIED` → `canStart=false`
  (`domain/readiness-score.ts:109-115`, `:172-185`, `:215-228`).
- При пуске смены решение принимается синхронно: `startShiftCommand` вызывает
  `evaluateAuthoritativeShiftStart` и при `allowed=false` возвращает 422
  `SHIFT_START_BLOCKED` с перечнем препятствий (`application/shifts/commands.ts:192-200`).
- Параллельно «допуск человека по документам» проверяется отдельно и **не снимается
  разрешением диспетчера** (`commands.ts:179-191`) — это другое правило.

Как закрывается и как возвращается допуск:

- Закрытие: `resolveDefectCommand` переводит в `CLOSED` и пишет `DEFECT_CHANGED` в outbox
  (`commands.ts:198-214`, `:67-90`). Проекция пересчитывает снимок установки: запрос
  `blockingDefect` открытый CRITICAL больше не находит → блокер не срабатывает → следующая
  попытка пуска проходит (`projection/project-event.ts`, `readiness-score.ts:88-94`).
- Обход запрета: письменное разрешение диспетчера `readiness.shift.waive`
  (`commands.ts:238-279`). Оно выдаётся на **набор препятствий** из последнего снимка
  (отпечаток `blockerFingerprint`, `domain/shifts/waiver.ts:15-25`) и покрывает текущие
  препятствия ровно в этом наборе (`waiverCoversBlockers`, `start-decision.ts:26-39`).
  Оператору право `shift.waive` не выдаётся (`capability-defaults.ts:75-94`).

Что видит оператор:

- На телефоне: открытые дефекты по своей установке (до 10, сортировка CRITICAL вверх —
  `operator-mobile/application/mobile-shift-query.ts:368-376`) → красное предупреждение
  `OPEN_ALERT_DEFECT` (`domain/work-warnings.ts:203-216`) и **запрет выработки**
  `CRITICAL_DEFECT` (`domain/production-permit.ts:103-113`). Журнал (простой, дефект,
  происшествие) остаётся доступным — это осознанное решение (`production-permit.ts:11-18`).
- На экране «Обслуживание ТО» (доступен каждому с `readiness.read`): панель «Журнал дефектов»
  с кнопкой «+ Зафиксировать дефект» и действиями по правам
  (`components/piling/to/readiness/screens/defects-panel.tsx:63-136`, подключается в
  `maintenance-screen.tsx:136`). Плитка «Критические дефекты» считает открытые CRITICAL
  (`maintenance-screen.tsx:63-64`, `:130`).
- В парке: карточка установки показывает её дефекты запросом
  `fetchReadinessDefects(..., {equipmentId})` (`screens/fleet-evidence-panel.tsx:71-79`).

Что видит механик: те же экраны; право `readiness.defect.manage` позволяет разбирать,
устранять и отклонять (`capability-defaults.ts:107-118`); роль MECHANIC доступна только
администратору в режиме «Действую как» (пользователей роли по проекту нет).

Уведомления: на создании дефекта HIGH/CRITICAL в той же транзакции ставится задача доставки
(`commands.ts:139-141` → `core/notifications/durable-alert.ts:19-31`), доставляется Telegram-у
через `services/notifications/durable-alert-delivery.ts` (ключ настройки `criticalDefect`,
`s:16-19`, выключается настройкой тенанта `:39`). При разборе/устранении/отклонении
оповещение не ставится.

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | важно | `src/modules/readiness/application/defects/schemas.ts:21-26`; `src/components/piling/to/readiness/screens/defects-panel.tsx:58,122`; `src/modules/readiness/application/defects/commands.ts:176-196`; `src/modules/readiness/infrastructure/defects/defect-repository.ts:123-138`; `prisma/schema.prisma:685-689` | Комментарий разбора (`comment`) принимается схемой и отправляется формой, но нигде не сохраняется: он не передаётся в `repository.triage`, у записи нет такого поля, в `serializeDefect` его нет. | Диспетчер пишет «передал механику, наряд такой-то», получает 200 «Замечание взято в работу», а запись пуста. Решение по безопасности/ремонту теряется; доказательного следа разбора, кроме факта `defect.triage`, нет. | Либо сохранять `comment` (поле в схеме + репозиторий, задача на миграцию — вне рамок этого аудита), либо убрать поле из формы/схемы и заменить на обязательное сохранение; сейчас хуже всего — обещание сохранить и молчаливая потеря. |
| 2 | важно | `src/components/piling/to/readiness/screens/defects-panel.tsx:121-124`; `src/modules/readiness/application/defects/commands.ts:187-194`; `schemas.ts:23-24`; `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:225` | Разбор из UI не может уточнить серьёзность (`severity`) и не может связать наряд-ремонт (`maintenanceRecordId`), хотя сервер это поддерживает и валидирует. | Заявленная цель разбора — «уточнить тяжесть, от уровня зависит допуск» (`schemas.ts:18-19`) — в UI недостижима. Ссылка «Связанная запись ТО» в карточке парка не может быть заполнена: цепочка «дефект → наряд → ремонт» рвётся. | Добавить в диалог разбора выбор серьёзности и (опционально) наряд; использовать поля, которые сервер уже принимает. |
| 3 | важно | `src/modules/readiness/application/readiness-score.ts:88-94,193-194`; `domain/readiness-rules.ts:172-173`; `tests/integration/tech-readiness-shifts.spec.ts:205-228` (особенно `:227`) | Путь «открытый CRITICAL-дефект → запрет пуска смены» не покрыт тестом; блокировка пуска проверяется только нарядом, при этом тест утверждает `criticalDefect: false`. | Это единственное системное правило безопасности, которое тенант не может отключить. Регресс (переименование статуса, смена запроса, поломка проекции) не будет пойман ни одним тестом. | Интеграционный тест: вставить `EquipmentDefect` severity=CRITICAL status=OPEN, вызвать `startShiftCommand`, ожидать 422 `SHIFT_START_BLOCKED` с `condition: 'CRITICAL_DEFECT'`; затем перевести в CLOSED и убедиться, что пуск проходит. |
| 4 | важно | `src/modules/readiness/application/defects/commands.ts:116-231`; `src/modules/readiness/infrastructure/defects/defect-repository.ts:24-153`; `src/app/api/readiness/defects/**` | Ни команды, ни маршруты, ни репозиторий дефектов не имеют ни одного теста (0 тестовых файлов). | Проверяются только доменная таблица переходов, права и оценщик. Ошибки в версионировании/идемпотентности/событиях/ошибках 409 не ловятся на уровне, где они реально происходят. | Юнит-тесты на `triage/resolve/reject` (переход, 409 на запрещённый переход, конфликт версии, запись аудита и outbox). |
| 5 | важно | `src/modules/readiness/application/defects/commands.ts:139-141` (только `create`); `src/core/notifications/durable-alert.ts:19-31` | Оповещение о дефекте ставится только при создании; при разборе, устранении и отклонении уведомления нет. | Оператор/помощник, сообщивший о критической неисправности, не получает решения диспетчера: чтобы узнать, что дефект отклонён или устранён, надо вручную открыть журнал. `production-permit`/`work-warnings` гаснут сами, но человек об этом не оповещён. | Ставить оповещение и на решение по дефекту (минимум на `REJECT`, чтобы автор узнал, что замечание отклонено и почему). |
| 6 | мелочь | `src/core/notifications/durable-alert.ts:28` | Текст оповещения подставляет сырой `equipmentId` вместо человекочитаемого имени установки («Опасный дефект установки <uuid>»). | В чате получатель видит идентификатор, а не «Установка №3»: сообщение менее понятно тому, кому оно адресовано. | Передавать имя установки (как это делают экраны), а не идентификатор. |
| 7 | мелочь | `src/modules/readiness/application/defects/commands.ts:144`; `find src/app/api/readiness/defects -name route.ts` → `[id]/route.ts` отсутствует | При создании дефекта возвращается `Location: /api/readiness/defects/{id}`, но маршрута чтения одного дефекта нет. | Заголовок advertises ресурс, которого не существует (404). Клиент, который по нему пойдёт, получит ошибку. | Либо добавить `GET /api/readiness/defects/[id]`, либо не отдавать `Location`. |
| 8 | мелочь | `src/modules/readiness/application/defects/queries.ts:46-48` | При одновременной передаче `openOnly=true` и `status=...` статус молча побеждает, `openOnly` игнорируется. | Клиент думает, что фильтрует по открытым, а получает один статус; расхождение не заметно (ответ 200). | Возвращать 422 при конфликте фильтров либо явно документировать приоритет. |
| 9 | мелочь | `src/modules/readiness/application/defects/queries.ts:61-63` | `summary` в ответе списка считается только по текущей странице, а не по всей выборке. | Экран может показать «открытых 0» на странице, где открытые дефекты не попали в пределы лимита; на плитке «Критические дефекты» это читается как «блокировок нет». | Считать сводку отдельным агрегатом по всему фильтру (как `total`), либо помечать, что сводка — по странице. |
| 10 | мелочь | `src/modules/readiness/application/defects/commands.ts:134-135`; `schemas.ts:13-14` | `inspectionId` и `shiftId` при создании дефекта принимаются без проверки существования и принадлежности тенанту/установке. | Можно привязать дефект к произвольной (в т.ч. чужой) сущности; целостность ссылок не гарантируется, хотя FK нет. | Валидировать эти ссылки так же, как `maintenanceRecordId` (`defect-repository.ts:41-50`). |
| 11 | мелочь | `src/modules/readiness/application/shifts/commands.ts:247-251,264-271` | Разрешение на пуск берёт «последний снимок по установке», не фильтруя по смене, и не имеет срока действия. | Отпечаток препятствий может быть взят из снимка другой смены той же машины; выданное разрешение бессрочно, пока набор препятствий не изменится. | Привязать снимок к `shiftId` и/или ограничить срок действия разрешения. |
| 12 | ГИПОТЕЗА | `src/components/piling/to/to-module.tsx:742-764`; `src/modules/readiness/application/readiness-facts.ts:41,78-79` | Клиентская функция `buildReadinessFacts` вызывается без дефектов (`defects` по умолчанию `[]`), поэтому клиентская производная оценка может не учитывать критический дефект. | Авторитетный снимок (с сервера) дефект учитывает — на нём строится статус. Если где-то на экране показывается именно производная оценка (`scoresByEquipment`), она может расходиться с сервером. Не проверено, где эти значения выводятся. | Проверить потребителей `scoresByEquipment`/`factsByEquipment`; если показываются — передавать туда дефекты. |

## Не проверено

- Не запускались `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`:
  задача — только чтение и отчёт, изменений кода нет; числовые «прогоны» не заявляю.
  Exit-коды команд выше относятся только к поискам и `git`/`find`/`grep` (все 0).
- Не смотрел базу данных (ни локальную, ни прод) и не выполнял приложение: выводы о поведении
  сделаны статически по коду. Фактическая работа Telegram-доставки и воркера outbox живым
  запуском не подтверждена.
- Не проверено, где именно на экране используются `scoresByEquipment`/`factsByEquipment`
  (находка 12 остаётся гипотезой).
- Не проверял, есть ли внешние потребители маршрута `GET /api/readiness/defects/[id]`
  (его попросту нет) — находка 7 основана на отсутствии файла маршрута.
- Не проверял значение настройки тенанта `criticalDefect` (включены ли оповещения) —
  это данные, не код.
- Наличие в схеме полей `observedSigns`, `safeStopApplied`, `classificationRuleId`,
  `classificationRuleVersion` (`prisma/schema.prisma:679-682`) и их незаполнение командой
  создания не анализировал глубоко — не проверено, используются ли они где-либо.
- Замороженные области (варианты экранов оператора `src/components/piling/operator*/**`,
  сайт ORION) как источник находок не аудировались по правилам задачи; код
  `operator-mobile` читался только для описания вида оператора.
