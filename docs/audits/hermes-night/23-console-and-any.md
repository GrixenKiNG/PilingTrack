# 23. `console.*` вместо logger и `as any` / `: any` в runtime-коде

Дата: 2026-09-26. Ветка: `hermes/q3-0925` (worktree `wt-night`). Метод: только чтение кода, ничего не запускалось и не менялось.
Область: `src/**`, кроме тестов (`__tests__/**`, `*.test.ts(x)`), `src/generated/**` и `scripts/**` (по условию задачи).
Замороженные области (варианты операторского экрана, сайт ORION) исключены из находок — см. «Не проверено».

## Итог

* Находок в таблице: **17**. Критично — **0**, важно — **2**, мелочь — **15**. Отдельно: то, что нашлось в замороженной зоне, в таблицу не попало (см. «Не проверено»).
* Всего `console.*` в области — **10 строк**: 3 в самом `src/lib/logger.ts` (это и есть реализация логгера, норма), 5 в `src/lib/seed/equipment.seed.ts` (dev-сид, для него в ESLint `no-console: off`) и **2 в клиентских компонентах** — других мест нет. Ни один вызов не логирует пароль/PIN/токен/персональные данные.
* Всего токенов `any` в коде — **75** (не считая слов «any» в комментариях). Все 75 закрыты `eslint-disable`.
  * (a) с обоснованием в комментарии — **68** (только счёт; разбивка по причинам — в приложении);
  * (b) в `src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts` — **0** (проверено, положительный результат);
  * (c) без обоснования — **7** токенов в 3 файлах.
* Самый важный пункт — №2: `src/core/realtime/server/ws-server.ts:317` лезет в **приватное** поле собственного класса через `(clients as any).clients?.values?.()`, причём `eslint-disable` подписан как «untyped external/library boundary» — это не внешняя библиотека. Из-за `?.` при изменении внутренностей `ClientManager` цикл молча не выполнится.
* Второй по важности — №1: в репозитории лежит **второй, никем не подключённый логгер** `src/core/observability/logger.ts` (167 строк, pino). Его `logger.error` (строка 109) раскрывает переданный объект в запись лога целиком — если однажды кто-то импортирует его вместо `@/lib/logger` и передаст туда тело запроса, пароль/PIN уедут в лог молча.
* Норма: ни в одном вызове `logger.*`/`console.*` в `src` не логируются `password`, `pin`, токены сессии, `METRICS_SCRAPE_TOKEN` или содержимое cookie (проверено по путям логина/PIN/сессии/Telegram/metrics).

## Методика

Все команды выполнялись из корня worktree `D:\PillingR\wt-night` (bash, ripgrep). Каждое попадание в таблицу открывалось через `read_file`, номера строк — из этих чтений.

```bash
# 1. console.* (и вообще любое упоминание console) в области
rg -n --no-heading -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.test.tsx' -g '!src/generated/**' 'console[.]' src
rg -n --no-heading 'console' src            # чтобы поймать console[level], window.console, комментарии

# 2. любые токены any (as any / : any / <any> / any[] / Promise<any> / Record<string, any>)
rg -n --no-heading -g '!**/__tests__/**' -g '!**/*.test.ts*' -g '!src/generated/**' '\bany\b' src
rg -n --no-heading -g '!**/__tests__/**' -g '!src/generated/**' '<any>|any\[\]|Record<string, *any>|= any\b|=> any\b' src

# 3. какие именно disable-комментарии без обоснования (нет « -- »)
rg -n --no-heading -g '!**/__tests__/**' -g '!**/*.test.ts*' -g '!src/generated/**' \
   'eslint-disable(-next-line|-line)? @typescript-eslint/no-explicit-any\s*$' src

# 4. разбивка обоснований по тексту
rg -o --no-heading -g '!**/__tests__/**' -g '!**/*.test.ts*' -g '!src/generated/**' \
   'eslint-disable-next-line @typescript-eslint/no-explicit-any -- .*' src | sed 's/.*-- //' | sort | uniq -c | sort -rn

# 5. любые другие средства отключения проверок
rg -n --no-heading -g '!**/__tests__/**' '@ts-(ignore|expect-error|nocheck)' src

# 6. секреты и ПДн рядом с логированием
rg -n --no-heading -i '(console|logger)[.a-zA-Z]*\(.*(password|passwd|\bpin\b|token|secret|apiKey|authorization|cookie)' src
rg -n --no-heading -g '!**/__tests__/**' 'logger[.](error|warn|info|debug)\([^)]*\b(body|input|payload|request|token|email|pin|password|session|credential|secret|authorization|cookie)\b' src
rg -n --no-heading 'process[.](stdout|stderr)' src     # пусто

# 7. контроль: не осталось ли «вторых» логгеров
rg -n --no-heading "from 'pino'" --glob '!node_modules' .
rg -l --no-heading "@/lib/logger" src | wc -l            # 63 файла — рабочий логгер
rg -n --no-heading 'childLogger|baseLogger|runWithCorrelation|observability/logger' --glob '!node_modules' --glob '!docs/**' .
```

Дополнительно написана и прогонена разовая проверка (в репозиторий не попала, лежит в scratch): обход 941 `.ts/.tsx` файла под `src` (без тестов и `src/generated`), из каждой строки вырезаны комментарии, и для каждого токена `any` проверялось, закрыт ли он disable-комментарием на той же/предыдущей строке либо блочным `/* eslint-disable ... */`. Результат: 75 реальных токенов, 72 закрыто построчно, 3 — блочно, «незакрытых» 0 (9 «незакрытых» в черновом прогоне оказались строками JSDoc, где `any` — часть английского текста; в таблицу они не попали).

Правило отнесения к группам (из задания): (a) есть disable **с обоснованием** — только счёт; (b) файл внутри `src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts` — перечислить всё; (c) всё остальное без обоснования — перечислить с указанием типа, которым это чинится.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|----------|-----------|----------|------------------------------|--------------------------|
| 1 | важно | `src/core/observability/logger.ts:102-113` (весь файл 1–167) | Второй логгер (pino) не подключён нигде: `logger`, `childLogger`, `baseLogger`, `runWithCorrelation` не импортируются ни одним файлом репозитория — единственные упоминания в поиске по всему репо это его собственный комментарий-пример (строки 12, 14). Зависимость `pino` (`package.json:106`) живёт только ради него. | Два несовместимых формата логов в одном дереве; новый код может импортировать «не тот» logger и уехать в отдельный поток, который не читает ни один парсер. Плюс `logger.error` в этой реализации (строка 109) **раскрывает переданный объект в запись лога целиком** (`{...context, ...err, ...obj}`) — в отличие от `src/lib/logger.ts:95-104`, где из `Error` берутся только `message`/`stack`. Для этого логгера нет правила «не логировать тело запроса». | Решить владельцу: удалить файл (тогда снять и `pino` из зависимостей — отдельной задачей) либо, если он планировался как замена, свести к одному логгеру и повторить в нём фильтрацию полей, как в `src/lib/logger.ts:95-104`. Сам я его не удалял: файл не в списке «выглядит мёртвым, но нужно», но и не в списке того, что можно трогать молча. |
| 2 | важно | `src/core/realtime/server/ws-server.ts:316-317` | `for (const client of (clients as any).clients?.values?.() \|\| [])` — обращение к **приватному** полю своего же класса (`private clients = new Map<string, WSClient>()`, `src/core/realtime/server/client-manager.ts:42`). Обоснование в disable — «untyped external/library boundary», что неверно: `ClientManager` — собственный код проекта. | Через этот цикл наполняются replay-буферы клиентов (строки 315–330). Из-за `?.` и `\|\| []` при переименовании/смене типа приватного поля цикл не упадёт, а **молча не выполнится**: клиенты перестанут получать пропущенные события после реконнекта, и ни ошибки, ни падения не будет. Также это тенант-гейт кода realtime (строка 320) — диагностировать пропажу будет тяжело. | Добавить в `ClientManager` публичный итератор (например `forEachClient(fn)` или `values(): IterableIterator<WSClient>`) и вызывать его; тогда `as any` и `?.` уходят вместе с некорректным обоснованием. |
| 3 | мелочь | `src/components/piling/admin-reports/use-report-history.ts:29` | `console.error('useReportHistory failed', { reportId, err })` в клиентском хуке — вместо `logger` из `@/lib/logger`. Логируется `reportId` (идентификатор сущности) и `Error`; ПДн и токенов нет. | Лог уходит только в консоль браузера пользователя: в Sentry/агрегатор такое не попадает, поэтому «история отчёта не загрузилась» не видно никому, кроме самого пользователя. Это единственный клиентский путь, где ошибка FETCH пишется руками. | Заменить на `console.error` → удалить (состояние `error: true` уже отдаётся наружу и обрабатывается UI) либо, если серверный логгер в клиенте нежелателен, оставить `console.error` и пометить строку комментарием-обоснованием, как это сделано в остальных местах. |
| 4 | мелочь | `src/components/piling/to/readiness/boundaries/active-view-error-boundary.tsx:28` | `console.error('Tech readiness active view failed', error, info.componentStack)` в `componentDidCatch`. В стек попадает `componentStack` (имена компонентов), ПДн внутри нет. | React и сам печатает ошибку границы в консоль, так что это дублирование; при этом ошибка не уходит в Sentry, хотя весь серверный край (`src/core/api-wrapper.ts:129`) его использует. Разница в наблюдаемости между сервером и клиентом. | Либо убрать (React печатает сам), либо отправлять в Sentry с `componentStack` в контексте и оставить `console.error` только в dev. |
| 5 | мелочь | `src/lib/seed/equipment.seed.ts:7,51,64,67,71` | 5 вызовов `console.log`/`console.error` в `src` — самый крупный кусок «console вместо logger» в области. Логируются названия оборудования из локального массива (`eq.name`, строки 11–44) и `error` от Prisma. Персональных данных нет. | Формально это runtime-код в `src`, но фактически dev-сид: ESLint сам исключает `src/lib/seed/**` из правила `no-console` (`eslint.config.mjs:75,82`). Проблема не в секретах, а в том, что это единственное место в `src` (кроме самого логгера), где `console.log` разрешён конфигом, — при копировании файла как образца лог в «правильном» каталоге размножится. | Перенести файл из `src/lib/seed/**` в `scripts/` (там `no-console` тоже off) — тогда «console в `src`» останется ровно в одном месте — реализации логгера. Либо оставить как есть и не считать нарушением (сейчас так и есть). |
| 6 | мелочь | `src/core/api-wrapper.ts:122` | `logger.warn('API handler hit a Prisma constraint', { domain, code: error.code, message: error.message })` — в лог целиком пишется текст ошибки Prisma. | Текст Prisma называет таблицы и поля схемы. По фикстуре проекта (`src/core/__tests__/api-wrapper.test.ts:228`) сообщение P2002 выглядит как ``Unique constraint failed on the fields: (`pinLookup`)`` — т.е. в лог попадает **имя поля** `pinLookup`, а не его значение. Утечки значения я не подтвердил (см. «Не проверено»), но имя поля, по которому ищется пользователь, в общем логе — лишнее. | Логировать `code` и `domain` без `message` (сам код P2002/P2025 уже однозначен), либо оставить только `domain` + `code`. Значение клиенту всё равно не отдаётся — в этом смысл ветки. |
| 7 | мелочь | `src/core/error-boundary/api-error-boundary.ts:283-292` | `logger[opts.logLevel](...)` — уровень лога берётся из строки, и для системных/таймаут-ошибок в лог пишутся `errorCtx.originalError?.stack`, `userId`, `tenantId` и здоровье всех circuit breaker'ов. | Не утечка секретов (это внутренние id), но: стек пользовательской ошибки в системном логе и полный снимок circuit breaker'ов на каждую системную ошибку — объёмный и шумный лог; тип `logLevel` — `'error'\|'warn'\|'info'`, поэтому `logger[opts.logLevel]` типизирован корректно, придирок нет. | Оставить только `category/domain/handler/traceId`, а стек — по флагу; `getCircuitBreakerHealth()` вынести из горячего пути. |
| 8 | мелочь | `src/core/api-wrapper.ts:62`, `src/core/api-wrapper.ts:177` | Единственные два места в области с disable **без обоснования**: `export function withApi<T extends any[]>(`, то же для `withMutation<T extends any[]>`. Правильный тип очевиден. | Причина, по которой здесь вообще стоит disable, не записана — следующий читатель не знает, снимать его или нет. Само `any[]` отключает проверку элементов кортежа аргументов роут-хендлера. | `T extends unknown[]` — ведёт себя так же (T выводится из сигнатуры), disable убирается целиком. |
| 9 | мелочь | `src/components/piling/inspections/template-editor.tsx:64`, `:68` | disable без обоснования: `(template.sections ?? []).map((s: any) => ...)` и `(s.items ?? []).map((it: any) => ...)` — разбор ответа `GET /api/checklist-templates/{id}` (строка 53) сырым `res.json()`, типом ответа не описан вовсе. | Компилятор здесь не проверяет ни одно поле: опечатка в `it.createsDefect`/`it.answerType` дойдёт до прода как `undefined`, а `answerType` тут же кастится через `as AnswerType` (строка 71) — то есть мусор примет вид валидного типа. | Объявить в этом файле локальный DTO (`interface TemplateSectionDto { title?: string; items?: TemplateItemDto[] }`, поля — по строке 64–78) и убрать оба `any`. **Важно:** не импортировать сюда `TemplateSectionInput`/`TemplateItemInput` из `src/modules/inspections/application/commands/template-commands.ts:5-12` — тот файл первым импортом тянет `db` (`@/lib/db`), и Prisma уедет в клиентский бандл. |
| 10 | мелочь | `src/services/reports/report-history.ts:42-55` | Блочный `/* eslint-disable @typescript-eslint/no-explicit-any */` без обоснования закрывает три параметра: `arr.map((p: any) => ...)` (45), `(d: any)` (49, 53). | Вход у всех трёх функций уже типизирован как `unknown` и защищён `Array.isArray` (строки 43–44), т.е. тип элемента всё равно не проверяется — `any` тут ничего не покупает, только прячет доступ к полям. | Объявить три локальных интерфейса (`{ pileGradeId?: string; count?: number }`, `{ typeId?: string; count?: number; meters?: number }`, `{ reasonId?: string; duration?: number }`) и сузить `Array.isArray(arr) ? (arr as RowDto[]) : []`; блочный disable снимается. |
| 11 | мелочь | `src/core/realtime/server/auth.ts:182` | `export function sendAuthError(ws: http.ServerResponse \| any, ...)` — с обоснованием «untyped external/library boundary», но фактически это **не** `http.ServerResponse`: тело вызывает `ws.send(...)` и `ws.close(1008, message)` (строки 184–190), то есть это WebSocket-подобный объект. `any` в объединении обнуляет проверку всего модуля аутентификации WS. | Модуль аутентификации реального времени — security-critical по существу (проверка сессии/tenant на подключении), хотя формально не входит в перечисленные в задании каталоги (b). Опечатка в имени метода (`ws.sen` вместо `ws.send`) не будет поймана компилятором, а её проглатывает `catch {}` (строка 191) — отказ аутентификации станет тихим. | Заменить на минимальный интерфейс: `interface WsLike { send(data: string): void; close(code?: number, reason?: string): void }`. |
| 12 | мелочь | `src/lib/request-context.ts:174-175` | `} as any;` с обоснованием «untyped external/library boundary», хотя объект — собственный: возвращаемый литерал, в который добавлено приватное поле `_childContext` (строка 173), отсутствующее в объявленном типе. | Обоснование неверное и маскирует настоящую причину (лишнее поле вне контракта). При рефакторинге типа никто не узнает, что каст держится ровно на `_childContext`. | Либо включить `_childContext` в тип возвращаемого контекста, либо убрать поле и каст; если каст нужен — переписать обоснование по существу. |
| 13 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:138-139`, `:201-202` | Три disable с обоснованием «telemetry enum/Prisma cast at the ingestion boundary», но по факту это граница **опциональной зависимости**: `let mqtt: any` для динамического `import('mqtt')` (строка 142, рядом уже стоит `@ts-expect-error mqtt is optional` на 141) и `const client = mqttClient as any` (202). | Обоснование не описывает реальную причину (текст скопирован из соседнего кейса в этом же файле — строка 107). Из-за `any` интерфейс MQTT-клиента не проверяется вообще, хотя это внешняя библиотека и здесь типы как раз есть (`mqtt` в devDeps типизирован самим пакетом... не проверял — см. «Не проверено»). | Для `mqtt` использовать `typeof import('mqtt')` (`let mqtt: typeof import('mqtt') \| null`) — тип есть без установки пакета, поскольку строка 141 и так подавляет отсутствие модуля; для `client` — тип из того же модуля. Обоснования привести к реальной причине. |
| 14 | мелочь | `src/core/cache/response-cache.ts:200-201`, `src/core/media/media-service.ts:427-428`, `src/core/realtime/server/ws-server.ts:162-165,181-182`, `src/modules/reports/application/commands/upsert-report.command.ts:27-30` | Причина «untyped external/library boundary» стоит на **своём** коде, а не на внешних библиотеках: `cloneResponse(value) as any` — собственная функция; `private toMediaRecord(media: any)` — строка Prisma-модели; `clients.subscribe(ws, channel as any)` — собственный `ClientManager`; `report: any; events: readonly any[]` — собственные доменные объекты. Таких «внешних границ» 35 из 68 обоснованных токенов. | Обоснование перестаёт работать как обоснование: если 35 комментариев одинаковы и часть из них заведомо неверна, проверяющий их больше не читает — а именно под ними прячутся настоящие проблемы (см. №2, №11). Это аудит-гигиена, а не баг. | Разбить формулировку на реальные причины: «строка Prisma-модели», «внутренний приватный API класса», «доменный объект до маппинга». Отдельно — заменить на нормальные типы те 4 случая, где тип очевиден. |
| 15 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:112-113,378-379,390-391,402-403,464-488` | Крупнейший кластер: **11** disable-комментариев в одном файле. Часть — построчные касты на `as any[]` (`r.piles as any[]`, `r.drillings as any[]`, `r.downtimes as any[]` — строки 465, 467, 469, 482, 484, 486, 488). | Все они относятся к одному и тому же расхождению: тип результата запроса с `include` не совпадает с локальным типом строки CSV-экспорта. Пока таких кастов 11, любое переименование поля в выборке (`d.meters` → `d.meterCount`) пройдёт мимо компилятора и даст пустую колонку в экспорте. | Описать локальный тип строки экспорта (одним интерфейсом на сваи/бурение/простои) и сделать один каст от результата запроса к нему — 11 disable сведутся к 1–3. |
| 16 | мелочь | `src/workers/unified-worker/pdf.ts:29-30` | `const data = job.data as Record<string, any>;` — обоснование есть («untyped external/library boundary»), но `Record<string, any>` внутри процесса-воркера дальше не проверяется ни на одном поле. | PDF-воркер принимает задачи из очереди; полезная нагрузка с фронта могла бы быть описана схемой (в проекте для этого есть `src/lib/validation-schemas.ts`). При `any` неверный job-контракт виден только падением внутри рендера. | Типизировать `job.data` конкретной формой задачи PDF (id отчёта и т.п.); если форма неизвестна — `Record<string, unknown>` плюс явные проверки полей. |
| 17 | мелочь | `src/core/outbox/dead-letter-queue.ts:80-81` | Комментарий обещает то, чего в коде нет: `// Last resort — log to console`, а строкой ниже вызывается `logger.error(...)`. | Обманутый читатель: при разборе инцидента с DLQ комментарий отправляет искать вывод в stdout сырым `console`, хотя запись идёт структурным JSON через логгер (и, значит, подчиняется `LOG_LEVEL`). Строкой выше, в этом же файле, обоснования у disable-комментариев корректные — тем заметнее. | Заменить комментарий на «последняя попытка — пишем в структурный лог» или удалить: строка 81 сама себя объясняет. |

### Что в таблицу не попало, но проверялось

* `src/lib/logger.ts:71,74,78` — `console.error/warn/log` внутри **реализации** логгера. Это не «console вместо logger»: `error`/`warn` разрешены конфигом (`eslint.config.mjs:43`), на строке 78 стоит `// eslint-disable-next-line no-console` (77). Единственное легальное место `console` в `src`.
* Все 68 токенов `any` группы (a) с обоснованием — только счёт (разбивка по причинам и по файлам в приложении). Один из них читался отдельно и попал в таблицу как отдельная проблема: №2.
* Проверено и **чисто** (a) в `src/services/auth/**` ни одного `any` — только слово «any» в комментариях (`auth-service.ts:252`, `session-service.ts:93,137,142`); (b) в `src/core/security/**` — то же (`encryption.ts:46,86`); (c) `src/lib/rate-limiter.ts` — ни одного вхождения. Дополнительно проверены соседние security-файлы, не входившие в задание: `src/lib/auth.ts`, `src/lib/csrf-protection.ts`, `src/core/media/media-auth.ts`, `src/services/auth/authorization-service.ts`, `src/services/auth/resource-access-service.ts` — вхождений `any` нет.

### Прочее, найденное по ходу (вне вопроса, не правил)

* `src/services/auth/auth-service.ts:228` — `logger.error('authenticateUserByEmailPassword failed', err)`: логируется объект ошибки из пути аутентификации. `src/lib/logger.ts:97-99` пишет только `message` и `stack` — сам пароль в них не попадает, но если исключение брошено Prisma, в `message` могут оказаться фрагмент запроса и параметры. Подтвердить сценарий без прогона не могу → в таблицу не выношу.
* `src/services/telemetry/device-key-service.ts` (device-ключи телеметрии) — просмотрен на предмет логирования ключа: вызовов `console`/`logger` с ключом не найдено; строки 21, 135 — только комментарии. Конкретных `logger.*` в файле мой греп не показал.

## Не проверено

1. **Замороженная зона ORION (исключена по условию задачи), но там есть утечка ПДн в лог.** `src/app/api/orion/lead/route.ts:83` и `:100` пишут в лог **имя, контакт и текст заявки** посетителя: `logger.error('ORION lead could not be stored', { error, name, contact, message })`. По шкале задания это «критично» (персональные данные в логе), но файл входит в замороженную зону `src/app/api/orion/**`, поэтому в таблицу находок он не вынесен и я его не трогал. Строка `:104` рядом устроена правильно — `{ leadId, isSpam, hasMessage: message.length > 0 }` без содержимого. Нужно решение владельца.
2. **Значения в тексте ошибок Prisma.** Находка №6: подтверждено, что в сообщении есть **имя поля** (`src/core/__tests__/api-wrapper.test.ts:228`), но я не проверял, попадают ли в `error.message` на этом проекте **значения** полей (у Prisma это `meta.target`, а не текст сообщения). Без запуска приложения с реальной ошибкой утверждать не могу.
3. **`pino` в `src/core/observability/logger.ts` — исполняется ли он где-нибудь косвенно.** Проверено текстовым поиском по всему репозиторию (включая `tests/`, `e2e/`, `scripts/`, конфиги) — импортов нет. Динамический импорт по вычисленной строке поиском не обнаруживается; исключить его полностью нельзя.
4. **Наличие типов у пакета `mqtt`** (находка №13): рекомендую `typeof import('mqtt')`, но установлен ли этот пакет в `node_modules` и есть ли у него `.d.ts`, я не смотрел (`@ts-expect-error` на строке 141 говорит, что пакет как раз может отсутствовать). Проверять установку пакетов в рамках read-only аудита не стал.
5. **TSX-часть клиентских экранов внутри замороженных каталогов** (`src/components/piling/operator*/**`, `src/app/operator/**`) — на предмет `console.*`/`any` не открывал, по условию задачи.
6. **`scripts/**` и `e2e/**`** — исключены условием; там `no-console` выключен конфигом (`eslint.config.mjs:68-82`), и `console.*` почти наверняка есть в больших количествах.
7. **ESLint-прогон не выполнялся** (read-only задача): утверждение «все `any` закрыты disable, незакрытых 0» получено собственным разбором файлов, а не запуском `npm run lint`. Расхождение возможно, если часть disable-комментариев ESLint считает неиспользуемыми (правило `@typescript-eslint/no-unused-disable-directive` в проекте выключено — `eslint.config.mjs:24`).

## Приложение. Группа (a): 68 токенов `any` с обоснованием — только счёт

Разбивка по тексту обоснования (одно вхождение = один закрытый disable):

| Обоснование | Токенов |
|---|---|
| `untyped external/library boundary` | 35 |
| `telemetry enum/Prisma cast at the ingestion boundary` | 13 |
| `Prisma JSON column / event payload is an arbitrary serializable shape` | 9 |
| `Prisma interactive-transaction callback client type isn't cleanly exported` | 7 |
| `Prisma row shape boundary in a mapper` | 3 |
| `MaintenanceType enum cast at the command boundary` | 1 |

По файлам (число disable-комментариев `no-explicit-any`):

```
src/modules/reports/application/queries/report-query.service.ts   11   ← №15
src/app/api/telemetry/route.ts                                     7
src/services/reports/outbox-publisher.ts                           6
src/core/realtime/server/ws-server.ts                              4    ← №2, №14
src/services/telemetry/mqtt-ingestion-service.ts                   3    ← №13
src/modules/reports/infrastructure/report.repository.ts            3
src/modules/crews/infrastructure/crew.repository.ts                3
src/services/reports/report-history.ts                             2    ← №10
src/modules/sites/infrastructure/site.prisma.mapper.ts             2
src/modules/reports/infrastructure/report.prisma.mapper.ts         2
src/modules/reports/application/commands/upsert-report.command.ts  2    ← №14
src/modules/crews/infrastructure/crew.prisma.mapper.ts             2
src/core/outbox/dead-letter-queue.ts                               2
src/core/media/media-service.ts                                    2    ← №14
src/core/event-bus/schema-registry/registry.ts                     2
src/core/api-wrapper.ts                                            2    ← №8
src/components/piling/inspections/template-editor.tsx              2    ← №9
src/app/api/telemetry/batch/route.ts                               2
src/workers/unified-worker/pdf.ts                                  1    ← №16
src/services/reports/event-handlers.ts                             1
src/services/reports/audit-service.ts                              1
src/services/feedback/feedback-event-service.ts                    1
src/modules/equipment/infrastructure/equipment.repository.ts       1
src/modules/equipment/application/commands/maintenance-plan.ts     1
src/lib/request-context.ts                                         1    ← №12
src/lib/pdf-generator/render.ts                                    1
src/core/realtime/server/auth.ts                                   1    ← №11
src/core/realtime/publisher/ws-publisher.ts                        1
src/core/realtime/alerts/engine.ts                                 1
src/core/infrastructure/raw-queries.ts                             1
src/core/cache/response-cache.ts                                   1    ← №14
src/components/piling/monitoring/fleet-dashboard.tsx               1
src/app/api/telemetry/ingest/route.ts                              1
```

Каждый файл из списка открывался; обоснование стоит на строке непосредственно над кастом (проверено построчно), кроме `src/services/reports/report-history.ts`, где это блочный `eslint-disable` на строке 42.
