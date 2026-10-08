# W82-CLAUDE-MD-DRIFT — сверка правил CLAUDE.md с текущим кодом

## Итог

- Проверено 7 утверждений CLAUDE.md против кода (только чтение, ничего в `src/` и `CLAUDE.md` не менялось).
- Совпадают полностью: 3 из 7 (пункты 3 — сравнение секретов, 5 — console.log в сервисах, 7 — существование путей).
- Расхождения: 4 пункта (1 — обёртки маршрутов, 2 — safeParse/400, 4 — сырой SQL, 6 — файлы >500 строк формально «совпадает как правило», но нарушителей 62).
- По severity: критично — 0, важно — 3, мелочь — 5 (всего 8 находок).
- Топ-5:
  1. `src/core/security/identity-role.ts:65` — реально используется `$executeRawUnsafe` (пункт 4 CLAUDE.md говорит «нет»); защита — только regex-проверка имени роли.
  2. `src/app/api/telemetry/route.ts:83` (+ `batch`, `ingest`) — POST идёт через `withApi` с ручным `withCsrf` и своим лимитом вместо `withMutation`; CLAUDE.md прямо запрещает дублировать CSRF/лимит в маршруте.
  3. Маршруты модуля readiness возвращают 422 на ошибку `safeParse`, а CLAUDE.md обещает 400 (24 вхождения в 21 файле).
  4. 21 маршрут readiness использует `withReadinessCommand` вместо литерального `withMutation` (обёртка внутри всё равно вызывает `withMutation`).
  5. Часть мутирующих маршрутов (`settings` PUT, `monitoring/template` PUT, `readiness-rules` PUT, `readiness/access-matrix` PUT/POST, `media` POST) валидируют тело вручную, без `schema.safeParse`.

## Методика

- Прочитан `CLAUDE.md` целиком (87 строк) и `AGENTS.md`; замороженные зоны (`src/app/orion/**`, `src/app/api/orion/**`, операторские экраны) из выводов исключены.
- Обход всех `route.ts` под `src/app/api/` скриптом (`node`): для каждого файла — экспортируемые HTTP-методы (`export const GET|POST|PUT|DELETE|PATCH`), наличие литералов `withApi` / `withMutation` / `withReadinessCommand`, `.safeParse(`, ре-экспортов. Скрипт и его полный вывод — во временном каталоге, в репозиторий не писался.
- Ключевые файлы прочитаны целиком: `src/core/api-wrapper.ts`, `src/app/api/readiness/_shared/route-adapter.ts`, `src/app/api/readiness/_shared/request-context.ts`, `src/app/api/readiness/route.ts`, `readiness/defects/route.ts`, `readiness/shifts/route.ts`, `readiness/access-matrix/route.ts`, `readiness/shifts/[id]/start|cancel/route.ts`, `telemetry/route.ts`, `telemetry/batch/route.ts`, `telemetry/ingest/route.ts`, `alerts/webhook/route.ts`, `settings/route.ts`, `monitoring/template/route.ts`, `readiness-rules/route.ts`, `media/route.ts`, `users/route.ts` (фрагмент), `equipment/route.ts` (фрагмент), `src/core/security/identity-role.ts`, `src/core/security/tenant-rls.ts`.
- `search_files` по образцам: `\$queryRawUnsafe|\$executeRawUnsafe`, `\$queryRaw\b|\$executeRaw\b` (count), `console\.(log|error|warn|info|debug)`, `timingSafeEqual`, `422`, `status: 400`, `safeParse`, `withApi`, `withMutation`, `withReadinessCommand`, `===` в `src/services/auth` и `src/core/security`.
- Длины файлов — обход всех `*.ts|*.tsx` под `src/` скриптом `node`, порог 500 строк.
- Существование путей — проверка `-e` в bash для каждого названного в CLAUDE.md пути.

## Находки

Таблица «утверждение CLAUDE.md | факт в коде | совпадает». Расхождения — сверху.

| # | severity | утверждение (CLAUDE.md) | факт в коде (число / `file:строка`) | совпадает |
|---|----------|--------------------------|--------------------------------------|-----------|
| 1 | важно | §Ловушки: «Сырой SQL — `$queryRaw` (не `Unsafe`)» | В `src/` есть реальное применение unsafe: `src/core/security/identity-role.ts:65` → `await tx.$executeRawUnsafe(\`SET LOCAL ROLE "${role}"\`)`. Защита — regex-проверка `identityRole()` (там же, строки ~30–42). Второе вхождение (`src/core/security/tenant-rls.ts:174,176`) — не вызов, а список имён методов-«стражей» (`RAW_METHODS`). Остальные 4 вхождения — тесты. | **нет** (1 реальный вызов `$executeRawUnsafe`; формально противоречит абсолютному «не Unsafe») |
| 2 | важно | §Маршруты: «Всегда `withApi` (GET) или `withMutation` (POST/PUT/DELETE…). Не дублировать CSRF/лимит в маршруте» | Три IoT-маршрута делают POST через `withApi` + ручной `withCsrf` + собственный `rateLimiter.check` вместо `withMutation`: `src/app/api/telemetry/route.ts:83` (csrf стр.84–85, лимит стр.91–103), `src/app/api/telemetry/batch/route.ts:9` (импорт `withApi`, `withCsrf`, `rateLimiter`), `src/app/api/telemetry/ingest/route.ts:28` (`withApi`, `readJsonBody`, свой лимит). | **нет** (3 маршрута дублируют CSRF и лимит, вопреки правилу) |
| 3 | важно | §Маршруты: «Тело — `schema.safeParse`, при ошибке 400» | Модуль readiness отвечает **422** на ошибку схемы (24 вхождения `422` в 21 файле `src/app/api/readiness/**`), например `readiness/defects/route.ts:37`, `readiness/shifts/[id]/cancel/route.ts:12`, `readiness/shifts/[id]/start/route.ts:14`. 400 там только на битый JSON. Остальные маршруты отвечают 400, напр. `users/route.ts:62`, `equipment/route.ts:45`. | **нет** (код ответа на ошибку валидации разнится: 400 vs 422) |
| 4 | мелочь | §Маршруты: «Всегда `withMutation` (POST/PUT/DELETE)» | 21 файл `src/app/api/readiness/**` использует `withReadinessCommand` (`readiness/_shared/route-adapter.ts:13,17`, внутри вызывает `withMutation`) вместо литерального `withMutation`. Примеры: `readiness/work-permits/[id]/approve/route.ts:15`, `readiness/defects/[id]/triage/route.ts:15`. | **частично** (обёртка модуля, но не имя из правила) |
| 5 | мелочь | §Маршруты: «Тело — `schema.safeParse`» | Часть мутирующих маршрутов валидирует тело вручную, без zod-`safeParse`: `settings/route.ts:30–42` (PUT, `saveSettings`), `monitoring/template/route.ts:38–44` (PUT, `saveTemplate` + try/catch→400), `readiness-rules/route.ts:27–37` (PUT, `saveReadinessDraft`), `readiness/access-matrix/route.ts:31–43` (PUT, без схемы) и `:45` (POST, без тела), `media/route.ts:19–37` (POST, ручные проверки `fileName`/`contentType`, комментарий «схемы zod тут нет»). | **нет** (не единый `safeParse`; валидация встречается ручная) |
| 6 | мелочь | §Маршруты: «Всегда `withApi` (GET)» | 5 публичных проб без обёртки: `health/route.ts`, `health/deep/route.ts`, `liveness/route.ts`, `ready/route.ts`, `readiness/route.ts:26` (deprecated-алиас). | **частично** (осознанное исключение проб, но правило заявлено без исключений) |
| 7 | мелочь | §Маршруты: обёртки для всех маршрутов | `alerts/webhook/route.ts:87` — POST без `withApi`/`withMutation`, своя token-авторизация (`isAuthorized`, стр.76–85). `src/app/api/orion/lead/route.ts` — POST без обёртки, но это замороженная зона ORION (не оценивалось). | **нет** (webhook намеренно вне обёрток; orion — заморозка) |
| 8 | мелочь | §Ловушки: «Файлы > 500 строк — делить по ответственности» | В `src/` 62 файла >500 строк. Из них 3 — сгенерированные (`.d.ts`), много тестов и замороженных операторских экранов. Первые 15 (строк): `generated/postgres-client/index.d.ts` 175013, `generated/.../runtime/library.d.ts` 3983, `runtime/client.d.ts` 3491, `components/piling/operator-next/__tests__/operator-next-app.test.tsx` 1787, `components/piling/operator-mobile/v10/operator-v10-app.tsx` 1717, `components/piling/to/readiness/screens/readiness-centre.tsx` 1382, `components/piling/operator-v5/operator-v5-app.tsx` 1313, `components/piling/to/__tests__/to-module-shell.test.tsx` 1293, `services/audit/__tests__/audit-service.test.ts` 1266, `components/piling/operator-v2/operator-shift-v2.tsx` 1257, `components/piling/operator-mobile/operator-mobile-app.tsx` 1005, `components/piling/operator-next/operator-next-app.tsx` 989, `services/audit/audit-service.ts` 988, `components/piling/operator-mobile/__tests__/api.test.ts` 934, `components/piling/to/to-module.tsx` 881. | **да** (правило действует; нарушителей много, часть — вне зоны правок: generated/frozen) |
| 9 | — | §Безопасность: «Сравнение секретов — `crypto.timingSafeEqual`» | Прямых сравнений токенов через `===` нет ни в `src/services/auth/`, ни в `src/core/security/` (grep `===` — только сравнения ролей/строк, не секретов). `timingSafeEqual` — в 3 местах: `app/api/alerts/webhook/route.ts:73`, `app/api/metrics/route.ts:30`, `services/telemetry/device-key-service.ts:138`. Пароли — `bcryptjs compare` (`services/auth/auth-service.ts:27,48,126`). | **да** (секреты не сравниваются через `===`) |
| 10 | — | §Ловушки: «`console.log` в сервисах — нет, `logger` из `@/lib/logger`» | `console\.(log|error|warn|info|debug)` в `src/services/` — 0 совпадений. | **да** |
| 11 | — | §Архитектура/Безопасность: перечень путей | Все существуют, кроме нюанса: `src/lib/logger` — это файл `src/lib/logger.ts` (модуль), а не каталог. Проверено `-e`: `src/modules/`, `src/services/`, `src/core/`, `src/app/api/`, `src/core/infrastructure/raw-queries.ts`, `src/lib/cache-strategies.ts`, `src/lib/rate-limiter.ts`, `src/lib/csrf-protection.ts`, `src/services/auth/`, `src/core/security/`, `src/modules/reports/` — существуют; `src/lib/logger` (каталог) — нет, есть файл `src/lib/logger.ts`. | **да** (с оговоркой про logger) |

Сводно по проверкам задачи:
- Пункт 1 (withApi/withMutation): всего 141 `route.ts`. Литеральный `withApi` — 97 файлов, `withMutation` — 71 файл; 21 файл без обоих литералов (14 из них — POST-команды readiness через `withReadinessCommand`, 5 — публичные пробы, 2 — webhook/orion). Исключения-нарушения: telemetry (находка 2).
- Пункт 2 (`safeParse`+400): `safeParse` — 80 вхождений в ~65 файлах. 400 — на legacy-маршрутах; 422 — в readiness (находка 3). Ручная валидация без схемы — находка 5.
- Пункт 3 (`timingSafeEqual` vs `===`): нарушения нет (находка 9).
- Пункт 4 (`$queryRaw`, нет Unsafe): нарушение есть — находка 1.
- Пункт 5 (`console.log` в services): нарушений 0 (находка 10).
- Пункт 6 (>500 строк): находка 8.
- Пункт 7 (пути): находка 11.

## Не проверено

- Не запускал приложение, сборку и тесты — задача только на чтение кода; выводы сделаны по тексту файлов, не по поведению.
- Не проверял, срабатывает ли `422`/`400` на клиенте: клиентский разбор отказов (`src/components/piling/*/api.ts`) не открывал — важно только для UX, не для сверки правила.
- `$executeRawUnsafe` в `identity-role.ts`: не проверял, задаётся ли `IDENTITY_ROLE`/переменная роли окружения на бою (`.env*` не открывал — запрет AGENTS.md); regex-барьер из файла читал, но его достаточность для всех возможных значений env не доказывал.
- Telemetry-маршруты (`withApi`+ручной CSRF/лимит): не проверял историю решения — возможно, это осознанный отказ от `withMutation` ради высокой пропускной способности; как «нарушение» квалифицирую по букве CLAUDE.md, не по замыслу.
- `src/app/api/orion/**` (замороженная зона) — пропускал по правилу; `orion/lead` упомянут только как исключение из пункта 1.
- Операторские экраны и ORION-сайт (заморожены) — в список >500 строк они попали механически, по ним выводов не делаю.
- Точные числа `withApi`/`withMutation` — из текстового поиска по литералам, не из графа GitNexus (impact/detect-changes не запускал: правок в коде нет, индекс мог быть устаревшим).
