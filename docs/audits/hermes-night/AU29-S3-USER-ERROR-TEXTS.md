# AU29-S3 — Технические сообщения об ошибках в интерфейсе (независимый аудит)

Версия: `git rev-parse HEAD` = `3a549c7e5bfdd63ba77dbe3ddb1d1cc855623d87` (branch `hermes/q4-0926`).
Аудит только чтения: код приложения не менялся, создан один файл (этот отчёт).
Существующие отчёты в `docs/audits/` (кроме этого файла), `CODEX-REPORT*` и `docs/strategy` не читались.

## Итог

Аудит пользовательских текстов ошибок по коду: тосты (`sonner`), встроенные баннеры (`QueryErrorBanner`, `LoadFailure`, `Alert`), тексты-состояния экранов и ответы API с полем `error`, которые показываются в интерфейсе.
Найдено 58 сообщений — с техническими словами/кодами/именами полей, с англоязычным текстом сервера, с сырым `Error.message` или без подсказки, что делать дальше.
Разбивка по степени: **критично — 2, важно — 41, мелочь — 15**. «Критично» здесь — не про безопасность/данные (их аудит не касался), а про случай, когда на частом действии человеку показывается нечитаемая техническая строка и он не понимает, что произошло.

Топ-5:
1. `src/components/piling/equipment-analytics.tsx:109` — в баннер ошибки аналитики парка идёт сырой `(err as Error).message`; при обрыве сети это английское «Failed to fetch», при не-JSON ответе — текст `SyntaxError`.
2. `src/components/piling/report-form/photo-section.tsx:110` — при подтверждении фото читается `(await confirm.json()).error`; если ответ не JSON, `res.json()` бросает английский `SyntaxError`, и он же уходит в тост на строке 115 (действие — сдача отчёта).
3. `src/lib/validation-schemas.ts:423` (и ряд других строк этого файла) — сообщения zod написаны по-английски (`Name is required`, `Site name is required`, `Crew name is required`, `Equipment name is required`, `Image data is required`); через `apiErrorMessage` они показываются как «Поле name: Name is required».
4. `src/modules/sites/application/commands/site-admin-command.service.ts` и `site-command.service.ts` — отказы `Site not found`, `Pile grade not found`, `Parent not found`, `Hierarchy item not found`, `Invalid type`, `Name required`, `parentId required` уходят в тост администратору объекта как есть (`{ error: err.message }` в маршруте).
5. `src/modules/inspections/...`, `src/modules/reports/...` — `Equipment not found`, `Template not found`, `Inspection not found`, `Missing required fields`, `siteId, date required` — те же англоязычные отказы на экранах осмотров и отчётов.

Уже закрытые места (проверял, не находка): клиент технической готовности `src/components/piling/to/readiness/api/client.ts:64` функцией `russianOr` заменяет любую нерусскую строку на свой русский текст, поэтому английские `Readiness access denied` / `Tenant settings are not configured` из `bootstrap-query.ts` до экрана не доходят; во многих компонентах обрыв сети уже разводится с ответом сервера через `cause instanceof TypeError` (см. Методику).

## Методика

Сначала прочитан `AGENTS.md` (модель доверия, замёрзшие зоны, «выглядит мёртвым, но должно остаться»). Замёрзшие зоны (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) в разбор не брались — там текстов не считал.

Поиски (ripgrep через `search_files`, репозиторий `D:\PillingR\wt-night`):
1. `ErrorNote|error-note|ErrorBanner|ErrorMessage|ErrorState` — найти компоненты показа ошибок.
2. `toast|sonner|useToast|notify` — точки показа тостов.
3. `toast\.error\([^'\"`]` — тосты, где аргумент не строковый литерал (сырой текст).
4. `message: .*(error|err)\.message | error: .*(error|err)\.message | error: String\(...` — где сообщение ошибки уходит в ответ API/в текст.
5. `new ServiceError\(` — все сообщения сервисных ошибок (300 совпадений).
6. `error: err\.message` в `src/app/api` — маршруты, отдающие сообщение ServiceError как поле `error`.
7. `Сервер вернул|вернул код|статус` и `setError\(|setLoadError\(` в `src/components/piling` — тексты-состояния экранов со статусом/сырым сообщением.
8. `'[A-Za-z][A-Za-z ]{4,}'` в `src/lib/validation-schemas.ts` — англоязычные сообщения zod.
9. `Failed to fetch|fetch failed|Internal Server|Prisma|P2002|P2025|undefined|null` в `*.tsx` — утечки техн. слов (в интерфейс не попали, см. раздел «Что не проверено»).

Маршрутизацию «откуда дошло до экрана» проверял по хелперам `src/lib/api-error-message.ts:16` (`apiErrorMessage` возвращает `error` как заголовок и печатает `details` построчно), `src/components/piling/admin-crews/crew-messages.ts:33`, `src/components/piling/admin-sites/use-site-mutations.ts:56`, `src/components/piling/inspections/inspection-api-error.ts:42`, `src/components/piling/to/readiness/screens/shared.tsx:403` (`commandFailure`), `src/components/piling/admin-telegram.tsx:47` (`apiFailureText`). Эти хелперы показывают серверную строку `error` дословно — значит любое англоязычное сообщение `ServiceError` доходит до человека.

Ключевые команды:
- `git rev-parse HEAD` → `3a549c7e5bfdd63ba77dbe3ddb1d1cc855623d87`, `git branch --show-current` → `hermes/q4-0926`.
- Все `path:line` в таблице получены из `read_file`/`search_files` по этому коммиту (не из памяти).

## Находки

Столбцы: текст | файл:строка | где показывается | почему плохо | предложение (по-русски).

### A. Англоязычные сообщения сервера доходят до пользователя

| Текст | Файл:строка | Где показывается | Почему плохо | Предложение |
|---|---|---|---|---|
| `Name is required` | src/lib/validation-schemas.ts:423 | тост/баннер на экране объектов (через `apiErrorMessage`) | английский + техническое имя поля `name` | «Укажите название элемента» |
| `Site name is required` | src/lib/validation-schemas.ts:68, :392 | тост на экране объектов | английский | «Укажите название объекта» |
| `Crew name is required` | src/lib/validation-schemas.ts:218 | тост на экране бригад | английский | «Укажите название бригады» |
| `Equipment name is required` | src/lib/validation-schemas.ts:187, :353 | тост на экране техники | английский | «Укажите название установки» |
| `Image data is required` | src/lib/validation-schemas.ts:339, :438 | тост при распознавании фото | английский | «Не удалось получить изображение — выберите файл заново» |
| `Invalid email format` / `Password is required` / `User ID is required` | src/lib/validation-schemas.ts:30, :31, :50, :55 | ответ API пользователей (в UI показывается только `error`, см. «Не проверено» №2) | английский | «Некорректный email» / «Укажите пароль» / «Не указан пользователь» |
| `Site not found` | src/modules/sites/application/commands/site-admin-command.service.ts:36 | тост админу объекта | английский, не говорит, что делать | «Объект не найден — возможно, удалён. Обновите список.» |
| `Pile grade not found` | src/modules/sites/application/commands/site-admin-command.service.ts:44 | тост админу объекта | английский | «Марка сваи не найдена — обновите справочник.» |
| `Name required` | src/modules/sites/application/commands/site-admin-command.service.ts:87 | тост админу объекта | английский | «Укажите название.» |
| `parentId required` | src/modules/sites/application/commands/site-admin-command.service.ts:406 | тост при добавлении узла схемы | английский + техническое имя поля | «Выберите родительский элемент.» |
| `Parent not found` | src/modules/sites/application/commands/site-admin-command.service.ts:419, :429 | тост при добавлении узла | английский | «Родительский элемент не найден — обновите схему.» |
| `Hierarchy item not found` | src/modules/sites/application/commands/site-admin-command.service.ts:455, :468, :479 | тост при правке/удалении узла | английский | «Элемент схемы не найден — возможно, удалён.» |
| `User not found` | src/modules/sites/application/commands/site-admin-command.service.ts:319 | тост при назначении пользователя | английский | «Пользователь не найден.» |
| `userId and siteId required` | src/modules/sites/application/commands/site-admin-command.service.ts:314, :332 | тост при назначении | английский + имена полей | «Выберите пользователя и объект.» |
| `Type and name required` / `Type and itemId required` | src/modules/sites/application/commands/site-admin-command.service.ts:403, :440 | тост при работе со схемой | английский + имена полей | «Недостаточно данных — обновите страницу и повторите.» |
| `Invalid type` | src/modules/sites/application/commands/site-admin-command.service.ts:405, :435, :442, :486 | тост при работе со схемой | английский | «Неизвестный тип элемента — обновите страницу.» |
| `Site not found` | src/modules/sites/application/commands/site-command.service.ts:39, :80, :95 | тост админу объекта | английский | «Объект не найден — возможно, удалён.» |
| `Equipment not found` | src/modules/inspections/application/commands/inspection-commands.ts:71, :190 | тост на экране осмотров | английский | «Установка не найдена.» |
| `Template not found` | src/modules/inspections/application/commands/inspection-commands.ts:195 | тост на экране осмотров | английский | «Шаблон осмотра не найден — возможно, деактивирован.» |
| `Inspection not found` | src/modules/inspections/application/commands/inspection-commands.ts:275, :338, :340 | тост на экране осмотров | английский | «Осмотр не найден.» |
| `Template not found` | src/modules/inspections/application/queries/template-query.service.ts:30 | тост/баннер экрана шаблонов | английский | «Шаблон не найден.» |
| `Template not found` | src/modules/inspections/application/commands/template-commands.ts:85 | тост экрана шаблонов | английский | «Шаблон не найден.» |
| `Inspection not found` | src/modules/inspections/application/queries/inspection-query.service.ts:52, :55 | баннер карточки осмотра | английский | «Осмотр не найден.» |
| `Missing required fields` | src/modules/reports/application/commands/report-validation.service.ts:51 | тост формы отчёта | английский | «Заполните обязательные поля отчёта.» |
| `siteId, date required` | src/modules/reports/application/queries/report-query.service.ts:48 | тост/баннер отчётов | английский + имена полей | «Выберите объект и дату.» |
| `dateFrom and dateTo are required` | src/modules/reports/application/queries/report-query.service.ts:78 | баннер отчётов за период | английский + имена полей | «Укажите начало и конец периода.» |
| `Config not found` | src/services/telegram/telegram-config-service.ts:116, :135, :150, :158 | тост админа на экране Telegram | английский | «Конфигурация не найдена — возможно, удалена. Обновите список.» |
| `${resourceName} not found` → напр. `Report not found` | src/services/auth/resource-access-service.ts:81 | ответ API 404 (может показаться в тосте) | английский шаблон с техническим именем ресурса | «Запись не найдена.» |
| `Invalid type` | src/services/dictionaries/dictionary-service.ts:131, :263, :385, :409 | ответ API справочника | английский (достижимость: см. «Не проверено» №1) | «Неизвестный тип справочника.» |
| `Invalid type` / `type and id required` | src/services/dictionaries/dictionary-service.ts:407 | ответ API справочника | английский + имена полей | «Недостаточно данных — обновите страницу.» |
| `User not found` | src/app/api/auth/me/route.ts:35 | ответ API 404 (в UI не показывается — см. «Не проверено» №2) | английский | «Пользователь не найден.» |

### B. Технические строки прямо в интерфейсе (код статуса, сырое сообщение, имена полей)

| Текст | Файл:строка | Где показывается | Почему плохо | Предложение |
|---|---|---|---|---|
| сырой `(err as Error).message` (напр. «Failed to fetch», `SyntaxError`) | src/components/piling/equipment-analytics.tsx:109 | баннер `QueryErrorBanner` аналитики парка (:175) | нечитаемая английская/JS-строка, нет подсказки | «Нет связи с сервером. Проверьте интернет и повторите.» |
| `Сервер вернул ${res.status}` | src/components/piling/equipment-analytics.tsx:105 | тот же баннер | код HTTP вместо причины и действия | «Не удалось загрузить аналитику. Повторите позже.» |
| `Сервер вернул ${res.status}` | src/components/piling/admin-equipment/detail/equipment-detail.tsx:73 | баннер карточки установки | код HTTP без действия | «Не удалось загрузить установку. Повторите.» |
| `Сервер вернул ${res.status}` | src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:166 | баннер телеметрии | код HTTP без действия | «Не удалось загрузить телеметрию. Повторите позже.» |
| `Не удалось загрузить: сервер вернул ${status}` | src/components/piling/to/load-failure.tsx:16 | баннер/текст панелей ТО (топливо, регламенты, моточасы) | код HTTP в тексте | «Сервер не ответил. Повторите.» |
| `Сервер ответил ${response.status}` | src/components/piling/admin-reports/admin-reports.tsx:150 | тост выгрузки отчётов | код HTTP без действия | «Не удалось выгрузить отчёты. Повторите.» |
| `Не удалось удалить отчёт (код ${res.status}).` | src/components/piling/admin-reports/admin-reports.tsx:218 | тост удаления отчёта | код HTTP в тексте | «Не удалось удалить отчёт. Повторите.» |
| `Не удалось изменить статус: ${failed}` | src/components/piling/admin-dictionaries.tsx:386 | тост справочника | подстановка сырой причины | уточнить причину словами или дать общий текст |
| `lengthMm, sectionOrDiameter и notes применимы только для типа сваи pileGrade` | src/app/api/dictionary/manage/route.ts:123 | ответ API 400, показывается в тосте | техн. имена полей и код типа в тексте для человека | «Длину, сечение и примечание можно менять только у марки сваи.» |
| сырой `(await confirm.json()).error`; при не-JSON — английский `SyntaxError` | src/components/piling/report-form/photo-section.tsx:110, :115 | тост при подтверждении/удалении фото отчёта | на действии «сдача отчёта» показывается техническая строка | обернуть разбор тела в `try/catch`, показать русский текст |
| `data.error` (сырой серверный текст) | src/components/piling/admin-telegram.tsx:119 | тост проверки Telegram-бота | серверная строка показывается дословно | оставить русский фолбэк / фильтровать нерусское |
| `body.error` (сырой серверный текст) | src/components/piling/admin-users/user-document-types-dialog.tsx:88, :111, :126, :156 | тосты видов документов | серверная строка дословно | провести через `extractApiError`/`apiErrorMessage` |

### C. Тексты без подсказки, что делать («Ошибка», «Ошибка загрузки/сохранения/удаления»)

| Текст | Файл:строка | Где показывается | Почему плохо | Предложение |
|---|---|---|---|---|
| `Ошибка` | src/components/piling/inspections/template-editor.tsx:222 | тост сохранения шаблона | не говорит ни причину, ни действие | «Не удалось сохранить шаблон. Повторите.» |
| `Ошибка` | src/components/piling/inspections/start-inspection-form.tsx:180 | тост старта осмотра | то же | «Не удалось начать осмотр. Повторите.» |
| `Ошибка` | src/components/piling/admin-dlq.tsx:219 | тост админа по очереди сбоев | то же | «Не удалось выполнить действие с событием. Повторите.» |
| `Ошибка` | src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:123, :138 | тосты ТО установки | то же | «Не удалось сохранить запись ТО. Повторите.» |
| `Ошибка` | src/components/piling/admin-equipment/detail/equipment-documents.tsx:142, :159 | тосты документов установки | то же | «Не удалось сохранить документ. Повторите.» |
| `Ошибка` | src/components/piling/maintenance/work-order-detail.tsx:219 | тост карточки наряда | то же | «Не удалось сохранить наряд. Повторите.» |
| `Ошибка` | src/components/piling/maintenance/work-order-form-dialog.tsx:260 | тост формы наряда | то же | «Не удалось сохранить наряд. Повторите.» |
| `Ошибка` | src/components/piling/admin-users/user-documents.tsx:195, :209 | тосты документов работника | то же | «Не удалось сохранить документ. Повторите.» |
| `Ошибка создания бригады` / `Ошибка сохранения` / `Ошибка деактивации бригады` | src/components/piling/admin-crews/admin-crews.tsx:156, :168, :182 | тосты экрана бригад | нет причины/действия | добавить «повторите» и телефон администратора при повторе |
| `Ошибка загрузки` / `Ошибка удаления` | src/components/piling/report-form/photo-section.tsx:115, :133 | тосты фото отчёта | обезличенный текст | «Не удалось загрузить фото. Выберите файл и повторите.» |
| `Ошибка загрузки` / `Ошибка удаления` | src/components/piling/inspections/inspection-item-photos.tsx:137, :156 | тосты фото осмотра | то же | «Не удалось загрузить фото. Повторите.» |
| `Ошибка загрузки` / `Ошибка удаления` | src/components/piling/admin-equipment/detail/equipment-photos.tsx:119, :135 | тосты фото установки | то же | «Не удалось загрузить фото. Повторите.» |
| `Ошибка загрузки` / `Ошибка удаления` | src/components/piling/maintenance/work-order-photos.tsx:131, :148 | тосты фото наряда | то же | «Не удалось загрузить фото. Повторите.» |
| `Ошибка создания установки` / `Ошибка сохранения` / `Ошибка удаления установки` | src/components/piling/admin-equipment/equipment-dialogs.tsx:90, :166, :222 | тосты экрана техники | нет причины/действия | добавить «повторите» |
| `Ошибка` | src/components/piling/admin-users/user-dialogs.tsx:128, :284, :394 | тосты диалогов пользователя | обезличенный текст | «Не удалось сохранить пользователя. Повторите.» |

Итого в таблицах: 58 находок (критично 2, важно 41, мелочь 15). «Критично» — две строки с сырым `Error.message`/`SyntaxError` на частых действиях (B1, B10); остальное — «важно» (англоязычные/коды/имена полей) и «мелочь» (обезличенные «Ошибка»).

### Приложение: те же техн. имена/коды в отчётах API по всему проекту (path:line)

Эти строки уходят в поле `error` ответа и могут быть показаны теми же хелперами; отдельно в таблицу не выносил, чтобы не дублировать:

- `tenantId is required` (fail-closed, срабатывает только при отсутствии тенанта): src/modules/sites/application/queries/site-query.service.ts:57, :90, :118; src/modules/sites/application/commands/site-command.service.ts:36; src/modules/sites/application/commands/site-admin-command.service.ts:34, :85; src/modules/inspections/application/queries/inspection-query.service.ts:11, :30, :47, :72; src/modules/inspections/application/queries/template-query.service.ts:9, :25; src/modules/inspections/application/commands/inspection-commands.ts:65, :188, :270, :336; src/modules/inspections/application/commands/template-commands.ts:28, :83; src/modules/reports/application/queries/report-query.service.ts:226; src/modules/reports/application/queries/report-export.service.ts:122; src/modules/reports/application/queries/pile-passport.service.ts:57; src/modules/reports/application/queries/pile-journal-list.ts:30; src/modules/safety/application/self-clearance-query.ts:59, :60; src/modules/safety/application/equipment-permits.ts:64, :116, :175; src/modules/safety/application/clearance-overview-query.ts:144; src/services/telemetry/device-key-service.ts:59.
- `Equipment not found` / `Tenant context missing`: src/services/telemetry/device-key-service.ts:66; src/services/auth/resource-access-service.ts:77 (доступ только с устройства/внутренние — на UI не проверено).
- `id required` / `${field} required`: src/services/telegram/telegram-config-service.ts:9, :109, :144 (после zod обычно недостижимо).
- `Equipment busy` (тест): src/app/api/inspections/__tests__/route.test.ts:123.

## Что не проверено

1. **Достижимость `Invalid type` в справочнике** (src/services/dictionaries/dictionary-service.ts:131 и далее). Маршрут `src/app/api/dictionary/manage/route.ts:17` валидирует `type` через `z.enum([...])` до вызова сервиса, поэтому при легальном клиенте эти строки недостижимы — статус «ГИПОТЕЗА». Нужен отдельный прогон с подделкой тела.
2. **Достижимость английских сообщений zod и `User not found`.** Пользовательский экран (`src/components/piling/admin-users/use-users-list.ts:100, :124, :138`) и `probeSession` (`src/lib/api.ts:184`) читают только `error`/`user`, а не `details`; строки `validation-schemas.ts:30, :31, :50, :55` и `auth/me/route.ts:35` в UI, скорее всего, не показываются. Англоязычные `Name is required` (/сайты, /бригады, /техника) показываются, потому что эти экраны идут через `apiErrorMessage` — но «срабатывает ли реально пустое имя» по UI не прогонял: ГИПОТЕЗА.
3. **Фактический показ строк из раздела B** (код статуса, `(err as Error).message`) — вывод основан на коде (баннер `QueryErrorBanner` в equipment-analytics.tsx:175; тип `TypeError` не разводится). Live-прогон в браузере не делал.
4. **Реакция на не-JSON тело** (photo-section.tsx:110, admin-reports.tsx:150) — предполагаю `SyntaxError` при HTML-ответе прокси, но реальный ответ прокси не воспроизводил.
5. **Проверки §6 AGENTS (tsc/lint/test/build)** не запускал: аудит только чтения, код не менялся; к тому же это не проверка регрессии. Тесты, ссылающиеся на эти сценарии (`*.test.tsx` с `Failed to fetch`), только прочитаны, не перезапускались.
6. **Замёрзшие зоны** (`operator*`, ORION) — тексты там не считал по условию задачи; англоязычные/технические строки в них возможны, но не оценены.
7. **Строки `Приложение`** — список не ранжирован и не проверён на показ в UI (многие «tenantId is required» достижимы только при сбое конфигурации тенанта).
