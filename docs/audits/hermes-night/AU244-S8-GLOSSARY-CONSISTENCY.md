# AU244-S8-GLOSSARY-CONSISTENCY — Термины: единый словарь

**Версия (git rev-parse HEAD):** `7ea8f570a97d756afaee03e0e6bfe0b8e6060bd1`
**Дата:** 2026-10-11
**Тип:** только чтение, код приложения не менялся.
**Статус аудита:** ПРОЙДЕНО (все находки ниже — по открытым файлам, `path:line` — из `grep`/`sed`).

## Итог

- Проверено: 34 находки. По важности: **критично — 0, важно — 14, мелочь — 20.**
- Критичных (потеря данных/деньги) нет: все расхождения — это разные СЛОВА для одних и тех же объектов, не разные данные.
- Топ-5: (1) роль «Механик/Мастер/Инженер ОТ» в журнале отчётов печатается как «Оператор» (`report-list-format.ts:46`); (2) статус `submitted` — «Отправлен» и «Сданные» на одном экране; (3) мёртвый файл-словарь `messages/ru.json` с расходящимися подписями (в т.ч. роль «Монтёр»); (4) один маршрут `/admin/to` в меню называется «Техготовность» одним ролям и «Готовность техники» другим; (5) один и тот же наряд ТО зовут и «наряд», и «заявка».
- Главная причина: нет единого источника подписей. Карты ролей, типов смены и статусов скопированы в 5–6 файлов и уже разошлись.
- Положительное: «Отчёт» везде пишется с «ё» (185/0), термины иерархии (Объект/Свайное поле/Куст/Пикет) согласованы.
- Рекомендация: свести подписи ролей, смен, статусов и ТО в один модуль (напр. расширить `src/lib/types.ts` и `report-history.ts`) и импортировать оттуда.

## Резюме для владельца (5 строк)

1. Один и тот же объект в системе часто назван разными словами — это путает людей, но данные при этом одни и те же.
2. Самое заметное: наряд по технике зовут и «наряд ТО», и «заявка»; отчёт и «Отправлен», и «Сданные»; модуль готовности — и «Техготовность», и «Готовность техники».
3. Есть рабочий дефект подписей: если отчёт правил механик (или мастер), в журнале он показывается как «Оператор» — неверный след «кто изменил».
4. В репозитории лежит готовый файл-словарь `messages/ru.json`, но он нигде не используется и уже расходится с экранами (там роль «Монтёр» — такого слова на экранах нет вообще).
5. Чинить не срочно, но лучше один раз завести один словарь подписей и брать текст оттуда, а не переписывать в каждом экране.

## Методика (как повторять)

Всё — из корня `D:\PillingR\wt-night`, `git-bash`. Числа сняты `grep -ro`, пути — из `grep -n`/`sed -n`.

```
git rev-parse HEAD
# где вообще живут русские подписи
node -e "const m=require('./messages/ru.json');const w=(o,p='')=>{for(const k in o){const v=o[k];typeof v==='object'?w(v,p+k+'.'):console.log((p+k).padEnd(46),v)}};w(m)"
grep -rn "messages/ru\|messages/en\|next-intl\|useTranslations" src        # пусто
grep -rl  "messages/ru" . | grep -v node_modules                            # только .gitnexus
# термины
for t in "Установка" "Копёр" "Техника" "Машина"; do echo -n "$t "; grep -ro "$t" src --include=*.ts --include=*.tsx | wc -l; done
grep -rn "OPERATOR:\s*'" src --include=*.ts --include=*.tsx                  # карты ролей
grep -rln "Дневная" src --include=*.ts --include=*.tsx                       # карты типа смены
grep -rn "Отправлен\|Сданные" src --include=*.tsx | grep -v __tests__        # статус отчёта
grep -rn "nаряд\|заявк" src/components/piling/maintenance                    # наряд/заявка
# сверка со спецификацией интерфейса
sed -n '55,70p' docs/ui-spec/operator-v3-ui-spec.md
sed -n '51,70p'  docs/product/operator-shift-readiness-specification-2.0-final.md
```

Замороженные зоны (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) в находки не брались. Существующие отчёты `docs/audits/` не читались.

## Таблица терминов

| Термин | Варианты (файлы) | Предложение |
|---|---|---|
| Статус отчёта `submitted` | «Отправлен» (`src/services/reports/report-history.ts:33`, `src/components/piling/report-history.tsx:318`), «Сданные» (`src/components/piling/admin-reports/admin-reports.tsx:38`) | Один словарь статусов; «Сдан»/«Не сдан» вместо «Отправлен». |
| Роль `OPERATOR` | «Оператор» (`src/lib/types.ts:18`, `src/components/piling/to/readiness/handover-journal.ts:42`), «Машинист» (`src/components/piling/to/readiness/screens/documents-screen.tsx:42`, `src/modules/reports/application/queries/pile-journal-export.ts:117`) | Оставить одно слово. Глоссарий проекта даёт «машинист» (`domain-glossary`). |
| Роль `ASSISTANT` | «Помощник» (код), «Монтёр» (`messages/ru.json:49`) | «Помощник» (вариант «Монтёр» в живом коде отсутствует). |
| Установка (`Equipment`) | «Установка» (везде), «Оборудование» (`src/lib/pdf-generator/single-pdf.ts:44`, `src/services/reports/event-handlers.ts:644`), «машина» (`src/components/piling/admin-dashboard.tsx:350`) | Оставить «Установка» в интерфейсе и PDF/Telegram. |
| Наряд ТО (`MaintenanceRecord`) | «наряд ТО» (`src/components/piling/maintenance/work-order-form-dialog.tsx:270`), «заявка» (`src/components/piling/maintenance/maintenance-request-form.tsx:142`, `src/components/piling/to/readiness/screens/maintenance-screen.tsx:127`) | Одно слово; «заявка» — только для внешних обращений (ОРИОН). |
| Уровень ТО `TO1/2/3` | «ТО-1» (`src/components/piling/maintenance/maintenance-labels.ts:9`), «Плановое ТО-1» (`src/modules/inspections/application/commands/inspection-commands.ts:20`) | «Плановое ТО-1/2/3» единообразно. |
| Тип ТО `SCHEDULED` | «Плановое ТО» (`maintenance-labels.ts:15`), «Техническое обслуживание» (`maintenance-request-form.tsx:43`) | Одно слово. |
| Справочник: `isActive` | «Активен» (`src/components/piling/admin-dictionaries/dictionary-table.tsx:123`), «Активный» (`src/components/piling/admin-dictionaries.tsx:561`), «Действует» (`src/components/piling/to/readiness/settings/checklists-section.tsx:242`) | «Действует / Архив» единообразно. |
| Модуль `/admin/to` | «Техготовность» (`src/components/piling/icons/role-navigation.ts:86,150`), «Готовность техники» (`role-navigation.ts:107,132`), «Центр готовности» (`src/components/piling/to/readiness/module-tab-list.tsx:31`) | Одно имя во всех ролях. |
| Модуль `/admin/maintenance` | «Обслуживание» (`role-navigation.ts:114`), «Наряды ТО» (`src/components/piling/maintenance/maintenance-board.tsx:284`), «Обслуживание ТО» (`module-tab-list.tsx:33`) | Одно имя. |
| Состояние смены `HANDOVER_PENDING` | «Ждёт приёмки» (`src/components/piling/to/readiness/readiness-labels.ts:14`), «Передача» (`src/components/piling/to/readiness/screens/shared.tsx:167`) | Один словарь (библиотека подписей есть — фильтр её не использует). |
| «Допуск» | 4 смысла: шаг готовности (`src/components/piling/to/readiness/authoritative-presentation.ts:114`), наряд-допуск (`src/components/piling/to/readiness/forms/permit-form.tsx:271`), допуск работника (`module-tab-list.tsx:50`), допуск смены (`readiness-labels.ts:12`) | Развести: «наряд-допуск», «допуск работника», «приёмка смены», «шаг допуска». |
| «Наряд-допуски» | «Наряд-допуски» (`module-tab-list.tsx:61`), «Наряды-допуски» (`src/components/piling/to/readiness/screens/blocker-guidance.ts:47,52`) | Единый порядок слов. |
| Простой | «Простой» (KPI/колонки, `admin-dashboard.tsx:353`, `src/components/piling/admin-sites/index.tsx:239`), «Простои» (раздел справочника, `admin-dictionaries.tsx:77`) | Допустимо: «Простой» — величина, «Простои» — список. Зафиксировать правило. |

## Находки

| # | Важность | path:line | Проблема | Сценарий / почему важно | Предложение |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-reports/report-list-format.ts:46` | `roleLabel()` знает только ADMIN/DISPATCHER/ASSISTANT, всех прочих (MECHANIC, FOREMAN, SAFETY_ENGINEER) сводит к «Оператор» | Правку отчёта, сделанную механиком/мастером, журнал показывает как «Оператор: Иванов» — неверный след «кто изменил» (аудит-поле `lastEditedByRole`). | Импортировать `ROLE_LABELS` из `src/lib/types.ts:17`; неизвестную роль показывать кодом, не подменять «Оператор». |
| 2 | важно | `src/components/piling/admin-reports/admin-reports.tsx:318` | Дублирующая логика: `formatLastEditor` ещё раз сводит MECHANIC/FOREMAN/SAFETY_ENGINEER к «Оператор» | Тот же неверный след в списке отчётов, отдельным копипастом. | Использовать `roleLabel` из `report-list-format.ts` (после фикса №1). |
| 3 | важно | `src/services/reports/report-history.ts:33` | `submitted` → «Отправлен» | В журнале отчётов бейдж статуса читается «Отправлен» (напр. `report-evidence-row.tsx:222`), а фильтр на том же экране — «Сданные». Два слова для одного статуса на одном экране. | Один словарь статусов; выбрать «Сдан/Не сдан/Черновик». |
| 4 | важно | `src/components/piling/admin-reports/admin-reports.tsx:38` | Фильтр «Сданные» | То же, что №3: «Сданные» vs «Отправлен». | То же. |
| 5 | важно | `messages/ru.json:48` | Файл-словарь `messages/ru.json` (и `messages/en.json`) никем не импортируется (только `.gitnexus`), но содержит свои подписи: `OPERATOR: "Оператор"`, `ASSISTANT: "Монтёр"` | «Монтёр» — слова, которого на экранах нет вообще (0 вхождений в `src`); ресурс мёртв и уже разошёлся с кодом. Будет вводить в заблуждение следующего разработчика. | Удалить файлы `messages/` ИЛИ связать с кодом; перед удалением проверить ссылки (по правилам §4 AGENTS.md). |
| 6 | важно | `src/components/piling/to/readiness/screens/documents-screen.tsx:42` | Роль `OPERATOR` подписана «Машинист» | Табличка документов отказывает в другой подписи, чем меню/журналы («Оператор»). Один человек на двух экранах — под двумя именами. | Одна карта ролей. |
| 7 | важно | `src/modules/reports/application/queries/pile-journal-export.ts:117` | В заголовке выгрузки журнала свай — «Машинист» | Печатная форма отчёта расходится с экранами («Оператор»). | То же. |
| 8 | важно | `src/components/piling/icons/role-navigation.ts:86` | Один маршрут `/admin/to` назван «Техготовность» (стр. 86, 150) | Разным ролям одно и то же место в меню названо по-разному, человек не узнаёт экран. | Одно имя для всех ролей. |
| 9 | важно | `src/components/piling/icons/role-navigation.ts:107` | Тот же `/admin/to` для другой роли — «Готовность техники» | См. №8. | То же. |
| 10 | важно | `src/components/piling/to/readiness/module-tab-list.tsx:31` | Внутренняя вкладка — «Центр готовности» (третий вариант имени того же модуля) | Три названия одного модуля. | То же. |
| 11 | важно | `src/components/piling/maintenance/maintenance-request-form.tsx:142` | Кнопка отправки — «Создать заявку», тост «Заявка создана» (:126) | Пользователь создаёт «заявку», а видит её потом как «наряд ТО» (`maintenance-board.tsx:284`), «Новый наряд ТО» (`work-order-form-dialog.tsx:270`). | Выбрать одно слово для `MaintenanceRecord`. |
| 12 | важно | `src/components/piling/to/readiness/screens/maintenance-screen.tsx:127` | Кнопка «+ Создать заявку» в модуле готовности | Тот же объект, что «наряд ТО» в `readiness-centre.tsx:76` («закройте наряд ТО»). | То же. |
| 13 | важно | `src/components/piling/to/readiness/screens/readiness-centre.tsx:77` | «пока есть незакрытая заявка, шаг не закрыт» | Смешение «заявка»/«наряд» в подсказке одного экрана. | То же. |
| 14 | важно | `src/components/piling/maintenance/maintenance-labels.ts:9` | Тип `TO1` → «ТО-1» | В модуле осмотров тот же уровень — «Плановое ТО-1» (`inspection-commands.ts:20`), а на экране `start-inspection-form.tsx:6` уровень зовут «ТО-1/2/3». | «Плановое ТО-1/2/3» единообразно. |
| 15 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:20` | `TO1` → «Плановое ТО-1» | Прямое расхождение с `maintenance-labels.ts:9` для того же `MaintenanceType`. | То же. |
| 16 | важно | `src/components/piling/maintenance/maintenance-labels.ts:15` | Тип `SCHEDULED` → «Плановое ТО» | В форме создания тот же тип — «Техническое обслуживание» (`maintenance-request-form.tsx:43`). | Одно имя. |
| 17 | важно | `src/components/piling/to/readiness/readiness-labels.ts:14` | Состояние `HANDOVER_PENDING` → «Ждёт приёмки» | Фильтр модуля для того же состояния даёт «Передача» (`shared.tsx:167`) — две подписи состояния рядом. | Фильтр брать из `readiness-labels`. |
| 18 | важно | `src/components/piling/to/readiness/screens/shared.tsx:167` | Хардкод опций фильтра статуса | Дублирует `readiness-labels.ts` и уже разошлось (№17). | Импортировать словарь. |
| 19 | важно | `src/components/piling/to/readiness/authoritative-presentation.ts:114` | Шаг готовности назван «Допуск» | Слово «допуск» означает и шаг готовности, и `WorkPermit` (наряд-допуск, `permit-form.tsx:271`), и допуск работника (`module-tab-list.tsx:50`), и приёмку смены (`readiness-labels.ts:12`). Инженер ОТ не может по слову понять, о чём речь. | Развести понятия разными словами. |
| 20 | важно | `src/lib/pdf-generator/single-pdf.ts:44` | Подпись поля — «Оборудование» | В PDF одного отчёта тот же объект зовётся «Оборудование», тогда как во всём интерфейсе — «Установка». | «Установка». |
| 21 | важно | `src/services/reports/event-handlers.ts:644` | Telegram-уведомление: «🛠 Оборудование: …» | В мессенджере объект назван не так, как на экране («Установка»). | «Установка». |
| 22 | мелочь | `src/components/piling/admin-dictionaries/dictionary-table.tsx:123` | `isActive` → «Активен» (и :241) | В панели того же раздела — «Активный» (`admin-dictionaries.tsx:561`), а в готовности — «Действует». Три подписи одного состояния. | «Действует / Архив». |
| 23 | мелочь | `src/components/piling/admin-dictionaries.tsx:561` | `isActive` → «Активный» | См. №22 (расходится с «Активен» в таблице). | То же. |
| 24 | мелочь | `src/components/piling/to/readiness/settings/checklists-section.tsx:242` | `isActive` → «Действует» (и `dictionaries-section.tsx:171`, `settings-workspace.tsx:505`) | Третья подпись того же состояния. | То же. |
| 25 | мелочь | `src/components/piling/admin-dashboard.tsx:350` | В одной подписи KPI — «нет установок» и «машин с отчётом сегодня» | Одна плитка называет объект двумя словами. | Одно слово. |
| 26 | мелочь | `src/components/piling/admin-equipment/detail/equipment-inspections.tsx:54` | «Чек-листы осмотров этой установки.» | Спецификация прямо запрещает «чек-лист» в интерфейсе (`docs/ui-spec/operator-v3-ui-spec.md:65`, `docs/product/operator-shift-readiness-specification-2.0-final.md:63` — «проверка», не «чек-лист»). | «Проверки». |
| 27 | мелочь | `src/components/piling/inspections/start-inspection-form.tsx:234` | «Чек-лист соберётся из блоков:» и ссылка «Чек-листы» (:257) | То же — запрещённый спецификацией термин на экране. | «Проверка». |
| 28 | мелочь | `src/components/piling/to/readiness/screens/blocker-guidance.ts:47` | «вкладка «Наряды-допуски»» (и :52) | Реальная вкладка зовётся «Наряд-допуски» (`module-tab-list.tsx:61`, `permits-screen.tsx:181`) — перестановка слов в подсказке. | «Наряд-допуски». |
| 29 | мелочь | `src/components/piling/to/readiness/readiness-labels.ts:19` | Карта типа смены `DAY/NIGHT` дублируется (≥6 копий: `pile-journal/index.tsx:42`, `src/lib/pdf-generator/format.ts:55`, `src/modules/reports/application/queries/pile-journal-export.ts:39`, `report-export.service.ts:59`, `src/components/piling/to/readiness/shift-create-form.tsx:41`) | Значения пока совпадают, но шесть копий разойдутся при первом же правке (как уже разошлись роль и тип ТО). | Одна карта в общем модуле. |
| 30 | мелочь | `src/lib/types.ts:17` | Карта ролей `ROLE_LABELS` дублируется (≥5 копий: `handover-journal.ts:40`, `documents-screen.tsx:42`, `src/lib/pdf-generator/format.ts:66`, `report-list-format.ts:46`) и уже разошлась (№6, №7). | Причина №1 и №6. | Один источник `ROLE_LABELS`. |
| 31 | мелочь | `src/components/piling/maintenance/maintenance-labels.ts:19` | Состояние «В работе» (`IN_PROGRESS`) | Тем же словом подписаны `STARTED` смены (`readiness-labels.ts:13`) и состояние осмотра (`src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:26`) — сущности разные, фильтры «Статус» по модулям. | Уточняющие подписи. |
| 32 | мелочь | `src/app/api/readiness/export/route.ts:52` | В одной строке экспорта «Моточасы» и «м/ч» | Разнобой единиц/слова для наработки («моточас» 157 против «м/ч» 99 по `src`). | Одна единица. |
| 33 | мелочь | `src/components/piling/icons/role-navigation.ts:34` | Домашний маршрут оператора назван «Смена», помощника — «Допуск» (:55) | Личный экран в меню назван по понятию предметной области, а в админ-меню аналог — «Дашборд» (:81). Читается непоследовательно. | Назвать экран по назначению. |
| 34 | мелочь | `src/components/piling/main-dashboard/kpi-catalog.ts:19` | Плитка «Простой» против раздела «Простои» (`src/components/piling/admin-dictionaries.tsx:77`) | Единственное/множественное для одного показателя. Допустимо, но стоит зафиксировать правило. | Правило: величина — «Простой», список — «Простои». |

### Приложение: остальное, что проверено и СОГЛАСОВАНО (проблем нет)

- «Отчёт»/«отчёт» — всегда с «ё»: 185 / 0 вхождений в `src` (без «ё» — 0).
- Иерархия: «Объект» (287/592), «Свайное поле» (`src/components/piling/report-form/cascading-select.tsx:43`, `src/app/api/...`), «Куст» (19/52), «Пикет» (11/70) — единообразно.
- «Смена», «Простой», «Дневная/Ночная» — слова одни и те же; расходится только место хранения (№29).
- Термин «наряд-допуск» в живом коде пишется слитно-через-дефис последовательно, кроме №28.

## Что не проверено

- **НЕ ПРОВЕРЕНО:** фактическое отображение терминов на живом экране (нет запуска приложения в рамках этого аудита). Все выводы — из исходников и `grep`, без прогона UI.
- **НЕ ПРОВЕРЕНО:** реальные значения `lastEditedByRole` в проде — есть ли вообще записи с MECHANIC/FOREMAN/SAFETY_ENGINEER (база не читалась). Дефект №1/№2 доказан по коду, но его частота на данных не измерена.
- **НЕ ПРОВЕРЕНО:** используется ли `messages/ru.json` вне репозитория (внешний пайплайн/скрипт вне git) — поиск по репозиторию дал только `.gitnexus`; если файл читает что-то за пределами репозитория, удалять нельзя без проверки (см. §4 AGENTS.md).
- **ГИПОТЕЗА:** смешение «ё» в «Завершён/Завершен» (`Завершён`=2, `Завершен`=10; `завершён`=67, `завершен`=97) — по выборке большая часть «завершен» это слово «завершение» (ё нет законно), поэтому как дефект не заявлено; точечная сверка прилагательных-статусов не проводилась.
- **ГИПОТЕЗА:** экраны внутри замороженных зон (`operator*`, `operator-mobile`, ORION) содержат ещё расхождения (напр. чипы «Сдан/Не сдан» в `operator-mobile`), но по правилу задачи они в находки не брались.
- **НЕ ПРОВЕРЕНО:** жаргон в комментариях кода (например «контур готовности» рядом с «Техготовность») — это внутренние заметки, не пользовательский текст; оценивались только подписи интерфейса и документов.
