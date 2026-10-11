# AU113-S3 — Состояния загрузки, пустоты и ошибки по страницам

Версия: `git rev-parse HEAD` = `6c4d1544c80384567071dd316e7ad016e5c75c38` (worktree `D:\PillingR\wt-night`, ветка `hermes/q4-0926`).
Тип работы: только чтение кода; изменён один файл — сам этот отчёт.
Замороженные области (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/app/orion/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) в разбор не включены, кроме одной строки-упоминания (см. находку 12).

## Итог

- Всего находок: **12** — критично **1**, важно **6**, мелочь **5**.
- Проверено страниц `page.tsx` (не замороженных): 33; глобальных/секционных границ ошибок и загрузки: 6 файлов.
- Главная находка (критично): `/admin/to/shifts/new` при сетевом сбое остаётся **белым экраном навсегда** — у запроса нет `catch`, а компонент при `timezone === null` возвращает `null`, без сообщения и без «Повторить» (`src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:21-30`).
- Топ-5 по значимости:
  1. `/admin/to/shifts/new` — белый экран без выхода (критично, №1).
  2. `equipment-inspections` — при сбое загрузки показывает «Осмотров ... пока нет» вместо ошибки (важно, №2).
  3. `equipment-maintenance` — то же: ложное «Записей по обслуживанию пока нет» (важно, №3).
  4. `equipment-to-tab` — то же: ложное «Записей ТО ... пока нет», ошибка глушится `catch { /* ignore */ }` (важно, №4).
  5. `equipment-photos` — при `!res.ok` тихо `setPhotos([])` → «Загрузить первое фото», плюс отсутствует `catch` на обрыв сети (важно, №5).
- Общая инфраструктура состояний сильная: две `loading.tsx` (корень и `(app)`), две `error.tsx` с кнопкой «Повторить», `global-error.tsx`, `not-found.tsx`, общий `QueryErrorBanner` (`async-ui.tsx`) и общий `LoadFailure`/`BootstrapBoundary` для контура ТО. Слабые места — точечные самозагружающиеся под-компоненты, которые перепутали «не загрузилось» с «пусто».

## Методика

Что и как искал (можно повторить):

1. Инвентаризация: `find src/app -name page.tsx` (46 файлов), `loading.tsx` (2), `error.tsx`/`global-error.tsx` (3), `not-found.tsx` (1), `layout.tsx` (20), `template.tsx` (0). Замороженные пути исключены по AGENTS.md.
2. Карта «страница → экран»: для каждого `page.tsx` прочитаны строки `import`/`export default`/`return`, найден корневой компонент экрана (`grep -nE "^import |return |export default"`).
3. Поиск признаков состояний в компонентах: `grep -rn` по `src/components/piling` для `Загрузка|Skeleton|loading`, `Повторить|Обновить|retry`, `loadError|setError|setFailed`, `пока нет|нет данных|ничего не найдено`, `QueryErrorBanner|LoadFailure|EmptyState`.
4. Отдельно проверены все компоненты, которые сами делают `authFetch`/`fetch` (≈90 файлов): для каждого прочитан загрузчик и ветка рендера «loading / error / empty», чтобы найти пропущенную ветку ошибки или ложную пустоту.
5. Границы ошибок: прочитаны `src/app/loading.tsx`, `src/app/(app)/loading.tsx`, `src/app/error.tsx`, `src/app/(app)/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, `src/components/piling/app-error-boundary.tsx`, `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx`, `.../active-view-error-boundary.tsx`, `src/components/piling/async-ui.tsx`.
6. Подтверждение «белого экрана»: проверено, что `authFetch` при сетевом сбое **пробрасывает** исключение (`src/lib/api.ts:29-57`, `throw error`), а не возвращает синтетический ответ — значит ветка `.catch`/`try` обязательна, и там, где её нет, состояние «загрузка» не снимается.

Каждый `path:line` ниже открыт и проверен; числа — только из этих чтений.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как исправить |
|---|----------|-----------|----------|--------------------------|----------------|
| 1 | критично | `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:21-30` | Ошибка чтения `timezone`: запрос без `try/catch` (строки 20-26), при reject `setTimezone` не вызывается, `if (!timezone) return null` (строка 30) рендерит пустоту | Обрыв сети/таймаут → страница `/admin/to/shifts/new` **не открывается вообще** (белый экран), нет текста ошибки и кнопки «Повторить», необработанное отклонение промиса. Выход только вручную. `authFetch` бросает исключение на сетевой сбой (`src/lib/api.ts:29-57`) | Обернуть запрос в `try/catch/finally`, добавить состояние `error` и кнопку «Повторить»; при ошибке показывать сообщение, а не `null` |
| 2 | важно | `src/components/piling/admin-equipment/detail/equipment-inspections.tsx:39-45` | При отказе загрузки (`!res.ok` или исключение, строка 39/41-42) только тост, `records` остаётся `[]`; рендер (строки 64-65) показывает «Осмотров по этой установке пока нет.» | На `/admin/equipment/[id]` (вкладка/раздел «Осмотры») сбой сети выдаётся за «осмотров нет» — мастер считает, что осмотров не было, хотя данные не пришли. Нет «Повторить» | Ввести состояние ошибки: при сбое показывать `LoadFailure`/`QueryErrorBanner` с повтором, а не пустую подсказку |
| 3 | важно | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:74-82` | Отказ загрузки журнала ТО → только тост (строка 79); рендер (строки 156-157) показывает «Записей по обслуживанию пока нет.» | Сбой сети на карточке установки выглядит как «ТО не проводилось» — ложный вывод о состоянии машины. Нет «Повторить» | Отдельное состояние ошибки с повтором; пустое состояние показывать только при успешном ответе |
| 4 | важно | `src/components/piling/admin-equipment/equipment-to-tab.tsx:44-49` | `catch { /* ignore */ }` (строка 48) глушит и исключение, и `!res.ok` (строка 47); рендер (строки 66-67) показывает «Записей ТО по этой установке пока нет» | Компактный журнал ТО в правой колонке центра парка при сбое утверждает, что записей нет — ложное пустое состояние, без ошибки и повтора | Тот же приём: состояние ошибки + «Повторить», игнорировать только реальную пустоту |
| 5 | важно | `src/components/piling/admin-equipment/detail/equipment-photos.tsx:57-60,73-75,188` | При `!res.ok` — `setPhotos([]); return;` без сообщения (строки 57-60); у загрузчика нет `catch` (только `finally`, строки 73-75) → обрыв сети даёт необработанное отклонение; рендер (строка 188) показывает «Загрузить первое фото» | Сбой сети на блоке фото выглядит как «фото ещё не добавляли»; на обрыве — молчаливый unhandled rejection. Нет «Повторить» | Различать ошибку и пустоту: показывать ошибку с повтором; обернуть загрузчик в `catch` |
| 6 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:162-171` | Ветка ошибки показывает текст «Не удалось загрузить установку: ...» (строки 166-168), но **без кнопки «Повторить»** и без вызова `refresh` | Вся страница `/admin/equipment/[id]` при сбое остаётся без способа перезагрузить, кроме перезагрузки браузера; `refresh` доступен и просто не выведен | Добавить кнопку «Повторить» → `void refresh()` |
| 7 | важно | `src/components/piling/maintenance/maintenance-request-form.tsx:83-95` | Загрузка списков «Установка»/«Исполнитель»: результат применяется только `if (res.ok)` (строки 91-92), у промиса нет `catch`; состояние ошибки отсутствует | На `/admin/maintenance/new` при обрыве сети селект «Установка» молча пуст — админ думает, что техники нет; форма при этом выглядит обычной, отправка невозможна. Обрыв даёт unhandled rejection | Состояние ошибки + «Повторить»; не выдавать пустой список за отсутствие данных |
| 8 | мелочь | `src/components/piling/pile-journal/index.tsx:349-351` | Ветка ошибки выводит только текст `<p>{error}</p>`, без кнопки «Повторить» (перезапрос есть только при смене фильтров) | Мастер на журнале забивки при сбое видит сообщение, но не может повторить одной кнопкой | Добавить «Повторить» → `void reload()` |
| 9 | мелочь | `src/components/piling/briefings/briefing-journal-print.tsx:196-202` | Ветка `failed` печатает сообщение (`<p role="alert">`), без кнопки повтора | Печатная форма журнала инструктажей при сбое не восстанавливается на месте (только перезагрузка) — нечасто, но экран тупиковый | Добавить повтор загрузки |
| 10 | мелочь | `src/app/(app)/layout.tsx:366-368` | `if (!currentUser) return null;` — пока идёт `router.replace('/login')` (строки 349-353), приложение рендерит пустоту | Короткое белое мигание при потере сессии на первом рендере; не вечно (идёт редирект), поэтому мелочь, но заметно на медленной сети | Показывать состояние «Перенаправление на вход…» вместо `null` |
| 11 | мелочь | `src/components/piling/workspace-settings.tsx:101-129,206-211` | Пока `settingsState === 'loading'`, рендерятся значения по умолчанию (компания/пояс из `DEFAULT_WORKSPACE_SETTINGS`), скелетона/плашки «Загрузка» нет; ошибка обрабатывается (строки 206-211) | На `/admin/settings` до прихода ответа видно значения по умолчанию, отличные от сохранённых; правка заблокирована, но цифры/название успевают мигнуть неверными | Показать скелетон/«Загрузка…» вместо значений по умолчанию |
| 12 | мелочь | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:88-96` | Загрузка справочника исполнителей: `if (res.ok) ...` без `else` и без `catch` (строки 90-95) | При сбое `names` пуст, и исполнитель в журнале ТО отображается как «вне справочника» (строка 264) — искажение источника данных; обрыв даёт unhandled rejection | Обработать отказ, не считать пустой справочник «вне справочника» |

Замечание (не находка): страница `/assistant` (`src/app/(app)/assistant/page.tsx:13`) рендерит `AssistantApp` из замороженной области (`src/components/piling/operator-mobile/**`). Обработка ошибок там есть — экран «Нет связи» с кнопкой «Повторить» (`src/components/piling/operator-mobile/assistant-app.tsx:130`). В таблицу по заморозке не включён, но по факту состояние корректно.

### Таблица: страница | загрузка | ошибка | пусто | файл:line

Статусы: **П** — есть и корректно; **Н** — нет/неполно; **и/з** — не применимо (редирект/статическая страница).

| Страница | Загрузка | Ошибка | Повторить | Пусто | Файл:line |
|----------|----------|--------|-----------|-------|-----------|
| `src/app/page.tsx` | и/з | и/з | — | и/з | `src/app/page.tsx:10-23` (server redirect) |
| `src/app/(auth)/login/page.tsx` | П (спиннер) | П (текст+тост на обрыв) | — | и/з | `src/components/piling/login-page.tsx:44-48,163` |
| `src/app/(app)/report/page.tsx` | П (Skeleton) | П | П | и/з | `src/components/piling/report-form/report-form.tsx:205-225` |
| `src/app/(app)/history/page.tsx` | П | П (QueryErrorBanner) | П | П | `src/components/piling/report-history.tsx:200,244-245,253` |
| `src/app/(app)/inspections/page.tsx` | П | П (QueryErrorBanner) | П | П | `src/components/piling/inspections/inspections-list.tsx:100-108` |
| `src/app/(app)/inspections/[id]/page.tsx` | П (спиннер) | П | П (по retryable) | П | `src/components/piling/inspections/run-inspection.tsx:302-340` |
| `src/app/(app)/inspections/new/page.tsx` | П («Загрузка…») | П (QueryErrorBanner) | П | — | `src/components/piling/inspections/start-inspection-form.tsx:198-200` |
| `src/app/(app)/monitoring/page.tsx` | П (Skeleton) | П | П | П | `src/components/piling/monitoring/fleet-dashboard.tsx:200-230`; `src/components/piling/equipment-analytics.tsx:175` |
| `src/app/(app)/assistant/page.tsx` | П | П | П | — | `src/components/piling/operator-mobile/assistant-app.tsx:130` (замороженная обл.) |
| `src/app/(app)/no-access/page.tsx` | и/з | и/з | — | и/з | `src/app/(app)/no-access/page.tsx:21-52` (server) |
| `src/app/(app)/admin/page.tsx` | П (Skeleton) | П | П | П | `src/components/piling/admin-dashboard.tsx:202,447,492-558` |
| `src/app/(app)/admin/analytics/page.tsx` | П (Skeleton) | П (QueryErrorBanner ×3) | П | П (EmptyState) | `src/components/piling/admin-analytics.tsx:286,289,293,427,477` |
| `src/app/(app)/admin/sites/page.tsx` | П | П (QueryErrorBanner) | П | П | `src/components/piling/admin-sites/index.tsx:251,282,344,489` |
| `src/app/(app)/admin/users/page.tsx` | П (Skeleton) | П | П | П | `src/components/piling/admin-users/admin-users.tsx:255,265-278` |
| `src/app/(app)/admin/crews/page.tsx` | П | П (QueryErrorBanner) | П | П | `src/components/piling/admin-crews/admin-crews.tsx:194,243-244` |
| `src/app/(app)/admin/dictionaries/page.tsx` | П | П (Alert) | П | П | `src/components/piling/admin-dictionaries.tsx:441,457-462` |
| `src/app/(app)/admin/dlq/page.tsx` | П (Skeleton) | П (QueryErrorBanner) | П | П | `src/components/piling/admin-dlq.tsx:280-288,294-299` |
| `src/app/(app)/admin/telegram/page.tsx` | П (Skeleton) | П (свой баннер) | П | П | `src/components/piling/admin-telegram.tsx:264-273,298-314` |
| `src/app/(app)/admin/settings/page.tsx` | **Н** (по умолчанию, без скелетона) | П | П | и/з | `src/components/piling/workspace-settings.tsx:104,206-211` (находка 11) |
| `src/app/(app)/admin/equipment/page.tsx` | П (Skeleton) | П | П | П | `src/components/piling/admin-equipment/admin-equipment.tsx:66-95` |
| `src/app/(app)/admin/equipment/[id]/page.tsx` | П (Skeleton) | П (текст) | **Н** | П (EmptyState) | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:152-171` (находка 6) + находки 2,3,5,12 в под-блоках |
| `src/app/(app)/admin/reports/page.tsx` | П (Skeleton) | П (QueryErrorBanner) | П | П | `src/components/piling/admin-reports/admin-reports.tsx:330,356` |
| `src/app/(app)/admin/maintenance/page.tsx` | П | П (QueryErrorBanner) | П | П | `src/components/piling/maintenance/maintenance-board.tsx:298,384-396` |
| `src/app/(app)/admin/maintenance/[id]/page.tsx` | П (спиннер) | П | П (по retryable) | П | `src/components/piling/maintenance/work-order-detail.tsx:228-257` |
| `src/app/(app)/admin/maintenance/new/page.tsx` | **Н** | **Н** (селекты молча пусты) | Н | — | `src/components/piling/maintenance/maintenance-request-form.tsx:83-95` (находка 7) |
| `src/app/(app)/admin/checklists/page.tsx` | П («Загрузка…») | П (QueryErrorBanner) | П | П | `src/components/piling/inspections/template-list.tsx:124-139` |
| `src/app/(app)/admin/checklists/[id]/page.tsx` | П («Загрузка…») | П (QueryErrorBanner) | П (по retryable) | и/з | `src/components/piling/inspections/template-editor.tsx:242,249-259` |
| `src/app/(app)/admin/incidents/page.tsx` | и/з | и/з | — | и/з | `src/app/(app)/admin/incidents/page.tsx:11-12` (redirect) |
| `src/app/(app)/admin/piles/page.tsx` | и/з | и/з | — | и/з | `src/app/(app)/admin/piles/page.tsx:11-12` (redirect) |
| `src/app/(app)/(readiness-admin)/admin/to/page.tsx` | П (BootstrapBoundary) | П | П | П (`feature-off`) | `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx:33-103` |
| `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx` | **Н** (белый экран) | **Н** | Н | — | `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx:21-30` (находка 1) |
| `src/app/(app)/(safety)/admin/safety/page.tsx` | П | П | П | П | `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx:33-103` |
| `src/app/print/briefing-journal/page.tsx` | П («Журнал загружается…») | П (текст) | **Н** | — | `src/components/piling/briefings/briefing-journal-print.tsx:196-210` (находка 9) |

### Границы ошибок и загрузки (инфраструктура)

| Уровень | Файл:line | Содержимое |
|---------|-----------|------------|
| Корень — загрузка | `src/app/loading.tsx:4-85` | Скелетон «Загрузка приложения...» + `Skeleton` |
| Корень — ошибка | `src/app/error.tsx:24-53` | «Экран не открылся», кнопки «Повторить» (`:38-43`) и «На главную»; `Sentry.captureException` (`:20-22`) |
| Корень — критическая ошибка | `src/app/global-error.tsx:20-58` | Инлайновые стили (заменяет корневой layout), кнопка «Обновить» → `window.location.reload()` (`:41-53`) |
| Корень — 404 | `src/app/not-found.tsx:8-27` | Русская страница «Страница не найдена», ссылка на главную |
| `(app)` — загрузка | `src/app/(app)/loading.tsx:11-55` | Скелетон раздела внутри оболочки, `aria-busy` |
| `(app)` — ошибка | `src/app/(app)/error.tsx:26-54` | «Экран не открылся», «Повторить» (`:39-45`); меню и навигация остаются |
| Оболочка (shell) | `src/components/piling/app-error-boundary.tsx:11-65` | `react-error-boundary`, Fallback с «Попробовать снова»/«Обновить страницу», digest вместо текста исключения |
| Контур ТО — bootstrap | `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx:31-104` | 4 состояния (`loading`/`forbidden`/`feature-off`/`error`) + «Повторить» |
| Контур ТО — вкладка | `src/components/piling/to/readiness/boundaries/active-view-error-boundary.tsx:45-70` | Class-boundary на активную вкладку, «Повторить» |
| Общие примитивы | `src/components/piling/async-ui.tsx:21-85`; `src/components/piling/to/load-failure.tsx:32-49` | `useMinSkeletonDuration`, `QueryErrorBanner`, `LoadFailure` |

## Не проверено

- **Рантайм-поведение под реальным сбоем сети.** Всё выше — по коду; я не запускал приложение и не воспроизводил обрыв сети (оффлайн/CDP), т.к. это read-only аудит и среда без поднятого стека. Вывод «белый экран навсегда» для `/admin/to/shifts/new` (находка 1) — из логики: `authFetch` пробрасывает исключение (`src/lib/api.ts:29-57`), `catch` отсутствует, `return null` при `timezone === null`. Гипотеза проверяема только запуском.
- **HTTP-статус-специфика отдельных веток.** Где `!res.ok` даёт разный текст по 401/403/5xx — читал код, но не сверял с фактическими ответами API.
- **`useFeedbackFeed` / SSE-лента `feedback-center.tsx`** (`src/components/piling/feedback-center.tsx:110-175`): переподключение и обработку ошибок потока не разбирал построчно — вне основной задачи (это шапка, а не экран данных).
- **Замороженные области** (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/app/orion/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) — не проверял, кроме одной ссылки на `/assistant` (см. замечание выше). Реальные их состояния загрузки/ошибки остаются неизвестными.
- **Визуальная проверка** (соответствие скелетонов макету, мигание, размеры) — не делал, только наличие/отсутствие состояний в коде.
- **Мобильные/планшетные варианты** отображения тех же экранов (`min-h-11`, `sm:` — видел в коде) — поведение на реальном устройстве не проверено.
- **Число тестов**, покрывающих эти состояния, — не считал; в задании не требовалось, а `npm run test:unit` не запускал.
