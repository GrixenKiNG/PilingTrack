# AU209-S6-UNITS-PILE-LENGTH-DISPLAY — единицы длины в отображении

Версия (git rev-parse HEAD): 9f81893fc1f4a2c5fae488a524c70dcae1a0d24c
Ветка: hermes/q4-0926. Только чтение: код приложения не менялся.

## Итог

Аудит единиц длины (м, мм, м.п.) в отображении. Проверено 20 находок: критично — 0, важно — 6, мелочь — 12.

Топ-5:
1. Критично-сопоставимая рассинхронизация единицы бурения: «X м» и «X м.п.» для одной величины в одном и том же диалоге (src/components/piling/admin-reports/report-form-dialog.tsx:351 против :438) и в форме отчёта (src/components/piling/report-form/drilling-section.tsx:48,69,84,85). Нарушает решение владельца 28.09.2026 («сваи и бурение везде „шт. / м.п.“»), зафиксированное в src/lib/format.ts:127-133.
2. Плановые метры объектов печатаются как «м», а не «м.п.», и без форматирования: src/components/piling/admin-sites/hierarchy-tree.tsx:231,234,246,266,269,277.
3. Длина сваи в справочнике — 2 знака («12,00 м», src/components/piling/admin-dictionaries.tsx:227,656; dictionary-table.tsx:43), а на экранах отчётов — 1 знак («12,0», src/components/piling/admin-reports/report-form-dialog.tsx:316). Одна величина, разная точность.
4. Ввод длины сваи показывает точку вместо запятой: src/components/piling/admin-dictionaries/dictionary-form.tsx:46 и admin-dictionaries.tsx:495 (`String(lengthMm/1000)` → «12.5»).
5. Таблица истории отчётов по технике без единиц в заголовках и без «м.п.» у метража: src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:149-151,176-178.

Статус проверки: ПРОЙДЕНО для всех находок ниже (файл открыт, строка сверена); отдельные — ГИПОТЕЗА (помечено). Числа получены командой (node v26.7.0), вывод приведён в «Методике».

## Методика

1. `git rev-parse HEAD` → 9f81893fc1f4a2c5fae488a524c70dcae1a0d24c (ветка hermes/q4-0926).
2. Прочитан src/lib/format.ts целиком (форматтеры: formatNumber, formatFixed, formatNum, formatCountMeters) и src/lib/pile-length.ts (единственный источник длины сваи: PileGrade.lengthMm / 1000).
3. Текстовый поиск по src/**/*.{ts,tsx} (search_files / ripgrep):
   - `м\.п\.|мм|lengthMm|formatCountMeters`
   - `мм|м/уд|мм/уд|м\.п|formatFixed`
   - `м/ч|моточас`
   - `toLocaleString\('ru'`
   - `[^а-яА-Я]мм`
   - `шт/м\.п|мм/уд|мм/удар|шт\. /`
   - `\}\s*м` (единица «м» сразу после интерполяции)
   Поиск ограничен src/; e2e/ не открывался (см. «Не проверено»).
4. Открыты все файлы-кандидаты целиком или диапазоном `sed -n`/read_file: format.ts, pile-length.ts, equipment-table.tsx, equipment-detail-parts.tsx, equipment-detail-overview.tsx, equipment-tile.tsx, hierarchy-tree.tsx, admin-sites/index.tsx, admin-dictionaries.tsx, dictionary-form.tsx, dictionary-table.tsx, report-form-dialog.tsx, report-detail-dialog.tsx, report-evidence-row.tsx, report-evidence-preview.tsx, report-history.tsx, report-history-detail-dialog.tsx, submit-bar.tsx, report-sent-screen.tsx, pile-section.tsx, drilling-section.tsx, pile-detail.tsx, journal-title-block.tsx, driving-sets.tsx, pile-journal-export.ts, pdf-generator/format.ts, single-pdf.ts, components.ts, equipment-analytics.tsx, monitoring/equipment-tile-block.tsx, maintenance/*.tsx.
5. Числа подтверждены командой (node v26.7.0):
   formatNumber(19136.5,1) = 19 136,5; formatNumber(2832,0) = 2 832; (12.5).toLocaleString('ru') = 12,5;
   pdf formatNumber(36.0) = 36; pdf formatNumber(36.5) = 36,5; String(12500/1000) = 12.5;
   formatFixed(9,1) = 9,0; `${1234.5}` = 1234.5; formatNumber(1754,1) = 1 754; formatFixed(40311,1) = 40 311,0.
6. Замороженные области НЕ проверялись: src/components/piling/operator*/** (operator, operator-v2, operator-v5, operator-mobile), src/app/orion/**. Там есть расхождения (напр. operator-v5-app.tsx:745 `formatNumber(...,0) м.п.`, operator-mobile/screens/entries-list.tsx:76 `toFixed(1)` — точка), но по AGENTS.md они исключены из аудита.

## Таблица единиц (экран | файл:строка | формат | риск)

| Экран / место | Файл:строка | Формат вывода | Риск |
|---|---|---|---|
| Форма отчёта (оператор), сваи | src/components/piling/report-form/pile-section.tsx:56,83,118 | `formatNumber(x)` → «N шт. / X м.п.» (до 1 знака) | ок |
| Форма отчёта (оператор), бурение | src/components/piling/report-form/drilling-section.tsx:48,69,84,85 | «X м» (не «м.п.») | важно: нарушает решение 28.09.2026 |
| Итог формы (submit-bar) | src/components/piling/report-form/submit-bar.tsx:35,36,39,40 | «N шт. / X м.п.», подпись «шт/м.п.» без точек/пробелов | мелочь |
| Экран «Отправлено» | src/components/piling/report-form/report-sent-screen.tsx:41,42 | «N шт. / X м.п.» | ок |
| Диалог отчёта (админ), итог бурения | src/components/piling/admin-reports/report-form-dialog.tsx:351 | «N шт. / X м» | важно: та же величина ниже — «м.п.» (:438) |
| Диалог отчёта (админ), подвал | src/components/piling/admin-reports/report-form-dialog.tsx:437,438 | «N шт. / X м.п.» (и сваи, и бурение) | ок (но конфликт с :351) |
| Диалог отчёта, длина сваи | src/components/piling/admin-reports/report-form-dialog.tsx:316,326 | `formatFixed(...,1)` → «12,0 м» | ок |
| Деталь отчёта (админ) | src/components/piling/admin-reports/report-detail-dialog.tsx:83,92,118 | `formatFixed(...,1)` → «м»/«м.п.» | ок |
| «Отчёты» (журнал) | src/components/piling/report-history.tsx:327,329,334,336 | `{totalPiles}` сырое/`formatFixed(...,1)`, подпись «шт/м.п.» | мелочь: счёт без разделителя, «/» без пробелов |
| Деталь отчёта (история) | src/components/piling/report-history-detail-dialog.tsx:113,138 | «N шт.» сырое / «X м.п.» | мелочь (число без разделителя) |
| План свай (объект) | src/components/piling/admin-sites/hierarchy-tree.tsx:231,234 | «count шт × metersPerUnit м» (сырое), итог «X м» | важно: «м» вместо «м.п.», сырой metersPerUnit |
| План бурения (объект) | src/components/piling/admin-sites/hierarchy-tree.tsx:266,269,277 | «X м» | важно: «м» вместо «м.п.» |
| Объекты, плитки план/факт | src/components/piling/admin-sites/index.tsx:462-467 | `formatNumber(x)` (до 1 знака) шт. / м.п. | мелочь: счёт мог бы получить 0 знаков |
| Справочник (длина сваи) | src/components/piling/admin-dictionaries.tsx:227,656 | 2 знака → «12,00 м» | важно: разная точность с отчётами (1 знак) |
| Справочник (таблица), длина | src/components/piling/admin-dictionaries/dictionary-table.tsx:43 | 2 знака → «12,00» | важно |
| Справочник, ввод длины | src/components/piling/admin-dictionaries/dictionary-form.tsx:46; admin-dictionaries.tsx:495 | `String(lengthMm/1000)` → «12.5» (точка) | важно: локаль ru-RU нарушена |
| Карточка техники, история | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:149-151,176-178 | метраж без «м.п.», счёт сырой | важно |
| Карточка техники, характеристики | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:334-337,351-353,357,358 | `pushInt` → «350 мм» (сырое целое); `pushNum` → «12,0 м/т» | ок (целые) / «м» для габаритов-максимумов — уместно |
| Техника (таблица) | src/components/piling/admin-equipment/equipment-table.tsx:56,57,110,113,121 | «шт/м.п.»; метраж 1 знак; моточасы без единицы | мелочь |
| Аналитика техники | src/components/piling/equipment-analytics.tsx:211,212,332,333,340 | «Сваи, шт. / м.п.»; `fmt` = дубль formatNumber | мелочь |
| Аналитика (админ) | src/components/piling/admin-analytics.tsx:382,383,399,400,539,547 | «шт. / м.п.», formatCountMeters | ок |
| Журнал забивки (экран) | src/components/piling/pile-journal/index.tsx:397; pile-detail.tsx:89,90; journal-title-block.tsx:37 | «мм/уд» | мелочь: экспорт пишет «мм/удар» |
| Журнал забивки (xlsx-экспорт) | src/modules/reports/application/queries/pile-journal-export.ts:91 | «мм/удар» (титул) против «мм/уд» (колонки :113,114) | мелочь |
| PDF отчёта | src/lib/pdf-generator/format.ts:15-21 | «Метров на сваю» 1 знак; «Кол-во» — 0/1 знак перемен. | мелочь |
| PDF периодный | src/lib/pdf-generator/components.ts:203,236 | «Бурение, м.п.», «Метров, м.п.» | ок |
| Моточасы (везде) | src/components/piling/monitoring/equipment-tile-block.tsx:185,187,200; admin-equipment/.../equipment-detail-overview.tsx:156,174 | «м/ч» | мелочь: коллизия с «м»/«м.п.» |
| ТО (maintenance) | src/components/piling/maintenance/work-order-table.tsx:115,117; maintenance-detail-panel.tsx:86,87,91,92; maintenance-request-form.tsx:172 | сырые числа «м/ч» | мелочь: точка и без разделителя |

## Находки

Формат: # | severity | путь:строка | проблема | сценарий / почему важно | предлагаемая правка. Статус: ПРОЙДЕНО — файл открыт и строка сверена; ГИПОТЕЗА — вывод по коду без запуска экрана.

| # | severity | путь:строка | проблема | сценарий / почему важно | предлагаемая правка | статус |
|---|---|---|---|---|---|---|
| F1 | важно | src/components/piling/admin-reports/report-form-dialog.tsx:351 и :438 | В одном диалоге итог бурения показан как «N шт. / X м» (:351), а в подвале — «N шт. / X м.п. бурение» (:438). Единица одной величины разная. | Диспетчер сверяет строку бурения в форме и в подвале — видит «м» и «м.п.», читает как разные цифры (то же, что владелец фиксировал 28.09.2026). | В :351 заменить ` м` на ` м.п.` (согласовать с :438 и с formatCountMeters). | ПРОЙДЕНО |
| F2 | важно | src/components/piling/report-form/drilling-section.tsx:48,69,84,85 | Метраж бурения в форме отчёта выводится как «X м»; сваи рядом — «м.п.» (pile-section.tsx:56,83,118). | Оператор видит «Объём: 36 м» против «шт. / м.п.» у свай — нарушение решения «сваи и бурение везде шт. / м.п.» (src/lib/format.ts:127-133). | Заменить «м» на «м.п.» в перечисленных строках (или использовать formatCountMeters). | ПРОЙДЕНО |
| F3 | важно | src/components/piling/admin-sites/hierarchy-tree.tsx:231,234,246,266,269,277 | План свай и бурения по объекту: итоги «X м» (не «м.п.»), а строка «{plan.count} шт × {plan.metersPerUnit} м» выводит metersPerUnit сырым числом. | Плановый метраж объекта читается как «м», хотя везде факт — «м.п.»; сырой metersPerUnit при дробном значении напечатает «33.333333» (точка, без форматирования). | Единицу на «м.п.», число — через formatFixed(…,1) (как в :234). | ПРОЙДЕНО (единица) / ГИПОТЕЗА (сырое значение metersPerUnit печатается как есть — вывод по коду) |
| F4 | важно | src/components/piling/admin-dictionaries.tsx:227,656; src/components/piling/admin-dictionaries/dictionary-table.tsx:43 | Длина сваи в справочнике — 2 знака («12,00 м»), а на экранах отчёта — 1 знак (`formatFixed(...,1)` в src/components/piling/admin-reports/report-form-dialog.tsx:316 и :326). | Одна и та же длина сваи отображается с разным числом знаков после запятой на разных экранах. | Выбрать единую точность (1 знак, как на экранах расчёта) и переиспользовать один форматтер. | ПРОЙДЕНО |
| F5 | важно | src/components/piling/admin-dictionaries/dictionary-form.tsx:46; src/components/piling/admin-dictionaries.tsx:495 | Поле ввода/черновик длины использует `String(item.lengthMm / 1000)` → «12.5» с точкой (проверено: `String(12500/1000)` = `12.5`). | Русскоязычный пользователь видит точку вместо запятой в поле, где ожидается «12,5»; при этом парсер (src/lib/parse-decimal.ts:15) принимает оба знака, поэтому ошибка тихая. | Форматировать через `(mm/1000).toLocaleString('ru-RU')` (или formatFixed) при инициализации значений. | ПРОЙДЕНО |
| F6 | важно | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:149-151,176-178 | В таблице истории отчётов по технике заголовки «Свай», «Бурение», «Простой» без единиц; метраж бурения (:178 `formatFixed(row.drillingMeters, 1)`) без «м.п.», счёт свай (:176 `{row.piles ?? '—'}`) — сырое число. | Единственная таблица истории техники не подписывает метраж как «м.п.» — противоречит «везде шт. / м.п.»; счёт без разделителя разрядов. | Добавить единицы в заголовки (шт. / м.п.) и «м.п.» к значению; счёт — через formatNumber(x,0). | ПРОЙДЕНО |
| F7 | мелочь | src/components/piling/admin-equipment/equipment-table.tsx:11-12,56,57 | Локальный `formatNum` дублирует `formatNum` из src/lib/format.ts:33, но локале `'ru'` и с иным дефолтом (digits=0); заголовки «шт/м.п.» без точек и пробелов. | Дублирующий форматтер расходится с общим (потенциал дрейфа); стиль заголовка «шт/м.п.» отличается от «шт. / м.п.» (equipment-analytics.tsx:211, admin-analytics.tsx:382). | Удалить локальный дубль, импортировать из @/lib/format; унифицировать подпись. | ПРОЙДЕНО |
| F8 | мелочь | src/components/piling/admin-equipment/equipment-table.tsx:121 | `c.engineHoursTotal?.toLocaleString('ru')` печатается без единицы, в отличие от «м/ч» везде (equipment-detail-overview.tsx:156, monitoring/equipment-tile-block.tsx:185). | В колонке «Моточасы» число без «м/ч» — на фоне обилия «м»/«м.п.» читается неоднозначно. | Добавить « м/ч» через общий форматтер. | ПРОЙДЕНО |
| F9 | мелочь | src/components/piling/report-history.tsx:327,329,334,336 | Счёт выведен сырым (`{report.totalPiles}`, `{report.totalDrillingCount ?? 0}`) без разделителя разрядов; единица «шт/м.п.» без точек/пробелов; пара соединена «/» без пробелов («24/312,0»). | Отличается от канонического «24 шт. / 312 м.п.» (submit-bar.tsx:35, report-sent-screen.tsx:41). | Использовать formatCountMeters (или formatNumber(x,0) для счёта). | ПРОЙДЕНО |
| F10 | мелочь | src/components/piling/pile-journal/pile-detail.tsx:89,90; journal-title-block.tsx:37; index.tsx:397; driving-sets.tsx:43 против src/modules/reports/application/queries/pile-journal-export.ts:91 | Отказ обозначается «мм/уд» на экранах, но «мм/удар» в титульном листе xlsx-экспорта (при колонках-«мм/уд» в том же файле :113,114). | В подшитом документе две подписи одной величины («мм/удар» и «мм/уд»). | Выбрать одну форму («мм/уд» как на экранах) и применить в экспорте. | ПРОЙДЕНО |
| F11 | мелочь | src/lib/pdf-generator/format.ts:15-18 | `formatNumber` возвращает 0 знаков для целого и 1 для дробного (`Number.isInteger(numeric) ? 0 : 1`) → в колонке «36» и «36,5» (проверено командой). | Переменная точность внутри одной колонки PDF (и колонок шт./м.). | Решить, фиксировать ли точность (formatMeters уже даёт 1 знак) — либо применить его и к метрам. | ПРОЙДЕНО |
| F12 | мелочь | src/components/piling/admin-sites/index.tsx:462-467; src/components/piling/admin-reports/report-evidence-row.tsx:225,226; src/components/piling/admin-reports/report-evidence-preview.tsx:192,193 | Количество свай/бурения форматируется `formatNumber(x)` (по умолчанию до 1 знака) вместо 0, как в formatCountMeters. Для целых чисел вид не меняется (проверено: formatNumber(1754,1) = «1 754»), но при дробном счёте напечатается десятичная. | Латентный риск нецелого счёта — «1 754,5 шт.». | Передавать 0 (`formatNumber(count, 0)`). | ПРОЙДЕНО (поведение) / ГИПОТЕЗА (что счёт когда-либо дробный) |
| F13 | мелочь | src/components/piling/maintenance/maintenance-detail-panel.tsx:86,87,91,92; src/components/piling/maintenance/work-order-table.tsx:115,117; src/components/piling/maintenance/maintenance-request-form.tsx:172 | Моточасы вставляются сырыми числами (`${hours} м/ч`, `{dueHours}`, `{selected.engineHoursTotal}`) без форматтера. | При дробном значении получится «1234.5 м/ч» — точка и без разделителя разрядов (проверено: `${1234.5}` = `1234.5`). Домен моточасов целочисленный, поэтому риск латентный. | Обернуть в formatNumber/formatFixed(…,0). | ГИПОТЕЗА (зависит от дробности показаний счётчика) |
| F14 | мелочь | src/components/piling/pile-journal/driving-sets.tsx:25 | Погружение за залог вставляется сырым (`{row.refusalSetPenetrationMm ?? '—'}`) — точка вместо запятой при дробном значении. | В подписи «N мм за M ударов» число не проходит ru-форматтер. | Форматировать через formatNumber(…,1). | ГИПОТЕЗА (по коду; значение поля не проверялось) |
| F15 | мелочь | src/components/piling/equipment-analytics.tsx:399-410 | `fmt` (399) и `fmtHours` (403) — дословные дубли src/lib/format.ts:1-6 (formatNumber) и :23-30 (formatHours). | Копии форматтеров склонны расходиться при будущих правках. | Импортировать из @/lib/format. | ПРОЙДЕНО |
| F16 | мелочь | src/components/piling/monitoring/equipment-tile-block.tsx:185,187,200; src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:156,174; src/modules/operator-mobile/domain/checklist-catalog.ts:523 | Моточасы подписаны «м/ч». | «м/ч» на экране, изобилующем «м», «мм», «м.п.», читается как «метров в час». Единица применяется единообразно по коду, поэтому статус — мелочь, а не ошибка. | Рассмотреть «моточас»/«маш.-ч» либо явный заголовок «Моточасы, м/ч». | ПРОЙДЕНО (единица) / ГИПОТЕЗА (восприятие пользователем) |
| F17 | мелочь | src/components/piling/admin-equipment/equipment-tile.tsx:16,108; src/components/piling/admin-analytics.tsx:510 | `toLocaleString('ru')` без ограничения знаков (моточасы, стоимость). | Значение с плавающей точкой напечатает лишние знаки; для целых безопасно. | Задать maximumFractionDigits. | ГИПОТЕЗА (зависит от данных) |
| F18 | мелочь | src/components/piling/admin-dictionaries.tsx:568 (placeholder «120×120 мм») против src/components/piling/admin-dictionaries/dictionary-form.tsx:101 («350×350 мм») | Одно и то же поле «Сечение/диаметр» имеет два разных примера-заполнителя. | Косметический разнобой подсказки ввода. | Выбрать один пример. | ПРОЙДЕНО |

## Не проверено

- Рендер экранов в браузере/Playwright не запускался: выводы по коду, а не по факту отрисовки (помечено ГИПОТЕЗА там, где итог зависит от данных). Почему: задача — только чтение; запуск e2e требует окружения, которое не поднималось.
- Фактические значения полей (дробность metersPerUnit, engineHours, refusalSetPenetrationMm) в БД не проверялись — только формат вывода по коду.
- Замороженные области (src/components/piling/operator*/**, src/app/orion/**) не проверялись по AGENTS.md, хотя там видны расхождения (operator-v5-app.tsx:745 `formatNumber(...,0) м.п.`; operator-mobile/screens/entries-list.tsx:76 `toFixed(1)` → точка).
- Каталог e2e/ не открывался: не проверено, зафиксированы ли текущие форматы («м» vs «м.п.», «мм/уд» vs «мм/удар») в e2e-спеках; при изменении формулировок тесты могут потребовать правки.
- Экраны, где единица берётся из данных/шаблонов (справочники типов бурения вида «d=620 мм», src/services/dictionaries/system-templates.ts:14,15) — источник строк не разбирался.
- Не проверялись мобильные/операторские экраны вне замороженных папок и Telegram/PDF-уведомления (src/services/reports/daily-summary) на предмет знаков после запятой — вне охвата текущего поиска.
