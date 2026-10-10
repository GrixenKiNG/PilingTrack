# AU178-S5-AUDIT-LOG-COVERAGE: Журнал аудита — покрытие действий

Версия кода (HEAD): `52e40a9a9ca04f2803e2cd03f3c9cdc993b4f4ae`
Ветка: `hermes/q4-0926` (git worktree `D:\PillingR\wt-night`). Только чтение; изменённых файлов приложения нет.

## Итог

Проверено 52 точки записи в аудит по коду. Все ключевые действия владельца из задания закрыты: создание/удаление пользователей, смена роли, допуски к технике, закрытие смены — след есть.

Главное, что нужно понимать владельцу: в системе ДВА непересекающихся журнала. «Лента» в /admin (`FeedbackEvent`) и «журнал готовности» (`AuditLog` с хеш-цепочкой) пишутся разным кодом и не видят друг друга. Поэтому «пишется ли в журнал» — вопрос про конкретный журнал, а не один.

Найдено: критично — 0; важно — 4; мелочь — 8. Всего 12 выводов (таблица «Находки»).

Топ-5 по важности:
1. Происшествие с телефона (в т.ч. с пострадавшим) не пишет НИ В ОДИН журнал (`incidents.ts:79`).
2. Выдача/отзыв ключа устройства телеметрии — без следа (`device-keys/route.ts:85,160`).
3. Старт смены (приём установки) и «работы закончены» — без следа (`equipment.ts:89`, `shift-close.ts:23`).
4. События контура готовности (смена, допуски work-permit, дефекты, матрица доступа, правила готовности) в ленту /admin вообще не попадают — только в отдельный журнал готовности.
5. Смена пароля пользователя в ленте неотличима от любой другой правки (`user-service.ts:306-315`).

## Методика

Всё выполнено командами из корня репозитория; существующие отчёты в `docs/audits/` не читались.

1. Точки записи аудита (грепом по имени функции создания события):
   `rg -n "recordAuditEvent\(|recordFeedbackEvent\(|writeReportAuditRow\(|recordChainedReadinessAudit\(|recordAuditLog\(|\.auditLog\.create\(" src --glob '!**/__tests__/**' --glob '!**/*.test.*' -l`
2. Инфраструктура журнала: `src/services/audit/audit-service.ts` (лента), `src/services/feedback/feedback-event-service.ts`, `src/modules/readiness/infrastructure/audit/*` (чейн), модель `AuditLog` — `prisma/schema.prisma:2573`.
3. Пересечение маршрутов и аудита: список маршрутов с `withMutation`, из него — те, где нет ни одного вызова записи аудита:
   `for f in $(rg -l "withMutation" src/app/api --glob '!**/__tests__/**'); do rg -q "recordAuditEvent|recordChainedReadinessAudit|writeReportAuditRow|recordAudit\b" "$f" || echo "$f"; done`
   Каждый такой маршрут затем открыт вручную (проверка, не пишет ли аудит вызываемый сервис).
4. Точечное чтение: `sed -n 'A,Bp' файл` и `read_file` по файлам пользователей, допусков, смен, оператор-мобильных команд.
5. Пользователи и допуски: чтение `src/services/users/user-service.ts`, `src/app/api/users/route.ts`, `src/app/api/safety/equipment-permits/route.ts`, `[id]/route.ts`.
6. Смены: `src/modules/operator-mobile/application/commands/shift-close.ts`, `equipment.ts`, `incidents.ts`; `src/modules/readiness/application/shifts/commands.ts`; `src/modules/readiness/application/scheduler.ts`.
7. Проверка консьюмеров ленты: `src/components/piling/feedback-center.tsx:119` (`/api/feedback/events`) против журнала готовности (`/api/readiness/audit`).

## Таблица покрытия (действие | файл:строка | пишется ли | поля)

ЖУРНАЛ — куда пишется: «лента» = `FeedbackEvent` (виден в /admin), «чейн» = `AuditLog` (журнал готовности), «ReportAudit» = история отчёта.

| Действие | Файл:строка | Пишется | Журнал | Поля / действие |
|---|---|---|---|---|
| Создание пользователя | src/services/users/user-service.ts:177-187 | Да | лента | `user.created`; actorId, targetId; metadata{email, role, isActive} |
| Изменение пользователя (роль, блокировка, пароль, ФИО, email, телефон) | src/services/users/user-service.ts:306-315 | Да | лента | `user.updated`; metadata{before{id,email,name,phone,role,isActive}, after{…}} |
| Смена роли (изменение прав) | src/services/users/user-service.ts:306-315 (текст — audit-service.ts:625-636) | Да | лента | переход «роль: X → Y» в тексте + before/after.role |
| Удаление пользователя | src/services/users/user-service.ts:368-377 | Да | лента | `user.deleted`; metadata{email, role} |
| Вид документа работника (создать/изменить/удалить) | src/services/users/user-document-types.ts:83,124,151 | Да | лента | `user.document_type.created/updated/deleted` |
| Документ работника (создать/изменить/удалить) | src/services/users/user-documents.ts:233 | Да | лента | `user.document.created/updated/deleted`; признак selfService |
| Допуск к технике выдан/изменён | src/app/api/safety/equipment-permits/route.ts:90-97 | Да | лента | `user.equipment_permit.saved`; metadata{permitId, equipmentKind, status, …} |
| Допуск к технике удалён | src/app/api/safety/equipment-permits/[id]/route.ts:29-35 | Да | лента | `user.equipment_permit.deleted` |
| Матрица доступа (готовность): черновик/публикация | src/modules/readiness/application/access-matrix-service.ts:135 (вызовы 187,229) | Да | чейн | action `draft_saved` / `published`, before/after |
| Правила готовности: черновик/публикация | src/modules/readiness/application/readiness-rules-service.ts:132,162,259 | Да | чейн | action `draft_saved` / `published` |
| Закрытие смены (мобильный контур) | src/modules/operator-mobile/application/commands/shift-close.ts:204 | Частично | ReportAudit + лента | ReportAudit `submitted` в транзакции; лента `ReportSubmitted` — асинхронно через outbox→воркер |
| Сдача отчёта (контур готовности) | src/modules/operator-mobile/application/commands/shift-close.ts:279 → :204 | Да | ReportAudit + лента | то же, что закрытие (общая `submitShiftReport`) |
| Передача смены (handover) | src/modules/readiness/application/shifts/commands.ts:353,421 | Да | чейн | `shift.submitted` / `handover.accepted` / `handover.rework-requested` |
| Старт / отмена / отклонение смены (готовность) | src/modules/readiness/application/shifts/commands.ts:202,296,312 | Да | чейн | `shift.started` / `acceptance-declined` / `cancelled` |
| Автозакрытие смены планировщиком | src/modules/readiness/application/scheduler.ts:178 | Да | чейн | `shift.auto-closed`; before/after, actor=SCHEDULER |
| Истечение допуска work-permit (планировщик) | src/modules/readiness/application/scheduler.ts:140 | Да | чейн | `work-permit.expired` |
| Допуск work-permit (создать/изменить/сдать/утвердить/отозвать) | src/modules/readiness/application/permits/commands.ts:74 | Да | чейн | `work-permit.created/updated/submit/approve/revoke` |
| Дефект (заявлен/разбор/закрыт/отклонён) | src/modules/readiness/application/defects/commands.ts:71 | Да | чейн | `defect.reported/triage/resolve/reject` |
| Старт смены — приём установки (мобильный) | src/modules/operator-mobile/application/commands/equipment.ts:89 | Нет | — | — |
| Окончание работ (finish-work) | src/modules/operator-mobile/application/commands/shift-close.ts:23 | Нет | — | — |
| Происшествие с телефона (в т.ч. с пострадавшим) | src/modules/operator-mobile/application/commands/incidents.ts:79 | Нет | — | — |
| Разбор происшествия из админки | src/app/api/admin/incidents/route.ts:131 | Да | лента | `incident.reviewed` |
| Ключ устройства телеметрии: выдача | src/app/api/equipment/[id]/device-keys/route.ts:85 | Нет | — | — |
| Ключ устройства телеметрии: отзыв | src/app/api/equipment/[id]/device-keys/route.ts:160 | Нет | — | — |
| Объект: создан/изменён/удалён/выполнен | src/modules/sites/application/commands/site-admin-command.service.ts:129,229,271,312; site-command.service.ts:57,88,118 | Да | лента | `site.created/updated/deleted/completed/…` |
| Закрепление/открепление сотрудника за объектом | src/modules/sites/application/commands/site-admin-command.service.ts:325,340 | Да | лента | `site.user_assigned` / `site.user_unassigned` |
| Схема объекта: поле/куст/пикет | src/app/api/sites/[id]/hierarchy/route.ts:81,127 | Да | лента | `site.hierarchy.created` / `deleted` |
| Бригады: создана/изменена/расформирована | src/modules/crews/application/commands/crew-command.service.ts:199,322,363 | Да | лента | `crew.created/updated/deleted` |
| Справочники (сваи, бурение, простои) | src/services/dictionaries/dictionary-service.ts:109,117,125,275,320,339,366,396,420 | Да | лента | `dictionary.*` |
| Настройки организации | src/app/api/settings/route.ts:48 | Да | лента | `settings.updated`; changedSettingsFields |
| Каналы оповещений Telegram | src/app/api/telegram/configs/route.ts:79,117,163 | Да | лента | `telegram.config.created/updated/deleted` |
| Техника: карточка | src/app/api/equipment/route.ts:84; src/app/api/equipment/[id]/route.ts:110,151 | Да | лента | `equipment.created/updated/retired/deleted` |
| Техника: моточасы, топливо, документы, регламенты, наряды ТО | src/app/api/equipment/[id]/meter-readings/route.ts:113; fuel/route.ts:107; documents/route.ts:51; maintenance-plans/route.ts:72; equipment/[id]/maintenance/route.ts:80 | Да | лента | `meter.reading.*`, `equipment.fuel.*`, `equipment.document.*`, `maintenance.*` |
| Наряд ТО принят | src/app/api/maintenance/[id]/accept/route.ts:35 | Да | лента | `maintenance.accepted` |
| Осмотры: начат / ответы / завершён | src/modules/inspections/application/commands/inspection-commands.ts:176,216; src/app/api/inspections/[id]/complete/route.ts:75 | Да | лента | `inspection.started/answers_saved/completed` |
| Шаблоны осмотров | src/app/api/checklist-templates/route.ts:77; [id]/route.ts:83,107 | Да | лента | `inspection.template.created/replaced/deactivated` |
| Инструктажи | src/app/api/briefings/route.ts:59; [id]/sign/route.ts:33 | Да | лента | `briefing.conducted` / `briefing.signed` |
| Вход/выход/ПИН | src/app/api/auth/login/route.ts:57,73,84; logout/route.ts:26 | Да | лента | `auth.login.succeeded/failed/rate_limited`, `auth.logout` |
| Решение мастера по свае | src/app/api/pile-passports/[id]/decide/route.ts:67 | Да | лента | `pile.passport.decided` |
| Отчёт: создан/изменён | src/modules/reports/application/commands/report-command.service.ts:323,334 | Да | ReportAudit + лента | `report.created/updated` |
| Отчёт удалён | src/app/api/reports/delete/route.ts:185 | Да | лента | `report.deleted` (recordFeedbackEvent напрямую) |
| Пересборка проекций | src/app/api/admin/projections/rebuild/route.ts:72 | Да | лента | `projections.rebuilt` |
| DLQ: повтор/отмена | src/app/api/admin/dlq/route.ts:129,136 | Да | лента | `dlq.retried` / `dlq.discarded` |
| Вложение удалено | src/app/api/media/[id]/route.ts:36 | Да | лента | `media.deleted` |
| Вложение загружено/подтверждено | src/app/api/media/route.ts:19; media/[id]/confirm/route.ts:8 | Нет | — | — |
| Тестовая отправка в Telegram | src/app/api/notifications/telegram/test/route.ts:24 | Нет | — | — |
| Раскладка интерфейса (сохранить/удалить) | src/app/api/layout/[surfaceId]/route.ts:50,76 | Нет | — | — |
| Шаблон мониторинга | src/app/api/monitoring/template/route.ts:25 | Нет | — | — |
| Личные подсказки мест работ | src/app/api/readiness/place-presets/route.ts:32,91 | Нет | — | — |
| Помощник: прочитать инструктаж / пройти тест знаний | src/app/api/assistant/command/route.ts:33 | Нет | — | — |
| Оператор: осмотр-чеклист с телефона | src/modules/operator-mobile/application/commands/checklist.ts (submitChecklist) | Нет | — | — |
| Оператор: подтверждение СИЗ | src/modules/operator-mobile/application/commands/admission.ts:209 (confirmPpe) | Нет | — | — |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | важно | src/modules/operator-mobile/application/commands/incidents.ts:79 | Происшествие с телефона (в т.ч. с пострадавшим) не пишет ни в ленту, ни в чейн, ни в ReportAudit | `reportIncident` создаёт `SafetyIncident`, снимок готовности и алерт — и на этом всё. Разбор происшествия (admin/incidents) в ленту пишется (`incident.reviewed`), а сам факт заявления — нет. При разборе невозможно доказать, кто и когда заявил происшествие, если строка SafetyIncident изменится | Добавить `recordAuditEvent({action:'incident.reported', …})` после создания строки (уровень warn при stopRequired) |
| 2 | важно | src/app/api/equipment/[id]/device-keys/route.ts:85,160 | Выдача и отзыв ключа устройства телеметрии — без следа | `provisionDeviceKey`/`revokeDeviceKey` дают/снимают доступ устройства к данным организации; кто выдал или отозвал ключ, нигде не остаётся | Писать `recordAuditEvent` (лента) на provision и revoke с name/equipmentId |
| 3 | важно | src/modules/operator-mobile/application/commands/equipment.ts:89; .../shift-close.ts:23 | Старт смены (создание Shift в accept-equipment) и «работы закончены» (finish-work) не логируются | Смена начинается и переводится в HANDOVER_PENDING без следа; в ленте виден только финал (сдача отчёта). Пропущенное начало/окончание не восстановить | Писать событие на старт и на finish-work (лента или чейн, как у остальных сменных переходов) |
| 4 | важно | src/services/audit/audit-service.ts:1004 (лента) против src/modules/readiness/infrastructure/audit/audit-repository.ts:45 (чейн) | Два журнала не пересекаются: лента /admin (`FeedbackEvent`) и журнал готовности (`AuditLog`) пишутся разным кодом | Все события контура готовности (старт/сдача/отмена/автозакрытие смены, допуски work-permit, дефекты, матрица доступа, правила готовности) в ленту /admin не попадают вовсе; события ленты не попадают в чейн. Лента /admin — это `feedback-center.tsx:119` → `/api/feedback/events`; журнал готовности — `/api/readiness/audit`. Владелец, читающий только /admin, не видит половину событий | Либо объединить читаемые представления (один экран на оба источника), либо намеренно и явно описать владельцу, что журналов два и где какой |
| 5 | мелочь | src/services/users/user-service.ts:291-315 | Смена пароля отражается как `user.updated` без признака, что меняли пароль | В снимок `before/after` входят только {id,email,name,phone,role,isActive}; пароль не входит. Сброс пароля сотрудника в ленте выглядит как «Изменена учётная запись» без деталей | Добавить в metadata признак passwordChanged и выводить его в тексте `user.updated` |
| 6 | мелочь | src/app/api/media/route.ts:19; src/app/api/media/[id]/confirm/route.ts:8 | Загрузка и подтверждение вложения — без следа (удаление — есть) | `media.deleted` пишется (`media/[id]/route.ts:36`), а загрузка нет; вложение к отчёту/дефекту появляется без записи | Писать `media.created`/`media.confirmed` (низкий приоритет — объём) |
| 7 | мелочь | src/app/api/notifications/telegram/test/route.ts:24 | Тестовая отправка в Telegram не логируется | Изменения конфигов канала логируются (`telegram.config.*`), а тестовый прогон — нет; безвредно, но при разборе «кто дёргал бота» следа нет | Опционально: событие `telegram.config.tested` |
| 8 | мелочь | src/app/api/layout/[surfaceId]/route.ts:50,76 | Сохранение/удаление раскладки интерфейса — без следа | Пользовательские настройки вида; аудит-ценности почти нет | Оставить как есть, отметить намеренно |
| 9 | мелочь | src/app/api/monitoring/template/route.ts:25 | Шаблон мониторинга — без следа | То же, что п.8 | Оставить как есть |
| 10 | мелочь | src/app/api/readiness/place-presets/route.ts:32,91 | Личные подсказки мест работ — без следа | Список личный (только свой), решение владельца 16.08.2026 | Оставить как есть |
| 11 | мелочь | src/app/api/assistant/command/route.ts:33 | Помощник: прочитать инструктаж / пройти тест знаний — без следа | Смотрит `acknowledgeBriefing`, `submitKnowledgeTest`; важные инструктажи логируются отдельно (`briefing.signed`), факт прочтения помощником — нет | Опционально: событие о прохождении теста знаний |
| 12 | мелочь | src/modules/operator-mobile/application/commands/checklist.ts:69; .../admission.ts:209 | Осмотр-чеклист и подтверждение СИЗ с телефона — без следа | Чеклист-исполнения и СИЗ пишутся в свои таблицы, но без записи в журнал; для оператора, вероятно, приемлемо | Уточнить у владельца, нужен ли след |

Итого по severity: критично — 0; важно — 4; мелочь — 8.

## Что не проверено (НЕ ПРОВЕРЕНО / ГИПОТЕЗЫ)

- НЕ ПРОВЕРЕНО: фактическое содержимое БД (ни прод, ни локальной) — запрещено правилами; все выводы сделаны по коду.
- НЕ ПРОВЕРЕНО: реальный прогон записи аудита. Тестов не запускал (задача — только чтение кода плюс запрет менять файлы).
- НЕ ПРОВЕРЕНО (важно для п.3 таблицы покрытия): что воркер outbox действительно запущен в эксплуатации. Запись закрытия смены в ленту /admin идёт АСИНХРОННО через outbox→`emitDomainEvent`→`registerAuditEventHandler` (src/services/reports/event-handlers.ts:467). Если воркер не поднят, в ленте сдачи не будет, хотя ReportAudit уже записан. Проверял только путь в коде (`src/workers/embedded-workers.ts:142`, `src/app/api/route.ts:10`).
- НЕ ПРОВЕРЕНО: наличие в БД триггеров/RLS, делающих `AuditLog` строго append-only (читал только `prisma/schema.prisma:2573-2618` и миграции; поведение в рантайме не подтверждал).
- ГИПОТЕЗА: оценка важности находки №4 (два журнала) — архитектурная; возможно, разделение намеренно, но явного подтверждения в прочитанном коде нет.
- НЕ ПРОВЕРЕНО: серверная (не клиентская) ветка оператора в `src/app/(app)/operator/**` и другие варианты операторского экрана — замороженная зона, не разбирал.
- НЕ ПРОВЕРЕНО: контур `modules/readiness` целиком (снимки, bootstrap) на предмет побочных записей аудита, кроме явно найденных точек; разобраны только смены, допуски, дефекты, матрица доступа, правила готовности, планировщик.
