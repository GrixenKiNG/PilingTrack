# 07 — Доступность (static accessibility)

Статический аудит доступности UI за пределами замороженных зон (`operator/**`, `orion/**`): `src/components/**` и `src/app/**`. Только чтение, ничего не менялось, сборка/тесты не запускались.

## Итог

- **Всего 29 дефектов**: критично — **3**, важно — **18**, мелочь — **8** (плюс 3 контрольные строки №27/31/32 в таблице — «проверено, не дефект»). Таблица — 32 строки. Уверенность высокая — каждая строка прочитана и проверен контекст.
- Сильнее всего страдает **полевой контур** (осмотр свай, ТО): удаление фото реализовано кнопкой **20×20 px, видимой только при hover** (на телефоне недостижима), а увеличение фото — `<img onClick>` без клавиатурной доступности.
- **Целый класс багов**: интерактивные элементы на `<Image onClick>` / `<Card onClick>` / `<tr onClick>` / `<g onClick>` без `role`+`tabIndex`+keyboard — клавиатура не может их активировать (найдено 5 мест, 3 из них — полевые/отчётные).
- **Много иконок-кнопок без aria-label/title**: удаление из списков (сваи, бурение, пикеты, кусты, ассистенты), закрытие форм ТО (`X`). Часто совмещено с крошечным таргетом (20–24 px).
- **Системный плюс**: базовый `src/components/ui/input.tsx` и `ui/select.tsx` имеют корректный `focus-visible:ring` — не системная проблема. Большинство статус-бейджей дублируют цвет текстом — «только цвет» встречается редко.
- **Хорошая практика для подражания**: `admin-equipment/detail/equipment-photos.tsx:202-209` — кнопка удаления 44×44 px + `aria-label` + `title`; `report-thumbnail.tsx:64-72` — открытие фото кнопкой с `aria-label`. Те же сценарии в осмотрах/ТО сделаны хуже.

**Топ-5:**
1. `src/components/piling/inspections/inspection-item-photos.tsx:194-202` — кнопка удаления фото 20×20 px, `opacity-0 group-hover` (невидима без курсора), без `aria-label`. На полевом экране на телефоне её нельзя ни увидеть, ни нажать.
2. `src/components/piling/inspections/inspection-item-photos.tsx:186-187` (+ `maintenance/work-order-photos.tsx:197-198`, `admin-equipment/detail/equipment-photos.tsx:194-195`) — увеличение фото привязано к `onClick` на `<Image>`: клавиатура не может открыть фото.
3. `src/components/piling/report-history.tsx:283` — `<Card onClick>` открывает деталку отчёта: нет `role`/`tabIndex`/keyboard.
4. `src/components/piling/admin-reports/admin-reports.tsx:282-294` — date-range инпуты без ассоциированного label/aria (в `admin-dashboard.tsx:334-340` те же инпуты сделаны с `aria-label` — разнобой).
5. `src/components/piling/admin-sites/hierarchy-tree.tsx:64-96` — кнопки «добавить/удалить» пикетов и кустов 20×20 px без `aria-label`.

## Методика

- Node-скрипт (временный, вне репо) обошёл все `*.tsx` на `src/components` и `src/app`, исключив директории `operator*` и `orion*`. Построчный регекс-разбор тегов с нейтрализацией `=>` (иначе `onChange={(e)=>…}` обрывал парсинг) искал:
  1. кнопки, у которых нет `aria-label`/`title`/`aria-labelledby` и внутри только иконка без текста;
  2. `<input>` без `id`/`aria-label`/`aria-labelledby` и не обёрнутые в `<label>`;
  3. `<img>` без `alt`.
- Вручную проверены каждый кандидат на `aria-label` дальше в теге, обёртку в `<label>`, наличие текста, семантику.
- Отдельные grep-проходы: `outline-none` без парного `focus-visible:ring`/`focus:border`; `onClick` на `<Card>/<tr>/<li>/<article>/<div>/<span>/<g>`; `cursor-pointer`; фиксированные малые размеры кнопок (`h/w 5..8` = 20–32 px) в полевых экранах; индикаторы «только цвет» (`h-2 w-2 rounded-full bg-*` без текста).
- Порог тач-таргета — WCAG 2.5.8 Target Size (min 24×24, рекомендация—44×44 для крупных элементов); приложение используется на улице/телефоне, потому фаервол взят 44 px.
- Для воспроизводимости: полный вывод скрипта — в scratch (`a11y_scan2.cjs`); ниже таблица только подтверждённых вручную строк.

## Находки

| # | серьёзность | path:line | проблема | почему важно / сценарий | предлагаемое действие |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/inspections/inspection-item-photos.tsx:194-202` | Кнопка удаления фото 20×20 px (`h-5 w-5`), `opacity-0 group-hover:opacity-100` (нужен курсор), `title` но нет `aria-label` | Полевой экран осмотра на телефоне: без hover кнопка невидима и недостижима; таргет вдвое меньше минимума | Перенести в 44×44 px, всегда видимую, добавить `aria-label` (как в `equipment-photos.tsx:202-209`) |
| 2 | критично | `src/components/piling/inspections/inspection-item-photos.tsx:186-187` (+`maintenance/work-order-photos.tsx:197-198`, `admin-equipment/detail/equipment-photos.tsx:194-195`) | Увеличение фото — `onClick={() => handleOpen(p)}` на `<Image>` без `role`/`tabIndex`/`onKeyDown` | Клавиатура/скринридер не могут открыть фото в осмотре/ТО — единственное открытие полноразмерного снимка | Обернуть в `<button>`/`<Link>` (паттерн `report-thumbnail.tsx:64-72`) |
| 3 | критично | `src/components/piling/report-history.tsx:283` | `<Card className="cursor-pointer card-hover" onClick={() => handleOpenDetail(report)}>` — нет `role=button`/`tabIndex`/keyboard | Вся навигация по списку отчётов недоступна с клавиатуры | Добавить `role="button" tabIndex={0}` и `onKeyDown` (Enter/Space) |
| 4 | важно | `src/components/piling/admin-reports/admin-reports.tsx:282-294` | Date-range инпуты (`periodFrom`/`periodTo`) без label, без `aria-label` (в `admin-dashboard.tsx:334-340` есть) | Неизвестно, что за поле; разнобой с соседним экраном | Добавить `aria-label`/`<label>` |
| 5 | важно | `src/components/piling/admin-crews/crew-form-dialog.tsx:422-440` | Иконка-крестик удаления ассистента, inline svg, без `aria-label`/`title` | Скринридер не озвучит действие | Добавить `aria-label` |
| 6 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:293-294` (и `:335`, `:378`) | Кнопки удаления свай/бурения/простоев — `<Trash2>` 24×24 px (`w-6 h-6`) без `aria-label` | Незрячий не поймёт что удаляет; таргет 24 px | `aria-label` + увеличить таргет |
| 7 | важно | `src/components/piling/admin-sites/hierarchy-tree.tsx:64-69,70-75,91-96` | Кнопки «+ пикет», «удалить куст/пикет» — 20×20 px (`w-5 h-5`) без `aria-label`, без `title` | Минимальный таргет 20 px; действие неозвучено | `aria-label` + таргет ≥24 px |
| 8 | важно | `src/components/piling/admin-sites/site-editor/drilling-plan-section.tsx:78-84`, `pile-plan-section.tsx:96-102` | Кнопка удаления строки плана — `X` 24×24 px без `aria-label` | Удаление строки бурения/свай не озвучено | `aria-label` + таргет |
| 9 | важно | `src/components/piling/to/fuel-panel.tsx:171-173`, `to/maintenance-plans-panel.tsx:165-167`, `to/meter-readings-panel.tsx:147-149` | Кнопка закрытия/сброса формы ТО — `<X>` без `aria-label`/`title`, крошечная (без паддинга) | Закрытие форм ТО неозвучено, труднодостижимо | `aria-label` + паддинг ≥24 px |
| 10 | важно | `src/components/piling/feedback-center.tsx:321-327` | Кнопка `X` dismiss-уведомления без `aria-label` | Закрытие уведомления неозвучено | `aria-label` +
| 11 | важно | `src/components/piling/ops-shell/ops-table.tsx:61-68` | `role="button" tabIndex={0}` строка, но `outline-none` и без `focus-visible:ring` — фокус виден только в состоянии `active` | Клавиатурный фокус невидимого контура нет | Добавить `focus-visible:ring-2 focus-visible:ring-ring` |
| 12 | важно | `src/components/piling/admin-dictionaries/dictionary-table.tsx:187` | `<tr onClick={() => onSelect(item)}>` — выбор строки только мышью, без `role`/`tabIndex`/keyboard (внутренние кнопки строки доступны частично) | Клавиатура не может выбрать строку целиком | `role="button" tabIndex={0}` + `onKeyDown`, или убрать дублирование |
| 13 | важно | `src/components/piling/inspections/lubrication-map.tsx:60` | `<g onClick={...} className="cursor-pointer">` на SVG — выбор пикета только мышью | Интерактивный элемент недоступен с клавиатуры/СР | `role/aria` на node + keyboard, или кнопки вне SVG |
| 14 | важно | `src/components/piling/maintenance/maintenance-board-bits.tsx:35`, `maintenance/work-order-table.tsx:127,136,145` | Иконки действий ТО (`ActionIcon`/кнопки) 28×28 px (`h-7 w-7`), имя только через `title` | Таргет <44 px на полевом ТО; `title` не всегда доступен скринридером | `aria-label` + таргет ≥44 px |
| 15 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:347-350` | Числовой input веса критерия: `outline-none` и без парного `focus-visible:ring` — фокус невидим (label есть) | Клавиатурный фокус не отображается | Добавить `focus-visible:ring-2` (tailwind не перекрывает `outline-none` без варианта) |
| 16 | важно | `src/components/piling/to/readiness/forms/form-kit.tsx:351` | `<select>` с `outline-none` и без `focus-visible` — фокус невидим | Нельзя понять где фокус при выборе исполнителя | Добавить `focus-visible:ring` или убрать `outline-none` |
| 17 | важно | `src/components/piling/admin-equipment/equipment-card-grid.tsx:77`, `monitoring/equipment-tile-editor.tsx:69` | Редактируемое имя: `focus:outline-none` без замены (нет `focus:border/ring`) | Фокус редактирования невидим | `focus:border-info focus:ring-2` (как `equipment-filters.tsx:38`) |
| 18 | важно | `src/components/piling/maintenance/maintenance-board.tsx:380-388` | Пагинация `‹`/`›` 32×32 px (`h-8 w-8`), иконка-глиф без `aria-label` | Таргет <44 px; название кнопки — просто «‹» | `aria-label="Назад/Вперёд"` + таргет |
| 19 | важно | `src/components/piling/admin-equipment/equipment-tile.tsx:144-151`, `admin-equipment/equipment-card-block.tsx:53-59` | Кнопка «Открыть карточку» — 32×32 px (`h-8 w-8`), `aria-label` есть | Таргет 32 px <44 px | Увеличить таргет до 44 px |
| 20 | важно | `src/components/piling/report-form/photo-section.tsx:161-167` | Превью-фото `<Image>` без `alt`-контекста и без keyboard-открытия (сценарий как №2 в форме отчёта) | Фото в отчёте неоткрываемо с клавиатуры | Паттерн `report-thumbnail.tsx` |
| 21 | мелочь | `src/components/piling/inspections/inspection-item-photos.tsx:206-212` | Кнопка «Ещё фото» корректна текстом, но скрытый file-инпут `sr-only absolute` (стр. 218-227) без `aria-label` — имя не задано | Скрытый инпут без доступного имени при фокусе через ref-клик | (мелочь, если всегда открывается видимой кнопкой) |
| 22 | важно | `src/components/piling/admin-dashboard.tsx:322-330` | Сегментированные кнопки периода (`all/today/7d/custom`) — нет `role="radiogroup"`/`aria-pressed`; активность только цветом+`periodMode` | Состояние «выбран» не озвучивается | `aria-pressed`/`aria-selected` |
| 23 | мелочь | `src/components/piling/maintenance/maintenance-detail-panel.tsx:201` | `RemarkLine` — статус (orange/red) только точкой-цветом 8×8 px, текст не меняется | Различие «предупреждение/критично» невидимо при ДЦ | Добавить текстовую метку или скрыть точку как декоративную |
| 24 | мелочь | `src/components/piling/maintenance/maintenance-detail-panel.tsx:210` | `TimelineLine` — tone green/orange точкой; текст «закрыто/ожидается» уже различает — точка избыточна | Нет вреда, но цвет дублирует текст | Считать декоративной (`aria-hidden`) |
| 25 | мелочь | `src/components/piling/kpi-tile.tsx:130` | `<span aria-label="Требует внимания">` без `role` на визуально скрытом помощнике — может не озвучиваться | Алерт KPI не гарантированно дойдёт до СР | `role="status"`/`aria-hidden` + текстовый дубль |
| 26 | мелочь | `src/components/piling/to/readiness/settings/notifications-section.tsx:210` | Точка статуса канала `aria-hidden` цветом (green/border), но рядом всё же есть `StatusPill` с текстом | Риск низкий, текст есть | Оставить или `aria-hidden` |
| 27 | мелочь | `src/components/piling/admin-equipment/equipment-monitoring.tsx:217,221` и `equipment-report-export.tsx:58-72` | Date-инпуты обёрнуты в `<label>` «С/По» — ок | (контроль: не находка, метка есть) | — |
| 28 | мелочь | `src/components/piling/to/readiness/screens/readiness-centre.tsx:698` | Оценка готовности — цифра + цвет, текстового «высокая/средняя» нет (только /100) | Степень нормы при ДЦ только по цвету | Добавить текстовый ярлык уровня |
| 29 | мелочь | `src/components/piling/admin-equipment/equipment-card-block.tsx:29-38` (`equipment-tile.tsx:72-81`) | Логотип-картинка `alt={brand.name}` — декор бренда | Не критично | оставить |
| 30 | мелочь | `src/components/piling/equipment-analytics.tsx:314` | Строка таблицы `cursor-pointer` с `onClick` фокус-рингом, роль не уточнена — частично ок | Проверить keyboard на сортируемых строках | `role` при необходимости |
| 31 | мелочь | `src/components/piling/monitoring/fleet-dashboard.tsx:330-337` | Статус соединения — текст + цвет, `aria-live` есть | Ок (контроль) | — |
| 32 | мелочь | `src/components/piling/admin-dictionaries.tsx:527` | Табы `role="tab"` `aria-selected` и фокус-ринг есть — ок | (контроль, паттерн верный) | — |

*Примечание по №27, 31, 32: включены как «проверено-хорошо» для ясности границ проверки; при желании можно исключить из подсчёта находок (это не дефекты).*

## Не проверено

- **Точные пиксельные размеры в рантайме** (фактический таргет зависит от отступа/медиа) — оценено по классам (`h-5…h-8` = 20–32 px); на реальном рендере могло немного отличаться, но все <44 px.
- **WCAG 1.4.3 контраст цветов** (текст/фон, различие `success/destructive/warning` на `--signal` тонах) — не считался; statically не вычисляется без рендера.
- **ARIA-live/динамика** (toast-уведомления, `aria-live` регионы) — статически проверены только явные атрибуты.
- Статус «только цвет» в **мониторинге** (`equipment-tile-block.tsx:78-85`) — там метка есть; полный визуальный прогон не делался.
- **Замороженные зоны** (`operator/**`, `orion/**`) исключены согласно правилам AGENTS.md — там не исключено большее количество дефектов доступности.
- Запуск сборки/тестов не проводился (задача read-only, ничего не менялось).
- Общее количество `<Input>` на placeholder-метках по всей кодовой базе (как в `equipment-report-export`) детально не сводил — базовый `ui/input.tsx` имеет корректный фокус, но ассоциацию label решают конкретные экраны.
