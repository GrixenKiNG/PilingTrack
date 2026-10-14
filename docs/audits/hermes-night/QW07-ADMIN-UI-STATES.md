# QW07-ADMIN-UI-STATES — Состояния экранов админки

Аудит четырёх состояний каждого экрана `src/components/piling/admin-*`:
1) загрузка, 2) ошибка + кнопка «Повторить», 3) пустое состояние, 4) защита введённых данных при закрытии формы.

**Версия кода** (`git rev-parse HEAD` на момент аудита): `3681cf66a804dc5527fd1e00cb43ddb4191ffa2f` (ветка `hermes/code-1011`).

READ-ONLY: в коде приложения **ничего** не менялось; создан только этот файл. Запрещённое к чтению не читал: существующие отчёты `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`; frozen-зоны (operator, orion) не трогал.

## Итог (резюме для владельца)

1. Прошёл по **22 экранам** admin-участка (+ подкомпоненты); у каждого — 4 состояния: загрузка / ошибка+повторить / пусто / защита формы.
2. **16 находок: критично 0 · важно 6 · мелочь 10** (до 40 — довесочного списка не нужно).
3. **Критично = 0**: ни один случай не ломает данные БД и не блокирует пользователей полностью.
4. **Главные (важно)**: потеря введённых данных при закрытии форм — `admin-telegram.tsx`, `create-site-dialog.tsx`, `user-documents.tsx`, `admin-dictionaries.tsx`, `admin-incidents.tsx`; + экран «Техника/карточка» **без кнопки «Повторить»** (`equipment-detail.tsx:162-170`).
5. **Сильная сторона**: 11 из 12 списочных экранов имеют скелетон + `QueryErrorBanner`/«Повторить» + `OpsTableEmpty`; защита «Закрыть без сохранения?» уже есть в 5 местах (`user-dialogs.tsx:98,253`, `crew-form-dialog.tsx:218`, `edit-site-dialog.tsx:202`, `equipment-dialogs.tsx:74,149`, `admin-dlq.tsx:143-154` — образцовый паттерн с объяснением последствий).

## Методика

- Перечень файлов: `src/components/piling/admin-*.tsx` + `src/components/piling/admin-*/**/*.tsx` (~24 экрана + 30 подкомпонентов).
- По каждому файлу: поиск по строкам/словам-маркерам `loading|Skeleton|Error|Повторить|EmptyState|OpsTableEmpty|QueryErrorBanner|dirty|confirm|onOpenChange|beforeunload|useWarnOnPageLeave|reset` (ripgrep + точечная проверка `sed -n` конкретных строк).
- Каждая строка в таблицах ниже подтверждена просмотром файла в этой же сессии; воспроизводимо.
- Не читались: `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`, frozen-зоны (operator, orion).
- Не запускал: `npm run build`, `npm run lint`, `npx tsc --noEmit` (READ-ONLY, код не трогал); браузер/Playwright — вывод о поведении «потеря ввода» помечен как **ГИПОТЕЗА** по строкам кода.
- Статусы: **ПРОЙДЕНО** — файл и строка открыты; **ГИПОТЕЗА** — вывод по коду, не прогонялось в браузере; **НЕ ПРОВЕРЕНО** — раздел ниже.

## 1. Сводная таблица: экран | загрузка | ошибка+Повторить | пусто | защита формы (dirty)

| Экран | Файл | Загрузка | Ошибка+Повторить | Пусто | Защита формы (dirty) |
|---|---|---|---|---|---|
| Дашборд | `admin-dashboard.tsx` | ПРОЙДЕНО `:338-350` (Skeleton), `:425-434` «Обновить…» | ПРОЙДЕНО `:435-444` «Данные не загрузились» (KPI); `:447-455` баннер + кнопка «Повторить» | ПРОЙДЕНО `:334` (noData), `:460-498` «С чего начать» | n/a (форм нет) |
| Аналитика | `admin-analytics.tsx` | ПРОЙДЕНО скелетоны в битах (`:27-31` импорты) | ПРОЙДЕНО `ErrorState`-схема (`:140` импорт, битах) | ПРОЙДЕНО `:293` «нет отчётов за период», `:367` «нет данных по операторам», `:431` «Нет данных за недели…», `:481` «Нет данных ТО…» | n/a |
| Справочники | `admin-dictionaries.tsx` | ПРОЙДЕНО `:442` (Skeleton) | ПРОЙДЕНО `:457-463` + `:590` «Повторить» | ПРОЙДЕНО `src/components/piling/admin-dictionaries/dictionary-table.tsx:189,290` «Ничего не найдено» | **ГИПОТЕЗА НЕТ** `:165-171`, `:230-235`, `:561` — см. #9 |
| Отчёты (список) | `admin-reports/admin-reports.tsx` | ПРОЙДЕНО `:326-335` (Skeleton, F-R128-1) | ПРОЙДЕНО `:356` QueryErrorBanner, `:537` «Повторить», `:376` фильтр-ошибка | ПРОЙДЕНО `:477-482` «Отчёты не найдены» | см. #10 (форма) |
| Форма отчёта | `admin-reports/report-form-dialog.tsx` | — | — | ПРОЙДЕНО `:174` «Добавьте хотя бы одну запись» | **ГИПОТЕЗА см. #10** `:127` |
| Бригады (список) | `admin-crews/admin-crews.tsx` | ПРОЙДЕНО `:194-199` | ПРОЙДЕНО `:244` (onRetry) | ПРОЙДЕНО `:254` «Бригады не найдены» | — |
| Форма бригады | `admin-crews/crew-form-dialog.tsx` | — | ПРОЙДЕНО `referenceError` + retry в диалоге | — | **ПРОЙДЕНО ЕСТЬ** `:39`, `:208`, `:218` |
| Объекты (список) | `admin-sites/index.tsx` | ПРОЙДЕНО `:251-258` | ПРОЙДЕНО `:282` + `:489` | ПРОЙДЕНО `:344` «Объектов пока нет» | — |
| Новый объект | `admin-sites/site-editor/create-site-dialog.tsx` | — | — | — | **ГИПОТЕЗА НЕТ** `:67`, `:111` — см. #2 |
| Изменить объект | `admin-sites/site-editor/edit-site-dialog.tsx` | — | — | — | **ПРОЙДЕНО ЕСТЬ** `:35`, `:196-198`, `:202` |
| Пользователи (список) | `admin-users/admin-users.tsx` | ПРОЙДЕНО `:255-262` | ПРОЙДЕНО `:265-275` + `:273` «Повторить» | ПРОЙДЕНО `:349` «Пользователи не найдены» | — |
| Создать/изм. пользователя | `admin-users/user-dialogs.tsx` | — | — | — | **ПРОЙДЕНО ЕСТЬ** `:94,98` / `:244,253` |
| Документы работника | `admin-users/user-documents.tsx` | ПРОЙДЕНО `:213-224` | ПРОЙДЕНО `:219-229` | ПРОЙДЕНО `:247,254-256` «Документов нет» | **ГИПОТЕЗА НЕТ** `:286` — см. #3 |
| Виды документов | `admin-users/user-document-types-dialog.tsx` | ПРОЙДЕНО `:128-140` | **НЕ ПРОВЕРЕНО** retry; `:88` toast.error без retry | ПРОЙДЕНО `:298-299` «Видов пока нет» | **ГИПОТЕЗА НЕТ** inline-форма без dirty |
| Профиль (история) | `admin-users/user-detail.tsx` | ПРОЙДЕНО `:169` (history.loading) | ПРОЙДЕНО `:169` (history.error) | ПРОЙДЕНО `:40,47` «Нет данных» | НЕ ПРОВЕРЕНО (form в user-dialogs) |
| Техника (список) | `admin-equipment/admin-equipment.tsx` | ПРОЙДЕНО `:66-77` | ПРОЙДЕНО `:84-92` + `:90` «Повторить» | ПРОЙДЕНО `:139` (Empty) | — |
| Техника (карточка) | `admin-equipment/detail/equipment-detail.tsx` | ПРОЙДЕНО `:152-158` | **ГИПОТЕЗА НЕТ** `:160-168` — см. #5 | ПРОЙДЕНО текст ошибки `:167` | n/a (крестик = назад, `:560`) |
| Осмотры | `admin-equipment/detail/equipment-inspections.tsx` | — | — | ПРОЙДЕНО `:65` «Осмотров пока не было» | — |
| ТО | `admin-equipment/detail/equipment-maintenance.tsx` | — | — | ПРОЙДЕНО `:157` «Нарядов ТО не создано» | — |
| Инциденты | `admin-incidents/admin-incidents.tsx` | ПРОЙДЕНО `:225` «Загружаем…» | ПРОЙДЕНО `:205-217` + «Повторить» | ПРОЙДЕНО `:227-231` | **ГИПОТЕЗА НЕТ** `:321-328` — см. #6 |
| Telegram | `admin-telegram.tsx` | ПРОЙДЕНО `:264-271` | ПРОЙДЕНО `:298-307` + `:302` «Повторить» | ПРОЙДЕНО `:309-312` «Нет конфигураций» | **ГИПОТЕЗА НЕТ** `:415`, `:95-98` — см. #1 |
| DLQ | `admin-dlq.tsx` | ПРОЙДЕНО `:288-293` | ПРОЙДЕНО `:281` QueryErrorBanner; `:148-153` retryConfirm | ПРОЙДЕНО `:295-299` «Недоставленных событий нет» | **ПРОЙДЕНО ЕСТЬ** `:148-153` |

## 2. Находки (16)

| # | Sev | path:line | Проблема (scenario) | Предлагаемая правка |
|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-telegram.tsx:415` + `:95-98` | Dialog закрытие = «сброс» без `window.confirm`/dirty. Пользователь ввёл токен (секрет, не показывается повторно) + ID чата → «Отмена»/крестик → потеряно. **Доп.** (code `:88-94`): пустой токен = «не сменить», но UI это не подсказывает — риск «сохранить с пустым полем = обнулить токен» (`ГИПОТЕЗА`). | Добавить `if (dirty && !window.confirm('Закрыть без сохранения?'))` по образцу `edit-site-dialog.tsx:202`; плюс подсказка под полем «пустой токен = оставить текущий». |
| 2 | важно | `src/components/piling/admin-sites/site-editor/create-site-dialog.tsx:67` + `:111` | Dialog «Новый объект» (`onOpenChange={onOpenChange}`) + button «Отмена» закрывают без confirm. Ввод (название, план свай/бурения) — **потерян** (`ГИПОТЕЗА`). | `if (dirty && !window.confirm(CONFIRM_LEAVE)) return;`. Вынести `CONFIRM_LEAVE` в `@/lib/confirm-leave.ts`. |
| 3 | важно | `src/components/piling/admin-users/user-documents.tsx:286` | Dialog «Документ» + button «Отмена» — **без** confirm. Ввод (вид/номер/выдан/срок/прим.) теряется (`ГИПОТЕЗА`). | То же, что #2. |
| 4 | важно | `src/components/piling/admin-dictionaries.tsx:165-171` (selectKind), `:230-235` (selectItem), `:561` (крестик) | Смены строки/вкладки/закрытия панели — **молча** сбрасывают `panelDraft`; `panelDirty` **есть** (`:237-244`) — можно использовать для guard (`ГИПОТЕЗА`). | `if (panelDirty && !window.confirm('Закрыть панель без сохранения?')) return;` в `selectKind`, `selectItem`, `closePanel`. |
| 5 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:160-168` | Экран «Не удалось загрузить установку» — **без** кнопки «Повторить» (в отличие от 11 других экранов). Только F5 или назад. | Добавить `<Button onClick={() => void load()}>Повторить</Button>` по образцу `admin-telegram.tsx:302`. |
| 6 | важно | `src/components/piling/admin-incidents/admin-incidents.tsx:321-328` | Кнопка «Отмена» в форме разбора: `setOpenForm(null); setNote(''); setReviewError(null);` — **молча** сбрасывает `note` (≤4000 символов) (`ГИПОТЕЗА`). | `if (note.trim().length > 0 && !window.confirm('Закрыть разбор без сохранения?')) return;`. |
| 7 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:124-127` | `handleClose = resetTempFields(); onClose();` — черновики `temp*` (марка/кол-во) теряются; `formPiles[]`/`formDrillings[]`/`formDowntimes[]` **остаются** в state до размонтирования (`ГИПОТЕЗА`, не проверено). | Вынести dirty-guard в `useDialogDirty(open, dirty, onClose)`. |
| 8 | мелочь | `src/components/piling/admin-users/user-document-types-dialog.tsx:88` | `toast.error('Не удалось загрузить виды документов')` — **без** retry; пользователь закрывает и открывает заново. | `onRetry={() => void load()}` в banner. |
| 9 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:66-77` | `if (loading)` **без** `useMinSkeletonDuration` (есть в `admin-dashboard.tsx:205`, `admin-dlq.tsx:288`) — короткий скелетон мигает. | Подключить `useMinSkeletonDuration`. |
| 10 | мелочь | 4 копии строки `CONFIRM_LEAVE` | `'Закрыть без сохранения? Введённые данные будут потеряны.'` дублируется: `admin-sites/site-editor/edit-site-dialog.tsx:35`, `admin-users/user-dialogs.tsx:64`, `admin-crews/crew-form-dialog.tsx:39`, `admin-equipment/equipment-dialogs.tsx:46`. | Вынести в `@/lib/confirm-leave.ts`. |
| 11 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:189,290` | «Ничего не найдено» — без `aria-live="polite"`; скринридер не объявит смену. | `role="status"` / `aria-live="polite"`. |
| 12 | мелочь | `src/components/piling/admin-telegram.tsx:309-312` | «Нет конфигураций» — без CTA-кнопки «Добавить» + без `aria-live`; CTA есть в шапке (не проверено). | CTA в пустом состоянии. |
| 13 | мелочь | `src/components/piling/admin-users/admin-users.tsx:349` | «Пользователи не найдены» — **без CTA** «Создать пользователя» (в отличие от `admin-sites/index.tsx:344` и `admin-crews/admin-crews.tsx:254`). | CTA в `OpsTableEmpty`. |
| 14 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:227-231` | Пустые состояния «Инцидентов пока не заводили.» / «Ничего не ждёт разбора» — хорошие тексты, без CTA. | CTA на «Завести инцидент» (кнопка есть в шапке — не проверено). |
| 15 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:139` | Empty **без CTA** «Добавить установку» (кнопка есть в шапке — не проверено). | CTA в Empty. |
| 16 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:537` | «Повторить» ok, но индикатор «Обновляем…» при `reports.length>0` **нет** (кроме `:461` aria-label); скелетон только при пустом списке (`:326-335`, F-R128-1). | Spinner на кнопке «Обновить» во время update. |

## 3. Что НЕ проверено

- **Не запустил** браузер (Playwright/`dogfood`) — вывод о UX «пользователь теряет ввод» — **ГИПОТЕЗА** по строке кода, не прогонялась в Chrome/Edge.
- **Не запускал** `npm run build`, `npm run lint`, `npx tsc --noEmit` — READ-ONLY, код не трогал.
- **Не читал** (не относится к 4-м государствам, либо подкомпоненты планов/составов):
  - `src/components/piling/admin-sites/hierarchy-tree.tsx`
  - `src/components/piling/admin-sites/drilling-plan-section.tsx`
  - `src/components/piling/admin-sites/pile-plan-section.tsx`
  - `src/components/piling/admin-sites/plan-summary.tsx`
  - `src/components/piling/admin-sites/add-hierarchy-dialog.tsx`
  - `src/components/piling/admin-sites/delete-site-dialog.tsx`
  - `src/components/piling/admin-users/user-assignment.tsx`
  - `src/components/piling/admin-users/user-detail.tsx` (кроме grep по `loading|error|Нет данных`)
  - `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx`
  - `src/components/piling/admin-equipment/detail/equipment-documents.tsx`
  - `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx`
  - `src/components/piling/admin-equipment/detail/equipment-report-export.tsx`
  - `src/components/piling/admin-equipment/detail/operator-checklist-history.tsx`
  - `src/components/piling/admin-crews/delete-dialog.tsx`
  - `src/components/piling/admin-reports/report-detail-dialog.tsx`, `print-screen.tsx`, `report-evidence-preview.tsx`, `report-evidence-row.tsx`, `report-filters.tsx`, `report-thumbnail.tsx`
  - `src/components/piling/async-ui.tsx` (общие `QueryErrorBanner`/`OpsTableEmpty`/`EmptyState`/`useMinSkeletonDuration`) — только по импортам.
  - `src/components/piling/confirm-action-dialog.tsx` (паттерн «Подтвердить действие», не dirty-защита).
  - `src/components/piling/admin-only.tsx` (ролевой контроллер, не UI-состояния).
- **Не проверял** save-команду Telegram-настроек (`admin-telegram.tsx`) — вывод «пустой токен = обнулить» — **ГИПОТЕЗА** (UI-текст, не code-поведение).
- **Не проверял** mount/unmount цикла `admin-reports.tsx` → `report-form-dialog.tsx` — остаётся ли `formPiles[]` после закрытия — **ГИПОТЕЗА** (найдено только `handleClose`).

## Приложение: полный список path:line по категориям

**Загрузка (12 подтверждено ПРОЙДЕНО):**
`src/components/piling/admin-dashboard.tsx:338-350` · `src/components/piling/admin-sites/index.tsx:251-258` · `src/components/piling/admin-reports/admin-reports.tsx:326-335` · `src/components/piling/admin-crews/admin-crews.tsx:194-199` · `src/components/piling/admin-users/admin-users.tsx:255-262` · `src/components/piling/admin-users/user-documents.tsx:213-224` · `src/components/piling/admin-users/user-document-types-dialog.tsx:128-140` · `src/components/piling/admin-equipment/admin-equipment.tsx:66-77` · `src/components/piling/admin-equipment/detail/equipment-detail.tsx:152-158` · `src/components/piling/admin-telegram.tsx:264-271` · `src/components/piling/admin-dlq.tsx:288-293` · `src/components/piling/admin-dictionaries.tsx:442`

**Ошибка+Повторить (10 подтверждено ПРОЙДЕНО):**
`src/components/piling/admin-dashboard.tsx:455` · `src/components/piling/admin-sites/index.tsx:282,489` · `src/components/piling/admin-reports/admin-reports.tsx:356,537` · `src/components/piling/admin-crews/admin-crews.tsx:244` · `src/components/piling/admin-users/admin-users.tsx:273` · `src/components/piling/admin-users/user-documents.tsx:219-229` · `src/components/piling/admin-equipment/admin-equipment.tsx:84-92` · `src/components/piling/admin-telegram.tsx:298-307` · `src/components/piling/admin-dlq.tsx:281` · `src/components/piling/admin-dictionaries.tsx:462,590`

**НЕТ** retry (2):
`src/components/piling/admin-equipment/detail/equipment-detail.tsx:160-168` · `src/components/piling/admin-users/user-document-types-dialog.tsx:88`

**Пусто (14 подтверждено ПРОЙДЕНО):**
`src/components/piling/admin-dashboard.tsx:334,460-498` · `src/components/piling/admin-analytics.tsx:293,367,431,481` · `src/components/piling/admin-sites/index.tsx:344` · `src/components/piling/admin-reports/admin-reports.tsx:477-482` · `src/components/piling/admin-crews/admin-crews.tsx:254` · `src/components/piling/admin-users/admin-users.tsx:349` · `src/components/piling/admin-users/user-documents.tsx:247,254-256` · `src/components/piling/admin-users/user-document-types-dialog.tsx:298-299` · `src/components/piling/admin-equipment/admin-equipment.tsx:139` · `src/components/piling/admin-equipment/detail/equipment-inspections.tsx:65` · `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:157` · `src/components/piling/admin-equipment/detail/equipment-photos.tsx:188` · `src/components/piling/admin-telegram.tsx:309-312` · `src/components/piling/admin-dlq.tsx:295-299`

**Защита формы — ЕСТЬ (5 подтверждено ПРОЙДЕНО):**
`src/components/piling/admin-users/user-dialogs.tsx:94,98` + `:244,253` · `src/components/piling/admin-crews/crew-form-dialog.tsx:39,208,218` · `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx:35,196-198,202` · `src/components/piling/admin-equipment/equipment-dialogs.tsx:46,74,149` · `src/components/piling/admin-dlq.tsx:148-153`

**Защита формы — НЕТ (5, ГИПОТЕЗА):**
`src/components/piling/admin-telegram.tsx:415,95-98` · `src/components/piling/admin-sites/site-editor/create-site-dialog.tsx:67,111` · `src/components/piling/admin-users/user-documents.tsx:285-286` · `src/components/piling/admin-dictionaries.tsx:165-171,230-235,561` · `src/components/piling/admin-incidents/admin-incidents.tsx:321-328`
