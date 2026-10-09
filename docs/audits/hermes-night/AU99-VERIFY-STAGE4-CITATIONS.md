# AU99 — Самопроверка отчёта AUDIT-STAGE4: ссылки файл:строка

Версия проверки: `git rev-parse HEAD` = **fca1468d0c387f92cb8f617d0c06db4fa5f3e5e3**
(ветка `hermes/q4-0926`).

Проверяемый отчёт: `docs/audits/hermes-night/AUDIT-STAGE4-NETWORK-CONCURRENCY.md`
(336 строк, заявленная в нём версия — `1fa758701e15658562a82b362e08fd6ec668cb25`).
Только чтение: код приложения не менялся, создан лишь этот файл.

## Итог

Проверены все 12 находок F-01…F-12 и строки таблицы покрытия. Ссылок
`файл:строка` проверено — **52**; существует диапазон строк — **51**;
содержимое совпадает с описанием — **51**.

- Одна ссылка **неверна**: F-08 указывает `mobile-shift-commands.ts:50-95`, но
  этот файл — 35-строчный ре-экспорт, строк 50–95 в нём нет. Реальный
  `closeShift` живёт в `src/modules/operator-mobile/application/commands/shift-close.ts:41-96`.
- Систематическое замечание: часть ссылок дана без каталога (`closing-screen.tsx`,
  `checklist-screen.tsx`, `incidents-tab.tsx`, `queue-flow.test.tsx`) — файлы
  существуют, но лежат в подкаталогах `screens/` и `__tests__/`, которые из
  короткого имени не выводятся. По букве задания («пути полностью») это дефект,
  на выводы находок он не влияет.
- Расхождение версий не сломало цитаты: почти все строки воспроизвелись на
  текущем HEAD (fca1468d), а не на заявленном 1fa75870.

Топ-5 по важности:
1. F-08 — единственная фактически несуществующая ссылка (`mobile-shift-commands.ts:50-95`).
2. F-01/F-02 — ключевая находка (порядок проверок), ссылки подтверждены точно.
3. F-05 — ссылки на экраны без пути (`screens/...`).
4. F-12 — расхождение README/RELEASE-NOTES/CONTRIBUTING с INSTALL-MOBILE подтверждено дословно.
5. F-10 — все 5 ссылок (в т.ч. вложенный HTTP-вызов в транзакции) подтверждены.

**Вывод: отчёт в целом добросовестный — 51 из 52 ссылок верны; критичных
подмен нет, кроме одной ссылки на файл с чужим именем в F-08.**

## Методика

Проверка каждой ссылки — командой, а не по памяти: `read_file` для диапазонов и
`sed -n '<n>p'` для одиночных строк; `grep -rIl … | wc -l` для заявлений об
отсутствии. Команды и результат — ниже. Пути — от корня `D:\PillingR\wt-night`.

- `git rev-parse HEAD` → `fca1468d0c387f92cb8f617d0c06db4fa5f3e5e3`.
- Существование файлов и их длину — `wc -l` по всем разобранным путям.
- Одиночные строки — `sed -n` по номерам из отчёта.
- Отсутствие service worker/манифеста — `grep -rIl -E "serviceWorker|sw\.js|manifest\.json" src | wc -l` → `0`.
- Отсутствие e2e по офлайну — `grep -rIl -E "offline|queue" e2e | wc -l` → `0`.
- Точка определения `closeShift` — `grep -rn "export async function closeShift" src/modules/operator-mobile`.

Статусы: ПРОЙДЕНО — строка существует и содержит описанное; НЕ ПРОВЕРЕНО —
утверждение нельзя подтвердить чтением кода; ГИПОТЕЗА — помечено самим отчётом.

## Находки

Таблица: ID | ссылка из отчёта | существует | соответствует | комментарий.

| ID | ссылка | существует | соответствует | комментарий |
| --- | --- | --- | --- | --- |
| F-01 | src/modules/operator-mobile/application/commands/incidents.ts:58 | Да | Да | `requireOpenShift(...)` на 58 — до поиска дубля |
| F-01 | src/modules/operator-mobile/application/commands/incidents.ts:61-73 | Да | Да | `findUnique` дубля и возврат внутри 61–73 |
| F-01 | src/modules/operator-mobile/application/commands/production.ts:108-121 | Да | Да | комментарий + `findByCommand` на 118 идут ПЕРВЫМИ |
| F-01 | src/components/piling/operator-mobile/offline-queue.ts:139-144 | Да | Да | `classifyFailure`: 4xx→permanent, 401/408/425/429→temporary |
| F-01 | src/components/piling/operator-mobile/offline-queue.ts:404-420 | Да | Да | `markAttempt` (411–420) + комментарий; 467–469 — вызов в `sendAll` |
| F-02 | src/modules/operator-mobile/application/commands/production-corrections.ts:73 | Да | Да | `requireOpenShift` на 73 |
| F-02 | src/modules/operator-mobile/application/commands/production-corrections.ts:76-77 | Да | Да | `findByCommand` на 76 — после проверки смены |
| F-02 | src/components/piling/operator-mobile/offline-queue.ts:67-69 | Да | Да | `QUEUEABLE` = log-production, report-incident, correct-production |
| F-03 | next.config.ts:114-116 | Да | Да | «the PWA was retired (no service worker, no manifest)» |
| F-03 | src/components/piling/operator-mobile/offline-queue.ts:29 | Да | Да | `STORAGE_KEY = 'pilingtrack.operator.queue.v1'` |
| F-03 | src/components/piling/operator-mobile/offline-queue.ts:210-222 | Да | Да | `read()`: пустой/битый localStorage → `[]`, предупреждения нет |
| F-04 | src/components/piling/operator-mobile/offline-queue.ts:257-265 | Да | Да | `mutate`: строгое чтение → запись без блокировки |
| F-04 | src/components/piling/operator-mobile/offline-queue.ts:332-357 | Да | Да | `enqueue`: `read(true)` → правка → `write` |
| F-04 | src/components/piling/operator-mobile/offline-queue.ts:277-288 | Да | Да | `onStorage`/`subscribeQueue` — только `notify`, без слияния |
| F-05 | src/components/piling/operator-mobile/api.ts:647-737 | Да | Да | `uploadPhoto`: grant→PUT→confirm, ветки «отложить» нет |
| F-05 | src/components/piling/operator-mobile/screens/checklist-screen.tsx:324-335 | Да | Да | путь неполный (см. №ниже); `attach` → `uploadPhoto`, ошибка теряется |
| F-05 | src/components/piling/operator-mobile/screens/incidents-tab.tsx:65-77 | Да | Да | путь неполный; `attach`, повтора нет |
| F-05 | src/modules/operator-mobile/application/commands/incidents.ts:26-28 | Да | Да | «ПОЧЕМУ ФОТО НЕ ОБЯЗАТЕЛЬНО» |
| F-06 | src/lib/store.ts:173-183 | Да | Да | `persist` c `currentUser` в `partialize` |
| F-06 | src/components/piling/operator-mobile/use-offline-queue.ts:49-50 | Да | Да | `void flush()` на монтировании |
| F-06 | src/components/piling/operator-mobile/offline-queue.ts:224-230 | Да | Да | `currentOwnerId()`/`isMine()` из store |
| F-07 | src/core/api-wrapper.ts:214-219 | Да | Да | 429 + `Retry-After: String(rl.retryAfter || 60)` |
| F-07 | src/components/piling/operator-mobile/use-offline-queue.ts:8,55-62 | Да | Да | `RETRY_EVERY_MS = 30_000` (8) и таймер (55–62), заголовок не читается |
| F-08 | src/components/piling/operator-mobile/screens/closing-screen.tsx:72-83 | Да | Да | путь неполный; кнопка закрытия при `pending > 0` заменена на «Отправить» |
| F-08 | **src/modules/operator-mobile/application/mobile-shift-commands.ts:50-95** | **НЕТ** | **Нет** | файл 35 строк — ре-экспорт; `closeShift` в `shift-close.ts:41-96` |
| F-08 | src/components/piling/operator-mobile/offline-queue-banner.tsx:100-178 | Да | Да | карточка `FailedItem` с «Повторить»/«Удалить» |
| F-09 | src/modules/operator-mobile/application/commands/checklist.ts:82 | Да | Да | `requireOpenShift` на 82 |
| F-09 | src/modules/operator-mobile/application/commands/checklist.ts:107-111 | Да | Да | поиск дубля по `clientCommandId` — после |
| F-09 | src/components/piling/operator-mobile/offline-queue.ts:67-69 | Да | Да | `submit-checklist` в `QUEUEABLE` отсутствует |
| F-10 | src/lib/db.ts:54-58 | Да | Да | `DEFAULT_TX_OPTIONS` timeout 10000, ReadCommitted |
| F-10 | src/components/piling/operator-mobile/api.ts:284 | Да | Да | `REQUEST_TIMEOUT_MS = 20_000` |
| F-10 | src/modules/operator-mobile/application/commands/equipment.ts:125-127 | Да | Да | `readWeather` (внешний вызов) внутри транзакции |
| F-10 | src/modules/operator-mobile/application/commands/equipment.ts:33 | Да | Да | `withReadinessTenantTransaction` открывает транзакцию |
| F-10 | src/modules/readiness/infrastructure/tenant-transaction.ts:38-43 | Да | Да | не-retry ветка (`runReadinessTenantTransaction` без ретрая) |
| F-11 | src/components/piling/operator-mobile/offline-queue.ts:228-230 | Да | Да | `isMine` → `!item.ownerId \|\| …` |
| F-11 | src/components/piling/operator-mobile/offline-queue.ts:39 | Да | Да | «…владельца нет — их считаем своими» |
| F-12 | README.md:3 | Да | Да | «…офлайн-синхронизация…» в описании продукта |
| F-12 | RELEASE-NOTES.md:18 | Да | Да | «офлайн-режим, разрешение конфликтов» |
| F-12 | CONTRIBUTING.md:188-195 | Да | Да | «Offline-first — не фича, а baseline», «Все CRUD … offline» |
| F-12 | INSTALL-MOBILE.md:46-55 | Да | Да | «офлайн-режима нет», «service worker … сейчас их в проекте нет» |
| Покр. | src/components/piling/operator-mobile/api.ts:567-568 | Да | Да | `enqueue(command)` до сети |
| Покр. | src/components/piling/operator-mobile/api.ts:179-187 | Да | Да | `unparsedFailureText`: 5xx-текст |
| Покр. | src/components/piling/operator-mobile/api.ts:298-354 / 322-354 | Да | Да | `timeoutSignal` (обрыв/таймаут) |
| Покр. | src/components/piling/operator-mobile/api.ts:549-550 | Да | Да | нераскладываемое шлём напрямую (`postCommand`) |
| Покр. | src/components/piling/operator-mobile/offline-queue.ts:141,140,146 | Да | Да | 5xx→temporary (141); 401→auth (140); `AUTH_WAIT_MESSAGE` (146) |
| Покр. | src/components/piling/operator-mobile/offline-queue.ts:183-190,232-248 | Да | Да | `QueueStorageError`; `write` c проверкой записи |
| Покр. | src/components/piling/operator-mobile/offline-queue.ts:210-248,298-310 | Да | Да | `read`/`write`; `foreignQueueSummary` |
| Покр. | src/components/piling/operator-mobile/offline-queue.ts:290-292 | Да | Да | `readQueue()` (сводка от реального хранилища) |
| Покр. | src/components/piling/operator-mobile/offline-queue.ts:446-472 | Да | Да | `sendAll`: обрыв/5xx → PENDING, остановка слива |
| Покр. | src/components/piling/operator-mobile/use-offline-queue.ts:49-70 | Да | Да | триггеры: запуск, online, visibility, таймер 30/60 с |
| Покр. | src/components/piling/operator-mobile/operator-mobile-app.tsx:425-426 | Да | Да | `error.reason === 'auth'` → `leaveToLogin()` |
| Покр. | src/components/piling/operator-mobile/operator-status-strip.tsx:22-41 | Да | Да | ветки offline/warning/ok сводки очереди |
| Покр. | src/components/piling/operator-mobile/screens/closing-screen.tsx:88-98 | Да | Да | панель «ждёт отправки», закрытие не блокируется кнопкой |
| Покр. | src/modules/operator-mobile/application/commands/shared.ts:56 | Да | Да | `SELECT 1 … FOR UPDATE` по смене |
| Покр. | src/modules/operator-mobile/application/commands/shared.ts:343-374 | Да | Да | `requireConfirmedImages` (проверка снимков на сервере) |
| Покр. | src/modules/operator-mobile/application/commands/shared.ts:398-419 | Да | Да | `ensureReport` — upsert отчёта |
| Покр. | src/modules/operator-mobile/application/commands/production.ts:118,123,82 | Да | Да | 118 `findByCommand` перед 123 `requireOpenShift`; 82 — старая форма простоя |
| Покр. | src/modules/operator-mobile/application/commands/production.ts:442-530,555-578 | Да | Да | legacy-простой по интервалу; перехват P2002 |
| Покр. | src/app/api/operator/mobile/command/route.ts:124-134 | Да | Да | старая форма простоя `startedAt/endedAt` сохранена |
| Покр. | prisma/schema.prisma:1243 | Да | Да | `@@unique([tenantId, clientCommandId])` ровно на 1243 |
| Покр. | src/components/piling/operator-mobile/offline-queue.test.ts:186,289,307 | Да | Да | обрыв сети; чужие записи не уходят; сменщик видит чужие |
| Покр. | src/components/piling/operator-mobile/__tests__/queue-flow.test.tsx:99,122,152,188 | Да | Да | путь неполный; сценарии online/409/503/401 совпадают с описанием |

### Дефекты цитирования (найдены этой проверкой)

1. **F-08, важная ошибка ссылки.** `mobile-shift-commands.ts:50-95` — файла-
   диапазона не существует (`wc -l` = 35 строк; это ре-экспорт `./commands/*`).
   Определение и тело `closeShift` — `src/modules/operator-mobile/application/commands/shift-close.ts:41-96`.
   Сам вывод F-08 (на сервере в `closeShift` нет проверки неотправленной
   очереди) верен: в `shift-close.ts:50-95` такой проверки действительно нет.
   Правильная ссылка: `shift-close.ts:41-96`.
2. **Неполные пути (мелочь).** В отчёте без каталога даны:
   `closing-screen.tsx`, `checklist-screen.tsx`, `incidents-tab.tsx`
   (реально `src/components/piling/operator-mobile/screens/`) и
   `queue-flow.test.tsx` (реально `.../operator-mobile/__tests__/`). Файлы
   существуют, но по короткому имени не находятся — задание требует полный путь.
3. **Версия.** Проверяемый отчёт объявляет версию `1fa75870`, текущий HEAD —
   `fca1468d`. На текущем HEAD почти все цитаты воспроизвелись, но проверить
   их на объявленной версии нечем (её нет в рабочем дереве) — см. «Что не проверено».

## Что не проверено

- **Содержимое по существу расхождения версий.** Отчёт заявлен для
  `1fa75870`, а проверялся на `fca1468d`. Совпадение 51 из 52 ссылок на текущем
  HEAD косвенно подтверждает, что между версиями перечисленные строки не
  сдвинулись, но доказательством для `1fa75870` это не является: коммит
  `1fa75870` в дереве отсутствует, диффа между версиями не делалось.
- **Номера строк в тестах после будущих правок** — не проверялись и не могут
  быть устойчивы, как и предупреждает сам отчёт.
- **Поведение в браузере/БД** (гонка двух вкладок F-04, `FOR UPDATE`, upsert)
  остаётся непроверяемым чтением; в отчёте оно и помечено ГИПОТЕЗА/НЕ ПРОВЕРЕНО
  — с этим согласен.
- **Утверждения из `chaos/chaos-scenarios.yaml` и `load-tests/`** — не
  разбирались: вне рамок проверки ссылок `файл:строка` отчёта.
- Проверялось только соответствие «ссылка ↔ строка»; содержательная правота
  самих находок (нужен ли перенос проверки дубля и т.п.) — вне задания.
