# AU60-S5-ALERT-WEBHOOK-AUTH — Вебхук тревог и внутренние машинные входы: как защищены

Версия (git rev-parse HEAD рабочей папки): `6c84434a184596963d7855447aa779658fb1cd4e`
Режим: только чтение. Изменён только этот файл отчёта. Существующие отчёты в `docs/audits/`,
`CODEX-REPORT*`, `docs/strategy` не открывались (независимость первого прохода).

## Итог

Владельцу, коротко (5 строк):

1. Все машинные входы, где есть секрет, сделаны правильно: секрет сверяется за постоянное время
   (`timingSafeEqual`), при отсутствии переменной окружения вход **закрыт** (fail closed), а не открыт.
2. Отдельного HMAC-подписанного вебхука в проекте нет: есть Bearer-токен Alertmanager, Bearer-токен
   скрейпа метрик и ключ устройства (X-Device-Key), хранимый в БД как HMAC-SHA256.
3. Cron-подобных HTTP-входов «только для машины» нет: планировщики живут внутри процесса воркера,
   а два «запустить сейчас» (`maintenance-plans/run`, `admin/projections/rebuild`) требуют сессию админа.
4. Две реальные дырки: у вебхука тревог **нет ограничения частоты** и **нет верхней границы массива
   `alerts`**; ни один машинный маршрут не ограничен по IP — Caddy проксирует всё в приложение без фильтра.
5. Критичных (с прямым захватом данных/обходом входа) находок нет; остальное — гигиена и
   информационные утечки малого масштаба.

Числа по severity: **критично — 0**, **важно — 2**, **мелочь — 10**. Итого 12 находок (таблица ниже).
Всего файлов-маршрутов `src/app/api/**/route.ts` — 141; `middleware.ts` отсутствует (0 файлов).

## Методика

Что и как искалось (шаги воспроизводимы):

- `git rev-parse HEAD` → хеш выше. `git status --short` → изменён только `AGENTS.md` (предсуществующее,
  не трогал).
- Перечисление маршрутов: `find src/app/api -name route.ts | wc -l` → 141.
- Поиск секретов/HMAC/bearer: `search_files` по `timingSafeEqual|createHmac|randomBytes|constantTimeEquals`,
  по `CRON|WEBHOOK|_TOKEN|_SECRET|X-Api-Key|x-device-key|Bearer`, по `webhook|cron|scheduler|heartbeat`.
- Перечень публичных и машинных входов взят из сторожа `src/app/api/__tests__/route-guards.test.ts`
  (реестры `MUTATION_EXCEPTIONS` — строки 142–171 и `PUBLIC_GETS` — строки 172–180). Это машинно
  проверяемый список исключений из правила «GET — с сессией, мутация — с `withMutation`».
- Ограничение частоты и IP: `search_files` по `rateLimiter.check|RATE_LIMIT_BYPASS|ALLOW_IP|ALLOWLIST`
  в `src/app/api`; чтение `src/lib/rate-limiter.ts`, `src/core/api-wrapper.ts`.
- Сетевой периметр: чтение `Caddyfile`, `deploy/Caddyfile.prod` (проксирование и IP-фильтры).
- Файлы читались через `read_file`, поэтому номера строк ниже соответствуют реальному файлу.

Статусы: **ПРОЙДЕНО** — проверено чтением кода и подтверждено; **ГИПОТЕЗА** — вывод из кода, но без
запуска в среде; **НЕ ПРОВЕРЕНО** — проверить в этой задаче нельзя (см. раздел в конце).

### Таблица 1. Машинные и внутренние входы

| Маршрут | Метод | Чем защищён | Постоянное время | Ограничение частоты | Без секрета в окружении | Файл:строка |
|---|---|---|---|---|---|---|
| `/api/alerts/webhook` | POST | Bearer-секрет `ALERTMANAGER_WEBHOOK_TOKEN` | да (SHA-256 + `timingSafeEqual`) | **нет** | fail closed (401) | `src/app/api/alerts/webhook/route.ts:79-86,88-91` |
| `/api/metrics` | GET | Bearer `METRICS_SCRAPE_TOKEN` **или** сессия + `system.read` | да (сверка длины + `timingSafeEqual`) | нет | fail closed → к сессии | `src/app/api/metrics/route.ts:39-45,47-54` |
| `/api/telemetry/ingest` | POST | ключ устройства `X-Device-Key` (HMAC-SHA256 в БД) | да (`timingSafeEqual` по хэшу) | да, 500/60 с на IP | fail closed (401/403) | `src/app/api/telemetry/ingest/route.ts:60-89,103` |
| `/api/telemetry/ingest` | PATCH | ключ устройства `X-Device-Key` | да | да, 500/60 с | fail closed | `src/app/api/telemetry/ingest/route.ts:141-157` |
| `/api/telemetry/ingest` | GET | нет (публичная справка) | — | нет | — | `src/app/api/telemetry/ingest/route.ts:341-353` |
| `/api/health/deep` | GET | нет (публичная проба) | — | нет (кэш 30 с) | — | `src/app/api/health/deep/route.ts:32-38` |
| `/api/health` | GET | нет (публичная проба) | — | нет | — | `src/app/api/health/route.ts:24-36` |
| `/api/ready` | GET | нет (публичная проба) | — | нет (кэш 5 с) | — | `src/app/api/ready/route.ts:27-40` |
| `/api/liveness` | GET | нет (публичная проба) | — | нет | — | `src/app/api/liveness/route.ts:13-16` |
| `/api` (корень) | GET | нет (публичная справка) | — | нет | — | `src/app/api/route.ts:13-14` |
| `/api/system/status` | GET | сессия + `system.read` | — | нет | — | `src/app/api/system/status/route.ts:24-30` |
| `/api/system` | GET | сессия + `users.manage` | — | нет | — | `src/app/api/system/route.ts:11-18` |
| `/api/maintenance-plans/run` (cron-подобный) | POST | сессия + `maintenance.manage`, `withMutation` | — | да (100/мин) | — | `src/app/api/maintenance-plans/run/route.ts:13-18` |
| `/api/admin/projections/rebuild` (cron-подобный) | POST | сессия + `projections.rebuild`, `withMutation` | — | да (100/мин) | — | `src/app/api/admin/projections/rebuild/route.ts:37-42` |
| `/api/orion/lead` (ЗАМОРОЖЕНО, не менялось) | POST | публичная форма: лимит 5/10 мин на IP + honeypot | — | да | — | `src/app/api/orion/lead/route.ts:55-62` |

Выводы по таблице 1 (ПРОЙДЕНО): секретные входы сверяют секрет за постоянное время и закрыты при
отсутствии переменной; ключ устройства хранится не в открытом виде, а как HMAC-SHA256
(`src/services/telemetry/device-key-service.ts:15-35,109-152`). Отдельного HMAC-`createHmac` вебхука нет —
`createHmac` встречается только в `device-key-service.ts`. Cron-подобные HTTP-входы защищены сессией,
а не секретом машины.

## Находки

Severity: критично / важно / мелочь. Статусы: ПРОЙДЕНО / ГИПОТЕЗА / НЕ ПРОВЕРЕНО.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/app/api/alerts/webhook/route.ts:88` | `POST` не обёрнут ни `withApi`, ни `withMutation` → у вебхука **нет ограничения частоты** (единственный «мутационный» машинный вход без лимита) | При действующем токене (или после его утечки) отправитель может слать неограниченное число запросов, каждое из которых пишет строки в `outboxEvent` и бьёт в Telegram (`deliverQueuedAlert`, строка 162). Штатный Alertmanager лимита не гарантирует | Добавить IP-лимитер (как в `telemetry/ingest`) либо завернуть в отдельную обёртку с лимитом; занести в `MUTATION_EXCEPTIONS` не только `isAuthorized`, но и `rateLimiter.check` | ПРОЙДЕНО (код) / ГИПОТЕЗА (эксплуатационный эффект) |
| 2 | важно | `src/app/api/alerts/webhook/route.ts:55` | Массив `alerts` в схеме без верхней границы: `z.array(alertSchema)` без `.max(...)`; тело читается `request.json()` без лимита размера (строка 95) | Действующий токен может прислать массив в десятки тысяч элементов → разбор/память/итерация (строки 125-169) без отсечки. `MAX_FORWARDED=100` (строка 60) ограничивает только число доставок, не размер входа | Ограничить `alerts` (например `.max(200)`) и/или отсекать по размеру тела; при превышении — 413 | ПРОЙДЕНО (код) |
| 3 | важно | `deploy/Caddyfile.prod:47-54` | Ни один машинный маршрут (`/api/metrics`, `/api/alerts/webhook`, `/api/health/deep`) не ограничен по IP на периметре: Caddy проксирует **всё** в `127.0.0.1:3000` без `@matcher`/`remote_ip` | Машинные входы достижимы из интернета напрямую; отсутствует сетевой рубеж как второй слой поверх секретов. Отдельно фильтруется только Grafana (строки 46-49) | Добавить в Caddy блок `remote_ip` (allow-list для IP Prometheus/Alertmanager) на `/api/metrics` и `/api/alerts/webhook`; либо не публиковать их наружу | ПРОЙДЕНО (код) |
| 4 | мелочь | `src/app/api/metrics/route.ts:28-31` | Локальный `constantTimeEquals` делает ранний возврат по длине (`if (a.length !== b.length) return false`) — в отличие от вебхука, который хэширует обе стороны до фиксированной длины (`webhook/route.ts:73-77`) | Ранний возврат — тайминг-оракул длины секрета. Токены случайные и фиксированной длины, поэтому практический риск низкий, но два «одинаковых» помощника ведут себя по-разному | Привести к одному виду: хэшировать обе стороны `sha256` перед `timingSafeEqual` (как в вебхуке) либо вынести общий помощник | ПРОЙДЕНО (код) |
| 5 | мелочь | `src/services/telemetry/device-key-service.ts:16-18` | Хэш ключа устройства использует `DEVICE_KEY_LOOKUP_SECRET`, а при его отсутствии — `SESSION_SECRET` (тот же секрет, что подписывает сессии) | Переиспользование одного секрета для двух назначений нарушает разделение ключей: компрометация `SESSION_SECRET` ослабляет и защиту ключей устройств | В продакшене требовать отдельный `DEVICE_KEY_LOOKUP_SECRET` без fallback на `SESSION_SECRET` | ГИПОТЕЗА (зависит от того, задан ли `DEVICE_KEY_LOOKUP_SECRET` в проде — .env не читался) |
| 6 | мелочь | `src/app/api/health/deep/route.ts:56` | Публичный ответ отдаёт имена планировщиков (`staleSchedulers: status.components.schedulers.stale`) | Раскрывает внутренние имена фоновых задач (инфраструктурная разведка): комментарий на строках 46-48 прямо называет это признаком живости рутины | Отдавать только булев признак «есть отставшие», без списка имён | ПРОЙДЕНО (код) |
| 7 | мелочь | `src/app/api/ready/route.ts:19-25` | `sanitizeChecks` сохраняет `latencyMs` для каждой проверки, хотя комментарий выше (строки 15-18) обещает «не раскрывать внутренние детали» | Публичный маршрут отдаёт тайминги БД/зависимостей — слабый канал разведки по нагрузке и задержкам | Убрать `latencyMs` из публичного ответа либо не считать это «безопасным статусом» в комментарии | ПРОЙДЕНО (код) |
| 8 | мелочь | `src/app/api/health/route.ts:35`; `src/app/api/route.ts:14`; `src/app/api/telemetry/ingest/route.ts:344-353` | Публичные входы отдают версию приложения/сервиса (`health.version`, `version: "1.0.0"`, `service: iot-telemetry`) без входа | Версия — материал для подбора известных уязвимостей конкретной сборки | Либо скрыть точную версию, либо оставить осознанно (проверка деплоя по версии — см. комментарий `health/route.ts:5-8`) | ПРОЙДЕНО (код) |
| 9 | мелочь | `src/lib/rate-limiter.ts:177-182` | `RATE_LIMIT_BYPASS=true` отключает **все** лимиты всюду, где `NODE_ENV !== 'production'` | При неверно выставленном `NODE_ENV` (например, `production` со строчной буквы) флаг остаётся активным и снимает защиту от перебора | Привязать bypass к явному признаку теста (`NODE_ENV === 'test'` или отдельный `E2E`-флаг), а не к «не production» | ПРОЙДЕНО (код) |
| 10 | мелочь | `src/core/api-wrapper.ts:62-147` | `withApi` не содержит ограничения частоты — лимитирует только `withMutation` (строки 178-223) | Все публичные GET машинных входов (`/api/metrics` без токена, `/api/system/*`, `/api/health/*`) не имеют лимита; для `health`/`deep`/`ready` есть кэш, для `/api/telemetry/ingest` GET и `/api/system/*` — нет | Осознанно или добавить общий лимит на чтение для «тяжёлых» GET | ПРОЙДЕНО (код) |
| 11 | мелочь | `src/services/telemetry/device-key-service.ts:25-31` | В dev/test без `DEVICE_KEY_LOOKUP_SECRET`/`SESSION_SECRET` используется жёстко зашитый HMAC-секрет `'dev-only-device-key-fallback'` | Значение в исходнике; вне `development`/`test` выбрасывается ошибка (fail closed, строки 25-29), поэтому риск ограничен локальной средой | Приемлемо; при желании запретить и в dev | ПРОЙДЕНО (код) |
| 12 | мелочь | `src/app/api/metrics/route.ts:49-53` | При валидной сессии токен скрейпа не обязателен — метрики доступны любому с правом `system.read` (по замыслу, см. комментарий строк 35-38) | Расширяет круг читателей метрик (нагрузка/задержки/бэкапы) на всех ADMIN; это осознанное решение, но стоит зафиксировать | Подтвердить решение владельца или убрать сессионный fallback | ПРОЙДЕНО (код) |

### Что подтверждено как корректное (ПРОЙДЕНО)

- Вебхук: сверка токена за постоянное время с хэшированием обеих сторон —
  `src/app/api/alerts/webhook/route.ts:73-77`; fail closed при отсутствии
  `ALERTMANAGER_WEBHOOK_TOKEN` — `route.ts:81`; принимается только заголовок `Authorization: Bearer`,
  `?token=` отклоняется (тест `src/app/api/alerts/webhook/__tests__/route.test.ts:97-121`).
- Метрики: fail closed при отсутствии `METRICS_SCRAPE_TOKEN` — переход к сессионной проверке
  `src/app/api/metrics/route.ts:41,49-53`.
- Ключ устройства: хэш HMAC-SHA256 + сверка `timingSafeEqual` — `device-key-service.ts:116,136-138`;
  отказ вне dev/test без секрета — `device-key-service.ts:25-29`; тенант для телеметрии берётся
  из ключа, а не из тела, и отказ при отсутствии тенанта — `telemetry/ingest/route.ts:296-305`.
- Телеметрия ingest: собственный лимит 500/60 с на IP — `telemetry/ingest/route.ts:103,147-148`.
- Cron-подобные входы требуют сессию и право: `maintenance.manage` — `maintenance-plans/run/route.ts:18`;
  `projections.rebuild` — `admin/projections/rebuild/route.ts:42`.
- Сторож маршрутов (`src/app/api/__tests__/route-guards.test.ts:142-180`) машинно удерживает список
  исключений: новый незащищённый GET или мутация без `withMutation` роняет тест.

## Не проверено

- **Фактические значения переменных окружения** (`ALERTMANAGER_WEBHOOK_TOKEN`, `METRICS_SCRAPE_TOKEN`,
  `DEVICE_KEY_LOOKUP_SECRET`, `SESSION_SECRET`, `TRUST_PROXY`, `RATE_LIMIT_BYPASS`) — `.env*` файлы не
  читались по правилам задачи; выводы о fail-closed строятся только по коду. Поэтому находка #5 —
  ГИПОТЕЗА: неизвестно, задан ли `DEVICE_KEY_LOOKUP_SECRET` в проде.
- **Реальный сетевой периметр прода** — проверялся только `deploy/Caddyfile.prod` как «источник истины»;
  файл на сервере не сверялся (SSH/прод запрещены). Находка #3 — по конфигу в репозитории.
- **Эксплуатационный эффект абьюза вебхука** (сколько строк `outboxEvent`/сообщений Telegram реально
  можно породить за единицу времени) — не воспроизводился: нужен запущенный Redis/БД и Telegram.
- **`/api/health/deep` и `/api/ready` под нагрузкой** — оценивался только факт кэша по коду
  (`health/deep/route.ts:32`, `health-checks.ts:29`); измерения не проводились.
- **Заголовки `x-forwarded-for`/`x-real-ip` как источник IP** — поведение зависит от `TRUST_PROXY` в
  среде (`src/lib/rate-limiter.ts:478-488`); в рантайме не проверялось, поэтому лимиты по IP могут
  вырождаться в общий `host-...`-бакет (это отдельный класс риска, требующий проверки на стенде).
