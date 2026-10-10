# AU162-S3-PHOTO-CAPTURE-FLOW: Фото в осмотрах и отчётах — обязательность и сбои

Ревью HEAD: `ab2778156d3ef9754553e29bf9deaa9120a31b2e` (ветка `hermes/q4-0926`).
Режим: только чтение, код приложения не менялся. Создан один файл — этот отчёт.

## Итог

- Проверено: где фото обязательно (осмотр ЕО/ТО, чек-лист машиниста), как считается
  факт наличия фото на сервере, что происходит при обрыве связи и отказе загрузки.
- Всего находок: 26. По важности: критично — 0, важно — 6, мелочь — 20.
- Топ-5:
  1. `src/components/piling/report-form/photo-section.tsx:35-38` — сбой чтения
     галереи фото отчёта молча превращается в «Фото не прикреплено» (нет состояния
     ошибки). Братские виджеты этот класс уже закрыли, этот — нет.
  2. `src/components/piling/operator-mobile/offline-queue.ts:22` — снимки **не
     попадают** в офлайн-очередь: при обрыве связи фото просто теряется, повтор
     только вручную, хотя текст на экране у «шага снимка» обещает обработку.
  3. `src/components/piling/inspections/run-inspection.tsx:288` — полоса разделов
     считает «осталось» по `photoRequired` без учёта уровня осмотра, тогда как
     сервер (`inspection-commands.ts:365`) для ЕО блокирует только фото при
     неисправности. Комментарий на строке 281 утверждает обратное («правило то же,
     что на сервере»).
  4. `src/core/media/media-auth.ts:63-68` — для `equipment_defect`/`safety_incident`
     нет проверки организации и владельца: достаточно совпадения с шаблоном id.
  5. Сжатия фото на клиенте нет нигде: полноразмерный файл (до 10 МБ) уходит в R2
     напрямую, сервер делает только миниатюру 400 px уже после загрузки.

## Методика

Что искалось и как (воспроизводимо):

- Точки входа по ключевым словам:
  `rg -li "photo|фото|attachment|upload" src`, `rg -n "photoRequired|requirePhoto|требу.*фото" src e2e tests`.
- Контракт обязательности на сервере: `src/modules/inspections/**`,
  `src/modules/operator-mobile/**` (правило + проверка).
- Транспорт медиа: `src/core/media/**`, `src/app/api/media/**`.
- Офлайн/повтор: `rg -n "navigator.onLine|indexedDB|offline|queue|outbox" src`,
  файлы `src/components/piling/operator-mobile/offline-queue.ts` и `.../api.ts`.
- Провайдеры сжатия: `rg -n "compress|toBlob|canvas|createImageBitmap|drawImage|quality:|resize" src` —
  клиентского сжатия не найдено, только серверный `sharp` в `media-service.ts`.
- Тесты: `node node_modules/vitest/vitest.mjs run <директории>` (см. числа ниже).
- Каждая цитата — это строка, открытая напрямую (`read_file` / `sed -n`), полный путь от корня.

Числа из команд (реальные, не оценка):

- `node node_modules/vitest/vitest.mjs run src/core/media/__tests__ src/components/piling/report-form/__tests__/photo-section.test.tsx src/modules/inspections/domain/__tests__/inspection-logic.test.ts src/components/piling/operator-mobile/offline-queue.test.ts`
  → **9 файлов, 97 тестов — все passed** (exit 0).
- `node node_modules/vitest/vitest.mjs run src/modules/inspections/application/commands/__tests__ src/modules/operator-mobile src/components/piling/operator-mobile/screens/checklist-screen.test.tsx src/components/piling/inspections/__tests__`
  → **15 файлов, 223 теста — все passed** (exit 0).
- `rg -n "photo|фото" e2e/inspection-to-flow.spec.ts` → фото реально **не**
  загружается ни в одном e2e (совпадения только в тексте шага «+ замечание / фото»).

### Таблица: экран | файл:строка | поведение | тест | статус

| Экран | Файл:строка | Поведение | Тест | Статус |
| --- | --- | --- | --- | --- |
| Осмотр ЕО (сервер) | src/modules/inspections/application/commands/inspection-commands.ts:365 | Для `level === 'EO'` блокирует только неисправности без фото; для ТО/ремонта — все пункты с `photoRequired` | inspection-commands.test.ts (findMissing через domain) | ПРОЙДЕНО |
| Осмотр, правило | src/modules/inspections/domain/inspection-logic.ts:49-66 | `findMissing` отдаёт `missingPhotos` и `missingPhotosOnFault` раздельно | src/modules/inspections/domain/__tests__/inspection-logic.test.ts:66-80 | ПРОЙДЕНО |
| Осмотр, подсчёт факта | src/modules/inspections/application/commands/inspection-commands.ts:240-263 | Фото считаются из `Media` по ключу `insId__itemId`; `photoCount` от клиента игнорируется | inspection-commands.test.ts:230-245 | ПРОЙДЕНО |
| Осмотр, галерея пункта | src/components/piling/inspections/inspection-item-photos.tsx:66-88 | Отказ чтения → отдельное состояние + «Повторить» (403/404/5xx) | inspection-messages.test.tsx | ПРОЙДЕНО |
| Осмотр, полоса разделов | src/components/piling/inspections/run-inspection.tsx:288 | «осталось» считает `photoRequired` без учёта ЕО/неисправности — строже сервера | НЕТ теста на это правило | ГИПОТЕЗА |
| Осмотр, подсказка | src/components/piling/inspections/run-inspection.tsx:522-524 | «Требуется фото» показывается на всех `photoRequired`, включая исправные пункты ЕО | НЕТ | ПРОЙДЕНО |
| Чек-лист машиниста — фото при неисправности | src/modules/operator-mobile/domain/checklist-run.ts:57-58 | Замечание/отказ при `photoOnIssue` без `mediaIds` → «Приложите фотографию» | checklist.test.ts | ПРОЙДЕНО |
| Чек-лист — серверная проверка | src/modules/operator-mobile/application/commands/shared.ts:343-374 | Снимок должен быть `completed`, `image/*`, своё `entityId` и своя организация | checklist.test.ts | ПРОЙДЕНО |
| Карточка снимка в чек-листе | src/components/piling/operator-mobile/screens/checklist-screen.tsx:443-470 | `capture="environment"` — только камера; ошибка показывается текстом | checklist-screen.test.tsx | ПРОЙДЕНО |
| Отчёт — фото | src/components/piling/report-form/photo-section.tsx:176-194 | Фото отчёта **необязательно**: нет ни клиентской, ни серверной проверки | report-form/__tests__/photo-section.test.tsx (только тексты) | ПРОЙДЕНО |
| Отчёт — сбой чтения галереи | src/components/piling/report-form/photo-section.tsx:35-38 | `!res.ok` → `setPhoto(null)` без ошибки: показывается «Фото не прикреплено» | НЕТ | ПРОЙДЕНО |
| Отчёт — загрузка | src/components/piling/report-form/photo-section.tsx:64-120 | presign → PUT в R2 → confirm; сжатия нет, лимит 10 МБ | photo-section.test.tsx (частично) | ПРОЙДЕНО |
| Наряд ТО — галерея | src/components/piling/maintenance/work-order-photos.tsx:55-67 | Отказ чтения → отдельное состояние + «Повторить» | maintenance-messages.test.tsx | ПРОЙДЕНО |
| Фото установки | src/components/piling/admin-equipment/detail/equipment-photos.tsx:57-59 | Отказ чтения молча → пустая галерея (тот же класс, что у отчёта) | equipment-photos.test.tsx | ПРОЙДЕНО |
| Дефект (механик) | src/components/piling/operator-v2/defect-sheet.tsx:120-127 | Фото к дефекту при создании не прикладывается, обещано «из карточки в журнале» | НЕТ | ГИПОТЕЗА |
| Происшествие | src/components/piling/operator-mobile/screens/incidents-tab.tsx:273 | Фото необязательно намеренно | incidents-tab.test.tsx | ПРОЙДЕНО |
| Офлайн | src/components/piling/operator-mobile/offline-queue.ts:22,67-69 | В очередь идут только `log-production`/`report-incident`/`correct-production`; **снимки — нет** | offline-queue.test.ts, offline-queue-storage.test.ts | ПРОЙДЕНО |
| Загрузка снимка (машинист) | src/components/piling/operator-mobile/api.ts:647-737 | Таймаут PUT 120 с, отдельные тексты на 403/413/5xx | operator-mobile/__tests__/api.test.ts | ПРОЙДЕНО |

## Находки

Severity: критично / важно / мелочь. «Сценарий» — почему это важно на практике.

### Важно

| # | Файл:строка | Проблема | Сценарий / почему важно | Рекомендованная правка |
| --- | --- | --- | --- | --- |
| 1 | src/components/piling/report-form/photo-section.tsx:35-38 | При `!res.ok` ставится `setPhoto(null)` и выходим; состояния ошибки нет | На экране отчёта при 500/403 фото выглядит как «не прикреплено», хотя оно есть. Класс F-R100 №8 уже закрыт в `inspection-item-photos.tsx:51-53,71-73` и `work-order-photos.tsx:55,63-67` — здесь остался | Добавить `loadError` и отдельный текст с «Повторить», как у соседей |
| 2 | src/components/piling/operator-mobile/offline-queue.ts:22 | «снимки в неё не попадают» — фото вне офлайн-очереди | В поле связь рвётся: снимок неисправности не уходит, очередь его не хранит, повтор только вручную. Это ровно тот случай, ради которого очередь и вводили (см. комментарий там же) | Решить явно: либо очередь для файла (IndexedDB), либо честный текст «снимок нужно повторить вручную» |
| 3 | src/components/piling/inspections/run-inspection.tsx:288 | Полоса разделов считает `photoRequired` безусловно | Для ЕО сервер не блокирует исправный пункт без фото, а экран показывает «осталось N» и «Требуется фото» (стр. 523) — механик ищет несуществующий блокер либо идёт снимать лишнее | Считать по уровню: для ЕО — только неисправные пункты, как в `findMissing`/`inspection-commands.ts:365` |
| 4 | src/core/media/media-auth.ts:63-68 | Для `equipment_defect`/`safety_incident` только regex по `entityId` | Нет сверки организации и владельца. Пока один тенант — не эксплуатируется; перед тенантом №2 это путь выдать presigned URL на чужой объект (при знании/подборе id) | Добавить проверку `tenantId` актора (как в ветках `maintenance`/`inspection`) |
| 5 | src/components/piling/report-form/photo-section.tsx:64-120, src/components/piling/operator-mobile/api.ts:647-737 | Клиентского сжатия нет: полноразмерный файл (до 10 МБ) в R2 | На мобильной сети фото телефона уходит десятки секунд; именно поэтому очередь машиниста ставит таймаут 120 с (`api.ts:285`). Сервер сжимает уже после (`media-service.ts:274-303`, миниатюра 400 px) | Решить, нужен ли пред-upload resize/quality на клиенте; это самый дешёвый способ не рвать загрузку |
| 6 | src/components/piling/admin-equipment/detail/equipment-photos.tsx:57-59 | Отказ чтения → `setPhotos([])` без ошибки | Админ видит «Загрузить первое фото» на установке, где фото есть. Тот же класс, что №1 | Тот же фикс, что №1 |

### Мелочь

| # | Файл:строка | Проблема | Сценарий / почему важно | Рекомендованная правка |
| --- | --- | --- | --- | --- |
| 7 | src/components/piling/inspections/run-inspection.tsx:281 | Комментарий «правило то же, что на сервере» неверен (см. №3) | Вводит в заблуждение следующего читателя | Обновить комментарий |
| 8 | src/components/piling/report-form/photo-section.tsx:41 | Берётся `list[0]` — показывается только новейшее фото | Если к отчёту когда-либо прикрепится второе фото, оно не отобразится | Либо галерея, либо явный комментарий «одно фото на отчёт» |
| 9 | src/components/piling/report-form/photo-section.tsx:196-202 | Нет атрибута `capture` (осознанно, есть комментарий) | На iOS/Android откроется полный выбор, а не камера — для «снять сломанное» лишний шаг | Оставить, но зафиксировать решением владельца |
| 10 | src/components/piling/operator-mobile/screens/checklist-screen.tsx:449 | `capture="environment"` — только камера | Нельзя приложить уже снятое фото; расхождение с подходом `photo-section` | Согласовать поведение между экранами |
| 11 | src/components/piling/inspections/inspection-item-photos.tsx:238-242 | Если `thumbUrl === null`, рендерится `div` с иконкой — не кликабельно | Фото есть, но открыть его нельзя и объяснения нет | Сделать плитку кликабельной/показать текст |
| 12 | src/lib/media-thumbnails.ts:71-83 | При обрыве сети ссылки раздаются `null` и кэшируются на 50 мин | Миниатюры не появятся до истечения кэша даже когда связь вернулась | Не кэшировать `null` так долго (или инвалидировать по `online`) |
| 13 | src/core/media/media-service.ts:338-340 | `if (media.tenantId) { // In production: verify … }` — пустая проверка | Мёртвый «на вид» код; реальная защита в роут-слое (`assertCanAccessMedia`) | Удалить заглушку или реализовать (не молча) |
| 14 | src/core/media/media-service.ts:298-302 | Сбой `sharp` → лог-warn, запись помечается `completed`, `thumbnailKey=null` | Фото без миниатюры; экран покажет иконку (см. №11) | Отдавать признак «без миниатюры» в ответ, чтобы UI сказал словами |
| 15 | src/core/media/media-service.ts:242-245 | `!fetched.Body` → статус `failed` + 422 | Это финально: повтор confirm того же id даст 422, а не retry | Сверить с задумкой «пустой файл = переснять» (кажется, так и надо) |
| 16 | src/core/media/media-auth.ts:48-58 | Для `report` незаперсённый (draft) id разрешён | Осознанно (комментарий 20-29): возможен «осиротевший» Media-объект, чистится retention | Оставить; проверить, что retention реально запускается (в этом аудите — нет) |
| 17 | src/components/piling/report-form/use-report-form.ts:100-102 | `reportId` генерируется на клиенте заранее под фото до отправки отчёта | Если отчёт так и не сдадут — Media-объект останется сиротой (см. №16) | Оставить, зафиксировать как известный риск |
| 18 | src/modules/operator-mobile/application/commands/production.ts:366 | `mediaIds` паспорта сваи пишутся в JSON без серверной проверки, как у чек-листа | У пункта чек-листа есть `requireConfirmedImages`, у паспорта — нет | Проверить, нужно ли фото паспорта обязательным/проверяемым |
| 19 | src/components/piling/operator-v2/defect-sheet.tsx:120-127 | Обещано «фото прикладывается из карточки в журнале» | UI для привязки фото к `equipment_defect` вне operator-mobile не найдено (`rg equipment_defect src/components` — только operator-mobile) | Либо добавить привязку в журнале дефектов, либо не обещать |
| 20 | src/components/piling/operator-mobile/screens/incidents-tab.tsx:273 | Фото происшествия необязательно (осознанно) | У происшествия с пострадавшим первое дело — помощь, а не снимок | Оставить |
| 21 | src/modules/reports/application/queries/report-export.service.ts:150-156 | Фильтр `withPhotos` есть, но фото в PDF-выгрузку не встраиваются | «Отчёт с фото» в выгрузке означает только фильтр, сам снимок не попадает | Уточнить ожидание владельца |
| 22 | e2e/inspection-to-flow.spec.ts:113-114 | E2E не загружает фото, только раскрывает блок «+ замечание / фото» | Реальный путь presign→PUT→confirm не покрыт сквозным тестом | Добавить хотя бы один e2e-сценарий загрузки |
| 23 | src/app/api/media/route.ts:35-37 | Проверяется только `fileName`/`contentType`, но не `fileSize` | `fileSize` проверяется в сервисе (`media-service.ts:118-130`), так что дыры нет, но маршрут отдаёт 400 иначе, чем сервис | Оставить; отмечено для полноты |
| 24 | src/components/piling/inspections/run-inspection.tsx:191 | Клиент по-прежнему шлёт `photoCount` | Сервер игнорирует (`inspection-commands.ts:279-283`) — безопасно, но поле в контракте избыточно | Убрать поле из клиента при следующей правке |
| 25 | src/modules/inspections/domain/inspection-logic.ts:61-64 | `missingPhotosOnFault` наполняется только для пунктов с `photoRequired` | Если неисправность отмечена в пункте без `photoRequired`, фото не требуется вовсе | Проверить, что шаблоны размечляют `photoRequired` на пунктах-неисправностях |
| 26 | src/components/piling/report-form/photo-section.tsx:81-84 | Лимит 10 МБ дублирован в клиенте и в сервисе (`media-service.ts:64,118`) | Рассинхрон при смене лимита через `MEDIA_MAX_FILE_SIZE` | Читать лимит из общего источника |

## Не проверено

- Реальные S3/R2 и `sharp` вживую: проверено только кодом и юнит-тестами с моками
  (`confirm-upload-validation.test.ts`). Загрузка в настоящее хранилище не выполнялась.
- Работа офлайн-очереди на устройстве: вывод сделан по коду `offline-queue.ts:22` и
  `QUEUEABLE` (стр. 67-69); фактический офлайн-прогон не запускался.
- Retention-воркер `media-service.ts:439-467` (`runRetention`): не проверял, кто и по
  какому расписанию его зовёт — то есть чистота «осиротевших» фото не подтверждена.
- Поведение на реальных iPhone/Android (HEIC, `capture`, приватный режим, доступ к
  камере): только по комментариям в коде, не проверено на устройствах.
- `src/modules/operator-mobile/**` и `src/components/piling/operator-mobile/**` —
  замороженные области (AGENTS.md §1); читал только для контекста «неисправность ЕО»,
  правки не предлагаю.
- Существующие отчёты в `docs/audits/`, `CODEX-REPORT*` и `docs/strategy` не читал
  (запрещено условием задачи).
- Прогоны `tsc`/`lint`/`build` не делались: задача read-only и без правок кода; для
  отчёта достаточно счётчиков vitest (97 + 223 passed).
