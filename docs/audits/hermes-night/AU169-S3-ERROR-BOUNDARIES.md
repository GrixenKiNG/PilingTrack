# AU169-S3 — Границы ошибок React (error boundaries)

Версия (git rev-parse HEAD на момент аудита): `7cc4a5a33510ef35c9f797ac1bdd7f58c7aaab09`
Ветка: `hermes/q4-0926`. Рабочее дерево на старте: `M AGENTS.md` (моя правка — не трогалась, в коммит не входит).
Аудит только на чтение; единственный созданный файл — этот отчёт.

## Итог

1. Все 44 страницы `page.tsx` покрыты хотя бы одной маршрутной границей: три файла-границы (`src/app/error.tsx`, `src/app/(app)/error.tsx`, `src/app/global-error.tsx`). Своей `error.tsx` не имеет ни один вложенный сегмент (`admin/**`, `inspections/**` и т.п. наследуют `(app)/error.tsx`).
2. Все три маршрутные границы и обе компонентные (`AppErrorBoundary`, `ActiveViewErrorBoundary`) отправляют исключение в Sentry через `captureException` — это подтверждено чтением кода и есть юнит-тесты на часть из них.
3. **Критично/важно (2):** (а) граница плитки в редакторе раскладки `src/components/piling/layout-editor/page-layout-renderer.tsx:58` НЕ имеет `onError` — падение плитки видно пользователю («Блок не загрузился»), но в Sentry не уходит; (б) обе экранные `error.tsx` не печатают `digest`, поэтому скриншот пользователя нельзя сопоставить с событием в Sentry, хотя событие создаётся.
4. Всего находок: **1 критично, 3 важно, 4 мелочи**; ниже — 8 строк таблицы. Критичных с падением всего приложения не найдено.
5. Тексты границ — русские, различаются по уровню: маршрутные — «Экран не открылся», корневая `global-error` — «Приложение не открылось». Сырой текст исключения пользователю не показывается нигде.

## Методика (как повторить)

1. `git rev-parse HEAD` — версия.
2. Инвентарь файлов: `find src/app -name 'page.tsx' | sort`, `find src/app -name 'layout.tsx' | sort`, `find src/app \( -name 'error.tsx' -o -name 'global-error.tsx' \) | sort`, `find src/app -name 'not-found.tsx'`.
3. Компонентные границы: `grep -rln "react-error-boundary" src --include=*.tsx | grep -v __tests__`; `grep -rln "getDerivedStateFromError" src --include=*.tsx`; `grep -rn "componentDidCatch" src`.
4. Отправка в Sentry: `grep -rn "Sentry\.\(captureException\|captureRequestError\)" src` и чтение каждого файла-границы целиком.
5. Числа: `find src/app -name 'page.tsx' | wc -l` (=44) и по верхним группам (`(app)`=34, `operator`=6, `orion`=1, `(auth)`=1, `print`=1).
6. Версии из `package.json`: `next@16.3.6`, `@sentry/nextjs@^10.53.1`, `react-error-boundary@^6.1.1`.
7. Каждый `path:line` в таблице открыт чтением файла (`read_file`), а не выведен из regex.

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемое исправление |
|---|----------|-----------|----------|----------------------|--------------------------|
| 1 | критично | `src/components/piling/layout-editor/page-layout-renderer.tsx:58` | Граница плитки `<ErrorBoundary FallbackComponent={TileFallback}>` без `onError` — единственная граница в приложении, которая не шлёт в Sentry | Падение рендера KPI-плитки на дашборде/в редакторе раскладки: пользователь видит «Блок не загрузился», разработчик — ничего (события нет), т.к. `TileFallback` (`:23-29`) ничего не логирует и не репортит | Добавить `onError={(e, i) => Sentry.captureException(e, { extra: { componentStack: i.componentStack } })}` в `:58` |
| 2 | важно | `src/app/error.tsx:24-53` и `src/app/(app)/error.tsx:26-55` | Экран не показывает `digest`; `captureException` (строки `21` и `23`) событие создаёт, а идентификатора на экране нет | Пользователь присылает скриншот «Экран не открылся» — сопоставить с событием в Sentry нельзя. `AppErrorBoundary` этот идентификатор выводит (`app-error-boundary.tsx:31-33`), маршрутные экраны — нет | Добавить блок «Идентификатор ошибки: …» из `error.digest`, как в `app-error-boundary.tsx:32` |
| 3 | важно | `src/core/api-wrapper.ts:129` | `Sentry.captureException` в API-обёртке выполняется только для не-`ServiceError` (403/401 `ServiceError` возвращается раньше, `src/core/api-wrapper.ts:108-112`) | Отказ прав и ошибки валидации API нигде не журналируются — это не React-граница, но единственная точка отправки серверных ошибок маршрутов мимо `onRequestError`; при разборе «пользователь видит 403, а в Sentry пусто» причина здесь | Отдельный счётчик/`logger.warn` для `ServiceError` (не Sentry-событие, чтобы не зашумить) |
| 4 | важно | `src/app/global-error.tsx:11-15` | Не деструктурируется второй аргумент `reset`, который даёт Next; кнопка вместо него делает `window.location.reload()` | Формально работает, но теряется штатный механизм повторного рендера после сбоя корневого layout; reload дороже (полная перезагрузка + повторный бутстрап сессии) | Использовать `reset()` из пропсов (сохранив reload как fallback) |
| 5 | мелочь | `src/app/(app)/layout.tsx:146` | `<AppErrorBoundary>{nav}</AppErrorBoundary>` оборачивает нижнюю навигацию (`fixed bottom-0`), а фолбэк `AppErrorBoundary` — `min-h-screen` (`app-error-boundary.tsx:20`) | Падение навигации подставит во всю высоту экрана полноэкранную заглушку «Произошла ошибка» там, где ожидалась полоса 60px — визуальный скачок, хотя приложение живое | Отдельный компактный фолбэк для навигации (без `min-h-screen`) |
| 6 | мелочь | `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx:1-105` | Не является React-границей (нет `componentDidCatch`/`getDerivedStateFromError`) — это отображение `QueryState`; в инвентаре границ не учитывается | При чтении легко принять за третью границу готовности; фактически ошибки рендера ловит только `ActiveViewErrorBoundary` (`tech-readiness-module.tsx:95-102`) | Оставить как есть; учитывать при аудите (в отчёте — пояснение) |
| 7 | мелочь | `sentry.server.config.ts:11`; `src/instrumentation-client.ts:9`; `sentry.edge.config.ts:10` | Sentry включён только при `NODE_ENV === 'production'` — на стенде/локально все `captureException` из границ молчат | Проверить границу на не-проде (демо, стенд) нельзя: событий нет не из-за бага, а из-за флага. Тест ошибки «вживую» возможен только в prod | Осознанное решение (держим prod-проект чистым); зафиксировать в документации по стенду |
| 8 | мелочь | `src/app/(auth)/layout.tsx:1-7` | У группы `(auth)` (единственная страница — `/login`) нет своей `error.tsx`; сбой входа рендерит корневую `src/app/error.tsx` | На единственном входе в приложение при сбое показывается полноэкранная заглушка с ссылкой «На главную» → `/` → редирект назад на `/login`: пользователь упирается в тот же экран, помогает только «Повторить»/перезагрузка | Добавить лёгкую `error.tsx` для `(auth)` без ссылки «На главную», либо пояснить это поведение |

## Таблица покрытия: маршрут → граница

| Маршрут (сегмент) | Ближайшая граница | файл:строка | Текст на экране |
|---|---|---|---|
| `/` (`src/app/page.tsx`, редирект) | корневая `error.tsx` | `src/app/error.tsx:13` | «Экран не открылся» / «Повторить» + «На главную» |
| `(auth)/login` | корневая `error.tsx` (своей нет) | `src/app/error.tsx:13` | «Экран не открылся» |
| `(app)/**` (34 страницы: `admin/**`, `assistant`, `history`, `inspections`, `report`, `monitoring`, `(safety)`, `(readiness-admin)`, `operator`) | `(app)/error.tsx` | `src/app/(app)/error.tsx:15` | «Экран не открылся» / «Повторить» + «На главную» (меню остаётся) |
| `print/briefing-journal` | корневая `error.tsx` | `src/app/error.tsx:13` | «Экран не открылся» |
| `operator/**` (frozen, 6 страниц) | корневая `error.tsx` | `src/app/error.tsx:13` | «Экран не открылся» |
| `orion/**` (frozen, 1 страница) | корневая `error.tsx` | `src/app/error.tsx:13` | «Экран не открылся» |
| любая (сбой корневого layout/провайдеров) | `global-error.tsx` | `src/app/global-error.tsx:11` | «Приложение не открылось» / «Обновить» (инлайн-стили, `lang="ru"`) |
| 404 (любой путь) | `not-found.tsx` | `src/app/not-found.tsx:8` | «Страница не найдена» / «404» / «На главную» |
| оболочка `(app)`: шапка (`OperatorLayout`) / сайдбар+шапка (`AdminLayout`) | `AppErrorBoundary` | `src/app/(app)/layout.tsx:94`, `:240` | «Произошла ошибка» + «Идентификатор ошибки: …» (`app-error-boundary.tsx:26,32`) |
| оболочка `(app)`: нижняя навигация (оператор) | `AppErrorBoundary` | `src/app/(app)/layout.tsx:146` | «Произошла ошибка» (полноэкранный фолбэк) |
| центр технической готовности (вкладки) | `ActiveViewErrorBoundary` | `src/components/piling/to/readiness/tech-readiness-module.tsx:95` | «Раздел временно недоступен» + «Повторить» (`active-view-error-boundary.tsx:49-67`) |
| плитка раскладки (`PageLayoutRenderer`) | `ErrorBoundary` (react-error-boundary) | `src/components/piling/layout-editor/page-layout-renderer.tsx:58` | «Блок не загрузился» (`:23-29`) |

Числа (из команд): `page.tsx` всего — 44; `(app)` — 34; `operator` — 6; `orion` — 1; `(auth)` — 1; `print` — 1. Файлов маршрутных границ — 3 (`find … | wc -l`). Компонентных реализаций границ — 3 (`react-error-boundary` импортируют 2 файла + 1 класс; всего 3 файла-реализации). Вызовов `AppErrorBoundary` в `src/app/(app)/layout.tsx` — 3 (строки 94, 146, 240).

Отправка в Sentry по границам (ПРОЙДЕНО чтением + юнит-тесты):
- `src/app/error.tsx:21` — `Sentry.captureException(error)`.
- `src/app/(app)/error.tsx:23` — `Sentry.captureException(error)` (тест `src/app/(app)/__tests__/error.test.tsx:27`).
- `src/app/global-error.tsx:17` — `Sentry.captureException(error)`.
- `src/components/piling/app-error-boundary.tsx:60` — `captureException` c `componentStack` (тест `src/components/piling/__tests__/app-error-boundary.test.tsx:24`).
- `src/components/piling/to/readiness/boundaries/active-view-error-boundary.tsx:30` — `captureException` c `componentStack` (тест `boundaries.test.tsx:90`).
- `src/components/piling/layout-editor/page-layout-renderer.tsx:58` — **НЕТ** отправки (находка №1).
- Серверный канал: `src/instrumentation.ts:8` — `export const onRequestError = Sentry.captureRequestError` (ошибки серверного рендера/route-хендлеров).

Не инвентаризировано как граница: `src/core/error-boundary/api-error-boundary.ts` (`withErrorBoundary`) — это middleware-обёртка API-роутов, не React-граница; живёт в `src/core`, вне `src/app`/`src/components`.

## Не проверено

- **НЕ ПРОВЕРЕНО:** фактическое поведение границ в браузере (запуск dev-сервера и принудительный throw) — не запускал, т.к. аудит только на чтение и не изменяю код. Все выводы о покрытии/текстах получены чтением исходников и юнит-тестов.
- **НЕ ПРОВЕРЕНО:** реальная доставка событий в Sentry (DSN, `enabled: prod`, туннель `/_relay`, CSP) — проверялось только наличие `captureException` в коде; живого события не наблюдал.
- **ГИПОТЕЗА:** формулировка «ни сохранённый сегмент `admin/**` и т.п. не имеет своей `error.tsx`» основана на `find`; семантику каскада границ Next 16 (наследование от ближайшего сегмента с `error.tsx`) я не верифицировал по исходникам `node_modules/next` — принята как общеизвестное поведение App Router. При необходимости требует отдельной проверки.
- **НЕ ПРОВЕРЕНО:** ловят ли границы ошибки в обработчиках событий/асинхронном коде (React-семантика: не ловят) — по коду это так, но применимость к конкретным сценариям продукта (отправка отчёта, загрузка данных) не проверял. Такие ошибки идут мимо React-границ (частично — в Sentry через глобальные хендлеры SDK клиента, конфиг `src/instrumentation-client.ts:28-33`).
- **НЕ ПРОВЕРЕНО:** кросс-сегментное поведение при падении самого `src/app/(app)/layout.tsx` (кто именно рендерит ошибку — корневая `error.tsx` или `global-error`) не проверял запуском.
- Замороженные зоны (`src/app/operator/**`, `src/app/orion/**`) на наличие своих границ не разбирались детально — только посчитаны (6 и 1 страница) и отмечено, что своей `error.tsx` они не имеют.
- Не читал существующие отчёты `docs/audits/**` по требованию задания; совпадения с их выводами не проверялись.
