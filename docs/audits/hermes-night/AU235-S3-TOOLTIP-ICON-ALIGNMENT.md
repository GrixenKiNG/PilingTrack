# AU235-S3-TOOLTIP-ICON-ALIGNMENT — подсказки у иконок: единообразие

Версия (git rev-parse HEAD): `3332fe131a68ad118a6e21c073b8056f62d24095`
Ветка: `hermes/q4-0926`. Дата аудита: 2026-10-11.
Только чтение: код приложения не изменялся.

## Итог

- **Единого компонента-подсказки в проекте НЕТ.** Все подсказки к иконкам — нативный HTML-атрибут `title`. Компонентных тултипов 0: единственные `Tooltip` в коде — графики recharts (`src/components/piling/admin-analytics.tsx:15`), а не подсказки к иконкам. Числа: `title=` — 422 вхождения в 115 файлах; `tooltip` (без учёта регистра) — 3 вхождения, все recharts.
- **Главное расхождение — иконочные кнопки без `title`.** Всего иконочных кнопок (только иконка, без видимого текста) — 70. Из них 40 имеют и `title`, и `aria-label` (ПРОЙДЕНО), 28 — только `aria-label`, без `title` (нет всплывающей подсказки для мыши), 2 — без обоих атрибутов.
- **2 переключателя-кнопки вообще без доступного имени** (`admin-equipment/equipment-form.tsx:353`, `admin-sites/site-editor/edit-site-dialog.tsx:276`).
- **Внутри одной функции поведение разное:** админский `report-form-dialog.tsx` даёт `title` иконкам добавления/удаления, а полевой `report-form/*` — только `aria-label` (`pile-section.tsx:75,96` против `report-form-dialog.tsx:312`).
- Итог по severity: критично — 0, важно — 3, мелочь — 6 (всего 9 находок).
- Топ-5: (1) нет компонента-обёртки; (2) 28 иконочных кнопок без `title`; (3) 2 переключателя без имени; (4) рассинхрон admin/поле в отчёте; (5) `title` непоследовательно ставится и на неинтерактивные элементы (th/span/div).

## Методика

Всё воспроизводимо командами из корня `D:\PillingR\wt-night`.

1. Числа по атрибутам:
   - `rg -o 'title=' -g '*.tsx' src | wc -l` → 422 (в `rg -c ... | wc -l` → 115 файлов).
   - `rg -o 'aria-label' -g '*.tsx' src | wc -l` → 320 (122 файла).
   - `rg -i -o 'tooltip' -g '*.tsx' src | wc -l` → 3 (все — recharts в `admin-analytics.tsx`).
   - `rg -o '<span[^>]*title=|<div[^>]*title=|<th[^>]*title=' -g '*.tsx' src` → нативные подсказки на неинтерактивных элементах: span 8, div 4, th 1 (13 шт).
   - `rg -l 'tooltip' -g '*.tsx' src/components/ui` → 0; `ls` по `src/components/ui` — 18 файлов, компонента Tooltip нет.
2. Разбор JSX по AST (TypeScript 6.0.3 из `node_modules`) — чтобы не считать `title=` внутри пропсов компонентов-заголовков (Card/Section/Screen/FormSection) за подсказку. Скрипт-пробник (вне репозитория, не коммитится) обходил все `*.tsx` в `src/components` (кроме `__tests__`/`*.test.*`), находил `JsxOpeningElement`/`JsxSelfClosingElement` с тегом `button`/`Button`, читал атрибуты `title` и `aria-label` и рекурсивно определял, есть ли в поддереве видимый текст. «Только иконка» = нет текстовых узлов и нет выражений с текстом; дочерние `Link`/`span` со своим текстом раскрывались (поэтому кнопки вида `<Button asChild><Link>…</Link></Button>` в «иконочные» не попали).
   - Результат: кнопок всего 737; только-иконка 70; из них title+aria 40, aria без title 28, без обоих 2.
3. Каждая находка ниже открыта глазами (`read_file`) и подтверждена; в таблице указаны полные пути от корня.
4. Замороженные зоны (ORION, варианты операторского экрана `src/components/piling/operator*`) исключены из находок; совпадения там отмечены отдельно в «Не проверено».

Ограничения метода: AST-разбор видит только прямой JSX; кнопки, собираемые динамически через переменные-компоненты, могли не попасть. Такие случаи не заявлены как «нет подсказки».

## Таблица: компонент | файл:строка | способ подсказки | замечание

| Компонент | Файл:строка (полный путь) | Способ подсказки | Замечание |
|---|---|---|---|
| `ActionIcon` (локальный хелпер) | `src/components/piling/maintenance/maintenance-board-bits.tsx:32` | `aria-label` + `title` из одного `label` | Единственная обёртка, рендерящая `title` для иконки; не переиспользуется вне maintenance |
| `work-order-table` | `src/components/piling/maintenance/work-order-table.tsx:134` | `aria-label`+`title` | Образцово; использует `ActionIcon` (стр.133) и явные `button` с обоими атрибутами |
| `dictionary-table` | `src/components/piling/admin-dictionaries/dictionary-table.tsx:135,144,159,249,258,273` | `aria-label`+`title` (+ видимый текст) | Эталон консистентности |
| `equipment-maintenance` | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:188,195,201` | `aria-label`+`title` | ПРОЙДЕНО |
| `equipment-photos` | `src/components/piling/admin-equipment/detail/equipment-photos.tsx:203,223` | `aria-label`+`title` | ПРОЙДЕНО |
| `user-documents` | `src/components/piling/admin-users/user-documents.tsx:274,277` | `aria-label`+`title` (Button size="icon") | ПРОЙДЕНО |
| `report-form-dialog` | `src/components/piling/admin-reports/report-form-dialog.tsx:312,334,374,417` | `aria-label`+`title` | ПРОЙДЕНО здесь — но см. полевой `report-form/*` |
| `hierarchy-tree` | `src/components/piling/admin-sites/hierarchy-tree.tsx:84,92,116,124,150` | `aria-label`+`title` | ПРОЙДЕНО |
| `meter-readings-panel` / `fuel-panel` / `maintenance-plans-panel` (закрытие формы) | `src/components/piling/to/meter-readings-panel.tsx:157`, `.../to/fuel-panel.tsx:181`, `.../to/maintenance-plans-panel.tsx:175` | `aria-label`+`title="Закрыть"` | ПРОЙДЕНО |
| `pile-section` (полевой отчёт) | `src/components/piling/report-form/pile-section.tsx:75,96` | только `aria-label` | Нет `title` → нет подсказки мышью |
| `drilling-section` | `src/components/piling/report-form/drilling-section.tsx:65,87` | только `aria-label` | То же |
| `downtime-section` | `src/components/piling/report-form/downtime-section.tsx:62,77` | только `aria-label` | То же |
| `report-form` (шапка) | `src/components/piling/report-form/report-form.tsx:244` | только `aria-label` («Вернуться…») | Нет `title` |
| `template-editor-parts` | `src/components/piling/inspections/template-editor-parts.tsx:126,281,290,299` | только `aria-label` | Удалить/вверх/вниз/удалить раздел без `title` |
| `page-layout-editor` | `src/components/piling/layout-editor/page-layout-editor.tsx:87,88` | только `aria-label` («Выше»/«Ниже») | Нет `title` |
| `layout-canvas` | `src/components/piling/layout-editor/layout-canvas.tsx:79` | только `aria-label` («Изменить размер блока») | Ручка ресайза без `title` |
| `admin-equipment` (закрыть карточку) | `src/components/piling/admin-equipment/admin-equipment.tsx:209` | только `aria-label` | Нет `title` |
| `admin-dictionaries` (закрыть панель) | `src/components/piling/admin-dictionaries.tsx:561` | только `aria-label` | Нет `title` |
| `user-document-types-dialog` | `src/components/piling/admin-users/user-document-types-dialog.tsx:285` | только `aria-label` | Нет `title` |
| `maintenance-plans-panel` (строка) | `src/components/piling/to/maintenance-plans-panel.tsx:239,247` | только `aria-label` | Нет `title` |
| `fuel-panel`/`meter-readings-panel` (удаление строки) | `src/components/piling/to/fuel-panel.tsx:255`, `.../to/meter-readings-panel.tsx:217` | только `aria-label` | Нет `title` |
| `form-kit` (чип) | `src/components/piling/to/readiness/forms/form-kit.tsx:226` | только `aria-label` («Убрать: …») | Нет `title` |
| `workspace-settings` (переключатель) | `src/components/piling/workspace-settings.tsx:39` | `role="switch"` + `aria-label` | Нет `title`; корректная роль |
| `equipment-form` (тумблер «Активна») | `src/components/piling/admin-equipment/equipment-form.tsx:353` | НЕТ ни `aria-label`, ни `title` | Доступное имя отсутствует |
| `edit-site-dialog` (тумблер «Активен») | `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx:276` | НЕТ ни `aria-label`, ни `title` | Доступное имя отсутствует |
| `admin-analytics` | `src/components/piling/admin-analytics.tsx:295-311,461` | `<Tooltip />` recharts | Это тултип графика, не подсказка к иконке |
| неинтерактивные элементы | `src/components/piling/admin-analytics.tsx:327,384`, `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:225`, `src/components/piling/admin-dictionaries.tsx:564` | нативный `title` на `div`/`th`/`span`/`input` | Подсказка на не-кнопках применяется выборочно |

## Находки

Severity: критично / важно / мелочь. Статус: ПРОЙДЕНО / ГИПОТЕЗА / НЕ ПРОВЕРЕНО.

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/components/ui/` (18 файлов, tooltip отсутствует); `src/components/piling/maintenance/maintenance-board-bits.tsx:32` | Нет единого компонента подсказки; 100% подсказок — нативный `title`, 0 компонентных. Локальный `ActionIcon` — единственная обёртка, но живёт в одном файле | Новые экраны копируют разные паттерны (`title`/только `aria-label`/ничего). Единый вид и поведение подсказки недостижимы | Вынести `IconButton`/`ActionIcon` в `src/components/ui` с обязательными `aria-label`+`title` и переиспользовать |
| 2 | важно | 28 адресов, напр. `src/components/piling/report-form/pile-section.tsx:75,96`, `.../drilling-section.tsx:65,87`, `.../downtime-section.tsx:62,77`, `.../report-form.tsx:244`, `src/components/piling/inspections/template-editor-parts.tsx:126,281,290,299`, `src/components/piling/layout-editor/page-layout-editor.tsx:87,88`, `src/components/piling/layout-editor/layout-canvas.tsx:79`, `src/components/piling/admin-equipment/admin-equipment.tsx:209`, `src/components/piling/admin-dictionaries.tsx:561`, `src/components/piling/to/fuel-panel.tsx:255`, `src/components/piling/to/meter-readings-panel.tsx:217`, `src/components/piling/to/maintenance-plans-panel.tsx:239,247`, `src/components/piling/to/readiness/forms/form-kit.tsx:226`, `src/components/piling/admin-users/user-document-types-dialog.tsx:285`, `src/components/piling/workspace-settings.tsx:39` | Иконочная кнопка имеет `aria-label`, но НЕТ `title` (статус: ПРОЙДЕНО, разбор + открытие) | Для мыши нет всплывающей подсказки — иконка-действие без подписи непонятна; скринридер получает имя, зрячий пользователь — нет | Добавить `title` = тексту `aria-label` |
| 3 | важно | `src/components/piling/admin-equipment/equipment-form.tsx:353`; `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx:276` | Кнопка-тумблер без `title` и без `aria-label` (статус: ПРОЙДЕНО, открыто) | У элемента нет доступного имени: скринридер читает «кнопка без подписи», подсказки нет; рядом визуальный `Label`, но программной связи нет | Добавить `role="switch"`/`aria-checked` и `aria-label` (как в `workspace-settings.tsx:39`) |
| 4 | мелочь | `src/components/piling/report-form/pile-section.tsx:75,96` vs `src/components/piling/admin-reports/report-form-dialog.tsx:312` | Одно и то же действие «добавить сваю» в админ-диалоге имеет `title`, в полевом отчёте — только `aria-label` (статус: ПРОЙДЕНО) | Пользователь на разных экранах получает разное поведение подсказки — нарушено единообразие | Взять `report-form-dialog.tsx:312` как эталон и доработать `report-form/*` |
| 5 | мелочь | `src/components/piling/admin-analytics.tsx:327,384`; `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:225`; `src/components/piling/admin-dictionaries.tsx:564` | `title` стоит на неинтерактивных `div`/`th`/`span`/`input` (13 нативных `title` всего: span 8, div 4, th 1) — применяется выборочно (статус: ПРОЙДЕНО) | Подсказка к заголовку таблицы/маркеру есть в одном месте и отсутствует в похожих — непоследовательно; для `input` `title` не заменяет `<Label>` | Либо системно пояснять неочевидные заголовки, либо не использовать `title` на статике |
| 6 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:436,461` | Пагинация «‹»/«›» имеет `aria-label`+`title` (ПРОЙДЕНО) — то есть паттерн есть, но не распространён на навигацию в других списках | Эталон навигации, к которому стоит привести остальные стрелки (`page-layout-editor.tsx:87,88`) | Унифицировать стрелки навигации к этому виду |
| 7 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:135-166` | Кнопки-иконки дублируют `title` видимой подписью `text-3xs` (ПРОЙДЕНО) | Избыточно: и подпись, и `title` об одном — риск расхождения текстов при правке | Оставить один канал (подпись), `title` — только где подписи нет |
| 8 | мелочь | `src/components/piling/maintenance/maintenance-board-bits.tsx:32-44` | `ActionIcon` задаёт `title={label}` и `aria-label={label}` из одного пропа (ПРОЙДЕНО) | Хороший паттерн единого источника текста, но продублирован не во всех областях | Сделать этот компонент общим |
| 9 | мелочь | `src/components/piling/to/fuel-panel.tsx:253`, `src/components/piling/to/meter-readings-panel.tsx:215` | Кнопки удаления строки внутри `{source === 'MANUAL' && ...}` без `title` (ПРОЙДЕНО) | Редкая условная иконка без подсказки — пользователь не уверен в действии | Добавить `title` |

Итого: критично 0, важно 3, мелочь 6.

## Что не проверено

- **Замороженные зоны (по AGENTS.md) — не аудировались:** совпадения вне таблицы находок: `src/components/orion/orion-fleet.tsx:59` (aria без title), `src/components/piling/operator-mobile/**` (напр. `v10/operator-v10-app.tsx:1683`, `v10/v10-ui.tsx:90`), `src/components/piling/operator-v2/ui.tsx:54` (aria без title). Статус: НЕ ПРОВЕРЕНО по правилам задачи.
- **Визуальная проверка поведения подсказок не выполнялась** (нет запуска браузера) — выводы только по коду. Реальный вид `title`-подсказки, её задержка и доступность на мобильных (где `title` не показывается вовсе) не проверялись; это ГИПОТЕЗА о UX.
- **Динамически собранные кнопки** (через переменные-компоненты, `React.createElement`, рендер из внешних данных) AST-разбор мог пропустить — такие случаи как «нет подсказки» не заявлялись. Полнота охвата: ГИПОТЕЗА.
- **Полевые устройства/сенсорные экраны:** `title` на touch-устройствах обычно не всплывает — вопрос о том, нужны ли вместо него видимые подписи, не рассматривался. НЕ ПРОВЕРЕНО.
- **Прочие каталоги** (`src/app/**`, `src/modules/**`) на наличие иконочных кнопок с подсказками не разбирались — охват ограничен `src/components`. НЕ ПРОВЕРЕНО.
- **Соответствие WCAG для `aria-label` vs видимой подписи** не оценивалось формально. НЕ ПРОВЕРЕНО.
