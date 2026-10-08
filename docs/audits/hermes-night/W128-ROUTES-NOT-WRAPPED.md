# W128 — маршруты API без withApi и withMutation

## Итог

- Всего `route.ts` в `src/app/api/`: **141**; экспортируемых HTTP-обработчиков (GET/POST/PUT/PATCH/DELETE): **202**.
- Из 202 обработчиков **194** идут через обёртку: `withApi` — 92, `withMutation` — 79, `withReadinessCommand` (аналог, внутри вызывает `withMutation`) — 22, алиас `PATCH = POST` — 1.
- **8** обработчиков без обёртки вообще: 6 GET и 2 POST. Все 8 — осознанные исключения (пробы здоровья, SSE-поток, вебхук Alertmanager, публичная форма ORION), у каждого есть компенсирующий контроль либо это проба, которой обёртка не нужна.
- **Критичных** находок нет: нет ни одной мутации (POST/PUT/PATCH/DELETE), которая осталась бы совсем без CSRF и без лимита запросов.
- Топ-находка: `src/app/api/telemetry/ingest/route.ts:95` (POST) и `:141` (PATCH) — это мутации, обёрнутые в `withApi`, а не `withMutation`, поэтому **CSRF-проверки у них нет** (лимит запросов и аутентификация устройства есть). Остальные «мутации через `withApi`» (`auth/login`, `telemetry`, `telemetry/batch`) содержат `withCsrf` внутри обработчика и свой лимитер — отклонение от конвенции, но не дыра.

## Методика

1. `find src/app/api -name route.ts` — 141 файл. Проверено, что других `route.ts` вне `src/app/api` нет (`find src -name route.ts | grep -v '^src/app/api/'` — пусто).
2. Для каждого файла Node-скриптом (`scan_routes2.js` в scratch-каталоге, не в репозитории) найдены строки `export const|function GET|POST|PUT|PATCH|DELETE`, и окно в 6 строк после объявления классифицировано по обёртке: `withApi` / `withMutation` / `withReadinessCommand` / алиас (`export const PATCH = POST;`) / `нет`.
3. Отдельно проверены все алиасы (`grep -rnE 'as (GET|POST|PUT|PATCH|DELETE)\b'` — нет; единственный алиас `PATCH = POST` — `feedback/events`).
4. Определение `withReadinessCommand` открыто: `src/app/api/readiness/_shared/route-adapter.ts:13-29` — `return withMutation(...)`, то есть 22 readiness-маршрута эквивалентны `withMutation` (CSRF+лимит есть).
5. Компенсирующие контроли искались текстом: `grep -rn "withCsrf" src/app/api` и `grep -rln "withCsrf\|rateLimiter" src/app/api`.
6. Пробы/исключения читались целиком: `health`, `health/deep`, `liveness`, `ready`, `readiness`, `feedback/stream`, `alerts/webhook`, `orion/lead`.
7. Границы риска: мутация без `withMutation` и без эквивалентного `withCsrf` — высокий; GET без `withApi` — средний; отклонение с компенсацией — мелочь.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | важно | `src/app/api/telemetry/ingest/route.ts:95` | POST обёрнут в `withApi`, а не `withMutation`; `withCsrf` в файле нет (grep: `withCsrf` присутствует только в `auth/login`, `telemetry/route`, `telemetry/batch`). Есть свой лимит 1000/мин и аутентификация устройства (`authenticateDevice`, стр. 112). | Приём телеметрии от устройств идёт без CSRF-проверки. Для машинного клиента с токеном устройства CSRF малозначим, но маршрут остаётся единственной мутацией без CSRF-контроля со стороны обёртки. | Либо перевести на `withMutation` (с проверкой, что устройство не браузерный клиент и CSRF ему не мешает), либо оставить как есть, но зафиксировать в комментарии, почему CSRF здесь не нужен. |
| 2 | важно | `src/app/api/telemetry/ingest/route.ts:141` | PATCH — то же: `withApi`, лимитер свой, `withCsrf` нет. | Вторая мутация без CSRF в том же модуле; класс проблемы тот же. | То же решение, что для #1 (общее на оба метода). |
| 3 | мелочь | `src/app/api/auth/login/route.ts:17` | POST через `withApi`, не `withMutation`; внутри сам вызывает `withCsrf` (стр. 27) и лимитер попыток (`authenticateUserByEmailPassword`, стр. 49-53). | Отклонение от конвенции, но компенсировано: `withCsrf` и лимит входа на месте, причина описана в комментарии стр. 21-26. | Не трогать; при желании — вынести логин в отдельный путь, минуя `withMutation` явно. |
| 4 | мелочь | `src/app/api/telemetry/route.ts:83` | POST через `withApi`; `withCsrf` внутри (стр. 84), лимитер 1000/мин. | Компенсировано; отклонение осознанное (комментарии стр. 87-90). | Не трогать. |
| 5 | мелочь | `src/app/api/telemetry/batch/route.ts:64` | POST через `withApi`; `withCsrf` внутри (стр. 65), лимитер свой. | Компенсировано. | Не трогать. |
| — | маршрут-исключение | `src/app/api/alerts/webhook/route.ts:87` | POST без обёртки. | Вебхук Alertmanager → Telegram. Сессии нет, CSRF неприменим. Защита: общий секрет `ALERTMANAGER_WEBHOOK_TOKEN` через `Authorization: Bearer` или `?token=`, сравнение `timingSafeEqual` (`isAuthorized`, стр. 76-90); при отсутствии токена — отказ (стр. 78). Всё пишется в outbox (`db.outboxEvent.upsert`, стр. 142). Причина ясна — обёртка не нужна. | Не трогать. |
| — | маршрут-исключение | `src/app/api/orion/lead/route.ts:55` | POST без обёртки. | Публичная форма заявки сайта ORION (замороженная зона `src/app/api/orion/**`, AGENTS.md). Без входа по замыслу; защита — IP-лимит `LEAD_RATE_LIMIT` 5/10 мин (стр. 34-38, 56), honeypot-поле `website` (стр. 45-48, 77), строгие лимиты длины и HTML-экранирование. | Не трогать (заморожено). |
| — | маршрут-исключение | `src/app/api/feedback/stream/route.ts:9` | GET без обёртки. | SSE-поток: `withApi` дождалась бы конца потока, поэтому контекст тенанта открыт вручную (`runWithTenantContext`, стр. 17), `requireAuth` вызван явно. Причина задокументирована в комментарии стр. 13-16. | Не трогать. |
| — | маршрут-исключение | `src/app/api/health/route.ts:24` | GET без обёртки. | Публичная проба (цель Docker HEALTHCHECK). Тело намеренно узкое; ответ всегда с контрактом status/version/uptime. Проба — обёртка с кешем/метриками тут не нужна. | Не трогать. |
| — | маршрут-исключение | `src/app/api/health/deep/route.ts:34` | GET без обёртки. | Публичная глубокая проба для внешних аптайм-мониторов. Отдаёт кешированный статус не старше 30 с (`MAX_STATUS_AGE_MS`, стр. 32), чтобы открытый маршрут не нагружал зависимости. | Не трогать. |
| — | маршрут-исключение | `src/app/api/liveness/route.ts:13` | GET без обёртки. | Проба живости процесса, без обращений к зависимостям. | Не трогать. |
| — | маршрут-исключение | `src/app/api/ready/route.ts:27` | GET без обёртки. | Каноничная проба готовности инфраструктуры (переехала с `/api/readiness`). | Не трогать. |
| — | маршрут-исключение | `src/app/api/readiness/route.ts:26` | GET без обёртки. | Устаревший алиас пробы (заголовки `Deprecation`/`Sunset`, стр. 34-37); бизнес-контур readiness живёт в `/api/readiness/*`. | Не трогать; удалить по истечении Sunset. |
| — | мелочь (инфо) | `src/app/api/feedback/events/route.ts:196` | `export const PATCH = POST;` — алиас, обёртка наследуется. | Скрипт-сканер помечает такой алиас как «без обёртки», но фактически PATCH вызывает POST, а POST обёрнут в `withMutation` (стр. 194). Дыры нет. | Не трогать; учитывать алиасы при повторном сканировании. |

Полная опись обёрнутых маршрутов (194 обработчика) не приводится построчно: они соответствуют правилу. Разбивка по типам обёрток дана в «Итог». Все 22 файла readiness-контура используют `withReadinessCommand` → `withMutation` (CSRF+лимит) — см. `route-adapter.ts:13-29`; примеры: `readiness/shifts/route.ts:46` (POST), `readiness/work-permits/[id]/approve/route.ts:11` (POST), `readiness/access-matrix/route.ts:31` (PUT) и `:45` (POST), `readiness/place-presets/route.ts:32` (POST).

## Не проверено

- **Фактическое поведение CSRF/лимита в рантайме** не проверялось (задача — опись). Выводы об отсутствии CSRF у `telemetry/ingest` сделаны по тексту кода и grep: `withCsrf` там не вызывается, но подстановка/конфигурация `withCsrf` (`CSRF_HEADERLESS_ALLOWED_PATHS` и т.п. в `src/lib/csrf-protection.ts`) не читалась построчно.
- **Динамические реэкспорты**: проверено, что `route.ts` не используют `export { x as GET }` и нет `route.ts` вне `src/app/api`. Иных способов объявить метод (например, через `const handlers = {GET...}` с последующим `export`) текст-скан не выявил, но специально не исключал.
- **Клиентская сторона**: какие фронтенд-вызовы бьют в маршруты-исключения и как они обходят/не обходят CSRF — не проверялось.
- **Прод-конфигурация** (`TRUST_PROXY`, `DEFAULT_TENANT_ID`, `ALERTMANAGER_WEBHOOK_TOKEN`) — не читалась (правило: без секретов/`.env`).

## Команды (для воспроизведения)

```
find src/app/api -name route.ts | wc -l                                  # 141
grep -rl "withReadinessCommand" src/app/api --include=route.ts | wc -l   # 21 файл (+ adapter)
grep -rn "withCsrf" src/app/api --include=route.ts                       # login, telemetry, telemetry/batch
node scan_routes2.js   # классификация каждого экспорта (скрипт в scratch, не в репозитории)
```
