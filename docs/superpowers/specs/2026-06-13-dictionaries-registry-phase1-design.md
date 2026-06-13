# Справочники → административный реестр (Фаза 1) — дизайн

**Дата:** 2026-06-13
**Статус:** утверждён к реализации
**Скоуп:** Фаза 1 (реестр + безопасность удаления). Drawer «где именно используется» — Фаза 2 (отдельный спек).

## Проблема

Текущий модуль «Справочники» (`src/components/piling/admin-dictionaries.tsx`) — три карточки со списками. Кнопка «удалить» вызывает soft-delete (`isActive:false`), но подаётся как «Элемент удалён» и не показывает, что значение уже связано с отчётами. Итог: слишком легко «удалить» марку/тип/причину, которая используется в истории, не понимая последствий. Архивные значения не видны и не восстановимы.

## Цель

Превратить модуль в управляемый реестр: вкладки, поиск, фильтр по статусу, таблица со статусом и счётчиком использования; архив по умолчанию; физическое удаление — только для неиспользуемых значений; восстановление из архива; переименование.

## Справочники и связи (существующая схема)

Три типа, каждый с `id, name, isActive, createdAt, updatedAt`:

| Тип (`type`) | Модель | Ссылки из отчётов | Доп. ссылка |
|---|---|---|---|
| `pileGrade` | `PileGrade` | `PileWork.pileGradeId` (FK Restrict) | `SitePilePlan.pileGradeId` (FK Cascade) |
| `drillingType` | `DrillingType` | `LeaderDrilling.typeId` (FK Restrict) | — |
| `downtimeReason` | `DowntimeReason` | `ReportDowntime.reasonId` (FK Restrict) | — |

«Используется» = `reportCount` (DISTINCT `reportId` по соответствующей строковой таблице) **плюс** `planCount` (только `pileGrade`: число `SitePilePlan`).

## Правила поведения

- **Архивировать** (по умолчанию вместо удаления): `isActive = false`. Значение исчезает из активных списков, в отчётах остаётся валидным.
- **Восстановить:** `isActive = true`.
- **Удалить (физически):** разрешено **только если `reportCount === 0 && planCount === 0`**. Иначе сервис возвращает `409`, а в UI кнопка заблокирована. (Защита в сервисе — defense in depth, не только в UI.)
- **Переименовать:** разрешено всегда (активный/архивный, используется или нет) — отчёты ссылаются по `id`, имя — только подпись, история не ломается.
- Счётчик использования считается **батчем** (`GROUP BY`) только для админ-реестра. Горячий путь операторов `GET /api/dictionary/all` (`listActiveDictionaries`) **не трогаем**.

## Бэкенд

### Сервис `src/services/dictionaries/dictionary-service.ts`

- `listDictionaries(filter: 'active' | 'archived' | 'all')` — три типа, отфильтрованы по `isActive`. (Существующий `listActiveDictionaries` остаётся для операторского пути без изменений.)
- `getDictionaryUsage()` — батч сгруппированных счётчиков. Возвращает по каждому типу карту `id → { reportCount, planCount }`. Реализация: `groupBy` по `pileGradeId`/`typeId`/`reasonId` в `PileWork`/`LeaderDrilling`/`ReportDowntime` + `groupBy` по `pileGradeId` в `SitePilePlan`.
- `renameDictionaryItem(type, id, name)` — `update { name }` (валидация имени как в create: 1..100, trim).
- `archiveDictionaryItem(type, id)` — `update { isActive: false }`. (Текущая логика soft-delete, переименована из `deleteDictionaryItem`.)
- `restoreDictionaryItem(type, id)` — `update { isActive: true }`.
- `deleteDictionaryItem(type, id)` — **жёсткое** `delete`. Сначала считает использование; если `reportCount > 0 || planCount > 0` → `throw new ServiceError('Элемент используется и не может быть удалён', 409)`. Иначе `db.<model>.delete`.

Все функции бросают `ServiceError(404)` при отсутствии элемента и `ServiceError(400)` при невалидном `type`/`name` (как сейчас).

### Роуты `src/app/api/dictionary/manage/route.ts`

Все под `withMutation`/`withApi` + `assertCan(user, 'dictionary.manage')` (ADMIN-only).

- `GET ?filter=active|archived|all` (новый, `withApi`) — фид реестра: `{ pileGrades, drillingTypes, downtimeReasons }`, где каждый элемент = `{ id, name, isActive, updatedAt, reportCount, planCount }`. Объединяет `listDictionaries(filter)` + `getDictionaryUsage()`. Отдельный от `/api/dictionary/all`.
- `POST` (существующий) — создать. Без изменений.
- `PATCH` (новый) `{ type, id, name?, isActive? }` — переименование (`name`) и/или смена статуса (`isActive`). Валидация zod; хотя бы одно из `name`/`isActive` обязано присутствовать.
- `DELETE` (изменён) `{ type, id }` — жёсткое удаление. На `409` от сервиса `withMutation` отдаёт `{ error }` со статусом `409` (через `ServiceError`).

## Фронтенд `src/components/piling/admin-dictionaries.tsx` (пересборка)

- Грузит реестр из нового `GET /api/dictionary/manage?filter=<state>` (элементы + статус + `updatedAt` + счётчики).
- **Вкладки:** Сваи / Бурение / Простои (shadcn `Tabs`).
- **Тулбар:** поиск по названию (клиентская фильтрация), `Select` фильтра Активные/Архив/Все (перезагружает фид), кнопка «Добавить».
- **Таблица:** Название · Статус (бейдж Активен/Архив) · Используется · Обновлено (дата) · Действия.
- **Колонка «Используется»** (исключаем неоднозначность с планами): если `reportCount > 0` → «N отчётов»; иначе если `planCount > 0` → «N планов»; иначе «—». Удаление доступно только когда оба счётчика 0, поэтому «—» в колонке всегда означает «можно удалить».
- **Действия в строке:** `[Переименовать ✎]` · `[Архивировать]` (для активных) / `[Восстановить]` (для архивных) · `[Удалить 🗑]` (активна только если `reportCount===0 && planCount===0`, иначе серая с подсказкой «используется в N отчётах»/«в N планах»).
- **Диалоги:** добавление/переименование — переиспользуют существующий паттерн (`Input` + `Dialog`). Удаление — подтверждение «Удалить «X» навсегда? Необратимо».
- Тосты: «Элемент архивирован» / «восстановлен» / «удалён» / «переименован» (точные формулировки, не вводящие в заблуждение).

Макет утверждён (см. визуальный мокап в обсуждении 2026-06-13).

## Тесты

- **Сервис** (`dictionary-service` unit):
  - `getDictionaryUsage` считает `reportCount` (DISTINCT отчётов) и `planCount` для марок свай.
  - `deleteDictionaryItem` бросает `409` при `reportCount>0` и при `planCount>0`; удаляет при обоих `0`.
  - `archive`/`restore` ставят `isActive` false/true; `rename` меняет имя; `404` для несуществующего.
- **Роуты** (`dictionary/manage` route):
  - `GET` фид: `403` для не-ADMIN; возвращает элементы со счётчиками; уважает `filter`.
  - `PATCH`: переименование и архив/восстановление; `400` без `name`/`isActive`.
  - `DELETE`: `200` при 0 использований, `409` при использовании; `403` для не-ADMIN.

## Вне скоупа (Фаза 2)

- Drawer справа со списком *конкретных* отчётов/объектов, где используется значение, с переходами.
- Кликабельный счётчик «N отчётов» открывает этот drawer.

## Затрагиваемые файлы

- `src/services/dictionaries/dictionary-service.ts` (расширение)
- `src/app/api/dictionary/manage/route.ts` (GET + PATCH + изменённый DELETE)
- `src/components/piling/admin-dictionaries.tsx` (пересборка)
- `src/lib/validation-schemas.ts` (схемы PATCH/usage при необходимости)
- Новые тесты: `src/services/dictionaries/__tests__/`, `src/app/api/dictionary/manage/__tests__/`
