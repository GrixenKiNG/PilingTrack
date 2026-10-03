# R112. Английские тексты, которые видит человек (UI, тосты, ответы API)

READ-ONLY. Создан только этот файл. Код, схема, `.env`, тесты и база не изменялись.
Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `8cab9797` (`git status` — чисто на момент начала).
Область: `src/components/piling/**` и `src/app/(app)/**` (без `operator*`), плюс английские ответы `src/app/api/**`, которые экран печатает как есть. Экраны машиниста и ORION — вне области. Сверено с прошлыми отчётами `docs/audits/hermes-night/**`; известное помечено «повтор Rnn».

## Итог

- Находок **37**: **критично — 0**, **важно — 10**, **мелочь — 24**, **инфо — 3**. Необратимой потери данных из-за текста нет; проблема одна и та же — экран печатает **чужую английскую строку как есть**, а не свой русский текст.
- Сам класс («английские строки отказа в тостах: `Unauthorized`, `CSRF validation failed`, `Failed to fetch`») уже описан в R27/R41 и подтверждён по экранам в R93/R94/R97/R98/R100/R103/R111 — здесь он сведён в одну таблицу и дополнен путями, которых в тех отчётах не было.
- Топ-5:
  1. **Любой 401 при админ-действии** показывает английское `Unauthorized` / `Session is invalid` / `User not found` (`src/lib/auth.ts:166,175,185,206`) — повтор R41 №14.
  2. **Обрыв сети** в тостах и баннерах показывает браузерное `Failed to fetch` — ~15 мест (повтор R41 №9/№19; R100/R103/R111).
  3. **Контур техготовности**: 503 `Tenant settings are not configured` (`bootstrap-query.ts:185` → `client.ts:67-68`) и английские предпосылки If-Match в форме наряда (`etag.ts`) — повтор R41 №17, R21 №19.
  4. **Модули `sites` и `inspections`** отвечают английскими `ServiceError` (`Site not found`, `Inspection not found`), а экран печатает их дословно — повтор R41 №11, R100 №5.
  5. **Новые видимые подписи**: `MTBF`/`MTTR` (`admin-analytics-bits.tsx:82-83`), `Chat ID:`/`Token:` (`admin-telegram.tsx:263,266,400`), `Ctrl + K` (`admin-dictionaries.tsx:449`), `VIN` (`equipment-form.tsx:176`).
- В проекте уже есть готовые образцы правильного поведения: `catchText`/`extractApiError` (`admin-crews/crew-messages.ts:33-46`, `inspections/inspection-api-error.ts:42-55`, `admin-sites/use-site-mutations.ts:34-36`), `apiErrorMessage` (`src/lib/api-error-message.ts`) и `commandFailure` (`to/readiness/screens/shared.tsx:262`). Лечится подключением этих же helper'ов, а не переписыванием текстов.

## Методика

Всё read-only, воспроизводимо. Python нет — сканеры на `node` лежат в scratch.

1. Прогон сканера по `src/components/piling` и `src/app/(app)` (без `operator*`): JSX-текст между тегами, атрибуты `placeholder|title|aria-label|alt|label|description|hint`, строковые литералы внутри `toast.*`/`setError`/`throw new Error`, объекты `{ error: … }`. Отдельный режим — по `src/app/api/**` (без `api/auth/**`) на `error|message|reason|details: '…'` без кириллицы.
2. Ручные grep-и (все без кириллицы в строке):
   `grep -rnE "'[A-Za-z][A-Za-z'-]* [A-Za-z]"` по области — поиск англ. фраз;
   `grep -rnE "(label|title|name|placeholder|hint|unit|subtitle|header|description)\s*[:=]\s*['\"][A-Za-z]"`;
   `grep -rnE "new ServiceError\(\s*['\"][A-Za-z]"` по `src/modules`, `src/services`, `src/lib`;
   `grep -rnE "throw new Error\('[A-Za-z]"` по области;
   `grep -rn "транслит"` нет — проверялись только `[A-Za-z]`-строки без `[А-Яа-я]`.
3. Отдельно проверено, **доходит ли** строка до экрана: по каждому `err.message`-тосту читался `catch` и рендер состояния (`setError` → разметка), а английский `throw` внутри try считался видимым только если его не перекрывает русский `catch` (иначе — «внутренняя метка, не видна», в таблицу не попал).
4. Сверка с прошлыми отчётами: `grep -rn "<текст>" docs/audits/hermes-night/**` по `Unauthorized`, `Failed to fetch`, `CSRF validation`, `MTBF`, `Chat ID`, `User not found`.

## Находки

| № | важность | путь:строка | что видит человек | сценарий / почему важно | что предложить |
|---|----------|-------------|-------------------|--------------------------|----------------|
| 1 | мелочь | `src/components/piling/admin-analytics-bits.tsx:82` | Подпись метрики «MTBF» в плитке «Надёжность ТО», рядом русские «Готовность парка», «Выполнение ППР» | Английская аббревиатура без расшифровки на русском экране; не-технический админ не знает, что это | «Средняя наработка на отказ (MTBF)» |
| 2 | мелочь | `src/components/piling/admin-analytics-bits.tsx:83` | Подпись «MTTR» | То же, что №1 | «Среднее время восстановления (MTTR)» |
| 3 | мелочь | `src/components/piling/admin-telegram.tsx:263` | В карточке канала моноширинная строка `Chat ID: -1001234567…` | Подписи полей формы уже переведены («Токен бота», «ID чата»), а строки-значения — нет (R04 №3 закрыт лишь частично) | «ID чата: …» |
| 4 | мелочь | `src/components/piling/admin-telegram.tsx:266` | `Token: ••••abcd` рядом со строкой «Токен не задан — введите заново» на том же экране | Смесь языков в одной карточке | «Токен: ••••abcd» |
| 5 | мелочь | `src/components/piling/admin-telegram.tsx:400` | В подтверждении удаления канала: «Канал «…» (Chat ID: …) будет удалён без возможности восстановления.» | Англ. вкрапление внутри русского предупреждения об удалении | «(ID чата: …)» |
| 6 | мелочь | `src/components/piling/admin-equipment/equipment-form.tsx:176` | Подпись поля «VIN» (рядом «Описание», «Год выпуска») | Аббревиатура понятна, но единообразнее — с расшифровкой | «VIN (номер кузова)» или оставить как международный термин — решить владельцу |
| 7 | мелочь | `src/components/piling/admin-dictionaries.tsx:449` | Подсказка сочетания клавиш `<kbd>Ctrl + K</kbd>` в поле поиска | Латиница в подсказке; на русской клавиатуре клавиша подписана иначе | «Ctrl + K» — оставить (стандарт), либо убрать подсказку |
| 8 | мелочь | `src/components/piling/admin-users/user-detail.tsx:89`; `src/components/piling/admin-users/user-dialogs.tsx:128,264` | Подпись поля «Email» | Повтор R04 №6/№16 — признано допустимым заимствованием | Оставить или «Электронная почта» — единое решение для всего проекта |
| 9 | мелочь | `src/components/piling/login-page.tsx:116` | Поле «Email» на экране входа (рядом «Пароль») | Повтор R04 №16 | То же, что №8 |
| 10 | инфо | `src/components/piling/admin-equipment/equipment-brand-logo.ts:25-29` | Названия брендов техники: `PVE`, `Kopernik`, `ABI (Banut)`, `Liebherr`, `RTG Rammtechnik` | Это имена производителей, а не дрейф языка | Не менять |
| 11 | инфо | `src/app/(app)/layout.tsx:92,157,244`; `src/components/piling/login-page.tsx:107-108` | Логотип «Piling»/«Track» и бренд «PilingTrack» в шапке и футере входа | Фирменный знак | Не менять (повтор R04 №5) |
| 12 | инфо | `src/components/piling/to/readiness/settings/audit-section.tsx:160` | Технический текст «SHA-256» у поля подписи аудита | Термин, а не текст интерфейса | Не менять |
| 13 | важно | `src/lib/auth.ts:166,175,185,206` | Тосты получают `Unauthorized` / `Session is invalid` / `User not found` / `Authentication failed` через `body.error` | Сессия истекла во время сохранения любого админ-раздела — на русском экране английская строка (и `Authentication failed` при сбое БД виден всегда) | Разбирать статус на клиенте: 401 → «Сессия истекла — войдите снова» (образец — `admin-crews/crew-messages.ts:34`) (повтор R41 №14, R27 №10) |
| 14 | мелочь | `src/app/api/auth/me/route.ts:35` | Ответ `{ error: 'User not found' }`, 404 | `probeSession` (`src/lib/api.ts:167-184`) текст не показывает, но любой другой читатель `body.error` — покажет | «Пользователь не найден» (повтор R27 №10) |
| 15 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:69,187,261,263` (+ `application/queries/inspection-query.service.ts:52,55`) | `Equipment not found`, `Template not found`, `Inspection not found` | Через `api-wrapper` (`src/core/api-wrapper.ts:110`) уходит клиенту дословно; экран осмотров печатает как есть | Русские тексты в сервисе (повтор R100 №5) |
| 16 | важно | `src/modules/readiness/application/bootstrap-query.ts:185` → `src/components/piling/to/readiness/api/client.ts:67-68` | 503 `Tenant settings are not configured` показывается в контуре техготовности без перевода | Настройки не заданы — весь раздел отдаёт английскую строку; для `status >= 500` клиент подставляет серверный `message` как есть | Русский текст в `bootstrap-query.ts` либо не подставлять серверный `message` для 5xx (повтор R41 №17) |
| 17 | важно | `src/modules/readiness/application/command-pipeline/etag.ts:13,14,17,20,22,37,45` → `src/components/piling/to/readiness/forms/permit-form.tsx:226,253` | `Exactly one If-Match value is required`, `If-Match does not identify the requested aggregate`, `Expected version must be a non-negative integer` и др. | `invalidPrecondition` (400) кладёт английский текст в `error.message`, а `commandFailure` (`to/readiness/screens/shared.tsx:272-273`) возвращает серверную строку дословно → плашка ошибки формы наряда по-английски | Русский текст предпосылок в `etag.ts` (повтор R21 №19) |
| 18 | важно | `src/modules/sites/application/commands/site-admin-command.service.ts:36,44,87,319,403,405,406,419,455` | `Site not found`, `Name required`, `Parent not found`, `Invalid type`, `Hierarchy item not found`, `User not found` | Через `/api/sites/**` уходит клиенту; экран объектов печатает `body.error` (после 401/CSRF-маппинга остальное как есть) | Русские тексты в сервисе (повтор R41 №11) |
| 19 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:47,77` | `siteId, date required`, `dateFrom and dateTo are required` (400) | Через `/api/reports/period|edit` уходит в раздел отчётов | Единый русский текст «Укажите период» (повтор R04 №7) |
| 20 | мелочь | `src/modules/reports/application/commands/report-validation.service.ts:51` | `Missing required fields` (400) | Отказ формы отчёта без указания поля | «Не заполнены обязательные поля» (повтор R04 №7, класс) |
| 21 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:75` → рендер `:152` | Баннер «Не удалось загрузить установку: **Failed to fetch**» | Обрыв сети/прокси при открытии карточки техники — браузерное английское сообщение внутри русского | `catchText`/`TypeError`-маппинг, как в `crew-messages.ts:43` (повтор R41 №19) |
| 22 | важно | `src/components/piling/admin-equipment/use-fleet.ts:28` → `src/components/piling/admin-equipment/admin-equipment.tsx:86` | «Не удалось загрузить парк техники: **Failed to fetch**» | Обрыв сети на списке парка | То же (повтор R41 №19) |
| 23 | важно | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:171` → рендер `:233` | «Не удалось загрузить телеметрию: **Failed to fetch**» | Обрыв сети на вкладке телеметрии | То же (повтор R41 №19) |
| 24 | важно | `src/components/piling/admin-dictionaries.tsx:297,336,364,411,432` | Тост с `Failed to fetch` / `Unauthorized` / `CSRF validation failed: origin mismatch` | `responseError` (`:76-83`) возвращает `payload.error` как есть; при обрыве сети `catch` берёт `err.message` | `extractApiError`-подобный маппинг 401/CSRF/сети (повтор R103 №3/№4) |
| 25 | важно | `src/components/piling/report-form/photo-section.tsx:115,133` | Тост `Failed to fetch` / `Unexpected end of JSON input` при загрузке/удалении фото | Полевой оператор с плохой связью видит английскую техническую строку | `catchText` (повтор R111) |
| 26 | мелочь | `src/components/piling/equipment-analytics.tsx:109` → рендер `:174` | Баннер `QueryErrorBanner` с браузерным `Failed to fetch` | Обрыв сети на аналитике техники; экран не разбирался в R-сериях — новый путь того же класса | `TypeError`-маппинг (класс R41 №19) |
| 27 | мелочь | `src/components/piling/admin-dlq.tsx:153` | Тост `Failed to fetch` при «Повтор»/«Отбросить» события | Обрыв сети при действии с очередью; в R95 английские строки не отмечались — новый путь | `catchText` (класс R41) |
| 28 | мелочь | `src/components/piling/admin-equipment/detail/equipment-photos.tsx:117,132` | Тост `Failed to fetch` при загрузке/удалении фото | Обрыв сети | `catchText` (повтор R97 №10) |
| 29 | мелочь | `src/components/piling/maintenance/work-order-photos.tsx:120,136` | Тост `Failed to fetch` при фото наряда ТО | Обрыв сети | `catchText` (повтор R94) |
| 30 | мелочь | `src/components/piling/inspections/inspection-item-photos.tsx:136,154` | Тост `Failed to fetch` при фото пункта осмотра | Обрыв сети | `catchText` (повтор R100) |
| 31 | мелочь | `src/components/piling/to/fuel-panel.tsx:130`; `src/components/piling/to/maintenance-plans-panel.tsx:139`; `src/components/piling/to/meter-readings-panel.tsx:124` | Тост `Failed to fetch` на панелях ТО/топлива/показаний | Обрыв сети на вкладках ТО | `catchText` (повтор R94 №1) |
| 32 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:154` | Тост `Failed to fetch` при удалении отчёта | Обрыв сети | `catchText` (повтор R93) |
| 33 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:240` | Тост `Failed to fetch` при сохранении отчёта админом | Обрыв сети | `catchText` (повтор R93) |
| 34 | мелочь | `src/components/piling/admin-users/user-dialogs.tsx:101,238,343`; `src/components/piling/admin-users/user-documents.tsx:188,201` | Тост `Failed to fetch` при CRUD пользователя/документа | Обрыв сети в разделе «Пользователи» | `catchText` (повтор R98, R41 №9) |
| 35 | мелочь | `src/components/piling/admin-equipment/equipment-dialogs.tsx:55,120,175`; `src/components/piling/admin-equipment/detail/equipment-documents.tsx:140,156`; `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:120,134` | Тост `Failed to fetch` на CRUD техники/документов/нарядов ТО | Обрыв сети | `catchText` (повтор R97) |
| 36 | мелочь | `src/components/piling/inspections/start-inspection-form.tsx:178`; `src/components/piling/inspections/template-editor.tsx:168` | Тост `Failed to fetch` при старте осмотра/сохранении шаблона | Обрыв сети | `catchText` (повтор R100) |
| 37 | мелочь | `src/components/piling/to/readiness/shift-create-form.tsx:182`; `src/components/piling/to/readiness/screens/fleet-screen.tsx:81`; `src/components/piling/to/readiness/screens/settings-workspace.tsx:50` | Тост `Failed to fetch` при создании смены/экспорте/скачивании | Обрыв сети в контуре техготовности | `catchText` (класс R41) |

## Приложение: прочие места без кириллицы, признанные безопасными

Это английские `throw`, которые перехватываются и заменяются русским текстом до показа (проверено чтением `catch`), либо внутренние метки, не попадающие на экран:

- `src/components/piling/admin-dictionaries.tsx:132` (`'load'`), `:185` (`'audit'`) — ловятся, показывается «Ошибка загрузки справочников».
- `src/components/piling/admin-sites/index.tsx:155` (`'tree load failed'`), `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx:86` (`'Failed to load site plans'`) — `.catch(() => setDetailState('error'))`, текста нет.
- `src/components/piling/admin-sites/use-sites-data.ts:80,105` (`'Failed to load users'`/`'Failed to load pile grades'`) — ловятся, тост русский.
- `src/components/piling/admin-sites/use-sites-overview.ts:53` (`'overview load failed'`) → `overviewErrorMessage` (русский).
- `src/components/piling/inspections/inspection-api-error.ts:19` (`'inspection load failed'`), `:20` имя класса — маппятся через `loadErrorText`.
- `src/components/piling/report-form/use-report-form.ts:167` (`'load failed: sites=…'`) — ловится, тост русский (`:185`).
- `src/components/piling/admin-reports/use-report-history.ts:24` — `console.error`, не UI.
- `src/components/piling/monitoring/equipment-tile-storage.ts:34`, `equipment-tile-asset-storage.ts:69-90`, `monitoring/use-equipment-tile-template.ts:100` — IndexedDB/типы, наружу не показываются.
- `src/app/api/telemetry/ingest/route.ts:298` — внутренняя проверка тенанта.
- `src/app/api/alerts/webhook/route.ts:115` `reason: 'disabled'`; `src/app/api/readiness/**` `code: 'FORBIDDEN'` и т.п. — машинные коды, сообщения рядом русские, `error.code` экран не печатает (читает `error.message`/`error`).
- `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx` — русские (дефолт Next заменён), бренд `PilingTrack` — намеренно.
- `src/app/api/**` (`error|message: '…'` без кириллицы): кроме `auth/me:35` не найдено; обёртка `api-wrapper.ts:116,124,131,204` и `lib/tenant.ts:28` — уже на русском (закрытая находка R41 №15).

## Не проверено

- **Реальный рендер.** Сервер/`npm run build` не поднимались, всё — по исходникам. Не проверено, что каждый путь из класса C (№21-37) достижим именно на обрыве сети, а не перехватывается раньше: вывод основан на чтении `catch` (там, где `await authFetch(...)` внутри try и `toast.error(... err.message ...)`, `TypeError` от fetch дойдёт до тоста) — на живом браузере это не воспроизводилось.
- **Полный обход `src/modules`/`src/services`.** Проверены только `new ServiceError('…')`/`throw new Error('…')` текстом, начинающимся с латиницы, по `src/modules`, `src/services`, `src/lib`, `src/core`. Строки, собранные шаблоном или начинающиеся с русского, не вычитывались; возможны непоказанные здесь английские сообщения в глубине модулей.
- **Проброс через `apiErrorMessage`.** Для 400 с `details` переводятся только тексты zod, перечисленные в `src/lib/api-error-message.ts:50-56`; остальные английские `message` zod могли не попасть в таблицу (проверялось на уровне helper'а, не по всем схемам).
- **Экраны машиниста и ORION** — вне области задачи, не сканировались (замороженные зоны).
- **Живой текст Telegram-шаблонов и e-mail** (шапка алертов «High Alert / Site / Report / Rule» из R12 №4) — вне области `src/components/piling`/`src/app/(app)`; в этом отчёте не перепроверялся.