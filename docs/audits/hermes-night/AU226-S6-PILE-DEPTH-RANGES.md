# AU226-S6-PILE-DEPTH-RANGES: Глубины свай: диапазоны и проверки

Репозиторий: D:\PillingR\wt-night, ветка hermes/q4-0926.
Ревизия на момент аудита: `git rev-parse HEAD` = `d53eeb22c00eed4850de6b24e961c55092feba39`.
Только чтение: код приложения не изменялся. Создан один файл — этот отчёт.

## Итог

Аудит охватил все поля «глубина/длина/метраж» на трёх контурах: справочник марок свай,
сменный отчёт (сваи + лидерное бурение) и паспорт забитой сваи с экрана машиниста.
Найдено 15 находок: критичных — 0, важных — 6, мелочей — 9.

Топ-5 по значимости:

1. `PileGrade.lengthMm` принимается в диапазоне 1 … 1 000 000 мм (0,001 … 1000 м) — физического
   контроля сверху нет; это единственный источник погонных метров, поэтому опечатка в длине марки
   задним числом меняет м.п. всех отчётов по ней (важно).
2. Марка без длины (`lengthMm = null`) выбирается в отчёте, а `pileLengthMeters` возвращает 0 —
   погонные метры молча занижаются, предупреждения на экране отчёта нет (важно).
3. Технические лимиты установки `maxPileLength` / `maxDrillingDepth` заполняются и хранятся, но
   нигде не сверяются с фактической работой — установка может «забить» сваю или «пробурить»
   глубже своего паспорта, и никто не возразит (важно).
4. «Глубина скважины» (`metersPerUnit`) имеет три разных потолка в трёх местах: 200 м (мобильная
   команда), 9999 м (отчётная zod-схема), 500 м (паспорт установки) — единого правила нет (важно).
5. `PileWork.depth` записывается при сохранении паспорта, но не читается нигде в приложении —
   второй экземпляр того же факта рядом с `PilePassport.drivenDepthM` (важно).

Отдельно отмечу, что ключевое доменное правило «свая не уходит глубже собственной длины, кроме
погружения добойником» реализовано корректно и на сервере, и на клиенте (ПРОЙДЕНО).

## Методика

Что искал и как (все команды — из корня D:\PillingR\wt-night, bash/Git Bash):

- Поля-глубины/метража по схеме: `rg -n "lengthMm|metersPerUnit|maxPileLength|maxDrillingDepth|depth" prisma/schema.prisma`.
- Все места записи/чтения глубины: `rg -n "\bdepth\b" -g '*.ts' -g '*.tsx' src` (исключая `drivenDepth`,
  `maxDrillingDepth`, `drilling_depth`, глубину аудит-JSON).
- Диапазоны ввода: открыл `src/lib/validation-schemas.ts` целиком (149 строк схемы отчёта и
  метаданных установки), `src/app/api/dictionary/manage/route.ts`,
  `src/app/api/operator/mobile/command/route.ts` (zod-объединение команд машиниста).
- Проверки при сохранении: `src/modules/reports/application/commands/report-validation.service.ts`,
  `src/modules/reports/domain/report.aggregate.ts`,
  `src/modules/operator-mobile/application/commands/production.ts`,
  `src/modules/operator-mobile/domain/pile-passport.ts`.
- Справочник марок: `src/services/dictionaries/dictionary-service.ts` (`assertLengthMm`,
  `setPileGradeLength`), форма `src/components/piling/admin-dictionaries/dictionary-form.tsx`.
- Установки: `src/components/piling/admin-equipment/equipment-form.tsx` (NUM_LIMITS),
  `src/modules/equipment/application/commands/equipment-metadata.ts`.
- Планы объекта: `src/lib/validation-schemas.ts` (createSiteSchema/updateSiteSchema),
  `src/modules/sites/application/commands/site-admin-command.service.ts`.
- Числа: `node -e` (пересчёт мм→м и произведения лимитов), см. таблицу ниже.
- Покрытие тестами: `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts`.

Замечание по инструментам: вывод `rg` в этой оболочке местами искажал совпавшие идентификаторы
(подменял имена на `n`); там, где это мешало, использовал `grep -n` и `read_file`, чтобы цитировать
файл:строку точно.

## Находки

Обозначения: severity — критично / важно / мелочь.

| # | severity | Поле | Файл:строка | Диапазон (код) | Проверка при вводе/сохранении | Риск / сценарий | Fix |
|---|---|---|---|---|---|---|---|
| 1 | важно | `PileGrade.lengthMm` (длина марки, мм) | `src/app/api/dictionary/manage/route.ts:22`, `:48`; `src/services/dictionaries/dictionary-service.ts:63-66` | `int min(1) max(1_000_000)` = 0,001 … 1000 м | zod + `assertLengthMm` (>0, целое); смена длины у используемой марки требует `confirmRecalculate` (409), снятие длины — 422 | Свая 1000 м невозможна; опечатка `25000 → 250000` (т.е. 250 м) пройдёт, и м.п. всех отчётов по марке изменятся задним числом. Единственный источник м.п. | Сузить верхнюю границу до физичной (напр. ≤ 60 м = 60 000 мм) или предупреждать при длине вне 4…40 м |
| 2 | важно | `pileLengthMeters` при `lengthMm = null` | `src/lib/pile-length.ts:23-26`; выбор марки — `src/components/piling/report-form/use-report-form.ts:155` | `null`/`≤0` → 0 м | Нет проверки, что выбранная марка имеет длину; сервер м.п. не считает (считает аналитика/PDF) | Марка с `lengthMm = null` (схема `Int?`, `prisma/schema.prisma:2452`) выбирается в отчёте → м.п. молча занижаются; предупреждение есть только в period-PDF (`src/lib/pdf-generator/period-pdf.ts:37`) | Запретить/предупреждать выбор марки без длины в форме отчёта; вернуть признак на экран |
| 3 | важно | `Equipment.maxPileLength`, `Equipment.maxDrillingDepth` | `src/lib/validation-schemas.ts:169-170`; `src/components/piling/admin-equipment/equipment-form.tsx:131-132`; `src/modules/equipment/application/commands/equipment-metadata.ts:44-45` | maxPileLength 0…200 м; maxDrillingDepth 0…500 м | Диапазон проверяется только при заполнении карточки; потребителей нет (`grep -rn "maxDrillingDepth\|maxPileLength" src/modules src/services src/app` — пусто) | Технические лимиты хранятся, но фактическая работа с ними не сверяется: в отчёте/паспорте можно «забить» сваю 40 м установкой с `maxPileLength 20` — система не заметит | Либо задействовать лимит при сохранении паспорта/отчёта (предупреждение), либо явно задокументировать как справочные |
| 4 | важно | `LeaderDrilling.metersPerUnit` («глубина скважины») | мобильно: `src/app/api/operator/mobile/command/route.ts:116`; отчёт: `src/lib/validation-schemas.ts:267`; установка: `src/lib/validation-schemas.ts:170` | 0,1…200 м (моб.) / 0…9999 (отчёт) / 0…500 (паспорт установки) | Три независимых потолка; связи между ними нет | «Глубина» описана тремя числами; бурение 300 м пройдёт с телефона-команды только до 200, а из отчёта — до 9999. Единого правила «глубина» в продукте нет | Ввести один лимит глубины скважины и переиспользовать его в обеих схемах и в паспорте установки |
| 5 | важно | `PileWork.depth` vs `PilePassport.drivenDepthM` | запись: `src/modules/operator-mobile/application/commands/production.ts:338` (и `:352`); схема: `prisma/schema.prisma:2182` | `Float?`, без диапазона | Значение копируется из `drivenDepthM`; ни одного чтения `PileWork.depth` в `src/` нет (журнал читает `passport.drivenDepthM` — `src/modules/reports/application/queries/pile-journal-list.ts:159`) | Два экземпляра одного факта: если кто-то обновит паспорт, копия в `PileWork.depth` разойдётся. Поле «мёртвое на чтение» | Либо читать `PileWork.depth` как источник, либо перестать писать (одна правда — `PilePassport.drivenDepthM`) |
| 6 | важно | `SitePilePlan.metersPerUnit` / `SiteDrillingPlan.metersPerUnit` | `src/lib/validation-schemas.ts:83`, `:88`, `:109`, `:114`; `prisma/schema.prisma:1787`, `:1803` | `number min(0)`, БЕЗ верхней границы | Ни zod, ни служба (`src/modules/sites/application/commands/site-admin-command.service.ts:109,120,202,214`) не ограничивают сверху | Плановый «метраж на единицу» может быть любым (1e9) → «плановые метры» на экране объекта бессмысленны; при этом 0 разрешён | Добавить физичный верхний предел и, при желании, нижний > 0 |
| 7 | мелочь | `PileWork.count` (свай за запись) | zod: `src/lib/validation-schemas.ts:260` (только `min(1)`); реальный потолок: `src/modules/reports/application/commands/report-validation.service.ts:64` и `report.aggregate.ts:96,180`; ввод: `src/components/piling/report-form/pile-section.tsx:74` | 1…9999 | Верхняя граница НЕ в zod и НЕ на клиенте — только в службе/агрегате | Опечатка «100000 шт.» проходит ввод, отклоняется на сервере 400 с русским текстом (не на месте ввода). Согласованность сервер-сервер есть | Добавить `max(9999)` в zod и `max="9999"` в поле ввода |
| 8 | мелочь | `LeaderDrilling.meters` (мобильная команда) | `src/app/api/operator/mobile/command/route.ts:114,116`; запись: `src/modules/operator-mobile/application/commands/production.ts:403`; потолок отчёта: `src/modules/reports/domain/report.aggregate.ts:97,202` | на телефоне `meters = count × metersPerUnit` до 500 × 200 = 100000 м; потолок отчёта 99999 м | На мобильном пути `MAX_DRILLING_METERS` не проверяется (агрегат отчёта не задействован) | Один и тот же столбец `LeaderDrilling.meters` принимает до 100000 по телефону и только 99999 из отчёта — инвариант расходится по двум путям записи (перебор всего на 1 м, эффект мал) | Проверять произведение на обоих путях одним правилом |
| 9 | мелочь | `LeaderDrilling.meters` vs `count × metersPerUnit` (веб-отчёт) | `src/lib/validation-schemas.ts:266-268`; клиент: `src/components/piling/report-form/use-report-form.ts:371,402,434` | `meters` 0…99999; `count` 1…9999; `metersPerUnit` 0…9999 | Сервер доверяет присланному `meters` и НЕ сверяет с `count × metersPerUnit`; значение считает клиент | Подделанный/устаревший клиент может сохранить `meters`, не равный `count × metersPerUnit`; суммы м.п. бурения поедут | Пересчитывать `meters` на сервере (как это делает мобильная команда) |
| 10 | мелочь | `PileDrivingSet.penetrationMm` / `PilePassport.refusalSetPenetrationMm` (погружение за залог) | `src/app/api/operator/mobile/command/route.ts:89`, `:96` | 0…10 000 мм (10 м за один залог!) | zod-потолок; служба проверяет только `≥ 0` (`production.ts:299-307`) | Залог — серия ~10 ударов; погружение 10 м за залог физически бессмысленно, но проходит | Снизить потолок до физичного (десятки–сотни мм) |
| 11 | мелочь | `PilePassport.designRefusalMm` (проектный отказ) | `src/app/api/operator/mobile/command/route.ts:98` | 0…1000 мм/удар | Только zod | 1000 мм/удар — абсурдный проектный отказ; опечатка не ловится | Сузить верхнюю границу |
| 12 | мелочь | `PilePassport.drivenDepthM` (глубина погружения) | `src/app/api/operator/mobile/command/route.ts:95` | 0…200 м | zod + правило «≤ длины сваи, кроме добойника» (см. ПРОЙДЕНО ниже) | Потолок 200 м выше любой реальной сваи; ограничивает только грубый мусор | Оставить, но связать с `maxPileLength` установки (см. находку 3) |
| 13 | мелочь | `PilePassport.designHeadLevelM` / `actualHeadLevelM` (отметки головы) | `src/app/api/operator/mobile/command/route.ts:93-94` | −200…200 м | Только zod | Диапазон обоснован (отметка бывает отрицательной), замечаний по существу нет — зафиксировано для полноты | — |
| 14 | мелочь | `Equipment.heightMm` / `lengthMm` / `widthMm` (габариты, мм) | `src/lib/validation-schemas.ts:163-165`; `src/components/piling/admin-equipment/equipment-form.tsx:127-129` | 0…100 000 мм (100 м) | zod + UI | 100 м по габариту — верхняя страховка; допустимо, но не отсекает опечатку «×10» | При желании снизить до ~30 000 мм |
| 15 | мелочь | `PileGrade.lengthMm` через PATCH = `null` | `src/services/dictionaries/dictionary-service.ts:312-313` | `null` разрешён, если марка не используется (`reportCount = 0`) | У используемой — 422; у неиспользуемой — разрешено | У неиспользуемой марки длину снять можно → будущие отчёты по ней дадут 0 м.п. (см. находку 2). Осознанное решение, но связка с находкой 2 | Оставить либо запретить `null` вовсе, раз создание требует длину |

### ПРОЙДЕНО (реализовано корректно, зафиксировано как положительный результат)

| Правило | Файл:строка | Статус |
|---|---|---|
| Глубина погружения ≤ длины сваи, исключение — добойник (`followerUsed`) | домен: `src/modules/operator-mobile/domain/pile-passport.ts:151-163`; сервер: `src/modules/operator-mobile/application/commands/production.ts:283-293`; клиент: `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:159-168` | ПРОЙДЕНО (единственное правило глубины, реализованное и на сервере, и на клиенте) |
| Тест правила глубины (в т.ч. исключение добойника и «не с чем сверять») | `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts:440-446` | ПРОЙДЕНО |
| Диапазон `maxPileLength` / `maxDrillingDepth`: zod и UI совпадают | `src/lib/validation-schemas.ts:169-170` ↔ `equipment-form.tsx:131-132` | ПРОЙДЕНО (диапазон), но без потребителя — см. находку 3 |
| Потолок метража бурения 99999 согласован в zod ↔ службе ↔ агрегате | `validation-schemas.ts:268` ↔ `report-validation.service.ts:79` ↔ `report.aggregate.ts:97,202` | ПРОЙДЕНО |
| Потолок числа свай 9999 согласован в службе ↔ агрегате | `report-validation.service.ts:64` ↔ `report.aggregate.ts:96,180` | ПРОЙДЕНО на сервере; в zod и на клиенте верхней границы нет — см. находку 7 |
| Планы объекта: `count ≥ 1`, диаметр ≤ 999 | `validation-schemas.ts:82,86-88` | ПРОЙДЕНО по нижней границе; верхняя у `metersPerUnit` отсутствует — см. находку 6 |

## Не проверено

- **Прод-данные.** Не подключался к базе (запрещено). Реальные значения `PileGrade.lengthMm` и
  количество марок с `lengthMm = null` неизвестны — частота срабатывания находки 2 оценивается
  только по коду, не по данным. НЕ ПРОВЕРЕНО.
- **CHECK-ограничения в БД.** Смотрел только код и `schema.prisma`; SQL-миграции на предмет
  ограничений по `lengthMm`/`meters` не просматривал (задача — по коду). ГИПОТЕЗА: ограничений нет,
  т.к. схема Prisma их не описывает.
- **Точные значения лимитов в интерфейсе оператора-mobile.** Форма паспорта разобрана, но другие
  экраны мобильного модуля (`src/modules/operator-mobile/**` — замороженная зона) детально не
  разбирались сверх путей записи. НЕ ПРОВЕРЕНО.
- **Guard-тест инварианта м.п.** `src/lib/__tests__/pile-meters-invariant.test.ts` существует, но
  его содержимое на предмет «марка без длины» не открывал. НЕ ПРОВЕРЕНО.
- **Telemetry `drilling_depth`.** Упомянут в `src/services/telemetry/telemetry-ingestion-service.ts:9,37`
  и `src/app/api/telemetry/ingest/route.ts:239` — это дормантный контур (телеметрия), в диапазоны
  ручного ввода не входит; не проверялся.
- **Сборка/типы/тесты (§6 AGENTS.md).** Задача только на чтение; гейты (`tsc`, `lint`, `test:unit`,
  `playwright --list`, `build`) не запускались — отчёт не претендует на «зелёный прогон».
