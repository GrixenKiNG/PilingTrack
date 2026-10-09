# AU85-S2-PILE-PASSPORT-FIELDS: Паспорт сваи и журнал забивки — поля, единицы, проверки

Версия проверяемого кода: `git rev-parse HEAD` = `26c1a9e608981e6790dc9e43ee3b5cea5799cf5e`
(в рабочем дереве `AGENTS.md` помечен как изменённый; это не влияет на код ниже).

Независимый аудит. Только чтение: код приложения не менялся. Существующие отчёты в
`docs/audits/` не читались. Формат: `path:line` — строки открывались через `read_file`/`search_files`.

Важно о границах: часть кода паспорта живёт в «замороженных» деревьях
`src/modules/operator-mobile/**` и `src/components/piling/operator-mobile/**`
(`AGENTS.md:16` — шаблон `operator*`). Ничего там не менялось; читалось только для
описания полей, как и требует задание.

## Итог

- Всего находок: 14. Критично — 0, важно — 5, мелочь — 9. Ошибок диапазона, отсутствующих
  на уровне API-схемы, нет: у каждого числового поля паспорта есть `min/max` в zod
  (`src/app/api/operator/mobile/command/route.ts:81-109`). Проблемы — в другом месте.
- Обязателен на сервере только номер сваи; домен проверяет ещё согласованность пары
  «погружение/удары» и глубину против длины марки
  (`src/modules/operator-mobile/domain/pile-passport.ts:128,134,151`).
- Отказ НЕ хранится, а считается средним по трём последним залогам
  (`src/modules/operator-mobile/domain/pile-passport.ts:228-245`) — это осознанное
  решение, не дефект.
- Топ-5 по значимости: (1) `recordedByForeman` никогда не ставится в `true` — бейдж
  «Записал мастер» недостижим; (2) форма паспорта не шлёт `picketId` — у всех свай с
  паспортом пикет в журнале пуст; (3) замеры паспорта нельзя править, меняется только
  решение; (4) `drivenAt` = момент отправки команды, а не время забивки; (5) `mediaIds`
  паспорта никогда не заполняется.
- `PileWork.depth` записывается из `passport.drivenDepthM`, но нигде не читается —
  дубль источника истины глубины.

## Методика

Что искал (может быть перезапущено):

- `prisma/schema.prisma` — модели `PileWork` (строка 2172), `PilePassport` (2236),
  `PileDrivingSet` (2323), `PileGrade` (2439). Читал полностью.
- `search_files` по `validatePassport|pilePassport.create|drivenDepthM|refusalSetPenetrationMm`
  → нашёл: домен, сервис, список журнала, форму, команду, API-схему.
- `search_files` по `recordedByForeman`, `mediaIds`, `lengthMm`.
- `terminal` grep: `recordedByForeman` вне тестов; чтение `PileWork.depth` вне `src/generated`;
  кто импортирует `PileJournal`.
- Прочитаны целиком: `src/modules/operator-mobile/domain/pile-passport.ts`,
  `src/modules/operator-mobile/application/commands/production.ts` (фрагмент 240-390),
  `src/modules/reports/application/queries/pile-passport.service.ts`,
  `pile-journal-list.ts`, `pile-journal-types.ts`, `pile-journal-export.ts`,
  `pile-journal-totals.ts`, `src/components/piling/operator-mobile/screens/pile-passport-form.tsx`,
  `src/components/piling/operator-mobile/api.ts` (400-459),
  `src/components/piling/pile-journal/{index,pile-detail,driving-sets}.tsx`,
  `src/app/api/pile-passports/route.ts`, `.../[id]/decide/route.ts`, `.../export/route.ts`,
  `src/app/api/operator/mobile/command/route.ts` (60-177), `src/lib/pile-length.ts`.

Статусы ниже: ПРОЙДЕНО — подтверждено чтением; ГИПОТЕЗА — вывод, но не проверен запуском.

## Связь с отчётом и пикетом (по коду)

- Паспорт привязан к записи выработки: `PilePassport.pileWorkId @unique` → `PileWork`
  (`prisma/schema.prisma:2240,2303`). Одна свая с паспортом = одна строка `PileWork`
  с `count = 1` (`src/modules/operator-mobile/application/commands/production.ts:336`).
- Связь с отчётом — через `PileWork.reportId` → `Report`
  (`prisma/schema.prisma:2198`); черновик определяется статусом отчёта
  (`src/modules/reports/application/queries/pile-journal-list.ts:140`).
- Пикет паспорт не хранит: он на `PileWork.picketId` (`prisma/schema.prisma:2199`),
  заполняется из `entry.passport.picketId` (`production.ts:337`).
- Марка и длина — тоже не в паспорте, а в `PileWork.pileGradeId` → `PileGrade.lengthMm`
  (`prisma/schema.prisma:2449-2456`), длина в метры переводится только через
  `pileLengthMeters` (`src/lib/pile-length.ts:23`).

## Поля паспорта и залогов: тип, единица, проверка, где видно

Типы и единицы — из `prisma/schema.prisma`. Проверка диапазона — из zod-схемы команды
`src/app/api/operator/mobile/command/route.ts` (строки указаны) плюс домен/команда.
«Где показывается» — экраны и выгрузка.

| Поле | Тип в БД | Единица | Проверка (файл:строка) | Где показывается |
| --- | --- | --- | --- | --- |
| PilePassport.pileNumber | String | — | trim min1 max50 — command/route.ts:82; непустота — pile-passport.ts:128 | форма pile-passport-form.tsx:240-248; журнал index.tsx:421; выгрузка pile-journal-export.ts:140; деталь pile-detail.tsx:36 |
| PilePassport.designHeadLevelM | Float? | м | min(-200) max(200) — command/route.ts:93 | форма :253; деталь pile-detail.tsx:95; выгрузка :113,144 |
| PilePassport.actualHeadLevelM | Float? | м | min(-200) max(200) — command/route.ts:94 | форма :254; журнал index.tsx:428; деталь :94; выгрузка :111,145 |
| PilePassport.drivenDepthM | Float? | м | min0 max200 — command/route.ts:95; ≤ длины марки (не добойник) — pile-passport.ts:151-163; команда production.ts:283-293 | форма :257,259-263; журнал :427; деталь ; выгрузка :147 |
| PilePassport.refusalSetPenetrationMm | Float? | мм | min0 max(10 000) — command/route.ts:96; пара с blows — pile-passport.ts:134 | деталь (fallback) driving-sets.tsx:24-25; список pile-journal-list.ts:130; выгрузка (через отказ) :151 |
| PilePassport.refusalSetBlows | Int? | ударов/залог | int min1 max1000 — command/route.ts:97; пара с погружением — pile-passport.ts:134 | driving-sets.tsx:24-25; pile-journal-list.ts:130 |
| PilePassport.designRefusalMm | Float? | мм/удар | min0 max1000 — command/route.ts:98 | форма :328; журнал :433; шапка pile-journal-totals.ts:141; выгрузка :151 |
| PilePassport.totalBlows | Int? | ударов | int min0 max(100 000) — command/route.ts:99 | деталь pile-detail.tsx:96; выгрузка :149 |
| PilePassport.blowsLastMeter | Int? | ударов/м | int min0 max(100 000) — command/route.ts:100 | деталь :97; выгрузка :150 |
| PilePassport.redriven | Boolean | — | boolean — command/route.ts:101 (default false — schema:2266) | деталь :106; выгрузка :159 |
| PilePassport.followerUsed | Boolean | — | boolean — command/route.ts:102; снимает правило глубины — pile-passport.ts:152 | деталь :107; выгрузка :160 |
| PilePassport.headCutOff | Boolean | — | boolean — command/route.ts:103 | деталь :108; выгрузка :161 |
| PilePassport.planDeviationMm | Float? | мм | min0 max(10 000) — command/route.ts:104 | деталь :98; выгрузка :154 |
| PilePassport.tiltPercent | Float? | % | min0 max100 — command/route.ts:105 | деталь :99; выгрузка :155 |
| PilePassport.hammerType | String? | — | нет (снимок из карточки) — production.ts:363 | деталь :100; шапка pile-journal-totals.ts:139; выгрузка :156 |
| PilePassport.hammerEnergyKj | Float? | кДж | нет (снимок) — production.ts:364 | деталь :101; выгрузка :157 |
| PilePassport.dropHeightM | Float? | м | min0 max20 — command/route.ts:106 | форма :356; деталь :102; выгрузка :158 |
| PilePassport.mediaIds | Json (`[]`) | — | массив ≤10 — command/route.ts:107 | **нигде не собирается и не показывается** (см. находку 5) |
| PilePassport.note | String? | — | max2000 — command/route.ts:108 | форма :380-389; деталь :120; выгрузка :168 |
| PilePassport.acceptance | enum PileAcceptance | — | default PENDING — schema:2345-2349; решается decide/route.ts:14 | журнал index.tsx:443; деталь :38; выгрузка :164 |
| PilePassport.drivenAt | DateTime | момент | нет (ставится now) — production.ts:368 | журнал index.tsx:419; выгрузка :138 |
| PilePassport.recordedById | String | — | нет (ставится actorId) — production.ts:369 | косвенно (имя — через отчёт) |
| PilePassport.recordedByForeman | Boolean | — | default false — schema:2299; **никогда не ставится true** (см. находку 1) | деталь pile-detail.tsx:40 |
| PileDrivingSet.ordinal | Int | № | задаётся порядком массива — production.ts:377 | деталь driving-sets.tsx:58; выгрузка :177 |
| PileDrivingSet.blows | Int | ударов/залог | int min1 max1000 — command/route.ts:88; >0 — production.ts:300 | driving-sets.tsx:59; выгрузка :178 |
| PileDrivingSet.penetrationMm | Float | мм/залог | min0 max(10 000) — command/route.ts:89; ≥0 — production.ts:301 | driving-sets.tsx:60; выгрузка :179 |
| PileDrivingSet.dropHeightM | Float? | м | min0 max20 — command/route.ts:90 | driving-sets.tsx:61; выгрузка :180 |

## Поля без проверки диапазона

На уровне API-схемы полей без `min/max` нет. Отдельно перечисляю то, где проверки нет
или она есть только «на форму», и это проверено:

- `hammerType`, `hammerEnergyKj` — диапазона нет вовсе (снимок из карточки установки,
  `production.ts:363-364`). Значения приходят не от пользователя, а из БД, — риск низкий.
- `drivenAt`, `recordedById`, `recordedByForeman` — диапазона нет: это не вводимые
  величины, а проставляемые сервером (`production.ts:368-369`).
- `planDeviationMm`, `tiltPercent` — проверка `min(0)` (command/route.ts:104-105), т.е.
  отрицательное отклонение отвергается; знак направления не хранится (см. находку 10).
- Перекрёстных проверок между отметками, глубиной и длиной нет, кроме одной
  (глубина ≤ длины марки, `pile-passport.ts:151`) и пары refusal
  (`pile-passport.ts:134`) — см. находку 9.
- Верхние границы залогов/отказа (10 000 мм на залог, 1000 ударов) формально заданы, но
  физически нереалистично велики — отсекают только грубую опечатку (находка 8).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `prisma/schema.prisma:2299`; чтение — `src/modules/reports/application/queries/pile-journal-list.ts:151`, `src/components/piling/pile-journal/pile-detail.tsx:40` | `recordedByForeman` читается, но НИ ОДНА запись кода не ставит его в `true`; create паспорта поле не передаёт (`src/modules/operator-mobile/application/commands/production.ts:344-385`) | Замысел схемы (`schema.prisma:2296-2299`): мастер заводит паспорт «за машиниста», запись со слов имеет другой вес. На практике бейдж «Записал мастер» (`pile-detail.tsx:40`) не появится никогда, а признак «запись со слов» отсутствует в журнале | Либо прокинуть флаг с экрана мастера и в `logProduction`, либо убрать недостижимое поле/бейдж (решение владельца) |
| 2 | важно | `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:180-204` | Форма паспорта не шлёт `picketId`, хотя команда и схема его принимают (`src/app/api/operator/mobile/command/route.ts:83`, `production.ts:337`) | У всех свай с паспортом `PileWork.picketId = null` → в журнале графа «Куст, пикет» = «—» (`index.tsx:422`, `pile-journal-list.ts:146-148`), в выгрузке (`pile-journal-export.ts:141`) тоже пусто. Связь сваи с пикетом по паспортным сваям вводится только через пачку в веб-форме | Добавить выбор пикета в форму паспорта (с проверкой «пикет объекта смены», как в `production.ts:312-318`) |
| 3 | важно | `src/app/api/operator/mobile/command/route.ts:141`; поддержка — `production.ts` (ветка `correct-production`) | Правка измерительных полей паспорта невозможна: `correct-production` знает только `PILES/DRILLING/DOWNTIME`; изменить можно лишь решение (`decide`) | Описка в замере (отказ, глубина, номер залога) не исправляется, кроме как завести вторую сваю с тем же номером — это искажает исполнительный документ. История ведётся только по решению (`[id]/decide/route.ts:67-92`), а не по замерам | Решить с владельцем: разрешить поправку замеров (новая запись/аудит) либо явно запретить и фиксировать в отчёте |
| 4 | важно | `src/modules/operator-mobile/application/commands/production.ts:368` (и `:339`) | `drivenAt` (и `PileWork.occurredAt`) = `now` — момент отправки команды, а не фактическое время забивки; поле ввода времени отсутствует | Свая, забитая ночью и записанная утром, датируется утром; журнал «Дата забивки» (`index.tsx:419`) и период (`pile-journal-types.ts:232`) построены на этой метке. Для исполнительной документации время забивки существенно | При потребности владельца — поле времени забивки с границей внутри смены отчёта |
| 5 | важно | `src/app/api/operator/mobile/command/route.ts:107`; запись — `production.ts:366`; форма — `pile-passport-form.tsx:180-204` | `mediaIds` паспорта: схема и команда поддержаны, но форма медиа не собирает и не отправляет — всегда `[]` | Фото головы/залога в паспорте недостижимы, хотя поле типа `Json` и лимит ≤10 заведены. Для «свая ушла под землю навсегда» фото — доказательство | Либо добавить съёмку в форму, либо задокументировать, что медиа паспорта не поддерживаются |
| 6 | мелочь | `src/modules/operator-mobile/application/commands/production.ts:338`; чтение не найдено | `PileWork.depth` дублирует `PilePassport.drivenDepthM` (пишется тем же значением) и нигде не читается (`grep` вне `src/generated` — ноль обращений) | Второй источник истины по глубине: правка одного и не другого разведёт данные; мёртвая колонка сбивает чтение кода | Убрать запись `depth` в `PileWork` (после доказательства отсутствия читателей) либо убрать `drivenDepthM` из паспорта — выбрать один |
| 7 | мелочь | `src/components/piling/operator-mobile/screens/pile-passport-form.tsx:298,351` | Поле «Ударов» и «Всего»: `step="1"`, но клиент не округляет (`num()` — `pile-passport-form.tsx:80-84`); сервер требует `int` (`command/route.ts:88,99`) | Ввод `10.5` проходит клиентскую проверку `toMeasuredSets` (`:103-117`), уходит на сервер и отвергается 400 — машинист видит отказ после заполнения формы | Округлять/валидировать целочисленность на клиенте до отправки |
| 8 | мелочь | `src/app/api/operator/mobile/command/route.ts:89,96` | Верхняя граница погружения за залог и `refusalSetPenetrationMm` — 10 000 мм (10 м) за один залог; 1000 ударов в залоге | Границы отсекают только грубую опечатку (лишний ноль), а не осмысленность замера. Свая длиной 10 м «за один залог» пройдёт валидацию | Сузить до физичных значений, согласованных с длиной сваи марки |
| 9 | мелочь | `src/modules/operator-mobile/domain/pile-passport.ts:116-166` | Из перекрёстных проверок только две: пара refusal (`:134`) и глубина ≤ длины марки (`:151`). Отметки головы (`designHeadLevelM`/`actualHeadLevelM`), глубина и длина между собой не сверяются | Можно записать `actualHeadLevelM`, `drivenDepthM` и марку так, что числа не согласуются (например, острие выше/ниже проектного), и это не будет поймано ни на экране, ни на сервере | Добавить проверку согласованности отметки головы, глубины и длины марки в `validatePassport` |
| 10 | мелочь (ГИПОТЕЗА) | `src/app/api/operator/mobile/command/route.ts:104-105` | `planDeviationMm` и `tiltPercent` — `min(0)`: отрицательное значение отклонения отвергается, знак направления не хранится | Если по методике отклонение в плане знаковое (влево/вправо), требование модуля теряет направление. Не проверено назначением величин (нет доменной нормы в коде) | Уточнить у владельца: модуль или знак; при необходимости снять `min(0)` и хранить знак |
| 11 | мелочь | `src/app/api/operator/mobile/command/route.ts:98` | `designRefusalMm` допускает `0` (`min(0)`); при этом `refusalExceedsDesign` считает `actual > design` (`pile-passport.ts:51-57`) | Проектный отказ 0 означает, что любое фактическое значение > 0 даст «на добивку» (`suggestAcceptance`, `:79-97`) — ложная тревога на каждом забиве | Требовать `> 0`, если 0 не осмыслен; иначе задокументировать как «0 = не задан» |
| 12 | мелочь | `src/app/api/operator/mobile/command/route.ts:99-100` | `totalBlows` и `blowsLastMeter` допускают `0` (`min(0)`) | Ноль ударов при забитой свае физически бессмыслен и не отличим от «не мерили» (пусто = null) | Либо `min(1)`, либо явно трактовать 0 как «нет данных» |
| 13 | мелочь | `src/modules/reports/application/queries/pile-journal-list.ts:163-164`; форма `pile-passport-form.tsx:192-193` | `refusalSetPenetrationMm`/`refusalSetBlows` дублируют последний залог: форма кладёт туда замер последнего залога, домен при отсутствии залогов считает отказ по этой паре (`pile-journal-list.ts:129-132`) | Два хранимых представления одного замера; при записи паспорта без массива залогов (сейчас — только теоретически) значения пары и залогов могут разойтись | Оставить одну форму хранения либо явно задокументировать приоритет залогов (уже частично сделано в комментарии) |
| 14 | мелочь | `src/components/piling/pile-journal/index.tsx:428` | Экранный список показывает фактическую отметку головы (`actualHeadLevelM`), проектной отметки головы в списке нет (она только в детали `pile-detail.tsx:95` и в выгрузке `pile-journal-export.ts:145`) | Мастер, читающий журнал «столбцами», не видит проектной отметки рядом с фактической, хотя в подшитом .xlsx обе графы есть (расхождение экран/выгрузка) | Добавить графу проектной отметки головы в список либо убрать её из выгрузки/детали — свести состав граф к одному |

## Что не проверено

- Не запускались тесты, `tsc`, `lint`, `build` — задание только на чтение, поведение не
  воспроизводилось в исполнении (кроме чтения кода). Утверждения выше — по исходникам.
- Не проверялось фактическое поведение zod-схемы на реальном теле запроса (например,
  проходит ли `10.5` в `blows`): вывод о 400 сделан из объявления `z.number().int()`
  (`command/route.ts:88,99`) — помечено как непроверенный запуском.
- Находка 10 (знак отклонений) — ГИПОТЕЗА: доменной нормы по знаку в коде нет, вопрос к
  владельцу.
- Не проверялось, читает ли кто-либо `PileWork.depth` вне `src/` (raw SQL в `scripts/`,
  внешние отчёты) — искал только в `src/`; при удалении колонки это надо подтвердить
  отдельно (правило `AGENTS.md:40-47`).
- Не открывались `docs/`, `e2e/`, `tests/` на предмет ссылок на поля паспорта (задание
  ограничивает чтение docs; e2e-спеки не проверялись на упоминания полей).
- Замороженные области (`src/modules/operator-mobile/**`,
  `src/components/piling/operator-mobile/**`, ORION) не рецензировались на предмет
  дефектов — читались только для описания полей; собственные находки там не искались.
