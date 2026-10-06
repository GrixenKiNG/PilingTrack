# R135 — Уведомления в приложении: тосты и баннеры

Дата: 2026-10-04. Ветка: `hermes/q4-0926` (worktree `wt-night`). Метод: только чтение кода, браузер не запускался. Замороженные зоны (экраны оператора `operator*`, сайт ORION) не разбирались.

## Итог

Всего находок: **29**. Критично — **0**, важно — **14**, мелочь — **15**.

Тосты в продукте — это sonner (`src/app/layout.tsx:116`), всего ~400 вызовов в 71 файле; баннеры — `QueryErrorBanner`/`LoadFailure`/`Alert` и лента-колокольчик `FeedbackCenter`. Оба канала местами дублируют друг друга.

Топ-5:
1. **Все тосты живут 4 с.** `<Toaster>` не задаёт `duration`, у sonner `TOAST_LIFETIME = 4000` — важная ошибка (не сохранился отчёт, конфликт правок, отклонение CSRF, «Сессия истекла») исчезает через 4 с, прочитать её повторно негде. №1.
2. **На телефоне тост накрывает шапку.** `position="top-center"` + sonner на `<600px` растягивает тост на всю ширину у самого верха (16 px) с `z-index:999999999`, а шапка приложения — `sticky top-0 z-30` с кнопками меню/уведомлений/выхода. №2.
3. **Дубли «тост + баннер» об одном сбое.** Отказ загрузки показывается дважды сразу в: истории отчётов, админ-отчётах (список и догрузка), нарядах ТО, центре техготовности и всех трёх панелях ТО. №4–№9.
4. **Отказ чтения только тостом** (нет баннера и «Повторить», пустой список читается как «данных нет») — 14 экранов админки/настроек. №11.
5. **Несогласованность формулировок и уровня.** Пять разных текстов «нет связи» (№13), 289 `toast.error` против 3 `warning` и 3 `info` (№20), валидация пустого поля — красной ошибкой (№15).

## Методика

Область: `src/**` (тосты, баннеры, лента уведомлений), кроме `operator*`/`orion`. Файлы читались через `read_file`; номера строк — из этих чтений.

Поиски (все можно повторить из корня репозитория):

```bash
# движки тостов и их монтирование
grep -rn "from 'sonner'\|from \"sonner\"" src
grep -rn "ui/toast\|use-toast\|ui/toaster\|Toaster" src e2e tests scripts
# все вызовы по типу (числа в отчёте — без тестов)
for t in success error warning info; do grep -rn "toast\.$t(" src --include=*.ts --include=*.tsx | grep -v "__tests__\|\.test\." | wc -l; done
# дедуп/длительность/прогресс
grep -rn "duration:\|toast\.promise\|toast\.loading\|toast\.custom" src
grep -rn "\{ id: '" src
# баннеры и лента
grep -rn "QueryErrorBanner" src
grep -rn "pushClientFeedback\|addLocalFeedbackEvent" src
grep -rn "navigator\.onLine\|addEventListener\('online'\|addEventListener\('offline'" src
# тексты отказов
grep -rn "Нет связи с сервером\|Нет соединения с сервером\|Сессия истекла" src
# моки sonner в тестах
grep -rn "toast: \{ error: vi.fn(), success: vi.fn() \}" src
```

Дефолты sonner проверены в установленном пакете: `node_modules/sonner/dist/index.mjs` — `TOAST_LIFETIME = 4000`, `VISIBLE_TOASTS_AMOUNT = 3`, `VIEWPORT_OFFSET = '24px'`, `MOBILE_VIEWPORT_OFFSET = '16px'`, CSS `z-index:999999999` и `@media (max-width:600px){ [data-sonner-toaster]{ width:100% } }`, тост `role="status" aria-live="polite" aria-atomic="false"`. В `src/app/globals.css` переопределений sonner нет (`grep sonner|toast|Toaster` = 0).

Прочитаны (не исчерпывающе): `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx`, `src/lib/hooks/use-toast.ts`, `src/components/ui/alert.tsx`, `src/components/piling/async-ui.tsx`, `feedback-center.tsx`, `acting-as-banner.tsx`, `use-feedback-feed.ts`, `app-error-boundary.tsx`, `report-history.tsx`, `to/to-module.tsx`, `to/load-failure.tsx`, `to/fuel-panel.tsx`, `to/meter-readings-panel.tsx`, `to/maintenance-plans-panel.tsx`, `maintenance/maintenance-board.tsx`, `maintenance/maintenance-helpers.ts`, `admin-reports/*` (admin-reports, use-reports-data, report-form-dialog), `admin-crews/*` (admin-crews, use-crews-data, crew-messages), `admin-sites/*` (index, use-site-mutations, use-sites-data), `admin-users/*`, `admin-equipment/*`, `admin-dictionaries.tsx`, `admin-dlq.tsx`, `report-form/*` (use-report-form, report-form, photo-section), `inspections/*` (inspection-api-error, template-list, inspections-list, template-editor, start-inspection-form), `to/readiness/screens/shared.tsx`, `to/readiness/settings/*`, `lib/api.ts`, `lib/client-feedback.ts`, `lib/store.ts`.

Ранее найденное помечено «повтор Rnn»: `docs/audits/hermes-night/16-empty-error-states.md`, `21-form-validation.md`, `22-phone-layout.md`, `04-ui-texts.md`, `12-notifications-map.md`.

## Находки

| № | важность | файл:строка | что видит человек | что предложить |
|---|---|---|---|---|
| 1 | важно | `src/app/layout.tsx:116` | Тост с ошибкой (не сохранился отчёт, конфликт правок, отклонение CSRF, «Сессия истекла») виден ровно 4 с и исчезает без следа. `<Toaster>` не задаёт `duration`; дефолт sonner `TOAST_LIFETIME=4000` (`node_modules/sonner/dist/index.mjs`); `grep "duration:"` по `src` = 0 вне CSS. Прочитать ошибку повторно негде. | `toastOptions={{ duration }}` для `error` (или `Infinity` у критичных) и/или постоянный баннер для того, что требует действия. |
| 2 | важно | `src/app/layout.tsx:116` + `src/app/(app)/layout.tsx:95-117,245-263` | `position="top-center"`: на телефоне sonner делает тост во всю ширину у самого верха (`MOBILE_VIEWPORT_OFFSET='16px'`, `z-index:999999999`), а шапка — `sticky top-0 z-30` с кнопками «меню», колокольчика и «Выйти». 4 с тост накрывает эти кнопки — их нельзя нажать. То же для диалогов: тост рисуется выше Radix-диалога. | На мобильном `position="bottom-*"` либо `offset`/`mobileOffset` под шапку; либо поднять шапку в z-порядке и не класть тост на неё. |
| 3 | важно | `src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx`, `src/lib/hooks/use-toast.ts` | В репозитории два тост-движка: живой sonner (`src/app/layout.tsx:116`) и мёртвый Radix (эти три файла ссылаются только друг на друга — `grep "ui/toast\|use-toast\|Toaster"` по `src e2e tests scripts` даёт только sonner). В мёртвом `TOAST_LIMIT=1` (`use-toast.ts:11`) и `TOAST_REMOVE_DELAY=1000000` (`:12`). Правка «не того» файла — реальный риск; зависимость `@radix-ui/react-toast` (`package.json:88`) держится только им. | Удалить три файла (с доказательством неиспользуемости по AGENTS.md §4) и зависимость, либо явно пометить «не используется». |
| 4 | важно | `src/components/piling/report-history.tsx:67,76` + `:244` | Сбой загрузки истории: одновременно тост «История отчётов не загрузилась» и красный баннер «Не удалось загрузить отчёты» об одном и том же. | Оставить баннер с «Повторить» (`:244`), тост убрать. |
| 5 | важно | `src/components/piling/admin-reports/use-reports-data.ts:249,258` + `src/components/piling/admin-reports/admin-reports.tsx:283` | Сбой загрузки отчётов: тост «Ошибка загрузки отчётов» + баннер «Не удалось загрузить отчёты». Дубль. | Тост убрать, оставить баннер с «Повторить». |
| 6 | важно | `src/components/piling/admin-reports/use-reports-data.ts:298,308` + `src/components/piling/admin-reports/admin-reports.tsx:438-440` | Сбой догрузки: тост «Ошибка догрузки отчётов» + инлайн-текст рядом с «Показать ещё». Дубль. | Оставить инлайн-текст (данные на месте), тост убрать. |
| 7 | важно | `src/components/piling/maintenance/maintenance-board.tsx:104,112` + `:384-388` | Сбой загрузки нарядов ТО: тост + инлайн `loadError`. Дубль. В коде уже есть `quiet` для 409 (`:94-96`), но путь загрузки не приглушён. | Приглушить тост и там (или убрать инлайн). |
| 8 | важно | `src/components/piling/to/to-module.tsx:554` + `:547` | Сбой загрузки центра техготовности: тост «Не удалось загрузить центр технической готовности» + баннер (`workspaceError`). Дубль. | Оставить баннер с повтором, тост убрать. |
| 9 | важно | `src/components/piling/to/fuel-panel.tsx:73,86` + `:236-237`; `src/components/piling/to/meter-readings-panel.tsx:65,78` + `:197-198`; `src/components/piling/to/maintenance-plans-panel.tsx:75,84` + `:219-220` | Каждая из трёх панелей ТО показывает и тост, и `LoadFailure`-баннер об одном отказе. Повтор R16 №5 — но теперь наоборот: баннер добавлен, а тост оставлен. | Убрать тост, оставить баннер с «Повторить». |
| 10 | важно | `src/lib/api.ts:38,72` + `src/lib/store.ts:123-159` | Один сетевой/5xx-сбой даёт И тост у вызывающего, И запись в колокольчике («Сетевой сбой» CRITICAL / «Серверная ошибка» HIGH) — два канала об одном событии. Плюс каждый 5xx persist-ится (`api.ts:85`) без дедупа (`store.ts:158`, cap 30): при аварии колокольчик забивается одинаковыми записями, счётчик «9+». | Не дублировать: либо тост, либо запись в ленте; дедуп сетевых событий (по url+status в окне времени). |
| 11 | важно | `admin-users/use-users-list.ts:80`; `admin-sites/use-sites-data.ts:86,111`; `admin-dictionaries.tsx:139`; `admin-equipment/use-equipment-list.ts:50`; `admin-equipment/detail/equipment-inspections.tsx:42`; `admin-equipment/detail/equipment-maintenance.tsx:79`; `maintenance/work-order-form-dialog.tsx:195`; `maintenance/work-order-photos.tsx:84`; `report-form/use-report-form.ts:187,190,222`; `to/readiness/settings/roles-section.tsx:93,99,108,114`; `notifications-section.tsx:78,96`; `integrations-section.tsx:42,48`; `dictionaries-section.tsx:76,87` | Отказ чтения показан ТОЛЬКО тостом на 4 с: ни баннера, ни «Повторить», список остаётся пустым и читается как «данных нет» (ровно то, что запрещает PRODUCT.md). Частично повтор R16 №5, R21 №23/#24. | Переводить на `QueryErrorBanner`/`LoadFailure` с повтором (образец — `async-ui.tsx:57`). |
| 12 | важно | `src/lib/api.ts:56-69` + `src/app/(app)/layout.tsx:349-353` | При 401 приложение молча разлогинивает и уводит на `/login`; сообщение «Сессия истекла — войдите снова.» приходит тостом у вызывающего (4 с) и/или теряется при переходе. На экране входа нет объяснения, почему выкинуло. | Показывать причину на `/login` (query-параметр/баннер «Сессия истекла»), а не только тостом. |
| 13 | важно | `inspections/inspection-api-error.ts:14`, `admin-crews/crew-messages.ts:15`, `admin-sites/use-site-mutations.ts:21` («Нет соединения… Проверьте связь») / `to/load-failure.tsx:28` («…Проверьте подключение») / `maintenance/maintenance-helpers.ts:61` («…— повторите при появлении сети») / `login-page.tsx:46` («…Проверьте интернет») / `report-form-dialog.tsx:246` («…нажмите «Сохранить» ещё раз») | Один и тот же обрыв связи описывается пятью разными фразами на разных экранах. | Один общий текст (и один хелпер) на весь продукт. |
| 14 | важно | `src/components/piling/admin-dlq.tsx:209-215` + `:223-228` | При `loadError` одновременно рисуются красный баннер ошибки и зелёный «Недоставленных событий нет» с галочкой. Повтор R16 №7 (не исправлено). | Ветки сделать взаимоисключающими (`else if`). |
| 15 | важно | `login-page.tsx:31`; `admin-crews/crew-form-dialog.tsx:178,185`; `admin-reports/report-form-dialog.tsx:135,146,161,194,197`; `admin-dictionaries.tsx:247,257,262`; `report-form/use-report-form.ts:363,370,377,395,407,408,416`; `inspections/start-inspection-form.tsx:157,158`; `admin-sites/site-editor/add-hierarchy-dialog.tsx:39`, `create-site-dialog.tsx:52`, `edit-site-dialog.tsx:164,168` | Незаполненное поле показывается красной ошибкой-тостом и исчезает через 4 с; поле не подсвечивается, к нему не прокручивают. Повтор R21 №17/#18. | Подсветить конкретное поле + `aria-invalid`, тост убрать или сделать подсказкой у поля. |
| 16 | мелочь | `report-form-dialog.tsx:231` (конфликт правок — `toast.error`) против `report-form/use-report-form.ts:451` (meter-warning — `toast.warning`) | Похожие «предупреждения» (отчёт изменён другим пользователем; моточасы не записаны) идут то как error, то как warning, то как info. Единого правила выбора уровня нет. | Определить: конфликт/предупреждение = `warning`, сбой = `error`; привести вызовы. |
| 17 | мелочь | `admin-dictionaries.tsx:281` / `workspace-settings.tsx:169` / `admin-dictionaries.tsx:326` / `report-form/use-report-form.ts:448` / `admin-crews/admin-crews.tsx:179` | Успех подтверждается по-разному: «Сохранено», «Настройки сохранены», «Элемент добавлен»/«Переименовано», «Отчёт успешно отправлен!» (с восклицательным знаком), «Бригада деактивирована — её можно активировать снова». | Единый шаблон «<Что> <глагол>» без восклицательных знаков. |
| 18 | мелочь | `login-page.tsx:68` (повтор R04 №1), `report-form-dialog.tsx:248`, `admin-users/use-users-list.ts:157`, `to/readiness/settings/roles-section.tsx:172,189`, `report-form/photo-section.tsx:115,133` | Тост показывает сырой `err.message` — при нестандартном ответе это может быть техническая/английская строка, тогда как на других экранах та же ошибка переводится хелпером. | Пропускать через `apiErrorMessage`/`catchText`, как в соседних экранах. |
| 19 | мелочь | `admin-sites/use-site-mutations.ts:34-36` против `inspections/inspection-api-error.ts:52`, `admin-crews/crew-messages.ts:43`, `to/load-failure.tsx:27` | Одноимённые `catchText` ведут себя по-разному: большинство отдают `cause.message`, а этот — фиксированное «Сервер ответил неожиданно, повторите позже.», теряя причину. | Один `catchText` на продукт (в `src/lib`). |
| 20 | мелочь | `to/meter-readings-panel.tsx:118`, `to/readiness/screens/shared.tsx:51`, `report-form/use-report-form.ts:451` (warning) и `use-report-form.ts:339` (info) | Всего 3 `warning` и 3 `info` против 289 `error` и 105 `success` (без тестов). Предупреждения о неполных данных (пустая выгрузка, нетронутые моточасы) часто показаны как `error`. | Осознанно использовать `warning` для «сделано, но с замечанием». |
| 21 | мелочь | `to/__tests__/to-panels-mobile-targets.test.tsx:12` и ещё 13 файлов с `toast: { error: vi.fn(), success: vi.fn() }` | Мок sonner не содержит `warning`/`info`; пути `toast.warning` (`meter-readings-panel.tsx:118`, `shared.tsx:51`) не покрыты и упадут `TypeError`, если их тронуть тестом. | Добавить `warning`/`info` в моки (или один общий `vi.mock('sonner')`). |
| 22 | мелочь | `src/components/ui/alert.tsx:30`, `to/load-failure.tsx:35` против sonner-тостов | Баннеры объявляются `role="alert"` (assertive), а тосты sonner — `role="status" aria-live="polite"`. Один и тот же отказ звучит для скринридера с разной громкостью. | Для критичных тостов задавать `aria-live` или дублировать баннером. |
| 23 | мелочь | `src/app/layout.tsx:116` | Ни один вызов `toast.*` не задаёт `id` (grep `{ id: '` = 0) — повторные одинаковые тосты копятся (sonner `visibleToasts=3`). Например, несколько подряд неудачных «Сохранить». | Использовать `id` для дедупа повторяющихся сообщений. |
| 24 | мелочь | `admin-equipment/detail/equipment-report-export.tsx:99-137` (и прочие выгрузки) | Долгая операция (генерация/выгрузка PDF) показывает занятость только на кнопке; `toast.loading`/`promise` в проекте нет ни одного (grep = 0) — при медленном ответе экран выглядит зависшим. | `toast.loading`/`toast.promise` для операций >2 с. |
| 25 | мелочь | `src/app/layout.tsx:116` (`richColors`) | `richColors` берёт встроенные цвета sonner (hsl green/red/amber/blue), а не палитру продукта (`--signal`, `--success`, `--warning`, `--destructive`) — визуальный дрейф на фоне остального UI. | Свои классы/токены для типов тостов. |
| 26 | мелочь | `acting-as-banner.tsx:41-67` | Постоянный баннер «Просмотр от роли: …» без `role="status"`/`aria-live`; при смене роли страница перезагружается, но сам баннер не озвучивается. | `role="status"` на баннер. |
| 27 | мелочь | `src/lib/api.ts:36-54` + отсутствие слушателей `online`/`offline` в оболочке (`(app)/layout.tsx`) | Обрыв сети показывается только тостами (4 с) и записями в колокольчике; постоянного баннера «нет сети» нет. Слушатели `online`/`offline` есть только в замороженном `operator-mobile` и в `monitoring/fleet-dashboard.tsx:153`. | Постоянная полоска «Нет сети» в оболочке приложения. |
| 28 | мелочь | `admin-reports/admin-reports.tsx:84,91,118` | Ошибки выгрузки периода — тосты на 4 с («Выберите и примените период до 92 дней…»); поле периода при этом не подсвечивается и не прокручивается. | Подсветить поле периода/кнопку, а не только тост. |
| 29 | мелочь | `feedback-center.tsx:193,248` | Бейдж «Активные сигналы» считает `warn`+`error` по объединённому списку (локальные+серверные), а «Критичные» — из серверной сводки; при дублях из №10 счётчики расходятся с содержимым. | Считать оба счётчика по одному набору. |

## Не проверено

- **Фактический рендер в браузере** не запускался (задача — только чтение). Вывод №2 (перекрытие кнопок на телефоне) и №24 (ощущение «зависло») — из CSS/дефолтов sonner и разметки шапок, а не из живого замера; вьюпорт 375 px не измерялся.
- **Поведение тоста при 401 в рантайме** (успевает ли он показаться до редиректа на `/login`) — по коду неоднозначно (тост у вызывающего + редирект из `(app)/layout.tsx:349-353`); не воспроизводил.
- **Экраны оператора** (`operator*`, включая `operator-v2/v3/mobile`) и **ORION** — замороженные зоны: в таблицу не включал, их тосты (`toast.info` в `operator-shift-v2.tsx:474,552` и др.) не разбирал.
- **Фактическая доставка/настройки Telegram-уведомлений** — вне скоупа (см. `12-notifications-map.md`).
- **Числа вызовов** (289 error / 105 success / 3 warning / 3 info) получены грепом без тестов; из-за мультистрочных вызовов могут слегка отличаться, на выводы не влияет.