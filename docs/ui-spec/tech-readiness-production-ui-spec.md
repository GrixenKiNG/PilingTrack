# UI Specification: производственный модуль «Техготовность»

**Статус:** Ready for implementation  
**Версия:** 1.0  
**Основание:** `docs/product/tech-readiness-production-prd.md`  
**Эталон:** `PilingTrack.dc.html` и четыре утверждённых PNG-референса  
**Целевая поверхность:** существующий маршрут модуля `ToModule`; без отдельной оболочки продукта  
**Timezone по умолчанию:** `Europe/Moscow`

## 1. Назначение и границы

Документ переводит утверждённый PRD и визуальный эталон в проверяемый контракт frontend-реализации. Он определяет структуру компонентов, данные, состояния, URL, действия, доступность и адаптивность. Серверные state machines, RBAC, tenant isolation, аудит, idempotency и optimistic concurrency остаются источником истины.

В версии 1 обязательно сохранить:

1. существующую глобальную оболочку PilingTrack;
2. одно глобальное левое меню приложения;
3. одну строку ровно из семи вкладок модуля в порядке:
   `Центр готовности → Техника → Смены → Наряд-допуски → Обслуживание → Отчёты → Настройки`;
4. ровно семь подразделов `Настроек` в порядке:
   `Правила готовности → Чек-листы → Роли и доступы → Справочники → Уведомления → Интеграции → Аудит`.

Запрещено:

- добавлять восьмую основную вкладку или восьмой подраздел настроек;
- переносить существующий левый nav приложения внутрь модуля;
- создавать второй логотип, второй user menu или второй top-level product header;
- заменять интерактивный интерфейс растровым макетом или hotspot-слоем;
- трактовать зелёный статус как наличие конфигурации: зелёный означает только рассчитанную готовность по опубликованной версии правил;
- называть hash-chain электронной подписью;
- показывать недостоверные локальные optimistic-статусы как подтверждённые сервером.

## 2. Источники истины и визуальный контракт

При расхождении источников применять приоритет:

1. PRD: бизнес-правила, RBAC, state machines, ошибки и acceptance criteria.
2. Эта UI Specification: component/state/responsive/a11y контракт.
3. Текущая реализация: переиспользуемые типы, дизайн-токены и wiring.
4. HTML/PNG-эталон: композиция, визуальная иерархия и плотность.

Эталон задаёт:

- тёмную строку семи вкладок с оранжевым активным индикатором;
- светлый рабочий фон, белые карточки, тонкие границы, компактные KPI;
- orange как акцент действия/attention, green как подтверждённый успех, red как blocker/error, blue/neutral как informational/pending;
- трёхколоночный `Центр готовности` на широком desktop;
- fleet master/detail на вкладке `Техника`;
- schedule + handover queue на вкладке `Смены`;
- settings side navigation только внутри вкладки `Настройки`;
- текст + иконку для каждого статуса.

Рекомендуемые токены должны браться из существующей design system, не дублироваться hex-значениями в компонентах:

| Назначение | Токен |
|---|---|
| Module tab bar | `bg-primary`, `text-white` |
| Primary signal/action | `signal`, `signal-strong` |
| Success | `success`, `success-strong` |
| Error/blocker | `destructive`, `destructive-strong` |
| Pending/info | `info`, `info-strong` |
| Warning | `warning`, `warning-strong` |
| Canvas/card/border | `background`, `card`, `border`, `muted` |

Минимальный интерактивный target: `44 × 44 px` на 390 px и `36 × 36 px` на desktop. Видимый focus ring — минимум 2 px, контрастный относительно элемента и фона.

## 3. Информационная архитектура

### 3.1 Основная иерархия компонентов

```text
ToModulePage
└─ AppShell (существующий, не дублировать)
   └─ TechReadinessModule
      ├─ ModuleTabList (ровно 7 вкладок)
      ├─ ModuleLoadBoundary
      │  ├─ InitialLoadingState
      │  ├─ FatalErrorState
      │  └─ PartialDataBanner
      └─ ActiveView
         ├─ ReadinessCenterView
         │  ├─ EquipmentContextPanel
         │  ├─ ReadinessSummaryPanel
         │  │  ├─ SnapshotHeader
         │  │  ├─ ReadinessScore
         │  │  ├─ StateChain
         │  │  ├─ BlockersWarnings
         │  │  └─ EvidenceGrid
         │  ├─ HandoverTimelinePanel
         │  ├─ DispatcherInboxPanel
         │  └─ ProcessRoleStrip
         ├─ EquipmentView
         │  ├─ SharedListFilters
         │  ├─ EquipmentKpis
         │  ├─ EquipmentList
         │  ├─ EquipmentDetailPanel
         │  └─ FleetSummary
         ├─ ShiftsView
         │  ├─ SharedListFilters + ShiftTypeFilter
         │  ├─ ShiftKpis
         │  ├─ ShiftSchedule/List
         │  ├─ HandoverQueue
         │  └─ CrewLoadSection
         ├─ WorkPermitsView
         │  ├─ SharedListFilters + RiskFilter
         │  ├─ PermitKpis/Evidence
         │  ├─ PermitTable/List
         │  └─ PermitDetailPanel
         ├─ MaintenanceView
         │  ├─ SharedListFilters
         │  ├─ MaintenanceSubtabs
         │  └─ Orders/Journal/Meters/Plans
         ├─ ReportsView
         │  ├─ SharedListFilters + EventType/ActorFilters
         │  ├─ ReportKpis/Charts
         │  ├─ AuditEventTable
         │  └─ CsvExportAction
         └─ SettingsView
            ├─ SettingsSectionList (ровно 7 подразделов)
            └─ SettingsSection
               ├─ ReadinessRulesSettings
               ├─ ChecklistsSettings
               ├─ RolesAccessSettings
               ├─ DictionariesSettings
               ├─ NotificationsSettings
               ├─ IntegrationsSettings
               └─ AuditSettings
```

### 3.2 Контейнеры и ответственность

`TechReadinessModuleController`:

- читает/валидирует URL;
- получает bootstrap permissions, tenant timezone и feature flags;
- оркестрирует запросы активной вкладки;
- хранит только UI state, query state и серверные entities/query cache;
- после command invalidates/refetches затронутые list, detail и current snapshot;
- не рассчитывает разрешения только по клиентской роли.

`ModuleTabList`:

- семантика `tablist/tab/tabpanel`;
- активна одна вкладка;
- tab state синхронен с URL;
- на mobile остаётся одной горизонтально прокручиваемой строкой.

`SharedListFilters`:

- одинаковые поля и query-key на `Техника`, `Смены`, `Наряд-допуски`, `Обслуживание`, `Отчёты`;
- фильтры `equipmentId`, `status`, `from`, `to`;
- контекстные фильтры расширяют, а не заменяют общие;
- показывает количество активных фильтров и явную кнопку `Сбросить`.

`EntityActionGate`:

- получает серверный `actions[]` либо `capabilities`;
- `allowed=true` показывает активную команду;
- ожидаемо недоступное действие показывает disabled control и человекочитаемую `reason`;
- действие, которое пользователь вообще не вправе знать/видеть, не рендерится;
- client gate не заменяет обработку `403`.

`CommandDialog`:

- единый каркас для create/start/handover/accept/rework/approve/revoke/cancel/publish;
- показывает entity, текущую версию, последствия, поля ввода и серверные ошибки;
- генерирует новый `Idempotency-Key` на новую команду, повторяет тот же key только при безопасном retry того же payload;
- отправляет aggregate `expectedVersion`/strong `If-Match`; для правил использует `expectedRevision`, не display/business `version`.

## 4. Модель данных UI

### 4.1 Bootstrap

```ts
interface ReadinessUiBootstrap {
  tenant: {
    id: string;
    timezone: string; // fallback Europe/Moscow
  };
  actor: {
    id: string;
    role: string;
    actingAs?: 'MECHANIC';
  };
  permissions: string[];
  featureFlags: {
    readiness_shifts_v1: boolean;
    readiness_permits_v1: boolean;
    readiness_audit_chain_v1: boolean;
  };
}
```

UI не должен выводить tenant ID, secret permissions или feature flag diagnostics пользователю. При выключенном feature flag вкладка не исчезает: она показывает scoped unavailable state с объяснением rollout, сохраняя структуру 7 вкладок.

### 4.2 Read models

| Read model | Обязательные UI-поля | Основные потребители |
|---|---|---|
| `EquipmentListItem` | `id`, `name`, `serialNumber`, `site`, `photo`, current snapshot summary, active shift summary, `actions` | Центр, Техника, selectors |
| `ReadinessCurrent` | `equipmentId`, `snapshotId`, `status`, `score`, `calculatedAt`, `timezone`, `ruleSetVersion`, blockers, warnings, evidence, `actions` | Центр, detail, start-shift gate |
| `Shift` | `id`, `equipment`, `type`, `state`, `productionDate`, timezone, timestamps/actors, `version`, `actions` | Смены, Центр |
| `ShiftHandover` | `id`, `shiftId`, `state`, summary, refs, submitted/accepted/rework data, `version`, `actions` | Смены, Центр |
| `WorkPermit` | `id`, equipment, optional shift, risk, state, validity, approvals, author, revoke data, `version`, `actions` | Допуски, Центр |
| `MaintenanceRecord` | id, equipment, type, status, due/completed values, executor | Обслуживание, evidence |
| `AuditEvent` | id, occurredAt UTC + display timezone, actor/role/actingAs, action, entity/version, result, correlation, masked before/after, hash status | Отчёты, Настройки/Аудит |
| `ReadinessRuleSet` | id, business `version`, optimistic `revision`, lifecycle, weights, blockers/actions, published/draft metadata, pending changes | Настройки/Правила |

### 4.3 Query state и local state

| State | Где хранится | Reload/back | Правило |
|---|---|---:|---|
| active view | URL `view` | Да | default `readiness` |
| settings section | URL `section` | Да | только при `view=settings`, default `rules` |
| selected equipment | URL `equipmentId` | Да | invalid ID очищается после безопасного 404 |
| list filters | URL | Да | canonical serialization |
| sort/cursor | URL | Да | reset cursor при смене фильтра |
| opened entity | URL `shiftId`/`permitId`/`eventId` или route segment | Да | detail должен deep-link |
| dialog open | local, кроме shareable detail | Нет | закрывается после success |
| draft form values | form state | Нет; optional session recovery | не смешивать с query cache |
| pending command | mutation state | Нет | один pending на entity/action |
| focused/expanded row | local | Нет | не влияет на API |

### 4.4 Контракт привязки данных и состояний

Каждое видимое значение должно иметь явный источник в server read model или query metadata:

- KPI, counts, score, status, blockers, warnings, timestamps, actors и версии берутся из ответа соответствующего endpoint; UI не пересчитывает доменный status и не подменяет отсутствующее значение `0`, `100%`, `Готово` или иным правдоподобным fallback;
- labels техники и площадки связываются по tenant-scoped ID из server response/selector query; строки, имена, номера, даты и проценты из HTML/PNG-эталона являются только визуальным примером и не включаются в production bundle как fixture/default state;
- доступность команд определяется `actions[]`/`capabilities` и текущей server version; локальные role checks допустимы только для presentation и не создают разрешение;
- loading/error/empty/pending/conflict являются UI-состояниями query/mutation и не записываются как domain state сущности;
- при частичном ответе отсутствующий source помечается unavailable/error, а карточка не дополняется псевдоданными;
- единственные допустимые demo/fixture-данные находятся в явно изолированных test/story fixtures и не импортируются production entrypoint.

## 5. URL contract

Базовая форма:

```text
<module-route>?view=<view>&section=<section>&equipmentId=<id>&status=<status>
  &from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&shiftType=<DAY|NIGHT>
  &risk=<NORMAL|ELEVATED>&eventType=<type>&actorId=<id>
  &maintenanceSection=<orders|journal|meters|plans>
  &sort=<field.direction>&cursor=<opaque-base64url>
```

### 5.1 Значения

| Параметр | Допустимые значения | Где применяется |
|---|---|---|
| `view` | `readiness`, `fleet`, `shifts`, `permits`, `maintenance`, `reports`, `settings` | глобально |
| `section` | `rules`, `checklists`, `roles`, `dictionaries`, `notifications`, `integrations`, `audit` | только settings |
| `equipmentId` | tenant-scoped opaque ID | все содержательные вкладки |
| `status` | whitelist конкретного endpoint | списки |
| `from`, `to` | local production date `YYYY-MM-DD` | списки, timezone tenant |
| `shiftType` | `DAY`, `NIGHT` | shifts |
| `risk` | `NORMAL`, `ELEVATED` | permits |
| `eventType`, `actorId` | endpoint-supported values | reports/audit |
| `maintenanceSection` | `orders`, `journal`, `meters`, `plans` | только maintenance; default `orders` |
| `cursor` | opaque backend cursor | paginated lists; действителен только с теми же canonical filters/sort |

List response использует `page: {limit,nextCursor,hasMore,total}`. Для audit list обязателен `meta.filterHash`; CSV возвращает тот же hash в `X-Filter-Hash`. UI не вычисляет hash самостоятельно.

### 5.2 Нормализация

- `view=readiness` можно опускать; отсутствие `view` означает `readiness`.
- `section` удаляется из URL вне `settings`.
- `maintenanceSection` удаляется из URL вне `maintenance`.
- неизвестные enum-параметры удаляются через `replace`, не вызывают fatal error.
- `from > to` не отправляется в API; поля получают inline error, URL сохраняет введённые значения до исправления.
- изменение фильтра выполняет `push` с debounce `300 ms` для text search и немедленно для select/date.
- выбор вкладки выполняет `push`; back/forward полностью восстанавливает вкладку, фильтры, selection и detail.
- `Сбросить` удаляет все фильтры активной вкладки, `cursor`, `sort` и entity detail; сохраняет `view` и, для settings, `section`.
- `400 CURSOR_FILTER_MISMATCH` один раз удаляет только `cursor` через `replace`, сохраняет filters/sort и загружает первую страницу; повторная ошибка показывается как scoped error.
- API и CSV получают один и тот же normalized filter object; запрещены отдельные client-only фильтры после получения CSV.

### 5.3 API mapping

| Вкладка | Endpoint | Дополнительные параметры |
|---|---|---|
| Центр | `/api/readiness/equipment/:id/current`, `/snapshots` | equipmentId |
| Техника | tenant equipment list + current readiness summary | общие |
| Смены | `/api/readiness/shifts` | `shiftType` |
| Допуски | `/api/readiness/work-permits` | `risk` |
| Обслуживание | существующие maintenance endpoints | subtype |
| Отчёты | `/api/audit` | `eventType`, `actorId` |
| CSV | `/api/audit/export.csv` или scoped export | точно те же filters + timezone |

## 6. Матрица экранов, данных и состояний

| Экран | Primary query | Selection/detail | Empty без данных | Empty по фильтрам | Главные команды |
|---|---|---|---|---|---|
| Центр | equipment summary | current + snapshots + active workflow | «Техника ещё не добавлена» | не применяется | контекстное следующее действие |
| Техника | equipment list | equipment current/detail | «Техника ещё не добавлена» | «По фильтрам техника не найдена» | добавить, открыть flow, экспорт |
| Смены | shifts list | shift + handover | «Смены ещё не создавались» | «Смены по фильтрам не найдены» | создать, начать, передать, принять, rework, cancel |
| Допуски | permits list | permit + approvals | «Наряды-допуски ещё не создавались» | «Наряды по фильтрам не найдены» | создать, edit, submit, approve, revoke |
| Обслуживание | records | record/detail | subtype-specific | subtype-specific filtered empty | mechanic actions |
| Отчёты | audit/events | selected event | «Событий ещё нет» | «События по фильтрам не найдены» | CSV/export, open detail |
| Настройки | section data | selected row/item | section-specific | section-specific | save draft, publish, configure |

## 7. Унифицированные async и mutation states

### 7.1 Loading

`initial-loading`:

- сохраняет tab bar и shell;
- main содержит skeleton, повторяющий финальную геометрию;
- `aria-busy=true`, один `role=status`, сообщение «Загружаем…»;
- не показывает искусственные нули KPI.

`refreshing`:

- существующие данные остаются видимыми;
- локальный progress indicator у фильтров/section;
- controls не блокируются целиком; блокируются только несовместимые mutation actions;
- результаты заменяются атомарно без прыжка scroll/focus.

`detail-loading`:

- list остаётся доступным;
- detail panel получает skeleton собственной ширины;
- повторный выбор той же сущности не запускает дублирующий запрос.

### 7.2 Error

| Ошибка | Представление | Recovery |
|---|---|---|
| bootstrap/list fatal | центрированный `role=alert`, понятный текст, Retry | повтор primary query |
| partial source error | banner «Часть данных недоступна» + источники | Retry failed queries |
| detail 404 | detail not-found, list сохраняется, invalid selection удаляется из URL | выбрать другую |
| network/offline | offline-текст, без ложного «нет данных» | Retry/on reconnect |
| 429 | retry-after или нейтральное «повторите позже» | action disabled до срока |
| 500 | correlationId в раскрываемых деталях/копировании | Retry |

### 7.3 Empty

`true-empty` показывается только после успешного ответа с total `0` и без активных фильтров. Содержит объяснение и permitted create action.

`filtered-empty` показывается при total `0` и наличии фильтра. Содержит chips активных фильтров и `Сбросить фильтры`; не предлагает создание как единственный выход.

`unknown-empty` запрещён: ошибка/permission/disabled feature не должны выглядеть как нулевые данные.

### 7.4 Pending

- mutation button меняет label на герундий: `Начинаем…`, `Принимаем…`, `Публикуем…`;
- spinner декоративный, текст остаётся доступным;
- повторный submit этой же команды заблокирован;
- другие сущности и безопасная навигация доступны;
- закрытие dialog во время pending запрещено через Escape/backdrop; доступна явная «Операция выполняется»;
- optimistic state допустим только как `pending`, не как финальный domain state.

### 7.5 Success

- server response является источником финального state/version;
- dialog закрывается;
- live-region сообщает сущность и результат;
- list row, detail и current snapshot обновляются одним согласованным cache transaction/refetch;
- focus возвращается на action trigger или, если сущность исчезла из фильтра, на заголовок list + сообщение;
- toast не является единственным подтверждением.

### 7.6 Conflict `409`

Общий toast запрещён. Показать `ConflictDialog/InlineConflict`:

- заголовок: «Данные уже изменились»;
- серверный `code`;
- кто и когда выполнил действие, если сервер это раскрывает;
- отправленная и текущая версии;
- актуальный state;
- summary последствий;
- primary `Обновить данные`;
- secondary `Закрыть`;
- `Повторить` разрешено только после refetch и повторной проверки capability; создаётся новый key, если payload/expectedVersion изменился.

Для конкурентного accept: «Передача уже принята: <actor>, <tenant-local time>». После закрытия UI показывает `ACCEPTED/CLOSED`, кнопки accept/rework исчезают или получают причину.

Для конкурентного start: «Для этой техники уже существует активная смена» и ссылка/кнопка открытия активной смены.

Для idempotency payload mismatch: не выполнять автоматический retry; предложить закрыть и заново сформировать команду.

### 7.7 Permission

| Ситуация | UI |
|---|---|
| permission на экран отсутствует | scoped `403` panel без утечки данных |
| экран читается, команда запрещена ролью | action скрыт, если не нужен для понимания workflow |
| команда ожидаемо недоступна текущему actor/state | disabled action + visible/tooltip reason |
| сервер вернул `403` после рендера | данные refetch; role/capabilities refresh; alert |
| cross-tenant safe `404` | обычный not-found, не сообщать о чужом tenant |
| ADMIN acting as mechanic | action маркируется «Выполнить как механик»; dialog сообщает аудит `actingAs=MECHANIC` |

Причина недоступности доступна keyboard и screen reader; нельзя полагаться на hover-only tooltip у disabled native button. Использовать wrapper/description, связанный `aria-describedby`.

## 8. Действия и диалоги

### 8.1 Каталог команд

| Команда | Роль/capability | Предусловия | Dialog |
|---|---|---|---|
| Создать смену | разрешённый dispatcher/admin path | type DAY/NIGHT, equipment | equipment, type, production date/timezone |
| Начать смену | server action | `PLANNED`, нет active shift, blockers pass | readiness version, blockers/warnings, consequences |
| Передать смену | MECHANIC или ADMIN actingAs | `STARTED` | defects/meters refs, summary, expectedVersion |
| Принять передачу | DISPATCHER | `HANDOVER_PENDING/SUBMITTED` | immutable summary, version, consequences |
| Вернуть на доработку | DISPATCHER | submitted handover | обязательная причина |
| Отменить смену | server capability | `PLANNED|STARTED` | обязательная причина |
| Создать/изменить допуск | MECHANIC/ADMIN-as-mechanic/DISPATCHER по PRD | editable state | scope, validity, risk, version |
| Отправить на согласование | server capability | valid draft | summary |
| Одобрить NORMAL | DISPATCHER, не author/editor | pending | role, user, version |
| Одобрить ELEVATED | DISPATCHER или ADMIN, разные users | pending | progress 0/2, 1/2, version |
| Отозвать допуск | server capability | approved | обязательная причина, consequences |
| Сохранить draft правил | ADMIN | valid weights/blockers | pending changes |
| Опубликовать правила | ADMIN | valid draft | affected equipment count, snapshot recalculation |
| Экспорт CSV | audit permission | filters valid | optional confirmation for large export |

### 8.2 Структура CommandDialog

Порядок:

1. title;
2. краткое назначение;
3. identity card: техника, entity ID/номер, смена/тип, текущий state;
4. `Версия N` и tenant-local timestamp;
5. последствия;
6. form fields;
7. inline validation/domain errors;
8. footer: `Отмена`, primary command.

Danger commands (`revoke`, `cancel`, destructive publish consequence) используют destructive styling только для подтверждающей кнопки, не окрашивают весь dialog.

### 8.3 Validation и `422`

- client validation помогает, но не заменяет server validation;
- server `422` остаётся внутри открытого dialog;
- общий message показывается сверху form;
- field errors связываются с fields через `aria-describedby`;
- blockers выводятся списком `code + message + correcting action`;
- action link из server response проходит allowlist внутренних маршрутов;
- focus переходит к summary ошибки, затем пользователь Tab-порядком достигает первого invalid field.

## 9. Поведение конкретных вкладок

### 9.1 Центр готовности

- Без selected equipment выбрать первый доступный элемент только при отсутствии `equipmentId`; записать его через replace, чтобы не создавать лишний history entry.
- Snapshot header всегда показывает `Рассчитано <date/time> <timezone>` и `Правила vN`.
- `ReadinessScore` не выводит `0`, если snapshot отсутствует: `— / 100`, статус `Нет данных`.
- Blockers и warnings раздельны. Каждый имеет code/label, evidence и permitted correcting action.
- State chain основывается на фактических states shift/inspection/permit/handover, не на локальном прогрессе.
- Handover timeline неизменяем в UI; действия расположены вне timeline.
- Dispatcher inbox виден только при read permission; accept/rework gates — server-driven.
- `Следующее действие` выбирается серверным capability/action priority; при отсутствии действия показывает объяснение, а не неактивную оранжевую кнопку.

### 9.2 Техника

- Desktop: filters → KPI → list grid → sticky detail; selected card имеет border + `aria-current`.
- Карточка показывает фото/fallback, name/site, score/status, meter, active shift/crew и следующее действие.
- Detail tabs допустимы только внутри detail (`Карточка/История/Документы`), не считаются основными вкладками.
- Search/filter controls имеют labels; сортировка — native select/listbox.
- Карточка целиком не становится несемантической кнопкой: отдельная button/link «Открыть».

### 9.3 Смены

- Day/week presentation не меняет обязательную общую filter model.
- На 1440/1280 timeline допустим; на 1024/390 primary presentation — вертикальный list, без обязательного горизонтального timeline.
- Shift type всегда текстом `Дневная/Ночная` + machine value.
- Одна active shift на equipment визуально проверяется, но окончательно обеспечивается сервером.
- Handover queue показывает state, submitted actor/time, readiness snapshot reference и разрешённые действия.
- `Принять смену` не объединять с «назначить механика» в одну неатомарную команду; если продукт требует оба шага, они выполняются и аудируются отдельно либо серверным явно документированным endpoint.

### 9.4 Наряд-допуски

- Status и risk — отдельные поля.
- Approval progress: NORMAL `0/1` или `1/1`; ELEVATED `0/2`, `1/2`, `2/2` с ролями и пользователями.
- Самосогласование не показывается разрешённым даже при наличии общей role capability.
- После содержательного edit UI сразу использует server version, очищает старые approvals и показывает «Требуется повторное согласование».
- `EXPIRED/REVOKED` read-only; действия создания новой версии не маскируют историю.

### 9.5 Обслуживание

- Внутренние subtabs `Наряды/Журнал/Моточасы/Регламенты` допустимы в content area.
- Не превращать их в основные module tabs и не сериализовать как legacy `view=journal|meters|plans`; использовать `maintenanceSection`.
- Completed/actual status содержит дату и исполнителя; «настроено» не равно «выполнено».

### 9.6 Отчёты

- Таблица семантическая; каждая строка имеет отдельную link/button detail.
- Все времена показываются в tenant timezone; detail дополнительно показывает UTC.
- CSV использует те же normalized filters, включает timezone и UTC timestamp.
- Перед export formula-dangerous values экранируются сервером.
- Integrity widget имеет только server-confirmed states `verified`, `broken`, `not_enabled`, `checking`, `unknown`; при выключенном flag не заявляет «цепочка цела».

### 9.7 Настройки

- Settings nav содержит ровно семь subsection controls.
- На wide desktop это левая локальная колонка внутри content; на 1024/390 — одна горизонтально прокручиваемая строка под module tabs.
- `Правила`: сумма нормализованных весов 100%; draft/published явно разделены; preview показывает test equipment и серверный пересчёт.
- Publish dialog показывает количество затронутой техники и то, что прошлые snapshots не изменятся.
- `Роли и доступы`: ADMIN может назначить MECHANIC; прочие роли read-only/denied согласно server capabilities.
- `Аудит`: читает только AuditLog; detail показывает masked diff и integrity result.

## 10. Focus management

### 10.1 Навигация и обновления

- При смене основной вкладки focus остаётся на активном tab; после render активный `tabpanel` имеет доступное имя, но не получает принудительный focus.
- При back/forward focus перемещается на восстановленный active tab только если предыдущий focused node был удалён.
- При выборе equipment focus остаётся на trigger; detail объявляет обновление через polite live region.
- При filtered-empty focus не прыгает.
- После `Сбросить` focus возвращается на кнопку/заголовок filters, объявляется количество результатов.

### 10.2 Dialog

- Открытие: focus на title container (`tabindex=-1`) либо первый field, если dialog простой form.
- Focus trap обязателен.
- Escape закрывает только не-pending dialog.
- Закрытие: focus на исходный trigger; если trigger исчез, на ближайший list heading.
- Validation failure: focus на error summary.
- Conflict: focus на heading «Данные уже изменились».
- Success не отправляет focus в toast.

### 10.3 Drawer/mobile detail

- Mobile detail открывается как modal sheet с `dialog` semantics;
- background inert;
- close button первая в Tab order;
- swipe не является единственным способом закрытия;
- после close focus возвращается на карточку/строку.

## 11. Keyboard semantics и ARIA

| Паттерн | Клавиши/семантика |
|---|---|
| Основные вкладки | `role=tablist`; Left/Right/Home/End перемещают focus, Enter/Space активируют; выбранная `aria-selected=true` |
| Settings sections | на desktop nav links/buttons; допустим tablist только если panels мгновенно переключаются; одна последовательность, не nested module tabs |
| Buttons | Enter/Space; icon-only имеют accessible name |
| Links | Enter; используются для навигации/deep-link, не для command |
| Data table | `table/thead/tbody/th`; sortable th содержит button + `aria-sort` |
| Row selection | отдельная link/button; hover строки не единственный affordance |
| Combobox | стандартный project component с Arrow/Escape/Enter и label |
| Date range | два labelled inputs; формат и timezone в description |
| Switch | `role=switch`, `aria-checked`, label; disabled reason доступна |
| Disclosure | button + `aria-expanded`/`aria-controls` |
| Status | icon decorative + видимый текст; color не единственный канал |
| Async result | одна `aria-live=polite` область; errors/conflict `role=alert` без повторного toast announcement |

Порядок Tab следует визуальному порядку: module tabs → page heading/actions → filters → primary content → detail → role strip/footer. Sticky/mobile перестановка не должна расходиться с DOM order.

## 12. Responsive specification

### 12.1 Общие правила

- Корневой модуль: `width:100%`, `min-width:0`, без page-level horizontal overflow.
- Горизонтальный scroll разрешён только у:
  1. module tab row;
  2. settings section row на narrow;
  3. явно обёрнутой data table, если вместо mobile cards не реализован list.
- Critical actions, dialog footer, page title и filters не могут находиться внутри горизонтально прокручиваемого table wrapper.
- Любой grid child с текстом: `min-width:0`; длинные ID/URL: `overflow-wrap:anywhere`.
- Sticky элементы учитывают фактическую высоту AppShell/module tab bar и safe areas.

### 12.2 1440 px

Рабочая ширина после глобального sidebar определяется shell; модуль не задаёт `min-width:1440`.

- Module tabs: одна строка, все семь видимы без scroll при доступной ширине `>=1180`.
- Центр: `300px / minmax(0,1fr) / 320px`, gap `12–16px`.
- Техника: filters `180–220px`, cards `minmax(0,1fr)`, detail `290–320px`.
- Смены/Допуски: main `minmax(0,1fr)` + aside `300–320px`.
- Настройки: local nav `180px` + content.
- Role strip: 4 колонки в одной строке с межшаговыми стрелками.

### 12.3 1280 px

- Все семь tabs остаются одной строкой; если shell оставляет меньше `1060px`, tab row скроллится, не сжимая labels и не накладывая user controls.
- Центр: `260px / minmax(0,1fr) / 300px`; если main content падает ниже `480px`, right aside переносится под main, layout становится `260px / 1fr`, aside span main column.
- Техника: filters collapsible toolbar; cards 2 columns, detail `280–300px` либо below list при main < `720px`.
- Role strip: 2×2, стрелки скрыты.
- Settings nav остаётся left rail только при content after rail `>=760px`.

### 12.4 1024 px

- Module tabs — горизонтальный scroll; высота ровно 48 px; scrollbar не перекрывает active underline.
- Все main views — одна content column.
- Filters — двухрядный responsive toolbar или collapsible panel; primary action остаётся справа/сверху и не входит в scroll.
- Detail panels становятся inline sections под selected item либо right-side sheet; запрещён постоянный 300 px aside рядом с таблицей.
- Timeline смен заменяется вертикальными shift cards; table может иметь собственный scroll, но first column sticky только если не перекрывает action column.
- Settings sections — горизонтальная row под tabs; content full width.
- Dialog max-width `min(640px, calc(100vw - 32px))`; max-height `calc(100dvh - 32px)`.

### 12.5 390 px

- App shell + module должны укладываться в CSS viewport `390px`; `document.documentElement.scrollWidth <= 390`.
- Module tabs: одна строка, horizontal scroll, tab `flex:none`, labels не обрезаются; активный tab прокручивается в видимую область.
- Page padding `12px`; card gap `8–12px`.
- Heading/actions stack; primary action width `100%`.
- KPI: 1 column; допускается 2 columns только если каждый tile `>=164px` и текст не переполняется.
- Все multi-column panels становятся 1 column.
- Selected equipment image `64–80px`; текстовая колонка `min-width:0`.
- Tables предпочтительно преобразуются в labelled cards. Если table scroll сохранён, wrapper занимает `100%`, critical actions вынесены над/под wrapper.
- Filters открываются в sheet; summary показывает active chips + count; `Сбросить` всегда виден.
- Dialog становится bottom/full-height sheet: width `100%`, max-height `100dvh`, footer sticky и учитывает `env(safe-area-inset-bottom)`.
- Footer action buttons stack, каждый `min-height:44px`; destructive primary последняя в DOM/visual order.
- Role strip — четыре последовательные cards без стрелок.
- Ни один fixed/sticky элемент не перекрывает последний focusable control; main получает нижний padding равный высоте sticky footer + safe area.

## 13. Точные проверки отсутствия наложений

Проверки выполняются при viewport `1440×900`, `1280×800`, `1024×768`, `390×844`, zoom `100%`, затем `200%` для desktop a11y smoke.

### 13.1 Глобальные геометрические инварианты

Для каждого viewport и каждой из 7 вкладок:

```js
expect(document.documentElement.scrollWidth)
  .toBeLessThanOrEqual(document.documentElement.clientWidth);
```

Исключение проверяется только внутри allowlisted scroll containers:

```text
[data-scroll-region="module-tabs"]
[data-scroll-region="settings-sections"]
[data-scroll-region="data-table"]
```

Для каждого видимого interactive element:

```js
const r = el.getBoundingClientRect();
expect(r.width).toBeGreaterThan(0);
expect(r.height).toBeGreaterThan(0);
expect(r.left).toBeGreaterThanOrEqual(0);
expect(r.right).toBeLessThanOrEqual(viewport.width);
```

Элементы внутри allowlisted horizontal scroll region проверяются после `scrollIntoView({block:'nearest', inline:'nearest'})`.

Пары sibling panels не пересекаются:

```js
const intersects = !(
  a.right <= b.left || b.right <= a.left ||
  a.bottom <= b.top || b.bottom <= a.top
);
expect(intersects).toBe(false);
```

Проверять: filter/main/detail, list/aside, settings-nav/settings-main, dialog-body/dialog-footer, sticky-header/first-focusable.

### 13.2 Sticky/fixed

- bottom активной module tab bar `<=` top первого content block;
- top settings row `>=` bottom module tabs;
- sticky dialog footer top `>=` body scrollTop boundary и не перекрывает последний field после scroll-to-bottom;
- последний focusable элемента страницы после `scrollIntoView()` имеет bottom `<= viewport.height - safeFooterHeight`;
- z-index: dialog/backdrop > module tabs > settings row > content.

### 13.3 Текст и controls

- `scrollWidth <= clientWidth + 1` для buttons, badges, KPI labels, headings, table headers, кроме элементов с deliberate ellipsis;
- deliberate ellipsis имеет доступное полное имя/description;
- button text не пересекается с icon/spinner;
- status badge не обрезает видимый status при 390 px;
- disabled reason доступна без hover.

### 13.4 Viewport-specific acceptance

`1440`:

- все семь tabs полностью видимы при доступной module width `>=1180`;
- три колонки Центра не пересекаются, center width `>=480`;
- detail panel Техники width `>=290`.

`1280`:

- при двухколоночном Центре main width `>=480`;
- перенос right aside не меняет DOM/action order;
- module tab user controls оболочки не перекрывают tabs.

`1024`:

- отсутствует page-level X-scroll;
- ни один persistent side panel не уменьшает main ниже `640px`;
- settings section row не переносится на вторую строку;
- shift actions доступны без прокрутки timeline по X.

`390`:

- `scrollWidth === clientWidth` страницы;
- module/settings rows остаются единственными nav X-scroll regions;
- primary action полностью видим и имеет высоту `>=44`;
- открытый sheet/dialog имеет `left=0`, `right=390` с tolerance 1 px;
- on-screen keyboard/`visualViewport` не скрывает focused input и submit footer;
- горизонтальный swipe content не требуется для выполнения critical workflow.

## 14. Acceptance checks по состояниям и сценариям

### 14.1 Структура

- DOM содержит ровно 7 module tabs в утверждённом порядке.
- Settings содержит ровно 7 subsection controls в утверждённом порядке.
- Нет второго product logo/nav/user menu внутри модуля.
- Каждая tab/section имеет unique accessible name и связанный panel.

### 14.2 URL

- Для каждой list tab: применить общие и контекстные filters → reload → state идентичен.
- Back/forward восстанавливает filters, selection и detail.
- Reset удаляет только scoped filter params.
- Invalid enum нормализуется без error screen.
- UI count/list и CSV соответствуют одному filter fixture.

### 14.3 Role/state

Для `ADMIN`, `MECHANIC`, `DISPATCHER`:

- allowed action видна и выполняется;
- prohibited action не выглядит доступной;
- expected disabled action имеет причину;
- прямой API bypass даёт server `403`;
- ADMIN mechanic action маркирован и записывается с `actingAs=MECHANIC`.

### 14.4 Commands

- double click создаёт одну mutation;
- retry same payload использует тот же idempotency key;
- новый/изменённый payload использует новый key;
- command отправляет expected version;
- success согласованно обновляет list, detail, snapshot;
- `422` сохраняет dialog и показывает blockers/correcting actions;
- `409` refetches current state и показывает actor/time/version;
- network error не отображает финальный success.

### 14.5 Domain scenarios

- start двух смен одной техники: один success, один `409`, UI второго открывает active shift.
- accept передачи двумя диспетчерами: один success, второй видит accepted actor/time.
- NORMAL permit: одно валидное dispatcher approval.
- ELEVATED permit: два approvals разных users/roles; self-approval невозможно.
- substantive edit после approval: version increment, approvals invalid, state DRAFT.
- blocker on: start без permit → `422`; blocker/action отображены.
- blocker off: start разрешён, warning остаётся видимым.
- snapshot после каждого из 7 trigger types обновляет timestamp/rule version/evidence.
- timezone boundary DAY/NIGHT и production date отображается по tenant timezone.

### 14.6 A11y

- keyboard-only проходит все главные сценарии;
- focus нигде не теряется после render/mutation/dialog;
- Escape/Tab/Shift+Tab корректны;
- status не различается только цветом;
- automated WCAG scan не содержит critical/serious issues;
- screen-reader smoke объявляет loading, error, conflict, success ровно один раз;
- 200% zoom не создаёт page-level X-scroll и не перекрывает critical actions.

## 15. Test hooks

Использовать стабильные semantic selectors; `data-testid` добавлять только там, где role/name недостаточны:

```text
tech-readiness-module
module-tabs
module-tab-{view}
view-panel-{view}
settings-sections
settings-section-{section}
shared-filters
filter-reset
equipment-list
equipment-detail
current-snapshot
blockers-list
warnings-list
command-dialog
command-submit
conflict-dialog
live-region
```

Не кодировать в test ID роль, визуальный цвет, индекс строки или translated status label.

## 16. Соответствие текущей реализации и production gap

Сохраняются:

- `ReferenceView`, `SettingsSection`, утверждённые `VIEW_ITEMS/SETTINGS_ITEMS`;
- `ToModule` как boundary;
- существующие дизайн-токены, карточки, KPI и responsive primitives;
- текущий URL `view/section/equipmentId` как совместимая основа;
- текущий `ReadinessReferenceUi` как визуальная декомпозиция, которую следует разнести на query/feature компоненты без изменения 7+7 структуры.

Production-доработка обязана заменить:

- local/mock-derived shifts, permits, permissions и audit на PRD endpoints/read models;
- статические/необработанные buttons на команды с RBAC/state gates;
- локальную CSV-сборку audit на server export;
- client-only фильтры на URL/API/CSV-aligned query model;
- общие toast errors на scoped `403/409/422` states;
- legacy view aliases для maintenance на отдельный `maintenanceSection`;
- произвольное `toLocaleString` без явной tenant timezone на единый formatter;
- ширинные таблицы как единственный mobile workflow на card/contained-scroll presentation;
- `aria-pressed` навигацию module tabs на полноценную tab semantics.

## 17. Definition of Done UI

UI считается готовым, когда:

1. все требования разделов 3–14 реализованы;
2. ни одна из 7 вкладок и 7 settings sections не является placeholder;
3. все команды имеют server-driven capability, pending/success/error/conflict handling;
4. URL/filter/CSV contract подтверждён integration/E2E;
5. role/state/domain scenarios PRD проходят;
6. geometry/overlap suite зелёный на 1440/1280/1024/390 и 200% zoom;
7. keyboard/screen-reader/a11y checks зелёные;
8. прошлые snapshots и audit history не изменяются UI-командами;
9. интерфейс не заявляет неподтверждённую готовность или целостность;
10. visual review подтверждает соответствие утверждённой композиции без дублирования shell/navigation.
