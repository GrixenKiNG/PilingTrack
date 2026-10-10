# AU194-S5: Массовые действия (удаление, архивирование, импорт) — защита

Версия: `git rev-parse HEAD` = **8538164612c1942f03a807f463db7cc677d5f6d5**
(ветка `hermes/q4-0926`). Ревью кода приложения не менялся; создан только этот файл.

Статусы ниже: ПРОЙДЕНО — проверено по коду с открытием строки; НЕ ПРОВЕРЕНО — не подтверждено; ГИПОТЕЗА — вывод, который нельзя утверждать как факт.

## Итог

- Массовых операций в системе немного, и почти все — «веер» из одиночных запросов на клиенте либо фоновые планировщики; единого серверного механизма «массовое действие» (подтверждение + лимит + откат + одна запись аудита) в коде нет.
- 1 важно: массовая архивация справочников — клиент шлёт N параллельных PATCH (Promise.all), серверного bulk-эндпоинта, лимита и транзакции нет; при >100 записях часть упадёт по rate-limit (429), результат — частичное архивирование с двумя числами в тосте.
- 1 важно: массовое восстановление справочников — то же веерное поведение, но вовсе без подтверждения.
- 1 важно: удаление узла схемы объекта (поле/куст/пикет) каскадно сносит поддерево и **не пишет событие аудита** — единственный массовый снос строк без следа.
- 1 важно: у массовых операций нет ни одного места, где применяется «откат» — есть только одиночная отмена в тосте для одного справочника; для фактически разрушительных операций отката нет нигде.
- 4 находки по контролю (лимиты/подтверждения), остальное — положительные образцы (планировщик готовности, backfill, матрица доступов) и «импорта нет вовсе».

Топ-5:
1. `src/components/piling/admin-dictionaries.tsx:371` — массовая архивация веером PATCH, без серверного лимита/транзакции → частичное выполнение + обрыв на 429 (важно).
2. `src/modules/sites/application/commands/site-admin-command.service.ts:438` — каскадное удаление узла схемы без события аудита (важно).
3. `src/components/piling/admin-dictionaries/dictionary-table.tsx:87` — массовое восстановление без подтверждения (важно).
4. Все массовые действия не имеют отката; только `dictionary-table.tsx:356` (одиночная архивация) даёт «Отменить» в тосте (важно).
5. Экспорт ограничен (`reports/export/route.ts:12` — 92 дня; `media/download-batch/route.ts:28` — 100 id; `telemetry/batch/route.ts:34` — 100 записей), но серверного лимита на массовое **изменение/удаление** нет (важно).

## Методика

Поиск по репозиторию (`D:\PillingR\wt-night`, только `src/`) с последующим чтением найденных файлов целиком:

- `search_files` (rg) по шаблонам: `deleteMany|updateMany|createMany|bulk|batch|массов`; `selectAll|selectedIds|Выбрать все|массов|bulk`; `[Ии]мпорт|importFile|parseImport|XLSX|FormData|read-excel|csv-parse`; `purge|cleanup|retention`; `z\.array\(|ids:|reportIds`; перечень `export const (DELETE|PUT|PATCH|POST)` в `src/app/api`.
- Прочитаны ключевые файлы (полный путь от корня): `src/app/api/reports/delete/route.ts`, `src/app/api/dictionary/manage/route.ts`, `src/app/api/admin/incidents/route.ts`, `src/app/api/admin/dlq/route.ts`, `src/app/api/admin/projections/rebuild/route.ts`, `src/app/api/maintenance-plans/run/route.ts`, `src/app/api/media/download-batch/route.ts`, `src/app/api/telemetry/batch/route.ts`, `src/app/api/reports/export/route.ts`, `src/app/api/reports/pdf/route.ts`, `src/app/api/crews/[id]/route.ts`, `src/app/api/readiness/place-presets/route.ts`, `src/app/api/readiness/access-matrix/route.ts`, `src/core/api-wrapper.ts`, `src/core/security/idempotency.ts`, `src/services/dictionaries/dictionary-service.ts`, `src/services/dictionaries/dictionary-table` (клиент — см. ниже), `src/components/piling/admin-dictionaries.tsx`, `src/components/piling/admin-dictionaries/dictionary-table.tsx`, `src/components/piling/admin-reports/admin-reports.tsx`, `src/components/piling/to/readiness/settings/roles-section.tsx`, `src/components/piling/layout-editor/layout-editor.tsx`, `src/modules/sites/application/commands/site-admin-command.service.ts`, `src/modules/crews/application/commands/crew-command.service.ts`, `src/modules/equipment/application/commands/pm-scheduler.ts`, `src/modules/readiness/application/scheduler.ts`, `src/modules/readiness/application/backfill/backfill-service.ts`, `src/app/api/__tests__/mutation-audit.test.ts`.

Как повторить: те же `rg`-шаблоны по `src/` и чтение перечисленных файлов; для проверки «есть ли импорт» — `rg "FormData|XLSX|read-excel|parseImport|Загрузить файл" src/` (даёт только выгрузку и ORION-форму).

## Находки

Сводная таблица «операция | файл:строка | защита | риск». Пути — полные от корня.

| Операция | файл:строка | Подтверждение | Лимит размера | Откат | Аудит |
|---|---|---|---|---|---|
| Массовая архивация справочников | `src/components/piling/admin-dictionaries.tsx:371` | да, с числом (`dictionary-table.tsx:291`) | НЕТ | НЕТ | N записей (по одной на PATCH) |
| Массовое восстановление справочников | `src/components/piling/admin-dictionaries/dictionary-table.tsx:87` | НЕТ | НЕТ | НЕТ | N записей |
| Удаление узла схемы объекта (поле/куст/пикет) | `src/modules/sites/application/commands/site-admin-command.service.ts:438` | да (`hierarchy-tree.tsx:183`) | — | НЕТ | НЕТ ← |
| Удаление объекта «навсегда» | `src/modules/sites/application/commands/site-admin-command.service.ts:254` | да (`admin-sites/index.tsx:458`) | запрет при связях (`:261`) | НЕТ | да (`:270`) |
| Удаление сменного отчёта | `src/app/api/reports/delete/route.ts:41` | да (`admin-reports.tsx:599`) | — | НЕТ (безвозвратно) | да, best-effort (`:184`) |
| Полная замена состава бригады | `src/modules/crews/application/commands/crew-command.service.ts:304` | да | — | НЕТ | да, before/after (`:322`) |
| Полная замена планов объекта | `src/modules/sites/application/commands/site-admin-command.service.ts:192` | да | — | НЕТ | да (`:228`) |
| Планировщик ТО (создание нарядов) | `src/modules/equipment/application/commands/pm-scheduler.ts:46` | н/д (авто) | batch нет | идемпотентно (dedup+lock `:105`) | да, на наряд (`:148`) |
| Планировщик готовности (истечение нарядов, автозакрытие смен) | `src/modules/readiness/application/scheduler.ts:113` | н/д (авто) | все за прогон | нет (но идемпотентно) | да, на строку (`:140`,`:178`) |
| Backfill готовности | `src/modules/readiness/application/backfill/backfill-service.ts:10` | н/д | 200/батч (`:8`) | resume по checkpoint | прогресс (`progress-repository`) |
| Пересборка проекций | `src/app/api/admin/projections/rebuild/route.ts:37` | НЕТ | НЕТ | пересчёт воспроизводим | да, best-effort (`:71`) |
| Приём телеметрии пачкой | `src/app/api/telemetry/batch/route.ts:64` | н/д | да, 100 (`:34`,`:103`) | н/д | нет |
| Ссылки на медиа пачкой | `src/app/api/media/download-batch/route.ts:31` | н/д | да, 100 (`:28`,`:48`) | н/д | нет |
| Экспорт отчётов | `src/app/api/reports/export/route.ts:18` | н/д | да, 92 дня (`:12`,`:56`) | н/д | нет |
| Повтор/отказ события очереди (DLQ) | `src/app/api/admin/dlq/route.ts:106` | н/д | по 1 записи | retry/discard | да (`:129`,`:136`) |
| Матрица доступов (роли×права) | `src/app/api/readiness/access-matrix/route.ts:31` | черновик + публикация (`:31`,`:45`) | — | да, через черновик | да (сервис) |

| # | severity | path:line | Проблема | Сценарий / почему важно | Что предложить |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-dictionaries.tsx:371` | Массовая архивация реализована веером из N независимых `PATCH /api/dictionary/manage` (`items.map(...)` + `Promise.all`). Серверного bulk-эндпоинта и транзакции нет; лимит числа записей не задан. | Владелец нажимает «Выбрать все → Архивировать» при 130 причинах простоя. Клиент шлёт 130 PATCH; после 100-го за минуту срабатывает `MUTATION_RATE_LIMIT` (`src/core/api-wrapper.ts:170`,`:213`) и часть запросов получает 429 → часть записей архивирована, часть нет. Тост покажет «Архивировано: 100», «Не удалось: 30» (`admin-dictionaries.tsx:385`), но оператор увидит смешанный список. Откатить «частично архивированное» одним действием нельзя. | Ввести серверный bulk-эндпоинт: одна транзакция `updateMany` по списку id, один вызов rate-limit, один агрегированный ответ (и одно событие аудита «архивировано N»). Либо явно ограничить число выбранных («не больше 50 за раз») и развести на батчи на клиенте. |
| 2 | важно | `src/modules/sites/application/commands/site-admin-command.service.ts:438` | `deleteSiteHierarchyItem` каскадно удаляет поддерево схемы (поле → кусты → пикеты) в транзакции, но **не вызывает `recordAuditEvent`** ни в одной из трёх веток (строки `:446`,`:462`,`:475`). | Админ удаляет «поле», вместе с ним уходят десятки пикетов и привязки. Событий в журнале аудита нет — при разборе «куда пропала схема» следа нет вообще. Все прочие разрушительные команды файла (`:270`, `:297`, `:325`) аудит пишут — здесь пропуск, а не осознанное решение. | Добавить `recordAuditEvent` (action `site.hierarchy_deleted`, targetId = itemId, metadata: type, name, число удалённых потомков) после успешного коммита. |
| 3 | важно | `src/components/piling/admin-dictionaries/dictionary-table.tsx:87` | Массовое восстановление (`bulkStatus(true)`) выполняется сразу, без `ConfirmActionDialog` (в отличие от архивации, `:68-74`). Затем так же веером уходит N PATCH. | Восстановление безопаснее архивации, но делит с ней риски #1 (веер, лимит 100, частичный результат) и не даёт шанса остановиться. Асимметрия «архивация спрашивает, восстановление — нет» неочевидна для владельца. | Для симметрии либо подтверждать и восстановление, либо (лучше) перевести обе операции на один серверный bulk-эндпоинт с лимитом. |
| 4 | важно | все строки таблицы выше | Ни у одной массовой операции нет **отката**. Единственная отмена — одиночная архивация одного справочника: тост «Отменить» на 10 секунд (`src/components/piling/admin-dictionaries.tsx:356-361`). Массовая архивация/удаление/удаление узла/удаление отчёта необратимы. | Ошибочно «Выбрать все → Архивировать» убирает из форм операторов весь справочник (это и был повод для подтверждения — `dictionary-table.tsx:64`), и вернуть всё одним действием нельзя: нужно вручную восстановить каждую запись. Для отчёта (`reports/delete`) и узла схемы отката нет в принципе. | Для массовой архивации — «Отменить» по аналогии со штучной (хранить список id и вернуть их одним обратным bulk-вызовом). Для схемы — мягкое удаление или журнал, позволяющий восстановить. |
| 5 | важно | `src/components/piling/admin-dictionaries.tsx:371` | Аудит массовой операции = N отдельных событий `dictionary.archived` (`src/services/dictionaries/dictionary-service.ts:275`) вместо одной записи «массовая архивация N элементов». | Владельцу в ленте аудита массовая архивация 50 записей выглядит как 50 одинаковых строк — «что произошло» не восстанавливается по одной записи. Нет числа-итога и нет связи записей одним действием. | Писать одно агрегирующее событие с `metadata: { count, ids, kind, isActive }` (и/или корреляционный id на весь веер). |
| 6 | мелочь | `src/app/api/admin/projections/rebuild/route.ts:37` | Пересборка проекций (`?name=all`) — массовый пересчёт витрин, без подтверждения и без лимита; аудит best-effort (`:71-83`), т.е. при сбое записи следа операция «прошла бесследно». | Меняет цифры всех витрин одним запросом; сам факт запуска может не попасть в журнал. Разрушением не является (пересчёт воспроизводим), поэтому severity низкая. | Сделать запись аудита обязательной (падение записи — не 500, но и не тишина): повтор с логом + алерт. |
| 7 | мелочь | `src/app/api/maintenance-plans/run/route.ts:13` | Ручной запуск планировщика ТО (`runPmScheduler`) сам по себе не пишет события «админ запустил планировщик»; аудит пишется только на созданные наряды (`src/modules/equipment/application/commands/pm-scheduler.ts:148`). | Если план был просрочен, но наряд уже открыт (dedup, `:119`), запуск ничего не создаёт и в журнале не отражается вообще. Разбор «почему наряды не появились» следа не найдёт. | Логировать/аудитить факт ручного запуска с итогами (`{ evaluated, due, created }`). |
| 8 | мелочь | `src/app/api/reports/export/route.ts:18`; `src/app/api/media/download-batch/route.ts:31`; `src/app/api/telemetry/batch/route.ts:64` | Размер пачки ограничен точечно (92 дня, 100 id, 100 записей) — ПРОЙДЕНО, но это разные, не единые правила. | Отсутствие общей нормы: следующая массовая операция лимит не получит, потому что «негде взять». | Зафиксировать общий предел пачки (например, константа в `core/api-wrapper`) как правило для массовых мутаций. |
| 9 | ПРОЙДЕНО | `src/modules/readiness/application/scheduler.ts:113` | Автозакрытие смен и истечение нарядов — в одной транзакции, с идемпотентностью (выборка только необработанных) и **событием аудита на каждую строку** (`:140`,`:178`) с системным актором. | Положительный образец: массовое действие оставляет полный след «кто/что/на каком основании». | — (использовать как эталон для #1/#2). |
| 10 | ПРОЙДЕНО | `src/modules/readiness/application/backfill/backfill-service.ts:10` | Backfill идёт батчами по 200, с чекпойнтом и возобновлением, `fail()` при ошибке (`:63`), сверка `reconciled` в конце (`:94`). | Массовая операция не «одним куском», а возобновляемой: рестарт не теряет прогресс. | — |
| 11 | ПРОЙДЕНО | `src/app/api/readiness/access-matrix/route.ts:31` | Массовое изменение прав (роли×права) выполнено по схеме «черновик → публикация» (`PUT` пишет draft, `POST` публикует), т.е. есть предпросмотр и фактическая возможность не применять. | Единственное массовое изменение, у которого реально есть «откат» (не применил публикацию). | — |
| 12 | ПРОЙДЕНО | `src/modules/crews/application/commands/crew-command.service.ts:304`; `src/modules/sites/application/commands/site-admin-command.service.ts:192` | Полная замена подчинённого набора (состав бригады; планы объекта) — `deleteMany` + `createMany` в одной транзакции, аудит с before/after (`crew-command.service.ts:322`, `site-admin-command.service.ts:228`). | Атомарность и след есть; частичного «стёрли, но не создали» не бывает. | — |

### Импорт данных

Операции «импорт» в коде **нет** (ГИПОТЕЗА→факт по поиску): найдены только выгрузки (`reports/export`, `readiness/export`, `pile-passports/export`, `xlsx-writer`) и публичная форма ORION, где файл не загружается, а сохраняется лишь его имя (`src/components/orion/orion-handoff-site.tsx:341` — замороженная зона, не разбиралась). Массового импорта отчётов/справочников из CSV/XLSX в приложении не существует, поэтому «подтверждение/лимит/аудит импорта» применить не к чему. Статус: ПРОЙДЕНО (отсутствие подтверждено текстовым поиском по `FormData|XLSX|read-excel|parseImport|Загрузить файл`).

## Не проверено

- Реальное поведение веера PATCH при N>100 на боевом лимите (429) — НЕ ПРОВЕРЕНО: не запускались живые запросы, вывод построен на чтении `src/core/api-wrapper.ts:170,213` и типа лимитера. Сколько именно записей в типичном справочнике у клиента — НЕ ПРОВЕРЕНО (нет доступа к БД).
- Есть ли в `AuditLog` дополнительная серверная агрегация/триггер для массовых действий — НЕ ПРОВЕРЕНО (схема и RLS не открывались: `prisma/schema.prisma` вне задачи).
- Поведение массовых операций в замороженных зонах (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, ORION) — НЕ ПРОВЕРЕНО: по правилам задачи пропущено.
- Наличие UI-подтверждения у восстановления справочников прочитано по коду `dictionary-table.tsx:68-89`; визуальная проверка экрана (Playwright/браузер) — НЕ ПРОВЕРЕНО.
- Каскадные FK-удаления на уровне БД (что физически уносит `site.delete` помимо проверки в `hardDeleteSite`) — НЕ ПРОВЕРЕНО: `prisma/schema.prisma` не читался (вне разрешённого объёма).
- Тестовое покрытие массовых операций (есть ли unit/e2e именно на массовую архивацию) — НЕ ПРОВЕРЕНО: тесты не запускались, только прочитан `src/app/api/__tests__/mutation-audit.test.ts` (он покрывает **одиночные** мутации, в нём нет кейса массовой архивации справочников).
