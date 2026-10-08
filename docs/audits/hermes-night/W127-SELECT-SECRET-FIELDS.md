# W127 — Запросы без `select`, отдающие скрытые поля

Задача: опись вызовов Prisma `findMany/findFirst/findUnique/findUniqueOrThrow`
по моделям с секретными и служебными полями (`password`, `pin`, `pinLookup`,
`sessionVersion`, `keyHash`, `botToken`, `*Hash`, `requestHash` и т.п.),
сделанных **без** `select`/`omit`, и оценка того, уходит ли результат клиенту.
Код не менялся — только чтение.

## Итог

- Всего находок: **11** (критично: 0, важно: 4, мелочь: 7).
- Модели с секретами по схеме: `User` (password, pin, pinLookup, sessionVersion),
  `DeviceKey` (keyHash), `TelegramConfig` (botToken), `ReportAudit`
  (beforeHash/afterHash), `AuditLog` (idempotencyKeyHash/prevHash/hash),
  `TenantAuditChain` (headHash), `IdempotencyKey` (requestHash),
  `ReadinessScoreSnapshot` (factsHash).
- **Сырого секрета (password/pin/pinLookup/botToken) ни один ответ API не отдаёт** —
  поэтому пунктов «критично» нет. Во всех проверенных клиентских путях
  (`/api/auth/me`, `/api/users`, `/api/reports/[id]/history`,
  `/api/equipment/[id]/device-keys`, `/api/telegram/configs`) стоит `select`
  либо явное сужение DTO.
- Топ-5:
  1. `audit-repository.ts:87` — `auditLog.findMany` без `select`, и результат
     (включая `idempotencyKeyHash`, `prevHash`, `hash`) уезжает клиенту через
     `/api/readiness/audit` и CSV-экспорт (важно).
  2. `readiness/history/route.ts:29` + `:59` — `readinessScoreSnapshot.findMany`
     без `select`, в ответ кладётся `factsHash` (важно).
  3. `readiness/export/route.ts:102` + `:125` — то же, `factsHash` и хеши
     аудита уезжают в CSV (важно).
  4. `telegram-config-service.ts:37` — `telegramConfig.findMany` без `select`
     тянет `botToken` и расшифровывает его в память ради хвоста (важно, клиенту
     не уходит).
  5. `crew-command.service.ts:142,228` — `user.findUnique` без `select` тянет
     `password`/`pin`/`pinLookup`/`sessionVersion` (мелочь: клиенту не уходит,
     ответ сужен и покрыт тестом).

## Методика

- Схема: `search_files` по `prisma/schema.prisma` — регулярки
  `(password|Hash|token|secret|sessionVersion|apiKey|Salt)` и
  `(?i)(credential|privateKey|refresh|apiKey|pin|bearer)`. Модели-кандидаты
  определены по `^model ` и чтением тел моделей (`read_file`).
- Вызовы: `search_files` по `src/**` с регэкспом
  `(user|deviceKey|telegramConfig|reportAudit|auditLog|tenantAuditChain|idempotencyKey|readinessScoreSnapshot|offlineWorkAuthorizationRecord|serverOfflineAuthorizationKey|tenant)\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow)\(`
  → 72 совпадения; тесты (`__tests__`, `*.test.ts`) отброшены.
- Для каждого совпадения `read_file` вокруг строки: есть ли `select`/`omit`,
  что возвращает функция-владелец и уходит ли объект в `NextResponse.json` /
  DTO ответа route-хендлера.
- Дополнительно: поиск `omit:` (в живом коде — 0 вхождений), `select *`
  (в живом коде — 0), `withIdentityRole` (3 боевых вызова), `pinLookup`
  (только тесты и комментарии).
- Ограничение объёма: модели без секретных полей (Report, ReportVersion,
  PileGrade и т.п.) не разбирались — у `ReportVersion` секретных колонок нет,
  `ReportAudit` покрыт отдельно.

## Находки

| # | severity | path:line | модель / метод | уходит клиенту | проблема / почему важно | предлагаемое исправление |
|---|----------|-----------|----------------|----------------|-------------------------|--------------------------|
| 1 | важно | src/modules/readiness/infrastructure/audit/audit-repository.ts:87 | AuditLog.findMany | да | `findMany` без `select`; строка мапится в `StoredAuditEvent` вместе с `idempotencyKeyHash`, `prevHash`, `hash` (audit-repository.ts:128,134,135). Эти события уходят клиенту: `/api/readiness/audit` (route.ts:32,44,47) и CSV-экспорт (export/route.ts:81,96). Отдаются служебные поля цепочки, а `idempotencyKeyHash` — ключ идемпотентности клиента в hex | Явный `select` колонок, нужных экрану; хеши отдавать только в отдельном «проверить цепочку» ответе |
| 2 | важно | src/app/api/readiness/history/route.ts:29 | ReadinessScoreSnapshot.findMany | да | `findMany` без `select` тянет всю строку; в ответ кладётся `factsHash` (route.ts:59). Хеш «фактов» — служебное поле целостности, в UI истории баллов не нужен | Добавить `select` без `factsHash` либо убрать строку 59 |
| 3 | важно | src/app/api/readiness/export/route.ts:102 и :114 | ReadinessScoreSnapshot.findMany + readChain | да | `findMany` без `select`; в CSV попадают `factsHash` (export/route.ts:125) и хеши аудита `prevHash`/`hash` (:96). Экспорт — файл, который уносят из системы | `select` нужных колонок; хеши в CSV включать только для датасета `audit` и осознанно |
| 4 | важно | src/services/telegram/telegram-config-service.ts:37 | TelegramConfig.findMany | нет | `findMany` без `select` поднимает `botToken` (в БД — шифротекст) и расшифровывает его в память ради хвоста из 4 символов (:49-52). Сам токен в ответ не уходит (destructure :47, тип `TelegramConfigView` :30-33), но расшифрованный секрет лишний раз живёт в процессе | Взять `hasBotToken`/`botToken` только когда нужен хвост, либо считать хвост из шифротекста без `decrypt` |
| 5 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:142 | User.findUnique | нет | `findUnique` без `select` возвращает `password`, `pin`, `pinLookup`, `sessionVersion`; используется только `role`/`tenantId` (:148,155). Ответ клиенту формируется отдельно через `crewWriteResponseInclude` (operator select :123) и покрыт тестом (crew-command-service.test.ts:143-168), поэтому утечки нет — но лишний секрет в памяти | `select: { id: true, role: true, tenantId: true }` |
| 6 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:228 | User.findUnique | нет | То же в `updateCrew`: полная строка пользователя, используется только `role` (:235) | `select: { role: true }` |
| 7 | мелочь | src/services/reports/report-history-service.ts:40 | ReportAudit.findMany | нет | `findMany` без `select` тянет `beforeHash`, `afterHash`, `ipAddress`, `userAgent`. DTO `events` (report-history-service.ts:55-63) хеши и IP не включает, route `/api/reports/[id]/history` отдаёт именно DTO (route.ts:15-16) — утечки нет, но хеши и IP зря в памяти | `select` полей diff/action/actorName/actorRole/createdAt |
| 8 | мелочь | src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts:38 | ReadinessScoreSnapshot.findUnique | нет | `findUnique` без `select` дважды (:38 и :40) возвращает строку целиком с `factsHash`. Потребители берут только `id/status/verdict/score/calculatedAt` (project-event.ts:67-68, start-decision.ts:44) — наружу не уходит | `select` нужных колонок |
| 9 | мелочь | src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts:40 | ReadinessScoreSnapshot.findUnique | нет | Тот же приём во втором `findUnique` (фолбэк по уникальному ключу) | `select` нужных колонок |
| 10 | мелочь | src/core/notifications/telegram.ts:75 | TelegramConfig.findMany | нет | `findMany` без `select` тянет `botToken`; отправитель расшифровывает его сам (:87-89) и отправляет в Telegram API — это штатно, но в код попадает полная строка | Брать явные колонки, включая `botToken` |
| 11 | мелочь | src/app/api/readiness/current/route.ts:25 | ReadinessScoreSnapshot.findMany | нет | `findMany` без `select` тянет всю строку (включая `factsHash`), но DTO (:31-46) `factsHash` не включает — утечки нет | `select` только используемых колонок |

### Проверено и безопасно (для полноты описи)

- `src/app/api/auth/me/route.ts:29` — `User.findUnique` с `select` без секретов; тест `me/__tests__/route.test.ts:64` прямо проверяет границу.
- `src/services/auth/auth-service.ts:110` — `select` включает `password`/`sessionVersion`, но это серверная проверка входа, наружу не уходит.
- `src/lib/auth.ts:91`, `src/lib/page-session.ts:54` — `User.findUnique` с явным `select`; `sessionVersion` используется для отзыва, в тело ответа не кладётся.
- `src/app/api/users/route.ts:33` + `src/services/users/user-service.ts:16,36,242,338` — все вызовы `User.*` с `select`.
- `src/app/api/equipment/[id]/device-keys/route.ts:110,152` и `src/services/telemetry/device-key-service.ts:120` — `DeviceKey.*` с `select`, `keyHash` в ответ GET не включён (route.ts:112-120).
- `src/app/api/telegram/configs/route.ts:153`, `src/app/api/notifications/telegram/test/route.ts:35`, `telegram-config-service.ts:114,148` — `TelegramConfig.findFirst` с `select {id}`; POST/PUT/PATCH возвращают `toView` без токена (route.ts:88,126; service :61-70).
- `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:45` — `IdempotencyKey.findFirst` с `select` (в т.ч. `requestHash` — внутреннее поле, но клиенту не отдаётся).
- `src/modules/readiness/application/bootstrap-query.ts:94` — `AuditLog.findFirst` с `select {after}`.
- `src/lib/tenant-iteration.ts:23` — `Tenant.findMany` с `select {id}` (billing-поля `stripeCustomerId`/`billingEmail` не тянутся).
- Прочие `User.findMany/findFirst` в `src/modules/safety/**`, `src/modules/reports/**`, `src/services/audit/**`, `src/services/reports/**`, `src/app/api/admin/incidents/route.ts:54`, `src/app/api/readiness/permit-form-options/route.ts:44`, `src/modules/readiness/**` — все с `select`.

## Не проверено

- Модели **вне списка секретных** (`Report`, `ReportVersion`, `Media`,
  `FeedbackEvent`, `DeadLetterQueue`, `OrionLead` и др.) — на «служебные»
  поля не разбирались, кроме `ReportVersion` (секретных колонок нет).
- **Замороженные зоны** не проверялись по правилу задачи: вызовы `db.user.*`
  в `src/modules/operator-mobile/**` (`defect-views.ts:41`,
  `commands/equipment.ts:35`, `commands/admission.ts:101,271`) и варианты
  экрана оператора пропущены; их `select` не читался.
- `src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts` —
  читал только `auth-service.ts:110` как точку входа (там `select`); остальной
  код этих файлов по правилам не аудировал.
- **Raw SQL** (`$queryRaw`) на предмет `SELECT *` не разбирался за пределами
  поиска литерала `select *` (в живом коде совпадений нет); тела запросов в
  `src/core/infrastructure/raw-queries.ts` не открывал.
- `OfflineWorkAuthorizationRecord` и `ServerOfflineAuthorizationKey` — на
  секретность полей смотрел по схеме (`authorization Json`, `publicKeyPem`),
  вызовов Prisma по ним в `src` не нашёл; поведение кода не проверял.
- Поведение **во время выполнения** (реальный ответ по сети) не проверялось —
  вывод сделан по чтению исходников (`read_file`), а не по запуску тестов.
- Функции, чей результат уходит в ответ, но тело которых я не читал до конца
  (`humanizeDiff` в `report-history-service.ts`, `verifyAuditEvents` в
  `verify-chain.ts`) — «функция не проверена»; на состав DTO это не влияет,
  DTO собирается по явным полям.
