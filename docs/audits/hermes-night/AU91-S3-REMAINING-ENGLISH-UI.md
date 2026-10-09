# AU91-S3 — Остаточные английские строки в интерфейсе

Версия репозитория: `git rev-parse HEAD` → `20c8bdebe5673f9f6ab1bd4d95638e86220011b0`
(рабочая папка `D:\PillingR\wt-night`, ветка `hermes/q4-0926`; `AGENTS.md` был изменён в рабочей копии — на результат не влияет).

## Итог

- Проверено: английских подписей/текстов в интерфейсе почти не осталось; основной слой — русский.
- критично — 0; важно — 8; мелочь — 5; отдельно (заморозка) — 2.
- Самое важное: `src/lib/api-error-message.ts:50` — карта переводов написана под формулировки zod v3, а проект на zod 4.6.5. Из пяти префиксов совпадает только `Invalid input`, поэтому тексты валидации приходят пользователю по-английски прямо в тосты формы отчёта.
- Второй слой той же проблемы — английские сообщения, заданные вручную в схемах: `src/lib/validation-schemas.ts:247` («Invalid date format (YYYY-MM-DD)») и `:260` («Count must be at least 1») — уходят в `details` маршрута отчёта и показываются в тосте.
- Видимая надпись `Email` встречается в 4 местах: экран входа и карточка/диалоги пользователя.
- Замороженные операторские экраны английского не содержат; единственное — ORION-сайт (в списке ниже).

## Методика

Только чтение; ни один файл приложения не изменён. Поиск вёлся `rg` (ripgrep 15.2.0) по `src/`, исключая тесты (`*.test.*`, `__tests__`), сгенерированный код (`**/generated/**`), и по умолчанию — замороженные каталоги (`operator*`, `orion*`). Числа получены командами, строки сверены чтением файлов.

Что именно искал и как (можно повторить):

- Атрибуты с латиницей: `rg -n --pcre2 '(placeholder|aria-label|alt|title|label|description)=("[^"]*[A-Za-z]|\{`[^`]*[A-Za-z])'`, затем фильтр «значение без кириллицы».
- Текстовые узлы JSX: `rg -n --pcre2 -o '>[ \t]*[A-Za-z][A-Za-z '"'"'.,!?()–—-]{0,60}<'`.
- Многословные английские литералы: `rg -n --pcre2 "['\"`][A-Za-z]{2,}( [A-Za-z][A-Za-z']*){1,8}['\"`]"` по `src/**`.
- Отдельно по серверным сообщениям: `rg -n 'ServiceError\(', 'toast\.(success|error|info)\(', `'label='`, `'aria-label='``, `.min(/.max(/.regex(` с английскими аргументами.
- Проверка версии и текстов zod (числа из команд):
  - `node -e "console.log(require('zod/package.json').version)"` → `4.6.5`.
  - `z.string().min(1)` → `Too small: expected string to have >=1 characters`;
  - `z.number().min(0)` → `Too small: expected number to be >=0`;
  - `z.string().max(2000)` → `Too big: expected string to have <=2000 characters`;
  - `z.array(z.string()).max(100)` → `Too big: expected array to have <=100 items`;
  - `z.enum(['DAY','NIGHT'])` → `Invalid option: expected one of "DAY"|"NIGHT"`;
  - `z.number().int()` → `Invalid input: expected int, received number`.
- Дефолтные подписи sonner: чтение `node_modules/sonner/dist/index.mjs` — `closeButtonAriaLabel = 'Close toast'`, `containerAriaLabel = 'Notifications'`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/lib/api-error-message.ts:50` | Карта `MESSAGE_TRANSLATIONS` написана под zod v3 (`String must contain at least 1 character(s)`, `Number must be greater than or equal to 0`). Проект на zod 4.6.5, который эти же ограничения описывает иначе (`Too small: …`, `Too big: …`, `Invalid option: …`). Совпадает только префикс `Invalid input`. | Пользователь сохраняет отчёт с отрицательным простоем / слишком длинным комментарием / неверным числом — в тост попадает английский текст: «Простой, строка 1: длительность: Too small: expected number to be >=0». Функция уходит в фолбэк headline только когда `details` пуст; здесь `details` непуст, поэтому английский текст виден. | Добавить v4-префиксы (`Too small`, `Too big`, `Invalid option`, `expected int`) в карту **или** задавать русские сообщения прямо в схемах; закрыть тестом на реальный zod v4. |
| 2 | важно | `src/lib/validation-schemas.ts:247` | Английское сообщение `'Invalid date format (YYYY-MM-DD)'` для поля `date`. | Неверная дата отчёта → `details` (`src/app/api/reports/upsert/route.ts:47`) → `apiErrorMessage` → тост по-английски. | Заменить на русское («Неверный формат даты (ГГГГ-ММ-ДД)»). |
| 3 | важно | `src/lib/validation-schemas.ts:260` | Английское сообщение `'Count must be at least 1'` для `piles[].count`. | Количество свай < 1 → тост «Сваи, строка 1: количество: Count must be at least 1». | Заменить на русское («Количество не меньше 1»). |
| 4 | важно | `src/components/piling/login-page.tsx:116` | Подпись поля `<Label>Email</Label>` на экране входа; соседнее поле — «Пароль». | Иногородний/новый пользователь на первом экране видит смесь языков. | `Электронная почта` (учесть тест `src/components/piling/__tests__/login-page.test.tsx:74` — `getByLabelText('Email')`). |
| 5 | важно | `src/components/piling/admin-users/user-dialogs.tsx:156` | `label="Email"` в диалоге создания пользователя. | Смесь с «Имя», «Телефон», «Пароль». | `Электронная почта`. |
| 6 | важно | `src/components/piling/admin-users/user-dialogs.tsx:311` | `label="Email"` в диалоге правки пользователя. | То же. | `Электронная почта`. |
| 7 | важно | `src/components/piling/admin-users/user-detail.tsx:105` | `<OpsFact label="Email" …/>` в карточке сотрудника. | Смесь с русскими фактами карточки. | `Электронная почта`. |
| 8 | важно | `src/components/piling/admin-users/user-dialogs.tsx:105` | Валидация `next.email = 'Email обязателен'` (и то же на `:261`). | Отправка формы без почты → под полем надпись «Email обязателен» (англ. слово в русской фразе). | `Электронная почта обязательна`. |
| 9 | мелочь | `src/app/layout.tsx:116` | `<Toaster … closeButton />` без переопределения подписей; sonner по умолчанию даёт `aria-label="Close toast"` (кнопка закрытия) и `aria-label="Notifications …"` (регион тостов). | Английские подписи читает только скринридер, но это единственный аудио-интерфейс у незрячего пользователя. | Передать `closeButtonAriaLabel="Закрыть уведомление"` и `containerAriaLabel="Уведомления"`. |
| 10 | мелочь | `src/app/api/telegram/configs/route.ts:19` | `z.string().min(1, 'Invalid ID')` — английское сообщение id. | Диалог Telegram использует `apiErrorMessage`; при пустом `id` возможен английский текст в тосте (штатный UI id всегда заполняет — поэтому мелочь). | Заменить на русское или убрать кастомный текст. |
| 11 | мелочь | `src/components/piling/feedback-center.tsx:325` | Всплывающая подсказка `title={\`requestId: ${…}\`}` — английский технический префикс. | Виден при наведении у привилегированных ролей; сама метка рядом — «ID обращения». | `ID обращения: …` (оставить сам id). |
| 12 | мелочь | `src/components/piling/admin-equipment/equipment-form.tsx:218` | Подпись поля `VIN` (латиница). | Аббревиатура общепринята в документах РФ, поэтому не ошибка, но формально это латинская строка в русской форме. | Оставить (норма) либо `VIN (номер кузова)`. |
| 13 | мелочь | `src/lib/validation-schemas.ts:43` | Английское `'Password must contain at least 8 characters'` в `userBaseSchema`. | Сейчас пользователю не показывается: `use-users-list.ts:100,124` берёт только `err.error` (headline «Некорректные данные»), а не `details`. Латентный английский текст остаётся в контракте API. | Заменить на русское для консистентности контракта. |

## Замороженные экраны (только список, не править)

Найдено чтением замороженных каталогов (`src/app/operator`, `src/app/(app)/operator`, `src/components/piling/operator*`, `src/modules/operator-mobile`, `src/app/orion`, `src/components/orion`):

- `src/components/orion/orion-handoff-site.tsx:333` — текстовый узел `EMAIL` (подпись поля формы заявки на публичном сайте ORION).
- `src/components/orion/orion-handoff-site.tsx:342` — `<label>Email` (то же поле).
- Операторские экраны-варианты (`operator-v5`, `operator-mobile/v7`, `operator-mobile/v10`, `operator-dashboard.tsx`) английских пользовательских строк **не содержат** — только бренд `PilingTrack` (`src/components/piling/operator-mobile/v7/operator-v7-app.tsx:456`).

## Не проверено

- Показываются ли пользователю английские строки-ответы аутентификации `'Unauthorized'`/`'Session is invalid'`/`'User not found'`/`'Authentication failed'` (`src/lib/auth.ts:166,175,185,206`) на экранах вне «Технической готовности». Экран готовности перекрывает 401 своим русским текстом (`src/components/piling/to/readiness/api/client.ts:64,70` и `src/components/piling/to/readiness/screens/shared.tsx:120`), но остальные читающие экраны не проверялись построчно — ГИПОТЕЗА, что не показываются: `authFetch` на 401 сам вызывает logout (`src/lib/api.ts:57`), поэтому текст обычно не доходит до экрана. Проверить не удалось без запуска приложения с реальной сессией.
- Английские `ServiceError` (`'Readiness access denied'`, `'Tenant settings are not configured'`, `'Tenant context missing'`, `'Equipment not found'`) — теоретически уходят в `{ error }` (`src/core/api-wrapper.ts:108`), но для экрана готовности подавляются `russianOr` (`client.ts:64`). Достижимость на остальных экранах не проверял. Статус: ГИПОТЕЗА.
- Внутренние английские строки, которые я **убедился**, что не показываются (проверены catch-ветки), но перечисляю для полноты: `src/components/piling/admin-sites/index.tsx:162` (`'tree load failed'` → `catch` ставит булев флаг), `src/components/piling/admin-sites/use-sites-data.ts:80,105` (`'Failed to load users/pile grades'` → русский тост), `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx:97` (`'Failed to load site plans'` → `detailState('error')`).
- Сообщения `logger.*` в воркерах и сервисах (`src/workers/**`, `src/core/**`) — английские, но это логи, а не интерфейс; не включал в находки.
- Не проверял: содержимое Telegram-шаблонов уведомлений, e-mail/PDF-выгрузки вне `src/lib/pdf-generator` (в просмотренных PDF-файлах текст русский), а также текст в `public/**` (вне области задачи).
- Не запускал проверки из §6 AGENTS.md (задача только на чтение, код не менялся) — `tsc`, `lint`, `test:unit`, `build` не выполнялись.
