# R121. Формы админки: ограничения клиента и схемы маршрута (zod) расходятся

READ-ONLY. Создан только этот файл. Код, схема, `.env`, тесты не изменялись, ни один символ не правился (поэтому GitNexus `impact` не запускался — править нечего).
Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `322c330f` (`git status` — чисто на момент начала).
Образец класса — `F-R103-TOP` (коммит `52c27d5d`, «лимиты формы совпадают с серверными»: форма справочника отправляла заведомо отклоняемый запрос и получала общее «Некорректные данные»). Тут тот же класс ищется по всем формам админки.
Экраны машиниста (оператора) и ORION — вне области; `operator*`, `src/modules/operator-mobile/**`, `src/app/orion/**` не читались.

## Итог

Просмотрено 22 формы/диалога админки и их маршруты (только чтение). Итог по severity: **критично — 4, важно — 11, мелочь — 5, закрыто/повтор — 1** (всего 21 строк).
Главный дефект класса — **почти ни одна форма админки не повторяет лимиты zod-схемы своего маршрута**. `maxLength`/`min`/`max` стоят у считанных полей, а сервер отдаёт 400, и в большинстве форм построчные `details` не читаются (`apiErrorMessage` подключён только в 4 местах: отчёты, бригады, объекты, осмотры) — человек видит «Некорректные данные» и правит поля наугад.

Топ-5:
1. **Карточка техники** (`equipment-form.tsx`) — из ~20 числовых и ~14 текстовых полей лимит клиента совпадает с сервером только у года выпуска; 400 на описании/весе/мощности/стоимости не называет ни поле, ни предел, а поля скрыты на вкладках.
2. **Наряд ТО** (`work-order-form-dialog.tsx`) — моточасы дробные (сервер требует `int`), имя/описания без `maxLength`, отрицательные трудозатраты/стоимость проходят клиент; `details` не читаются.
3. **Редактор шаблона чек-листа** (`template-editor.tsx`) — название, текст пункта, норма, источник без лимитов на длинной форме; ошибка — общий текст.
4. **Отчёт (админ)** (`report-form-dialog.tsx`) — часы простоя > 24 (`DOWNTIME_MAX_HOURS`) и комментарий > 1000 символов отклоняются без подсказки; `details` читаются, но поля не подсвечиваются.
5. **Виды документов** (`user-document-types-dialog.tsx`) — «Срок, мес.» = 0 (или пусто-как-0) уходит на сервер, где `min(1)`; название без `maxLength`.

Проверено и совпадает (чтобы не искали заново): справочники (`dictionary-form.tsx`, коммит `52c27d5d`), координаты объекта, план свай по `count` (клиент отсекает нули), лимиты полей наряда-допуска `title`/`scope`, план смены (`createShiftSchema` — только enum/обязательность).

## Методика

Воспроизводимо чтением кода (Windows + Git Bash, Python нет; `read_file`/`search_files`/`git`).

1. `AGENTS.md` прочитан (модель доверия, заморозка вариантов оператора и ORION, «выглядит мёртвым, но живёт»); правок нет.
2. Инвентаризация форм: `search_files(target=files, pattern="*form*.tsx|*dialog*.tsx|*editor*.tsx")` по `src/components/piling/**` минус `operator*/**`, `orion*/**`; + `wc -l`. Прочитаны целиком 22 файла форм и под-компонентов (в т.ч. `forms/creation-form.tsx`, `to/readiness/forms/form-kit.tsx`, `template-editor-parts.tsx`, `pile-plan-section.tsx`, `drilling-plan-section.tsx`).
3. Ограничения клиента искал машинно и глазами: `grep -rn 'maxLength|min=|max=|step=|pattern=|type="number"'` по `src/components/piling/**` (вне замороженных зон) — каждая найденная строка прочитана в контексте.
4. Схемы маршрутов: `src/lib/validation-schemas.ts` (465 стр.) прочитан целиком; локальные схемы — чтением `src/app/api/**/route.ts` и `*schema*.ts`: `user-document-types/schema.ts`, `dictionary/manage`, `equipment/[id]/{maintenance,documents,fuel,meter-readings}`, `users/[id]/documents`, `checklist-templates`, `briefings`, `reports/admin-upsert`, `sites/{create,[id],[id]/hierarchy}`, `inspections`, `modules/readiness/application/{permits,shifts}/schemas.ts`.
5. Что видит человек: `src/lib/api-error-message.ts` прочитан целиком; `grep -rn apiErrorMessage src/components/piling` — 4 подключения (отчёты/бригады/объекты/осмотры), остальные формы читают только `err.error`. `src/components/piling/maintenance/maintenance-helpers.ts:46-53` — тоже только `err.error`.
6. Сверка с прошлым (чтобы не выдавать старое за новое): `docs/audits/hermes-night/R103-admin-dictionaries-messages.md` (форма справочника — закрыто), `21-form-validation.md` (показ ошибок; лимиты полей не разбирались), `R41-user-facing-errors.md` №6 (`details` не читается), `R111-report-form-messages.md` (тексты формы отчёта; лимиты не разбирались), `R119` (карточка техники — про 409, не про лимиты).
7. Динамика не запускалась: сервер не поднимался, браузер/Playwright недоступны, тесты форм не гонялись. Все исходы — вывод из разметки и ветвлений.

## Расхождение по полям (форма | поле | клиент | сервер | файл:строка)

Значения — из разметки формы и из схемы её маршрута. Клиент = атрибуты/проверки JS; сервер = zod.

| Форма | Поле | Клиент | Сервер | файл:строка |
|-------|------|--------|--------|-------------|
| Карточка техники | Название | без maxLength | max 200 | `admin-equipment/equipment-form.tsx:131-136` / `lib/validation-schemas.ts:187` |
| Карточка техники | Описание | Textarea без maxLength | max 2000 | `equipment-form.tsx:180-185` / `validation-schemas.ts:193` |
| Карточка техники | Модель / Базовая машина / Марка двигателя / Тип молота / Место базирования | без maxLength | max 200 | `equipment-form.tsx:139,158-163,202,234,257` / `validation-schemas.ts:192,156,166,171,183` |
| Карточка техники | Инв. номер / Серийный номер / Номер двигателя / Серийник молота | без maxLength | max 100 | `equipment-form.tsx:152,166,205,237` / `validation-schemas.ts:153,157,167,172` |
| Карточка техники | VIN | без maxLength | max 50 | `equipment-form.tsx:177` / `validation-schemas.ts:159` |
| Карточка техники | Год выпуска | min 1950, max 2100 | int 1950..2100 | `equipment-form.tsx:169-174` / `validation-schemas.ts:158` |
| Карточка техники | Вес / Вес с оборуд. | шаг 0.1, без max | 0..2000 | `equipment-form.tsx:194,195` / `validation-schemas.ts:161,162` |
| Карточка техники | Высота / Длина / Ширина | без max | int 0..100 000 | `equipment-form.tsx:197-199` / `validation-schemas.ts:163-165` |
| Карточка техники | Мощность двигателя | без max | int 0..10 000 | `equipment-form.tsx:207` / `validation-schemas.ts:168` |
| Карточка техники | Макс. длина сваи | без max | 0..200 | `equipment-form.tsx:209` / `validation-schemas.ts:169` |
| Карточка техники | Макс. глубина бурения | без max | 0..500 | `equipment-form.tsx:210` / `validation-schemas.ts:170` |
| Карточка техники | Энергия удара | без max | 0..10 000 | `equipment-form.tsx:239` / `validation-schemas.ts:173` |
| Карточка техники | Стоимость покупки | без max | 0..1 000 000 000 | `equipment-form.tsx:249` / `validation-schemas.ts:178` |
| Карточка техники | Наработка / След. ТО (моточасы) | без max | int 0..1 000 000 | `equipment-form.tsx:250,252` / `validation-schemas.ts:179,181` |
| Карточка техники | Объём бака | без max | int 0..100 000 | `equipment-form.tsx:251` / `validation-schemas.ts:180` |
| Пользователи | Имя | без maxLength | min 1, max 200 | `admin-users/user-dialogs.tsx:117-126` / `validation-schemas.ts:40` |
| Пользователи | Email | regex `\S+@\S+\.\S+` | `.email()`, max 255 | `user-dialogs.tsx:80,127-137` / `validation-schemas.ts:39` |
| Пользователи | Телефон | без maxLength/формата | max 30 | `user-dialogs.tsx:138-143` / `validation-schemas.ts:42` |
| Пользователи | Пароль | min 8 | min 8, max 100 | `user-dialogs.tsx:144-154` / `validation-schemas.ts:43` |
| Объект (создание) | Название | без maxLength | min 1, max 200 | `admin-sites/site-editor/create-site-dialog.tsx:82-88` / `validation-schemas.ts:68` |
| Объект (правка) | Название | без maxLength | max 200 | `edit-site-dialog.tsx:195-200` / `validation-schemas.ts:68,103` |
| Объект (правка) | Координаты | −90..90 / −180..180 | min/max совпадают | `edit-site-dialog.tsx:127-133,212-227` / `validation-schemas.ts:76-77` |
| Объект (план) | Диаметр бурения | `min 0`, без max | 0..999 | `drilling-plan-section.tsx:42-51` / `validation-schemas.ts:86` |
| Объект (план) | Кол-во свай | `min 0` | int min 1 | `pile-plan-section.tsx:78-87` / `validation-schemas.ts:82` (клиент отсекает нули: `admin-sites/use-site-mutations.ts:85,139`) |
| Объект (план) | м/шт | `min 0` | min 0 | `pile-plan-section.tsx:88-98` / `validation-schemas.ts:83` |
| Бригада | Название | без maxLength | max 200 | `admin-crews/crew-form-dialog.tsx:291-296` / `validation-schemas.ts:207,218` |
| Справочники | Название | maxLength 100 | max 100 | `admin-dictionaries/dictionary-form.tsx:69` / `dictionary/manage/route.ts:19` — **совпадает** |
| Справочники | Длина, м | ≤ 1000 м | int 1..1 000 000 мм | `dictionary-form.tsx:43-44` / `dictionary/manage/route.ts:21` — **совпадает** |
| Отчёт (админ) | Часы простоя | `min 0.5`, без max | 0..24 | `admin-reports/report-form-dialog.tsx:417-418` / `validation-schemas.ts:280` |
| Отчёт (админ) | Комментарий простоя | без maxLength | max 1000 | `report-form-dialog.tsx:421` / `validation-schemas.ts:281` |
| Отчёт (админ) | Кол-во строк свай / бурения | без ограничения | max 100 | `report-form-dialog.tsx:135,146` / `validation-schemas.ts:262,271` |
| Отчёт (админ) | Кол-во строк простоя | без ограничения | max 50 | `report-form-dialog.tsx:161` / `validation-schemas.ts:282` |
| Наряд ТО | Название | без maxLength | min 1, max 200 | `maintenance/work-order-form-dialog.tsx:290-295` / `equipment/[id]/maintenance/route.ts:23` |
| Наряд ТО | Описание | без maxLength | max 2000 | `work-order-form-dialog.tsx:351-355` / `maintenance/route.ts:24` |
| Наряд ТО | Причина неисправности | без maxLength | max 2000 | `work-order-form-dialog.tsx:333-337` / `maintenance/route.ts:34` |
| Наряд ТО | Выполненные работы | без maxLength | max 4000 | `work-order-form-dialog.tsx:339-343` / `maintenance/route.ts:35` |
| Наряд ТО | Запчасти | без maxLength | max 2000 | `work-order-form-dialog.tsx:345-349` / `maintenance/route.ts:36` |
| Наряд ТО | Моточасы | `type=number`, дробные допустимы | `.int()`, ≥ 0 | `work-order-form-dialog.tsx:316-320` / `maintenance/route.ts:27` |
| Наряд ТО | Трудоч. / Стоимость | `min 0` (HTML не блокирует минус) | min 0 | `work-order-form-dialog.tsx:321-330` / `maintenance/route.ts:28,32` |
| Заявка ТО | Краткое описание | maxLength 100 | max 200 | `maintenance/maintenance-request-form.tsx:31,181-188` / `equipment/[id]/maintenance/route.ts:23` — клиент строже |
| Заявка ТО | Подробное описание | maxLength 500 | max 2000 | `maintenance-request-form.tsx:32,193-200` / `maintenance/route.ts:24` — клиент строже |
| Шаблон чек-листа | Название | без maxLength | min 1, max 200 | `inspections/template-editor.tsx:236-244` / `checklist-templates/route.ts:35` |
| Шаблон чек-листа | Заголовок раздела | без maxLength | min 1, max 200 | `template-editor-parts.tsx` (секция) / `checklist-templates/route.ts:30` |
| Шаблон чек-листа | Текст пункта | Textarea без maxLength | min 1, max 500 | `template-editor-parts.tsx:101-107` / `checklist-templates/route.ts:17` |
| Шаблон чек-листа | Ед. изм. | без maxLength | max 40 | `template-editor-parts.tsx:135-140` / `checklist-templates/route.ts:19` |
| Шаблон чек-листа | Норма | без maxLength | max 300 | `template-editor-parts.tsx:144-149` / `checklist-templates/route.ts:20` |
| Шаблон чек-листа | Источник | без maxLength | max 120 | `template-editor-parts.tsx:153-158` / `checklist-templates/route.ts:21` |
| Шаблон чек-листа | Применимость (модель) | без maxLength | max 120 | `template-editor.tsx:274-281` / `checklist-templates/route.ts:38` |
| Виды документов | Название | без maxLength | min 1, max 200 | `admin-users/user-document-types-dialog.tsx:158-161` / `user-document-types/schema.ts:12` |
| Виды документов | Срок, мес. | min 1, max 600 (HTML), пусто → null | int 1..600 | `user-document-types-dialog.tsx:40-43,164` / `user-document-types/schema.ts:14` — «0» уходит как 0 |
| Виды документов | Предупредить за | min 0, max 365 | int 0..365 | `user-document-types-dialog.tsx:169` / `user-document-types/schema.ts:15` — совпадает |
| Документ работника | Номер | без maxLength | max 100 | `admin-users/user-documents.tsx:296-298` / `users/[id]/documents/route.ts:15` |
| Документ работника | Примечание | Textarea без maxLength | max 2000 | `user-documents.tsx:310-312` / `users/[id]/documents/route.ts:18` |
| Документ техники | Название | без maxLength | min 1, max 200 | `admin-equipment/detail/equipment-documents.tsx:249-254` / `equipment/[id]/documents/route.ts:20` |
| Документ техники | Заметки | Textarea без maxLength | max 2000 | `equipment-documents.tsx:280-285` / `equipment/[id]/documents/route.ts:23` |
| Наряд-допуск | Опасные факторы | ChipList без ограничений | max 20 × max 120 | `to/readiness/forms/form-kit.tsx:196-291`; `forms/permit-form.tsx:381-390` / `modules/readiness/application/permits/schemas.ts:11` |
| Наряд-допуск | Место работы | ≥ 2 символа | без min, max 200 | `permit-form.tsx:187,339-345` / `permits/schemas.ts:10` — клиент строже |
| Наряд-допуск | Описание работ | лимит 300 | min 3, max 4000 | `permit-form.tsx:23,377-380` / `permits/schemas.ts:9` — клиент строже (осознанно, `:21-23`) |
| Инструктаж | Основание | без maxLength | max 500 | `to/readiness/screens/briefing-conduct-dialog.tsx:127-131` / `briefings/route.ts:18` |
| Иерархия объекта | Название | без maxLength | min 1, max 200 | `admin-sites/site-editor/add-hierarchy-dialog.tsx:61-70` / `validation-schemas.ts:119,419` |
| Осмотр (механик) | Моточасы | `type=number`, дробные допустимы | `.int()`, ≥ 0 | `inspections/start-inspection-form.tsx:329-332` / `inspections/route.ts:18,26` |

## Находки

Severity по правилу: `критично` — форма отправляет заведомо отклоняемый сервером запрос, а человек не может понять, что править (общий тост, поле не подписано, поле может быть скрыто); `важно` — то же, но цена ошибки/частота ниже; `мелочь` — клиент строже сервера или подпись; `повтор Rnn` — уже разбиралось.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
|---|----------|-----------|----------|-------------------------|---------------------|
| 1 | критично | `admin-equipment/equipment-form.tsx:131-259` + `lib/validation-schemas.ts:151-184` | Из ~20 числовых и ~14 текстовых полей карточки совпадает с сервером только `manufactureYear` (`:169-174`): у остальных нет `min`/`max`/`maxLength`. `details` не читаются: ответ разбирается как `err.error` (`admin-equipment/use-equipment-list.ts:70,84,94`), тост собирается в `equipment-dialogs.tsx:55,120` | Админ заводит установку: пишет описание 2 500 знаков или вес «2500» т (сервер ≤ 2000) → 400. Тост «Ошибка создания установки»/«Некорректные данные» без поля и предела; проблемное поле может быть на скрытой вкладке «Тех. характеристики»/«Эксплуатация» (`:116,118` — вкладки заблокированы в режиме создания) | Вынести лимиты схемы в общие константы, раздать их `NumberField` (`:276-289`) и `Input`/`Textarea`; читать `details` через `apiErrorMessage` и подсвечивать поле, переключая вкладку |
| 2 | критично | `maintenance/work-order-form-dialog.tsx:316-330,290-355` + `app/api/equipment/[id]/maintenance/route.ts:20-37` | Моточасы принимают дробь (`type=number` без `step`), сервер требует `int` (`:27`); «Трудоч.»/«Стоимость» помечены `min={0}`, но это HTML-атрибут — в JS-обработчике минус проходит, сервер `min 0` (`:28,32`) отклоняет. Название/описания без `maxLength` (сервер 200/2000/2000/4000, `:23-36`) | Механик закрывает наряд, вписывает «12 345.5» моточасов (типично — счётчик показывает дробное) → 400 «Некорректные данные» (`maintenance-helpers.ts:51-52` отдаёт только `err.error`). Понять, что не так именно с моточасами, неоткуда | `step="1"` и проверка целостности у моточасов, `min={0}`-проверка до отправки; `maxLength` по схеме; `details` — в тост/под поле |
| 3 | критично | `inspections/template-editor.tsx:236-244` + `inspections/template-editor-parts.tsx:101-158` + `app/api/checklist-templates/route.ts:16-41` | Ни у названия шаблона, ни у текста пункта (`≤500`), нормы (`≤300`), источника (`≤120`), ед. изм. (`≤40`) нет `maxLength`; проверка перед отправкой только на «не пусто» (`template-editor.tsx:119-126`) | Шаблон ЕО — это десятки пунктов на длинной странице. Длинный пункт (> 500) отклонён 400, а `submit` показывает только `err.error` («Некорректные данные», `:161-163`) — какой из пунктов, не видно, прокрутка вручную | Проставить `maxLength`/счётчики (`CountedField` уже есть) и называть пункт в сообщении («Раздел 3, пункт 5») |
| 4 | критично | `admin-reports/report-form-dialog.tsx:417-418,421` + `lib/validation-schemas.ts:280-282` | Часы простоя: клиент `min 0.5`, сервер `0..DOWNTIME_MAX_HOURS` (=24, `lib/downtime-hours.ts:39`). Комментарий простоя без `maxLength` (сервер ≤1000). Строк свай/бурения сервер ≤100, простоя ≤50 — клиент без счётчика | Админ правит отчёт за сутки и ставит простой «30» ч (24 ч — редкая граница, её нигде не видно) → 400. `details` в форме читаются (`:231`), но поле не подсвечивается — текст «Простой, строка 1: длительность…» уходит в тост и исчезает | Показать предел «не больше 24 ч» рядом с полем, ограничить ввод; подсветить поле по `details` |
| 5 | важно | `admin-users/user-dialogs.tsx:117-154` + `lib/validation-schemas.ts:38-52` | Имя/Email/Телефон/Пароль без `maxLength`; сервер: имя ≤200, email ≤255, телефон ≤30, пароль ≤100. Клиентский email-regex (`:80,217`) ≠ zod `.email()` (`:39`) | Админ создаёт пользователя с длинным «служебным» email (> 255) или паролем-фразой (> 100) → 400 «Некорректные данные» (форма читает только `err.message`, `:101`). Набор строк, проходящих regex клиента и заваливающих `.email()`, тоже непустой | `maxLength` по схеме; заменить клиентский regex на общую функцию (та же, что в zod) |
| 6 | важно | `admin-sites/site-editor/create-site-dialog.tsx:82-88`; `edit-site-dialog.tsx:195-200` + `lib/validation-schemas.ts:68,103` | «Название объекта» без `maxLength` (сервер ≤200). В создании имя не проверяется и на длину — только «не пусто» (`:50-53`) | Длинное название (копипаст из письма/договора) → 400 при создании/сохранении. `use-site-mutations.ts:108,168` показывают `details`-текст, но поле не подсвечивается | `maxLength={200}` + счётчик рядом |
| 7 | важно | `admin-sites/site-editor/drilling-plan-section.tsx:42-51` + `lib/validation-schemas.ts:86` | Диаметр бурения: `min 0`, без `max`; сервер `0..999`. Клиент фильтрует строки только по `count > 0` (`use-site-mutations.ts:94,140`), диаметр не проверяет | Админ вводит «⌀ 1200» (опечатка) — строка уходит на сервер и 400; в списке строк невозможно понять, что именно диаметр вне диапазона | `max={999}` и подсказка «⌀ до 999 мм» |
| 8 | важно | `admin-crews/crew-form-dialog.tsx:291-296` + `lib/validation-schemas.ts:207,218` | «Название» бригады без `maxLength` (сервер ≤200); остальное клиент проверяет (`:154-165`) | Длинное имя бригады → 400; `crew-messages.ts:35` показывает `details`, но поле не подсвечивается. Минимум (непусто) клиент проверяет, максимум — нет | `maxLength={200}` |
| 9 | важно | `admin-users/user-document-types-dialog.tsx:40-43,158-169` + `app/api/user-document-types/schema.ts:12-14` | «Название» без `maxLength` (сервер ≤200). «Срок, мес.»: клиент шлёт `months ? Number(months) : null` (`:41`), поэтому «0» уходит как `0`, а сервер требует `int ≥ 1` (`:14`); HTML `min={1}` не блокирует отправку | Админ пишет «0» в срок (или сбрасывает в 0) → 400 «Некорректные данные» на создании/правке строки; текст не называет поле | `maxLength`; трактовать «0»/neg как пусто либо запретить до отправки |
| 10 | важно | `admin-users/user-documents.tsx:296-312` + `app/api/users/[id]/documents/route.ts:13-20` | «Номер» без `maxLength` (сервер ≤100), «Примечание» без `maxLength` (сервер ≤2000). Форма читает только `err.error` (`:181`) | Удостоверение с длинным номером/примечанием → 400 «Некорректные данные»; какое поле, не сказано | `maxLength` по схеме + показ `details` |
| 11 | важно | `admin-equipment/detail/equipment-documents.tsx:249-285` + `app/api/equipment/[id]/documents/route.ts:18-29` | «Название» документа без `maxLength` (сервер ≤200), «Заметки» без (≤2000). Форма читает только `err.error` (`:134`) | Название «Полис ОСАГО АО Альфа, серия…» с копипастом > 200 → 400; админ правит наугад | `maxLength` + показ `details` |
| 12 | важно | `to/readiness/forms/permit-form.tsx:381-390` + `to/readiness/forms/form-kit.tsx:196-291` + `modules/readiness/application/permits/schemas.ts:11` | «Опасные факторы» (`ChipList`) — без предела по числу и длине; сервер: массив ≤20, каждый ≤120 символов. Клиент разрешает добавлять сколько угодно и любой длины | Диспетчер добавляет 21-й фактор или длинную формулировку → 422/400; `commandFailure` (`screens/shared.tsx`) показывает только `error.message` — «Некорректные данные наряда», поле не названо | Ограничить `ChipList` (20 чипсов, ≤120 символов) и сказать об этом у поля |
| 13 | важно | `to/readiness/screens/briefing-conduct-dialog.tsx:127-131` + `app/api/briefings/route.ts:12-20` | «Основание» (reason) без `maxLength` (сервер ≤500). Диалог показывает `body.error` (`:72-73`) | Длинное основание (> 500) → 400; человек видит текст сервера, но не понимает, что причина — длина поля | `maxLength={500}` + счётчик |
| 14 | важно | `admin-sites/site-editor/add-hierarchy-dialog.tsx:61-70` + `lib/validation-schemas.ts:119,419` | «Название» пикета/куста/поля без `maxLength` (сервер ≤200). Форма проверяет только «не пусто» (`:37`) | Длинное название узла → 400; в `use-site-mutations.ts:287` показывается текст с `details`, поле не подсвечивается | `maxLength={200}` |
| 15 | важно | `inspections/start-inspection-form.tsx:329-332` + `app/api/inspections/route.ts:13-31` | Моточасы: `type=number` без `step`, сервер `.int() ≥ 0` (`:18,26`) | Механик вписывает показание счётчика «5701.5» → 400; форма не объясняет, что нужен целый | `step={1}` + проверка целостности до отправки |
| 16 | мелочь | `maintenance/maintenance-request-form.tsx:31-32,181-200` + `app/api/equipment/[id]/maintenance/route.ts:23-24` | Клиент ограничивает «Краткое описание» 100 (сервер 200) и «Подробное» 500 (сервер 2000) — клиент строже сервера | Пользователь не может вписать допустимое сервером описание; на ходу кажется, что больше нельзя (нет счётчика рядом визуально — только `CharCount`) | Либо расширить лимит клиента до серверного, либо явно подписать, что предел — 500 |
| 17 | мелочь | `to/readiness/forms/permit-form.tsx:187,339-345` + `modules/readiness/application/permits/schemas.ts:10` | Клиент требует «Место работы» ≥ 2 символов, сервер `place` — без минимума (`max 200`) | Клиент строже: короткое место не заведёт наряд, хотя сервер бы принял. Не потеря данных, но форма блокирует раньше сервера без объяснения | Оставить, но сказать у поля «минимум 2 символа» |
| 18 | мелочь | `to/readiness/forms/permit-form.tsx:21-23,377-380` + `modules/readiness/application/permits/schemas.ts:9` | «Описание работ» ограничено клиентом 300 символов, сервер допускает 4000. В коде это осознанно (`:21-23`) | Диспетчер не может вписать состав работ > 300, хотя сервер принял бы — расхождение в сторону клиента | Либо поднять лимит до серверного, либо оставить как решение владельца (тогда — пометка в отчёте, не в коде) |
| 19 | мелочь | `admin-users/user-dialogs.tsx:80,217` + `lib/validation-schemas.ts:39` | Email-проверка клиента (`/\S+@\S+\.\S+/`) не совпадает с zod `.email()` — разные наборы принимаемых строк | Адрес, проходящий клиентский regex, может не пройти сервер (и наоборот) → лишний 400 «Некорректные данные» без подсказки | Единая функция проверки email на клиенте и сервере |
| 20 | повтор R103 | `admin-dictionaries/dictionary-form.tsx:13-14,44,69,79` + `app/api/dictionary/manage/route.ts:19,21` | Лимиты формы справочника теперь совпадают с сервером (название 100, длина ≤1 000 000 мм). **Закрыто коммитом `52c27d5d` (F-R103-TOP, №6)** | — (для полноты; R103 №6 описывал отправку заведомо отклоняемого запроса) | Ничего; оставлено как проверенное соответствие |
| 21 | мелочь (проверено, дефекта нет) | `admin-sites/use-site-mutations.ts:85,94,139-140` + `lib/validation-schemas.ts:82,87` | `count ≥ 1` на сервере при `min 0` в поле — не дефект: клиент отбрасывает строки плана с `count = 0` до отправки; пустая строка плана не уходит | — | Ничего; важно не «починить» `min 0` без учёта фильтра |

Сводка: критично 4 (№1–4), важно 11 (№5–15), мелочь 5 (№16–20), проверено/повтор 1 (№21).

## Не проверено

- **Живой прогон.** Аудит read-only: сервер не поднимался, браузер и Playwright не запускались, тесты форм не гонялись. Все исходы («человек видит 400 и тост») — вывод из разметки и ветвлений, а не из наблюдения. Правок кода нет, поэтому регрессионный тест не писался; при исправлении — узкая правка существующего теста по правилу `pilingtrack-testing-and-evidence`.
- **Точные значения HTML-валидации.** Утверждение «`min={0}` на `<input type="number">` не блокирует JS-отправку» — из чтения кода (нет `<form onSubmit>`, кнопка зовёт обработчик напрямую); в браузере не воспроизводил.
- **Полнота схем.** `src/lib/validation-schemas.ts` прочитан целиком; локальные схемы — те, что перечислены в «Методике». Схемы `layout`, `settings`, `monitoring`, `feedback`, `telemetry`, `safety`, `pile-passports`, `maintenance-plans` на расхождение с их формами не разбирал (в область «формы админки» они не попали либо не имеют полей с клиентскими ограничениями).
- **Формы вне глобов/замороженные.** `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION — не читались (вне области). Формы в `src/components/piling/report-form/**` (экран машиниста) не разбирались.
- **`details` на сервере.** Формат `details` у части маршрутов — `{field,message}` (`maintenance`, `user-documents`), у части — zod-`fieldErrors` (`reports/admin-upsert`, `dictionary/manage`); `apiErrorMessage` понимает оба, но конкретный текст на реальном откате я не воспроизводил.
- **`maintenance-request-form` лимиты.** `CharCount` показывает предел, но визуально ли он читается рядом с полем — не проверял.
- **Проверки §6 (tsc/тесты).** Команд в этой сессии: `npx tsc --noEmit -p tsconfig.json` — exit 0. Тесты не запускались: правок кода нет, затронутых тестов нет. `npm run lint`, `npm run test:unit`, `npx playwright test --list`, `npm run build` не гонялись (задача — только документ; сборка требует env/БД).
- **GitNexus `impact`.** Не запускался: ни один символ не редактировался (создан только текстовый отчёт), анализ влияния неприменим.