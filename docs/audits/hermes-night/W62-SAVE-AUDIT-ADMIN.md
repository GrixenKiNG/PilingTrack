# W62-SAVE-AUDIT-ADMIN: что в админке не сохраняется

Аудит от 07.10.2026, ветка `hermes/q4-0926`, только чтение. Задача владельца:
«все вкладки, подвкладки, меню — всё должно проставиться, записаться,
сохраниться; цифры и буквы должны отображаться и сохраняться везде».

## Итог

- Проверено вкладок: 9 (установки, объекты, бригады, пользователи,
  справочники, ТО-планы, инструктажи/чек-листы, происшествия, настройки:
  Telegram / пороги / роли). Проверено полей формы: ~120.
- Потеря или молчаливое искажение ввода: **10 находок**.
  - **критично: 0**
  - **важно: 3** (телефон обрезается молча; «Примечание» марки сваи не
    отображается и не редактируется после создания; марку длиной ровно
    1000,00 м нельзя сохранить из панели сведений)
  - **мелочь: 7**
- Топ-5:
  1. Пользователи: телефон длиннее 20 знаков молча обрезается
     (`user-service.ts:168,227`), хотя форма и zod разрешают 30.
  2. Справочники: поле «Примечание» (notes) пишется в БД при создании, но
     нигде не показывается и в PATCH-схеме его нет — правка невозможна.
  3. Справочники: длина марки ровно 1000,00 м форматируется с пробелом
     («1 000,00»), `Number(...)` даёт NaN и **любое** сохранение панели
     отбивается тостом «Введите положительную длину».
  4. ТО-планы: смена «по моточасам» → «по календарю» оставляет в БД прежний
     `intervalHours` (второй интервал не очищается).
  5. Telegram: после «Редактировать» в строке списка пропадает хвост токена
     («••••»), виден только после перезагрузки.

Обратное (поле в схеме, но маршрут его не пишет) найдено один раз —
`description`/`status` объекта; см. находку 4.

## Методика

Прослеживал каждое редактируемое поле по цепочке
`поле формы → состояние → тело запроса → zod-схема маршрута → сервис →
запись в БД (prisma/schema.prisma) → ответ → поле после перечитывания`.

Что читал (не grep по памяти, а открывал файлы):

- Компоненты: `src/components/piling/admin-sites/**`, `admin-crews/**`,
  `admin-users/**`, `admin-dictionaries*`, `admin-equipment/**`,
  `admin-telegram.tsx`, `workspace-settings.tsx`, `maintenance/**`,
  `inspections/**`, `to/**` (fuel/meter/maintenance-plans/readiness-settings).
- Маршруты: `src/app/api/{settings,dictionary/manage,equipment,sites,crews,
  users,user-document-types,user-documents,checklist-templates,
  maintenance-plans,briefings,admin/incidents,telegram/configs,layout}/**`.
- Схемы: `src/lib/validation-schemas.ts` (целиком), схемы в самих маршрутах.
- Сервисы: `services/users/user-service.ts`, `services/dictionaries/
  dictionary-service.ts`, `services/telegram/telegram-config-service.ts`,
  `modules/crews|equipment|inspections|sites|readiness|settings`.
- Примитивы: `prisma/schema.prisma` (модели Equipment, EquipmentDocument,
  MaintenancePlan, Crew, User).

Точечные текстовые поиски (перезапускаемо):

```bash
grep -rn "formStateToPayload\|toPayload\|buildPayload" src
grep -rn "\.slice(0, [0-9]" src/services src/modules --include=*.ts | grep -v test
grep -rn "export const patchSchema\|createSchema" src/app/api/dictionary/manage/route.ts
grep -rn "Number(" src/components/piling/{to,admin-*,maintenance,inspections} --include=*.tsx
grep -rn "assistantNames\|assistantsCount" src/lib/validation-schemas.ts
```

Отдельно подтверждал числовую границу через node (правило «не гадать»):

```bash
node -e "const s=(1000000/1000).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}); console.log(JSON.stringify(s), Number(s.replace(',','.')))"
# → "1 000,00" NaN
```

Охват по «здоровым» вкладкам (проверено, потерь не найдено): бригады
(все поля формы доходят до `crew-command.service`), установки — форма
`EquipmentForm` → `formStateToPayload` → `equipmentMetadataSchema` →
whitelist `METADATA_KEYS` (27 из 27 полей совпадают), происшествия
(`admin/incidents` POST пишет `reviewNote`), роли/пороги —
`sanitizeAccessMatrix` и `sanitizeRuleSet` отбрасывают только чужие ключи,
а не поля формы.

## Находки

Легенда severity: критично / важно / мелочь.

| # | severity | вкладка · поле | где теряется (path:line) | что увидит человек · почему важно | предлагаемая правка |
|---|----------|----------------|--------------------------|-----------------------------------|---------------------|
| 1 | важно | Пользователи · Телефон | `src/services/users/user-service.ts:168` (create), `:227` (update) — `trim().slice(0, 20)` | Форма (`admin-users/user-dialogs.tsx:59`, `USER_FIELD_MAX.phone = 30`) и схема (`validation-schemas.ts:42`, `.max(30)`) разрешают 30 знаков. Введённый номер длиной 21–30 (напр. «+7 (999) 123-45-67 доб. 1234») сохраняется обрезанным, тост — «Пользователь обновлён». Склейка молчаливая, длина нигде не заявлена. | Поднять `slice` до 30 (или убрать вовсе) либо сузить схему и форму до 20 и показать счётчик. |
| 2 | важно | Справочники · Примечание марки сваи | форма `admin-dictionaries/dictionary-form.tsx:55,94-97`; запись `services/dictionaries/dictionary-service.ts:106`; PATCH-схема `app/api/dictionary/manage/route.ts:34-59` (нет `notes`) | При создании марки примечание сохраняется, но ни в таблице (`dictionary-table.tsx`), ни в панели сведений (`admin-dictionaries.tsx`) оно не выводится, а PATCH его не принимает. Поле write-only: после закрытия диалога значение недостижимо — «буквы» введены, но не отображаются и не правятся. | Либо показывать и принимать `notes` в панели (добавить в `patchSchema` + `updateDictionaryItem`), либо убрать поле из формы создания. |
| 3 | важно | Справочники · Длина, м (панель сведений) | `src/components/piling/admin-dictionaries.tsx:225-226` (formatMetres), `:255-266` (savePanel) | Для марки ровно 1000,00 м поле засевается как «1 000,00» (ru-RU с пробелом-разделителем). `Number("1 000,00".replace(',','.'))` = NaN → ветка `!Number.isFinite` → тост «Введите положительную длину в метрах» и возврат **до** отправки. Блокируется любое сохранение — даже смена только названия или сечения. (Подтверждено node, см. Методику.) | Разбирать число как `Number(text.replace(/\s/g,'').replace(',','.'))` или брать длину из исходного `selectedItem.lengthMm`, когда поле не менялось. |
| 4 | мелочь | Объекты · Описание / Статус | схема `src/lib/validation-schemas.ts:78-79`; маршрут `src/app/api/sites/[id]/route.ts:63-94` | `updateSiteSchema` принимает `description` и `status`, но PUT не передаёт их ни в `updateSiteWithPlans`, ни в `updateSite` — запрос вернёт 200 без изменений. Формы этих полей сейчас нет, поэтому урон невиден, но любой клиент/будущая форма получат «сохранено» впустую. | Убрать поля из схемы до появления поддержки, либо дописать их запись в сервисе. |
| 5 | мелочь | ТО-планы · «Чем меряется» (моточасы/календарь) | `src/modules/equipment/application/commands/maintenance-plan.ts:96-97`; панель `src/components/piling/to/maintenance-plans-panel.tsx:122-127` | Форма при смене триггера шлёт только один интервал (`intervalHours` ИЛИ `intervalDays`). Сервис пишет только присланное — второй столбец остаётся со старым значением. При обратном переключении всплывает давно забытое число. Расчёт (`evaluatePlanDue`) берёт значение по `triggerType`, поэтому «работает», но данные в БД противоречивы. | При смене `triggerType` обнулять неиспользуемый интервал (`intervalHours: null`/`intervalDays: null`). |
| 6 | мелочь | Настройки · Telegram · Токен бота | `src/services/telegram/telegram-config-service.ts:61-70` (`toView` → `botTokenHint: ''`); экран `src/components/piling/admin-telegram.tsx:193-200,343-346` | После «Редактировать» ответ кладётся в список напрямую (`setConfigs(map(data.config))`), а `toView` отдаёт пустой `botTokenHint` → строка показывает «Токен: ••••» без последних 4 знаков, чем до перезагрузки. Человек думает, что токен испортился. | После правки перечитывать список (`loadData()`) либо брать `botTokenHint` из прежней записи. |
| 7 | мелочь | Установки · Топливо · «Залито, л» | схема `src/app/api/equipment/[id]/fuel/route.ts:33` (`z.coerce.number().int()`); форма `src/components/piling/to/fuel-panel.tsx:190-197` | Форма не запрещает дробное число, схема требует целое. Ввод «12.5 л» даёт 400 «Некорректные данные» без имени поля — человек не понимает, что именно не так. | Разрешить `number().min(0)` (доли литра реальны) либо поставить `step={1}` и пояснить «целое». |
| 8 | мелочь | Инструктажи · Основание | схема `src/app/api/briefings/route.ts:22` (`reason.max(500)`); поле `src/components/piling/to/readiness/screens/briefing-conduct-dialog.tsx:129-130` (без `maxLength`) | Длинное основание (>500 знаков) вернёт 400 «Некорректные данные» без указания поля. То же — «Примечание» в топливе и моточасах (`*.max(500)` при `Input` без `maxLength`). | Проставить `maxLength={500}` или предупреждать до отправки. |
| 9 | мелочь | Настройки · Название компании | `src/modules/settings/domain/settings.ts:99,128` (`str(..., 200, base)`); поле `src/components/piling/workspace-settings.tsx:249` (без `maxLength`) | Строка длиннее 200 знаков не обрезается, а подменяется прежним значением; тост при этом «Настройки сохранены». Поле возвращается к старому тексту — выглядит как «не сохранилось». | Усечь до 200 или показать ошибку; на поле — `maxLength={200}`. |
| 10 | мелочь | Справочники · Код марки | `src/services/dictionaries/dictionary-service.ts:103` (пишется при create); PATCH-схема `src/app/api/dictionary/manage/route.ts:34-59` (нет `code`) | Код задаётся только при создании, после — не изменить (в отличие от сечения, у которого есть `setPileGradeSection`). В таблице показывается `sectionOrDiameter || code`, так что «неверный код» виден, но исправить нечем. | Добавить `code` в `patchSchema` и обновлять в сервисе, либо не показывать его как редактируемый по смыслу. |

## Не проверено

- **Шаблоны плиток и раскладки** (`/admin/settings` → «Шаблоны плиток»,
  `/api/layout/[surfaceId]`, редакторы `analytics-dashboard/kpi-widgets`,
  `main-dashboard/dashboard-layout`, `monitoring/equipment-tile-template-settings`):
  валидатор поверхности (`modules/layout/domain/page-layout-template.ts:49-72`)
  отбивает шаблон целиком (400 без имени поля), если хоть один id плитки вне
  каталога или `settings` сериализуется длиннее 4000 знаков. Отдельно не
  проверил, что именно видит администратор в редакторе в этот момент и не
  теряются ли несохранённые правки — нужен прогон UI.
- **Инструкции и регламенты** (`SAFETY_INSTRUCTIONS`) — тексты живут в коде; в
  рамках read-only это ожидаемо, редактирования нет, поэтому в цепочку не
  входят.
- **Журнал доставки / DLQ** (`admin-dlq.tsx`, `/api/admin/dlq`) — операционный
  экран, форм редактирования полей нет, поле-в-полях не отслеживал.
- **Массовые операции справочников** (`setStatusBulk`): каждый элемент шлётся
  отдельным PATCH; агрегированный отказ показывается счётчиком «Не удалось
  изменить статус: N» без имён — это осознанный компромисс, но какое именно
  значение не сохранилось, из экрана не видно (проверял чтением, поведение
  подтверждено; правкой не занимаюсь).
- **Установки: числовые поля формы.** Теоретический `Number('1,5')` → NaN →
  `JSON.stringify` → `null` (молчаливая очистка) для полей
  `EquipmentForm`/`formStateToPayload` не воспроизведён: поля объявлены
  `type="number"`, браузер не отдаёт запятую через `e.target.value`. Не
  проверено в браузере — утверждать не берусь.
- **Печатные формы и PDF** — вне цепочки «форма → БД», не проверял.
