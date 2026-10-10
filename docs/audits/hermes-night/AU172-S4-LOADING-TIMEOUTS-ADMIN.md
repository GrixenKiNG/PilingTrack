# AU172-S4 — Админ-экраны: таймауты и повторы загрузки

Версия/база: `git rev-parse HEAD` = `356ca2cc924af7dc73288dcfd015fc1ef10d558d` (ветка `hermes/q4-0926`).
Тип работы: только чтение. Код приложения не изменялся; создан один файл отчёта.

Проверялось по коду: что делает хук загрузки админ-экрана, когда сервер/сеть не отвечает, есть ли таймаут, есть ли повтор и кнопка «Повторить». Замороженные зоны (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) не проверялись.

## Итог

1. Главное: у клиентского транспорта нет таймаута вообще. `authFetch` (`src/lib/api.ts:29`) и `loadJson` (`src/lib/api.ts:130`) делают `fetch` без `AbortSignal.timeout`. Единственное место во всём клиенте с явным таймаутом — мониторинговая панель `src/components/piling/monitoring/fleet-dashboard.tsx:91` (`AbortSignal.timeout(15_000)`), не админ. Вывод по коду: если сервер принял соединение и не отвечает (зависший запрос, залипший прокси, событие-loop), любой админ-экран остаётся в `loading = true` навсегда.
2. Разница между «сбой» и «зависание» принципиальна. Кнопка «Повторить» почти везде рендерится только в ветке ошибки (`catch` / `!res.ok`). Отказ связи → ошибка+повтор есть. Зависание → ошибки нет, `loading` не снимается, скелетон/«Загрузка…» навсегда и повтора нет.
3. Худший сценарий по коду — дашборд `/admin`: пока `loading` истинно, кнопка «Обновить дашборд» отключена (`admin-dashboard.tsx:420`), и при зависании фильтра/аналитики пользователь не может перезапросить вообще (`admin-dashboard.tsx:367`).
4. Второй по важности — «Настройки»: при зависании `/api/settings` все тумблеры и кнопки остаются отключёнными навсегда (`workspace-settings.tsx:238,253,296,353`), на экране нет ни индикатора загрузки, ни повтора — баннер ошибки тоже не покажется.
5. Отдельно: карточка установки при отказе/зависании показывает «Не удалось загрузить установку» без кнопки «Повторить» (`equipment-detail.tsx:162-171`), а список парка — с повтором (`admin-equipment.tsx:84-92`); поведение одного экрана в двух местах расходится.

Счёт по важности: критично — 0; важно — 9; мелочь — 18. Всего 27 находок. Статусы: поведение при зависании — ПРОЙДЕНО (по коду, см. таблицу); фактическое наступление зависания на проде — НЕ ПРОВЕРЕНО (нет живого сервера/БД в этой сессии).

## Методика

Команды (все — из корня `D:\PillingR\wt-night`, номера строк из вывода, не пересчитаны):

- `git rev-parse HEAD` — версия базы.
- `find src/app -type d | grep -i -E "admin|settings|..."` и `ls "src/app/(app)/admin"` — перечень админ-маршрутов.
- `find src/components/piling -path "*admin*" -name "*.ts*"` + `ls src/components/piling | grep ^admin` — файлы экранов.
- `grep -rn "AbortController\|AbortSignal\|setTimeout\|timeout\|signal:" src/components/piling/admin-*` — кто вообще работает с отменой/таймаутом.
- `grep -rn "AbortSignal.timeout" src` — единственные три места; `grep -rn "export.*authFetch\|loadJson"` → `src/lib/api.ts`.
- чтение хуков целиком: `use-crews-data.ts`, `use-equipment-list.ts`, `use-fleet.ts`, `use-users-list.ts`, `use-sites-data.ts`, `use-sites-overview.ts`, `use-reports-data.ts`, `use-report-history.ts`, `use-entity-history.ts`, `async-ui.tsx`, `lib/api.ts`.
- построчное чтение компонентов экранов (полные пути и строки — в таблицах).

Перезапускаемо: последовательность `grep -rn "AbortSignal.timeout" src` + открытие перечисленных в таблице `path:line` воспроизводит каждую строку «Находок».

## Поведение экранов при обрыве и при зависании

Статус — по коду. «Зависание» = сервер принял запрос и не ответил (нет таймаута ни на клиенте, ни в маршруте: `grep -rn "maxDuration" src/app` пусто, `grep "globalThis.fetch =" src` — только тесты).

| Экран (маршрут) | Файл:строка (загрузка) | Поведение при обрыве связи (fetch reject) | Поведение при зависании (нет ответа) | Риск вечной загрузки |
| --- | --- | --- | --- | --- |
| Дашборд `/admin` | `src/components/piling/admin-dashboard.tsx:126`, `:154`, `:181` | ошибка в блоке «План-факт» текстом, баннер «Сводка неполная», повтор у справочника объектов | скелетон `:331` и «Обновляется…» навсегда; кнопка «Обновить дашборд» отключена `:420` | ДА — повтор недоступен |
| Аналитика `/admin/analytics` | `src/components/piling/admin-analytics.tsx:87`, `:104`, `:121`, `:145`, `:169` | баннеры с «Повторить» `:286,:427,:477`; для `fleet`/`sites` только предупреждение `:256`, повтора нет | полосы KPI — скелетон навсегда `:280-282`; вкладки — скелетон `:364,:428,:478` | ДА |
| Справочники `/admin/dictionaries` | `src/components/piling/admin-dictionaries.tsx:121`, `:175` | `Alert` с «Повторить» `:457-462`; журнал истории — текст с «Повторить» `:587-590` | ранний возврат со скелетоном `:441` навсегда; вкладка «История» — «Загрузка истории…» навсегда `:592` | ДА |
| Очередь DLQ `/admin/dlq` | `src/components/piling/admin-dlq.tsx:168` | `QueryErrorBanner` с «Повторить» `:280-285` | скелетон навсегда `:288` | ДА |
| Установки `/admin/equipment` | `src/components/piling/admin-equipment/use-fleet.ts:18`; `use-equipment-list.ts:21` | экран ошибки с «Повторить» `admin-equipment.tsx:84-92` | скелетон навсегда `admin-equipment.tsx:66` | ДА |
| Карточка установки `/admin/equipment/[id]` | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:69` | текст «Не удалось загрузить установку», **без** «Повторить» `:162-171` | скелетон навсегда `:152` | ДА — нет кнопки повтора |
| Объекты `/admin/sites` | `src/components/piling/admin-sites/use-sites-data.ts:36`; `use-sites-overview.ts:80` | `QueryErrorBanner` с «Повторить» `admin-sites/index.tsx:277-289` | скелетон навсегда `admin-sites/index.tsx:251` | ДА |
| Пользователи `/admin/users` | `src/components/piling/admin-users/use-users-list.ts:58` | экран ошибки с «Повторить» `admin-users.tsx:265-275` | скелетон навсегда `admin-users.tsx:255` | ДА |
| Бригады `/admin/crews` | `src/components/piling/admin-crews/use-crews-data.ts:66`, `:111` | `QueryErrorBanner` с «Повторить» `admin-crews.tsx:244` | скелетон навсегда `admin-crews.tsx:194` | ДА |
| Отчёты `/admin/reports` | `src/components/piling/admin-reports/use-reports-data.ts:112`, `:217` | баннер с «Повторить» `admin-reports.tsx:346-359` | скелетон навсегда `admin-reports.tsx:330` | ДА |
| Настройки `/admin/settings` | `src/components/piling/workspace-settings.tsx:115`, `:131` | баннер «Настройки не загрузились» с «Повторить» `:206-211` | все элементы управления disabled навсегда `:238,:253,:296,:353`, индикатора и повтора нет | ДА |
| Telegram `/admin/telegram` | `src/components/piling/admin-telegram.tsx:128` | баннер с «Повторить» `:298-304` | скелетон навсегда `:264` | ДА |
| Чек-листы `/admin/checklists` | `src/components/piling/inspections/template-list.tsx:66` | баннер с «Повторить» (если retryable) `:126-134` | скелетон навсегда `:124` | ДА |
| ТО `/admin/maintenance` | `src/components/piling/maintenance/maintenance-board.tsx:99` | баннер с «Повторить» `:386-392` | скелетон навсегда `:384` | ДА |
| Инциденты `/admin/incidents` | `src/components/piling/admin-incidents/admin-incidents.tsx:71`, `:118` | текст ошибки с «Повторить» `:205-215` | «Загружаем…» навсегда `:225`, повтора нет | ДА |
| Документы сотрудника | `src/components/piling/admin-users/user-documents.tsx:117` | текст ошибки с «Повторить» `:221-227` | скелетон навсегда `:213` | ДА |
| История сущности/отчёта | `src/components/piling/ops-shell/use-entity-history.ts:21`; `admin-reports/use-report-history.ts:16` | текст ошибки (без повтора) `use-entity-history.ts:36` | индикатор `loading` навсегда | ДА |
| Готовность/ТБ `/admin/to`, `/admin/safety` | `src/components/piling/to/to-module.tsx:391`, `:854` | `queryState: error` + `onRetry` `:875` | `queryState: loading` навсегда `:854-855` | ДА |

## Находки

| # | важность | файл:строка | проблема | сценарий / почему важно | предлагаемая правка |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/lib/api.ts:29`, `:130` | `authFetch`/`loadJson` не задают таймаут: `fetch` без `AbortSignal.timeout`, вызов `:32` | Сервер принял соединение и не отвечает → промис не разрешается и не отклоняется, `finally` не выполняется, `loading` не снимается. Затрагивает все экраны ниже. | Ввести единый сигнал таймаута (напр. 15 с) в `authFetch` и объединять с внешним `signal`; по истечении — `LoadFailed`/`TimeoutError`, чтобы ветка ошибки и «Повторить» заработали |
| 2 | важно | `src/components/piling/admin-dashboard.tsx:420` | кнопка «Обновить дашборд» `disabled={loading}` | При зависании аналитики/фильтра `loading` не снимается → кнопка навсегда серая, перезапросить нельзя; в заголовке навсегда «Обновляется…» `:367` | Таймаут (см. №1); при зависании — вернуть `loading=false` и показать баннер с «Повторить» |
| 3 | важно | `src/components/piling/admin-dashboard.tsx:492-495` | блок «План-факт» при сбое аналитики показывает `<Empty text={loadError}/>` без кнопки повтора | Пользователь видит текст ошибки, но повторить может только иконкой «Обновить», а она disabled при `loading` (№2) | Добавить в `Empty` действие «Повторить» → `refreshAll` |
| 4 | важно | `src/components/piling/admin-analytics.tsx:104-118`, `:280-282` | `fleet`/`sites` грузятся без таймаута и без повтора (только предупреждение `:256`) | Зависание `/api/monitoring/fleet` → полоса KPI-скелетонов навсегда, восстановиться нечем | Дать повторы у `fleetError`/`sitesError` и общий таймаут |
| 5 | важно | `src/components/piling/admin-analytics.tsx:364`, `:428`, `:478` | вкладки «Операторы/Тренды/ТО» показывают скелетон, пока `*Loading` истинно | Кнопка «Повторить» есть только при ошибке (`:286,:427,:477`); при зависании остаётся скелетон навсегда | Таймаут + состояние «долго грузится» с повтором |
| 6 | важно | `src/components/piling/admin-dictionaries.tsx:121-146`, `:441` | `loadData` без таймаута; `if (loading) return <Skeleton/>` | Зависание `/api/dictionary/manage` → скелетон навсегда; `Alert` с «Повторить» `:457` не появится | Таймаут на клиенте |
| 7 | важно | `src/components/piling/admin-equipment/use-fleet.ts:18-46`, `admin-equipment.tsx:66` | `useFleet` без таймаута; при `loading` — ранний скелетон | Зависание `/api/monitoring/fleet` → скелетон навсегда; экран ошибки с «Повторить» `:84` не покажется | Таймаут; по истечении выставлять `error` |
| 8 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:162-171` | состояние ошибки карточки без кнопки «Повторить» | Единственный способ — уйти и вернуться; при зависании ещё и скелетон навсегда `:152` | Добавить «Повторить» → `refresh` |
| 9 | важно | `src/components/piling/admin-sites/use-sites-overview.ts:80-133` | `useSitesOverview` не имеет ни `AbortController`, ни таймаута | Зависание `/api/analytics/sites` или `/api/crews/all` → `loading` навсегда → скелетон `admin-sites/index.tsx:251` | Сигнал отмены/таймаута; при уходе с экрана — `abort()` |
| 10 | важно | `src/components/piling/admin-reports/use-reports-data.ts:229-293` | основной список отчётов без таймаута; `finally` `:289` сработает только после ответа | Зависание `/api/reports/all` → ранний скелетон `admin-reports.tsx:330` навсегда; баннер с повтором `:356` не покажется | Таймаут |
| 11 | важно | `src/components/piling/workspace-settings.tsx:238,253,296,353` | пока `settingsState !== 'ready'`, тумблеры/кнопки `disabled`; отдельного индикатора загрузки на экране нет | Зависание `/api/settings` → интерфейс навсегда «серый», объяснения нет (баннер `:206` только при `error`) | Таймаут + видимый индикатор/баннер с повтором во время загрузки |
| 12 | мелочь | `src/components/piling/admin-equipment/use-equipment-list.ts:21-62` | при отказе `/api/equipment` и `/api/crews` — только `toast.error` `:51`, состояния ошибки нет | Список из этого хука остаётся пустым; при отказе обоих — предупреждение исчезает (`toast`); пустой список читается как «техники нет» | Хранить ошибку в состоянии и показывать баннер (как в остальных хуках) |
| 13 | мелочь | `src/components/piling/admin-users/use-users-list.ts:69-75` | постраничный добор в цикле `while (cursor)`: если сервер вернёт тот же `nextCursor`, цикл не завершится | ГИПОТЕЗА (не воспроизводилось): сервер с повторяющимся курсором → бесконентный поток `/api/users?cursor=...`, `loading` навсегда | Ограничить число страниц/защититься от повторяющегося курсора |
| 14 | мелочь | `src/components/piling/admin-crews/use-crews-data.ts:66-109` | `loadReferenceData` без `AbortController` и таймаута; при зависании `loadingReferenceData` не снимется | Форма бригады ждёт; `referenceError` не выставится (зависание ≠ отказ) — выбор просто пуст | Таймаут; по истечении — `referenceError` |
| 15 | мелочь | `src/components/piling/admin-dictionaries.tsx:592` | вкладка «История» при отсутствии ответа показывает «Загрузка истории…» бесконечно | Повтор `:590` только после `historyFailed` (`catch`); зависание ветку `catch` не запускает | Таймаут/переход в `historyFailed` |
| 16 | мелочь | `src/components/piling/admin-sites/use-sites-data.ts:78-95`, `:103-120` | `loadUsers`/`loadPileGrades` при отказе только `toast.error`, флаг `*LoadedRef` не сбрасывается | После первой неудачи повтор не выполняется (ref уже «занят» не будет, но и кнопки повтора нет — только повторное открытие диалога) | Хранить ошибку + кнопку повтора в диалоге |
| 17 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:521-526`, `:534-537` | «Загрузить ещё» при зависании: `loadingMore` навсегда, кнопка `disabled` `:521` | Догрузка не завершается и не отменяется; кнопка остаётся серой | Таймаут догрузки |
| 18 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:376` | баннеры `filterError`/`dictionaryError` без кнопки повтора | Отказ справочников формы излечивается только повторным открытием диалога; сам баннер действий не предлагает | Добавить «Повторить» → `loadReferenceData` |
| 19 | мелочь | `src/components/piling/workspace-settings.tsx:131-151` | цикл до 50 страниц `/api/users?limit=200` без таймаута | Зависание → `rosterState` остаётся `loading`, счётчики ролей навсегда «…» `:155` | Таймаут; ограничить и сообщать |
| 20 | мелочь | `src/components/piling/admin-telegram.tsx:264` | при зависании `/api/telegram/configs` — скелетон навсегда | Повтор `:301` появляется только при `loadError` (из `catch`) | Таймаут |
| 21 | мелочь | `src/components/piling/inspections/template-list.tsx:124` | при зависании `/api/checklist-templates` — скелетон навсегда | Повтор `:134` только в ветке `loadError` | Таймаут |
| 22 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:384` | при зависании `/api/maintenance` — скелетон навсегда | Повтор `:392` только при `loadError` | Таймаут |
| 23 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:225` | при зависании `/api/admin/incidents` — «Загружаем…» навсегда, повтора нет | Кнопка «Повторить» `:215` только в ветке `error` | Таймаут/ошибка по истечении |
| 24 | мелочь | `src/components/piling/admin-users/user-documents.tsx:213` | при зависании `/api/users/{id}/documents` — скелетон навсегда | Повтор `:227` только при `failed` | Таймаут |
| 25 | мелочь | `src/components/piling/ops-shell/use-entity-history.ts:21-43` | нет таймаута и нет повтора для отказов истории | Зависание `/api/audit` → `loading` навсегда; при отказе `:36` — ошибка без кнопки перезапроса | Таймаут + повтор |
| 26 | мелочь | `src/components/piling/admin-reports/use-report-history.ts:16-34` | нет таймаута на `/api/reports/{id}/history` | Зависание → `loading` навсегда | Таймаут |
| 27 | мелочь | `src/components/piling/to/to-module.tsx:854-855` | `queryState: loading` без таймаута (при этом `onRetry` при ошибке есть, `:875`) | Зависание bootstrap/workspace → модуль «Техготовность/ТБ» навсегда в загрузке | Таймаут |

Пройденo (не находки, для полноты): у большинства экранов ветка ошибки реализована и содержит кнопку «Повторить» — `admin-equipment.tsx:84-92`, `admin-users.tsx:265-275`, `admin-sites/index.tsx:277-289`, `admin-crews.tsx:244`, `admin-reports.tsx:346-359`, `admin-dlq.tsx:280-285`, `admin-dictionaries.tsx:457-462`, `admin-telegram.tsx:298-304`, `template-list.tsx:126-134`, `maintenance-board.tsx:386-392`, `admin-incidents.tsx:205-215`, `user-documents.tsx:221-227`, `workspace-settings.tsx:206-211`. Общий компонент баннера с повтором — `src/components/piling/async-ui.tsx:57-84`; общие тексты ошибок и различение «обрыв ≠ нет данных» — `src/lib/api.ts:105-128`.

## Не проверено

- Не воспроизведено фактическое зависание: нет запущенных сервера/БД в этой сессии. Всё «вечная загрузка» — вывод из чтения кода (отсутствие таймаута + ветка `catch`/`finally`). Отдельного прогона с «залипшим» ответом не делал.
- Не проверено, действительно ли в проде возможен сценарий «сервер принял соединение и не ответил» (idle-таймауты прокси/`nginx`, лимиты Node). На уровне приложения `grep -rn "maxDuration" src/app` — пусто; серверной границы времени ответа в коде не найдено.
- Не запускались проверки из AGENTS.md §6 (`tsc`, `lint`, `test:unit`, `playwright`, `build`) — задача только на чтение, изменения кода отсутствуют, прогон не требуется.
- `src/components/piling/to/to-module.tsx` (маршруты `/admin/to`, `/admin/safety`) прочитан выборочно (строки загрузки и состояния запроса); полный разбор хуков готовности (`src/components/piling/to/readiness/**`) не делал.
- Подкомпоненты, которые грузят свои данные (диалоги/вкладки `admin-sites/site-editor/*`, вкладки `admin-equipment/detail/*`, `admin-equipment/equipment-card-grid.tsx:131`) просмотрены не полностью; их вклад в таблицу не включён.
- Не оценено, есть ли уже тесты на снятие `loading`/таймаут в этих хуках — покрытие тестами для этой задачи не измерялось.
- Замороженные зоны (варианты экрана оператора, ORION) не проверялись по условию задачи.
