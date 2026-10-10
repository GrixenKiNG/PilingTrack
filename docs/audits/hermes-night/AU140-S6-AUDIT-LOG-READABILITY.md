# AU140-S6-AUDIT-LOG-READABILITY — Журнал аудита: читаемость записей

Версия (git rev-parse HEAD): `cd289bd4f47612c9d687e6a92d70c5344fd235ce`
Дата аудита: 10.10.2026. Работа только на чтение; код приложения не менялся.

## Итог

- Область: лента доказательного журнала «Настройки → Аудит» (`audit-section.tsx`) и её подписи (`audit-labels.ts`). Источник данных — цепочка `readChain` (`hash != null`).
- Действия без русской подписи в коде контура: **0** из 28 (все коды из `ACTION_LABEL` покрыты — ПРОЙДЕНО). Но подписи/иконки/фильтр разъезжаются с тем, что реально пишется в цепочку.
- «Кто/что/когда» показывается: время (`occurredAt`, пояс тенанта), автор (`actor.name`), действие (подпись), объект (тип). Полностью «что именно изменилось» — НЕ показывается.
- Всего находок: **13**. По важности: критично — 0, важно — 5, мелочь — 8.
- Топ-5:
  1. Тип объекта `ReadinessAccessMatrix` без подписи → в колонке «Объект» сырое «ReadinessAccessMatrix» (важно).
  2. Тип объекта `ReadinessActor` без подписи → сырое «ReadinessActor» (важно).
  3. Код `published` подписан «Опубликованы правила готовности», но тем же кодом публикуется матрица доступов → владелец читает чужой смысл (важно).
  4. Роль планировщика `SYSTEM` без подписи → в ленте сырое «SYSTEM» (важно).
  5. Лента не показывает, что изменилось (before/after), хотя цепочка это хранит и API это отдаёт (важно).

## Методика

Что и как искалось (можно перезапустить):

- Точка входа ленты: `src/components/piling/to/readiness/settings/audit-section.tsx` и подписи рядом — `audit-labels.ts`. DTO события — `src/components/piling/to/readiness/api/contracts.ts:309`.
- Кто пишет в ленту: читал `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` (отбор `hash: {not: null}`) и искал всех писателей цепочки: `grep -rn "record-audit\|append-audit" src` → 9 совпадений, все внутри контура готовности (список ниже).
- Коды действий собирал: `grep -rhoE "action: '[^']+'" src/modules/readiness/application src/app/api/readiness/export/route.ts | sort | uniq -c` (23 литерала; реальный код = префикс + литерал: `shift.` / `handover.` / `work-permit.` / `defect.`, см. `shifts/commands.ts:72`, `permits/commands.ts:75`, `defects/commands.ts`).
- Типы объектов: `grep -rhoE "entityType: '[^']+'"` по тем же файлам → 8 типов.
- Сверка с подписями — скриптом на node: ключи `ACTION_LABEL`/`ENTITY_LABEL`/`ACTION_MARK` против фактически записываемых кодов.

Писатели цепочки (все в контуре готовности): `src/modules/readiness/application/shifts/commands.ts:3`, `permits/commands.ts:3`, `defects/commands.ts:4`, `scheduler.ts:30`, `readiness-rules-service.ts:11`, `access-matrix-service.ts:20`, `bootstrap-query.ts:5`, `src/app/api/readiness/export/route.ts:3`. Других владельцев цепочки нет — значит лента показывает только действия контура.

### Таблица действий (action → подпись → что показано)

| action (что реально пишется) | русская подпись (`ACTION_LABEL`) | кто/что/когда в ленте | статус |
|---|---|---|---|
| `shift.created` `shift.updated` | «Смена запланирована» / «Смена изменена» | кто+что+когда | ПРОЙДЕНО |
| `shift.acceptance-requested` `shift.acceptance-declined` | «Запрошен допуск к работе» / «В допуске отказано» | кто+что+когда | ПРОЙДЕНО |
| `shift.started` `shift.start-blocked` `shift.start-waived` | «Смена допущена…» / «Запуск… заблокирован» / «Выдано разрешение на пуск» | кто+что+когда | ПРОЙДЕНО |
| `shift.cancelled` `shift.auto-closed` | «Смена отменена» / «Смена закрыта автоматически» | кто+что+когда (автор — «Планировщик техготовности», роль сырая `SYSTEM`) | важно (роль) |
| `handover.submitted` `handover.resubmitted` `handover.accepted` `handover.rework-requested` | «Смена передана…» / «Передача сдана повторно» / «Передача принята» / «Передача возвращена…» | кто+что+когда | ПРОЙДЕНО |
| `work-permit.created` `work-permit.updated` `work-permit.submit` | см. `audit-labels.ts:38-40` | кто+что+когда | ПРОЙДЕНО |
| `work-permit.approved-dispatcher` `work-permit.approved-admin` | «Наряд согласован диспетчером/администратором» | кто+что+когда | ПРОЙДЕНО |
| `work-permit.revoke` `work-permit.expired` | «Наряд отозван» / «Наряд-допуск истёк» | кто+что+когда | ПРОЙДЕНО |
| `defect.reported` `defect.triage` `defect.resolve` `defect.reject` | «Зафиксировано замечание» / … | кто+что+когда | ПРОЙДЕНО |
| `readiness.exported` | «Выгрузка данных готовности» | кто+что+когда (объект = `dataset:hash`) | ПРОЙДЕНО |
| `draft_saved` | «Черновик сохранён» (общий на правила и матрицу) | кто+что+когда | ПРОЙДЕНО |
| `published` | «Опубликованы **правила готовности**» | кто+что+когда, но подпись врёт для матрицы доступов | важно |
| `acting_as_mechanic` | «Включён режим замещения роли» | кто+что+когда (объект `ReadinessActor` сырой) | важно |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/to/readiness/settings/audit-labels.ts:66-76` (нет ключа) + `src/modules/readiness/application/access-matrix-service.ts:138` (пишет `entityType: 'ReadinessAccessMatrix'`) | Тип объекта матрицы доступов без русской подписи. `auditEntityLabel` возвращает `type` как есть (`audit-labels.ts:161-163`) → в колонке «Объект» сырое «ReadinessAccessMatrix». | Диспетчер в «Настройки → Аудит» читает изменение прав организации как «Опубликованы… · ReadinessAccessMatrix» — английский код вместо «Матрица доступов». | Добавить `ReadinessAccessMatrix: 'Матрица доступов'` в `ENTITY_LABEL`. |
| 2 | важно | `src/components/piling/to/readiness/settings/audit-labels.ts:66-76` + `src/modules/readiness/application/bootstrap-query.ts:117` (пишет `entityType: 'ReadinessActor'`) | Тип объекта записи о замещении роли без подписи → сырое «ReadinessActor». | Запись «Включён режим замещения роли» показывает объект «ReadinessActor» — код вместо «Сотрудник». | Добавить `ReadinessActor: 'Сотрудник'` в `ENTITY_LABEL`. |
| 3 | важно | `src/components/piling/to/readiness/settings/audit-labels.ts:59` (`published: 'Опубликованы правила готовности'`) + `src/modules/readiness/application/access-matrix-service.ts:137,187,229,243` | Один код `published` пишут И правила готовности (сущность `ReadinessRuleSet`), И матрица доступов (`ReadinessAccessMatrix`). Подпись называет только правила. | Публикация новых прав в «Роли и доступы» читается в журнале как «Опубликованы правила готовности» — владелец видит не то, что произошло. | Либо развести коды (`rules.published` / `access-matrix.published`), либо сделать подпись нейтральной («Опубликовано изменение настроек»). Комментарий в `audit-labels.ts:55-57` уже декларирует «подпись без имени объекта» — но строка 59 имя содержит. |
| 4 | важно | `src/components/piling/to/readiness/handover-journal.ts:39-47` (нет `SYSTEM`) + `src/modules/readiness/application/scheduler.ts:39` (`role: 'SYSTEM'`) + `src/components/piling/to/readiness/settings/audit-section.tsx:127,174` | Роль планировщика `SYSTEM` не имеет подписи; `handoverRoleLabel('SYSTEM')` возвращает код как есть → мелким текстом под «Планировщик техготовности» печатается «SYSTEM». | Ночные события (автозакрытие смены, истечение наряда) — самые важные для разбора — читаются с английской ролью. | Добавить `SYSTEM: 'Система'` (или `'Планировщик'`) в `ROLE_LABEL`. |
| 5 | важно | `src/components/piling/to/readiness/api/contracts.ts:309-319` (DTO без before/after) + `src/components/piling/to/readiness/settings/audit-section.tsx:172-181` (панель деталей без изменений) + `src/modules/readiness/infrastructure/audit/audit-repository.ts:131-133` (before/after/metadata читаются) | Лента не показывает, ЧТО изменилось внутри действия. Цепочка хранит `before`/`after`, API их отдаёт (в `data` уходят те же `StoredAuditEvent`, роут не срезает поля — `src/app/api/readiness/audit/route.ts:44`), но DTO и панель деталей их не читают. | «Смена изменена», «Наряд-допуск изменён», «Включён режим замещения роли» не показывают, какую роль выдали/что поменяли. Для доказательного журнала это ключевой вопрос разбора. | Расширить `ReadinessAuditEventDto` (before/after/metadata) и вывести хотя бы «было → стало» для ключевых действий. |
| 6 | мелочь | `src/components/piling/to/readiness/screens/shared.tsx:154-160` | Список фильтра «Тип события» строится из `ACTION_LABEL` + `ENTITY_LABEL`. Значит: (а) предлагает типы `Equipment`, `Inspection`, `MaintenanceRecord` («Установка», «Осмотр», «Обслуживание»), которых в цепочке не бывает → «ничего не найдено»; (б) не даёт отфильтровать два реально записываемых типа (`ReadinessAccessMatrix`, `ReadinessActor`). | Диспетчер выбирает «Осмотр» и получает пустой журнал — читает это как пропажу данных. | Строить список из фактически записываемых типов/кодов (общий источник с писателями), а не из всех ключей подписей. |
| 7 | мелочь | `src/components/piling/to/readiness/settings/audit-section.tsx:60-66` + `src/app/api/readiness/audit/route.ts:26,44` | Плитка «Всего в журнале» — по всей цепочке (`verification.eventCount`), а «Событий за 24 ч» и «Критических действий» — по загруженной выборке (≤ `limit`, по умолчанию 200). Области счёта разные, подписи одинаковые. | На большой цепочке критичных действий насчитывается меньше, чем есть. | Считать все KPI по одному множеству (вся цепочка), либо подписать «за загруженный период». |
| 8 | мелочь | `src/components/piling/to/readiness/settings/audit-labels.ts:110-143` (`ACTION_MARK` без `draft_saved`), fallback — `:150-155` | У `draft_saved` нет собственного значка → срабатывает запасная ветка `{CheckCircle2, tone:'success'}`. Черновик матрицы/правил рисуется зелёной галочкой «успех», как подтверждённое действие. | В плотной ленте «Черновик сохранён» неотличим по значку от результата. | Добавить `draft_saved: {icon: Pencil, tone: 'warning'}` в `ACTION_MARK`. |
| 9 | мелочь | `src/components/piling/to/readiness/settings/audit-section.tsx:127,174` | Показывается только исполняемая роль: `handoverRoleLabel(actor.actingAs \|\| actor.role)`. Собственная роль (например, ADMIN, действующий как Мастер) и сам факт замещения в ленте не видны. | По записи «Согласовано от имени мастера» нельзя понять, что действовал администратор. | Показывать «Мастер (за администратора)» или отдельную метку замещения рядом с ролью. |
| 10 | мелочь | `src/components/piling/to/readiness/settings/audit-section.tsx:135,177` | Объект выводится как `entity.id.slice(0, 12)` — усечённый UUID без человекочитаемого имени. | «Наряд-допуск · a1b2c3d4e5f6» нельзя сопоставить с объектом на экране; «что» читается слабо. | Подтягивать имя установки/заголовок наряда (или добавлять его в DTO). |
| 11 | мелочь | `src/components/piling/to/readiness/settings/audit-section.tsx:152` | В мобильной карточке важность зашита литералами `'Критично'`/`'Обычное'`, а не `auditImportanceLabel(action)` (как в десктопной строке, стр. 137). | При изменении подписи важности тексты десктопа и мобильной версии разойдутся. | Использовать `auditImportanceLabel(action)` и в мобильной ветке. |
| 12 | мелочь | `src/components/piling/to/readiness/settings/audit-section.tsx:52-57` | Клиентский поиск ищет по подписи действия, подписи объекта, имени автора и сырому коду `action` — но не по роли и не по `entity.id`. | Поиск «Мастер» или по имени объекта ничего не найдёт, хотя фильтр «Кто изменил» роль учитывает (`route.ts:40`). | Искать также по `handoverRoleLabel(role)` и `entity.id`. |
| 13 | мелочь | `src/components/piling/to/readiness/settings/audit-labels.ts:157-159` | Неизвестный код действия показывается сырым (по задумке). Сейчас таких кодов в контуре нет (0 из 28), но любое будущее действие появится в ленте английским кодом, пока его не добавят в обе таблицы. | Латентный риск: новый код планировщика/команды снова «утечёт» в журнал кодом. | Держать тест `audit-labels.test.ts` (`CONTOUR_ACTIONS`) синхронным с писателями; падать на новом коде без подписи. |

## Не проверено

- **Живой рендер в браузере.** Оценка «кто/что/когда показывается» сделана по коду (`audit-section.tsx`), без запуска приложения (нет доверенной БД/окружения для этого аудита). Статус выводов — на уровне кода.
- **Реальные данные в цепочке.** Не проверял, нет ли в боевой БД исторических кодов действий от уже удалённого кода (цепочка только читается, БД недоступна). Если такие есть — они тоже показываются сырыми, и в таблицу действий они не попали.
- **Полнота `ACTING_ROLE`/ролей.** Сверял только семь ролей из `handover-journal.ts:39-47` и `SYSTEM`; есть ли другие коды ролей у писателей — не проверял построчно по всем командам.
- **Причина расхождения комментария и подписи `published`** (`audit-labels.ts:55-59`, комментарий обещает «подпись без имени объекта», строка содержит «правила готовности») — ГИПОТЕЗА: похоже на недоделанное намерение; историю правки не смотрел (в `docs/audits/` правилом запрещено).
- **Значения before/after на проводе** подтверждены чтением роута (`route.ts:44`) и репозитория, но реальный JSON-ответ я не снимал; если где-то есть срезающий сериализатор — находка №5 меняется.
- **CSV-экспорт** (`settings-workspace.tsx:126`) не аудировал детально: заметно, что колонка «Действие» использует `auditActionLabel` (хорошо), а дата — сырой ISO `event.occurredAt` (не проверено, ожидаемо ли это в выгрузке).
