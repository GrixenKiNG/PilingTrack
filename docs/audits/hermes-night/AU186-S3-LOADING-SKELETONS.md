# AU186-S3-LOADING-SKELETONS: Состояния загрузки и пустые экраны

Аудит только чтением. Версия кода: `git rev-parse HEAD` = `096b25b5be0f1e8551cc459a0d9a2d7f4875de3b` (ветка `hermes/q4-0926`).
Дата: 10.10.2026. Отчёт в формате заказчика; существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Итог

Проверено: у ~25 основных экранов в `src/components/piling` есть ли (1) индикатор загрузки, (2) пустое состояние с подсказкой, (3) ошибка с повтором.
Всего находок: 11 — критично 0, важно 3, мелочь 8.
Общая картина здоровая: у подавляющего большинства экранов три состояния на месте, а пустое состояние почти всегда отделено от отказа (это осознанная линия кода — «пустой список об отказе не говорит»).
Топ-5:
1. Лента уведомлений (`feedback-center.tsx`): сбой чтения выглядит как «Событий пока нет» — нет ни состояния ошибки, ни повтора (важно).
2. Журнал свай (`pile-journal/index.tsx`): ошибка без кнопки повтора, а поверх неё показывается ложное «За период свай нет» (важно).
3. Карточка установки (`equipment-detail.tsx`): «Не удалось загрузить установку» без кнопки «Повторить» (важно).
4. Настройки (`workspace-settings.tsx`): нет индикатора загрузки — при загрузке показаны значения по умолчанию, экран выглядит загруженным (мелочь).
5. Непонятный PDF-предпросмотр (`pdf-preview-dialog.tsx`): у iframe нет состояния ошибки (мелочь).

Числа (команды, `rg`/`find`, тестовые файлы исключены):
- `*.tsx` в `src/components/piling` без тестов — 231;
- файлов с `<Skeleton` — 21; с `useMinSkeletonDuration` — 6; с `QueryErrorBanner` — 17; с `LoadFailure` — 5;
- файлов, содержащих «Повторить» — 76;
- файлов с текстовым «Загрузка…/Загружаем» (без скелетона) — 26;
- файлов с `EmptyState` / `OpsTableEmpty` / `<Empty` — 13; с проверкой `length === 0` — 105.

## Методика

- Прочитан `AGENTS.md` (модель доверия, замороженные зоны, «выглядит мёртвым, но должно остаться»).
- Инвентаризация экранов: `search_files(target=files, pattern=*.tsx)` и `wc -l` по `src/components/piling`.
- Три маркера искались по всему дереву `rg`:
  - загрузка: `Skeleton`, `useMinSkeletonDuration`, `Queloader/Spinner`, «Загрузка…», `animate-pulse`;
  - пусто: `EmptyState`, `OpsTableEmpty`, `<Empty`, `length === 0`, «не найдено/ничего/нет данных»;
  - ошибка: `QueryErrorBanner`, `LoadFailure`, `onRetry`, «Повторить».
- Общие примитивы прочитаны целиком: `src/components/ui/skeleton.tsx`, `src/components/piling/async-ui.tsx` (useMinSkeletonDuration, QueryErrorBanner), `src/components/piling/to/load-failure.tsx`, `src/components/piling/admin-analytics-bits.tsx` (EmptyState), `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx` (EmptyState), `src/components/piling/to/readiness/boundaries/*`, `src/components/piling/app-error-boundary.tsx`.
- Каждый вывод сверен с конкретным `path:line`, файлы открыты через `read_file`, счётчики сняты командами `rg`/`find`.
- Замороженные зоны (варианты операторского экрана `operator*`, сайт ORION) не анализировались.

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|----------|-----------|---------|---------------------------|----------------|
| 1 | важно | `src/components/piling/feedback-center.tsx:279` + `src/components/piling/use-feedback-feed.ts:90` | Сбой чтения ленты неотличим от пустой ленты: при `!eventsRes.ok` состояние не меняется (`use-feedback-feed.ts:90-96`), `mergedEvents` остаётся пустым и показывается «Событий пока нет» (`feedback-center.tsx:279-282`). Состояния ошибки и повтора нет вовсе. | Пользователь считает, что уведомлений нет, хотя запрос `/api/feedback/events` упал (403/5xx/обрыв). Именно тот класс лжи, который в других экранах уже разведён. | Ввести в состояние ленты `error`; при `!eventsRes.ok` ставить его и показывать `QueryErrorBanner` с `onRetry={() => loadFeedbackFeed()}` вместо пустого состояния. |
| 2 | важно | `src/components/piling/pile-journal/index.tsx:349` | Ошибка загрузки журнала выводится текстом без кнопки «Повторить»; при отказе `setRows([])` (`:173-175`), поэтому ниже дополнительно рисуется пустое «За период свай нет.» (`:354-370`). | Мастер видит одновременно красную ошибку и «свай нет» — второе читается как факт о выработке. Повторить загрузку можно только сменой фильтра/перезагрузкой. | Показывать `QueryErrorBanner` c `onRetry={() => void reload()}` и не рисовать пустое состояние, когда `error !== null`. |
| 3 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:162` | Экран карточки установки при ошибке показывает «Не удалось загрузить установку: {error}» без кнопки повтора (`:162-171`). | Диспетчер/admin после разового сбоя может восстановить экран только перезагрузкой страницы. | Добавить кнопку «Повторить» с вызовом существующего `refresh()`. |
| 4 | мелочь | `src/components/piling/workspace-settings.tsx:101` | Нет индикатора загрузки настроек: при `settingsState === 'loading'` карточка сразу рисует значения из `DEFAULT_WORKSPACE_SETTINGS` (`:258-261`), т.е. выглядит как загруженная. | До ответа `/api/settings` «Название компании / Часовой пояс» показывают значения по умолчанию, которые могут не совпадать с сохранёнными. Кнопка «Редактировать» заблокирована (`:238`), но данные всё равно вводят в заблуждение. | На время `loading` показывать skeleton в местах значений или прочерк «…». |
| 5 | мелочь | `src/components/piling/feedback-center.tsx:229` | Единственный индикатор загрузки — вращающаяся иконка на кнопке «Обновить»; первая загрузка панели идёт без индикатора (`loading` из `useFeedbackFeed` влияет только на иконку). | При открытии панели на медленной сети пользователь видит пустой список и не понимает, идёт ли загрузка. | Показывать спиннер/скелетон в теле панели при первой загрузке. |
| 6 | мелочь | `src/components/piling/pdf-preview-dialog.tsx:58` | У iframe предпросмотра PDF нет состояния ошибки: `onLoad` (`:65`) сбрасывает `loading` даже когда сервер вернул страницу ошибки вместо PDF (`/api/reports/single-pdf`). | При сбое генерации PDF пользователь видит пустой белый прямоугольник без объяснения и без возможности повторить. | Различать успех/ошибку (например, `onError`/`load` без ответа) и показывать текст с повтором. |
| 7 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:225` | Загрузка показана текстом «Загружаем…», без скелетона и без `useMinSkeletonDuration`. | Экран мигает текстом вместо стабильного скелета; при быстром ответе текст мелькает. | Использовать `Skeleton`/`useMinSkeletonDuration`, как в admin-dashboard/admin-dlq. |
| 8 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:385` | Загрузка — текстом «Загрузка…» (`:384-385`), а не скелетоном, при этом соседние экраны (`admin-equipment`, `admin-reports`) уже на `Skeleton`. | Непоследовательный визуальный язык экранов; «дёргается» раскладка при появлении данных. | Заменить на skeleton-блок в стиле остальных таблиц. |
| 9 | мелочь | `src/components/piling/pile-journal/index.tsx:353` | Загрузка журнала — текст «Загрузка журнала…» без скелетона (таблица из ~17 колонок). | Скачок раскладки при появлении широкой таблицы; нет имитации структуры. | Сохранить локальный skeleton-заголовок/строк. |
| 10 | мелочь | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:232` | Внутри панели «Телеметрия» ошибка выводится текстом «Не удалось загрузить телеметрию: {error}» без кнопки повтора (`:232-233`). | Повторить загрузку телеметрии можно только переоткрытием вкладки/экрана. | Добавить кнопку повтора с вызовом загрузчика панели. |
| 11 | мелочь | `src/components/piling/inspections/inspections-list.tsx:99` (аналогично `template-list.tsx:125`, `start-inspection-form.tsx:198`) | Списковые экраны осмотров/шаблонов показывают загрузку серым текстом «Загрузка…» вместо скелетона, хотя у них уже есть полноценные пустое состояние и `QueryErrorBanner`. | Единый набор состояний не выглядит единым; на медленной сети нет ощущения прогресса. | Опционально перевести на общий `Skeleton`-блок; приоритет низкий. |

### Таблица экранов (загрузка / пусто / ошибка)

Не-замороженные основные экраны. «Есть» — реализовано; в скобках — путь:строка.

| Экран | файл:строка | загрузка | пусто | ошибка+повтор |
|---|---|---|---|---|
| Дашборд | `src/components/piling/admin-dashboard.tsx:202` | Есть (Skeleton + useMinSkeletonDuration) | Есть (`:454-476`, `:495-559`) | Есть (`:440-449` Повторить; Empty tone=danger `:495`) |
| Аналитика | `src/components/piling/admin-analytics.tsx:48` | Есть (Skeleton) | Есть (EmptyState `:293,367,431,481`) | Есть (QueryErrorBanner `:286,427,477`) |
| Справочники | `src/components/piling/admin-dictionaries.tsx:442` | Есть (Skeleton) | Есть (`dictionary-table.tsx:290`; `:593`) | Есть (`:457-464` Повторить) |
| Очередь DLQ | `src/components/piling/admin-dlq.tsx:288` | Есть (Skeleton) | Есть (`:294-299`) | Есть (`:280-286` QueryErrorBanner) |
| Telegram | `src/components/piling/admin-telegram.tsx:264` | Есть (Skeleton) | Есть (`:307-…`) | Есть (`:298-305` Повторить) |
| Пользователи | `src/components/piling/admin-users/admin-users.tsx:255` | Есть (Skeleton + инлайн-спиннер `:338-342`) | Есть (`OpsTableEmpty :349`) | Есть (`:265-278` Повторить) |
| Бригады | `src/components/piling/admin-crews/admin-crews.tsx:194` | Есть (Skeleton) | Есть (`:254`) | Есть (`:243-244`) |
| Объекты | `src/components/piling/admin-sites/index.tsx:253` | Есть (Skeleton) | Есть (`:344`) | Есть (`:277-290`) |
| Отчёты | `src/components/piling/admin-reports/admin-reports.tsx:330` | Есть (Skeleton + спиннер `:459-463`) | Есть (`:474-486`) | Есть (`:356-360`; «Повторить» `:537`) |
| Техника (парк) | `src/components/piling/admin-equipment/admin-equipment.tsx:66` | Есть (Skeleton) | Есть (`:135-146`) | Есть (`:84-95` Повторить) |
| Карточка установки | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:152` | Есть (Skeleton) | Есть (EmptyState по вкладкам) | **Нет повтора** (`:162-171`) — находка №3 |
| Происшествия | `src/components/piling/admin-incidents/admin-incidents.tsx:224` | Есть, но текстом (`:225`) | Есть (`:226-231`) | Есть (`:205-218` Повторить) |
| Аналитика по установкам | `src/components/piling/equipment-analytics.tsx:176` | Есть (Skeleton) | Есть (`:251-253`, `:370-376`) | Есть (QueryErrorBanner `:174-175`) |
| Журнал свай | `src/components/piling/pile-journal/index.tsx:353` | Есть, но текстом | Есть (`:354-370`) | **Нет повтора** + ложное пустое (`:349-351`) — находка №2 |
| Обслуживание (наряды) | `src/components/piling/maintenance/maintenance-board.tsx:384` | Есть, но текстом | Есть (`:396`) | Есть (`:386-394` Повторить) |
| Наряд ТО (карточка) | `src/components/piling/maintenance/work-order-detail.tsx:228` | Есть (спиннер) | н/п (деталь) | Есть (`:237-258`, условный повтор) |
| История отчётов | `src/components/piling/report-history.tsx:200` | Есть (Skeleton) | Есть (`:249-259`) | Есть (QueryErrorBanner `:243-248`) |
| Мониторинг | `src/components/piling/monitoring/fleet-dashboard.tsx:194` | Есть (Skeleton) | Есть (`:280-286`) | Есть (`:200-217` Повторить) |
| Лента уведомлений | `src/components/piling/feedback-center.tsx:279` | **Нет** (только спиннер на кнопке `:229`) | Есть (`:279-282`) | **Нет состояния ошибки** — находка №1 |
| Настройки | `src/components/piling/workspace-settings.tsx:206` | **Нет индикатора** (`:101-104`) | н/п | Есть (`:206-211` Повторить) |
| Осмотры (список) | `src/components/piling/inspections/inspections-list.tsx:98` | Есть, но текстом | Есть (`:111`) | Есть (`:100-109`) |
| Шаблоны чек-листов | `src/components/piling/inspections/template-list.tsx:124` | Есть, но текстом | Есть (`:136-139`) | Есть (`:126-135`) |
| Проведение осмотра | `src/components/piling/inspections/run-inspection.tsx:302` | Есть (спиннер) | н/п | Есть (`:310-340`, условный повтор) |
| Форма осмотра | `src/components/piling/inspections/start-inspection-form.tsx:197` | Есть, но текстом | н/п | Есть (`:199-200`) |
| Модуль техготовности | `src/components/piling/to/readiness-reference-ui.tsx:157` | Есть (спиннер) | н/п | Есть (`:169-189` Повторить загрузку) |
| Экраны техготовности | `src/components/piling/to/readiness/screens/*.tsx` (readiness-centre `:619`, staff-screens) | Есть (Loader2) | Есть (ex. `permits-screen.tsx:267`) | Есть (`failed` + «Обновить/Повторить») |

Статусы: состояния таблицы — ПРОЙДЕНО по коду (`read_file`); поведение в рантайме не воспроизводилось (см. «Не проверено»).

## Что не проверено

- **Рантайм не воспроизводился.** Оценка основана только на чтении кода; ни dev-сервер, ни `npm run build`, ни Playwright не запускались (задача read-only, без изменения кода). Что «ошибка выглядит как пусто» на конкретном экране — вывод из кода, не из наблюдения.
- **Тесты не запускались.** В `__tests__` есть спеки, прямо проверяющие часть этих сценариев (например, `admin-dlq.test.tsx:316` про скелет 250 мс, `admin-sites/__tests__/*` про «Повторить»). Прогон и его числа не сняты.
- **operator*/ORION не смотрелись** — замороженные зоны по `AGENTS.md`.
- **`equipment-inspections.tsx` / `equipment-documents.tsx` / `equipment-photos.tsx`** — ошибки там уходят в `toast` без инлайн-повтора; в таблицу/находки не выносил, т.к. это вложенные панели, а не экраны; отдельная проверка не делалась.
- **Страница `admin-reports` пустое состояние при «неполном» отклике** — логика ветвления (`hasMore` и др.) разобрана поверхностно; полная семантика не проверена.
- **Мобильные оболочки** (`operator-mobile/**`) — вне периметра задачи, не проверялись.
- **Индикаторы загрузки, зависящие от CSS-классов** (`animate-pulse`/`animate-spin`), визуально не подтверждены — только по разметке.
